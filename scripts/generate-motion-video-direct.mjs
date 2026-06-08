import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { buildMotionDirectorPrompt } from '../lib/motion-prompt-director.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

function loadLocalEnv() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (!key || Object.hasOwn(process.env, key)) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function reduceAspectRatio(size) {
  const match = /^(\d+)\s*x\s*(\d+)$/i.exec(String(size || ''));
  if (!match) return String(size || '16x9');
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return '16x9';
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const divisor = gcd(width, height);
  return `${width / divisor}x${height / divisor}`;
}

function parseArgs(argv) {
  const args = [...argv];
  let outDir = '';
  const files = [];
  while (args.length) {
    const item = args.shift();
    if (item === '--out') {
      outDir = args.shift() || '';
    } else {
      files.push(item);
    }
  }
  return { outDir, files: files.slice(0, 3) };
}

function normalizeMotionVideoModelForEndpoint(model, endpoint) {
  const value = String(model || '').trim();
  const isN1n = /(^|[/.])n1n\.ai/i.test(endpoint || '');
  if (isN1n && /^veo[_-]?3[_-]?1(?:[-_]?4k)?$/i.test(value)) return 'veo_3_1';
  return value;
}

async function readJsonResponse(response, context) {
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || text || `HTTP ${response.status}`;
    throw new Error(`${context} failed: ${String(message).replace(/\s+/g, ' ').slice(0, 500)}`);
  }
  if (!payload) throw new Error(`${context} failed: empty JSON response`);
  return payload;
}

function looksLikeCloudflareHtml(text = '') {
  return /cloudflare|Attention Required|cf-ray|Just a moment/i.test(String(text || ''));
}

async function submitJsonFallback({
  videoEndpoint,
  apiKey,
  videoModel,
  prompt,
  seconds,
  size,
  sourceImages,
}) {
  const dataUrls = sourceImages.map((buffer) => `data:image/jpeg;base64,${buffer.toString('base64')}`);
  const body = {
    model: videoModel,
    prompt,
    seconds,
    size,
    watermark: false,
    image: dataUrls[0],
    images: dataUrls,
    input_reference: dataUrls[0],
  };
  const response = await fetch(videoEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  return readJsonResponse(response, 'Submit video JSON fallback');
}

async function downloadVideo(videoUrl, dest, endpoint, apiKey, depth = 0) {
  const needsAuth = String(videoUrl).startsWith(endpoint.replace(/\/$/, ''));
  const response = await fetch(videoUrl, {
    headers: needsAuth ? { Authorization: `Bearer ${apiKey}`, Accept: 'application/json, video/*;q=0.9, */*;q=0.8' } : undefined,
  });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error('Download failed: empty content');
  if (/json/i.test(contentType)) {
    const payload = JSON.parse(buffer.toString('utf8'));
    const nestedUrl = payload?.video_url || payload?.url || payload?.result_url || payload?.content?.video_url;
    if (nestedUrl && depth < 3) return downloadVideo(nestedUrl, dest, endpoint, apiKey, depth + 1);
    throw new Error(`Download JSON did not contain video URL: ${JSON.stringify(payload).slice(0, 240)}`);
  }
  await writeFile(dest, buffer);
  return buffer.length;
}

loadLocalEnv();

const { outDir: requestedOutDir, files } = parseArgs(process.argv.slice(2));
if (!files.length) {
  console.error('Usage: node scripts/generate-motion-video-direct.mjs [--out <dir>] <image1> [image2] [image3]');
  process.exit(1);
}

const outputDir = requestedOutDir
  ? path.resolve(ROOT_DIR, requestedOutDir)
  : path.join(ROOT_DIR, '.data', 'generated', `direct-motion-${Date.now().toString(36)}`);
await mkdir(outputDir, { recursive: true });
console.log(`OUTPUT_DIR=${outputDir}`);

const apiKey = process.env.MOTION_VIDEO_API_KEY || process.env.OPENAI_API_KEY || process.env.N1N_API_KEY || '';
const openaiApiKey = process.env.OPENAI_API_KEY || process.env.N1N_API_KEY || '';
const baseUrl = process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE || '';
const copyEndpoint = process.env.COPY_API_ENDPOINT || (baseUrl ? `${baseUrl.replace(/\/$/, '')}/chat/completions` : '');
const videoEndpoint = process.env.MOTION_VIDEO_ENDPOINT || (baseUrl ? `${baseUrl.replace(/\/$/, '')}/videos` : 'https://api.n1n.ai/v1/videos');
const videoModel = normalizeMotionVideoModelForEndpoint(process.env.MOTION_VIDEO_MODEL || 'veo_3_1', videoEndpoint);
const seconds = String(Number(process.env.MOTION_VIDEO_DURATION || 8));
const size = process.env.MOTION_VIDEO_ASPECT_RATIO || reduceAspectRatio(process.env.MOTION_VIDEO_SIZE || '1280x720');
const maxEdge = Number(process.env.MOTION_VIDEO_REFERENCE_MAX_EDGE || 1024);
const quality = Number(process.env.MOTION_VIDEO_REFERENCE_QUALITY || 86);

const sourceImages = [];
for (const [index, file] of files.entries()) {
  const fullPath = path.resolve(ROOT_DIR, file);
  if (!existsSync(fullPath)) throw new Error(`Image not found: ${file}`);
  const buffer = await sharp(await readFile(fullPath))
    .rotate()
    .resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer();
  sourceImages.push(buffer);
  const filename = index === 0 ? 'motion-source.jpg' : `motion-reference-${index + 1}.jpg`;
  await writeFile(path.join(outputDir, filename), buffer);
}

console.log(`[director] Generating Gemini prompt for ${sourceImages.length} reference image(s)...`);
const prompt = await buildMotionDirectorPrompt({
  sourceImages,
  endpoint: copyEndpoint,
  apiKey: openaiApiKey,
  model: process.env.MOTION_DIRECTOR_MODEL || process.env.COPY_MODEL || process.env.OPENAI_TEXT_MODEL || 'gemini-3.5-flash',
  timeoutMs: Number(process.env.MOTION_DIRECTOR_PROMPT_TIMEOUT_MS || 180_000),
  maxTokens: Number(process.env.MOTION_DIRECTOR_PROMPT_MAX_TOKENS || 4000),
  visionMaxEdge: Number(process.env.COPY_VISION_MAX_EDGE || 768),
  visionImageQuality: Number(process.env.COPY_VISION_IMAGE_QUALITY || 70),
});
await writeFile(path.join(outputDir, 'motion-prompt.txt'), `${prompt}\n`, 'utf8');
console.log(`[director] ${prompt}`);

const form = new FormData();
form.append('model', videoModel);
form.append('prompt', prompt);
form.append('size', size);
for (const [index, buffer] of sourceImages.entries()) {
  const filename = index === 0 ? 'motion-source.jpg' : `motion-reference-${index + 1}.jpg`;
  form.append('input_reference', new Blob([buffer], { type: 'image/jpeg' }), filename);
}

console.log(`[motion] Submitting ${videoModel}, ${seconds}s, ${size}...`);
const submitResponse = await fetch(videoEndpoint, {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  body: form,
});
let submitPayload;
if (!submitResponse.ok) {
  const text = await submitResponse.text();
  if (looksLikeCloudflareHtml(text)) {
    console.log('[motion] Multipart upload was blocked by Cloudflare, retrying JSON data-url fallback...');
    submitPayload = await submitJsonFallback({
      videoEndpoint,
      apiKey,
      videoModel,
      prompt,
      seconds,
      size,
      sourceImages,
    });
  } else {
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch {}
    const message = payload?.error?.message || payload?.message || text || `HTTP ${submitResponse.status}`;
    throw new Error(`Submit video failed: ${String(message).replace(/\s+/g, ' ').slice(0, 500)}`);
  }
} else {
  const text = await submitResponse.text();
  submitPayload = text ? JSON.parse(text) : null;
}
await writeFile(path.join(outputDir, 'motion-submit.json'), `${JSON.stringify(submitPayload, null, 2)}\n`, 'utf8');
const taskId = submitPayload?.task_id || submitPayload?.id;
if (!taskId) throw new Error('Submit video failed: missing task id');
console.log(`[motion] task_id=${taskId}`);

const startedAt = Date.now();
let lastStatus = '';
let finalInfo = null;
while (Date.now() - startedAt < Number(process.env.MOTION_VIDEO_POLL_TIMEOUT_MS || 600_000)) {
  await new Promise((resolve) => setTimeout(resolve, Number(process.env.MOTION_VIDEO_POLL_INTERVAL_MS || 8000)));
  const infoResponse = await fetch(`${videoEndpoint.replace(/\/$/, '')}/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });
  const info = await readJsonResponse(infoResponse, 'Query video');
  const status = String(info?.status || '').toLowerCase();
  const progress = Number(info?.progress || info?.output?.progress || 0);
  const marker = progress ? `${status || 'unknown'} ${progress}%` : (status || 'unknown');
  if (marker !== lastStatus) {
    console.log(`[motion] ${marker}`);
    lastStatus = marker;
  }
  if (['completed', 'succeeded', 'partial_succeeded'].includes(status)) {
    finalInfo = info;
    break;
  }
  if (['failed', 'error', 'canceled'].includes(status) || info?.error) {
    const message = info?.fail_reason || info?.error?.message || info?.message || 'unknown error';
    throw new Error(`Video generation failed: ${message}`);
  }
}

if (!finalInfo) throw new Error('Video generation timed out');
await writeFile(path.join(outputDir, 'motion-result.json'), `${JSON.stringify(finalInfo, null, 2)}\n`, 'utf8');
const videoUrl = finalInfo?.video_url || finalInfo?.url || finalInfo?.result_url || finalInfo?.content?.video_url
  || `${videoEndpoint.replace(/\/$/, '')}/${encodeURIComponent(taskId)}/content`;
console.log(`[motion] Downloading ${videoUrl}`);
const videoPath = path.join(outputDir, 'motion.mp4');
const bytes = await downloadVideo(videoUrl, videoPath, videoEndpoint, apiKey);
console.log(`[motion] saved=${videoPath} bytes=${bytes}`);

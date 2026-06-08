import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

loadLocalEnv();

const files = process.argv.slice(2).slice(0, 3);
if (!files.length) {
  console.error('Usage: node scripts/preview-motion-prompt.mjs <image1> [image2] [image3]');
  process.exit(1);
}

const baseUrl = process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE || '';
const endpoint = process.env.COPY_API_ENDPOINT || (baseUrl ? `${baseUrl.replace(/\/$/, '')}/chat/completions` : '');
const sourceImages = files.map((file) => {
  const fullPath = path.resolve(ROOT_DIR, file);
  if (!existsSync(fullPath)) throw new Error(`Image not found: ${file}`);
  return readFileSync(fullPath);
});

const prompt = await buildMotionDirectorPrompt({
  sourceImages,
  endpoint,
  apiKey: process.env.OPENAI_API_KEY || process.env.N1N_API_KEY || '',
  model: process.env.MOTION_DIRECTOR_MODEL || process.env.COPY_MODEL || process.env.OPENAI_TEXT_MODEL || 'gemini-3.5-flash',
  timeoutMs: Number(process.env.MOTION_DIRECTOR_PROMPT_TIMEOUT_MS || 180_000),
  maxTokens: Number(process.env.MOTION_DIRECTOR_PROMPT_MAX_TOKENS || 4000),
  visionMaxEdge: Number(process.env.COPY_VISION_MAX_EDGE || 768),
  visionImageQuality: Number(process.env.COPY_VISION_IMAGE_QUALITY || 70),
});

console.log(prompt);

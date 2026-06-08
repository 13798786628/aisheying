import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { request as httpsRequest } from 'node:https';
import { promisify } from 'node:util';
import OpenAI, { toFile } from 'openai';
import sharp from 'sharp';
import ffmpegStatic from 'ffmpeg-static';
import opentype from 'opentype.js';
import { buildMotionDirectorPrompt } from './lib/motion-prompt-director.mjs';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadLocalEnv() {
  const envPath = path.join(__dirname, '.env');
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

const PORT = Number(process.env.PORT || 5173);
const DATA_DIR = path.join(__dirname, '.data');
const GENERATED_DIR = path.join(DATA_DIR, 'generated');
const RESOURCES_DIR = path.join(DATA_DIR, 'resources');
const RESOURCES_MANIFEST = path.join(DATA_DIR, 'resources-manifest.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const TENANTS_FILE = path.join(DATA_DIR, 'tenants.json');
const JOB_LEDGER_FILE = path.join(DATA_DIR, 'job-ledger.json');
const STATIC_ROOT = process.env.STATIC_ROOT
  ? path.resolve(process.env.STATIC_ROOT)
  : path.join(__dirname, 'dist');
const COMPARISON_LABEL_FONT = process.env.COMPARISON_LABEL_FONT
  ? path.resolve(process.env.COMPARISON_LABEL_FONT)
  : path.join(__dirname, 'assets', 'fonts', 'NotoSansSC-Bold.otf');

const OPENAI_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';
const IMAGE_QUALITY = process.env.OPENAI_IMAGE_QUALITY || 'medium';
const XIAOJI_IMAGE_ENDPOINT = process.env.XIAOJI_IMAGE_ENDPOINT || 'https://xiaoji.baziapi.site/v1/images/generations';
const XIAOJI_EDIT_ENDPOINT = process.env.XIAOJI_EDIT_ENDPOINT || XIAOJI_IMAGE_ENDPOINT.replace(/\/images\/generations\/?$/, '/images/edits');
const XIAOJI_API_KEY = process.env.XIAOJI_API_KEY || process.env.IMAGE_API_KEY || '';
const XIAOJI_IMAGE_MODEL = process.env.XIAOJI_IMAGE_MODEL || process.env.IMAGE_API_MODEL || 'gpt-image-2';
const XIAOJI_REFERENCE_FIELD = process.env.XIAOJI_REFERENCE_FIELD || '';
const XIAOJI_IMAGE_INPUT_MODE = (process.env.XIAOJI_IMAGE_INPUT_MODE || 'edit').toLowerCase();
const XIAOJI_EDIT_IMAGE_FIELD = process.env.XIAOJI_EDIT_IMAGE_FIELD || 'image';
const DEFAULT_IMAGE_SIZE = process.env.DEFAULT_IMAGE_SIZE || '1024x1024';
const STORYBOARD_IMAGE_SIZE = process.env.STORYBOARD_IMAGE_SIZE || '1536x864';
const SIMILAR_IMAGE_MAX_EDGE = Number(process.env.SIMILAR_IMAGE_MAX_EDGE || 1280);
const USE_MOCK_IMAGES = process.env.USE_MOCK_IMAGES === 'true';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.N1N_API_KEY || '';
const OPENAI_REQUEST_TIMEOUT_MS = Number(process.env.OPENAI_REQUEST_TIMEOUT_MS || 600_000);
const DESIGN_RENDER_IMAGE_TIMEOUT_MS = Number(process.env.DESIGN_RENDER_IMAGE_TIMEOUT_MS || 180_000);
const DESIGN_RENDER_MAX_ATTEMPTS = Math.max(1, Number(process.env.DESIGN_RENDER_MAX_ATTEMPTS || 1));
const DESIGN_RENDER_CONCURRENCY = Math.max(1, Number(process.env.DESIGN_RENDER_CONCURRENCY || 1));
const IMAGE_CONCURRENCY = Math.max(1, Number(process.env.IMAGE_CONCURRENCY || 1));
const REFERENCE_IMAGE_MAX_EDGE = Number(process.env.REFERENCE_IMAGE_MAX_EDGE || 1280);
const REFERENCE_IMAGE_QUALITY = Number(process.env.REFERENCE_IMAGE_QUALITY || 86);

function hasUsableSecret(value) {
  return !!value && !/^replace_|^your_|^test_/i.test(value.trim());
}

const HAS_XIAOJI_KEY = hasUsableSecret(XIAOJI_API_KEY);
const HAS_OPENAI_KEY = hasUsableSecret(OPENAI_API_KEY);
const IMAGE_PROVIDER = (process.env.IMAGE_PROVIDER || (HAS_XIAOJI_KEY ? 'xiaoji' : (HAS_OPENAI_KEY ? 'openai' : 'mock'))).toLowerCase();
const USE_N1N = IMAGE_PROVIDER === 'n1n' || IMAGE_PROVIDER === 'n1n.ai';
const USE_OPENAI_COMPAT = !USE_MOCK_IMAGES && (IMAGE_PROVIDER === 'openai' || USE_N1N) && HAS_OPENAI_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE || (USE_N1N ? 'https://api.n1n.ai/v1' : '');
const OPENAI_PROVIDER_LABEL = process.env.OPENAI_PROVIDER_LABEL || (USE_N1N ? 'n1n.ai' : 'OpenAI');
const N1N_IMAGE_EDIT_ENDPOINT = process.env.N1N_IMAGE_EDIT_ENDPOINT || `${OPENAI_BASE_URL.replace(/\/$/, '')}/images/edits`;
const N1N_IMAGE_INPUT_MODE = (process.env.N1N_IMAGE_INPUT_MODE || process.env.OPENAI_IMAGE_INPUT_MODE || 'auto').toLowerCase();
const N1N_EDIT_IMAGE_FIELD = process.env.N1N_EDIT_IMAGE_FIELD || process.env.N1N_IMAGE_EDIT_FIELD || 'image';
// n1n.ai 兼容 /v1/images/generations，并扩展支持 JSON body 里塞 image=data:URI 做参考图（用于绕过 Cloudflare WAF 对 multipart 的拦截）
const N1N_IMAGE_GENERATIONS_ENDPOINT = process.env.N1N_IMAGE_GENERATIONS_ENDPOINT || `${OPENAI_BASE_URL.replace(/\/$/, '')}/images/generations`;
const COPY_MODEL = process.env.COPY_MODEL || process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini';
const MOTION_DIRECTOR_MODEL = process.env.MOTION_DIRECTOR_MODEL || COPY_MODEL;
const COPY_API_ENDPOINT = process.env.COPY_API_ENDPOINT || (OPENAI_BASE_URL ? `${OPENAI_BASE_URL.replace(/\/$/, '')}/chat/completions` : '');
const COPY_REQUEST_TIMEOUT_MS = Number(process.env.COPY_REQUEST_TIMEOUT_MS || 120_000);
const MOTION_DIRECTOR_PROMPT_TIMEOUT_MS = Number(process.env.MOTION_DIRECTOR_PROMPT_TIMEOUT_MS || 180_000);
const COPY_VISION_MAX_EDGE = Number(process.env.COPY_VISION_MAX_EDGE || 768);
const COPY_VISION_IMAGE_QUALITY = Number(process.env.COPY_VISION_IMAGE_QUALITY || 70);
const COPY_GENERATED_IMAGE_LIMIT = Number(process.env.COPY_GENERATED_IMAGE_LIMIT || 4);
const ENABLE_COPY_API = process.env.ENABLE_COPY_API !== 'false';
const USE_COPY_API = !USE_MOCK_IMAGES && ENABLE_COPY_API && HAS_OPENAI_KEY && !!COPY_API_ENDPOINT && !!COPY_MODEL;
const USE_XIAOJI = !USE_MOCK_IMAGES && IMAGE_PROVIDER === 'xiaoji' && HAS_XIAOJI_KEY;
const ACTIVE_PROVIDER = USE_XIAOJI ? 'xiaoji' : (USE_OPENAI_COMPAT ? OPENAI_PROVIDER_LABEL : 'mock');
const ACTIVE_MODEL = USE_XIAOJI ? XIAOJI_IMAGE_MODEL : (USE_OPENAI_COMPAT ? OPENAI_MODEL : 'mock');
const PUBLIC_ACCESS_CODE = (process.env.PUBLIC_ACCESS_CODE || '').trim();
const ACCESS_COOKIE_NAME = process.env.ACCESS_COOKIE_NAME || 'wedscene_access';
const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || OPENAI_API_KEY || XIAOJI_API_KEY || 'wedscene-local-access';
const ACCESS_COOKIE_MAX_AGE_SECONDS = Number(process.env.ACCESS_COOKIE_MAX_AGE_SECONDS || 60 * 60 * 24 * 30);
const ACCESS_COOKIE_SECURE = process.env.ACCESS_COOKIE_SECURE === 'true';
const ACCOUNT_SYSTEM_ENABLED = process.env.ACCOUNT_SYSTEM_ENABLED === 'true';
const ACCOUNT_COOKIE_NAME = process.env.ACCOUNT_COOKIE_NAME || 'wedscene_user';
const ACCOUNT_TOKEN_SECRET = process.env.ACCOUNT_TOKEN_SECRET || ACCESS_TOKEN_SECRET;
const ABANDONED_JOB_REFUND_GRACE_MS = Number(process.env.ABANDONED_JOB_REFUND_GRACE_MS || 2 * 60 * 1000);
const LEGACY_MOTION_REFUND_AFTER = process.env.LEGACY_MOTION_REFUND_AFTER || '2026-06-01T00:00:00.000Z';
const LEGACY_MOTION_REFUND_BEFORE = process.env.LEGACY_MOTION_REFUND_BEFORE || '2026-06-04T00:00:00.000Z';
const TRIAL_POINTS = Number(process.env.TRIAL_POINTS || 5);
const JOB_POINT_COST = Number(process.env.JOB_POINT_COST || process.env.SINGLE_IMAGE_POINT_COST || 5);
const TEXT_POINT_COST = Number(process.env.TEXT_POINT_COST || process.env.COPY_POINT_COST || JOB_POINT_COST);
const SIX_IMAGE_POINT_COST = Number(process.env.SIX_IMAGE_POINT_COST || process.env.IMAGE_PACK_POINT_COST || JOB_POINT_COST * 6);
const DESIGN_RENDER_POINT_COST = Number(process.env.DESIGN_RENDER_POINT_COST || 20);
const ADMIN_TOKEN = (process.env.ADMIN_TOKEN || '').trim();
const SUPPORT_WECHAT = (process.env.SUPPORT_WECHAT || '').trim();
const SUPPORT_WECHAT_QR = (process.env.SUPPORT_WECHAT_QR || '').trim();
const SUPPORT_WECHAT_2 = (process.env.SUPPORT_WECHAT_2 || '').trim();
const SUPPORT_WECHAT_QR_2 = (process.env.SUPPORT_WECHAT_QR_2 || '').trim();
const SITE_BRAND_NAME = (process.env.SITE_BRAND_NAME || 'WedScene').trim();
const SITE_LOGO_URL = (process.env.SITE_LOGO_URL || '').trim();
const SITE_LOGO_TEXT = (process.env.SITE_LOGO_TEXT || 'W').trim();
const SITE_TAGLINE = (process.env.SITE_TAGLINE || 'WEDSCENE AI').trim();
const DEFAULT_RECHARGE_PLANS = '9.9元=100灵感值;99元=1200灵感值;199元=2600灵感值;399元=5600灵感值';
const RECHARGE_PLANS = process.env.RECHARGE_PLANS || DEFAULT_RECHARGE_PLANS;
const RECHARGE_PLAN_PROFILES = [
  { price: 9.9, name: '体验包', badge: '体验', description: '适合首次体验AI视频', durationDays: 3, durationText: '3天体验' },
  { price: 99, name: '月度包', badge: '月卡', featured: true, description: '适合一个月持续创作', durationDays: 30, durationText: '1个月有效' },
  { price: 199, name: '半年包', badge: '半年', featured: true, description: '适合半年稳定使用', durationDays: 180, durationText: '半年有效' },
  { price: 399, name: '包年档', badge: '最划算', featured: true, description: '一年超低成本使用AI', durationDays: 365, durationText: '一年有效' },
];
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const API_CORS_ORIGINS = new Set(
  (process.env.API_CORS_ORIGINS || process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean)
);
const MOTION_VIDEO_MODEL = process.env.MOTION_VIDEO_MODEL || 'veo_3_1-fast-components-4K';
const MOTION_VIDEO_ENDPOINT = process.env.MOTION_VIDEO_ENDPOINT || (OPENAI_BASE_URL ? `${OPENAI_BASE_URL.replace(/\/$/, '')}/videos` : 'https://api.n1n.ai/v1/videos');
// 阿里百炼 dashscope 格式：endpoint 含 /alibailian/ 时启用
const MOTION_VIDEO_IS_ALIBAILIAN = /\/alibailian\//.test(MOTION_VIDEO_ENDPOINT);
// 小鸡聚合 AI：endpoint 含 xiaoji/baziapi 时启用（Veo 走 multipart input_reference）
const MOTION_VIDEO_IS_XIAOJI = /xiaoji|baziapi/i.test(MOTION_VIDEO_ENDPOINT);
const MOTION_VIDEO_IS_N1N_UNIFIED = /\/v1\/video\/create\/?$/i.test(MOTION_VIDEO_ENDPOINT);
const MOTION_VIDEO_IS_N1N_OPENAI = !MOTION_VIDEO_IS_XIAOJI
  && !MOTION_VIDEO_IS_N1N_UNIFIED
  && (USE_N1N || /(^|[/.])n1n\.ai/i.test(MOTION_VIDEO_ENDPOINT) || /(^|[/.])llm-api\.net/i.test(MOTION_VIDEO_ENDPOINT));

function appendNoProxyHost(host) {
  const cleanHost = String(host || '').trim();
  if (!cleanHost) return;
  const current = String(process.env.NO_PROXY || process.env.no_proxy || '');
  const parts = current.split(',').map((item) => item.trim()).filter(Boolean);
  if (!parts.some((item) => item.toLowerCase() === cleanHost.toLowerCase())) {
    process.env.NO_PROXY = [...parts, cleanHost].join(',');
  }
}

try {
  if (MOTION_VIDEO_IS_XIAOJI) appendNoProxyHost(new URL(MOTION_VIDEO_ENDPOINT).hostname);
} catch {}

function normalizeMotionVideoModelForEndpoint(model) {
  const value = String(model || '').trim();
  if (MOTION_VIDEO_IS_XIAOJI
    && (/^veo3(?:\.|_)?1(?:[-_.]?(?:components|fast|4k))*$/i.test(value)
      || /^veo[_-]?3[_-]?1(?:[-_]?components)?$/i.test(value))) {
    return 'veo_3_1-fast-fl';
  }
  if (MOTION_VIDEO_IS_N1N_UNIFIED && /veo.*(3[_-]?1|3\.1).*(component|fast|4k)|veo[_-]?3[_-]?1/i.test(value)) {
    return 'veo3.1-components';
  }
  if (MOTION_VIDEO_IS_N1N_OPENAI && /^veo[_-]?3[_-]?1(?:[-_]?4k)?$/i.test(value)) {
    return 'veo_3_1';
  }
  return value;
}
const MOTION_VIDEO_REQUEST_MODEL = normalizeMotionVideoModelForEndpoint(MOTION_VIDEO_MODEL);
function parseMotionVideoModelList(value = '') {
  return String(value || '')
    .split(',')
    .map((item) => normalizeMotionVideoModelForEndpoint(item.trim()))
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
}
const DEFAULT_MOTION_VIDEO_FALLBACK_MODELS = [];
const MOTION_VIDEO_FALLBACK_MODELS = parseMotionVideoModelList(
  Object.hasOwn(process.env, 'MOTION_VIDEO_FALLBACK_MODELS')
    ? process.env.MOTION_VIDEO_FALLBACK_MODELS
    : DEFAULT_MOTION_VIDEO_FALLBACK_MODELS.join(','),
).filter((model) => model !== MOTION_VIDEO_REQUEST_MODEL);
const MOTION_VIDEO_SUBMIT_MODELS = [MOTION_VIDEO_REQUEST_MODEL, ...MOTION_VIDEO_FALLBACK_MODELS]
  .filter(Boolean)
  .filter((item, index, list) => list.indexOf(item) === index);
const MOTION_VIDEO_TASK_QUERY_BASE = (() => {
  if (MOTION_VIDEO_IS_N1N_UNIFIED) return MOTION_VIDEO_ENDPOINT.replace(/\/video\/create\/?$/i, '/video/query');
  if (!MOTION_VIDEO_IS_ALIBAILIAN) return MOTION_VIDEO_ENDPOINT;
  // 把 .../alibailian/api/v1/services/... 转成 .../alibailian/api/v1/tasks
  return MOTION_VIDEO_ENDPOINT.replace(/\/alibailian\/api\/v1\/.*$/, '/alibailian/api/v1/tasks');
})();
// 视频接口使用的密钥：优先使用专用 key；小鸡默认走 XIAOJI_API_KEY。
const MOTION_VIDEO_API_KEY = process.env.MOTION_VIDEO_API_KEY
  || (MOTION_VIDEO_IS_XIAOJI ? (process.env.XIAOJI_API_KEY || OPENAI_API_KEY) : OPENAI_API_KEY);
const HAS_MOTION_VIDEO_KEY = hasUsableSecret(MOTION_VIDEO_API_KEY);
const MOTION_VIDEO_RESOLUTION = process.env.MOTION_VIDEO_RESOLUTION || '4K';
const MOTION_VIDEO_SIZE = process.env.MOTION_VIDEO_SIZE || '1280x720';
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
const MOTION_VIDEO_ASPECT_RATIO = process.env.MOTION_VIDEO_ASPECT_RATIO || reduceAspectRatio(MOTION_VIDEO_SIZE);
function motionVideoAspectRatioSize() {
  return String(MOTION_VIDEO_ASPECT_RATIO || reduceAspectRatio(MOTION_VIDEO_SIZE || '1280x720') || '16x9')
    .replace(':', 'x');
}
function motionVideoPixelSize() {
  const size = String(MOTION_VIDEO_SIZE || '').trim();
  if (/^\d{3,5}x\d{3,5}$/i.test(size)) return size.toLowerCase();
  const ratio = String(MOTION_VIDEO_ASPECT_RATIO || '').replace(':', 'x').toLowerCase();
  if (ratio === '9x16') return '720x1280';
  return '1280x720';
}
const MOTION_VIDEO_DURATION = Number(process.env.MOTION_VIDEO_DURATION || 8);
const MOTION_VIDEO_POLL_INTERVAL_MS = Number(process.env.MOTION_VIDEO_POLL_INTERVAL_MS || 8_000);
const MOTION_VIDEO_POLL_TIMEOUT_MS = Number(process.env.MOTION_VIDEO_POLL_TIMEOUT_MS || 10 * 60 * 1000);
const MOTION_VIDEO_STALL_RETRY_MS = Number(process.env.MOTION_VIDEO_STALL_RETRY_MS || 180_000);
const MOTION_VIDEO_MAX_SUBMIT_ATTEMPTS = Math.max(1, Number(process.env.MOTION_VIDEO_MAX_SUBMIT_ATTEMPTS || 4));
const MOTION_VIDEO_DOWNLOAD_TIMEOUT_MS = Number(process.env.MOTION_VIDEO_DOWNLOAD_TIMEOUT_MS || 600_000);
const MOTION_VIDEO_LOCAL_FALLBACK = String(process.env.MOTION_VIDEO_LOCAL_FALLBACK ?? 'true').toLowerCase() !== 'false';
const MOTION_VIDEO_LOCAL_FALLBACK_AFTER_MS = Number(process.env.MOTION_VIDEO_LOCAL_FALLBACK_AFTER_MS || 90_000);
const MOTION_VIDEO_PREFLIGHT_TTL_MS = Number(process.env.MOTION_VIDEO_PREFLIGHT_TTL_MS || 60_000);
const MOTION_REFERENCE_LIMIT = 3;
function motionReferenceLimitForModel(model = MOTION_VIDEO_REQUEST_MODEL) {
  if (MOTION_VIDEO_IS_XIAOJI && /(?:^|[-_])fl(?:[-_]|$)/i.test(String(model || ''))) {
    return Math.min(2, MOTION_REFERENCE_LIMIT);
  }
  return MOTION_REFERENCE_LIMIT;
}
// 去水印：ffmpeg 可执行文件 + 右下角 delogo 区域（表达式使用 ffmpeg 滤镜内部变量 W/H = 视频宽高）
// 优先：.env 手动设的 → ffmpeg-static 提供的预编译二进制 → 系统 PATH 中的 ffmpeg
const FFMPEG_BIN = process.env.FFMPEG_BIN || ffmpegStatic || 'ffmpeg';
const MOTION_WATERMARK_REMOVE = String(process.env.MOTION_WATERMARK_REMOVE ?? 'true').toLowerCase() !== 'false';
// 默认抠右下角 宽 200 × 高 70 区域（部分聚合视频模型常见 logo 位置）
const MOTION_WATERMARK_BOX = process.env.MOTION_WATERMARK_BOX || 'W-220:H-90:200:70';
const MOTION_VIDEO_WEB_OPTIMIZE = String(process.env.MOTION_VIDEO_WEB_OPTIMIZE ?? 'true').toLowerCase() !== 'false';
const MOTION_VIDEO_WEB_MAX_WIDTH = Number(process.env.MOTION_VIDEO_WEB_MAX_WIDTH || 1280);
const MOTION_VIDEO_WEB_CRF = Number(process.env.MOTION_VIDEO_WEB_CRF || 25);
const MOTION_VIDEO_WEB_PRESET = process.env.MOTION_VIDEO_WEB_PRESET || 'veryfast';
const MOTION_VIDEO_WEB_MAXRATE = process.env.MOTION_VIDEO_WEB_MAXRATE || '3200k';
const MOTION_VIDEO_WEB_BUFSIZE = process.env.MOTION_VIDEO_WEB_BUFSIZE || '6400k';
const MOTION_VIDEO_WEB_AUDIO_BITRATE = process.env.MOTION_VIDEO_WEB_AUDIO_BITRATE || '96k';
const MOTION_VIDEO_TOKEN_TTL_MS = Number(process.env.MOTION_VIDEO_TOKEN_TTL_MS || 6 * 60 * 60 * 1000);
const MOTION_VIDEO_REFERENCE_MAX_EDGE = Number(process.env.MOTION_VIDEO_REFERENCE_MAX_EDGE || 1024);
const MOTION_VIDEO_REFERENCE_QUALITY = Number(process.env.MOTION_VIDEO_REFERENCE_QUALITY || 86);
const MOTION_POINT_COST = Number(process.env.MOTION_POINT_COST || 60);
const MOTION_REFERENCE_GUARD_ENABLED = process.env.MOTION_REFERENCE_GUARD_ENABLED !== 'false';
const MOTION_REFERENCE_GUARD_MAX_TOKENS = Number(process.env.MOTION_REFERENCE_GUARD_MAX_TOKENS || 2000);
const MOTION_DIRECTOR_PROMPT_MAX_TOKENS = Number(process.env.MOTION_DIRECTOR_PROMPT_MAX_TOKENS || 4000);
// 没有 API Key / 强制 mock / 没有 PUBLIC_BASE_URL（URL 模式上游拉不到本地图）任一条件成立，都走 mock
const FORCE_MOCK_MOTION = process.env.MOTION_VIDEO_FORCE_MOCK === 'true';
const MOTION_VIDEO_REQUIRES_PUBLIC_URL = MOTION_VIDEO_IS_N1N_UNIFIED
  || MOTION_VIDEO_IS_ALIBAILIAN
  || (!MOTION_VIDEO_IS_XIAOJI && !MOTION_VIDEO_IS_N1N_OPENAI);
const USE_MOCK_MOTION_VIDEO = FORCE_MOCK_MOTION || !HAS_MOTION_VIDEO_KEY || USE_MOCK_IMAGES || (MOTION_VIDEO_REQUIRES_PUBLIC_URL && !PUBLIC_BASE_URL);

const app = express();
function normalizeOrigin(origin = '') {
  return String(origin || '').trim().replace(/\/+$/, '');
}

function isAllowedCorsOrigin(origin = '') {
  const normalized = normalizeOrigin(origin);
  return !!normalized && API_CORS_ORIGINS.has(normalized);
}

function appendVary(res, value) {
  const current = res.getHeader('Vary');
  if (!current) {
    res.setHeader('Vary', value);
    return;
  }
  const parts = String(current).split(',').map((part) => part.trim().toLowerCase());
  if (!parts.includes(value.toLowerCase())) {
    res.setHeader('Vary', `${current}, ${value}`);
  }
}

app.use((req, res, next) => {
  const origin = normalizeOrigin(req.headers.origin || '');
  if (isAllowedCorsOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Content-Type, x-admin-token');
    appendVary(res, 'Origin');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

app.use(express.json({ limit: '64kb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const jobs = new Map();
const openai = USE_OPENAI_COMPAT ? new OpenAI({
  apiKey: OPENAI_API_KEY,
  timeout: OPENAI_REQUEST_TIMEOUT_MS,
  ...(OPENAI_BASE_URL ? { baseURL: OPENAI_BASE_URL } : {}),
}) : null;

const MODE_LABELS = {
  cinematic_storyboard: '电影感分镜图',
  multi_angle: '同场景多角度',
  detail_pack: '婚礼细节补图',
  similar_style: '类似婚礼',
  setup_comparison: '布置前后对比图',
  design_render_scene: '设计图转实景',
  venue_fusion: '空地婚礼融合图',
  copy_title: '爆款标题文案',
  motion_video: '现场空景连续转场视频',
};

const SIX_IMAGE_MODES = new Set(['cinematic_storyboard', 'multi_angle', 'detail_pack', 'similar_style']);
const DISABLED_MODES = new Set(['design_comparison']);
const SINGLE_IMAGE_MODES = new Set(['setup_comparison', 'venue_fusion']);
const DESIGN_RENDER_MODES = new Set(['design_render_scene']);

function pointCostForMode(mode = '') {
  if (mode === 'motion_video') return MOTION_POINT_COST;
  if (mode === 'copy_title') return TEXT_POINT_COST;
  if (DESIGN_RENDER_MODES.has(mode)) return DESIGN_RENDER_POINT_COST;
  if (SIX_IMAGE_MODES.has(mode)) return SIX_IMAGE_POINT_COST;
  if (SINGLE_IMAGE_MODES.has(mode)) return JOB_POINT_COST;
  return JOB_POINT_COST;
}

function publicPointCosts() {
  return {
    text: TEXT_POINT_COST,
    singleImage: JOB_POINT_COST,
    sixImage: SIX_IMAGE_POINT_COST,
    designRender: DESIGN_RENDER_POINT_COST,
    motion: MOTION_POINT_COST,
    byMode: Object.fromEntries(Object.keys(MODE_LABELS).map((mode) => [mode, pointCostForMode(mode)])),
  };
}

// 把空景参考图按镜头顺序串成一段连续转场视频；组件模型默认支持 1-3 张参考图。
const MOTION_STYLES = {
  seamless_sequence: {
    label: '三图连续转场',
    description: '一键按上传顺序串联：图 1 开场 → 图 2 中段 → 图 3 收尾',
    prompt: 'A crisp cinematic wedding sequence cutting through the uploaded reference images in their exact order, with no people. Start with Image 1 as the opening establishing scene, use each later uploaded image as its own readable sequence target, and make the last uploaded image the ending frame. The ending image must keep its actual viewpoint and subject: if it is an upward ceiling / crystal / floral installation view, end on that ceiling view; if it is a stage, aisle, tabletop, floral or decor detail, end on that exact category. Do not replace the final uploaded image with a generic flower macro, bouquet, table centerpiece or stock wedding detail unless that is clearly what the uploaded ending image shows. Keep the wedding identity, color palette, floral language, lighting mood and material realism consistent across all supplied scenes.',
  },
};

const DEFAULT_MOTION_STYLE = 'seamless_sequence';

function normalizeMotionStyleKey(styleKey = '') {
  const value = String(styleKey || '').trim();
  if (MOTION_STYLES[value]) return value;
  if ([
    'slow_push_in',
    'pull_out',
    'lateral_left_to_right',
    'lateral_right_to_left',
    'parallax_walkthrough',
    'soft_bokeh_sequence',
  ].includes(value)) {
    return DEFAULT_MOTION_STYLE;
  }
  return DEFAULT_MOTION_STYLE;
}

function motionTimelinePrompt(styleKey, count = 1) {
  const duration = Math.max(1, Number(MOTION_VIDEO_DURATION || 8));
  const end = duration.toFixed(1);
  if (count >= 3) {
    const cut1 = (duration * 0.33).toFixed(1);
    const shot2Start = Math.min(duration - 0.2, duration * 0.33 + 0.2).toFixed(1);
    const cut2 = (duration * 0.66).toFixed(1);
    const shot3Start = Math.min(duration - 0.1, duration * 0.66 + 0.2).toFixed(1);
    return [
      `${duration}-SECOND THREE-IMAGE TIMING: 0.0-${cut1}s establish Image 1 clearly and recognizably; use an instant editorial match cut; ${shot2Start}-${cut2}s reveal and track through Image 2 as the middle scene; use a second instant editorial match cut; ${shot3Start}-${end}s arrive at Image 3 as the final uploaded reference scene, preserving Image 3's real viewpoint and subject exactly.`,
      'The three uploaded images are sequential scene targets, not optional references and not a blended style moodboard. The first visible frame must be anchored to Image 1, the middle segment must be anchored to Image 2, and the ending segment must be anchored to Image 3. The video should feel like one wedding film edited with fast clean cuts, not a collage, not a split-screen, not slow dissolves.',
      styleKey === 'soft_bokeh_sequence'
        ? 'This legacy style is normalized to fast cuts: do not use long defocus or fade-through-light between scenes.'
        : 'Use visible but refined gimbal movement inside each shot: forward push, slow pan, sideways track, or gentle parallax.',
    ].join(' ');
  }
  if (count === 2) {
    const cut = (duration / 2).toFixed(1);
    const firstEnd = Math.max(0.1, duration / 2 - 0.1).toFixed(1);
    const secondStart = Math.min(duration - 0.1, duration / 2 + 0.1).toFixed(1);
    return [
      `${duration}-SECOND TWO-IMAGE TIMING: 0.0-${firstEnd}s establish and move within Image 1; around ${cut}s use an instant editorial match cut; ${secondStart}-${end}s reveal Image 2 as the second and final scene and settle with a refined camera move.`,
      'The two uploaded images are sequential scene targets. Avoid slow dissolves and avoid inventing a third scene.',
    ].join(' ');
  }
  return [
    `${duration}-SECOND SINGLE-IMAGE TIMING: 0.0-1.0s establish Image 1; 1.0-${Math.max(1, duration - 1).toFixed(1)}s perform one elegant continuous camera movement inside the same scene; ${Math.max(0.5, duration - 1).toFixed(1)}-${end}s ease out and settle.`,
    'Only one image is supplied, so do not invent additional scenes. Use a refined slow push, pan, or parallax move within the uploaded scene.',
  ].join(' ');
}

function motionReferenceRolePrompt(count = 1) {
  const base = [
    'REFERENCE IMAGE ROLES FOR SEQUENTIAL VIDEO: Use the uploaded images as ordered scene targets for one wedding film, not as independent outputs and not as a blended average.',
    'Image 1 is the opening scene / establishing view. Begin the video from Image 1 and preserve its visible decor, lighting, color palette, venue identity and object placement while the camera pushes in.',
  ];
  if (count >= 3) {
    base.push(
      'Image 2 is the required middle scene. After the first soft transition, reveal Image 2 as the next camera position: usually a middle view, aisle, guest-area view, reception-space view, or alternate spatial angle.',
      'Image 3 is the required ending scene. After the second instant cut, reveal Image 3 as the final uploaded scene with its actual camera angle and subject. Do not reinterpret Image 3 as a generic close-up: ceiling views must remain ceiling views, stage views must remain stage views, aisle views must remain aisle views, and detail views must match the exact visible detail.',
      'Do not force all three images into one impossible geometry. Connect them using instant editorial match cuts under 0.2s, not slow optical transitions.',
    );
  } else if (count === 2) {
    base.push(
      'Image 2 is the required second scene. Cut from Image 1 to Image 2 using an instant editorial match cut under 0.2s.',
    );
  } else {
    base.push(
      'Only Image 1 is supplied. Generate one continuous empty-wedding camera move inside Image 1 without inventing extra scenes.',
    );
  }
  base.push(
    'Presence rule: an object category may appear only if it is clearly visible in at least one uploaded reference. Wedding style alone is not permission to add it.',
    'No people, no guests, no staff, no couple, no hands, no text overlays, no split-screen, no collage, no slideshow framing.',
  );
  return count > 1 ? `${base.join(' ')} ${count} reference images are supplied.` : base.join(' ');
}

// 所有运镜风格通用：保持场景一致性、不穿帮、不转场、道具细节真实。会追加到每个 style.prompt 末尾。
const MOTION_CONSISTENCY_RULES = [
  'REFERENCE FILE LOCK: Treat motion-source.jpg as Image 1, motion-reference-2.jpg as Image 2, and motion-reference-3.jpg as Image 3 when present. Each segment must be recognizably based on its matching uploaded file. Do not swap the order and do not substitute the final uploaded image with a generic wedding detail.',
  'STRICT SEQUENCE CONSISTENCY: The video must follow the uploaded images in order. Preserve the visible decor, floral language, drapery, stage/aisle relationship, color palette, lighting direction and venue identity of each referenced scene. Do NOT add unrelated tables, candles, chandeliers, chairs, guests, signs, props or background details that are not supported by the references.',
  'UNSUPPORTED OBJECT BAN: Treat the references as an allowed-object inventory. If an object type is absent from every reference, it must stay absent in the video. This especially blocks stock wedding additions such as white Chiavari ceremony chair rows, foreground tent-like draped curtains or canopies, new floral arches, new chandeliers, signage, doors, windows, columns, guests, staff and random aisle props. Candles, candelabra, table settings and loose petals may appear only when they are clearly visible in the uploaded references. Use empty floor, dark room edges, existing tables or existing floral areas instead of inventing filler.',
  'CINEMATIC CONTINUITY: Create one real-camera wedding film with elegant camera movement inside each referenced scene. When multiple reference images are supplied, use clean editorial hard cuts at the specified timestamps so every image becomes a readable shot. No split-screen, no montage cards, no slideshow presentation, no slow dissolves, no prolonged blur, and no invented scenes.',
  'PHYSICAL & TEMPORAL STABILITY: Within each referenced scene, objects stay in their original position and orientation. No melting, no warping, no floating, no glitching, no morphing flowers, no growing/shrinking objects, no disappearing/appearing props within a scene, no color shifts, no weather changes, no people walking in or out of frame. Scene changes must happen during the soft transition, not by visible object morphing.',
  'EMPTY WEDDING ATMOSPHERE: Keep the venue empty and serene. Add only subtle, physically plausible atmosphere that is supported by the references: soft golden-hour or warm ambient light, gentle lens flare, delicate dust motes in visible light beams, candlelight flicker if candles exist, crystal sparkle if chandeliers or crystal props exist, and a very gentle breeze moving visible fabric if drapery exists. Do not invent candles, chandeliers, fairy lights, sunlight or wind effects when the images do not support them.',
  'PROP DETAIL & MATERIAL REALISM (HIGH PRIORITY): Render only the props and materials that already exist in the uploaded references, but render those with strong photographic detail and authentic materials. Existing flowers must show individual petals with subtle veins, soft natural creases, dewy highlights and accurate species shape (rose, hydrangea, peony, eucalyptus, baby breath, etc. — match exactly to the input). Existing fabrics must show real woven texture, soft folds, gentle wrinkles, light translucency and weight under gravity. Existing crystal, glass, metal, candle, ribbon, bow, wood floor, aisle carpet and stage materials should keep their real texture and scale. Do not introduce any of these materials as new props. Avoid any plastic-looking, CG-rendered, over-saturated, over-smooth, doll-like or cartoon look. The entire frame must feel like a high-end DSLR / cinema-camera capture (Sony FX / ARRI / RED look) with real-world depth of field, real bokeh shape and natural color science.',
].join(' ');

function buildFallbackMotionPrompt(styleKey = DEFAULT_MOTION_STYLE, count = 1) {
  const style = MOTION_STYLES[styleKey] || MOTION_STYLES[DEFAULT_MOTION_STYLE];
  return [
    style.prompt,
    motionTimelinePrompt(styleKey, count),
    motionReferenceRolePrompt(count),
    MOTION_CONSISTENCY_RULES,
  ].join(' ').replace(/\s+/g, ' ').trim().slice(0, 2600);
}

const SHOT_PLANS = {
  cinematic_storyboard: [
    ['建立场大远景', 'wide establishing shot of the wedding scene; keep the original venue structure, main color tone, stage or aisle relationship and lighting direction; looks like a real camera frame from the uploaded wedding'],
    ['主视觉中景', 'medium hero shot of the main ceremony focal point or stage; preserve the exact wedding style and decor logic, only refine the composition like a cinematographer'],
    ['花艺特写', 'close-up or medium close-up of the most visible floral design from the uploaded wedding. CRITICAL: every flower must be a complete, naturally grown bloom with intact petals, stems and leaves; flowers must connect to a visible structure (vase, arrangement base, pillar, table or aisle), no floating flowers, no half-cut flowers awkwardly clipped by the frame edge, no flowers melting/merging into each other, no broken stems. Real photographic depth of field, realistic flower species and scale that match the uploaded reference. No invented flower species that break the style.'],
    ['灯光空间细节', 'conditional lighting-space detail shot based strictly on the uploaded wedding reference: if the reference clearly shows a real ceiling or overhead hanging installation such as a crystal bead canopy, chandelier, hanging floral ring, suspended crystal curtain or drapery ceiling, shoot it as a front-facing upward cinematic shot from the central axis directly beneath the installation; if no ceiling or overhead hanging installation is visible, replace this frame with a grounded lighting-and-floral atmosphere detail that actually exists in the scene, such as stage spotlights washing visible flowers, illuminated fabric, aisle marker, candle or crystal prop, table setting, wall light or floor light texture; never invent a ceiling, chandelier, hanging crystals or overhead floral structure that is not supported by the reference'],
    ['通道低机位', 'low camera angle along the aisle or floor depth if the scene has an aisle; if no aisle exists, use a low foreground-to-stage depth shot without inventing a fake passage'],
    ['道具前景虚化', 'foreground bokeh transition shot. CRITICAL physical-consistency rules: (1) the foreground prop (candle, lantern, candelabra, glassware, floral cluster, aisle marker etc.) MUST be physically grounded — it must sit on a real table, on the floor, or on a clearly visible surface from the reference scene; absolutely NO floating or hovering props in mid-air, NO props isolated in empty space far from any surface. (2) the foreground prop must be a natural extension of the actual decoration logic — pulled from the same reception table, the same aisle edge, or the same ceremony area visible in the uploaded reference; do NOT invent random props that do not belong to this wedding. (3) Maintain a clear and continuous spatial logic: foreground prop on a surface → mid-ground table/aisle/decor → background stage/backdrop softly out of focus. (4) NO collage-like layering where foreground props look pasted in front of an unrelated background. (5) Tall props such as candelabra must stand on a table or aisle base, never on empty floor between tables. Render as a real cinema photograph with real bokeh and real depth of field.'],
  ],
  multi_angle: [
    ['正面大景', 'front wide establishing shot of the same wedding setup'],
    ['左侧视角', 'left side angle showing aisle depth and floral layers'],
    ['右侧视角', 'right side angle with guests perspective and ceremony arch'],
    ['仪式通道', 'center aisle view toward the ceremony focal point'],
    ['花艺细节', 'close-up of floral installation, fabric, candles and textures'],
    ['灯光氛围', 'evening ambience with warm lights and refined atmosphere'],
  ],
  detail_pack: [
    ['主舞台', 'ceremony stage hero image with refined floral composition'],
    ['桌景细节', 'reception table styling, plates, candles and flowers'],
    ['花艺特写', 'premium floral detail close-up with soft depth of field'],
    ['签到区', 'welcome sign and guest check-in corner in matching style'],
    ['甜品台', 'dessert table styling matching the wedding visual language'],
    ['灯光层次', 'ambient lighting detail with elegant shadows and highlights'],
  ],
  similar_style: [
    ['类似婚礼 1', 'first similar wedding reference based on this wedding; keep the same overall style but change the main floral/stage visual'],
    ['类似婚礼 2', 'second similar wedding reference based on this wedding; keep the same mood but vary drapery curves, lighting placement and composition'],
    ['类似婚礼 3', 'third similar wedding reference based on this wedding; keep the same atmosphere but vary floral rhythm, foreground depth and stage relationship'],
    ['类似婚礼 4', 'fourth similar wedding reference based on this wedding; vary the ceremony focal point, fabric lines and floral density while keeping the same color system'],
    ['类似婚礼 5', 'fifth similar wedding reference based on this wedding; use a wider venue relationship or aisle/stage composition with the same wedding category and palette'],
    ['类似婚礼 6', 'sixth similar wedding reference based on this wedding; create a polished alternative hero image with a fresh foreground/background rhythm and consistent mood'],
  ],
  setup_comparison: [
    ['布置前空场地图', 'create the before-decoration empty venue image inferred from the uploaded already-decorated wedding photo; remove ALL wedding decorations (floral installations, drapery and fabric, ceiling chandeliers or hanging florals, aisle/runner decor, candles, props, ceremony arch, stage decor, banquet table setups, chair sashes, event-specific lighting) and reveal the bare venue underneath; keep the venue architecture, camera perspective, floor direction, wall/ceiling structure, windows/doors, columns, main stage or aisle space; render as a plain empty hotel ballroom or event hall under neutral ambient lighting, as if photographed before any wedding setup was installed'],
  ],
  design_render_scene: [
    ['主视觉全景', 'same camera composition as the uploaded design render, transformed into a real finished installation photo; preserve the exact stage/backdrop shape, aisle or runway path, ceiling/hanging decor, left-right layout, floral positions, drapery curves, table/chair relationship, color palette and lighting direction'],
    ['真实施工落地版', 'as if the uploaded design was built by a wedding production team and photographed on site; keep every major design element in the same relative position and scale, replacing only CG surfaces with real fabric, real flowers, real floor contact shadows, practical rigging and real venue materials'],
    ['灯光质感版', 'photorealistic event-lighting version of the same design; keep the original structure locked while making lamps, spotlights, candles, crystals, reflective floor and fabric highlights physically believable only where those elements already exist in the uploaded render'],
    ['客户确认清晰版', 'client-facing verification shot of the same design after construction; stable front-on wide view, all key elements readable, no redesign, no extra theme, no unrelated venue, suitable for checking whether the real build matches the design render'],
  ],
  venue_fusion: [
    ['空地融合婚礼效果图', 'install the wedding material from Reference Image 2 into the exact empty land or empty venue from Reference Image 1; lock Reference Image 1 camera viewpoint, indoor/outdoor identity, ground or floor material, architecture, horizon if present, scale and lighting direction; transfer only the Reference Image 2 wedding style, stage/aisle/floral/fabric/lighting language where it physically fits; if the material contains a stage/runway/stair deck, render it as a raised platform with visible height and riser edges, not a flat floor overlay; for indoor ballrooms add round banquet dining tables with hotel chairs on both sides of the central aisle while keeping the aisle open; create one finished photorealistic wedding setup in that same space'],
  ],
  copy_title: [],
};

const CINEMATIC_STORYBOARD_PLAN = [
  'Frame 1: 建立场大远景, first show the complete venue/stage/aisle relationship.',
  'Frame 2: 主视觉中景, then show the core ceremony focal point or stage design.',
  'Frame 3: 花艺特写, then show the most valuable floral detail that actually exists in the style.',
  'Frame 4: 灯光空间细节, this is a conditional replacement shot: only use a front-facing upward ceiling shot when a real overhead installation is visible; otherwise replace it with a visible lighting, floral or prop atmosphere detail from the same scene and do not invent a ceiling.',
  'Frame 5: 通道低机位, then show aisle or floor-depth lens language without inventing impossible structures.',
  'Frame 6: 道具前景虚化, finally use real props/florals/candles/chairs/tableware as a foreground bokeh transition shot.',
  '⚠️ GLOBAL ANTI-CONTINUITY-ERROR RULES for ALL 6 frames (zero tolerance for visual breakdown):',
  '- Every prop, candle, candelabra, glassware, vase, floral arrangement, fabric and decor element MUST be physically grounded on a real visible surface (table, floor, stage, aisle base, pillar). NO floating props, NO hovering candles, NO objects isolated in mid-air.',
  '- Every flower must be a complete real bloom with intact petals, stems and leaves connected to a visible base (vase / arrangement / pillar / aisle planter). NO half-melted flowers, NO flowers fused into each other, NO disembodied petals.',
  '- All elements within a single frame must belong to the same physical space, with consistent perspective, consistent lighting direction, consistent floor plane and consistent depth-of-field. Foreground / mid-ground / background must form ONE continuous space, never look like 2-3 unrelated photos pasted together.',
  '- NO duplicated or mirrored impossible elements (e.g. one candelabra suddenly appearing twice in unrealistic positions, two aisles, two stages).',
  '- NO surreal scaling errors (a candle taller than a chair, a flower larger than a person\'s head).',
  '- The output should look like a real on-site wedding cinema photograph — if any frame shows a clearly impossible / floating / collage / morphed element, regenerate it as a clean realistic shot of the same wedding.',
].join(' ');

function createJob(mode, file, user = null, options = {}) {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const motionStyle = normalizeMotionStyleKey(options.motionStyle);
  const job = {
    id,
    mode,
    ownerId: user?.id || '',
    ownerLogin: user?.login || '',
    tenantId: options.tenantId || user?.tenantId || '',
    tenantSlug: options.tenantSlug || user?.tenantSlug || '',
    chargedPoints: 0,
    refundedPoints: false,
    status: 'queued',
    progress: 4,
    stage: '任务已进入队列',
    logs: ['[queue] 已收到现场照，准备解析风格'],
    partialImages: [],
    result: null,
    error: null,
    cancelRequested: false,
    cancelReason: '',
    abortController: null,
    createdAt: Date.now(),
    file,
    files: options.files || (file ? [file] : []),
    motionStyle,
    motionTaskId: '',
  };
  jobs.set(id, job);
  return job;
}

function updateJob(job, progress, stage, log) {
  job.progress = Math.max(job.progress, Math.min(100, Math.round(progress)));
  job.stage = stage;
  if (log) job.logs.push(log);
  queueJobLedgerSnapshot(job);
}

class JobCancelledError extends Error {
  constructor(message = '任务已停止') {
    super(message);
    this.name = 'JobCancelledError';
  }
}

function isJobCancelledError(error) {
  return error instanceof JobCancelledError
    || error?.name === 'JobCancelledError'
    || error?.name === 'AbortError' && error?.message === '任务已停止';
}

function ensureJobAbortController(job) {
  if (!job.abortController || job.abortController.signal.aborted) {
    job.abortController = new AbortController();
  }
  return job.abortController;
}

function throwIfJobCancelled(job) {
  if (job.cancelRequested || job.status === 'cancelled') {
    throw new JobCancelledError(job.cancelReason || '任务已停止');
  }
}

function signalForJob(job, timeoutMs) {
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (job?.abortController?.signal) signals.push(job.abortController.signal);
  return AbortSignal.any(signals);
}

function imageRequestTimeoutFor(job) {
  return job?.mode === 'design_render_scene'
    ? Math.max(60_000, DESIGN_RENDER_IMAGE_TIMEOUT_MS)
    : OPENAI_REQUEST_TIMEOUT_MS;
}

function imageConcurrencyFor(job, pendingCount) {
  const configured = job?.mode === 'design_render_scene'
    ? DESIGN_RENDER_CONCURRENCY
    : IMAGE_CONCURRENCY;
  return Math.min(Math.max(1, configured), pendingCount);
}

function imageMaxAttemptsFor(job) {
  return job?.mode === 'design_render_scene'
    ? DESIGN_RENDER_MAX_ATTEMPTS
    : 3;
}

function cancelJob(job, reason = '已停止生成，未提交后续图片') {
  job.cancelRequested = true;
  job.cancelReason = reason;
  if (job.abortController && !job.abortController.signal.aborted) {
    job.abortController.abort(new JobCancelledError(reason));
  }
  job.logs.push(`[cancel] ${reason}`);
}

function publicAbsoluteUrl(urlPath = '') {
  const value = String(urlPath || '');
  if (!value || /^https?:\/\//i.test(value)) return value;
  return value.startsWith('/') ? value : `/${value}`;
}

function localizePublicUrl(url = '') {
  const value = String(url || '');
  if (!PUBLIC_BASE_URL || !/^https?:\/\//i.test(value)) return value;
  try {
    const base = new URL(PUBLIC_BASE_URL);
    const parsed = new URL(value);
    if (parsed.origin === base.origin) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    return value;
  }
  return value;
}

function localizePublicResultUrls(value, key = '') {
  if (typeof value === 'string') {
    return /url$/i.test(key) ? localizePublicUrl(value) : value;
  }
  if (Array.isArray(value)) return value.map((item) => localizePublicResultUrls(item, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      localizePublicResultUrls(entryValue, entryKey),
    ]));
  }
  return value;
}

function publicUrl(jobId, filename) {
  return publicAbsoluteUrl(`/generated/${jobId}/${filename}`);
}

function downloadUrl(jobId, filename) {
  return publicAbsoluteUrl(`/api/download/${encodeURIComponent(jobId)}/${encodeURIComponent(filename)}`);
}

function resourcePublicUrl(resourceId, filename) {
  return publicAbsoluteUrl(`/my-resources/${encodeURIComponent(resourceId)}/${encodeURIComponent(filename)}`);
}

function resourceDownloadUrl(resourceId, filename) {
  return publicAbsoluteUrl(`/api/resources/${encodeURIComponent(resourceId)}/download/${encodeURIComponent(filename)}`);
}

function streamInlineFile(res, filePath, filename) {
  res.type(path.extname(filename));
  res.setHeader('Cache-Control', 'private, max-age=3600');
  if (/\.mp4$/i.test(filename)) {
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Disposition', `inline; filename="${filename.replace(/"/g, '')}"`);
  }
  res.setHeader('Content-Length', statSync(filePath).size);
  createReadStream(filePath).pipe(res);
}

function formatByteSize(bytes = 0) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)}MB`;
  if (value >= 1024) return `${Math.round(value / 1024)}KB`;
  return `${value}B`;
}

async function readResourceManifest() {
  try {
    const payload = JSON.parse(await readFile(RESOURCES_MANIFEST, 'utf8'));
    return Array.isArray(payload.resources) ? payload.resources : [];
  } catch {
    return [];
  }
}

async function writeResourceManifest(resources) {
  await mkdir(RESOURCES_DIR, { recursive: true });
  await writeFile(RESOURCES_MANIFEST, JSON.stringify({ resources }, null, 2), 'utf8');
}

async function readTenantStore() {
  try {
    const payload = JSON.parse(await readFile(TENANTS_FILE, 'utf8'));
    return { tenants: Array.isArray(payload.tenants) ? payload.tenants : [] };
  } catch {
    return { tenants: [] };
  }
}

function normalizeTenantSlug(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

function normalizeHost(value = '') {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].replace(/:\d+$/, '');
}

function isActiveTenant(tenant) {
  return !!tenant && String(tenant.status || 'active').toLowerCase() !== 'disabled';
}

function tenantDomains(tenant) {
  return Array.isArray(tenant?.domains)
    ? tenant.domains.map(normalizeHost).filter(Boolean)
    : [];
}

function requestHost(req) {
  const forwarded = String(req.headers['x-forwarded-host'] || '').split(',')[0];
  return normalizeHost(forwarded || req.headers.host || '');
}

function defaultTenantContext() {
  return {
    id: '',
    slug: '',
    name: SITE_BRAND_NAME || 'WedScene',
    logoUrl: publicAbsoluteUrl(SITE_LOGO_URL),
    logoText: SITE_LOGO_TEXT || 'W',
    tagline: SITE_TAGLINE || 'WEDSCENE AI',
    supportWechat: SUPPORT_WECHAT,
    supportWechatQr: publicAbsoluteUrl(SUPPORT_WECHAT_QR),
    supportContacts: publicSupportContacts(),
    plan: 'platform',
    defaultTenant: true,
  };
}

function publicTenant(tenant = null) {
  if (!tenant) return defaultTenantContext();
  const fallback = defaultTenantContext();
  const slug = normalizeTenantSlug(tenant.slug || tenant.id || '');
  return {
    id: String(tenant.id || '').trim(),
    slug,
    name: String(tenant.name || tenant.brandName || fallback.name).trim(),
    logoUrl: publicAbsoluteUrl(tenant.logoUrl || tenant.logo || ''),
    logoText: String(tenant.logoText || tenant.shortName || tenant.name || fallback.logoText).trim().slice(0, 2) || fallback.logoText,
    tagline: String(tenant.tagline || fallback.tagline).trim(),
    brandColor: String(tenant.brandColor || '').trim(),
    supportWechat: String(tenant.supportWechat || fallback.supportWechat || '').trim(),
    supportWechatQr: publicAbsoluteUrl(tenant.supportWechatQr || fallback.supportWechatQr || ''),
    supportContacts: publicSupportContacts(tenant),
    plan: String(tenant.plan || '').trim(),
    inviteUrl: slug ? publicAbsoluteUrl(`/?partner=${encodeURIComponent(slug)}`) : '',
    defaultTenant: false,
  };
}

function publicAdminTenant(tenant = null) {
  const item = publicTenant(tenant);
  return {
    ...item,
    status: String(tenant?.status || 'active').trim(),
    domains: tenantDomains(tenant),
    adminUserIds: Array.isArray(tenant?.adminUserIds) ? tenant.adminUserIds.map(String).filter(Boolean) : [],
    createdAt: tenant?.createdAt || '',
    updatedAt: tenant?.updatedAt || '',
  };
}

function parseTenantDomains(value) {
  const source = Array.isArray(value)
    ? value
    : String(value || '').split(/[\s,;]+/);
  return [...new Set(source.map(normalizeHost).filter(Boolean))];
}

async function writeTenantStore(store) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(TENANTS_FILE, JSON.stringify({
    tenants: Array.isArray(store.tenants) ? store.tenants : [],
  }, null, 2), 'utf8');
}

let tenantStoreQueue = Promise.resolve();

async function mutateTenantStore(mutator) {
  const run = tenantStoreQueue.then(async () => {
    const store = await readTenantStore();
    const result = await mutator(store);
    await writeTenantStore(store);
    return result;
  });
  tenantStoreQueue = run.catch(() => {});
  return run;
}

async function resolveTenant(req, options = {}) {
  const store = await readTenantStore();
  const tenants = store.tenants.filter(isActiveTenant);
  const partner = normalizeTenantSlug(options.partner || req.query.partner || req.query.t || req.body?.partner || req.body?.tenantSlug || '');
  if (partner) {
    const bySlug = tenants.find((tenant) => normalizeTenantSlug(tenant.slug || tenant.id) === partner);
    if (bySlug) return bySlug;
  }
  const tenantId = String(options.tenantId || req.body?.tenantId || req.query.tenantId || '').trim();
  if (tenantId) {
    const byId = tenants.find((tenant) => String(tenant.id || '') === tenantId);
    if (byId) return byId;
  }
  const host = requestHost(req);
  if (host) {
    const byDomain = tenants.find((tenant) => tenantDomains(tenant).includes(host));
    if (byDomain) return byDomain;
  }
  if (ACCOUNT_SYSTEM_ENABLED) {
    const user = req.user || await sessionUser(req);
    if (user?.tenantId) {
      const byUser = tenants.find((tenant) => String(tenant.id || '') === String(user.tenantId));
      if (byUser) return byUser;
    }
  }
  return null;
}

async function siteContextPayload(req, options = {}) {
  const tenant = await resolveTenant(req, options);
  const context = publicTenant(tenant);
  return {
    tenant: context,
    defaultTenant: !!context.defaultTenant,
    partner: context.defaultTenant ? '' : context.slug,
  };
}

async function deleteSavedResource(resourceId) {
  const safeId = path.basename(String(resourceId || ''));
  if (!safeId) return false;
  await rm(path.join(RESOURCES_DIR, safeId), { recursive: true, force: true });
  return true;
}

async function readUserStore() {
  try {
    const payload = JSON.parse(await readFile(USERS_FILE, 'utf8'));
    return {
      users: Array.isArray(payload.users) ? payload.users : [],
      ledger: Array.isArray(payload.ledger) ? payload.ledger : [],
    };
  } catch {
    return { users: [], ledger: [] };
  }
}

async function writeUserStore(store) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(USERS_FILE, JSON.stringify({
    users: Array.isArray(store.users) ? store.users : [],
    ledger: Array.isArray(store.ledger) ? store.ledger : [],
  }, null, 2), 'utf8');
}

let userStoreQueue = Promise.resolve();

async function mutateUserStore(mutator) {
  const run = userStoreQueue.then(async () => {
    const store = await readUserStore();
    const result = await mutator(store);
    await writeUserStore(store);
    return result;
  });
  userStoreQueue = run.catch(() => {});
  return run;
}

async function readJobLedgerStore() {
  try {
    const payload = JSON.parse(await readFile(JOB_LEDGER_FILE, 'utf8'));
    return { jobs: Array.isArray(payload.jobs) ? payload.jobs : [] };
  } catch {
    return { jobs: [] };
  }
}

async function writeJobLedgerStore(store) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(JOB_LEDGER_FILE, JSON.stringify({
    jobs: Array.isArray(store.jobs) ? store.jobs : [],
  }, null, 2), 'utf8');
}

let jobLedgerQueue = Promise.resolve();

async function mutateJobLedgerStore(mutator) {
  const run = jobLedgerQueue.then(async () => {
    const store = await readJobLedgerStore();
    const result = await mutator(store);
    store.jobs = Array.isArray(store.jobs) ? store.jobs.slice(0, 2000) : [];
    await writeJobLedgerStore(store);
    return result;
  });
  jobLedgerQueue = run.catch(() => {});
  return run;
}

function jobLedgerSnapshot(job) {
  if (!job?.id || !job.chargedPoints) return null;
  const now = new Date().toISOString();
  return {
    id: job.id,
    mode: job.mode || '',
    ownerId: job.ownerId || '',
    ownerLogin: job.ownerLogin || '',
    tenantId: job.tenantId || '',
    tenantSlug: job.tenantSlug || '',
    chargedPoints: Number(job.chargedPoints || 0),
    refundedPoints: !!job.refundedPoints,
    refundedAt: job.refundedAt || '',
    status: job.status || 'queued',
    progress: Number(job.progress || 0),
    stage: job.stage || '',
    logs: Array.isArray(job.logs) ? job.logs.slice(-80) : [],
    partialImages: Array.isArray(job.partialImages) ? job.partialImages : [],
    result: job.result || null,
    error: job.error || '',
    cancelRequested: !!job.cancelRequested,
    cancelReason: job.cancelReason || '',
    createdAt: Number(job.createdAt || Date.now()),
    updatedAt: now,
    motionStyle: job.motionStyle || '',
    motionTaskId: job.motionTaskId || '',
    sourceResourceId: job.sourceResourceId || '',
    sourceResourceFilename: job.sourceResourceFilename || '',
  };
}

async function upsertJobLedgerSnapshot(snapshot) {
  if (!snapshot?.id || !snapshot.chargedPoints) return null;
  return mutateJobLedgerStore((store) => {
    const index = store.jobs.findIndex((item) => item.id === snapshot.id);
    if (index >= 0) {
      store.jobs[index] = {
        ...store.jobs[index],
        ...snapshot,
        createdAt: store.jobs[index].createdAt || snapshot.createdAt,
      };
      return store.jobs[index];
    }
    store.jobs.unshift(snapshot);
    return snapshot;
  });
}

async function writeJobLedgerSnapshot(job) {
  const snapshot = jobLedgerSnapshot(job);
  if (!snapshot) return null;
  return upsertJobLedgerSnapshot(snapshot);
}

function queueJobLedgerSnapshot(job) {
  const snapshot = jobLedgerSnapshot(job);
  if (!snapshot) return;
  upsertJobLedgerSnapshot(snapshot).catch((error) => {
    console.warn(`[jobs] failed to persist job ${snapshot.id}: ${error.message}`);
  });
}

async function readJobLedgerSnapshot(jobId) {
  const safeId = path.basename(String(jobId || ''));
  if (!safeId) return null;
  const store = await readJobLedgerStore();
  return store.jobs.find((item) => item.id === safeId) || null;
}

async function knownJobForAccess(jobId) {
  const safeId = path.basename(String(jobId || ''));
  if (!safeId) return null;
  return jobs.get(safeId) || await readJobLedgerSnapshot(safeId);
}

function normalizeLogin(login) {
  return String(login || '').trim().toLowerCase();
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(5).toString('hex')}`;
}

function generateLoginCode() {
  return randomBytes(4).toString('hex');
}

function hashLoginCode(login, code) {
  return createHmac('sha256', ACCOUNT_TOKEN_SECRET)
    .update(`wedscene-login-code:${normalizeLogin(login)}:${String(code || '')}`)
    .digest('hex');
}

function publicUser(user) {
  if (!user) return null;
  const displayName = displayAccountName(user.name, user.login);
  const membershipExpiresAt = user.membershipExpiresAt || '';
  const membershipExpiryTime = Date.parse(membershipExpiresAt);
  const hasMembershipExpiry = Number.isFinite(membershipExpiryTime);
  return {
    id: user.id,
    login: user.login,
    name: displayName,
    points: Number(user.points || 0),
    status: user.status || 'active',
    role: user.role || user.source || '',
    tenantId: user.tenantId || '',
    tenantSlug: user.tenantSlug || '',
    tenantRole: user.tenantRole || '',
    membershipPlan: user.membershipPlan || '',
    membershipExpiresAt,
    membershipStatus: hasMembershipExpiry
      ? (membershipExpiryTime >= Date.now() ? 'active' : 'expired')
      : 'none',
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function displayAccountName(name, fallback) {
  const rawName = String(name || '').trim();
  return (!rawName || /^[?\s]+$/.test(rawName) || rawName.includes('�'))
    ? fallback
    : rawName;
}

function extendMembership(user, durationDays, now = new Date(), meta = {}) {
  const days = Number(durationDays || 0);
  if (!Number.isFinite(days) || days <= 0) return null;
  const nowMs = now.getTime();
  const currentExpiryMs = Date.parse(user.membershipExpiresAt || '');
  const baseMs = Number.isFinite(currentExpiryMs) && currentExpiryMs > nowMs ? currentExpiryMs : nowMs;
  const nextExpiresAt = new Date(baseMs + days * 24 * 60 * 60 * 1000).toISOString();
  const previousExpiresAt = user.membershipExpiresAt || '';
  user.membershipExpiresAt = nextExpiresAt;
  user.membershipPlan = meta.membershipPlan || meta.planName || '';
  user.membershipUpdatedAt = now.toISOString();
  return {
    previousExpiresAt,
    expiresAt: nextExpiresAt,
  };
}

const REGISTER_IP_RATE = new Map();
const REGISTER_IP_LIMIT = Number(process.env.REGISTER_IP_LIMIT || 3);
const REGISTER_IP_WINDOW_MS = Number(process.env.REGISTER_IP_WINDOW_MS || 60 * 60 * 1000);

function checkRegisterRate(ip) {
  if (!ip) return true;
  const now = Date.now();
  const arr = (REGISTER_IP_RATE.get(ip) || []).filter((t) => now - t < REGISTER_IP_WINDOW_MS);
  if (arr.length >= REGISTER_IP_LIMIT) {
    REGISTER_IP_RATE.set(ip, arr);
    return false;
  }
  arr.push(now);
  REGISTER_IP_RATE.set(ip, arr);
  return true;
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || '';
}

function accountToken(user) {
  return createHmac('sha256', ACCOUNT_TOKEN_SECRET)
    .update(`wedscene-account:${user.id}:${user.login}:${user.sessionVersion || 1}`)
    .digest('base64url');
}

function isCrossSiteApiRequest(req) {
  const origin = normalizeOrigin(req?.headers?.origin || '');
  if (!isAllowedCorsOrigin(origin)) return false;
  const host = req?.headers?.host || '';
  return !!host && origin !== `http://${host}` && origin !== `https://${host}`;
}

function authCookieAttrs(req) {
  const crossSite = isCrossSiteApiRequest(req);
  return [
    crossSite ? 'SameSite=None' : 'SameSite=Lax',
    (crossSite || ACCESS_COOKIE_SECURE) ? 'Secure' : '',
  ].filter(Boolean);
}

function accountCookie(value, maxAge = ACCESS_COOKIE_MAX_AGE_SECONDS, req = null) {
  return [
    `${encodeURIComponent(ACCOUNT_COOKIE_NAME)}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    ...authCookieAttrs(req),
    `Max-Age=${maxAge}`,
  ].filter(Boolean).join('; ');
}

async function sessionUser(req) {
  if (!ACCOUNT_SYSTEM_ENABLED) return null;
  const cookies = parseCookies(req.headers.cookie || '');
  const raw = cookies[ACCOUNT_COOKIE_NAME] || '';
  const [userId, token] = raw.split('.');
  if (!userId || !token) return null;

  const store = await readUserStore();
  const user = store.users.find((item) => item.id === userId && item.status !== 'disabled');
  if (!user) return null;
  return safeEqualText(token, accountToken(user)) ? user : null;
}

async function authenticateAccount(login, code) {
  const normalizedLogin = normalizeLogin(login);
  const store = await readUserStore();
  const user = store.users.find((item) => item.login === normalizedLogin && item.status !== 'disabled');
  if (!user) return null;
  const codeHash = hashLoginCode(normalizedLogin, code);
  return safeEqualText(user.codeHash, codeHash) ? user : null;
}

async function adjustUserPoints(userId, delta, type, note = '', jobId = '', meta = {}) {
  return mutateUserStore((store) => {
    const user = store.users.find((item) => item.id === userId && item.status !== 'disabled');
    if (!user) {
      const error = new Error('账号不存在或已停用');
      error.status = 401;
      throw error;
    }
    const current = Number(user.points || 0);
    const next = current + Number(delta || 0);
    if (next < 0) {
      const error = new Error('点数不足，请联系管理员充值');
      error.status = 402;
      error.balance = current;
      throw error;
    }
    const now = new Date();
    const membershipUpdate = Number(delta || 0) > 0
      ? extendMembership(user, Number(meta.durationDays || 0), now, {
        membershipPlan: meta.durationText
          ? `${meta.planName || '会员'} · ${meta.durationText}`
          : meta.planName,
        planName: meta.planName,
      })
      : null;
    user.points = next;
    user.updatedAt = now.toISOString();
    const entry = {
      id: newId('ledger'),
      userId: user.id,
      login: user.login,
      type,
      points: Number(delta || 0),
      balanceAfter: next,
      note,
      jobId,
      planId: meta.planId || '',
      planName: meta.planName || '',
      amount: Number(meta.amount || 0),
      channel: meta.channel || '',
      durationDays: Number(meta.durationDays || 0),
      durationText: meta.durationText || '',
      tenantId: meta.tenantId || user.tenantId || '',
      tenantSlug: meta.tenantSlug || user.tenantSlug || '',
      membershipExpiresAt: membershipUpdate?.expiresAt || '',
      previousMembershipExpiresAt: membershipUpdate?.previousExpiresAt || '',
      createdAt: now.toISOString(),
    };
    store.ledger.unshift(entry);
    store.ledger = store.ledger.slice(0, 2000);
    return { user: { ...user }, entry };
  });
}

async function refundJobCharge(job, reason) {
  if (!ACCOUNT_SYSTEM_ENABLED || !job?.ownerId || !job.chargedPoints || job.refundedPoints) return null;
  const existingRefund = await existingJobRefund(job.ownerId, job.id);
  if (existingRefund) {
    job.refundedPoints = true;
    job.refundedAt = existingRefund.entry.createdAt || new Date().toISOString();
    job.logs.push(`[points] 任务 ${job.id} 已有退款流水，跳过重复退点`);
    queueJobLedgerSnapshot(job);
    return existingRefund.user || null;
  }
  try {
    const result = await adjustUserPoints(job.ownerId, job.chargedPoints, 'refund', reason || '生成失败自动退回点数', job.id, {
      tenantId: job.tenantId || '',
      tenantSlug: job.tenantSlug || '',
    });
    job.refundedPoints = true;
    job.refundedAt = new Date().toISOString();
    job.logs.push(`[points] 生成失败，已自动退回 ${job.chargedPoints} 点`);
    queueJobLedgerSnapshot(job);
    return result.user;
  } catch (error) {
    job.logs.push(`[points] 自动退点失败：${error.message}`);
    queueJobLedgerSnapshot(job);
    return null;
  }
}

async function chargeJobPoints(job, userId, pointCost, note) {
  if (!ACCOUNT_SYSTEM_ENABLED || !job?.id || !userId || !pointCost) return null;
  const charge = await adjustUserPoints(userId, -pointCost, 'generate', note, job.id, {
    tenantId: job.tenantId || '',
    tenantSlug: job.tenantSlug || '',
  });
  job.chargedPoints = pointCost;
  job.logs.push(`[points] 已扣除 ${pointCost} 点，剩余 ${charge.user.points} 点`);
  try {
    await writeJobLedgerSnapshot(job);
  } catch (error) {
    const refundedUser = await refundJobCharge(job, '任务记录写入失败，自动退回点数');
    const ledgerError = new Error('任务记录写入失败，已自动退回点数，请稍后重试');
    ledgerError.status = 500;
    ledgerError.balance = refundedUser?.points ?? charge.user.points;
    throw ledgerError;
  }
  return charge.user;
}

async function existingJobRefund(userId, jobId) {
  if (!userId || !jobId) return null;
  const store = await readUserStore();
  const entry = store.ledger.find((item) => item.userId === userId
    && item.jobId === jobId
    && item.type === 'refund'
    && Number(item.points || 0) > 0);
  if (!entry) return null;
  const user = store.users.find((item) => item.id === userId && item.status !== 'disabled');
  return { entry, user: user ? { ...user } : null };
}

function isAbandonedChargedJob(snapshot, now = Date.now()) {
  if (!ACCOUNT_SYSTEM_ENABLED || !snapshot?.ownerId || !snapshot.chargedPoints || snapshot.refundedPoints) return false;
  if (snapshot.status === 'completed') return false;
  const updatedAtMs = Date.parse(snapshot.updatedAt || '') || Number(snapshot.createdAt || 0) || 0;
  const stale = !updatedAtMs || now - updatedAtMs >= ABANDONED_JOB_REFUND_GRACE_MS;
  if ((snapshot.status === 'queued' || snapshot.status === 'running') && stale) return true;
  return snapshot.status === 'failed' || snapshot.status === 'cancelled';
}

async function reconcileAbandonedJobCharges(source = 'startup') {
  if (!ACCOUNT_SYSTEM_ENABLED) return { refunded: 0, checked: 0 };
  const store = await readJobLedgerStore();
  let refunded = 0;
  let checked = 0;
  for (const snapshot of store.jobs) {
    checked += 1;
    if (jobs.has(snapshot.id)) continue;
    if (!isAbandonedChargedJob(snapshot)) continue;
    const job = {
      ...snapshot,
      logs: Array.isArray(snapshot.logs) ? snapshot.logs.slice() : [],
      status: 'failed',
      error: snapshot.error || '服务重启导致任务中断，已自动退回点数',
      stage: '任务中断，灵感值已自动退回',
      refundedPoints: !!snapshot.refundedPoints,
      chargedPoints: Number(snapshot.chargedPoints || 0),
    };
    const refundedUser = await refundJobCharge(job, job.error);
    if (refundedUser || job.refundedPoints) {
      refunded += 1;
      await writeJobLedgerSnapshot(job);
    }
  }
  if (refunded > 0) {
    console.log(`[jobs] reconciled ${refunded} abandoned charged job(s) from ${source}`);
  }
  return { refunded, checked };
}

function isLegacyMotionGenerateEntry(entry) {
  if (!entry?.jobId || entry.type !== 'generate' || Number(entry.points || 0) >= 0) return false;
  const note = String(entry.note || '');
  return /视频|运镜|连续转场|motion/i.test(note);
}

function inLegacyMotionRefundWindow(entry) {
  const createdAtMs = Date.parse(entry?.createdAt || '');
  if (!Number.isFinite(createdAtMs)) return false;
  const afterMs = Date.parse(LEGACY_MOTION_REFUND_AFTER || '');
  const beforeMs = Date.parse(LEGACY_MOTION_REFUND_BEFORE || '');
  if (Number.isFinite(afterMs) && createdAtMs < afterMs) return false;
  if (Number.isFinite(beforeMs) && createdAtMs >= beforeMs) return false;
  return true;
}

async function reconcileLegacyMotionRefunds(source = 'startup') {
  if (!ACCOUNT_SYSTEM_ENABLED) return { refunded: 0, checked: 0 };
  const [resources, store] = await Promise.all([readResourceManifest(), readUserStore()]);
  const successfulMotionJobs = new Set(resources
    .filter((resource) => resource.mode === 'motion_video' && resource.jobId && resource.videoFilename)
    .map((resource) => resource.jobId));
  const refundedJobs = new Set(store.ledger
    .filter((entry) => entry.type === 'refund' && entry.jobId && Number(entry.points || 0) > 0)
    .map((entry) => entry.jobId));
  const usersById = new Map(store.users.map((user) => [user.id, user]));
  const seenJobs = new Set();
  let refunded = 0;
  let checked = 0;

  for (const entry of store.ledger) {
    if (!isLegacyMotionGenerateEntry(entry)) continue;
    checked += 1;
    const jobId = path.basename(String(entry.jobId || ''));
    if (!jobId || seenJobs.has(jobId)) continue;
    seenJobs.add(jobId);
    if (!inLegacyMotionRefundWindow(entry)) continue;
    if (refundedJobs.has(jobId) || successfulMotionJobs.has(jobId) || jobs.has(jobId)) continue;
    if (existsSync(path.join(GENERATED_DIR, jobId, 'motion.mp4'))) continue;
    const user = usersById.get(entry.userId);
    if (!user || user.status === 'disabled') continue;

    const job = {
      id: jobId,
      mode: 'motion_video',
      ownerId: entry.userId,
      ownerLogin: entry.login || user.login || '',
      chargedPoints: Math.abs(Number(entry.points || 0)),
      refundedPoints: false,
      status: 'failed',
      progress: 0,
      stage: '历史失败视频任务，灵感值已补退',
      logs: ['[reconcile] 历史失败视频任务未生成成功，自动补退灵感值'],
      partialImages: [],
      result: null,
      error: '历史失败视频任务未生成成功，已自动补退点数',
      createdAt: Date.parse(entry.createdAt || '') || Date.now(),
    };
    const refundedUser = await refundJobCharge(job, job.error);
    if (refundedUser || job.refundedPoints) {
      refunded += 1;
      refundedJobs.add(jobId);
      await writeJobLedgerSnapshot(job);
    }
  }

  if (refunded > 0) {
    console.log(`[jobs] reconciled ${refunded} legacy failed motion job(s) from ${source}`);
  }
  return { refunded, checked };
}

function canSeeOwnedItem(req, item) {
  if (!ACCOUNT_SYSTEM_ENABLED) return true;
  if (!req.user?.id) return false;
  if (item?.ownerId === req.user.id) return true;
  if (req.user.tenantRole === 'tenant_admin' && req.user.tenantId && item?.tenantId === req.user.tenantId) return true;
  return false;
}

function withResourceUrls(resource) {
  const withUrls = {
    ...resource,
    images: (resource.images || []).map((image) => ({
      ...image,
      url: resourcePublicUrl(resource.id, image.filename),
      downloadUrl: resourceDownloadUrl(resource.id, image.filename),
    })),
  };

  if (resource.collageFilename) {
    withUrls.collageUrl = resourcePublicUrl(resource.id, resource.collageFilename);
    withUrls.collageDownloadUrl = resourceDownloadUrl(resource.id, resource.collageFilename);
  }
  if (resource.zipFilename) {
    withUrls.zipUrl = resourcePublicUrl(resource.id, resource.zipFilename);
    withUrls.zipDownloadUrl = resourceDownloadUrl(resource.id, resource.zipFilename);
  }
  if (resource.copyFilename) {
    withUrls.copyUrl = resourcePublicUrl(resource.id, resource.copyFilename);
    withUrls.copyDownloadUrl = resourceDownloadUrl(resource.id, resource.copyFilename);
  }
  if (resource.videoFilename) {
    withUrls.videoUrl = resourcePublicUrl(resource.id, resource.videoFilename);
    withUrls.videoDownloadUrl = resourceDownloadUrl(resource.id, resource.videoFilename);
  }
  if (resource.motionPosterFilename) {
    withUrls.motionPosterUrl = resourcePublicUrl(resource.id, resource.motionPosterFilename);
  }

  return localizePublicResultUrls(withUrls);
}

async function copyResourceFile(outputDir, resourceDir, filename) {
  if (!filename) return false;
  const source = path.join(outputDir, path.basename(filename));
  if (!existsSync(source)) return false;
  await copyFile(source, path.join(resourceDir, path.basename(filename)));
  return true;
}

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  CRC_TABLE[index] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosDate, dosTime };
}

async function createZipArchive(outputDir, entries, zipFilename) {
  const fileParts = [];
  const centralParts = [];
  let offset = 0;
  const { dosDate, dosTime } = dosDateTime();

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
    const data = entry.buffer || await readFile(path.join(outputDir, entry.file));
    const checksum = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    fileParts.push(localHeader, nameBuffer, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endHeader = Buffer.alloc(22);
  endHeader.writeUInt32LE(0x06054b50, 0);
  endHeader.writeUInt16LE(0, 4);
  endHeader.writeUInt16LE(0, 6);
  endHeader.writeUInt16LE(entries.length, 8);
  endHeader.writeUInt16LE(entries.length, 10);
  endHeader.writeUInt32LE(centralSize, 12);
  endHeader.writeUInt32LE(offset, 16);
  endHeader.writeUInt16LE(0, 20);

  await writeFile(path.join(outputDir, zipFilename), Buffer.concat([...fileParts, ...centralParts, endHeader]));
}

function recordGeneratedImage(job, images, image) {
  const item = {
    ...image,
    downloadUrl: image.downloadUrl || downloadUrl(job.id, image.filename),
  };
  images.push(item);
  job.partialImages = images.map(({ label, url, filename, downloadUrl, width, height }) => ({ label, url, filename, downloadUrl, width, height }));
}

function isVenueFusionMode(mode = '') {
  return mode === 'venue_fusion';
}

function isStrictReferenceEditMode(mode = '') {
  return mode === 'cinematic_storyboard' || DESIGN_RENDER_MODES.has(mode) || isVenueFusionMode(mode);
}

function imageReferenceLimitForJob(job) {
  if (job?.mode === 'motion_video') return motionReferenceLimitForModel();
  if (isVenueFusionMode(job?.mode)) return 2;
  return 1;
}

function referenceLogLabel(job, index) {
  if (isVenueFusionMode(job?.mode)) {
    return index === 0 ? '空地/空场图' : '婚礼素材图';
  }
  if (job?.mode === 'motion_video') {
    return index === 0 ? '开场镜头图' : `后续镜头图 ${index + 1}`;
  }
  return '现场参考图';
}

async function createVenueFusionReferenceBoard(job, outputDir, references = []) {
  const [venueReference, weddingReference] = references;
  if (!venueReference?.buffer || !weddingReference?.buffer) {
    throw new Error('空地婚礼融合需要同时上传空地照片和婚礼素材图');
  }

  const panelWidth = 768;
  const panelHeight = 768;
  const gap = 24;
  const pad = 24;
  const width = panelWidth * 2 + gap + pad * 2;
  const height = panelHeight + pad * 2;
  const venueBuffer = await sharp(venueReference.buffer)
    .resize(panelWidth, panelHeight, { fit: 'cover' })
    .jpeg({ quality: REFERENCE_IMAGE_QUALITY })
    .toBuffer();
  const weddingBuffer = await sharp(weddingReference.buffer)
    .resize(panelWidth, panelHeight, { fit: 'cover' })
    .jpeg({ quality: REFERENCE_IMAGE_QUALITY })
    .toBuffer();
  const board = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: '#111111',
    },
  })
    .composite([
      { input: venueBuffer, left: pad, top: pad },
      { input: weddingBuffer, left: pad + panelWidth + gap, top: pad },
    ])
    .jpeg({ quality: REFERENCE_IMAGE_QUALITY })
    .toBuffer({ resolveWithObject: true });
  const filename = 'fusion-reference-board.jpg';
  await writeFile(path.join(outputDir, filename), board.data);
  return {
    buffer: board.data,
    mimetype: 'image/jpeg',
    filename,
    storedFilename: filename,
    width: board.info.width,
    height: board.info.height,
    role: 'venue_fusion_reference_board',
  };
}

function getReferenceInput(job) {
  const source = job.reference || (isVenueFusionMode(job?.mode) ? job.referenceComposite : null);
  const buffer = source?.buffer || job.file?.buffer;
  if (!buffer) throw new Error('任务缺少参考图，请重新上传后生成');

  return {
    buffer,
    filename: source?.filename || job.file?.originalname || 'wedding-reference.jpg',
    mimetype: source?.mimetype || job.file?.mimetype || 'image/jpeg',
    storedFilename: source?.storedFilename || '',
  };
}

function normalizeReferenceInput(source, fallbackFilename = 'wedding-reference.jpg') {
  if (!source?.buffer) return null;
  return {
    buffer: source.buffer,
    filename: source.filename || fallbackFilename,
    mimetype: source.mimetype || 'image/jpeg',
    storedFilename: source.storedFilename || '',
  };
}

function getReferenceInputs(job) {
  if (isVenueFusionMode(job?.mode) && job.fusionReferences?.length >= 2) {
    return job.fusionReferences
      .slice(0, 2)
      .map((reference, index) => normalizeReferenceInput(
        reference,
        index === 0 ? 'empty-venue-reference.jpg' : 'wedding-material-reference.jpg',
      ))
      .filter(Boolean);
  }

  return [getReferenceInput(job)];
}

function getResumeInfo(job) {
  const total = SHOT_PLANS[job.mode]?.length ?? 0;
  const completed = job.partialImages?.length || 0;
  const canResumeImageSteps = total > 0 && job.mode !== 'motion_video';
  const hasWorkLeft = canResumeImageSteps && (completed < total || !job.result);
  const nonResumable = isNonResumableGenerationError(job.error || '');
  return {
    total,
    completed,
    canResume: canResumeImageSteps && !!job.reference && hasWorkLeft && !nonResumable && !job.cancelRequested && job.status !== 'cancelled' && job.status !== 'running' && job.status !== 'queued' && job.status !== 'completed',
  };
}

function isTransientJobError(message = '') {
  return /timeout|timed out|fetch failed|ECONNRESET|CONNECT_TIMEOUT|ETIMEDOUT|ENETUNREACH|UND_ERR|socket hang up|network|502|503|504|520|521|522|523|524|525|526|527|530/i
    .test(String(message || ''));
}

function publicJobStage(job) {
  if (!job) return '任务进行中';
  const mode = job.mode === 'motion_video' ? 'video' : 'image';
  const progress = Number(job.progress || 0);
  if (job.status === 'completed') return mode === 'video' ? '视频生成完成，已保存到资源库' : '生成完成，已保存到资源库';
  if (job.status === 'failed') return job.refundedPoints ? '生成失败，灵感值已自动退回' : '生成失败，请重新尝试或联系客服';
  if (job.status === 'cancelled') return '任务已停止';
  if (job.mode === 'design_render_scene' && job.stage) return job.stage;
  if (progress < 18) return '正在接收素材';
  if (progress < 35) return '正在检查素材与生成参数';
  if (progress < 75) return mode === 'video' ? '已提交上游视频任务，正在等待出片' : '正在生成婚礼成品图';
  if (progress < 96) return '正在整理生成结果';
  return '正在保存到资源库';
}

function publicJobError(job) {
  if (!job?.error) return '';
  if (job.refundedPoints) return '生成失败，灵感值已自动退回';
  if (getResumeInfo(job).canResume) return '生成中断，系统可继续处理，请稍后重试';
  return '生成失败，请重新尝试或联系客服';
}

function publicJobLogs(job) {
  const mode = job?.mode === 'motion_video' ? 'video' : 'image';
  const progress = Number(job?.progress || 0);
  const designRender = job?.mode === 'design_render_scene';
  const total = SHOT_PLANS[job?.mode]?.length || 0;
  const completed = job?.partialImages?.length || 0;
  const logs = ['已收到素材，任务已进入生成队列'];
  if (progress >= 18) logs.push('素材检查完成，正在解析婚礼风格');
  if (progress >= 35) logs.push(designRender ? `正在生成现场候选图，已完成 ${completed}/${total} 张` : (mode === 'video' ? '已提交上游视频任务，正在等待出片' : '正在生成婚礼成品图'));
  if (progress >= 75) logs.push('正在整理生成结果');
  if (progress >= 96) logs.push('正在保存到资源库');
  if (job?.status === 'completed') logs.push(designRender ? '实景候选图已生成完成' : (mode === 'video' ? '视频已生成完成' : '成品已生成完成'));
  if (job?.status === 'failed') logs.push(job.refundedPoints ? '生成失败，灵感值已自动退回' : '生成失败，请重新尝试或联系客服');
  if (job?.status === 'cancelled') logs.push('任务已停止');
  return [...new Set(logs)].slice(-6);
}

function safeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf('=');
      if (index === -1) return [part, ''];
      return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
    }));
}

function accessToken() {
  return createHmac('sha256', ACCESS_TOKEN_SECRET)
    .update(`wedscene-access:${PUBLIC_ACCESS_CODE}`)
    .digest('base64url');
}

function hasAccess(req) {
  if (!PUBLIC_ACCESS_CODE) return true;
  const cookies = parseCookies(req.headers.cookie || '');
  return safeEqualText(cookies[ACCESS_COOKIE_NAME], accessToken());
}

function accessCookie(value, req = null) {
  return [
    `${encodeURIComponent(ACCESS_COOKIE_NAME)}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    ...authCookieAttrs(req),
    `Max-Age=${ACCESS_COOKIE_MAX_AGE_SECONDS}`,
  ].filter(Boolean).join('; ');
}

async function requireAccess(req, res, next) {
  if (ACCOUNT_SYSTEM_ENABLED) {
    try {
      const user = await sessionUser(req);
      if (!user) {
        res.status(401).json({ error: '请先登录账号', accessRequired: true, accountRequired: true });
        return;
      }
      req.user = user;
      next();
    } catch (error) {
      res.status(500).json({ error: error.message || '账号校验失败' });
    }
    return;
  }

  if (hasAccess(req)) {
    next();
    return;
  }
  res.status(401).json({ error: '请输入公测访问码', accessRequired: true });
}

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) {
    res.status(503).json({ error: '管理员密钥未配置' });
    return;
  }
  const token = String(req.headers['x-admin-token'] || req.query.token || req.body?.adminToken || '').trim();
  if (!safeEqualText(token, ADMIN_TOKEN)) {
    res.status(401).json({ error: '管理员密钥不正确' });
    return;
  }
  next();
}

function requireOwner(req, res, item) {
  if (canSeeOwnedItem(req, item)) return true;
  res.status(404).json({ error: '资源不存在或无权访问' });
  return false;
}

function assertMode(mode) {
  if (DISABLED_MODES.has(String(mode || ''))) return 'cinematic_storyboard';
  return Object.hasOwn(MODE_LABELS, mode) ? mode : 'cinematic_storyboard';
}

function roundImageDimension(value) {
  return Math.max(64, Math.round(Number(value) / 8) * 8);
}

function sameAspectSizeForReference(reference) {
  const width = Number(reference?.width);
  const height = Number(reference?.height);
  if (!width || !height) return DEFAULT_IMAGE_SIZE;

  const scale = SIMILAR_IMAGE_MAX_EDGE / Math.max(width, height);
  return `${roundImageDimension(width * scale)}x${roundImageDimension(height * scale)}`;
}

function imageSizeFor(mode, job) {
  if (mode === 'cinematic_storyboard') return STORYBOARD_IMAGE_SIZE;
  if (mode === 'setup_comparison' || mode === 'design_render_scene') return STORYBOARD_IMAGE_SIZE;
  if (mode === 'venue_fusion') return sameAspectSizeForReference(job?.reference);
  if (mode === 'similar_style') return sameAspectSizeForReference(job?.reference);
  return DEFAULT_IMAGE_SIZE;
}

function parseImageSize(size) {
  const match = /^(\d+)x(\d+)$/i.exec(size);
  if (!match) return { width: 1024, height: 1024 };
  return { width: Number(match[1]), height: Number(match[2]) };
}

function promptFor(mode, shotLabel, shotPrompt) {
  const isLightingSpaceDetailShot = /conditional lighting-space detail shot|overhead hanging installation|grounded lighting-and-floral/i.test(shotPrompt);

  if (mode === 'cinematic_storyboard') {
    return [
      '⚠️⚠️⚠️ CRITICAL OUTPUT FORMAT: Output ONE SINGLE photographic frame only. This is NOT a grid, NOT a collage, NOT a montage, NOT a storyboard mosaic, NOT a 2x2/2x3/3x2 panel layout, NOT a split-screen, NOT a diptych, NOT a picture-in-picture image. The output must be one continuous photograph from a single camera position, edge-to-edge, with zero visible seams or divisions. Generating any multi-panel / grid / collage layout will be considered a complete failure.',
      '根据婚礼现场的图片生成摄像师专业的单张分镜图。',
      '保持原图的色调，重点渲染婚礼的道具细节比如说花艺等，后面方便我用这几个镜头生成大片感的婚礼视频。',
      'The uploaded wedding photo is the controlling reference image and must be treated like the actual source photo to edit, not loose inspiration.',
      'You are being called 6 separate times — once per shot — to generate 6 independent photographs. Right now you are generating only ONE of them. Do NOT try to show multiple shots inside this single image.',
      'Scene identity lock: keep the same indoor/outdoor category, same ballroom or venue architecture, same ceiling shape, same wall panels, same carpet/floor pattern direction, same stage/backdrop position, same raised platform or aisle height, same banquet table layout, same chair style, same camera-facing spatial relationship and same decor density as the uploaded photo.',
      'Visual anchors to preserve strictly: main color tone, lighting color temperature, stage or aisle geometry, flower color ratio, fabric/drapery style, prop type, venue scale, floor direction, table placement and decor density.',
      'For indoor banquet halls or hotel ballrooms, the generated frame MUST remain an indoor banquet hall/hotel ballroom with visible carpet or floor, ceiling, walls/panels, stage/runway and round dining tables if they are visible in the reference. Do not erase the banquet tables or replace the room with a ceremony-only aisle.',
      'Do not redesign the wedding. Do not create a new venue. Do not create a fantasy render. Do not change a dark coffee/gold/cream ballroom into a white-green garden, chapel, lawn, greenhouse, outdoor terrace, church aisle, palace corridor or another stock wedding scene. The result should look like real wedding cinematographer footage derived from this exact wedding.',
      ...(isLightingSpaceDetailShot ? [
        'Lighting-space frame direction: first inspect the uploaded reference for a real overhead ceiling installation. If it exists, use the central-axis front-facing upward angle under that real installation, with symmetrical head-on structure and sharp lighting detail. If it does not exist, the primary subject must be a real visible lighting, floral, fabric, aisle, table, candle, crystal prop, wall or floor atmosphere detail from the reference, using a natural eye-level or slight low front angle.',
        'Lighting-space negative style: do not invent ceiling decor, chandeliers, hanging crystals, hanging floral rings or overhead drapery that are not visible in the uploaded reference; do not force an upward ceiling angle when the reference has no ceiling installation; do not use side-angle, diagonal-angle or off-axis composition for true ceiling shots; avoid warm peach fabric dominating unless that is the actual visible style.',
      ] : []),
      'Anti-fake constraints: realistic perspective, realistic object scale, physically plausible hanging decorations, no floating chandeliers unless supported by the reference, no broken symmetry, no melted candles, no warped chairs, no random people, no hands, no extra signs, no random English or Chinese words.',
      'Physical-consistency rules: every prop/candle/candelabra/glassware/vase/floral cluster MUST be physically grounded on a real surface (table, floor, stage, pedestal); NO floating props or hovering candles in mid-air. Every flower MUST be a complete bloom with stem connected to a vase/arrangement/pillar; NO disembodied or fused flowers. All elements within this frame must share one consistent perspective and one continuous floor plane — no collage layering of unrelated views.',
      'If the original has a simple double-happiness symbol or clear central emblem, keep it clean and simple; otherwise avoid readable text entirely.',
      'Every output must be 16:9 horizontal, ONE single continuous photograph (no grid/collage/split), high-definition, photorealistic, film still quality, natural camera depth of field, no watermark, no logo, no UI, no storyboard labels.',
      `Shot for this single frame: ${shotLabel}. ${shotPrompt}.`,
      '⚠️ FINAL REMINDER: Output exactly ONE photograph that fills the entire 16:9 frame edge-to-edge. ZERO multi-panel layouts, ZERO grids, ZERO mosaics.',
    ].join(' ');
  }

  if (mode === 'similar_style') {
    return [
      '根据这场婚礼生成其他类似的婚礼。',
      'The uploaded wedding photo is the controlling reference. Think like this: read the visible wedding style, then extend it into another similar but non-repeating wedding reference.',
      'Keep the generated image in the SAME ASPECT RATIO as the uploaded image. Do not change it into a fixed square, fixed vertical poster, or fixed 16:9 frame.',
      'Continue the overall atmosphere of the uploaded wedding, including color palette, drapery or fabric feeling, stage or aisle relationship, lighting mood, floral color proportions, decor density and luxury level.',
      'Generate a different similar wedding scene, not a copy of the exact same photo. Change the floral arrangement, stage styling, fabric curve, lighting placement, foreground/background relationship, or composition so every version has a new main visual.',
      'Do not split the set into different wedding types such as indoor, outdoor, Chinese, destination, garden or terrace. These are other similar weddings from the same reference style.',
      'The whole set has six images. Each image should be a clean finished wedding reference image, similar in style but not repeated.',
      'Photorealistic, polished wedding decor, realistic flowers, realistic fabric, realistic lighting, commercially usable reference image.',
      'No text, no watermark, no logo, no UI elements.',
      `Shot: ${shotLabel}. ${shotPrompt}.`,
    ].join(' ');
  }

  if (mode === 'design_render_scene') {
    return [
      'Convert the uploaded wedding design render into ONE photorealistic real wedding venue photograph that still clearly matches the uploaded design.',
      'REFERENCE LOCK: the uploaded image is the construction blueprint and the controlling visual reference, not a style moodboard. Keep the same main composition, camera direction, venue category, stage/backdrop geometry, aisle/runway path, ceiling or hanging installation, table/chair relationship, flower placement, drapery/fabric curves, prop inventory, color palette and lighting direction.',
      'Do not redesign the wedding. Do not create a new wedding concept, a new venue, a new ceremony arch, a new garden/lawn/chapel, a new background wall, a different ceiling, different floral colors, different aisle shape, different table layout or unrelated stock wedding decor.',
      'Transformation boundary: only translate the render into a real built scene. Replace CG/PPT/proposal-render surfaces with real-world photography: real hotel ballroom/event-hall materials, real fabric under gravity, real flower volume, real stage carpentry, real rigging/contact shadows, real floor reflections and physically plausible event lighting.',
      'Similarity priority: the result should pass a client side-by-side check against the original design render. The major objects must remain in the same relative positions and proportions. If the render is symmetrical, preserve symmetry. If the render has a specific central structure, backdrop shape, aisle geometry, suspended decor or floral rhythm, keep it recognizable.',
      'Material realism requirements: real fabric texture with wrinkles and layered folds; real flowers with individual petals and natural species shapes; real glass/crystal/chandeliers/candles/acrylic/metal only when visible in the uploaded design; realistic table linens, floor contact shadows, practical rigging, physically plausible spotlight beams and believable light falloff.',
      'Spatial rules: keep one continuous physical space with consistent perspective, floor plane, object scale, and a readable aisle-to-stage depth relationship. Do not create a collage, split screen, poster, plan view, fantasy venue, impossible floating props, warped chairs, melted flowers, duplicate stages or unrelated new architecture.',
      'People/text rules: no people, no couple, no guests, no staff, no hands, no readable text, no logos, no watermark, no UI.',
      'Camera: horizontal 16:9 single photograph, full-frame wedding portfolio quality, natural exposure, realistic depth of field, clean wide view; keep the whole design readable.',
      `Variant for this single output: ${shotLabel}. ${shotPrompt}.`,
      'Final reminder: output exactly one continuous real-scene photograph, edge-to-edge, no before/after comparison, no multi-panel layout, no loose reinterpretation.',
    ].join(' ');
  }

  if (mode === 'venue_fusion') {
    return [
      'Create ONE photorealistic finished wedding installation by fusing two separate uploaded reference images.',
      'REFERENCE IMAGE 1 = the real empty land / empty venue / empty ballroom. This is the PRIMARY SCENE LOCK.',
      'REFERENCE IMAGE 2 = the wedding material source. This is ONLY the design-material source.',
      'Use Image 1 as the controlling camera and venue: preserve its indoor/outdoor identity, camera viewpoint, lens height, perspective, ground plane, floor material, wall/ceiling/background architecture, horizon if present, scale, usable open area, lighting direction and ambient condition.',
      'Treat Image 1 as the actual base photo to edit, not as loose inspiration. Keep recognizable floor pattern, carpet/tile/wood texture, wall panels, doors, columns, stage opening and room proportions from Image 1 whenever they are visible.',
      'Use Image 2 only for wedding design material: transfer its color palette, floral language, fabric/drapery feeling, ceremony focal point, aisle/runner logic, lighting mood and major decor vocabulary where it physically fits into Image 1.',
      'The main wedding decor in the result must visibly echo Image 2: if Image 2 has a large flower focal piece, dark drapery, glowing ball lanterns, floor spotlights or clustered foreground florals, those specific design cues must appear in the installed setup.',
      'Raised-platform rule: if Image 2 shows a stage, runway, aisle deck, stair platform or visible front riser edge, rebuild it as a raised physical structure with real height, vertical front/side faces, steps or risers, contact shadows and perspective. It must not become a flat floor pattern, flat carpet overlay or painted aisle.',
      'Banquet-table rule: when Image 1 is an indoor ballroom, hotel banquet hall or dining event space, add realistic round banquet dining tables on both sides of the central aisle/platform unless Image 1 is clearly too small. Use white or cream tablecloths, matching hotel chairs, table settings/glassware and small floral centerpieces, while keeping the central raised aisle open.',
      'Hard failure boundary: if Image 1 is an indoor ballroom, banquet hall, hotel carpeted room or stage interior, the result MUST remain that same indoor venue. Never turn it into an outdoor lawn, garden, meadow, terrace or sky scene; never replace carpet/tile/wood floor with grass.',
      'Hard failure boundary: if Image 1 is outdoor, keep its actual ground type, landscape, horizon, weather and architecture. Do not replace it with a generic wedding lawn or stock garden unless Image 1 already is that kind of site.',
      'Fusion goal: make it look like the wedding material from Image 2 has been physically built inside Image 1. All decor must touch the Image 1 floor or venue surfaces with correct shadows, contact points, scale and perspective.',
      'Do not copy Image 2 background, walls, ceiling, floor, outdoor environment, tables, chairs or original camera angle into Image 1 unless those elements are part of the wedding decor and can physically fit.',
      'Do not create a split-screen, before/after comparison, collage, contact sheet, moodboard, poster, plan view, floating render, fantasy scene or unrelated venue.',
      'No people, no couple, no guests, no staff, no hands, no readable text, no logos, no watermark, no UI.',
      'Output exactly one continuous real photograph, commercially usable for showing how this wedding would land on this exact empty site.',
      `Shot: ${shotLabel}. ${shotPrompt}.`,
    ].join(' ');
  }

  if (mode === 'setup_comparison') {
    return [
      '根据上传的婚礼已布置完成的现场图，反向生成同一场地「布置前」的空场地图。',
      'The uploaded photo is the already-decorated wedding setup. Infer and create the BEFORE-decoration empty venue image: how this venue looked before any wedding decor was installed.',
      'Strictly remove ALL wedding decoration: floral installations, drapery and fabric, ceiling chandeliers or hanging florals, aisle/runner decor, candles, props, ceremony arch, stage decor, banquet table setups, chair sashes, event-specific lighting.',
      'Keep the venue bare and authentic: original architecture, ceiling structure, wall finishes, floor, windows/doors, columns, main stage/aisle space, room shape and perspective. Use the same camera viewpoint as the uploaded photo.',
      'Render with neutral overhead/ambient hotel lighting (no event lighting), looking like a real estate or venue catalog shot of an empty ballroom/event hall before setup.',
      'Do not add any new decoration, people, brand logos, watermarks, UI panels, software interface, random text or signage. Do not include partial leftover decor.',
      'Use a 16:9 horizontal frame, high definition, commercially usable, suitable to place above the original after photo in a 3:4 two-panel before/after poster.',
      `Shot: ${shotLabel}. ${shotPrompt}.`,
    ].join(' ');
  }

  const common = [
    'The uploaded wedding photo is the controlling visual reference, not just loose inspiration.',
    'Keep recognizable venue architecture, camera perspective cues, spatial layout, ceremony structure, floral language, lighting mood, and material textures from the uploaded photo.',
    'Do not invent an unrelated wedding venue or unrelated decor style.',
    'Create a premium photorealistic wedding planning image.',
    'No text, no watermark, no logo, no UI elements.',
    'Keep the image elegant, commercially usable, and suitable for a viral wedding image-and-text post.',
    'Strong visual hierarchy, polished lighting, realistic materials.',
  ].join(' ');

  if (mode === 'detail_pack') {
    return `${common} Preserve the style direction from the uploaded reference image and generate a complementary detail image for a content carousel that feels like it belongs to the same event. Shot: ${shotPrompt}.`;
  }

  return `${common} Preserve the same wedding design language and make it feel like another angle from the same event shown in the uploaded photo. Shot: ${shotPrompt}.`;
}

async function requestOpenAIImageEditBuffer(job, prompt) {
  throwIfJobCancelled(job);
  const references = getReferenceInputs(job);
  const requestTimeout = imageRequestTimeoutFor(job);

  if (USE_N1N) {
    return requestN1nImageBuffer(job, prompt, references);
  }

  // 官方 OpenAI：用 SDK images.edit（multipart 上传），SDK 自带正确的 UA / Stainless headers。
  const imageFiles = await Promise.all(references.map((reference) => toFile(reference.buffer, reference.filename, {
    type: reference.mimetype,
  })));
  const editPayload = {
    model: OPENAI_MODEL,
    image: imageFiles.length === 1 ? imageFiles[0] : imageFiles,
    prompt,
    size: imageSizeFor(job.mode, job),
    n: 1,
    quality: IMAGE_QUALITY,
    output_format: 'jpeg',
    output_compression: 88,
  };
  if (isStrictReferenceEditMode(job.mode)) {
    editPayload.input_fidelity = 'high';
  }
  let response;
  try {
    response = await openai.images.edit(editPayload, {
      timeout: requestTimeout,
      signal: signalForJob(job, requestTimeout),
    });
  } catch (err) {
    const status = err.status || err.response?.status || '?';
    const code = err.code || err.error?.code || '?';
    const errType = err.type || err.error?.type || '?';
    const rawBody = (err.response?.body || err.body || '').toString().replace(/\s+/g, ' ').slice(0, 600);
    const cfRay = err.headers?.['cf-ray'] || err.response?.headers?.get?.('cf-ray') || '?';
    console.error(`[image-sdk-error] HTTP=${status} code=${code} type=${errType} cf-ray=${cfRay} msg=${err.message}`);
    if (rawBody) console.error(`[image-sdk-error] body=${rawBody}`);
    if (job) {
      job.logs.push(`[image-sdk-error] HTTP=${status} code=${code} cf-ray=${cfRay} ${(err.message || '').slice(0, 200)}`);
    }
    throw err;
  }

  throwIfJobCancelled(job);
  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error('图片生成接口没有返回图像数据');
  return Buffer.from(b64, 'base64');
}

async function requestN1nImageGenerationBuffer(job, prompt, reference) {
  const requestTimeout = imageRequestTimeoutFor(job);
  const references = Array.isArray(reference) ? reference : [reference];
  const imageInput = references.map((item) => {
    if (PUBLIC_BASE_URL && item.storedFilename) return publicUrl(job.id, item.storedFilename);
    const mime = item.mimetype || 'image/jpeg';
    return 'data:' + mime + ';base64,' + item.buffer.toString('base64');
  });
  const publicRefs = references
    .filter((item) => PUBLIC_BASE_URL && item.storedFilename)
    .map((item) => item.storedFilename);
  if (publicRefs.length && job?.logs) {
    job.logs.push('[n1n] generations 使用公网参考图：' + publicRefs.join(', '));
  }

  const payload = {
    model: OPENAI_MODEL,
    prompt,
    image: imageInput,
    size: imageSizeFor(job.mode, job),
    n: 1,
  };

  const response = await fetch(N1N_IMAGE_GENERATIONS_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
    signal: signalForJob(job, requestTimeout),
  });

  throwIfJobCancelled(job);

  if (!response.ok) {
    const text = await response.text();
    const rawSnippet = String(text || '').replace(/\s+/g, ' ').slice(0, 500);
    console.error(`[n1n-gen-error] HTTP ${response.status} body=${rawSnippet}`);
    if (job) job.logs.push(`[n1n-gen-error] HTTP ${response.status} → ${rawSnippet.slice(0, 200)}`);
    const message = summarizeImageApiError({
      context: 'n1n.ai images.generations',
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      text,
      payload: null,
    });
    const error = new Error(`n1n.ai images.generations failed (HTTP ${response.status}): ${message}`);
    error.status = response.status;
    error.body = text;
    throw error;
  }

  const payloadJson = await response.json().catch(() => null);
  if (!payloadJson) {
    throw new Error('n1n.ai 接口没有返回图像数据');
  }
  const item = payloadJson?.data?.[0] || payloadJson?.images?.[0] || payloadJson?.output?.[0] || payloadJson?.result?.[0] || payloadJson;
  return imageBufferFromApiItem(item, job);
}

async function requestN1nImageEditBuffer(job, prompt, reference) {
  throwIfJobCancelled(job);
  const requestTimeout = imageRequestTimeoutFor(job);
  const references = Array.isArray(reference) ? reference : [reference];
  const editEndpoint = isStrictReferenceEditMode(job?.mode)
    ? N1N_IMAGE_GENERATIONS_ENDPOINT.replace(/\/images\/generations\/?$/i, '/images/edits')
    : N1N_IMAGE_EDIT_ENDPOINT;
  if (isStrictReferenceEditMode(job?.mode) && job?.logs) {
    job.logs.push(`[n1n] ${MODE_LABELS[job.mode] || job.mode} edits endpoint: ${editEndpoint}`);
  }

  const form = new FormData();
  form.append('model', OPENAI_MODEL);
  form.append('prompt', prompt);
  form.append('n', '1');
  form.append('size', imageSizeFor(job.mode, job));
  form.append('response_format', 'b64_json');
  form.append('output_format', 'jpeg');
  form.append('output_compression', '88');
  if (IMAGE_QUALITY) form.append('quality', IMAGE_QUALITY);
  if (isStrictReferenceEditMode(job?.mode)) form.append('input_fidelity', 'high');

  for (const field of N1N_EDIT_IMAGE_FIELD.split(',').map((item) => item.trim()).filter(Boolean)) {
    for (const item of references) {
      const referenceBlob = new Blob([item.buffer], { type: item.mimetype || 'image/jpeg' });
      form.append(field, referenceBlob, item.filename || 'wedding-reference.jpg');
    }
  }

  const response = await fetch(editEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      Accept: 'application/json',
    },
    body: form,
    signal: signalForJob(job, requestTimeout),
  });

  return readImageApiResponse(response, 'n1n.ai images.edits', job);
}

function shouldTryAlternateN1nTransport(error) {
  if (isJobCancelledError(error)) return false;
  const status = Number(error?.status || 0);
  if (status === 401) return false;
  if (status === 403 && !textLooksLikeCloudflareBlock(error?.body || error?.message || '')) return false;
  if (status >= 400) return true;
  return /fetch failed|timed out|timeout|ECONNRESET|ETIMEDOUT|ENETUNREACH|UND_ERR|socket hang up|network|Cloudflare|HTML 错误页/i
    .test(`${error?.message || ''} ${describeFetchError(error)}`);
}

async function requestN1nImageBuffer(job, prompt, reference) {
  const mode = N1N_IMAGE_INPUT_MODE;
  if (isStrictReferenceEditMode(job?.mode)) {
    const label = MODE_LABELS[job?.mode] || job?.mode || '当前模式';
    if (job?.logs) job.logs.push(`[n1n] ${label}强制使用 images.edits 参考图编辑通道，避免 generations 弱参考跑偏`);
    return requestN1nImageEditBuffer(job, prompt, reference);
  }
  if (mode === 'edit' || mode === 'edits' || mode === 'multipart') {
    return requestN1nImageEditBuffer(job, prompt, reference);
  }
  if (mode === 'generation' || mode === 'generations' || mode === 'json') {
    return requestN1nImageGenerationBuffer(job, prompt, reference);
  }

  try {
    return await requestN1nImageEditBuffer(job, prompt, reference);
  } catch (error) {
    if (!shouldTryAlternateN1nTransport(error)) throw error;
    const detail = describeFetchError(error).slice(0, 180);
    if (job) job.logs.push(`[n1n] edits multipart 通道失败，自动切换 generations JSON：${detail}`);
    return requestN1nImageGenerationBuffer(job, prompt, reference);
  }
}

async function generateWithOpenAI(job, outputDir, existingImages = []) {
  const shots = SHOT_PLANS[job.mode];
  const total = shots.length;
  const slots = new Array(total).fill(null);
  for (const item of existingImages) {
    const match = /image-(\d+)\.jpg$/.exec(item.filename || '');
    const idx = match ? Number(match[1]) - 1 : -1;
    if (idx >= 0 && idx < total) slots[idx] = item;
  }

  const pending = [];
  for (let i = 0; i < total; i += 1) if (!slots[i]) pending.push(i);

  const syncPartial = () => {
    job.partialImages = slots.filter(Boolean);
    const done = job.partialImages.length;
    const next = shots[done] ? shots[done][0] : '即将完成';
    const stagePrefix = job.mode === 'design_render_scene' ? '正在生成现场候选图' : '正在生成';
    updateJob(
      job,
      22 + Math.round(done * (58 / total)),
      done < total ? `${stagePrefix}：${next}（${done}/${total}）` : '正在合成发布包',
    );
  };

  if (pending.length === 0) {
    syncPartial();
    return slots.filter(Boolean);
  }

  const queue = pending.slice();
  const { width, height } = parseImageSize(imageSizeFor(job.mode, job));
  const concurrency = imageConcurrencyFor(job, pending.length);
  const requestTimeout = imageRequestTimeoutFor(job);
  job.logs.push(`[${USE_N1N ? 'n1n' : 'generate'}] 并发 ${concurrency} 路生成，共 ${pending.length} 张，单张超时 ${Math.round(requestTimeout / 1000)} 秒`);

  const worker = async (workerId) => {
    while (queue.length > 0) {
      throwIfJobCancelled(job);
      const index = queue.shift();
      if (index === undefined) break;
      const [label, shotPrompt] = shots[index];
      job.logs.push(`[worker-${workerId}] 开始 ${index + 1}/${total} ${label}`);
      let buffer;
      const maxAttempts = imageMaxAttemptsFor(job);
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          throwIfJobCancelled(job);
          const buf = await requestOpenAIImageEditBuffer(job, promptFor(job.mode, label, shotPrompt));
          throwIfJobCancelled(job);
          if (!buf || buf.length < 8192) {
            throw new Error(`接口返回图像数据过小（${buf?.length || 0}B），疑似被内容审核拦截`);
          }
          buffer = buf;
          break;
        } catch (error) {
          if (isJobCancelledError(error)) throw error;
          const msg = describeFetchError(error) || error.message || error.code || '';
          const retriable = /timed out|timeout|fetch failed|过小|审核|EAI_AGAIN|ECONNRESET|ETIMEDOUT|ENETUNREACH|UND_ERR_SOCKET|socket hang up|502|503|504|429|520|521|522|523|524|525|526|527|530|origin_response_timeout|origin_dns|origin_unreachable|bad gateway|gateway timeout|upstream/i.test(msg);
          // Cloudflare 5xx（524/520-530）说明上游 n1n 服务慢或暂时不稳，需要更长 backoff
          const isCloudflareUpstream = /\b52[0-7]\b|530|origin_response_timeout|origin_dns|origin_unreachable/i.test(msg);
          if (!retriable || attempt >= maxAttempts) {
            if (/timed out|timeout/i.test(msg)) {
              throw new Error(`${ACTIVE_PROVIDER} 生图超时（>${Math.round(requestTimeout / 1000)}s），系统将自动继续生成`);
            }
            if (/fetch failed/i.test(msg)) {
              throw new Error(`${ACTIVE_PROVIDER} 请求失败：${describeFetchError(error)}`);
            }
            throw error;
          }
          const backoff = isCloudflareUpstream ? 8000 * attempt : 2000 * attempt;
          job.logs.push(`[worker-${workerId}] 第 ${index + 1} 张失败（${msg.slice(0, 120)}），${backoff}ms 后重试 ${attempt + 1}/${maxAttempts}`);
          await wait(backoff);
        }
      }
      throwIfJobCancelled(job);
      const filename = `image-${index + 1}.jpg`;
      await sharp(buffer)
        .rotate()
        .resize(width, height, { fit: 'cover' })
        .jpeg({ quality: 88 })
        .toFile(path.join(outputDir, filename));
      slots[index] = {
        label,
        url: publicUrl(job.id, filename),
        filename,
        width,
        height,
        downloadUrl: downloadUrl(job.id, filename),
      };
      job.logs.push(`[worker-${workerId}] 完成 ${index + 1}/${total} ${label}`);
      syncPartial();
    }
  };

  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i + 1)));
  return slots.filter(Boolean);
}

function stripDataUrl(value) {
  return value.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeFetchError(error) {
  const cause = error?.cause;
  return [
    error?.message,
    cause?.code,
    cause?.message,
  ].filter(Boolean).join(' / ') || 'fetch failed';
}

function textLooksLikeHtml(text = '') {
  return /<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]/i.test(String(text).slice(0, 2000));
}

function textLooksLikeCloudflareBlock(text = '') {
  return /cloudflare|attention required|cf-error|cf-chl|just a moment|sorry,\s*you have been blocked|ray id/i.test(String(text).slice(0, 8000));
}

function summarizeImageApiError({ context, status, contentType, text = '', payload = null }) {
  if (textLooksLikeCloudflareBlock(text)) {
    return `${ACTIVE_PROVIDER} 接口被 Cloudflare 拦截，当前网络/IP/代理被上游拒绝访问。请切换网络或代理、联系 n1n.ai 放行/更换可用 API 域名，或临时切回官方 OpenAI 接口后重试。`;
  }

  if (textLooksLikeHtml(text) || /text\/html/i.test(contentType)) {
    return `${context} 返回了 HTML 错误页（HTTP ${status}），不是图片接口响应。请检查 API 域名、代理线路或上游服务状态。`;
  }

  const message = payload?.error?.message || payload?.message || text || `HTTP ${status}`;
  return String(message).replace(/\s+/g, ' ').slice(0, 500);
}

async function readUpstreamResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text().catch(() => '');
  let payload = null;
  if (text && (/json/i.test(contentType) || /^[\s\r\n]*[{\[]/.test(text))) {
    try { payload = JSON.parse(text); } catch {}
  }
  return { contentType, text, payload };
}

function summarizeMotionApiError({ context, status, contentType, text = '', payload = null }) {
  if (textLooksLikeCloudflareBlock(text)) {
    return `视频上游接口被 Cloudflare 拦截（HTTP ${status}），当前网络/IP/代理可能被上游拒绝。请切换代理线路、联系 n1n.ai 放行，或更换可用 API 域名后重试。`;
  }

  if (textLooksLikeHtml(text) || /text\/html/i.test(contentType)) {
    const type = contentType ? `，Content-Type: ${contentType}` : '';
    return `${context} 返回了 HTML 错误页（HTTP ${status}${type}），不是视频接口响应。请检查 MOTION_VIDEO_ENDPOINT、代理线路、MOTION_VIDEO_MODEL 或上游服务状态。`;
  }

  const message = payload?.error?.message || payload?.message || payload?.detail || text || `HTTP ${status}`;
  return `${context} 请求失败（HTTP ${status}）：${String(message).replace(/\s+/g, ' ').slice(0, 500)}`;
}

function cleanUserErrorMessage(message = '') {
  const text = String(message || '').trim();
  if (textLooksLikeCloudflareBlock(text)) {
    return `${ACTIVE_PROVIDER} 接口被 Cloudflare 拦截，当前网络/IP/代理被上游拒绝访问。请切换网络或代理、联系 n1n.ai 放行/更换可用 API 域名，或临时切回官方 OpenAI 接口后重试。`;
  }
  if (textLooksLikeHtml(text)) {
    return '上游接口返回了 HTML 错误页，不是图片接口响应。请检查 API 域名、代理线路或上游服务状态。';
  }
  return text.replace(/\s+/g, ' ').slice(0, 500) || '生成失败';
}

function isNonResumableGenerationError(message = '') {
  return /Cloudflare|拒绝访问|HTML 错误页|不是图片接口响应|API 域名|上游服务状态|内容审核拦截|返回图像数据过小/i.test(String(message || ''));
}

async function fetchWithRetries(createRequest, context, onRetry, job = null) {
  let lastError = null;
  const delays = [0, 1500, 4000, 9000, 15000, 25000, 40000];

  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (job) throwIfJobCancelled(job);
    if (delays[attempt]) await wait(delays[attempt]);
    if (job) throwIfJobCancelled(job);

    try {
      const { url, options } = createRequest();
      return await fetch(url, {
        ...options,
        signal: job ? signalForJob(job, 180_000) : AbortSignal.timeout(180_000),
      });
    } catch (error) {
      lastError = error;
      if (job && isJobCancelledError(error)) throw error;
      if (attempt < delays.length - 1 && onRetry) {
        onRetry({
          attempt: attempt + 1,
          maxAttempts: delays.length,
          delay: delays[attempt + 1],
          message: describeFetchError(error),
        });
      }
    }
  }

  throw new Error(`${context} request failed: ${describeFetchError(lastError)}`);
}

async function fetchImageUrlBuffer(url, job = null) {
  let lastError = null;
  const delays = [0, 1200, 2500, 5000];

  for (const delay of delays) {
    if (job) throwIfJobCancelled(job);
    if (delay) await wait(delay);
    if (job) throwIfJobCancelled(job);

    try {
      const response = await fetch(url, {
        signal: job ? signalForJob(job, 90_000) : AbortSignal.timeout(90_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (job && isJobCancelledError(error)) throw error;
    }
  }

  throw new Error(`Image download failed: ${lastError?.message || 'fetch failed'}`);
}

async function imageBufferFromApiItem(item, job = null) {
  if (!item) throw new Error('Image API did not return an image item');

  const b64 = item.b64_json || item.base64 || item.image_base64 || item.image;
  if (typeof b64 === 'string' && b64.trim()) {
    return Buffer.from(stripDataUrl(b64.trim()), 'base64');
  }

  const url = item.url || item.image_url || item.output_url;
  if (typeof url === 'string' && url.trim()) {
    return fetchImageUrlBuffer(url.trim(), job);
  }

  throw new Error('Image API response did not contain b64_json or url');
}

async function readImageApiResponse(response, context, job = null) {
  if (job) throwIfJobCancelled(job);
  const contentType = response.headers.get('content-type') || '';
  if (contentType.startsWith('image/')) {
    if (!response.ok) throw new Error(`${context} failed: HTTP ${response.status}`);
    if (job) throwIfJobCancelled(job);
    return Buffer.from(await response.arrayBuffer());
  }

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    // 详细记录原始错误，便于排查 cloudflare/限流/审核 等问题
    const rawSnippet = String(text || '').replace(/\s+/g, ' ').slice(0, 500);
    console.error(`[image-api-error] ${context} HTTP ${response.status} content-type=${contentType} body=${rawSnippet}`);
    if (job) job.logs.push(`[image-api-error] HTTP ${response.status} → ${rawSnippet.slice(0, 200)}`);
    const message = summarizeImageApiError({
      context,
      status: response.status,
      contentType,
      text,
      payload,
    });
    const error = new Error(`${context} failed: ${message}`);
    error.status = response.status;
    error.contentType = contentType;
    error.body = text;
    throw error;
  }

  if (!payload) {
    const message = summarizeImageApiError({
      context,
      status: response.status,
      contentType,
      text,
      payload,
    });
    const error = new Error(`${context} failed: ${message}`);
    error.status = response.status;
    error.contentType = contentType;
    error.body = text;
    throw error;
  }

  const item = payload?.data?.[0] || payload?.images?.[0] || payload?.output?.[0] || payload?.result?.[0] || payload;
  return imageBufferFromApiItem(item, job);
}

async function requestXiaojiGenerationImageBuffer(job, prompt) {
  throwIfJobCancelled(job);
  const references = getReferenceInputs(job);
  const body = {
    model: XIAOJI_IMAGE_MODEL,
    prompt,
    n: 1,
    size: imageSizeFor(job.mode, job),
    response_format: 'b64_json',
  };

  if (IMAGE_QUALITY) body.quality = IMAGE_QUALITY;
  if (XIAOJI_REFERENCE_FIELD) {
    const referenceData = references.map((reference) => `data:${reference.mimetype};base64,${reference.buffer.toString('base64')}`);
    body[XIAOJI_REFERENCE_FIELD] = referenceData.length === 1 ? referenceData[0] : referenceData;
  }

  const response = await fetchWithRetries(() => ({
    url: XIAOJI_IMAGE_ENDPOINT,
    options: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${XIAOJI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  }), 'Image generation API', ({ attempt, maxAttempts, delay, message }) => {
    job.logs.push(`[retry] 生图接口连接不稳定，${Math.round(delay / 1000)} 秒后自动重试 ${attempt + 1}/${maxAttempts}：${message}`);
  }, job);

  return readImageApiResponse(response, 'Image generation API', job);
}

async function requestXiaojiEditImageBuffer(job, prompt) {
  throwIfJobCancelled(job);
  const references = getReferenceInputs(job);

  const response = await fetchWithRetries(() => {
    const form = new FormData();

    form.append('model', XIAOJI_IMAGE_MODEL);
    form.append('prompt', prompt);
    form.append('n', '1');
    form.append('size', imageSizeFor(job.mode, job));
    form.append('response_format', 'b64_json');
    form.append('output_format', 'jpeg');
    form.append('output_compression', '88');
    if (IMAGE_QUALITY) form.append('quality', IMAGE_QUALITY);
    if (isStrictReferenceEditMode(job?.mode)) form.append('input_fidelity', 'high');

    for (const field of XIAOJI_EDIT_IMAGE_FIELD.split(',').map((item) => item.trim()).filter(Boolean)) {
      for (const reference of references) {
        const referenceBlob = new Blob([reference.buffer], { type: reference.mimetype });
        form.append(field, referenceBlob, reference.filename);
      }
    }

    return {
      url: XIAOJI_EDIT_ENDPOINT,
      options: {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${XIAOJI_API_KEY}`,
        },
        body: form,
      },
    };
  }, 'Image edit API', ({ attempt, maxAttempts, delay, message }) => {
    job.logs.push(`[retry] 生图接口连接不稳定，${Math.round(delay / 1000)} 秒后自动重试 ${attempt + 1}/${maxAttempts}：${message}`);
  }, job);

  return readImageApiResponse(response, 'Image edit API', job);
}

async function requestXiaojiImageBuffer(job, prompt) {
  if (isStrictReferenceEditMode(job?.mode)) {
    const label = MODE_LABELS[job?.mode] || job?.mode || '当前模式';
    if (job?.logs) job.logs.push(`[xiaoji] ${label}强制使用 images.edits 参考图编辑通道，避免 generations 弱参考跑偏`);
    return requestXiaojiEditImageBuffer(job, prompt);
  }
  if (XIAOJI_IMAGE_INPUT_MODE === 'edit') {
    return requestXiaojiEditImageBuffer(job, prompt);
  }

  return requestXiaojiGenerationImageBuffer(job, prompt);
}

async function generateWithXiaoji(job, outputDir, existingImages = []) {
  const shots = SHOT_PLANS[job.mode];
  const images = [...existingImages];

  for (let index = images.length; index < shots.length; index += 1) {
    throwIfJobCancelled(job);
    const [label, shotPrompt] = shots[index];
    const total = shots.length;
    updateJob(
      job,
      22 + Math.round(index * (58 / total)),
      `正在生成：${label}`,
      `[xiaoji:${XIAOJI_IMAGE_INPUT_MODE}] ${index + 1}/${total} ${label}，已附带 ${getReferenceInputs(job).length} 张参考图`,
    );

    const buffer = await requestXiaojiImageBuffer(job, promptFor(job.mode, label, shotPrompt));
    throwIfJobCancelled(job);
    const filename = `image-${index + 1}.jpg`;
    const { width, height } = parseImageSize(imageSizeFor(job.mode, job));
    await sharp(buffer)
      .rotate()
      .resize(width, height, { fit: 'cover' })
      .jpeg({ quality: 88 })
      .toFile(path.join(outputDir, filename));
    recordGeneratedImage(job, images, { label, url: publicUrl(job.id, filename), filename, width, height });
  }

  return images;
}

function mockSvg(index, mode) {
  const palettes = {
    cinematic_storyboard: ['#101014', '#f0c2b5', '#d4b46e', '#f7a8a8'],
    multi_angle: ['#171016', '#f0c2b5', '#d4b46e', '#7dd3fc'],
    detail_pack: ['#130f14', '#f5c5db', '#f4d4c5', '#a7f3d0'],
    similar_style: ['#10131a', '#c7d2fe', '#f0c2b5', '#d4b46e'],
    setup_comparison: ['#1d1d20', '#f0c2b5', '#d4b46e', '#a7f3d0'],
    design_render_scene: ['#111116', '#f0c2b5', '#d4b46e', '#7dd3fc'],
    venue_fusion: ['#101513', '#f0c2b5', '#d4b46e', '#9bd5c3'],
  }[mode] || ['#171016', '#f0c2b5', '#d4b46e', '#7dd3fc'];
  const [bg, rose, gold, accent] = palettes;
  const shift = index * 41;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${bg}"/>
          <stop offset="1" stop-color="#08080c"/>
        </linearGradient>
        <radialGradient id="halo" cx="${42 + index * 6}%" cy="${30 + index * 4}%" r="60%">
          <stop offset="0" stop-color="${rose}" stop-opacity="0.52"/>
          <stop offset="1" stop-color="${rose}" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="1024" height="1024" fill="url(#bg)"/>
      <rect width="1024" height="1024" fill="url(#halo)"/>
      <path d="M70 886L350 438H674L954 886Z" fill="#0d0d13" opacity="0.9"/>
      <path d="M${250 + shift % 96} 768C${250 + shift % 96} 414 ${774 - shift % 86} 414 ${774 - shift % 86} 768" fill="none" stroke="${rose}" stroke-width="${26 + index * 2}" stroke-linecap="round" opacity="0.9"/>
      <path d="M312 804H712" stroke="${gold}" stroke-width="22" stroke-linecap="round" opacity="0.65"/>
      ${Array.from({ length: 21 }, (_, i) => {
        const x = 150 + (i % 7) * 118 + (index % 2) * 16;
        const y = 650 + Math.floor(i / 7) * 72;
        return `<rect x="${x}" y="${y}" width="50" height="42" rx="10" fill="#fff7ed" opacity="${0.12 + (i % 3) * 0.04}"/>`;
      }).join('')}
      ${Array.from({ length: 20 }, (_, i) => {
        const x = 260 + (i % 10) * 52 + (index % 3) * 14;
        const y = 570 + Math.floor(i / 10) * 78;
        return `<circle cx="${x}" cy="${y}" r="${16 + (i % 4) * 4}" fill="${i % 2 ? rose : gold}" opacity="0.88"/>`;
      }).join('')}
      <path d="M240 360C390 306 620 306 784 360" fill="none" stroke="${accent}" stroke-width="5" stroke-linecap="round" stroke-dasharray="1 26" opacity="0.84"/>
      <circle cx="360" cy="326" r="7" fill="#fde68a"/>
      <circle cx="512" cy="304" r="8" fill="#fde68a"/>
      <circle cx="664" cy="326" r="7" fill="#fde68a"/>
    </svg>
  `;
}

async function generateMockImages(job, outputDir, existingImages = []) {
  const shots = SHOT_PLANS[job.mode];
  const images = [...existingImages];

  for (let index = images.length; index < shots.length; index += 1) {
    throwIfJobCancelled(job);
    const [label] = shots[index];
    const total = shots.length;
    updateJob(
      job,
      22 + Math.round(index * (58 / total)),
      `演示生成：${label}`,
      `[mock] ${index + 1}/${total} ${label}`,
    );
    const filename = `image-${index + 1}.jpg`;
    const { width, height } = parseImageSize(imageSizeFor(job.mode, job));
    await sharp(Buffer.from(mockSvg(index, job.mode)))
      .resize(width, height, { fit: 'cover' })
      .jpeg({ quality: 88 })
      .toFile(path.join(outputDir, filename));
    recordGeneratedImage(job, images, { label, url: publicUrl(job.id, filename), filename, width, height });
    await new Promise((resolve) => setTimeout(resolve, 220));
  }

  return images;
}

function safeMotionSourceFilename(filename = 'motion-source.jpg') {
  const value = path.basename(String(filename || 'motion-source.jpg'));
  return /^motion-(source|reference-\d+)\.jpg$/i.test(value) ? value : 'motion-source.jpg';
}

function signMotionSourceToken(jobId, filename = 'motion-source.jpg', ttlMs = MOTION_VIDEO_TOKEN_TTL_MS) {
  const exp = Date.now() + ttlMs;
  const safeFilename = safeMotionSourceFilename(filename);
  const payload = `${jobId}|${safeFilename}|${exp}`;
  const sig = createHmac('sha256', ACCESS_TOKEN_SECRET).update(payload).digest('hex').slice(0, 24);
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

function verifyMotionSourceToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [payloadEncoded, sig] = token.split('.');
  if (!payloadEncoded || !sig) return null;
  let payload = '';
  try { payload = Buffer.from(payloadEncoded, 'base64url').toString('utf8'); } catch { return null; }
  const expected = createHmac('sha256', ACCESS_TOKEN_SECRET).update(payload).digest('hex').slice(0, 24);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const parts = payload.includes('|') ? payload.split('|') : payload.split('.');
  const jobId = parts.shift();
  const expStr = parts.pop();
  const filename = parts.length ? safeMotionSourceFilename(parts.join(payload.includes('|') ? '|' : '.')) : 'motion-source.jpg';
  const exp = Number(expStr);
  if (!jobId || !Number.isFinite(exp) || Date.now() > exp) return null;
  return { jobId, filename, exp };
}

function resolvePublicMotionFileUrl(job, filename = 'motion-source.jpg') {
  const token = signMotionSourceToken(job.id, filename);
  const path = `/api/motion/source/${token}`;
  if (PUBLIC_BASE_URL) return `${PUBLIC_BASE_URL}${path}`;
  // 兜底：本地无公网时尝试拼 localhost（n1n 大概率拉不到，仅供本地调试日志）
  return `http://127.0.0.1:${PORT}${path}`;
}

function resolvePublicSourceUrl(job) {
  return resolvePublicMotionFileUrl(job, 'motion-source.jpg');
}

async function ensureMotionPublicReferencesReachable(urls = [], job = null) {
  if (!MOTION_VIDEO_IS_N1N_UNIFIED) return;
  const referenceUrls = urls.filter(Boolean).slice(0, motionReferenceLimitForModel());
  if (!referenceUrls.length) {
    throw new Error('Motion reference image public URL was not generated. Check PUBLIC_BASE_URL.');
  }
  for (const [index, url] of referenceUrls.entries()) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'image/*,*/*;q=0.8' },
        signal: AbortSignal.timeout(15_000),
      });
      const contentType = response.headers.get('content-type') || '';
      const contentLength = Number(response.headers.get('content-length') || 0);
      if (!response.ok || /text\/html/i.test(contentType)) {
        throw new Error(`HTTP ${response.status}${contentType ? ` ${contentType}` : ''}`);
      }
      if (contentLength > 0 && contentLength < 1024) {
        throw new Error(`image response too small (${contentLength} bytes)`);
      }
    } catch (error) {
      throw new Error(`Motion reference image ${index + 1} is not publicly reachable: ${url}; ${error?.message || error}`);
    }
  }
  job?.logs?.push(`[motion] PUBLIC_BASE_URL image check passed for ${referenceUrls.length} video reference(s)`);
}

let motionVideoServicePreflight = { checkedAt: 0, ok: false, status: 0, message: '' };

function motionVideoPreflightError(message, status = 503) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function motionVideoModelsEndpoint() {
  if (MOTION_VIDEO_IS_XIAOJI) {
    return MOTION_VIDEO_ENDPOINT.replace(/\/videos\/?$/i, '/models');
  }
  return '';
}

async function assertMotionVideoServiceReady() {
  if (USE_MOCK_MOTION_VIDEO || !MOTION_VIDEO_IS_XIAOJI) return;
  if (!HAS_MOTION_VIDEO_KEY) {
    throw motionVideoPreflightError('视频接口暂不可用：未配置视频 API Key，请联系管理员处理');
  }

  const now = Date.now();
  if (motionVideoServicePreflight.checkedAt
    && now - motionVideoServicePreflight.checkedAt < MOTION_VIDEO_PREFLIGHT_TTL_MS) {
    if (motionVideoServicePreflight.ok) return;
    throw motionVideoPreflightError(motionVideoServicePreflight.message || '视频接口暂不可用，请联系管理员处理', motionVideoServicePreflight.status || 503);
  }

  const endpoint = motionVideoModelsEndpoint();
  if (!endpoint) return;
  try {
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${MOTION_VIDEO_API_KEY}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch {}
    if (!response.ok) {
      const upstreamMessage = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
      const message = /disabled|invalid_api_key|白名单|quota|余额|insufficient/i.test(String(upstreamMessage))
        ? `视频接口暂不可用：${upstreamMessage}，请联系管理员处理`
        : `视频接口暂不可用：上游返回 ${response.status}，请稍后重试`;
      motionVideoServicePreflight = {
        checkedAt: now,
        ok: false,
        status: response.status === 401 || response.status === 403 || response.status === 402 ? 503 : 502,
        message,
      };
      throw motionVideoPreflightError(message, motionVideoServicePreflight.status);
    }
    motionVideoServicePreflight = { checkedAt: now, ok: true, status: response.status, message: '' };
  } catch (error) {
    if (error?.status) throw error;
    const message = `视频接口暂不可用：预检失败（${error?.message || error}），请稍后重试`;
    motionVideoServicePreflight = { checkedAt: now, ok: false, status: 503, message };
    throw motionVideoPreflightError(message, 503);
  }
}

async function imageBufferToMotionGuardPart(buffer, label) {
  const image = await sharp(buffer)
    .rotate()
    .resize(COPY_VISION_MAX_EDGE, COPY_VISION_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: COPY_VISION_IMAGE_QUALITY })
    .toBuffer();
  return [
    { type: 'text', text: label },
    {
      type: 'image_url',
      image_url: {
        url: `data:image/jpeg;base64,${image.toString('base64')}`,
        detail: 'high',
      },
    },
  ];
}

function cleanMotionGuardPrompt(text = '') {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-z]*|```/gi, ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1800);
}

async function buildMotionReferenceGuardPrompt(job, sourceImages, styleKey) {
  if (!MOTION_REFERENCE_GUARD_ENABLED || !USE_COPY_API || sourceImages.length < 2) return '';

  try {
    const sequenceNames = sourceImages.map((_, index) => `Image ${index + 1}`);
    const finalName = sequenceNames[sequenceNames.length - 1] || 'the final image';
    const imageParts = [];
    for (const [index, buffer] of sourceImages.entries()) {
      const label = index === 0
        ? 'Image 1: opening establishing scene / first sequence target. Describe only what is truly visible.'
        : index === sourceImages.length - 1
        ? `Image ${index + 1}: required final uploaded scene / ending sequence target. Describe its actual viewpoint and subject only; do not call it a macro/detail unless it truly is one.`
        : `Image ${index + 1}: required middle scene / sequence target. Describe only what is truly visible.`;
      imageParts.push(...await imageBufferToMotionGuardPart(buffer, label));
    }

    const body = {
      model: MOTION_DIRECTOR_MODEL,
      temperature: 0.1,
      max_tokens: MOTION_REFERENCE_GUARD_MAX_TOKENS,
      messages: [
        {
          role: 'system',
          content: [
            'You write compact visual guardrails for image-to-video wedding generation.',
            'Only mention elements that are visibly supported by the uploaded images.',
            'Your output will be appended directly to a video prompt, so write in clear English instructions.',
            'Do not use markdown, JSON, headings, or explanations.',
          ].join(' '),
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                `Motion style: ${styleKey}. Analyze the references as ordered sequence targets for one empty wedding film.`,
                'Return one compact English prompt fragment, about 120-180 words.',
                `Include: the visible inventory for each image; the exact sequence order ${sequenceNames.join(' -> ')}; recommended optical transitions between them; a specific ban on common wedding hallucinations absent from all images.`,
                `For ${finalName}, describe the actual final scene exactly as uploaded. If it is an upward ceiling/crystal/floral installation view, require the ending to remain that view; do not turn it into a generic flower macro, bouquet or tabletop shot.`,
                'Important: if a stock wedding object is not clearly visible in any reference, explicitly forbid adding it. Common hallucinations include white Chiavari chair rows, foreground tent drapes, new arches, extra chandeliers, candelabra, candles, table settings, doors, windows, guests and signs.',
                'If uncertain, phrase it as "only if visible in the uploaded references".',
              ].join(' '),
            },
            ...imageParts,
          ],
        },
      ],
    };

    const response = await fetch(COPY_API_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(COPY_REQUEST_TIMEOUT_MS),
    });
    const raw = await response.text();
    let payload = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch {}
    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || raw || `HTTP ${response.status}`;
      throw new Error(String(message).replace(/\s+/g, ' ').slice(0, 240));
    }

    const content = payload?.choices?.[0]?.message?.content || payload?.output_text || payload?.content || '';
    const guard = cleanMotionGuardPrompt(content);
    if (!guard) return '';
    job.logs.push(`[motion-guard] 已生成 ${sourceImages.length} 图连续转场视觉清单约束`);
    return `ORDERED SEQUENCE VISUAL LOCK FROM THE UPLOADED REFERENCES (HIGH PRIORITY): ${guard}`;
  } catch (error) {
    job.logs.push(`[motion-guard] 连续转场视觉清单生成失败，使用基础约束：${error?.message || 'unknown error'}`);
    return '';
  }
}

async function submitMotionTask({ prompt, imageUrl, imageBuffer, imageBuffers = [], imageUrls = [], signal, job = null, requestModel = MOTION_VIDEO_REQUEST_MODEL }) {
  let body;
  let fallbackJsonBody = null;
  const referenceLimit = motionReferenceLimitForModel(requestModel);
  const referenceBuffers = imageBuffers.length ? imageBuffers.filter((buffer) => buffer?.length).slice(0, referenceLimit) : (imageBuffer?.length ? [imageBuffer] : []);
  const referenceUrls = (imageUrls.length ? imageUrls : [imageUrl]).filter(Boolean).slice(0, referenceLimit);
  const headers = {
    Authorization: `Bearer ${MOTION_VIDEO_API_KEY}`,
    Accept: 'application/json',
  };
  if (MOTION_VIDEO_IS_ALIBAILIAN) {
    body = {
      model: requestModel,
      input: { prompt, img_url: imageUrl },
      parameters: {
        resolution: String(MOTION_VIDEO_RESOLUTION || '720P').toUpperCase(),
        duration: MOTION_VIDEO_DURATION,
        prompt_extend: true,
      },
    };
  } else if (MOTION_VIDEO_IS_XIAOJI) {
    if (!referenceBuffers.length) {
      throw new Error('小鸡 Veo 接口需要上传参考图文件，当前任务缺少 motion-source.jpg');
    }
    const form = new FormData();
    form.append('model', requestModel);
    form.append('prompt', prompt);
    const videoSize = motionVideoPixelSize();
    form.append('size', videoSize);
    form.append('seconds', String(MOTION_VIDEO_DURATION || 8));
    if (MOTION_VIDEO_RESOLUTION) form.append('resolution', String(MOTION_VIDEO_RESOLUTION).toLowerCase());
    job?.logs?.push?.(`[motion] xiaoji submit size=${videoSize}`);
    referenceBuffers.forEach((buffer, index) => {
      const filename = index === 0 ? 'motion-source.jpg' : `motion-reference-${index + 1}.jpg`;
      form.append('input_reference[]', new Blob([buffer], { type: 'image/jpeg' }), filename);
    });
    const response = await fetch(MOTION_VIDEO_ENDPOINT, {
      method: 'POST',
      headers,
      signal,
      body: form,
    });
    if (!response.ok) {
      const { contentType, text, payload } = await readUpstreamResponse(response);
      throw new Error(summarizeMotionApiError({
        context: '鎻愪氦瑙嗛浠诲姟',
        status: response.status,
        contentType,
        text,
        payload,
      }));
    }
    const { taskId } = await readMotionSubmitResponse(response, '鎻愪氦瑙嗛浠诲姟');
    return taskId;
  } else if (MOTION_VIDEO_IS_N1N_UNIFIED) {
    const sourceStyleVideoModel = /viduq/i.test(String(requestModel || ''));
    body = {
      model: requestModel,
      prompt,
      images: referenceUrls,
      duration: MOTION_VIDEO_DURATION,
      enhance_prompt: true,
      enable_upsample: true,
      aspect_ratio: MOTION_VIDEO_ASPECT_RATIO || '16:9',
    };
    if (sourceStyleVideoModel) {
      body.sources = referenceUrls;
      body.source = referenceUrls[0];
      body.seconds = MOTION_VIDEO_DURATION;
    }
  } else if (MOTION_VIDEO_IS_N1N_OPENAI) {
    if (!referenceBuffers.length) {
      throw new Error('n1n 视频接口需要上传参考图文件，当前任务缺少 motion-source.jpg');
    }
    const form = new FormData();
    form.append('model', requestModel);
    form.append('prompt', prompt);
    form.append('seconds', String(MOTION_VIDEO_DURATION || 8));
    form.append('size', MOTION_VIDEO_ASPECT_RATIO || '16x9');
    form.append('watermark', false);
    referenceBuffers.forEach((buffer, index) => {
      const filename = index === 0 ? 'motion-source.jpg' : `motion-reference-${index + 1}.jpg`;
      form.append('input_reference', new Blob([buffer], { type: 'image/jpeg' }), filename);
    });
    body = form;
    const referenceDataUrls = referenceBuffers.map((buffer) => `data:image/jpeg;base64,${buffer.toString('base64')}`);
    fallbackJsonBody = {
      model: requestModel,
      prompt,
      seconds: String(MOTION_VIDEO_DURATION || 8),
      size: MOTION_VIDEO_ASPECT_RATIO || '16x9',
      watermark: false,
      image: referenceDataUrls[0] || imageUrl,
      images: referenceDataUrls.length ? referenceDataUrls : [imageUrl],
      input_reference: referenceDataUrls[0] || imageUrl,
    };
  } else {
    body = {
      model: requestModel,
      prompt,
      image: imageUrl,
    };
  }
  if (!(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const response = await fetch(MOTION_VIDEO_ENDPOINT, {
    method: 'POST',
    headers,
    body,
    signal,
  });
  if (!response.ok) {
    const { contentType, text, payload } = await readUpstreamResponse(response);
    if (fallbackJsonBody && textLooksLikeCloudflareBlock(text)) {
      if (job?.logs) {
        job.logs.push('[motion] input_reference 文件上传被 n1n/WAF 拦截，自动退回 URL 参考图模式');
      }
      const fallbackResponse = await fetch(MOTION_VIDEO_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${MOTION_VIDEO_API_KEY}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(fallbackJsonBody),
        signal,
      });
      if (!fallbackResponse.ok) {
        const fallbackError = await readUpstreamResponse(fallbackResponse);
        throw new Error(summarizeMotionApiError({
          context: '提交视频任务（参考图文件上传与 URL 兜底均失败）',
          status: fallbackResponse.status,
          contentType: fallbackError.contentType,
          text: fallbackError.text,
          payload: fallbackError.payload,
        }));
      }
      const fallbackData = await readMotionSubmitResponse(fallbackResponse, '提交视频任务（URL 兜底）');
      if (job?.logs) {
        job.logs.push('[motion] JSON data-url 多参考图兜底提交成功');
      }
      return fallbackData.taskId;
    }
    throw new Error(summarizeMotionApiError({
      context: '提交视频任务',
      status: response.status,
      contentType,
      text,
      payload,
    }));
  }
  const { taskId } = await readMotionSubmitResponse(response, '提交视频任务');
  return taskId;
}

function shouldTryNextMotionModelError(error) {
  const message = String(error?.message || error || '');
  return /HTTP 402|HTTP 429|HTTP 500|HTTP 503|no available|no sources|input json is empty|syntax error|unavailable|temporar|overload|capacity|distributor|no route|no channel|channel.*available|model.*not.*available|model.*unsupported|model.*disabled|invalid model|insufficient|not enough|balance|credit|quota|billing|payment|余额|额度|点数|计费|欠费|无可用渠道|渠道不可用|模型.*不可用|模型.*不支持/i
    .test(message);
}

async function submitMotionTaskWithFallback(args) {
  const models = MOTION_VIDEO_SUBMIT_MODELS.length ? MOTION_VIDEO_SUBMIT_MODELS : [MOTION_VIDEO_REQUEST_MODEL];
  let lastError = null;

  for (let index = 0; index < models.length; index += 1) {
    const requestModel = models[index];
    args.job?.logs?.push(index === 0
      ? `[motion] submitting video model: ${requestModel}`
      : `[motion] retrying fallback video model: ${requestModel}`);

    try {
      const taskId = await submitMotionTask({ ...args, requestModel });
      if (index > 0) args.job?.logs?.push(`[motion] fallback model accepted: ${requestModel}`);
      return taskId;
    } catch (error) {
      if (isJobCancelledError(error)) throw error;
      lastError = error;
      console.warn('[motion-submit-error] job=' + (args.job?.id || '') + ' model=' + requestModel + ' ' + String(error.message || error).replace(/\s+/g, ' ').slice(0, 800));
      const canTryNext = index < models.length - 1 && shouldTryNextMotionModelError(error);
      if (!canTryNext) throw error;
      args.job?.logs?.push(`[motion] model ${requestModel} unavailable, trying next fallback: ${String(error.message || error).slice(0, 180)}`);
    }
  }

  throw lastError || new Error('Submit video task failed');
}

async function readMotionSubmitResponse(response, context) {
  const { contentType, text, payload: data } = await readUpstreamResponse(response);
  if (!data) {
    throw new Error(summarizeMotionApiError({
      context,
      status: response.status,
      contentType,
      text,
      payload: null,
    }));
  }
  const taskId = MOTION_VIDEO_IS_ALIBAILIAN
    ? (data?.output?.task_id || data?.task_id || data?.id)
    : (data?.task_id || data?.id || data?.data?.task_id || data?.data?.id || data?.output?.task_id);
  if (!taskId) {
    throw new Error('提交视频任务失败：响应缺少任务 id');
  }
  return { taskId, data };
}

function multipartBuffer({ fields = {}, files = [] }) {
  const boundary = `----wedscene-${Date.now().toString(36)}-${randomBytes(8).toString('hex')}`;
  const chunks = [];
  const pushText = (text) => chunks.push(Buffer.from(text, 'utf8'));

  Object.entries(fields).forEach(([name, value]) => {
    pushText(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${String(value ?? '')}\r\n`);
  });

  files.forEach((file) => {
    pushText(`--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType || 'application/octet-stream'}\r\n\r\n`);
    chunks.push(Buffer.from(file.buffer));
    pushText('\r\n');
  });

  pushText(`--${boundary}--\r\n`);
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function postMultipartDirect(url, { fields, files, headers = {}, signal = null }) {
  const target = new URL(url);
  if (target.protocol !== 'https:') throw new Error(`Unsupported direct video endpoint protocol: ${target.protocol}`);
  const { body, contentType } = multipartBuffer({ fields, files });

  return new Promise((resolve, reject) => {
    const req = httpsRequest({
      method: 'POST',
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      headers: {
        ...headers,
        'Content-Type': contentType,
        'Content-Length': body.length,
      },
      signal,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode || 0,
          headers: {
            get(name) {
              const value = res.headers[String(name || '').toLowerCase()];
              return Array.isArray(value) ? value.join(', ') : (value || '');
            },
          },
          text: async () => text,
        });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function getDirect(url, { headers = {}, signal = null } = {}) {
  const target = new URL(url);
  if (target.protocol !== 'https:') throw new Error(`Unsupported direct video endpoint protocol: ${target.protocol}`);

  return new Promise((resolve, reject) => {
    const req = httpsRequest({
      method: 'GET',
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      headers,
      signal,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode || 0,
          headers: {
            get(name) {
              const value = res.headers[String(name || '').toLowerCase()];
              return Array.isArray(value) ? value.join(', ') : (value || '');
            },
          },
          text: async () => text,
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function queryMotionTask(taskId, signal) {
  const baseUrl = MOTION_VIDEO_IS_ALIBAILIAN ? MOTION_VIDEO_TASK_QUERY_BASE : MOTION_VIDEO_ENDPOINT;
  const url = MOTION_VIDEO_IS_N1N_UNIFIED
    ? `${MOTION_VIDEO_TASK_QUERY_BASE}?id=${encodeURIComponent(taskId)}`
    : `${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(taskId)}`;
  const headers = { Authorization: `Bearer ${MOTION_VIDEO_API_KEY}`, Accept: 'application/json' };
  const response = MOTION_VIDEO_IS_XIAOJI
    ? await getDirect(url, { headers, signal })
    : await fetch(url, { headers, signal });
  if (!response.ok) {
    const { contentType, text, payload } = await readUpstreamResponse(response);
    throw new Error(summarizeMotionApiError({
      context: '查询视频任务',
      status: response.status,
      contentType,
      text,
      payload,
    }));
  }
  const { contentType, text, payload } = await readUpstreamResponse(response);
  if (!payload) {
    throw new Error(summarizeMotionApiError({
      context: '查询视频任务',
      status: response.status,
      contentType,
      text,
      payload: null,
    }));
  }
  return payload;
}

function resolveN1nMotionContentUrl(taskId) {
  return `${MOTION_VIDEO_ENDPOINT.replace(/\/$/, '')}/${encodeURIComponent(taskId)}/content`;
}

function parseMotionTaskInfo(info, taskId) {
  const rawStatus = MOTION_VIDEO_IS_ALIBAILIAN
    ? (info?.output?.task_status || info?.task_status || info?.status)
    : info?.status;
  const status = String(rawStatus || '').toLowerCase();
  const progress = Number(info?.output?.progress ?? info?.progress) || 0;
  const videoUrl = (MOTION_VIDEO_IS_ALIBAILIAN ? info?.output?.video_url : null)
    || info?.video_url || info?.url || info?.result_url || info?.content?.video_url || info?.detail?.video_url
    || (MOTION_VIDEO_IS_N1N_OPENAI ? resolveN1nMotionContentUrl(taskId) : null);
  const completed = status === 'completed'
    || status === 'succeeded'
    || status === 'success'
    || status === 'partial_succeeded'
    || (!status && info?.video_url);
  const failed = status === 'failed'
    || status === 'error'
    || status === 'canceled'
    || info?.error
    || info?.output?.code;
  const errorMessage = info?.fail_reason
    || info?.output?.message
    || info?.error?.message
    || info?.message
    || 'video generation failed';
  return { status, progress, videoUrl, completed, failed, errorMessage };
}

async function pollMotionTask(job, taskId, options = {}) {
  const startedAt = Date.now();
  const timeoutMs = Number(options.timeoutMs || MOTION_VIDEO_POLL_TIMEOUT_MS);
  const stallMs = Number(options.stallMs || 0);
  const allowStallReturn = Boolean(options.allowStallReturn);
  let lastProgress = 0;
  while (true) {
    throwIfJobCancelled(job);
    const elapsedMs = Date.now() - startedAt;
    if (allowStallReturn && stallMs > 0 && elapsedMs > stallMs && lastProgress === 0) {
      return { stalled: true, taskId };
    }
    if (elapsedMs > timeoutMs) {
      throw new Error(`???????>${Math.round(timeoutMs / 1000)}s???????`);
    }
    let info;
    try {
      info = await queryMotionTask(taskId, signalForJob(job, 30_000));
    } catch (error) {
      if (isJobCancelledError(error)) throw error;
      job.logs.push(`[motion] ??????????${error.message || error}`);
      await new Promise((resolve) => setTimeout(resolve, MOTION_VIDEO_POLL_INTERVAL_MS));
      continue;
    }
    const { status, progress, videoUrl, completed, failed, errorMessage } = parseMotionTaskInfo(info, taskId);
    if (progress > lastProgress) {
      lastProgress = progress;
      const mappedProgress = 25 + Math.round((progress / 100) * 65);
      updateJob(job, mappedProgress, `??????${progress}%`, `[motion] ?? ${progress}% (status=${status})`);
    } else if (status === 'running' && lastProgress === 0) {
      lastProgress = 1;
      updateJob(job, 60, '?????', `[motion] status=${status}`);
    }
    if (completed) {
      if (!videoUrl) throw new Error('??????????????');
      return { videoUrl, raw: info, taskId };
    }
    if (failed) {
      throw new Error(`???????${errorMessage}`);
    }
    await new Promise((resolve) => setTimeout(resolve, MOTION_VIDEO_POLL_INTERVAL_MS));
  }
}

async function submitAndPollMotionTask(args) {
  const job = args.job;
  const startedAt = Date.now();
  const activeTasks = [];
  let attempts = 0;
  let lastSubmitAt = 0;
  let lastError = null;

  const submitNextTask = async (reason = '') => {
    let taskId = '';
    try {
      taskId = await submitMotionTaskWithFallback({
        ...args,
        signal: signalForJob(job, 60_000),
      });
    } catch (error) {
      lastError = error;
      lastSubmitAt = Date.now();
      job.logs.push(`[motion] submit retry deferred${reason ? ` (${reason})` : ''}: ${String(error?.message || error).slice(0, 180)}`);
      return null;
    }
    attempts += 1;
    const active = {
      taskId,
      submittedAt: Date.now(),
      lastProgress: 0,
      failed: false,
    };
    activeTasks.push(active);
    lastSubmitAt = active.submittedAt;
    job.motionTaskId = taskId;
    job.motionTaskIds = activeTasks.map((item) => item.taskId);
    const suffix = reason ? ` (${reason})` : '';
    updateJob(job, 35, '已提交上游视频任务，正在等待出片', `[motion] task submitted ${attempts}/${MOTION_VIDEO_MAX_SUBMIT_ATTEMPTS}${suffix}: task_id=${taskId}`);
    return active;
  };

  while (!activeTasks.length) {
    throwIfJobCancelled(job);
    if (MOTION_VIDEO_LOCAL_FALLBACK
      && MOTION_VIDEO_LOCAL_FALLBACK_AFTER_MS > 0
      && Date.now() - startedAt > MOTION_VIDEO_LOCAL_FALLBACK_AFTER_MS) {
      const error = new Error(`upstream submit did not produce a task after ${Math.round(MOTION_VIDEO_LOCAL_FALLBACK_AFTER_MS / 1000)}s${lastError ? `: ${lastError.message || lastError}` : ''}`);
      error.motionLocalFallback = true;
      throw error;
    }
    await submitNextTask();
    if (!activeTasks.length) {
      await new Promise((resolve) => setTimeout(resolve, MOTION_VIDEO_POLL_INTERVAL_MS));
    }
  }
  while (true) {
    throwIfJobCancelled(job);
    if (Date.now() - startedAt > MOTION_VIDEO_POLL_TIMEOUT_MS) {
      throw new Error(`视频生成超时（>${Math.round(MOTION_VIDEO_POLL_TIMEOUT_MS / 1000)}s），请稍后重试`);
    }

    for (const active of activeTasks) {
      if (active.failed) continue;
      let info;
      try {
        info = await queryMotionTask(active.taskId, signalForJob(job, 30_000));
      } catch (error) {
        if (isJobCancelledError(error)) throw error;
        lastError = error;
        job.logs.push(`[motion] query failed for ${active.taskId}: ${String(error?.message || error).slice(0, 180)}`);
        continue;
      }

      const parsed = parseMotionTaskInfo(info, active.taskId);
      if (parsed.progress > active.lastProgress) {
        active.lastProgress = parsed.progress;
        const mappedProgress = 25 + Math.round((parsed.progress / 100) * 65);
        updateJob(job, mappedProgress, `视频生成中：${parsed.progress}%`, `[motion] task ${active.taskId} progress ${parsed.progress}% (status=${parsed.status})`);
      }
      if (parsed.completed) {
        if (!parsed.videoUrl) throw new Error('视频任务完成但未返回视频地址');
        job.motionTaskId = active.taskId;
        return { videoUrl: parsed.videoUrl, raw: info, taskId: active.taskId };
      }
      if (parsed.failed) {
        active.failed = true;
        lastError = new Error(parsed.errorMessage);
        job.logs.push(`[motion] upstream task failed ${active.taskId}: ${String(parsed.errorMessage).slice(0, 180)}`);
      }
    }

    const anyLiveProgress = activeTasks.some((task) => !task.failed && task.lastProgress > 0);
    if (MOTION_VIDEO_LOCAL_FALLBACK
      && MOTION_VIDEO_LOCAL_FALLBACK_AFTER_MS > 0
      && !anyLiveProgress
      && Date.now() - startedAt > MOTION_VIDEO_LOCAL_FALLBACK_AFTER_MS) {
      const liveTasks = activeTasks.filter((task) => !task.failed).map((task) => task.taskId).join(', ');
      const reason = liveTasks
        ? `upstream task stayed at 0% after ${Math.round(MOTION_VIDEO_LOCAL_FALLBACK_AFTER_MS / 1000)}s (${liveTasks})`
        : `upstream submit did not produce progress after ${Math.round(MOTION_VIDEO_LOCAL_FALLBACK_AFTER_MS / 1000)}s`;
      const error = new Error(reason);
      error.motionLocalFallback = true;
      throw error;
    }
    const shouldRetryStall = MOTION_VIDEO_IS_XIAOJI
      && attempts < MOTION_VIDEO_MAX_SUBMIT_ATTEMPTS
      && !anyLiveProgress
      && Date.now() - lastSubmitAt > MOTION_VIDEO_STALL_RETRY_MS;
    if (shouldRetryStall) {
      await submitNextTask('previous task stayed at 0%');
    } else if (activeTasks.every((task) => task.failed)) {
      if (attempts < MOTION_VIDEO_MAX_SUBMIT_ATTEMPTS) {
        await submitNextTask('previous task failed');
      } else {
        throw lastError || new Error('video generation failed');
      }
    }

    await new Promise((resolve) => setTimeout(resolve, MOTION_VIDEO_POLL_INTERVAL_MS));
  }
}

async function downloadMotionVideo(videoUrl, destPath, signal, redirectDepth = 0) {
  const needsAuth = MOTION_VIDEO_IS_N1N_OPENAI && String(videoUrl).startsWith(MOTION_VIDEO_ENDPOINT.replace(/\/$/, ''));
  const response = await fetch(videoUrl, {
    signal,
    headers: needsAuth ? { Authorization: `Bearer ${MOTION_VIDEO_API_KEY}`, Accept: 'application/json, video/*;q=0.9, */*;q=0.8' } : undefined,
  });
  if (!response.ok) throw new Error(`下载视频失败：HTTP ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);
  if (!buf.length) throw new Error('下载视频失败：内容为空');
  const contentType = response.headers.get('content-type') || '';
  if (/text\/html/i.test(contentType) || textLooksLikeHtml(buf.toString('utf8', 0, Math.min(buf.length, 2000)))) {
    throw new Error(summarizeMotionApiError({
      context: '下载视频',
      status: response.status,
      contentType,
      text: buf.toString('utf8', 0, Math.min(buf.length, 2000)),
      payload: null,
    }));
  }
  if (/json/i.test(contentType)) {
    const data = JSON.parse(buf.toString('utf8'));
    const nestedUrl = data?.video_url || data?.url || data?.result_url || data?.content?.video_url;
    if (nestedUrl && redirectDepth < 3) {
      return downloadMotionVideo(nestedUrl, destPath, signal, redirectDepth + 1);
    }
    throw new Error(`下载视频失败：接口未返回可下载视频地址 ${JSON.stringify(data).slice(0, 200)}`);
  }
  await writeFile(destPath, buf);
  return buf.length;
}

async function downloadMotionVideoWithRetries(videoUrl, destPath, job) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    throwIfJobCancelled(job);
    if (attempt > 1) {
      const delayMs = 5000 * attempt;
      job?.logs?.push(`[motion] 视频下载重试 ${attempt}/3（等待 ${Math.round(delayMs / 1000)} 秒）`);
      await wait(delayMs);
    }
    try {
      return await downloadMotionVideo(videoUrl, destPath, signalForJob(job, MOTION_VIDEO_DOWNLOAD_TIMEOUT_MS));
    } catch (error) {
      if (isJobCancelledError(error)) throw error;
      lastError = error;
      const msg = String(error?.message || error);
      const retriable = /timeout|timed out|aborted|fetch failed|ECONNRESET|ETIMEDOUT|UND_ERR|socket|network/i.test(msg);
      if (!retriable || attempt === 3) throw error;
      job?.logs?.push(`[motion] 视频下载中断：${msg.slice(0, 160)}，准备重试`);
    }
  }
  throw lastError || new Error('视频下载失败');
}

// 用 ffmpeg -i 探测视频分辨率（ffmpeg 不带输出会 exit 1，但 stderr 含 "1920x1080" 信息）
async function probeVideoSize(videoPath) {
  try {
    await execFileAsync(FFMPEG_BIN, ['-hide_banner', '-i', videoPath], { maxBuffer: 4 * 1024 * 1024 });
    return null; // 正常不会到这
  } catch (error) {
    const text = String(error?.stderr || error?.message || '');
    const match = /(\d{2,5})x(\d{2,5})/.exec(text);
    if (match) return { width: Number(match[1]), height: Number(match[2]) };
    return null;
  }
}

// 解析 `W-220:H-90:200:70` 这种表达式 → 用实际宽高替换 W/H 并算出纯数字
function resolveWatermarkBox(template, size) {
  if (!size) return template;
  return template.split(':').map((seg) => {
    const replaced = seg
      .replace(/\bW\b/g, String(size.width))
      .replace(/\bH\b/g, String(size.height));
    // 含 + - * / 的纯数学表达式 → 算出结果（ffmpeg 6 的 delogo 不支持表达式，要纯数字）
    if (/^[0-9+\-*/\s().]+$/.test(replaced) && /[+\-*/]/.test(replaced)) {
      try {
        const val = Function(`"use strict";return (${replaced})`)();
        if (Number.isFinite(val)) return String(Math.round(val));
      } catch { /* fallthrough */ }
    }
    return replaced;
  }).join(':');
}

// 用 ffmpeg delogo 滤镜抹掉右下角水印。失败不阻断主流程，在日志里警告。
async function removeMotionWatermark(videoPath, job) {
  if (!MOTION_WATERMARK_REMOVE) return false;
  const tmpPath = videoPath.replace(/\.mp4$/i, '') + '.cleaned.mp4';
  const debug = String(process.env.MOTION_WATERMARK_DEBUG ?? 'false').toLowerCase() === 'true';
  // 先探测视频尺寸，再把 W/H 表达式算成纯数字（ffmpeg 6 的 delogo 不接受表达式）
  const size = await probeVideoSize(videoPath);
  const resolvedBox = resolveWatermarkBox(MOTION_WATERMARK_BOX, size);
  // delogo 在 ffmpeg 6 已去掉 band 选项，可用 show=1 画绿框调试位置
  const filter = debug ? `delogo=${resolvedBox}:show=1` : `delogo=${resolvedBox}`;
  const args = [
    '-y',
    '-loglevel', 'warning',
    '-i', videoPath,
    '-vf', filter,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-c:a', 'copy',
    '-movflags', '+faststart',
    tmpPath,
  ];
  console.log(`[motion] video size=${size ? `${size.width}x${size.height}` : 'unknown'}, box=${resolvedBox}`);
  console.log(`[motion] ffmpeg cmd: ${FFMPEG_BIN} ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`);
  try {
    const { stderr } = await execFileAsync(FFMPEG_BIN, args, { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
    if (stderr && stderr.trim()) {
      console.log(`[motion] ffmpeg stderr (first 500):\n${stderr.slice(0, 500)}`);
    }
  } catch (error) {
    const stderr = error?.stderr ? `\n--- ffmpeg stderr ---\n${String(error.stderr).slice(0, 1000)}` : '';
    const msg = `${error?.message || error}${stderr}`;
    console.warn(`[motion] ffmpeg 去水印失败：${msg}`);
    if (job?.logs) job.logs.push(`[motion] ⚠ ffmpeg 去水印失败，保留原视频：${error?.message || error}`);
    return false;
  }
  // 覆盖原文件
  try {
    await rm(videoPath, { force: true });
    await copyFile(tmpPath, videoPath);
    await rm(tmpPath, { force: true });
  } catch (error) {
    if (job?.logs) job.logs.push(`[motion] ⚠ ffmpeg 产出覆盖失败：${error?.message || error}`);
    return false;
  }
  return true;
}

async function optimizeMotionVideoForWeb(videoPath, job) {
  if (!MOTION_VIDEO_WEB_OPTIMIZE) return false;
  if (!existsSync(videoPath)) return false;

  const before = statSync(videoPath).size;
  const tmpPath = videoPath.replace(/\.mp4$/i, '') + '.web.mp4';
  const maxWidth = Number.isFinite(MOTION_VIDEO_WEB_MAX_WIDTH) && MOTION_VIDEO_WEB_MAX_WIDTH > 0
    ? Math.round(MOTION_VIDEO_WEB_MAX_WIDTH)
    : 1280;
  const crf = Number.isFinite(MOTION_VIDEO_WEB_CRF) ? String(MOTION_VIDEO_WEB_CRF) : '25';
  const args = [
    '-y',
    '-loglevel', 'warning',
    '-i', videoPath,
    '-map', '0:v:0',
    '-map', '0:a?',
    '-vf', `scale=w='min(${maxWidth},iw)':h=-2`,
    '-c:v', 'libx264',
    '-preset', MOTION_VIDEO_WEB_PRESET,
    '-crf', crf,
    '-maxrate', MOTION_VIDEO_WEB_MAXRATE,
    '-bufsize', MOTION_VIDEO_WEB_BUFSIZE,
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-c:a', 'aac',
    '-b:a', MOTION_VIDEO_WEB_AUDIO_BITRATE,
    tmpPath,
  ];

  try {
    await execFileAsync(FFMPEG_BIN, args, { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
    if (!existsSync(tmpPath)) throw new Error('ffmpeg 未生成优化文件');
    const after = statSync(tmpPath).size;
    if (!after) throw new Error('优化后视频为空');
    if (after > before * 1.1) {
      await rm(tmpPath, { force: true });
      job?.logs?.push(`[motion] 网页播放优化跳过：优化后文件更大（${formatByteSize(before)} → ${formatByteSize(after)}）`);
      return false;
    }
    await rm(videoPath, { force: true });
    await copyFile(tmpPath, videoPath);
    await rm(tmpPath, { force: true });
    job?.logs?.push(`[motion] 已优化网页播放 MP4：${formatByteSize(before)} → ${formatByteSize(after)}`);
    return true;
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => {});
    job?.logs?.push(`[motion] ⚠ 视频网页优化失败，保留原视频：${error?.message || error}`);
    return false;
  }
}

async function assertMotionVideoHasVisibleFrame(videoPath, job) {
  if (!existsSync(videoPath)) throw new Error('视频文件不存在');
  const probeTimes = [0.2, 1.5, Math.max(2.5, Math.min(4, Number(MOTION_VIDEO_DURATION || 8) / 2))];
  let bestLuma = 0;
  let bestMax = 0;
  let lastError = null;

  for (let index = 0; index < probeTimes.length; index += 1) {
    const framePath = videoPath.replace(/\.mp4$/i, `.probe-${index}.jpg`);
    try {
      await execFileAsync(FFMPEG_BIN, [
        '-y',
        '-loglevel', 'warning',
        '-ss', String(probeTimes[index]),
        '-i', videoPath,
        '-frames:v', '1',
        '-q:v', '3',
        framePath,
      ], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
      if (!existsSync(framePath) || statSync(framePath).size < 1024) continue;
      const stats = await sharp(framePath).stats();
      const [r, g, b] = stats.channels;
      const luma = (0.2126 * (r?.mean || 0)) + (0.7152 * (g?.mean || 0)) + (0.0722 * (b?.mean || 0));
      const maxChannel = Math.max(r?.max || 0, g?.max || 0, b?.max || 0);
      bestLuma = Math.max(bestLuma, luma);
      bestMax = Math.max(bestMax, maxChannel);
      if (luma >= 12 || maxChannel >= 48) {
        job?.logs?.push(`[motion] 视频首帧可见性校验通过：亮度 ${Math.round(luma)}`);
        await rm(framePath, { force: true }).catch(() => {});
        return true;
      }
    } catch (error) {
      lastError = error;
    } finally {
      await rm(framePath, { force: true }).catch(() => {});
    }
  }

  const suffix = lastError ? `；抽帧错误：${lastError?.message || lastError}` : '';
  throw new Error(`视频画面校验失败：检测到疑似黑屏（亮度 ${Math.round(bestLuma)}，max ${Math.round(bestMax)}）${suffix}`);
}

function localMotionZoomForStyle(styleKey) {
  if (styleKey === 'pull_back') return { start: 1.14, end: 1.02, xPan: 0, yPan: 0 };
  if (styleKey === 'micro_orbit') return { start: 1.04, end: 1.12, xPan: 0.045, yPan: 0.012 };
  if (styleKey === 'gentle_push_in') return { start: 1.02, end: 1.10, xPan: 0.012, yPan: 0 };
  return { start: 1.0, end: 1.16, xPan: 0, yPan: 0 };
}

async function generateLocalMotionVideoFromImage(sourceImagePath, destPath, job, styleKey) {
  const duration = Math.max(1, Number(MOTION_VIDEO_DURATION || 8));
  const fps = 30;
  const frames = Math.max(fps, Math.round(duration * fps));
  const { start, end, xPan, yPan } = localMotionZoomForStyle(styleKey);
  const zoomDelta = end - start;
  const eased = `((1-cos(PI*on/${Math.max(1, frames - 1)}))/2)`;
  const zoom = `${start.toFixed(4)}+${zoomDelta.toFixed(4)}*${eased}`;
  const x = `iw/2-(iw/${zoom})/2+${xPan.toFixed(4)}*iw*sin(2*PI*on/${frames})`;
  const y = `ih/2-(ih/${zoom})/2+${yPan.toFixed(4)}*ih*sin(PI*on/${frames})`;
  const filters = [
    `scale=1536:864:force_original_aspect_ratio=increase`,
    `crop=1536:864`,
    `zoompan=z='${zoom}':x='${x}':y='${y}':d=${frames}:s=1280x720:fps=${fps}`,
    'format=yuv420p',
  ].join(',');
  const args = [
    '-y',
    '-loglevel', 'warning',
    '-loop', '1',
    '-framerate', String(fps),
    '-i', sourceImagePath,
    '-vf', filters,
    '-t', String(duration),
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '22',
    '-movflags', '+faststart',
    destPath,
  ];

  try {
    await execFileAsync(FFMPEG_BIN, args, { timeout: Math.max(60_000, duration * 20_000), maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    const stderr = error?.stderr ? ` ${String(error.stderr).replace(/\s+/g, ' ').slice(0, 500)}` : '';
    throw new Error(`local motion ffmpeg failed: ${error?.message || error}${stderr}`);
  }
  if (!existsSync(destPath) || statSync(destPath).size < 1024) {
    throw new Error('local motion ffmpeg did not create a usable mp4');
  }
  job?.logs?.push(`[motion-local] 已生成本地快速运镜 MP4：${formatByteSize(statSync(destPath).size)}`);
  return statSync(destPath).size;
}

async function generateMotionVideoMock(job, outputDir) {
  updateJob(job, 20, '演示模式：分析图片', '[motion] 演示模式：本地无公网，使用预生成的 demo 视频代替');
  await new Promise((r) => setTimeout(r, 800));
  updateJob(job, 50, '演示模式：模拟提交任务到模型', '[motion] 模拟提交视频生成任务');
  await new Promise((r) => setTimeout(r, 1500));
  updateJob(job, 80, '演示模式：模拟模型生成中', '[motion] 模拟模型渲染（实际部署到公网后会调真实接口）');
  await new Promise((r) => setTimeout(r, 1200));

  const filename = 'motion.mp4';
  const dest = path.join(outputDir, filename);
  const demoSource = path.join(__dirname, 'assets', 'motion-demo.mp4');
  if (existsSync(demoSource)) {
    await copyFile(demoSource, dest);
    job.logs.push('[motion] 演示模式：已复用 assets/motion-demo.mp4');
  } else {
    await writeFile(dest, Buffer.alloc(0));
    job.logs.push('[motion] ⚠ 缺少 assets/motion-demo.mp4，写入了空占位');
  }
  updateJob(job, 100, '演示模式生成完成', '[motion] 演示模式完成，视频已保存到资源库');
  return { videoFilename: filename, mock: true, durationSeconds: 8 };
}

async function generateMotionVideo(job, outputDir) {
  const styleKey = normalizeMotionStyleKey(job.motionStyle);
  const style = MOTION_STYLES[styleKey];
  job.motionStyle = styleKey;

  if (USE_MOCK_MOTION_VIDEO) {
    return generateMotionVideoMock(job, outputDir);
  }

  // 1. 优化输入图为 source.jpg（视频生成专用副本，最大边 MOTION_VIDEO_REFERENCE_MAX_EDGE）
  const reference = job.reference;
  if (!reference?.buffer) throw new Error('视频任务缺少参考图，请重新上传');
  updateJob(job, 22, `应用单图运镜方案`, `[motion] 单图运镜 | ${style.label}`);

  const motionReferenceLimit = motionReferenceLimitForModel(MOTION_VIDEO_REQUEST_MODEL);
  const motionReferences = (job.motionReferences?.length ? job.motionReferences : [reference]).slice(0, motionReferenceLimit);
  const sourceImages = await Promise.all(motionReferences.map((item) => sharp(item.buffer)
    .rotate()
    .resize(MOTION_VIDEO_REFERENCE_MAX_EDGE, MOTION_VIDEO_REFERENCE_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: MOTION_VIDEO_REFERENCE_QUALITY })
    .toBuffer()));
  const sourceImage = sourceImages[0];
  await writeFile(path.join(outputDir, 'motion-source.jpg'), sourceImage);
  for (let index = 1; index < sourceImages.length; index += 1) {
    await writeFile(path.join(outputDir, `motion-reference-${index + 1}.jpg`), sourceImages[index]);
  }
  job.logs.push(`[motion] 视频源图已优化为 ${Math.round(sourceImage.length / 1024)}KB`);
  if (sourceImages.length > 1) {
    job.logs.push(`[motion] 已附加 ${sourceImages.length - 1} 张额外参考图`);
  }

  // 2. 拼公开 URL（带签名 token）
  const imageUrl = resolvePublicSourceUrl(job);
  const motionImageUrls = sourceImages.map((_, index) => resolvePublicMotionFileUrl(
    job,
    index === 0 ? 'motion-source.jpg' : `motion-reference-${index + 1}.jpg`,
  ));
  if (!PUBLIC_BASE_URL) {
    job.logs.push('[motion] ⚠ 未配置 PUBLIC_BASE_URL，URL 模式视频接口可能无法拉到本地图片，请配置公网域名或内网穿透');
  } else {
    job.logs.push(`[motion] 公开图片 URL：${imageUrl}`);
  }
  if (MOTION_VIDEO_REQUEST_MODEL !== MOTION_VIDEO_MODEL) {
    job.logs.push(`[motion] 视频模型名按当前接口映射：${MOTION_VIDEO_MODEL} → ${MOTION_VIDEO_REQUEST_MODEL}`);
  }
  if (MOTION_VIDEO_IS_N1N_OPENAI) {
    job.logs.push('[motion] n1n 视频接口使用 multipart input_reference 文件模式提交参考图');
    if (/4k/i.test(String(MOTION_VIDEO_RESOLUTION || '')) && !/4k/i.test(String(MOTION_VIDEO_REQUEST_MODEL || ''))) {
      job.logs.push('[motion] ⚠ n1n OpenAI 视频格式当前默认 720P；4K 不会通过 MOTION_VIDEO_RESOLUTION 生效');
    }
  } else if (MOTION_VIDEO_IS_N1N_UNIFIED) {
    job.logs.push('[motion] n1n 视频接口使用 JSON 公网图片 URL 模式提交参考图');
    if (/4k/i.test(String(MOTION_VIDEO_RESOLUTION || ''))) {
      job.logs.push('[motion] ⚠ n1n Veo 统一格式通常默认 720P，enable_upsample 仅尽量提升清晰度');
    }
    await ensureMotionPublicReferencesReachable(motionImageUrls, job);
  } else if (MOTION_VIDEO_IS_XIAOJI) {
    job.logs.push(`[motion] 小鸡 Veo 视频接口使用 multipart input_reference 文件模式提交 ${motionReferenceLimit} 张以内参考图`);
  }
  job.logs.push(sourceImages.length >= 3
    ? '[motion] 已启用多图运镜方案'
    : sourceImages.length === 2
      ? '[motion] 已启用双图运镜方案'
      : '[motion] 已启用单图运镜方案：以图 1 作为主体画面生成镜头运动');

  // 3. 提交任务
  updateJob(job, 25, '正在提交视频生成任务到 AI', '[motion] POST 视频任务');
  let prompt = '';
  try {
    prompt = await buildMotionDirectorPrompt({
      sourceImages,
      endpoint: COPY_API_ENDPOINT,
      apiKey: OPENAI_API_KEY,
      model: MOTION_DIRECTOR_MODEL,
      durationSeconds: MOTION_VIDEO_DURATION,
      maxReferences: motionReferenceLimit,
      timeoutMs: MOTION_DIRECTOR_PROMPT_TIMEOUT_MS,
      maxTokens: MOTION_DIRECTOR_PROMPT_MAX_TOKENS,
      visionMaxEdge: COPY_VISION_MAX_EDGE,
      visionImageQuality: COPY_VISION_IMAGE_QUALITY,
    });
    prompt = finalizeMotionPrompt(prompt, styleKey, sourceImages.length);
    job.logs.push(`[motion-director] Gemini 已生成单图运镜短提示词：${MOTION_DIRECTOR_MODEL}`);
  } catch (error) {
    prompt = finalizeMotionPrompt(buildFallbackMotionPrompt(styleKey, sourceImages.length), styleKey, sourceImages.length);
    job.logs.push(`[motion-director] Gemini prompt failed, using built-in motion prompt fallback: ${error?.message || 'unknown error'}`);
  }
  await writeFile(path.join(outputDir, 'motion-prompt.txt'), `${prompt}\n`, 'utf8');
  job.logs.push('[motion] 已保存本次视频提示词快照 motion-prompt.txt');
  // 5. 下载到本地
  const filename = 'motion.mp4';
  const dest = path.join(outputDir, filename);
  let raw = null;
  let taskId = '';
  let usedLocalFallback = false;
  try {
    const motionTask = await submitAndPollMotionTask({
      prompt,
      imageUrl,
      imageBuffer: sourceImage,
      imageBuffers: sourceImages,
      imageUrls: motionImageUrls,
      job,
    });
    const { videoUrl } = motionTask;
    raw = motionTask.raw;
    taskId = motionTask.taskId;
    job.logs.push(`[motion] task completed, preparing mp4 download: task_id=${taskId}`);
    updateJob(job, 92, '正在下载视频', '[motion] download mp4');
    const size = await downloadMotionVideoWithRetries(videoUrl, dest, job);
    job.logs.push(`[motion] 视频已保存：${Math.round(size / 1024)}KB`);
  } catch (error) {
    if (isJobCancelledError(error)) throw error;
    if (!MOTION_VIDEO_LOCAL_FALLBACK) throw error;
    usedLocalFallback = true;
    job.logs.push(`[motion-local] 上游视频暂不可用，切换本地运镜生成：${String(error?.message || error).slice(0, 180)}`);
    updateJob(job, 88, '上游繁忙，正在本地生成运镜视频', '[motion-local] ffmpeg image-to-video fallback');
    await generateLocalMotionVideoFromImage(path.join(outputDir, 'motion-source.jpg'), dest, job, styleKey);
  }

  // 6. ffmpeg 去水印（右下角 logo）
  if (MOTION_WATERMARK_REMOVE) {
    updateJob(job, 96, '清除视频水印中', '[motion] ffmpeg delogo 去水印');
    const cleaned = await removeMotionWatermark(dest, job);
    if (cleaned) job.logs.push('[motion] 水印已去除');
  }

  updateJob(job, 98, '优化视频播放中', '[motion] ffmpeg web mp4 optimize');
  await optimizeMotionVideoForWeb(dest, job);
  await assertMotionVideoHasVisibleFrame(dest, job);

  return {
    videoFilename: filename,
    durationSeconds: MOTION_VIDEO_DURATION,
    resolution: MOTION_VIDEO_RESOLUTION,
    style: styleKey,
    styleLabel: style.label,
    mock: false,
    localFallback: usedLocalFallback,
    rawTaskInfo: { id: raw?.id || taskId, completed_at: raw?.completed_at },
  };
}

async function createCollage(job, outputDir, images) {
  if (job.mode === 'cinematic_storyboard') {
    return createStoryboardBoard(job, outputDir, images);
  }
  if (job.mode === 'setup_comparison') {
    return createSetupComparisonBoard(job, outputDir, images);
  }
  if (job.mode === 'design_render_scene') {
    updateJob(job, 88, '现场候选图已生成', '[compose] 设计图转实景模式跳过合成图，保留 4 张真实现场候选图');
    return '';
  }
  if (job.mode === 'venue_fusion') {
    updateJob(job, 88, '空地婚礼融合图已生成', '[compose] 空地婚礼融合模式跳过拼图，保留 1 张融合效果图');
    return '';
  }

  updateJob(job, 88, '正在拼接爆款首图', '[compose] 裁切 6 张图并生成爆款图文首图');

  const canvasWidth = 1080;
  const canvasHeight = 1440;
  const pad = 28;
  const gap = 20;
  const cellW = Math.round((canvasWidth - pad * 2 - gap) / 2);
  const cellH = Math.round((canvasHeight - pad * 2 - gap * 2) / 3);

  const composites = await Promise.all(images.map(async (image, index) => {
    const input = path.join(outputDir, image.filename);
    const buffer = await sharp(input)
      .resize(cellW, cellH, { fit: 'cover' })
      .jpeg({ quality: 90 })
      .toBuffer();
    return {
      input: buffer,
      left: pad + (index % 2) * (cellW + gap),
      top: pad + Math.floor(index / 2) * (cellH + gap),
    };
  }));

  const filename = 'viral-cover.jpg';
  await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 3,
      background: '#f6ded5',
    },
  })
    .composite(composites)
    .jpeg({ quality: 92 })
    .toFile(path.join(outputDir, filename));

  return publicUrl(job.id, filename);
}

let comparisonLabelFont = null;
let comparisonLabelFontLoaded = false;

function getComparisonLabelFont() {
  if (comparisonLabelFontLoaded) return comparisonLabelFont;
  comparisonLabelFontLoaded = true;
  if (!existsSync(COMPARISON_LABEL_FONT)) return null;
  try {
    const fontBuffer = readFileSync(COMPARISON_LABEL_FONT);
    const fontData = fontBuffer.buffer.slice(fontBuffer.byteOffset, fontBuffer.byteOffset + fontBuffer.byteLength);
    comparisonLabelFont = opentype.parse(fontData);
  } catch (error) {
    console.warn(`[compose] Failed to load comparison label font: ${error?.message || error}`);
    comparisonLabelFont = null;
  }
  return comparisonLabelFont;
}

function escapeSvgText(text) {
  return String(text || '').replace(/[<&>]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[char]));
}

function comparisonLabelSvg(text, width, height) {
  const label = String(text || '');
  const font = getComparisonLabelFont();
  if (font) {
    const fontSize = 58;
    const draftPath = font.getPath(label, 0, 0, fontSize);
    const bbox = draftPath.getBoundingBox();
    const textWidth = bbox.x2 - bbox.x1;
    const textHeight = bbox.y2 - bbox.y1;
    const x = Math.round((width - textWidth) / 2 - bbox.x1);
    const y = Math.round((height - textHeight) / 2 - bbox.y1 + 3);
    const finalPath = font.getPath(label, x, y, fontSize);
    return Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <rect width="100%" height="100%" fill="#050505"/>
        <path d="${finalPath.toPathData(2)}" fill="#ffffff"/>
      </svg>
    `);
  }

  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="#050505"/>
      <text x="50%" y="55%" text-anchor="middle" dominant-baseline="middle"
        font-family="Microsoft YaHei, SimHei, Arial, sans-serif" font-size="58" font-weight="700"
        fill="#ffffff">${escapeSvgText(label)}</text>
    </svg>
  `);
}

async function createSetupComparisonBoard(job, outputDir, images) {
  return createTwoPanelComparisonBoard(job, outputDir, images, {
    stageText: '正在拼接布置前后对比图',
    logText: '[compose] 生成 3:4 上下 2 宫格前后对比图（上=AI 反推的布置前空场地，下=上传的布置后效果图）',
    missingText: '缺少布置前空场地图，无法拼接对比图',
    filename: 'setup-before-after.jpg',
    topLabel: '布置前现场图',
    bottomLabel: '布置后效果图',
    topSource: 'generated',
    bottomSource: 'reference',
  });
}

async function createTwoPanelComparisonBoard(job, outputDir, images, options) {
  updateJob(job, 88, options.stageText, options.logText);

  const generatedImage = images[0];
  if (!generatedImage?.filename) throw new Error(options.missingText);

  const canvasWidth = 1080;
  const canvasHeight = 1440;
  const halfHeight = canvasHeight / 2;
  const labelHeight = 92;
  const imageHeight = halfHeight - labelHeight;
  const filename = options.filename;

  const reference = getReferenceInput(job);
  const generatedBuffer = await sharp(path.join(outputDir, generatedImage.filename))
    .resize(canvasWidth, imageHeight, { fit: 'cover' })
    .jpeg({ quality: 92 })
    .toBuffer();
  const liveBuffer = await sharp(reference.buffer)
    .rotate()
    .resize(canvasWidth, imageHeight, { fit: 'cover' })
    .jpeg({ quality: 92 })
    .toBuffer();
  const sourceBuffers = {
    generated: generatedBuffer,
    reference: liveBuffer,
  };

  await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 3,
      background: '#050505',
    },
    })
    .composite([
      { input: comparisonLabelSvg(options.topLabel, canvasWidth, labelHeight), left: 0, top: 0 },
      { input: sourceBuffers[options.topSource], left: 0, top: labelHeight },
      { input: comparisonLabelSvg(options.bottomLabel, canvasWidth, labelHeight), left: 0, top: halfHeight },
      { input: sourceBuffers[options.bottomSource], left: 0, top: halfHeight + labelHeight },
    ])
    .jpeg({ quality: 92 })
    .toFile(path.join(outputDir, filename));

  return publicUrl(job.id, filename);
}

async function createStoryboardBoard(job, outputDir, images) {
  updateJob(job, 88, '正在拼接 3:4 分镜总览', '[compose] 纯图片拼接 6 个镜头，不添加标题和文字');

  const canvasWidth = 1080;
  const canvasHeight = 1440;
  const pad = 28;
  const gap = 18;
  const cellW = Math.round((canvasWidth - pad * 2 - gap) / 2);
  const cellH = Math.round((canvasHeight - pad * 2 - gap * 2) / 3);
  const composites = [];

  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    const input = path.join(outputDir, image.filename);
    const col = index % 2;
    const row = Math.floor(index / 2);
    const left = pad + col * (cellW + gap);
    const top = pad + row * (cellH + gap);
    const buffer = await sharp(input)
      .resize(cellW, cellH, { fit: 'cover' })
      .jpeg({ quality: 90 })
      .toBuffer();
    composites.push({ input: buffer, left, top });
  }

  const filename = 'cinematic-storyboard.jpg';
  await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 3,
      background: '#f6f0ec',
    },
  })
    .composite(composites)
    .jpeg({ quality: 92 })
    .toFile(path.join(outputDir, filename));

  return publicUrl(job.id, filename);
}

function createCopy(mode) {
  const configs = {
    cinematic_storyboard: {
      title: '紫白花艺配镜面通道很出片✨',
      tags: ['#紫色婚礼', '#白色花艺', '#镜面通道', '#婚礼电影感', '#婚礼布置', '#备婚灵感'],
      body: '这场现场最抓人的地方，是紫白花艺、镜面通道和舞台灯光之间的层次。两侧花艺顺着通道往仪式区延伸，镜面反光把灯线和花材都拉得更有纵深。\n\n如果喜欢这种电影感画面，可以重点参考“主色明确、通道干净、灯光集中”的处理方式。大景负责第一眼，通道和舞台的比例关系会决定整组照片有没有记忆点。',
    },
    multi_angle: {
      title: '同一场婚礼换角度也很出片～',
      tags: ['#婚礼布置', '#婚礼灵感', '#婚礼策划', '#婚礼现场', '#宴会设计'],
      body: '婚礼现场不只大景值得看，通道、花艺、灯光和桌面关系放在一起，整场案例会更完整。\n\n这种发布方式很适合记录一场真实婚礼：先看空间和主色，再看花材密度、灯光走向和局部质感。新人收藏的时候也更容易判断，自己喜欢的是色系、结构，还是某一个细节。',
    },
    detail_pack: {
      title: '婚礼现场好不好看细节很关键～',
      tags: ['#婚礼细节', '#花艺布置', '#婚礼桌景', '#婚礼审美', '#备婚灵感'],
      body: '一场婚礼的记忆点，很多时候藏在近处的花材、灯光、布幔和桌面材质里。大景负责第一眼的氛围，细节决定客户愿不愿意多看几秒。\n\n备婚参考时可以多留意这些地方：花艺有没有层次，灯光是不是干净，材质和色系能不能接上。把这些细节拍清楚，整场案例会更像一套完整作品。',
    },
    similar_style: {
      title: '同色系婚礼可以这样找灵感～',
      tags: ['#类似婚礼', '#婚礼灵感', '#婚礼效果图', '#婚礼策划', '#备婚参考'],
      body: '想参考同色系婚礼，可以先抓住主色、花艺比例、舞台关系和灯光氛围，再看通道和桌景要不要延续同一组元素。\n\n只要这几个方向稳定，后面无论换成通道、仪式区还是桌景，都能保持同一种调性。新人收藏后和策划师沟通，也能更快说清楚自己喜欢哪一部分。',
    },
    setup_comparison: {
      title: '同一场地布置前后真的很有反差！',
      tags: ['#婚礼布置', '#婚礼前后对比', '#同一场地', '#空场改造', '#备婚参考', '#婚礼灵感'],
      body: '同一个场地，布置前后放在一起看会更直观。空场时先看空间结构和动线，完成后再看花艺、灯光和通道关系，整个婚礼氛围一下就清楚了。\n\n备婚参考这种对比图很实用：不要只看完成图有多热闹，也要看原本场地适不适合自己的主色和布置体量。反差越清楚，越容易判断方案落地后的效果。',
    },
    design_render_scene: {
      title: '效果图转成实景后会很有画面感✨',
      tags: ['#婚礼设计图', '#婚礼现场效果', '#婚礼提案', '#婚礼布置', '#备婚参考', '#婚礼灵感'],
      body: '把设计图转成真实现场视角后，重点就更清楚了：色系、花艺比例、灯光走向、舞台和通道关系都能提前看到落地后的感觉。\n\n提案沟通时这种现场候选图很实用，不用只靠平面效果图想象。客户可以直接看空间氛围、材质质感和整体层次，再决定哪一版更适合后续深化。',
    },
    venue_fusion: {
      title: '空地落成婚礼现场很有画面感✨',
      tags: ['#空地婚礼', '#婚礼效果图', '#婚礼布置', '#场地改造', '#备婚参考', '#婚礼灵感'],
      body: '把婚礼素材落到真实空地里以后，场地能不能承接舞台、通道、花艺和灯光关系就更直观了。先看空间动线，再看主色和布置体量，客户沟通时会更容易判断方向。\n\n这种融合效果很适合做方案前期沟通：不用只靠想象空地完成后的样子，可以直接看风格、比例和背景环境是否合拍，再决定后续深化。',
    },
    copy_title: {
      title: '奶白花艺配水晶灯像电影截图✨',
      tags: ['#婚礼文案', '#婚礼灵感', '#婚礼布置', '#婚礼记录', '#备婚日记', '#婚礼案例', '#婚礼策划'],
      body: '把这场婚礼的色系、花艺和灯光关系都记下来：奶白花艺顺着仪式区往通道延展，水晶灯和暖光落在镜面地面上，画面又安静又有质感。\n\n如果你也在备婚，可以重点参考主色和花艺的搭配方式。通道、灯光和舞台比例先统一，照片里会更容易出现干净的纵深感。\n\n这种调性很适合喜欢柔和光影的新娘收藏，后期选片时大景、侧面和近景都能接成一组。',
    },
    motion_video: {
      title: '婚礼现场运镜短片',
      tags: ['#婚礼运镜', '#婚礼短片', '#婚礼现场', '#婚礼布置', '#婚礼灵感'],
      body: '这类空景短片很适合放在案例开头：先交代场地和主色，再切到花艺、灯光或布幔细节，最后停在最有记忆点的画面。\n\n发布时不用写太满，把现场的色系、通道关系和灯光氛围说清楚，就已经很适合新人收藏参考。',
    },
  };
  return configs[mode] || configs.cinematic_storyboard;
}

function extractJsonObject(text) {
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalizeVisualKeyword(keyword) {
  const normalized = String(keyword || '').trim().replace(/^#+/, '');
  if (!normalized) return '';
  const lower = normalized.toLowerCase();
  const map = [
    [/champagne|cream|beige|ivory/, '香槟色'],
    [/purple|lavender|lilac/, '紫色'],
    [/red|burgundy|crimson/, '红色'],
    [/gold|golden/, '金色'],
    [/black/, '黑色'],
    [/green|greenery/, '绿色'],
    [/white/, '白色'],
    [/flower|floral|rose|hydrangea/, '花艺'],
    [/light|lighting|spotlight|ambient/, '灯光'],
    [/drape|drapery|fabric|curtain/, '布幔'],
    [/crystal|chandelier/, '水晶灯'],
    [/stage|ceremony/, '仪式区'],
    [/aisle|walkway/, '通道'],
    [/table|tablescape/, '桌景'],
    [/candle|lantern/, '烛光'],
  ];
  const matched = map.find(([pattern]) => pattern.test(lower));
  if (matched) return matched[1];
  if (/^[a-z\s-]+$/i.test(normalized)) return '';
  return normalized;
}

const COPY_BANNED_WORDS = [
  'AI', 'ai', '人工智能', '智能生成',
  '提示词', '模型', '接口', '参数', '生成失败', '生成图片', '生成结果',
  '分镜', '九宫格', '图生视频', '爆款图文', '本地兜底',
  '专业分镜解析', '高级感拉满', '每一场婚礼', '独一无二', '尽显浪漫',
  '小' + '红' + '书', '案例获客', '内容获客',
];

const COPY_EXTREME_WORD_REPLACEMENTS = [
  [/绝对/g, '比较'],
  [/一定/g, '建议'],
  [/保证/g, '更容易'],
  [/必看/g, '值得看'],
  [/必须/g, '可以'],
  [/唯一/g, '很特别的'],
  [/第一/g, '前面'],
  [/顶级/g, '高质感'],
  [/极致/g, '细腻'],
  [/完美/g, '完整'],
  [/无敌/g, '很出彩'],
  [/天花板/g, '高水准参考'],
  [/封神/g, '很出片'],
  [/不踩雷/g, '更稳妥'],
  [/不会踩雷/g, '更稳妥'],
  [/零风险/g, '更稳妥'],
  [/全网/g, '近期'],
  [/100%/g, ''],
  [/百分百/g, ''],
  [/最适合/g, '很适合'],
  [/最值得/g, '很值得'],
  [/最容易/g, '更容易'],
  [/最美/g, '很美'],
  [/最强/g, '很强'],
  [/最高级/g, '很高级'],
  [/最大/g, '更大'],
  [/最小/g, '更小'],
  [/最好/g, '更好'],
  [/最/g, '很'],
];

function cleanExtremeWords(text) {
  let value = String(text || '');
  for (const [pattern, replacement] of COPY_EXTREME_WORD_REPLACEMENTS) {
    value = value.replace(pattern, replacement);
  }
  return value.replace(/\s+/g, ' ').trim();
}

function containsExtremeWord(text) {
  const normalized = String(text || '');
  return COPY_EXTREME_WORD_REPLACEMENTS.some(([pattern]) => {
    pattern.lastIndex = 0;
    return pattern.test(normalized);
  });
}

const COPY_WEAK_TITLE_PHRASES = [
  '打造',
  '营造',
  '组合',
  '主视觉',
  '仪式区',
  '整体以',
  '整体用',
  '整体看起来',
  '梦幻',
  '非常梦幻',
  '极为梦幻',
  '婚礼现场',
  '婚礼布置',
  '婚区',
  '适合喜欢',
  '适合偏爱',
  '了解更多',
  '欢迎私信',
  '定制专属',
  '专属方案',
];

const COPY_VIRAL_TITLE_HOOKS = [
  '别再',
  '原来',
  '备婚',
  '直接',
  '照着抄',
  '出片',
  '心动',
  '收藏',
  '参考',
  '值得',
  '被',
  '存进备婚夹',
  '像电影截图',
];

const COPY_TITLE_DIRECTIONS = [
  '案例纪实型：标题像真实婚礼团队发案例，直接点出颜色、花艺、灯光或场地记忆点。',
  '收藏参考型：标题写清楚画面里哪一处值得存，不要只喊"值得收藏"。',
  '画面细节型：标题直接拿具体颜色和物件做钩子，例如"奶白花艺配水晶灯像电影截图"。',
  '场地适配型：标题写它适合什么季节或场地，例如冬季宴会厅、暗场礼堂、午宴花园。',
  '情绪共鸣型：标题可以写被某个细节戳中、想存进备婚夹，但不要落回固定模板。',
  '摄影画面型：标题从光影、通道、镜面反射、近景细节切入，像在选一张封面图。',
];

const COPY_OVERUSED_TITLE_PATTERNS = [
  /^谁懂啊/,
  /^看完/,
  /看完.*(重办|办婚礼|想抄|照着抄|收藏)/,
  /我又想.*(重办|办婚礼|办一场)/,
  /又想重办婚礼/,
  /又想办婚礼/,
  /谁懂啊.*太会了/,
  /谁懂啊.*真的/,
  /.*配.*真的太会了/,
  /.*太会了$/,
  /.*真的太.*了$/,
  /.*太适合.*了$/,
  /.*真的太会了$/,
  /.*高级感拉满$/,
  /.*氛围感拉满$/,
];

function containsBannedWord(text) {
  if (!text) return false;
  const normalized = String(text);
  return COPY_BANNED_WORDS.some((word) => {
    if (!word) return false;
    if (/^[A-Za-z]+$/.test(word)) {
      const pattern = new RegExp(`(?:^|[^A-Za-z])${word}(?:[^A-Za-z]|$)`, 'i');
      return pattern.test(normalized);
    }
    return normalized.includes(word);
  }) || containsExtremeWord(normalized);
}

function cleanTitleText(title, fallback = '') {
  const source = String(title || fallback || '');
  return cleanExtremeWords(source)
    .replace(/^#+\s*/, '')
    .replace(/^标题[:：]\s*/, '')
    .replace(/^["“”'‘’「」『』]+|["“”'‘’「」『』]+$/g, '')
    .replace(/[。.]+$/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function applyXhsTitleStyle(title, seed = '') {
  const clean = cleanTitleText(title);
  if (!clean) return clean;
  if (/[!！~～…🥹😭✨🤍💕💗🌷]/u.test(clean)) return clean;
  const suffixes = ['！', '～', '🥹', '✨'];
  return `${clean}${suffixes[pickStableIndex(seed || clean, suffixes.length)]}`;
}

function collectTitleCandidates(payload, fallbackTitle) {
  const raw = [];
  const pushCandidate = (candidate) => {
    if (typeof candidate === 'string') raw.push(candidate);
    if (candidate && typeof candidate === 'object') {
      if (typeof candidate.title === 'string') raw.push(candidate.title);
      if (typeof candidate.text === 'string') raw.push(candidate.text);
      if (typeof candidate.value === 'string') raw.push(candidate.value);
    }
  };
  pushCandidate(payload?.title);
  if (Array.isArray(payload?.title_candidates)) payload.title_candidates.forEach(pushCandidate);
  if (Array.isArray(payload?.titles)) payload.titles.forEach(pushCandidate);
  pushCandidate(fallbackTitle);
  return [...new Set(raw.map((item) => cleanTitleText(item)).filter(Boolean))].slice(0, 10);
}

function visualKeywordTokens(visualKeywords) {
  return [...new Set((visualKeywords || [])
    .flatMap((keyword) => String(keyword || '')
      .replace(/[，,。.!！?？、\s]/g, '')
      .split(/[和与及/｜|]/g))
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length >= 2 && keyword.length <= 8))];
}

function countVisualKeywordHits(title, visualKeywords) {
  const normalized = cleanTitleText(title);
  if (!normalized) return 0;
  return visualKeywordTokens(visualKeywords)
    .filter((keyword) => normalized.includes(keyword) || (keyword.length >= 3 && keyword.includes(normalized.slice(0, 3))))
    .length;
}

function scoreCopyTitleCandidate(title, visualKeywords, recentTitles) {
  const normalized = cleanTitleText(title);
  if (!normalized) return -999;
  if (titleNeedsVisualFallback(normalized)) return -900;
  if (titleLooksRepetitive(normalized, recentTitles)) return -800;

  const length = normalized.length;
  let score = 0;
  if (length >= 12 && length <= 26) score += 12;
  else if (length >= 8 && length <= 32) score += 5;
  else score -= 8;

  const visualHits = countVisualKeywordHits(normalized, visualKeywords);
  if (visualKeywords.length && !visualHits) score -= 12;
  score += Math.min(visualHits, 3) * 7;

  if (/(这场|备婚|收藏|参考|出片|原来|值得|被|存进备婚夹|电影截图|光感|镜面|通道|落地|空场|空地|布置|现场|宴会厅|圆桌|提案|记忆点|封面)/.test(normalized)) score += 5;
  if (/(看完|重办|又想.*婚礼|想抄作业|照着抄)/.test(normalized)) score -= 35;
  if (/(谁懂啊|太会|救命|狠狠|拉满)/.test(normalized)) score -= 18;
  if (/(别乱堆|别堆|才耐看|耐不耐看|这样才|堆花|少而精|不容易过时|显贵气)/.test(normalized)) score -= 24;
  if (/(打造|营造|组合|主视觉|高级感|氛围感|梦幻)/.test(normalized)) score -= 8;
  if (/婚礼/.test(normalized)) score += 1;
  return score;
}

function selectCopyTitle(payload, fallback, visualKeywords, seed, recentTitles) {
  const generated = visualKeywords.length
    ? createVisualTitleCandidates(visualKeywords, fallback.title)
    : [fallback.title];
  const candidates = [...collectTitleCandidates(payload, fallback.title), ...generated]
    .map((title) => cleanTitleText(title))
    .filter(Boolean)
    .filter((title, index, array) => array.indexOf(title) === index);
  const scored = candidates
    .map((title) => ({
      title,
      score: scoreCopyTitleCandidate(title, visualKeywords, recentTitles),
      tie: pickStableIndex(`${seed}|${title}`, 1000),
    }))
    .sort((a, b) => (b.score - a.score) || (a.tie - b.tie));
  const best = scored.find((item) => item.score >= 0);
  return applyXhsTitleStyle(best?.title || createVisualTitle(visualKeywords, fallback.title, seed, recentTitles) || fallback.title, seed);
}

function selectTitleCandidates(payload, fallback, visualKeywords, seed, recentTitles) {
  const generated = visualKeywords.length
    ? createVisualTitleCandidates(visualKeywords, fallback.title)
    : [fallback.title];
  const candidates = [...collectTitleCandidates(payload, fallback.title), ...generated]
    .map((title) => cleanTitleText(title))
    .filter(Boolean)
    .filter((title, index, array) => array.indexOf(title) === index)
    .map((title) => ({
      title,
      score: scoreCopyTitleCandidate(title, visualKeywords, recentTitles),
      tie: pickStableIndex(`${seed}|${title}`, 1000),
    }))
    .sort((a, b) => (b.score - a.score) || (a.tie - b.tie))
    .map((item) => item.title)
    .filter((title) => !titleNeedsVisualFallback(title))
    .filter((title) => !titleLooksRepetitive(title, recentTitles));
  const fallbackCandidates = generated
    .filter((title) => !titleNeedsVisualFallback(title))
    .filter((title) => !titleLooksRepetitive(title, recentTitles));
  return [...new Set([...candidates, ...fallbackCandidates])]
    .map((title) => applyXhsTitleStyle(title, `${seed}|${title}`))
    .slice(0, 10);
}

function normalizeCopyHook(hook, visualKeywords) {
  const normalized = cleanExtremeWords(String(hook || ''))
    .replace(/^开头[:：]\s*/, '')
    .replace(/^钩子[:：]\s*/, '')
    .trim();
  if (!normalized || normalized.length < 10 || normalized.length > 90) return '';
  if (/[A-Za-z]{3,}/.test(normalized)) return '';
  if (containsBannedWord(normalized)) return '';
  if (visualKeywords.length && countVisualKeywordHits(normalized, visualKeywords) === 0) return '';
  return /[。！？]$/.test(normalized) ? normalized : `${normalized}。`;
}

function normalizeBodyText(text, visualKeywords, fallbackBody = '') {
  const normalized = cleanExtremeWords(String(text || '').trim());
  if (!normalized) return '';
  if (/[A-Za-z]{8,}/.test(normalized)) return '';
  if (containsBannedWord(normalized)) return '';
  if (visualKeywords.length && countVisualKeywordHits(normalized, visualKeywords) === 0) return '';
  if (bodyNeedsVisualFallback(normalized)) return fallbackBody ? createVisualBody(visualKeywords, fallbackBody) : '';
  return normalized;
}

function normalizeBodyVersions(payload, visualKeywords, fallbackBody) {
  const labels = [
    ['bride', '新娘视角'],
    ['planner', '婚礼策划视角'],
    ['photographer', '摄影师视角'],
  ];
  const source = payload?.body_versions || payload?.versions || payload?.bodyVersions;
  const readValue = (key, label) => {
    if (!source) return '';
    if (typeof source === 'object' && !Array.isArray(source)) {
      return source[key] || source[label] || source[label.replace('视角', '')] || '';
    }
    if (Array.isArray(source)) {
      const matched = source.find((item) => {
        if (typeof item === 'string') return item.includes(label);
        if (item && typeof item === 'object') return item.key === key || item.label === label || item.title === label;
        return false;
      });
      return typeof matched === 'string' ? matched : (matched?.body || matched?.content || matched?.text || '');
    }
    return '';
  };
  const result = {};
  for (const [key, label] of labels) {
    const value = normalizeBodyText(readValue(key, label), visualKeywords, fallbackBody);
    if (value) result[label] = value;
  }
  return Object.keys(result).length ? result : null;
}

function normalizeCommentPrompts(payload) {
  const source = payload?.comments || payload?.comment_prompts || payload?.interaction_comments;
  if (!Array.isArray(source)) return [];
  return [...new Set(source
    .map((item) => cleanExtremeWords(String(item || '').trim()))
    .filter(Boolean)
    .filter((item) => item.length >= 6 && item.length <= 36)
    .filter((item) => !/[A-Za-z]{3,}/.test(item))
    .filter((item) => !containsBannedWord(item))
    .filter((item) => !/(私信|咨询|联系|下单|报价|预算|定制|了解更多)/.test(item)))]
    .slice(0, 5);
}

// 对比类模式标题必须包含的关键词
const COMPARE_TITLE_KEYWORDS = {
  setup_comparison: ['布置前', '布置后', '前后对比', '反差', '同一场地', '同一个场地', '空场', '完成后', '神还原', '秒变', '从空', '到完整', '到完成'],
};

function titleMatchesCompareKeyword(title, mode) {
  const keywords = COMPARE_TITLE_KEYWORDS[mode];
  if (!keywords) return true;
  const text = String(title || '');
  return keywords.some((kw) => text.includes(kw));
}

function normalizeCopy(payload, fallback, options = {}) {
  if (!payload || typeof payload !== 'object') return fallback;
  const recentTitles = Array.isArray(options.recentTitles) ? options.recentTitles : [];
  const seed = options.seed || '';
  const mode = options.mode || '';
  const visualKeywords = Array.isArray(payload.visual_keywords)
    ? payload.visual_keywords
      .map(normalizeVisualKeyword)
      .filter(Boolean)
      .slice(0, 6)
    : [];
  const titleCandidates = selectTitleCandidates(payload, fallback, visualKeywords, seed, recentTitles);
  let title = titleCandidates[0] || selectCopyTitle(payload, fallback, visualKeywords, seed, recentTitles);
  // 对比类模式兜底：标题必须含对比关键词，否则从 candidates 中重选；都没有则套用对比模板
  if (COMPARE_TITLE_KEYWORDS[mode] && !titleMatchesCompareKeyword(title, mode)) {
    const better = titleCandidates.find((t) => titleMatchesCompareKeyword(t, mode));
    if (better) {
      title = better;
    } else {
      const visual = visualKeywords.find((kw) => kw && kw.length >= 2 && kw.length <= 8) || '布置';
      title = `同一场地${visual}前后真的太反差了！`;
    }
  }
  const hasPayloadBody = typeof payload.body === 'string' && payload.body.trim();
  const rawBody = hasPayloadBody ? payload.body.trim() : fallback.body;
  const bodyCandidate = ((!hasPayloadBody && visualKeywords.length) || bodyNeedsVisualFallback(rawBody))
    ? createVisualBody(visualKeywords, fallback.body)
    : rawBody;
  const hook = normalizeCopyHook(payload.hook, visualKeywords);
  const cleanedBody = cleanExtremeWords(bodyCandidate);
  const body = hook && !cleanedBody.includes(hook.replace(/[。！？]$/g, ''))
    ? cleanExtremeWords(`${hook}\n\n${cleanedBody}`)
    : cleanedBody;
  const tags = Array.isArray(payload.tags)
    ? payload.tags
      .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
      .filter(Boolean)
      .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
      .map(cleanExtremeWords)
      .filter((tag) => !/[A-Za-z]{3,}/.test(tag))
      .filter((tag) => !containsBannedWord(tag))
      .slice(0, 10)
    : fallback.tags;

  const mergedTags = [...tags, ...fallback.tags]
    .filter(Boolean)
    .map(cleanExtremeWords)
    .filter((tag) => !containsBannedWord(tag))
    .filter((tag, index, array) => array.indexOf(tag) === index)
    .slice(0, 10);

  return {
    title: title.slice(0, 42),
    titleCandidates: titleCandidates.length ? titleCandidates : [title],
    body,
    bodyVersions: normalizeBodyVersions(payload, visualKeywords, fallback.body),
    comments: normalizeCommentPrompts(payload),
    tags: mergedTags.length ? mergedTags : fallback.tags,
  };
}

function titleNeedsVisualFallback(title) {
  if (!title) return true;
  const normalized = title.replace(/\s+/g, '');
  const asciiLetters = normalized.match(/[A-Za-z]/g)?.length || 0;
  if (asciiLetters >= 4) return true;
  if (containsBannedWord(normalized)) return true;
  const hasWeakPhrase = COPY_WEAK_TITLE_PHRASES.some((phrase) => normalized.includes(phrase));
  const hasViralHook = COPY_VIRAL_TITLE_HOOKS.some((hook) => normalized.includes(hook));
  if (hasWeakPhrase && !hasViralHook) return true;
  if (/^[\u4e00-\u9fa5]+和[\u4e00-\u9fa5]+(搭配|配|打造|营造)/.test(normalized)) return true;
  const genericPhrases = [
    '专业分镜',
    '浪漫细节',
    '尽显浪漫',
    '每一场婚礼',
    '这组婚礼分镜',
    '这组分镜',
    '高级感藏在',
    '小' + '红' + '书',
    '这场婚礼的标题',
    '标题文案可以这样写',
    '这场婚礼太美',
    '高级感拉满',
    '氛围感拉满',
  ];
  return genericPhrases.some((phrase) => normalized.includes(phrase));
}

function titleLooksRepetitive(title, recentTitles = []) {
  if (!title) return true;
  const normalized = title.replace(/\s+/g, '');
  if (COPY_OVERUSED_TITLE_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
  const commonOpening = normalized.match(/^(被|原来|备婚|这场|这处|空场|空地|同一场地|设计图|效果图|布置前|布置后)/)?.[0] || '';
  if (commonOpening) {
    const sameOpeningCount = recentTitles
      .map((recent) => String(recent || '').replace(/\s+/g, ''))
      .filter((recent) => recent.startsWith(commonOpening))
      .length;
    if (sameOpeningCount >= 2) return true;
  }
  const commonEnding = normalized.match(/(像电影截图|存进备婚夹|适合直接收藏|很有故事感|光感好温柔|记忆点很强|落地感很清楚|适合给客户看效果)[!！~～…🥹😭✨🤍💕💗🌷]*$/u)?.[1] || '';
  if (commonEnding && recentTitles.some((recent) => String(recent || '').replace(/\s+/g, '').includes(commonEnding))) return true;
  const meaningful = normalized.replace(/[啊呀呢吧了的真很太超]/g, '');
  return recentTitles.some((recent) => {
    const compare = String(recent || '').replace(/\s+/g, '').replace(/[啊呀呢吧了的真很太超]/g, '');
    if (!compare) return false;
    if (compare === meaningful) return true;
    if (meaningful.length >= 10 && compare.includes(meaningful.slice(0, 8))) return true;
    if (compare.length >= 10 && meaningful.includes(compare.slice(0, 8))) return true;
    return false;
  });
}

function bodyNeedsVisualFallback(body) {
  if (!body) return true;
  const asciiLetters = body.match(/[A-Za-z]/g)?.length || 0;
  if (asciiLetters >= 16) return true;
  if (containsBannedWord(body)) return true;
  const genericPhrases = [
    '每一场婚礼都是独一无二',
    '本次生成',
    '这次不生成图片',
    '这次先看',
    '这组图的视觉重点会围绕',
    '内容获客',
    '案例获客',
  ];
  if (genericPhrases.some((phrase) => body.includes(phrase))) return true;
  const salesyPhrases = [
    '留言',
    '私信',
    '欢迎咨询',
    '欢迎联系',
    '联系我',
    '咨询我',
    '可以咨询',
    '可以联系',
    '定制专属',
    '专属方案',
    '了解更多',
    '按你的场地',
    '按你的预算',
    '给落地思路',
    '一对一',
  ];
  return salesyPhrases.some((phrase) => body.includes(phrase));
}

const VISUAL_TITLE_TEMPLATES = [
  (a, b) => `${a}${b}这场像电影截图`,
  (a, b) => `备婚想要${a}可以存${b}`,
  (a, b) => `${a}婚礼被${b}戳中了`,
  (a, b) => `原来${a}靠${b}就很出片`,
  (a, b) => `这场${a}${b}很适合宴会厅`,
  (a, b) => `${a}${b}现场记忆点很强`,
  (a, b) => `${a}${b}拍出来很有故事感`,
  (a, b) => `${a}${b}适合存进备婚夹`,
  (a, b) => `${a}配${b}光感好温柔`,
  (a, b) => `${a}${b}这一组很像封面图`,
  (a, b) => `${a}一出现${b}就有记忆点`,
  (a, b) => `${a}${b}这场适合直接收藏`,
  (a, b) => `${a}${b}细节比大景还抓人`,
  (a, b) => `${a}婚礼用${b}会更有层次`,
  (a) => `${a}婚礼像一张电影截图`,
  (a) => `备婚想要${a}氛围可以照着抄`,
  (a) => `这场${a}婚礼很适合收藏`,
  (a) => `${a}现场适合给客户看效果`,
  (a) => `${a}婚礼拍出来好有故事感`,
  (a) => `喜欢${a}调性的可以存一下`,
];

function pickStableIndex(seed, length) {
  if (!length) return 0;
  let hash = 0;
  const text = String(seed || '');
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash % length;
}

function createVisualTitleCandidates(keywords, fallbackTitle) {
  const useful = [...new Set(keywords
    .map((keyword) => keyword.replace(/[，,。.!！?？、\s]/g, ''))
    .filter((keyword) => keyword.length >= 2 && keyword.length <= 8))];
  if (!useful.length) return fallbackTitle ? [fallbackTitle] : [];
  const pairedTemplates = VISUAL_TITLE_TEMPLATES.slice(0, 14);
  const singleTemplates = VISUAL_TITLE_TEMPLATES.slice(14);
  const primary = useful.length >= 2
    ? pairedTemplates.flatMap((tpl) => [
      tpl(useful[0], useful[1]),
      useful[2] ? tpl(useful[0], useful[2]) : '',
      useful[3] ? tpl(useful[1], useful[3]) : '',
    ])
    : singleTemplates.map((tpl) => tpl(useful[0]));
  return [...new Set(primary.concat(fallbackTitle || '').map((title) => cleanTitleText(title)).filter(Boolean))];
}

function createVisualTitle(keywords, fallbackTitle, seed = '', recentTitles = []) {
  const useful = [...new Set(keywords
    .map((keyword) => keyword.replace(/[，,。.!！?？、\s]/g, ''))
    .filter((keyword) => keyword.length >= 2 && keyword.length <= 8))];
  if (!useful.length) return fallbackTitle;
  const titleSeed = `${seed}|${useful.join('|')}`;
  const candidates = createVisualTitleCandidates(useful, fallbackTitle);
  const start = pickStableIndex(titleSeed, candidates.length);
  for (let offset = 0; offset < candidates.length; offset += 1) {
    const candidate = candidates[(start + offset) % candidates.length];
    if (!titleNeedsVisualFallback(candidate) && !titleLooksRepetitive(candidate, recentTitles)) return candidate;
  }
  return candidates[start] || fallbackTitle;
}

function createVisualBody(keywords, fallbackBody) {
  const useful = [...new Set(keywords
    .map((keyword) => keyword.replace(/[，,。.!！?？、\s]/g, ''))
    .filter((keyword) => keyword.length >= 2 && keyword.length <= 8))]
    .slice(0, 4);
  if (!useful.length) return fallbackBody;
  const [first, second, third, fourth] = useful;
  const firstLine = third
    ? `这场婚礼比较打动人的就是${first}、${second}和${third}这几处细节，色调统一又有层次，画面整体看着就很舒服。`
    : `这场婚礼比较打动人的是${first}和${second || first}的搭配，色调干净又有氛围感。`;
  const secondLine = fourth
    ? `如果你也喜欢这种调性，可以把重点放在${fourth}和整体灯光关系上，落地的时候保留主色就很出片。`
    : `如果你也喜欢这种调性，记得保留主色和灯光关系，通道、舞台和近景细节放在一起会更有质感。`;
  const thirdLine = '这种调性很适合喜欢柔和光影的新娘收藏，大景、侧面和近景都能接成一组，后期发案例也更完整。';
  return `${firstLine}\n\n${secondLine}\n\n${thirdLine}`;
}

async function imageBufferToCopyPart(buffer, label) {
  const image = await sharp(buffer)
    .rotate()
    .resize(COPY_VISION_MAX_EDGE, COPY_VISION_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: COPY_VISION_IMAGE_QUALITY })
    .toBuffer();
  return [
    { type: 'text', text: label },
    {
      type: 'image_url',
      image_url: {
        url: `data:image/jpeg;base64,${image.toString('base64')}`,
        detail: 'low',
      },
    },
  ];
}

async function buildCopyImageParts(job, images, outputDir) {
  const parts = [];
  try {
    if (isVenueFusionMode(job.mode) && job.fusionReferences?.length >= 2) {
      parts.push(...await imageBufferToCopyPart(
        job.fusionReferences[0].buffer,
        '上传的空地/空场图：这是融合结果要落地的真实场地，请优先根据这张图判断空间、地面、背景、光线和可布置区域。',
      ));
      parts.push(...await imageBufferToCopyPart(
        job.fusionReferences[1].buffer,
        '上传的婚礼素材图：这是要融合进空地的婚礼风格来源，请参考其中色系、花艺、布幔、灯光、舞台或通道关系。',
      ));
    } else if (job.reference?.buffer) {
      const referenceLabel = job.mode === 'setup_comparison'
        ? '上传的婚礼布置后效果图：这是已经布置完成的婚礼现场，请优先根据这张图判断婚礼色系、花艺、灯光、布幔/吊顶、舞台或通道关系。我们要为它反推出「布置前的空场地」做前后对比。'
        : job.mode === 'design_render_scene'
        ? '上传的婚礼设计图/效果图：请优先根据这张图判断方案色系、花艺、灯光、材质、舞台、通道和空间关系。我们要把它转成真实婚礼现场候选图。'
        : '上传的婚礼现场参考图：请优先根据这张图判断色系、花艺、灯光、布幔/吊顶、舞台或通道关系。';
      parts.push(...await imageBufferToCopyPart(job.reference.buffer, referenceLabel));
    }
  } catch (error) {
    job.logs.push(`[copy-vision] 参考图读取失败，改用文字上下文：${error.message || 'unknown error'}`);
  }

  const selectedImages = images.slice(0, Math.max(0, COPY_GENERATED_IMAGE_LIMIT));
  for (const [index, image] of selectedImages.entries()) {
    try {
      const imagePath = path.join(outputDir, image.filename);
      const buffer = await readFile(imagePath);
      const resultLabel = job.mode === 'setup_comparison'
        ? `布置前空场地图 ${index + 1}：AI 反推的同一场地未布置前的空旷状态，请仅做结构/空间参考。`
        : job.mode === 'design_render_scene'
        ? `真实现场候选图 ${index + 1}：${image.label || '婚礼现场效果'}。这是由设计图延展出的真实落地现场视角，请围绕方案落地后的氛围和沟通价值写，不要说成对比图。`
        : job.mode === 'venue_fusion'
        ? `空地婚礼融合图 ${index + 1}：${image.label || '融合效果图'}。这是把婚礼素材落到空地后的完成效果，请围绕场地利用、风格融合和落地沟通价值写。`
        : `生成结果图 ${index + 1}：${image.label || '婚礼参考图'}。只参考其中真实可信的风格细节，不要照抄成技术描述。`;
      parts.push(...await imageBufferToCopyPart(buffer, resultLabel));
    } catch (error) {
      job.logs.push(`[copy-vision] 生成图 ${index + 1} 读取失败：${error.message || 'unknown error'}`);
    }
  }
  return parts;
}

function pickTitleDirection(job) {
  return COPY_TITLE_DIRECTIONS[pickStableIndex(job?.id || `${Date.now()}`, COPY_TITLE_DIRECTIONS.length)];
}

async function recentCopyTitles(limit = 12) {
  const resources = await readResourceManifest();
  return resources
    .map((resource) => resource?.copy?.title || resource?.title || '')
    .filter(Boolean)
    .slice(0, limit);
}

function buildCopyInstruction(job, images, recentTitles = []) {
  const imageLabels = images.map((image, index) => `${index + 1}. ${image.label || `生成图 ${index + 1}`}`);
  const titleDirection = pickTitleDirection(job);
  const isSetupCompare = job.mode === 'setup_comparison';
  const isDesignRender = job.mode === 'design_render_scene';
  const isVenueFusion = job.mode === 'venue_fusion';
  const isCompareMode = isSetupCompare;
  const modeInstruction = (() => {
    if (job.mode === 'copy_title') return [
      '任务：这是“只写标题文案”，不会再生成任何图片，只根据上传的婚礼现场照写一篇真实内容平台婚礼笔记。',
      '请像真实婚礼策划师/婚礼摄像团队在内容平台发自己案例那样写，不是介绍工具，也不是解说“这次生成的图”。',
      '严禁在任何文字里出现：AI、人工智能、提示词、模型、接口、生成图片、分镜、九宫格、图生视频、爆款图文、本次生成等词；也不要说“这次/这组/这套”这种带工具感的口吻。',
    ].join('\n');
    if (isDesignRender) return [
        '任务：这是“设计图转实景”。用户上传的是婚礼设计图/效果图，系统输出的是 4 张真实落地现场候选图，不做上下对比图、不做九宫格、不做拼图。',
        '标题和正文要围绕「设计方案落地后的真实现场效果」「提案沟通更直观」「空间、材质、灯光、花艺更容易被客户理解」来写。',
        '可以自然使用“设计图”“效果图”“现场效果”“提案沟通”“落地现场”“现场候选图”等词，但不要说 AI、生成、工具、接口、模型，也不要说上图下图或对比图。',
      ].join('\n');
    if (isVenueFusion) return [
        '任务：这是“空地婚礼融合图”。用户上传了 2 张图：一张空地/空场作为真实场地，一张婚礼素材作为风格来源；系统输出 1 张把这场婚礼融合并落到空地上的完成效果图。',
        '标题和正文要围绕「空地变婚礼现场」「场地利用」「婚礼风格落地」「客户提前看到布置完成效果」来写，不要写成普通晒图，也不要写成前后对比图。',
        '可以自然使用“空地”“空场”“落地效果”“融合效果”“场地布置”“婚礼现场”等词；不要说 AI、生成、工具、接口、模型，也不要说左图右图或参考板。',
      ].join('\n');
    if (job.mode === 'similar_style') {
      return '任务：这是“类似婚礼”：标题要像同色系婚礼灵感分享，强调根据这场婚礼延展出相似但不重复的方案。不要写成室内/户外/新中式/目的地等不同婚礼类型，也不要提九宫格或合成总览。';
    }
    if (job.mode === 'setup_comparison') return [
          '任务：这是“婚礼布置前后对比图”。',
          '画面是一张上下两宫格的 3:4 对比图：上半部分是「布置前」同一场地空场地状态（AI 反推得到的，没有任何花艺/吊顶/布幔），下半部分是上传的「布置后」完成状态的婚礼现场。',
          '⚠️ 强制要求：标题必须明确点出「前后对比 / 反差 / 同一个场地 / 空场到完整 / 布置前后」这个对比主题，绝对不能写成普通"晒婚礼图"那种标题。',
          '标题里必须包含以下任意一组词：①"前后对比"或"布置前/布置后" ②"同一个场地/同一场地"+"反差/变化" ③"空场"+"完整/完成/完美/绽放" ④"布置 + 神还原/反差/秒变"。',
          '正文也要紧紧围绕「同一个场地从空荡到完整婚礼场景的反差」这个主题来写，第一段就要点出这个对比关系，让读者看完能感受到布置设计带来的变化。',
          '可以自然使用"布置前/后""前后对比""同一场地""反差感""空场""完成后""神还原"这类词。不要提 AI、反推、接口、生成、工具，不要夸大承诺。',
        ].join('\n');
    return '任务：这是“电影感分镜图”：标题要像婚礼团队发布摄像师视角素材，突出画面里的真实色系、花艺、灯光、道具、布幔、吊顶或通道细节，后续可用于婚礼视频分镜。';
  })();

  return [
    `当前模式：${MODE_LABELS[job.mode] || job.mode}`,
    imageLabels.length ? `镜头/图片列表：\n${imageLabels.join('\n')}` : '没有生成图片列表，请只参考上传的婚礼现场图。',
    modeInstruction,
    [
      '第一步：先看图，在心里默念 5-8 个画面里真实可见的元素，必须包含：',
      '- 至少 1 个具体颜色词（例如：香槟、奶白、莫兰迪绿、雾霾蓝、酒红、暮粉、藕粉、墨绿、红金、黑金、雪青、米咖、烟灰），不要只说"浅色/暖色/高级色"。',
      '- 至少 1 个具体物件或材质（例如：水晶吊灯、绿植拱门、白色布幔通道、雾感纱幔、丝绒桌旗、长枝绣球、铁艺烛台、镜面 T 台、香槟塔、灯串、烛光廊道）。',
      '只能写图里真实看到的元素，看不清就别写；绝对不要凭空编造画面里没有的东西。',
    ].join('\n'),
    '所有输出必须是简体中文，标题、正文、话题和 visual_keywords 里都不要出现英文单词。',
    [
      '合规用词要求：',
      '- 标题、正文、话题都要规避极限词和绝对化承诺。',
      '- 禁用：最、一定、绝对、保证、必须、唯一、第一、顶级、极致、完美、无敌、天花板、封神、全网、100%、百分百、不踩雷、不会踩雷、零风险、必看。',
      '- 可以改成：比较、建议、值得参考、更适合、更容易、更稳妥、很出片、有质感、很有记忆点。',
      '- 不要承诺效果，不要写成广告法风险文案。',
    ].join('\n'),
    [
      '标题去重要求：',
      `- 本次标题方向：${titleDirection}`,
      recentTitles.length ? `- 最近已经用过的标题，禁止同款句式或只换几个词：${recentTitles.join(' / ')}` : '- 当前没有历史标题，但也不要使用固定模板。',
      '- 本版本先不要用“谁懂啊”“真的太会了”“高级感拉满”“氛围感拉满”“看完...我又想重办婚礼”这类重复度很高的标题。',
      '- 每次至少想 10 个不同句式的标题，再从里面选一个更贴图、更像真实案例发布的。',
    ].join('\n'),
    [
      '标题要求：',
      ...(isSetupCompare ? [
        '⚠️⚠️⚠️ 布置前后对比图标题铁律（凌驾于下面所有通用规则之上）：',
        '- 标题里必须包含「布置前 / 布置后 / 前后对比 / 反差 / 同一场地 / 空场 / 完成后 / 神还原 / 秒变」中至少 1 个对比类关键词；不含的标题视为不合格。',
        '- 标题必须能让读者一眼看出"这是同一场地从空到布置完成的反差对比"，不是普通婚礼晒图。',
      ] : []),
      ...(isVenueFusion ? [
        '⚠️ 空地婚礼融合图标题方向：',
        '- 标题最好让读者一眼看出"这是一块空地/空场被布置成婚礼现场后的效果"，可以包含「空地 / 空场 / 落地 / 融合 / 布置 / 现场」等词。',
      ] : []),
      '- 标题不加空格，长度 14-26 个中文字符左右，宁可短、有钩子，也不要像方案说明。',
      '- 标题必须是“钩子 + 画面元素 + 情绪/结果/保存理由”，必须让备婚用户想点开或收藏。',
      '- 必须出现至少 1 个上一步默念出来的具体颜色词或具体物件名，不能只用"婚礼/现场/氛围/高级感/出片"这种空词凑数。',
      isCompareMode
        ? '- 从这些方向里选一种改写，不要固定使用同一个开头（务必结合对比主题）：同一场地布置前后真的太反差了 / ...布置前后一对比就懂了 / 空场到完成图变化很清楚。'
        : '- 从这些方向里选一种改写，不要固定使用同一个开头：被...的光感戳中了 / ...像电影截图 / ...配...现场记忆点很强 / 这处...适合做封面 / ...一出来画面就完整了 / ...适合给客户看落地效果。',
      '- 标题可以有小红书感的情绪符号：允许 1 个感叹号、波浪号或表情，例如 ！、～、🥹、✨、🤍；不要堆一串，不要满屏表情。',
      '- 不要带话题标签、不要书名号、不要句号结尾。',
      '- 标题不能像设计说明，严禁用“打造、营造、组合、主视觉、整体以、仪式区、非常梦幻、专属方案、欢迎私信、了解更多”。',
      isSetupCompare ? '- 允许的语气示例（必须含对比主题词，禁止照抄具体颜色和句式）：' : '- 允许的语气示例（参考爆款结构，禁止照抄具体颜色和句式）：',
      ...(isSetupCompare ? [
        '  · 同一个场地布置前后真的太反差了！',
        '  · 空场变水晶吊顶婚礼现场也太神还原🥹',
        '  · 雾霾紫布置前后一对比就懂了～',
        '  · 一张空场布置后秒变梦幻婚礼✨',
        '  · 布置前现场再看完成图反差很清楚',
        '  · 同一场地从空到完整的反差太上头🤍',
      ] : (isVenueFusion ? [
        '  · 空地落成香槟色婚礼也太有画面了！',
        '  · 原来这块空场可以这样布置🥹',
        '  · 把花艺婚礼搬到户外空地也很出片～',
        '  · 空地变成婚礼现场后记忆点很强✨',
      ] : [
        '  · 奶白花艺配水晶灯也太温柔了！',
        '  · 被香槟布幔的光感美到🥹',
        '  · 莫兰迪绿花艺像一张电影截图～',
        '  · 水晶灯一亮氛围就出来了✨',
        '  · 红金中式配圆桌席现场很有记忆点！',
      ])),
    ].join('\n'),
    [
      '三段式写作流程（按这个逻辑思考，但最终只返回 JSON）：',
      '/dbs-xhs-title 起标题：先给 10 个 title_candidates，分别覆盖收藏参考、审美建议、画面细节、备婚提醒、情绪共鸣、场地季节、摄影画面、布置细节这几类，不要同一个开头换词。',
      '/dbs-hook 优化开头：hook 用一句话点中画面里更容易被客户记住的元素，不要空喊高级、梦幻、绝了。',
      '/dbs-content 写/诊断正文：body 只写一篇完整笔记正文，客户复制后能直接发；写完自查一次，删掉极限词、工具词、销售话术和看不见的元素。',
    ].join('\n'),
    [
      '禁用标题（命中任何一条都算失败）：',
      '- 这场婚礼的标题文案可以这样写',
      '- 这场婚礼太美了 / 这场婚礼太适合拍电影感了',
      '- 婚礼现场高级感拉满 / 婚礼现场的高级感',
      '- 香槟色布幔和水晶吊灯打造梦幻通道',
      '- 香槟色布幔搭配水晶吊灯梦幻近婚区',
      '- 水晶吊灯与香槟布幔营造浪漫氛围',
      '- 这组婚礼分镜很适合做视频 / 专业分镜解析',
      '- 每一场婚礼都是独一无二的 / 尽显浪漫细节',
      '- 任何"看完...我又想重办婚礼/办婚礼"句式',
      '- 任何只是把颜色和物件塞进同一个爆款模板、但看不出具体现场记忆点的标题',
      '- 任何包含 AI、分镜、九宫格、生成、提示词、模型 等技术字眼的标题',
      ...(isCompareMode ? [
        '⚠️ 对比类模式额外禁用（命中即不合格）：',
        '- 任何"看完...我又想重办婚礼"句式（这是普通晒图模板，跟对比主题无关）',
        '- 任何"...也太温柔了/美到/绝了/出片了"这种纯氛围词收尾、完全不点对比主题的标题',
        '- 任何只夸花艺/灯光/氛围、看不出"两张图对比"关系的标题',
        '- 必须复查：标题里有没有「布置前/布置后/前后对比/反差/同一场地/空场」中至少 1 个词？没有就重写。',
      ] : []),
    ].join('\n'),
    [
      '正文要求（不是分镜解说，是内容平台图文正文）：',
      '- 主正文 body 写 2-4 段，总长 200-400 个中文字符。',
      '- 第一段：点出 3-4 个图里真实可见的具体元素（具体颜色名、花种或花型、灯光形态、桌景细节、布幔/拱门/通道、舞台/仪式区结构），让客户能看出你真的看过图。',
      '- 第二段：根据画面判断它适合什么调性的客户（如轻法式、新中式宫廷、复古港风、北欧森系、户外草坪、暮色礼堂等），或者推荐怎么落地参考、什么季节/场地拍出来更好看。',
      '- 第三段（可选）：一句话自然收尾，写明这种调性适合谁参考、哪一处值得收藏、为什么有记忆点，严禁出现"留言、私信、交流、联系我、咨询、定制、欢迎、按你的场地预算"等带销售感或求互动的话术；像真实策划师发完案例后顺手补一句感慨，不是引流文案。',
      '- 禁止出现：高级感拉满、氛围感拉满、每一场婚礼都、独一无二、内容获客、案例获客、本次生成、这组图、这次先看 等套话。',
      '- 不要输出多个视角版本，不要写评论区互动引导，不要让客户二次选择；body 就是一篇可以复制直接发布的完整笔记正文。',
    ].join('\n'),
    [
      '话题要求：',
      '- 10 个，字符串数组，每个以 # 开头；宁可少于 10 个也不要超过。',
      '- 至少 6 个要直接绑定画面元素，例如 #香槟色婚礼、#莫兰迪绿婚礼、#水晶吊灯婚礼、#绿植拱门、#红金中式 等。',
      '- 泛标签 #婚礼策划 #婚礼灵感 #备婚 这类最多保留 1-2 个。',
      '- 不要英文话题，不要重复。',
    ].join('\n'),
    '返回格式（严格 JSON，不要 markdown，不要解释文字，不要 ```代码块```）：{"title":"...","title_candidates":["...10个标题..."],"hook":"...","body":"...","tags":["#...10个标签..."],"visual_keywords":["..."]}',
    'visual_keywords 写 4-6 个上一步默念出来的中文画面元素，方便后端核对。',
  ].join('\n\n');
}

async function requestPublishCopy(job, messages, fallback, providedRecentTitles = null) {
  const recentTitles = Array.isArray(providedRecentTitles) ? providedRecentTitles : await recentCopyTitles();
  const body = {
    model: COPY_MODEL,
    temperature: 0.92,
    max_tokens: 1000,
    messages,
  };

  const response = await fetch(COPY_API_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(COPY_REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || text || `HTTP ${response.status}`;
    throw new Error(message);
  }

  const content = payload?.choices?.[0]?.message?.content || payload?.output_text || payload?.content || '';
  const parsed = typeof content === 'string' ? extractJsonObject(content) : content;
  return normalizeCopy(parsed, fallback, { seed: job.id, recentTitles, mode: job.mode });
}

async function generatePublishCopy(job, images, outputDir) {
  const fallback = createCopy(job.mode);
  if (!USE_COPY_API) {
    job.logs.push('[copy-fallback] 文案接口未启用，使用本地爆款文案模板');
    return fallback;
  }
  const recentTitles = await recentCopyTitles();

  const systemMessage = {
    role: 'system',
    content: [
      '你是婚礼策划公司和婚礼影像团队的内容平台主理人，专门写真实婚礼案例的爆款图文。',
      '所有输出必须使用简体中文，禁止出现任何英文单词（连话题标签也不要英文）。',
      '工作流程严格按这个顺序：1) 先仔细看用户上传的婚礼现场图；2) 在心里列出 5-8 个画面里真实可见的元素（具体颜色名、花种/花艺形态、灯光、布幔/吊顶、舞台/通道/桌景结构、道具材质等）；3) 才能写标题、正文、话题。',
      '硬性规则：只能描述图片里真实能看见的元素，绝对不要凭空编造画面里没有的颜色、花种、道具、灯光、场地结构；看不清的细节宁可不写。',
      '不要编造新人故事、酒店名称、价格、地点、品牌；语气要像真实笔记，温柔、有画面感，不要像广告，不要太官方。',
      '标题必须像真实婚礼团队/客户发布的内容平台爆款，必须包含至少 1 个具体颜色词或具体物件名（不能只用"婚礼/现场/氛围/高级感/出片"这种空词凑数）。',
      '标题要有强钩子和收藏理由，优先使用“被...戳中、像电影截图、存进备婚夹、原来、备婚、出片、值得收藏、现场记忆点、落地效果”等口语化但具体的结构；标题不加空格，可以用 1 个小红书感情绪符号或表情，例如 ！、～、🥹、✨；本版本先不要使用“谁懂啊”“真的太会了”“拉满”“别乱堆”“这样才耐看”“看完...我又想重办婚礼”这类重复度高的句式；严禁写成空间设计说明或销售介绍。',
      '合规要求：标题、正文、话题都不要出现极限词或绝对承诺，包括：最、一定、绝对、保证、必须、唯一、第一、顶级、极致、完美、无敌、天花板、封神、全网、100%、百分百、不踩雷、不会踩雷、零风险、必看。',
      '严禁写"专业分镜解析""浪漫细节""高级感拉满""每一场婚礼都""独一无二"等空话套话。',
      '严禁出现：AI、人工智能、模型、提示词、接口、参数、分镜、九宫格、图生视频、生成图片、生成失败、本次生成、本地兜底 等任何带工具感或技术感的字眼。',
      '严禁用"这次/这组/这套图"这种带工具口吻的指代，要像真实策划师在分享自己刚结束的一场婚礼案例。',
      '只返回严格的 JSON，不要 Markdown 代码块，不要解释，不要前后缀文字。',
    ].join(' '),
  };
  const instruction = buildCopyInstruction(job, images, recentTitles);

  try {
    const imageParts = await buildCopyImageParts(job, images, outputDir);
    if (imageParts.length) {
      const copy = await requestPublishCopy(job, [
        systemMessage,
        {
          role: 'user',
          content: [
            { type: 'text', text: instruction },
            ...imageParts,
          ],
        },
      ], fallback, recentTitles);
      job.logs.push(`[copy-api] 已根据婚礼图片生成爆款标题文案：${COPY_MODEL}`);
      return copy;
    }
  } catch (error) {
    job.logs.push(`[copy-retry] 看图写文案失败，改用文字上下文：${error.message || 'unknown error'}`);
  }

  try {
    const copy = await requestPublishCopy(job, [
      systemMessage,
      { role: 'user', content: instruction },
    ], fallback, recentTitles);
    job.logs.push(`[copy-api] 已生成爆款标题文案：${COPY_MODEL}`);
    return copy;
  } catch (error) {
    job.logs.push(`[copy-fallback] 文案接口暂不可用，使用本地文案：${error.message || 'unknown error'}`);
    return fallback;
  }
}

function formatCopyForText(copy) {
  const tags = Array.isArray(copy?.tags) ? copy.tags.filter(Boolean) : [];
  const sections = [
    copy?.title || '',
  ];
  if (copy?.body) {
    sections.push(copy.body);
  }
  if (tags.length) {
    sections.push(tags.join(' '));
  }
  return sections.filter(Boolean).join('\n\n');
}

async function createDownloadPackage(job, outputDir, images, collageUrl, copy) {
  updateJob(job, 98, '正在打包发布素材', collageUrl ? '[package] 写入单图、爆款首图和文案' : '[package] 写入单图和文案');

  const copyText = `${formatCopyForText(copy)}\n`;
  const zipFilename = job.mode === 'cinematic_storyboard'
    ? 'wedscene-storyboard-package.zip'
    : (job.mode === 'copy_title'
      ? 'wedscene-copywriting-package.zip'
      : (job.mode === 'setup_comparison'
        ? 'wedscene-setup-before-after-package.zip'
        : (job.mode === 'design_render_scene'
            ? 'wedscene-design-render-scene-package.zip'
            : (job.mode === 'venue_fusion' ? 'wedscene-venue-fusion-package.zip' : 'wedscene-viral-post-package.zip'))));
  const entries = [
    ...images.map((image, index) => ({
      file: image.filename,
      name: `images/${String(index + 1).padStart(2, '0')}-${image.label || 'image'}.jpg`,
    })),
    { buffer: Buffer.from(copyText, 'utf8'), name: 'copywriting.txt' },
  ];
  if (collageUrl) {
    entries.splice(-1, 0, {
      file: collageUrl.split('/').pop(),
      name: job.mode === 'cinematic_storyboard'
        ? 'cinematic-storyboard.jpg'
        : (job.mode === 'setup_comparison'
          ? 'setup-before-after.jpg'
          : 'viral-cover.jpg'),
    });
  }

  await createZipArchive(outputDir, entries, zipFilename);
  return publicUrl(job.id, zipFilename);
}

async function saveJobResource(job, outputDir, images, collageUrl, zipUrl, copy, motion = null) {
  const resourceId = `${Date.now().toString(36)}-${job.id}`;
  const resourceDir = path.join(RESOURCES_DIR, resourceId);
  await mkdir(resourceDir, { recursive: true });

  for (const image of images) {
    await copyResourceFile(outputDir, resourceDir, image.filename);
  }

  const collageFilename = collageUrl ? path.basename(collageUrl) : '';
  const zipFilename = zipUrl ? path.basename(zipUrl) : '';
  if (collageFilename) await copyResourceFile(outputDir, resourceDir, collageFilename);
  if (zipFilename) await copyResourceFile(outputDir, resourceDir, zipFilename);

  let videoFilename = '';
  let motionPosterFilename = '';
  if (motion?.videoFilename) {
    await copyResourceFile(outputDir, resourceDir, motion.videoFilename);
    videoFilename = motion.videoFilename;
  }
  // 同时把 motion-source.jpg 当作视频海报保存（前端 video poster 用）
  if (motion && existsSync(path.join(outputDir, 'motion-source.jpg'))) {
    await copyResourceFile(outputDir, resourceDir, 'motion-source.jpg');
    motionPosterFilename = 'motion-source.jpg';
  }
  if (motion) {
    for (let index = 2; index <= motionReferenceLimitForModel(); index += 1) {
      await copyResourceFile(outputDir, resourceDir, `motion-reference-${index}.jpg`);
    }
    await copyResourceFile(outputDir, resourceDir, 'motion-reference-guard.txt');
    await copyResourceFile(outputDir, resourceDir, 'motion-prompt.txt');
  }

  const copyFilename = 'copywriting.txt';
  const copyText = `${formatCopyForText(copy)}\n`;
  await writeFile(path.join(resourceDir, copyFilename), copyText, 'utf8');

  const resource = {
    id: resourceId,
    jobId: job.id,
    ownerId: job.ownerId || '',
    ownerLogin: job.ownerLogin || '',
    tenantId: job.tenantId || '',
    tenantSlug: job.tenantSlug || '',
    mode: job.mode,
    modeLabel: MODE_LABELS[job.mode] || job.mode,
    title: copy.title || MODE_LABELS[job.mode] || '婚礼素材',
    createdAt: new Date().toISOString(),
    provider: ACTIVE_PROVIDER,
    images: images.map(({ label, filename, width, height }) => ({
      label,
      filename,
      width,
      height,
    })),
    collageFilename,
    zipFilename,
    copyFilename,
    copy,
    videoFilename,
    motionPosterFilename,
    motionStyle: motion?.style || '',
    motionStyleLabel: motion?.styleLabel || '',
    durationSeconds: motion?.durationSeconds || 0,
  };

  const resources = await readResourceManifest();
  resources.unshift(resource);
  await writeResourceManifest(resources.slice(0, 80));
  return withResourceUrls(resource);
}

async function processJob(job, { resume = false } = {}) {
  job.cancelRequested = false;
  job.cancelReason = '';
  ensureJobAbortController(job);
  job.status = 'running';
  job.error = null;
  queueJobLedgerSnapshot(job);
  const outputDir = path.join(GENERATED_DIR, job.id);

  try {
    await mkdir(outputDir, { recursive: true });

    if (!resume || !job.reference) {
      const referenceLimit = imageReferenceLimitForJob(job);
      const uploadedFiles = (job.files?.length ? job.files : [job.file])
        .filter((file) => file?.buffer)
        .slice(0, referenceLimit);
      if (!uploadedFiles.length) throw new Error('任务缺少参考图，请重新上传后生成');
      if (isVenueFusionMode(job.mode) && uploadedFiles.length < 2) {
        throw new Error('空地婚礼融合需要同时上传空地照片和婚礼素材图');
      }
      updateJob(job, 12, '正在读取图片信息', '[input] 图片校验通过');

      const references = [];
      for (let index = 0; index < uploadedFiles.length; index += 1) {
        const file = uploadedFiles[index];
        const referenceImage = await sharp(file.buffer)
          .rotate()
          .resize(REFERENCE_IMAGE_MAX_EDGE, REFERENCE_IMAGE_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: REFERENCE_IMAGE_QUALITY })
          .toBuffer({ resolveWithObject: true });
        const referenceBuffer = referenceImage.data;
        const filename = index === 0 ? 'reference.jpg' : `reference-${index + 1}.jpg`;
        const reference = {
          buffer: referenceBuffer,
          mimetype: 'image/jpeg',
          filename: file.originalname || filename,
          storedFilename: filename,
          width: referenceImage.info.width,
          height: referenceImage.info.height,
          role: index === 0 ? 'main_scene' : 'detail_reference',
        };
        references.push(reference);
        await writeFile(path.join(outputDir, filename), referenceBuffer);
        job.logs.push(`[input] ${referenceLogLabel(job, index)}已优化为 ${Math.round(referenceBuffer.length / 1024)}KB，尺寸 ${referenceImage.info.width}x${referenceImage.info.height}`);
      }
      job.reference = references[0];
      if (job.mode === 'motion_video') {
        job.motionReferences = references;
      }
      if (isVenueFusionMode(job.mode)) {
        job.fusionReferences = references;
        job.referenceComposite = await createVenueFusionReferenceBoard(job, outputDir, references);
        job.logs.push('[input] 已保留双图独立参考：图1=空地/空场，图2=婚礼素材；参考板仅用于排查，不参与生图');
      }
      updateJob(job, 18, `已确认模式：${MODE_LABELS[job.mode]}`, `[mode] ${MODE_LABELS[job.mode]}`);
    } else {
      const { completed, total } = getResumeInfo(job);
      updateJob(job, Math.max(job.progress || 18, 22 + completed * 10), `自动继续生成：${completed}/${total} 已完成`, `[resume] 已保留 ${completed}/${total} 张，自动继续生成剩余图片`);
    }

    const existingImages = job.partialImages || [];
    let images = [];
    let collageUrl = '';
    let motionResult = null;

    throwIfJobCancelled(job);
    if (job.mode === 'motion_video') {
      motionResult = await generateMotionVideo(job, outputDir);
      throwIfJobCancelled(job);
    } else if (job.mode === 'copy_title') {
      updateJob(job, 72, '正在根据婚礼图片写标题文案', '[copy] 不生成图片，直接根据上传现场照写标题、正文和话题');
    } else {
      images = USE_XIAOJI
        ? await generateWithXiaoji(job, outputDir, existingImages)
        : (USE_OPENAI_COMPAT ? await generateWithOpenAI(job, outputDir, existingImages) : await generateMockImages(job, outputDir, existingImages));
      throwIfJobCancelled(job);
      collageUrl = await createCollage(job, outputDir, images);
    }

    throwIfJobCancelled(job);
    let copy;
    let zipUrl = '';
    if (job.mode === 'motion_video') {
      // 视频模式跳过文案、collage、zip
      copy = createCopy('motion_video');
      updateJob(job, 96, '正在保存到我的资源', '[resource] 正在写入视频资源');
    } else {
      updateJob(job, 96, '正在生成爆款标题文案', '[copy] 正在生成标题、正文和话题');
      copy = await generatePublishCopy(job, images, outputDir);
      throwIfJobCancelled(job);
      zipUrl = await createDownloadPackage(job, outputDir, images, collageUrl, copy);
      updateJob(job, 99, '正在保存到我的资源', '[resource] 正在写入我的资源，方便客户查看保存');
    }

    const resource = await saveJobResource(job, outputDir, images, collageUrl, zipUrl, copy, motionResult);
    const collageFilename = collageUrl ? collageUrl.split('/').pop() : '';
    const zipFilename = zipUrl ? zipUrl.split('/').pop() : '';
    job.result = {
      mode: job.mode,
      images,
      items: images.map(({ label, url, filename, downloadUrl, width, height }) => ({ label, url, filename, downloadUrl, width, height })),
      collageUrl,
      collageDownloadUrl: collageFilename ? downloadUrl(job.id, collageFilename) : '',
      zipUrl,
      zipDownloadUrl: zipFilename ? downloadUrl(job.id, zipFilename) : '',
      copy,
      resource,
      mock: ACTIVE_PROVIDER === 'mock' || (motionResult?.mock === true),
      provider: ACTIVE_PROVIDER,
      videoUrl: motionResult?.videoFilename ? publicUrl(job.id, motionResult.videoFilename) : '',
      videoDownloadUrl: motionResult?.videoFilename ? downloadUrl(job.id, motionResult.videoFilename) : '',
      videoPosterUrl: motionResult ? publicUrl(job.id, 'motion-source.jpg') : '',
      motionStyle: motionResult?.style || '',
      motionStyleLabel: motionResult?.styleLabel || '',
      durationSeconds: motionResult?.durationSeconds || 0,
      resolution: motionResult?.resolution || '',
    };
    job.status = 'completed';
    const doneStage = job.mode === 'motion_video'
      ? '连续转场视频已生成'
      : (job.mode === 'copy_title'
        ? '标题文案已生成'
        : (job.mode === 'design_render_scene'
          ? '实景候选图已生成'
          : (job.mode === 'venue_fusion' ? '空地婚礼融合图已生成' : '爆款图文已生成')));
    const doneLog = job.mode === 'motion_video'
      ? '[done] 连续转场视频已就绪，并已自动保存到我的资源'
      : (job.mode === 'copy_title'
          ? '[done] 标题文案已就绪，并已自动保存到我的资源'
          : (job.mode === 'design_render_scene'
            ? '[done] 设计图转实景候选图已就绪，并已自动保存到我的资源'
            : (job.mode === 'venue_fusion'
              ? '[done] 空地婚礼融合图已就绪，并已自动保存到我的资源'
              : '[done] 爆款图文素材已就绪，并已自动保存到我的资源')));
    updateJob(job, 100, doneStage, doneLog);
  } catch (error) {
    if (isJobCancelledError(error) || job.cancelRequested) {
      job.status = 'cancelled';
      job.error = job.cancelReason || error.message || '任务已停止';
      const { completed, total } = getResumeInfo(job);
      if (completed === 0) await refundJobCharge(job, job.error);
      job.stage = completed > 0
        ? `已停止生成，已保留 ${completed}/${total} 张，未提交后续图片`
        : '已停止生成，未提交后续图片';
      job.logs.push(`[cancelled] ${job.stage}`);
      return;
    }
    job.status = 'failed';
    if (job.mode === 'motion_video') {
      console.error('[motion-job-error] job=' + job.id + ' ' + String(error?.stack || error?.message || error).replace(/\s+/g, ' ').slice(0, 1600));
    }
    job.error = cleanUserErrorMessage(error.message || '生成失败');
    const { completed, total } = getResumeInfo(job);
    const canResume = getResumeInfo(job).canResume;
    const refundedUser = !canResume ? await refundJobCharge(job, job.error) : null;
    job.stage = completed > 0
      ? `生成中断：已保留 ${completed}/${total} 张，系统将自动继续处理`
      : (refundedUser ? '生成失败，未生成图片，已自动退回点数' : '生成失败，请重试或切换演示模式');
    job.logs.push(`[error] ${job.error}`);
  } finally {
    delete job.file;
    delete job.files;
    try {
      await writeJobLedgerSnapshot(job);
    } catch (error) {
      console.warn(`[jobs] failed to persist final job ${job.id}: ${error.message}`);
    }
  }
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    openaiEnabled: ACTIVE_PROVIDER !== 'mock',
    provider: ACTIVE_PROVIDER !== 'mock' ? 'api' : 'mock',
    imageProvider: ACTIVE_PROVIDER,
    imageModel: ACTIVE_MODEL,
    imageInputMode: USE_N1N ? N1N_IMAGE_INPUT_MODE : (ACTIVE_PROVIDER === 'xiaoji' ? XIAOJI_IMAGE_INPUT_MODE : 'mock'),
    copyEnabled: USE_COPY_API,
    referenceImageEnabled: USE_OPENAI_COMPAT || (ACTIVE_PROVIDER === 'xiaoji' && XIAOJI_IMAGE_INPUT_MODE === 'edit') || !!XIAOJI_REFERENCE_FIELD,
    referenceMode: ACTIVE_PROVIDER === 'xiaoji' ? XIAOJI_IMAGE_INPUT_MODE : (USE_OPENAI_COMPAT ? 'edit' : 'mock'),
    accessRequired: ACCOUNT_SYSTEM_ENABLED || !!PUBLIC_ACCESS_CODE,
    accountRequired: ACCOUNT_SYSTEM_ENABLED,
  });
});

function publicMotionConfig() {
  return {
    pointCost: MOTION_POINT_COST,
    durationSeconds: MOTION_VIDEO_DURATION,
    resolution: MOTION_VIDEO_RESOLUTION,
    referenceLimit: motionReferenceLimitForModel(),
    publicBaseConfigured: !!PUBLIC_BASE_URL,
    mockMode: USE_MOCK_MOTION_VIDEO,
    styles: Object.entries(MOTION_STYLES).map(([key, info]) => ({
      key,
      label: info.label,
      description: info.description,
    })),
  };
}

function publicSupportContacts(tenant = null) {
  const tenantContacts = Array.isArray(tenant?.supportContacts)
    ? tenant.supportContacts
        .map((item) => ({
          wechat: String(item?.wechat || item?.id || '').trim(),
          qr: publicAbsoluteUrl(item?.qr || item?.qrUrl || ''),
          label: String(item?.label || '').trim(),
        }))
        .filter((item) => item.wechat || item.qr)
    : [];
  if (tenantContacts.length) return tenantContacts;

  const primaryWechat = String(tenant?.supportWechat || SUPPORT_WECHAT || '').trim();
  const primaryQr = publicAbsoluteUrl(tenant?.supportWechatQr || SUPPORT_WECHAT_QR || '');
  const secondaryWechat = String(tenant?.supportWechat2 || SUPPORT_WECHAT_2 || '').trim();
  const secondaryQr = publicAbsoluteUrl(tenant?.supportWechatQr2 || SUPPORT_WECHAT_QR_2 || '');
  return [
    { wechat: primaryWechat, qr: primaryQr },
    { wechat: secondaryWechat, qr: secondaryQr },
  ].filter((item) => item.wechat || item.qr);
}

function rechargePlanProfile(priceValue) {
  return RECHARGE_PLAN_PROFILES.find((profile) => Math.abs(profile.price - priceValue) < 0.01) || {};
}

function parseRechargePlan(plan, index = 0) {
  const [rawPrice, rawPoints] = String(plan || '').split('=');
  const priceText = String(rawPrice || '').trim();
  const pointsText = String(rawPoints || '').trim();
  const price = Number(priceText.match(/[\d.]+/)?.[0] || 0);
  const points = Number(pointsText.match(/\d+/)?.[0] || 0);
  const profile = rechargePlanProfile(price);
  const textGenerations = TEXT_POINT_COST > 0 ? Math.floor(points / TEXT_POINT_COST) : points;
  const singleImageGenerations = JOB_POINT_COST > 0 ? Math.floor(points / JOB_POINT_COST) : points;
  const sixImageGenerations = SIX_IMAGE_POINT_COST > 0 ? Math.floor(points / SIX_IMAGE_POINT_COST) : points;
  const motionGenerations = MOTION_POINT_COST > 0 ? Math.floor(points / MOTION_POINT_COST) : 0;
  const imageUnitCost = price && sixImageGenerations ? price / (sixImageGenerations * 6) : 0;
  const motionUnitCost = price && motionGenerations ? price / motionGenerations : 0;
  const idBase = `${priceText}-${pointsText}`.replace(/[^\w\u4e00-\u9fa5.-]+/g, '-').replace(/^-+|-+$/g, '');
  return {
    id: idBase || `plan-${index + 1}`,
    name: profile.name || `${priceText || '自定义'}套餐`,
    priceText,
    price,
    pointsText,
    points,
    badge: profile.badge || '',
    description: profile.description || '',
    featured: !!profile.featured,
    durationDays: Number(profile.durationDays || 0),
    durationText: profile.durationText || '',
    imageGenerations: singleImageGenerations,
    textGenerations,
    singleImageGenerations,
    sixImageGenerations,
    imageUnitCost,
    motionGenerations,
    motionUnitCost,
  };
}

function publicRechargePlans() {
  return RECHARGE_PLANS.split(';')
    .map((plan, index) => parseRechargePlan(plan, index))
    .filter((plan) => plan.priceText && plan.pointsText && plan.points > 0);
}

function localDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || '00';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function publicLedgerEntry(entry) {
  return {
    id: entry.id,
    login: entry.login,
    tenantId: entry.tenantId || '',
    tenantSlug: entry.tenantSlug || '',
    type: entry.type,
    points: Number(entry.points || 0),
    balanceAfter: Number(entry.balanceAfter || 0),
    note: entry.note || '',
    jobId: entry.jobId || '',
    planId: entry.planId || '',
    planName: entry.planName || '',
    amount: Number(entry.amount || 0),
    channel: entry.channel || '',
    durationDays: Number(entry.durationDays || 0),
    durationText: entry.durationText || '',
    membershipExpiresAt: entry.membershipExpiresAt || '',
    previousMembershipExpiresAt: entry.previousMembershipExpiresAt || '',
    createdAt: entry.createdAt,
  };
}

function accountStats(store) {
  const users = Array.isArray(store.users) ? store.users : [];
  const ledger = Array.isArray(store.ledger) ? store.ledger : [];
  const today = localDateKey();
  const todayRows = ledger.filter((entry) => entry.createdAt && localDateKey(new Date(entry.createdAt)) === today);
  const sumBy = (rows, predicate) => rows.reduce((sum, entry) => predicate(entry) ? sum + Number(entry.points || 0) : sum, 0);
  const activeUsers = users.filter((user) => user.status !== 'disabled');
  return {
    totalUsers: users.length,
    activeUsers: activeUsers.length,
    totalBalance: users.reduce((sum, user) => sum + Number(user.points || 0), 0),
    todayNewUsers: users.filter((user) => user.createdAt && localDateKey(new Date(user.createdAt)) === today).length,
    todayRechargePoints: sumBy(todayRows, (entry) => Number(entry.points || 0) > 0 && /recharge|trial/.test(String(entry.type || ''))),
    todayConsumedPoints: Math.abs(sumBy(todayRows, (entry) => Number(entry.points || 0) < 0)),
    todayRefundPoints: sumBy(todayRows, (entry) => entry.type === 'refund'),
    todayLedgerCount: todayRows.length,
  };
}

app.get('/api/site-context', async (req, res) => {
  res.json(await siteContextPayload(req));
});

app.get('/api/access', async (req, res) => {
  const context = await siteContextPayload(req);
  const tenant = context.tenant;
  if (ACCOUNT_SYSTEM_ENABLED) {
    const user = await sessionUser(req);
    res.json({
      ...context,
      required: true,
      accountRequired: true,
      ok: !!user,
      user: publicUser(user),
      pointCost: JOB_POINT_COST,
      pointCosts: publicPointCosts(),
      trialPoints: TRIAL_POINTS,
      supportWechat: tenant.supportWechat,
      supportWechatQr: tenant.supportWechatQr,
      supportContacts: tenant.supportContacts,
      rechargePlans: RECHARGE_PLANS,
      rechargePlanItems: publicRechargePlans(),
      motion: publicMotionConfig(),
    });
    return;
  }
  res.json({
    ...context,
    required: !!PUBLIC_ACCESS_CODE,
    accountRequired: false,
    ok: hasAccess(req),
    pointCost: 0,
    pointCosts: publicPointCosts(),
    supportWechat: tenant.supportWechat,
    supportWechatQr: tenant.supportWechatQr,
    supportContacts: tenant.supportContacts,
    motion: publicMotionConfig(),
  });
});

app.post('/api/access', async (req, res) => {
  const context = await siteContextPayload(req);
  if (ACCOUNT_SYSTEM_ENABLED) {
    const login = normalizeLogin(req.body?.login);
    const code = String(req.body?.code || '').trim();
    if (!login || !code) {
      res.status(400).json({ error: '请输入账号和登录码' });
      return;
    }
    const user = await authenticateAccount(login, code);
    if (!user) {
      res.status(401).json({ error: '账号或登录码不正确' });
      return;
    }
    res.setHeader('Set-Cookie', accountCookie(`${user.id}.${accountToken(user)}`, ACCESS_COOKIE_MAX_AGE_SECONDS, req));
    const loginContext = await siteContextPayload(req, { tenantId: user.tenantId || context.tenant?.id || '' });
    res.json({
      ...loginContext,
      ok: true,
      required: true,
      accountRequired: true,
      user: publicUser(user),
      pointCost: JOB_POINT_COST,
      pointCosts: publicPointCosts(),
      motion: publicMotionConfig(),
    });
    return;
  }

  if (!PUBLIC_ACCESS_CODE) {
    res.json({ ...context, ok: true, required: false });
    return;
  }

  const code = String(req.body?.code || '').trim();
  if (!safeEqualText(code, PUBLIC_ACCESS_CODE)) {
    res.status(401).json({ error: '访问码不正确' });
    return;
  }

  res.setHeader('Set-Cookie', accessCookie(accessToken(), req));
  res.json({ ...context, ok: true, required: true });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', accountCookie('', 0, req));
  res.json({ ok: true });
});

app.post('/api/account/register', async (req, res) => {
  if (!ACCOUNT_SYSTEM_ENABLED) {
    res.status(404).json({ error: '注册功能未开启' });
    return;
  }
  const login = normalizeLogin(req.body?.login);
  const code = String(req.body?.code || '').trim();
  const name = displayAccountName(String(req.body?.name || '').trim().slice(0, 20), login);
  const role = String(req.body?.role || req.body?.source || '').trim().slice(0, 30);
  const tenant = await resolveTenant(req);
  const tenantContext = publicTenant(tenant);
  const tenantId = tenant ? String(tenant.id || '').trim() : '';
  const tenantSlug = tenant ? tenantContext.slug : '';

  if (!/^1[3-9]\d{9}$/.test(login) && !/^[a-zA-Z0-9_]{4,32}$/.test(login)) {
    res.status(400).json({ error: '请输入有效的 11 位手机号或 4-32 位账号名' });
    return;
  }
  if (code.length < 6 || code.length > 32) {
    res.status(400).json({ error: '密码需 6-32 位' });
    return;
  }

  const ip = clientIp(req);
  if (!checkRegisterRate(ip)) {
    res.status(429).json({ error: `IP 注册过于频繁，请 1 小时后再试（每 IP 限 ${REGISTER_IP_LIMIT} 个）` });
    return;
  }

  const existing = await readUserStore();
  if (existing.users.some((u) => u.login === login)) {
    res.status(409).json({ error: '该账号已注册，请直接登录或重置密码' });
    return;
  }

  const now = new Date().toISOString();
  const result = await mutateUserStore((store) => {
    const user = {
      id: newId('user'),
      login,
      name,
      points: Math.max(0, TRIAL_POINTS),
      status: 'active',
      role: role || '',
      tenantId,
      tenantSlug,
      invitedByTenantId: tenantId,
      registerIp: ip,
      codeHash: hashLoginCode(login, code),
      sessionVersion: 1,
      createdAt: now,
      updatedAt: now,
    };
    store.users.unshift(user);
    store.ledger.unshift({
      id: newId('ledger'),
      userId: user.id,
      login: user.login,
      type: 'self_register_trial',
      points: user.points,
      balanceAfter: user.points,
      note: role ? `自助注册赠送 · 身份：${role}` : '自助注册赠送试用点数',
      jobId: '',
      tenantId,
      tenantSlug,
      createdAt: now,
    });
    return { user };
  });

  res.setHeader('Set-Cookie', accountCookie(`${result.user.id}.${accountToken(result.user)}`, ACCESS_COOKIE_MAX_AGE_SECONDS, req));
  res.json({
    ok: true,
    user: publicUser(result.user),
    tenant: tenantContext,
    defaultTenant: !tenant,
    partner: tenantSlug,
    pointCost: JOB_POINT_COST,
    pointCosts: publicPointCosts(),
    message: `注册成功，赠送 ${TRIAL_POINTS} 点试用`,
  });
});

app.get('/api/account/ledger', requireAccess, async (req, res) => {
  if (!ACCOUNT_SYSTEM_ENABLED || !req.user) {
    res.status(404).json({ error: '账号系统未开启' });
    return;
  }
  const limit = Math.max(1, Math.min(80, Number(req.query.limit || 20)));
  const store = await readUserStore();
  const user = store.users.find((item) => item.id === req.user.id) || req.user;
  const ledger = store.ledger
    .filter((entry) => entry.userId === user.id || entry.login === user.login)
    .slice(0, limit)
    .map(publicLedgerEntry);
  res.json({
    user: publicUser(user),
    ledger,
    rechargePlans: publicRechargePlans(),
    pointCosts: publicPointCosts(),
  });
});

app.get('/api/admin/accounts', requireAdmin, async (_req, res) => {
  const store = await readUserStore();
  res.json({
    accounts: store.users.map(publicUser),
    ledger: store.ledger.slice(0, 160).map(publicLedgerEntry),
    rechargePlans: publicRechargePlans(),
    stats: accountStats(store),
  });
});

app.get('/api/admin/tenants', requireAdmin, async (_req, res) => {
  const store = await readTenantStore();
  res.json({ tenants: store.tenants.map(publicAdminTenant) });
});

app.post('/api/admin/tenants', requireAdmin, async (req, res) => {
  const now = new Date().toISOString();
  const slug = normalizeTenantSlug(req.body?.slug || req.body?.name || '');
  if (!slug) {
    res.status(400).json({ error: 'tenant slug is required' });
    return;
  }
  const tenant = await mutateTenantStore((store) => {
    if (store.tenants.some((item) => normalizeTenantSlug(item.slug || item.id) === slug)) {
      const error = new Error('tenant slug already exists');
      error.status = 409;
      throw error;
    }
    const item = {
      id: String(req.body?.id || '').trim() || newId('tenant'),
      slug,
      name: String(req.body?.name || req.body?.brandName || slug).trim(),
      status: String(req.body?.status || 'active').trim(),
      plan: String(req.body?.plan || 'affiliate').trim(),
      logoUrl: String(req.body?.logoUrl || req.body?.logo || '').trim(),
      logoText: String(req.body?.logoText || req.body?.shortName || '').trim(),
      tagline: String(req.body?.tagline || '').trim(),
      brandColor: String(req.body?.brandColor || '').trim(),
      supportWechat: String(req.body?.supportWechat || '').trim(),
      supportWechatQr: String(req.body?.supportWechatQr || '').trim(),
      domains: parseTenantDomains(req.body?.domains),
      adminUserIds: Array.isArray(req.body?.adminUserIds) ? req.body.adminUserIds.map(String).filter(Boolean) : [],
      createdAt: now,
      updatedAt: now,
    };
    store.tenants.unshift(item);
    return item;
  });
  res.status(201).json({ ok: true, tenant: publicAdminTenant(tenant) });
});

app.patch('/api/admin/tenants/:id', requireAdmin, async (req, res) => {
  const tenantKey = String(req.params.id || '').trim();
  const now = new Date().toISOString();
  const tenant = await mutateTenantStore((store) => {
    const item = store.tenants.find((tenantItem) => String(tenantItem.id || '') === tenantKey
      || normalizeTenantSlug(tenantItem.slug || tenantItem.id) === normalizeTenantSlug(tenantKey));
    if (!item) {
      const error = new Error('tenant not found');
      error.status = 404;
      throw error;
    }
    const nextSlug = req.body?.slug == null ? normalizeTenantSlug(item.slug || item.id) : normalizeTenantSlug(req.body.slug);
    if (!nextSlug) {
      const error = new Error('tenant slug is required');
      error.status = 400;
      throw error;
    }
    if (store.tenants.some((tenantItem) => tenantItem !== item && normalizeTenantSlug(tenantItem.slug || tenantItem.id) === nextSlug)) {
      const error = new Error('tenant slug already exists');
      error.status = 409;
      throw error;
    }
    item.slug = nextSlug;
    for (const key of ['name', 'status', 'plan', 'logoUrl', 'logoText', 'tagline', 'brandColor', 'supportWechat', 'supportWechatQr']) {
      if (req.body?.[key] != null) item[key] = String(req.body[key] || '').trim();
    }
    if (req.body?.domains != null) item.domains = parseTenantDomains(req.body.domains);
    if (req.body?.adminUserIds != null) item.adminUserIds = Array.isArray(req.body.adminUserIds) ? req.body.adminUserIds.map(String).filter(Boolean) : [];
    item.updatedAt = now;
    return item;
  });
  res.json({ ok: true, tenant: publicAdminTenant(tenant) });
});

app.post('/api/admin/accounts', requireAdmin, async (req, res) => {
  const login = normalizeLogin(req.body?.login);
  if (!login) {
    res.status(400).json({ error: '请输入客户账号或手机号' });
    return;
  }
  const now = new Date().toISOString();
  const inputCode = String(req.body?.code || '').trim() || generateLoginCode();
  const initialPoints = Number.isFinite(Number(req.body?.points)) ? Number(req.body.points) : TRIAL_POINTS;
  const name = displayAccountName(String(req.body?.name || login).trim(), login);
  const tenant = await resolveTenant(req);
  const tenantContext = publicTenant(tenant);
  const tenantId = tenant ? String(tenant.id || '').trim() : '';
  const tenantSlug = tenant ? tenantContext.slug : '';
  const tenantRole = tenantId && String(req.body?.tenantRole || '').trim() === 'tenant_admin' ? 'tenant_admin' : '';

  const result = await mutateUserStore((store) => {
    let user = store.users.find((item) => item.login === login);
    const isNew = !user;
    if (!user) {
      user = {
        id: newId('user'),
        login,
        name,
        points: 0,
        status: 'active',
        tenantId,
        tenantSlug,
        tenantRole,
        createdAt: now,
        updatedAt: now,
        sessionVersion: 1,
      };
      store.users.unshift(user);
    }
    user.name = name;
    user.status = String(req.body?.status || user.status || 'active');
    if (tenantId) {
      user.tenantId = tenantId;
      user.tenantSlug = tenantSlug;
      if (tenantRole) user.tenantRole = tenantRole;
    }
    user.codeHash = hashLoginCode(login, inputCode);
    user.sessionVersion = Number(user.sessionVersion || 1);
    if (isNew) {
      user.points = Math.max(0, initialPoints);
      store.ledger.unshift({
        id: newId('ledger'),
        userId: user.id,
        login: user.login,
        type: 'trial',
        points: user.points,
        balanceAfter: user.points,
        note: req.body?.note || '新账号试用点数',
        jobId: '',
        tenantId: user.tenantId || '',
        tenantSlug: user.tenantSlug || '',
        createdAt: now,
      });
    }
    user.updatedAt = now;
    return { user: { ...user }, isNew };
  });

  res.json({
    ok: true,
    account: publicUser(result.user),
    tenant: tenantContext,
    defaultTenant: !tenant,
    partner: tenantSlug,
    loginCode: inputCode,
    created: result.isNew,
  });
});

app.post('/api/admin/recharge', requireAdmin, async (req, res) => {
  const login = normalizeLogin(req.body?.login);
  const plans = publicRechargePlans();
  const requestedPlanId = String(req.body?.planId || '').trim();
  const selectedPlan = plans.find((plan) => plan.id === requestedPlanId || plan.priceText === requestedPlanId);
  const points = selectedPlan ? selectedPlan.points : Number(req.body?.points);
  if (!login || !Number.isFinite(points) || points === 0) {
    res.status(400).json({ error: '请输入客户账号和要增加的点数' });
    return;
  }
  const store = await readUserStore();
  const user = store.users.find((item) => item.login === login && item.status !== 'disabled');
  if (!user) {
    res.status(404).json({ error: '客户账号不存在' });
    return;
  }
  const note = req.body?.note || (selectedPlan
    ? `套餐充值：${selectedPlan.name} ${selectedPlan.priceText} / ${selectedPlan.pointsText}`
    : (points > 0 ? '管理员手动充值' : '管理员手动扣点'));
  const meta = selectedPlan ? {
    planId: selectedPlan.id,
    planName: selectedPlan.name,
    amount: selectedPlan.price,
    channel: 'manual',
    durationDays: selectedPlan.durationDays,
    durationText: selectedPlan.durationText,
  } : {};
  meta.tenantId = user.tenantId || '';
  meta.tenantSlug = user.tenantSlug || '';
  const result = await adjustUserPoints(user.id, points, points > 0 ? 'manual_recharge' : 'manual_adjustment', note, '', meta);
  res.json({ ok: true, account: publicUser(result.user), ledger: result.entry });
});

app.get('/api/resources', requireAccess, async (req, res) => {
  const resources = await readResourceManifest();
  res.json({ resources: resources.filter((resource) => canSeeOwnedItem(req, resource)).map(withResourceUrls) });
});

app.get('/api/resources/:id', requireAccess, async (req, res) => {
  const resources = await readResourceManifest();
  const resource = resources.find((item) => item.id === req.params.id);
  if (!resource) {
    res.status(404).json({ error: '资源不存在或已被删除' });
    return;
  }
  if (!requireOwner(req, res, resource)) return;
  res.json(withResourceUrls(resource));
});

app.delete('/api/resources/:id', requireAccess, async (req, res) => {
  const resourceId = path.basename(req.params.id || '');
  if (!resourceId) {
    res.status(400).json({ error: '资源参数不完整' });
    return;
  }

  const resources = await readResourceManifest();
  const resourceIndex = resources.findIndex((item) => item.id === resourceId);
  if (resourceIndex === -1) {
    res.status(404).json({ error: '资源不存在或已被删除' });
    return;
  }

  const resource = resources[resourceIndex];
  if (!requireOwner(req, res, resource)) return;

  resources.splice(resourceIndex, 1);
  await writeResourceManifest(resources);
  await deleteSavedResource(resourceId);
  res.json({ ok: true, id: resourceId });
});

// 基于资源库的图直接生成连续转场视频（不再需要重新上传）
app.post('/api/resources/:id/motion-video', requireAccess, express.json(), async (req, res) => {
  const resourceId = path.basename(req.params.id || '');
  if (!resourceId) {
    res.status(400).json({ error: '资源参数不完整' });
    return;
  }

  const resources = await readResourceManifest();
  const resource = resources.find((item) => item.id === resourceId);
  if (!resource) {
    res.status(404).json({ error: '资源不存在或已被删除' });
    return;
  }
  if (!requireOwner(req, res, resource)) return;

  const requestedFilename = path.basename(String(req.body?.filename || '').trim());
  const resourceFilenames = (resource.images || []).map((img) => img.filename).filter(Boolean);
  const validFilename = resourceFilenames.includes(requestedFilename);
  if (!requestedFilename || !validFilename) {
    res.status(400).json({ error: '请选择资源中的有效图片' });
    return;
  }
  const detailFilenames = (Array.isArray(req.body?.reference_filenames) ? req.body.reference_filenames : [])
    .map((name) => path.basename(String(name || '').trim()))
    .filter((name) => name && name !== requestedFilename && resourceFilenames.includes(name))
    .slice(0, motionReferenceLimitForModel() - 1);
  const selectedFilenames = [requestedFilename, ...detailFilenames];

  const motionStyle = normalizeMotionStyleKey(req.body?.motion_style || req.body?.motionStyle || '');
  if (motionStyle && !MOTION_STYLES[motionStyle]) {
    res.status(400).json({ error: '未知的运镜风格' });
    return;
  }

  const resourceFiles = [];
  try {
    for (const filename of selectedFilenames) {
      const sourcePath = path.join(RESOURCES_DIR, resourceId, filename);
      if (!existsSync(sourcePath)) {
        res.status(404).json({ error: `资源图片不存在或已被删除：${filename}` });
        return;
      }
      const buffer = await readFile(sourcePath);
      resourceFiles.push({
        buffer,
        originalname: filename,
        mimetype: filename.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg',
        size: buffer.length,
      });
    }
  } catch (error) {
    res.status(500).json({ error: '资源图片读取失败' });
    return;
  }

  const fakeFile = resourceFiles[0];

  const baseCost = pointCostForMode('motion_video');
  const pointCost = ACCOUNT_SYSTEM_ENABLED ? Math.max(0, baseCost) : 0;
  try {
    await assertMotionVideoServiceReady();
  } catch (error) {
    res.status(error.status || 503).json({
      error: error.message || '视频接口暂不可用，请稍后重试',
      pointCost,
    });
    return;
  }

  const tenant = await resolveTenant(req, { tenantId: resource.tenantId || req.user?.tenantId || '' });
  const tenantContext = publicTenant(tenant);
  const jobTenantId = resource.tenantId || (tenant ? String(tenant.id || '').trim() : '') || req.user?.tenantId || '';
  const jobTenantSlug = resource.tenantSlug || (tenant ? tenantContext.slug : '') || req.user?.tenantSlug || '';

  let chargedUser = req.user;
  const job = createJob('motion_video', fakeFile, req.user, {
    motionStyle,
    files: resourceFiles,
    tenantId: jobTenantId,
    tenantSlug: jobTenantSlug,
  });
  job.sourceResourceId = resourceId;
  job.sourceResourceFilename = requestedFilename;
  job.logs.push(`[source] 取自资源库 ${resourceId} 的 ${requestedFilename}`);
  if (detailFilenames.length) {
    job.logs.push(`[source] 后续镜头图：${detailFilenames.join(', ')}（按顺序作为中段/收尾镜头参与连续转场）`);
  }

  if (pointCost > 0) {
    try {
      const noteSuffix = job.motionStyle ? ` · ${MOTION_STYLES[job.motionStyle]?.label || job.motionStyle}` : '';
      chargedUser = await chargeJobPoints(job, req.user.id, pointCost, `生成：${MODE_LABELS.motion_video}${noteSuffix}（资源库）`);
    } catch (error) {
      jobs.delete(job.id);
      res.status(error.status || 402).json({
        error: error.message || '点数不足，请联系管理员充值',
        balance: error.balance ?? req.user?.points ?? 0,
        pointCost,
      });
      return;
    }
  }
  res.status(202).json({
    id: job.id,
    status: job.status,
    user: publicUser(chargedUser),
    tenant: tenant ? tenantContext : null,
    partner: jobTenantSlug,
    pointCost,
  });
  processJob(job);
});

app.post('/api/jobs', requireAccess, upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'wedding_image', maxCount: 1 },
  { name: 'images', maxCount: motionReferenceLimitForModel() },
]), async (req, res) => {
  if (DISABLED_MODES.has(String(req.body?.mode || ''))) {
    res.status(410).json({ error: '该功能已下架，请选择其他生成模式' });
    return;
  }
  const mode = assertMode(req.body.mode);
  const motionStyle = req.body.motion_style || req.body.motionStyle || '';
  const isMotion = mode === 'motion_video';
  const isFusion = isVenueFusionMode(mode);
  const rawUploadedImages = isMotion
    ? [
      ...(req.files?.images || []),
      ...(req.files?.image || []),
    ]
    : (isFusion
      ? [
        ...(req.files?.image || []),
        ...(req.files?.wedding_image || []),
        ...(req.files?.images || []),
      ]
      : [
        ...(req.files?.image || []),
        ...(req.files?.images || []),
      ]);
  const primaryFile = rawUploadedImages[0];
  if (!primaryFile) {
    res.status(400).json({ error: '请上传婚礼现场照片或设计图' });
    return;
  }
  if (isFusion && rawUploadedImages.length < 2) {
    res.status(400).json({ error: '请同时上传空地照片和婚礼素材图' });
    return;
  }

  const uploadedImages = rawUploadedImages.slice(0, imageReferenceLimitForJob({ mode }));
  const baseCost = pointCostForMode(mode);
  const pointCost = ACCOUNT_SYSTEM_ENABLED ? Math.max(0, baseCost) : 0;
  if (isMotion) {
    try {
      await assertMotionVideoServiceReady();
    } catch (error) {
      res.status(error.status || 503).json({
        error: error.message || '视频接口暂不可用，请稍后重试',
        pointCost,
      });
      return;
    }
  }
  const tenant = await resolveTenant(req);
  const tenantContext = publicTenant(tenant);
  const jobTenantId = tenant ? String(tenant.id || '').trim() : (req.user?.tenantId || '');
  const jobTenantSlug = tenant ? tenantContext.slug : (req.user?.tenantSlug || '');

  let chargedUser = req.user;
  const job = createJob(mode, primaryFile, req.user, {
    motionStyle,
    files: uploadedImages,
    tenantId: jobTenantId,
    tenantSlug: jobTenantSlug,
  });
  if (pointCost > 0) {
    try {
      const noteSuffix = isMotion && job.motionStyle ? ` · ${MOTION_STYLES[job.motionStyle]?.label || job.motionStyle}` : '';
      chargedUser = await chargeJobPoints(job, req.user.id, pointCost, `生成：${MODE_LABELS[mode]}${noteSuffix}`);
    } catch (error) {
      jobs.delete(job.id);
      res.status(error.status || 402).json({
        error: error.message || '点数不足，请联系管理员充值',
        balance: error.balance ?? req.user?.points ?? 0,
        pointCost,
      });
      return;
    }
  }
  res.status(202).json({
    id: job.id,
    status: job.status,
    user: publicUser(chargedUser),
    tenant: tenant ? tenantContext : null,
    partner: jobTenantSlug,
    pointCost,
  });
  processJob(job);
});

app.post('/api/motion-prompt-preview', requireAccess, upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'images', maxCount: motionReferenceLimitForModel() },
]), async (req, res) => {
  const uploadedImages = [
    ...(req.files?.images || []),
    ...(req.files?.image || []),
  ].slice(0, motionReferenceLimitForModel());

  if (!uploadedImages.length) {
    res.status(400).json({ error: `请上传 1-${motionReferenceLimitForModel()} 张婚礼现场照片` });
    return;
  }
  if (!USE_COPY_API) {
    res.status(503).json({ error: 'Gemini 提示词整理模型未配置或未启用' });
    return;
  }

  try {
    const sourceImages = await Promise.all(uploadedImages.map((file) => sharp(file.buffer)
      .rotate()
      .resize(MOTION_VIDEO_REFERENCE_MAX_EDGE, MOTION_VIDEO_REFERENCE_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: MOTION_VIDEO_REFERENCE_QUALITY })
      .toBuffer()));
    const prompt = await buildMotionDirectorPrompt({
      sourceImages,
      endpoint: COPY_API_ENDPOINT,
      apiKey: OPENAI_API_KEY,
      model: MOTION_DIRECTOR_MODEL,
      durationSeconds: MOTION_VIDEO_DURATION,
      maxReferences: motionReferenceLimitForModel(),
      timeoutMs: MOTION_DIRECTOR_PROMPT_TIMEOUT_MS,
      maxTokens: MOTION_DIRECTOR_PROMPT_MAX_TOKENS,
      visionMaxEdge: COPY_VISION_MAX_EDGE,
      visionImageQuality: COPY_VISION_IMAGE_QUALITY,
    });
    res.json({
      ok: true,
      model: MOTION_DIRECTOR_MODEL,
      referenceCount: sourceImages.length,
      prompt,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Gemini 提示词整理失败' });
  }
});

app.post('/api/jobs/:id/resume', requireAccess, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: '任务不存在，请重新上传后生成' });
    return;
  }
  if (ACCOUNT_SYSTEM_ENABLED && job.ownerId !== req.user.id) {
    res.status(404).json({ error: '任务不存在，请重新上传后生成' });
    return;
  }

  if (job.status === 'running' || job.status === 'queued') {
    res.status(409).json({ error: '任务正在生成中，请稍等' });
    return;
  }

  if (job.status === 'completed') {
    res.status(200).json({ id: job.id, status: job.status });
    return;
  }

  const { canResume, completed, total } = getResumeInfo(job);
  if (!canResume) {
    res.status(410).json({ error: '这个任务不能继续，请重新上传后生成' });
    return;
  }

  job.status = 'queued';
  job.error = null;
  job.result = null;
  job.logs.push(`[resume] 系统自动继续生成，当前已完成 ${completed}/${total} 张`);
  res.status(202).json({ id: job.id, status: job.status, partialImages: job.partialImages || [] });
  processJob(job, { resume: true });
});

app.post('/api/jobs/:id/cancel', requireAccess, async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: '任务不存在，请重新上传后生成' });
    return;
  }
  if (ACCOUNT_SYSTEM_ENABLED && job.ownerId !== req.user.id) {
    res.status(404).json({ error: '任务不存在，请重新上传后生成' });
    return;
  }

  if (job.status === 'completed') {
    res.status(409).json({ error: '任务已完成，不能停止' });
    return;
  }
  if (job.status === 'cancelled') {
    res.json({ id: job.id, status: job.status, partialImages: job.partialImages || [], user: publicUser(req.user) });
    return;
  }

  cancelJob(job, '用户已停止生成，未提交后续图片');
  if (job.status !== 'running' && job.status !== 'queued') {
    job.status = 'cancelled';
    job.error = job.cancelReason;
    job.stage = job.partialImages?.length
      ? `已停止生成，已保留 ${job.partialImages.length}/${SHOT_PLANS[job.mode]?.length || 0} 张，未提交后续图片`
      : '已停止生成，未提交后续图片';
    if (!job.partialImages?.length) await refundJobCharge(job, job.error);
  } else {
    job.stage = '正在停止生成，已阻止后续图片提交';
  }
  res.json({
    id: job.id,
    status: job.status,
    stage: job.stage,
    partialImages: job.partialImages || [],
    user: publicUser(req.user),
  });
});

app.get('/api/jobs/:id', requireAccess, async (req, res) => {
  const job = await knownJobForAccess(req.params.id);
  if (!job) {
    res.status(404).json({ error: '任务不存在' });
    return;
  }
  if (ACCOUNT_SYSTEM_ENABLED && job.ownerId !== req.user.id) {
    res.status(404).json({ error: '任务不存在' });
    return;
  }
  res.json({
    id: job.id,
    mode: job.mode,
    status: job.status,
    progress: job.progress,
    stage: publicJobStage(job),
    logs: publicJobLogs(job),
    partialImages: job.partialImages || [],
    result: localizePublicResultUrls(job.result),
    error: publicJobError(job),
    canResume: getResumeInfo(job).canResume,
    retryable: isTransientJobError(job.error || ''),
    canCancel: job.status === 'queued' || job.status === 'running',
    user: publicUser(req.user),
  });
});

app.get('/api/download/:jobId/:filename', requireAccess, async (req, res) => {
  const filename = path.basename(req.params.filename || '');
  const jobId = path.basename(req.params.jobId || '');
  if (!filename || !jobId) {
    res.status(400).json({ error: '下载参数不完整' });
    return;
  }
  const job = await knownJobForAccess(jobId);
  if (ACCOUNT_SYSTEM_ENABLED && (!job || job.ownerId !== req.user.id)) {
    res.status(404).json({ error: '文件不存在或已过期，请重新生成' });
    return;
  }

  const filePath = path.join(GENERATED_DIR, jobId, filename);
  if (!existsSync(filePath)) {
    res.status(404).json({ error: '文件不存在或已过期，请重新生成' });
    return;
  }

  res.type(path.extname(filename));
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
  res.setHeader('Content-Length', statSync(filePath).size);
  createReadStream(filePath).pipe(res);
});

app.get('/api/resources/:id/download/:filename', requireAccess, async (req, res) => {
  const resourceId = path.basename(req.params.id || '');
  const filename = path.basename(req.params.filename || '');
  if (!resourceId || !filename) {
    res.status(400).json({ error: '下载参数不完整' });
    return;
  }

  if (ACCOUNT_SYSTEM_ENABLED) {
    const resources = await readResourceManifest();
    const resource = resources.find((item) => item.id === resourceId);
    if (!resource) {
      res.status(404).json({ error: '资源文件不存在' });
      return;
    }
    if (!requireOwner(req, res, resource)) return;
  }

  const filePath = path.join(RESOURCES_DIR, resourceId, filename);
  if (!existsSync(filePath)) {
    res.status(404).json({ error: '资源文件不存在' });
    return;
  }

  res.type(path.extname(filename));
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
  res.setHeader('Content-Length', statSync(filePath).size);
  createReadStream(filePath).pipe(res);
});

// 公开签名路由：仅供 n1n.ai/上游视频供应商拉取视频源图（无 cookie 鉴权）。
// 安全：需要 HMAC 签名 token，仅对 motion-source.jpg 生效，30 分钟过期。
app.get('/api/motion/source/:token', (req, res) => {
  const verified = verifyMotionSourceToken(req.params.token);
  if (!verified) {
    res.status(403).json({ error: '签名无效或已过期' });
    return;
  }
  const filePath = path.join(GENERATED_DIR, verified.jobId, verified.filename || 'motion-source.jpg');
  if (!existsSync(filePath)) {
    res.status(404).json({ error: '源图未就绪' });
    return;
  }
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=300');
  createReadStream(filePath).pipe(res);
});

app.get('/generated/:jobId/:filename', requireAccess, async (req, res) => {
  const filename = path.basename(req.params.filename || '');
  const jobId = path.basename(req.params.jobId || '');
  const job = await knownJobForAccess(jobId);
  if (ACCOUNT_SYSTEM_ENABLED && (!job || job.ownerId !== req.user.id)) {
    res.status(404).json({ error: '文件不存在或已过期，请重新生成' });
    return;
  }
  const filePath = path.join(GENERATED_DIR, jobId, filename);
  if (!filename || !jobId || !existsSync(filePath)) {
    res.status(404).json({ error: '文件不存在或已过期，请重新生成' });
    return;
  }
  streamInlineFile(res, filePath, filename);
});

app.get('/my-resources/:id/:filename', requireAccess, async (req, res) => {
  const resourceId = path.basename(req.params.id || '');
  const filename = path.basename(req.params.filename || '');
  if (!resourceId || !filename) {
    res.status(400).json({ error: '资源参数不完整' });
    return;
  }
  if (ACCOUNT_SYSTEM_ENABLED) {
    const resources = await readResourceManifest();
    const resource = resources.find((item) => item.id === resourceId);
    if (!resource) {
      res.status(404).json({ error: '资源文件不存在' });
      return;
    }
    if (!requireOwner(req, res, resource)) return;
  }
  const filePath = path.join(RESOURCES_DIR, resourceId, filename);
  if (!existsSync(filePath)) {
    res.status(404).json({ error: '资源文件不存在' });
    return;
  }
  streamInlineFile(res, filePath, filename);
});

const SENSITIVE_PUBLIC_PATH_RE = /^\/(?:\.env(?:[./]|$)|\.data(?:\/|$)|node_modules(?:\/|$)|server\.mjs$|package(?:-lock)?\.json$)/i;

app.use((req, res, next) => {
  if (SENSITIVE_PUBLIC_PATH_RE.test(req.path)) {
    res.status(404).type('text/plain').send('Not found');
    return;
  }
  next();
});

app.use(express.static(STATIC_ROOT, {
  setHeaders: (res, filePath) => {
    // 关键 HTML / JS / CSS 不缓存，避免迭代时拿到旧版本
    if (/\.(html|js|css)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  },
}));

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(STATIC_ROOT, 'admin.html'));
});

app.get('/login', (_req, res) => {
  res.sendFile(path.join(STATIC_ROOT, 'login.html'));
});

app.get('/terms', (_req, res) => {
  res.sendFile(path.join(STATIC_ROOT, 'terms.html'));
});

app.get('/privacy', (_req, res) => {
  res.sendFile(path.join(STATIC_ROOT, 'privacy.html'));
});

app.get(/.*/, (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(STATIC_ROOT, 'index.html'));
});

setInterval(async () => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [id, job] of jobs.entries()) {
    if (job.createdAt < cutoff) {
      jobs.delete(id);
      await rm(path.join(GENERATED_DIR, id), { recursive: true, force: true });
    }
  }
}, 30 * 60 * 1000).unref();

setInterval(() => {
  reconcileAbandonedJobCharges('interval').catch((error) => {
    console.warn(`[jobs] interval reconciliation failed: ${error.message}`);
  });
}, Math.max(60_000, ABANDONED_JOB_REFUND_GRACE_MS)).unref();

await mkdir(GENERATED_DIR, { recursive: true });
await mkdir(RESOURCES_DIR, { recursive: true });
try {
  await reconcileAbandonedJobCharges('startup');
  await reconcileLegacyMotionRefunds('startup');
} catch (error) {
  console.warn(`[jobs] startup reconciliation failed: ${error.message}`);
}
app.listen(PORT, () => {
  console.log(`WedScene AI server running at http://127.0.0.1:${PORT}`);
  if (USE_XIAOJI) {
    console.log(`Image API: xiaoji ${XIAOJI_IMAGE_MODEL}`);
  } else if (USE_OPENAI_COMPAT) {
    console.log(`Image API: ${OPENAI_PROVIDER_LABEL} ${OPENAI_MODEL}${OPENAI_BASE_URL ? ` via ${OPENAI_BASE_URL}` : ''}`);
    if (USE_N1N) console.log(`n1n image input mode: ${N1N_IMAGE_INPUT_MODE} (edit=${N1N_IMAGE_EDIT_ENDPOINT}, generations=${N1N_IMAGE_GENERATIONS_ENDPOINT})`);
  } else {
    console.log('Image API: mock mode (set XIAOJI_API_KEY or OPENAI_API_KEY for real generation)');
  }
console.log(USE_COPY_API ? `Copy API: ${COPY_MODEL} via ${COPY_API_ENDPOINT}` : 'Copy API: local fallback');
console.log(USE_COPY_API ? `Motion Director API: ${MOTION_DIRECTOR_MODEL} via ${COPY_API_ENDPOINT}` : 'Motion Director API: local fallback');
  if (USE_MOCK_MOTION_VIDEO) {
    const reason = FORCE_MOCK_MOTION ? 'MOTION_VIDEO_FORCE_MOCK=true' : (!HAS_MOTION_VIDEO_KEY ? '未配置视频 API Key' : (USE_MOCK_IMAGES ? 'USE_MOCK_IMAGES=true' : '未配置 PUBLIC_BASE_URL'));
    console.log(`Motion Video: mock mode（${reason}），将使用 assets/motion-demo.mp4 占位`);
  } else {
    const modelNote = MOTION_VIDEO_REQUEST_MODEL === MOTION_VIDEO_MODEL ? MOTION_VIDEO_MODEL : `${MOTION_VIDEO_MODEL} -> ${MOTION_VIDEO_REQUEST_MODEL}`;
    console.log(`Motion Video: ${modelNote} via ${MOTION_VIDEO_ENDPOINT}（PUBLIC_BASE_URL=${PUBLIC_BASE_URL}）`);
  }
  if (MOTION_WATERMARK_REMOVE) {
    console.log(`Watermark Remove: enabled · ffmpeg=${FFMPEG_BIN} · box=${MOTION_WATERMARK_BOX}`);
  } else {
    console.log('Watermark Remove: disabled (MOTION_WATERMARK_REMOVE=false)');
  }
});

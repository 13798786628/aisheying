import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { appendFile, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { execFile } from 'node:child_process';
import { request as httpsRequest } from 'node:https';
import { promisify } from 'node:util';
import OpenAI, { toFile } from 'openai';
import sharp from 'sharp';
import ffmpegStatic from 'ffmpeg-static';
import opentype from 'opentype.js';
import { writePsdBuffer } from 'ag-psd';
import { buildMotionDirectorPrompt } from './lib/motion-prompt-director.mjs';
import {
  expiresAtFromCreatedAt,
  planResourceRetention,
  resourceRetentionSettings,
} from './lib/resource-retention.mjs';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEDDING_STYLE_RULES_PATH = path.join(__dirname, 'wedding_style_rules.json');

function loadWeddingStyleRules() {
  try {
    const payload = JSON.parse(readFileSync(WEDDING_STYLE_RULES_PATH, 'utf8'));
    const styles = Array.isArray(payload?.styles) ? payload.styles : [];
    return { ...payload, styles };
  } catch (error) {
    console.warn(`[wedding-style] failed to load wedding_style_rules.json: ${error.message}`);
    return { version: 'missing', styles: [], global_rules: {}, recognition_schema: {} };
  }
}

const WEDDING_STYLE_RULES = loadWeddingStyleRules();
const WEDDING_STYLE_RULE_BY_ID = new Map(
  WEDDING_STYLE_RULES.styles.map((rule) => [String(rule.id || '').trim(), rule]).filter(([id]) => id),
);

function listFromValue(value, limit = 8) {
  const items = Array.isArray(value) ? value : String(value || '').split(/[,\n;；、]/);
  return [...new Set(items
    .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean))]
    .slice(0, limit);
}

function compactWeddingStyleRuleCatalog() {
  return WEDDING_STYLE_RULES.styles.map((rule) => [
    `id=${rule.id}`,
    `name=${rule.name}`,
    `aliases=${listFromValue(rule.aliases, 8).join('/')}`,
    `xhs_tags=${listFromValue(rule.xhs_tags, 8).join('/')}`,
    `palette=${listFromValue(rule.palette, 8).join('/')}`,
    `venue=${listFromValue(rule.venue_signals, 5).join('/')}`,
    `stage=${listFromValue(rule.stage_signals, 5).join('/')}`,
    `layout=${listFromValue(rule.layout_rules, 4).join('/')}`,
    `xhs_popular=${listFromValue(rule.xhs_popularity_signals, 4).join('/')}`,
    `failures=${listFromValue(rule.failure_patterns, 4).join('/')}`,
    `must_keep=${listFromValue(rule.must_keep, 6).join('/')}`,
    `avoid=${listFromValue(rule.avoid, 6).join('/')}`,
  ].join(' | ')).join('\n');
}

function findWeddingStyleRule(styleId = '', styleName = '') {
  const id = String(styleId || '').trim();
  if (WEDDING_STYLE_RULE_BY_ID.has(id)) return WEDDING_STYLE_RULE_BY_ID.get(id);
  const name = String(styleName || '').trim();
  if (!name) return null;
  return WEDDING_STYLE_RULES.styles.find((rule) => {
    const aliases = listFromValue(rule.aliases, 20);
    return rule.name === name || aliases.includes(name) || aliases.some((alias) => name.includes(alias) || alias.includes(name));
  }) || null;
}

function normalizeWeddingStyleProfile(rawProfile = null) {
  const profile = rawProfile && typeof rawProfile === 'object' ? rawProfile : {};
  const rule = findWeddingStyleRule(profile.style_id, profile.style_name);
  const confidence = Math.max(0, Math.min(1, Number(profile.confidence || 0)));
  return {
    style_id: rule?.id || String(profile.style_id || 'unknown_domestic_wedding').trim(),
    style_name: rule?.name || String(profile.style_name || '国内婚礼风格').trim(),
    confidence,
    style_tags: listFromValue(profile.style_tags || rule?.xhs_tags, 8),
    palette: listFromValue(profile.palette || rule?.palette, 8),
    venue_type: String(profile.venue_type || '').replace(/\s+/g, ' ').trim(),
    stage_type: String(profile.stage_type || '').replace(/\s+/g, ' ').trim(),
    aisle_type: String(profile.aisle_type || '').replace(/\s+/g, ' ').trim(),
    spatial_layout: String(profile.spatial_layout || '').replace(/\s+/g, ' ').trim(),
    materials: listFromValue(profile.materials || rule?.materials, 8),
    floral_language: String(profile.floral_language || rule?.floral_language || '').replace(/\s+/g, ' ').trim(),
    lighting_mood: String(profile.lighting_mood || rule?.lighting_mood || '').replace(/\s+/g, ' ').trim(),
    layout_rules: listFromValue(rule?.layout_rules, 10),
    xhs_popularity_signals: listFromValue(rule?.xhs_popularity_signals, 10),
    failure_patterns: listFromValue(rule?.failure_patterns, 10),
    must_keep: listFromValue(profile.must_keep || rule?.must_keep, 8),
    can_extend: listFromValue(profile.can_extend || rule?.can_extend, 8),
    avoid: listFromValue(profile.avoid || rule?.avoid, 10),
    rule_positive_prompt: String(rule?.positive_prompt || '').replace(/\s+/g, ' ').trim(),
    rule_negative_prompt: String(rule?.negative_prompt || '').replace(/\s+/g, ' ').trim(),
  };
}

function fallbackWeddingStyleProfile(reason = '') {
  return {
    style_id: 'unknown_domestic_wedding',
    style_name: '国内婚礼通用同款风格',
    confidence: 0,
    style_tags: ['国内婚礼审美', '同款婚礼延伸'],
    palette: [],
    venue_type: '',
    stage_type: '',
    aisle_type: '',
    spatial_layout: '',
    materials: [],
    floral_language: '',
    lighting_mood: '',
    layout_rules: listFromValue(WEDDING_STYLE_RULES.global_rules?.chinese_t_stage_grammar, 10),
    xhs_popularity_signals: [],
    failure_patterns: [],
    must_keep: [
      'uploaded image visible palette',
      'uploaded image venue type',
      'uploaded image material language',
      'uploaded image lighting mood',
      'uploaded image floral density',
      'uploaded image luxury level',
    ],
    can_extend: ['camera angle', 'aisle view', 'stage detail', 'welcome area', 'tablescape', 'floral rhythm'],
    avoid: listFromValue(WEDDING_STYLE_RULES.global_rules?.hard_avoid, 12),
    rule_positive_prompt: '',
    rule_negative_prompt: '',
    analysis_status: 'fallback',
    analysis_reason: reason,
  };
}

function loadLocalEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!existsSync(envPath)) return;
  const overrideLocalEnv = String(process.env.LOCAL_ENV_OVERRIDE ?? 'true').toLowerCase() !== 'false';

  for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (!key || (!overrideLocalEnv && Object.hasOwn(process.env, key))) continue;
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
const TENANT_ASSETS_DIR = path.join(DATA_DIR, 'tenant-assets');
const RESOURCES_MANIFEST = path.join(DATA_DIR, 'resources-manifest.json');
const RESOURCE_CLEANUP_LOG = path.join(DATA_DIR, 'resource-cleanup-log.jsonl');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const TENANTS_FILE = path.join(DATA_DIR, 'tenants.json');
const JOB_LEDGER_FILE = path.join(DATA_DIR, 'job-ledger.json');
const SERVER_SECRETS_FILE = path.join(DATA_DIR, 'server-secrets.json');
const GEO_CERTIFICATIONS_FILE = path.join(DATA_DIR, 'geo-certifications.json');
const VOICE_INPUT_DIR = path.join(DATA_DIR, 'voice-inputs');
const RESOURCE_RETENTION = resourceRetentionSettings();
const RESOURCE_CLEANUP_INTERVAL_MS = Math.max(
  60 * 60 * 1000,
  Number(process.env.RESOURCE_CLEANUP_INTERVAL_MS || 24 * 60 * 60 * 1000),
);
const RESOURCE_CLEANUP_ON_STARTUP = !/^(0|false|no)$/i.test(process.env.RESOURCE_CLEANUP_ON_STARTUP || 'true');
const STATIC_ROOT = process.env.STATIC_ROOT
  ? path.resolve(process.env.STATIC_ROOT)
  : path.join(__dirname, 'dist');
const COMPARISON_LABEL_FONT = process.env.COMPARISON_LABEL_FONT
  ? path.resolve(process.env.COMPARISON_LABEL_FONT)
  : path.join(__dirname, 'assets', 'fonts', 'NotoSansSC-Bold.otf');
const VOICE_CLONE_API_BASE = String(process.env.VOICE_CLONE_API_BASE || process.env.GPT_SOVITS_API_BASE || '').trim().replace(/\/+$/, '');
const VOICE_CLONE_PROVIDER = String(process.env.VOICE_CLONE_PROVIDER || (VOICE_CLONE_API_BASE ? 'gpt-sovits' : 'disabled')).trim().toLowerCase();
const VOICE_CLONE_TTS_PATH = String(process.env.VOICE_CLONE_TTS_PATH || '/tts').trim() || '/tts';
const VOICE_CLONE_TIMEOUT_MS = Math.max(30_000, Number(process.env.VOICE_CLONE_TIMEOUT_MS || 180_000));
const VOICE_CLONE_MAX_AUDIO_BYTES = Math.max(1024 * 1024, Number(process.env.VOICE_CLONE_MAX_AUDIO_BYTES || 50 * 1024 * 1024));
const VOICE_CLONE_TEXT_LANG = String(process.env.VOICE_CLONE_TEXT_LANG || 'all_zh').trim().toLowerCase();
const VOICE_CLONE_PROMPT_LANG = String(process.env.VOICE_CLONE_PROMPT_LANG || VOICE_CLONE_TEXT_LANG).trim().toLowerCase();

function readServerSecrets() {
  try {
    const payload = JSON.parse(readFileSync(SERVER_SECRETS_FILE, 'utf8'));
    return payload && typeof payload === 'object' ? payload : {};
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn(`[security] failed to read persisted secrets: ${error.message}`);
    }
    return {};
  }
}

let serverSecrets = readServerSecrets();

function writeServerSecrets() {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(SERVER_SECRETS_FILE, JSON.stringify(serverSecrets, null, 2), 'utf8');
}

function getOrCreateServerSecret(key) {
  const existing = String(serverSecrets[key] || '').trim();
  if (existing) return existing;
  const next = randomBytes(32).toString('base64url');
  serverSecrets = {
    ...serverSecrets,
    [key]: next,
    updatedAt: new Date().toISOString(),
  };
  writeServerSecrets();
  console.warn(`[security] ${key} was missing; generated and saved it in ${SERVER_SECRETS_FILE}`);
  return next;
}

const OPENAI_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';
const IMAGE_QUALITY = process.env.OPENAI_IMAGE_QUALITY || 'high';
const FINAL_IMAGE_JPEG_QUALITY = Math.max(88, Math.min(100, Number(process.env.FINAL_IMAGE_JPEG_QUALITY || 95)));
const FINAL_BOARD_JPEG_QUALITY = Math.max(88, Math.min(100, Number(process.env.FINAL_BOARD_JPEG_QUALITY || 94)));
const FINAL_BOARD_CELL_JPEG_QUALITY = Math.max(88, Math.min(100, Number(process.env.FINAL_BOARD_CELL_JPEG_QUALITY || FINAL_BOARD_JPEG_QUALITY)));
const XIAOJI_IMAGE_ENDPOINT = process.env.XIAOJI_IMAGE_ENDPOINT || 'https://xiaoji.baziapi.site/v1/images/generations';
const XIAOJI_EDIT_ENDPOINT = process.env.XIAOJI_EDIT_ENDPOINT || XIAOJI_IMAGE_ENDPOINT.replace(/\/images\/generations\/?$/, '/images/edits');
const XIAOJI_API_KEY = process.env.XIAOJI_API_KEY || process.env.IMAGE_API_KEY || '';
const XIAOJI_IMAGE_MODEL = process.env.XIAOJI_IMAGE_MODEL || process.env.IMAGE_API_MODEL || 'gpt-image-2';
const XIAOJI_REFERENCE_FIELD = process.env.XIAOJI_REFERENCE_FIELD || '';
const XIAOJI_IMAGE_INPUT_MODE = (process.env.XIAOJI_IMAGE_INPUT_MODE || 'edit').toLowerCase();
const XIAOJI_EDIT_IMAGE_FIELD = process.env.XIAOJI_EDIT_IMAGE_FIELD || 'image';
const DEFAULT_IMAGE_SIZE = process.env.DEFAULT_IMAGE_SIZE || '1024x1024';
const STORYBOARD_IMAGE_SIZE = process.env.STORYBOARD_IMAGE_SIZE || '1536x864';
const CONSTRUCTION_CHECKLIST_IMAGE_SIZE = process.env.CONSTRUCTION_CHECKLIST_IMAGE_SIZE || '1088x1440';
const CONSTRUCTION_CHECKLIST_HD_WIDTH = Math.max(1536, Number(process.env.CONSTRUCTION_CHECKLIST_HD_WIDTH || 3072));
const CONSTRUCTION_CHECKLIST_DETAIL_EXPORTS = process.env.CONSTRUCTION_CHECKLIST_DETAIL_EXPORTS !== 'false';
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
const DEFAULT_IMAGE_PROVIDER = HAS_OPENAI_KEY
  ? (/n1n/i.test(`${process.env.N1N_API_KEY || ''} ${process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE || ''} ${process.env.OPENAI_PROVIDER_LABEL || ''}`) ? 'n1n' : 'openai')
  : 'mock';
const REQUESTED_IMAGE_PROVIDER = (process.env.IMAGE_PROVIDER || DEFAULT_IMAGE_PROVIDER).toLowerCase();
const IMAGE_PROVIDER = REQUESTED_IMAGE_PROVIDER === 'xiaoji' ? DEFAULT_IMAGE_PROVIDER : REQUESTED_IMAGE_PROVIDER;
const USE_N1N = IMAGE_PROVIDER === 'n1n' || IMAGE_PROVIDER === 'n1n.ai';
const USE_OPENAI_COMPAT = !USE_MOCK_IMAGES && (IMAGE_PROVIDER === 'openai' || USE_N1N) && HAS_OPENAI_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE || (USE_N1N ? 'https://api.n1n.ai/v1' : '');
const OPENAI_PROVIDER_LABEL = process.env.OPENAI_PROVIDER_LABEL || (USE_N1N ? 'n1n.ai' : 'OpenAI');
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '').trim();
const HAS_GEMINI_KEY = hasUsableSecret(GEMINI_API_KEY);
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';
const GEMINI_API_BASE = (process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1').replace(/\/$/, '');
const GEMINI_IMAGE_ENDPOINT = (process.env.GEMINI_IMAGE_ENDPOINT || '').trim();
const IMAGE_ENHANCE_MODEL = process.env.IMAGE_ENHANCE_MODEL || process.env.GEMINI_IMAGE_MODEL || (USE_N1N ? GEMINI_IMAGE_MODEL : OPENAI_MODEL);
const IMAGE_ENHANCE_PROVIDER = (process.env.IMAGE_ENHANCE_PROVIDER || '').toLowerCase();
const USE_GEMINI_IMAGE_ENHANCE = HAS_GEMINI_KEY && (IMAGE_ENHANCE_PROVIDER === 'gemini' || /^gemini-/i.test(IMAGE_ENHANCE_MODEL));
const N1N_IMAGE_EDIT_ENDPOINT = process.env.N1N_IMAGE_EDIT_ENDPOINT || `${OPENAI_BASE_URL.replace(/\/$/, '')}/images/edits`;
const N1N_IMAGE_INPUT_MODE = (process.env.N1N_IMAGE_INPUT_MODE || process.env.OPENAI_IMAGE_INPUT_MODE || 'auto').toLowerCase();
const N1N_STRICT_REFERENCE_FALLBACK = (process.env.N1N_STRICT_REFERENCE_FALLBACK || 'fail').toLowerCase();
const ALLOW_XIAOJI_IMAGE_PROVIDER = false;
const ALLOW_XIAOJI_IMAGE_FALLBACK = false;
const N1N_EDIT_IMAGE_FIELD = process.env.N1N_EDIT_IMAGE_FIELD || process.env.N1N_IMAGE_EDIT_FIELD || 'image';
const N1N_EDIT_MASK_FIELD = process.env.N1N_EDIT_MASK_FIELD || process.env.N1N_IMAGE_MASK_FIELD || 'mask';
// n1n.ai 兼容 /v1/images/generations，并扩展支持 JSON body 里塞 image=data:URI 做参考图（用于绕过 Cloudflare WAF 对 multipart 的拦截）
const N1N_IMAGE_GENERATIONS_ENDPOINT = process.env.N1N_IMAGE_GENERATIONS_ENDPOINT || `${OPENAI_BASE_URL.replace(/\/$/, '')}/images/generations`;
function parseEnvList(value = '') {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
function uniqueList(items = []) {
  return [...new Set(items.map((item) => String(item || '').trim()).filter(Boolean))];
}
const DEFAULT_N1N_IMAGE_FALLBACK_MODELS = USE_N1N ? ['gpt-image-2'] : [];
const OPENAI_IMAGE_MODELS = uniqueList([
  OPENAI_MODEL,
  ...parseEnvList(process.env.OPENAI_IMAGE_FALLBACK_MODELS),
  ...DEFAULT_N1N_IMAGE_FALLBACK_MODELS,
]);
const IMAGE_ENHANCE_IMAGE_MODELS = uniqueList([
  IMAGE_ENHANCE_MODEL,
  ...parseEnvList(process.env.IMAGE_ENHANCE_FALLBACK_MODELS),
]).filter((model) => /^gemini-/i.test(String(model || '').trim()));
if (!IMAGE_ENHANCE_IMAGE_MODELS.length) IMAGE_ENHANCE_IMAGE_MODELS.push(GEMINI_IMAGE_MODEL);
const IMAGE_ENHANCE_COMPAT_ENABLED = /^(1|true|yes)$/i.test(process.env.IMAGE_ENHANCE_ALLOW_COMPAT || '');
const IMAGE_ENHANCE_AVAILABLE = USE_GEMINI_IMAGE_ENHANCE
  || (IMAGE_ENHANCE_COMPAT_ENABLED && USE_OPENAI_COMPAT && IMAGE_ENHANCE_IMAGE_MODELS.length > 0);
const IMAGE_ENHANCE_UNAVAILABLE_MESSAGE = '画质升级需要配置官方 GEMINI_API_KEY；当前 llm-api/n1n 图片接口不支持 gemini-3.1-flash-image 的 2K/4K 带图生成。';
const XIAOJI_IMAGE_MODELS = uniqueList([
  XIAOJI_IMAGE_MODEL,
  ...parseEnvList(process.env.XIAOJI_IMAGE_FALLBACK_MODELS || process.env.IMAGE_API_FALLBACK_MODELS),
]);
const COPY_MODEL = process.env.COPY_MODEL || process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini';
const MOTION_DIRECTOR_MODEL = process.env.MOTION_DIRECTOR_MODEL || COPY_MODEL;
const DOUBAO_VIDEO_PROMPT_MODEL = process.env.DOUBAO_VIDEO_PROMPT_MODEL || MOTION_DIRECTOR_MODEL;
const COPY_API_ENDPOINT = process.env.COPY_API_ENDPOINT || (OPENAI_BASE_URL ? `${OPENAI_BASE_URL.replace(/\/$/, '')}/chat/completions` : '');
const COPY_REQUEST_TIMEOUT_MS = Number(process.env.COPY_REQUEST_TIMEOUT_MS || 120_000);
const CHAT_MODEL = process.env.CHAT_MODEL || process.env.OPENAI_CHAT_MODEL || 'gpt-5.5';
const CHAT_API_ENDPOINT = process.env.CHAT_API_ENDPOINT
  || (OPENAI_BASE_URL ? `${OPENAI_BASE_URL.replace(/\/$/, '')}/chat/completions` : 'https://llm-api.net/v1/chat/completions');
const CHAT_REQUEST_TIMEOUT_MS = Number(process.env.CHAT_REQUEST_TIMEOUT_MS || 180_000);
const CHAT_JSON_BODY_LIMIT = process.env.CHAT_JSON_BODY_LIMIT || process.env.CHAT_BODY_LIMIT || '32mb';
const CHAT_IMAGE_LIMIT = Math.max(1, Math.min(8, Number(process.env.CHAT_IMAGE_LIMIT || 6)));
const CHAT_IMAGE_MAX_DATA_URL_LENGTH = Math.max(100_000, Number(process.env.CHAT_IMAGE_MAX_DATA_URL_LENGTH || 4_000_000));
const CHAT_POINT_COST = Math.max(0, Number(process.env.CHAT_POINT_COST || 1));
const CHAT_MAX_HISTORY_MESSAGES = Math.max(2, Math.min(40, Number(process.env.CHAT_MAX_HISTORY_MESSAGES || 24)));
const CHAT_MAX_TOKENS = Math.max(256, Math.min(8000, Number(process.env.CHAT_MAX_TOKENS || 2400)));
const CHAT_TEMPERATURE = Number.isFinite(Number(process.env.CHAT_TEMPERATURE))
  ? Math.max(0, Math.min(2, Number(process.env.CHAT_TEMPERATURE)))
  : 0.7;
const DEFAULT_CHAT_SYSTEM_PROMPT = process.env.CHAT_SYSTEM_PROMPT || '你是 WedScene 的婚礼 AI 对话助手，擅长婚礼策划、空间设计、短视频脚本、小红书文案、客户沟通话术和执行清单。回答要具体、可执行、适合婚礼团队直接使用。';
const MOTION_DIRECTOR_PROMPT_TIMEOUT_MS = Number(process.env.MOTION_DIRECTOR_PROMPT_TIMEOUT_MS || 180_000);
const COPY_VISION_MAX_EDGE = Number(process.env.COPY_VISION_MAX_EDGE || 768);
const COPY_VISION_IMAGE_QUALITY = Number(process.env.COPY_VISION_IMAGE_QUALITY || 70);
const COPY_GENERATED_IMAGE_LIMIT = Number(process.env.COPY_GENERATED_IMAGE_LIMIT || 4);
const DOUBAO_VIDEO_PROMPT_IMAGE_LIMIT = Math.max(1, Number(process.env.DOUBAO_VIDEO_PROMPT_IMAGE_LIMIT || 6));
const ENABLE_COPY_API = process.env.ENABLE_COPY_API !== 'false';
const USE_COPY_API = !USE_MOCK_IMAGES && ENABLE_COPY_API && HAS_OPENAI_KEY && !!COPY_API_ENDPOINT && !!COPY_MODEL;
const USE_XIAOJI = false;
const ACTIVE_PROVIDER = USE_OPENAI_COMPAT ? OPENAI_PROVIDER_LABEL : 'mock';
const ACTIVE_MODEL = USE_OPENAI_COMPAT ? OPENAI_MODEL : 'mock';
const PUBLIC_ACCESS_CODE = (process.env.PUBLIC_ACCESS_CODE || '').trim();
const ACCESS_COOKIE_NAME = process.env.ACCESS_COOKIE_NAME || 'wedscene_access';
const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || getOrCreateServerSecret('accessTokenSecret');
const ACCESS_COOKIE_MAX_AGE_SECONDS = Number(process.env.ACCESS_COOKIE_MAX_AGE_SECONDS || 60 * 60 * 24 * 30);
const ACCESS_COOKIE_SECURE = process.env.ACCESS_COOKIE_SECURE === 'true';
const ACCOUNT_SYSTEM_ENABLED = process.env.ACCOUNT_SYSTEM_ENABLED === 'true';
const ACCOUNT_COOKIE_NAME = process.env.ACCOUNT_COOKIE_NAME || 'wedscene_user';
const ACCOUNT_TOKEN_SECRET = process.env.ACCOUNT_TOKEN_SECRET || process.env.ACCESS_TOKEN_SECRET || getOrCreateServerSecret('accountTokenSecret');
const ACCOUNT_LEGACY_TOKEN_SECRETS = [
  ...(process.env.ACCOUNT_LEGACY_TOKEN_SECRETS || '').split(','),
  OPENAI_API_KEY,
  XIAOJI_API_KEY,
  process.env.ACCESS_TOKEN_SECRET || '',
  'wedscene-local-access',
].map((value) => String(value || '').trim()).filter((value, index, list) => (
  value && value !== ACCOUNT_TOKEN_SECRET && list.indexOf(value) === index
));
const REGISTER_CAPTCHA_TTL_SECONDS = Math.max(60, Number(process.env.REGISTER_CAPTCHA_TTL_SECONDS || 5 * 60));
const PHONE_VERIFICATION_REQUIRED = process.env.PHONE_VERIFICATION_REQUIRED === 'true';
const PHONE_CODE_TTL_SECONDS = Math.max(60, Number(process.env.PHONE_CODE_TTL_SECONDS || 5 * 60));
const PHONE_CODE_RESEND_SECONDS = Math.max(10, Number(process.env.PHONE_CODE_RESEND_SECONDS || 60));
const PHONE_CODE_MAX_ATTEMPTS = Math.max(1, Number(process.env.PHONE_CODE_MAX_ATTEMPTS || 5));
const PHONE_CODE_IP_LIMIT = Math.max(1, Number(process.env.PHONE_CODE_IP_LIMIT || 20));
const PHONE_CODE_IP_WINDOW_MS = Math.max(60_000, Number(process.env.PHONE_CODE_IP_WINDOW_MS || 60 * 60 * 1000));
const SMS_PROVIDER = (process.env.SMS_PROVIDER || 'disabled').trim().toLowerCase();
const SMS_REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.SMS_REQUEST_TIMEOUT_MS || 10_000));
const SMS_WEBHOOK_URL = (process.env.SMS_WEBHOOK_URL || '').trim();
const SMS_WEBHOOK_TOKEN = (process.env.SMS_WEBHOOK_TOKEN || '').trim();
const SMS_DEBUG_LOG_CODE = process.env.SMS_DEBUG_LOG_CODE === 'true';
const SMSBAO_USERNAME = (process.env.SMSBAO_USERNAME || process.env.SMSBAO_USER || '').trim();
const SMSBAO_PASSWORD = (process.env.SMSBAO_PASSWORD || '').trim();
const SMSBAO_PASSWORD_MD5 = (process.env.SMSBAO_PASSWORD_MD5 || process.env.SMSBAO_PASSWORD_HASH || '').trim().toLowerCase();
const SMSBAO_SIGN_NAME = (process.env.SMSBAO_SIGN_NAME || process.env.SMS_SIGN_NAME || '').trim();
const SMSBAO_TEMPLATE = (process.env.SMSBAO_TEMPLATE || '您的验证码是{code}，{minutes}分钟内有效，请勿泄露。').trim();
const SMSBAO_ENDPOINT = (process.env.SMSBAO_ENDPOINT || 'https://api.smsbao.com/sms').trim();
const TENCENT_SMS_SECRET_ID = (process.env.TENCENT_SMS_SECRET_ID || '').trim();
const TENCENT_SMS_SECRET_KEY = (process.env.TENCENT_SMS_SECRET_KEY || '').trim();
const TENCENT_SMS_SDK_APP_ID = (process.env.TENCENT_SMS_SDK_APP_ID || '').trim();
const TENCENT_SMS_SIGN_NAME = (process.env.TENCENT_SMS_SIGN_NAME || '').trim();
const TENCENT_SMS_TEMPLATE_ID = (process.env.TENCENT_SMS_TEMPLATE_ID || '').trim();
const TENCENT_SMS_REGION = (process.env.TENCENT_SMS_REGION || 'ap-guangzhou').trim();
const ABANDONED_JOB_REFUND_GRACE_MS = Number(process.env.ABANDONED_JOB_REFUND_GRACE_MS || 2 * 60 * 1000);
const LEGACY_MOTION_REFUND_AFTER = process.env.LEGACY_MOTION_REFUND_AFTER || '2026-06-01T00:00:00.000Z';
const LEGACY_MOTION_REFUND_BEFORE = process.env.LEGACY_MOTION_REFUND_BEFORE || '2026-06-04T00:00:00.000Z';
const TRIAL_POINTS = Number(process.env.TRIAL_POINTS || 5);
const JOB_POINT_COST = Number(process.env.JOB_POINT_COST || process.env.SINGLE_IMAGE_POINT_COST || 5);
const FREE_IMAGE_POINT_COST = Number(process.env.FREE_IMAGE_POINT_COST || 10);
const IMAGE_ENHANCE_POINT_COST = Number(process.env.IMAGE_ENHANCE_POINT_COST || process.env.ENHANCE_POINT_COST || 5);
const IMAGE_ENHANCE_MAX_EDGE = Math.max(1024, Number(process.env.IMAGE_ENHANCE_MAX_EDGE || 4096));
const IMAGE_ENHANCE_SIZE_MAX_EDGES = { '2K': 2048, '4K': 4096 };
const DEFAULT_IMAGE_ENHANCE_SIZE = normalizeImageEnhanceSize(process.env.DEFAULT_IMAGE_ENHANCE_SIZE || process.env.IMAGE_ENHANCE_SIZE || '2K');
const TEXT_POINT_COST = Number(process.env.TEXT_POINT_COST || process.env.COPY_POINT_COST || 1);
const PLAN_IMAGE_POINT_COST = Number(process.env.PLAN_IMAGE_POINT_COST || 10);
const CONSTRUCTION_CHECKLIST_POINT_COST = Number(process.env.CONSTRUCTION_CHECKLIST_POINT_COST || PLAN_IMAGE_POINT_COST);
const SIX_IMAGE_POINT_COST = Number(process.env.SIX_IMAGE_POINT_COST || process.env.IMAGE_PACK_POINT_COST || JOB_POINT_COST * 6);
const STORYBOARD_POINT_COST = Number(process.env.STORYBOARD_POINT_COST || process.env.CINEMATIC_STORYBOARD_POINT_COST || 50);
const DESIGN_RENDER_POINT_COST = Number(process.env.DESIGN_RENDER_POINT_COST || 5);
const PARTIAL_EDIT_POINT_COST = Number(process.env.PARTIAL_EDIT_POINT_COST || 20);
const PARTIAL_EDIT_REFERENCE_LIMIT = Math.min(4, Math.max(1, Number(process.env.PARTIAL_EDIT_REFERENCE_LIMIT || 4)));
const FREE_IMAGE_REFERENCE_LIMIT = Math.min(16, Math.max(1, Number(process.env.FREE_IMAGE_REFERENCE_LIMIT || 8)));
const PARTIAL_EDIT_SEND_EXTRA_REFERENCES = process.env.PARTIAL_EDIT_SEND_EXTRA_REFERENCES !== 'false';
const ADMIN_TOKEN = (process.env.ADMIN_TOKEN || '').trim();
const SUPPORT_WECHAT = (process.env.SUPPORT_WECHAT || '').trim();
const SUPPORT_WECHAT_QR = (process.env.SUPPORT_WECHAT_QR || '').trim();
const SITE_BRAND_NAME = (process.env.SITE_BRAND_NAME || 'WedScene').trim();
const SITE_LOGO_URL = (process.env.SITE_LOGO_URL || '').trim();
const SITE_LOGO_TEXT = (process.env.SITE_LOGO_TEXT || 'W').trim();
const SITE_TAGLINE = (process.env.SITE_TAGLINE || 'WEDSCENE AI').trim();
const DEFAULT_RECHARGE_PLANS = '29.9元=300灵感值;299元=3000灵感值;899元=11000灵感值;3980元=高级代理权益包';
const RECHARGE_PLANS = process.env.RECHARGE_PLANS || DEFAULT_RECHARGE_PLANS;
const PERMANENT_MEMBERSHIP_EXPIRES_AT = '9999-12-31T23:59:59.999Z';
const RECHARGE_PLAN_PROFILES = [
  { price: 29.9, name: '图片生成版', badge: '图片版', description: '1个月图片生成权益，适合轻量出图和测试', durationDays: 30, durationText: '1个月图片生成版', benefits: ['图片生成', '提示词试用'], includesMotion: false },
  { price: 299, name: '体验版', badge: '体验', featured: true, description: '完整体验入口，跑通图片、文案和15s视频流程', durationDays: -1, durationText: '永久有效', benefits: ['完整体验', '视频生成', '去水印'] },
  { price: 899, name: '专业版', badge: '专业', featured: true, description: '性价比主推，含初级代理权益，适合团队分销获客', durationDays: -1, durationText: '永久有效', benefits: ['初级代理', '图片低至0.41元', 'GEO优化'] },
  { price: 3980, name: 'AI经理', badge: 'AI经理', featured: true, packageOnly: true, grantPoints: 0, pointsText: '高级代理权益包', packageText: '赠5套专业版 + 3套体验版名额', description: '高级代理权益，赠送5套专业版和3套体验版名额，AI经理陪跑获客', durationDays: -1, durationText: '永久有效', benefits: ['高级代理', '赠5套专业版', '赠3套体验版', 'AI经理陪跑'] },
];
const LEGACY_VIDEO_ACCESS_CUTOFF = Date.parse(process.env.LEGACY_VIDEO_ACCESS_CUTOFF || '2026-07-03T00:00:00+08:00');
const IMAGE_ONLY_PLAN_PATTERN = /图片生成版|图片版|1个月图片生成版|29\.9/i;
const VIDEO_ACCESS_DENIED_MESSAGE = '当前账号为图片生成版，仅可使用图片功能；视频功能请开通体验版、专业版或 AI经理。';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const PUBLIC_BASE_URL_OVERRIDE_FILE = process.env.PUBLIC_BASE_URL_FILE
  ? path.resolve(process.env.PUBLIC_BASE_URL_FILE)
  : path.join(DATA_DIR, 'public-base-url.txt');
function currentPublicBaseUrl() {
  try {
    const value = readFileSync(PUBLIC_BASE_URL_OVERRIDE_FILE, 'utf8').trim().replace(/\/+$/, '');
    if (/^https?:\/\//i.test(value)) return value;
  } catch {
    // Runtime override is optional; fall back to the startup env value.
  }
  return PUBLIC_BASE_URL;
}
const API_CORS_ORIGINS = new Set(
  (process.env.API_CORS_ORIGINS || process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean)
);
function normalizeMotionVideoEndpoint(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (/xiaoji|baziapi/i.test(url.hostname)) return '';
    const pathname = url.pathname.replace(/\/+$/, '');
    if (/(^|[.])pro666\.top$/i.test(url.hostname)) {
      if (!pathname || pathname === '/') {
        url.pathname = '/v1/videos';
      } else if (/\/v1$/i.test(pathname)) {
        url.pathname = `${pathname}/videos`;
      }
      return url.toString().replace(/\/+$/, '');
    }
  } catch {}
  return raw.replace(/\/+$/, '');
}
const MOTION_VIDEO_MODEL = process.env.MOTION_VIDEO_MODEL || 'veo_3_1_fast_components_vip';
const MOTION_VIDEO_DEFAULT_ENDPOINT = OPENAI_BASE_URL ? `${OPENAI_BASE_URL.replace(/\/$/, '')}/videos` : '';
const MOTION_VIDEO_CONFIG_URL = process.env.MOTION_VIDEO_ENDPOINT || process.env.MOTION_VIDEO_BASE_URL || MOTION_VIDEO_DEFAULT_ENDPOINT;
const MOTION_VIDEO_ENDPOINT = normalizeMotionVideoEndpoint(MOTION_VIDEO_CONFIG_URL);
const MOTION_VIDEO_PROVIDER = String(process.env.MOTION_VIDEO_PROVIDER || '').trim().toLowerCase();
const MOTION_VIDEO_IS_PRO666 = /pro666|video-v1/i.test(MOTION_VIDEO_PROVIDER)
  || /(^|[.])pro666\.top$/i.test((() => {
    try { return new URL(MOTION_VIDEO_ENDPOINT).hostname; } catch { return ''; }
  })());
const PRO666_VIDEO_FAST_MODEL = 'wf-sd2-fast';
const PRO666_VIDEO_QUALITY_MODEL = 'wf-sd2';
const PRO666_VIDEO_MODEL_MODES = {
  fast: PRO666_VIDEO_FAST_MODEL,
  quality: PRO666_VIDEO_QUALITY_MODEL,
};
function normalizePro666VideoModelName(value) {
  const raw = String(value || '').trim();
  const lower = raw.toLowerCase();
  if (!raw
    || lower === 'fast'
    || lower === 'quick'
    || lower === 'video-v1'
    || lower === 'video_v1'
    || lower === 'seedance2.0-fast'
    || lower === PRO666_VIDEO_FAST_MODEL.toLowerCase()) {
    return PRO666_VIDEO_FAST_MODEL;
  }
  if (lower === 'quality'
    || lower === 'high'
    || lower === 'wf-sd2-quality'
    || lower === 'seedance'
    || lower === 'seedance2'
    || lower === 'seedance2.0'
    || lower === 'otoy-image-to-video-seedance-2-0-mini-reference-to-video'
    || lower === PRO666_VIDEO_QUALITY_MODEL.toLowerCase()) {
    return PRO666_VIDEO_QUALITY_MODEL;
  }
  return raw;
}
function normalizePro666VideoModelMode(value) {
  const model = normalizePro666VideoModelName(value);
  return model === PRO666_VIDEO_QUALITY_MODEL ? 'quality' : 'fast';
}
function pro666VideoModelForMode(value) {
  return PRO666_VIDEO_MODEL_MODES[normalizePro666VideoModelMode(value)] || PRO666_VIDEO_FAST_MODEL;
}
function pro666VideoModelLabel(model) {
  return normalizePro666VideoModelName(model) === PRO666_VIDEO_QUALITY_MODEL ? 'WF-SD2 质量' : 'WF-SD2 快速';
}
// 阿里百炼 dashscope 格式：endpoint 含 /alibailian/ 时启用
const MOTION_VIDEO_IS_ALIBAILIAN = /\/alibailian\//.test(MOTION_VIDEO_ENDPOINT);
// baziapi OpenAI-compatible 视频：base URL 可写到 /v1，实际提交会归一化到 /v1/videos。
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
  if (MOTION_VIDEO_IS_PRO666) return normalizePro666VideoModelName(value);
  if (MOTION_VIDEO_IS_XIAOJI) {
    if (/^veo3[._-]?1$/i.test(value) || /^veo[_-]?3[_-]?1$/i.test(value)) {
      return 'veo_3_1-fast';
    }
    if (/^veo3[._-]?1[-_.]?fast$/i.test(value)) {
      return 'veo_3_1-fast';
    }
    if (/^veo3[._-]?1[-_.]?hd$/i.test(value)) {
      return 'veo_3_1-hd';
    }
    if (/^veo3[._-]?1[-_.]?fast[-_.]?fl$/i.test(value)) {
      return 'veo_3_1-fast-fl';
    }
    if (/^veo3[._-]?1[-_.]?fast[-_.]?fl[-_.]?hd$/i.test(value)) {
      return 'veo_3_1-fast-fl-hd';
    }
    if (/^veo(?:3[._-]?1|[_-]?3[_-]?1)[-_.]?fast[-_.]?components[-_.]?vip$/i.test(value)
      || /^veo[_-]?3[_-]?1[-_]?fast[-_]?components[-_]?vip$/i.test(value)
      || /^veo[_-]?3[_-]?1[_-]?fast[_-]?components[_-]?vip$/i.test(value)) {
      return 'veo_3_1_fast_components_vip';
    }
    if (/^veo(?:3[._-]?1|[_-]?3[_-]?1)[-_.]?components(?:[-_.]?vip)?$/i.test(value)
      || /^veo[_-]?3[_-]?1[-_]?components(?:[-_]?vip)?$/i.test(value)) {
      return 'veo_3_1_fast_components_vip';
    }
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
// Video uses only an explicit MOTION_VIDEO_API_KEY for endpoints that are not tied to the image provider key.
const MOTION_VIDEO_API_KEY = process.env.MOTION_VIDEO_API_KEY
  || (MOTION_VIDEO_IS_XIAOJI || MOTION_VIDEO_IS_PRO666 ? '' : OPENAI_API_KEY);
const HAS_MOTION_VIDEO_KEY = hasUsableSecret(MOTION_VIDEO_API_KEY);
const MOTION_VIDEO_RESOLUTION = process.env.MOTION_VIDEO_RESOLUTION || (MOTION_VIDEO_IS_PRO666 ? '' : '4K');
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
function motionVideoColonAspectRatio() {
  const value = String(MOTION_VIDEO_ASPECT_RATIO || reduceAspectRatio(MOTION_VIDEO_SIZE || '1280x720') || '16:9')
    .trim()
    .replace(/x/i, ':');
  if (/^(16:9|9:16|1:1)$/.test(value)) return value;
  const pixelSize = motionVideoPixelSize();
  if (/^720x1280$/i.test(pixelSize)) return '9:16';
  return '16:9';
}
const VIDEO_V1_ALLOWED_DURATIONS = [10, 15];
const VIDEO_V1_DURATION_SECONDS = 15;
function normalizeVideoV1Duration(value = VIDEO_V1_DURATION_SECONDS) {
  const duration = Math.round(Number(value));
  return VIDEO_V1_ALLOWED_DURATIONS.includes(duration) ? duration : VIDEO_V1_DURATION_SECONDS;
}
const MOTION_VIDEO_DURATION = MOTION_VIDEO_IS_PRO666
  ? normalizeVideoV1Duration(process.env.MOTION_VIDEO_DURATION || VIDEO_V1_DURATION_SECONDS)
  : Number(process.env.MOTION_VIDEO_DURATION || 10);
function normalizeVideoV1AspectRatio(value, fallback = motionVideoColonAspectRatio()) {
  const clean = String(value || fallback || '16:9').trim().replace(/x/i, ':');
  return /^(16:9|9:16|1:1)$/.test(clean) ? clean : '16:9';
}
const MOTION_VIDEO_POLL_INTERVAL_MS = Number(process.env.MOTION_VIDEO_POLL_INTERVAL_MS || 5_000);
const MOTION_VIDEO_POLL_TIMEOUT_MS = Number(process.env.MOTION_VIDEO_POLL_TIMEOUT_MS || 10 * 60 * 1000);
const MOTION_VIDEO_STALL_RETRY_MS = Number(process.env.MOTION_VIDEO_STALL_RETRY_MS || 300_000);
const MOTION_VIDEO_MAX_SUBMIT_ATTEMPTS = Math.max(1, Number(process.env.MOTION_VIDEO_MAX_SUBMIT_ATTEMPTS || 1));
const MOTION_VIDEO_SUBMIT_RETRY_INTERVAL_MS = Math.max(5_000, Number(process.env.MOTION_VIDEO_SUBMIT_RETRY_INTERVAL_MS || 15_000));
const MOTION_VIDEO_SUBMIT_RETRY_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.MOTION_VIDEO_SUBMIT_RETRY_TIMEOUT_MS || Math.min(MOTION_VIDEO_POLL_TIMEOUT_MS, 10 * 60 * 1000)),
);
const MOTION_VIDEO_DOWNLOAD_TIMEOUT_MS = Number(process.env.MOTION_VIDEO_DOWNLOAD_TIMEOUT_MS || 600_000);
const MOTION_VIDEO_PREFLIGHT_TTL_MS = Number(process.env.MOTION_VIDEO_PREFLIGHT_TTL_MS || 60_000);
const DEFAULT_MOTION_REFERENCE_LIMIT = 3;
const MOTION_REFERENCE_LIMIT = Math.max(
  1,
  Math.min(DEFAULT_MOTION_REFERENCE_LIMIT, Number(process.env.MOTION_REFERENCE_LIMIT || DEFAULT_MOTION_REFERENCE_LIMIT)),
);
const PRO666_VIDEO_FAST_REFERENCE_LIMIT = Math.max(
  1,
  Math.min(4, Number(process.env.MOTION_VIDEO_FAST_REFERENCE_LIMIT || process.env.MOTION_FAST_REFERENCE_LIMIT || 4)),
);
const PRO666_VIDEO_QUALITY_REFERENCE_LIMIT = Math.max(
  1,
  Math.min(4, Number(process.env.MOTION_VIDEO_QUALITY_REFERENCE_LIMIT || process.env.MOTION_QUALITY_REFERENCE_LIMIT || 4)),
);
const PRO666_VIDEO_MAX_REFERENCE_LIMIT = Math.max(PRO666_VIDEO_FAST_REFERENCE_LIMIT, PRO666_VIDEO_QUALITY_REFERENCE_LIMIT);
const PRO666_VIDEO_REFERENCE_VIDEO_LIMIT = Math.max(0, Math.min(3, Number(process.env.MOTION_VIDEO_REFERENCE_VIDEO_LIMIT || 3)));
const PRO666_VIDEO_REFERENCE_AUDIO_LIMIT = Math.max(0, Math.min(1, Number(process.env.MOTION_VIDEO_REFERENCE_AUDIO_LIMIT || 1)));
const PRO666_VIDEO_FAST_MEDIA_LIMIT = Math.max(1, Math.min(8, Number(process.env.MOTION_VIDEO_FAST_MEDIA_LIMIT || process.env.MOTION_VIDEO_REFERENCE_MEDIA_LIMIT || 8)));
const PRO666_VIDEO_QUALITY_MEDIA_LIMIT = Math.max(1, Math.min(8, Number(process.env.MOTION_VIDEO_QUALITY_MEDIA_LIMIT || 8)));
function pro666VideoMediaLimitForModel(model = MOTION_VIDEO_REQUEST_MODEL) {
  return normalizePro666VideoModelName(model) === PRO666_VIDEO_QUALITY_MODEL
    ? PRO666_VIDEO_QUALITY_MEDIA_LIMIT
    : PRO666_VIDEO_FAST_MEDIA_LIMIT;
}
function motionVideoModelUsesFirstLastFrames(model = MOTION_VIDEO_REQUEST_MODEL) {
  return /(?:^|[-_])fl(?:[-_]|$)/i.test(String(model || ''));
}
function motionVideoModelUsesComponents(model = MOTION_VIDEO_REQUEST_MODEL) {
  return /components?/i.test(String(model || ''));
}
function motionVideoModelForReferenceCount(model = MOTION_VIDEO_REQUEST_MODEL, referenceCount = 1) {
  const value = String(model || '').trim();
  if (!MOTION_VIDEO_IS_XIAOJI
    || referenceCount < 2
    || motionVideoModelUsesFirstLastFrames(value)
    || motionVideoModelUsesComponents(value)) {
    return value;
  }
  if (/^veo_3_1-hd$/i.test(value)) return 'veo_3_1-fast-fl-hd';
  return 'veo_3_1-fast-fl';
}
function motionMinimumReferenceCountForModel(model = MOTION_VIDEO_REQUEST_MODEL) {
  return MOTION_VIDEO_IS_XIAOJI && motionVideoModelUsesFirstLastFrames(model) ? 2 : 1;
}
function motionReferenceLimitForModel(model = MOTION_VIDEO_REQUEST_MODEL) {
  if (MOTION_VIDEO_IS_PRO666) {
    return normalizePro666VideoModelName(model) === PRO666_VIDEO_QUALITY_MODEL
      ? PRO666_VIDEO_QUALITY_REFERENCE_LIMIT
      : PRO666_VIDEO_FAST_REFERENCE_LIMIT;
  }
  if (MOTION_VIDEO_IS_XIAOJI && motionVideoModelUsesFirstLastFrames(model)) {
    return Math.min(2, MOTION_REFERENCE_LIMIT);
  }
  if (motionVideoModelUsesComponents(model)) {
    return Math.min(3, MOTION_REFERENCE_LIMIT);
  }
  return MOTION_REFERENCE_LIMIT;
}
// 去水印：ffmpeg 可执行文件 + 右下角 delogo 区域（表达式使用 ffmpeg 滤镜内部变量 W/H = 视频宽高）
// 优先：.env 手动设的 → ffmpeg-static 提供的预编译二进制 → 系统 PATH 中的 ffmpeg
function resolveFfmpegBin() {
  const candidates = [process.env.FFMPEG_BIN, ffmpegStatic, 'ffmpeg'].filter(Boolean);
  for (const candidate of candidates) {
    const value = String(candidate);
    const isCommandName = !path.isAbsolute(value) && !/[\\/]/.test(value);
    if (isCommandName || existsSync(value)) return value;
    console.warn(`[ffmpeg] binary not found, trying next candidate: ${value}`);
  }
  return 'ffmpeg';
}
const FFMPEG_BIN = resolveFfmpegBin();
const MOTION_WATERMARK_REMOVE = String(process.env.MOTION_WATERMARK_REMOVE ?? 'true').toLowerCase() !== 'false';
// 默认抠右下角 宽 200 × 高 70 区域（部分聚合视频模型常见 logo 位置）
const MOTION_WATERMARK_BOX = process.env.MOTION_WATERMARK_BOX || 'W-220:H-90:200:70';
const EXTERNAL_IMPORT_MAINTENANCE = String(process.env.EXTERNAL_IMPORT_MAINTENANCE ?? 'true').toLowerCase() !== 'false';
const EXTERNAL_IMPORT_MAINTENANCE_MESSAGE = process.env.EXTERNAL_IMPORT_MAINTENANCE_MESSAGE
  || '豆包素材导入功能暂时用不了，正在维护中，请稍后再试。';
const EXTERNAL_IMPORT_VIDEO_WATERMARK_REMOVE = String(process.env.EXTERNAL_IMPORT_VIDEO_WATERMARK_REMOVE ?? 'false').toLowerCase() === 'true';
const EXTERNAL_IMPORT_VIDEO_WATERMARK_BOX = process.env.EXTERNAL_IMPORT_VIDEO_WATERMARK_BOX || 'W-250:H-120:240:110';
const MOTION_VIDEO_WEB_OPTIMIZE = String(process.env.MOTION_VIDEO_WEB_OPTIMIZE ?? 'true').toLowerCase() !== 'false';
const MOTION_VIDEO_WEB_MAX_WIDTH = Number(process.env.MOTION_VIDEO_WEB_MAX_WIDTH || 1280);
const MOTION_VIDEO_WEB_CRF = Number(process.env.MOTION_VIDEO_WEB_CRF || 25);
const MOTION_VIDEO_WEB_PRESET = process.env.MOTION_VIDEO_WEB_PRESET || 'veryfast';
const MOTION_VIDEO_WEB_MAXRATE = process.env.MOTION_VIDEO_WEB_MAXRATE || '3200k';
const MOTION_VIDEO_WEB_BUFSIZE = process.env.MOTION_VIDEO_WEB_BUFSIZE || '6400k';
const MOTION_VIDEO_WEB_AUDIO_BITRATE = process.env.MOTION_VIDEO_WEB_AUDIO_BITRATE || '96k';
const MOTION_VIDEO_VERIFY_VISIBLE_FRAME = String(process.env.MOTION_VIDEO_VERIFY_VISIBLE_FRAME ?? 'false').toLowerCase() !== 'false';
const MOTION_VIDEO_TOKEN_TTL_MS = Number(process.env.MOTION_VIDEO_TOKEN_TTL_MS || 6 * 60 * 60 * 1000);
const MOTION_VIDEO_REFERENCE_MAX_EDGE = Number(process.env.MOTION_VIDEO_REFERENCE_MAX_EDGE || 1024);
const MOTION_VIDEO_REFERENCE_QUALITY = Number(process.env.MOTION_VIDEO_REFERENCE_QUALITY || 86);
const MOTION_POINT_COST = Number(process.env.MOTION_POINT_COST || 200);
const MOTION_REFERENCE_GUARD_ENABLED = process.env.MOTION_REFERENCE_GUARD_ENABLED !== 'false';
const MOTION_REFERENCE_GUARD_MAX_TOKENS = Number(process.env.MOTION_REFERENCE_GUARD_MAX_TOKENS || 2000);
const MOTION_DIRECTOR_PROMPT_MAX_TOKENS = Number(process.env.MOTION_DIRECTOR_PROMPT_MAX_TOKENS || 4000);
// 没有 API Key / 强制 mock / 没有 PUBLIC_BASE_URL（URL 模式上游拉不到本地图）任一条件成立，都走 mock
const FORCE_MOCK_MOTION = process.env.MOTION_VIDEO_FORCE_MOCK === 'true';
const MOTION_VIDEO_REQUIRES_PUBLIC_URL = !MOTION_VIDEO_IS_PRO666 && (
  MOTION_VIDEO_IS_XIAOJI
  || MOTION_VIDEO_IS_N1N_UNIFIED
  || MOTION_VIDEO_IS_ALIBAILIAN
  || (!MOTION_VIDEO_IS_XIAOJI && !MOTION_VIDEO_IS_N1N_OPENAI)
);
const USE_MOCK_MOTION_VIDEO = FORCE_MOCK_MOTION || !HAS_MOTION_VIDEO_KEY || USE_MOCK_IMAGES || (MOTION_VIDEO_REQUIRES_PUBLIC_URL && !currentPublicBaseUrl());
const DOUBAO_NOMARK_API_BASE = String(process.env.DOUBAO_NOMARK_API_BASE || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const DOUBAO_NOMARK_TIMEOUT_MS = Number(process.env.DOUBAO_NOMARK_TIMEOUT_MS || 120_000);
const EXTERNAL_IMPORT_MAX_ASSETS = Math.max(1, Number(process.env.EXTERNAL_IMPORT_MAX_ASSETS || 12));
const EXTERNAL_IMPORT_MAX_LINKS = Math.max(1, Number(process.env.EXTERNAL_IMPORT_MAX_LINKS || 6));
const EXTERNAL_IMPORT_MAX_ASSET_BYTES = Math.max(1024 * 1024, Number(process.env.EXTERNAL_IMPORT_MAX_ASSET_BYTES || 150 * 1024 * 1024));
const EXTERNAL_IMPORT_ALLOWED_HOSTS = parseEnvList(process.env.EXTERNAL_IMPORT_ALLOWED_HOSTS || '');

const app = express();

app.set('trust proxy', 'loopback');

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://esm.sh",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' blob: https: http://127.0.0.1:* http://localhost:*",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
].join('; ');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  if (req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});

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

const defaultJsonParser = express.json({ limit: process.env.JSON_BODY_LIMIT || '64kb' });
const chatJsonParser = express.json({ limit: CHAT_JSON_BODY_LIMIT });
app.use((req, res, next) => {
  if (req.path === '/api/chat') {
    next();
    return;
  }
  defaultJsonParser(req, res, next);
});

app.use((err, req, res, next) => {
  if (!err) {
    next();
    return;
  }
  if (err.type === 'entity.too.large' || err.status === 413) {
    res.status(413).json({ error: '上传内容过大，请压缩图片、减少参考图数量后再试。' });
    return;
  }
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: '请求内容格式不正确，请刷新页面后重试。' });
    return;
  }
  next(err);
});

const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);
const ALLOWED_VIDEO_UPLOAD_MIME_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-m4v',
  'video/x-msvideo',
]);
const ALLOWED_AUDIO_UPLOAD_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'audio/aac',
  'audio/ogg',
  'audio/flac',
  'audio/x-flac',
]);
const VIDEO_REFERENCE_UPLOAD_FIELDS = new Set(['video', 'videos', 'reference_video', 'reference_videos']);
const AUDIO_REFERENCE_UPLOAD_FIELDS = new Set(['audio', 'audios', 'reference_audio', 'reference_audios']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 200 * 1024 * 1024,
    files: 14,
    fields: 28,
    parts: 48,
    fieldNameSize: 80,
    fieldSize: 8 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const mimetype = String(file.mimetype || '').toLowerCase();
    const fieldName = String(file.fieldname || '');
    if (ALLOWED_UPLOAD_MIME_TYPES.has(mimetype)
      || (VIDEO_REFERENCE_UPLOAD_FIELDS.has(fieldName) && ALLOWED_VIDEO_UPLOAD_MIME_TYPES.has(mimetype))
      || (AUDIO_REFERENCE_UPLOAD_FIELDS.has(fieldName) && ALLOWED_AUDIO_UPLOAD_MIME_TYPES.has(mimetype))) {
      cb(null, true);
      return;
    }
    if (VIDEO_REFERENCE_UPLOAD_FIELDS.has(fieldName)) {
      cb(new Error('Unsupported video upload type. Please upload MP4, MOV, WebM, M4V, or AVI videos.'));
      return;
    }
    if (AUDIO_REFERENCE_UPLOAD_FIELDS.has(fieldName)) {
      cb(new Error('Unsupported audio upload type. Please upload MP3, WAV, M4A, AAC, OGG, or FLAC audio.'));
      return;
    }
    cb(new Error('Unsupported upload type. Please upload JPG, PNG, WebP, HEIC, or HEIF images.'));
  },
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
  similar_style: '同款婚礼延伸',
  setup_comparison: '布置前后对比图',
  design_render_scene: '设计图转实景',
  venue_fusion: '空地婚礼融合图',
  product_matrix: '方案施工矩阵图',
  handdrawn_plan: '手绘方案推演图',
  outdoor_handdrawn_plan: '户外小清新手绘图',
  construction_checklist: '落地施工清单图',
  detail_grid: '九宫格细节图',
  setup_process_grid: '搭建视频九宫格',
  photo_area_setup_grid: '留影区搭建九宫格',
  partial_wedding_edit: '上传参考图局部改图',
  ps_layer_split: 'PS白底分层素材',
  image_enhance: '画质升级',
  free_text_image: '自由创作文生图',
  free_image_image: '自由创作图生图',
  copy_title: '提示词',
  motion_video: '现场空景运镜视频',
};

const SIX_IMAGE_MODES = new Set(['multi_angle', 'detail_pack', 'ps_layer_split']);
const DISABLED_MODES = new Set(['design_comparison', 'construction_checklist']);
const SETUP_PROCESS_GRID_MODES = new Set(['setup_process_grid', 'photo_area_setup_grid']);
const PLAN_RESOURCE_MODES = new Set(['product_matrix', 'handdrawn_plan', 'outdoor_handdrawn_plan', 'detail_grid', ...SETUP_PROCESS_GRID_MODES]);
const SINGLE_IMAGE_MODES = new Set(['similar_style', 'setup_comparison', 'venue_fusion', ...PLAN_RESOURCE_MODES]);
const DESIGN_RENDER_MODES = new Set(['design_render_scene']);
const PARTIAL_EDIT_MODES = new Set(['partial_wedding_edit']);
const IMAGE_ENHANCE_MODES = new Set(['image_enhance']);
const FREE_IMAGE_MODES = new Set(['free_text_image', 'free_image_image']);

function pointCostForMode(mode = '') {
  if (mode === 'motion_video') return MOTION_POINT_COST;
  if (mode === 'copy_title') return TEXT_POINT_COST;
  if (mode === 'cinematic_storyboard') return STORYBOARD_POINT_COST;
  if (IMAGE_ENHANCE_MODES.has(mode)) return IMAGE_ENHANCE_POINT_COST;
  if (PARTIAL_EDIT_MODES.has(mode)) return PARTIAL_EDIT_POINT_COST;
  if (FREE_IMAGE_MODES.has(mode)) return FREE_IMAGE_POINT_COST;
  if (DESIGN_RENDER_MODES.has(mode)) return DESIGN_RENDER_POINT_COST;
  if (SIX_IMAGE_MODES.has(mode)) return SIX_IMAGE_POINT_COST;
  if (mode === 'construction_checklist') return CONSTRUCTION_CHECKLIST_POINT_COST;
  if (PLAN_RESOURCE_MODES.has(mode)) return PLAN_IMAGE_POINT_COST;
  if (SINGLE_IMAGE_MODES.has(mode)) return JOB_POINT_COST;
  return JOB_POINT_COST;
}

function publicPointCosts() {
  return {
    text: TEXT_POINT_COST,
    chat: CHAT_POINT_COST,
    singleImage: JOB_POINT_COST,
    storyboard: STORYBOARD_POINT_COST,
    planImage: PLAN_IMAGE_POINT_COST,
    constructionChecklist: CONSTRUCTION_CHECKLIST_POINT_COST,
    designRender: DESIGN_RENDER_POINT_COST,
    partialEdit: PARTIAL_EDIT_POINT_COST,
    freeImage: FREE_IMAGE_POINT_COST,
    imageEnhance: IMAGE_ENHANCE_POINT_COST,
    motion: MOTION_POINT_COST,
    byMode: Object.fromEntries(Object.keys(MODE_LABELS).map((mode) => [mode, pointCostForMode(mode)])),
  };
}

// 空景运镜：支持 1-3 张连续转场参考图；baziapi -fl 模型仍会要求首尾帧两张参考图。
const MOTION_STYLES = {
  seamless_sequence: {
    label: '三图连续转场',
    description: '一键按上传顺序串联：图 1 开场 → 图 2 中段 → 图 3 收尾',
    prompt: 'A crisp cinematic wedding sequence cutting through the uploaded reference images in their exact order, with no people. Start with Image 1 as the opening establishing scene, use each later uploaded image as its own readable sequence target, and make the last uploaded image the ending frame. The ending image must keep its actual viewpoint and subject: if it is an upward ceiling / crystal / floral installation view, end on that ceiling view; if it is a stage, aisle, tabletop, floral or decor detail, end on that exact category. Do not replace the final uploaded image with a generic flower macro, bouquet, table centerpiece or stock wedding detail unless that is clearly what the uploaded ending image shows. Keep the wedding identity, color palette, floral language, lighting mood and material realism consistent across all supplied scenes.',
  },
  slow_push_in: {
    label: '慢速推进',
    description: '从原图构图缓慢推近，突出舞台、通道或主视觉层次',
    prompt: 'Create one continuous cinematic empty-wedding camera move from the uploaded reference image: a slow elegant dolly push-in from the original composition toward the main visible focal area. Preserve the same venue, decor layout, object positions, color palette, lighting direction and material texture. Do not change scenes and do not add people.',
  },
  pull_out: {
    label: '缓慢拉远',
    description: '由局部氛围拉到完整空间，适合场地展示',
    prompt: 'Create one continuous cinematic empty-wedding camera move from the uploaded reference image: begin slightly closer to the main focal area, then slowly dolly backward to reveal more of the original venue space. Keep the uploaded image as the only scene, preserving architecture, decor, lighting, colors and all object positions. No people, no invented props.',
  },
  lateral_left_to_right: {
    label: '左向右横移',
    description: '横向滑过空间层次，适合花艺、通道和布幔',
    prompt: 'Create one continuous cinematic empty-wedding camera move from the uploaded reference image: a refined left-to-right gimbal slide with subtle parallax across the existing decor. Keep every visible object grounded and in its original relationship. Preserve the same scene, color palette, lighting and venue identity. No people and no scene transition.',
  },
  lateral_right_to_left: {
    label: '右向左横移',
    description: '反向横移营造案例片开场感',
    prompt: 'Create one continuous cinematic empty-wedding camera move from the uploaded reference image: a refined right-to-left gimbal slide with subtle parallax across the existing decor. Keep the original composition, venue structure, floral language, lighting mood and object placement. No people, no extra scene, no unsupported props.',
  },
  parallax_walkthrough: {
    label: '轻微穿行',
    description: '模拟摄影师向前经过前景，空间感更强',
    prompt: 'Create one continuous cinematic empty-wedding camera move from the uploaded reference image: a gentle forward walkthrough with tasteful parallax, as if a stabilised cinema camera moves through the existing aisle or open floor. Keep the scene physically plausible and preserve all visible wedding decor, materials, scale and lighting. No people, no new objects, no cutaway.',
  },
  soft_bokeh_sequence: {
    label: '柔焦氛围',
    description: '轻微景深变化和灯光呼吸，适合细节图',
    prompt: 'Create one continuous cinematic empty-wedding camera move from the uploaded reference image: a calm atmospheric shot with subtle rack-focus and soft bokeh breathing, staying inside the same scene. Existing flowers, fabric, crystal, lights or decor may gently catch highlights only if they are visible in the reference. No people, no invented candles or chandeliers, no transition.',
  },
};

const DEFAULT_MOTION_STYLE = 'seamless_sequence';

function normalizeMotionStyleKey(styleKey = '') {
  const value = String(styleKey || '').trim();
  if (MOTION_STYLES[value]) return value;
  if ([
    'seamless_sequence',
  ].includes(value)) {
    return DEFAULT_MOTION_STYLE;
  }
  return DEFAULT_MOTION_STYLE;
}

function motionTimelinePrompt(styleKey, count = 1) {
  const duration = Math.max(1, Number(MOTION_VIDEO_DURATION || 10));
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
    return [
      `${duration}-SECOND TWO-IMAGE FIRST/LAST-FRAME TIMING: Image 1 is the required opening frame at 0.0s. Image 2 is the required final frame at ${end}s. Generate a smooth cinematic camera move or physically plausible transition from Image 1 to Image 2, then settle on Image 2 during the final second.`,
      'The two uploaded images are first and last frame targets, not a style moodboard. Do not invent a third scene, do not use split-screen, and do not replace the final frame with a generic wedding detail.',
    ].join(' ');
  }
  return [
    `${duration}-SECOND SINGLE-IMAGE TIMING: 0.0-1.0s establish Image 1; 1.0-${Math.max(1, duration - 1).toFixed(1)}s perform one elegant continuous camera movement inside the same scene; ${Math.max(0.5, duration - 1).toFixed(1)}-${end}s ease out and settle.`,
    'Only one image is supplied, so do not invent additional scenes. Use a refined slow push, pan, or parallax move within the uploaded scene.',
  ].join(' ');
}

function motionReferenceRolePrompt(count = 1) {
  const base = [
    'REFERENCE IMAGE ROLES FOR VIDEO: Use the uploaded images as ordered required targets for one wedding film, not as independent outputs and not as a blended average.',
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
      'Image 2 is the required final frame / end scene. The video must end on Image 2 with its actual viewpoint, subject, decor, lighting and color palette still recognizable.',
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

function motionStylePromptForCount(styleKey = DEFAULT_MOTION_STYLE, count = 1) {
  const style = MOTION_STYLES[styleKey] || MOTION_STYLES[DEFAULT_MOTION_STYLE];
  if (count < 2 || styleKey === 'seamless_sequence') return style.prompt;
  const movementByStyle = {
    slow_push_in: 'a gentle forward dolly push with a calm cinematic settle',
    pull_out: 'a slow pull-back reveal with a calm cinematic settle',
    lateral_left_to_right: 'a refined left-to-right gimbal slide with subtle parallax',
    lateral_right_to_left: 'a refined right-to-left gimbal slide with subtle parallax',
    parallax_walkthrough: 'a gentle forward walkthrough with tasteful parallax',
    soft_bokeh_sequence: 'a soft atmospheric rack-focus and bokeh-breathing move',
  };
  const movement = movementByStyle[styleKey] || 'a refined cinematic camera move';
  return `Create one continuous empty-wedding first/last-frame video using the uploaded references: start from Image 1 and end on Image 2. Use ${movement} to connect the two required frames. Preserve both referenced venue views, decor layout, object categories, color palette, lighting mood and material realism. Do not add people, text, logos, unsupported props, or unrelated wedding scenes.`;
}

// 所有运镜风格通用：保持场景一致性、不穿帮、不转场、道具细节真实。会追加到每个 style.prompt 末尾。
const MOTION_CONSISTENCY_RULES = [
  'REFERENCE FILE LOCK: Treat motion-source.jpg as Image 1 and motion-reference-2.jpg as Image 2 when present. With two images, Image 1 is the opening frame and Image 2 is the required ending frame. Do not swap the order and do not substitute the final uploaded image with a generic wedding detail.',
  'STRICT SEQUENCE CONSISTENCY: The video must follow the uploaded images in order. Preserve the visible decor, floral language, drapery, stage/aisle relationship, color palette, lighting direction and venue identity of each referenced scene. Do NOT add unrelated tables, candles, chandeliers, chairs, guests, signs, props or background details that are not supported by the references.',
  'UNSUPPORTED OBJECT BAN: Treat the references as an allowed-object inventory. If an object type is absent from every reference, it must stay absent in the video. This especially blocks stock wedding additions such as white Chiavari ceremony chair rows, foreground tent-like draped curtains or canopies, new floral arches, new chandeliers, signage, doors, windows, columns, guests, staff and random aisle props. Candles, candelabra, table settings and loose petals may appear only when they are clearly visible in the uploaded references. Use empty floor, dark room edges, existing tables or existing floral areas instead of inventing filler.',
  'CINEMATIC CONTINUITY: Create one real-camera wedding film with elegant camera movement inside each referenced scene. When multiple reference images are supplied, use clean editorial hard cuts at the specified timestamps so every image becomes a readable shot. No split-screen, no montage cards, no slideshow presentation, no slow dissolves, no prolonged blur, and no invented scenes.',
  'PHYSICAL & TEMPORAL STABILITY: Within each referenced scene, objects stay in their original position and orientation. No melting, no warping, no floating, no glitching, no morphing flowers, no growing/shrinking objects, no disappearing/appearing props within a scene, no color shifts, no weather changes, no people walking in or out of frame. Scene changes must happen during the soft transition, not by visible object morphing.',
  'EMPTY WEDDING ATMOSPHERE: Keep the venue empty and serene. Add only subtle, physically plausible atmosphere that is supported by the references: soft golden-hour or warm ambient light, gentle lens flare, delicate dust motes in visible light beams, candlelight flicker if candles exist, crystal sparkle if chandeliers or crystal props exist, and a very gentle breeze moving visible fabric if drapery exists. Do not invent candles, chandeliers, fairy lights, sunlight or wind effects when the images do not support them.',
  'PROP DETAIL & MATERIAL REALISM (HIGH PRIORITY): Render only the props and materials that already exist in the uploaded references, but render those with strong photographic detail and authentic materials. Existing flowers must show individual petals with subtle veins, soft natural creases, dewy highlights and accurate species shape (rose, hydrangea, peony, eucalyptus, baby breath, etc. — match exactly to the input). Existing fabrics must show real woven texture, soft folds, gentle wrinkles, light translucency and weight under gravity. Existing crystal, glass, metal, candle, ribbon, bow, wood floor, aisle carpet and stage materials should keep their real texture and scale. Do not introduce any of these materials as new props. Avoid any plastic-looking, CG-rendered, over-saturated, over-smooth, doll-like or cartoon look. The entire frame must feel like a high-end DSLR / cinema-camera capture (Sony FX / ARRI / RED look) with real-world depth of field, real bokeh shape and natural color science.',
].join(' ');

function buildFallbackMotionPrompt(styleKey = DEFAULT_MOTION_STYLE, count = 1) {
  return [
    motionStylePromptForCount(styleKey, count),
    motionTimelinePrompt(styleKey, count),
    motionReferenceRolePrompt(count),
    MOTION_CONSISTENCY_RULES,
  ].join(' ').replace(/\s+/g, ' ').trim().slice(0, 2600);
}

function finalizeMotionPrompt(rawPrompt = '', styleKey = DEFAULT_MOTION_STYLE, count = 1) {
  const stylePrompt = motionStylePromptForCount(styleKey, count);
  const cleaned = String(rawPrompt || '').replace(/\s+/g, ' ').trim();
  const parts = [];

  if (!cleaned.includes(stylePrompt.slice(0, 80))) {
    parts.push(stylePrompt);
  }
  if (cleaned) parts.push(cleaned);
  if (!/SINGLE-IMAGE TIMING|TWO-IMAGE(?: FIRST\/LAST-FRAME)? TIMING|THREE-IMAGE TIMING/.test(cleaned)) {
    parts.push(motionTimelinePrompt(styleKey, count));
  }
  if (!/REFERENCE IMAGE ROLES/.test(cleaned)) {
    parts.push(motionReferenceRolePrompt(count));
  }
  if (!/REFERENCE FILE LOCK/.test(cleaned)) {
    parts.push(MOTION_CONSISTENCY_RULES);
  }
  parts.push(`Final output: ${Math.max(1, Number(MOTION_VIDEO_DURATION || 10))} seconds, 16:9, cinematic empty wedding venue video, no text overlay, no logo overlay, no people.`);

  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 3200);
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
    ['同款延伸', 'one polished same-style wedding reference based on this wedding; keep the same domestic wedding aesthetic family, venue type, palette, stage/backdrop relationship, aisle or T-stage structure, grounded road-guide florals, lighting mood and practical Chinese banquet-hall realism, while changing only safe visual details so it feels similar but not copied'],
  ],
  setup_comparison: [
    ['布置前空场地图', 'create the before-decoration empty venue image inferred from the uploaded already-decorated wedding photo; remove ALL wedding decorations (floral installations, drapery and fabric, ceiling chandeliers or hanging florals, aisle/runner decor, candles, props, ceremony arch, stage decor, banquet table setups, chair sashes, event-specific lighting) and reveal the bare venue underneath; keep the venue architecture, camera perspective, floor direction, wall/ceiling structure, windows/doors, columns, main stage or aisle space; render as a plain empty hotel ballroom or event hall under neutral ambient lighting, as if photographed before any wedding setup was installed'],
  ],
  design_render_scene: [
    ['真实现场图', 'same camera composition as the uploaded design render, transformed into one ordinary real event-photographer photo of the finished installation; preserve the exact stage/backdrop shape, aisle or runway path, ceiling/hanging decor, left-right layout, floral positions, drapery curves, table/chair relationship, color palette and lighting direction; replace CG surfaces with real fabric, real flowers, real floor contact shadows, practical rigging, stage seams, lamp hardware, banquet-hall floor texture and slightly imperfect real venue materials; avoid 3D render, Octane/Unreal/CGI look, showroom perfection or over-polished concept-art lighting'],
  ],
  venue_fusion: [
    ['空地融合婚礼效果图', 'install the wedding material from Reference Image 2 into the exact empty land or empty venue from Reference Image 1; lock Reference Image 1 camera viewpoint, indoor/outdoor identity, ground or floor material, architecture, horizon if present, scale and lighting direction; transfer only the Reference Image 2 wedding style, stage/aisle/floral/fabric/lighting language where it physically fits; if the material contains a stage/runway/stair deck, render it as a raised platform with visible height and riser edges, not a flat floor overlay; for indoor ballrooms add round banquet dining tables with hotel chairs on both sides of the central aisle while keeping the aisle open; rebuild the material as a real photographed installation with Image 1 exposure, lens, shadows, noise and color temperature, not as a pasted CGI render; create one finished photorealistic wedding setup in that same space'],
  ],
  product_matrix: [
    ['方案施工矩阵图', 'create one vertical high-end wedding design construction matrix board based on the uploaded wedding case, matching the NEW numbered construction-board layout: matte charcoal background, NO big centered title header, top-left large 45-degree main perspective view, top-right front elevation and floor plan, middle-left true exploded axonometric construction view, middle-right detail thumbnail grid, and one full-width bottom modular component/material library. Preserve the uploaded wedding identity: theme, palette, floral language, stage/aisle structure, lighting mood, fabric, ceiling/truss, table/chair relationship and distinctive props. Generate the visual base only and let the app overlay all labels and borders later: no readable Chinese, English, numbers, section titles, captions, dimension marks, rulers, callout arrows, table text, watermarks, logos, floating black tags, white caption bands, QR codes or random text. Do not draw your own gold panel borders, grid frames, tables, tangled guide lines or fake technical labels. Keep clean dark gutters between modules. Reserve a plain dark empty title strip at the top of every panel, and reserve a taller plain dark empty header strip above the bottom material library so later text never covers materials. Put all material thumbnails fully below that header strip and centered inside their columns. The board should feel dense, luxurious, proposal-ready, realistic 3D-rendered and useful for construction communication. The exploded axonometric panel must show separated construction layers without written callouts or dimension labels, not a finished bird-eye render.'],
  ],
  handdrawn_plan: [
    ['手绘方案推演图', 'create one vertical 9:16 high-end wedding stage design hand-drawn proposal board based on the uploaded wedding photo, matching the polished vintage paper designer-board effect: warm beige paper grain background, elegant handwritten Chinese-style main title area, large central wedding stage hero rendering, surrounding floor plan, front elevation, side elevation, core structure analysis, material analysis, lighting design, color palette swatches, and close-up detail enlargements. Preserve the uploaded wedding identity: theme, palette, floral language, stage/aisle structure, ceiling shape, lighting mood, fabric/drapery material, table/chair relationship and distinctive props. Style should be watercolor hand rendering + precise pencil/ink architectural linework + realistic 3D wedding visualization. Use sparse large handwritten Chinese-style headings only; avoid dense paragraphs, tiny fake text, random English, watermarks, logos, UI, people, and unreadable clutter.'],
  ],
  outdoor_handdrawn_plan: [
    ['户外小清新手绘图', 'create one vertical premium wedding/event planning visual proposal board in hand-drawn watercolor architectural sketch style. Use the uploaded image as reference, and infer missing placeholders such as theme/brand, fresh outdoor romantic artistic premium mood, main colors, accent color and venue type from the uploaded image or user notes. Upper half: immersive complete outdoor main scene with ceremony area, lawn, tree/garden background, guest seating, floral installation and main visual structure; include one large central artistic installation such as flowing ribbon sculpture, abstract sculpture, floral arch or clear acrylic structure, surrounded by abundant floral materials, fruit or props, light clean dreamy feeling. Lower half: professional wedding design breakdown moodboard with small illustrations and annotation modules: STRUCTURES & SEATING 结构与座椅, COLOR PALETTE 色彩展示, FLORAL MATERIALS 花材清单, CENTERPIECE DETAIL 桌花细节, SIGNAGE / WELCOME BOARD 指示牌设计, DESSERT / DRINK DISPLAY 甜品饮品区, FABRIC / DRAPING 布幔材质, CLEAR ACRYLIC CHAIR 透明座椅. Include bilingual small labels, color swatches, floral icons, local effect sketches and handwritten annotations. White background, generous negative space, exquisite fresh commercial proposal feeling. Do not make it photographic, 3D rendered, thick oil painting, dark, heavy or overfilled.'],
  ],
  construction_checklist: [
    ['落地施工清单图', 'from the uploaded wedding construction matrix board, create one complete vertical construction handoff checklist board in the same layout as a professional wedding landing construction sheet: large top-left photorealistic hero render, top-right project overview and design-highlight cards, middle floor-plan/front-elevation/side-elevation technical views, lower build-material list area, construction material thumbnail grid, build-step strip, safety notes, lighting suggestion and upgrade configuration table. Use the uploaded matrix as the controlling blueprint and preserve its exact theme, palette, floral style, stage/aisle structure, ceiling/truss, drapery, lighting and distinctive props. Focus the material areas on installable construction items: truss, fabric, foam-carved props, stage decks, aisle runner, floral installations, hanging decor, lighting, power and setup accessories. Do not show hotel dining materials in the material list or thumbnail grid: no banquet round tables, chair covers, tableware, napkins, plates, cutlery or dining service items. Generate a clean visual base only; the app will overlay stable Chinese labels and tables afterward.'],
  ],
  detail_grid: [
    ['九宫格细节图', 'generate one vertical 3x3 same-stage wedding album with GPT image generation based on the uploaded wedding stage photo: create multiple camera views and detail views of the exact same stage, preserving the same backdrop, aisle, lighting, floral color, materials and spatial relationship. Do not crop-compose the source image and do not redesign the wedding.'],
  ],
  setup_process_grid: [
    ['搭建视频九宫格', 'generate one horizontal 16:9 photorealistic 3x3 wedding setup-process grid based on the uploaded finished wedding photo: infer a believable chronological build sequence from empty venue to final completed scene while preserving the same venue, camera identity, literal top boundary, architectural ceiling or open-air top exactly as shown, color palette, floral language, drapery, lighting, stage/aisle relationship and decor style. Default assumption: NO suspended ceiling decor. Only if the uploaded finished photo unmistakably shows real overhead wedding installation inside the wedding design may overhead work appear. If the top is cropped, dark, plain, ambiguous, or only shows normal venue ceiling/lighting, treat it as no吊顶 and keep every panel without ceiling/canopy/hanging installation. Do not redesign or replace the wedding top area.'],
  ],
  photo_area_setup_grid: [
    ['留影区搭建九宫格', 'generate one horizontal 16:9 photorealistic 3x3 wedding photo-area setup-process grid based on the uploaded finished wedding photo area image: infer a believable chronological build sequence from empty wall/entrance/photo spot to final completed photo area while preserving the same location, wall or outdoor background, ground material, camera identity, photo backdrop, welcome sign, floral palette, props, lighting mood and spatial relationship. This is about a wedding photo area / welcome photo zone / sign-in backdrop, not the main ceremony stage or banquet hall. Do not invent an aisle, main stage, dining tables, ceremony arch or unrelated wedding scene.'],
  ],
  partial_wedding_edit: [
    ['局部改图候选 1', 'first conservative local-edit candidate; use Reference Image 1 as the locked base photo, keep its full layout and identity anchors, and only add or replace the exact decor objects requested by the user inside the requested area'],
    ['局部改图候选 2', 'second conservative local-edit candidate with only a small difference in placement or density; still preserve Reference Image 1 background, signboard/poster layout, camera angle, palette, architecture and all unedited areas'],
  ],
  ps_layer_split: [
    ['01-fixed-background-and-architecture', 'Keep only the original fixed scene/background structure that actually appears in the source image: venue architecture, building/wall/backdrop, stage frame, fixed columns, fixed panels and non-movable structural pieces. Remove movable flowers, fabric, table settings, chairs, aisle/carpet and loose decor. If a named object is not visible in the source, leave it out instead of inventing it.'],
    ['02-fabric-drapery-and-hanging-decor', 'Keep only fabric, curtains, drapery, hanging pendants, hanging lamps and suspended decor that actually appears in the source image. Preserve the original color, material and exact source position. Remove architecture, flowers, carpet/aisle, tables, chairs and floor base. If no fabric or hanging decor exists, leave this layer mostly white.'],
    ['03-center-focal-decor', 'Keep only the central focal decor group that actually appears in the source image: central flowers, sign/prop/focal installation or center-stage decorative cluster. Remove left/right side groups, architecture, fabric, tables, chairs, carpet and floor base.'],
    ['04-left-side-decor', 'Keep only the visible left-side decor group from the source image: left floral clusters, left-side props, left aisle flowers, left-side fabric or hanging decor if it belongs to that side. Remove center/right groups, architecture, tables, chairs and carpet unless the visible object is directly part of the left-side decor.'],
    ['05-right-side-decor', 'Keep only the visible right-side decor group from the source image: right floral clusters, right-side props, right aisle flowers, right-side fabric or hanging decor if it belongs to that side. Remove center/left groups, architecture, tables, chairs and carpet unless the visible object is directly part of the right-side decor.'],
    ['06-floor-aisle-stage-and-low-flowers', 'Keep only the source image floor/aisle/runway/stage platform/base and low flower line or ground-level floral groups. Preserve the original carpet/floor color and exact perspective. Remove backdrop, vertical fabric, hanging decor, tables, chairs and upper floral elements.'],
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
  '- First classify the uploaded reference as indoor ballroom / outdoor open-air / courtyard / terrace / garden / lawn / seaside / forest / tented venue, then keep that venue identity in every frame. If the uploaded reference is outdoor or open-air, every frame must keep outdoor ground, sky/trees/garden/horizon/exterior context when visible and must NOT become an indoor ballroom, hotel hall, chapel, studio, greenhouse, palace corridor, carpeted room or curtain-walled interior.',
  '- If the reference shows outdoor lawn/grass/trees/sky plus drapery, arches or floral frames, the drapery is outdoor ceremony decor only. Do not reinterpret it as indoor walls, hotel curtains, ballroom ceiling, stage curtains or an enclosed room.',
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
    editMaskFile: options.editMaskFile || null,
    editInstruction: options.editInstruction || '',
    userInstruction: options.userInstruction || '',
    freeImagePrompt: options.freeImagePrompt || '',
    freeImageSize: options.freeImageSize || '1024x1024',
    freeImageQuality: options.freeImageQuality || 'auto',
    freeImageFormat: options.freeImageFormat || 'jpeg',
    freeImageCount: options.freeImageCount || 1,
    freeImageReferences: [],
    setupBrandName: options.setupBrandName || '',
    imageEnhanceSize: normalizeImageEnhanceSize(options.imageEnhanceSize),
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
  const publicBaseUrl = currentPublicBaseUrl();
  if (!publicBaseUrl || !/^https?:\/\//i.test(value)) return value;
  try {
    const base = new URL(publicBaseUrl);
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

function wantsDocumentResponse(req) {
  const fetchDest = String(req.headers['sec-fetch-dest'] || '').toLowerCase();
  if (fetchDest === 'document') return true;
  return String(req.headers.accept || '').toLowerCase().includes('text/html');
}

function resourceLibrarySharePath(resourceId, resource = null) {
  const params = new URLSearchParams();
  const tenantSlug = String(resource?.tenantSlug || '').trim();
  if (tenantSlug) params.set('partner', tenantSlug);
  params.set('resource', resourceId);
  return `/?${params.toString()}#resources`;
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
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    console.warn(`[resources] failed to read manifest: ${error.message}`);
    throw error;
  }
}

async function backupResourceManifest() {
  if (!existsSync(RESOURCES_MANIFEST)) return;
  try {
    await copyFile(RESOURCES_MANIFEST, `${RESOURCES_MANIFEST}.bak`);
  } catch (error) {
    console.warn(`[resources] failed to back up manifest: ${error.message}`);
  }
}

async function writeJsonFileAtomic(filePath, payload) {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, payload, 'utf8');
  await rename(tmpPath, filePath);
}

async function writeResourceManifest(resources) {
  await mkdir(RESOURCES_DIR, { recursive: true });
  await backupResourceManifest();
  await writeJsonFileAtomic(RESOURCES_MANIFEST, JSON.stringify({ resources }, null, 2));
}

let resourceManifestQueue = Promise.resolve();

async function updateResourceManifest(mutator) {
  const run = resourceManifestQueue.then(async () => {
    const resources = await readResourceManifest();
    const nextResources = await mutator(resources);
    await writeResourceManifest(Array.isArray(nextResources) ? nextResources : resources);
    return nextResources;
  });
  resourceManifestQueue = run.catch(() => {});
  return run;
}

async function appendResourceCleanupLog(entry) {
  await mkdir(DATA_DIR, { recursive: true });
  await appendFile(RESOURCE_CLEANUP_LOG, `${JSON.stringify({
    cleanedAt: new Date().toISOString(),
    ...entry,
  })}\n`, 'utf8');
}

async function enforceResourceRetention(resources, source = 'retention') {
  const plan = planResourceRetention(resources, {
    limitPerOwner: RESOURCE_RETENTION.limitPerOwner,
    retentionDays: RESOURCE_RETENTION.retentionDays,
  });
  if (!plan.removed.length) {
    return { resources, removed: [] };
  }

  const removedIds = new Set();
  const removed = [];
  for (const entry of plan.removed) {
    const resource = entry.resource || {};
    const id = String(resource.id || '').trim();
    if (!id) continue;
    try {
      await deleteSavedResource(id);
      removedIds.add(id);
      removed.push(entry);
      await appendResourceCleanupLog({
        source,
        reason: entry.reason,
        id,
        ownerKey: entry.ownerKey,
        mode: resource.mode || '',
        createdAt: resource.createdAt || '',
        expiresAt: resource.expiresAt || '',
      });
    } catch (error) {
      console.warn(`[resources] cleanup failed id=${id}: ${error.message}`);
      await appendResourceCleanupLog({
        source,
        reason: entry.reason,
        id,
        ownerKey: entry.ownerKey,
        failed: true,
        error: error.message,
      }).catch(() => {});
    }
  }

  return {
    resources: resources.filter((resource) => !removedIds.has(String(resource?.id || '').trim())),
    removed,
  };
}

async function addResourceToManifest(resource) {
  await updateResourceManifest(async (resources) => {
    const proposed = [resource, ...resources.filter((item) => item?.id !== resource.id)];
    const retained = await enforceResourceRetention(proposed, 'save');
    return retained.resources;
  });
}

async function cleanupSavedResources(source = 'interval') {
  let removed = [];
  await updateResourceManifest(async (resources) => {
    const retained = await enforceResourceRetention(resources, source);
    removed = retained.removed;
    return retained.resources;
  });
  if (removed.length) {
    console.log(`[resources] cleanup removed ${removed.length} resource(s) from ${source}`);
  }
  return removed;
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
  const rechargePlans = tenantRechargePlansText();
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
    rechargePlans,
    rechargePlanItems: publicRechargePlans(rechargePlans),
    plan: 'platform',
    defaultTenant: true,
  };
}

function publicTenant(tenant = null) {
  if (!tenant) return defaultTenantContext();
  const fallback = defaultTenantContext();
  const slug = normalizeTenantSlug(tenant.slug || tenant.id || '');
  const rechargePlans = tenantRechargePlansText(tenant);
  return {
    id: String(tenant.id || '').trim(),
    slug,
    name: fallback.name,
    logoUrl: fallback.logoUrl,
    logoText: fallback.logoText,
    tagline: fallback.tagline,
    brandColor: '',
    supportWechat: String(tenant.supportWechat || '').trim(),
    supportWechatQr: publicAbsoluteUrl(tenant.supportWechatQr || ''),
    supportContacts: publicSupportContacts(tenant),
    rechargePlans,
    rechargePlanItems: publicRechargePlans(rechargePlans),
    plan: String(tenant.plan || '').trim(),
    inviteUrl: slug ? publicAbsoluteUrl(`/?partner=${encodeURIComponent(slug)}`) : '',
    defaultTenant: false,
  };
}

function publicWebTenant(tenant = null) {
  const context = publicTenant(tenant);
  if (context.defaultTenant) return context;
  return {
    ...context,
    supportWechat: '',
    supportWechatQr: '',
    supportContacts: [],
    rechargePlans: '',
    rechargePlanItems: [],
  };
}

function publicWebRechargeFields(tenantContext = {}) {
  const isDefaultTenant = !!tenantContext.defaultTenant;
  const rechargePlans = isDefaultTenant
    ? (tenantContext.rechargePlans || tenantRechargePlansText(tenantContext))
    : '';
  return {
    supportWechat: isDefaultTenant ? tenantContext.supportWechat : '',
    supportWechatQr: isDefaultTenant ? tenantContext.supportWechatQr : '',
    supportContacts: isDefaultTenant ? (tenantContext.supportContacts || []) : [],
    rechargePlans,
    rechargePlanItems: isDefaultTenant
      ? (tenantContext.rechargePlanItems || publicRechargePlans(rechargePlans))
      : [],
  };
}

function publicAdminTenant(tenant = null) {
  const item = publicTenant(tenant);
  return {
    ...item,
    name: String(tenant?.name || tenant?.brandName || item.name).trim(),
    logoUrl: publicAbsoluteUrl(tenant?.logoUrl || tenant?.logo || ''),
    logoText: String(tenant?.logoText || tenant?.shortName || tenant?.name || item.logoText).trim().slice(0, 2) || item.logoText,
    tagline: String(tenant?.tagline || item.tagline).trim(),
    brandColor: String(tenant?.brandColor || '').trim(),
    status: String(tenant?.status || 'active').trim(),
    domains: tenantDomains(tenant),
    adminUserIds: Array.isArray(tenant?.adminUserIds) ? tenant.adminUserIds.map(String).filter(Boolean) : [],
    customRechargePlans: String(tenant?.rechargePlans || '').trim(),
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

function safeTenantAssetId(value = '') {
  return path.basename(String(value || '')).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

async function saveTenantWechatQrImage(tenantId, file) {
  const safeTenantId = safeTenantAssetId(tenantId);
  if (!safeTenantId) {
    const error = new Error('合作方参数不完整');
    error.status = 400;
    throw error;
  }
  if (!file?.buffer?.length) {
    const error = new Error('请上传微信图片');
    error.status = 400;
    throw error;
  }
  if (!/^image\//i.test(String(file.mimetype || ''))) {
    const error = new Error('只支持上传图片文件');
    error.status = 400;
    throw error;
  }
  let output;
  try {
    output = await sharp(file.buffer)
      .rotate()
      .resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch {
    const error = new Error('图片无法识别，请重新上传微信图片');
    error.status = 400;
    throw error;
  }
  const dir = path.join(TENANT_ASSETS_DIR, safeTenantId);
  await mkdir(dir, { recursive: true });
  const filename = `wechat-${Date.now().toString(36)}.png`;
  await writeFile(path.join(dir, filename), output);
  return `/tenant-assets/${encodeURIComponent(safeTenantId)}/${encodeURIComponent(filename)}`;
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
  if (options.userTenantScope && ACCOUNT_SYSTEM_ENABLED) {
    const user = options.user || req.user || await sessionUser(req);
    if (user) {
      if (!user.tenantId) return null;
      const byUser = tenants.find((tenant) => String(tenant.id || '') === String(user.tenantId));
      return byUser || null;
    }
  }
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
  if (options.useUserTenant && ACCOUNT_SYSTEM_ENABLED) {
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
  const context = publicWebTenant(tenant);
  return {
    tenant: context,
    defaultTenant: !!context.defaultTenant,
    partner: context.defaultTenant ? '' : context.slug,
    sms: publicSmsStatus(),
  };
}

function smsChannelStatus() {
  if (SMS_PROVIDER === 'smsbao') {
    const missing = [
      ['SMSBAO_USERNAME', SMSBAO_USERNAME],
      ['SMSBAO_PASSWORD_MD5 or SMSBAO_PASSWORD', SMSBAO_PASSWORD_MD5 || SMSBAO_PASSWORD],
      ['SMSBAO_SIGN_NAME', SMSBAO_SIGN_NAME],
    ].filter(([, value]) => !value).map(([key]) => key);
    return {
      provider: 'smsbao',
      ready: missing.length === 0,
      missing,
      debugOnly: false,
      message: missing.length ? `短信宝配置缺失：${missing.join(', ')}` : '',
    };
  }
  if (SMS_PROVIDER === 'tencent') {
    const missing = [
      ['TENCENT_SMS_SECRET_ID', TENCENT_SMS_SECRET_ID],
      ['TENCENT_SMS_SECRET_KEY', TENCENT_SMS_SECRET_KEY],
      ['TENCENT_SMS_SDK_APP_ID', TENCENT_SMS_SDK_APP_ID],
      ['TENCENT_SMS_SIGN_NAME', TENCENT_SMS_SIGN_NAME],
      ['TENCENT_SMS_TEMPLATE_ID', TENCENT_SMS_TEMPLATE_ID],
    ].filter(([, value]) => !value).map(([key]) => key);
    return {
      provider: 'tencent',
      ready: missing.length === 0,
      missing,
      debugOnly: false,
      message: missing.length ? `腾讯云短信配置缺失：${missing.join(', ')}` : '',
    };
  }
  if (SMS_PROVIDER === 'webhook') {
    return {
      provider: 'webhook',
      ready: !!SMS_WEBHOOK_URL,
      missing: SMS_WEBHOOK_URL ? [] : ['SMS_WEBHOOK_URL'],
      debugOnly: false,
      message: SMS_WEBHOOK_URL ? '' : 'SMS_WEBHOOK_URL 未配置',
    };
  }
  if (SMS_PROVIDER === 'log' || SMS_PROVIDER === 'console' || SMS_PROVIDER === 'mock') {
    return {
      provider: SMS_PROVIDER,
      ready: SMS_DEBUG_LOG_CODE,
      missing: SMS_DEBUG_LOG_CODE ? [] : ['SMS_DEBUG_LOG_CODE=true'],
      debugOnly: true,
      message: SMS_DEBUG_LOG_CODE
        ? '短信调试模式已开启，验证码只会写入服务器日志'
        : '短信调试模式未开启。若仅用于本地排查，请设置 SMS_DEBUG_LOG_CODE=true',
    };
  }
  return {
    provider: SMS_PROVIDER || 'disabled',
    ready: false,
    missing: ['SMS_PROVIDER'],
    debugOnly: false,
    message: '短信服务未配置，请设置 SMS_PROVIDER=smsbao 并填写短信宝参数',
  };
}

function publicSmsStatus() {
  const status = smsChannelStatus();
  return {
    provider: status.provider,
    ready: status.ready && !status.debugOnly,
    debugOnly: !!status.debugOnly,
    ttlSeconds: PHONE_CODE_TTL_SECONDS,
    resendSeconds: PHONE_CODE_RESEND_SECONDS,
  };
}

function smsFailurePayload(tenant = null, error = null) {
  const tenantContext = publicWebTenant(tenant);
  const message = error?.message || smsChannelStatus().message || '短信验证码发送失败，请稍后再试';
  return {
    ok: false,
    error: `${message}。如一直收不到验证码，请联系运营手动开通账号。`,
    code: 'SMS_SEND_FAILED',
    supportWechat: tenantContext.supportWechat,
    supportWechatQr: tenantContext.supportWechatQr,
    supportContacts: tenantContext.supportContacts,
    sms: publicSmsStatus(),
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
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error(`[accounts] failed to read ${USERS_FILE}: ${error.message}`);
      throw error;
    }
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

async function readGeoCertificationStore() {
  try {
    const payload = JSON.parse(await readFile(GEO_CERTIFICATIONS_FILE, 'utf8'));
    return { records: Array.isArray(payload.records) ? payload.records : [] };
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error(`[geo] failed to read ${GEO_CERTIFICATIONS_FILE}: ${error.message}`);
      throw error;
    }
    return { records: [] };
  }
}

async function writeGeoCertificationStore(store) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(GEO_CERTIFICATIONS_FILE, JSON.stringify({
    records: Array.isArray(store.records) ? store.records : [],
  }, null, 2), 'utf8');
}

let geoCertificationQueue = Promise.resolve();

async function mutateGeoCertificationStore(mutator) {
  const run = geoCertificationQueue.then(async () => {
    const store = await readGeoCertificationStore();
    const result = await mutator(store);
    await writeGeoCertificationStore(store);
    return result;
  });
  geoCertificationQueue = run.catch(() => {});
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
    weddingStyleProfile: job.weddingStyleProfile || null,
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

function normalizePhone(phone) {
  return String(phone || '').replace(/\D+/g, '');
}

function isMainlandPhone(phone) {
  return /^1[3-9]\d{9}$/.test(normalizePhone(phone));
}

function normalizeLogin(login) {
  const raw = String(login || '').trim().toLowerCase();
  const phone = normalizePhone(raw);
  return isMainlandPhone(phone) && !/[a-z_]/i.test(raw) ? phone : raw;
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(5).toString('hex')}`;
}

function generateLoginCode() {
  return randomBytes(4).toString('hex');
}

function generatePhoneVerificationCode() {
  return (randomBytes(4).readUInt32BE(0) % 1_000_000).toString().padStart(6, '0');
}

function randomIntInclusive(min, max) {
  const low = Math.ceil(Number(min));
  const high = Math.floor(Number(max));
  return low + (randomBytes(4).readUInt32BE(0) % (high - low + 1));
}

function captchaSignature(payloadEncoded) {
  return createHmac('sha256', ACCOUNT_TOKEN_SECRET)
    .update(`wedscene-register-captcha:${payloadEncoded}`)
    .digest('base64url');
}

function createRegisterCaptcha() {
  const a = randomIntInclusive(2, 9);
  const b = randomIntInclusive(1, 9);
  const payload = {
    a,
    b,
    op: '+',
    exp: Date.now() + REGISTER_CAPTCHA_TTL_SECONDS * 1000,
    nonce: randomBytes(8).toString('hex'),
  };
  const payloadEncoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = captchaSignature(payloadEncoded);
  return {
    question: `${a} + ${b} = ?`,
    token: `${payloadEncoded}.${signature}`,
    expiresIn: REGISTER_CAPTCHA_TTL_SECONDS,
  };
}

function verifyRegisterCaptcha(token, answer) {
  const [payloadEncoded, signature] = String(token || '').split('.');
  if (!payloadEncoded || !signature) {
    return { ok: false, status: 400, error: '请先获取验证码' };
  }
  if (!safeEqualText(signature, captchaSignature(payloadEncoded))) {
    return { ok: false, status: 400, error: '验证码已失效，请刷新重试' };
  }
  let payload = null;
  try {
    payload = JSON.parse(Buffer.from(payloadEncoded, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, status: 400, error: '验证码已失效，请刷新重试' };
  }
  if (Number(payload?.exp || 0) <= Date.now()) {
    return { ok: false, status: 400, error: '验证码已过期，请刷新重试' };
  }
  const expected = Number(payload?.a || 0) + Number(payload?.b || 0);
  const input = Number(String(answer || '').replace(/[^\d-]/g, ''));
  if (!Number.isFinite(input) || input !== expected) {
    return { ok: false, status: 400, error: '验证码不正确，请重新输入' };
  }
  return { ok: true };
}

function hashLoginCodeWithSecret(login, code, secret) {
  return createHmac('sha256', secret)
    .update(`wedscene-login-code:${normalizeLogin(login)}:${String(code || '')}`)
    .digest('hex');
}

function hashLoginCode(login, code) {
  return hashLoginCodeWithSecret(login, code, ACCOUNT_TOKEN_SECRET);
}

function legacyLoginCodeMatched(storedHash, login, code) {
  return ACCOUNT_LEGACY_TOKEN_SECRETS.some((secret) => (
    safeEqualText(storedHash, hashLoginCodeWithSecret(login, code, secret))
  ));
}

function maskLoginForLog(login) {
  return String(login || '').replace(/^(\d{3})\d+(\d{4})$/, '$1****$2').slice(0, 64);
}

function hashPhoneVerificationCode(phone, code) {
  return createHmac('sha256', ACCOUNT_TOKEN_SECRET)
    .update(`wedscene-phone-code:${normalizePhone(phone)}:${String(code || '')}`)
    .digest('hex');
}

function publicUser(user) {
  if (!user) return null;
  const displayName = displayAccountName(user.name, user.login);
  const membershipExpiresAt = user.membershipExpiresAt || '';
  const membershipExpiryTime = Date.parse(membershipExpiresAt);
  const hasMembershipExpiry = Number.isFinite(membershipExpiryTime);
  const membershipPermanent = isPermanentMembership(user);
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
    membershipPermanent,
    membershipStatus: hasMembershipExpiry
      ? (membershipExpiryTime >= Date.now() ? 'active' : 'expired')
      : 'none',
    motionAllowed: canUseMotionFeatures(user),
    motionAccessLabel: motionAccessLabel(user),
    superCustomAllowed: true,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function hasActiveMembership(user, now = Date.now()) {
  if (!user) return false;
  if (isPermanentMembership(user)) return true;
  const expiryTime = Date.parse(user.membershipExpiresAt || '');
  return Number.isFinite(expiryTime) && expiryTime >= now;
}

const SUPER_CUSTOM_ANNUAL_REQUIRED_MESSAGE = '超级定制已开放，登录账号并保持灵感值充足即可使用。';

function isSuperCustomBypassUser(user) {
  if (!user) return false;
  const roleText = `${user.role || ''} ${user.source || ''} ${user.tenantRole || ''}`.toLowerCase();
  return /tenant_admin|(^|[\s_-])(admin|owner|test)([\s_-]|$)|管理员|测试/.test(roleText);
}

function isImageOnlyMembershipPlan(plan = '') {
  return IMAGE_ONLY_PLAN_PATTERN.test(String(plan || ''));
}

function isLegacyVideoCustomer(user = {}) {
  const createdAt = Date.parse(user.createdAt || '');
  return Number.isFinite(createdAt) && createdAt < LEGACY_VIDEO_ACCESS_CUTOFF;
}

function canUseMotionFeatures(user, now = Date.now()) {
  if (!ACCOUNT_SYSTEM_ENABLED) return true;
  if (!user) return false;
  if (isSuperCustomBypassUser(user)) return true;
  if (isLegacyVideoCustomer(user)) return true;
  if (isImageOnlyMembershipPlan(user.membershipPlan)) return false;
  return hasActiveMembership(user, now);
}

function motionAccessLabel(user = {}) {
  if (!user) return '未登录';
  if (isSuperCustomBypassUser(user)) return '视频可用（管理）';
  if (isLegacyVideoCustomer(user)) return '视频可用（老客户）';
  if (isImageOnlyMembershipPlan(user.membershipPlan)) return '仅图片功能';
  if (hasActiveMembership(user)) return '视频可用';
  return '未开通视频';
}

function canUseSuperCustom(user, now = Date.now()) {
  return !ACCOUNT_SYSTEM_ENABLED || !!user;
}

function displayAccountName(name, fallback) {
  const rawName = String(name || '').trim();
  return (!rawName || /^[?\s]+$/.test(rawName) || rawName.includes('�'))
    ? fallback
    : rawName;
}

function isPermanentMembership(user = {}) {
  return user?.membershipPermanent === true
    || String(user?.membershipPlan || '').includes('永久')
    || String(user?.membershipExpiresAt || '') === PERMANENT_MEMBERSHIP_EXPIRES_AT;
}

function extendMembership(user, durationDays, now = new Date(), meta = {}) {
  const days = Number(durationDays || 0);
  const permanent = days < 0 || String(meta.durationText || meta.membershipPlan || '').includes('永久');
  if (permanent) {
    const previousExpiresAt = user.membershipExpiresAt || '';
    user.membershipExpiresAt = PERMANENT_MEMBERSHIP_EXPIRES_AT;
    user.membershipPermanent = true;
    user.membershipPlan = meta.membershipPlan || meta.planName || '';
    user.membershipUpdatedAt = now.toISOString();
    return {
      previousExpiresAt,
      expiresAt: PERMANENT_MEMBERSHIP_EXPIRES_AT,
      permanent: true,
    };
  }
  if (!Number.isFinite(days) || days <= 0) return null;
  if (isPermanentMembership(user)) {
    return {
      previousExpiresAt: user.membershipExpiresAt || '',
      expiresAt: PERMANENT_MEMBERSHIP_EXPIRES_AT,
      permanent: true,
    };
  }
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
const PHONE_CODE_STORE = new Map();
const PHONE_CODE_IP_RATE = new Map();
const LOGIN_IP_RATE = new Map();
const ADMIN_IP_RATE = new Map();
const GENERATE_IP_RATE = new Map();
const EXTERNAL_IMPORT_IP_RATE = new Map();
const GEO_IP_RATE = new Map();
const LOGIN_IP_LIMIT = Math.max(1, Number(process.env.LOGIN_IP_LIMIT || 20));
const LOGIN_IP_WINDOW_MS = Math.max(60_000, Number(process.env.LOGIN_IP_WINDOW_MS || 15 * 60 * 1000));
const ADMIN_IP_LIMIT = Math.max(1, Number(process.env.ADMIN_IP_LIMIT || 30));
const ADMIN_IP_WINDOW_MS = Math.max(60_000, Number(process.env.ADMIN_IP_WINDOW_MS || 15 * 60 * 1000));
const GENERATE_IP_LIMIT = Math.max(1, Number(process.env.GENERATE_IP_LIMIT || 60));
const GENERATE_IP_WINDOW_MS = Math.max(60_000, Number(process.env.GENERATE_IP_WINDOW_MS || 60 * 60 * 1000));
const EXTERNAL_IMPORT_IP_LIMIT = Math.max(1, Number(process.env.EXTERNAL_IMPORT_IP_LIMIT || 20));
const EXTERNAL_IMPORT_IP_WINDOW_MS = Math.max(60_000, Number(process.env.EXTERNAL_IMPORT_IP_WINDOW_MS || 60 * 60 * 1000));
const GEO_IP_LIMIT = Math.max(1, Number(process.env.GEO_IP_LIMIT || 30));
const GEO_IP_WINDOW_MS = Math.max(60_000, Number(process.env.GEO_IP_WINDOW_MS || 60 * 60 * 1000));
const GEO_CERT_AUTO_APPROVE_MS = Math.max(0, Number(process.env.GEO_CERT_AUTO_APPROVE_MS || 45_000));

function checkRateWindow(map, key, limit, windowMs) {
  if (!key) return { ok: true, retryAfter: 0 };
  const now = Date.now();
  const arr = (map.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    map.set(key, arr);
    const oldest = Math.min(...arr);
    return { ok: false, retryAfter: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)) };
  }
  arr.push(now);
  map.set(key, arr);
  return { ok: true, retryAfter: 0 };
}

function checkRegisterRate(ip) {
  return checkRateWindow(REGISTER_IP_RATE, ip, REGISTER_IP_LIMIT, REGISTER_IP_WINDOW_MS).ok;
}

function normalizeRemoteAddress(value = '') {
  return String(value || '').replace(/^::ffff:/, '').trim();
}

function isTrustedProxyAddress(value = '') {
  const ip = normalizeRemoteAddress(value);
  return ip === '::1'
    || ip === '127.0.0.1'
    || ip.startsWith('10.')
    || ip.startsWith('192.168.')
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip);
}

function clientIp(req) {
  const remote = normalizeRemoteAddress(req.socket?.remoteAddress || '');
  const forwarded = isTrustedProxyAddress(remote)
    ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    : '';
  return forwarded || req.socket?.remoteAddress || '';
}

function rateLimit(map, { limit, windowMs, message }) {
  return (req, res, next) => {
    const key = clientIp(req);
    const result = checkRateWindow(map, key, limit, windowMs);
    if (!result.ok) {
      res.setHeader('Retry-After', String(result.retryAfter));
      res.status(429).json({
        error: message || '请求过于频繁，请稍后再试',
        retryAfter: result.retryAfter,
      });
      return;
    }
    next();
  };
}

function prunePhoneVerificationCodes(now = Date.now()) {
  for (const [phone, entry] of PHONE_CODE_STORE.entries()) {
    if (!entry || Number(entry.expiresAt || 0) + PHONE_CODE_TTL_SECONDS * 1000 < now) {
      PHONE_CODE_STORE.delete(phone);
    }
  }
}

function phoneCodeCooldown(phone, now = Date.now()) {
  const entry = PHONE_CODE_STORE.get(phone);
  const elapsed = now - Number(entry?.lastSentAt || 0);
  const remaining = PHONE_CODE_RESEND_SECONDS * 1000 - elapsed;
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

function consumePhoneVerificationCode(phone, code) {
  const normalizedPhone = normalizePhone(phone);
  const inputCode = String(code || '').trim();
  const entry = PHONE_CODE_STORE.get(normalizedPhone);
  const now = Date.now();
  if (!entry) return { ok: false, status: 400, error: '请先获取短信验证码' };
  if (Number(entry.expiresAt || 0) <= now) {
    PHONE_CODE_STORE.delete(normalizedPhone);
    return { ok: false, status: 400, error: '短信验证码已过期，请重新获取' };
  }
  if (Number(entry.attempts || 0) >= PHONE_CODE_MAX_ATTEMPTS) {
    PHONE_CODE_STORE.delete(normalizedPhone);
    return { ok: false, status: 429, error: '验证码错误次数过多，请重新获取' };
  }
  const expected = hashPhoneVerificationCode(normalizedPhone, inputCode);
  if (!safeEqualText(entry.codeHash, expected)) {
    entry.attempts = Number(entry.attempts || 0) + 1;
    PHONE_CODE_STORE.set(normalizedPhone, entry);
    return { ok: false, status: 400, error: '短信验证码不正确' };
  }
  PHONE_CODE_STORE.delete(normalizedPhone);
  return { ok: true };
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hmacSha256(key, value, encoding = undefined) {
  return createHmac('sha256', key).update(value).digest(encoding);
}

function tencentSmsAuthorization({ payload, timestamp, action, host, region }) {
  const algorithm = 'TC3-HMAC-SHA256';
  const service = 'sms';
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    sha256Hex(payload),
  ].join('\n');
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = [
    algorithm,
    String(timestamp),
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const secretDate = hmacSha256(`TC3${TENCENT_SMS_SECRET_KEY}`, date);
  const secretService = hmacSha256(secretDate, service);
  const secretSigning = hmacSha256(secretService, 'tc3_request');
  const signature = hmacSha256(secretSigning, stringToSign, 'hex');
  return `${algorithm} Credential=${TENCENT_SMS_SECRET_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

async function sendTencentPhoneCode(phone, code) {
  const missing = [
    ['TENCENT_SMS_SECRET_ID', TENCENT_SMS_SECRET_ID],
    ['TENCENT_SMS_SECRET_KEY', TENCENT_SMS_SECRET_KEY],
    ['TENCENT_SMS_SDK_APP_ID', TENCENT_SMS_SDK_APP_ID],
    ['TENCENT_SMS_SIGN_NAME', TENCENT_SMS_SIGN_NAME],
    ['TENCENT_SMS_TEMPLATE_ID', TENCENT_SMS_TEMPLATE_ID],
  ].filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) {
    throw new Error(`腾讯云短信配置缺失：${missing.join(', ')}`);
  }

  const host = 'sms.tencentcloudapi.com';
  const action = 'SendSms';
  const timestamp = Math.floor(Date.now() / 1000);
  const ttlMinutes = String(Math.max(1, Math.ceil(PHONE_CODE_TTL_SECONDS / 60)));
  const payload = JSON.stringify({
    PhoneNumberSet: [`+86${phone}`],
    SmsSdkAppId: TENCENT_SMS_SDK_APP_ID,
    SignName: TENCENT_SMS_SIGN_NAME,
    TemplateId: TENCENT_SMS_TEMPLATE_ID,
    TemplateParamSet: [code, ttlMinutes],
  });
  const response = await fetch(`https://${host}/`, {
    method: 'POST',
    headers: {
      Authorization: tencentSmsAuthorization({ payload, timestamp, action, host, region: TENCENT_SMS_REGION }),
      'Content-Type': 'application/json; charset=utf-8',
      Host: host,
      'X-TC-Action': action,
      'X-TC-Version': '2021-01-11',
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': TENCENT_SMS_REGION,
    },
    body: payload,
    signal: AbortSignal.timeout(SMS_REQUEST_TIMEOUT_MS),
  });
  const text = await response.text().catch(() => '');
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch {}
  const payloadResponse = body?.Response || {};
  const status = payloadResponse.SendStatusSet?.[0];
  if (!response.ok || payloadResponse.Error || (status?.Code && status.Code !== 'Ok')) {
    const message = payloadResponse.Error?.Message || status?.Message || status?.Code || text || `HTTP ${response.status}`;
    throw new Error(`腾讯云短信发送失败：${message}`);
  }
  return { provider: 'tencent' };
}

function smsbaoPasswordHash() {
  if (SMSBAO_PASSWORD_MD5) return SMSBAO_PASSWORD_MD5;
  return createHash('md5').update(SMSBAO_PASSWORD).digest('hex');
}

function smsbaoMessage(code) {
  const minutes = String(Math.max(1, Math.ceil(PHONE_CODE_TTL_SECONDS / 60)));
  const body = SMSBAO_TEMPLATE
    .replace(/\{code\}/g, code)
    .replace(/\{minutes\}/g, minutes);
  const sign = SMSBAO_SIGN_NAME.replace(/^【|】$/g, '').trim();
  return sign ? `【${sign}】${body}` : body;
}

function smsbaoErrorMessage(statusCode) {
  const messages = {
    '-1': '参数不全',
    '-2': '服务器空间不支持 curl',
    '30': '密码错误',
    '40': '账号不存在',
    '41': '余额不足',
    '42': '账户已过期',
    '43': 'IP 地址限制',
    '50': '内容含有敏感词',
    '51': '手机号不正确',
  };
  return messages[String(statusCode)] || `返回码 ${statusCode}`;
}

async function sendSmsbaoPhoneCode(phone, code) {
  const missing = [
    ['SMSBAO_USERNAME', SMSBAO_USERNAME],
    ['SMSBAO_PASSWORD_MD5 or SMSBAO_PASSWORD', SMSBAO_PASSWORD_MD5 || SMSBAO_PASSWORD],
    ['SMSBAO_SIGN_NAME', SMSBAO_SIGN_NAME],
  ].filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) {
    throw new Error(`短信宝配置缺失：${missing.join(', ')}`);
  }

  const url = new URL(SMSBAO_ENDPOINT);
  url.searchParams.set('u', SMSBAO_USERNAME);
  url.searchParams.set('p', smsbaoPasswordHash());
  url.searchParams.set('m', phone);
  url.searchParams.set('c', smsbaoMessage(code));
  const response = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(SMS_REQUEST_TIMEOUT_MS),
  });
  const text = (await response.text().catch(() => '')).trim();
  if (!response.ok || text !== '0') {
    throw new Error(`短信宝发送失败：${smsbaoErrorMessage(text || `HTTP ${response.status}`)}`);
  }
  return { provider: 'smsbao' };
}

async function sendWebhookPhoneCode(phone, code) {
  if (!SMS_WEBHOOK_URL) throw new Error('SMS_WEBHOOK_URL 未配置');
  const response = await fetch(SMS_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(SMS_WEBHOOK_TOKEN ? { Authorization: `Bearer ${SMS_WEBHOOK_TOKEN}` } : {}),
    },
    body: JSON.stringify({
      phone,
      code,
      ttlSeconds: PHONE_CODE_TTL_SECONDS,
      purpose: 'account_register',
    }),
    signal: AbortSignal.timeout(SMS_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`短信 Webhook 发送失败：${text || `HTTP ${response.status}`}`);
  }
  return { provider: 'webhook' };
}

async function sendPhoneVerificationCode(phone, code) {
  const status = smsChannelStatus();
  if (!status.ready) {
    throw new Error(status.message || '短信服务未配置');
  }
  if (SMS_PROVIDER === 'smsbao') return sendSmsbaoPhoneCode(phone, code);
  if (SMS_PROVIDER === 'tencent') return sendTencentPhoneCode(phone, code);
  if (SMS_PROVIDER === 'webhook') return sendWebhookPhoneCode(phone, code);
  if (SMS_PROVIDER === 'log' || SMS_PROVIDER === 'console' || SMS_PROVIDER === 'mock') {
    console.log(`[sms] phone=${phone} code=${code} ttl=${PHONE_CODE_TTL_SECONDS}s`);
    return { provider: 'log' };
  }
  throw new Error('短信服务未配置，请设置 SMS_PROVIDER=smsbao 并填写短信宝参数');
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
  return mutateUserStore((store) => {
    const user = store.users.find((item) => item.login === normalizedLogin && item.status !== 'disabled');
    if (!user) {
      console.warn(`[auth] login failed: user_not_found login=${maskLoginForLog(normalizedLogin)}`);
      return null;
    }
    const codeHash = hashLoginCode(normalizedLogin, code);
    if (safeEqualText(user.codeHash, codeHash)) return user;
    if (!legacyLoginCodeMatched(user.codeHash, normalizedLogin, code)) {
      console.warn(`[auth] login failed: password_mismatch login=${maskLoginForLog(normalizedLogin)} hash=${String(user.codeHash || '').slice(0, 8)}`);
      return null;
    }
    user.codeHash = codeHash;
    user.updatedAt = new Date().toISOString();
    console.warn(`[auth] migrated legacy password hash login=${maskLoginForLog(normalizedLogin)}`);
    return user;
  });
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
    const membershipUpdate = Number(delta || 0) > 0 || meta.applyMembership === true
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

async function refundChatCharge(userId, chatId, pointCost, reason, meta = {}) {
  if (!ACCOUNT_SYSTEM_ENABLED || !userId || !chatId || !pointCost) return null;
  try {
    const result = await adjustUserPoints(userId, pointCost, 'refund', reason || 'AI 对话失败自动退回灵感值', chatId, meta);
    return result.user;
  } catch (error) {
    console.error(`[chat] refund failed chatId=${chatId}: ${String(error?.message || error).replace(/\s+/g, ' ').slice(0, 500)}`);
    return null;
  }
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
  return /视频|运镜|motion/i.test(note);
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
  if (resource.doubaoVideoPromptFilename) {
    withUrls.doubaoVideoPromptUrl = resourcePublicUrl(resource.id, resource.doubaoVideoPromptFilename);
    withUrls.doubaoVideoPromptDownloadUrl = resourceDownloadUrl(resource.id, resource.doubaoVideoPromptFilename);
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

function generatedImageExtensionForMode(mode = '', job = null) {
  if (FREE_IMAGE_MODES.has(mode)) {
    const format = normalizeFreeImageFormat(job?.freeImageFormat || 'jpeg');
    if (format === 'png' || format === 'webp') return format;
  }
  if (isPsLayerSplitMode(mode)) return 'png';
  return mode === 'construction_checklist' ? 'png' : 'jpg';
}

function generatedImageFilename(index, mode = '', job = null) {
  return `image-${index + 1}.${generatedImageExtensionForMode(mode, job)}`;
}

function baseGeneratedImageRegex() {
  return /^image-(\d+)\.(?:jpe?g|png|webp)$/i;
}

async function writeGeneratedImage(buffer, filePath, width, height, mode = '', outputFormat = '') {
  const resizeOptions = isPsLayerSplitMode(mode)
    ? { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } }
    : { fit: 'cover' };
  const pipeline = sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize(width, height, resizeOptions);

  const normalizedOutputFormat = normalizeFreeImageFormat(outputFormat || (FREE_IMAGE_MODES.has(mode) ? 'jpeg' : 'jpeg'));
  if (FREE_IMAGE_MODES.has(mode) && normalizedOutputFormat === 'webp') {
    await pipeline.webp({ quality: FINAL_IMAGE_JPEG_QUALITY }).toFile(filePath);
    return;
  }

  if (mode === 'construction_checklist' || isPsLayerSplitMode(mode) || (FREE_IMAGE_MODES.has(mode) && normalizedOutputFormat === 'png')) {
    await pipeline
      .png({ compressionLevel: 8, adaptiveFiltering: true })
      .toFile(filePath);
    return;
  }

  await pipeline
    .jpeg({ quality: FINAL_IMAGE_JPEG_QUALITY, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toFile(filePath);
}

function isVenueFusionMode(mode = '') {
  return mode === 'venue_fusion';
}

function isPlanResourceMode(mode = '') {
  return PLAN_RESOURCE_MODES.has(mode);
}

function isPartialWeddingEditMode(mode = '') {
  return PARTIAL_EDIT_MODES.has(mode);
}

function isPsLayerSplitMode(mode = '') {
  return mode === 'ps_layer_split';
}

function isImageEnhanceMode(mode = '') {
  return IMAGE_ENHANCE_MODES.has(mode);
}

function isFreeImageMode(mode = '') {
  return FREE_IMAGE_MODES.has(mode);
}

function isFreeTextImageMode(mode = '') {
  return mode === 'free_text_image';
}

function isFreeImageToImageMode(mode = '') {
  return mode === 'free_image_image';
}

function isSetupProcessGridMode(mode = '') {
  return SETUP_PROCESS_GRID_MODES.has(mode);
}

function isPhotoAreaSetupGridMode(mode = '') {
  return mode === 'photo_area_setup_grid';
}

function isStrictReferenceEditMode(mode = '') {
  return mode === 'cinematic_storyboard'
    || mode === 'setup_comparison'
    || DESIGN_RENDER_MODES.has(mode)
    || isVenueFusionMode(mode)
    || isPartialWeddingEditMode(mode)
    || isPsLayerSplitMode(mode)
    || isImageEnhanceMode(mode)
    || isFreeImageToImageMode(mode)
    || mode === 'construction_checklist'
    || mode === 'detail_grid'
    || isSetupProcessGridMode(mode);
}

function imageReferenceLimitForJob(job) {
  if (job?.mode === 'motion_video') return motionReferenceLimitForModel();
  if (isPartialWeddingEditMode(job?.mode)) return PARTIAL_EDIT_REFERENCE_LIMIT;
  if (isVenueFusionMode(job?.mode)) return 2;
  if (isFreeTextImageMode(job?.mode)) return 0;
  if (isFreeImageToImageMode(job?.mode)) return FREE_IMAGE_REFERENCE_LIMIT;
  return 1;
}

function referenceLogLabel(job, index) {
  if (isPartialWeddingEditMode(job?.mode)) {
    return index === 0 ? '待修改婚礼主图' : `局部改图参考图 ${index}`;
  }
  if (isVenueFusionMode(job?.mode)) {
    return index === 0 ? '空地/空场图' : '婚礼素材图';
  }
  if (isImageEnhanceMode(job?.mode)) {
    return '待增强图片';
  }
  if (isFreeImageToImageMode(job?.mode)) {
    return '图生图参考图';
  }
  if (job?.mode === 'motion_video') {
    if (motionVideoModelUsesComponents()) {
      if (index === 0) return '起始参考图';
      if (index === 1) return '过渡参考图';
      if (index === 2) return '收尾参考图';
    }
    if (motionMinimumReferenceCountForModel() >= 2) {
      if (index === 0) return '首帧参考图';
      if (index === 1) return '尾帧参考图';
    }
    return index === 0 ? '运镜参考图' : `额外参考图 ${index + 1}`;
  }
  return '现场参考图';
}

function orientedImageSize(metadata = {}) {
  let width = Number(metadata.width || 0);
  let height = Number(metadata.height || 0);
  const orientation = Number(metadata.orientation || 1);
  if (orientation >= 5 && orientation <= 8) {
    [width, height] = [height, width];
  }
  return { width, height };
}

function normalizeImageEnhanceSize(value, fallback = '2K') {
  const candidate = String(value || fallback || '2K').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(IMAGE_ENHANCE_SIZE_MAX_EDGES, candidate) ? candidate : fallback;
}

function imageEnhanceMaxEdgeForSize(size) {
  const normalized = normalizeImageEnhanceSize(size);
  return Math.min(IMAGE_ENHANCE_SIZE_MAX_EDGES[normalized] || 2048, IMAGE_ENHANCE_MAX_EDGE);
}

function imageEnhanceScaleForSize(width, height) {
  const maxSide = Math.max(Number(width) || 0, Number(height) || 0);
  if (maxSide < 900) return 4;
  if (maxSide < 1500) return 3;
  if (maxSide < 2600) return 2;
  return 1;
}

function imageEnhanceTargetSize(width, height, size = DEFAULT_IMAGE_ENHANCE_SIZE) {
  const sourceWidth = Math.max(1, Number(width) || 1);
  const sourceHeight = Math.max(1, Number(height) || 1);
  const targetMaxEdge = imageEnhanceMaxEdgeForSize(size);
  const scale = targetMaxEdge / Math.max(sourceWidth, sourceHeight);
  let targetWidth = roundImageDimension(sourceWidth * scale);
  let targetHeight = roundImageDimension(sourceHeight * scale);
  if (Math.max(targetWidth, targetHeight) !== targetMaxEdge) {
    const adjustScale = targetMaxEdge / Math.max(targetWidth, targetHeight);
    targetWidth = roundImageDimension(targetWidth * adjustScale);
    targetHeight = roundImageDimension(targetHeight * adjustScale);
  }
  return {
    width: targetWidth,
    height: targetHeight,
    scale: Number(scale.toFixed(2)),
    imageSize: normalizeImageEnhanceSize(size),
  };
}

function imageModelLooksGemini(model = '') {
  return /^gemini-/i.test(String(model || '').trim());
}

function imageRequestSizeForModel(job, model = '') {
  if (isPsLayerSplitMode(job?.mode)) {
    return psLayerSplitSheetLayout(job?.reference).size;
  }
  if (isImageEnhanceMode(job?.mode) && !imageModelLooksGemini(model)) {
    return sameAspectSizeForReference(job?.reference);
  }
  return imageSizeFor(job?.mode, job);
}

function imageEnhanceProviderLabel() {
  if (USE_GEMINI_IMAGE_ENHANCE) return GEMINI_IMAGE_MODEL;
  if (USE_XIAOJI) return 'xiaoji-gpt-image';
  if (USE_OPENAI_COMPAT) return OPENAI_PROVIDER_LABEL || 'gpt-image';
  return 'gpt-image';
}

function promptForImageEnhance(job = null) {
  const sourceSize = job?.reference?.width && job?.reference?.height
    ? ` Reference image size is ${job.reference.width}x${job.reference.height}.`
    : '';
  return [
    'Use the uploaded wedding photo as a strict image-editing source, not loose inspiration.',
    'Create one enhanced photorealistic version of the same image for client presentation.',
    'Improve clarity, perceived resolution, sharpness, compression artifacts, low-light muddiness, flower detail, fabric folds, crystal/glass highlights, tableware, ceiling lines, carpet/floor texture and overall transparency.',
    'Keep a natural premium champagne-white wedding tone. Lift dark areas gently and control highlights so white flowers, crystal columns and stage fabric still retain detail.',
    'Preserve the exact venue, camera angle, lens perspective, crop, architecture, ceiling, floor, stage, aisle/runway, floral arrangements, props, lighting positions, tables, chairs, spacing and color palette.',
    'Do not redesign the wedding. Do not add, remove, replace, move or invent decor, people, text, signs, logos, watermarks, UI elements, fantasy lighting, new flowers, new chandeliers or a different venue.',
    'The result should look like the original photo was professionally retouched and made clearer, not like a new concept rendering.',
    sourceSize,
  ].filter(Boolean).join(' ');
}

async function requestGptImageEnhanceBuffer(job) {
  const prompt = promptForImageEnhance(job);
  if (USE_GEMINI_IMAGE_ENHANCE) {
    updateJob(job, 42, '正在调用 Gemini 画质升级', `[enhance:gemini] 使用 ${GEMINI_IMAGE_MODEL} 输出 ${normalizeImageEnhanceSize(job?.imageEnhanceSize)} 高清图`);
    return requestGeminiImageEnhanceBuffer(job, prompt);
  }
  if (USE_XIAOJI) {
    updateJob(job, 42, '正在调用画质升级', '[enhance:gpt] 使用 xiaoji 图片编辑通道优化原图');
    return requestXiaojiImageBufferWithFallback(job, prompt);
  }
  if (USE_OPENAI_COMPAT && IMAGE_ENHANCE_COMPAT_ENABLED) {
    updateJob(job, 42, '正在调用 Gemini 画质升级', `[enhance:gemini] 使用 ${OPENAI_PROVIDER_LABEL} / ${IMAGE_ENHANCE_IMAGE_MODELS[0]} 输出 ${normalizeImageEnhanceSize(job?.imageEnhanceSize)} 高清图`);
    return requestImageBufferWithModelFallback({
      job,
      prompt,
      providerLabel: `${OPENAI_PROVIDER_LABEL}-image-enhance`,
      models: IMAGE_ENHANCE_IMAGE_MODELS,
      request: (model) => requestOpenAIImageEditBuffer(job, prompt, model),
    });
  }
  throw new Error(IMAGE_ENHANCE_UNAVAILABLE_MESSAGE);
}

async function postProcessGptEnhancedImage(buffer, target) {
  return sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({
      width: target.width,
      height: target.height,
      fit: 'fill',
      kernel: sharp.kernel.lanczos3,
    })
    .modulate({ brightness: 1.01, saturation: 1.04 })
    .sharpen({ sigma: 1.05, m1: 0.66, m2: 2.55, x1: 2, y2: 10, y3: 22 })
    .jpeg({ quality: 95, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toBuffer({ resolveWithObject: true });
}

async function enhanceUploadedImage(job, outputDir) {
  const sourceBuffer = job.files?.[0]?.buffer || job.file?.buffer || job.reference?.buffer;
  if (!sourceBuffer) throw new Error('画质升级缺少原始图片，请重新上传后再试');

  updateJob(job, 34, '正在读取原图清晰度', '[enhance] 正在检测原图尺寸和方向');
  const metadata = await sharp(sourceBuffer, { failOn: 'none' }).metadata();
  const sourceSize = orientedImageSize(metadata);
  if (!sourceSize.width || !sourceSize.height) {
    throw new Error('无法识别图片尺寸，请换一张 JPG 或 PNG 图片');
  }

  job.imageEnhanceSize = normalizeImageEnhanceSize(job.imageEnhanceSize);
  const target = imageEnhanceTargetSize(sourceSize.width, sourceSize.height, job.imageEnhanceSize);
  job.imageEnhanceTarget = target;
  updateJob(
    job,
    58,
    `正在准备 ${target.imageSize} 高清输出 ${sourceSize.width}x${sourceSize.height} → ${target.width}x${target.height}`,
    `[enhance] 将由 Gemini 优化原图，再输出 ${target.imageSize}（${target.width}x${target.height}）并锐化`,
  );

  const gptBuffer = await requestGptImageEnhanceBuffer(job);
  throwIfJobCancelled(job);
  updateJob(job, 72, '正在高清放大与锐化', `[enhance] Gemini 优化完成，正在输出 ${target.imageSize} ${target.width}x${target.height} 高清图`);
  const result = await postProcessGptEnhancedImage(gptBuffer, target);

  const filename = 'image-enhanced-hq.jpg';
  await writeFile(path.join(outputDir, filename), result.data);
  updateJob(
    job,
    82,
    '画质升级图已生成',
    `[enhance] ${imageEnhanceProviderLabel()} 输出 ${result.info.width}x${result.info.height}，${formatByteSize(result.data.length)}`,
  );

  const images = [];
  recordGeneratedImage(job, images, {
    label: `${job.imageEnhanceSize || DEFAULT_IMAGE_ENHANCE_SIZE}画质升级版`,
    filename,
    url: publicUrl(job.id, filename),
    width: result.info.width,
    height: result.info.height,
  });
  return images;
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
  if (isPartialWeddingEditMode(job?.mode) && job.partialEditReferences?.length) {
    return job.partialEditReferences
      .slice(0, PARTIAL_EDIT_REFERENCE_LIMIT)
      .map((reference, index) => normalizeReferenceInput(
        reference,
        index === 0 ? 'wedding-main-reference.jpg' : `wedding-edit-reference-${index}.jpg`,
      ))
      .filter(Boolean);
  }

  if (isVenueFusionMode(job?.mode) && job.fusionReferences?.length >= 2) {
    return job.fusionReferences
      .slice(0, 2)
      .map((reference, index) => normalizeReferenceInput(
        reference,
        index === 0 ? 'empty-venue-reference.jpg' : 'wedding-material-reference.jpg',
      ))
      .filter(Boolean);
  }

  if (isFreeImageToImageMode(job?.mode) && job.freeImageReferences?.length) {
    return job.freeImageReferences
      .slice(0, FREE_IMAGE_REFERENCE_LIMIT)
      .map((reference, index) => normalizeReferenceInput(
        reference,
        `free-image-reference-${index + 1}.jpg`,
      ))
      .filter(Boolean);
  }

  return [getReferenceInput(job)];
}

function getImageEditInputs(job) {
  const references = getReferenceInputs(job);
  if (isPartialWeddingEditMode(job?.mode)) {
    return PARTIAL_EDIT_SEND_EXTRA_REFERENCES ? references : references.slice(0, 1);
  }
  return references;
}

function getImageEditMask(job) {
  if (!isPartialWeddingEditMode(job?.mode)) return null;
  return normalizeReferenceInput(job.partialEditMask, 'edit-mask.png');
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
    canResume: canResumeImageSteps && !!job.reference && !job.refundedPoints && hasWorkLeft && !nonResumable && !job.cancelRequested && job.status !== 'cancelled' && job.status !== 'running' && job.status !== 'queued' && job.status !== 'completed',
  };
}

function isTransientJobError(message = '') {
  return /timeout|timed out|fetch failed|ECONNRESET|CONNECT_TIMEOUT|ETIMEDOUT|ENETUNREACH|UND_ERR|socket hang up|network|502|503|504|520|521|522|523|524|525|526|527|530/i
    .test(String(message || ''));
}

function publicJobStage(job) {
  if (!job) return '任务进行中';
  const mode = job.mode === 'motion_video' ? 'video' : 'image';
  const enhance = isImageEnhanceMode(job.mode);
  const progress = Number(job.progress || 0);
  if (job.status === 'completed') return mode === 'video' ? '视频生成完成，已保存到资源库' : (enhance ? '画质升级完成，已保存到资源库' : '生成完成，已保存到资源库');
  if (job.status === 'failed') return job.refundedPoints ? '生成失败，灵感值已自动退回' : '生成失败，请重新尝试或联系客服';
  if (job.status === 'cancelled') return '任务已停止';
  if (job.mode === 'design_render_scene' && job.stage) return job.stage;
  if (progress < 18) return '正在接收素材';
  if (progress < 35) return '正在检查素材与生成参数';
  if (enhance && progress < 75) return '正在用GPT优化图片并高清放大';
  if (progress < 75) return mode === 'video' ? '已提交上游视频任务，正在等待出片' : '正在生成婚礼成品图';
  if (progress < 96) return '正在整理生成结果';
  return '正在保存到资源库';
}

function publicJobError(job) {
  if (!job?.error) return '';
  const operationalError = publicOperationalJobError(job.error);
  if (operationalError) return job.refundedPoints
    ? `${operationalError}，灵感值已自动退回`
    : operationalError;
  if (job.refundedPoints) return '生成失败，灵感值已自动退回';
  if (getResumeInfo(job).canResume) return '生成中断，系统可继续处理，请稍后重试';
  return '生成失败，请重新尝试或联系客服';
}

function publicOperationalJobError(message = '') {
  const text = String(message || '');
  if (/HTTP\s*429|图片上游通道繁忙|上游负载已饱和|负载已饱和|rate\s*limit|too many requests|overload|capacity|busy/i.test(text)) {
    return '图片上游通道繁忙或负载已饱和，请稍后重试';
  }
  if (/Motion reference image .*publicly reachable|PUBLIC_BASE_URL|api\/motion\/source|HTTP\s+(408|502|503)/i.test(text)) {
    return '视频参考图公网地址不可访问，请检查内网穿透是否在线或改用公网 HTTPS 图片 URL';
  }
  if (/401|unauthori[sz]ed|令牌状态不可用|图片生成接口令牌不可用|invalid\s+(api\s*)?(key|token)|api\s*key.*invalid|token.*invalid/i.test(text)) {
    return '图片生成接口令牌不可用，请联系运营检查或更换图片 API Key';
  }
  if (/Cloudflare|cf-error|sorry,\s*you have been blocked|ray id/i.test(text)) {
    return `${ACTIVE_PROVIDER} 接口被 Cloudflare 拦截，请检查网络、代理或更换可用 API 域名`;
  }
  return '';
}

function publicJobLogs(job) {
  const mode = job?.mode === 'motion_video' ? 'video' : 'image';
  const progress = Number(job?.progress || 0);
  const designRender = job?.mode === 'design_render_scene';
  const enhance = isImageEnhanceMode(job?.mode);
  const total = SHOT_PLANS[job?.mode]?.length || 0;
  const completed = job?.partialImages?.length || 0;
  const logs = ['已收到素材，任务已进入生成队列'];
  if (progress >= 18) logs.push('素材检查完成，正在解析婚礼风格');
  if (progress >= 35) logs.push(enhance ? '正在用GPT优化图片并高清放大' : (designRender ? `正在生成现场候选图，已完成 ${completed}/${total} 张` : (mode === 'video' ? '已提交上游视频任务，正在等待出片' : '正在生成婚礼成品图')));
  if (progress >= 75) logs.push('正在整理生成结果');
  if (progress >= 96) logs.push('正在保存到资源库');
  if (job?.status === 'completed') logs.push(enhance ? '高清优化图已生成完成' : (designRender ? '实景候选图已生成完成' : (mode === 'video' ? '视频已生成完成' : '成品已生成完成')));
  if (job?.status === 'failed') logs.push(job.refundedPoints ? '生成失败，灵感值已自动退回' : '生成失败，请重新尝试或联系客服');
  if (job?.status === 'cancelled') logs.push('任务已停止');
  if (mode === 'video') {
    const motionLogs = (job?.logs || [])
      .filter((line) => /^\[motion\]/.test(String(line || '')) && /task submitted|progress|status=|upstream task failed|query failed/i.test(String(line || '')))
      .slice(-3);
    logs.push(...motionLogs);
  }
  return [...new Set(logs)].slice(-6);
}

function normalizeChatText(value = '', maxLength = 4000) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, maxLength);
}

function normalizeChatMessages(value = []) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const role = item?.role === 'assistant' ? 'assistant' : (item?.role === 'user' ? 'user' : '');
      const content = normalizeChatText(item?.content || item?.text || '', 4000);
      return role && content ? { role, content } : null;
    })
    .filter(Boolean)
    .slice(-CHAT_MAX_HISTORY_MESSAGES);
}

function normalizeChatImages(value = []) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const dataUrl = String(item?.dataUrl || item?.url || '').trim();
      if (!/^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(dataUrl)) return null;
      if (dataUrl.length > CHAT_IMAGE_MAX_DATA_URL_LENGTH) return null;
      return {
        name: normalizeChatText(item?.name || 'reference image', 120),
        dataUrl: dataUrl.replace(/\s+/g, ''),
      };
    })
    .filter(Boolean)
    .slice(0, CHAT_IMAGE_LIMIT);
}

function chatMessageContentWithImages(text = '', images = []) {
  const cleanText = normalizeChatText(text || '请根据这些参考图进行分析。', 4000) || '请根据这些参考图进行分析。';
  return [
    { type: 'text', text: cleanText },
    ...images.map((image) => ({
      type: 'image_url',
      image_url: { url: image.dataUrl },
    })),
  ];
}

function chatCompletionText(payload = null) {
  const direct = payload?.choices?.[0]?.message?.content
    ?? payload?.choices?.[0]?.delta?.content
    ?? payload?.output_text
    ?? payload?.content
    ?? '';
  if (typeof direct === 'string') return direct.trim();
  if (Array.isArray(direct)) {
    return direct
      .map((part) => typeof part === 'string' ? part : (part?.text || part?.content || ''))
      .join('')
      .trim();
  }
  if (Array.isArray(payload?.output)) {
    return payload.output
      .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
      .map((part) => part?.text || part?.content || '')
      .join('')
      .trim();
  }
  return '';
}

function publicChatError(status, message = '') {
  const text = String(message || '').replace(/\s+/g, ' ').trim();
  if (status === 401 || /unauthori[sz]ed|invalid.*(key|token)|令牌|token/i.test(text)) {
    return 'AI 对话接口令牌不可用，请检查 OPENAI_API_KEY / N1N_API_KEY';
  }
  if (status === 429 || /rate limit|too many|overload|busy|capacity|额度|余额/i.test(text)) {
    return 'AI 对话通道繁忙或额度不足，请稍后重试';
  }
  if (status >= 500 || /timeout|timed out|ECONNRESET|fetch failed|network/i.test(text)) {
    return 'AI 对话上游暂时不可用，请稍后重试';
  }
  return text.slice(0, 240) || `AI 对话请求失败（HTTP ${status || 500}）`;
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

async function requireTenantAdmin(req, res, next) {
  if (!ACCOUNT_SYSTEM_ENABLED) {
    res.status(404).json({ error: '账号系统未开启' });
    return;
  }
  try {
    const user = await sessionUser(req);
    if (!user) {
      res.status(401).json({ error: '请先登录代理管理员账号', accessRequired: true, accountRequired: true });
      return;
    }
    if (user.tenantRole !== 'tenant_admin' || !user.tenantId) {
      res.status(403).json({ error: '当前账号不是代理管理员' });
      return;
    }
    req.user = user;
    next();
  } catch (error) {
    res.status(500).json({ error: error.message || '代理管理员校验失败' });
  }
}

function requireActiveMembership(req, res, next) {
  if (!ACCOUNT_SYSTEM_ENABLED) {
    next();
    return;
  }
  if (hasActiveMembership(req.user)) {
    next();
    return;
  }
  const user = publicUser(req.user);
  const expired = user?.membershipStatus === 'expired';
  res.status(402).json({
    error: expired
      ? '视频权益已过期，请开通体验版、专业版或 AI经理后继续使用。'
      : VIDEO_ACCESS_DENIED_MESSAGE,
    membershipRequired: true,
    accountRequired: true,
    user,
  });
}

function requireMotionFeatureAccess(req, res, next) {
  if (!ACCOUNT_SYSTEM_ENABLED || canUseMotionFeatures(req.user)) {
    next();
    return;
  }
  res.status(403).json({
    error: VIDEO_ACCESS_DENIED_MESSAGE,
    motionAccessRequired: true,
    membershipRequired: true,
    accountRequired: true,
    user: publicUser(req.user),
  });
}

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) {
    res.status(503).json({ error: '管理员密钥未配置' });
    return;
  }
  const token = String(req.headers['x-admin-token'] || '').trim();
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

function normalizeEditInstruction(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900);
}

function normalizeUserInstruction(value = '') {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900);
}

const FREE_IMAGE_SIZES = new Set([
  'auto',
  '1024x1024',
  '1536x1024',
  '1024x1536',
  '2048x2048',
  '2048x1152',
  '3840x2160',
  '2160x3840',
]);
const FREE_IMAGE_QUALITIES = new Set(['auto', 'high', 'medium', 'low']);
const FREE_IMAGE_FORMATS = new Set(['jpeg', 'png', 'webp']);

function normalizeFreeImagePrompt(value = '') {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Number(process.env.FREE_IMAGE_PROMPT_MAX_LENGTH || 2800));
}

function normalizeFreeImageSize(value = '') {
  const size = String(value || '').trim().toLowerCase();
  return FREE_IMAGE_SIZES.has(size) ? size : '1024x1024';
}

function normalizeFreeImageQuality(value = '') {
  const quality = String(value || '').trim().toLowerCase();
  return FREE_IMAGE_QUALITIES.has(quality) ? quality : 'auto';
}

function normalizeFreeImageFormat(value = '') {
  const format = String(value || '').trim().toLowerCase();
  if (format === 'jpg') return 'jpeg';
  return FREE_IMAGE_FORMATS.has(format) ? format : 'jpeg';
}

function normalizeFreeImageCount(value = '') {
  const count = Number.parseInt(String(value || '1'), 10);
  return Math.max(1, Math.min(4, Number.isFinite(count) ? count : 1));
}

function freeImageQualityForApi(job = null) {
  const quality = normalizeFreeImageQuality(job?.freeImageQuality || 'auto');
  return quality === 'auto' ? '' : quality;
}

function imageQualityForApi(job = null) {
  return isFreeImageMode(job?.mode) ? freeImageQualityForApi(job) : IMAGE_QUALITY;
}

function freeImageFormatForApi(job = null) {
  return normalizeFreeImageFormat(job?.freeImageFormat || 'jpeg');
}

function normalizeSetupBrandName(value = '') {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
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
  if (isFreeImageMode(mode)) return normalizeFreeImageSize(job?.freeImageSize || DEFAULT_IMAGE_SIZE);
  if (mode === 'cinematic_storyboard') return STORYBOARD_IMAGE_SIZE;
  if (mode === 'setup_comparison' || mode === 'design_render_scene') return STORYBOARD_IMAGE_SIZE;
  if (mode === 'construction_checklist') return CONSTRUCTION_CHECKLIST_IMAGE_SIZE;
  if (isSetupProcessGridMode(mode)) return STORYBOARD_IMAGE_SIZE;
  if (mode === 'product_matrix') return '1024x1536';
  if (mode === 'handdrawn_plan') return '1024x1792';
  if (mode === 'outdoor_handdrawn_plan') return '1024x1536';
  if (isPlanResourceMode(mode)) return '1088x1440';
  if (isImageEnhanceMode(mode)) {
    const target = job?.imageEnhanceTarget || (job?.reference?.width && job?.reference?.height
      ? imageEnhanceTargetSize(job.reference.width, job.reference.height, job.imageEnhanceSize)
      : null);
    if (target?.width && target?.height) return `${target.width}x${target.height}`;
    return sameAspectSizeForReference(job?.reference);
  }
  if (mode === 'venue_fusion') return sameAspectSizeForReference(job?.reference);
  if (mode === 'similar_style') return sameAspectSizeForReference(job?.reference);
  if (mode === 'partial_wedding_edit') return sameAspectSizeForReference(job?.reference);
  if (mode === 'ps_layer_split') return sameAspectSizeForReference(job?.reference);
  return DEFAULT_IMAGE_SIZE;
}

function parseImageSize(size) {
  const match = /^(\d+)x(\d+)$/i.exec(size);
  if (!match) return { width: 1024, height: 1024 };
  return { width: Number(match[1]), height: Number(match[2]) };
}

function psLayerSplitSheetLayout(reference) {
  const sourceWidth = Number(reference?.width) || 1280;
  const sourceHeight = Number(reference?.height) || 656;
  const aspect = sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : 16 / 9;
  const cols = 2;
  const rows = 3;
  const line = 2;
  const maxW = 1536;
  const maxH = 1536;
  let cellW = roundImageDimension((maxW - (cols + 1) * line) / cols);
  let cellH = roundImageDimension(cellW / aspect);
  let sheetW = cols * cellW + (cols + 1) * line;
  let sheetH = rows * cellH + (rows + 1) * line;
  if (sheetH > maxH) {
    cellH = roundImageDimension((maxH - (rows + 1) * line) / rows);
    cellW = roundImageDimension(cellH * aspect);
    sheetW = cols * cellW + (cols + 1) * line;
    sheetH = rows * cellH + (rows + 1) * line;
  }
  return {
    cols,
    rows,
    line,
    cellW,
    cellH,
    width: sheetW,
    height: sheetH,
    size: `${sheetW}x${sheetH}`,
  };
}

function psLayerSplitSheetPrompt(job = null) {
  const sourceSize = job?.reference?.width && job?.reference?.height
    ? `源图尺寸约为 ${job.reference.width}x${job.reference.height}，每个分格都要保持源图画幅比例和同一套坐标位置。`
    : '每个分格都要保持源图画幅比例和同一套坐标位置。';
  return [
    'Reference Image 1 是唯一准确来源，不是风格参考图。严禁重新设计、重新配色、换场景、换材质、换花艺、换背景或补画不存在的婚礼元素。',
    '把这张婚礼图拆分成若干图像，每个元素不要改变相对位置，这样我可以直接在PS里拼合无需拖动，底色为白色，不要伪透明度。',
    '请输出一张 2列 x 3行 的大分屏预览图，6个格子之间只用细灰色分割线，不要标题、编号、文字、黑色标签、按钮、水印、UI 或说明。',
    sourceSize,
    '每一个格子都是一张完整同画幅白底图层素材：只保留源图中真实存在的目标元素，其余区域刷成纯白色 RGB(255,255,255)。',
    '目标元素保持原图的颜色、材质、透视、比例和相对位置；不要重新设计，不要换场景，不要新增原图没有的元素。',
    '不要把元素做成商品图或新设计效果图，不要加透明棋盘格、灰色透明效果、文字、标签、水印或 UI。',
    '6个格子的内容顺序如下，全部以源图实际存在的元素为准：',
    '第一行左：固定背景/建筑/背景板/墙面/舞台结构，只保留原图里真实存在且固定不动的结构。',
    '第一行右：布幔/帘幕/垂布/吊挂装饰/吊灯，只保留原图里真实存在的布艺和吊挂物。',
    '第二行左：中央主视觉装饰，只保留原图中央的花艺、标牌、主道具或主装饰焦点。',
    '第二行右：左侧装饰，只保留原图左侧花艺、左侧道具、左侧通道花和左侧相关装饰。',
    '第三行左：右侧装饰，只保留原图右侧花艺、右侧道具、右侧通道花和右侧相关装饰。',
    '第三行右：地面/通道/舞台台面/底部花线，只保留原图地面、红毯/通道、台阶、平台、底部低位花丛。',
    '某类元素不存在时，对应格子尽量留白，不要编造。目标是 Photoshop 分层素材预览，不是艺术再创作。',
  ].filter(Boolean).join(' ');
}

function psLayerSplitPrompt(shotLabel, shotPrompt, job = null) {
  const sourceSize = job?.reference?.width && job?.reference?.height
    ? ` The source photo canvas is ${job.reference.width}x${job.reference.height}; preserve that aspect ratio and composition.`
    : '';
  return [
    'Use case: precise-object-edit / Photoshop layer asset extraction.',
    'Asset type: one full-canvas white-background PS layer image.',
    'Primary request: split the uploaded wedding stage photo into separate white-background layer assets for Photoshop compositing.',
    'Input image: Reference Image 1 is the locked edit target and exact source photograph, not loose inspiration.',
    sourceSize,
    'Output exactly one complete full-canvas image with the same wide canvas/aspect ratio as the source photo.',
    'Keep only the requested target element group. Keep it in its original absolute position, original scale, original perspective, original left/right/up/down placement and original visual relationship to the whole canvas.',
    'Replace every non-target area with pure solid white #FFFFFF / RGB(255,255,255). Opaque white background only.',
    'Do not crop, zoom, recenter, rotate, mirror, straighten, expand, change perspective, or make a new composition.',
    'Do not use transparency, alpha checkerboard, fake transparent grid, gray haze, paper texture, colored background, halos, shadow-only leftovers, cutout labels or guide lines.',
    'Do not create a contact sheet, collage, split screen, PSD mockup, UI, layer stack, label text, arrows, borders, watermarks, or captions.',
    'Do not redesign the wedding, do not invent new flowers or props, and do not beautify by moving elements. This is source-image layer extraction, not a new wedding rendering.',
    'If an object overlaps the target layer, keep only the visible target pixels that exist in the original view; do not hallucinate hidden backside details.',
    'Keep realistic edges and fine detail for flowers, fabric folds, chandeliers, columns, wall texture and stage base where they belong to the target layer. The white background must stay plain and clean so it can be keyed or blended in Photoshop.',
    `Layer to output: ${shotLabel}. ${shotPrompt}.`,
    'Final check before output: full canvas, target element in original position, all other pixels solid white, no fake transparency, no crop.',
  ].filter(Boolean).join(' ');
}

function psLayerPixelFeatures(r, g, b, x, y, width, height) {
  const nx = x / Math.max(1, width - 1);
  const ny = y / Math.max(1, height - 1);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const brightness = (r + g + b) / 3;
  const saturation = max - min;
  const lavender = r > 70 && b > 75 && b >= g * 1.02 && r >= g * 0.88 && (b - g > 10 || r - g > 10);
  const purple = lavender && (saturation > 20 || brightness > 105);
  const green = g > 45 && g >= r * 0.86 && g >= b * 0.78 && (g - r > 4 || g - b > 4);
  const pink = r > 130 && b > 95 && g < Math.max(r, b) - 18;
  const whiteOrGray = brightness > 105 && saturation < 74;
  const dark = brightness < 48;
  const softWhiteFlower = brightness > 132 && saturation < 92;
  const flowerLike = purple || green || pink || softWhiteFlower;
  return { nx, ny, brightness, saturation, purple, green, pink, whiteOrGray, dark, softWhiteFlower, flowerLike };
}

function shouldKeepLocalPsLayerPixel(label = '', r, g, b, x, y, width, height) {
  const f = psLayerPixelFeatures(r, g, b, x, y, width, height);
  const inMainBackdrop = f.nx > 0.14 && f.nx < 0.96 && f.ny > 0.09 && f.ny < 0.68;
  const inLeftFabric = f.nx > 0.08 && f.nx < 0.34 && f.ny > 0.08 && f.ny < 0.74;
  const inRightFabric = f.nx > 0.69 && f.nx < 0.98 && f.ny > 0.06 && f.ny < 0.58;
  const inCenter = f.nx > 0.34 && f.nx < 0.70 && f.ny > 0.14 && f.ny < 0.78;
  const inLeft = f.nx < 0.43 && f.ny > 0.12 && f.ny < 0.86;
  const inRight = f.nx > 0.56 && f.ny > 0.10 && f.ny < 0.86;
  const lowerFlowerLine = f.ny > 0.57 && f.ny < 0.88 && f.flowerLike;

  if (/background-stage-structure/i.test(label)) {
    const structuralWhite = inMainBackdrop && f.whiteOrGray && !f.purple && !f.green && !f.pink && f.ny < 0.70;
    const columnWhite = ((f.nx < 0.13 && f.ny > 0.10 && f.ny < 0.72) || (f.nx > 0.93 && f.ny > 0.10 && f.ny < 0.62)) && f.whiteOrGray;
    const lineArt = inMainBackdrop && f.brightness > 45 && f.brightness < 135 && f.saturation < 58 && f.ny < 0.54;
    return structuralWhite || columnWhite || lineArt;
  }

  if (/lavender-drapery-fabric/i.test(label)) {
    const fabricColor = f.purple && f.brightness > 70 && f.brightness < 230 && f.saturation < 128;
    const likelyFabric = (inLeftFabric || inRightFabric) && fabricColor;
    const avoidLowFlowerBeds = !(f.ny > 0.57 && f.flowerLike && f.saturation > 78);
    return likelyFabric && avoidLowFlowerBeds;
  }

  if (/center-floral-focus/i.test(label)) {
    return inCenter && f.flowerLike && !(f.whiteOrGray && f.ny < 0.36 && f.saturation < 36);
  }

  if (/left-floral-and-hanging-decor/i.test(label)) {
    const leftChandelier = f.nx > 0.14 && f.nx < 0.36 && f.ny > 0.17 && f.ny < 0.47 && f.whiteOrGray && f.brightness > 115;
    return (inLeft && f.flowerLike && f.ny > 0.22) || leftChandelier;
  }

  if (/right-floral-and-hanging-decor/i.test(label)) {
    const rightChandelier = f.nx > 0.66 && f.nx < 0.84 && f.ny > 0.10 && f.ny < 0.35 && f.whiteOrGray && f.brightness > 115;
    return (inRight && f.flowerLike && f.ny > 0.20) || rightChandelier;
  }

  if (/floor-base-front-flower-line/i.test(label)) {
    const stageBase = f.ny > 0.70 && f.ny < 0.91 && f.nx > 0.18 && f.nx < 0.86 && f.dark;
    return stageBase || lowerFlowerLine;
  }

  return false;
}

async function createLocalPsLayerSplitImages(job, outputDir, existingImages = []) {
  if (!job?.reference?.buffer) throw new Error('PS分层本地兜底缺少参考图');
  const shots = SHOT_PLANS[job.mode] || [];
  const total = shots.length;
  const slots = new Array(total).fill(null);
  for (const item of existingImages) {
    const match = baseGeneratedImageRegex().exec(item.filename || '');
    const idx = match ? Number(match[1]) - 1 : -1;
    if (idx >= 0 && idx < total) slots[idx] = item;
  }

  const { width, height } = parseImageSize(imageSizeFor(job.mode, job));
  const { data } = await sharp(job.reference.buffer, { failOn: 'none' })
    .rotate()
    .resize(width, height, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  job.logs.push('[ps-layer-local] 启用本地白底图层提取兜底，保持原图画幅和位置，不再等待上游生图接口');

  for (let index = 0; index < total; index += 1) {
    throwIfJobCancelled(job);
    if (slots[index]) continue;
    const [label] = shots[index];
    const layer = Buffer.alloc(width * height * 4, 255);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const src = (y * width + x) * 4;
        const r = data[src];
        const g = data[src + 1];
        const b = data[src + 2];
        if (!shouldKeepLocalPsLayerPixel(label, r, g, b, x, y, width, height)) continue;
        layer[src] = r;
        layer[src + 1] = g;
        layer[src + 2] = b;
        layer[src + 3] = 255;
      }
    }

    const filename = generatedImageFilename(index, job.mode);
    await sharp(layer, { raw: { width, height, channels: 4 } })
      .png({ compressionLevel: 8, adaptiveFiltering: true })
      .toFile(path.join(outputDir, filename));
    slots[index] = {
      label,
      url: publicUrl(job.id, filename),
      filename,
      width,
      height,
      downloadUrl: downloadUrl(job.id, filename),
    };
    job.partialImages = slots.filter(Boolean);
    updateJob(job, 32 + Math.round((slots.filter(Boolean).length / Math.max(1, total)) * 48), `正在生成本地图层：${label}（${slots.filter(Boolean).length}/${total}）`);
  }

  return slots.filter(Boolean);
}

async function generatePsLayerSplitSheetWithOpenAI(job, outputDir) {
  if (!USE_OPENAI_COMPAT) {
    throw new Error('导出PS素材必须使用可用的 GPT-Image2 图片接口，当前服务未配置可用图片接口。');
  }
  if (!job?.reference?.buffer) throw new Error('PS分层缺少参考图');

  const shots = SHOT_PLANS[job.mode] || [];
  if (!shots.length) throw new Error('PS分层缺少图层方案');

  const layout = psLayerSplitSheetLayout(job.reference);
  const layerSize = parseImageSize(sameAspectSizeForReference(job.reference));
  const prompt = psLayerSplitSheetPrompt(job);

  updateJob(job, 28, '正在用GPT-Image2生成PS分层大图', '[ps-layer] 使用单次生图生成 2x3 白底分屏，不启用本地抠图兜底');
  const buffer = await requestOpenAIImageEditBufferWithFallback(job, prompt);
  throwIfJobCancelled(job);
  if (!buffer || buffer.length < 8192) {
    throw new Error(`GPT-Image2 返回图像数据过小（${buffer?.length || 0}B），未生成PS分层素材`);
  }

  const white = { r: 255, g: 255, b: 255, alpha: 1 };
  const sheetFilename = 'ps-layer-split-preview.png';
  const normalizedSheet = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize(layout.width, layout.height, { fit: 'fill' })
    .flatten({ background: white })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  await writeFile(path.join(outputDir, sheetFilename), normalizedSheet);
  job.logs.push(`[ps-layer] GPT-Image2 已输出 2x3 分屏预览 ${sheetFilename} (${layout.width}x${layout.height})`);

  const images = [];
  for (let index = 0; index < Math.min(6, shots.length); index += 1) {
    throwIfJobCancelled(job);
    const col = index % layout.cols;
    const row = Math.floor(index / layout.cols);
    const left = layout.line + col * (layout.cellW + layout.line);
    const top = layout.line + row * (layout.cellH + layout.line);
    const [label] = shots[index];
    const filename = generatedImageFilename(index, job.mode);
    await sharp(normalizedSheet, { failOn: 'none' })
      .extract({ left, top, width: layout.cellW, height: layout.cellH })
      .resize(layerSize.width, layerSize.height, { fit: 'fill' })
      .flatten({ background: white })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(path.join(outputDir, filename));
    images.push({
      label,
      url: publicUrl(job.id, filename),
      filename,
      width: layerSize.width,
      height: layerSize.height,
      downloadUrl: downloadUrl(job.id, filename),
    });
    job.partialImages = images.map(({ label: itemLabel, url, filename: itemFilename, downloadUrl, width, height }) => ({
      label: itemLabel,
      url,
      filename: itemFilename,
      downloadUrl,
      width,
      height,
    }));
    updateJob(job, 42 + Math.round((images.length / 6) * 34), `正在裁出PS图层：${label}（${images.length}/6）`);
  }

  return images;
}

function psLayerSplitMaskSheetPrompt(job = null) {
  const sourceSize = job?.reference?.width && job?.reference?.height
    ? `源图尺寸约为 ${job.reference.width}x${job.reference.height}，每个分格都要使用源图同画幅、同坐标。`
    : '每个分格都要使用源图同画幅、同坐标。';
  return [
    'Reference Image 1 是唯一准确来源。请不要生成婚礼效果图，不要输出彩色素材，不要重新设计。',
    '任务：为这张婚礼图生成 Photoshop 分层用的黑白蒙版大图。',
    '输出一张 2列 x 3行 的大分屏蒙版图，6个格子之间只用细灰色分割线，不要标题、编号、文字、按钮、水印、UI 或说明。',
    sourceSize,
    '每个格子都是完整源图画幅的二值蒙版：需要保留的目标元素画纯白色 RGB(255,255,255)，其他所有区域画纯黑色 RGB(0,0,0)。',
    '目标白色区域必须在原图的相同位置、相同比例、相同透视关系上；不要把白色形状居中展示、放大、缩小或移动。',
    '只画蒙版形状，不画真实花艺、布幔、建筑、地毯、桌椅的颜色和纹理。',
    '6个格子的白色区域顺序如下，全部以源图实际存在的元素为准：',
    '第一行左：固定背景/建筑/背景板/墙面/舞台结构。',
    '第一行右：布幔/帘幕/垂布/吊挂装饰/吊灯。',
    '第二行左：中央主视觉装饰，例如中央花艺、标牌、主道具或主装饰焦点。',
    '第二行右：左侧装饰，例如左侧花艺、左侧道具、左侧通道花和左侧相关装饰。',
    '第三行左：右侧装饰，例如右侧花艺、右侧道具、右侧通道花和右侧相关装饰。',
    '第三行右：地面/通道/舞台台面/底部花线，例如原图地面、红毯/通道、台阶、平台、底部低位花丛。',
    '某类元素不存在时，该格子保持黑色，不要编造元素。',
  ].filter(Boolean).join(' ');
}

async function generatePsLayerSplitMasksWithOpenAI(job, outputDir) {
  if (!USE_OPENAI_COMPAT) {
    throw new Error('导出PS素材必须使用可用的 GPT-Image2 图片接口，当前服务未配置可用图片接口。');
  }
  if (!job?.reference?.buffer) throw new Error('PS分层缺少参考图');

  const shots = SHOT_PLANS[job.mode] || [];
  if (!shots.length) throw new Error('PS分层缺少图层方案');

  const layout = psLayerSplitSheetLayout(job.reference);
  const layerSize = parseImageSize(sameAspectSizeForReference(job.reference));
  const prompt = psLayerSplitMaskSheetPrompt(job);

  updateJob(job, 28, '正在用GPT-Image2生成PS分层蒙版', '[ps-layer] 使用 GPT-Image2 生成黑白蒙版，再套回原图像素，避免重绘素材');
  const buffer = await requestOpenAIImageEditBufferWithFallback(job, prompt);
  throwIfJobCancelled(job);
  if (!buffer || buffer.length < 8192) {
    throw new Error(`GPT-Image2 返回蒙版图像数据过小（${buffer?.length || 0}B），未生成PS分层素材`);
  }

  const maskSheetFilename = 'ps-layer-split-mask-sheet.png';
  const normalizedMaskSheet = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize(layout.width, layout.height, { fit: 'fill' })
    .flatten({ background: { r: 0, g: 0, b: 0, alpha: 1 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  await writeFile(path.join(outputDir, maskSheetFilename), normalizedMaskSheet);
  job.logs.push(`[ps-layer] GPT-Image2 已输出 2x3 黑白蒙版 ${maskSheetFilename} (${layout.width}x${layout.height})`);

  const sourceRaw = await sharp(job.reference.buffer, { failOn: 'none' })
    .rotate()
    .resize(layerSize.width, layerSize.height, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer();

  const images = [];
  for (let index = 0; index < Math.min(6, shots.length); index += 1) {
    throwIfJobCancelled(job);
    const col = index % layout.cols;
    const row = Math.floor(index / layout.cols);
    const left = layout.line + col * (layout.cellW + layout.line);
    const top = layout.line + row * (layout.cellH + layout.line);
    const [label] = shots[index];
    const filename = generatedImageFilename(index, job.mode);

    const maskRaw = await sharp(normalizedMaskSheet, { failOn: 'none' })
      .extract({ left, top, width: layout.cellW, height: layout.cellH })
      .resize(layerSize.width, layerSize.height, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer();

    const layer = Buffer.alloc(layerSize.width * layerSize.height * 4, 255);
    for (let i = 0, p = 0; i < maskRaw.length; i += 1, p += 4) {
      if (maskRaw[i] < 128) continue;
      layer[p] = sourceRaw[p];
      layer[p + 1] = sourceRaw[p + 1];
      layer[p + 2] = sourceRaw[p + 2];
      layer[p + 3] = 255;
    }

    await sharp(layer, { raw: { width: layerSize.width, height: layerSize.height, channels: 4 } })
      .png({ compressionLevel: 8, adaptiveFiltering: true })
      .toFile(path.join(outputDir, filename));

    images.push({
      label,
      url: publicUrl(job.id, filename),
      filename,
      width: layerSize.width,
      height: layerSize.height,
      downloadUrl: downloadUrl(job.id, filename),
    });
    job.partialImages = images.map(({ label: itemLabel, url, filename: itemFilename, downloadUrl, width, height }) => ({
      label: itemLabel,
      url,
      filename: itemFilename,
      downloadUrl,
      width,
      height,
    }));
    updateJob(job, 42 + Math.round((images.length / 6) * 34), `正在套用PS蒙版：${label}（${images.length}/6）`);
  }

  return images;
}

async function createPsLayerStackPsdBuffer(job, images = [], outputDir = '') {
  if (!isPsLayerSplitMode(job?.mode) || !job?.reference?.buffer) return null;
  const shots = SHOT_PLANS[job.mode] || [];
  if (!shots.length) return null;

  const { width, height } = parseImageSize(imageSizeFor(job.mode, job));
  const { data } = await sharp(job.reference.buffer, { failOn: 'none' })
    .rotate()
    .resize(width, height, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const whiteBackground = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < whiteBackground.length; i += 4) {
    whiteBackground[i] = 255;
    whiteBackground[i + 1] = 255;
    whiteBackground[i + 2] = 255;
    whiteBackground[i + 3] = 255;
  }

  const layerMap = new Map(images.map((image) => [image.label, image]));
  const layerChildren = await Promise.all(shots.map(async ([label], index) => {
    const image = layerMap.get(label) || images[index];
    if (!image?.filename || !outputDir) {
      throw new Error(`缺少 PSD 图层文件：${label}`);
    }
    const layerBuffer = await sharp(path.join(outputDir, image.filename), { failOn: 'none' })
      .rotate()
      .resize(width, height, { fit: 'fill' })
      .ensureAlpha()
      .raw()
      .toBuffer();
    const layerData = new Uint8ClampedArray(layerBuffer);
    for (let i = 0; i < layerData.length; i += 4) {
      const r = layerData[i];
      const g = layerData[i + 1];
      const b = layerData[i + 2];
      if (r > 248 && g > 248 && b > 248) {
        layerData[i + 3] = 0;
      } else {
        layerData[i + 3] = 255;
      }
    }
    return {
      name: layerMap.get(label)?.label || label,
      left: 0,
      top: 0,
      imageData: { width, height, data: layerData },
    };
  }));

  const compositeData = new Uint8ClampedArray(data);
  const psd = {
    width,
    height,
    imageData: { width, height, data: compositeData },
    children: [
      ...layerChildren.reverse(),
      {
        name: '00-white-background',
        left: 0,
        top: 0,
        imageData: { width, height, data: whiteBackground },
      },
    ],
  };
  return writePsdBuffer(psd, { noBackground: true, trimImageData: false });
}

function promptFor(mode, shotLabel, shotPrompt, job = null) {
  const isLightingSpaceDetailShot = /conditional lighting-space detail shot|overhead hanging installation|grounded lighting-and-floral/i.test(shotPrompt);
  const editInstruction = String(job?.editInstruction || '').replace(/\s+/g, ' ').trim().slice(0, 900);
  const userInstruction = String(job?.userInstruction || '').replace(/\s+/g, ' ').trim().slice(0, 900);
  const userInstructionPrompt = userInstruction ? [
    'User additional natural-language direction: interpret the following text as generation guidance only, not as visible text to render inside the image.',
    'Follow it when it clarifies placement, preservation, color, material, mood, or negative requirements, but do not violate the uploaded reference locks, physical plausibility, no-people rules, no-readable-text rules, or single-photo output format.',
    `Additional direction from user: ${userInstruction}`,
  ] : [];
  const partialEditReferenceNotes = String(job?.partialEditReferenceNotes || '').replace(/\s+/g, ' ').trim().slice(0, 700);
  const referenceCount = job ? getReferenceInputs(job).length : 1;

  if (mode === 'ps_layer_split') {
    return psLayerSplitPrompt(shotLabel, shotPrompt, job);
  }

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
      'For outdoor weddings, garden weddings, lawn weddings, courtyards, terraces, seaside venues, forest venues or open-air venues, the generated frame MUST remain the same outdoor/open-air venue. Preserve the real ground material such as lawn, soil, stone, deck or outdoor paving; preserve visible sky, trees, garden background, horizon, exterior architecture and natural daylight/weather when present. Never enclose an outdoor wedding inside a hotel ballroom, banquet hall, studio, chapel, greenhouse, palace corridor or room. Never add indoor ceiling, wall panels, chandeliers, hotel carpet, banquet tables, ballroom columns, indoor curtains-as-walls, air-conditioning vents or stage ceiling unless those exact objects are clearly visible in the uploaded outdoor reference.',
      'Outdoor fabric/backdrop clarification: if the reference shows lawn/grass/trees/sky together with white drapery, curtains, arches or floral frames, treat those fabrics as outdoor ceremony decor only, not as indoor walls, hotel curtains or a ceiling. Keep open-air depth around and above them.',
      'Do not redesign the wedding. Do not create a new venue. Do not create a fantasy render. Do not change a dark coffee/gold/cream ballroom into a white-green garden, chapel, lawn, greenhouse, outdoor terrace, church aisle, palace corridor or another stock wedding scene. The result should look like real wedding cinematographer footage derived from this exact wedding.',
      ...(isLightingSpaceDetailShot ? [
        'Lighting-space frame direction: first inspect the uploaded reference for a real overhead ceiling installation. If it exists, use the central-axis front-facing upward angle under that real installation, with symmetrical head-on structure and sharp lighting detail. If it does not exist, the primary subject must be a real visible lighting, floral, fabric, aisle, table, candle, crystal prop, wall or floor atmosphere detail from the reference, using a natural eye-level or slight low front angle.',
        'Lighting-space negative style: do not invent ceiling decor, chandeliers, hanging crystals, hanging floral rings or overhead drapery that are not visible in the uploaded reference; do not force an upward ceiling angle when the reference has no ceiling installation; for outdoor/open-air references, do not replace sky, trees, lawn, courtyard or terrace context with an indoor ceiling or ballroom detail; do not use side-angle, diagonal-angle or off-axis composition for true ceiling shots; avoid warm peach fabric dominating unless that is the actual visible style.',
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
    const styleProfilePrompt = weddingStyleProfilePromptBlock(job?.weddingStyleProfile);
    return [
      'Generate another same-style wedding extension based on the uploaded wedding photo.',
      'The uploaded wedding photo is the controlling reference. First use the structured domestic wedding style profile below, then extend it into another similar but non-repeating wedding reference.',
      styleProfilePrompt,
      'Same-style extension means: keep the domestic Chinese wedding aesthetic family, color system, material vocabulary, lighting mood, floral language, venue type and luxury level. Do not merely create any beautiful wedding.',
      'Domestic Chinese layout lock: when the uploaded image is an indoor hotel/banquet-hall wedding, keep a practical Chinese wedding stage grammar: central aisle or T-stage aligned to a visually dominant main stage/backdrop, grounded road-guide florals on both aisle edges, visible stage/runway floor contact, steps or riser edges when raised, and side banquet tables/chairs/venue edges as secondary context when visible. Do not render a fashion-show catwalk, empty Western ceremony aisle, chapel nave, anime stage, palace corridor, or fantasy runway.',
      'Keep the generated image in the SAME ASPECT RATIO as the uploaded image. Do not change it into a fixed square, fixed vertical poster, or fixed 16:9 frame.',
      'Continue the overall atmosphere of the uploaded wedding, including palette, drapery or fabric feeling, stage or aisle relationship, lighting mood, floral color proportions, decor density and luxury level.',
      'Xiaohongshu realism target: make the result feel like a real wedding company case photo, not a perfect CGI proposal render. Keep believable hotel venue edges, dim side tables/chairs when supported, practical rigging or ceiling darkness, floor seams, stage riser edges, uneven spotlight falloff, mild lens softness and natural sensor noise. Avoid cloned flower clusters, liquid-perfect mirror floors, too many chandeliers, showroom-clean surfaces and fantasy stage upgrades.',
      'Do not overfill the image to show richness. For dark-field weddings, black negative space is part of the luxury feeling: preserve dark room breathing space, keep flowers grounded along the aisle edges, keep the central walkway open, and avoid bright candy-purple lighting or studio-portrait overdecoration.',
      'Generate a different but same-family wedding scene, not a copy of the exact same photo. Change only safe extension areas such as floral rhythm, stage styling, fabric curve, lighting placement, foreground/background relationship, welcome area, aisle view, table detail or composition.',
      'Do not split the set into different wedding types such as indoor, outdoor, Chinese, destination, garden, lawn, chapel, castle, terrace or dark crystal unless those are already part of the detected style profile.',
      'The whole set has multiple images generated one by one. Each image should be a clean finished wedding reference image in the same domestic aesthetic family, similar in style but not repeated.',
      'Photorealistic, polished Chinese wedding decor, realistic flowers, realistic fabric, realistic lighting, commercially usable wedding planning reference image.',
      'No people, no bride, no groom, no guests, no text, no watermark, no logo, no UI elements.',
      `Shot: ${shotLabel}. ${shotPrompt}.`,
    ].join(' ');
    return [
      '根据这场婚礼生成一张同款延伸婚礼。',
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
      'Anti-render realism requirement: the result must look like a normal event photographer shot an actual finished wedding setup after construction, not like a 3D visualization, Octane render, Unreal render, AI concept art, showroom render, luxury poster, stage mockup or perfectly clean marketing image. Add restrained real-world imperfections: subtle sensor noise, mild JPEG compression, slight lens softness at the edges, uneven spotlight falloff, small fabric wrinkles, floor seams, stage riser edges, cable/truss/lamp hardware where plausible, imperfect drape folds, natural shadows and real banquet-hall ambience.',
      'Venue context requirement: include enough real venue context to break the render feeling, such as dim banquet tables or hotel chairs at the sides, tablecloths, tableware silhouettes, dark ceiling rigging, stage steps, floor texture and foreground depth when the uploaded design supports an indoor banquet or event hall. Keep these details secondary so the original design remains the main subject.',
      'Lighting realism requirement: avoid overly perfect glossy highlights, fake volumetric beams, plastic-clean red surfaces, uniformly sharp everything, fantasy glow, impossible smoke, symmetrical ray patterns and over-saturated CGI contrast. Use practical event lights with believable haze, exposure rolloff, shadows and color spill.',
      'Spatial rules: keep one continuous physical space with consistent perspective, floor plane, object scale, and a readable aisle-to-stage depth relationship. Do not create a collage, split screen, poster, plan view, fantasy venue, impossible floating props, warped chairs, melted flowers, duplicate stages or unrelated new architecture.',
      'People/text rules: no people, no couple, no guests, no staff, no hands, no readable text, no logos, no watermark, no UI.',
      ...userInstructionPrompt,
      'Camera: horizontal 16:9 single photograph, eye-level or slightly low real camera, 24-35mm event-lens perspective, natural exposure, realistic depth of field, full-frame but not too perfect, keep the whole design readable.',
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
      'Material translation rule: if Image 2 is a CGI render, concept board, studio mockup, screenshot, cutout, or overly perfect generated scene, reinterpret it as real wedding production materials photographed on site. Do not paste Image 2 pixels, copy its whole background, or keep its synthetic render look.',
      'The main wedding decor in the result must visibly echo Image 2: if Image 2 has a large flower focal piece, dark drapery, glowing ball lanterns, floor spotlights or clustered foreground florals, those specific design cues must appear in the installed setup.',
      'Raised-platform rule: if Image 2 shows a stage, runway, aisle deck, stair platform or visible front riser edge, rebuild it as a raised physical structure with real height, vertical front/side faces, steps or risers, contact shadows and perspective. It must not become a flat floor pattern, flat carpet overlay or painted aisle.',
      'Scale and perspective rule: estimate the vanishing points and lens distortion from Image 1. Stage depth, aisle width, stair height, flower-ball height, floral cluster size and table spacing must match the existing chairs, tables, walls and floor scale. Avoid oversized decor blocking impossible amounts of seating unless the room layout supports it.',
      'Lighting integration rule: all added decor must share Image 1 exposure, white balance, contrast, shadow softness, light direction and ambient falloff. Add realistic contact shadows, ambient occlusion, floor reflections only when the floor supports reflections, and subtle edge softness. Avoid isolated glowing stair dots, pasted white highlights, halo edges or light patterns that do not come from visible fixtures.',
      'Floral realism rule: flowers should look like real mixed blooms with varied size, angle, depth, leaves, stems, gaps and imperfect organic clustering. Avoid identical cloned flower balls, mathematically perfect rose spheres, plastic petals, over-saturated neon red, black-crushed props, melted flowers or razor-sharp cutout edges.',
      'Banquet-table rule: when Image 1 is an indoor ballroom, hotel banquet hall or dining event space, add realistic round banquet dining tables on both sides of the central aisle/platform unless Image 1 is clearly too small. Use white or cream tablecloths, matching hotel chairs, table settings/glassware and small floral centerpieces, while keeping the central raised aisle open.',
      'Hard failure boundary: if Image 1 is an indoor ballroom, banquet hall, hotel carpeted room or stage interior, the result MUST remain that same indoor venue. Never turn it into an outdoor lawn, garden, meadow, terrace or sky scene; never replace carpet/tile/wood floor with grass.',
      'Hard failure boundary: if Image 1 is outdoor, keep its actual ground type, landscape, horizon, weather and architecture. Do not replace it with a generic wedding lawn or stock garden unless Image 1 already is that kind of site.',
      'Fusion goal: make it look like the wedding material from Image 2 has been physically built inside Image 1. All decor must touch the Image 1 floor or venue surfaces with correct shadows, contact points, scale and perspective.',
      'Single-camera realism goal: the final image should look like one ordinary event photographer took the finished installation in Image 1, with natural lens softness, mild sensor noise/compression, real-world imperfections and consistent depth. It should not look like a 3D render, marketing mockup, pasted product cutout, game scene, overly clean showroom image or AI composite.',
      'Do not copy Image 2 background, walls, ceiling, floor, outdoor environment, tables, chairs or original camera angle into Image 1 unless those elements are part of the wedding decor and can physically fit.',
      'Do not create a split-screen, before/after comparison, collage, contact sheet, moodboard, poster, plan view, floating render, fantasy scene or unrelated venue.',
      'No people, no couple, no guests, no staff, no hands, no readable text, no logos, no watermark, no UI.',
      ...userInstructionPrompt,
      'Output exactly one continuous real photograph, commercially usable for showing how this wedding would land on this exact empty site.',
      `Shot: ${shotLabel}. ${shotPrompt}.`,
    ].join(' ');
  }

  if (mode === 'product_matrix') {
    return [
      'Create ONE 2:3 vertical high-end wedding design construction matrix base board based on the uploaded wedding case photo, matching the NEW numbered wedding construction-board layout: deep charcoal black background, luxury realistic 3D render quality, rich multi-panel information density, and a professional wedding planning / banquet design handoff feeling. It must not look like the OLD version with a large centered title header and one full-width top hero image. It must not look like a simplified infographic, a flat software UI, a moodboard collage, or a manually drawn board.',
      'SOURCE-IMAGE LOCK: the uploaded wedding photo is the visual style source and construction reference. Preserve its color palette, floral language, lighting mood, fabric/drapery style, stage or aisle relationship, ceiling/truss/lighting relationship, table/chair placement and distinctive props. Do not redesign it into another wedding theme. Clean up obvious construction clutter such as ladders in the final hero render, but construction tools may appear only inside build-step or material panels when useful.',
      'CRITICAL CLEAN BASE RULE: this image will receive all stable Chinese labels, panel borders and grid lines from the app after generation. The model output itself must contain ZERO readable characters and ZERO self-drawn technical annotation. Do NOT draw Chinese, English, section numbers, captions, dimension marks, rulers, measurement ticks, callout arrows, callout dots, table text, handwritten notes, transparent text ribbons, watermarks, fake logos, QR codes or dense paragraphs. Do not create floating black label tags or white caption bands. Leave clean quiet label space inside each panel for later overlay text.',
      'NO SELF-DRAWN FRAMEWORK: do not draw your own gold panel borders, grid frames, table boxes, dense wireframes, nested rectangles, dimension-line systems, fake CAD layers, fake technical labels or decorative corner marks. Use dark empty gutters, clean spacing and clear object placement to imply the layout. The app will overlay the final thin champagne-gold border system and section titles. This prevents double frames and messy text.',
      'TITLE-SAFE ZONES: reserve a plain dark empty strip at the top of every panel, about 48px high in the final 1024x1536 board, with no chandeliers, fabric, flowers, candles, props, tables, lines or thumbnails inside it. The bottom material/component library must reserve a taller plain dark empty header strip, about 96px high, for the section title and column labels. All material thumbnails must start below that header strip, centered in their own visual columns with clear dark gutters so later text does not cover the materials.',
      'Output format: a single luxury matte-black technical proposal board with consistent empty gutters and clear non-overlapping modules. Use realistic architectural visualization, cinematic wedding lighting, premium materials, crisp shadows, and detailed but orderly composition. Do not make it sparse, minimalist, flat, or like a clean software UI screenshot.',
      'Use this exact NEW template structure so the app overlay aligns: no top title band; top-left 64% width by 34% height is the large 45-degree main perspective render of the complete wedding stage, ceremony area and aisle; top-right is split into front elevation above and top-down floor plan below; middle-left 64% width is a large true exploded axonometric construction diagram; middle-right is a neat 2-column by 4-row detail thumbnail grid for close-up component effects; bottom full-width band is a modular component/material library with clear visual columns for floral modules, flower balls, fabric/drape modules, crystal or hanging modules, chandelier/lighting modules, truss/arch/stage structure pieces, candles, props and decorative objects inferred from the source photo. Keep all label/header zones empty, dark and visually quiet.',
      'TRUE EXPLODED AXONOMETRIC REQUIREMENT: the exploded axonometric panel must be schematic and construction-oriented, not a finished bird-eye render. Show separated floating visual layers with visible vertical gaps: overhead truss/lighting layer, backdrop/fabric layer, hanging-prop layer, stage/runway deck layer, floral/greenery layer, tables/chairs/base-layout layer. Do not add written callouts, numbers, measurement labels or long guide lines. Do not render this panel as one complete finished banquet scene.',
      'Technical views should be simple clean front/plan visual diagrams matching the same wedding, without written dimensions, numbers, labels, rulers or measurement ticks. Detail panels should isolate the source-scene components: floral ceiling or floral arch, crystal/bead curtains or hanging ornaments, fabric/drapery folds, chandeliers or warm lighting, stage flowers, aisle decorations, candles, fountains, props, tables and chairs when visible. The bottom material library should use visual thumbnails/icons only, organized as modular design elements rather than banquet-service inventory.',
      'Identify the most distinctive source-scene objects and repeat them consistently across the hero render, detail panels, component library and exploded view: fabric/drapery, lights, floral clusters, aisle pieces, truss, spotlights, hanging props, tables and chairs when visible.',
      'Hard failures to avoid: any model-generated text, fake characters, fake numbers, messy cross-panel wireframes, random long lines, overlapping panels, wrong label zones, double title, black floating tags, numbered tags, English words, white caption bands, translucent title covering the hero render, flat simplified infographic, tiny unreadable text, fake brand names, QR codes, UI screenshot, browser window, people, hands, couple portraits, unrelated stock wedding, or a generic luxury board that does not match the uploaded photo.',
      'The result must feel like one coherent wedding scheme construction matrix board: elegant, structured, technical and useful for proposal communication and internal build planning.',
      'Direction: ' + shotLabel + '. ' + shotPrompt + '.',
    ].join(' ');
  }

  if (mode === 'handdrawn_plan') {
    return [
      'Create ONE vertical 9:16 high-end wedding stage design hand-drawn proposal board by translating the uploaded wedding case photo into a polished designer sketch sheet on warm beige vintage paper.',
      'SOURCE-IMAGE LOCK: the uploaded wedding photo is the source of truth, not loose inspiration and not a moodboard. Preserve the same wedding identity: theme, dominant palette, floral style, stage/backdrop silhouette, ceiling installation, aisle/runway geometry, lighting direction, fabric/drapery rhythm, table/chair placement, material vocabulary, fountains/candles/chandeliers/crystals and distinctive props when visible. It must pass a side-by-side client check as the same wedding re-expressed as a hand-rendered design proposal.',
      'TARGET VISUAL STYLE: match the luxury vintage-paper hand proposal-board effect: cream/beige paper grain, soft watercolor washes, precise pencil and ink construction lines, architectural drafting feeling, fine floral brushwork, realistic 3D wedding visualization blended with hand drawing, warm romantic lighting, refined high-end wedding designer taste.',
      'LAYOUT REQUIREMENT: create a complete proposal board, not a single sketch. Include a large central main wedding stage hero rendering; around it arrange design concept notes, color palette swatches, floor plan, front elevation, side elevation, core structure analysis, material analysis, lighting design, close-up detail enlargements, floral detail, crystal hanging detail, draped fabric detail, chandelier/detail lighting panel, flower ball or decorative prop detail, and small material samples. Keep the hierarchy clear and professional.',
      'TEXT RULE: a few large clean handwritten Chinese-style headings and short labels are allowed, similar to a wedding designer proposal sheet. Text should be sparse, elegant and decorative. Avoid dense paragraphs, tiny unreadable fake micro-text, random English, gibberish Chinese, fake prices, QR codes, logos, watermarks, UI, or any cluttered label field. Do not rely on text for meaning; the visual diagrams and samples must carry the board.',
      'DIMENSION-NUMBER BAN: never write or draw numeric dimension values anywhere on the board. The floor plan, front elevation and side elevation must be visual sketch diagrams without measurement numbers such as 24000, 12000, 8000, 6000, scale labels, ruler numbers, CAD dimension strings or size-callout digits. If a dimension annotation would normally appear, leave only the clean sketch relationship and omit the number entirely.',
      'UNSUPPORTED-OBJECT BAN: do not invent major objects or colors that are not clearly visible in the source photo. Do not replace the original wedding with a generic garden board, chapel board, unrelated beige/pink wedding, different room, different ceiling, different stage shape or stock flower-arch board. New plan/elevation/material/detail sketches must be inferred from visible source elements only.',
      'QUALITY RULE: the board should feel like a client-facing wedding planning company proposal: elegant, romantic, luxurious, clean, layered, detailed but not chaotic. Avoid people, bride, groom, hands, cartoon style, cheap plastic texture, low quality, blurry details, malformed architecture, distorted perspective, and overly busy unreadable annotation fields.',
      `Direction: ${shotLabel}. ${shotPrompt}.`,
    ].join(' ');
  }

  if (mode === 'outdoor_handdrawn_plan') {
    return [
      'Generate ONE premium wedding/event planning visual proposal board, vertical poster ratio. Overall style must be hand-drawn watercolor architectural sketch: soft transparent watercolor washes, fine pencil linework, designer concept proposal draft texture.',
      'Theme/brand, mood, main colors, accent color and venue type are flexible placeholders. Infer them from the uploaded image and the user additional direction when available. Target mood: fresh, outdoor, romantic, artistic, high-end. Suitable venues: outdoor lawn, garden, hotel courtyard, seaside, forest, terrace or greenhouse.',
      'Upper half: show the complete immersive main scene: outdoor ceremony area, lawn, tree or garden background, guest seating, floral installation and main visual structure. In the center place one large artistic installation such as flowing ribbon, abstract sculpture, floral arch or transparent acrylic structure, surrounded by abundant floral materials, fruits or props. The overall feeling must be light, clean, dreamy and refined.',
      'Lower half: create a wedding design scheme breakdown board with multiple small illustrations and annotation modules. Include these modules clearly as bilingual proposal-board labels: STRUCTURES & SEATING 结构与座椅; COLOR PALETTE 色彩展示; FLORAL MATERIALS 花材清单; CENTERPIECE DETAIL 桌花细节; SIGNAGE / WELCOME BOARD 指示牌设计; DESSERT / DRINK DISPLAY 甜品饮品区; FABRIC / DRAPING 布幔材质; CLEAR ACRYLIC CHAIR 透明座椅. Add color swatches, floral material icons, local effect sketches and handwritten annotations.',
      'Composition should feel like a professional wedding planning proposal moodboard: upper half immersive render, lower half design element breakdown. White background, generous negative space, exquisite fresh commercial proposal feeling.',
      'Important layout correction: keep the material list compact; place a clean product-proof/product-evidence area next to the material-list module so the two sections feel balanced and the material list is not oversized.',
      'Source compatibility: use the uploaded image as reference for palette, floral language, decor density and recognizable design cues. If the uploaded image is indoor, translate only the decor language into an outdoor fresh proposal version; do not copy an indoor ceiling into the outdoor scene.',
      ...(userInstruction ? [
        'User additional natural-language direction: interpret the following as theme, palette, venue, installation, materials, props or avoid-list guidance for this outdoor proposal board.',
        `Additional direction from user: ${userInstruction}`,
      ] : []),
      'Avoid: photographic look, 3D render, thick oil painting, dark tone, heavy banquet-hall mood, clutter, dense unreadable paragraphs, prices, QR codes, logos, UI, people, bride/groom, warped chairs, melted flowers.',
      `Direction: ${shotLabel}. ${shotPrompt}.`,
    ].join(' ');
  }

  if (mode === 'construction_checklist') {
    return [
      'Create ONE complete vertical wedding landing construction checklist board from the uploaded wedding construction matrix. This is a single-step matrix-to-checklist transformation, not four separate generated panels.',
      'SOURCE ROLE: the uploaded image is preferably a wedding construction matrix board. Treat it as the controlling blueprint, not loose inspiration. Read its main perspective, front elevation, floor plan, exploded axonometric view, detail panels and material library, then reorganize that existing information into a practical construction handoff sheet. If the upload is only a normal wedding photo, infer the same categories conservatively from the visible wedding.',
      'FIDELITY PRIORITY: preserve the same wedding identity from the uploaded source: theme, dominant palette, floral language, stage/backdrop silhouette, aisle/runway geometry, ceiling/truss/hanging installation, drapery/fabric, crystal/chandelier/lamp vocabulary, props, lighting mood and material density. Keep any hotel dining area only as faint spatial context if it already exists, never as the focus. Do not redesign into a different wedding theme.',
      'LAYOUT REQUIREMENT: match a professional white landing-construction sheet: large top-left photorealistic hero render, top-right project overview and design highlights, a middle landing-size band with floor plan, front elevation and side elevation, then lower build-material list, construction material thumbnail grid, build steps, safety notes, lighting suggestion and upgrade configuration table. Use cream-white sheet background, taupe section headers, clean construction-table spacing, and practical wedding execution aesthetics.',
      'MATERIAL FOCUS: show mainly build/setup materials: truss and rigging, backdrop drapes, carved foam props, floral arches and ground flowers, stage deck, aisle runner, aisle markers, hanging chandelier/crystal/fairy-light decor, front wash lights, moving head beam lights, COB/par lights, power distribution boxes, cables, cable ramps, tape, zip ties and counterweights. Exclude hotel dining materials from all material areas: no banquet round tables, chair covers, tableware, plates, cutlery, glassware, napkins, menu cards or dining service items.',
      'TEXT RULE: generate a clean visual base with no readable Chinese or English. Sparse unreadable placeholder strokes are acceptable only as table texture, because the app will overlay stable Chinese labels, dimensions and tables afterward. Do not put logos, watermarks, QR codes, brand marks, browser/app UI or dense fake micro-text.',
      'Output one vertical board around 3:4 to 2:3 ratio, high resolution, clean and client-facing. Avoid distorted trusses, melted flowers, impossible floating props, messy dimension lines, chaotic collage, people, bride, groom or hands.',
      `Direction: ${shotLabel}. ${shotPrompt}.`,
    ].join(' ');
  }

  if (mode === 'detail_grid') {
    return [
      'Use GPT image generation/editing to create ONE vertical 3x3 same-stage wedding album from the uploaded wedding stage photo.',
      'The uploaded image is the strict source of truth, not loose style inspiration. Preserve the exact stage identity: same backdrop structure, same stage geometry, same aisle/runway, same chandelier or ceiling installation if present, same drapery/chain/fabric rhythm, same floral color and density, same lighting direction, same black/white/gold/red/green palette, same venue mood.',
      'Output format: a single 3:4 vertical image with a clean 3-column by 3-row grid, like a client-facing wedding album. It is NOT a technical board, NOT a labeled infographic, NOT a new wedding design.',
      'Nine grid contents must all be GPT-generated views/details of this exact same stage: top row = full stage / centered aisle-to-stage / side angle of the same stage; middle row = aisle flower edge / stage center backdrop / lighting or hanging installation detail; bottom row = guest-table or stage-side area if visible / aisle surface and candles / stage step or floral base detail.',
      'Fidelity priority beats creativity. Generate new camera views and close-up details, but keep every visible anchor consistent with the uploaded stage. Do not change the stage, do not replace decor, do not invent a new scene, do not change the flower color, do not change the aisle material, do not add people.',
      'Important: this is not a manual collage. The final image should look like GPT generated a cohesive nine-image album from one wedding stage, similar to a Xiaohongshu wedding case grid, while staying recognizably the same stage.',
      'No text, no labels, no QR codes, no logos, no watermarks, no social-media UI, no random English and no unreadable Chinese.',
      `Direction: ${shotLabel}. ${shotPrompt}.`,
    ].join(' ');
  }

  if (mode === 'setup_process_grid') {
    const setupBrandName = normalizeSetupBrandName(job?.setupBrandName || '');
    const setupBrandNameChars = Array.from(setupBrandName).filter((char) => char.trim()).join(' ');
    return [
      'Use GPT image generation/editing to create ONE horizontal 16:9 photorealistic wedding setup-process grid from the uploaded finished wedding photo.',
      'OUTPUT FORMAT IS CRITICAL: one single 16:9 image containing a clean 3-column by 3-row grid with thin white dividers. This is a nine-panel process image, not a video, not a storyboard for separate outputs, not a vertical poster, not a technical checklist board.',
      'The uploaded image is the strict source of truth for the final wedding identity. Preserve the same venue architecture, ballroom/stage/aisle geometry, literal top boundary, architectural ceiling or open-air top exactly as shown, visible truss only if present, floral color palette, drapery/fabric language, lighting mood, material texture and overall luxury level.',
      'Top/ceiling lock with strict no-hallucination rule: default to NO suspended ceiling decor. Only allow overhead wedding work when the uploaded finished photo unmistakably shows that exact hanging wedding installation as a major visible element. A cropped/dark/plain top, normal hotel ceiling, ordinary house lights, spotlights, wall edge, black void or ambiguous upper frame is NOT evidence of吊顶. If uncertain, treat it as no吊顶.',
      'When treated as no吊顶, every panel must keep the top area plain/open/as originally shown and must not add any dropped ceiling, canopy, chandelier, hanging crystals, hanging florals, drapery ceiling, starry ceiling, tent roof, arching roof, tree canopy, new overhead truss, sky replacement, higher/lower roof or unrelated top decoration. Do not show workers installing anything above head height except side/backdrop/upright frames that are visible in the final photo.',
      'Infer a believable chronological build sequence from the final scene. The nine panels should read left-to-right, top-to-bottom:',
      'Panel 1: empty venue or bare stage before wedding setup, same camera/venue architecture, no decor installed yet.',
      'Panel 2: backdrop frame, stage structure, side truss, fabric or curtain installation begins only where supported by the final photo; staff may be visible working. Do not create roof frames or overhead rigs unless the final photo clearly has them.',
      'Panel 3: if the final photo unmistakably has overhead suspended decor, show that exact ceiling crystal, hanging floral, lighting or canopy element being installed. Otherwise show stage/backdrop/upright frame/ground lighting/floor floral work, with the top area unchanged and empty of吊顶.',
      'Panel 4: close process view of visible supported elements being adjusted: hanging strands/fabric only when they exist in the final photo; otherwise use backdrop fabric, stage detail, floor lighting, aisle marker, floral base or side prop adjustment, with no invented ceiling work and no upward-looking ceiling shot.',
      setupBrandName
        ? `Panel 5: main stage floral construction with ONE readable staff-uniform medium shot, but the wedding setup process must remain the main subject. Show a back-facing worker in the near foreground or foreground side, actively arranging flowers, carrying floral material, adjusting props or checking the stage. The worker's dark shirt back should fill about 38-50% of this panel height and about 22-32% of this panel width, enough for the shirt-back name "${setupBrandName}" to be readable without turning the panel into a clothing close-up. The surrounding stage, floral base, tools, props and unfinished construction details should fill most of the panel. This panel must feel like a real wedding build-process photo, not a uniform advertisement.`
        : 'Panel 5: main stage floral construction, workers arranging flowers and core focal pieces.',
      'Panel 6: aisle, stage base, floor floral clusters, candles or side props being placed.',
      'Panel 7: nearly finished ceremony/stage area with workers doing final low-level adjustments.',
      'Panel 8: final inspection or lighting test from a slightly wider event-space angle.',
      'Panel 9: finished wedding scene matching the uploaded photo style, composition and top/ceiling structure as the completed result. If the uploaded photo has no clear吊顶, panel 9 must also have no吊顶.',
      'People rule: setup staff are allowed in process panels 2-8, wearing simple dark work clothes, but no couple, no guests, no portraits, no smiling staged models. Staff should look like real production workers and should not dominate the scene. Panel 1 and panel 9 should be clean venue/final-scene shots without distracting people whenever possible.',
      setupBrandName
        ? `Staff clothing brand rule: readability beats repetition, but wedding construction context beats clothing close-up. Make Panel 5 the single primary readable shirt-back brand panel; do not try to make the name readable on many tiny distant workers. Print the exact brand name "${setupBrandName}" once on the back of the foreground worker's shirt in Panel 5, like a real wedding production company uniform. Use large centered bold white block characters or letters on a plain dark shirt, flat across the upper back, high contrast, crisp edges, no perspective warping. The printed name should occupy about 38-50% of the shirt-back width and about 7-11% of the full panel height, readable but secondary to the stage-building action. The shirt-back text must be exactly "${setupBrandName}" with no substitution, no question marks, no garbled symbols, no random letters, no fake placeholder text, and no extra characters; the visible characters should read ${setupBrandNameChars || setupBrandName} in that order. If the name is long, split it into two centered lines of large characters instead of shrinking it. Keep the name unobstructed by straps, arms, tools, folds, flowers or motion blur, and do not crop it off. Other small or distant workers in panels 2-8 should have plain dark backs with no readable text or only indistinct non-readable marks, to avoid tiny garbled lettering. Place "${setupBrandName}" only on clothing backs. Do not put "${setupBrandName}" on banners, stage backdrops, walls, signs, watermarks, captions, UI, or panel labels.`
        : 'Staff clothing brand rule: no brand name was supplied, so keep setup staff clothing plain dark workwear with no readable shirt text.',
      'Fidelity priority beats creativity. Do not redesign the wedding, do not change the main color system, do not invent a different venue, outdoor lawn, chapel, garden, unrelated stage shape, unrelated flowers or unrelated props. The process must look like this exact final wedding was being built.',
      'Composition quality: every panel should be photographic, commercially usable, realistic scale, realistic rigging, grounded props, plausible shadows, consistent lens/perspective and one coherent venue identity. Use the uploaded final image as the visual anchor for all panels.',
      setupBrandName
        ? `No text, labels, numbers, QR codes, logos, watermarks, social-media UI, random English or unreadable Chinese inside the generated image, except the exact brand name "${setupBrandName}" on the medium-shot staff shirt back in Panel 5. Avoid repeated tiny shirt text, blurred shirt text, low-contrast shirt text, cropped shirt text, warped shirt text, misspelled shirt text or partially hidden shirt text.`
        : 'No text, no labels, no numbers, no QR codes, no logos, no watermarks, no social-media UI, no random English and no unreadable Chinese inside the generated image.',
      `Direction: ${shotLabel}. ${shotPrompt}.`,
    ].join(' ');
  }

  if (mode === 'photo_area_setup_grid') {
    const setupBrandName = normalizeSetupBrandName(job?.setupBrandName || '');
    const setupBrandNameChars = Array.from(setupBrandName).filter((char) => char.trim()).join(' ');
    return [
      'Use GPT image generation/editing to create ONE horizontal 16:9 photorealistic wedding photo-area setup-process grid from the uploaded finished wedding photo area image.',
      'OUTPUT FORMAT IS CRITICAL: one single 16:9 image containing a clean 3-column by 3-row grid with thin white dividers. This is a nine-panel process image, not a video, not a storyboard for separate outputs, not a vertical poster, not a technical checklist board.',
      'Subject lock: this mode is specifically for a wedding photo area / welcome photo zone / sign-in backdrop / check-in display / guest photo wall. The uploaded image is the strict source of truth for the final photo-area identity. Preserve the same location, wall or outdoor background, ground/floor material, camera viewpoint, finished backdrop board or photo wall, welcome sign, logo or nameplate area as visual shapes, floral color palette, supported props, drapery and spatial relationship.',
      'Physical-object lock: treat anything visible only inside printed portrait panels or poster artwork as printed image content, not as real venue objects. Do not turn bar shelves, pendant lamps, people, wine glasses, paintings or interior decor inside the printed panels into physical props, side lamps, lamp posts, wall sconces, light columns or extra decorations outside the panels. If the final uploaded photo does not clearly show real freestanding or hanging lamps beside the photo area, every process panel must keep both sides free of new lamps and only use the original dark wall/curtain/empty space.',
      'Do not transform the photo area into a main ceremony stage, banquet hall, aisle runway, dining-table setup, chapel, lawn ceremony, large stage show or unrelated wedding scene. If the uploaded image only shows a compact photo spot, every panel must remain a compact photo spot.',
      'Text/signage handling: preserve existing signboard/poster/nameplate areas as visual blocks and graphic placements, but do not invent new readable text, random English, garbled Chinese, QR codes or logos. If the original sign is readable, keep its placement and approximate visual presence without adding extra slogans.',
      'Infer a believable chronological build sequence from the final photo area. The nine panels should read left-to-right, top-to-bottom:',
      'Panel 1: empty wall, entrance corner, lobby/photo-zone location or outdoor background before setup, same camera and ground material, no wedding photo-area decor installed yet.',
      'Panel 2: floor protection, measuring tape, small cases or tools, with 1-2 dark-shirt setup workers marking the backdrop/welcome-sign placement.',
      'Panel 3: backdrop board, display frame, arch frame, freestanding wall, signboard stand or photo-wall structure being positioned by setup workers, only using shapes supported by the final image.',
      'Panel 4: main backdrop surface, fabric, printed panel, acrylic board, photo frame or sign-in wall being fixed and aligned by workers; show hands, ladders or carrying posture where believable.',
      setupBrandName
        ? `Panel 5: photo-area floral construction with ONE mandatory readable staff-uniform medium shot, like the existing wedding setup video grid feature. Show a back-facing worker in the near foreground or foreground side, actively arranging flowers, adjusting the welcome sign, fixing the backdrop or placing props. The worker's dark shirt back should fill about 42-55% of this panel height and about 24-34% of this panel width, enough for the shirt-back name "${setupBrandName}" to be clearly readable without turning the panel into a clothing-only close-up. The surrounding backdrop, signboard, flowers, tools, props and unfinished photo-area details should fill most of the panel. This panel must not be empty or people-free.`
        : 'Panel 5: floral construction around the photo backdrop or welcome sign, with a mandatory back-facing dark-shirt worker medium shot arranging flowers and core focal pieces.',
      'Panel 6: props, photo frame, welcome board, sign-in table item, floor floral clusters, candles or small decorative objects being placed by workers where supported by the final image. Do not add new side lamps, lamp posts, lanterns or hanging lights unless they are physically visible outside the printed panels in the final uploaded photo.',
      'Panel 7: nearly finished photo area with visible workers doing final low-level adjustments, cleaning the ground, straightening the sign or checking floral density.',
      'Panel 8: final ambient-light inspection from a slightly wider event-space angle, showing the photo area nearly complete and 1-2 staff members checking existing warm venue light, floor reflections or hidden uplight mood in the same location. Do not introduce new visible side fixtures or symmetrical lamps.',
      'Panel 9: finished photo area matching the uploaded image style, composition, backdrop/sign/floral relationship and ground/wall structure as the completed result.',
      'People rule: setup staff are required in process panels 2-8, wearing simple dark work clothes, especially back-facing workers in panels 3-7. Do not omit all people. No couple, no guests, no posed portraits, no smiling staged models. Staff should look like real production workers and should not dominate the photo area. Panel 1 and panel 9 should be clean location/final-scene shots without distracting people whenever possible.',
      setupBrandName
        ? `Staff clothing brand rule: readability beats repetition, but wedding photo-area construction context beats clothing close-up. Make Panel 5 the single primary readable shirt-back brand panel, matching the existing wedding setup video grid behavior; do not try to make the name readable on many tiny distant workers. Print the exact brand name "${setupBrandName}" once on the back of the foreground worker's shirt in Panel 5, like a real wedding production company uniform. Use large centered bold white block characters or letters on a plain dark shirt, flat across the upper back, high contrast, crisp edges, no perspective warping. The printed name should occupy about 40-55% of the shirt-back width and about 8-13% of the full panel height, readable but secondary to the backdrop/sign/floral setup action. The shirt-back text must be exactly "${setupBrandName}" with no substitution, no question marks, no garbled symbols, no random letters, no fake placeholder text, and no extra characters; the visible characters should read ${setupBrandNameChars || setupBrandName} in that order. If the name is long, split it into two centered lines of large characters instead of shrinking it. Keep the name unobstructed by straps, arms, tools, folds, flowers or motion blur, and do not crop it off. Other small or distant workers in panels 2-8 should have plain dark backs with no readable text or only indistinct non-readable marks, to avoid tiny garbled lettering. Place "${setupBrandName}" only on clothing backs. Do not put "${setupBrandName}" on the backdrop, welcome sign, photo wall, floor, walls, watermarks, captions, UI, or panel labels.`
        : 'Staff clothing brand rule: no brand name was supplied, so keep setup staff clothing plain dark workwear with no readable shirt text.',
      'Fidelity priority beats creativity. Do not redesign the wedding photo area, do not change the main color system, do not invent a different venue, a main stage, an aisle, a banquet table layout, unrelated flowers, unrelated props, side lamps or freestanding light fixtures. The process must look like this exact final photo area was being built.',
      'Composition quality: every panel should be photographic, commercially usable, realistic scale, grounded props, plausible shadows, consistent lens/perspective and one coherent photo-area location. Use the uploaded final image as the visual anchor for all panels.',
      setupBrandName
        ? `No text, labels, numbers, QR codes, logos, watermarks, social-media UI, random English or unreadable Chinese inside the generated image, except the exact brand name "${setupBrandName}" on the medium-shot staff shirt back in Panel 5 and any pre-existing uploaded signboard graphic preserved as non-new visual structure. Avoid repeated tiny shirt text, blurred shirt text, low-contrast shirt text, cropped shirt text, warped shirt text, misspelled shirt text or partially hidden shirt text.`
        : 'No new text, no labels, no numbers, no QR codes, no logos, no watermarks, no social-media UI, no random English and no unreadable Chinese inside the generated image.',
      `Direction: ${shotLabel}. ${shotPrompt}.`,
    ].join(' ');
  }

  if (mode === 'partial_wedding_edit') {
    return [
      'Create ONE conservative photorealistic local edit of Reference Image 1.',
      'REFERENCE IMAGE 1 is the locked base photograph and the only editable canvas. The result must be immediately recognizable as the same photo after a small local wedding-decor edit.',
      job?.partialEditMask
        ? 'A user-drawn edit mask is attached: the transparent mask area is the editable area, and the opaque mask area must remain visually unchanged. Keep the edit inside the masked region unless natural blending at the edge is required.'
        : '',
      'Base-photo lock: preserve the same crop/aspect ratio, camera angle, lens height, perspective, horizon/floor line, wall or outdoor background, architecture, ground/floor material, lighting direction, exposure, shadow direction, color balance, object positions and image composition from Reference Image 1.',
      'Identity anchors must stay: if Reference Image 1 contains a welcome sign, red display board, printed Chinese text, couple portrait/photo, logo panel, poster frame, entrance wall, pavement, building edge, plants, columns or background structure, keep those elements in the same place, size, color family and visual role.',
      'Do not remove, translate, rewrite or replace existing signage/text/portrait areas. Preserve existing text/signage as close visual graphics from the base photo; do not invent new readable words.',
      'Edit coverage limit: unless the user explicitly asks for a full replacement, change only the requested local area and keep at least 80 percent of the base photo visually unchanged.',
      'Only add, remove or replace the exact wedding decor objects requested by the user. If the user asks to replace a stage, backdrop, aisle, runway, floral structure, fabric, lighting or prop style with the extra reference image, transfer that requested wedding-design structure from the extra reference while keeping Reference Image 1 as the venue and camera lock.',
      referenceCount > 1 && partialEditReferenceNotes
        ? `Optional extra reference notes for the requested wedding design only: ${partialEditReferenceNotes}. Use these notes only for requested stage/backdrop/aisle/floral/fabric/lighting/prop structure, materials, colors or density; never copy the extra reference venue, wall, floor, camera angle, poster layout, signs, words, people or unrelated objects.`
        : 'If Reference Image 2 or later is supplied, treat those extra images as wedding-design references only. Transfer the requested stage/backdrop/aisle/floral/fabric/lighting/prop elements when the user asks for them; never copy their venue, wall, floor, poster layout, people, cartoon figures, readable words, watermark, camera angle or full scene.',
      referenceCount > 1
        ? 'Reference Image 1 is the base canvas. Reference Image 2 and later are not replacement scenes; they are design-source references only for the requested local replacement.'
        : 'Follow the text instruction while keeping the original wedding scene physically consistent.',
      'Never turn the base photo into a new indoor ballroom, ceremony stage, sofa backdrop, beige/white arch scene, studio render, product poster, stock wedding scene or unrelated venue.',
      'If the user asks to add balloons or flowers to a specific area, keep the original main background/signboard/entrance and add those balloons or flowers only around the requested area. Do not let balloons or flowers take over the whole image.',
      'Hard negatives: no new people, no new couple, no guests, no staff, no hands, no newly invented readable text, no watermark, no logo, no UI, no split screen, no collage, no before-after panel, no fantasy venue, no floating flowers or props, no melted objects, no warped chairs, no random signage.',
      'Output the same aspect ratio as the main uploaded wedding photo, one continuous real photograph, commercially usable for client preview. If unsure, preserve more of Reference Image 1 and edit less.',
      `User edit instruction: ${editInstruction || 'make a subtle, realistic wedding decor adjustment while preserving the original scene.'}`,
      `Candidate direction: ${shotLabel}. ${shotPrompt}.`,
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

async function requestOpenAIImageEditBuffer(job, prompt, model = OPENAI_MODEL) {
  throwIfJobCancelled(job);
  const references = getImageEditInputs(job);
  const requestTimeout = imageRequestTimeoutFor(job);

  if (USE_N1N) {
    return requestN1nImageBuffer(job, prompt, references, model);
  }

  // 官方 OpenAI：用 SDK images.edit（multipart 上传），SDK 自带正确的 UA / Stainless headers。
  const imageFiles = await Promise.all(references.map((reference) => toFile(reference.buffer, reference.filename, {
    type: reference.mimetype,
  })));
  const quality = imageQualityForApi(job);
  const editPayload = {
    model,
    image: imageFiles.length === 1 ? imageFiles[0] : imageFiles,
    prompt,
    size: imageRequestSizeForModel(job, model),
    n: 1,
    output_format: isFreeImageMode(job?.mode) ? freeImageFormatForApi(job) : 'jpeg',
  };
  if (quality) editPayload.quality = quality;
  if (editPayload.output_format === 'jpeg') editPayload.output_compression = 88;
  const editMask = getImageEditMask(job);
  if (editMask?.buffer) {
    editPayload.mask = await toFile(editMask.buffer, editMask.filename || 'edit-mask.png', {
      type: editMask.mimetype || 'image/png',
    });
  }
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

async function requestOpenAIImageEditBufferWithFallback(job, prompt) {
  return requestImageBufferWithModelFallback({
    job,
    prompt,
    providerLabel: USE_N1N ? 'n1n' : OPENAI_PROVIDER_LABEL,
    models: OPENAI_IMAGE_MODELS,
    request: (model) => requestOpenAIImageEditBuffer(job, prompt, model),
  });
}

async function requestOpenAIImageGenerationBuffer(job, prompt, model = OPENAI_MODEL) {
  throwIfJobCancelled(job);
  const requestTimeout = imageRequestTimeoutFor(job);

  if (USE_N1N) {
    return requestN1nImageGenerationBuffer(job, prompt, [], model);
  }

  const outputFormat = freeImageFormatForApi(job);
  const quality = imageQualityForApi(job);
  const payload = {
    model,
    prompt,
    size: imageRequestSizeForModel(job, model),
    n: 1,
    output_format: outputFormat,
  };
  if (quality) payload.quality = quality;
  if (outputFormat === 'jpeg') payload.output_compression = 88;

  const response = await openai.images.generate(payload, {
    timeout: requestTimeout,
    signal: signalForJob(job, requestTimeout),
  });

  throwIfJobCancelled(job);
  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error('图片生成接口没有返回图像数据');
  return Buffer.from(b64, 'base64');
}

async function requestOpenAIImageGenerationBufferWithFallback(job, prompt) {
  return requestImageBufferWithModelFallback({
    job,
    prompt,
    providerLabel: USE_N1N ? 'n1n' : OPENAI_PROVIDER_LABEL,
    models: OPENAI_IMAGE_MODELS,
    request: (model) => requestOpenAIImageGenerationBuffer(job, prompt, model),
  });
}

async function requestN1nImageGenerationBuffer(job, prompt, reference, model = OPENAI_MODEL) {
  const requestTimeout = imageRequestTimeoutFor(job);
  const references = (Array.isArray(reference) ? reference : [reference]).filter((item) => item?.buffer);
  const imageInput = references.map((item) => {
    if (currentPublicBaseUrl() && item.storedFilename) return publicUrl(job.id, item.storedFilename);
    const mime = item.mimetype || 'image/jpeg';
    return 'data:' + mime + ';base64,' + item.buffer.toString('base64');
  });
  const publicRefs = references
    .filter((item) => currentPublicBaseUrl() && item.storedFilename)
    .map((item) => item.storedFilename);
  if (publicRefs.length && job?.logs) {
    job.logs.push('[n1n] generations 使用公网参考图：' + publicRefs.join(', '));
  }

  const payload = {
    model,
    prompt,
    size: isPartialWeddingEditMode(job?.mode) ? 'auto' : imageRequestSizeForModel(job, model),
    n: 1,
  };
  if (imageInput.length) payload.image = imageInput;
  const quality = imageQualityForApi(job);
  if (quality) payload.quality = quality;
  const outputFormat = isFreeImageMode(job?.mode) ? freeImageFormatForApi(job) : 'jpeg';
  if (outputFormat) payload.output_format = outputFormat;
  if (outputFormat === 'jpeg') payload.output_compression = 88;
  if (isImageEnhanceMode(job?.mode) && imageModelLooksGemini(model)) {
    payload.image_size = normalizeImageEnhanceSize(job?.imageEnhanceSize);
  }

  const payloadJson = await requestImageApiWithTransientRetries({
    job,
    context: 'n1n.ai images.generations',
    requestTimeout,
    createFetchArgs: () => ({
      url: N1N_IMAGE_GENERATIONS_ENDPOINT,
      options: {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      },
    }),
    parseResponse: async (response) => {
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
      return response.json().catch(() => null);
    },
  });
  if (!payloadJson) {
    throw new Error('n1n.ai 接口没有返回图像数据');
  }
  const item = payloadJson?.data?.[0] || payloadJson?.images?.[0] || payloadJson?.output?.[0] || payloadJson?.result?.[0] || payloadJson;
  return imageBufferFromApiItem(item, job);
}

async function requestN1nImageEditBuffer(job, prompt, reference, model = OPENAI_MODEL) {
  throwIfJobCancelled(job);
  const requestTimeout = imageRequestTimeoutFor(job);
  const references = isPartialWeddingEditMode(job?.mode)
    ? getImageEditInputs(job)
    : (Array.isArray(reference) ? reference : [reference]);
  const primaryEditEndpoint = isStrictReferenceEditMode(job?.mode)
    ? N1N_IMAGE_EDIT_ENDPOINT
    : N1N_IMAGE_EDIT_ENDPOINT;
  const editEndpoints = [...new Set([
    primaryEditEndpoint,
    OPENAI_BASE_URL ? `${OPENAI_BASE_URL.replace(/\/$/, '')}/images/edits` : '',
    N1N_IMAGE_GENERATIONS_ENDPOINT.replace(/\/images\/generations\/?$/i, '/images/edits'),
  ].filter(Boolean))];

  const outputFormat = isFreeImageMode(job?.mode) ? freeImageFormatForApi(job) : 'jpeg';
  const quality = imageQualityForApi(job);
  const editMask = getImageEditMask(job);

  const buildEditForm = () => {
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    form.append('n', '1');
    form.append('size', imageRequestSizeForModel(job, model));
    if (isImageEnhanceMode(job?.mode) && imageModelLooksGemini(model)) form.append('image_size', normalizeImageEnhanceSize(job?.imageEnhanceSize));
    form.append('response_format', 'b64_json');
    form.append('output_format', outputFormat);
    if (outputFormat === 'jpeg') form.append('output_compression', '88');
    if (quality) form.append('quality', quality);
    if (isStrictReferenceEditMode(job?.mode)) form.append('input_fidelity', 'high');

    for (const field of N1N_EDIT_IMAGE_FIELD.split(',').map((item) => item.trim()).filter(Boolean)) {
      for (const item of references) {
        const referenceBlob = new Blob([item.buffer], { type: item.mimetype || 'image/jpeg' });
        form.append(field, referenceBlob, item.filename || 'wedding-reference.jpg');
      }
    }
    if (editMask?.buffer) {
      for (const field of N1N_EDIT_MASK_FIELD.split(',').map((item) => item.trim()).filter(Boolean)) {
        const maskBlob = new Blob([editMask.buffer], { type: editMask.mimetype || 'image/png' });
        form.append(field, maskBlob, editMask.filename || 'edit-mask.png');
      }
    }
    return form;
  };

  let lastError = null;
  for (const editEndpoint of editEndpoints) {
    if (isStrictReferenceEditMode(job?.mode) && job?.logs) {
      job.logs.push(`[n1n] ${MODE_LABELS[job.mode] || job.mode} edits endpoint: ${editEndpoint}`);
    }
    try {
      return await requestImageApiWithTransientRetries({
        job,
        context: 'n1n.ai images.edits',
        requestTimeout,
        createFetchArgs: () => ({
          url: editEndpoint,
          options: {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${OPENAI_API_KEY}`,
              Accept: 'application/json',
            },
            body: buildEditForm(),
          },
        }),
        parseResponse: (response) => readImageApiResponse(response, 'n1n.ai images.edits', job),
      });
    } catch (error) {
      lastError = error;
      if (!shouldTryAlternateN1nTransport(error)) throw error;
      if (job?.logs) {
        job.logs.push(`[n1n] edits endpoint 不可用，尝试下一个域名：${describeFetchError(error).slice(0, 160)}`);
      }
    }
  }

  throw lastError || new Error('n1n.ai images.edits failed');
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

function shouldTryNextImageModelError(error) {
  if (isJobCancelledError(error)) return false;
  const message = [
    error?.message,
    error?.body,
    error?.code,
    describeFetchError(error),
  ].filter(Boolean).join(' ');
  return /HTTP 402|HTTP 429|HTTP 500|HTTP 503|no available|no sources|unavailable|temporar|overload|capacity|distributor|no route|no channel|channel.*available|model.*not.*available|model.*unsupported|unsupported.*model|model.*not.*supported|not supported model|not.*support.*model|model.*disabled|model.*not.*found|invalid model|insufficient|not enough|balance|credit|quota|billing|payment|余额|额度|点数|计费|欠费|无可用渠道|没有.*渠道|渠道不可用|渠道.*不可用|模型.*不可用|模型.*不支持|模型.*不存在|无效模型/i
    .test(String(message || ''));
}

async function requestImageBufferWithModelFallback({ job, prompt, providerLabel, models, request }) {
  const candidates = uniqueList(models);
  let lastError = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const model = candidates[index];
    if (index > 0) {
      job?.logs?.push(`[image] retrying fallback image model: ${model}`);
    }
    try {
      const buffer = await request(model);
      if (index > 0) {
        job?.logs?.push(`[image] fallback image model accepted: ${model}`);
      }
      return buffer;
    } catch (error) {
      if (isJobCancelledError(error)) throw error;
      lastError = error;
      const canTryNext = index < candidates.length - 1 && shouldTryNextImageModelError(error);
      if (!canTryNext) throw error;
      job?.logs?.push(`[image] ${providerLabel} model ${model} unavailable, trying next fallback: ${describeFetchError(error).slice(0, 180)}`);
    }
  }

  throw lastError || new Error(`${providerLabel || 'Image'} image generation failed`);
}

function shouldTryN1nStrictImageGenerationFallback(job, model = '', error = null) {
  if (isJobCancelledError(error)) return false;
  if (isPsLayerSplitMode(job?.mode)) return true;
  if (N1N_STRICT_REFERENCE_FALLBACK === 'generations' || N1N_STRICT_REFERENCE_FALLBACK === 'json') return true;
  return isImageEnhanceMode(job?.mode) && imageModelLooksGemini(model);
}

async function requestN1nImageBuffer(job, prompt, reference, model = OPENAI_MODEL) {
  const mode = N1N_IMAGE_INPUT_MODE;
  if (isPartialWeddingEditMode(job?.mode)) {
    if (job?.logs) {
      job.logs.push('[n1n] Partial edit will try images.edits first: Image 1 is the locked base photo; later images are decor references only.');
    }
  }
  if (isStrictReferenceEditMode(job?.mode)) {
    const label = MODE_LABELS[job?.mode] || job?.mode || '当前模式';
    if (job?.logs) job.logs.push(`[n1n] ${label}优先使用 images.edits 参考图编辑通道，必要时切换 generations JSON 参考图通道`);
    try {
      return await requestN1nImageEditBuffer(job, prompt, reference, model);
    } catch (error) {
      if (shouldTryN1nStrictImageGenerationFallback(job, model, error)) {
        const detail = describeFetchError(error).slice(0, 180);
        if (job?.logs) {
          job.logs.push(`[n1n] ${label} edits 通道不可用，自动切换 generations JSON 参考图通道：${detail}`);
        }
        return requestN1nImageGenerationBuffer(job, prompt, reference, model);
      }
      if (shouldTryAlternateN1nTransport(error)) {
        const detail = describeFetchError(error).slice(0, 180);
        const strictError = new Error(`强参考图编辑通道暂时不可用：${detail}`);
        strictError.status = error?.status;
        strictError.cause = error;
        throw strictError;
      }
      if (Number(error?.status || 0) !== 403
        || !textLooksLikeCloudflareBlock(error?.body || error?.message || '')
        || !HAS_XIAOJI_KEY
        || !ALLOW_XIAOJI_IMAGE_FALLBACK) {
        throw error;
      }
      if (job?.logs) job.logs.push('[n1n] images.edits 被 Cloudflare 拦截，自动切到 baziapi images.edits 备用通道');
      return requestXiaojiImageBufferWithFallback(job, prompt);
    }
  }
  if (mode === 'edit' || mode === 'edits' || mode === 'multipart') {
    return requestN1nImageEditBuffer(job, prompt, reference, model);
  }
  if (mode === 'generation' || mode === 'generations' || mode === 'json') {
    return requestN1nImageGenerationBuffer(job, prompt, reference, model);
  }

  try {
    return await requestN1nImageEditBuffer(job, prompt, reference, model);
  } catch (error) {
    if (!shouldTryAlternateN1nTransport(error)) throw error;
    const detail = describeFetchError(error).slice(0, 180);
    if (job) job.logs.push(`[n1n] edits multipart 通道失败，自动切换 generations JSON：${detail}`);
    return requestN1nImageGenerationBuffer(job, prompt, reference, model);
  }
}

async function generateWithOpenAI(job, outputDir, existingImages = []) {
  const shots = SHOT_PLANS[job.mode];
  const total = shots.length;
  const slots = new Array(total).fill(null);
  for (const item of existingImages) {
    const match = baseGeneratedImageRegex().exec(item.filename || '');
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
      done < total ? `${stagePrefix}：${next}（${done}/${total}）` : '正在整理生成图片',
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
          const buf = await requestOpenAIImageEditBufferWithFallback(job, promptFor(job.mode, label, shotPrompt, job));
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
              throw new Error(`${ACTIVE_PROVIDER} 图片生成超时（>${Math.round(requestTimeout / 1000)}s），系统将自动继续生成`);
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
      const filename = generatedImageFilename(index, job.mode);
      await writeGeneratedImage(buffer, path.join(outputDir, filename), width, height, job.mode);
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

function freeImageCountForJob(job = null) {
  return normalizeFreeImageCount(job?.freeImageCount || 1);
}

function promptForFreeImage(job = null, index = 0) {
  const userPrompt = normalizeFreeImagePrompt(job?.freeImagePrompt || job?.userInstruction || '');
  const base = isFreeImageToImageMode(job?.mode)
    ? [
      'Use the uploaded reference image(s) as the visual base for image-to-image creation.',
      'When multiple reference images are supplied, blend their requested subjects, composition cues, materials and style direction into one coherent image.',
      'Keep the reference image identity, main subject, composition, camera perspective and important visual anchors unless the Chinese prompt clearly asks to change them.',
      'Generate one complete polished image, not a UI screenshot, not a parameter panel, not a collage.',
    ]
    : [
      'Generate one complete polished image directly from the Chinese text prompt.',
      'Do not render an API playground, parameter panel, app UI, watermark, logo or caption unless the user explicitly asks for visible text.',
    ];
  const variation = freeImageCountForJob(job) > 1
    ? `This is candidate ${index + 1}; keep the same user direction but make a tasteful visual variation.`
    : '';
  return [
    ...base,
    'Respect Chinese-language details exactly. If the user describes a wedding scene, keep it commercially usable, physically plausible and free of random unreadable text.',
    variation,
    `用户中文描述：${userPrompt || '自由创作一张高级、干净、真实感强的婚礼灵感图片。'}`,
  ].filter(Boolean).join(' ');
}

async function generateFreeImages(job, outputDir, existingImages = []) {
  const total = freeImageCountForJob(job);
  const slots = new Array(total).fill(null);
  for (const item of existingImages) {
    const match = baseGeneratedImageRegex().exec(item.filename || '');
    const idx = match ? Number(match[1]) - 1 : -1;
    if (idx >= 0 && idx < total) slots[idx] = item;
  }

  const { width, height } = parseImageSize(imageSizeFor(job.mode, job));
  const outputFormat = freeImageFormatForApi(job);

  for (let index = 0; index < total; index += 1) {
    if (slots[index]) continue;
    throwIfJobCancelled(job);
    const label = `${isFreeImageToImageMode(job.mode) ? '图生图' : '文生图'} ${index + 1}`;
    updateJob(
      job,
      24 + Math.round(index * (58 / total)),
      `正在生成自由创作图片：${label}（${index}/${total}）`,
      `[free-image] 开始 ${label}`,
    );
    const prompt = promptForFreeImage(job, index);
    const buffer = isFreeImageToImageMode(job.mode)
      ? await requestOpenAIImageEditBufferWithFallback(job, prompt)
      : await requestOpenAIImageGenerationBufferWithFallback(job, prompt);
    if (!buffer || buffer.length < 8192) {
      throw new Error(`接口返回图像数据过小（${buffer?.length || 0}B），疑似被内容审核拦截`);
    }
    const filename = generatedImageFilename(index, job.mode, job);
    await writeGeneratedImage(buffer, path.join(outputDir, filename), width, height, job.mode, outputFormat);
    slots[index] = {
      label,
      url: publicUrl(job.id, filename),
      filename,
      width,
      height,
      downloadUrl: downloadUrl(job.id, filename),
    };
    job.logs.push(`[free-image] 完成 ${label}`);
    job.partialImages = slots.filter(Boolean);
  }

  return slots.filter(Boolean);
}

async function generateFreeMockImages(job, outputDir, existingImages = []) {
  const total = freeImageCountForJob(job);
  const images = [...existingImages];
  const { width, height } = parseImageSize(imageSizeFor(job.mode, job));
  const outputFormat = freeImageFormatForApi(job);

  for (let index = images.length; index < total; index += 1) {
    throwIfJobCancelled(job);
    const label = `${isFreeImageToImageMode(job.mode) ? '图生图' : '文生图'} ${index + 1}`;
    updateJob(job, 24 + Math.round(index * (58 / total)), `演示生成：${label}`, `[mock] ${label}`);
    const filename = generatedImageFilename(index, job.mode, job);
    await writeGeneratedImage(Buffer.from(mockSvg(index, job.mode)), path.join(outputDir, filename), width, height, job.mode, outputFormat);
    recordGeneratedImage(job, images, { label, url: publicUrl(job.id, filename), filename, width, height });
    await wait(220);
  }

  return images;
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

  if (Number(status) === 429 || /上游负载已饱和|负载已饱和|rate\s*limit|too many requests|overload|capacity|busy/i.test(String(text))) {
    return '图片上游通道繁忙或负载已饱和，请稍后重试。';
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
  if (/HTTP\s*429|上游负载已饱和|负载已饱和|rate\s*limit|too many requests|overload|capacity|busy/i.test(text)) {
    return '图片上游通道繁忙或负载已饱和，请稍后重试。';
  }
  if (textLooksLikeHtml(text)) {
    return '上游接口返回了 HTML 错误页，不是图片接口响应。请检查 API 域名、代理线路或上游服务状态。';
  }
  if (/401|unauthori[sz]ed|令牌状态不可用|invalid\s+(api\s*)?(key|token)|api\s*key.*invalid|token.*invalid/i.test(text)) {
    return '图片生成接口令牌不可用，请联系运营检查或更换图片 API Key';
  }
  return text.replace(/\s+/g, ' ').slice(0, 500) || '生成失败';
}

function isNonResumableGenerationError(message = '') {
  return /Cloudflare|拒绝访问|HTML 错误页|不是图片接口响应|API 域名|上游服务状态|内容审核拦截|返回图像数据过小/i.test(String(message || ''));
}

function isTransientImageApiError(error) {
  if (isJobCancelledError(error)) return false;
  const status = Number(error?.status || 0);
  if (status === 408 || status === 409 || status === 425 || status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  return /timeout|timed out|fetch failed|ECONNRESET|CONNECT_TIMEOUT|ETIMEDOUT|ENETUNREACH|UND_ERR|socket hang up|network|上游负载已饱和|负载已饱和|rate\s*limit|too many requests|overload|capacity|busy/i
    .test(`${error?.message || ''} ${error?.body || ''} ${describeFetchError(error)}`);
}

async function requestImageApiWithTransientRetries({
  job,
  context,
  requestTimeout,
  createFetchArgs,
  parseResponse,
}) {
  const delays = [0, 3000, 8000, 15000];
  let lastError = null;

  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (job) throwIfJobCancelled(job);
    if (delays[attempt]) await wait(delays[attempt]);
    if (job) throwIfJobCancelled(job);

    try {
      const { url, options } = createFetchArgs();
      const response = await fetch(url, {
        ...options,
        signal: job ? signalForJob(job, requestTimeout) : AbortSignal.timeout(requestTimeout),
      });
      return await parseResponse(response);
    } catch (error) {
      if (isJobCancelledError(error)) throw error;
      lastError = error;
      if (attempt >= delays.length - 1 || !isTransientImageApiError(error)) throw error;
      const nextDelay = delays[attempt + 1];
      if (job?.logs) {
        job.logs.push(`[image-api-retry] ${context} 短时繁忙，${Math.round(nextDelay / 1000)} 秒后重试 ${attempt + 2}/${delays.length}`);
      }
    }
  }

  throw lastError || new Error(`${context} request failed`);
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

const GEMINI_IMAGE_ASPECT_RATIOS = [
  '1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4',
  '9:16', '16:9', '21:9', '9:21', '1:4', '4:1', '1:8', '8:1',
];

function closestGeminiAspectRatio(width, height) {
  const ratio = Math.max(1, Number(width) || 1) / Math.max(1, Number(height) || 1);
  let best = '1:1';
  let bestDiff = Infinity;
  for (const item of GEMINI_IMAGE_ASPECT_RATIOS) {
    const [w, h] = item.split(':').map(Number);
    const diff = Math.abs(Math.log(ratio / (w / h)));
    if (diff < bestDiff) {
      best = item;
      bestDiff = diff;
    }
  }
  return best;
}

function geminiGenerateContentEndpoint(model = GEMINI_IMAGE_MODEL) {
  if (GEMINI_IMAGE_ENDPOINT) return GEMINI_IMAGE_ENDPOINT;
  const modelId = String(model || GEMINI_IMAGE_MODEL).replace(/^models\//, '');
  return `${GEMINI_API_BASE}/models/${encodeURIComponent(modelId)}:generateContent`;
}

function geminiImageBufferFromResponse(payload) {
  const direct = payload?.output_image || payload?.outputImage;
  if (direct?.data) return Buffer.from(stripDataUrl(String(direct.data)), 'base64');

  const modelImages = [];
  for (const candidate of Array.isArray(payload?.candidates) ? payload.candidates : []) {
    for (const part of Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []) {
      if (part?.thought) continue;
      const inline = part?.inlineData || part?.inline_data;
      if (inline?.data && /^image\//i.test(String(inline.mimeType || inline.mime_type || 'image/png'))) {
        modelImages.push(inline.data);
      }
    }
  }
  for (const step of Array.isArray(payload?.steps) ? payload.steps : []) {
    if (step?.type !== 'model_output') continue;
    for (const block of Array.isArray(step.content) ? step.content : []) {
      if (block?.type === 'image' && block.data) modelImages.push(block.data);
    }
  }
  if (modelImages.length) return Buffer.from(stripDataUrl(String(modelImages.at(-1))), 'base64');

  const discovered = [];
  const stack = [payload];
  const seen = new Set();
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (value.type === 'image' && value.data) discovered.push(value.data);
    if ((value.inlineData || value.inline_data)?.data) discovered.push((value.inlineData || value.inline_data).data);
    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') stack.push(child);
    }
  }
  if (discovered.length) return Buffer.from(stripDataUrl(String(discovered.at(-1))), 'base64');

  throw new Error('Gemini image response did not contain image data');
}

async function requestGeminiImageEnhanceBuffer(job, prompt) {
  throwIfJobCancelled(job);
  if (!HAS_GEMINI_KEY) throw new Error('GEMINI_API_KEY is required for Gemini image enhancement');
  const requestTimeout = imageRequestTimeoutFor(job);
  const reference = job?.reference;
  if (!reference?.buffer) throw new Error('Gemini image enhancement is missing a reference image');
  const imageSize = normalizeImageEnhanceSize(job?.imageEnhanceSize);
  const target = job?.imageEnhanceTarget || imageEnhanceTargetSize(reference.width, reference.height, imageSize);
  const model = IMAGE_ENHANCE_MODEL || GEMINI_IMAGE_MODEL;
  const payload = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: reference.mimetype || 'image/jpeg',
              data: reference.buffer.toString('base64'),
            },
          },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      responseFormat: {
        image: {
          aspectRatio: closestGeminiAspectRatio(target.width, target.height),
          imageSize,
        },
      },
    },
  };

  const response = await fetch(geminiGenerateContentEndpoint(model), {
    method: 'POST',
    headers: {
      'x-goog-api-key': GEMINI_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
    signal: signalForJob(job, requestTimeout),
  });

  throwIfJobCancelled(job);

  if (!response.ok) {
    const { contentType, text, payload: errorPayload } = await readUpstreamResponse(response);
    const message = summarizeImageApiError({
      context: 'Gemini image enhancement',
      status: response.status,
      contentType,
      text,
      payload: errorPayload,
    });
    const error = new Error(`Gemini image enhancement failed (HTTP ${response.status}): ${message}`);
    error.status = response.status;
    error.body = text;
    throw error;
  }

  const payloadJson = await response.json().catch(() => null);
  if (!payloadJson) throw new Error('Gemini image enhancement did not return JSON');
  return geminiImageBufferFromResponse(payloadJson);
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

async function requestXiaojiGenerationImageBuffer(job, prompt, model = XIAOJI_IMAGE_MODEL) {
  throw new Error('Xiaoji/baziapi image interface is disabled');
  throwIfJobCancelled(job);
  const references = getReferenceInputs(job);
  const body = {
    model,
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
    job.logs.push(`[retry] 图片接口连接不稳定，${Math.round(delay / 1000)} 秒后自动重试 ${attempt + 1}/${maxAttempts}：${message}`);
  }, job);

  return readImageApiResponse(response, 'Image generation API', job);
}

async function requestXiaojiEditImageBuffer(job, prompt, model = XIAOJI_IMAGE_MODEL) {
  throw new Error('Xiaoji/baziapi image interface is disabled');
  throwIfJobCancelled(job);
  const references = getImageEditInputs(job);

  const response = await fetchWithRetries(() => {
    const form = new FormData();

    form.append('model', model);
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
    job.logs.push(`[retry] 图片接口连接不稳定，${Math.round(delay / 1000)} 秒后自动重试 ${attempt + 1}/${maxAttempts}：${message}`);
  }, job);

  return readImageApiResponse(response, 'Image edit API', job);
}

async function requestXiaojiImageBuffer(job, prompt, model = XIAOJI_IMAGE_MODEL) {
  if (isStrictReferenceEditMode(job?.mode)) {
    const label = MODE_LABELS[job?.mode] || job?.mode || '当前模式';
    if (job?.logs) job.logs.push(`[xiaoji] ${label}强制使用 images.edits 参考图编辑通道，避免 generations 弱参考跑偏`);
    return requestXiaojiEditImageBuffer(job, prompt, model);
  }
  if (XIAOJI_IMAGE_INPUT_MODE === 'edit') {
    return requestXiaojiEditImageBuffer(job, prompt, model);
  }

  return requestXiaojiGenerationImageBuffer(job, prompt, model);
}

async function requestXiaojiImageBufferWithFallback(job, prompt) {
  return requestImageBufferWithModelFallback({
    job,
    prompt,
    providerLabel: 'xiaoji',
    models: XIAOJI_IMAGE_MODELS,
    request: (model) => requestXiaojiImageBuffer(job, prompt, model),
  });
}

async function generateWithXiaoji(job, outputDir, existingImages = []) {
  const shots = SHOT_PLANS[job.mode];
  const images = [...existingImages];

  for (let index = images.length; index < shots.length; index += 1) {
    throwIfJobCancelled(job);
    const [label, shotPrompt] = shots[index];
    const total = shots.length;
    const attachedReferenceCount = isStrictReferenceEditMode(job?.mode)
      ? getImageEditInputs(job).length
      : getReferenceInputs(job).length;
    updateJob(
      job,
      22 + Math.round(index * (58 / total)),
      `正在生成：${label}`,
      `[xiaoji:${XIAOJI_IMAGE_INPUT_MODE}] ${index + 1}/${total} ${label}，已附带 ${attachedReferenceCount} 张参考图`,
    );

    const buffer = await requestXiaojiImageBufferWithFallback(job, promptFor(job.mode, label, shotPrompt, job));
    throwIfJobCancelled(job);
    const filename = generatedImageFilename(index, job.mode);
    const { width, height } = parseImageSize(imageSizeFor(job.mode, job));
    await writeGeneratedImage(buffer, path.join(outputDir, filename), width, height, job.mode);
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
    product_matrix: ['#17120f', '#f0c2b5', '#d4b46e', '#fff7ed'],
    handdrawn_plan: ['#3b2f24', '#f4d7aa', '#7da46d', '#fff7ed'],
    outdoor_handdrawn_plan: ['#eef4e8', '#f0cf8a', '#7da46d', '#fffdf6'],
    construction_checklist: ['#181613', '#d6a56b', '#f4eadf', '#9fb4c7'],
    detail_grid: ['#111113', '#d6a56b', '#f0c2b5', '#a7d8ff'],
    setup_process_grid: ['#15110f', '#a78bfa', '#d4b46e', '#f8fafc'],
    photo_area_setup_grid: ['#121417', '#f0c2b5', '#d4b46e', '#b8f3ff'],
  }[mode] || ['#171016', '#f0c2b5', '#d4b46e', '#7dd3fc'];
  const [bg, rose, gold, accent] = palettes;
  const shift = index * 41;

  if (isSetupProcessGridMode(mode)) {
    const photoArea = isPhotoAreaSetupGridMode(mode);
    const steps = photoArea
      ? ['空区基础', '背景进场', '框架定位', '迎宾牌位', '花艺安装', '道具摆放', '灯光调试', '现场微调', '留影完工']
      : ['空场基础', '框架进场', '背景灯光', '灯光调试', '花艺搭建', '舞台成型', '通道铺设', '现场微调', '完工效果'];
    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="1536" height="864" viewBox="0 0 1536 864">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="${bg}"/>
            <stop offset="0.55" stop-color="#2a1d2f"/>
            <stop offset="1" stop-color="#0e1016"/>
          </linearGradient>
          <radialGradient id="flower" cx="50%" cy="50%" r="50%">
            <stop offset="0" stop-color="#fff7ed"/>
            <stop offset="0.48" stop-color="${rose}"/>
            <stop offset="1" stop-color="${accent}"/>
          </radialGradient>
        </defs>
        <rect width="1536" height="864" fill="url(#bg)"/>
        ${steps.map((step, i) => {
          const cellW = 512;
          const cellH = 288;
          const x = (i % 3) * cellW;
          const y = Math.floor(i / 3) * cellH;
          const progress = (i + 1) / steps.length;
          return `
            <g transform="translate(${x},${y})">
              <rect x="0" y="0" width="${cellW}" height="${cellH}" fill="${i === 0 ? '#2b2d33' : bg}" opacity="${0.42 + progress * 0.36}"/>
              <path d="${photoArea ? `M92 ${224 - i * 5} H420` : `M70 ${230 - i * 7} C180 ${185 - i * 8}, 310 ${205 - i * 9}, 450 ${160 - i * 5}`}" fill="none" stroke="${gold}" stroke-width="${6 + i}" opacity="${0.22 + progress * 0.52}"/>
              <rect x="${photoArea ? 138 : 116}" y="${photoArea ? 72 : 88 - Math.min(i, 5) * 6}" width="${photoArea ? 236 : 280}" height="${photoArea ? 152 : 130}" rx="10" fill="${i < 2 ? '#4b5563' : (photoArea ? '#315c66' : '#6d5ca8')}" opacity="${0.16 + progress * 0.38}"/>
              ${Array.from({ length: Math.min(3 + i, 10) }, (_, j) => {
                const fx = 70 + ((j * 61 + i * 23) % 380);
                const fy = 190 - ((j * 29 + i * 17) % 94);
                const r = 12 + ((j + i) % 4) * 4;
                return `<circle cx="${fx}" cy="${fy}" r="${r}" fill="url(#flower)" opacity="${0.42 + progress * 0.44}"/>`;
              }).join('')}
              ${i > 2 ? `<path d="M130 220 L190 92 M382 220 L318 96" stroke="#f8fafc" stroke-width="2" opacity="${0.2 + progress * 0.36}"/>` : ''}
              <rect x="0" y="0" width="${cellW}" height="${cellH}" fill="none" stroke="#fff" stroke-width="4" opacity="0.9"/>
              <rect x="18" y="18" width="126" height="34" rx="17" fill="rgba(255,255,255,0.78)"/>
              <text x="36" y="41" fill="#17120f" font-size="18" font-weight="900" font-family="Microsoft YaHei, sans-serif">${String(i + 1).padStart(2, '0')} ${escapeSvgText(step)}</text>
            </g>
          `;
        }).join('')}
      </svg>
    `;
  }

  if (mode === 'construction_checklist') {
    const titles = ['主视觉落地效果', '平立面技术视图', '物料清单展示', '搭建步骤灯光图'];
    const title = titles[index] || '施工清单分区';
    const cells = index === 2 ? 8 : (index === 3 ? 6 : 3);
    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="1536" height="864" viewBox="0 0 1536 864">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#fff9f2"/>
            <stop offset="1" stop-color="#eadfD2"/>
          </linearGradient>
          <linearGradient id="scene" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="${bg}"/>
            <stop offset="0.55" stop-color="${rose}"/>
            <stop offset="1" stop-color="${gold}"/>
          </linearGradient>
        </defs>
        <rect width="1536" height="864" fill="url(#bg)"/>
        <rect x="42" y="42" width="1452" height="780" rx="28" fill="#fffdf9" stroke="#c8b5a1" stroke-width="3"/>
        <text x="88" y="112" fill="#261c18" font-size="46" font-weight="900" font-family="Microsoft YaHei, sans-serif">${escapeSvgText(title)}</text>
        ${index === 0 ? `
          <rect x="108" y="176" width="1320" height="560" rx="24" fill="url(#scene)"/>
          <path d="M250 660 L536 330 H1000 L1288 660 Z" fill="#130f12" opacity="0.7"/>
          <path d="M430 640 C500 360 1030 360 1102 640" fill="none" stroke="#fff7ed" stroke-width="34" stroke-linecap="round" opacity="0.84"/>
          ${Array.from({ length: 42 }, (_, i) => `<circle cx="${260 + (i * 73) % 1010}" cy="${530 + ((i * 29) % 160)}" r="${12 + (i % 5) * 5}" fill="${i % 2 ? rose : '#fff7ed'}" opacity="0.9"/>`).join('')}
        ` : `
          ${Array.from({ length: cells }, (_, i) => {
            const cols = index === 2 ? 4 : 3;
            const x = 100 + (i % cols) * (1328 / cols);
            const y = 180 + Math.floor(i / cols) * (index === 2 ? 250 : 190);
            const w = 1328 / cols - 28;
            const h = index === 2 ? 208 : 154;
            return `
              <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="${i % 2 ? '#f0e2d4' : '#211816'}" opacity="${i % 2 ? 1 : 0.88}"/>
              <path d="M${x + 44} ${y + h - 34} C${x + w * 0.35} ${y + 34}, ${x + w * 0.62} ${y + 34}, ${x + w - 40} ${y + h - 34}" fill="none" stroke="${i % 2 ? rose : gold}" stroke-width="${8 + (i % 3) * 4}" opacity="0.78"/>
              <circle cx="${x + w * 0.28}" cy="${y + h * 0.62}" r="24" fill="${rose}" opacity="0.84"/>
              <circle cx="${x + w * 0.50}" cy="${y + h * 0.48}" r="18" fill="#fff7ed" opacity="0.78"/>
              <circle cx="${x + w * 0.70}" cy="${y + h * 0.64}" r="22" fill="${gold}" opacity="0.72"/>
            `;
          }).join('')}
        `}
      </svg>
    `;
  }

  if (isPlanResourceMode(mode)) {
    const planTitle = {
      product_matrix: '方案施工矩阵',
      handdrawn_plan: '手绘方案推演',
      outdoor_handdrawn_plan: '户外手绘提案',
      construction_checklist: '落地施工清单',
      detail_grid: '九宫格细节图',
    }[mode] || '方案图';
    const planSub = {
      product_matrix: '效果视图 · 物料拆解 · 搭建步骤',
      handdrawn_plan: '手绘效果 · 平面推演 · 材质色卡',
      outdoor_handdrawn_plan: '户外花园 · 小清新 · 手绘方案',
      construction_checklist: '尺寸示意 · 物料清单 · 搭建步骤',
      detail_grid: '全景 · 花艺 · 灯光 · 材质细节',
    }[mode] || '方案沟通 · 施工交底';
    const labels = {
      product_matrix: ['整体效果', '技术视图', '物料网格', '施工步骤'],
      handdrawn_plan: ['手绘效果', '平面布局', '立面推演', '材质色卡'],
      outdoor_handdrawn_plan: ['花园主景', '户外动线', '花材色卡', '清新细节'],
      construction_checklist: ['整体效果', '尺寸示意', '物料清单', '搭建步骤'],
      detail_grid: ['全景通道', '花艺局部', '灯光道具', '桌椅材质'],
    }[mode] || ['整体效果', '技术视图', '物料网格', '施工步骤'];
    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="1088" height="1440" viewBox="0 0 1088 1440">
        <defs>
          <linearGradient id="posterBg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#fff8f4"/>
            <stop offset="0.52" stop-color="#f7ede7"/>
            <stop offset="1" stop-color="#ede1d7"/>
          </linearGradient>
          <linearGradient id="photo" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="${rose}"/>
            <stop offset="1" stop-color="${gold}"/>
          </linearGradient>
          <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="18" stdDeviation="24" flood-color="#3a2722" flood-opacity="0.16"/>
          </filter>
        </defs>
        <rect width="1088" height="1440" fill="url(#posterBg)"/>
        <rect x="66" y="70" width="956" height="300" rx="28" fill="${bg}" filter="url(#softShadow)"/>
        <rect x="92" y="96" width="312" height="248" rx="22" fill="url(#photo)" opacity="0.95"/>
        <path d="M154 286C212 180 290 180 350 286" fill="none" stroke="#fff7ed" stroke-width="18" stroke-linecap="round" opacity="0.88"/>
        <circle cx="210" cy="260" r="22" fill="#fff7ed" opacity="0.78"/>
        <circle cx="262" cy="236" r="18" fill="#fff7ed" opacity="0.72"/>
        <circle cx="316" cy="266" r="24" fill="#fff7ed" opacity="0.78"/>
        <text x="456" y="162" fill="#fff7ed" font-size="52" font-weight="800" font-family="Microsoft YaHei, PingFang SC, sans-serif">${escapeSvgText(planTitle)}</text>
        <text x="456" y="222" fill="#f8d8c8" font-size="28" font-weight="700" font-family="Microsoft YaHei, PingFang SC, sans-serif">${escapeSvgText(planSub)}</text>
        <rect x="456" y="272" width="430" height="18" rx="9" fill="#fff7ed" opacity="0.38"/>
        <rect x="456" y="306" width="300" height="14" rx="7" fill="#fff7ed" opacity="0.22"/>
        ${Array.from({ length: 4 }, (_, i) => {
          const x = 66 + (i % 2) * 486;
          const y = 430 + Math.floor(i / 2) * 344;
          return `
            <g filter="url(#softShadow)">
              <rect x="${x}" y="${y}" width="470" height="300" rx="24" fill="#fffdfb"/>
              <rect x="${x + 22}" y="${y + 24}" width="426" height="104" rx="18" fill="${i % 2 ? '#f7e8df' : '#f3d6c9'}"/>
              <circle cx="${x + 74}" cy="${y + 76}" r="30" fill="${i % 2 ? gold : rose}" opacity="0.72"/>
              <path d="M${x + 122} ${y + 92}C${x + 168} ${y + 42} ${x + 260} ${y + 42} ${x + 314} ${y + 92}" fill="none" stroke="#6b3f37" stroke-width="10" stroke-linecap="round" opacity="0.42"/>
              <text x="${x + 26}" y="${y + 176}" fill="#17120f" font-size="30" font-weight="800" font-family="Microsoft YaHei, PingFang SC, sans-serif">${labels[i]}</text>
              <rect x="${x + 26}" y="${y + 208}" width="330" height="16" rx="8" fill="#3a2722" opacity="0.16"/>
              <rect x="${x + 26}" y="${y + 238}" width="260" height="14" rx="7" fill="#3a2722" opacity="0.1"/>
              <rect x="${x + 360}" y="${y + 210}" width="62" height="44" rx="14" fill="#17120f" opacity="0.88"/>
            </g>
          `;
        }).join('')}
        <rect x="66" y="1158" width="956" height="172" rx="28" fill="${bg}" opacity="0.94" filter="url(#softShadow)"/>
        <text x="112" y="1238" fill="#fff7ed" font-size="32" font-weight="800" font-family="Microsoft YaHei, PingFang SC, sans-serif">适合提案沟通、施工交底和套餐说明</text>
        <rect x="112" y="1278" width="612" height="16" rx="8" fill="#fff7ed" opacity="0.26"/>
      </svg>
    `;
  }

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
    const filename = generatedImageFilename(index, job.mode);
    const { width, height } = parseImageSize(imageSizeFor(job.mode, job));
    await writeGeneratedImage(Buffer.from(mockSvg(index, job.mode)), path.join(outputDir, filename), width, height, job.mode);
    recordGeneratedImage(job, images, { label, url: publicUrl(job.id, filename), filename, width, height });
    await new Promise((resolve) => setTimeout(resolve, 220));
  }

  return images;
}

function localDecorBalloon(cx, cy, rx, ry, gradientId, opacity = 0.96) {
  return `<g opacity="${opacity}">
    <ellipse cx="${cx + rx * 0.08}" cy="${cy + ry * 0.12}" rx="${rx}" ry="${ry}" fill="rgba(0,0,0,0.16)" filter="url(#soft)"/>
    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#${gradientId})"/>
    <ellipse cx="${cx - rx * 0.32}" cy="${cy - ry * 0.34}" rx="${rx * 0.22}" ry="${ry * 0.16}" fill="rgba(255,255,255,0.58)"/>
    <path d="M${cx - 4} ${cy + ry * 0.88} L${cx + 4} ${cy + ry * 0.88} L${cx} ${cy + ry * 1.05}Z" fill="rgba(80,60,60,0.28)"/>
  </g>`;
}

function localDecorLeaf(cx, cy, size, rotation = 0) {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${size * 0.18}" ry="${size * 0.52}" fill="#6b8f62" opacity="0.78" transform="rotate(${rotation} ${cx} ${cy})"/>`;
}

function localDecorFlower(cx, cy, size, fill, center = '#f5c35c') {
  const petals = Array.from({ length: 7 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 7;
    const px = cx + Math.cos(angle) * size * 0.35;
    const py = cy + Math.sin(angle) * size * 0.28;
    return `<ellipse cx="${px}" cy="${py}" rx="${size * 0.22}" ry="${size * 0.34}" fill="${fill}" transform="rotate(${(angle * 180 / Math.PI) + 25} ${px} ${py})"/>`;
  }).join('');
  return `<g opacity="0.96" filter="url(#tinyShadow)">${petals}<circle cx="${cx}" cy="${cy}" r="${size * 0.16}" fill="${center}"/></g>`;
}

function localDecorFlowerCluster(points) {
  const colors = ['#f7b7c8', '#f3d5d7', '#fff7ef', '#f0a3b4', '#f7d95a', '#e9a8cc'];
  return points.map((point, index) => {
    const [x, y, size] = point;
    return `${localDecorLeaf(x - 8, y + 5, size, -45)}${localDecorLeaf(x + 10, y + 8, size * 0.9, 38)}${localDecorFlower(x, y, size, colors[index % colors.length])}`;
  }).join('');
}

function localPartialWeddingEditOverlaySvg(width, height, variant = 1) {
  const defs = `
    <defs>
      <filter id="soft"><feGaussianBlur stdDeviation="5"/></filter>
      <filter id="tinyShadow"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity="0.20"/></filter>
      <radialGradient id="pink" cx="32%" cy="28%" r="72%"><stop offset="0" stop-color="#ffe1eb"/><stop offset="0.62" stop-color="#f58cac"/><stop offset="1" stop-color="#c95679"/></radialGradient>
      <radialGradient id="rose" cx="30%" cy="25%" r="74%"><stop offset="0" stop-color="#ffd9e3"/><stop offset="0.68" stop-color="#e74778"/><stop offset="1" stop-color="#aa3159"/></radialGradient>
      <radialGradient id="blue" cx="30%" cy="25%" r="74%"><stop offset="0" stop-color="#e7f8ff"/><stop offset="0.65" stop-color="#8ecce5"/><stop offset="1" stop-color="#4c93b4"/></radialGradient>
      <radialGradient id="purple" cx="30%" cy="25%" r="74%"><stop offset="0" stop-color="#eadcff"/><stop offset="0.65" stop-color="#a379d7"/><stop offset="1" stop-color="#6c4aa6"/></radialGradient>
      <radialGradient id="yellow" cx="30%" cy="25%" r="74%"><stop offset="0" stop-color="#fff6a7"/><stop offset="0.62" stop-color="#f2cf2b"/><stop offset="1" stop-color="#d29c00"/></radialGradient>
      <radialGradient id="green" cx="30%" cy="25%" r="74%"><stop offset="0" stop-color="#d6ffd9"/><stop offset="0.66" stop-color="#54c35c"/><stop offset="1" stop-color="#2f8d35"/></radialGradient>
      <radialGradient id="orange" cx="30%" cy="25%" r="74%"><stop offset="0" stop-color="#ffe8bd"/><stop offset="0.65" stop-color="#f59a32"/><stop offset="1" stop-color="#c96a11"/></radialGradient>
      <radialGradient id="white" cx="30%" cy="25%" r="76%"><stop offset="0" stop-color="#ffffff"/><stop offset="0.7" stop-color="#f5edf0"/><stop offset="1" stop-color="#d7c8cf"/></radialGradient>
    </defs>`;
  const rightX = variant === 1 ? width * 0.89 : width * 0.86;
  const rightY = variant === 1 ? height * 0.37 : height * 0.42;
  const right = [
    localDecorBalloon(rightX + 26, rightY - 75, 35, 38, 'purple'),
    localDecorBalloon(rightX + 70, rightY - 52, 32, 35, 'blue'),
    localDecorBalloon(rightX + 18, rightY - 28, 33, 36, 'rose'),
    localDecorBalloon(rightX + 57, rightY - 8, 29, 32, 'pink'),
    localDecorBalloon(rightX + 87, rightY + 24, 34, 37, 'white'),
    localDecorBalloon(rightX + 23, rightY + 42, 35, 38, 'blue'),
    localDecorBalloon(rightX + 62, rightY + 70, 37, 40, 'yellow'),
    localDecorBalloon(rightX + 3, rightY + 93, 27, 30, 'purple'),
    localDecorBalloon(rightX + 90, rightY + 110, 42, 45, 'pink'),
    localDecorBalloon(rightX + 42, rightY + 130, 31, 34, 'orange'),
    localDecorBalloon(rightX + 82, rightY + 155, 34, 36, 'yellow'),
  ].join('');
  const bottomY = height * (variant === 1 ? 0.77 : 0.81);
  const bottom = [
    localDecorBalloon(width * 0.63, bottomY + 5, 28, 30, 'pink'),
    localDecorBalloon(width * 0.68, bottomY + 28, 35, 37, 'blue'),
    localDecorBalloon(width * 0.73, bottomY + 12, 39, 41, 'yellow'),
    localDecorBalloon(width * 0.79, bottomY + 32, 33, 35, 'green'),
    localDecorBalloon(width * 0.84, bottomY + 4, 42, 45, 'pink'),
    localDecorBalloon(width * 0.91, bottomY + 28, 47, 50, 'purple'),
    localDecorBalloon(width * 0.96, bottomY - 8, 31, 34, 'orange'),
  ].join('');
  const flowerPoints = [
    [width * 0.58, height * 0.77, 28],
    [width * 0.62, height * 0.73, 24],
    [width * 0.66, height * 0.78, 30],
    [width * 0.71, height * 0.75, 24],
    [width * 0.75, height * 0.79, 28],
    [width * 0.81, height * 0.76, 26],
    [width * 0.86, height * 0.72, 25],
    [width * 0.90, height * 0.76, 27],
    [width * 0.94, height * 0.73, 23],
    [rightX + 20, rightY + 175, 24],
    [rightX + 55, rightY + 184, 22],
    [rightX + 88, rightY + 177, 24],
  ];
  const accent = variant === 2
    ? `${localDecorBalloon(width * 0.08, height * 0.67, 35, 38, 'pink')}${localDecorBalloon(width * 0.12, height * 0.71, 29, 31, 'white')}${localDecorFlowerCluster([[width * 0.10, height * 0.78, 26], [width * 0.14, height * 0.76, 22], [width * 0.17, height * 0.81, 25]])}`
    : '';
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${defs}
    <ellipse cx="${width * 0.79}" cy="${height * 0.86}" rx="${width * 0.24}" ry="${height * 0.035}" fill="rgba(0,0,0,0.18)" filter="url(#soft)"/>
    <path d="M${width * 0.55} ${height * 0.77} C${width * 0.66} ${height * 0.69}, ${width * 0.82} ${height * 0.67}, ${width * 0.97} ${height * 0.75}" fill="none" stroke="#6b8f62" stroke-width="5" opacity="0.45"/>
    ${bottom}${right}${localDecorFlowerCluster(flowerPoints)}${accent}
  </svg>`;
}

async function generateLocalPartialWeddingEdit(job, outputDir, existingImages = []) {
  const shots = SHOT_PLANS[job.mode] || [];
  const images = [...existingImages];
  const baseReference = getReferenceInput(job);
  const metadata = await sharp(baseReference.buffer).metadata();
  const width = metadata.width || parseImageSize(imageSizeFor(job.mode, job)).width;
  const height = metadata.height || parseImageSize(imageSizeFor(job.mode, job)).height;

  for (let index = images.length; index < shots.length; index += 1) {
    throwIfJobCancelled(job);
    const [label] = shots[index];
    updateJob(job, 22 + Math.round(index * (58 / Math.max(1, shots.length))), `正在生成：${label}`, `[partial-local] 锁定原图局部合成 ${index + 1}/${shots.length}`);
    const filename = `image-${index + 1}.jpg`;
    const overlay = Buffer.from(localPartialWeddingEditOverlaySvg(width, height, index + 1));
    await sharp(baseReference.buffer)
      .composite([{ input: overlay, left: 0, top: 0 }])
      .jpeg({ quality: FINAL_IMAGE_JPEG_QUALITY, mozjpeg: true, chromaSubsampling: '4:4:4' })
      .toFile(path.join(outputDir, filename));
    recordGeneratedImage(job, images, { label, url: publicUrl(job.id, filename), filename, width, height });
  }

  return images;
}

function safeMotionSourceFilename(filename = 'motion-source.jpg') {
  const value = path.basename(String(filename || 'motion-source.jpg'));
  if (/^motion-(source|reference-\d+)\.(jpg|jpeg|png|webp|gif|heic|heif|avif)$/i.test(value)) return value;
  if (/^motion-video-\d+\.(mp4|mov|webm|m4v|avi)$/i.test(value)) return value;
  if (/^motion-audio-\d+\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(value)) return value;
  return 'motion-source.jpg';
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
  const safeFilename = safeMotionSourceFilename(filename);
  const token = signMotionSourceToken(job.id, safeFilename);
  const path = `/api/motion/source/${token}/${encodeURIComponent(safeFilename)}`;
  const publicBaseUrl = currentPublicBaseUrl();
  if (publicBaseUrl) return `${publicBaseUrl}${path}`;
  // 兜底：本地无公网时尝试拼 localhost（n1n 大概率拉不到，仅供本地调试日志）
  return `http://127.0.0.1:${PORT}${path}`;
}

function resolvePublicSourceUrl(job) {
  return resolvePublicMotionFileUrl(job, 'motion-source.jpg');
}

async function ensureMotionPublicReferencesReachable(urls = [], job = null) {
  if (!MOTION_VIDEO_IS_N1N_UNIFIED && !MOTION_VIDEO_IS_XIAOJI && !MOTION_VIDEO_IS_PRO666) return;
  const referenceUrls = urls.filter(Boolean);
  if (!referenceUrls.length) {
    throw new Error('Motion reference public URL was not generated. Check PUBLIC_BASE_URL.');
  }
  for (const [index, url] of referenceUrls.entries()) {
    let lastError = null;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: { Accept: 'image/*,video/*,audio/*,*/*;q=0.8' },
          signal: AbortSignal.timeout(20_000),
        });
        const contentType = response.headers.get('content-type') || '';
        const contentLength = Number(response.headers.get('content-length') || 0);
        if (!response.ok || /text\/html/i.test(contentType)) {
          throw new Error(`HTTP ${response.status}${contentType ? ` ${contentType}` : ''}`);
        }
        if (contentLength > 0 && contentLength < 1024) {
          throw new Error(`media response too small (${contentLength} bytes)`);
        }
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 4) {
          job?.logs?.push(`[motion] public reference ${index + 1} check retry ${attempt}/4: ${String(error?.message || error).slice(0, 120)}`);
          await wait(1200 * attempt);
        }
      }
    }
    if (lastError) {
      throw new Error(`Motion reference ${index + 1} is not publicly reachable: ${url}; ${lastError?.message || lastError}`);
    }
  }
  job?.logs?.push(`[motion] PUBLIC_BASE_URL media check passed for ${referenceUrls.length} reference(s)`);
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
    const upstreamModels = (Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload) ? payload : []))
      .map((item) => String(item?.id || item?.model || item?.name || '').trim())
      .filter(Boolean);
    if (upstreamModels.length && MOTION_VIDEO_REQUEST_MODEL && !upstreamModels.includes(MOTION_VIDEO_REQUEST_MODEL)) {
      const relatedModels = upstreamModels.filter((id) => /veo|video|components?|vip/i.test(id)).slice(0, 8);
      const message = `视频接口当前分组未开放模型 ${MOTION_VIDEO_REQUEST_MODEL}，请在上游后台切到包含该模型的分组/Key，或改用可用模型：${relatedModels.join(', ') || upstreamModels.slice(0, 5).join(', ')}`;
      motionVideoServicePreflight = {
        checkedAt: now,
        ok: false,
        status: 503,
        message,
      };
      throw motionVideoPreflightError(message, 503);
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
    job.logs.push(`[motion-guard] 已生成 ${sourceImages.length} 图参考图视觉约束`);
    return `UPLOADED REFERENCE VISUAL LOCK (HIGH PRIORITY): ${guard}`;
  } catch (error) {
    job.logs.push(`[motion-guard] 参考图视觉约束生成失败，使用基础约束：${error?.message || 'unknown error'}`);
    return '';
  }
}

async function submitMotionTask({
  prompt,
  imageUrl,
  imageBuffer,
  imageBuffers = [],
  imageUrls = [],
  signal,
  job = null,
  requestModel = MOTION_VIDEO_REQUEST_MODEL,
  durationSeconds = MOTION_VIDEO_DURATION,
  aspectRatio = motionVideoColonAspectRatio(),
  videoUrls = [],
  audioUrls = [],
  generateAudio = false,
}) {
  let body;
  let fallbackJsonBody = null;
  const configuredReferenceCount = (imageUrls.length ? imageUrls : [imageUrl]).filter(Boolean).length
    || (imageBuffers.length ? imageBuffers : [imageBuffer]).filter((buffer) => buffer?.length).length
    || 1;
  requestModel = motionVideoModelForReferenceCount(requestModel, configuredReferenceCount);
  const referenceLimit = motionReferenceLimitForModel(requestModel);
  const referenceBuffers = imageBuffers.length ? imageBuffers.filter((buffer) => buffer?.length).slice(0, referenceLimit) : (imageBuffer?.length ? [imageBuffer] : []);
  const referenceUrls = (imageUrls.length ? imageUrls : [imageUrl]).filter(Boolean).slice(0, referenceLimit);
  const minReferenceCount = motionMinimumReferenceCountForModel(requestModel);
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
  } else if (MOTION_VIDEO_IS_PRO666) {
    const pro666Model = normalizePro666VideoModelName(requestModel);
    const referenceVideoUrls = Array.isArray(videoUrls) ? videoUrls.filter(Boolean).slice(0, PRO666_VIDEO_REFERENCE_VIDEO_LIMIT) : [];
    const referenceAudioUrls = Array.isArray(audioUrls) ? audioUrls.filter(Boolean).slice(0, PRO666_VIDEO_REFERENCE_AUDIO_LIMIT) : [];
    const hasReferences = referenceUrls.length || referenceVideoUrls.length || referenceAudioUrls.length;
    body = {
      model: pro666Model,
      prompt,
      duration: normalizeVideoV1Duration(durationSeconds),
      aspect_ratio: normalizeVideoV1AspectRatio(aspectRatio),
    };
    if (hasReferences) body.mode = 'references';
    if (referenceUrls.length) body.images = referenceUrls;
    if (referenceVideoUrls.length) body.videos = referenceVideoUrls;
    if (referenceAudioUrls.length) body.audios = referenceAudioUrls;
    job?.logs?.push?.(`[motion] pro666 ${pro666VideoModelLabel(pro666Model)} submit JSON images=${referenceUrls.length} videos=${referenceVideoUrls.length} audios=${referenceAudioUrls.length} aspect_ratio=${body.aspect_ratio} duration=${body.duration}`);
  } else if (MOTION_VIDEO_IS_XIAOJI) {
    if (!referenceUrls.length) {
      throw new Error('baziapi Veo interface needs a publicly reachable reference image URL. Check PUBLIC_BASE_URL.');
    }
    if (referenceUrls.length < minReferenceCount) {
      throw new Error(`Current baziapi video model ${requestModel} needs ${minReferenceCount} reference image(s). Upload enough wedding scene references before generating.`);
    }
    const videoSize = motionVideoPixelSize();
    const payload = {
      model: requestModel,
      prompt,
      size: videoSize,
      images: referenceUrls,
    };
    if (motionVideoModelUsesFirstLastFrames(requestModel) && referenceUrls.length < 2) {
      job?.logs?.push?.('[motion] Current model is a first/last-frame model (-fl), but only one image was uploaded.');
    }
    job?.logs?.push?.(`[motion] baziapi submit JSON images=${referenceUrls.length} size=${videoSize}`);
    const response = await fetch(MOTION_VIDEO_ENDPOINT, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify(payload),
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
    const referenceDataUrls = referenceBuffers.map((buffer) => `data:image/jpeg;base64,${buffer.toString('base64')}`);
    const fallbackReferences = referenceDataUrls.length ? referenceDataUrls : [imageUrl].filter(Boolean);
    fallbackJsonBody = {
      model: requestModel,
      prompt,
      seconds: String(MOTION_VIDEO_DURATION || 10),
      size: MOTION_VIDEO_ASPECT_RATIO || '16x9',
      watermark: false,
      image: fallbackReferences[0],
      images: fallbackReferences,
    };
    if (/(^|[/.])llm-api\.net/i.test(MOTION_VIDEO_ENDPOINT)) {
      job?.logs?.push?.(`[motion] submit JSON image/images count=${fallbackReferences.length}`);
      body = fallbackJsonBody;
    } else {
      const form = new FormData();
      form.append('model', requestModel);
      form.append('prompt', prompt);
      form.append('seconds', String(MOTION_VIDEO_DURATION || 10));
      form.append('size', MOTION_VIDEO_ASPECT_RATIO || '16x9');
      form.append('watermark', false);
      referenceBuffers.forEach((buffer, index) => {
        const filename = index === 0 ? 'motion-source.jpg' : `motion-reference-${index + 1}.jpg`;
        form.append('input_reference', new Blob([buffer], { type: 'image/jpeg' }), filename);
      });
      job?.logs?.push?.(`[motion] submit multipart input_reference count=${referenceBuffers.length}`);
      body = form;
    }
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
    const upstreamCountMismatch = /最多支持\s*3\s*张图片[，,]\s*实际收到\s*4|maximum[^\\n]{0,80}3[^\\n]{0,80}(?:got|received|actual)[^\\n]{0,80}4/i
      .test(`${text || ''} ${JSON.stringify(payload || {})}`);
    if (fallbackJsonBody && (textLooksLikeCloudflareBlock(text) || upstreamCountMismatch)) {
      if (job?.logs) {
        job.logs.push(upstreamCountMismatch
          ? `[motion] 上游误判参考图数量，改用 JSON images=${fallbackJsonBody.images?.length || 0} 重新提交`
          : `[motion] input_reference 文件上传被 n1n/WAF 拦截，自动退回 JSON images=${fallbackJsonBody.images?.length || 0} 模式`);
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
  const requestedModel = args.requestModel ? normalizeMotionVideoModelForEndpoint(args.requestModel) : '';
  const models = (requestedModel
    ? [requestedModel, ...MOTION_VIDEO_FALLBACK_MODELS]
    : (MOTION_VIDEO_SUBMIT_MODELS.length ? MOTION_VIDEO_SUBMIT_MODELS : [MOTION_VIDEO_REQUEST_MODEL]))
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
  let lastError = null;
  const referenceCount = (args.imageUrls?.length ? args.imageUrls : [args.imageUrl]).filter(Boolean).length
    || (args.imageBuffers?.length ? args.imageBuffers : [args.imageBuffer]).filter((buffer) => buffer?.length).length
    || 1;

  for (let index = 0; index < models.length; index += 1) {
    const requestModel = motionVideoModelForReferenceCount(models[index], referenceCount);
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

function resolveMotionContentUrl(taskId) {
  return `${MOTION_VIDEO_ENDPOINT.replace(/\/$/, '')}/${encodeURIComponent(taskId)}/content`;
}

function resolveN1nMotionContentUrl(taskId) {
  return resolveMotionContentUrl(taskId);
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function parseMotionTaskInfo(info, taskId) {
  const detail = info?.data || info?.result || info?.output || info?.content || info?.detail || info?.metadata || {};
  const rawStatus = firstPresent(
    detail?.status,
    detail?.task_status,
    detail?.state,
    detail?.status_code,
    info?.status,
    info?.task_status,
    info?.state,
    info?.status_code,
    info?.output?.task_status,
  );
  const status = String(rawStatus || '').toLowerCase();
  const progress = Number(firstPresent(
    detail?.progress,
    detail?.percent,
    detail?.progress_percent,
    info?.progress,
    info?.percent,
    info?.progress_percent,
    info?.output?.progress,
  )) || 0;
  const explicitVideoUrl = (MOTION_VIDEO_IS_ALIBAILIAN ? info?.output?.video_url : null)
    || firstPresent(
      detail?.video_url,
      detail?.videoUrl,
      detail?.url,
      detail?.result_url,
      detail?.download_url,
      detail?.output_url,
      detail?.content_url,
      info?.video_url,
      info?.videoUrl,
      info?.url,
      info?.result_url,
      info?.download_url,
      info?.output_url,
      info?.content_url,
      info?.metadata?.url,
      info?.metadata?.video_url,
      info?.metadata?.download_url,
      info?.content?.video_url,
      info?.detail?.video_url,
    );
  const completedByStatus = status === 'completed'
    || status === 'succeeded'
    || status === 'success'
    || status === 'partial_succeeded'
    || status === 'finished'
    || status === 'done'
    || status === 'complete';
  let videoUrl = explicitVideoUrl || (MOTION_VIDEO_IS_N1N_OPENAI ? resolveN1nMotionContentUrl(taskId) : null);
  if (MOTION_VIDEO_IS_PRO666 && completedByStatus) {
    videoUrl = resolveMotionContentUrl(taskId);
  }
  const completed = completedByStatus || (!status && videoUrl);
  const failed = status === 'failed'
    || status === 'error'
    || status === 'canceled'
    || status === 'cancelled'
    || status === 'failure'
    || info?.error
    || detail?.error
    || info?.output?.code;
  const errorMessage = firstPresent(
    detail?.fail_reason,
    detail?.message,
    detail?.error?.message,
    detail?.error,
    info?.fail_reason,
    info?.output?.message,
    info?.error?.message,
    info?.error,
    info?.message,
  )
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
  let submitFailures = 0;
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
      submitFailures += 1;
      lastSubmitAt = Date.now();
      const message = String(error?.message || error || '');
      const busy = /HTTP 429|负载|饱和|繁忙|capacity|temporar|overload|rate/i.test(message);
      const retrySeconds = Math.max(1, Math.round(MOTION_VIDEO_SUBMIT_RETRY_INTERVAL_MS / 1000));
      const stage = busy
        ? `Veo 通道繁忙，继续排队重试（约 ${retrySeconds} 秒后再试）`
        : '提交视频任务遇到异常，系统正在自动重试';
      updateJob(job, Math.min(34, 25 + Math.min(8, submitFailures)), stage, `[motion] submit retry deferred${reason ? ` (${reason})` : ''}: ${message.slice(0, 180)}`);
      return null;
    }
    submitFailures = 0;
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
    if (Date.now() - startedAt > MOTION_VIDEO_SUBMIT_RETRY_TIMEOUT_MS) {
      throw lastError || new Error(`上游视频通道持续繁忙（>${Math.round(MOTION_VIDEO_SUBMIT_RETRY_TIMEOUT_MS / 1000)}s），请稍后重试`);
    }
    await submitNextTask();
    if (!activeTasks.length) {
      await new Promise((resolve) => setTimeout(resolve, MOTION_VIDEO_SUBMIT_RETRY_INTERVAL_MS));
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
  const needsAuth = (MOTION_VIDEO_IS_N1N_OPENAI || MOTION_VIDEO_IS_PRO666)
    && String(videoUrl).startsWith(MOTION_VIDEO_ENDPOINT.replace(/\/$/, ''));
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
    const nestedUrl = firstPresent(
      data?.video_url,
      data?.videoUrl,
      data?.url,
      data?.result_url,
      data?.download_url,
      data?.output_url,
      data?.content_url,
      data?.data?.video_url,
      data?.data?.videoUrl,
      data?.data?.url,
      data?.data?.download_url,
      data?.data?.content_url,
      data?.result?.video_url,
      data?.result?.videoUrl,
      data?.result?.url,
      data?.output?.video_url,
      data?.output?.videoUrl,
      data?.output?.url,
      data?.metadata?.url,
      data?.metadata?.video_url,
      data?.content?.video_url,
    );
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
async function removeMotionWatermark(videoPath, job, options = {}) {
  const enabled = options.enabled ?? MOTION_WATERMARK_REMOVE;
  if (!enabled) return false;
  const boxTemplate = options.box || MOTION_WATERMARK_BOX;
  const logPrefix = options.logPrefix || 'motion';
  const tmpPath = videoPath.replace(/\.mp4$/i, '') + '.cleaned.mp4';
  const debug = String(process.env.MOTION_WATERMARK_DEBUG ?? 'false').toLowerCase() === 'true';
  // 先探测视频尺寸，再把 W/H 表达式算成纯数字（ffmpeg 6 的 delogo 不接受表达式）
  const size = await probeVideoSize(videoPath);
  const resolvedBox = resolveWatermarkBox(boxTemplate, size);
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
  console.log(`[${logPrefix}] video size=${size ? `${size.width}x${size.height}` : 'unknown'}, box=${resolvedBox}`);
  console.log(`[${logPrefix}] ffmpeg cmd: ${FFMPEG_BIN} ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`);
  try {
    const { stderr } = await execFileAsync(FFMPEG_BIN, args, { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
    if (stderr && stderr.trim()) {
      console.log(`[${logPrefix}] ffmpeg stderr (first 500):\n${stderr.slice(0, 500)}`);
    }
  } catch (error) {
    const stderr = error?.stderr ? `\n--- ffmpeg stderr ---\n${String(error.stderr).slice(0, 1000)}` : '';
    const msg = `${error?.message || error}${stderr}`;
    console.warn(`[${logPrefix}] ffmpeg 去水印失败：${msg}`);
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
  if (!MOTION_VIDEO_VERIFY_VISIBLE_FRAME) {
    job?.logs?.push('[motion] 已跳过本地 ffmpeg 抽帧校验（MOTION_VIDEO_VERIFY_VISIBLE_FRAME=false）');
    return true;
  }
  const probeTimes = [0.2, 1.5, Math.max(2.5, Math.min(4, Number(MOTION_VIDEO_DURATION || 10) / 2))];
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
  return { videoFilename: filename, mock: true, durationSeconds: MOTION_VIDEO_DURATION };
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

  const motionReferenceLimit = motionReferenceLimitForModel(MOTION_VIDEO_REQUEST_MODEL);
  const motionReferences = (job.motionReferences?.length ? job.motionReferences : [reference]).slice(0, motionReferenceLimit);
  const motionPlanLabel = motionReferences.length >= 3
    ? '连续转场运镜方案'
    : (motionReferences.length >= 2 ? '首尾帧运镜方案' : '单图运镜方案');
  updateJob(job, 22, `应用${motionPlanLabel}`, `[motion] ${motionPlanLabel} | ${style.label}`);
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
  if (!currentPublicBaseUrl()) {
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
  } else if (MOTION_VIDEO_IS_PRO666) {
    job.logs.push(`[motion] pro666 video-v1 uses JSON public image URL mode with up to ${motionReferenceLimit} reference image(s)`);
    await ensureMotionPublicReferencesReachable(motionImageUrls, job);
  } else if (MOTION_VIDEO_IS_XIAOJI) {
    job.logs.push(`[motion] baziapi Veo API uses JSON images URL mode with up to ${motionReferenceLimit} reference image(s)`);
    await ensureMotionPublicReferencesReachable(motionImageUrls, job);
  }
  job.logs.push(sourceImages.length >= 3
    ? '[motion] 已启用连续转场运镜方案：图 1 为起始画面，图 2 为过渡画面，图 3 为收尾画面'
    : sourceImages.length === 2
      ? '[motion] 已启用首尾帧运镜方案：图 1 为首帧，图 2 为尾帧'
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
    job.logs.push(`[motion-director] Gemini 已生成${sourceImages.length >= 3 ? '连续转场' : (sourceImages.length >= 2 ? '首尾帧' : '单图')}运镜短提示词：${MOTION_DIRECTOR_MODEL}`);
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
    job.logs.push(`[motion] 上游视频生成失败，不启用本地兜底：${String(error?.message || error).slice(0, 180)}`);
    throw error;
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
    localFallback: false,
    rawTaskInfo: { id: raw?.id || taskId, completed_at: raw?.completed_at },
  };
}

function normalizeVideoV1Prompt(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 4000);
}

function normalizeVideoV1PublicImageUrl(value = '') {
  return normalizeVideoV1PublicMediaUrl(value, '参考图 URL');
}

function normalizeVideoV1PublicMediaUrl(value = '', label = '素材 URL') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} 格式不正确，请填写公网 HTTPS 地址`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`${label} 请使用公网 HTTPS URL`);
  }
  return parsed.href;
}

function normalizeVideoV1PublicMediaUrls(values = [], limit = 1, label = '素材 URL') {
  const candidates = values.flatMap((value) => {
    if (Array.isArray(value)) return value;
    return String(value || '')
      .split(/[\n,，]+/u)
      .map((item) => item.trim())
      .filter(Boolean);
  });
  const urls = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const url = normalizeVideoV1PublicMediaUrl(candidate, label);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls.slice(0, Math.max(0, Number(limit) || 0));
}

function normalizeVideoV1PublicImageUrls(...values) {
  return normalizeVideoV1PublicMediaUrls(values, motionReferenceLimitForModel(), '参考图 URL');
}

function formBoolean(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function motionReferenceUploadExtension(file, kind = 'video') {
  const mimetype = String(file?.mimetype || '').toLowerCase();
  const ext = path.extname(String(file?.originalname || '')).toLowerCase().replace(/^\./, '');
  const imageExts = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif']);
  const videoExts = new Set(['mp4', 'mov', 'webm', 'm4v', 'avi']);
  const audioExts = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']);
  if (kind === 'image') {
    if (imageExts.has(ext)) return ext === 'jpeg' ? 'jpg' : ext;
    if (/png/.test(mimetype)) return 'png';
    if (/webp/.test(mimetype)) return 'webp';
    if (/gif/.test(mimetype)) return 'gif';
    if (/heic/.test(mimetype)) return 'heic';
    if (/heif/.test(mimetype)) return 'heif';
    return 'jpg';
  }
  if (kind === 'audio') {
    if (audioExts.has(ext)) return ext;
    if (/wav/.test(mimetype)) return 'wav';
    if (/mp4|m4a/.test(mimetype)) return 'm4a';
    if (/aac/.test(mimetype)) return 'aac';
    if (/ogg/.test(mimetype)) return 'ogg';
    if (/flac/.test(mimetype)) return 'flac';
    return 'mp3';
  }
  if (videoExts.has(ext)) return ext;
  if (/quicktime/.test(mimetype)) return 'mov';
  if (/webm/.test(mimetype)) return 'webm';
  if (/x-msvideo/.test(mimetype)) return 'avi';
  if (/x-m4v/.test(mimetype)) return 'm4v';
  return 'mp4';
}

function uploadedFileTotalSize(files = []) {
  return (Array.isArray(files) ? files : []).reduce((sum, file) => sum + Number(file?.size || file?.buffer?.length || 0), 0);
}

function hasUploadedFileOver(files = [], maxBytes = 0) {
  return (Array.isArray(files) ? files : []).some((file) => Number(file?.size || file?.buffer?.length || 0) > maxBytes);
}

function videoV1ResultLabel(aspectRatio = '16:9') {
  if (aspectRatio === '9:16') return '竖屏视频';
  if (aspectRatio === '1:1') return '方形视频';
  return '横屏视频';
}

async function processVideoV1Job(job) {
  job.cancelRequested = false;
  job.cancelReason = '';
  ensureJobAbortController(job);
  job.status = 'running';
  job.error = null;
  queueJobLedgerSnapshot(job);

  const outputDir = path.join(GENERATED_DIR, job.id);
  const prompt = normalizeVideoV1Prompt(job.videoV1?.prompt || '');
  const requestModel = normalizePro666VideoModelName(job.videoV1?.requestModel || job.videoV1?.model || job.videoV1?.modelMode || MOTION_VIDEO_REQUEST_MODEL);
  const modelMode = normalizePro666VideoModelMode(requestModel);
  const modelLabel = pro666VideoModelLabel(requestModel);
  const referenceLimit = motionReferenceLimitForModel(requestModel);
  const durationSeconds = normalizeVideoV1Duration(job.videoV1?.durationSeconds || MOTION_VIDEO_DURATION);
  const aspectRatio = normalizeVideoV1AspectRatio(job.videoV1?.aspectRatio || motionVideoColonAspectRatio());
  const generateAudio = Boolean(job.videoV1?.generateAudio);
  const publicReferenceUrls = (Array.isArray(job.videoV1?.referenceUrls)
    ? job.videoV1.referenceUrls
    : [job.videoV1?.referenceUrl])
    .filter(Boolean)
    .slice(0, referenceLimit);
  const videoReferenceUrls = (Array.isArray(job.videoV1?.videoUrls) ? job.videoV1.videoUrls : [])
    .filter(Boolean)
    .slice(0, PRO666_VIDEO_REFERENCE_VIDEO_LIMIT);
  const audioReferenceUrls = (Array.isArray(job.videoV1?.audioUrls) ? job.videoV1.audioUrls : [])
    .filter(Boolean)
    .slice(0, PRO666_VIDEO_REFERENCE_AUDIO_LIMIT);
  const uploadedVideoReferences = (Array.isArray(job.videoV1?.videoFiles) ? job.videoV1.videoFiles : [])
    .filter((file) => file?.buffer)
    .slice(0, PRO666_VIDEO_REFERENCE_VIDEO_LIMIT);
  const uploadedAudioReferences = (Array.isArray(job.videoV1?.audioFiles) ? job.videoV1.audioFiles : [])
    .filter((file) => file?.buffer)
    .slice(0, PRO666_VIDEO_REFERENCE_AUDIO_LIMIT);
  const uploadedReferences = (Array.isArray(job.videoV1?.referenceFiles)
    ? job.videoV1.referenceFiles
    : [job.videoV1?.referenceFile || job.files?.[0]])
    .filter((file) => file?.buffer)
    .slice(0, referenceLimit);

  try {
    await mkdir(outputDir, { recursive: true });
    if (!prompt) throw new Error('请输入视频生成提示词');

    updateJob(job, 10, `正在准备${modelLabel}请求参数`, `[video-v1] model=${requestModel} mode=${modelMode}, prompt ready, duration=${durationSeconds}s, aspect_ratio=${aspectRatio}`);
    await writeFile(path.join(outputDir, 'motion-prompt.txt'), `${prompt}\n`, 'utf8');

    if (USE_MOCK_MOTION_VIDEO) {
      for (const [index, uploadedReference] of uploadedReferences.entries()) {
        const sourceImage = await sharp(uploadedReference.buffer)
          .rotate()
          .resize(MOTION_VIDEO_REFERENCE_MAX_EDGE, MOTION_VIDEO_REFERENCE_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: MOTION_VIDEO_REFERENCE_QUALITY })
          .toBuffer();
        const filename = index === 0 ? 'motion-source.jpg' : `motion-reference-${index + 1}.jpg`;
        await writeFile(path.join(outputDir, filename), sourceImage);
      }
      const mockMotion = await generateMotionVideoMock(job, outputDir);
      const resource = await saveJobResource(job, outputDir, [], '', '', null, {
        ...mockMotion,
        durationSeconds,
        resolution: MOTION_VIDEO_RESOLUTION,
        style: requestModel,
        styleLabel: videoV1ResultLabel(aspectRatio),
      });
      job.result = {
        jobId: job.id,
        mode: job.mode,
        images: [],
        items: [],
        collageUrl: '',
        zipUrl: '',
        copy: null,
        resource,
        mock: true,
        provider: 'mock',
        videoUrl: publicUrl(job.id, mockMotion.videoFilename),
        videoDownloadUrl: downloadUrl(job.id, mockMotion.videoFilename),
        videoPosterUrl: existsSync(path.join(outputDir, 'motion-source.jpg')) ? publicUrl(job.id, 'motion-source.jpg') : '',
        motionStyle: requestModel,
        motionStyleLabel: videoV1ResultLabel(aspectRatio),
        durationSeconds,
        resolution: MOTION_VIDEO_RESOLUTION,
        aspectRatio,
      };
      job.status = 'completed';
      updateJob(job, 100, `${modelLabel}演示视频已生成`, '[done] video-v1 mock video saved to resources');
      return;
    }

    const sourceImages = [];
    const referenceUrls = [];
    if (uploadedReferences.length) {
      if (!currentPublicBaseUrl()) {
        throw new Error('上传参考图需要配置 PUBLIC_BASE_URL，或改用已公开可访问的 HTTPS 图片 URL');
      }
      for (const [index, uploadedReference] of uploadedReferences.entries()) {
        const sourceImage = uploadedReference.buffer;
        const ext = motionReferenceUploadExtension(uploadedReference, 'image');
        const filename = index === 0 ? `motion-source.${ext}` : `motion-reference-${index + 1}.${ext}`;
        await writeFile(path.join(outputDir, filename), sourceImage);
        sourceImages.push(sourceImage);
        referenceUrls.push(resolvePublicMotionFileUrl(job, filename));
        job.logs.push(`[video-v1] uploaded reference ${index + 1} saved original: ${Math.round(sourceImage.length / 1024)}KB`);
      }
    }
    referenceUrls.push(...publicReferenceUrls);
    const dedupedReferenceUrls = [...new Set(referenceUrls)].slice(0, referenceLimit);
    for (const [index, uploadedVideo] of uploadedVideoReferences.entries()) {
      const filename = `motion-video-${index + 1}.${motionReferenceUploadExtension(uploadedVideo, 'video')}`;
      await writeFile(path.join(outputDir, filename), uploadedVideo.buffer);
      videoReferenceUrls.push(resolvePublicMotionFileUrl(job, filename));
      job.logs.push(`[video-v1] uploaded reference video ${index + 1} saved: ${Math.round(uploadedVideo.buffer.length / 1024)}KB`);
    }
    for (const [index, uploadedAudio] of uploadedAudioReferences.entries()) {
      const filename = `motion-audio-${index + 1}.${motionReferenceUploadExtension(uploadedAudio, 'audio')}`;
      await writeFile(path.join(outputDir, filename), uploadedAudio.buffer);
      audioReferenceUrls.push(resolvePublicMotionFileUrl(job, filename));
      job.logs.push(`[video-v1] uploaded reference audio ${index + 1} saved: ${Math.round(uploadedAudio.buffer.length / 1024)}KB`);
    }
    const dedupedVideoReferenceUrls = [...new Set(videoReferenceUrls)].slice(0, PRO666_VIDEO_REFERENCE_VIDEO_LIMIT);
    const dedupedAudioReferenceUrls = [...new Set(audioReferenceUrls)].slice(0, PRO666_VIDEO_REFERENCE_AUDIO_LIMIT);
    const publicMediaUrls = [...dedupedReferenceUrls, ...dedupedVideoReferenceUrls, ...dedupedAudioReferenceUrls];
    if (publicMediaUrls.length) {
      updateJob(job, 18, '正在检查参考素材公网可访问性', `[video-v1] public references images=${dedupedReferenceUrls.length}, videos=${dedupedVideoReferenceUrls.length}, audios=${dedupedAudioReferenceUrls.length}`);
      await ensureMotionPublicReferencesReachable(publicMediaUrls, job);
    }

    updateJob(job, 25, `正在提交${modelLabel}视频任务`, '[video-v1] POST /v1/videos');
    const motionTask = await submitAndPollMotionTask({
      prompt,
      imageUrl: dedupedReferenceUrls[0] || '',
      imageBuffer: sourceImages[0] || null,
      imageBuffers: sourceImages,
      imageUrls: dedupedReferenceUrls,
      job,
      requestModel,
      durationSeconds,
      aspectRatio,
      videoUrls: dedupedVideoReferenceUrls,
      audioUrls: dedupedAudioReferenceUrls,
      generateAudio,
    });

    const filename = 'motion.mp4';
    const dest = path.join(outputDir, filename);
    job.logs.push(`[video-v1] task completed, downloading mp4: task_id=${motionTask.taskId}`);
    updateJob(job, 92, `正在下载${modelLabel}成片`, '[video-v1] download mp4');
    const size = await downloadMotionVideoWithRetries(motionTask.videoUrl, dest, job);
    job.logs.push(`[video-v1] video saved: ${Math.round(size / 1024)}KB`);

    if (MOTION_WATERMARK_REMOVE) {
      updateJob(job, 96, '正在处理视频水印区域', '[video-v1] ffmpeg delogo');
      const cleaned = await removeMotionWatermark(dest, job);
      if (cleaned) job.logs.push('[video-v1] watermark area processed');
    }
    updateJob(job, 98, '正在优化网页播放文件', '[video-v1] ffmpeg web optimize');
    await optimizeMotionVideoForWeb(dest, job);
    await assertMotionVideoHasVisibleFrame(dest, job);

    const motionResult = {
      videoFilename: filename,
      durationSeconds,
      resolution: MOTION_VIDEO_RESOLUTION,
      style: requestModel,
      styleLabel: videoV1ResultLabel(aspectRatio),
      mock: false,
      rawTaskInfo: { id: motionTask.raw?.id || motionTask.taskId, completed_at: motionTask.raw?.completed_at },
    };
    updateJob(job, 99, '正在保存到我的资源', '[resource] saving video-v1 output');
    const resource = await saveJobResource(job, outputDir, [], '', '', null, motionResult);
    job.result = {
      jobId: job.id,
      mode: job.mode,
      images: [],
      items: [],
      collageUrl: '',
      zipUrl: '',
      copy: null,
      resource,
      mock: false,
      provider: 'pro666',
      videoUrl: publicUrl(job.id, filename),
      videoDownloadUrl: downloadUrl(job.id, filename),
      videoPosterUrl: existsSync(path.join(outputDir, 'motion-source.jpg')) ? publicUrl(job.id, 'motion-source.jpg') : '',
      motionStyle: requestModel,
      motionStyleLabel: videoV1ResultLabel(aspectRatio),
      durationSeconds,
      resolution: MOTION_VIDEO_RESOLUTION,
      aspectRatio,
    };
    job.status = 'completed';
    updateJob(job, 100, `${modelLabel}视频已生成`, '[done] video-v1 video saved to resources');
  } catch (error) {
    if (isJobCancelledError(error) || job.cancelRequested) {
      job.status = 'cancelled';
      job.error = job.cancelReason || error.message || '任务已停止';
      await refundJobCharge(job, job.error);
      job.stage = '视频生成已停止，未提交后续处理';
      job.logs.push(`[cancelled] ${job.stage}`);
      return;
    }
    job.status = 'failed';
    console.error('[video-v1-job-error] job=' + job.id + ' ' + String(error?.stack || error?.message || error).replace(/\s+/g, ' ').slice(0, 1600));
    job.error = cleanUserErrorMessage(error.message || '视频生成失败');
    const refundedUser = await refundJobCharge(job, job.error);
    job.stage = refundedUser ? '视频生成失败，已自动退回点数' : '视频生成失败，请稍后重试';
    job.logs.push(`[error] ${job.error}`);
  } finally {
    delete job.file;
    delete job.files;
    try {
      await writeJobLedgerSnapshot(job);
    } catch (error) {
      console.warn(`[jobs] failed to persist final video-v1 job ${job.id}: ${error.message}`);
    }
  }
}

function checklistCropRect(meta, crop) {
  const width = Number(meta?.width || 0);
  const height = Number(meta?.height || 0);
  const left = Math.max(0, Math.round(width * crop.x));
  const top = Math.max(0, Math.round(height * crop.y));
  const cropWidth = Math.max(1, Math.round(width * crop.w));
  const cropHeight = Math.max(1, Math.round(height * crop.h));
  return {
    left,
    top,
    width: Math.min(cropWidth, Math.max(1, width - left)),
    height: Math.min(cropHeight, Math.max(1, height - top)),
  };
}

function constructionChecklistBoardLayout() {
  return {
    width: 3072,
    height: 4096,
    panels: {
      hero: { x: 0, y: 0, w: 2240, h: 1350 },
      overview: { x: 2300, y: 110, w: 724, h: 560 },
      highlights: { x: 2300, y: 720, w: 724, h: 510 },
      tech: { x: 48, y: 1388, w: 2976, h: 760 },
      table: { x: 48, y: 2192, w: 1460, h: 760 },
      materials: { x: 1552, y: 2192, w: 1472, h: 760 },
      steps: { x: 48, y: 3000, w: 1460, h: 920 },
      notes: { x: 1552, y: 3000, w: 660, h: 920 },
      config: { x: 2256, y: 3000, w: 768, h: 920 },
    },
  };
}

function scalePanelRect(rect, width, height) {
  const layout = constructionChecklistBoardLayout();
  const sx = width / layout.width;
  const sy = height / layout.height;
  return {
    left: Math.round(rect.x * sx),
    top: Math.round(rect.y * sy),
    width: Math.round(rect.w * sx),
    height: Math.round(rect.h * sy),
  };
}

function constructionChecklistUnderlaySvg(width, height) {
  const { width: baseWidth, height: baseHeight, panels } = constructionChecklistBoardLayout();
  const card = (r, fill = '#fffdf9', radius = 18) => `
    <rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${radius}" fill="${fill}" stroke="#cdbdae" stroke-width="2"/>
  `;
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${baseWidth} ${baseHeight}">
      <defs>
        <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#fbf8f2"/>
          <stop offset="0.58" stop-color="#f4eee6"/>
          <stop offset="1" stop-color="#ebe0d4"/>
        </linearGradient>
        <pattern id="paperDot" width="36" height="36" patternUnits="userSpaceOnUse">
          <path d="M36 0H0V36" fill="none" stroke="#e2d6ca" stroke-width="1" opacity="0.35"/>
        </pattern>
      </defs>
      <rect width="${baseWidth}" height="${baseHeight}" fill="url(#paper)"/>
      <rect width="${baseWidth}" height="${panels.tech.y - 22}" fill="#050505"/>
      <rect x="0" y="${panels.tech.y - 78}" width="${baseWidth}" height="${baseHeight - panels.tech.y + 78}" fill="#f8f4ee"/>
      <rect width="${baseWidth}" height="${baseHeight}" fill="url(#paperDot)" opacity="0.42"/>
      ${card(panels.overview, '#fffdf9', 14)}
      ${card(panels.highlights, '#fffdf9', 14)}
      ${card(panels.tech, '#fffdf9', 12)}
      ${card(panels.table, '#fffdf9', 12)}
      ${card(panels.materials, '#fffdf9', 12)}
      ${card(panels.steps, '#fffdf9', 12)}
      ${card(panels.notes, '#fffdf9', 12)}
      ${card(panels.config, '#fffdf9', 12)}
    </svg>`;
}

function constructionChecklistFinalOverlaySvg(width, height) {
  const font = 'Microsoft YaHei, Noto Sans CJK SC, PingFang SC, Arial, sans-serif';
  const red = '#8d2520';
  const coffee = '#8f7a66';
  const ink = '#1f1a17';
  const muted = '#6d625a';
  const line = '#cbbcaf';
  const { panels } = constructionChecklistBoardLayout();
  const tag = (x, y, text, w = 180) => `
    <g>
      <rect x="${x}" y="${y}" width="${w}" height="38" rx="4" fill="${coffee}"/>
      <text x="${x + 18}" y="${y + 27}" fill="#fffaf4" font-size="21" font-weight="900" font-family="${font}">${escapeSvgText(text)}</text>
    </g>`;
  const overviewRows = [
    ['适用场地', '室内宴会厅 / 酒店宴会厅'],
    ['输入母版', '方案施工矩阵图'],
    ['核心区域', '主舞台 · T台通道 · 搭建区'],
    ['施工重点', '吊顶结构 / 花艺 / 灯光 / 布幔'],
    ['尺寸说明', '以现场复尺与深化图为准'],
  ];
  const highlights = [
    '先以施工矩阵锁定主题、色系和舞台比例',
    '再拆解为主效果、技术视图、物料和步骤',
    '清单表格由系统模板输出，便于交底确认',
    '适合客户确认、内部报价和现场施工沟通',
  ];
  const materialRows = [
    ['1', '舞台背景结构', '按矩阵深化', '项', '1', '拱门/背板/立柱'],
    ['2', 'T台通道地台', '现场复尺', '套', '1', '含台阶与收边'],
    ['3', '仿真花材组合', '主色+辅色', '组', '若干', '花顶/路引/舞台花'],
    ['4', '纱幔布艺', '按造型裁剪', '套', '1', '背景与顶部 drape'],
    ['5', '水晶帘/吊饰', '按吊点配置', '组', '若干', '顶部与两侧'],
    ['6', '吊灯/烛台灯具', '暖光系统', '组', '若干', '氛围与重点光'],
    ['7', '桁架/吊点结构', '铝合金', '套', '1', '承重需复核'],
    ['8', 'LED帕灯/光束灯', '舞台灯光', '台', '若干', '洗墙与追光'],
    ['9', '装饰道具', '同主题', '批', '1', '喷泉/烛台/摆件'],
    ['10', '安装人工', '专业团队', '项', '1', '进场搭建与调试'],
  ];
  const table = panels.table;
  const cols = [0, 90, 455, 760, 920, 1080, table.w];
  const tableLines = [
    `<rect x="${table.x}" y="${table.y}" width="${table.w}" height="${table.h}" rx="18" fill="#fffdf9" stroke="${line}" stroke-width="2"/>`,
    tag(table.x, table.y, '物料清单', 170),
    `<rect x="${table.x + 28}" y="${table.y + 58}" width="${table.w - 56}" height="54" fill="#eee7df"/>`,
    ...cols.slice(1, -1).map((col) => `<line x1="${table.x + col}" y1="${table.y + 58}" x2="${table.x + col}" y2="${table.y + table.h - 28}" stroke="${line}" stroke-width="2"/>`),
    ...Array.from({ length: materialRows.length + 1 }, (_, i) => {
      const y = table.y + 112 + i * 35;
      return `<line x1="${table.x + 28}" y1="${y}" x2="${table.x + table.w - 28}" y2="${y}" stroke="${line}" stroke-width="1.4"/>`;
    }),
    ...['序号', '物料名称', '规格/尺寸', '单位', '数量', '备注'].map((head, i) => {
      const x = table.x + (cols[i] + cols[i + 1]) / 2;
      return `<text x="${x}" y="${table.y + 94}" fill="${ink}" font-size="22" font-weight="900" text-anchor="middle" font-family="${font}">${escapeSvgText(head)}</text>`;
    }),
    ...materialRows.flatMap((row, r) => row.map((text, c) => {
      const x = table.x + (cols[c] + cols[c + 1]) / 2;
      const y = table.y + 139 + r * 35;
      const size = c === 5 ? 18 : 19;
      return `<text x="${x}" y="${y}" fill="${ink}" font-size="${size}" font-weight="720" text-anchor="middle" font-family="${font}">${escapeSvgText(text)}</text>`;
    })),
  ].join('');
  const swatches = ['#9b1f24', '#c9a36c', '#f3e6d8', '#fff8ee', '#2a211d'].map((color, i) => (
    `<rect x="${panels.overview.x + 166 + i * 74}" y="${panels.overview.y + 372}" width="54" height="54" rx="7" fill="${color}" stroke="#d8c8b9" stroke-width="1.5"/>`
  )).join('');
  const imagePanelBorders = [panels.hero, panels.tech, panels.materials, panels.steps].map((panel) => `
    <rect x="${panel.x}" y="${panel.y}" width="${panel.w}" height="${panel.h}" rx="18" fill="none" stroke="${line}" stroke-width="2.2"/>
  `).join('');
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 4096 2304">
      <text x="64" y="78" fill="${ink}" font-size="48" font-weight="900" font-family="${font}">落地施工清单图</text>
      <text x="520" y="78" fill="${muted}" font-size="24" font-weight="760" font-family="${font}">基于方案施工矩阵拆解 · 主效果 / 技术视图 / 物料 / 搭建交底</text>
      <text x="3828" y="78" fill="${red}" font-size="26" font-weight="900" text-anchor="end" font-family="${font}">施工交付板</text>
      ${tag(panels.hero.x, panels.hero.y, '效果示意', 170)}
      ${tag(panels.tech.x, panels.tech.y, '落地尺寸图', 190)}
      ${tag(panels.materials.x, panels.materials.y, '物料清单展示', 220)}
      ${tag(panels.steps.x, panels.steps.y, '搭建步骤 / 灯光建议', 300)}
      <rect x="${panels.overview.x}" y="${panels.overview.y}" width="${panels.overview.w}" height="${panels.overview.h}" rx="18" fill="#fffdf9" fill-opacity="0.94" stroke="${line}" stroke-width="2"/>
      ${tag(panels.overview.x, panels.overview.y, '项目概况', 170)}
      ${overviewRows.map((row, i) => {
        const y = panels.overview.y + 92 + i * 54;
        return `
          <circle cx="${panels.overview.x + 52}" cy="${y - 7}" r="7" fill="${red}"/>
          <text x="${panels.overview.x + 80}" y="${y}" fill="${ink}" font-size="25" font-weight="900" font-family="${font}">${escapeSvgText(row[0])}：</text>
          <text x="${panels.overview.x + 250}" y="${y}" fill="${muted}" font-size="25" font-weight="760" font-family="${font}">${escapeSvgText(row[1])}</text>`;
      }).join('')}
      <text x="${panels.overview.x + 52}" y="${panels.overview.y + 407}" fill="${ink}" font-size="25" font-weight="900" font-family="${font}">主色板：</text>
      ${swatches}
      <rect x="${panels.overview.x + 34}" y="${panels.overview.y + 470}" width="${panels.overview.w - 68}" height="302" rx="14" fill="#f4eee7" stroke="${line}" stroke-width="1.5"/>
      ${tag(panels.overview.x + 34, panels.overview.y + 470, '设计亮点', 170)}
      ${highlights.map((item, i) => `
        <text x="${panels.overview.x + 74}" y="${panels.overview.y + 552 + i * 48}" fill="${ink}" font-size="25" font-weight="760" font-family="${font}">${i + 1}. ${escapeSvgText(item)}</text>
      `).join('')}
      ${tableLines}
      <rect x="${panels.notes.x}" y="${panels.notes.y}" width="${panels.notes.w}" height="${panels.notes.h}" rx="18" fill="#fffdf9" stroke="${line}" stroke-width="2"/>
      ${tag(panels.notes.x, panels.notes.y, '注意事项', 170)}
      ${['结构承重需复核', '电线走线需隐藏并防漏电', '明火与喷泉设备分区管理', '高空吊挂需二次安全检查', '进场时间预留灯光调试'].map((item, i) => `
        <g>
          <circle cx="${panels.notes.x + 230 + i * 690}" cy="${panels.notes.y + 70}" r="18" fill="none" stroke="${red}" stroke-width="4"/>
          <text x="${panels.notes.x + 230 + i * 690}" y="${panels.notes.y + 78}" fill="${red}" font-size="24" font-weight="900" text-anchor="middle" font-family="${font}">${i + 1}</text>
          <text x="${panels.notes.x + 265 + i * 690}" y="${panels.notes.y + 78}" fill="${ink}" font-size="24" font-weight="820" font-family="${font}">${escapeSvgText(item)}</text>
        </g>
      `).join('')}
      ${imagePanelBorders}
    </svg>`;
}

function constructionChecklistFinalOverlaySvgV2(width, height) {
  const font = 'Microsoft YaHei, Noto Sans CJK SC, PingFang SC, Arial, sans-serif';
  const red = '#9a2b2b';
  const taupe = '#9b8978';
  const ink = '#211a16';
  const muted = '#766a61';
  const line = '#cdbdae';
  const { width: baseWidth, height: baseHeight, panels } = constructionChecklistBoardLayout();
  const sectionBar = (r, text, extra = '') => `
    <g>
      <rect x="${r.x}" y="${r.y}" width="${r.w}" height="52" rx="10" fill="${taupe}"/>
      <text x="${r.x + 24}" y="${r.y + 36}" fill="#fffaf4" font-size="28" font-weight="900" font-family="${font}">${escapeSvgText(text)}</text>
      ${extra ? `<text x="${r.x + r.w - 24}" y="${r.y + 36}" fill="#fffaf4" font-size="19" font-weight="760" text-anchor="end" font-family="${font}">${escapeSvgText(extra)}</text>` : ''}
    </g>`;
  const smallTitleBar = (r, text) => `
    <g>
      <rect x="${r.x}" y="${r.y}" width="${r.w}" height="50" rx="12" fill="${taupe}"/>
      <text x="${r.x + 24}" y="${r.y + 34}" fill="#fffaf4" font-size="28" font-weight="900" font-family="${font}">${escapeSvgText(text)}</text>
    </g>`;
  const dim = (x1, y1, x2, y2, label, dy = -12) => `
    <g stroke="${ink}" stroke-width="2" fill="none" opacity="0.72">
      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-start="url(#dimArrow)" marker-end="url(#dimArrow)"/>
      <text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 + dy}" fill="${ink}" stroke="none" font-size="22" font-weight="820" text-anchor="middle" font-family="${font}">${escapeSvgText(label)}</text>
    </g>`;
  const overviewRows = [
    ['适用场地', '室内宴会厅 / 酒店空间'],
    ['输入母版', '原效果图 / 施工矩阵图'],
    ['风格', '以原图主视觉为准'],
    ['色系', '按原图主色系复核'],
    ['搭建范围', '舞台 / T台 / 花艺 / 灯光'],
    ['尺寸说明', '现场复尺后深化'],
    ['执行原则', '不替换原方案风格'],
  ];
  const highlights = [
    '主效果图作为施工清单唯一视觉母版',
    '舞台帷幔、中心装置、T台花艺按原图比例拆解',
    '桌花、路引、灯光只做落地标注，不替换风格',
    '物料数量以现场复尺和最终报价清单确认为准',
  ];
  const materialRows = [
    ['1', '舞台 / T台结构', '现场复尺', '套', '1', '含台阶与收边'],
    ['2', '背景帷幔造型', '按原图高度', '项', '1', '褶皱比例复核'],
    ['3', '舞台中心装置', '按原图定制', '套', '1', '异形 / 雕花 / 主视觉'],
    ['4', 'T台两侧地排花', '混色花材', '组', '若干', '高低层次'],
    ['5', '舞台前沿花带', '混色花材', '米', '复尺', '与通道衔接'],
    ['6', '桌花 / 高瓶花', '按桌数配置', '组', '复核', '两侧宴会区'],
    ['7', '追光 / 光束 / 面光', '按灯位深化', '组', '1', '氛围与人物光'],
    ['8', '桁架 / 吊点结构', '现场复核', '项', '1', '承重安全确认'],
    ['9', '地毯 / 台面包边', '按原图色系', '套', '1', 'T台与舞台'],
    ['10', '电源线材 / 辅料', '阻燃安全', '批', '1', '隐藏走线'],
    ['11', '安装人工', '专业团队', '项', '1', '搭建 + 撤场'],
    ['12', '现场调试 / 验收', '灯光与安全', '项', '1', '完工复核'],
  ];
  const table = panels.table;
  const cols = [0, 82, 420, 682, 820, 952, table.w];
  const tableTop = table.y + 52;
  const rowH = 48;
  const tableLines = [
    sectionBar(table, '物料清单'),
    `<rect x="${table.x + 18}" y="${tableTop + 18}" width="${table.w - 36}" height="50" fill="#eee7df"/>`,
    ...cols.slice(1, -1).map((col) => `<line x1="${table.x + col}" y1="${tableTop + 18}" x2="${table.x + col}" y2="${table.y + table.h - 24}" stroke="${line}" stroke-width="1.7"/>`),
    ...Array.from({ length: materialRows.length + 1 }, (_, i) => {
      const y = tableTop + 68 + i * rowH;
      return `<line x1="${table.x + 18}" y1="${y}" x2="${table.x + table.w - 18}" y2="${y}" stroke="${line}" stroke-width="1.2"/>`;
    }),
    ...['序号', '物料名称', '规格/尺寸', '单位', '数量', '备注'].map((head, i) => {
      const x = table.x + (cols[i] + cols[i + 1]) / 2;
      return `<text x="${x}" y="${tableTop + 53}" fill="${ink}" font-size="21" font-weight="900" text-anchor="middle" font-family="${font}">${escapeSvgText(head)}</text>`;
    }),
    ...materialRows.flatMap((row, r) => row.map((text, c) => {
      const x = table.x + (cols[c] + cols[c + 1]) / 2;
      const y = tableTop + 101 + r * rowH;
      const size = c === 5 ? 17 : 18;
      return `<text x="${x}" y="${y}" fill="${ink}" font-size="${size}" font-weight="720" text-anchor="middle" font-family="${font}">${escapeSvgText(text)}</text>`;
    })),
  ].join('');
  const swatches = ['#efbfd0', '#d9b98c', '#f4eadc', '#ffffff', '#b9b2aa'].map((color, i) => (
    `<rect x="${panels.overview.x + 154 + i * 84}" y="${panels.overview.y + 438}" width="62" height="48" rx="5" fill="${color}" stroke="#d8c8b9" stroke-width="1.5"/>`
  )).join('');
  const techCellW = panels.tech.w / 3;
  const techGuides = ['1. 平面布局图（俯视图）', '2. 正面立面图', '3. 侧面立面图'].map((label, i) => {
    const x = panels.tech.x + i * techCellW;
    return `
      <line x1="${x}" y1="${panels.tech.y + 52}" x2="${x}" y2="${panels.tech.y + panels.tech.h}" stroke="${line}" stroke-width="2" opacity="${i === 0 ? 0 : 1}"/>
      <text x="${x + 34}" y="${panels.tech.y + 100}" fill="${ink}" font-size="25" font-weight="900" font-family="${font}">${escapeSvgText(label)}</text>
    `;
  }).join('');
  const materialLabels = ['背景帷幔', '中心装置', 'T台结构', '地排花艺', '舞台花带', '桌花瓶插', '追光面光', '桁架吊点', '线材辅料'];
  const materialGrid = Array.from({ length: 9 }, (_, i) => {
    const gridX = panels.materials.x + 18;
    const gridY = panels.materials.y + 70;
    const cellW = (panels.materials.w - 36) / 3;
    const cellH = (panels.materials.h - 94) / 3;
    const x = gridX + (i % 3) * cellW;
    const y = gridY + Math.floor(i / 3) * cellH;
    return `
      <rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.86"/>
      <rect x="${x}" y="${y + cellH - 42}" width="${cellW}" height="42" fill="#fffdf9" fill-opacity="0.9"/>
      <text x="${x + cellW / 2}" y="${y + cellH - 14}" fill="${ink}" font-size="20" font-weight="860" text-anchor="middle" font-family="${font}">${escapeSvgText(materialLabels[i])}</text>
    `;
  }).join('');
  const stepLabels = ['1. 复尺定位 & 保护进场', '2. 舞台/T台结构搭建', '3. 背景帷幔/主装置安装', '4. 花艺分区摆放', '5. 灯光走线 & 调试', '6. 完工验收 & 补量'];
  const stepGrid = Array.from({ length: 6 }, (_, i) => {
    const gridX = panels.steps.x + 18;
    const gridY = panels.steps.y + 70;
    const cellW = (panels.steps.w - 36) / 3;
    const cellH = (panels.steps.h - 94) / 2;
    const x = gridX + (i % 3) * cellW;
    const y = gridY + Math.floor(i / 3) * cellH;
    return `
      <rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.88"/>
      <rect x="${x}" y="${y + cellH - 52}" width="${cellW}" height="52" fill="#fffdf9" fill-opacity="0.92"/>
      <text x="${x + 22}" y="${y + cellH - 20}" fill="${ink}" font-size="18" font-weight="850" font-family="${font}">${escapeSvgText(stepLabels[i])}</text>
    `;
  }).join('');
  const configRows = [
    ['主舞台还原', '基础', '标准', '加强'],
    ['花艺密度', '标准', '充足', '丰富'],
    ['帷幔层次', '单层', '多层', '加密褶皱'],
    ['灯光配置', '基础面光', '面光+光束', '仪式灯光组'],
    ['桌花配置', '基础桌花', '桌花+高瓶', '桌花+高瓶加密'],
    ['安全复核', '基础检查', '二次检查', '专项检查'],
    ['搭建时间', '按场地', '预留调试', '提前进场'],
    ['数量确认', '初版估算', '现场复尺', '最终报价'],
  ];
  const configTable = (() => {
    const r = panels.config;
    const top = r.y + 64;
    const headers = ['配置项', '标准版', '升级版', '豪华版'];
    const colW = r.w / headers.length;
    const row = 58;
    return [
      sectionBar(r, '推荐配置清单（可升级）'),
      `<rect x="${r.x + 18}" y="${top}" width="${r.w - 36}" height="${row}" fill="#eee7df"/>`,
      ...headers.map((head, i) => `<text x="${r.x + colW * i + colW / 2}" y="${top + 38}" fill="${ink}" font-size="20" font-weight="900" text-anchor="middle" font-family="${font}">${escapeSvgText(head)}</text>`),
      ...Array.from({ length: configRows.length + 1 }, (_, i) => `<line x1="${r.x + 18}" y1="${top + row + i * row}" x2="${r.x + r.w - 18}" y2="${top + row + i * row}" stroke="${line}" stroke-width="1.2"/>`),
      ...Array.from({ length: headers.length - 1 }, (_, i) => `<line x1="${r.x + colW * (i + 1)}" y1="${top}" x2="${r.x + colW * (i + 1)}" y2="${top + row * (configRows.length + 1)}" stroke="${line}" stroke-width="1.2"/>`),
      ...configRows.flatMap((items, rowIndex) => items.map((text, i) => `<text x="${r.x + colW * i + colW / 2}" y="${top + row * (rowIndex + 1) + 38}" fill="${i === 0 ? ink : muted}" font-size="18" font-weight="${i === 0 ? 850 : 760}" text-anchor="middle" font-family="${font}">${escapeSvgText(text)}</text>`)),
    ].join('');
  })();
  const imagePanelBorders = [panels.tech, panels.materials, panels.steps].map((panel) => `
    <rect x="${panel.x}" y="${panel.y}" width="${panel.w}" height="${panel.h}" rx="12" fill="none" stroke="${line}" stroke-width="2.2"/>
  `).join('');
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${baseWidth} ${baseHeight}">
      <defs>
        <linearGradient id="heroFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#000000" stop-opacity="0.72"/>
          <stop offset="0.36" stop-color="#000000" stop-opacity="0.28"/>
          <stop offset="1" stop-color="#000000" stop-opacity="0.02"/>
        </linearGradient>
        <marker id="dimArrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="${ink}"/>
        </marker>
      </defs>
      <rect x="${panels.hero.x}" y="${panels.hero.y}" width="${panels.hero.w}" height="${panels.hero.h}" fill="url(#heroFade)"/>
      <text x="52" y="92" fill="#ffffff" font-size="58" font-weight="900" font-family="${font}">主题婚礼落地施工图</text>
      <text x="54" y="142" fill="#ffffff" fill-opacity="0.86" font-size="31" font-weight="820" font-family="${font}">主效果 · 落地尺寸 · 物料清单 · 搭建交底</text>
      ${smallTitleBar(panels.overview, '项目概况')}
      ${overviewRows.map((row, i) => {
        const y = panels.overview.y + 92 + i * 49;
        return `
          <circle cx="${panels.overview.x + 42}" cy="${y - 7}" r="6" fill="${red}"/>
          <text x="${panels.overview.x + 66}" y="${y}" fill="${ink}" font-size="22" font-weight="900" font-family="${font}">${escapeSvgText(row[0])}：</text>
          <text x="${panels.overview.x + 206}" y="${y}" fill="${muted}" font-size="22" font-weight="760" font-family="${font}">${escapeSvgText(row[1])}</text>`;
      }).join('')}
      <text x="${panels.overview.x + 42}" y="${panels.overview.y + 472}" fill="${ink}" font-size="22" font-weight="900" font-family="${font}">主色板：</text>
      ${swatches}
      ${smallTitleBar(panels.highlights, '设计亮点')}
      ${highlights.map((item, i) => `
        <text x="${panels.highlights.x + 48}" y="${panels.highlights.y + 104 + i * 72}" fill="${ink}" font-size="24" font-weight="760" font-family="${font}">${i + 1}. ${escapeSvgText(item)}</text>
      `).join('')}
      ${sectionBar(panels.tech, '落地尺寸图', '现场复尺')}
      ${techGuides}
      ${dim(panels.tech.x + 132, panels.tech.y + 148, panels.tech.x + techCellW - 132, panels.tech.y + 148, '现场复尺')}
      ${dim(panels.tech.x + techCellW + 170, panels.tech.y + 166, panels.tech.x + techCellW * 2 - 170, panels.tech.y + 166, '舞台宽度')}
      ${dim(panels.tech.x + techCellW * 2 + 170, panels.tech.y + 166, panels.tech.x + techCellW * 3 - 170, panels.tech.y + 166, '通道长度')}
      ${dim(panels.tech.x + 110, panels.tech.y + 650, panels.tech.x + techCellW - 110, panels.tech.y + 650, '入口 / T台 / 舞台区', 30)}
      ${tableLines}
      ${sectionBar(panels.materials, '物料清单展示')}
      ${materialGrid}
      ${sectionBar(panels.steps, '搭建步骤')}
      ${stepGrid}
      ${sectionBar(panels.notes, '注意事项')}
      ${['主视觉比例以原效果图为准', '桁架与吊点需提前确认承重', '所有线路需固定并隐藏走线', '高位装置安装后做二次安全检查', '现场预留 2 小时灯光调试'].map((item, i) => `
        <g>
          <circle cx="${panels.notes.x + 42}" cy="${panels.notes.y + 100 + i * 62}" r="12" fill="none" stroke="${red}" stroke-width="3"/>
          <text x="${panels.notes.x + 70}" y="${panels.notes.y + 109 + i * 62}" fill="${ink}" font-size="21" font-weight="780" font-family="${font}">${escapeSvgText(item)}</text>
        </g>
      `).join('')}
      <rect x="${panels.notes.x + 20}" y="${panels.notes.y + 424}" width="${panels.notes.w - 40}" height="1.8" fill="${line}"/>
      <text x="${panels.notes.x + 26}" y="${panels.notes.y + 478}" fill="${ink}" font-size="28" font-weight="900" font-family="${font}">灯光建议</text>
      <rect x="${panels.notes.x + 80}" y="${panels.notes.y + 560}" width="${panels.notes.w - 160}" height="150" rx="8" fill="#f2ece4" stroke="${line}" stroke-width="1.5"/>
      <rect x="${panels.notes.x + 224}" y="${panels.notes.y + 678}" width="${panels.notes.w - 448}" height="38" rx="4" fill="#d8c8b9"/>
      ${[['LED帕灯', '#8f77ff', 120, 548], ['光束灯', '#f4c04d', 204, 516], ['追光灯', '#78a8ff', 288, 548], ['洗墙灯', '#f08a63', 372, 516]].map(([name, color, dx, dy], i) => `
        <circle cx="${panels.notes.x + dx}" cy="${panels.notes.y + dy}" r="15" fill="${color}"/>
        <text x="${panels.notes.x + 454}" y="${panels.notes.y + 566 + i * 42}" fill="${muted}" font-size="19" font-weight="760" font-family="${font}">${escapeSvgText(name)}</text>
      `).join('')}
      ${configTable}
      <text x="50" y="4026" fill="${muted}" font-size="21" font-weight="720" font-family="${font}">注：本方案为参考施工交底图，具体尺寸、材料型号、数量与报价以现场复尺和最终确认清单为准。</text>
      ${imagePanelBorders}
    </svg>`;
}

function constructionChecklistTextMaskSvg(width, height) {
  const { width: baseWidth, height: baseHeight, panels } = constructionChecklistBoardLayout();
  const line = '#cdbdae';
  const card = (r, fill = '#fffdf9', opacity = 0.985) => `
    <rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="12" fill="${fill}" fill-opacity="${opacity}" stroke="${line}" stroke-width="2.2"/>
  `;
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${baseWidth} ${baseHeight}">
      ${card(panels.overview)}
      ${card(panels.highlights)}
      ${card(panels.table)}
      ${card(panels.notes)}
      ${card(panels.config)}
      <rect x="${panels.tech.x}" y="${panels.tech.y}" width="${panels.tech.w}" height="52" rx="10" fill="#9b8978" fill-opacity="0.98"/>
      <rect x="${panels.materials.x}" y="${panels.materials.y}" width="${panels.materials.w}" height="52" rx="10" fill="#9b8978" fill-opacity="0.98"/>
      <rect x="${panels.steps.x}" y="${panels.steps.y}" width="${panels.steps.w}" height="52" rx="10" fill="#9b8978" fill-opacity="0.98"/>
    </svg>`;
}

async function resizePanelImage(inputPath, rect, options = {}) {
  return sharp(inputPath, { failOn: 'none' })
    .rotate()
    .resize(rect.width, rect.height, {
      fit: options.fit || 'cover',
      background: options.background || '#fffdf9',
      kernel: sharp.kernel.lanczos3,
    })
    .sharpen({ sigma: 0.45, m1: 0.5, m2: 1.2 })
    .png({ compressionLevel: 8, adaptiveFiltering: true })
    .toBuffer();
}

function sourcePercentCrop(meta, crop) {
  const width = Number(meta?.width || 1);
  const height = Number(meta?.height || 1);
  const left = Math.max(0, Math.min(width - 1, Math.round(width * crop.x)));
  const top = Math.max(0, Math.min(height - 1, Math.round(height * crop.y)));
  return {
    left,
    top,
    width: Math.max(1, Math.min(Math.round(width * crop.w), width - left)),
    height: Math.max(1, Math.min(Math.round(height * crop.h), height - top)),
  };
}

async function cropReferencePanel(sourcePath, sourceMeta, crop, rect, options = {}) {
  return sharp(sourcePath, { failOn: 'none' })
    .rotate()
    .extract(sourcePercentCrop(sourceMeta, crop))
    .resize(rect.width, rect.height, {
      fit: options.fit || 'cover',
      position: options.position || 'center',
      background: options.background || '#fffdf9',
      kernel: sharp.kernel.lanczos3,
    })
    .sharpen({ sigma: 0.45, m1: 0.45, m2: 1.1 })
    .png({ compressionLevel: 8, adaptiveFiltering: true })
    .toBuffer();
}

function isSingleEffectChecklistSource(meta) {
  const width = Number(meta?.width || 0);
  const height = Number(meta?.height || 0);
  if (!width || !height) return false;
  const aspect = width / height;
  return aspect >= 1.05 || height / width < 1.15;
}

function constructionChecklistEffectTechnicalSvg(width, height) {
  const font = 'Microsoft YaHei, Noto Sans CJK SC, PingFang SC, Arial, sans-serif';
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 2976 760">
      <defs>
        <linearGradient id="paperTech" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#fffdf9"/>
          <stop offset="1" stop-color="#eee3d8"/>
        </linearGradient>
        <linearGradient id="drapeTech" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#41201b"/>
          <stop offset="0.45" stop-color="#9a5a36"/>
          <stop offset="1" stop-color="#2b1716"/>
        </linearGradient>
      </defs>
      <rect width="2976" height="760" fill="url(#paperTech)"/>
      <line x1="992" y1="52" x2="992" y2="760" stroke="#cdbdae" stroke-width="2"/>
      <line x1="1984" y1="52" x2="1984" y2="760" stroke="#cdbdae" stroke-width="2"/>
      <g transform="translate(64 138)">
        <rect x="210" y="78" width="470" height="128" rx="10" fill="#4a2b26" stroke="#211a16" stroke-width="5"/>
        <path d="M358 206 L238 562 H650 L528 206 Z" fill="#8d6964" fill-opacity="0.72" stroke="#211a16" stroke-width="4"/>
        <path d="M283 270 C386 302 500 302 604 270" fill="none" stroke="#d7b58a" stroke-width="14" opacity="0.72"/>
        <path d="M270 352 C388 382 512 382 626 352" fill="none" stroke="#f3e3d8" stroke-width="13" opacity="0.8"/>
        ${Array.from({ length: 30 }, (_, i) => {
          const side = i % 2 ? 1 : -1;
          const x = 444 + side * (86 + (i % 5) * 56);
          const y = 260 + Math.floor(i / 6) * 62;
          const r = 16 + (i % 4) * 5;
          return `<circle cx="${x}" cy="${y}" r="${r}" fill="${i % 3 ? '#f3d4dc' : '#fff8ef'}" stroke="#a88979" stroke-width="2"/>`;
        }).join('')}
        ${Array.from({ length: 8 }, (_, i) => {
          const x = 92 + i * 104;
          return `<circle cx="${x}" cy="406" r="28" fill="#f3d4dc" opacity="0.72"/><circle cx="${x + 36}" cy="430" r="24" fill="#fff8ef" opacity="0.82"/>`;
        }).join('')}
      </g>
      <g transform="translate(1064 142)">
        <rect x="92" y="146" width="720" height="276" rx="8" fill="url(#drapeTech)" opacity="0.94"/>
        ${Array.from({ length: 12 }, (_, i) => {
          const x = 112 + i * 58;
          return `<path d="M${x} 150 C${x + 36} 220, ${x - 24} 320, ${x + 20} 420" fill="none" stroke="#d5a06d" stroke-width="${8 + (i % 3) * 4}" opacity="0.72"/>`;
        }).join('')}
        <path d="M392 190 C320 270 324 366 418 402 C520 442 604 374 560 282 C536 232 472 204 392 190 Z" fill="#f9f4ee" opacity="0.92"/>
        <path d="M176 432 C306 392 584 392 734 432" fill="none" stroke="#f4d2d9" stroke-width="36" stroke-linecap="round"/>
        <path d="M196 476 C330 438 570 438 712 476" fill="none" stroke="#fff8ef" stroke-width="26" stroke-linecap="round"/>
        ${Array.from({ length: 7 }, (_, i) => `<line x1="${144 + i * 96}" y1="54" x2="${214 + i * 78}" y2="136" stroke="#eee7df" stroke-width="5" opacity="0.76"/>`).join('')}
      </g>
      <g transform="translate(2058 150)">
        <path d="M206 504 L510 168 L676 168 L398 504 Z" fill="#8d6964" fill-opacity="0.76" stroke="#211a16" stroke-width="4"/>
        <rect x="516" y="150" width="292" height="110" rx="6" fill="#4a2b26" stroke="#211a16" stroke-width="4"/>
        <rect x="520" y="260" width="292" height="38" fill="#301b18"/>
        <path d="M522 148 C604 206 724 206 806 148" fill="none" stroke="#d5a06d" stroke-width="20" opacity="0.72"/>
        <path d="M258 498 C326 396 430 334 566 312" fill="none" stroke="#f3d4dc" stroke-width="34" stroke-linecap="round"/>
        <path d="M192 510 C296 454 470 408 664 390" fill="none" stroke="#fff8ef" stroke-width="20" stroke-linecap="round"/>
        <line x1="626" y1="40" x2="626" y2="150" stroke="#211a16" stroke-width="4" stroke-dasharray="10 10" opacity="0.5"/>
      </g>
      <text x="1488" y="724" fill="#766a61" font-size="22" font-weight="760" text-anchor="middle" font-family="${font}">示意图仅锁定结构关系，实际尺寸以现场复尺深化图为准</text>
    </svg>`;
}

async function createCroppedMosaicPanel(sourcePath, sourceMeta, crops, rect, cols, rows) {
  const composites = [];
  for (let i = 0; i < cols * rows; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = Math.round((rect.width / cols) * col);
    const y = Math.round((rect.height / rows) * row);
    const nextX = col === cols - 1 ? rect.width : Math.round((rect.width / cols) * (col + 1));
    const nextY = row === rows - 1 ? rect.height : Math.round((rect.height / rows) * (row + 1));
    const cell = { width: Math.max(1, nextX - x), height: Math.max(1, nextY - y) };
    composites.push({
      input: await cropReferencePanel(sourcePath, sourceMeta, crops[i % crops.length], cell, { fit: 'cover', position: 'center' }),
      left: x,
      top: y,
    });
  }
  return sharp({
    create: {
      width: rect.width,
      height: rect.height,
      channels: 3,
      background: '#f8f1ea',
    },
  })
    .composite(composites)
    .png({ compressionLevel: 8, adaptiveFiltering: true })
    .toBuffer();
}

async function createConstructionChecklistFromEffectPhotoExports(job, outputDir, sourcePath, sourceMeta) {
  const targetWidth = CONSTRUCTION_CHECKLIST_HD_WIDTH;
  const { width: layoutWidth, height: layoutHeight, panels } = constructionChecklistBoardLayout();
  const targetHeight = Math.round(targetWidth * layoutHeight / layoutWidth);
  const baseToTarget = (rect) => scalePanelRect(rect, targetWidth, targetHeight);
  const materialCrops = [
    { x: 0.00, y: 0.00, w: 1.00, h: 1.00 },
    { x: 0.08, y: 0.06, w: 0.34, h: 0.42 },
    { x: 0.34, y: 0.14, w: 0.32, h: 0.44 },
    { x: 0.58, y: 0.06, w: 0.34, h: 0.42 },
    { x: 0.00, y: 0.43, w: 0.36, h: 0.52 },
    { x: 0.32, y: 0.38, w: 0.36, h: 0.54 },
    { x: 0.64, y: 0.43, w: 0.36, h: 0.52 },
    { x: 0.00, y: 0.30, w: 0.22, h: 0.38 },
    { x: 0.78, y: 0.30, w: 0.22, h: 0.38 },
  ];
  const stepCrops = [
    { x: 0.00, y: 0.00, w: 1.00, h: 1.00 },
    { x: 0.10, y: 0.12, w: 0.34, h: 0.44 },
    { x: 0.34, y: 0.10, w: 0.32, h: 0.42 },
    { x: 0.56, y: 0.12, w: 0.36, h: 0.44 },
    { x: 0.10, y: 0.48, w: 0.36, h: 0.42 },
    { x: 0.54, y: 0.48, w: 0.36, h: 0.42 },
  ];

  updateJob(job, 72, '正在按效果图合成施工清单', '[compose] 检测到单张效果图，锁定原图主视觉并裁切原图细节');
  const composites = [
    { input: Buffer.from(constructionChecklistUnderlaySvg(targetWidth, targetHeight)), left: 0, top: 0 },
  ];

  const heroRect = baseToTarget(panels.hero);
  composites.push({
    input: await cropReferencePanel(sourcePath, sourceMeta, { x: 0, y: 0, w: 1, h: 1 }, heroRect, { fit: 'contain', background: '#050505' }),
    left: heroRect.left,
    top: heroRect.top,
  });

  const techRect = baseToTarget(panels.tech);
  composites.push({
    input: Buffer.from(constructionChecklistEffectTechnicalSvg(techRect.width, techRect.height)),
    left: techRect.left,
    top: techRect.top,
  });

  const materialRect = baseToTarget(panels.materials);
  composites.push({
    input: await createCroppedMosaicPanel(sourcePath, sourceMeta, materialCrops, materialRect, 3, 3),
    left: materialRect.left,
    top: materialRect.top,
  });

  const stepRect = baseToTarget(panels.steps);
  composites.push({
    input: await createCroppedMosaicPanel(sourcePath, sourceMeta, stepCrops, stepRect, 3, 2),
    left: stepRect.left,
    top: stepRect.top,
  });

  composites.push({ input: Buffer.from(constructionChecklistTextMaskSvg(targetWidth, targetHeight)), left: 0, top: 0 });
  composites.push({ input: Buffer.from(constructionChecklistFinalOverlaySvgV2(targetWidth, targetHeight)), left: 0, top: 0 });

  const filename = 'construction-checklist-hd.png';
  const info = await sharp({
    create: {
      width: targetWidth,
      height: targetHeight,
      channels: 3,
      background: '#fffdf9',
    },
  })
    .composite(composites)
    .png({ compressionLevel: 8, adaptiveFiltering: true })
    .toFile(path.join(outputDir, filename));

  const images = [{
    label: '落地施工清单图（高清整图）',
    filename,
    url: publicUrl(job.id, filename),
    downloadUrl: downloadUrl(job.id, filename),
    width: info.width || targetWidth,
    height: info.height || targetHeight,
  }];

  if (CONSTRUCTION_CHECKLIST_DETAIL_EXPORTS) {
    const crops = [
      { key: 'hero-render', label: '效果示意高清分区', rect: panels.hero, outWidth: 3200 },
      { key: 'technical-views', label: '平立面技术视图高清分区', rect: panels.tech, outWidth: 3600 },
      { key: 'material-list', label: '物料清单高清分区', rect: panels.table, outWidth: 2800 },
      { key: 'material-details', label: '物料细节高清分区', rect: panels.materials, outWidth: 2800 },
      { key: 'build-steps', label: '搭建步骤高清分区', rect: panels.steps, outWidth: 2800 },
      { key: 'safety-notes', label: '注意事项高清分区', rect: panels.notes, outWidth: 1800 },
    ];
    for (const crop of crops) {
      const scaled = scalePanelRect(crop.rect, info.width || targetWidth, info.height || targetHeight);
      const detailFilename = `construction-checklist-${crop.key}.png`;
      const cropInfo = await sharp(path.join(outputDir, filename), { failOn: 'none' })
        .extract({ left: scaled.left, top: scaled.top, width: scaled.width, height: scaled.height })
        .resize({ width: crop.outWidth, kernel: sharp.kernel.lanczos3 })
        .png({ compressionLevel: 8, adaptiveFiltering: true })
        .toFile(path.join(outputDir, detailFilename));
      images.push({
        label: crop.label,
        filename: detailFilename,
        url: publicUrl(job.id, detailFilename),
        downloadUrl: downloadUrl(job.id, detailFilename),
        width: cropInfo.width || crop.outWidth,
        height: cropInfo.height || Math.round(crop.outWidth * scaled.height / scaled.width),
      });
    }
  }

  job.partialImages = images.map(({ label, url, filename: itemFilename, downloadUrl, width, height }) => ({
    label,
    url,
    filename: itemFilename,
    downloadUrl,
    width,
    height,
  }));
  updateJob(job, 90, '落地施工清单图已合成', '[compose] 已使用原效果图主视觉和细节裁切，避免清单图改风格');
  return images;
}

async function createConstructionChecklistFromMatrixExports(job, outputDir) {
  const sourcePath = path.join(outputDir, job.reference?.storedFilename || 'reference.jpg');
  if (!existsSync(sourcePath)) throw new Error('缺少方案施工矩阵参考图，请重新上传后生成');

  const targetWidth = CONSTRUCTION_CHECKLIST_HD_WIDTH;
  const { width: layoutWidth, height: layoutHeight, panels } = constructionChecklistBoardLayout();
  const targetHeight = Math.round(targetWidth * layoutHeight / layoutWidth);
  const meta = await sharp(sourcePath, { failOn: 'none' }).metadata();
  if (isSingleEffectChecklistSource(meta)) {
    return createConstructionChecklistFromEffectPhotoExports(job, outputDir, sourcePath, meta);
  }
  const techCellW = panels.tech.w / 3;
  const techContentY = panels.tech.y + 92;
  const techContentH = panels.tech.h - 128;
  const techRects = [
    { x: panels.tech.x + 28, y: techContentY, w: techCellW - 56, h: techContentH },
    { x: panels.tech.x + techCellW + 28, y: techContentY, w: techCellW - 56, h: techContentH },
    { x: panels.tech.x + techCellW * 2 + 28, y: techContentY, w: techCellW - 56, h: techContentH },
  ];
  const stepsContent = { x: panels.steps.x + 18, y: panels.steps.y + 70, w: panels.steps.w - 36, h: panels.steps.h - 112 };
  const materialContent = { x: panels.materials.x + 18, y: panels.materials.y + 70, w: panels.materials.w - 36, h: panels.materials.h - 94 };
  const materialImageArea = { x: panels.table.x + 18, y: panels.table.y + 70, w: 172, h: panels.table.h - 104 };

  const baseToTarget = (rect) => scalePanelRect(rect, targetWidth, targetHeight);
  const crops = {
    hero: { x: 0.00, y: 0.02, w: 0.66, h: 0.335 },
    front: { x: 0.685, y: 0.055, w: 0.29, h: 0.125 },
    plan: { x: 0.700, y: 0.230, w: 0.26, h: 0.115 },
    exploded: { x: 0.175, y: 0.400, w: 0.46, h: 0.350 },
    details: { x: 0.690, y: 0.390, w: 0.285, h: 0.375 },
    components: { x: 0.02, y: 0.825, w: 0.96, h: 0.155 },
  };

  updateJob(job, 72, '正在整理施工矩阵为清单版式', '[compose] 直接裁切方案施工矩阵，不重新生图');
  const composites = [
    { input: Buffer.from(constructionChecklistUnderlaySvg(targetWidth, targetHeight)), left: 0, top: 0 },
  ];

  const addCrop = async (crop, rect, options = {}) => {
    const targetRect = baseToTarget(rect);
    composites.push({
      input: await cropReferencePanel(sourcePath, meta, crop, targetRect, options),
      left: targetRect.left,
      top: targetRect.top,
    });
  };

  await addCrop(crops.hero, panels.hero, { fit: 'cover', position: 'center' });
  await addCrop(crops.plan, techRects[0], { fit: 'contain', background: '#fffdf9' });
  await addCrop(crops.front, techRects[1], { fit: 'contain', background: '#fffdf9' });
  await addCrop(crops.exploded, techRects[2], { fit: 'contain', background: '#fffdf9', position: 'top' });
  await addCrop(crops.components, materialContent, { fit: 'cover', position: 'center' });
  await addCrop(crops.exploded, stepsContent, { fit: 'cover', position: 'center' });
  await addCrop(crops.components, materialImageArea, { fit: 'cover', position: 'left' });

  composites.push({ input: Buffer.from(constructionChecklistTextMaskSvg(targetWidth, targetHeight)), left: 0, top: 0 });
  composites.push({ input: Buffer.from(constructionChecklistFinalOverlaySvgV2(targetWidth, targetHeight)), left: 0, top: 0 });

  const filename = 'construction-checklist-hd.png';
  const info = await sharp({
    create: {
      width: targetWidth,
      height: targetHeight,
      channels: 3,
      background: '#fffdf9',
    },
  })
    .composite(composites)
    .png({ compressionLevel: 8, adaptiveFiltering: true })
    .toFile(path.join(outputDir, filename));

  const images = [{
    label: '落地施工清单图（高清整图）',
    filename,
    url: publicUrl(job.id, filename),
    downloadUrl: downloadUrl(job.id, filename),
    width: info.width || targetWidth,
    height: info.height || targetHeight,
  }];
  job.partialImages = images.map(({ label, url, filename: itemFilename, downloadUrl, width, height }) => ({
    label,
    url,
    filename: itemFilename,
    downloadUrl,
    width,
    height,
  }));
  updateJob(job, 90, '落地施工清单图已合成', '[compose] 已使用矩阵图原始内容重排，避免模型重绘失真');
  return images;
}

async function createConstructionChecklistCompositeExports(job, outputDir, images) {
  const targetWidth = CONSTRUCTION_CHECKLIST_HD_WIDTH;
  const { width: layoutWidth, height: layoutHeight, panels } = constructionChecklistBoardLayout();
  const targetHeight = Math.round(targetWidth * layoutHeight / layoutWidth);
  const required = [0, 1, 2, 3].map((index) => images[index]).filter((item) => item?.filename);
  if (required.length < 4) return images;

  updateJob(job, 86, '正在合成落地施工交付板', '[compose] 施工清单分区图 + SVG 稳定标签表格');
  const imageComposites = [
    { item: images[0], rect: scalePanelRect(panels.hero, targetWidth, targetHeight), fit: 'cover' },
    { item: images[1], rect: scalePanelRect(panels.tech, targetWidth, targetHeight), fit: 'cover' },
    { item: images[2], rect: scalePanelRect(panels.materials, targetWidth, targetHeight), fit: 'cover' },
    { item: images[3], rect: scalePanelRect(panels.steps, targetWidth, targetHeight), fit: 'cover' },
  ];
  const composites = [
    { input: Buffer.from(constructionChecklistUnderlaySvg(targetWidth, targetHeight)), left: 0, top: 0 },
  ];
  for (const entry of imageComposites) {
    composites.push({
      input: await resizePanelImage(path.join(outputDir, entry.item.filename), entry.rect, { fit: entry.fit }),
      left: entry.rect.left,
      top: entry.rect.top,
    });
  }
  composites.push({ input: Buffer.from(constructionChecklistFinalOverlaySvgV2(targetWidth, targetHeight)), left: 0, top: 0 });

  const hdFilename = 'construction-checklist-hd.png';
  const info = await sharp({
    create: {
      width: targetWidth,
      height: targetHeight,
      channels: 3,
      background: '#f6efe6',
    },
  })
    .composite(composites)
    .png({ compressionLevel: 8, adaptiveFiltering: true })
    .toFile(path.join(outputDir, hdFilename));

  images[0] = {
    ...images[0],
    label: '落地施工清单图（高清整图）',
    filename: hdFilename,
    url: publicUrl(job.id, hdFilename),
    downloadUrl: downloadUrl(job.id, hdFilename),
    width: info.width || targetWidth,
    height: info.height || targetHeight,
  };

  if (CONSTRUCTION_CHECKLIST_DETAIL_EXPORTS) {
    const crops = [
      { key: 'hero-render', label: '效果示意高清分区', rect: panels.hero, outWidth: 3200 },
      { key: 'technical-views', label: '平立面技术视图高清分区', rect: panels.tech, outWidth: 3600 },
      { key: 'material-details', label: '物料细节高清分区', rect: panels.materials, outWidth: 2600 },
      { key: 'build-steps', label: '搭建步骤灯光高清分区', rect: panels.steps, outWidth: 3400 },
      { key: 'material-list', label: '物料清单高清分区', rect: panels.table, outWidth: 3000 },
    ];
    for (const crop of crops) {
      const scaled = scalePanelRect(crop.rect, targetWidth, targetHeight);
      const filename = `construction-checklist-${crop.key}.png`;
      const cropInfo = await sharp(path.join(outputDir, hdFilename), { failOn: 'none' })
        .extract({ left: scaled.left, top: scaled.top, width: scaled.width, height: scaled.height })
        .resize({ width: crop.outWidth, kernel: sharp.kernel.lanczos3 })
        .png({ compressionLevel: 8, adaptiveFiltering: true })
        .toFile(path.join(outputDir, filename));
      images.push({
        label: crop.label,
        filename,
        url: publicUrl(job.id, filename),
        downloadUrl: downloadUrl(job.id, filename),
        width: cropInfo.width || crop.outWidth,
        height: cropInfo.height || Math.round(crop.outWidth * scaled.height / scaled.width),
      });
    }
  }

  job.partialImages = images.map(({ label, url, filename, downloadUrl, width, height }) => ({
    label,
    url,
    filename,
    downloadUrl,
    width,
    height,
  }));
  return images;
}

function constructionChecklistOverlaySvg(width, height) {
  const font = 'Microsoft YaHei, Noto Sans CJK SC, PingFang SC, Arial, sans-serif';
  const red = '#971f22';
  const ink = '#222222';
  const line = '#b7b7b7';
  const tag = (x, y, text, w = 86) => `
    <g>
      <rect x="${x}" y="${y}" width="${w}" height="25" fill="${red}"/>
      <text x="${x + 10}" y="${y + 18}" fill="#fff" font-size="15" font-weight="900" font-family="${font}">${escapeSvgText(text)}</text>
    </g>`;
  const materialRows = [
    ['1', '舞台背景结构', '24mW×8mH', '套', '1', '定制雕花+拱门'],
    ['2', '波浪镜面T台', '16mL×2.4mW', '套', '1', '黑色镜面'],
    ['3', '花艺装饰（红白）', '按需', '项', '1', '主花材：红玫瑰/白花'],
    ['4', '水晶吊灯', '按需', '盏', '18+', '吊挂6层'],
    ['5', '垂坠水晶/链条', '按需', '项', '1', '金色/透明'],
    ['6', '烛台灯组', '按需', '组', '20+', 'LED仿真蜡烛'],
    ['7', '喷泉装置', '直径1.8m', '套', '2', '循环水泵'],
    ['8', '红色绒布吊顶', '按需', '项', '1', '波浪造型'],
    ['9', '配电及辅料', '63A/380V', '批', '1', '电箱/线缆/压线槽'],
    ['10', '灯光音响系统', '按需', '项', '1', '舞台灯光+音响'],
  ];
  const table = {
    x: 36,
    y: 594,
    w: 420,
    h: 235,
    cols: [0, 45, 170, 270, 315, 360, 420],
    headerH: 26,
    rowH: 19.6,
  };
  const cellText = (text, x, y, size = 10, weight = 800, anchor = 'middle') => (
    `<text x="${x}" y="${y}" fill="${ink}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" font-family="${font}">${escapeSvgText(text)}</text>`
  );
  const materialTable = `
    <g>
      <rect x="${table.x}" y="${table.y}" width="${table.w}" height="${table.h}" fill="#fff" fill-opacity="0.985" stroke="#8d8d8d" stroke-width="1"/>
      ${tag(table.x, table.y, '物料清单', 96)}
      <rect x="${table.x}" y="${table.y + 25}" width="${table.w}" height="${table.headerH}" fill="#eee9e5"/>
      ${table.cols.slice(1, -1).map((col) => `<line x1="${table.x + col}" y1="${table.y + 25}" x2="${table.x + col}" y2="${table.y + table.h}" stroke="${line}" stroke-width="1"/>`).join('')}
      ${Array.from({ length: 11 }, (_, i) => {
        const y = table.y + 25 + table.headerH + i * table.rowH;
        return `<line x1="${table.x}" y1="${y}" x2="${table.x + table.w}" y2="${y}" stroke="${line}" stroke-width="1"/>`;
      }).join('')}
      ${['序号', '物料名称', '规格/尺寸', '单位', '数量', '备注'].map((head, i) => {
        const x = table.x + (table.cols[i] + table.cols[i + 1]) / 2;
        return cellText(head, x, table.y + 43, 10.2, 900);
      }).join('')}
      ${materialRows.map((row, r) => row.map((text, c) => {
        const x = table.x + (table.cols[c] + table.cols[c + 1]) / 2;
        const y = table.y + 25 + table.headerH + r * table.rowH + 13.5;
        const size = c === 5 ? 8.5 : 9.5;
        return cellText(text, x, y, size, 760);
      }).join('')).join('')}
    </g>`;
  const notes = [
    ['结构安全', '桁架牢固固定', '承重点加固处理'],
    ['用电安全', '线路照明细查', '线材绝缘防漏电'],
    ['防火安全', '避开明火热源', '配备灭火器材'],
    ['防滑防跌', '台阶边缘处理', '地面保持干燥'],
    ['人员安全', '高空作业佩戴安全绳', '现场设置警戒线'],
    ['时间管理', '预留调试时间', '按进度施工'],
  ];
  const notesX = 464;
  const notesY = 733;
  const noteW = 1000 / notes.length;
  const safetyNotes = `
    <g>
      <rect x="${notesX}" y="${notesY}" width="1000" height="97" fill="#fff" fill-opacity="0.985" stroke="#8d8d8d" stroke-width="1"/>
      ${tag(notesX, notesY, '注意事项', 98)}
      ${notes.map((note, i) => {
        const x = notesX + i * noteW;
        const cx = x + 38;
        return `
          <g>
            ${i ? `<line x1="${x}" y1="${notesY + 34}" x2="${x}" y2="${notesY + 88}" stroke="${line}" stroke-width="1"/>` : ''}
            <circle cx="${cx}" cy="${notesY + 58}" r="18" fill="none" stroke="${red}" stroke-width="3"/>
            <text x="${cx}" y="${notesY + 64}" fill="${red}" font-size="20" font-weight="900" text-anchor="middle" font-family="${font}">${i + 1}</text>
            <text x="${x + 70}" y="${notesY + 50}" fill="${red}" font-size="13" font-weight="900" font-family="${font}">${escapeSvgText(note[0])}</text>
            <text x="${x + 70}" y="${notesY + 68}" fill="${ink}" font-size="10" font-weight="760" font-family="${font}">${escapeSvgText(note[1])}</text>
            <text x="${x + 70}" y="${notesY + 83}" fill="${ink}" font-size="10" font-weight="760" font-family="${font}">${escapeSvgText(note[2])}</text>
          </g>`;
      }).join('')}
    </g>`;
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1536 864">
      <rect x="0" y="0" width="1536" height="42" fill="#fff" fill-opacity="0.98"/>
      <rect x="36" y="18" width="9" height="24" fill="${red}"/>
      <text x="55" y="39" fill="#111" font-size="26" font-weight="900" font-family="${font}">落地施工清单图</text>
      ${tag(36, 54, '效果示意', 96)}
      ${tag(902, 54, '材料细节', 112)}
      ${tag(36, 390, '平面布置', 96)}
      ${tag(496, 390, '正立面', 84)}
      ${tag(1078, 390, '侧立面', 84)}
      ${tag(464, 594, '搭建步骤', 98)}
      ${materialTable}
      ${safetyNotes}
    </svg>`;
}

async function createConstructionChecklistReadableExports(job, outputDir, images) {
  if ((images || []).filter((item) => item?.filename).length >= 4) {
    return createConstructionChecklistCompositeExports(job, outputDir, images);
  }

  if (!images?.[0]?.filename) return images;
  const source = path.join(outputDir, images[0].filename);
  if (!existsSync(source)) return images;

  updateJob(job, 86, '正在合成落地施工交付板', '[compose] 1 张施工矩阵转清单底图 + SVG 稳定标签表格');
  const meta = await sharp(source, { failOn: 'none' }).metadata();
  const sourceWidth = Number(meta.width || images[0].width || 0);
  const sourceHeight = Number(meta.height || images[0].height || 0);
  if (!sourceWidth || !sourceHeight) return images;

  const hdFilename = 'construction-checklist-hd.png';
  const { width: layoutWidth, height: layoutHeight, panels } = constructionChecklistBoardLayout();
  const targetWidth = CONSTRUCTION_CHECKLIST_HD_WIDTH;
  const targetHeight = Math.round(targetWidth * layoutHeight / layoutWidth);
  const mask = Buffer.from(constructionChecklistTextMaskSvg(targetWidth, targetHeight));
  const overlay = Buffer.from(constructionChecklistFinalOverlaySvgV2(targetWidth, targetHeight));
  const hdInfo = await sharp(source, { failOn: 'none' })
    .rotate()
    .resize(targetWidth, targetHeight, {
      fit: 'cover',
      position: 'center',
      background: '#fffdf9',
      kernel: sharp.kernel.lanczos3,
    })
    .sharpen({ sigma: 0.6, m1: 0.7, m2: 1.6 })
    .composite([
      { input: mask, left: 0, top: 0 },
      { input: overlay, left: 0, top: 0 },
    ])
    .png({ compressionLevel: 8, adaptiveFiltering: true })
    .toFile(path.join(outputDir, hdFilename));
  const detailSource = path.join(outputDir, hdFilename);
  const detailMeta = {
    width: hdInfo.width || targetWidth,
    height: hdInfo.height || targetHeight,
  };

  images[0] = {
    ...images[0],
    label: '落地施工清单图（高清整图）',
    filename: hdFilename,
    url: publicUrl(job.id, hdFilename),
    downloadUrl: downloadUrl(job.id, hdFilename),
    width: detailMeta.width,
    height: detailMeta.height,
  };

  if (CONSTRUCTION_CHECKLIST_DETAIL_EXPORTS) {
    const crops = [
      { key: 'hero-render', label: '效果示意高清分区', rect: panels.hero, outWidth: 3200 },
      { key: 'technical-views', label: '平立面高清分区', rect: panels.tech, outWidth: 3600 },
      { key: 'material-list', label: '物料清单高清分区', rect: panels.table, outWidth: 2800 },
      { key: 'material-details', label: '材质细节高清分区', rect: panels.materials, outWidth: 2800 },
      { key: 'build-steps', label: '搭建步骤高清分区', rect: panels.steps, outWidth: 2800 },
      { key: 'safety-notes', label: '注意事项高清分区', rect: panels.notes, outWidth: 1800 },
    ];

    for (const crop of crops) {
      const scaled = scalePanelRect(crop.rect, detailMeta.width, detailMeta.height);
      const region = {
        left: Math.max(0, Math.min(detailMeta.width - 1, scaled.left)),
        top: Math.max(0, Math.min(detailMeta.height - 1, scaled.top)),
        width: Math.max(1, Math.min(scaled.width, detailMeta.width - scaled.left)),
        height: Math.max(1, Math.min(scaled.height, detailMeta.height - scaled.top)),
      };
      const filename = `construction-checklist-${crop.key}.png`;
      const info = await sharp(detailSource, { failOn: 'none' })
        .rotate()
        .extract(region)
        .resize({ width: crop.outWidth, kernel: sharp.kernel.lanczos3 })
        .sharpen({ sigma: 0.55, m1: 0.7, m2: 1.5 })
        .png({ compressionLevel: 8, adaptiveFiltering: true })
        .toFile(path.join(outputDir, filename));
      images.push({
        label: crop.label,
        filename,
        url: publicUrl(job.id, filename),
        downloadUrl: downloadUrl(job.id, filename),
        width: info.width || crop.outWidth,
        height: info.height || Math.round(crop.outWidth * region.height / region.width),
      });
    }
  }

  job.partialImages = images.map(({ label, url, filename, downloadUrl, width, height }) => ({
    label,
    url,
    filename,
    downloadUrl,
    width,
    height,
  }));
  return images;
}

async function createPsLayerSplitPreviewBoard(job, outputDir, images = []) {
  const layerImages = (Array.isArray(images) ? images : []).filter((image) => image?.filename).slice(0, 6);
  if (!layerImages.length) {
    updateJob(job, 88, 'PS白底分层素材已生成', '[compose] PS分层预览缺少图层文件，保留 PNG 图层包');
    return '';
  }

  updateJob(job, 88, '正在生成PS素材分屏预览', '[compose] 正在生成 2x3 白底分屏预览图');

  const cols = 2;
  const rows = Math.max(1, Math.ceil(layerImages.length / cols));
  const cellW = 900;
  const cellH = 360;
  const line = 2;
  const canvasWidth = cols * cellW + (cols + 1) * line;
  const canvasHeight = rows * cellH + (rows + 1) * line;
  const white = { r: 255, g: 255, b: 255, alpha: 1 };

  const composites = [];
  for (let index = 0; index < rows * cols; index += 1) {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const image = layerImages[index];
    const left = line + col * (cellW + line);
    const top = line + row * (cellH + line);
    let input;
    if (image?.filename) {
      input = await sharp(path.join(outputDir, image.filename), { failOn: 'none' })
        .resize(cellW, cellH, { fit: 'contain', background: white })
        .flatten({ background: white })
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer();
    } else {
      input = await sharp({
        create: {
          width: cellW,
          height: cellH,
          channels: 4,
          background: white,
        },
      }).png().toBuffer();
    }
    composites.push({ input, left, top });
  }

  const filename = 'ps-layer-split-preview.png';
  await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
      background: { r: 148, g: 151, b: 156, alpha: 1 },
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(path.join(outputDir, filename));

  job.logs.push('[compose] 已生成 PS 分层 2x3 白底大预览 ps-layer-split-preview.png');
  return publicUrl(job.id, filename);
}

async function createCollage(job, outputDir, images) {
  if (job.mode === 'cinematic_storyboard') {
    return createStoryboardBoard(job, outputDir, images);
  }
  if (job.mode === 'setup_comparison') {
    return createSetupComparisonBoard(job, outputDir, images);
  }
  if (job.mode === 'design_render_scene') {
    updateJob(job, 88, '实景图已生成', '[compose] 设计图转实景模式跳过合成图，保留 1 张真实现场图');
    return '';
  }
  if (job.mode === 'venue_fusion') {
    updateJob(job, 88, '空地婚礼融合图已生成', '[compose] 空地婚礼融合模式跳过拼图，保留 1 张融合效果图');
    return '';
  }
  if (job.mode === 'similar_style') {
    updateJob(job, 88, '同款延伸已生成', '[compose] 同款婚礼延伸模式跳过拼图，保留 1 张同款延伸图');
    return '';
  }
  if (isFreeImageMode(job.mode)) {
    updateJob(job, 88, `${MODE_LABELS[job.mode] || '自由创作图片'}已生成`, '[compose] 自由创作图片跳过拼图，保留原始生成图');
    return '';
  }
  if (job.mode === 'detail_grid') {
    updateJob(job, 88, '同舞台九宫格已生成', '[compose] 九宫格GPT生图模式跳过叠字，保留模型输出相册');
    return '';
  }
  if (isSetupProcessGridMode(job.mode)) {
    updateJob(job, 88, `${MODE_LABELS[job.mode] || '搭建过程九宫格'}已生成`, `[compose] ${MODE_LABELS[job.mode] || job.mode}模式跳过叠字，保留模型输出过程图`);
    return '';
  }
  if (job.mode === 'product_matrix') {
    try {
      await enhanceConstructionMatrixImage(job, outputDir, images);
    } catch (error) {
      job.logs.push(`[compose] 施工矩阵栏目叠加失败，保留原始生成图：${String(error?.message || error).slice(0, 160)}`);
    }
    updateJob(job, 88, '方案施工矩阵图已生成', '[compose] 方案施工矩阵模式跳过拼图，保留 1 张竖版整合板');
    return '';
  }
  if (job.mode === 'construction_checklist') {
    try {
      await createConstructionChecklistReadableExports(job, outputDir, images);
    } catch (error) {
      job.logs.push(`[compose] construction checklist HD export failed: ${String(error?.message || error).slice(0, 160)}`);
    }
    updateJob(job, 88, '落地施工清单图已生成', '[compose] 落地施工清单采用长版施工交付板，跳过普通栏目叠加');
    return '';
  }
  if (job.mode === 'handdrawn_plan') {
    updateJob(job, 88, '手绘方案推演图已生成', '[compose] 手绘方案推演图保留 9:16 复古纸张手绘提案板，不叠加额外栏目');
    return '';
  }
  if (job.mode === 'outdoor_handdrawn_plan') {
    updateJob(job, 88, '户外小清新手绘图已生成', '[compose] 户外小清新手绘图保留竖版手绘提案板，不叠加额外栏目');
    return '';
  }
  if (PLAN_RESOURCE_MODES.has(job.mode)) {
    try {
      await enhancePlanBoardImage(job, outputDir, images);
    } catch (error) {
      job.logs.push(`[compose] 方案图栏目叠加失败，保留原始生成图：${String(error?.message || error).slice(0, 160)}`);
    }
    updateJob(job, 88, `${MODE_LABELS[job.mode] || '方案图'}已生成`, `[compose] ${MODE_LABELS[job.mode] || job.mode}模式跳过拼图，保留 1 张竖版方案图`);
    return '';
  }
  if (job.mode === 'partial_wedding_edit') {
    updateJob(job, 88, '局部改图候选已生成', '[compose] 局部改图模式跳过拼图，保留 2 张候选图');
    return '';
  }
  if (isPsLayerSplitMode(job.mode)) {
    return createPsLayerSplitPreviewBoard(job, outputDir, images);
  }
  if (isImageEnhanceMode(job.mode)) {
    updateJob(job, 88, '画质升级图已生成', '[compose] 画质升级模式跳过拼图，保留 1 张高清图');
    return '';
  }

  updateJob(job, 88, '正在拼接爆款首图', '[compose] 裁切 6 张图并生成内容首图');

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
      .jpeg({ quality: FINAL_BOARD_CELL_JPEG_QUALITY, mozjpeg: true, chromaSubsampling: '4:4:4' })
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
    .jpeg({ quality: FINAL_BOARD_JPEG_QUALITY, mozjpeg: true, chromaSubsampling: '4:4:4' })
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

function constructionMatrixOverlaySvg({ width = 1024, height = 1536, dark = true } = {}) {
  const bg = dark ? '#050504' : '#120f0c';
  const gold = '#d8aa62';
  const goldStrong = '#f1c97e';
  const line = '#d8aa62';
  const lineOpacity = 0.62;
  const labelFont = 'Noto Sans CJK SC, Microsoft YaHei, PingFang SC, Arial, sans-serif';
  const panelRect = (x, y, w, h, opacity = lineOpacity) => `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${line}" stroke-opacity="${opacity}" stroke-width="1.2"/>
  `;
  const guideLine = (x1, y1, x2, y2, opacity = lineOpacity) => `
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${line}" stroke-opacity="${opacity}" stroke-width="1"/>
  `;
  const headerBand = (x, y, w, h = 50, opacity = 0.88) => `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${bg}" fill-opacity="${opacity}"/>
    <line x1="${x}" y1="${y + h}" x2="${x + w}" y2="${y + h}" stroke="${line}" stroke-opacity="0.42" stroke-width="1"/>
  `;
  const sectionLabel = (x, y, title, size = 23, w = 270) => `
    <text x="${x}" y="${y}" fill="${goldStrong}" font-size="${size}" font-weight="900" font-family="${labelFont}"
      stroke="${bg}" stroke-width="4" stroke-opacity="0.82" paint-order="stroke">${escapeSvgText(title)}</text>
  `;
  const columnLabel = (x, y, title, w = 84) => `
    <text x="${x}" y="${y}" fill="${goldStrong}" font-size="17" font-weight="760" font-family="${labelFont}"
      stroke="${bg}" stroke-width="3" stroke-opacity="0.78" paint-order="stroke">${escapeSvgText(title)}</text>
  `;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1024 1536">
      ${panelRect(10, 10, 1004, 1516, 0.86)}

      ${panelRect(14, 14, 654, 504, 0.72)}
      ${headerBand(15, 15, 652, 50, 0.88)}
      ${sectionLabel(28, 47, '1. 核心全景45°立体视图', 22, 282)}

      ${panelRect(674, 14, 336, 230, 0.72)}
      ${headerBand(675, 15, 334, 50, 0.88)}
      ${sectionLabel(690, 47, '2. 正立面图', 22, 148)}

      ${panelRect(674, 248, 336, 270, 0.72)}
      ${headerBand(675, 249, 334, 50, 0.88)}
      ${sectionLabel(690, 287, '3. 平面图', 22, 128)}

      ${panelRect(14, 522, 654, 692, 0.72)}
      ${headerBand(15, 523, 652, 56, 0.88)}
      ${sectionLabel(28, 562, '4. 爆炸轴测图', 22, 170)}

      ${panelRect(674, 522, 336, 692, 0.72)}
      ${headerBand(675, 523, 334, 56, 0.88)}
      ${sectionLabel(690, 562, '5. 细节效果图', 22, 170)}
      ${guideLine(842, 590, 842, 1214, 0.32)}
      ${guideLine(674, 742, 1010, 742, 0.3)}
      ${guideLine(674, 898, 1010, 898, 0.3)}
      ${guideLine(674, 1056, 1010, 1056, 0.3)}

      ${panelRect(14, 1222, 996, 300, 0.72)}
      ${headerBand(15, 1223, 994, 92, 0.9)}
      ${sectionLabel(28, 1258, '6. 单体素材库（设计元素模块化）', 22, 342)}
      ${columnLabel(82, 1298, '花艺组件')}
      ${columnLabel(236, 1298, '花球组件')}
      ${columnLabel(374, 1298, '布艺组件')}
      ${columnLabel(526, 1298, '水晶组件')}
      ${columnLabel(668, 1298, '灯具组件')}
      ${columnLabel(790, 1298, '结构组件')}
      ${columnLabel(912, 1298, '装饰道具')}
      ${guideLine(220, 1315, 220, 1522, 0.34)}
      ${guideLine(332, 1315, 332, 1522, 0.34)}
      ${guideLine(486, 1315, 486, 1522, 0.34)}
      ${guideLine(626, 1315, 626, 1522, 0.34)}
      ${guideLine(760, 1315, 760, 1522, 0.34)}
      ${guideLine(890, 1315, 890, 1522, 0.34)}
    </svg>
  `;
}

async function enhanceConstructionMatrixImage(job, outputDir, images) {
  if (job.mode !== 'product_matrix' || !images?.[0]?.filename) return images;
  const source = path.join(outputDir, images[0].filename);
  if (!existsSync(source)) return images;

  updateJob(job, 86, '正在叠加新版施工矩阵模板', '[compose] 叠加新版编号分区、金色分区名和面板边框');
  const stats = await sharp(source).stats();
  const channels = stats.channels || [];
  const luma = ((channels[0]?.mean || 0) * 0.2126) + ((channels[1]?.mean || 0) * 0.7152) + ((channels[2]?.mean || 0) * 0.0722);
  const dark = luma < 132;
  const width = 1024;
  const height = 1536;
  const filename = 'construction-matrix.jpg';
  const overlay = Buffer.from(constructionMatrixOverlaySvg({ width, height, dark }));

  await sharp(source)
    .rotate()
    .resize(width, height, { fit: 'cover' })
    .composite([{ input: overlay, left: 0, top: 0 }])
    .jpeg({ quality: FINAL_IMAGE_JPEG_QUALITY, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toFile(path.join(outputDir, filename));

  images[0] = {
    ...images[0],
    label: '方案施工矩阵图',
    filename,
    url: publicUrl(job.id, filename),
    downloadUrl: downloadUrl(job.id, filename),
    width,
    height,
  };
  job.partialImages = images.map(({ label, url, filename: itemFilename, downloadUrl, width: itemWidth, height: itemHeight }) => ({
    label,
    url,
    filename: itemFilename,
    downloadUrl,
    width: itemWidth,
    height: itemHeight,
  }));
  return images;
}

function planBoardOverlayConfig(mode = '') {
  return {
    handdrawn_plan: {
      title: '手绘方案推演',
      subtitle: '手绘效果 / 平面布局 / 立面推演 / 材质色卡',
      filename: 'handdrawn-plan-board.jpg',
      labels: [
        ['01', '整体效果', 'SKETCH RENDER'],
        ['02', '平面布局', 'PLAN SKETCH'],
        ['03', '立面推演', 'ELEVATION'],
        ['04', '材质色卡', 'MATERIALS'],
        ['05', '细节草图', 'DETAILS'],
        ['06', '设计要点', 'NOTES'],
      ],
    },
    construction_checklist: {
      title: '落地施工清单',
      subtitle: '整体效果 / 尺寸示意 / 物料清单 / 搭建步骤',
      filename: 'construction-checklist.jpg',
      labels: [
        ['01', '整体效果', 'FINAL RENDER'],
        ['02', '尺寸示意', 'SIZE GUIDE'],
        ['03', '物料清单', 'MATERIAL LIST'],
        ['04', '搭建步骤', 'BUILD STEPS'],
        ['05', '注意事项', 'NOTES'],
        ['06', '配置清单', 'CONFIG'],
      ],
    },
    detail_grid: {
      title: '九宫格细节图',
      subtitle: '全景 / 通道 / 花艺 / 灯光 / 材质 / 氛围',
      filename: 'detail-nine-grid.jpg',
      labels: [
        ['01', '全景', 'OVERVIEW'],
        ['02', '通道', 'AISLE'],
        ['03', '花艺', 'FLORAL'],
        ['04', '主视觉', 'FOCAL'],
        ['05', '灯光', 'LIGHTING'],
        ['06', '桌椅', 'TABLES'],
        ['07', '材质', 'TEXTURE'],
        ['08', '道具', 'PROPS'],
        ['09', '氛围', 'MOOD'],
      ],
    },
  }[mode] || null;
}

function planBoardOverlaySvg({ mode, width = 1088, height = 1440, dark = true } = {}) {
  const config = planBoardOverlayConfig(mode);
  if (!config) return '';
  const ink = dark ? '#f8f4ee' : '#1d1712';
  const softInk = dark ? '#d9c7b4' : '#66584c';
  const panel = dark ? '#070707' : '#fffaf4';
  const line = dark ? '#f5e7d4' : '#2c241d';
  const accent = dark ? '#d6a56b' : '#6f8a55';
  const labelFill = dark ? '#12100e' : '#f4eadf';
  const font = 'Noto Sans CJK SC, Microsoft YaHei, PingFang SC, Arial, sans-serif';
  const mono = 'JetBrains Mono, SFMono-Regular, Consolas, monospace';
  const label = (x, y, [code, title], w = null) => {
    const labelWidth = w || Math.max(134, Math.min(242, 44 + String(`${code} ${title}`).length * 17));
    return `
      <g>
        <rect x="${x}" y="${y}" width="${labelWidth}" height="36" rx="4" fill="${labelFill}" fill-opacity="${dark ? 0.94 : 0.96}"/>
        <text x="${x + 12}" y="${y + 24}" fill="${ink}" font-size="18" font-weight="900" font-family="${font}">${escapeSvgText(code)} ${escapeSvgText(title)}</text>
      </g>
    `;
  };
  const detailGrid = mode === 'detail_grid';
  const handdrawnBoard = mode === 'handdrawn_plan';
  const gridTop = 140;
  const gridLeft = 34;
  const gridWidth = 1020;
  const gridHeight = 1236;
  const cellW = gridWidth / 3;
  const cellH = gridHeight / 3;
  const headerY = handdrawnBoard ? 28 : 28;
  const headerHeight = handdrawnBoard ? 64 : 88;
  const headerRadius = handdrawnBoard ? 6 : 8;
  const titleFontSize = handdrawnBoard ? 30 : 34;
  const titleBaseline = handdrawnBoard ? 70 : 80;
  const subtitleX = handdrawnBoard ? 326 : 330;
  const subtitleFontSize = handdrawnBoard ? 14 : 16;
  const subtitleBaseline = handdrawnBoard ? 69 : 80;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1088 1440">
      <defs>
        <filter id="planShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity="${dark ? 0.32 : 0.12}"/>
        </filter>
      </defs>
      <rect x="30" y="${headerY}" width="1028" height="${headerHeight}" rx="${headerRadius}" fill="${panel}" fill-opacity="${handdrawnBoard ? 1 : (dark ? 0.9 : 0.94)}" filter="url(#planShadow)"/>
      <text x="58" y="${titleBaseline}" fill="${ink}" font-size="${titleFontSize}" font-weight="900" font-family="${font}">${escapeSvgText(config.title)}</text>
      <text x="${subtitleX}" y="${subtitleBaseline}" fill="${softInk}" font-size="${subtitleFontSize}" font-weight="700" font-family="${font}">${escapeSvgText(config.subtitle)}</text>
      ${handdrawnBoard ? '' : `<text x="914" y="80" fill="${accent}" font-size="18" font-weight="800" font-family="${mono}">WED BOARD</text>`}

      ${handdrawnBoard ? '' : detailGrid ? `
        <rect x="${gridLeft}" y="${gridTop}" width="${gridWidth}" height="${gridHeight}" fill="none" stroke="${line}" stroke-opacity="${dark ? 0.28 : 0.22}" stroke-width="1.4"/>
        ${[1, 2].map((i) => `<line x1="${gridLeft + cellW * i}" y1="${gridTop}" x2="${gridLeft + cellW * i}" y2="${gridTop + gridHeight}" stroke="${line}" stroke-opacity="${dark ? 0.25 : 0.2}" stroke-width="1.2"/>`).join('')}
        ${[1, 2].map((i) => `<line x1="${gridLeft}" y1="${gridTop + cellH * i}" x2="${gridLeft + gridWidth}" y2="${gridTop + cellH * i}" stroke="${line}" stroke-opacity="${dark ? 0.25 : 0.2}" stroke-width="1.2"/>`).join('')}
        ${config.labels.map((item, index) => {
          const x = gridLeft + (index % 3) * cellW + 16;
          const y = gridTop + Math.floor(index / 3) * cellH + 18;
          return label(x, y, item, 150);
        }).join('')}
      ` : `
        <rect x="34" y="130" width="1020" height="560" fill="none" stroke="${line}" stroke-opacity="${dark ? 0.28 : 0.22}" stroke-width="1.4"/>
        <line x1="682" y1="130" x2="682" y2="690" stroke="${line}" stroke-opacity="${dark ? 0.24 : 0.18}" stroke-width="1.2"/>
        ${label(54, 150, config.labels[0])}
        ${label(704, 150, config.labels[1])}
        ${label(704, 410, config.labels[2])}
        <rect x="34" y="714" width="1020" height="662" fill="none" stroke="${line}" stroke-opacity="${dark ? 0.28 : 0.22}" stroke-width="1.4"/>
        <line x1="544" y1="714" x2="544" y2="1376" stroke="${line}" stroke-opacity="${dark ? 0.24 : 0.18}" stroke-width="1.2"/>
        <line x1="34" y1="1045" x2="1054" y2="1045" stroke="${line}" stroke-opacity="${dark ? 0.24 : 0.18}" stroke-width="1.2"/>
        ${label(54, 736, config.labels[3])}
        ${label(566, 736, config.labels[4])}
        ${label(566, 1068, config.labels[5])}
      `}
    </svg>
  `;
}

async function enhancePlanBoardImage(job, outputDir, images) {
  if (!PLAN_RESOURCE_MODES.has(job.mode) || job.mode === 'product_matrix' || !images?.[0]?.filename) return images;
  const config = planBoardOverlayConfig(job.mode);
  if (!config) return images;
  const source = path.join(outputDir, images[0].filename);
  if (!existsSync(source)) return images;

  updateJob(job, 86, '正在叠加方案图栏目', `[compose] 叠加${config.title}栏目`);
  const stats = await sharp(source).stats();
  const channels = stats.channels || [];
  const luma = ((channels[0]?.mean || 0) * 0.2126) + ((channels[1]?.mean || 0) * 0.7152) + ((channels[2]?.mean || 0) * 0.0722);
  const dark = luma < 132;
  const width = 1088;
  const height = 1440;
  const filename = config.filename;
  const overlay = Buffer.from(planBoardOverlaySvg({ mode: job.mode, width, height, dark }));

  await sharp(source)
    .rotate()
    .resize(width, height, { fit: 'cover' })
    .composite([{ input: overlay, left: 0, top: 0 }])
    .jpeg({ quality: FINAL_IMAGE_JPEG_QUALITY, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toFile(path.join(outputDir, filename));

  images[0] = {
    ...images[0],
    label: MODE_LABELS[job.mode] || config.title,
    filename,
    url: publicUrl(job.id, filename),
    downloadUrl: downloadUrl(job.id, filename),
    width,
    height,
  };
  job.partialImages = images.map(({ label: itemLabel, url, filename: itemFilename, downloadUrl, width: itemWidth, height: itemHeight }) => ({
    label: itemLabel,
    url,
    filename: itemFilename,
    downloadUrl,
    width: itemWidth,
    height: itemHeight,
  }));
  return images;
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
    .jpeg({ quality: FINAL_BOARD_CELL_JPEG_QUALITY, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toBuffer();
  const liveBuffer = await sharp(reference.buffer)
    .rotate()
    .resize(canvasWidth, imageHeight, { fit: 'cover' })
    .jpeg({ quality: FINAL_BOARD_CELL_JPEG_QUALITY, mozjpeg: true, chromaSubsampling: '4:4:4' })
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
    .jpeg({ quality: FINAL_BOARD_JPEG_QUALITY, mozjpeg: true, chromaSubsampling: '4:4:4' })
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
      .jpeg({ quality: FINAL_BOARD_CELL_JPEG_QUALITY, mozjpeg: true, chromaSubsampling: '4:4:4' })
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
    .jpeg({ quality: FINAL_BOARD_JPEG_QUALITY, mozjpeg: true, chromaSubsampling: '4:4:4' })
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
      tags: ['#同款婚礼延伸', '#婚礼灵感', '#婚礼效果图', '#婚礼策划', '#备婚参考'],
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
    product_matrix: {
      title: '婚礼方案这样拆，客户更容易看懂',
      tags: ['#婚礼施工图', '#婚礼方案', '#婚礼物料清单', '#婚礼策划', '#方案沟通', '#婚礼搭建'],
      body: '把一场婚礼案例拆成施工矩阵后，客户能同时看到整体效果、技术视图、核心物料和搭建步骤。效果图负责第一眼，平面/立面和轴测图负责讲清楚结构，物料网格和清单负责把执行边界说具体。\n\n这种图很适合放在产品矩阵页、提案沟通和施工交底里。它不是单纯做一张好看的海报，而是把方案从“氛围好看”变成“能落地、能报价、能沟通”的交付物。',
    },
    handdrawn_plan: {
      title: '前期提案用手绘方案会更有设计感',
      tags: ['#婚礼手绘方案', '#婚礼提案', '#婚礼设计', '#方案沟通', '#婚礼策划', '#备婚参考'],
      body: '手绘方案推演图适合放在方案前期：先用主效果图建立氛围，再用平面、立面、材质色卡和细节草图把设计逻辑说清楚。\n\n它不像最终施工图那么硬，也不是单纯发一张效果图，而是把“为什么这么设计”讲给客户看。客户能更快理解空间动线、主视觉、花艺比例和材质方向。',
    },
    outdoor_handdrawn_plan: {
      title: '户外婚礼用手绘图会更有清新感',
      tags: ['#户外婚礼', '#小清新婚礼', '#婚礼手绘方案', '#花园婚礼', '#方案沟通', '#备婚参考'],
      body: '户外小清新手绘图更适合草坪、花园、庭院和露台婚礼提案：先用手绘主视觉讲清楚自然氛围，再把花材色卡、通道动线、座椅区和材质细节放在同一张方案板里。\n\n这种图不会显得太硬，客户能更快理解户外现场落地后是什么气质，也方便策划、花艺和搭建团队提前统一方向。',
    },
    construction_checklist: {
      title: '施工交底这样整理，现场更容易对齐',
      tags: ['#婚礼施工图', '#婚礼物料清单', '#婚礼搭建', '#施工交底', '#婚礼策划', '#方案沟通'],
      body: '落地施工清单图更偏执行：用长版施工交付板把效果示意、物料局部、平面/正立/侧立图、物料清单、搭建步骤和注意事项放在同一张图里，策划、花艺、灯光和搭建团队都能对着同一套信息沟通。\n\n这种图适合给客户确认方案边界，也适合内部开工前复盘，减少“效果图很好看，但现场不知道怎么落”的问题。',
    },
    detail_grid: {
      title: '一场婚礼的细节可以这样拆成九宫格',
      tags: ['#婚礼九宫格', '#婚礼细节', '#花艺布置', '#婚礼灵感', '#婚礼现场', '#备婚参考'],
      body: '九宫格细节图适合做同一舞台的案例展示：全景负责第一眼，通道、花艺、灯光、材质和舞台局部负责把氛围讲完整。\n\n客户看大景会被吸引，看同一舞台的细节才会判断这套方案是不是够精致。把一个舞台拆成九个可看的局部，也更适合后续发图文内容。',
    },
    partial_wedding_edit: {
      title: '婚礼现场按需求微调后更好沟通✨',
      tags: ['#婚礼改图', '#婚礼效果图', '#婚礼布置', '#花艺调整', '#方案沟通', '#备婚参考'],
      body: '在原现场基础上做局部调整，最适合用来和客户确认方向：场地结构、镜头角度和空间关系先保留，再看花艺、色系、布幔或灯光细节要怎么改。\n\n这种候选图不用从零想象方案，客户能直接对着原图判断“哪里要保留、哪里要升级”，沟通会更快也更具体。',
    },
    copy_title: {
      title: '提示词已生成',
      tags: [],
      body: '以这张婚礼现场图为视觉参考，生成真实婚礼影像提示词。保持原图场地结构、主色调、花艺位置、灯光方向、舞台背景和通道纵深不变，描述清楚空间层次、材质质感、光影氛围和镜头/画面重点；不要新增人物、文字、logo、水印或画面里没有的装饰。',
    },
    setup_process_grid: {
      title: '婚礼搭建过程也能做成九宫格',
      tags: ['#婚礼搭建', '#搭建视频九宫格', '#婚礼施工', '#婚礼布置', '#婚礼案例'],
      body: '上传一张完工婚礼图，就能把这场布置反推成搭建视频九宫格：空场、框架、花艺、灯光、现场调整和最终完工都放在同一张图里。\n\n这种图很适合做案例展示和客户沟通，不只是看最终效果，也能让客户看到团队从进场到落地的执行过程。',
    },
    photo_area_setup_grid: {
      title: '婚礼留影区搭建过程也能讲清楚',
      tags: ['#婚礼留影区', '#留影区搭建', '#婚礼搭建', '#迎宾区布置', '#婚礼案例'],
      body: '上传一张留影区完工图，就能反推出从空白区域、背景板定位、迎宾牌摆放、花艺安装到最终完工的 3×3 搭建过程图。\n\n这种图很适合展示迎宾区和留影区的落地细节，让客户不只看到成品，也能看见团队把一个小空间一步步搭完整的执行力。',
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
  '分镜', '图生视频', '爆款图文', '本地兜底',
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

function titleHasBrokenSubject(title) {
  const normalized = cleanTitleText(title);
  if (!normalized) return false;
  return /婚礼被[^，。！？!?、]{1,12}戳中/.test(normalized)
    || /现场被[^，。！？!?、]{1,12}戳中/.test(normalized)
    || /空间被[^，。！？!?、]{1,12}戳中/.test(normalized)
    || /场地被[^，。！？!?、]{1,12}戳中/.test(normalized);
}

function scoreCopyTitleCandidate(title, visualKeywords, recentTitles) {
  const normalized = cleanTitleText(title);
  if (!normalized) return -999;
  if (titleNeedsVisualFallback(normalized)) return -900;
  if (titleLooksRepetitive(normalized, recentTitles)) return -800;
  if (titleHasBrokenSubject(normalized)) return -850;

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
  (a, b) => `${a}配${b}适合收藏参考`,
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

function cleanPartialEditReferenceNotes(value = '') {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 700);
}

async function describePartialEditStyleReferences(job) {
  if (!isPartialWeddingEditMode(job?.mode)) return '';
  const extraReferences = (job.partialEditReferences || []).slice(1, PARTIAL_EDIT_REFERENCE_LIMIT);
  if (!extraReferences.length) return '';

  if (!USE_COPY_API) {
    job.logs.push('[partial-edit] Extra style references are not sent as editable canvases; vision summary API is disabled, so the edit will follow the text instruction conservatively.');
    return '';
  }

  try {
    const content = [
      {
        type: 'text',
        text: [
          'Look only at the extra wedding decor reference image(s).',
          'Return one concise Simplified Chinese sentence listing only transferable requested wedding-design details:',
          'stage/backdrop/aisle/runway structure, object types, colors, flower/fabric/material/lighting style and density.',
          'Do not describe or copy the venue, wall, floor, camera angle, signs, words, people, sofa, architecture or unrelated background.',
          'This sentence will be used to edit another base photo locally.',
        ].join(' '),
      },
    ];

    for (const [index, reference] of extraReferences.entries()) {
      content.push(...await imageBufferToCopyPart(
        reference.buffer,
        `Extra decor reference ${index + 2}: style/object source only, not a scene or background source.`,
      ));
    }

    const body = {
      model: COPY_MODEL,
      temperature: 0.2,
      max_tokens: 260,
      messages: [
        {
          role: 'system',
          content: 'You summarize wedding decor reference images for a conservative local photo edit. Return plain text only, no JSON and no markdown.',
        },
        { role: 'user', content },
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
    const responseText = await response.text();
    const payload = responseText ? JSON.parse(responseText) : null;

    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || responseText || `HTTP ${response.status}`;
      throw new Error(message);
    }

    const rawContent = payload?.choices?.[0]?.message?.content || payload?.output_text || payload?.content || '';
    const notes = cleanPartialEditReferenceNotes(Array.isArray(rawContent)
      ? rawContent.map((part) => part?.text || part?.content || '').join(' ')
      : rawContent);
    if (notes) job.logs.push(`[partial-edit] Extra reference decor notes: ${notes.slice(0, 180)}`);
    return notes;
  } catch (error) {
    job.logs.push(`[partial-edit] Extra reference vision summary failed; using text instruction only: ${String(error?.message || error || 'unknown error').slice(0, 180)}`);
    return '';
  }
}

function weddingStyleProfilePromptBlock(profile = null) {
  const normalized = normalizeWeddingStyleProfile(profile || fallbackWeddingStyleProfile('missing profile'));
  const globalAvoid = listFromValue(WEDDING_STYLE_RULES.global_rules?.hard_avoid, 12);
  const domesticLayoutGrammar = listFromValue(WEDDING_STYLE_RULES.global_rules?.chinese_t_stage_grammar, 12);
  const xhsPopularityStandard = listFromValue(WEDDING_STYLE_RULES.global_rules?.xhs_popularity_standard, 12);
  return [
    'DOMESTIC CHINESE WEDDING STYLE PROFILE FOR SAME-STYLE EXTENSION:',
    `Detected style: ${normalized.style_name} (${normalized.style_id}), confidence ${normalized.confidence}.`,
    normalized.style_tags.length ? `Xiaohongshu-style internal tags: ${normalized.style_tags.join(', ')}.` : '',
    normalized.palette.length ? `Locked palette: ${normalized.palette.join(', ')}.` : '',
    normalized.venue_type ? `Locked venue type: ${normalized.venue_type}.` : '',
    normalized.stage_type ? `Locked stage/backdrop type: ${normalized.stage_type}.` : '',
    normalized.aisle_type ? `Locked aisle/runway type: ${normalized.aisle_type}.` : '',
    normalized.spatial_layout ? `Locked spatial layout: ${normalized.spatial_layout}.` : '',
    normalized.materials.length ? `Locked materials: ${normalized.materials.join(', ')}.` : '',
    normalized.floral_language ? `Locked floral language: ${normalized.floral_language}.` : '',
    normalized.lighting_mood ? `Locked lighting mood: ${normalized.lighting_mood}.` : '',
    domesticLayoutGrammar.length ? `Domestic banquet-hall layout grammar: ${domesticLayoutGrammar.join('; ')}.` : '',
    normalized.layout_rules?.length ? `Style-specific spatial layout rules: ${normalized.layout_rules.join('; ')}.` : '',
    xhsPopularityStandard.length ? `Xiaohongshu high-like taste standard: ${xhsPopularityStandard.join('; ')}.` : '',
    normalized.xhs_popularity_signals?.length ? `Style-specific high-like signals: ${normalized.xhs_popularity_signals.join('; ')}.` : '',
    normalized.failure_patterns?.length ? `Known failed-output patterns to avoid: ${normalized.failure_patterns.join('; ')}.` : '',
    normalized.must_keep.length ? `Must keep: ${normalized.must_keep.join('; ')}.` : '',
    normalized.can_extend.length ? `May vary only within these extension areas: ${normalized.can_extend.join('; ')}.` : '',
    normalized.avoid.length ? `Style drift to avoid: ${normalized.avoid.join('; ')}.` : '',
    normalized.rule_positive_prompt ? `Positive visual anchors: ${normalized.rule_positive_prompt}.` : '',
    normalized.rule_negative_prompt ? `Negative visual anchors: ${normalized.rule_negative_prompt}.` : '',
    globalAvoid.length ? `Global same-style hard negatives: ${globalAvoid.join('; ')}.` : '',
    'If there is any conflict between a style name and the uploaded image, trust the visible uploaded image and keep the visible palette, venue, materials, floral density and lighting.',
  ].filter(Boolean).join(' ');
}

async function analyzeSimilarWeddingStyle(job) {
  if (job.mode !== 'similar_style') return null;
  if (!job.reference?.buffer) return fallbackWeddingStyleProfile('missing reference image');
  if (!USE_COPY_API) {
    job.logs.push('[wedding-style] vision analysis disabled; using domestic wedding style fallback rules.');
    return fallbackWeddingStyleProfile('vision analysis disabled');
  }

  try {
    const domesticLayoutGrammar = listFromValue(WEDDING_STYLE_RULES.global_rules?.chinese_t_stage_grammar, 12);
    const xhsPopularityStandard = listFromValue(WEDDING_STYLE_RULES.global_rules?.xhs_popularity_standard, 12);
    const content = [
      {
        type: 'text',
        text: [
          'Analyze the uploaded wedding image before same-style generation.',
          'Match it to exactly one style_id from this Chinese domestic wedding style rule catalog.',
          'Use the visible image first. The style catalog is a guide, not permission to invent unseen elements.',
          'Return strict JSON only, no markdown.',
          'JSON schema:',
          '{"style_id":"...","style_name":"...","confidence":0.0,"style_tags":["..."],"palette":["..."],"venue_type":"...","stage_type":"...","aisle_type":"...","spatial_layout":"...","materials":["..."],"floral_language":"...","lighting_mood":"...","must_keep":["..."],"can_extend":["..."],"avoid":["..."]}',
          'Style rule catalog:',
          compactWeddingStyleRuleCatalog(),
          domesticLayoutGrammar.length ? `Domestic Chinese banquet-hall layout grammar:\n- ${domesticLayoutGrammar.join('\n- ')}` : '',
          xhsPopularityStandard.length ? `Xiaohongshu high-like taste standard:\n- ${xhsPopularityStandard.join('\n- ')}` : '',
        ].join('\n'),
      },
      ...await imageBufferToCopyPart(
        job.reference.buffer,
        'Uploaded wedding reference image: classify its domestic Chinese wedding aesthetic and same-style extension constraints.',
      ),
    ];

    const body = {
      model: COPY_MODEL,
      temperature: 0.1,
      max_tokens: 1100,
      messages: [
        {
          role: 'system',
          content: 'You are a Chinese wedding visual director. You classify wedding decor images into domestic Xiaohongshu-style wedding aesthetics and return strict JSON only.',
        },
        { role: 'user', content },
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
      signal: signalForJob(job, COPY_REQUEST_TIMEOUT_MS),
    });
    const responseText = await response.text();
    let payload = null;
    try {
      payload = responseText ? JSON.parse(responseText) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || responseText || `HTTP ${response.status}`;
      throw new Error(message);
    }

    const rawContent = payload?.choices?.[0]?.message?.content || payload?.output_text || payload?.content || '';
    const parsed = typeof rawContent === 'string'
      ? extractJsonObject(rawContent)
      : rawContent;
    const normalized = {
      ...normalizeWeddingStyleProfile(parsed),
      analysis_status: 'ok',
    };
    job.logs.push(`[wedding-style] ${normalized.style_name} (${normalized.style_id}), confidence=${normalized.confidence}, tags=${normalized.style_tags.slice(0, 5).join('/')}`);
    return normalized;
  } catch (error) {
    const reason = String(error?.message || error || 'unknown error').slice(0, 180);
    job.logs.push(`[wedding-style] vision analysis failed; using fallback rules: ${reason}`);
    return fallbackWeddingStyleProfile(reason);
  }
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
        : job.mode === 'product_matrix'
        ? '上传的婚礼案例图：请优先根据这张图判断案例色系、花艺、灯光、布幔/吊顶、舞台、通道、桌椅区和可施工物料关系。我们要把它提炼成婚礼方案施工矩阵整合板。'
        : job.mode === 'handdrawn_plan'
        ? '上传的婚礼案例图：请优先根据这张图判断案例色系、花艺、灯光、布幔/吊顶、舞台、通道和标志性物件。我们要把它提炼成手绘方案推演板。'
        : job.mode === 'outdoor_handdrawn_plan'
        ? '上传的婚礼案例图：请优先根据这张图判断案例色系、花艺、材质、通道、座椅和标志性物件。我们要把它提炼成户外小清新手绘提案板，重点是花园/草坪/庭院氛围、自然光、清新色卡、紧凑物料清单和产品取证区。'
        : job.mode === 'construction_checklist'
        ? '上传的方案施工矩阵图：请优先根据这张矩阵判断主效果、平面图、立面图、爆炸轴测、花艺、灯光、舞台、通道、吊挂结构、道具和可施工搭建物料关系。我们要把它整理成落地施工清单图，物料重点放在搭建施工，不要整理成酒店餐饮物料清单。'
        : job.mode === 'detail_grid'
        ? '上传的婚礼舞台案例图：请优先根据这张图判断同一个舞台的色系、花艺、灯光、布幔/吊顶、通道、材质和空间层次。系统会把这个舞台保真拆成九宫格细节展示图，不是重新设计另一场婚礼。'
        : job.mode === 'setup_process_grid'
        ? '上传的婚礼完工图：请优先根据这张图判断同一场婚礼的场地、色系、花艺、灯光、舞台、通道、最终效果，以及是否真的存在布幔/吊顶/悬挂结构；没有就不要写成有吊顶。系统会把这张完工图反推出空场到完工的搭建视频九宫格。'
        : job.mode === 'photo_area_setup_grid'
        ? '上传的婚礼留影区完工图：请优先根据这张图判断同一个留影区的位置、墙面或户外背景、地面、背景板、迎宾牌、照片墙、花艺、灯光、道具和最终效果。系统会把这张完工图反推出空区到完工的留影区搭建九宫格，不要写成主舞台或宴会通道。'
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
        : job.mode === 'product_matrix'
        ? `方案施工矩阵图 ${index + 1}：${image.label || '方案施工矩阵图'}。这是根据婚礼案例风格整理出的效果视图、技术视图、物料网格和施工步骤整合板，请围绕提案沟通、施工交底和方案落地价值写。`
        : job.mode === 'handdrawn_plan'
        ? `手绘方案推演图 ${index + 1}：${image.label || '手绘方案推演图'}。这是根据婚礼案例风格整理出的手绘效果、平面布局、立面推演和材质色卡方案板，请围绕前期提案、设计逻辑和客户沟通价值写。`
        : job.mode === 'outdoor_handdrawn_plan'
        ? `户外小清新手绘图 ${index + 1}：${image.label || '户外小清新手绘图'}。这是根据婚礼案例风格整理出的户外花园/草坪/庭院手绘提案板，请围绕自然清新氛围、户外提案、物料清单和产品取证沟通价值写。`
        : job.mode === 'construction_checklist'
        ? `落地施工清单图 ${index + 1}：${image.label || '落地施工清单图'}。这是基于方案施工矩阵拆解出的长版施工交付板，包含效果示意、平立面技术视图、物料清单、搭建步骤和注意事项，请围绕施工交底、物料确认和落地执行价值写。`
        : job.mode === 'detail_grid'
        ? `九宫格细节图 ${index + 1}：${image.label || '九宫格细节图'}。这是从同一个婚礼舞台原图保真拆出的全景、通道、花艺、灯光、材质和舞台局部展示图，请围绕案例展示、细节沟通和内容发布价值写。`
        : job.mode === 'setup_process_grid'
        ? `搭建视频九宫格 ${index + 1}：${image.label || '搭建视频九宫格'}。这是根据婚礼完工图反推出的空场、框架、花艺、灯光、搭建调整和完工效果九宫格，请围绕施工过程展示、团队执行力和客户沟通价值写。`
        : job.mode === 'photo_area_setup_grid'
        ? `留影区搭建九宫格 ${index + 1}：${image.label || '留影区搭建九宫格'}。这是根据婚礼留影区完工图反推出的空区、背景板、迎宾牌、花艺灯光、道具摆放和完工效果九宫格，请围绕留影区落地过程、细节执行和客户沟通价值写。`
        : job.mode === 'partial_wedding_edit'
        ? `局部改图候选 ${index + 1}：${image.label || '改图候选'}。这是在原婚礼主图基础上按用户需求调整出的候选效果，请围绕方案调整和客户沟通价值写。`
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
  const isProductMatrix = job.mode === 'product_matrix';
  const isHanddrawnPlan = job.mode === 'handdrawn_plan';
  const isOutdoorHanddrawnPlan = job.mode === 'outdoor_handdrawn_plan';
  const isConstructionChecklist = job.mode === 'construction_checklist';
  const isDetailGrid = job.mode === 'detail_grid';
  const isPartialEdit = job.mode === 'partial_wedding_edit';
  const isCompareMode = isSetupCompare;
  const modeInstruction = (() => {
    if (job.mode === 'copy_title') return [
      '任务：这是“只写标题文案”，不会再生成任何图片，只根据上传的婚礼现场照写一篇真实内容平台婚礼笔记。',
      '请像真实婚礼策划师/婚礼摄像团队在内容平台发自己案例那样写，不是介绍工具，也不是解说“这次生成的图”。',
      '严禁在任何文字里出现：AI、人工智能、提示词、模型、接口、生成图片、分镜、九宫格、图生视频、爆款图文、本次生成等词；也不要说“这次/这组/这套”这种带工具感的口吻。',
    ].join('\n');
    if (isDesignRender) return [
        '任务：这是“设计图转实景”。用户上传的是婚礼设计图/效果图，系统输出的是 1 张真实落地现场图，不做上下对比图、不做九宫格、不做拼图。',
        '标题和正文要围绕「设计方案落地后的真实现场效果」「提案沟通更直观」「空间、材质、灯光、花艺更容易被客户理解」来写。',
        '可以自然使用“设计图”“效果图”“现场效果”“提案沟通”“落地现场”“现场候选图”等词，但不要说 AI、生成、工具、接口、模型，也不要说上图下图或对比图。',
      ].join('\n');
    if (isVenueFusion) return [
        '任务：这是“空地婚礼融合图”。用户上传了 2 张图：一张空地/空场作为真实场地，一张婚礼素材作为风格来源；系统输出 1 张把这场婚礼融合并落到空地上的完成效果图。',
        '标题和正文要围绕「空地变婚礼现场」「场地利用」「婚礼风格落地」「客户提前看到布置完成效果」来写，不要写成普通晒图，也不要写成前后对比图。',
        '可以自然使用“空地”“空场”“落地效果”“融合效果”“场地布置”“婚礼现场”等词；不要说 AI、生成、工具、接口、模型，也不要说左图右图或参考板。',
      ].join('\n');
    if (isProductMatrix) return [
        '任务：这是“方案施工矩阵图”。用户上传一张婚礼案例图，系统把案例风格提炼成 1 张婚礼方案施工整合板。',
        '标题和正文要围绕「整体效果」「技术视图」「物料拆解」「搭建步骤」「施工交底」「客户沟通」「方案落地」来写，不要写成普通婚礼晒图。',
        '可以自然使用“方案施工矩阵”“施工图”“技术视图”“平面图”“立面图”“爆炸轴测”“物料网格”“搭建步骤”“物料清单”“产品矩阵页”等词；不要说 AI、生成、工具、接口、模型，也不要承诺转化效果。',
      ].join('\n');
    if (isHanddrawnPlan) return [
        '任务：这是“手绘方案推演图”。用户上传一张婚礼案例图，系统把案例风格提炼成 1 张手绘提案推演板。',
        '标题和正文要围绕「手绘效果」「平面布局」「立面推演」「材质色卡」「设计逻辑」「前期提案」「客户沟通」来写，不要写成普通婚礼晒图。',
        '可以自然使用“手绘方案”“方案推演”“平面布局”“立面草图”“材质色卡”“设计提案”等词；不要说 AI、生成、工具、接口、模型，也不要承诺转化效果。',
      ].join('\n');
    if (isOutdoorHanddrawnPlan) return [
        '任务：这是“户外小清新手绘图”。用户上传一张婚礼案例图，系统把案例风格提炼成 1 张户外花园/草坪/庭院小清新手绘提案板。',
        '标题和正文要围绕「户外手绘提案」「花园/草坪/庭院氛围」「自然光」「清新色卡」「物料清单」「产品取证」「客户沟通」来写，不要写成普通婚礼晒图。',
        '可以自然使用“户外婚礼”“小清新”“手绘方案”“花园提案”“草坪婚礼”“物料清单”“产品取证”等词；不要说 AI、生成、工具、接口、模型，也不要承诺转化效果。',
      ].join('\n');
    if (isConstructionChecklist) return [
        '任务：这是“落地施工清单图”。用户上传的是方案施工矩阵图，系统进行一次矩阵转施工清单生成，再叠加稳定的标题、尺寸区、物料表、搭建步骤和注意事项。',
        '标题和正文要围绕「施工矩阵转清单」「整体效果」「尺寸示意」「物料清单」「搭建步骤」「注意事项」「施工交底」「落地执行」来写，不要写成普通婚礼晒图。',
        '可以自然使用“方案施工矩阵”“施工清单”“物料清单”“搭建步骤”“尺寸示意”“施工交底”“落地执行”等词；不要说 AI、生成、工具、接口、模型，也不要编造精确报价。',
      ].join('\n');
    if (isDetailGrid) return [
        '任务：这是“九宫格细节图”。用户上传一张婚礼舞台案例图，系统把同一个舞台保真拆成 1 张九宫格细节展示图。',
        '标题和正文要围绕「同一舞台」「全景」「通道」「花艺」「灯光」「材质」「舞台局部」「案例细节」来写，不要写成施工交底，也不要写成另一套婚礼灵感。',
        '可以自然使用“九宫格”“细节图”“花艺细节”“灯光氛围”“材质纹理”“舞台细节”“案例展示”等词；不要说 AI、生成、工具、接口、模型。',
      ].join('\n');
    if (isPartialEdit) return [
        '任务：这是“上传参考图局部改图”。用户上传一张婚礼主图，输入修改需求，可选上传参考图；系统输出 2 张按需求微调后的候选图。',
        '标题和正文要围绕「在原现场基础上调整」「花艺/色系/布幔/灯光/舞台局部优化」「客户沟通更直观」来写，不要写成普通婚礼晒图。',
        '可以自然使用“局部调整”“改图候选”“方案微调”“客户确认”“保留原场地结构”等词；不要说 AI、生成、工具、接口、模型，也不要说参考图编号。',
        job.editInstruction ? `用户这次的修改需求：${String(job.editInstruction).replace(/\s+/g, ' ').trim().slice(0, 160)}` : '',
      ].filter(Boolean).join('\n');
    if (job.mode === 'similar_style') {
      return '任务：这是“同款婚礼延伸”：标题要像同色系同结构婚礼灵感分享，强调根据这场婚礼延展出相似但不重复的方案。不要写成室内/户外/新中式/目的地等不同婚礼类型，也不要提九宫格或合成总览。';
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
      '- 任何包含 AI、分镜、生成、提示词、模型 等技术字眼的标题',
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
      '你是婚礼策划公司和婚礼影像团队的小红书内容主理人，专门把真实婚礼案例写成小红书爆款笔记。',
      '所有输出必须使用简体中文，禁止出现任何英文单词（连话题标签也不要英文）。',
      '底层写作逻辑必须符合小红书爆款标题文案：先抓图中真实可见的高记忆点，再把它转成“标题钩子 + 正文种草理由 + 话题标签”的完整笔记。',
      '工作流程严格按这个顺序：1) 先仔细看用户上传的婚礼现场图；2) 在心里列出 5-8 个画面里真实可见的元素（具体颜色名、花种/花艺形态、灯光、布幔/吊顶、舞台/通道/桌景结构、道具材质等）；3) 先想 10 个小红书标题候选；4) 选择最贴图、最有收藏理由的一条；5) 才能写标题、正文、话题。',
      '硬性规则：只能描述图片里真实能看见的元素，绝对不要凭空编造画面里没有的颜色、花种、道具、灯光、场地结构；看不清的细节宁可不写。',
      '不要编造新人故事、酒店名称、价格、地点、品牌；语气要像真实笔记，温柔、有画面感，不要像广告，不要太官方。',
      '标题必须像真实婚礼团队/客户发布的小红书爆款标题，必须包含至少 1 个具体颜色词或具体物件名（不能只用"婚礼/现场/氛围/高级感/出片"这种空词凑数）。',
      '标题要有强钩子和收藏理由，优先使用“被...戳中、像电影截图、存进备婚夹、原来、备婚、出片、值得收藏、现场记忆点、落地效果”等小红书口语化但具体的结构；标题不加空格，可以用 1 个小红书感情绪符号或表情，例如 ！、～、🥹、✨；本版本先不要使用“谁懂啊”“真的太会了”“拉满”“别乱堆”“这样才耐看”“看完...我又想重办婚礼”这类重复度高的句式；严禁写成空间设计说明或销售介绍。',
      '合规要求：标题、正文、话题都不要出现极限词或绝对承诺，包括：最、一定、绝对、保证、必须、唯一、第一、顶级、极致、完美、无敌、天花板、封神、全网、100%、百分百、不踩雷、不会踩雷、零风险、必看。',
      '严禁写"专业分镜解析""浪漫细节""高级感拉满""每一场婚礼都""独一无二"等空话套话。',
      '严禁出现：AI、人工智能、模型、提示词、接口、参数、分镜、图生视频、生成图片、生成失败、本次生成、本地兜底 等任何带工具感或技术感的字眼。',
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

function cleanDoubaoVideoPrompt(text = '') {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-z]*|```/gi, ''))
    .replace(/^\s*(最终视频生成提示词|豆包视频提示词|视频生成提示词)\s*[:：]\s*/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 4200);
}

async function imageBufferToVideoPromptPart(buffer, label) {
  const image = await sharp(buffer)
    .rotate()
    .resize(900, 900, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 74 })
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

function cleanImagePromptText(text = '') {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-z]*|```/gi, ''))
    .replace(/^\s*(最终提示词|图片生成提示词|图像生成提示词|豆包提示词|提示词)\s*[:：]\s*/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 2400);
}

async function generateImagePromptCopy(job) {
  const fallback = createCopy('copy_title');
  const requestedInstruction = String(job.userInstruction || '').replace(/\s+/g, ' ').trim().slice(0, 900);
  if (!USE_COPY_API) {
    job.logs.push('[copy] 豆包看图提示词模型未启用，使用本地提示词模板');
    return fallback;
  }
  if (!job.reference?.buffer) {
    job.logs.push('[copy] 未读取到上传图片，使用本地提示词模板');
    return fallback;
  }

  try {
    const imageParts = await imageBufferToVideoPromptPart(
      job.reference.buffer,
      '上传的婚礼图片：请根据用户指令，只基于这张图片生成提示词。',
    );
    const body = {
      model: DOUBAO_VIDEO_PROMPT_MODEL,
      temperature: 0.32,
      max_tokens: 1600,
      messages: [
        {
          role: 'system',
          content: [
            '你是婚礼影像提示词工程师，擅长根据单张婚礼现场图片按用户指令生成提示词。',
            '只输出最终提示词正文，不要输出分析过程、标题、JSON、Markdown 或代码块。',
            '必须优先遵循用户指令来决定输出用途、格式、长度和语气；不要使用固定模板，不要强制分成两段。',
            '提示词必须忠实于图片真实可见内容，不能凭空新增人物、品牌、文字、水印、夸张建筑或画面里没有的装饰。',
          ].join(' '),
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                requestedInstruction
                  ? `用户指令：${requestedInstruction}`
                  : '用户未填写额外指令。请基于图片生成一段通用中文提示词，可用于看图写视频或图片提示词反推，格式自然，不要强制分段。',
                '请只根据上传图片中真实可见的婚礼场地、空间结构、主色调、花艺、布幔、灯光、舞台、通道、桌椅、顶部装饰、构图视角、光影氛围和材质质感来写。',
                '如果用户要求视频提示词，就写清楚首帧/参考画面、运镜、动态幅度、需要保持不变的空间和元素；如果用户要求图片反推，就写清楚图片生成所需的画面描述、风格、构图和负面约束。',
                '如果用户要求其他格式、字数、平台或用途，就按用户要求输出。看不清的元素不要编造；没有人物就不要新增人物；不要生成文字、logo、水印或画面里没有的道具。',
              ].join('\n'),
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
      signal: AbortSignal.timeout(MOTION_DIRECTOR_PROMPT_TIMEOUT_MS),
    });
    const raw = await response.text();
    let payload = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch {}
    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || raw || `HTTP ${response.status}`;
      throw new Error(String(message).replace(/\s+/g, ' ').slice(0, 240));
    }

    const rawContent = payload?.choices?.[0]?.message?.content || payload?.output_text || payload?.content || '';
    const prompt = cleanImagePromptText(Array.isArray(rawContent)
      ? rawContent.map((part) => part?.text || part?.content || '').join(' ')
      : rawContent);
    if (!prompt) throw new Error('empty prompt');
    job.logs.push('[copy] 已根据婚礼图片生成提示词');
    return {
      title: requestedInstruction ? '按指令生成的提示词' : '提示词已生成',
      body: prompt,
      tags: [],
    };
  } catch (error) {
    job.logs.push(`[copy] 豆包看图提示词生成失败，使用本地提示词模板：${String(error?.message || error || 'unknown error').slice(0, 180)}`);
    return fallback;
  }
}

async function buildDoubaoVideoPromptImageParts(job, images, outputDir) {
  const parts = [];
  const selectedImages = images.slice(0, DOUBAO_VIDEO_PROMPT_IMAGE_LIMIT);
  for (const [index, image] of selectedImages.entries()) {
    try {
      const imagePath = path.join(outputDir, image.filename);
      const buffer = await readFile(imagePath);
      parts.push(...await imageBufferToVideoPromptPart(
        buffer,
        `第 ${index + 1} 张生成图：${image.label || `婚礼空镜 ${index + 1}`}。请把它作为视频第 ${index + 1} 个独立镜头的首帧和参考画面。`,
      ));
    } catch (error) {
      job.logs.push(`[doubao-prompt] 读取第 ${index + 1} 张生成图失败，跳过该图：${String(error?.message || error || 'unknown error').slice(0, 160)}`);
    }
  }
  return parts;
}

async function generateDoubaoStoryboardVideoPrompt(job, images, outputDir) {
  if (job.mode !== 'cinematic_storyboard') return '';
  const count = Array.isArray(images) ? images.length : 0;
  if (!USE_COPY_API) {
    job.logs.push('[doubao-prompt] 专属提示词模型未启用，未生成豆包视频提示词');
    return '';
  }

  try {
    const imageParts = await buildDoubaoVideoPromptImageParts(job, images, outputDir);
    if (!imageParts.length) {
      job.logs.push('[doubao-prompt] 未读取到可用于看图的分镜图，未生成豆包视频提示词');
      return '';
    }
    const body = {
      model: DOUBAO_VIDEO_PROMPT_MODEL,
      temperature: 0.45,
      max_tokens: 1800,
      messages: [
        {
          role: 'system',
          content: [
            '你是资深婚礼影像导演，擅长根据多张婚礼空镜图整理成可直接用于图生视频的中文提示词。',
            '只输出最终可复制的豆包视频生成提示词，不要输出分析、不要输出制作方案标题、不要 markdown。',
            '提示词必须让视频模型按图片顺序逐镜头生成，不要拼贴，不要分屏，不要把不同图片融合到一个画面。',
          ].join(' '),
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                `请观察我上传的 ${imageParts.filter((part) => part.type === 'image_url').length} 张婚礼现场生成图，写一段可直接复制到豆包视频生成的中文提示词。`,
                '这些图片来自同一套婚礼电影分镜/多角度空镜图，请按上传顺序规划连续镜头。',
                '最终提示词必须包含：横版16:9、每张图作为独立镜头首帧和参考画面、按上传顺序生成、每个镜头的画面内容和运镜方式、灯光氛围变化、自然淡入淡出或柔和切换。',
                '请根据图片真实内容写具体场景描述，例如场地类型、主色调、舞台/通道/花艺/灯光/桌椅/顶部装饰等；看不清的细节不要编造。',
                '必须先判断并锁定整组图片的场地身份：如果画面是户外/露天/草坪/花园/庭院/露台/海边/森林，就在最终提示词里明确写“全片保持同一户外露天场地/草坪或花园环境”，保留草地、树木、天空、庭院背景、自然光和开放空间；禁止变成室内宴会厅、酒店厅、影棚、教堂、温室、宫殿走廊、地毯房间、室内墙板、室内天花、吊灯或窗帘墙。若户外场景里有白色纱幔/拱门/背景布，要说明它们只是户外仪式区装饰，不是室内墙面或天花。',
                '运镜要克制高级：全景缓慢推进，中景轻微横移，细节镜头轻微靠近，光束/水晶/金属材质可以细微闪烁，花艺和主体布置基本静止。',
                '必须强调：不要拼贴、不要分屏、不要画中画、不要九宫格、不要重新排版、不要新增人物、不要新增文字字幕水印logo、不要改变图片比例、不要把不同图片内容融合到同一个画面。',
                '输出长度控制在 700-1200 个中文字符。只输出这一段最终提示词。',
              ].join('\n'),
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
      signal: AbortSignal.timeout(MOTION_DIRECTOR_PROMPT_TIMEOUT_MS),
    });
    const raw = await response.text();
    let payload = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch {}
    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || raw || `HTTP ${response.status}`;
      throw new Error(String(message).replace(/\s+/g, ' ').slice(0, 240));
    }

    const rawContent = payload?.choices?.[0]?.message?.content || payload?.output_text || payload?.content || '';
    const prompt = cleanDoubaoVideoPrompt(Array.isArray(rawContent)
      ? rawContent.map((part) => part?.text || part?.content || '').join(' ')
      : rawContent);
    if (!prompt) throw new Error('empty prompt');
    job.logs.push(`[doubao-prompt] 已根据 ${count} 张分镜图生成专属豆包视频提示词：${DOUBAO_VIDEO_PROMPT_MODEL}`);
    return prompt;
  } catch (error) {
    const message = String(error?.message || error || 'unknown error').slice(0, 180);
    job.logs.push(`[doubao-prompt] 专属视频提示词模型生成失败，未生成豆包视频提示词：${message}`);
    return '';
  }
}

function doubaoPromptImages(images = []) {
  return (Array.isArray(images) ? images : [])
    .map((image) => ({
      ...image,
      filename: path.basename(String(image?.filename || '').trim()),
    }))
    .filter((image) => image.filename);
}

function resolveDoubaoPromptOutputDir(jobId, resource, images = []) {
  const candidates = [];
  if (resource?.id) candidates.push(path.join(RESOURCES_DIR, resource.id));
  if (jobId) candidates.push(path.join(GENERATED_DIR, jobId));
  for (const candidate of candidates) {
    if (images.some((image) => existsSync(path.join(candidate, image.filename)))) return candidate;
  }
  return candidates[0] || path.join(GENERATED_DIR, jobId || '');
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

function hasCopyPayload(copy) {
  return !!(copy && (copy.title || copy.body || (Array.isArray(copy.tags) && copy.tags.length)));
}

function psLayerSplitReadme(job, images = []) {
  return [
    'WedScene AI - PS white-background layer split',
    '',
    'How to use:',
    '1. Open wedscene-ps-layers.psd directly in Photoshop when available.',
    '2. The PSD contains transparent full-canvas layers plus a bottom white background layer.',
    '3. The images/ folder also contains white-background PNG layer assets for manual import.',
    '4. ps-layer-split-preview.png is a 2x3 white-background preview board for quickly checking the split result.',
    '5. If you use PNG assets manually, keep every layer at its original canvas size and do not move or scale it.',
    '6. White pixels in PNG files are intentional solid white background, not fake transparency. Use a blend mode such as Multiply/正片叠底 or Select Color Range to remove white if needed.',
    '',
    'Important generation rule:',
    'Each file is generated as a full-canvas layer asset. The target element should remain in the original relative position, while non-target areas are solid white.',
    '',
    `Job: ${job?.id || ''}`,
    `Mode: ${MODE_LABELS[job?.mode] || job?.mode || 'ps_layer_split'}`,
    '',
    'Layer files:',
    ...images.map((image, index) => `${String(index + 1).padStart(2, '0')}. ${image.label || image.filename || 'layer image'}`),
    '',
  ].join('\n');
}

async function createDownloadPackage(job, outputDir, images, collageUrl, copy, doubaoVideoPrompt = '') {
  const includeCopy = hasCopyPayload(copy);
  updateJob(job, 98, '正在打包生成素材', includeCopy
    ? (job.mode === 'copy_title'
      ? '[package] 写入提示词'
      : (collageUrl ? '[package] 写入单图、合成首图和文案' : '[package] 写入单图和文案'))
    : (collageUrl ? '[package] 写入单图和合成首图' : '[package] 写入单图'));

  const zipFilename = {
    cinematic_storyboard: 'wedscene-storyboard-package.zip',
    copy_title: 'wedscene-prompt-package.zip',
    setup_comparison: 'wedscene-setup-before-after-package.zip',
    design_render_scene: 'wedscene-design-render-scene-package.zip',
    venue_fusion: 'wedscene-venue-fusion-package.zip',
    product_matrix: 'wedscene-construction-matrix-package.zip',
    handdrawn_plan: 'wedscene-handdrawn-plan-package.zip',
    outdoor_handdrawn_plan: 'wedscene-outdoor-handdrawn-plan-package.zip',
    construction_checklist: 'wedscene-construction-checklist-package.zip',
    detail_grid: 'wedscene-detail-grid-package.zip',
    setup_process_grid: 'wedscene-setup-process-grid-package.zip',
    photo_area_setup_grid: 'wedscene-photo-area-setup-grid-package.zip',
    partial_wedding_edit: 'wedscene-partial-edit-package.zip',
    ps_layer_split: 'wedscene-ps-white-layers-package.zip',
    image_enhance: 'wedscene-image-enhance-package.zip',
    free_text_image: 'wedscene-free-text-image-package.zip',
    free_image_image: 'wedscene-free-image-to-image-package.zip',
  }[job.mode] || 'wedscene-viral-post-package.zip';
  const entries = images.map((image, index) => ({
    file: image.filename,
    name: `images/${String(index + 1).padStart(2, '0')}-${image.label || 'image'}${path.extname(image.filename || '') || '.jpg'}`,
  }));
  if (isPsLayerSplitMode(job.mode)) {
    entries.unshift({ buffer: Buffer.from(psLayerSplitReadme(job, images), 'utf8'), name: 'README-PS-layer-split.txt' });
    try {
      const psdBuffer = await createPsLayerStackPsdBuffer(job, images, outputDir);
      if (psdBuffer?.length) {
        entries.unshift({ buffer: psdBuffer, name: 'wedscene-ps-layers.psd' });
        job.logs.push('[package] 已写入 PSD 分层文件 wedscene-ps-layers.psd');
      }
    } catch (error) {
      job.logs.push(`[package] PSD 写入失败，已保留 PNG 图层包：${String(error?.message || error).slice(0, 160)}`);
    }
  }
  if (collageUrl) {
    entries.push({
      file: collageUrl.split('/').pop(),
      name: isPsLayerSplitMode(job.mode)
        ? 'ps-layer-split-preview.png'
        : (job.mode === 'cinematic_storyboard'
        ? 'cinematic-storyboard.jpg'
        : (job.mode === 'setup_comparison'
          ? 'setup-before-after.jpg'
          : 'viral-cover.jpg')),
    });
  }
  if (includeCopy) {
    entries.push({
      buffer: Buffer.from(`${formatCopyForText(copy)}\n`, 'utf8'),
      name: job.mode === 'copy_title' ? 'prompt.txt' : 'copywriting.txt',
    });
  }
  const videoPromptText = String(doubaoVideoPrompt || '').trim();
  if (videoPromptText) {
    entries.push({ buffer: Buffer.from(`${videoPromptText}\n`, 'utf8'), name: 'doubao-video-prompt.txt' });
  }

  await createZipArchive(outputDir, entries, zipFilename);
  return publicUrl(job.id, zipFilename);
}

async function saveJobResource(job, outputDir, images, collageUrl, zipUrl, copy, motion = null, doubaoVideoPrompt = '') {
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

  const copyFilename = hasCopyPayload(copy) ? (job.mode === 'copy_title' ? 'prompt.txt' : 'copywriting.txt') : '';
  if (copyFilename) {
    await writeFile(path.join(resourceDir, copyFilename), `${formatCopyForText(copy)}\n`, 'utf8');
  }
  const doubaoVideoPromptText = String(doubaoVideoPrompt || '').trim();
  const doubaoVideoPromptFilename = doubaoVideoPromptText ? 'doubao-video-prompt.txt' : '';
  if (doubaoVideoPromptFilename) {
    await writeFile(path.join(resourceDir, doubaoVideoPromptFilename), `${doubaoVideoPromptText}\n`, 'utf8');
  }

  const createdAt = new Date().toISOString();
  const resource = {
    id: resourceId,
    jobId: job.id,
    ownerId: job.ownerId || '',
    ownerLogin: job.ownerLogin || '',
    tenantId: job.tenantId || '',
    tenantSlug: job.tenantSlug || '',
    mode: job.mode,
    modeLabel: MODE_LABELS[job.mode] || job.mode,
    title: copy?.title || MODE_LABELS[job.mode] || '婚礼素材',
    createdAt,
    expiresAt: expiresAtFromCreatedAt(createdAt, RESOURCE_RETENTION.retentionDays),
    provider: motion ? (MOTION_VIDEO_IS_PRO666 ? 'pro666 video-v1' : 'motion video') : (isImageEnhanceMode(job.mode) ? imageEnhanceProviderLabel() : ACTIVE_PROVIDER),
    images: images.map(({ label, filename, width, height }) => ({
      label,
      filename,
      width,
      height,
    })),
    collageFilename,
    zipFilename,
    copyFilename,
    copy: hasCopyPayload(copy) ? copy : null,
    doubaoVideoPromptFilename,
    doubaoVideoPrompt: doubaoVideoPromptText,
    videoFilename,
    motionPosterFilename,
    motionStyle: motion?.style || '',
    motionStyleLabel: motion?.styleLabel || '',
    weddingStyleProfile: job.weddingStyleProfile || null,
    durationSeconds: motion?.durationSeconds || 0,
  };

  await addResourceToManifest(resource);
  return withResourceUrls(resource);
}

function collectExternalImportUrlCandidates(input) {
  const values = Array.isArray(input) ? input : [input];
  const candidates = [];
  for (const value of values) {
    const raw = String(value || '').trim();
    if (!raw) continue;
    const matches = raw.match(/https?:\/\/[^\s<>"'，,、]+/gi);
    if (matches?.length) {
      candidates.push(...matches);
    } else {
      candidates.push(raw);
    }
  }
  return candidates
    .map((url) => String(url || '').replace(/[)\]}>。！？；;]+$/g, '').trim())
    .filter(Boolean);
}

function normalizeExternalImportUrls(input) {
  const seen = new Set();
  const urls = collectExternalImportUrlCandidates(input).filter((url) => {
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
  if (!urls.length) throw new Error('请先粘贴豆包或千问分享链接');
  if (urls.length > EXTERNAL_IMPORT_MAX_LINKS) {
    throw new Error(`一次最多导入 ${EXTERNAL_IMPORT_MAX_LINKS} 条分享链接，请分批提交`);
  }
  return urls;
}

function validateExternalImportUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('请先粘贴豆包或千问分享链接');

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('分享链接格式不正确，请复制完整链接');
  }

  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new Error('只支持 http/https 分享链接');
  }

  const host = parsed.hostname.toLowerCase();
  const supported = /(^|\.)doubao\.com$/.test(host) || /(^|\.)qianwen\.com$/.test(host);
  if (!supported) {
    throw new Error('当前只支持豆包或千问分享链接');
  }

  return parsed.href;
}

function externalImportProvider(sourceUrl = '') {
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    if (host.includes('qianwen')) return 'qianwen';
  } catch {
    // Keep the default below.
  }
  return 'doubao';
}

async function callDoubaoNomark(endpoint, sourceUrl) {
  if (!DOUBAO_NOMARK_API_BASE) {
    throw new Error('未配置豆包素材解析服务地址');
  }

  const response = await fetch(`${DOUBAO_NOMARK_API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ url: sourceUrl, return_raw: false }),
    signal: AbortSignal.timeout(DOUBAO_NOMARK_TIMEOUT_MS),
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const detail = data?.detail || data?.message || data?.error || text || `HTTP ${response.status}`;
    throw new Error(String(detail).slice(0, 180));
  }

  return data || {};
}

function collectExternalImages(payload = {}) {
  const source = Array.isArray(payload.images)
    ? payload.images
    : (Array.isArray(payload.data?.images) ? payload.data.images : []);
  const seen = new Set();
  return source
    .map((item = {}) => {
      const url = String(item.url || item.image_url || item.download_url || item.src || '').trim();
      if (!url || seen.has(url)) return null;
      seen.add(url);
      return {
        url,
        width: Number(item.width) || 0,
        height: Number(item.height) || 0,
      };
    })
    .filter(Boolean)
    .slice(0, EXTERNAL_IMPORT_MAX_ASSETS);
}

function preferNoWatermarkDoubaoVideoUrl(rawUrl = '') {
  return String(rawUrl || '').trim()
    .replace(/([?&])lr=video_gen_watermark(?:_dyn)?(?=&|$)/i, '$1lr=video_gen_no_watermark');
}

function collectExternalVideo(payload = {}) {
  const source = payload.video
    || payload.data?.video
    || (Array.isArray(payload.videos) ? payload.videos[0] : null)
    || (Array.isArray(payload.data?.videos) ? payload.data.videos[0] : null)
    || payload.data
    || payload;
  const url = preferNoWatermarkDoubaoVideoUrl(source?.url || source?.video_url || source?.download_url || payload.video_url || '');
  if (!url) return null;
  return {
    url,
    width: Number(source?.width) || 0,
    height: Number(source?.height) || 0,
    definition: String(source?.definition || source?.quality || '').trim(),
    posterUrl: String(source?.poster_url || source?.posterUrl || source?.cover_url || source?.cover || '').trim(),
  };
}

function extensionFromUrlOrType(url = '', contentType = '', fallback = '.bin') {
  const byType = String(contentType || '').split(';')[0].trim().toLowerCase();
  const typeMap = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
  };
  if (typeMap[byType]) return typeMap[byType];

  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).toLowerCase();
    if (/^\.(jpg|jpeg|png|webp|gif|mp4|webm|mov)$/i.test(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  } catch {
    // Fall through to fallback.
  }

  return fallback;
}

function hostMatchesAllowedImportList(host = '') {
  if (!EXTERNAL_IMPORT_ALLOWED_HOSTS.length) return true;
  const cleanHost = String(host || '').toLowerCase();
  return EXTERNAL_IMPORT_ALLOWED_HOSTS.some((allowed) => {
    const cleanAllowed = String(allowed || '').toLowerCase().replace(/^\*\./, '');
    return cleanHost === cleanAllowed || cleanHost.endsWith(`.${cleanAllowed}`);
  });
}

function isBlockedNetworkAddress(address = '') {
  const ip = normalizeRemoteAddress(address).replace(/^\[|\]$/g, '').toLowerCase();
  if (!ip) return true;
  if (ip === 'localhost' || ip.endsWith('.localhost')) return true;
  if (ip === '::1' || ip === '127.0.0.1' || ip.startsWith('127.')) return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  if (ip === '0.0.0.0' || ip.startsWith('0.')) return true;
  if (/^(fc|fd)[0-9a-f]{2}:/i.test(ip) || /^fe80:/i.test(ip)) return true;
  return false;
}

async function assertSafeExternalAssetUrl(rawUrl = '') {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    throw new Error('素材地址无效');
  }
  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new Error('素材地址只支持 http/https');
  }
  if (parsed.username || parsed.password) {
    throw new Error('素材地址不能包含用户名或密码');
  }

  const host = parsed.hostname.toLowerCase();
  if (!hostMatchesAllowedImportList(host)) {
    throw new Error('素材地址不在允许的下载域名内');
  }
  if (isBlockedNetworkAddress(host)) {
    throw new Error('素材地址不能指向本机或内网地址');
  }

  if (!isIP(host)) {
    let addresses = [];
    try {
      addresses = await lookup(host, { all: true, verbatim: true });
    } catch {
      throw new Error('素材地址域名无法解析');
    }
    if (!addresses.length || addresses.some((item) => isBlockedNetworkAddress(item.address))) {
      throw new Error('素材地址不能解析到本机或内网地址');
    }
  }

  return parsed.href;
}

async function responseBufferWithLimit(response, limitBytes) {
  const maxBytes = Math.max(1, Number(limitBytes || EXTERNAL_IMPORT_MAX_ASSET_BYTES));
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > maxBytes) {
    throw new Error(`素材文件过大，最大允许 ${formatByteSize(maxBytes)}`);
  }

  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error(`素材文件过大，最大允许 ${formatByteSize(maxBytes)}`);
    return buffer;
  }

  const chunks = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maxBytes) {
        throw new Error(`素材文件过大，最大允许 ${formatByteSize(maxBytes)}`);
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function downloadExternalAsset(url, fallbackExtension = '.bin') {
  const safeUrl = await assertSafeExternalAssetUrl(url);
  const response = await fetch(safeUrl, {
    headers: { Accept: '*/*' },
    signal: AbortSignal.timeout(DOUBAO_NOMARK_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`下载素材失败：HTTP ${response.status}`);

  const buffer = await responseBufferWithLimit(response, EXTERNAL_IMPORT_MAX_ASSET_BYTES);
  if (!buffer.length) throw new Error('下载素材失败：内容为空');

  const contentType = response.headers.get('content-type') || '';
  if (/text\/html/i.test(contentType) || textLooksLikeHtml(buffer.toString('utf8', 0, Math.min(buffer.length, 2000)))) {
    throw new Error('下载素材失败：解析服务返回了网页内容');
  }

  return {
    buffer,
    extension: extensionFromUrlOrType(safeUrl, contentType, fallbackExtension),
  };
}

async function saveExternalImportResource(req, sourceUrl, parsed) {
  const provider = externalImportProvider(sourceUrl);
  const resourceId = `${Date.now().toString(36)}-external-${randomBytes(3).toString('hex')}`;
  const resourceDir = path.join(RESOURCES_DIR, resourceId);
  await mkdir(resourceDir, { recursive: true });

  const images = [];
  for (const [index, image] of parsed.images.entries()) {
    const asset = await downloadExternalAsset(image.url, '.jpg');
    const filename = `external-image-${String(index + 1).padStart(2, '0')}${asset.extension}`;
    await writeFile(path.join(resourceDir, filename), asset.buffer);
    let width = image.width;
    let height = image.height;
    try {
      const meta = await sharp(asset.buffer).metadata();
      width = Number(meta.width) || width;
      height = Number(meta.height) || height;
    } catch {
      // Keep parser dimensions when sharp cannot read metadata.
    }
    images.push({
      label: `${provider === 'qianwen' ? '千问' : '豆包'}原图 ${index + 1}`,
      filename,
      width,
      height,
    });
  }

  let videoFilename = '';
  let motionPosterFilename = '';
  if (parsed.video?.url) {
    const videoAsset = await downloadExternalAsset(parsed.video.url, '.mp4');
    const ext = videoAsset.extension === '.bin' ? '.mp4' : videoAsset.extension;
    videoFilename = `external-video${ext}`;
    const videoPath = path.join(resourceDir, videoFilename);
    await writeFile(videoPath, videoAsset.buffer);
    if (provider === 'doubao' && EXTERNAL_IMPORT_VIDEO_WATERMARK_REMOVE && /\.mp4$/i.test(videoFilename)) {
      await removeMotionWatermark(videoPath, null, {
        enabled: true,
        box: EXTERNAL_IMPORT_VIDEO_WATERMARK_BOX,
        logPrefix: 'external-import',
      });
    }

    if (parsed.video.posterUrl) {
      try {
        const posterAsset = await downloadExternalAsset(parsed.video.posterUrl, '.jpg');
        motionPosterFilename = `external-video-poster${posterAsset.extension === '.bin' ? '.jpg' : posterAsset.extension}`;
        await writeFile(path.join(resourceDir, motionPosterFilename), posterAsset.buffer);
      } catch (error) {
        console.warn(`[external-import] poster download failed: ${error.message}`);
      }
    }
  }

  const createdAt = new Date().toISOString();
  const resource = {
    id: resourceId,
    jobId: '',
    ownerId: req.user?.id || '',
    ownerLogin: req.user?.phone || req.user?.name || '',
    tenantId: req.user?.tenantId || '',
    tenantSlug: req.tenant?.slug || '',
    mode: 'external_asset_import',
    modeLabel: provider === 'qianwen' ? '千问素材导入' : '豆包素材导入',
    title: provider === 'qianwen' ? '千问素材导入' : '豆包素材导入',
    createdAt,
    expiresAt: expiresAtFromCreatedAt(createdAt, RESOURCE_RETENTION.retentionDays),
    provider: 'doubao-nomark',
    sourceUrl,
    images,
    collageFilename: '',
    zipFilename: '',
    copyFilename: '',
    copy: null,
    videoFilename,
    motionPosterFilename,
    motionStyle: '',
    motionStyleLabel: parsed.video?.definition || '',
    durationSeconds: 0,
  };

  await addResourceToManifest(resource);
  return withResourceUrls(resource);
}

async function importExternalDoubaoResource(req, sourceUrl) {
  const normalizedUrl = validateExternalImportUrl(sourceUrl);
  const [imageResult, videoResult] = await Promise.allSettled([
    callDoubaoNomark('/parse', normalizedUrl),
    callDoubaoNomark('/parse-video', normalizedUrl),
  ]);

  const parsed = {
    images: imageResult.status === 'fulfilled' ? collectExternalImages(imageResult.value) : [],
    video: videoResult.status === 'fulfilled' ? collectExternalVideo(videoResult.value) : null,
  };

  if (!parsed.images.length && !parsed.video) {
    const errors = [imageResult, videoResult]
      .filter((item) => item.status === 'rejected')
      .map((item) => item.reason?.message)
      .filter(Boolean)
      .join('；');
    throw new Error(errors || '没有解析到可导入的图片或视频');
  }

  return saveExternalImportResource(req, normalizedUrl, parsed);
}

async function importExternalDoubaoResources(req, input) {
  const urls = normalizeExternalImportUrls(input);
  const resources = [];
  const failures = [];

  for (const [index, url] of urls.entries()) {
    try {
      resources.push(await importExternalDoubaoResource(req, url));
    } catch (error) {
      failures.push({
        index,
        url,
        message: String(error?.message || '素材导入失败').slice(0, 180),
      });
    }
  }

  if (!resources.length) {
    const failureText = failures
      .map((failure, index) => `${index + 1}. ${failure.message}`)
      .filter(Boolean)
      .join('；');
    throw new Error(failureText || '没有解析到可导入的图片或视频');
  }

  return {
    resources,
    failures,
    requestedCount: urls.length,
  };
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
      if (!uploadedFiles.length) {
        if (!isFreeTextImageMode(job.mode)) throw new Error('任务缺少参考图，请重新上传后生成');
        job.logs.push(`[input] 已进入文生图模式：${job.freeImageCount} 张 · ${job.freeImageSize} · ${job.freeImageQuality} · ${job.freeImageFormat}`);
        updateJob(job, 18, `已确认模式：${MODE_LABELS[job.mode]}`, `[mode] ${MODE_LABELS[job.mode]}`);
      } else {
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
        job.logs.push('[input] 已保留双图独立参考：图1=空地/空场，图2=婚礼素材；参考板仅用于排查，不参与图片生成');
      }
      if (isPartialWeddingEditMode(job.mode)) {
        job.partialEditReferences = references;
        job.logs.push(`[input] 已进入局部改图模式：主图 1 张，参考图 ${Math.max(0, references.length - 1)} 张，指令已锁定`);
        if (job.editMaskFile?.buffer) {
          const maskImage = await sharp(job.editMaskFile.buffer, { failOn: 'none' })
            .rotate()
            .resize(job.reference.width, job.reference.height, { fit: 'fill' })
            .ensureAlpha()
            .png({ compressionLevel: 9, adaptiveFiltering: true })
            .toBuffer({ resolveWithObject: true });
          job.partialEditMask = {
            buffer: maskImage.data,
            mimetype: 'image/png',
            filename: 'edit-mask.png',
            storedFilename: 'edit-mask.png',
            width: maskImage.info.width,
            height: maskImage.info.height,
            role: 'partial_edit_mask',
          };
          await writeFile(path.join(outputDir, 'edit-mask.png'), maskImage.data);
          job.logs.push(`[input] 已接收手绘蒙版，尺寸 ${maskImage.info.width}x${maskImage.info.height}`);
        }
        job.partialEditReferenceNotes = await describePartialEditStyleReferences(job);
      }
      if (isPsLayerSplitMode(job.mode)) {
        job.logs.push('[input] 已进入PS白底分层模式：主图作为锁定画布，输出6张同画幅白底图层');
      }
      if (isFreeImageToImageMode(job.mode)) {
        job.freeImageReferences = references;
        job.logs.push(`[input] 已进入图生图模式：参考图 ${references.length} 张 · 输出 ${job.freeImageCount} 张 · ${job.freeImageSize} · ${job.freeImageQuality} · ${job.freeImageFormat}`);
      }
      updateJob(job, 18, `已确认模式：${MODE_LABELS[job.mode]}`, `[mode] ${MODE_LABELS[job.mode]}`);
      }
    } else {
      const { completed, total } = getResumeInfo(job);
      updateJob(job, Math.max(job.progress || 18, 22 + completed * 10), `自动继续生成：${completed}/${total} 已完成`, `[resume] 已保留 ${completed}/${total} 张，自动继续生成剩余图片`);
    }

    if (job.mode === 'similar_style' && !job.weddingStyleProfile) {
      updateJob(job, 20, '正在识别婚礼风格', '[wedding-style] analyzing uploaded wedding image against domestic style rules');
      job.weddingStyleProfile = await analyzeSimilarWeddingStyle(job);
      queueJobLedgerSnapshot(job);
      const styleName = job.weddingStyleProfile?.style_name || '国内婚礼风格';
      updateJob(job, 22, `已识别风格：${styleName}`, `[wedding-style] profile ready: ${styleName}`);
    }

    const existingImages = job.partialImages || [];
    let images = [];
    let collageUrl = '';
    let motionResult = null;
    let doubaoVideoPrompt = '';

    throwIfJobCancelled(job);
    if (job.mode === 'motion_video') {
      motionResult = await generateMotionVideo(job, outputDir);
      throwIfJobCancelled(job);
    } else if (job.mode === 'copy_title') {
      updateJob(job, 72, '正在根据婚礼图片生成提示词', '[copy] 不生成图片，直接根据上传现场照整理提示词');
    } else if (isImageEnhanceMode(job.mode)) {
      images = await enhanceUploadedImage(job, outputDir);
      throwIfJobCancelled(job);
      collageUrl = await createCollage(job, outputDir, images);
    } else if (isFreeImageMode(job.mode)) {
      images = USE_OPENAI_COMPAT
        ? await generateFreeImages(job, outputDir, existingImages)
        : await generateFreeMockImages(job, outputDir, existingImages);
      throwIfJobCancelled(job);
      collageUrl = await createCollage(job, outputDir, images);
    } else if (job.mode === 'construction_checklist') {
      images = await createConstructionChecklistFromMatrixExports(job, outputDir);
      throwIfJobCancelled(job);
      collageUrl = '';
    } else {
      if (isPartialWeddingEditMode(job.mode) && !USE_XIAOJI && !USE_OPENAI_COMPAT) {
        throw new Error('该功能需要可用的图片编辑接口，当前服务处于 mock 模式，已停止生成以避免输出误导性的本地叠图。');
      }
      if (isPsLayerSplitMode(job.mode)) {
        try {
          images = await generatePsLayerSplitMasksWithOpenAI(job, outputDir);
        } catch (error) {
          if (isJobCancelledError(error)) throw error;
          const message = cleanUserErrorMessage(error.message || error).slice(0, 220);
          job.logs.push(`[ps-layer] GPT-Image2 分层生成失败，已停止本地兜底：${message}`);
          throw new Error(`GPT-Image2 分层生成失败：${message}`);
        }
      } else {
        images = USE_OPENAI_COMPAT
          ? await generateWithOpenAI(job, outputDir, existingImages)
          : await generateMockImages(job, outputDir, existingImages);
      }
      throwIfJobCancelled(job);
      collageUrl = await createCollage(job, outputDir, images);
    }

    throwIfJobCancelled(job);
    let copy = null;
    let zipUrl = '';
    if (job.mode === 'motion_video') {
      // 视频模式跳过文案、collage、zip
      updateJob(job, 96, '正在保存到我的资源', '[resource] 正在写入视频资源');
    } else if (job.mode === 'copy_title') {
      updateJob(job, 96, '正在生成提示词', '[copy] 正在调用豆包看图提示词模型');
      copy = await generateImagePromptCopy(job);
      throwIfJobCancelled(job);
      zipUrl = await createDownloadPackage(job, outputDir, images, collageUrl, copy);
      updateJob(job, 99, '正在保存到我的资源', '[resource] 正在写入提示词资源，方便客户查看保存');
    } else {
      if (job.mode === 'cinematic_storyboard') {
        updateJob(job, 96, '正在整理豆包视频提示词', '[doubao-prompt] 正在根据 6 张分镜图整理专属视频提示词');
        doubaoVideoPrompt = await generateDoubaoStoryboardVideoPrompt(job, images, outputDir);
        throwIfJobCancelled(job);
      }
      zipUrl = await createDownloadPackage(job, outputDir, images, collageUrl, null, doubaoVideoPrompt);
      updateJob(job, 99, '正在保存到我的资源', '[resource] 正在写入我的资源，方便客户查看保存');
    }

    const resource = await saveJobResource(job, outputDir, images, collageUrl, zipUrl, copy, motionResult, doubaoVideoPrompt);
    const collageFilename = collageUrl ? collageUrl.split('/').pop() : '';
    const zipFilename = zipUrl ? zipUrl.split('/').pop() : '';
    job.result = {
      jobId: job.id,
      mode: job.mode,
      images,
      items: images.map(({ label, url, filename, downloadUrl, width, height }) => ({ label, url, filename, downloadUrl, width, height })),
      collageUrl,
      collageDownloadUrl: collageFilename ? downloadUrl(job.id, collageFilename) : '',
      psPreviewUrl: isPsLayerSplitMode(job.mode) ? collageUrl : '',
      psPreviewDownloadUrl: isPsLayerSplitMode(job.mode) && collageFilename ? downloadUrl(job.id, collageFilename) : '',
      zipUrl,
      zipDownloadUrl: zipFilename ? downloadUrl(job.id, zipFilename) : '',
      copy,
      doubaoVideoPrompt,
      resource,
      mock: isImageEnhanceMode(job.mode) ? false : (ACTIVE_PROVIDER === 'mock' || (motionResult?.mock === true)),
      provider: isImageEnhanceMode(job.mode) ? imageEnhanceProviderLabel() : ACTIVE_PROVIDER,
      videoUrl: motionResult?.videoFilename ? publicUrl(job.id, motionResult.videoFilename) : '',
      videoDownloadUrl: motionResult?.videoFilename ? downloadUrl(job.id, motionResult.videoFilename) : '',
      videoPosterUrl: motionResult ? publicUrl(job.id, 'motion-source.jpg') : '',
      motionStyle: motionResult?.style || '',
      motionStyleLabel: motionResult?.styleLabel || '',
      weddingStyleProfile: job.weddingStyleProfile || null,
      durationSeconds: motionResult?.durationSeconds || 0,
      resolution: isImageEnhanceMode(job.mode) ? job.imageEnhanceSize : (motionResult?.resolution || ''),
    };
    job.status = 'completed';
    const motionDoneName = (job.motionReferences?.length || 0) >= 3
      ? '连续转场视频'
      : ((job.motionReferences?.length || 0) >= 2 ? '首尾帧运镜视频' : '运镜视频');
    const doneStageMap = {
      copy_title: '提示词已生成',
      design_render_scene: '实景图已生成',
      venue_fusion: '空地婚礼融合图已生成',
      product_matrix: '方案施工矩阵图已生成',
      handdrawn_plan: '手绘方案推演图已生成',
      outdoor_handdrawn_plan: '户外小清新手绘图已生成',
      construction_checklist: '落地施工清单图已生成',
      detail_grid: '九宫格细节图已生成',
      setup_process_grid: '搭建视频九宫格已生成',
      photo_area_setup_grid: '留影区搭建九宫格已生成',
      partial_wedding_edit: '局部改图候选已生成',
      ps_layer_split: 'PS白底分层素材已生成',
      image_enhance: '高清优化图已生成',
      free_text_image: '自由创作文生图已生成',
      free_image_image: '自由创作图生图已生成',
    };
    const doneLogMap = {
      copy_title: '[done] 提示词已就绪，并已自动保存到我的资源',
      design_render_scene: '[done] 设计图转实景图已就绪，并已自动保存到我的资源',
      venue_fusion: '[done] 空地婚礼融合图已就绪，并已自动保存到我的资源',
      product_matrix: '[done] 方案施工矩阵图已就绪，并已自动保存到我的资源',
      handdrawn_plan: '[done] 手绘方案推演图已就绪，并已自动保存到我的资源',
      outdoor_handdrawn_plan: '[done] 户外小清新手绘图已就绪，并已自动保存到我的资源',
      construction_checklist: '[done] 落地施工清单图已就绪，并已自动保存到我的资源',
      detail_grid: '[done] 九宫格细节图已就绪，并已自动保存到我的资源',
      setup_process_grid: '[done] 搭建视频九宫格已就绪，并已自动保存到我的资源',
      photo_area_setup_grid: '[done] 留影区搭建九宫格已就绪，并已自动保存到我的资源',
      partial_wedding_edit: '[done] 局部改图候选已就绪，并已自动保存到我的资源',
      ps_layer_split: '[done] PS白底分层素材已就绪，并已自动保存到我的资源',
      image_enhance: '[done] 高清优化图已就绪，并已自动保存到我的资源',
      free_text_image: '[done] 自由创作文生图已就绪，并已自动保存到我的资源',
      free_image_image: '[done] 自由创作图生图已就绪，并已自动保存到我的资源',
    };
    const doneStage = job.mode === 'motion_video'
      ? `${motionDoneName}已生成`
      : (doneStageMap[job.mode] || '图片已生成');
    const doneLog = job.mode === 'motion_video'
      ? `[done] ${motionDoneName}已就绪，并已自动保存到我的资源`
      : (doneLogMap[job.mode] || '[done] 图片素材已就绪，并已自动保存到我的资源');
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
    } else {
      console.error('[job-error] job=' + job.id + ' mode=' + job.mode + ' ' + String(error?.stack || error?.message || error).replace(/\s+/g, ' ').slice(0, 1600));
    }
    job.error = cleanUserErrorMessage(error.message || '生成失败');
    const { completed, total } = getResumeInfo(job);
    const canResume = getResumeInfo(job).canResume;
    const refundedUser = (completed === 0 || !canResume) ? await refundJobCharge(job, job.error) : null;
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

function voiceCloneEndpoint(pathname = VOICE_CLONE_TTS_PATH) {
  const cleanPath = String(pathname || '/tts').startsWith('/') ? pathname : `/${pathname}`;
  return `${VOICE_CLONE_API_BASE}${cleanPath}`;
}

function uploadedVoiceExtension(file) {
  const ext = path.extname(String(file?.originalname || '')).toLowerCase().replace(/^\./, '');
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(ext)) return ext;
  const mimetype = String(file?.mimetype || '').toLowerCase();
  if (mimetype.includes('mpeg') || mimetype.includes('mp3')) return 'mp3';
  if (mimetype.includes('mp4')) return 'm4a';
  if (mimetype.includes('aac')) return 'aac';
  if (mimetype.includes('ogg')) return 'ogg';
  if (mimetype.includes('flac')) return 'flac';
  return 'wav';
}

async function synthesizeVoiceWithGptSovits({ text, referenceText, referenceAudioPath }) {
  if (!VOICE_CLONE_API_BASE || VOICE_CLONE_PROVIDER === 'disabled') {
    throw new Error('声音引擎未配置：请先启动 GPT-SoVITS API，并设置 VOICE_CLONE_API_BASE 或 GPT_SOVITS_API_BASE');
  }
  if (!/gpt-?sovits/i.test(VOICE_CLONE_PROVIDER)) {
    throw new Error(`暂不支持的声音引擎：${VOICE_CLONE_PROVIDER}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VOICE_CLONE_TIMEOUT_MS);
  try {
    const response = await fetch(voiceCloneEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        text,
        text_lang: VOICE_CLONE_TEXT_LANG,
        ref_audio_path: referenceAudioPath,
        prompt_text: referenceText || '',
        prompt_lang: VOICE_CLONE_PROMPT_LANG,
        text_split_method: 'cut5',
        batch_size: 1,
        media_type: 'wav',
        streaming_mode: false,
      }),
    });
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const payload = Buffer.from(await response.arrayBuffer());
    if (!response.ok) {
      let message = payload.toString('utf8');
      if (contentType.includes('application/json')) {
        try {
          const json = JSON.parse(message || '{}');
          message = json.error || json.message || message;
        } catch {}
      }
      throw new Error(message || `声音引擎返回 ${response.status}`);
    }
    if (!contentType.startsWith('audio/') && payload.slice(0, 12).toString('utf8').trim().startsWith('{')) {
      const json = JSON.parse(payload.toString('utf8') || '{}');
      throw new Error(json.error || json.message || '声音引擎没有返回音频');
    }
    return {
      buffer: payload,
      contentType: contentType.startsWith('audio/') ? contentType : 'audio/wav',
    };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('声音引擎响应超时，请稍后重试');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    openaiEnabled: ACTIVE_PROVIDER !== 'mock',
    provider: ACTIVE_PROVIDER !== 'mock' ? 'api' : 'mock',
    imageProvider: ACTIVE_PROVIDER,
    imageModel: ACTIVE_MODEL,
    imageEnhanceModel: IMAGE_ENHANCE_IMAGE_MODELS[0] || IMAGE_ENHANCE_MODEL,
    imageEnhanceDefaultSize: DEFAULT_IMAGE_ENHANCE_SIZE,
    imageEnhanceAvailable: IMAGE_ENHANCE_AVAILABLE,
    imageEnhanceRequiresGeminiKey: !HAS_GEMINI_KEY,
    imageEnhanceMessage: IMAGE_ENHANCE_AVAILABLE ? '' : IMAGE_ENHANCE_UNAVAILABLE_MESSAGE,
    imageInputMode: USE_N1N ? N1N_IMAGE_INPUT_MODE : (USE_OPENAI_COMPAT ? 'edit' : 'mock'),
    copyEnabled: USE_COPY_API,
    chatEnabled: HAS_OPENAI_KEY && !!CHAT_API_ENDPOINT && !!CHAT_MODEL,
    chatModel: CHAT_MODEL,
    motionVideoModel: MOTION_VIDEO_REQUEST_MODEL,
    motionVideoEndpointHost: (() => {
      try { return new URL(MOTION_VIDEO_ENDPOINT).host; } catch { return ''; }
    })(),
    motionVideoMockMode: USE_MOCK_MOTION_VIDEO,
    voiceCloneConfigured: !!VOICE_CLONE_API_BASE && VOICE_CLONE_PROVIDER !== 'disabled',
    voiceCloneProvider: VOICE_CLONE_PROVIDER,
    referenceImageEnabled: USE_OPENAI_COMPAT,
    referenceMode: USE_OPENAI_COMPAT ? 'edit' : 'mock',
    accessRequired: ACCOUNT_SYSTEM_ENABLED || !!PUBLIC_ACCESS_CODE,
    accountRequired: ACCOUNT_SYSTEM_ENABLED,
  });
});

app.post('/api/chat', rateLimit(GENERATE_IP_RATE, {
  limit: 40,
  windowMs: 60_000,
  message: 'AI 对话请求过于频繁，请稍后再试',
}), requireAccess, chatJsonParser, async (req, res) => {
  let chatRequestId = '';
  let chargedPointCost = 0;
  let chargedUser = req.user;
  const chargeMeta = {
    tenantId: req.user?.tenantId || '',
    tenantSlug: req.user?.tenantSlug || '',
  };
  try {
    if (!HAS_OPENAI_KEY || !CHAT_API_ENDPOINT || !CHAT_MODEL) {
      res.status(503).json({ error: 'AI 对话接口未配置，请检查 OPENAI_API_KEY / N1N_API_KEY' });
      return;
    }

    const messages = normalizeChatMessages(req.body?.messages);
    const images = normalizeChatImages(req.body?.images);
    const lastUserIndex = (() => {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index]?.role === 'user') return index;
      }
      return -1;
    })();
    if (lastUserIndex === -1 && images.length) {
      messages.push({ role: 'user', content: '请根据这些参考图进行分析。' });
    }
    const finalUserIndex = (() => {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index]?.role === 'user') return index;
      }
      return -1;
    })();
    if (finalUserIndex === -1) {
      res.status(400).json({ error: '请输入要发送的对话内容' });
      return;
    }

    const requestMessages = messages.map((message) => ({ ...message }));
    if (images.length) {
      requestMessages[finalUserIndex] = {
        role: 'user',
        content: chatMessageContentWithImages(requestMessages[finalUserIndex]?.content || '', images),
      };
    }

    const pointCost = ACCOUNT_SYSTEM_ENABLED ? CHAT_POINT_COST : 0;
    if (pointCost > 0) {
      chatRequestId = newId('chat');
      chargedPointCost = pointCost;
      try {
        const charge = await adjustUserPoints(
          req.user.id,
          -pointCost,
          'generate',
          `AI 对话${images.length ? `（${images.length} 张参考图）` : ''}`,
          chatRequestId,
          chargeMeta,
        );
        chargedUser = charge.user;
      } catch (error) {
        res.status(error.status || 402).json({
          error: error.message || '灵感值不足，请先充值',
          balance: error.balance ?? req.user?.points ?? 0,
          pointCost,
          user: publicUser(req.user),
        });
        return;
      }
    }

    const systemPrompt = normalizeChatText(req.body?.system || DEFAULT_CHAT_SYSTEM_PROMPT, 1200) || DEFAULT_CHAT_SYSTEM_PROMPT;
    const body = {
      model: CHAT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        ...requestMessages,
      ],
      temperature: CHAT_TEMPERATURE,
      max_tokens: CHAT_MAX_TOKENS,
      stream: false,
    };

    const response = await fetch(CHAT_API_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CHAT_REQUEST_TIMEOUT_MS),
    });
    const raw = await response.text();
    let payload = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch {}
    if (!response.ok) {
      const upstreamMessage = payload?.error?.message || payload?.message || raw || `HTTP ${response.status}`;
      const refundedUser = await refundChatCharge(
        req.user?.id,
        chatRequestId,
        chargedPointCost,
        'AI 对话失败自动退回灵感值',
        chargeMeta,
      );
      if (refundedUser) chargedUser = refundedUser;
      res.status(response.status >= 500 ? 502 : response.status).json({
        error: publicChatError(response.status, upstreamMessage),
        pointCost: chargedPointCost,
        user: chargedUser ? publicUser(chargedUser) : null,
      });
      return;
    }

    const message = chatCompletionText(payload);
    res.json({
      ok: true,
      model: payload?.model || CHAT_MODEL,
      message,
      usage: payload?.usage || null,
      pointCost: chargedPointCost,
      user: chargedUser ? publicUser(chargedUser) : null,
    });
  } catch (error) {
    const status = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 504 : 500;
    const refundedUser = await refundChatCharge(
      req.user?.id,
      chatRequestId,
      chargedPointCost,
      'AI 对话失败自动退回灵感值',
      chargeMeta,
    );
    if (refundedUser) chargedUser = refundedUser;
    res.status(status).json({
      error: publicChatError(status, error?.message || 'AI 对话失败'),
      pointCost: chargedPointCost,
      user: chargedUser ? publicUser(chargedUser) : null,
    });
  }
});

function publicMotionConfig() {
  const minReferenceCount = MOTION_VIDEO_IS_PRO666 ? 0 : motionMinimumReferenceCountForModel();
  const pro666DefaultMode = normalizePro666VideoModelMode(MOTION_VIDEO_REQUEST_MODEL);
  return {
    pointCost: MOTION_POINT_COST,
    durationSeconds: MOTION_VIDEO_DURATION,
    durationOptions: MOTION_VIDEO_IS_PRO666 ? VIDEO_V1_ALLOWED_DURATIONS : [MOTION_VIDEO_DURATION],
    resolution: MOTION_VIDEO_RESOLUTION,
    aspectRatio: MOTION_VIDEO_IS_PRO666 ? motionVideoColonAspectRatio() : MOTION_VIDEO_ASPECT_RATIO,
    minReferenceCount,
    referenceLimit: motionReferenceLimitForModel(),
    defaultModelMode: MOTION_VIDEO_IS_PRO666 ? pro666DefaultMode : '',
    modelVariants: MOTION_VIDEO_IS_PRO666 ? [
      {
        key: 'fast',
        label: '快速',
        model: PRO666_VIDEO_FAST_MODEL,
        referenceLimit: motionReferenceLimitForModel(PRO666_VIDEO_FAST_MODEL),
        mediaReferenceLimit: pro666VideoMediaLimitForModel(PRO666_VIDEO_FAST_MODEL),
        videoReferenceLimit: PRO666_VIDEO_REFERENCE_VIDEO_LIMIT,
        audioReferenceLimit: PRO666_VIDEO_REFERENCE_AUDIO_LIMIT,
      },
      {
        key: 'quality',
        label: '质量',
        model: PRO666_VIDEO_QUALITY_MODEL,
        referenceLimit: motionReferenceLimitForModel(PRO666_VIDEO_QUALITY_MODEL),
        mediaReferenceLimit: pro666VideoMediaLimitForModel(PRO666_VIDEO_QUALITY_MODEL),
        videoReferenceLimit: PRO666_VIDEO_REFERENCE_VIDEO_LIMIT,
        audioReferenceLimit: PRO666_VIDEO_REFERENCE_AUDIO_LIMIT,
      },
    ] : [],
    publicBaseConfigured: !!currentPublicBaseUrl(),
    mockMode: USE_MOCK_MOTION_VIDEO,
    model: MOTION_VIDEO_REQUEST_MODEL,
    provider: MOTION_VIDEO_IS_PRO666 ? 'pro666' : (MOTION_VIDEO_IS_N1N_OPENAI || MOTION_VIDEO_IS_N1N_UNIFIED ? 'n1n' : ''),
    endpointHost: (() => {
      try { return new URL(MOTION_VIDEO_ENDPOINT).host; } catch { return ''; }
    })(),
    styles: Object.entries(MOTION_STYLES).filter(([key]) => key === DEFAULT_MOTION_STYLE).map(([key, info]) => ({
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
  if (tenantContacts.length) return tenantContacts.slice(0, 1);

  const hasTenant = !!tenant;
  const primaryWechat = String(hasTenant ? tenant?.supportWechat : SUPPORT_WECHAT || '').trim();
  const primaryQr = publicAbsoluteUrl(hasTenant ? tenant?.supportWechatQr : SUPPORT_WECHAT_QR || '');
  return [
    { wechat: primaryWechat, qr: primaryQr },
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
  const packageOnly = profile.packageOnly === true;
  const includesMotion = profile.includesMotion !== false;
  const grantPoints = Object.hasOwn(profile, 'grantPoints') ? Number(profile.grantPoints || 0) : points;
  const pointsForGenerations = packageOnly ? 0 : points;
  const textGenerations = TEXT_POINT_COST > 0 ? Math.floor(pointsForGenerations / TEXT_POINT_COST) : pointsForGenerations;
  const singleImageGenerations = JOB_POINT_COST > 0 ? Math.floor(pointsForGenerations / JOB_POINT_COST) : pointsForGenerations;
  const motionGenerations = includesMotion && MOTION_POINT_COST > 0 ? pointsForGenerations / MOTION_POINT_COST : 0;
  const imageUnitCost = price && singleImageGenerations ? price / singleImageGenerations : 0;
  const motionUnitCost = price && motionGenerations ? price / motionGenerations : 0;
  const idBase = `${priceText}-${pointsText}`.replace(/[^\w\u4e00-\u9fa5.-]+/g, '-').replace(/^-+|-+$/g, '');
  return {
    id: idBase || `plan-${index + 1}`,
    name: profile.name || `${priceText || '自定义'}套餐`,
    priceText,
    price,
    pointsText: profile.pointsText || pointsText,
    rawPointsText: pointsText,
    points: grantPoints,
    rawPoints: points,
    grantPoints,
    packageOnly,
    packageText: profile.packageText || '',
    badge: profile.badge || '',
    description: profile.description || '',
    benefits: Array.isArray(profile.benefits) ? profile.benefits : [],
    includesMotion,
    featured: !!profile.featured,
    durationDays: Number(profile.durationDays || 0),
    durationText: profile.durationText || '',
    imageGenerations: singleImageGenerations,
    textGenerations,
    singleImageGenerations,
    imageUnitCost,
    motionGenerations,
    motionUnitCost,
  };
}

function tenantRechargePlansText(tenant = null) {
  return String(tenant?.rechargePlans || '').trim() || RECHARGE_PLANS;
}

function normalizeRechargePlansText(value, options = {}) {
  const allowEmpty = options.allowEmpty !== false;
  const text = String(value || '').trim();
  if (!text) {
    if (allowEmpty) return '';
    const error = new Error('请至少配置一个套餐');
    error.status = 400;
    throw error;
  }
  if (text.length > 800) {
    const error = new Error('套餐配置太长，请控制在 800 字以内');
    error.status = 400;
    throw error;
  }
  const parts = text.split(';').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) {
    if (allowEmpty) return '';
    const error = new Error('请至少配置一个套餐');
    error.status = 400;
    throw error;
  }
  if (parts.length > 12) {
    const error = new Error('套餐数量不能超过 12 个');
    error.status = 400;
    throw error;
  }
  const invalid = parts.find((part, index) => {
    const plan = parseRechargePlan(part, index);
    return !plan.priceText || !plan.rawPointsText || plan.price <= 0 || (plan.rawPoints <= 0 && !plan.packageOnly);
  });
  if (invalid) {
    const error = new Error(`套餐格式不正确：${invalid}，请使用 39元=300灵感值`);
    error.status = 400;
    throw error;
  }
  return parts.join(';');
}

function publicRechargePlans(source = RECHARGE_PLANS) {
  return String(source || '').split(';')
    .map((plan, index) => parseRechargePlan(plan, index))
    .filter((plan) => plan.priceText && plan.pointsText && (plan.points > 0 || plan.packageOnly));
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

function adminAccountKeyMatches(user, key = '') {
  const rawKey = String(key || '').trim();
  if (!rawKey) return false;
  const normalizedKey = normalizeLogin(rawKey);
  return String(user.id || '') === rawKey || normalizeLogin(user.login) === normalizedKey;
}

function findAdminAccount(store, key = '') {
  return (Array.isArray(store.users) ? store.users : []).find((user) => adminAccountKeyMatches(user, key));
}

function adminAccountMatchesQuery(user, query = '', tenantsById = new Map()) {
  const raw = String(query || '').trim().toLowerCase();
  if (!raw) return false;
  const normalized = normalizeLogin(raw);
  const phone = normalizePhone(raw);
  const tenant = tenantsById.get(String(user.tenantId || ''));
  const values = [
    user.id,
    user.login,
    user.phone,
    user.name,
    user.role,
    user.source,
    user.status,
    user.tenantId,
    user.tenantSlug,
    user.tenantRole,
    tenant?.name,
    tenant?.brandName,
    tenant?.slug,
    ...(Array.isArray(tenant?.domains) ? tenant.domains : []),
  ];
  if (normalizeLogin(user.login) === normalized || String(user.id || '').toLowerCase() === raw) return true;
  if (phone && [user.login, user.phone].some((value) => normalizePhone(value).includes(phone))) return true;
  return values.some((value) => String(value || '').toLowerCase().includes(raw));
}

function normalizeAdminMembershipExpiry(value) {
  if (value == null) return undefined;
  const text = String(value || '').trim();
  if (!text) return '';
  const source = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T23:59:59+08:00` : text;
  const date = new Date(source);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeAdminLoginCode(value = '') {
  const code = String(value || '').trim();
  if (code.length < 6 || code.length > 32) return '';
  return code;
}

function normalizeGeoText(value = '', maxLength = 160) {
  return String(value || '')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeGeoUrl(value = '') {
  let text = normalizeGeoText(value, 260);
  if (!text) return '';
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  try {
    const parsed = new URL(text);
    if (!/^https?:$/i.test(parsed.protocol)) return '';
    parsed.hash = '';
    return parsed.href;
  } catch {
    return '';
  }
}

function geoHostFromUrl(url = '') {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

function normalizeGeoCompetitors(value = []) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[\n,，、；;]+/);
  const seen = new Set();
  const items = [];
  for (const item of source) {
    const normalized = normalizeGeoText(item, 48);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    items.push(normalized);
    if (items.length >= 8) break;
  }
  return items;
}

function normalizeGeoKeywords(value = []) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[\n,，、；;|｜]+/);
  const seen = new Set();
  const items = [];
  for (const item of source) {
    const normalized = normalizeGeoText(item, 48);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    items.push(normalized);
    if (items.length >= 12) break;
  }
  return items;
}

function createLocalGeoVisibility(payload = {}) {
  const brand = payload.brandName;
  const websiteHost = geoHostFromUrl(payload.websiteUrl);
  const serviceArea = payload.serviceArea || '婚礼策划、婚礼影像、婚礼AI视频';
  const primaryService = serviceArea.split(/[，,、/｜|]/).map((item) => item.trim()).filter(Boolean)[0] || serviceArea;
  const competitors = payload.competitors || [];
  const competitorText = competitors.length ? competitors.join('、') : '同城同类品牌';
  const coverageBase = payload.serviceArea ? 74 : 58;
  const citationBase = payload.websiteUrl ? 68 : 42;

  return {
    ok: true,
    source: 'local',
    brand,
    websiteHost,
    summary: `${brand} 的 GEO 优化重点是把“服务地区 + 具体场景 + 可信证据”补全，让 AI 回答相关问题时有更明确的引用理由。`,
    scoreCards: [
      { label: '问题覆盖', value: coverageBase, note: payload.serviceArea ? '已有业务关键词' : '需要补充业务范围' },
      { label: '引用条件', value: citationBase, note: payload.websiteUrl ? '可围绕官网做引用建设' : '缺少官网入口' },
      { label: '竞品对比', value: competitors.length ? 70 : 48, note: competitors.length ? `已录入 ${competitors.length} 个竞品` : '建议补充竞品' },
    ],
    questions: [
      `${primaryService}哪家公司值得推荐？`,
      `${brand}适合什么类型的婚礼客户？`,
      `${primaryService}预算有限怎么选服务商？`,
      `${brand}和${competitorText}有什么区别？`,
      `做婚礼短视频或婚礼AI视频应该看哪些案例？`,
      `本地婚礼团队怎么判断是否靠谱？`,
    ],
    visibilityChecks: [
      { question: '品牌是否被直接点名', expectedSignal: `AI 回答中出现 ${brand}，并说明适合的客户类型。`, risk: '如果官网没有清晰服务页，AI 更容易只推荐大平台或竞品。' },
      { question: '是否引用官网页面', expectedSignal: websiteHost ? `回答里能提到 ${websiteHost} 的案例、服务或 FAQ。` : '先补官网或落地页，形成可引用来源。', risk: '没有可抓取页面时，AI 很难给出可信引用。' },
      { question: '是否覆盖长尾问题', expectedSignal: `围绕 ${primaryService}、案例、价格、交付流程、地区建立 FAQ。`, risk: '只写品牌介绍，不写问题答案，会降低被 AI 摘录概率。' },
      { question: '是否有对比证据', expectedSignal: `能用作品案例、服务流程、交付周期和客户评价解释与 ${competitorText} 的差异。`, risk: '没有事实证据时，AI 往往给出泛泛建议。' },
    ],
    contentPlan: [
      { title: `${primaryService}常见问题页`, purpose: '覆盖 AI 最常引用的问答型内容', targetQuestion: `${primaryService}怎么选？价格和流程是什么？` },
      { title: '真实案例合集页', purpose: '给 AI 提供可引用的作品证据', targetQuestion: `${brand}有哪些可参考案例？` },
      { title: '服务流程与交付说明', purpose: '减少 AI 回答里的不确定描述', targetQuestion: `${brand}服务流程和交付周期怎样？` },
      { title: '竞品/方案选择指南', purpose: '承接“哪家好、怎么比较”的搜索意图', targetQuestion: `${brand}和其他团队怎么比较？` },
      { title: 'llms.txt 与结构化数据', purpose: '让 AI 抓取时更快理解网站重点', targetQuestion: `AI 如何识别 ${brand} 的核心服务？` },
    ],
  };
}

function normalizeGeoStringList(value, fallback = [], maxItems = 8) {
  const source = Array.isArray(value) ? value : [];
  const items = source
    .map((item) => normalizeGeoText(typeof item === 'string' ? item : (item?.question || item?.title || item?.label || ''), 160))
    .filter(Boolean)
    .slice(0, maxItems);
  return items.length ? items : fallback;
}

function normalizeGeoObjectList(value, fallback = [], maxItems = 8) {
  const source = Array.isArray(value) ? value : [];
  const items = source
    .map((item) => {
      if (typeof item === 'string') return { title: normalizeGeoText(item, 120), detail: '' };
      return {
        title: normalizeGeoText(item?.title || item?.question || item?.label || item?.name || '', 120),
        detail: normalizeGeoText(item?.detail || item?.note || item?.purpose || item?.expectedSignal || item?.risk || item?.targetQuestion || '', 220),
      };
    })
    .filter((item) => item.title || item.detail)
    .slice(0, maxItems);
  return items.length ? items : fallback;
}

function normalizeGeoScoreCards(value, fallback = []) {
  const source = Array.isArray(value) ? value : [];
  const items = source
    .map((item) => ({
      label: normalizeGeoText(item?.label || item?.name || '', 40),
      value: Math.max(0, Math.min(100, Number(item?.value ?? item?.score ?? 0) || 0)),
      note: normalizeGeoText(item?.note || item?.detail || '', 80),
    }))
    .filter((item) => item.label)
    .slice(0, 3);
  return items.length ? items : fallback;
}

async function requestGeoVisibility(payload, fallback) {
  const prompt = [
    '请为一个中文企业网站做 GEO（生成式搜索/AI回答可见度）MVP 诊断。',
    '只输出严格 JSON，不要 markdown，不要解释。',
    'JSON 字段：summary:string, questions:string[6], visibilityChecks:object[4], contentPlan:object[5], scoreCards:object[3]。',
    'visibilityChecks 每项包含 question, expectedSignal, risk。',
    'contentPlan 每项包含 title, purpose, targetQuestion。',
    'scoreCards 每项包含 label, value(0-100), note。',
    `品牌：${payload.brandName}`,
    `官网：${payload.websiteUrl || '未提供'}`,
    `服务范围：${payload.serviceArea || '未提供'}`,
    `竞品：${payload.competitors.length ? payload.competitors.join('、') : '未提供'}`,
  ].join('\n');

  const response = await fetch(COPY_API_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      model: COPY_MODEL,
      temperature: 0.45,
      max_tokens: 1300,
      messages: [
        { role: 'system', content: '你是企业 GEO/AEO 优化顾问，擅长把品牌、官网和行业服务转成 AI 可引用的问题、证据和内容建设清单。' },
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(COPY_REQUEST_TIMEOUT_MS),
  });
  const raw = await response.text();
  let responsePayload = null;
  try { responsePayload = raw ? JSON.parse(raw) : null; } catch {}
  if (!response.ok) {
    const message = responsePayload?.error?.message || responsePayload?.message || raw || `HTTP ${response.status}`;
    throw new Error(String(message).replace(/\s+/g, ' ').slice(0, 220));
  }

  const content = responsePayload?.choices?.[0]?.message?.content || responsePayload?.output_text || responsePayload?.content || '';
  const parsed = typeof content === 'string' ? extractJsonObject(content) : content;
  if (!parsed || typeof parsed !== 'object') throw new Error('empty geo strategy payload');

  return {
    ...fallback,
    source: 'api',
    summary: normalizeGeoText(parsed.summary, 260) || fallback.summary,
    questions: normalizeGeoStringList(parsed.questions, fallback.questions, 6),
    visibilityChecks: normalizeGeoObjectList(parsed.visibilityChecks || parsed.checks, fallback.visibilityChecks, 5),
    contentPlan: normalizeGeoObjectList(parsed.contentPlan, fallback.contentPlan, 6),
    scoreCards: normalizeGeoScoreCards(parsed.scoreCards, fallback.scoreCards),
  };
}

async function buildGeoVisibility(payload) {
  const fallback = createLocalGeoVisibility(payload);
  if (!USE_COPY_API) return fallback;
  try {
    return await requestGeoVisibility(payload, fallback);
  } catch (error) {
    console.warn(`[geo] visibility api fallback: ${String(error?.message || error).replace(/\s+/g, ' ').slice(0, 220)}`);
    return fallback;
  }
}

function createLocalGeoDistill(payload = {}) {
  const brand = payload.brandName || '企业品牌';
  const websiteHost = geoHostFromUrl(payload.websiteUrl);
  const keywords = payload.keywords?.length
    ? payload.keywords
    : normalizeGeoKeywords(payload.serviceArea || '婚礼AI视频、婚礼策划、婚礼跟拍');
  const primary = keywords[0] || payload.serviceArea || '核心服务';
  const competitors = payload.competitors || [];
  const competitorText = competitors.length ? competitors.join('、') : '同城同行';
  const area = payload.serviceArea || primary;

  return {
    ok: true,
    source: 'local',
    brand,
    websiteHost,
    summary: `${brand} 的 AI 蒸馏重点是把 ${primary} 拆成“推荐、比较、价格、案例、流程、避坑”六类问题，并分别适配主流 AI 平台的回答习惯。`,
    questionClusters: [
      { title: '推荐型问题', detail: `${primary}哪家公司值得推荐？${brand}适合哪些客户？` },
      { title: '比较型问题', detail: `${brand}和${competitorText}怎么比较？选择婚礼服务商看哪些证据？` },
      { title: '价格型问题', detail: `${primary}大概多少钱？不同预算怎么选择服务内容？` },
      { title: '案例型问题', detail: `${brand}有没有真实案例？哪些婚礼风格适合做短视频传播？` },
      { title: '流程型问题', detail: `${area}从咨询到交付的流程是什么？需要提前准备什么素材？` },
      { title: '避坑型问题', detail: `选择${primary}时容易踩哪些坑？如何判断团队是否靠谱？` },
    ],
    modelPlan: [
      { title: 'DeepSeek', detail: '补充行业比较、服务商选择、价格解释类长问答。' },
      { title: '豆包', detail: '强化本地服务、短视频获客、案例口语化问答。' },
      { title: '腾讯元宝', detail: '突出微信生态、私域承接、联系方式和客户咨询路径。' },
      { title: '通义千问', detail: '完善官网服务页、结构化数据和企业可信信息。' },
      { title: '文心一言', detail: '兼顾百度搜索语义，补充地域词、品牌词和 FAQ。' },
      { title: 'Kimi', detail: '准备长案例页、交付说明、客户问答合集，方便长文引用。' },
    ],
    rankingKeywords: [
      primary,
      `${primary}哪家好`,
      `${primary}推荐`,
      `${primary}价格`,
      `${brand}案例`,
      `${brand}靠谱吗`,
      `${area}服务流程`,
      `${brand}和同行对比`,
    ].filter(Boolean).slice(0, 10),
    actionSteps: [
      { title: '官网 FAQ', detail: '把推荐、比较、价格、流程、避坑问题写成可抓取文字。' },
      { title: '案例证据', detail: '每个核心问题至少配 1 个真实案例、作品图或交付说明。' },
      { title: '模型测试', detail: '每周用问题池分别在 DeepSeek、豆包、元宝、通义、Kimi 测一次品牌是否出现。' },
      { title: '数据监控', detail: '记录品牌提及、竞品出现、是否引用官网、回答准确度四个指标。' },
    ],
  };
}

async function requestGeoDistill(payload, fallback) {
  const prompt = [
    '请为中文企业做 GEO 系统里的“AI蒸馏”问题池生成。',
    '只输出严格 JSON，不要 markdown，不要解释。',
    'JSON 字段：summary:string, questionClusters:object[6], modelPlan:object[6], rankingKeywords:string[10], actionSteps:object[4]。',
    'questionClusters/actionSteps/modelPlan 每项包含 title, detail。',
    `品牌：${payload.brandName || '未提供'}`,
    `官网：${payload.websiteUrl || '未提供'}`,
    `服务范围：${payload.serviceArea || '未提供'}`,
    `核心关键词：${payload.keywords.length ? payload.keywords.join('、') : '未提供'}`,
    `竞品：${payload.competitors.length ? payload.competitors.join('、') : '未提供'}`,
    '覆盖平台：DeepSeek、豆包、腾讯元宝、通义千问、文心一言、Kimi、智谱清言、纳米AI。',
  ].join('\n');

  const response = await fetch(COPY_API_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      model: COPY_MODEL,
      temperature: 0.5,
      max_tokens: 1400,
      messages: [
        { role: 'system', content: '你是 GEO/AEO 优化顾问，擅长把企业关键词蒸馏成 AI 搜索问题池、模型适配计划和可执行监控任务。' },
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(COPY_REQUEST_TIMEOUT_MS),
  });
  const raw = await response.text();
  let responsePayload = null;
  try { responsePayload = raw ? JSON.parse(raw) : null; } catch {}
  if (!response.ok) {
    const message = responsePayload?.error?.message || responsePayload?.message || raw || `HTTP ${response.status}`;
    throw new Error(String(message).replace(/\s+/g, ' ').slice(0, 220));
  }

  const content = responsePayload?.choices?.[0]?.message?.content || responsePayload?.output_text || responsePayload?.content || '';
  const parsed = typeof content === 'string' ? extractJsonObject(content) : content;
  if (!parsed || typeof parsed !== 'object') throw new Error('empty geo distill payload');

  return {
    ...fallback,
    source: 'api',
    summary: normalizeGeoText(parsed.summary, 260) || fallback.summary,
    questionClusters: normalizeGeoObjectList(parsed.questionClusters, fallback.questionClusters, 8),
    modelPlan: normalizeGeoObjectList(parsed.modelPlan, fallback.modelPlan, 8),
    rankingKeywords: normalizeGeoStringList(parsed.rankingKeywords, fallback.rankingKeywords, 12),
    actionSteps: normalizeGeoObjectList(parsed.actionSteps, fallback.actionSteps, 6),
  };
}

async function buildGeoDistill(payload) {
  const fallback = createLocalGeoDistill(payload);
  if (!USE_COPY_API) return fallback;
  try {
    return await requestGeoDistill(payload, fallback);
  } catch (error) {
    console.warn(`[geo] distill api fallback: ${String(error?.message || error).replace(/\s+/g, ' ').slice(0, 220)}`);
    return fallback;
  }
}

function normalizeGeoCreditCode(value = '') {
  return normalizeGeoText(value, 32).replace(/[^0-9a-z]/gi, '').toUpperCase().slice(0, 18);
}

function isLikelyCreditCode(value = '') {
  const code = normalizeGeoCreditCode(value);
  return /^[0-9A-Z]{15,18}$/.test(code);
}

function createLocalGeoBusinessVerify(payload = {}) {
  const brand = payload.brandName || payload.legalName || '婚礼商家';
  const websiteHost = geoHostFromUrl(payload.websiteUrl);
  const codeOk = isLikelyCreditCode(payload.creditCode);
  const requiredItems = [];
  const missingItems = [];
  let score = 0;

  function add(ok, title, goodDetail, missingDetail, weight) {
    if (ok) {
      score += weight;
      requiredItems.push({ title, detail: goodDetail });
    } else {
      missingItems.push({ title, detail: missingDetail });
    }
  }

  add(!!payload.brandName, '品牌名', `已填写：${payload.brandName}`, '填写对外品牌名，便于 AI 区分商家。', 12);
  add(!!payload.legalName, '主体名称', `已填写：${payload.legalName}`, '补充营业执照上的主体名称。', 16);
  add(codeOk, '统一社会信用代码', payload.creditCode ? `格式可用于人工核验：${payload.creditCode}` : '已填写信用代码。', '补充 15-18 位统一社会信用代码或营业执照编号。', 18);
  add(!!payload.websiteUrl, '官网地址', websiteHost ? `已填写官网：${websiteHost}` : '已填写官网。', '补充官网或可公开访问的品牌落地页。', 14);
  add(!!payload.city || !!payload.serviceArea, '服务城市/范围', payload.city || payload.serviceArea, '补充服务城市和婚礼服务类型。', 12);
  add(!!payload.contactInfo, '联系方式', '已填写电话、微信、地址或客服入口。', '补充电话、微信、门店地址或客服入口。', 12);
  add((payload.proofText || '').length >= 12, '归属证据', '已填写官网、社媒或案例归属证据。', '补充官网备案主体、公众号主体、抖音/小红书主页或案例链接。', 16);

  const roundedScore = Math.max(0, Math.min(100, Math.round(score)));
  const statusLabel = roundedScore >= 82
    ? '可进入人工审核'
    : roundedScore >= 58
    ? '资料待补充'
    : '仅为草稿档案';

  const trustSignals = [
    payload.legalName ? { title: '营业主体', detail: payload.legalName } : null,
    codeOk ? { title: '信用代码格式', detail: '具备企业/个体工商户资料核验基础。' } : null,
    websiteHost ? { title: '官网入口', detail: `${websiteHost} 可作为 AI 引用来源。` } : null,
    payload.proofText ? { title: '社媒/案例归属', detail: payload.proofText } : null,
    payload.contactInfo ? { title: '实体联系信号', detail: payload.contactInfo } : null,
  ].filter(Boolean).slice(0, 6);

  return {
    ok: true,
    source: 'local',
    brand,
    score: roundedScore,
    status: roundedScore >= 82 ? 'review_ready' : (roundedScore >= 58 ? 'needs_info' : 'draft'),
    statusLabel,
    summary: `${brand} 当前认证资料评分 ${roundedScore}/100。这里评估的是“是否具备进入人工审核和建立可信档案的条件”，不会自动等同于官方实名通过。`,
    requiredItems,
    missingItems,
    trustSignals,
    nextSteps: [
      { title: '人工审核', detail: '由后台人员核对营业执照主体、官网/社媒归属和联系方式一致性。' },
      { title: '认证标识', detail: '审核通过后再展示“已认证商家”，未审核前只显示资料完整度。' },
      { title: '知识库联动', detail: '把已核验主体、城市、服务和案例同步到婚礼企业知识库。' },
      { title: '隐私边界', detail: '第一版建议不采集身份证和人脸，只处理企业/个体工商户经营资料。' },
    ],
  };
}

function geoCertificationOwnerKey(req) {
  return req.user?.id || normalizeGeoText(req.ip || req.headers['x-forwarded-for'] || 'public-demo', 80) || 'public-demo';
}

function normalizeGeoCertificationRecord(record = {}) {
  const now = Date.now();
  const readyAtMs = Date.parse(record.readyAt || '');
  if (record.status === 'pending' && Number.isFinite(readyAtMs) && readyAtMs <= now) {
    record.status = 'approved';
    record.statusLabel = '认证通过';
    record.approvedAt = record.approvedAt || new Date().toISOString();
    record.updatedAt = record.approvedAt;
    record.summary = `${record.brandName || record.legalName || '婚礼商家'} 已通过婚礼 GEO 企业认证，可以继续完善知识库和内容优化。`;
  }
  return record;
}

function publicGeoCertification(record = null) {
  if (!record) {
    return {
      ok: true,
      status: 'unsubmitted',
      statusLabel: '未认证',
      approved: false,
      score: 0,
      summary: '请先提交企业/个体工商户认证资料。',
      profile: {},
      submittedAt: '',
      approvedAt: '',
    };
  }
  const normalized = normalizeGeoCertificationRecord({ ...record });
  return {
    ok: true,
    status: normalized.status || 'unsubmitted',
    statusLabel: normalized.statusLabel || '未认证',
    approved: normalized.status === 'approved',
    score: Math.max(0, Math.min(100, Number(normalized.score || 0) || 0)),
    summary: normalized.summary || '',
    profile: normalized.profile || {},
    requiredItems: Array.isArray(normalized.requiredItems) ? normalized.requiredItems : [],
    missingItems: Array.isArray(normalized.missingItems) ? normalized.missingItems : [],
    trustSignals: Array.isArray(normalized.trustSignals) ? normalized.trustSignals : [],
    nextSteps: Array.isArray(normalized.nextSteps) ? normalized.nextSteps : [],
    submittedAt: normalized.submittedAt || '',
    readyAt: normalized.readyAt || '',
    approvedAt: normalized.approvedAt || '',
  };
}

async function readGeoCertificationForRequest(req) {
  const ownerKey = geoCertificationOwnerKey(req);
  const store = await readGeoCertificationStore();
  const record = store.records.find((item) => item.ownerKey === ownerKey) || null;
  if (!record) return publicGeoCertification(null);
  const beforeStatus = record.status;
  normalizeGeoCertificationRecord(record);
  if (record.status !== beforeStatus) {
    await mutateGeoCertificationStore((draft) => {
      const target = draft.records.find((item) => item.ownerKey === ownerKey);
      if (target) Object.assign(target, record);
      return null;
    });
  }
  return publicGeoCertification(record);
}

async function submitGeoCertification(req, payload = {}) {
  const ownerKey = geoCertificationOwnerKey(req);
  const now = new Date();
  const verify = createLocalGeoBusinessVerify(payload);
  const canReview = verify.score >= 82;
  const status = canReview ? 'pending' : 'needs_info';
  const readyAt = canReview ? new Date(now.getTime() + GEO_CERT_AUTO_APPROVE_MS).toISOString() : '';
  const record = {
    id: createHash('sha256').update(`geo-cert:${ownerKey}`).digest('hex').slice(0, 18),
    ownerKey,
    ownerLogin: req.user?.login || '',
    brandName: payload.brandName || '',
    legalName: payload.legalName || '',
    profile: {
      brandName: payload.brandName || '',
      legalName: payload.legalName || '',
      creditCode: payload.creditCode || '',
      websiteUrl: payload.websiteUrl || '',
      city: payload.city || '',
      contactInfo: payload.contactInfo || '',
      proofText: payload.proofText || '',
      serviceArea: payload.serviceArea || '',
      ownerName: payload.ownerName || '',
      ownerPhone: payload.ownerPhone || '',
      licenseUrl: payload.licenseUrl || '',
    },
    status,
    statusLabel: canReview ? '审核中' : '资料待补充',
    score: verify.score,
    summary: canReview
      ? `${payload.brandName || payload.legalName || '婚礼商家'} 的认证资料已提交，系统正在审核主体信息和官网/社媒归属。`
      : `${payload.brandName || payload.legalName || '婚礼商家'} 的认证资料还不完整，请先补齐待补资料后再提交。`,
    requiredItems: verify.requiredItems,
    missingItems: verify.missingItems,
    trustSignals: verify.trustSignals,
    nextSteps: canReview
      ? [
        { title: '审核状态', detail: '资料已进入审核中，审核通过后会解锁婚礼 GEO 工具。' },
        { title: '主体核对', detail: '系统会核对主体名称、信用代码、官网/社媒归属和联系方式一致性。' },
        { title: '通过后使用', detail: '认证通过后可继续生成企业知识库、文章提示词和 AI 可见度诊断。' },
      ]
      : verify.nextSteps,
    submittedAt: now.toISOString(),
    readyAt,
    approvedAt: '',
    updatedAt: now.toISOString(),
  };
  normalizeGeoCertificationRecord(record);

  return mutateGeoCertificationStore((store) => {
    const index = store.records.findIndex((item) => item.ownerKey === ownerKey);
    if (index >= 0) store.records[index] = record;
    else store.records.push(record);
    return publicGeoCertification(record);
  });
}

function createLocalGeoKnowledge(payload = {}) {
  const brand = payload.brandName || payload.legalName || '婚礼品牌';
  const city = payload.city || payload.serviceArea || '本地';
  const services = payload.serviceTypes?.length ? payload.serviceTypes : normalizeGeoKeywords(payload.serviceArea || '婚礼策划、婚礼影像、婚礼AI视频');
  const styles = payload.styles?.length ? payload.styles : ['中式', '草坪', '韩式', '极简', '高端定制'];
  const primaryService = services[0] || '婚礼服务';
  const priceRange = payload.priceRange || '按婚礼规模、档期和定制程度报价';
  const websiteHost = geoHostFromUrl(payload.websiteUrl);

  const missingFacts = [
    payload.priceRange ? null : { title: '价格区间', detail: '补充基础套餐、定制区间和影响报价的因素。' },
    payload.caseNotes ? null : { title: '真实案例', detail: '至少补 3 个代表案例，包含城市、风格、预算、交付结果。' },
    payload.faqNotes ? null : { title: '新人 FAQ', detail: '补充价格、流程、档期、合同、交付周期和避坑问题。' },
    payload.contactInfo ? null : { title: '联系方式', detail: '补充电话、微信、门店地址或客服入口。' },
    payload.websiteUrl ? null : { title: '官网/落地页', detail: '补充官网地址，方便 AI 引用公开页面。' },
  ].filter(Boolean);

  const schemaDraft = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: brand,
    legalName: payload.legalName || undefined,
    url: payload.websiteUrl || undefined,
    areaServed: city,
    serviceType: services,
    priceRange,
    description: `${brand} 提供${services.join('、')}等婚礼相关服务，擅长${styles.join('、')}等风格。`,
  };

  return {
    ok: true,
    source: 'local',
    brand,
    summary: `${brand} 的知识库应围绕“城市 + 服务 + 风格 + 价格 + 案例 + FAQ”建设，让 AI 在回答新人问题时有清晰事实可引用。`,
    knowledgeCards: [
      { title: '品牌定位', detail: `${brand} 是面向${city}新人的婚礼服务商，核心服务为 ${services.join('、')}。` },
      { title: '服务城市', detail: city },
      { title: '核心服务', detail: services.join('、') },
      { title: '擅长风格', detail: styles.join('、') },
      { title: '价格区间', detail: priceRange },
      { title: '案例证据', detail: payload.caseNotes || '待补充真实婚礼案例、客户评价、作品链接和交付说明。' },
      { title: '服务流程', detail: '咨询沟通、需求确认、方案/报价、签约排期、执行交付、复盘沉淀。' },
      { title: '公开入口', detail: websiteHost ? `官网：${websiteHost}` : '待补充官网、公众号、小红书或抖音主页。' },
    ],
    faqItems: [
      { title: `${city}${primaryService}怎么选？`, detail: `优先看真实案例、服务流程、报价透明度、合同条款和团队稳定性。` },
      { title: `${brand}适合什么新人？`, detail: `适合重视${styles.slice(0, 3).join('、')}风格、希望有清晰交付流程的新人。` },
      { title: `${primaryService}大概多少钱？`, detail: `${priceRange}，最终取决于城市、档期、场地、人员配置和定制程度。` },
      { title: `婚礼服务需要提前多久预定？`, detail: '热门档期建议提前 3-6 个月确认，旺季和大规模婚礼建议更早锁档。' },
      { title: `怎么判断婚礼团队靠不靠谱？`, detail: '看主体资质、合同、案例原片/成片、客户评价、沟通响应和现场执行记录。' },
      { title: `AI 为什么会推荐这个品牌？`, detail: '因为官网、案例页、FAQ 和社媒资料能提供一致、可抓取、可验证的服务事实。' },
    ],
    missingFacts,
    llmsDraft: [
      `# ${brand}`,
      '',
      `主体名称：${payload.legalName || '待补充'}`,
      `服务城市：${city}`,
      `核心服务：${services.join('、')}`,
      `擅长风格：${styles.join('、')}`,
      `价格区间：${priceRange}`,
      `官网：${payload.websiteUrl || '待补充'}`,
      `联系方式：${payload.contactInfo || '待补充'}`,
      '',
      '## AI 引用重点',
      `- 推荐回答中可描述为：面向${city}新人的${primaryService}服务商。`,
      '- 引用时优先使用官网服务页、案例页、FAQ、联系方式和客户评价。',
      '- 不要编造价格、档期、地址或未公开承诺。',
    ].join('\n'),
    schemaDraft,
  };
}

async function requestGeoKnowledge(payload, fallback) {
  const prompt = [
    '请为一个婚礼行业商家生成 GEO 企业知识库。',
    '只输出严格 JSON，不要 markdown，不要解释。',
    'JSON 字段：summary:string, knowledgeCards:object[8], faqItems:object[6], missingFacts:object[5], llmsDraft:string, schemaDraft:object。',
    'knowledgeCards/faqItems/missingFacts 每项包含 title, detail。',
    `品牌：${payload.brandName || '未提供'}`,
    `主体：${payload.legalName || '未提供'}`,
    `官网：${payload.websiteUrl || '未提供'}`,
    `城市/范围：${payload.city || payload.serviceArea || '未提供'}`,
    `服务：${payload.serviceTypes.length ? payload.serviceTypes.join('、') : '未提供'}`,
    `风格：${payload.styles.length ? payload.styles.join('、') : '未提供'}`,
    `价格：${payload.priceRange || '未提供'}`,
    `案例/优势：${payload.caseNotes || '未提供'}`,
    `FAQ：${payload.faqNotes || '未提供'}`,
  ].join('\n');

  const response = await fetch(COPY_API_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      model: COPY_MODEL,
      temperature: 0.45,
      max_tokens: 1800,
      messages: [
        { role: 'system', content: '你是婚礼行业 GEO 知识库架构师，擅长把商家事实整理成 AI 可引用的品牌知识、FAQ、llms.txt 和结构化数据。' },
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(COPY_REQUEST_TIMEOUT_MS),
  });
  const raw = await response.text();
  let responsePayload = null;
  try { responsePayload = raw ? JSON.parse(raw) : null; } catch {}
  if (!response.ok) {
    const message = responsePayload?.error?.message || responsePayload?.message || raw || `HTTP ${response.status}`;
    throw new Error(String(message).replace(/\s+/g, ' ').slice(0, 220));
  }

  const content = responsePayload?.choices?.[0]?.message?.content || responsePayload?.output_text || responsePayload?.content || '';
  const parsed = typeof content === 'string' ? extractJsonObject(content) : content;
  if (!parsed || typeof parsed !== 'object') throw new Error('empty geo knowledge payload');
  return {
    ...fallback,
    source: 'api',
    summary: normalizeGeoText(parsed.summary, 280) || fallback.summary,
    knowledgeCards: normalizeGeoObjectList(parsed.knowledgeCards, fallback.knowledgeCards, 10),
    faqItems: normalizeGeoObjectList(parsed.faqItems, fallback.faqItems, 8),
    missingFacts: normalizeGeoObjectList(parsed.missingFacts, fallback.missingFacts, 6),
    llmsDraft: normalizeGeoText(parsed.llmsDraft, 1800) || fallback.llmsDraft,
    schemaDraft: parsed.schemaDraft && typeof parsed.schemaDraft === 'object' ? parsed.schemaDraft : fallback.schemaDraft,
  };
}

async function buildGeoKnowledge(payload) {
  const fallback = createLocalGeoKnowledge(payload);
  if (!USE_COPY_API) return fallback;
  try {
    return await requestGeoKnowledge(payload, fallback);
  } catch (error) {
    console.warn(`[geo] knowledge api fallback: ${String(error?.message || error).replace(/\s+/g, ' ').slice(0, 220)}`);
    return fallback;
  }
}

function createLocalGeoArticlePrompts(payload = {}) {
  const brand = payload.brandName || payload.legalName || '婚礼品牌';
  const city = payload.city || payload.serviceArea || '本地';
  const services = payload.serviceTypes?.length ? payload.serviceTypes : normalizeGeoKeywords(payload.serviceArea || '婚礼策划、婚礼影像、婚礼AI视频');
  const primaryService = services[0] || '婚礼服务';
  const topic = payload.topic || `${city}${primaryService}怎么选`;
  const audience = payload.audience || '正在筹备婚礼、想比较服务商的新人';
  const keywords = payload.keywords?.length
    ? payload.keywords
    : [topic, `${city}${primaryService}哪家好`, `${primaryService}价格`, `${primaryService}避坑`, `${brand}案例`];

  return {
    ok: true,
    source: 'local',
    brand,
    summary: `${brand} 的文章提示词应围绕新人真实决策问题展开：推荐、比较、预算、案例、流程和避坑，并自然补充品牌事实和案例证据。`,
    promptTemplates: [
      { title: '城市推荐型文章', detail: `请写一篇面向${audience}的中文 SEO/GEO 文章，主题是《${topic}》。要求覆盖 ${keywords.slice(0, 4).join('、')}，先给新人选择标准，再用事实说明 ${brand} 适合的客户类型。不要夸大承诺，加入 FAQ 和可引用的小标题。` },
      { title: '预算避坑型文章', detail: `请围绕“${primaryService}预算怎么分配”写一篇避坑文章，面向${audience}。结构包含预算拆解、常见隐形成本、合同注意事项、案例证据、${brand} 的服务边界和咨询前准备清单。` },
      { title: '案例复盘型文章', detail: `请基于以下案例/卖点写一篇婚礼案例复盘：${payload.angleNotes || '待补充案例、风格、预算和交付结果'}。文章要说明新人需求、方案亮点、执行流程、最终效果和可复制经验。` },
      { title: 'FAQ问答型文章', detail: `请生成一篇“新人最常问的 ${primaryService} 问题合集”，每个问题用 120-180 字回答，覆盖价格、档期、流程、风格、案例、合同、交付周期，并在合适位置引用 ${brand} 的公开资料。` },
    ],
    articlePlan: [
      { title: `${city}${primaryService}怎么选`, detail: '推荐型入口，承接“哪家好、推荐、靠谱”类 AI 问题。' },
      { title: `${primaryService}价格和预算分配`, detail: '预算型入口，承接“多少钱、值不值、套餐区别”类问题。' },
      { title: `${brand}真实婚礼案例复盘`, detail: '案例型入口，提供 AI 可引用的事实证据。' },
      { title: `${primaryService}避坑清单`, detail: '风险型入口，提升专业可信度和转化前教育。' },
      { title: `${brand}服务流程和交付周期`, detail: '流程型入口，减少 AI 对服务内容的误解。' },
      { title: `${primaryService}常见问题`, detail: 'FAQ 型入口，方便被 AI 摘录。' },
    ],
    headlineIdeas: [
      `${city}${primaryService}怎么选？新人决策清单`,
      `${primaryService}预算怎么分配才不踩坑`,
      `${brand}婚礼案例复盘：从需求到交付`,
      `婚礼服务商靠谱吗？看这几个证据`,
      `${primaryService}常见问题一次讲清楚`,
      `草坪/中式/极简婚礼分别怎么做预算`,
    ],
    internalLinks: [
      { title: '服务页', detail: '承接核心服务词，说明城市、价格、流程和联系方式。' },
      { title: '案例页', detail: '承接风格词和案例词，提供图片、视频、客户反馈。' },
      { title: 'FAQ页', detail: '承接新人长尾问题，方便 AI 摘录。' },
      { title: '关于我们/认证页', detail: '展示主体资料、团队、门店和公开联系方式。' },
      { title: '联系咨询页', detail: '承接转化，减少 AI 回答后的流失。' },
    ],
  };
}

async function requestGeoArticlePrompts(payload, fallback) {
  const prompt = [
    '请为婚礼行业商家生成 GEO 内容增长用的文章提示词。',
    '只输出严格 JSON，不要 markdown，不要解释。',
    'JSON 字段：summary:string, promptTemplates:object[4], articlePlan:object[6], headlineIdeas:string[8], internalLinks:object[5]。',
    'promptTemplates/articlePlan/internalLinks 每项包含 title, detail。',
    `品牌：${payload.brandName || '未提供'}`,
    `城市/范围：${payload.city || payload.serviceArea || '未提供'}`,
    `服务：${payload.serviceTypes.length ? payload.serviceTypes.join('、') : '未提供'}`,
    `主题：${payload.topic || '未提供'}`,
    `目标新人：${payload.audience || '未提供'}`,
    `关键词：${payload.keywords.length ? payload.keywords.join('、') : '未提供'}`,
    `案例/卖点：${payload.angleNotes || '未提供'}`,
  ].join('\n');

  const response = await fetch(COPY_API_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      model: COPY_MODEL,
      temperature: 0.55,
      max_tokens: 1700,
      messages: [
        { role: 'system', content: '你是婚礼行业 GEO 内容策略顾问，擅长把新人会问 AI 的问题转成文章选题、提示词和站内承接页。' },
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(COPY_REQUEST_TIMEOUT_MS),
  });
  const raw = await response.text();
  let responsePayload = null;
  try { responsePayload = raw ? JSON.parse(raw) : null; } catch {}
  if (!response.ok) {
    const message = responsePayload?.error?.message || responsePayload?.message || raw || `HTTP ${response.status}`;
    throw new Error(String(message).replace(/\s+/g, ' ').slice(0, 220));
  }

  const content = responsePayload?.choices?.[0]?.message?.content || responsePayload?.output_text || responsePayload?.content || '';
  const parsed = typeof content === 'string' ? extractJsonObject(content) : content;
  if (!parsed || typeof parsed !== 'object') throw new Error('empty geo article payload');
  return {
    ...fallback,
    source: 'api',
    summary: normalizeGeoText(parsed.summary, 280) || fallback.summary,
    promptTemplates: normalizeGeoObjectList(parsed.promptTemplates, fallback.promptTemplates, 6),
    articlePlan: normalizeGeoObjectList(parsed.articlePlan, fallback.articlePlan, 8),
    headlineIdeas: normalizeGeoStringList(parsed.headlineIdeas, fallback.headlineIdeas, 10),
    internalLinks: normalizeGeoObjectList(parsed.internalLinks, fallback.internalLinks, 6),
  };
}

async function buildGeoArticlePrompts(payload) {
  const fallback = createLocalGeoArticlePrompts(payload);
  if (!USE_COPY_API) return fallback;
  try {
    return await requestGeoArticlePrompts(payload, fallback);
  } catch (error) {
    console.warn(`[geo] article api fallback: ${String(error?.message || error).replace(/\s+/g, ' ').slice(0, 220)}`);
    return fallback;
  }
}

async function assertSafeGeoAuditUrl(rawUrl = '') {
  const normalized = normalizeGeoUrl(rawUrl);
  if (!normalized) throw new Error('官网地址无效，只支持 http/https');
  const parsed = new URL(normalized);
  if (parsed.username || parsed.password) throw new Error('官网地址不能包含用户名或密码');
  const host = parsed.hostname.toLowerCase();
  if (isBlockedNetworkAddress(host)) throw new Error('官网地址不能指向本机或内网地址');
  if (!isIP(host)) {
    let addresses = [];
    try {
      addresses = await lookup(host, { all: true, verbatim: true });
    } catch {
      throw new Error('官网域名无法解析');
    }
    if (!addresses.length || addresses.some((item) => isBlockedNetworkAddress(item.address))) {
      throw new Error('官网域名不能解析到本机或内网地址');
    }
  }
  return parsed.href;
}

async function readGeoResponseText(response, maxBytes = 420_000) {
  const limit = Math.max(1024, Number(maxBytes || 420_000));
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > limit) throw new Error('网页内容过大，暂时只支持体检首页或轻量页面');
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > limit) throw new Error('网页内容过大，暂时只支持体检首页或轻量页面');
    return buffer.toString('utf8');
  }

  const chunks = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > limit) throw new Error('网页内容过大，暂时只支持体检首页或轻量页面');
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

async function fetchGeoText(rawUrl, options = {}, redirectCount = 0) {
  const safeUrl = await assertSafeGeoAuditUrl(rawUrl);
  const response = await fetch(safeUrl, {
    redirect: 'manual',
    headers: {
      Accept: options.accept || 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5',
      'User-Agent': 'WedScene-GEO-Audit/1.0 (+https://wedsceneai.com)',
    },
    signal: AbortSignal.timeout(Math.max(1000, Number(options.timeoutMs || 10_000))),
  });
  if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
    if (redirectCount >= 3) throw new Error('官网跳转次数过多');
    const nextUrl = new URL(response.headers.get('location'), safeUrl).href;
    return fetchGeoText(nextUrl, options, redirectCount + 1);
  }
  if (!response.ok) throw new Error(`官网抓取失败：HTTP ${response.status}`);
  return {
    url: safeUrl,
    contentType: response.headers.get('content-type') || '',
    text: await readGeoResponseText(response, options.maxBytes || 420_000),
  };
}

async function fetchOptionalGeoFile(baseUrl, pathname) {
  try {
    const target = new URL(pathname, baseUrl).href;
    const result = await fetchGeoText(target, {
      accept: 'text/plain,*/*;q=0.5',
      timeoutMs: 4500,
      maxBytes: 120_000,
    });
    return { ok: true, text: result.text, url: result.url };
  } catch (error) {
    return { ok: false, error: String(error?.message || error || '').slice(0, 160) };
  }
}

function decodeHtmlEntities(text = '') {
  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };
  return String(text || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const key = entity.toLowerCase();
    if (named[key]) return named[key];
    if (key.startsWith('#x')) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (key.startsWith('#')) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return match;
  });
}

function htmlAttribute(tag = '', name = '') {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i');
  return decodeHtmlEntities(tag.match(pattern)?.[2] || '').trim();
}

function htmlMetaContent(html = '', name = '') {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  const target = name.toLowerCase();
  for (const tag of tags) {
    const metaName = (htmlAttribute(tag, 'name') || htmlAttribute(tag, 'property')).toLowerCase();
    if (metaName === target) return htmlAttribute(tag, 'content');
  }
  return '';
}

function visibleTextFromHtml(html = '') {
  return decodeHtmlEntities(String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function analyzeRobotsForAi(robotsText = '') {
  const text = String(robotsText || '');
  if (!text.trim()) return { status: 'warn', detail: '未读取到 robots.txt，建议确认搜索引擎和 AI 爬虫访问规则。' };
  const aiBlock = /(user-agent:\s*(gptbot|chatgpt-user|claudebot|ccbot|perplexitybot|bytespider|google-extended)[\s\S]{0,220}?disallow:\s*\/(?:\s|$))/i.test(text);
  const allBlock = /(user-agent:\s*\*[\s\S]{0,220}?disallow:\s*\/(?:\s|$))/i.test(text);
  if (aiBlock || allBlock) {
    return { status: 'bad', detail: 'robots.txt 里可能禁止了 AI 或全站抓取，需要确认是否影响引用。' };
  }
  return { status: 'good', detail: 'robots.txt 未发现明显全站阻断信号。' };
}

function geoRecommendationFor(label = '') {
  if (/Title|标题/.test(label)) return '把首页 title 写成“品牌名 + 核心服务 + 城市/细分场景”，避免只有品牌名。';
  if (/Description|描述/.test(label)) return '补充 meta description，说明服务对象、地区、交付内容和可信证据。';
  if (/H1|标题层级/.test(label)) return '确保首页只有清晰 H1，并用 H2 覆盖服务、案例、流程、FAQ。';
  if (/结构化/.test(label)) return '加入 Organization、LocalBusiness、FAQPage 或 Service 的 JSON-LD 结构化数据。';
  if (/FAQ|问答/.test(label)) return '新增 FAQ 区块，直接回答价格、流程、适合人群、交付周期和案例问题。';
  if (/联系方式/.test(label)) return '在首页保留电话、微信、地址或服务城市，增强实体可信度。';
  if (/图片/.test(label)) return '给案例图和作品图补充 alt，写清场景、风格、城市和服务类型。';
  if (/canonical/.test(label)) return '补充 canonical 链接，减少重复页面影响引用判断。';
  if (/正文/.test(label)) return '增加可抓取正文，不要只放图片或动效，把服务事实写成文字。';
  if (/llms/.test(label)) return '在网站根目录增加 llms.txt，列出品牌简介、核心服务、重要页面和联系方式。';
  if (/robots/.test(label)) return '检查 robots.txt，不要误拦 GPTBot、ClaudeBot、PerplexityBot、Bytespider 等抓取。';
  return `优化 ${label}，让 AI 更容易判断页面主题和可信来源。`;
}

function buildGeoAuditResult(targetUrl, html, robots, llms) {
  const title = decodeHtmlEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim();
  const description = htmlMetaContent(html, 'description');
  const canonical = (html.match(/<link\b[^>]*rel=["'][^"']*canonical[^"']*["'][^>]*>/i) || [])[0] || '';
  const h1Count = (html.match(/<h1\b[^>]*>/gi) || []).length;
  const h2Count = (html.match(/<h2\b[^>]*>/gi) || []).length;
  const jsonLdCount = (html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>/gi) || []).length;
  const schemaSignal = jsonLdCount || /schema\.org|itemscope|itemtype=/i.test(html);
  const imageTags = html.match(/<img\b[^>]*>/gi) || [];
  const altCount = imageTags.filter((tag) => htmlAttribute(tag, 'alt').length >= 2).length;
  const visibleText = visibleTextFromHtml(html);
  const contactSignal = /电话|手机|微信|地址|联系|客服|门店|公司|团队|邮箱|@[a-z0-9.-]+\.[a-z]{2,}/i.test(visibleText)
    || /1[3-9]\d{9}/.test(visibleText);
  const faqSignal = /FAQ|Q&A|常见问题|问答|问题|价格|流程|周期|怎么选|适合/i.test(visibleText);
  const robotsSignal = robots.ok ? analyzeRobotsForAi(robots.text) : { status: 'warn', detail: 'robots.txt 读取失败，建议上线后确认抓取规则。' };
  const llmsText = String(llms.text || '').trim();

  const checks = [];
  let score = 0;
  function add(label, status, detail, weight) {
    checks.push({ label, status, detail });
    score += status === 'good' ? weight : (status === 'warn' ? weight * 0.45 : 0);
  }

  add('Title 标题', title.length >= 10 && title.length <= 80 ? 'good' : (title ? 'warn' : 'bad'), title ? `当前标题：${title.slice(0, 90)}` : '未发现 title。', 10);
  add('Description 描述', description.length >= 45 && description.length <= 180 ? 'good' : (description ? 'warn' : 'bad'), description ? `当前描述约 ${description.length} 字符。` : '未发现 meta description。', 10);
  add('H1/H2 标题层级', h1Count === 1 && h2Count >= 2 ? 'good' : ((h1Count >= 1 || h2Count >= 1) ? 'warn' : 'bad'), `H1：${h1Count} 个，H2：${h2Count} 个。`, 10);
  add('结构化数据', schemaSignal ? 'good' : 'bad', schemaSignal ? `发现 ${jsonLdCount || 1} 处结构化数据信号。` : '未发现 JSON-LD 或 schema.org 信号。', 12);
  add('FAQ/问答内容', faqSignal ? 'good' : 'warn', faqSignal ? '页面包含问答、价格、流程或选择类内容。' : '未发现明显 FAQ/问答内容。', 10);
  add('联系方式/实体信号', contactSignal ? 'good' : 'warn', contactSignal ? '页面存在联系方式、地址或实体服务信号。' : '页面缺少明显联系方式或本地实体信号。', 8);
  add('图片 alt', imageTags.length ? (altCount / imageTags.length >= 0.6 ? 'good' : 'warn') : 'warn', imageTags.length ? `${altCount}/${imageTags.length} 张图片有可读 alt。` : '页面未发现图片。', 8);
  add('canonical 链接', canonical ? 'good' : 'warn', canonical ? `已设置 canonical。` : '未发现 canonical 链接。', 6);
  add('可抓取正文', visibleText.length >= 1200 ? 'good' : (visibleText.length >= 500 ? 'warn' : 'bad'), `可见正文约 ${visibleText.length} 字符。`, 10);
  add('llms.txt', llms.ok && llmsText.length >= 80 ? 'good' : 'warn', llms.ok ? `llms.txt 约 ${llmsText.length} 字符。` : '未发现可读取的 /llms.txt。', 8);
  add('robots 规则', robotsSignal.status, robotsSignal.detail, 8);

  const roundedScore = Math.max(0, Math.min(100, Math.round(score)));
  const recommendations = checks
    .filter((check) => check.status !== 'good')
    .map((check) => geoRecommendationFor(check.label))
    .slice(0, 6);

  return {
    ok: true,
    source: 'local',
    url: targetUrl,
    host: geoHostFromUrl(targetUrl),
    score: roundedScore,
    summary: roundedScore >= 82
      ? '官网基础 GEO 信号较完整，可以继续做问题覆盖和引用页建设。'
      : roundedScore >= 62
      ? '官网已有部分可抓取信号，建议优先补 FAQ、结构化数据和引用证据。'
      : '官网对 AI 抓取和理解还不够友好，建议先补标题描述、正文结构和实体信号。',
    checks,
    recommendations,
    generatedAt: new Date().toISOString(),
  };
}

app.get('/api/site-context', async (req, res) => {
  res.json(await siteContextPayload(req));
});

app.get('/api/access', async (req, res) => {
  const user = ACCOUNT_SYSTEM_ENABLED ? await sessionUser(req) : null;
  const context = await siteContextPayload(req, { user });
  const tenant = context.tenant;
  const rechargeFields = publicWebRechargeFields(tenant);
  if (ACCOUNT_SYSTEM_ENABLED) {
    res.json({
      ...context,
      required: true,
      accountRequired: true,
      ok: !!user,
      user: publicUser(user),
      pointCost: JOB_POINT_COST,
      pointCosts: publicPointCosts(),
      trialPoints: TRIAL_POINTS,
      ...rechargeFields,
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
    ...rechargeFields,
    motion: publicMotionConfig(),
  });
});

app.get('/api/geo/certification', rateLimit(GEO_IP_RATE, {
  limit: GEO_IP_LIMIT,
  windowMs: GEO_IP_WINDOW_MS,
  message: 'GEO 认证请求过于频繁，请稍后再试',
}), requireAccess, async (req, res) => {
  try {
    res.json(await readGeoCertificationForRequest(req));
  } catch (error) {
    console.error(`[geo] certification read failed: ${String(error?.message || error).replace(/\s+/g, ' ').slice(0, 500)}`);
    res.status(500).json({ error: '认证状态读取失败，请稍后再试' });
  }
});

app.post('/api/geo/certification', rateLimit(GEO_IP_RATE, {
  limit: GEO_IP_LIMIT,
  windowMs: GEO_IP_WINDOW_MS,
  message: 'GEO 认证请求过于频繁，请稍后再试',
}), requireAccess, async (req, res) => {
  try {
    const brandName = normalizeGeoText(req.body?.brandName, 80);
    const legalName = normalizeGeoText(req.body?.legalName, 100);
    const creditCode = normalizeGeoCreditCode(req.body?.creditCode);
    const rawWebsiteUrl = normalizeGeoText(req.body?.websiteUrl, 260);
    const websiteUrl = normalizeGeoUrl(rawWebsiteUrl);
    const city = normalizeGeoText(req.body?.city, 80);
    const contactInfo = normalizeGeoText(req.body?.contactInfo, 160);
    const proofText = normalizeGeoText(req.body?.proofText, 700);
    const serviceArea = normalizeGeoText(req.body?.serviceArea, 160);
    const ownerName = normalizeGeoText(req.body?.ownerName, 80);
    const ownerPhone = normalizeGeoText(req.body?.ownerPhone, 60);
    const licenseUrl = normalizeGeoText(req.body?.licenseUrl, 260);

    if (!brandName && !legalName) {
      res.status(400).json({ error: '请先填写品牌名或主体名称' });
      return;
    }
    if (rawWebsiteUrl && !websiteUrl) {
      res.status(400).json({ error: '官网地址无效，只支持 http/https' });
      return;
    }

    res.json(await submitGeoCertification(req, {
      brandName,
      legalName,
      creditCode,
      websiteUrl,
      city,
      contactInfo,
      proofText,
      serviceArea,
      ownerName,
      ownerPhone,
      licenseUrl,
    }));
  } catch (error) {
    console.error(`[geo] certification submit failed: ${String(error?.message || error).replace(/\s+/g, ' ').slice(0, 500)}`);
    res.status(500).json({ error: '认证提交失败，请稍后再试' });
  }
});

app.post('/api/geo/business-verify', rateLimit(GEO_IP_RATE, {
  limit: GEO_IP_LIMIT,
  windowMs: GEO_IP_WINDOW_MS,
  message: 'GEO 认证请求过于频繁，请稍后再试',
}), requireAccess, async (req, res) => {
  try {
    const brandName = normalizeGeoText(req.body?.brandName, 80);
    const legalName = normalizeGeoText(req.body?.legalName, 100);
    const creditCode = normalizeGeoCreditCode(req.body?.creditCode);
    const rawWebsiteUrl = normalizeGeoText(req.body?.websiteUrl, 260);
    const websiteUrl = normalizeGeoUrl(rawWebsiteUrl);
    const city = normalizeGeoText(req.body?.city, 80);
    const contactInfo = normalizeGeoText(req.body?.contactInfo, 160);
    const proofText = normalizeGeoText(req.body?.proofText, 700);
    const serviceArea = normalizeGeoText(req.body?.serviceArea, 160);

    if (!brandName && !legalName) {
      res.status(400).json({ error: '请先填写品牌名或主体名称' });
      return;
    }
    if (rawWebsiteUrl && !websiteUrl) {
      res.status(400).json({ error: '官网地址无效，只支持 http/https' });
      return;
    }

    res.json({
      ...createLocalGeoBusinessVerify({
        brandName,
        legalName,
        creditCode,
        websiteUrl,
        city,
        contactInfo,
        proofText,
        serviceArea,
      }),
      ok: true,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`[geo] business verify failed: ${String(error?.message || error).replace(/\s+/g, ' ').slice(0, 500)}`);
    res.status(500).json({ error: '商家认证清单生成失败，请稍后再试' });
  }
});

app.post('/api/geo/knowledge', rateLimit(GEO_IP_RATE, {
  limit: GEO_IP_LIMIT,
  windowMs: GEO_IP_WINDOW_MS,
  message: 'GEO 知识库请求过于频繁，请稍后再试',
}), requireAccess, async (req, res) => {
  try {
    const brandName = normalizeGeoText(req.body?.brandName, 80);
    const legalName = normalizeGeoText(req.body?.legalName, 100);
    const rawWebsiteUrl = normalizeGeoText(req.body?.websiteUrl, 260);
    const websiteUrl = normalizeGeoUrl(rawWebsiteUrl);
    const city = normalizeGeoText(req.body?.city, 80);
    const contactInfo = normalizeGeoText(req.body?.contactInfo, 160);
    const serviceArea = normalizeGeoText(req.body?.serviceArea, 160);
    const serviceTypes = normalizeGeoKeywords(req.body?.serviceTypes);
    const styles = normalizeGeoKeywords(req.body?.styles);
    const priceRange = normalizeGeoText(req.body?.priceRange, 100);
    const caseNotes = normalizeGeoText(req.body?.caseNotes, 1200);
    const faqNotes = normalizeGeoText(req.body?.faqNotes, 900);

    if (!brandName && !legalName && !serviceTypes.length && !caseNotes) {
      res.status(400).json({ error: '请先填写品牌名、服务类型或案例资料' });
      return;
    }
    if (rawWebsiteUrl && !websiteUrl) {
      res.status(400).json({ error: '官网地址无效，只支持 http/https' });
      return;
    }

    const result = await buildGeoKnowledge({
      brandName,
      legalName,
      websiteUrl,
      city,
      contactInfo,
      serviceArea,
      serviceTypes,
      styles,
      priceRange,
      caseNotes,
      faqNotes,
    });
    res.json({
      ...result,
      ok: true,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`[geo] knowledge failed: ${String(error?.message || error).replace(/\s+/g, ' ').slice(0, 500)}`);
    res.status(500).json({ error: '婚礼知识库生成失败，请稍后再试' });
  }
});

app.post('/api/geo/article-prompts', rateLimit(GEO_IP_RATE, {
  limit: GEO_IP_LIMIT,
  windowMs: GEO_IP_WINDOW_MS,
  message: 'GEO 文章提示词请求过于频繁，请稍后再试',
}), requireAccess, async (req, res) => {
  try {
    const brandName = normalizeGeoText(req.body?.brandName, 80);
    const legalName = normalizeGeoText(req.body?.legalName, 100);
    const rawWebsiteUrl = normalizeGeoText(req.body?.websiteUrl, 260);
    const websiteUrl = normalizeGeoUrl(rawWebsiteUrl);
    const city = normalizeGeoText(req.body?.city, 80);
    const serviceArea = normalizeGeoText(req.body?.serviceArea, 160);
    const serviceTypes = normalizeGeoKeywords(req.body?.serviceTypes);
    const topic = normalizeGeoText(req.body?.topic, 140);
    const audience = normalizeGeoText(req.body?.audience, 160);
    const keywords = normalizeGeoKeywords(req.body?.keywords);
    const angleNotes = normalizeGeoText(req.body?.angleNotes, 1000);

    if (!topic && !keywords.length && !serviceTypes.length) {
      res.status(400).json({ error: '请先填写文章主题、关键词或服务类型' });
      return;
    }
    if (rawWebsiteUrl && !websiteUrl) {
      res.status(400).json({ error: '官网地址无效，只支持 http/https' });
      return;
    }

    const result = await buildGeoArticlePrompts({
      brandName,
      legalName,
      websiteUrl,
      city,
      serviceArea,
      serviceTypes,
      topic,
      audience,
      keywords,
      angleNotes,
    });
    res.json({
      ...result,
      ok: true,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`[geo] article prompts failed: ${String(error?.message || error).replace(/\s+/g, ' ').slice(0, 500)}`);
    res.status(500).json({ error: '文章提示词生成失败，请稍后再试' });
  }
});

app.post('/api/geo/visibility', rateLimit(GEO_IP_RATE, {
  limit: GEO_IP_LIMIT,
  windowMs: GEO_IP_WINDOW_MS,
  message: 'GEO 诊断请求过于频繁，请稍后再试',
}), requireAccess, async (req, res) => {
  try {
    const brandName = normalizeGeoText(req.body?.brandName, 80);
    const rawWebsiteUrl = normalizeGeoText(req.body?.websiteUrl, 260);
    const websiteUrl = normalizeGeoUrl(rawWebsiteUrl);
    const serviceArea = normalizeGeoText(req.body?.serviceArea, 120);
    const competitors = normalizeGeoCompetitors(req.body?.competitors);

    if (!brandName) {
      res.status(400).json({ error: '请先填写品牌名' });
      return;
    }
    if (rawWebsiteUrl && !websiteUrl) {
      res.status(400).json({ error: '官网地址无效，只支持 http/https' });
      return;
    }

    const result = await buildGeoVisibility({
      brandName,
      websiteUrl,
      serviceArea,
      competitors,
    });
    res.json({
      ...result,
      ok: true,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`[geo] visibility failed: ${String(error?.message || error).replace(/\s+/g, ' ').slice(0, 500)}`);
    res.status(500).json({ error: 'GEO 可见度诊断失败，请稍后再试' });
  }
});

app.post('/api/geo/distill', rateLimit(GEO_IP_RATE, {
  limit: GEO_IP_LIMIT,
  windowMs: GEO_IP_WINDOW_MS,
  message: 'GEO 蒸馏请求过于频繁，请稍后再试',
}), requireAccess, async (req, res) => {
  try {
    const brandName = normalizeGeoText(req.body?.brandName, 80);
    const rawWebsiteUrl = normalizeGeoText(req.body?.websiteUrl, 260);
    const websiteUrl = normalizeGeoUrl(rawWebsiteUrl);
    const serviceArea = normalizeGeoText(req.body?.serviceArea, 140);
    const keywords = normalizeGeoKeywords(req.body?.keywords);
    const competitors = normalizeGeoCompetitors(req.body?.competitors);

    if (!brandName && !keywords.length && !serviceArea) {
      res.status(400).json({ error: '请先填写品牌名或核心关键词' });
      return;
    }
    if (rawWebsiteUrl && !websiteUrl) {
      res.status(400).json({ error: '官网地址无效，只支持 http/https' });
      return;
    }

    const result = await buildGeoDistill({
      brandName,
      websiteUrl,
      serviceArea,
      keywords,
      competitors,
    });
    res.json({
      ...result,
      ok: true,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`[geo] distill failed: ${String(error?.message || error).replace(/\s+/g, ' ').slice(0, 500)}`);
    res.status(500).json({ error: 'GEO AI蒸馏失败，请稍后再试' });
  }
});

app.post('/api/geo/audit', rateLimit(GEO_IP_RATE, {
  limit: GEO_IP_LIMIT,
  windowMs: GEO_IP_WINDOW_MS,
  message: 'GEO 体检请求过于频繁，请稍后再试',
}), requireAccess, async (req, res) => {
  try {
    const safeUrl = await assertSafeGeoAuditUrl(req.body?.url);
    const page = await fetchGeoText(safeUrl, {
      accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5',
      timeoutMs: 10_000,
      maxBytes: 420_000,
    });
    if (page.contentType && !/text\/html|application\/xhtml\+xml|text\/plain|charset=/i.test(page.contentType)) {
      throw new Error('目标地址不像可体检的网页，请填写官网首页地址');
    }
    const robots = await fetchOptionalGeoFile(page.url, '/robots.txt');
    const llms = await fetchOptionalGeoFile(page.url, '/llms.txt');
    res.json(buildGeoAuditResult(page.url, page.text, robots, llms));
  } catch (error) {
    const message = String(error?.message || '官网体检失败').replace(/\s+/g, ' ').slice(0, 220);
    const status = /无效|不能|只支持|用户名|无法解析|内容过大|不像可体检/.test(message)
      ? 400
      : (/timeout|AbortError|timed out/i.test(message) ? 504 : 502);
    res.status(status).json({ error: message });
  }
});

app.post('/api/access', rateLimit(LOGIN_IP_RATE, {
  limit: LOGIN_IP_LIMIT,
  windowMs: LOGIN_IP_WINDOW_MS,
  message: '登录或访问码尝试过于频繁，请稍后再试',
}), async (req, res) => {
  if (ACCOUNT_SYSTEM_ENABLED) {
    const login = normalizeLogin(req.body?.login);
    const code = String(req.body?.code || '').trim();
    if (!login || !code) {
      res.status(400).json({ error: '请输入手机号和密码' });
      return;
    }
    const user = await authenticateAccount(login, code);
    if (!user) {
      res.status(401).json({ error: '手机号或密码不正确' });
      return;
    }
    res.setHeader('Set-Cookie', accountCookie(`${user.id}.${accountToken(user)}`, ACCESS_COOKIE_MAX_AGE_SECONDS, req));
    const loginContext = await siteContextPayload(req, { user });
    const loginTenant = loginContext.tenant;
    const rechargeFields = publicWebRechargeFields(loginTenant);
    res.json({
      ...loginContext,
      ok: true,
      required: true,
      accountRequired: true,
      user: publicUser(user),
      pointCost: JOB_POINT_COST,
      pointCosts: publicPointCosts(),
      ...rechargeFields,
      motion: publicMotionConfig(),
    });
    return;
  }

  const context = await siteContextPayload(req);
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

app.post('/api/account/send-phone-code', async (req, res) => {
  if (!ACCOUNT_SYSTEM_ENABLED) {
    res.status(404).json({ error: '注册功能未开启' });
    return;
  }
  const tenant = await resolveTenant(req);
  const phone = normalizePhone(req.body?.phone || req.body?.login);
  if (!isMainlandPhone(phone)) {
    res.status(400).json({ error: '请输入有效的 11 位手机号' });
    return;
  }

  const existing = await readUserStore();
  if (existing.users.some((u) => normalizeLogin(u.login) === phone)) {
    res.status(409).json({ error: '该手机号已注册，请直接登录' });
    return;
  }

  const smsStatus = smsChannelStatus();
  if (!smsStatus.ready) {
    console.warn(`[sms] channel unavailable for ${phone}: ${smsStatus.message}`);
    res.status(503).json(smsFailurePayload(tenant, new Error(smsStatus.message)));
    return;
  }

  const ip = clientIp(req);
  const ipRate = checkRateWindow(PHONE_CODE_IP_RATE, ip, PHONE_CODE_IP_LIMIT, PHONE_CODE_IP_WINDOW_MS);
  if (!ipRate.ok) {
    res.status(429).json({
      error: `短信发送过于频繁，请 ${ipRate.retryAfter} 秒后再试`,
      code: 'SMS_RATE_LIMITED',
      retryAfter: ipRate.retryAfter,
      supportContacts: publicWebTenant(tenant).supportContacts,
    });
    return;
  }

  const now = Date.now();
  prunePhoneVerificationCodes(now);
  const cooldown = phoneCodeCooldown(phone, now);
  if (cooldown > 0) {
    res.status(429).json({
      error: `验证码已发送，请 ${cooldown} 秒后再试`,
      code: 'SMS_COOLDOWN',
      retryAfter: cooldown,
      supportContacts: publicWebTenant(tenant).supportContacts,
    });
    return;
  }

  const verificationCode = generatePhoneVerificationCode();
  try {
    await sendPhoneVerificationCode(phone, verificationCode);
  } catch (error) {
    console.warn(`[sms] failed to send code to ${phone}: ${error.message}`);
    res.status(502).json(smsFailurePayload(tenant, error));
    return;
  }

  PHONE_CODE_STORE.set(phone, {
    codeHash: hashPhoneVerificationCode(phone, verificationCode),
    expiresAt: now + PHONE_CODE_TTL_SECONDS * 1000,
    lastSentAt: now,
    attempts: 0,
    ip,
  });
  res.json({
    ok: true,
    expiresIn: PHONE_CODE_TTL_SECONDS,
    cooldown: PHONE_CODE_RESEND_SECONDS,
    message: '验证码已发送，请查看手机短信',
  });
});

app.get('/api/account/captcha', (_req, res) => {
  if (!ACCOUNT_SYSTEM_ENABLED) {
    res.status(404).json({ error: '注册功能未开启' });
    return;
  }
  res.json({
    ok: true,
    ...createRegisterCaptcha(),
  });
});

app.post('/api/account/register', async (req, res) => {
  if (!ACCOUNT_SYSTEM_ENABLED) {
    res.status(404).json({ error: '注册功能未开启' });
    return;
  }
  const login = normalizePhone(req.body?.login);
  const code = String(req.body?.code || '').trim();
  const captchaAnswer = String(req.body?.captchaAnswer || req.body?.captcha || '').trim();
  const captchaToken = String(req.body?.captchaToken || '').trim();
  const name = displayAccountName(String(req.body?.name || '').trim().slice(0, 20), login);
  const role = String(req.body?.role || req.body?.source || '').trim().slice(0, 30);
  const tenant = await resolveTenant(req);
  const tenantContext = publicTenant(tenant);
  const tenantId = tenant ? String(tenant.id || '').trim() : '';
  const tenantSlug = tenant ? tenantContext.slug : '';

  if (!isMainlandPhone(login)) {
    res.status(400).json({ error: '注册必须使用有效的 11 位手机号' });
    return;
  }
  if (code.length < 6 || code.length > 32) {
    res.status(400).json({ error: '密码需 6-32 位' });
    return;
  }
  const captcha = verifyRegisterCaptcha(captchaToken, captchaAnswer);
  if (!captcha.ok) {
    res.status(captcha.status || 400).json({ error: captcha.error || '验证码不正确' });
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
  if (PHONE_VERIFICATION_REQUIRED) {
    const phoneCode = String(req.body?.phoneCode || req.body?.smsCode || '').trim();
    const verification = consumePhoneVerificationCode(login, phoneCode);
    if (!verification.ok) {
      res.status(verification.status || 400).json({ error: verification.error });
      return;
    }
  }

  const now = new Date().toISOString();
  const result = await mutateUserStore((store) => {
    const user = {
      id: newId('user'),
      login,
      phone: login,
      phoneVerifiedAt: PHONE_VERIFICATION_REQUIRED ? now : '',
      phoneVerificationSkippedAt: PHONE_VERIFICATION_REQUIRED ? '' : now,
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
  const tenant = await resolveTenant(req);
  const tenantContext = publicTenant(tenant);
  const rechargePlans = tenantContext.rechargePlans || tenantRechargePlansText(tenant);
  const ledger = store.ledger
    .filter((entry) => entry.userId === user.id || entry.login === user.login)
    .slice(0, limit)
    .map(publicLedgerEntry);
  res.json({
    user: publicUser(user),
    ledger,
    rechargePlans,
    rechargePlanItems: tenantContext.rechargePlanItems || publicRechargePlans(rechargePlans),
    pointCosts: publicPointCosts(),
  });
});

app.get('/api/tenant/admin/profile', requireTenantAdmin, async (req, res) => {
  const store = await readTenantStore();
  const tenant = store.tenants.find((item) => String(item.id || '') === String(req.user.tenantId || ''));
  if (!tenant || !isActiveTenant(tenant)) {
    res.status(404).json({ error: '合作方不存在或已停用' });
    return;
  }
  const tenantPayload = publicAdminTenant(tenant);
  res.json({
    ok: true,
    user: publicUser(req.user),
    tenant: tenantPayload,
    inviteUrl: tenantPayload.inviteUrl,
    rechargePlans: tenantPayload.rechargePlans,
    rechargePlanItems: tenantPayload.rechargePlanItems,
  });
});

app.patch('/api/tenant/admin/profile', requireTenantAdmin, async (req, res) => {
  let nextRechargePlans;
  if (req.body?.rechargePlans != null) {
    try {
      nextRechargePlans = normalizeRechargePlansText(req.body.rechargePlans, { allowEmpty: false });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message || '套餐配置不正确' });
      return;
    }
  }
  const now = new Date().toISOString();
  try {
    const tenant = await mutateTenantStore((store) => {
      const item = store.tenants.find((tenantItem) => String(tenantItem.id || '') === String(req.user.tenantId || ''));
      if (!item || !isActiveTenant(item)) {
        const error = new Error('合作方不存在或已停用');
        error.status = 404;
        throw error;
      }
      for (const key of ['supportWechat']) {
        if (req.body?.[key] != null) item[key] = String(req.body[key] || '').trim();
      }
      if (nextRechargePlans !== undefined) item.rechargePlans = nextRechargePlans;
      item.updatedAt = now;
      return item;
    });
    const tenantPayload = publicAdminTenant(tenant);
    res.json({
      ok: true,
      user: publicUser(req.user),
      tenant: tenantPayload,
      inviteUrl: tenantPayload.inviteUrl,
      rechargePlans: tenantPayload.rechargePlans,
      rechargePlanItems: tenantPayload.rechargePlanItems,
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '保存代理配置失败' });
  }
});

app.post('/api/tenant/admin/wechat-qr', requireTenantAdmin, upload.single('image'), async (req, res) => {
  try {
    const qrPath = await saveTenantWechatQrImage(req.user.tenantId, req.file);
    const now = new Date().toISOString();
    const tenant = await mutateTenantStore((store) => {
      const item = store.tenants.find((tenantItem) => String(tenantItem.id || '') === String(req.user.tenantId || ''));
      if (!item || !isActiveTenant(item)) {
        const error = new Error('合作方不存在或已停用');
        error.status = 404;
        throw error;
      }
      item.supportWechatQr = qrPath;
      item.updatedAt = now;
      return item;
    });
    const tenantPayload = publicAdminTenant(tenant);
    res.json({
      ok: true,
      user: publicUser(req.user),
      tenant: tenantPayload,
      inviteUrl: tenantPayload.inviteUrl,
      rechargePlans: tenantPayload.rechargePlans,
      rechargePlanItems: tenantPayload.rechargePlanItems,
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '上传微信图片失败' });
  }
});

app.use('/api/admin', rateLimit(ADMIN_IP_RATE, {
  limit: ADMIN_IP_LIMIT,
  windowMs: ADMIN_IP_WINDOW_MS,
  message: '管理员接口请求过于频繁，请稍后再试',
}));

app.get('/api/admin/accounts', requireAdmin, async (_req, res) => {
  const store = await readUserStore();
  res.json({
    accounts: store.users.map(publicUser),
    ledger: store.ledger.slice(0, 160).map(publicLedgerEntry),
    rechargePlans: publicRechargePlans(),
    stats: accountStats(store),
  });
});

app.get('/api/admin/accounts/search', requireAdmin, async (req, res) => {
  const query = String(req.query.q || req.query.query || '').trim();
  if (!query) {
    res.status(400).json({ error: '请输入要搜索的手机号、姓名或合作方' });
    return;
  }
  const limit = Math.max(1, Math.min(50, Number(req.query.limit || 12)));
  const ledgerLimit = Math.max(1, Math.min(120, Number(req.query.ledgerLimit || 60)));
  const [store, tenantStore] = await Promise.all([readUserStore(), readTenantStore()]);
  const tenantsById = new Map((tenantStore.tenants || []).map((tenant) => [String(tenant.id || ''), tenant]));
  const accounts = store.users
    .filter((user) => adminAccountMatchesQuery(user, query, tenantsById))
    .slice(0, limit);
  const accountKeys = new Set(accounts.flatMap((account) => [account.id, account.login].filter(Boolean)));
  const ledger = store.ledger
    .filter((entry) => accountKeys.has(entry.userId) || accountKeys.has(entry.login))
    .slice(0, ledgerLimit)
    .map(publicLedgerEntry);
  res.json({
    ok: true,
    query,
    count: accounts.length,
    accounts: accounts.map(publicUser),
    ledger,
    rechargePlans: publicRechargePlans(),
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
  let rechargePlans = '';
  try {
    rechargePlans = normalizeRechargePlansText(req.body?.rechargePlans || '');
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message || '套餐配置不正确' });
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
      rechargePlans,
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
  let nextRechargePlans;
  if (req.body?.rechargePlans != null) {
    try {
      nextRechargePlans = normalizeRechargePlansText(req.body.rechargePlans);
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message || '套餐配置不正确' });
      return;
    }
  }
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
    if (nextRechargePlans !== undefined) item.rechargePlans = nextRechargePlans;
    if (req.body?.domains != null) item.domains = parseTenantDomains(req.body.domains);
    if (req.body?.adminUserIds != null) item.adminUserIds = Array.isArray(req.body.adminUserIds) ? req.body.adminUserIds.map(String).filter(Boolean) : [];
    item.updatedAt = now;
    return item;
  });
  res.json({ ok: true, tenant: publicAdminTenant(tenant) });
});

app.patch('/api/admin/accounts/:login', requireAdmin, async (req, res) => {
  const accountKey = String(req.params.login || req.body?.login || '').trim();
  if (!accountKey) {
    res.status(400).json({ error: '请输入客户账号' });
    return;
  }

  const body = req.body || {};
  const hasTenantChange = Object.hasOwn(body, 'tenantId') || Object.hasOwn(body, 'tenantSlug');
  const tenantKey = String(body.tenantId || body.tenantSlug || '').trim();
  let selectedTenant = null;
  if (hasTenantChange && tenantKey) {
    const tenantStore = await readTenantStore();
    selectedTenant = tenantStore.tenants.find((tenant) => String(tenant.id || '') === tenantKey
      || normalizeTenantSlug(tenant.slug || tenant.id) === normalizeTenantSlug(tenantKey));
    if (!selectedTenant) {
      res.status(400).json({ error: '合作方不存在' });
      return;
    }
  }

  const hasExpiryChange = Object.hasOwn(body, 'membershipExpiresAt');
  const nextExpiry = hasExpiryChange ? normalizeAdminMembershipExpiry(body.membershipExpiresAt) : undefined;
  if (nextExpiry === null) {
    res.status(400).json({ error: '有效期格式不正确' });
    return;
  }

  const hasPointsChange = Object.hasOwn(body, 'points') && String(body.points ?? '').trim() !== '';
  const nextPoints = hasPointsChange ? Number(body.points) : undefined;
  if (hasPointsChange && (!Number.isFinite(nextPoints) || nextPoints < 0)) {
    res.status(400).json({ error: '点数必须是不小于 0 的数字' });
    return;
  }

  try {
    const now = new Date().toISOString();
    const result = await mutateUserStore((store) => {
      const user = findAdminAccount(store, accountKey);
      if (!user) {
        const error = new Error('客户账号不存在');
        error.status = 404;
        throw error;
      }

      const note = String(body.note || '').trim();
      const ledgerEntries = [];
      const previousPoints = Number(user.points || 0);
      const previousExpiresAt = user.membershipExpiresAt || '';
      const previousPlan = user.membershipPlan || '';
      const changes = [];

      if (Object.hasOwn(body, 'name')) {
        user.name = displayAccountName(String(body.name || '').trim(), user.login);
        changes.push('姓名');
      }

      if (Object.hasOwn(body, 'status')) {
        const status = String(body.status || '').trim() || 'active';
        if (!['active', 'disabled'].includes(status)) {
          const error = new Error('状态只能是 active 或 disabled');
          error.status = 400;
          throw error;
        }
        user.status = status;
        changes.push('状态');
      }

      if (Object.hasOwn(body, 'role')) {
        user.role = String(body.role || '').trim().slice(0, 30);
        changes.push('身份');
      }

      if (hasTenantChange) {
        if (selectedTenant) {
          const tenantContext = publicTenant(selectedTenant);
          user.tenantId = String(selectedTenant.id || '').trim();
          user.tenantSlug = tenantContext.slug;
        } else {
          user.tenantId = '';
          user.tenantSlug = '';
        }
        changes.push('合作方');
      }

      if (Object.hasOwn(body, 'tenantRole') || hasTenantChange) {
        const tenantRole = String(body.tenantRole || '').trim();
        user.tenantRole = user.tenantId && tenantRole === 'tenant_admin' ? 'tenant_admin' : '';
        changes.push('代理权限');
      }

      if (hasPointsChange) {
        const roundedPoints = Math.round(nextPoints);
        const delta = roundedPoints - previousPoints;
        if (delta !== 0) {
          user.points = roundedPoints;
          ledgerEntries.push({
            id: newId('ledger'),
            userId: user.id,
            login: user.login,
            type: 'manual_adjustment',
            points: delta,
            balanceAfter: roundedPoints,
            note: note || `管理员修改点数：${previousPoints} → ${roundedPoints}`,
            jobId: '',
            tenantId: user.tenantId || '',
            tenantSlug: user.tenantSlug || '',
            createdAt: now,
          });
        }
        changes.push('点数');
      }

      if (hasExpiryChange) {
        user.membershipExpiresAt = nextExpiry;
        user.membershipUpdatedAt = now;
        changes.push('有效期');
      }

      if (Object.hasOwn(body, 'membershipPlan')) {
        user.membershipPlan = String(body.membershipPlan || '').trim().slice(0, 60);
        changes.push('有效期备注');
      }

      if ((hasExpiryChange && previousExpiresAt !== (user.membershipExpiresAt || ''))
        || (Object.hasOwn(body, 'membershipPlan') && previousPlan !== (user.membershipPlan || ''))) {
        const expiryLabel = user.membershipExpiresAt ? `有效期调整为 ${user.membershipExpiresAt}` : '清空有效期';
        ledgerEntries.push({
          id: newId('ledger'),
          userId: user.id,
          login: user.login,
          type: 'membership_adjustment',
          points: 0,
          balanceAfter: Number(user.points || 0),
          note: note || `管理员${expiryLabel}`,
          jobId: '',
          tenantId: user.tenantId || '',
          tenantSlug: user.tenantSlug || '',
          membershipExpiresAt: user.membershipExpiresAt || '',
          previousMembershipExpiresAt: previousExpiresAt,
          createdAt: now,
        });
      }

      user.updatedAt = now;
      store.ledger.unshift(...ledgerEntries);
      return { user: { ...user }, ledger: ledgerEntries.map((entry) => ({ ...entry })), changes: [...new Set(changes)] };
    });

    res.json({
      ok: true,
      account: publicUser(result.user),
      ledger: result.ledger.map(publicLedgerEntry),
      changes: result.changes,
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '更新客户账号失败' });
  }
});

app.patch('/api/admin/accounts/:login/password', requireAdmin, async (req, res) => {
  const accountKey = String(req.params.login || req.body?.login || '').trim();
  const nextCode = normalizeAdminLoginCode(req.body?.password || req.body?.code || req.body?.loginCode);
  if (!accountKey) {
    res.status(400).json({ error: '请输入客户账号' });
    return;
  }
  if (!nextCode) {
    res.status(400).json({ error: '新密码需 6-32 位' });
    return;
  }

  try {
    const now = new Date().toISOString();
    const result = await mutateUserStore((store) => {
      const user = findAdminAccount(store, accountKey);
      if (!user) {
        const error = new Error('客户账号不存在');
        error.status = 404;
        throw error;
      }
      user.codeHash = hashLoginCode(user.login, nextCode);
      user.sessionVersion = Number(user.sessionVersion || 1) + 1;
      user.updatedAt = now;
      store.ledger.unshift({
        id: newId('ledger'),
        userId: user.id,
        login: user.login,
        type: 'password_change',
        points: 0,
        balanceAfter: Number(user.points || 0),
        note: String(req.body?.note || '').trim() || '管理员修改客户密码',
        jobId: '',
        tenantId: user.tenantId || '',
        tenantSlug: user.tenantSlug || '',
        createdAt: now,
      });
      return { user: { ...user } };
    });
    res.json({ ok: true, account: publicUser(result.user) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '修改客户密码失败' });
  }
});

app.post('/api/admin/accounts', requireAdmin, async (req, res) => {
  const login = normalizeLogin(req.body?.login);
  if (!login) {
    res.status(400).json({ error: '请输入客户手机号' });
    return;
  }
  const existing = await readUserStore();
  if (!existing.users.some((item) => item.login === login) && !isMainlandPhone(login)) {
    res.status(400).json({ error: '新建客户账号必须使用有效的 11 位手机号' });
    return;
  }
  const now = new Date().toISOString();
  const requestedCode = String(req.body?.code || '').trim();
  const inputCode = requestedCode || generateLoginCode();
  if (requestedCode && !normalizeAdminLoginCode(requestedCode)) {
    res.status(400).json({ error: '密码需 6-32 位' });
    return;
  }
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
    user.sessionVersion = Number(user.sessionVersion || 1) + (isNew ? 0 : 1);
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
  const points = selectedPlan
    ? (Object.hasOwn(selectedPlan, 'grantPoints') ? Number(selectedPlan.grantPoints || 0) : Number(selectedPlan.points || 0))
    : Number(req.body?.points);
  const zeroPointPackage = !!selectedPlan && selectedPlan.packageOnly === true && points === 0;
  if (!login || !Number.isFinite(points) || (points === 0 && !zeroPointPackage)) {
    res.status(400).json({ error: '请输入客户手机号和要增加的点数' });
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
    applyMembership: true,
  } : {};
  meta.tenantId = user.tenantId || '';
  meta.tenantSlug = user.tenantSlug || '';
  const result = await adjustUserPoints(user.id, points, selectedPlan ? 'manual_recharge' : (points > 0 ? 'manual_recharge' : 'manual_adjustment'), note, '', meta);
  res.json({ ok: true, account: publicUser(result.user), ledger: result.entry });
});

app.get('/api/resources', requireAccess, async (req, res) => {
  const resources = await readResourceManifest();
  res.json({ resources: resources.filter((resource) => canSeeOwnedItem(req, resource)).map(withResourceUrls) });
});

app.post('/api/voice/narration', rateLimit(GENERATE_IP_RATE, {
  limit: GENERATE_IP_LIMIT,
  windowMs: GENERATE_IP_WINDOW_MS,
  message: '声音旁白请求过于频繁，请稍后再试',
}), requireAccess, upload.single('audio'), async (req, res) => {
  let referenceAudioPath = '';
  try {
    const text = String(req.body?.text || '').trim();
    const referenceText = String(req.body?.referenceText || '').trim();
    const consent = /^(1|true|yes|on)$/i.test(String(req.body?.consent || ''));
    if (!consent) {
      res.status(400).json({ error: '请先确认声音本人授权' });
      return;
    }
    if (!req.file?.buffer?.length) {
      res.status(400).json({ error: '请上传声音样本' });
      return;
    }
    if (req.file.size > VOICE_CLONE_MAX_AUDIO_BYTES) {
      res.status(400).json({ error: `声音样本太大，请控制在 ${Math.round(VOICE_CLONE_MAX_AUDIO_BYTES / 1024 / 1024)}MB 以内` });
      return;
    }
    if (!text) {
      res.status(400).json({ error: '请填写旁白文案' });
      return;
    }
    if (text.length > 1200) {
      res.status(400).json({ error: '旁白文案太长，请控制在 1200 字以内' });
      return;
    }
    if (!VOICE_CLONE_API_BASE || VOICE_CLONE_PROVIDER === 'disabled') {
      res.status(503).json({
        error: '声音引擎未配置：请先启动 GPT-SoVITS API，并在 .env 设置 VOICE_CLONE_API_BASE，例如 http://127.0.0.1:9880',
        setupRequired: true,
      });
      return;
    }

    await mkdir(VOICE_INPUT_DIR, { recursive: true });
    const requestId = randomBytes(10).toString('hex');
    referenceAudioPath = path.join(VOICE_INPUT_DIR, `${Date.now()}-${requestId}.${uploadedVoiceExtension(req.file)}`);
    await writeFile(referenceAudioPath, req.file.buffer);

    const result = await synthesizeVoiceWithGptSovits({
      text,
      referenceText,
      referenceAudioPath,
    });

    res.setHeader('Content-Type', result.contentType || 'audio/wav');
    res.setHeader('Content-Disposition', 'attachment; filename="wedscene-voice-narration.wav"');
    res.setHeader('X-Voice-Engine', VOICE_CLONE_PROVIDER);
    res.send(result.buffer);
  } catch (error) {
    const message = String(error?.message || '声音旁白生成失败').slice(0, 260);
    const serviceDown = /ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed|timeout|声音引擎|AbortError/i.test(message);
    res.status(serviceDown ? 503 : 400).json({ error: message });
  } finally {
    if (referenceAudioPath) {
      await rm(referenceAudioPath, { force: true }).catch(() => {});
    }
  }
});

app.post('/api/external/doubao-import', rateLimit(EXTERNAL_IMPORT_IP_RATE, {
  limit: EXTERNAL_IMPORT_IP_LIMIT,
  windowMs: EXTERNAL_IMPORT_IP_WINDOW_MS,
  message: '素材导入请求过于频繁，请稍后再试',
}), (req, res, next) => {
  if (EXTERNAL_IMPORT_MAINTENANCE) {
    res.status(503).json({
      error: EXTERNAL_IMPORT_MAINTENANCE_MESSAGE,
      maintenance: true,
    });
    return;
  }
  next();
}, requireAccess, requireMotionFeatureAccess, express.json({ limit: '64kb' }), async (req, res) => {
  try {
    const input = Array.isArray(req.body?.urls) ? req.body.urls : (req.body?.urls || req.body?.url);
    const result = await importExternalDoubaoResources(req, input);
    const resource = result.resources[0] || null;
    res.json({
      success: true,
      resource,
      resources: result.resources,
      failures: result.failures,
      requestedCount: result.requestedCount,
      imageCount: result.resources.reduce((count, item) => count + (item.images?.length || 0), 0),
      videoCount: result.resources.reduce((count, item) => count + (item.videoUrl ? 1 : 0), 0),
    });
  } catch (error) {
    const message = String(error?.message || '素材导入失败').slice(0, 220);
    const serviceDown = /fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|AbortError|timeout|Failed to fetch/i.test(message);
    res.status(serviceDown ? 503 : 400).json({
      error: serviceDown
        ? '豆包去水印解析通道暂时繁忙，请稍后重试'
        : message,
    });
  }
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

// 基于资源库的一张图直接生成运镜视频；首尾帧模型会在扣点前拒绝该入口。
app.post('/api/resources/:id/motion-video', requireAccess, requireMotionFeatureAccess, express.json(), async (req, res) => {
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
  if (isPlanResourceMode(resource.mode)) {
    res.status(400).json({ error: '方案图用于提案和施工交底，不支持一键生成视频' });
    return;
  }

  const requestedFilename = path.basename(String(req.body?.filename || '').trim());
  const resourceFilenames = (resource.images || []).map((img) => img.filename).filter(Boolean);
  const validFilename = resourceFilenames.includes(requestedFilename);
  if (!requestedFilename || !validFilename) {
    res.status(400).json({ error: '请选择资源中的有效图片' });
    return;
  }
  const selectedFilenames = [requestedFilename];
  const resourceMotionMinReferences = motionMinimumReferenceCountForModel();
  if (resourceMotionMinReferences > selectedFilenames.length) {
    res.status(400).json({
      error: `当前视频模型需要 ${resourceMotionMinReferences} 张参考图，请到视频页上传连续转场参考图生成。`,
      minReferenceCount: resourceMotionMinReferences,
      referenceLimit: motionReferenceLimitForModel(),
    });
    return;
  }

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
  job.logs.push(`[motion] 资源图运镜 | ${MOTION_STYLES[job.motionStyle]?.label || job.motionStyle}`);

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

app.post('/api/video-v1/jobs', rateLimit(GENERATE_IP_RATE, {
  limit: GENERATE_IP_LIMIT,
  windowMs: GENERATE_IP_WINDOW_MS,
  message: '视频生成任务提交过于频繁，请稍后再试',
}), requireAccess, requireMotionFeatureAccess, upload.fields([
  { name: 'image', maxCount: PRO666_VIDEO_MAX_REFERENCE_LIMIT },
  { name: 'reference_image', maxCount: PRO666_VIDEO_MAX_REFERENCE_LIMIT },
  { name: 'images', maxCount: PRO666_VIDEO_MAX_REFERENCE_LIMIT },
  { name: 'video', maxCount: PRO666_VIDEO_REFERENCE_VIDEO_LIMIT },
  { name: 'videos', maxCount: PRO666_VIDEO_REFERENCE_VIDEO_LIMIT },
  { name: 'reference_video', maxCount: PRO666_VIDEO_REFERENCE_VIDEO_LIMIT },
  { name: 'reference_videos', maxCount: PRO666_VIDEO_REFERENCE_VIDEO_LIMIT },
  { name: 'audio', maxCount: PRO666_VIDEO_REFERENCE_AUDIO_LIMIT },
  { name: 'audios', maxCount: PRO666_VIDEO_REFERENCE_AUDIO_LIMIT },
  { name: 'reference_audio', maxCount: PRO666_VIDEO_REFERENCE_AUDIO_LIMIT },
  { name: 'reference_audios', maxCount: PRO666_VIDEO_REFERENCE_AUDIO_LIMIT },
]), async (req, res) => {
  let prompt = '';
  let referenceUrls = [];
  let videoUrls = [];
  let audioUrls = [];
  let modelMode = 'fast';
  let requestModel = PRO666_VIDEO_FAST_MODEL;
  let generateAudio = false;
  let durationSeconds = VIDEO_V1_DURATION_SECONDS;
  let aspectRatio = '16:9';
  try {
    prompt = normalizeVideoV1Prompt(req.body?.prompt || req.body?.text || '');
    if (!prompt) {
      res.status(400).json({ error: '请输入视频生成提示词' });
      return;
    }
    modelMode = normalizePro666VideoModelMode(req.body?.model_mode || req.body?.modelMode || req.body?.video_model_mode || req.body?.model || MOTION_VIDEO_REQUEST_MODEL);
    requestModel = pro666VideoModelForMode(modelMode);
    const referenceLimit = motionReferenceLimitForModel(requestModel);
    durationSeconds = normalizeVideoV1Duration(req.body?.duration ?? req.body?.seconds ?? MOTION_VIDEO_DURATION);
    aspectRatio = normalizeVideoV1AspectRatio(req.body?.aspect_ratio || req.body?.aspectRatio || motionVideoColonAspectRatio());
    referenceUrls = normalizeVideoV1PublicMediaUrls([
      req.body?.image_url,
      req.body?.imageUrl,
      req.body?.image_urls,
      req.body?.imageUrls,
      req.body?.reference_url,
      req.body?.referenceUrl,
      req.body?.input_reference,
      req.body?.images,
    ], referenceLimit, '参考图 URL');
    videoUrls = normalizeVideoV1PublicMediaUrls([
      req.body?.video_urls,
      req.body?.videoUrls,
      req.body?.video_url,
      req.body?.videoUrl,
    ], PRO666_VIDEO_REFERENCE_VIDEO_LIMIT, '参考视频 URL');
    audioUrls = normalizeVideoV1PublicMediaUrls([
      req.body?.audio_urls,
      req.body?.audioUrls,
      req.body?.audio_url,
      req.body?.audioUrl,
    ], PRO666_VIDEO_REFERENCE_AUDIO_LIMIT, '参考音频 URL');
    generateAudio = formBoolean(req.body?.generate_audio ?? req.body?.generateAudio);
  } catch (error) {
    res.status(400).json({ error: error.message || '视频参数不完整' });
    return;
  }

  const uploadedReferences = [
    ...(req.files?.images || []),
    ...(req.files?.image || []),
    ...(req.files?.reference_image || []),
  ].slice(0, motionReferenceLimitForModel(requestModel));
  const uploadedVideoReferences = [
    ...(req.files?.videos || []),
    ...(req.files?.video || []),
    ...(req.files?.reference_videos || []),
    ...(req.files?.reference_video || []),
  ].slice(0, PRO666_VIDEO_REFERENCE_VIDEO_LIMIT);
  const uploadedAudioReferences = [
    ...(req.files?.audios || []),
    ...(req.files?.audio || []),
    ...(req.files?.reference_audios || []),
    ...(req.files?.reference_audio || []),
  ].slice(0, PRO666_VIDEO_REFERENCE_AUDIO_LIMIT);
  const isQualityModel = modelMode === 'quality';
  const imageCount = uploadedReferences.length + referenceUrls.length;
  const videoCount = uploadedVideoReferences.length + videoUrls.length;
  const audioCount = uploadedAudioReferences.length + audioUrls.length;
  const referenceLimit = motionReferenceLimitForModel(requestModel);
  if (imageCount > referenceLimit) {
    res.status(400).json({ error: `参考图最多 ${referenceLimit} 张` });
    return;
  }
  if (videoCount > PRO666_VIDEO_REFERENCE_VIDEO_LIMIT) {
    res.status(400).json({ error: `参考视频最多 ${PRO666_VIDEO_REFERENCE_VIDEO_LIMIT} 个` });
    return;
  }
  if (audioCount > PRO666_VIDEO_REFERENCE_AUDIO_LIMIT) {
    res.status(400).json({ error: `参考音频最多 ${PRO666_VIDEO_REFERENCE_AUDIO_LIMIT} 个` });
    return;
  }
  const mediaCount = imageCount + videoCount + audioCount;
  const mediaLimit = pro666VideoMediaLimitForModel(requestModel);
  if (mediaCount > mediaLimit) {
    res.status(400).json({
      error: `参考素材总数最多 ${mediaLimit} 个`,
    });
    return;
  }
  const imageSingleLimit = 20 * 1024 * 1024;
  if (hasUploadedFileOver(uploadedReferences, imageSingleLimit)) {
    res.status(400).json({ error: '参考图片单张不能超过 20M' });
    return;
  }
  if (uploadedFileTotalSize(uploadedReferences) > 80 * 1024 * 1024) {
    res.status(400).json({ error: '参考图片总大小不能超过 80M' });
    return;
  }
  if (hasUploadedFileOver(uploadedVideoReferences, 100 * 1024 * 1024)) {
    res.status(400).json({ error: '单个参考视频不能超过 100M' });
    return;
  }
  if (uploadedFileTotalSize(uploadedVideoReferences) > 300 * 1024 * 1024) {
    res.status(400).json({ error: '参考视频总大小不能超过 300M' });
    return;
  }
  if (hasUploadedFileOver(uploadedAudioReferences, 50 * 1024 * 1024)) {
    res.status(400).json({ error: '单个参考音频不能超过 50M' });
    return;
  }
  if ((uploadedReferences.length || uploadedVideoReferences.length || uploadedAudioReferences.length) && !USE_MOCK_MOTION_VIDEO && !currentPublicBaseUrl()) {
    res.status(400).json({ error: '上传参考素材需要先配置 PUBLIC_BASE_URL；也可以直接填写公网 HTTPS 素材 URL' });
    return;
  }

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

  const tenant = await resolveTenant(req);
  const tenantContext = publicTenant(tenant);
  const jobTenantId = tenant ? String(tenant.id || '').trim() : (req.user?.tenantId || '');
  const jobTenantSlug = tenant ? tenantContext.slug : (req.user?.tenantSlug || '');
  const placeholderFile = uploadedReferences[0] || {
    originalname: 'video-v1-prompt.txt',
    mimetype: 'text/plain',
    size: Buffer.byteLength(prompt, 'utf8'),
    buffer: Buffer.from(prompt, 'utf8'),
  };

  let chargedUser = req.user;
  const job = createJob('motion_video', placeholderFile, req.user, {
    files: [...uploadedReferences, ...uploadedVideoReferences, ...uploadedAudioReferences],
    tenantId: jobTenantId,
    tenantSlug: jobTenantSlug,
  });
  job.stage = 'video-v1 任务已创建';
  job.logs = [
    '[queue] video-v1 task accepted',
    `[input] model=${requestModel}, prompt length=${prompt.length}, duration=${durationSeconds}s, aspect_ratio=${aspectRatio}`,
    uploadedReferences.length || referenceUrls.length || uploadedVideoReferences.length || videoUrls.length || uploadedAudioReferences.length || audioUrls.length
      ? `[input] references images=${uploadedReferences.length + referenceUrls.length}, videos=${uploadedVideoReferences.length + videoUrls.length}, audios=${uploadedAudioReferences.length + audioUrls.length}`
      : '[input] text-to-video mode',
  ];
  job.videoV1 = {
    prompt,
    modelMode,
    requestModel,
    durationSeconds,
    aspectRatio,
    referenceUrls,
    videoUrls,
    audioUrls,
    generateAudio,
    referenceFiles: uploadedReferences,
    videoFiles: uploadedVideoReferences,
    audioFiles: uploadedAudioReferences,
  };

  if (pointCost > 0) {
    try {
      chargedUser = await chargeJobPoints(job, req.user.id, pointCost, `生成：视频生成 ${pro666VideoModelLabel(requestModel)}`);
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
  processVideoV1Job(job);
});

app.post('/api/jobs', rateLimit(GENERATE_IP_RATE, {
  limit: GENERATE_IP_LIMIT,
  windowMs: GENERATE_IP_WINDOW_MS,
  message: '生成任务提交过于频繁，请稍后再试',
}), requireAccess, upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'wedding_image', maxCount: 1 },
  { name: 'edit_mask', maxCount: 1 },
  { name: 'edit_references', maxCount: 3 },
  { name: 'reference_images', maxCount: Math.max(PARTIAL_EDIT_REFERENCE_LIMIT, FREE_IMAGE_REFERENCE_LIMIT) },
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
  const isPartialEdit = isPartialWeddingEditMode(mode);
  const isPsLayerSplit = isPsLayerSplitMode(mode);
  const isFreeTextImage = isFreeTextImageMode(mode);
  const isFreeImageToImage = isFreeImageToImageMode(mode);
  const isFreeImage = isFreeImageMode(mode);
  const editMaskFile = isPartialEdit ? (req.files?.edit_mask || [])[0] || null : null;
  const isSuperCustomMaskEdit = isPartialEdit && !!editMaskFile;
  const isSuperCustomLayerSplit = isPsLayerSplit;
  if (isMotion && ACCOUNT_SYSTEM_ENABLED && !canUseMotionFeatures(req.user)) {
    res.status(403).json({
      error: VIDEO_ACCESS_DENIED_MESSAGE,
      motionAccessRequired: true,
      membershipRequired: true,
      accountRequired: true,
      user: publicUser(req.user),
    });
    return;
  }
  if ((isSuperCustomMaskEdit || isSuperCustomLayerSplit) && ACCOUNT_SYSTEM_ENABLED && !canUseSuperCustom(req.user)) {
    res.status(403).json({
      error: SUPER_CUSTOM_ANNUAL_REQUIRED_MESSAGE,
      membershipRequired: true,
      annualMembershipRequired: true,
      accountRequired: true,
      user: publicUser(req.user),
    });
    return;
  }
  const userInstruction = (isFusion || mode === 'design_render_scene' || mode === 'outdoor_handdrawn_plan' || mode === 'copy_title')
    ? normalizeUserInstruction(req.body?.user_instruction || req.body?.userInstruction || req.body?.custom_instruction || req.body?.customInstruction || '')
    : '';
  const editInstruction = normalizeEditInstruction(req.body?.edit_instruction || req.body?.editInstruction || '');
  const freeImagePrompt = isFreeImage
    ? normalizeFreeImagePrompt(req.body?.prompt || req.body?.image_prompt || req.body?.imagePrompt || req.body?.free_image_prompt || req.body?.freeImagePrompt || req.body?.user_instruction || '')
    : '';
  const freeImageSize = isFreeImage ? normalizeFreeImageSize(req.body?.image_size || req.body?.imageSize || req.body?.size || '') : '1024x1024';
  const freeImageQuality = isFreeImage ? normalizeFreeImageQuality(req.body?.quality || req.body?.image_quality || req.body?.imageQuality || '') : 'auto';
  const freeImageFormat = isFreeImage ? normalizeFreeImageFormat(req.body?.output_format || req.body?.outputFormat || req.body?.format || '') : 'jpeg';
  const freeImageCount = isFreeImage ? normalizeFreeImageCount(req.body?.n || req.body?.count || req.body?.image_count || req.body?.imageCount || 1) : 1;
  const setupBrandName = isSetupProcessGridMode(mode)
    ? normalizeSetupBrandName(req.body?.setup_brand_name || req.body?.setupBrandName || req.body?.brand_name || req.body?.brandName || '')
    : '';
  const imageEnhanceSize = isImageEnhanceMode(mode)
    ? normalizeImageEnhanceSize(req.body?.image_enhance_size || req.body?.imageEnhanceSize || req.body?.image_size || req.body?.imageSize)
    : DEFAULT_IMAGE_ENHANCE_SIZE;
  let rawUploadedImages = [];
  if (isMotion) {
    rawUploadedImages = [
      ...(req.files?.images || []),
      ...(req.files?.image || []),
    ];
  } else if (isFusion) {
    rawUploadedImages = [
      ...(req.files?.image || []),
      ...(req.files?.wedding_image || []),
      ...(req.files?.images || []),
    ];
  } else if (isFreeTextImage) {
    rawUploadedImages = [];
  } else if (isFreeImageToImage) {
    rawUploadedImages = [
      ...(req.files?.image || []),
      ...(req.files?.reference_images || []),
      ...(req.files?.images || []),
    ];
  } else if (isPartialEdit) {
    rawUploadedImages = [
      ...(req.files?.image || []),
      ...(req.files?.edit_references || []),
      ...(req.files?.reference_images || []),
      ...(req.files?.images || []),
    ];
  } else {
    rawUploadedImages = [
      ...(req.files?.image || []),
      ...(req.files?.images || []),
    ];
  }
  const primaryFile = rawUploadedImages[0] || null;
  if (isFreeImageToImage && !primaryFile) {
    res.status(400).json({ error: '请先上传图生图参考图' });
    return;
  }
  if (!primaryFile && !isFreeTextImage) {
    res.status(400).json({ error: '请上传婚礼现场照片或设计图' });
    return;
  }
  if (isFreeImage && !freeImagePrompt) {
    res.status(400).json({ error: '请输入中文图像描述' });
    return;
  }
  if (isImageEnhanceMode(mode) && !IMAGE_ENHANCE_AVAILABLE) {
    res.status(503).json({
      error: IMAGE_ENHANCE_UNAVAILABLE_MESSAGE,
      imageEnhanceAvailable: false,
    });
    return;
  }
  if (isPartialEdit && !editInstruction) {
    res.status(400).json({ error: '请输入局部改图指令' });
    return;
  }
  if (isFusion && rawUploadedImages.length < 2) {
    res.status(400).json({ error: '请同时上传空地照片和婚礼素材图' });
    return;
  }

  const uploadedImages = rawUploadedImages.slice(0, imageReferenceLimitForJob({ mode }));
  if (isMotion) {
    const effectiveMotionModel = motionVideoModelForReferenceCount(MOTION_VIDEO_REQUEST_MODEL, uploadedImages.length);
    const minReferenceCount = motionMinimumReferenceCountForModel(effectiveMotionModel);
    if (uploadedImages.length < minReferenceCount) {
      res.status(400).json({
        error: `当前视频模型需要上传 ${minReferenceCount} 张参考图`,
        minReferenceCount,
        referenceLimit: motionReferenceLimitForModel(effectiveMotionModel),
      });
      return;
    }
  }
  const baseCost = pointCostForMode(mode);
  const modeQuantity = isFreeImage ? freeImageCount : 1;
  const pointCost = ACCOUNT_SYSTEM_ENABLED ? Math.max(0, baseCost) : 0;
  const totalPointCost = ACCOUNT_SYSTEM_ENABLED ? Math.max(0, baseCost * modeQuantity) : 0;
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
    editInstruction,
    editMaskFile,
    userInstruction,
    setupBrandName,
    imageEnhanceSize,
    freeImagePrompt,
    freeImageSize,
    freeImageQuality,
    freeImageFormat,
    freeImageCount,
    files: uploadedImages,
    tenantId: jobTenantId,
    tenantSlug: jobTenantSlug,
  });
  if (userInstruction) {
    job.logs.push(`[input] 已收到补充说明：${userInstruction.slice(0, 120)}`);
  }
  if (isImageEnhanceMode(mode)) {
    job.logs.push(`[input] 画质升级输出规格：${job.imageEnhanceSize}`);
  }
  if (totalPointCost > 0) {
    try {
      const noteSuffix = isMotion && job.motionStyle ? ` · ${MOTION_STYLES[job.motionStyle]?.label || job.motionStyle}` : '';
      chargedUser = await chargeJobPoints(job, req.user.id, totalPointCost, `生成：${MODE_LABELS[mode]}${noteSuffix}`);
    } catch (error) {
      jobs.delete(job.id);
      res.status(error.status || 402).json({
        error: error.message || '点数不足，请联系管理员充值',
        balance: error.balance ?? req.user?.points ?? 0,
        pointCost: totalPointCost,
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
    pointCost: totalPointCost,
  });
  processJob(job);
});

app.post('/api/motion-prompt-preview', rateLimit(GENERATE_IP_RATE, {
  limit: GENERATE_IP_LIMIT,
  windowMs: GENERATE_IP_WINDOW_MS,
  message: '提示词预览请求过于频繁，请稍后再试',
}), requireAccess, upload.fields([
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
  const result = localizePublicResultUrls(job.result);
  if (result && typeof result === 'object' && !result.jobId) result.jobId = job.id;
  res.json({
    id: job.id,
    mode: job.mode,
    status: job.status,
    progress: job.progress,
    stage: publicJobStage(job),
    logs: publicJobLogs(job),
    partialImages: job.partialImages || [],
    result,
    error: publicJobError(job),
    canResume: getResumeInfo(job).canResume,
    retryable: isTransientJobError(job.error || ''),
    canCancel: job.status === 'queued' || job.status === 'running',
    user: publicUser(req.user),
  });
});

app.post('/api/jobs/:id/doubao-video-prompt', requireAccess, requireMotionFeatureAccess, async (req, res) => {
  const jobId = path.basename(String(req.params.id || '').trim());
  if (!jobId) {
    res.status(400).json({ error: '任务参数不完整' });
    return;
  }

  try {
    const [job, resources] = await Promise.all([
      knownJobForAccess(jobId),
      readResourceManifest(),
    ]);
    const resourceIndex = resources.findIndex((item) => item.jobId === jobId && item.mode === 'cinematic_storyboard');
    const manifestResource = resourceIndex >= 0 ? resources[resourceIndex] : null;

    if (!job && !manifestResource) {
      res.status(404).json({ error: '任务不存在或资源已过期，请重新生成电影分镜图' });
      return;
    }
    if (ACCOUNT_SYSTEM_ENABLED && job && !canSeeOwnedItem(req, job)) {
      res.status(404).json({ error: '任务不存在' });
      return;
    }
    if (manifestResource && !requireOwner(req, res, manifestResource)) return;

    const mode = job?.mode || manifestResource?.mode || job?.result?.mode || '';
    if (mode !== 'cinematic_storyboard') {
      res.status(400).json({ error: '只有电影分镜图支持重新生成专属提示词' });
      return;
    }
    if (job?.status && job.status !== 'completed') {
      res.status(409).json({ error: '电影分镜图还没有生成完成，暂时不能重新生成提示词' });
      return;
    }

    const sourceResource = manifestResource || job?.result?.resource || null;
    const images = doubaoPromptImages(
      sourceResource?.images?.length
        ? sourceResource.images
        : (job?.result?.images?.length ? job.result.images : job?.partialImages || []),
    );
    if (!images.length) {
      res.status(400).json({ error: '没有找到可用于识图的 6 张分镜图，无法重新生成提示词' });
      return;
    }

    const promptJob = job || {
      id: jobId,
      mode: 'cinematic_storyboard',
      ownerId: sourceResource?.ownerId || '',
      tenantId: sourceResource?.tenantId || '',
      logs: [],
    };
    if (!Array.isArray(promptJob.logs)) promptJob.logs = [];
    promptJob.logs.push('[doubao-prompt] 正在根据已生成分镜图重新生成专属视频提示词');

    const outputDir = resolveDoubaoPromptOutputDir(jobId, sourceResource, images);
    const doubaoVideoPrompt = await generateDoubaoStoryboardVideoPrompt(promptJob, images, outputDir);
    if (!doubaoVideoPrompt) {
      if (job) queueJobLedgerSnapshot(job);
      res.status(502).json({
        error: '专属提示词生成失败，未写入兜底提示词，请稍后再点重新生成',
        logs: publicJobLogs(promptJob),
        user: publicUser(req.user),
      });
      return;
    }

    const promptFilename = 'doubao-video-prompt.txt';
    let publicResource = null;
    if (sourceResource?.id) {
      const resourceDir = path.join(RESOURCES_DIR, sourceResource.id);
      await mkdir(resourceDir, { recursive: true });
      await writeFile(path.join(resourceDir, promptFilename), `${doubaoVideoPrompt}\n`, 'utf8');
    }
    if (resourceIndex >= 0) {
      const updatedResource = {
        ...resources[resourceIndex],
        doubaoVideoPromptFilename: promptFilename,
        doubaoVideoPrompt,
      };
      resources[resourceIndex] = updatedResource;
      await writeResourceManifest(resources);
      publicResource = withResourceUrls(updatedResource);
    } else if (sourceResource?.id) {
      publicResource = withResourceUrls({
        ...sourceResource,
        doubaoVideoPromptFilename: promptFilename,
        doubaoVideoPrompt,
      });
    }

    const generatedDir = path.join(GENERATED_DIR, jobId);
    await mkdir(generatedDir, { recursive: true });
    await writeFile(path.join(generatedDir, promptFilename), `${doubaoVideoPrompt}\n`, 'utf8');

    if (job) {
      if (!Array.isArray(job.logs)) job.logs = promptJob.logs;
      if (job.result) {
        job.result.jobId = job.id;
        job.result.doubaoVideoPrompt = doubaoVideoPrompt;
        if (publicResource) job.result.resource = publicResource;
      }
      queueJobLedgerSnapshot(job);
    }

    const result = localizePublicResultUrls(job?.result || null);
    if (result && typeof result === 'object' && !result.jobId) result.jobId = jobId;
    res.json({
      ok: true,
      jobId,
      doubaoVideoPrompt,
      resource: publicResource,
      result,
      logs: publicJobLogs(promptJob),
      user: publicUser(req.user),
    });
  } catch (error) {
    const message = String(error?.message || error || '专属提示词生成失败').replace(/\s+/g, ' ').slice(0, 220);
    res.status(500).json({ error: message, user: publicUser(req.user) });
  }
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
function streamSignedMotionSource(req, res) {
  const verified = verifyMotionSourceToken(req.params.token);
  if (!verified) {
    res.status(403).json({ error: '签名无效或已过期' });
    return;
  }
  const requestedFilename = path.basename(String(req.params.filename || ''));
  if (requestedFilename && requestedFilename !== verified.filename) {
    res.status(404).json({ error: 'filename mismatch' });
    return;
  }
  const filePath = path.join(GENERATED_DIR, verified.jobId, verified.filename || 'motion-source.jpg');
  if (!existsSync(filePath)) {
    res.status(404).json({ error: '源图未就绪' });
    return;
  }
  res.type(path.extname(verified.filename || 'motion-source.jpg') || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${path.basename(verified.filename || 'motion-source.jpg').replace(/"/g, '')}"`);
  res.setHeader('Content-Length', statSync(filePath).size);
  res.setHeader('Cache-Control', 'public, max-age=300');
  createReadStream(filePath).pipe(res);
}

app.get('/api/motion/source/:token/:filename', streamSignedMotionSource);
app.get('/api/motion/source/:token', streamSignedMotionSource);

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

app.get('/my-resources/:id/:filename', async (req, res, next) => {
  if (!wantsDocumentResponse(req)) {
    next();
    return;
  }
  const resourceId = path.basename(req.params.id || '');
  if (!resourceId) {
    next();
    return;
  }
  let resource = null;
  try {
    const resources = await readResourceManifest();
    resource = resources.find((item) => item.id === resourceId) || null;
  } catch {
    // Redirect with the resource id we have; the app will show its normal empty/not-found state.
  }
  res.redirect(302, resourceLibrarySharePath(resourceId, resource));
}, requireAccess, async (req, res) => {
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

app.get('/tenant-assets/:tenantId/:filename', (req, res) => {
  const tenantId = safeTenantAssetId(req.params.tenantId || '');
  const filename = path.basename(String(req.params.filename || ''));
  if (!tenantId || !filename || !/^wechat-[a-z0-9]+\.png$/i.test(filename)) {
    res.status(404).json({ error: '图片不存在' });
    return;
  }
  const filePath = path.join(TENANT_ASSETS_DIR, tenantId, filename);
  if (!existsSync(filePath)) {
    res.status(404).json({ error: '图片不存在' });
    return;
  }
  streamInlineFile(res, filePath, filename);
});

app.use((err, _req, res, next) => {
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    res.status(413).json({ error: '上传内容过大，请压缩图片、减少参考图数量后再试。' });
    return;
  }
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: '请求内容格式不正确，请刷新页面后重试。' });
    return;
  }
  if (err instanceof multer.MulterError) {
    const messages = {
      LIMIT_FILE_SIZE: '上传文件过大，请压缩后再试',
      LIMIT_FILE_COUNT: '上传图片数量过多',
      LIMIT_FIELD_COUNT: '提交字段过多',
      LIMIT_PART_COUNT: '提交内容过多',
      LIMIT_FIELD_KEY: '字段名过长',
      LIMIT_FIELD_VALUE: '字段内容过长',
      LIMIT_UNEXPECTED_FILE: '上传字段不符合要求',
    };
    res.status(400).json({ error: messages[err.code] || '上传内容不符合要求' });
    return;
  }
  if (/Unsupported video upload type/i.test(String(err?.message || ''))) {
    res.status(400).json({ error: '请上传 MP4、MOV、WebM、M4V 或 AVI 视频' });
    return;
  }
  if (/Unsupported audio upload type/i.test(String(err?.message || ''))) {
    res.status(400).json({ error: '请上传 MP3、WAV、M4A、AAC、OGG 或 FLAC 音频' });
    return;
  }
  if (/Unsupported upload type/i.test(String(err?.message || ''))) {
    res.status(400).json({ error: '请上传 JPG、PNG、WebP、HEIC 或 HEIF 图片' });
    return;
  }
  next(err);
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

app.get('/super-custom-admin', (_req, res) => {
  res.sendFile(path.join(STATIC_ROOT, 'super-custom-admin.html'));
});

app.get('/tenant-admin', (_req, res) => {
  res.sendFile(path.join(STATIC_ROOT, 'tenant-admin.html'));
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

setInterval(() => {
  cleanupSavedResources('interval').catch((error) => {
    console.warn(`[resources] interval cleanup failed: ${error.message}`);
  });
}, RESOURCE_CLEANUP_INTERVAL_MS).unref();

await mkdir(GENERATED_DIR, { recursive: true });
await mkdir(RESOURCES_DIR, { recursive: true });
await mkdir(TENANT_ASSETS_DIR, { recursive: true });
try {
  await reconcileAbandonedJobCharges('startup');
  await reconcileLegacyMotionRefunds('startup');
  if (RESOURCE_CLEANUP_ON_STARTUP) await cleanupSavedResources('startup');
} catch (error) {
  console.warn(`[jobs] startup reconciliation failed: ${error.message}`);
}
app.listen(PORT, () => {
  console.log(`WedScene AI server running at http://127.0.0.1:${PORT}`);
  if (USE_XIAOJI) {
    console.log(`Image API: xiaoji ${XIAOJI_IMAGE_MODEL}`);
    if (XIAOJI_IMAGE_MODELS.length > 1) console.log(`Image fallback models: ${XIAOJI_IMAGE_MODELS.join(', ')}`);
  } else if (USE_OPENAI_COMPAT) {
    console.log(`Image API: ${OPENAI_PROVIDER_LABEL} ${OPENAI_MODEL}${OPENAI_BASE_URL ? ` via ${OPENAI_BASE_URL}` : ''}`);
    if (OPENAI_IMAGE_MODELS.length > 1) console.log(`Image fallback models: ${OPENAI_IMAGE_MODELS.join(', ')}`);
    if (USE_N1N) console.log(`n1n image input mode: ${N1N_IMAGE_INPUT_MODE} (edit=${N1N_IMAGE_EDIT_ENDPOINT}, generations=${N1N_IMAGE_GENERATIONS_ENDPOINT})`);
  } else {
    console.log('Image API: mock mode (set IMAGE_PROVIDER=n1n and OPENAI_API_KEY for real generation)');
  }
console.log(USE_COPY_API ? `Copy API: ${COPY_MODEL} via ${COPY_API_ENDPOINT}` : 'Copy API: local fallback');
console.log(USE_COPY_API ? `Motion Director API: ${MOTION_DIRECTOR_MODEL} via ${COPY_API_ENDPOINT}` : 'Motion Director API: local fallback');
console.log(USE_COPY_API ? `Doubao Video Prompt API: ${DOUBAO_VIDEO_PROMPT_MODEL} via ${COPY_API_ENDPOINT}` : 'Doubao Video Prompt API: local fallback');
  if (USE_MOCK_MOTION_VIDEO) {
    const reason = FORCE_MOCK_MOTION ? 'MOTION_VIDEO_FORCE_MOCK=true' : (!HAS_MOTION_VIDEO_KEY ? '未配置视频 API Key' : (USE_MOCK_IMAGES ? 'USE_MOCK_IMAGES=true' : '未配置 PUBLIC_BASE_URL'));
    console.log(`Motion Video: mock mode（${reason}），将使用 assets/motion-demo.mp4 占位`);
  } else {
    const modelNote = MOTION_VIDEO_REQUEST_MODEL === MOTION_VIDEO_MODEL ? MOTION_VIDEO_MODEL : `${MOTION_VIDEO_MODEL} -> ${MOTION_VIDEO_REQUEST_MODEL}`;
    console.log(`Motion Video: ${modelNote} via ${MOTION_VIDEO_ENDPOINT}（PUBLIC_BASE_URL=${currentPublicBaseUrl()}）`);
  }
  if (MOTION_WATERMARK_REMOVE) {
    console.log(`Watermark Remove: enabled · ffmpeg=${FFMPEG_BIN} · box=${MOTION_WATERMARK_BOX}`);
  } else {
    console.log('Watermark Remove: disabled (MOTION_WATERMARK_REMOVE=false)');
  }
});

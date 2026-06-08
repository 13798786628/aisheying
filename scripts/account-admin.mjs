import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHmac, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, '.data');
const usersFile = path.join(dataDir, 'users.json');

function loadLocalEnv() {
  const envPath = path.join(root, '.env');
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

const openaiKey = process.env.OPENAI_API_KEY || process.env.N1N_API_KEY || '';
const xiaojiKey = process.env.XIAOJI_API_KEY || process.env.IMAGE_API_KEY || '';
const accountSecret = process.env.ACCOUNT_TOKEN_SECRET
  || process.env.ACCESS_TOKEN_SECRET
  || openaiKey
  || xiaojiKey
  || 'wedscene-local-access';
const trialPoints = Number(process.env.TRIAL_POINTS || 3);

function normalizeLogin(login) {
  return String(login || '').trim().toLowerCase();
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(5).toString('hex')}`;
}

function hashLoginCode(login, code) {
  return createHmac('sha256', accountSecret)
    .update(`wedscene-login-code:${normalizeLogin(login)}:${String(code || '')}`)
    .digest('hex');
}

function publicUser(user) {
  return {
    login: user.login,
    name: user.name,
    points: user.points,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function readStore() {
  try {
    const payload = JSON.parse(await readFile(usersFile, 'utf8'));
    return {
      users: Array.isArray(payload.users) ? payload.users : [],
      ledger: Array.isArray(payload.ledger) ? payload.ledger : [],
    };
  } catch {
    return { users: [], ledger: [] };
  }
}

async function writeStore(store) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(usersFile, JSON.stringify(store, null, 2), 'utf8');
}

function usage() {
  console.log([
    'Usage:',
    '  node scripts/account-admin.mjs list',
    '  node scripts/account-admin.mjs create <login> [name] [points] [loginCode]',
    '  node scripts/account-admin.mjs recharge <login> <points> [note]',
    '',
    'Examples:',
    '  node scripts/account-admin.mjs create 13800138000 张三 3 246810',
    '  node scripts/account-admin.mjs recharge 13800138000 20 99元套餐',
  ].join('\n'));
}

const [command, ...args] = process.argv.slice(2);
const store = await readStore();

if (command === 'list') {
  console.table(store.users.map(publicUser));
  process.exit(0);
}

if (command === 'create') {
  const [rawLogin, rawName, rawPoints, rawCode] = args;
  const login = normalizeLogin(rawLogin);
  if (!login) {
    usage();
    process.exit(1);
  }
  const now = new Date().toISOString();
  const loginCode = rawCode || randomBytes(4).toString('hex');
  const points = Number.isFinite(Number(rawPoints)) ? Number(rawPoints) : trialPoints;
  let user = store.users.find((item) => item.login === login);
  const created = !user;
  if (!user) {
    user = {
      id: newId('user'),
      login,
      points: 0,
      status: 'active',
      createdAt: now,
      sessionVersion: 1,
    };
    store.users.unshift(user);
  }
  user.name = rawName || user.name || login;
  user.points = created ? Math.max(0, points) : user.points;
  user.codeHash = hashLoginCode(login, loginCode);
  user.updatedAt = now;
  if (created) {
    store.ledger.unshift({
      id: newId('ledger'),
      userId: user.id,
      login,
      type: 'trial',
      points: user.points,
      balanceAfter: user.points,
      note: '新账号试用点数',
      jobId: '',
      createdAt: now,
    });
  }
  await writeStore(store);
  console.log(JSON.stringify({ ok: true, created, account: publicUser(user), loginCode }, null, 2));
  process.exit(0);
}

if (command === 'recharge') {
  const [rawLogin, rawPoints, ...noteParts] = args;
  const login = normalizeLogin(rawLogin);
  const points = Number(rawPoints);
  if (!login || !Number.isFinite(points) || points === 0) {
    usage();
    process.exit(1);
  }
  const user = store.users.find((item) => item.login === login && item.status !== 'disabled');
  if (!user) {
    console.error(`账号不存在：${login}`);
    process.exit(1);
  }
  const now = new Date().toISOString();
  user.points = Number(user.points || 0) + points;
  if (user.points < 0) {
    console.error('扣减后点数不能小于 0');
    process.exit(1);
  }
  user.updatedAt = now;
  const entry = {
    id: newId('ledger'),
    userId: user.id,
    login,
    type: 'manual_recharge',
    points,
    balanceAfter: user.points,
    note: noteParts.join(' ') || '管理员手动充值',
    jobId: '',
    createdAt: now,
  };
  store.ledger.unshift(entry);
  await writeStore(store);
  console.log(JSON.stringify({ ok: true, account: publicUser(user), ledger: entry }, null, 2));
  process.exit(0);
}

usage();
process.exit(1);

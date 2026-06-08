import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const warnings = [];

const ignoredDirs = new Set(['.git', 'node_modules', 'dist', '.data', '.cache', '.claude', 'deploy', 'output']);
const ignoredFiles = new Set([
  '.env',
  'WedSceneAI-2026.pdf',
  '婚礼商家的 AI内容获客工具.pdf',
  '完整操作指南.md',
  '工具任务执行完成-Final.md',
  '立即开始部署.md',
  '给Codex的部署指令.md',
  '轻量云服务器部署指南.md',
]);
const ignoredExts = new Set(['.zip', '.log', '.gz']);
const ignoredPathPatterns = [
  /^assets\/demo\/.+\.(jpg|png|mp4)$/i,
];
const allowedLargeFiles = new Set([
  'assets/motion-demo.mp4',
  'assets/motion-demo-showcase.mp4',
]);

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(path.join(root, file), 'utf8'));
  } catch (error) {
    fail(`${file} is missing or invalid JSON: ${error.message}`);
    return null;
  }
}

async function walk(dir, files = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(root, fullPath).replace(/\\/g, '/');
    if (ignoredPathPatterns.some((pattern) => pattern.test(relativePath))) continue;
    if (entry.isDirectory()) {
      await walk(fullPath, files);
      continue;
    }
    if (ignoredFiles.has(entry.name)) continue;
    if (ignoredExts.has(path.extname(entry.name).toLowerCase())) continue;
    files.push(relativePath);
  }
  return files;
}

function checkGitignore(content) {
  for (const rule of ['.env', '.data/', 'node_modules/', 'dist/', 'deploy/', 'output/', '*.log', '*.zip', '*.tar.gz']) {
    if (!content.includes(rule)) fail(`.gitignore should include ${rule}`);
  }
  if (/^assets\/motion-demo-\*\.mp4$/m.test(content)) {
    fail('.gitignore must not ignore assets/motion-demo-showcase.mp4; use assets/motion-demo-[0-9]*.mp4 for old variants');
  }
}

function checkEnvExample(content) {
  const forbidden = [
    /sk-[A-Za-z0-9_-]{12,}/,
    /OPENAI_API_KEY\s*=\s*(?!replace_|your_|$)[^\s#]+/i,
    /N1N_API_KEY\s*=\s*(?!replace_|your_|$)[^\s#]+/i,
    /XIAOJI_API_KEY\s*=\s*(?!replace_|your_|$)[^\s#]+/i,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(content)) fail('.env.example appears to contain a real secret');
  }
  if (/^(?:HTTPS_PROXY|HTTP_PROXY)=http:\/\/127\.0\.0\.1/m.test(content)) {
    fail('.env.example should not enable a local proxy by default');
  }
}

async function checkSourceSecrets(files) {
  const secretPatterns = [
    /sk-[A-Za-z0-9_-]{12,}/,
    /(?:OPENAI|N1N|XIAOJI|API)_?(?:API_)?KEY\s*[:=]\s*['"][^'"]{12,}['"]/i,
  ];

  for (const file of files) {
    if (!/\.(js|mjs|html|md|json|yml|yaml|toml|env\.example)$/i.test(file)) continue;
    const content = await readFile(path.join(root, file), 'utf8');
    for (const pattern of secretPatterns) {
      if (pattern.test(content)) fail(`Possible secret in ${file}`);
    }
  }
}

async function checkLargeFiles(files) {
  for (const file of files) {
    if (allowedLargeFiles.has(file)) continue;
    const info = await stat(path.join(root, file));
    if (info.size > 5 * 1024 * 1024) warn(`Large file outside ignored dirs: ${file} (${Math.round(info.size / 1024 / 1024)} MB)`);
  }
}

function checkLocalEnv() {
  if (!existsSync(path.join(root, '.env'))) {
    warn('.env is missing locally; production will need real API keys on the server');
  }
}

const packageJson = await readJson('package.json');
if (packageJson) {
  for (const script of ['build', 'start', 'start:prod']) {
    if (!packageJson.scripts?.[script]) fail(`package.json missing script: ${script}`);
  }
}

for (const file of ['README.md', '.env.example', '.gitignore', 'docs/LAUNCH_PLAN.md', 'docs/TENCENT_CLOUD_DEPLOY.md', 'assets/motion-demo.mp4', 'assets/motion-demo-showcase.mp4']) {
  if (!existsSync(path.join(root, file))) fail(`Missing required file: ${file}`);
}

if (existsSync(path.join(root, '.gitignore'))) {
  checkGitignore(await readFile(path.join(root, '.gitignore'), 'utf8'));
}

if (existsSync(path.join(root, '.env.example'))) {
  checkEnvExample(await readFile(path.join(root, '.env.example'), 'utf8'));
}

checkLocalEnv();

const files = await walk(root);
await checkSourceSecrets(files);
await checkLargeFiles(files);

if (warnings.length) {
  console.log('Warnings:');
  for (const message of warnings) console.log(`- ${message}`);
}

if (failures.length) {
  console.error('Preflight failed:');
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}

console.log('Preflight passed.');

import { chmod, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const deployRoot = path.join(root, 'deploy');
const packageDir = path.join(deployRoot, 'wedscene-ai-server');

async function copy(from, to = from) {
  await cp(path.join(root, from), path.join(packageDir, to), {
    recursive: true,
    force: true,
  });
}

const setupScript = `#!/usr/bin/env bash
set -euo pipefail

APP_DIR="\${APP_DIR:-/opt/wedscene-ai}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Please run as root: sudo bash setup-server.sh"
  exit 1
fi

cd "$APP_DIR"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created $APP_DIR/.env from .env.example."
  echo "Edit it with real production values, then rerun: sudo bash setup-server.sh"
  exit 2
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y curl ca-certificates nginx unzip fontconfig fonts-noto-cjk

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)"
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

npm ci --omit=dev --ignore-scripts --registry=https://registry.npmmirror.com

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2 --registry=https://registry.npmmirror.com
fi

mkdir -p .data/generated .data/resources

cat >/etc/nginx/sites-available/wedscene-ai <<'NGINX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 30m;
    proxy_read_timeout 900s;
    proxy_send_timeout 900s;
    proxy_connect_timeout 60s;

    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/wedscene-ai /etc/nginx/sites-enabled/wedscene-ai
nginx -t
systemctl enable --now nginx
systemctl reload nginx

pm2 delete wedscene-ai >/dev/null 2>&1 || true
pm2 start npm --name wedscene-ai -- run start:prod
pm2 save
pm2 startup systemd -u root --hp /root >/tmp/wedscene-pm2-startup.txt || true

pm2 status
`;

await rm(packageDir, { recursive: true, force: true });
await mkdir(packageDir, { recursive: true });

await copy('server.mjs');
await copy('package.json');
await copy('package-lock.json');
await copy('.env.example');
await copy('dist');
const deployApiBaseUrl = process.env.DEPLOY_API_BASE_URL ?? '';
const siteConfigPath = path.join(packageDir, 'dist', 'site-config.js');
const siteConfig = await readFile(siteConfigPath, 'utf8');
await writeFile(
  siteConfigPath,
  siteConfig.replace(/apiBaseUrl:\s*'[^']*'/, `apiBaseUrl: '${deployApiBaseUrl.replace(/'/g, "\\'")}'`),
  'utf8',
);
await copy('lib');
await mkdir(path.join(packageDir, 'scripts'), { recursive: true });
await copy('scripts/account-admin.mjs');
await mkdir(path.join(packageDir, 'assets'), { recursive: true });
await copy('assets/motion-demo.mp4');
await copy('assets/fonts');

await writeFile(path.join(packageDir, 'setup-server.sh'), setupScript, 'utf8');
await chmod(path.join(packageDir, 'setup-server.sh'), 0o755);

let totalBytes = 0;
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full);
    } else {
      totalBytes += (await stat(full)).size;
    }
  }
}

await walk(packageDir);

console.log(`deploy package ready: ${path.relative(root, packageDir).replace(/\\\\/g, '/')}`);
console.log(`size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);

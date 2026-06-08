import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const files = [
  'index.html',
  'site-config.js',
  'app.js',
  'admin.html',
  'login.html',
  'terms.html',
  'privacy.html',
  'robots.txt',
  '_headers',
  'assets/styles.css',
  'assets/wechat-qr.png',
  'assets/wechat-qr-clean.png',
  'assets/wechat-qr-ZzuninzZ.jpg',
  'assets/wechat-qr-ZzuninzZ-clean.png',
  'assets/motion-demo.mp4',
  'assets/motion-demo-showcase.mp4',
  'assets/demo/upload-bg.webp',
  'assets/demo/product-showcase.webp',
  'assets/demo/product-core-bg.webp',
];

await rm(dist, { recursive: true, force: true });

let totalBytes = 0;
for (const file of files) {
  const from = join(root, file);
  const to = join(dist, file);
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
  totalBytes += (await stat(to)).size;
}

const mb = (totalBytes / 1024 / 1024).toFixed(2);
console.log(`dist ready: ${files.length} files, ${mb} MB`);

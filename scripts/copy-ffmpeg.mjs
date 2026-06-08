// 一次性脚本：把系统里现成的 ffmpeg.exe 复制到项目本地 tools/ffmpeg.exe
// 用 Node 来做是为了避免 PowerShell 5 在中文路径上的编码坑。
import { existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const candidates = [
  'D:\\电脑管家迁移文件\\JianyingPro\\apps\\5.4.0.11246\\ffmpeg.exe',
  'D:\\小鸡AI\\小红书克隆\\data\\ffmpeg.exe',
  'D:\\小鸡AI\\抖音克隆\\data\\ffmpeg.exe',
  'C:\\Program Files (x86)\\Lenovo\\LegionZone\\2.0.24.5141\\SEGamingAI\\services\\editor\\ffmpeg.exe',
];

const found = candidates.find((p) => existsSync(p));
if (!found) {
  console.error('[copy-ffmpeg] 没找到任何已知的 ffmpeg.exe，请手动指定');
  process.exit(1);
}
console.log(`[copy-ffmpeg] 源文件：${found}`);
console.log(`[copy-ffmpeg] 大小：${(statSync(found).size / 1024 / 1024).toFixed(2)} MB`);

const dest = path.join(projectRoot, 'tools', 'ffmpeg.exe');
mkdirSync(path.dirname(dest), { recursive: true });
copyFileSync(found, dest);
console.log(`[copy-ffmpeg] 已复制到：${dest}`);
console.log('[copy-ffmpeg] 完成');

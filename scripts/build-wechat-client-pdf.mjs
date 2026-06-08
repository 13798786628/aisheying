import fs from 'node:fs/promises';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const outDir = path.join(root, 'dist');
const previewDir = path.join(outDir, 'wechat-client-pdf-preview');
const htmlPath = path.join(outDir, 'WedSceneAI-2026.html');
const pdfPath = path.join(outDir, 'WedSceneAI-2026.pdf');
const workspacePdfPath = path.join(root, 'WedSceneAI-2026.pdf');
const desktopPdfPath = 'C:\\Users\\22591\\Desktop\\WedSceneAI-2026.pdf';
const bundledNodeModules = 'C:\\Users\\22591\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules';
const bundledPnpmNodeModules = path.join(bundledNodeModules, '.pnpm', 'node_modules');

process.env.NODE_PATH = [bundledNodeModules, bundledPnpmNodeModules, process.env.NODE_PATH]
  .filter(Boolean)
  .join(path.delimiter);
Module._initPaths();

const localRequire = createRequire(import.meta.url);
const bundledRequire = createRequire(path.join(bundledNodeModules, '_codex_require_probe.js'));
const requirePackage = (name) => {
  try {
    return localRequire(name);
  } catch {
    return bundledRequire(name);
  }
};

const { chromium } = requirePackage('playwright');
const { PDFDocument } = requirePackage('pdf-lib');

const fileUrl = (relativePath) => pathToFileURL(path.join(root, relativePath)).href;
const imagePaths = {
  videoFrame1: 'assets/client-pdf/video-frame-1.jpg',
  videoFrame2: 'assets/client-pdf/video-frame-2.jpg',
  videoFrame3: 'assets/client-pdf/video-frame-3.jpg',
  videoPage: 'assets/client-pdf/app-video-page.png',
  videoGenerator: 'assets/client-pdf/app-video-generator.png',
  similarFlow: 'assets/client-pdf/app-similar-flow.png',
  similarResult: 'assets/client-pdf/app-similar-result-tight.png',
  storyboardResult: 'assets/client-pdf/app-storyboard-result-tight.png',
  storyboardShot: 'assets/client-pdf/storyboard-shot-1.jpg',
  storyboardDetail: 'assets/client-pdf/storyboard-shot-4.jpg',
  designResult: 'assets/client-pdf/app-design-result-tight.png',
  beforeResult: 'assets/client-pdf/app-before-result-tight.png',
  resourcePage: 'screenshots/resource-pagination-grid.png',
  renderScene: 'assets/client-pdf/app-render-scene-flow.png',
  venueFusionFlow: 'assets/client-pdf/app-venue-fusion-flow.png',
  venueFusionResult: 'assets/client-pdf/app-venue-fusion-result.png',
  websiteQr: 'assets/client-pdf/website-qr.png',
};

const img = Object.fromEntries(Object.entries(imagePaths).map(([key, value]) => [key, fileUrl(value)]));

const firstExisting = async (paths) => {
  for (const candidate of paths) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Keep looking.
    }
  }
  return undefined;
};

const assertAssets = async () => {
  const missing = [];
  for (const [name, relativePath] of Object.entries(imagePaths)) {
    try {
      await fs.access(path.join(root, relativePath));
    } catch {
      missing.push(`${name}: ${relativePath}`);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing PDF image assets:\n${missing.join('\n')}`);
  }
};

const topbar = (label = '婚礼商家 AI 内容获客工具') => `
  <div class="topbar">
    <div class="brand"><span class="brand-mark">W</span><span>WedScene AI</span></div>
    <span class="pill">${label}</span>
  </div>
`;

const footer = (label, page, total = 7) => `
  <div class="footer"><span>${label}</span><span>${String(page).padStart(2, '0')} / ${String(total).padStart(2, '0')}</span></div>
`;

const featureCard = (num, title, copy, extraClass = '') => `
  <div class="cap ${extraClass}">
    <b>${num}</b>
    <h3>${title}</h3>
    <p>${copy}</p>
  </div>
`;

const metric = (value, label) => `
  <div class="metric"><strong>${value}</strong><span>${label}</span></div>
`;

const bullet = (items) => `
  <ul class="use-list">
    ${items.map((item) => `<li>${item}</li>`).join('')}
  </ul>
`;

const pages = [
`<section class="sheet cover">
  <div class="pad">
    ${topbar('图文 / 视频 / 实景融合 / 资源库')}
    <div class="cover-copy">
      <div class="kicker">2026 AI CONTENT GROWTH</div>
      <h1>2026 婚礼商家的 AI 内容获客工具</h1>
      <p class="subtitle">把一场婚礼现场照，变成可发布、可转发、可给新人看的图文素材、实景候选图、场地融合图和 4K 空景运镜短片。</p>
    </div>

    <div class="hero-grid">
      <div class="hero-card dark">
        <h2>覆盖婚礼商家从提案到发布的高频内容能力</h2>
        <p>效果图转实景适合把设计方案变成真实落地候选图；空地婚礼融合图适合把一张空场图和一张婚礼素材合成到同一个场地里。</p>
        <div class="tag-row">
          <span class="tag strong">效果图转实景</span>
          <span class="tag strong">空地婚礼融合图</span>
          <span class="tag">小红书爆款图文</span>
          <span class="tag">4K 视频素材</span>
        </div>
      </div>
      <div class="cover-stack">
        <img src="${img.renderScene}" alt="效果图转实景界面" />
        <img src="${img.venueFusionResult}" alt="空地婚礼融合结果" />
      </div>
    </div>

    <div class="flow">
      <div><b>STEP 01</b><strong>上传现场照 / 设计图 / 空场图</strong></div>
      <div><b>STEP 02</b><strong>选择图文、实景、融合或视频方向</strong></div>
      <div><b>STEP 03</b><strong>下载图片、文案或 MP4 成片</strong></div>
      <div><b>STEP 04</b><strong>沉淀到资源库继续复用</strong></div>
    </div>

    <div class="cap-grid">
      ${featureCard('01', '爆款图文发布包', '一张婚礼现场照生成同风格素材、首图、标题正文和话题。')}
      ${featureCard('02', '4K 空景运镜视频', '上传 1-3 张空景图，生成适合展示的短视频素材。')}
      ${featureCard('03', '电影感分镜', '拆出大景、花艺、灯光和通道镜头，用于连续发布。')}
      ${featureCard('04', '对比图工具', '布置前后对比图，让方案沟通更直观。')}
      ${featureCard('05', '效果图转实景', '设计图一次生成 4 张真实落地现场候选图。', 'new')}
      ${featureCard('06', '空地婚礼融合图', '空场图叠加婚礼素材，生成 1 张真实场地融合效果图。', 'new')}
      ${featureCard('07', '标题文案与资源库', '只写文案、保存结果、分类预览，持续积累案例资产。')}
    </div>
  </div>
  ${footer('WedScene AI 产品能力总览', 1)}
</section>`,

`<section class="sheet video-feature">
  <div class="pad">
    ${topbar('AI VIDEO · 4K 连续转场')}
    <div class="page-head">
      <div>
        <div class="kicker">SCENE 01</div>
        <h2>连续转场视频：1-3 张婚礼空景照生成 4K MP4</h2>
      </div>
      <div class="metrics">
        ${metric('4K', '高清成片输出')}
        ${metric('8 秒', '短视频预览时长')}
        ${metric('60', '默认灵感值')}
        ${metric('1-3 张', '按顺序串联镜头')}
      </div>
    </div>

    <div class="video-workspace">
      <div class="panel light">
        <div class="mini-kicker">第一步 · 上传空景照</div>
        <h3>把空景图按镜头顺序放进来</h3>
        <p>适合婚礼堂、宴会厅、布置完成后的空场展示，也适合拍摄团队做案例开场素材。</p>
        <div class="photo-hero">
          <img src="${img.videoFrame1}" alt="连续转场视频第一张空景照" />
          <span>1 开场全景</span>
        </div>
        <div class="mini-shot-row">
          <div><img src="${img.videoFrame1}" alt="开场全景" /><span>开场</span></div>
          <div><img src="${img.videoFrame2}" alt="中段镜头" /><span>中段</span></div>
          <div><img src="${img.videoFrame3}" alt="收尾画面" /><span>收尾</span></div>
        </div>
      </div>

      <div class="panel light">
        <div class="mini-kicker">第二步 · 一键生成</div>
        <h3>生成可播放、可发布、可沉淀的 MP4 成片</h3>
        <p>系统自动串联多张空景，生成适合朋友圈、视频号、小红书和门店屏幕展示的短视频。</p>
        <div class="screen video-ui">
          <img src="${img.videoGenerator}" alt="视频生成界面" />
          <span class="screen-label">视频生成控制台</span>
        </div>
      </div>
    </div>

    <div class="dense-band dark">
      <div><strong>能播放</strong><span>客户看到的是完整 MP4 成片，不只是静态效果图。</span></div>
      <div><strong>能发布</strong><span>适合短视频平台、朋友圈和门店屏幕展示。</span></div>
      <div><strong>能沉淀</strong><span>生成后自动进入资源库，后续还能继续复用。</span></div>
    </div>
  </div>
  ${footer('4K 连续转场视频', 2)}
</section>`,

`<section class="sheet">
  <div class="pad">
    ${topbar()}
    <div class="page-head">
      <div>
        <div class="kicker">SCENE 05</div>
        <h2>小红书爆款图文：一张婚礼图生成一组同风格发布素材</h2>
      </div>
      <p>上传一张婚礼现场图，AI 提取场地、色系、花艺和灯光，生成同风格婚礼参考图，同时整理爆款首图、标题正文和话题。</p>
    </div>

    <div class="screen result-wide">
      <img src="${img.similarResult}" alt="小红书图文发布包结果页" />
      <span class="screen-label">下载爆款首图 + 复制发布文案</span>
    </div>

    <div class="two" style="margin-top:12px;">
      <div class="panel">
        <h3>不是只修原图，而是扩展成一组同风格婚礼参考</h3>
        <p>适合用在小红书案例笔记、朋友圈案例更新、视频号封面和发给新人看的风格参考里。</p>
        <div class="mini-grid">
          <div class="mini"><strong>爆款首图</strong><span>6 张素材拼成发布入口，减少排版时间。</span></div>
          <div class="mini"><strong>标题正文</strong><span>围绕画面元素写成真实案例分享口吻。</span></div>
        </div>
        <div class="button-row">
          <span class="btn-like dark">下载爆款首图</span>
          <span class="btn-like">复制发布文案</span>
          <span class="btn-like ghost">保存单图素材</span>
        </div>
      </div>
      <div class="screen compact">
        <img src="${img.similarFlow}" alt="上传照片并选择生成方向" />
        <span class="screen-label">上传照片 / 选择生成方向</span>
      </div>
    </div>

    <div class="dense-band light">
      <div><strong>标题更像真实笔记</strong><span>围绕颜色、花艺、吊顶、灯光等画面元素写标题。</span></div>
      <div><strong>正文更适合发布</strong><span>少一点空话，多一点现场案例细节。</span></div>
      <div><strong>话题更贴内容平台</strong><span>保留婚礼灵感，也补充具体风格和场景标签。</span></div>
    </div>
  </div>
  ${footer('小红书爆款图文发布包', 6)}
</section>`,

`<section class="sheet new-page">
  <div class="pad">
    ${topbar('新增功能 · 效果图转实景')}
    <div class="page-head">
      <div>
        <div class="kicker">SCENE 02 · NEW</div>
        <h2>效果图转实景：设计图一次生成 4 张真实落地现场候选图</h2>
      </div>
      <p>上传婚礼效果图或设计图，不做对比拼图，直接生成更接近真实拍摄质感的现场候选图，适合提案沟通、客户确认和营销发布。</p>
    </div>

    <div class="screen result-wide render-scene">
      <img src="${img.renderScene}" alt="效果图转实景功能界面和候选图" />
      <span class="screen-label">上传设计图 · 生成 4 张现场候选图</span>
    </div>

    <div class="three feature-points">
      <div class="panel point">
        <span class="new-badge">NEW 05</span>
        <h3>从设计方案到真实氛围</h3>
        <p>把舞台、花艺、灯光和通道从效果图语言转成更像落地现场的视觉表达。</p>
      </div>
      <div class="panel point">
        <span class="new-badge">4 张候选</span>
        <h3>多版本给客户挑选</h3>
        <p>一次生成 4 张真实落地现场候选图，便于比较灯光、材质和空间层次。</p>
      </div>
      <div class="panel point">
        <span class="new-badge">发布友好</span>
        <h3>不只服务内部提案</h3>
        <p>候选图可作为案例预热、风格沟通图、销售朋友圈和小红书素材。</p>
      </div>
    </div>

    <div class="dense-band light">
      <div><strong>给策划</strong><span>让新人更快看懂方案落地后的空间效果。</span></div>
      <div><strong>给花艺搭建</strong><span>提前讨论花材体量、舞台层次和灯光氛围。</span></div>
      <div><strong>给营销发布</strong><span>没有实景图时，也能先拿到可沟通的视觉素材。</span></div>
    </div>
  </div>
  ${footer('新增功能：效果图转实景', 3)}
</section>`,

`<section class="sheet new-page">
  <div class="pad">
    ${topbar('新增功能 · 空地婚礼融合图')}
    <div class="page-head">
      <div>
        <div class="kicker">SCENE 03 · NEW</div>
        <h2>空地婚礼融合图：空场图 + 婚礼素材，真实融合到同一个场地</h2>
      </div>
      <p>上传 1 张空地/空场图和 1 张婚礼素材图，AI 提取花艺、布幔、灯光、舞台和通道风格，把婚礼布置真实融合到目标场地里。</p>
    </div>

    <div class="two visual-pair">
      <div class="screen tall">
        <img src="${img.venueFusionFlow}" alt="空地婚礼融合图上传界面" />
        <span class="screen-label">第一步：上传空地和婚礼素材</span>
      </div>
      <div class="screen tall">
        <img src="${img.venueFusionResult}" alt="空地婚礼融合图结果" />
        <span class="screen-label">生成结果：场地融合效果图</span>
      </div>
    </div>

    <div class="two" style="margin-top:12px;">
      <div class="panel">
        <h3>把“这个场地能不能做成这样”讲清楚</h3>
        <p>适合宴会厅空场、草坪、户外空地、婚礼堂未布置前的沟通场景。新人不用只靠想象，也不用等真实搭建完成后才看效果。</p>
      </div>
      <div class="panel">
        <h3>一张融合图就能进入销售沟通</h3>
        ${bullet([
          '提取婚礼素材里的花艺、布幔、灯光、舞台和通道风格。',
          '保留上传空场的空间结构、吊顶、地毯和舞台方向。',
          '生成后支持下载图片，并自动沉淀到资源库。'
        ])}
      </div>
    </div>
  </div>
  ${footer('新增功能：空地婚礼融合图', 4)}
</section>`,

`<section class="sheet">
  <div class="pad">
    ${topbar()}
    <div class="page-head">
      <div>
        <div class="kicker">SCENE 04</div>
        <h2>电影感分镜：先把一场婚礼拆成可发布镜头</h2>
      </div>
      <p>分镜图适合把大景、通道、花艺、灯光和细节拆出来，作为小红书封面、连续笔记和视频脚本参考。</p>
    </div>

    <div class="screen result-wide">
      <img src="${img.storyboardResult}" alt="电影感分镜结果页" />
      <span class="screen-label">6 张分镜 + 下载发布包</span>
    </div>

    <div class="three">
      <div class="screen compact">
        <img src="${img.storyboardShot}" alt="电影感分镜单张镜头" />
        <span class="screen-label">单张镜头图</span>
      </div>
      <div class="panel">
        <h3>把一场婚礼拆成连续内容</h3>
        ${bullet([
          '大景和主视觉：适合封面和视频开场。',
          '花艺、通道、灯光：适合拆成细节笔记。',
          '道具和桌景：补充案例质感。'
        ])}
        <div class="button-row">
          <span class="btn-like dark">生成分镜</span>
          <span class="btn-like">下载发布包</span>
        </div>
      </div>
      <div class="screen compact">
        <img src="${img.storyboardDetail}" alt="电影感分镜细节镜头" />
        <span class="screen-label">细节镜头图</span>
      </div>
    </div>

    <div class="dense-band dark">
      <div><strong>分镜图</strong><span>一张现场图拆成多张内容图，适合连续发布。</span></div>
      <div><strong>发布包</strong><span>合成首图、单图素材和文案一起下载。</span></div>
      <div><strong>后续复用</strong><span>生成后的镜头自动沉淀，后续可继续做视频或案例图。</span></div>
    </div>
  </div>
  ${footer('电影感分镜', 5)}
</section>`,

`<section class="sheet">
  <div class="pad">
    ${topbar('方案沟通 / 资源沉淀 / 网站入口')}
    <div class="page-head">
      <div>
        <div class="kicker">SCENE 06</div>
        <h2>对比图、只写标题文案、资源库：让方案沟通更直观</h2>
      </div>
      <p>对策划、花艺搭建和婚礼堂来说，客户最关心的是效果怎么落地。对比图展示布置价值，标题文案辅助发布，资源库方便持续保存和调用。</p>
    </div>

    <div class="scene-row">
      <div class="screen short">
        <img src="${img.beforeResult}" alt="布置前后对比图结果页" />
        <span class="screen-label">布置前后对比图</span>
      </div>
    </div>

    <div class="two" style="margin-top:12px;">
      <div class="panel">
        <h3>适合婚礼商家的 4 个实际用途</h3>
        ${bullet([
          '小红书获客：持续输出案例首图、标题和正文。',
          '朋友圈更新：让一场婚礼不只发一次完工图。',
          '新人沟通：用对比图和融合图讲清方案落地效果。',
          '团队沉淀：图片、视频和文案统一进入资源库。'
        ])}
        <div class="button-row">
          <span class="btn-like">下载爆款首图</span>
          <span class="btn-like dark">查看生成结果</span>
          <span class="btn-like ghost">进入资源库</span>
        </div>
      </div>
      <div class="screen short">
        <img src="${img.resourcePage}" alt="资源库页面" />
        <span class="screen-label">资源库保存 / 分类预览</span>
      </div>
    </div>

    <div class="website">
      <div>
        <h3>进入 WedScene AI 网站，查看婚礼商家 AI 内容素材生成流程</h3>
        <p>支持婚礼图文、电影感分镜、类似婚礼、前后对比图、效果图转实景、空地婚礼融合图和空景短视频。</p>
        <div class="chrome-note"><span class="chrome-icon"></span>推荐使用 Google Chrome 浏览器打开</div>
      </div>
      <div class="qr-card">
        <img src="${img.websiteQr}" alt="网站二维码" />
        <span>http://106.53.167.63/</span>
      </div>
    </div>
  </div>
  ${footer('方案沟通与网站入口', 7)}
</section>`,
];

const css = String.raw`
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #ece5df; }
  body {
    font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", Arial, sans-serif;
    color: #171310;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sheet {
    width: 210mm;
    height: 297mm;
    position: relative;
    overflow: hidden;
    background:
      linear-gradient(rgba(126, 72, 52, .035) 1px, transparent 1px),
      linear-gradient(90deg, rgba(126, 72, 52, .03) 1px, transparent 1px),
      #fbf8f4;
    background-size: 22px 22px;
    page-break-after: always;
    break-after: page;
  }
  .sheet:last-child { page-break-after: auto; break-after: auto; }
  .pad { position: relative; z-index: 2; height: 100%; padding: 14mm 15mm 16mm; }
  h1, h2, h3, h4, p { margin: 0; }
  .cover {
    background:
      radial-gradient(circle at 10% 5%, rgba(238, 175, 146, .42), transparent 32%),
      radial-gradient(circle at 95% 14%, rgba(139, 70, 58, .16), transparent 28%),
      linear-gradient(135deg, #fff7f2 0%, #f5ece6 48%, #fbf8f4 100%);
  }
  .new-page {
    background:
      radial-gradient(circle at 86% 8%, rgba(233, 177, 142, .25), transparent 31%),
      linear-gradient(rgba(126, 72, 52, .035) 1px, transparent 1px),
      linear-gradient(90deg, rgba(126, 72, 52, .03) 1px, transparent 1px),
      #fbf8f4;
    background-size: auto, 22px 22px, 22px 22px, auto;
  }
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    color: #6f6259;
    font-size: 12px;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    color: #171310;
    font-weight: 900;
  }
  .brand-mark {
    width: 28px;
    height: 28px;
    border-radius: 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: #161313;
    color: #fff8ef;
    font-weight: 900;
    box-shadow: 0 9px 22px rgba(44, 29, 22, .16);
  }
  .pill {
    display: inline-flex;
    align-items: center;
    min-height: 29px;
    padding: 0 13px;
    border-radius: 999px;
    border: 1px solid rgba(125, 63, 52, .22);
    background: rgba(255,255,255,.72);
    color: #5d4f47;
    font-size: 11px;
    font-weight: 900;
    white-space: nowrap;
  }
  .kicker {
    color: #8d493d;
    font-size: 11px;
    letter-spacing: .16em;
    font-weight: 900;
    text-transform: uppercase;
  }
  .cover-copy { margin-top: 15mm; max-width: 690px; }
  .cover h1 {
    margin-top: 10px;
    max-width: 710px;
    font-size: 43px;
    line-height: 1.1;
    font-weight: 900;
    letter-spacing: 0;
  }
  .subtitle {
    margin-top: 12px;
    max-width: 690px;
    color: #5c514b;
    font-size: 16px;
    line-height: 1.65;
    font-weight: 700;
  }
  .hero-grid {
    display: grid;
    grid-template-columns: 1.05fr .95fr;
    gap: 12px;
    margin-top: 17px;
  }
  .hero-card,
  .panel,
  .cap,
  .screen {
    border-radius: 10px;
    background: #fff;
    border: 1px solid #eaded6;
    box-shadow: 0 12px 28px rgba(44, 29, 22, .07);
  }
  .hero-card { padding: 17px; min-height: 130px; }
  .hero-card.dark {
    background: #1a1714;
    color: #fff;
    border-color: #1a1714;
  }
  .hero-card h2 {
    font-size: 25px;
    line-height: 1.25;
    font-weight: 900;
  }
  .hero-card p {
    margin-top: 10px;
    color: rgba(255,255,255,.72);
    font-size: 12.5px;
    line-height: 1.65;
  }
  .tag-row, .button-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 13px;
  }
  .tag, .btn-like {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 28px;
    padding: 0 11px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 900;
    white-space: nowrap;
  }
  .tag { background: #f3e6dd; color: #634f45; }
  .tag.strong { background: #efb18f; color: #171310; }
  .btn-like { background: #eab18f; color: #1c1410; }
  .btn-like.dark { background: #171310; color: #fff; }
  .btn-like.ghost { background: #fff; color: #5b4d45; border: 1px solid #ded2ca; }
  .cover-stack {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .cover-stack img {
    width: 100%;
    height: 132px;
    object-fit: cover;
    object-position: top center;
    border-radius: 10px;
    border: 1px solid rgba(125, 63, 52, .18);
    box-shadow: 0 12px 24px rgba(44, 29, 22, .08);
  }
  .flow {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 9px;
    margin-top: 13px;
  }
  .flow div {
    border-radius: 9px;
    padding: 11px 10px;
    background: #fff;
    border: 1px solid #eaded6;
    min-height: 70px;
  }
  .flow b {
    display: block;
    color: #8d493d;
    font-size: 12px;
    letter-spacing: .06em;
  }
  .flow strong {
    display: block;
    margin-top: 5px;
    font-size: 14px;
    line-height: 1.35;
  }
  .cap-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-top: 12px;
  }
  .cap {
    min-height: 95px;
    padding: 10px;
  }
  .cap b {
    display: inline-flex;
    min-width: 30px;
    height: 24px;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    background: linear-gradient(135deg, #f2c6ad, #d9aa72);
    font-size: 12px;
  }
  .cap.new b { background: #171310; color: #fff8ef; }
  .cap h3 { margin-top: 7px; font-size: 13px; line-height: 1.28; }
  .cap p { margin-top: 5px; color: #655a53; font-size: 10px; line-height: 1.45; }
  .page-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 245px;
    gap: 22px;
    align-items: end;
    margin-top: 11mm;
    margin-bottom: 12px;
  }
  .page-head h2 {
    margin-top: 8px;
    font-size: 30px;
    line-height: 1.2;
    font-weight: 900;
  }
  .page-head p {
    color: #6b5f58;
    font-size: 12.3px;
    line-height: 1.72;
  }
  .metrics {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 7px;
  }
  .metric {
    min-height: 50px;
    border-radius: 9px;
    padding: 9px 10px;
    border: 1px solid #eaded6;
    background: rgba(255,255,255,.74);
  }
  .metric strong { display: block; color: #171310; font-size: 18px; line-height: 1; }
  .metric span { display: block; margin-top: 6px; color: #665a53; font-size: 10.5px; line-height: 1.35; }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    align-items: start;
  }
  .three {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 9px;
    margin-top: 10px;
  }
  .panel {
    padding: 14px;
  }
  .panel h3 { font-size: 19px; line-height: 1.32; font-weight: 900; }
  .panel p { margin-top: 8px; color: #665a53; font-size: 12px; line-height: 1.64; }
  .panel.light { background: #fff8ef; }
  .mini-kicker {
    color: #8d493d;
    font-size: 10px;
    font-weight: 900;
    letter-spacing: .12em;
    text-transform: uppercase;
  }
  .screen {
    background: #fffaf6;
    overflow: hidden;
    position: relative;
    padding: 8px;
  }
  .screen img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    object-position: center;
    margin: 0 auto;
  }
  .screen.result-wide { height: 108mm; display: flex; align-items: center; }
  .screen.compact { height: 58mm; display: flex; align-items: center; }
  .screen.short { height: 68mm; display: flex; align-items: center; }
  .screen.tall { height: 87mm; display: flex; align-items: center; }
  .screen.render-scene { height: 106mm; }
  .screen.video-ui { height: 73mm; margin-top: 10px; }
  .screen-label {
    position: absolute;
    left: 12px;
    top: 12px;
    display: inline-flex;
    align-items: center;
    min-height: 27px;
    padding: 0 10px;
    border-radius: 999px;
    background: rgba(25,20,18,.78);
    color: #fff;
    font-size: 11px;
    font-weight: 900;
  }
  .video-feature {
    background:
      linear-gradient(rgba(255,247,237,.045) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,247,237,.035) 1px, transparent 1px),
      radial-gradient(circle at 84% 8%, rgba(233, 177, 142, .32), transparent 32%),
      linear-gradient(135deg, #17110f 0%, #2c211d 46%, #0f1015 100%);
    background-size: 26px 26px, 26px 26px, auto, auto;
    color: #fff8ef;
  }
  .video-feature .topbar { color: rgba(255,248,239,.64); }
  .video-feature .brand { color: #fff8ef; }
  .video-feature .pill {
    color: rgba(255,248,239,.78);
    border-color: rgba(255,248,239,.18);
    background: rgba(255,248,239,.08);
  }
  .video-feature .kicker { color: #f0c2b5; }
  .video-feature .page-head h2 { color: #fff8ef; }
  .video-feature .page-head p { color: rgba(255,248,239,.68); }
  .video-feature .metric {
    border-color: rgba(255,248,239,.14);
    background: rgba(255,248,239,.08);
  }
  .video-feature .metric strong { color: #fff8ef; }
  .video-feature .metric span { color: rgba(255,248,239,.62); }
  .video-workspace {
    display: grid;
    grid-template-columns: .88fr 1.12fr;
    gap: 12px;
    align-items: start;
  }
  .photo-hero {
    position: relative;
    height: 48mm;
    margin-top: 10px;
    overflow: hidden;
    border-radius: 9px;
    background: #1a1412;
  }
  .photo-hero img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
  }
  .photo-hero::after {
    content: "";
    position: absolute;
    inset: auto 0 0 0;
    height: 38%;
    background: linear-gradient(transparent, rgba(0,0,0,.72));
  }
  .photo-hero span {
    position: absolute;
    left: 10px;
    bottom: 10px;
    z-index: 1;
    color: #fff;
    font-size: 12px;
    font-weight: 900;
  }
  .mini-shot-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 7px;
    margin-top: 9px;
  }
  .mini-shot-row div {
    position: relative;
    overflow: hidden;
    height: 28mm;
    border-radius: 8px;
    background: #1a1412;
  }
  .mini-shot-row img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
  }
  .mini-shot-row span {
    position: absolute;
    left: 7px;
    bottom: 7px;
    color: #fff;
    font-size: 10px;
    font-weight: 900;
    text-shadow: 0 1px 6px rgba(0,0,0,.55);
  }
  .mini-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
    margin-top: 12px;
  }
  .mini {
    border-radius: 9px;
    background: #f7eee8;
    padding: 11px;
    min-height: 66px;
  }
  .mini strong { display: block; font-size: 15px; }
  .mini span { display: block; margin-top: 5px; color: #6b5f58; font-size: 11px; line-height: 1.45; }
  .use-list { margin: 11px 0 0; padding: 0; list-style: none; }
  .use-list li {
    position: relative;
    padding-left: 17px;
    margin-top: 7px;
    color: #5e534c;
    font-size: 12px;
    line-height: 1.52;
  }
  .use-list li::before {
    content: "";
    position: absolute;
    left: 0;
    top: .68em;
    width: 7px;
    height: 7px;
    border-radius: 99px;
    background: #8d493d;
  }
  .feature-points .point { min-height: 122px; }
  .new-badge {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    padding: 0 9px;
    border-radius: 999px;
    background: #171310;
    color: #fff8ef;
    font-size: 10px;
    font-weight: 900;
    letter-spacing: .04em;
    margin-bottom: 8px;
  }
  .visual-pair .screen { background: #fff; }
  .scene-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-top: 12px;
  }
  .dense-band {
    margin-top: 12px;
    border-radius: 12px;
    padding: 14px 16px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    box-shadow: 0 16px 32px rgba(44, 29, 22, .10);
  }
  .dense-band.dark {
    background: #181412;
    color: #fff;
  }
  .dense-band.light {
    background: #fff;
    color: #171310;
    border: 1px solid #eaded6;
  }
  .dense-band strong {
    display: block;
    font-size: 16px;
    line-height: 1.3;
    font-weight: 900;
  }
  .dense-band span {
    display: block;
    margin-top: 6px;
    color: rgba(255,255,255,.70);
    font-size: 11px;
    line-height: 1.45;
  }
  .dense-band.light span { color: #665a53; }
  .website {
    margin-top: 12px;
    border-radius: 12px;
    background: #181412;
    color: #fff;
    padding: 16px;
    display: grid;
    grid-template-columns: 1fr 124px;
    gap: 18px;
    align-items: center;
  }
  .website h3 { font-size: 21px; line-height: 1.35; }
  .website p { margin-top: 8px; color: rgba(255,255,255,.72); font-size: 12px; line-height: 1.6; }
  .chrome-note {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 34px;
    padding: 0 13px;
    margin-top: 11px;
    border-radius: 999px;
    background: #fff;
    color: #171310;
    font-size: 12px;
    font-weight: 900;
  }
  .chrome-icon {
    position: relative;
    width: 21px;
    height: 21px;
    border-radius: 999px;
    background: conic-gradient(#e94335 0 34%, #f7c945 0 66%, #34a853 0 84%, #4285f4 0);
    box-shadow: inset 0 0 0 1px rgba(0,0,0,.08);
  }
  .chrome-icon::after {
    content: "";
    position: absolute;
    inset: 5px;
    border-radius: 999px;
    background: #4285f4;
    border: 2px solid #fff;
  }
  .qr-card {
    height: 124px;
    border-radius: 10px;
    background: #fff;
    color: #5d524c;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    font-weight: 900;
    font-size: 10px;
    line-height: 1.55;
    padding: 9px;
    gap: 5px;
  }
  .qr-card img { width: 82px; height: 82px; display: block; }
  .qr-card span { max-width: 110px; overflow-wrap: anywhere; }
  .footer {
    position: absolute;
    left: 15mm;
    right: 15mm;
    bottom: 8mm;
    display: flex;
    justify-content: space-between;
    color: #92857c;
    font-size: 9.5px;
    z-index: 3;
  }
  .video-feature .footer { color: rgba(255,248,239,.48); }
`;

const orderedPages = [
  pages[0],
  pages[1],
  pages[3],
  pages[4],
  pages[5],
  pages[2],
  pages[6],
];

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>WedScene AI 2026 婚礼商家 AI 内容获客工具</title>
  <style>${css}</style>
</head>
<body>
  ${orderedPages.join('\n')}
</body>
</html>`;

await assertAssets();
await fs.mkdir(outDir, { recursive: true });
await fs.rm(previewDir, { recursive: true, force: true });
await fs.mkdir(previewDir, { recursive: true });
await fs.writeFile(htmlPath, html, 'utf8');

const executablePath = await firstExisting([
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
]);

const browser = await chromium.launch({
  headless: true,
  executablePath,
});

try {
  const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0));
  await page.emulateMedia({ media: 'print' });

  const sheets = page.locator('.sheet');
  const count = await sheets.count();
  for (let i = 0; i < count; i += 1) {
    await sheets.nth(i).screenshot({
      path: path.join(previewDir, `page-${String(i + 1).padStart(2, '0')}.png`),
    });
  }

  await page.pdf({
    path: pdfPath,
    printBackground: true,
    preferCSSPageSize: true,
  });
  await page.close();
} finally {
  await browser.close();
}

await fs.copyFile(pdfPath, workspacePdfPath);
await fs.copyFile(pdfPath, desktopPdfPath);

const pdfBytes = await fs.readFile(pdfPath);
const pdf = await PDFDocument.load(pdfBytes);

console.log(JSON.stringify({
  htmlPath,
  pdfPath,
  workspacePdfPath,
  desktopPdfPath,
  previewDir,
  pageCount: pdf.getPageCount(),
}, null, 2));

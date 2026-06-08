// ===== WedScene AI · 一键生成爆款图文工作流 =====

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
const POLL_INTERVAL = 1200;
const AUTO_RESUME_DELAY = 1200;
const MAX_AUTO_RESUME_ATTEMPTS = 4;
const MAX_POLL_RECONNECT_ATTEMPTS = 8;
const RESOURCE_ASSETS_PER_PAGE = 12;
const RECHARGE_PLAN_PROFILES = [
  { price: 9.9, name: '体验包', badge: '体验', description: '适合首次体验AI视频', durationText: '3天体验' },
  { price: 99, name: '月度包', badge: '月卡', featured: true, description: '适合一个月持续创作', durationText: '1个月有效' },
  { price: 199, name: '半年包', badge: '半年', featured: true, description: '适合半年稳定使用', durationText: '半年有效' },
  { price: 399, name: '包年档', badge: '最划算', featured: true, description: '一年超低成本使用AI', durationText: '一年有效' },
];
const RESOURCE_CATEGORIES = [
  { key: 'images', label: '图片', empty: '还没有图片素材。完成一次图片生成后会出现在这里。' },
  { key: 'videos', label: '视频', empty: '还没有视频素材。生成连续转场视频后会出现在这里。' },
  { key: 'comparisons', label: '对比图', empty: '还没有对比图。布置前后对比会归到这里。' },
];

const STEP_LABELS = ['上传', '确认', '生图', '拼图', '发布'];

const MODE_CONFIG = {
  cinematic_storyboard: {
    label: '电影感分镜图',
    title: '按摄像师顺序生成 6 个 16:9 分镜',
    tags: ['#婚礼视频分镜', '#婚礼电影感', '#婚礼花艺', '#婚礼跟拍', '#婚礼影像'],
  },
  multi_angle: {
    label: '同场景多角度',
    title: '同一场婚礼，6 个视角看完整氛围',
    tags: ['#婚礼布置', '#婚礼灵感', '#婚礼策划', '#婚礼现场', '#宴会设计'],
  },
  detail_pack: {
    label: '婚礼细节补图',
    title: '把婚礼现场拆成 6 张高级细节图',
    tags: ['#婚礼细节', '#花艺布置', '#婚礼桌景', '#婚礼审美', '#备婚灵感'],
  },
  similar_style: {
    label: '类似婚礼',
    title: '根据这场婚礼生成 6 张类似婚礼',
    tags: ['#类似婚礼', '#婚礼灵感', '#婚礼效果图', '#婚礼策划', '#备婚参考'],
  },
  setup_comparison: {
    label: '布置前后对比图',
    title: '上传现场图生成 3:4 布置前后 2 宫格',
    tags: ['#婚礼布置', '#婚礼前后对比', '#婚礼效果图', '#婚礼策划', '#备婚灵感'],
  },
  design_render_scene: {
    label: '设计图转实景',
    title: '上传设计图生成 4 张真实现场候选图',
    tags: ['#婚礼设计图', '#婚礼现场效果', '#婚礼提案', '#婚礼布置', '#备婚参考'],
  },
  venue_fusion: {
    label: '空地婚礼融合图',
    title: '上传空地和婚礼素材，生成 1 张融合落地效果图',
    tags: ['#空地婚礼', '#婚礼效果图', '#婚礼布置', '#场地改造', '#备婚参考'],
  },
  copy_title: {
    label: '爆款标题文案',
    title: '上传婚礼图直接写标题文案',
    tags: ['#婚礼文案', '#爆款标题', '#婚礼灵感', '#婚礼策划', '#婚礼布置'],
  },
  motion_video: {
    label: '空景转场视频',
    title: '上传 1-3 张婚礼空景照 → 连续转场电影感视频',
    tags: ['#婚礼运镜', '#婚礼短片', '#婚礼现场', '#婚礼布置', '#婚礼灵感'],
  },
};

const MODE_IMAGE_COUNTS = {
  cinematic_storyboard: 6,
  similar_style: 6,
  setup_comparison: 1,
  design_render_scene: 4,
  venue_fusion: 1,
  copy_title: 0,
  motion_video: 0,
};

const DEFAULT_MOTION_STYLE = 'seamless_sequence';
const FALLBACK_MOTION_STYLES = [
  { key: 'seamless_sequence', label: '连续转场', description: '按上传顺序自动串联成片' },
];

const PUBLIC_PAGES = new Set(['home', 'products', 'demo', 'video', 'resources', 'logs', 'launch', 'faq']);

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const els = {
  uploadZone: $('#generatorUploadZone'),
  uploadTitle: $('#generatorUploadTitle'),
  uploadHint: $('#generatorUploadHint'),
  fileInput: $('#generatorFileInput'),
  inputPreviewWrap: $('#inputPreviewWrap'),
  inputPreview: $('#inputPreview'),
  fusionMaterialPanel: $('#fusionMaterialPanel'),
  fusionMaterialPickBtn: $('#fusionMaterialPickBtn'),
  fusionMaterialInput: $('#fusionMaterialInput'),
  fusionMaterialPreviewWrap: $('#fusionMaterialPreviewWrap'),
  fusionMaterialPreview: $('#fusionMaterialPreview'),
  replaceFusionMaterialBtn: $('#replaceFusionMaterialBtn'),
  replaceImageBtn: $('#replaceImageBtn'),
  sampleDemoBtn: $('#sampleDemoBtn'),
  modeGrid: $('#modeGrid'),
  generateBtn: $('#generateBtn'),
  restartBtn: $('#restartBtn'),
  progressBar: $('#progressBar'),
  overallProgress: $('#overallProgress'),
  jobStatusText: $('#jobStatusText'),
  logStream: $('#logStream'),
  resultPanel: $('#resultPanel'),
  resultGrid: $('#resultGrid'),
  resultOverview: $('#resultOverview'),
  collageImg: $('#collageImg'),
  overviewKicker: $('#overviewKicker'),
  overviewTitle: $('#overviewTitle'),
  downloadCollageBtn: $('#downloadCollageBtn'),
  downloadAllBtn: $('#downloadAllBtn'),
  copyTitle: $('#copyTitle'),
  copyBody: $('#copyBody'),
  copyTags: $('#copyTags'),
  copyTextBtn: $('#copyTextBtn'),
  apiStatus: $('#apiStatus'),
  stepIndicator: $('#stepIndicator'),
  resourcesGrid: $('#resourcesGrid'),
  resourcesEmpty: $('#resourcesEmpty'),
  resourcesPagination: $('#resourcesPagination'),
  resourcesPageMeta: $('#resourcesPageMeta'),
  resourcesCategoryTabs: $('#resourcesCategoryTabs'),
  refreshResourcesBtn: $('#refreshResourcesBtn'),
  accountLogsSummary: $('#accountLogsSummary'),
  accountLogsMeta: $('#accountLogsMeta'),
  accountLogsList: $('#accountLogsList'),
  accountLogsEmpty: $('#accountLogsEmpty'),
  refreshAccountLogsBtn: $('#refreshAccountLogsBtn'),
  rechargeFromLogsBtn: $('#rechargeFromLogsBtn'),
  authEntryBtn: $('#authEntryBtn'),
  // video 页面（独立工作流）
  videoUploadZone: $('#videoUploadZone'),
  videoFileInput: $('#videoFileInput'),
  videoInputPreview: $('#videoInputPreview'),
  videoInputPreviewWrap: $('#videoInputPreviewWrap'),
  videoInputPreviewList: $('#videoInputPreviewList'),
  videoUploadAdvice: $('#videoUploadAdvice'),
  videoReplaceBtn: $('#videoReplaceBtn'),
  videoGenerateBtn: $('#videoGenerateBtn'),
  videoRestartBtn: $('#videoRestartBtn'),
  videoJobStatusText: $('#videoJobStatusText'),
  videoOverallProgress: $('#videoOverallProgress'),
  videoProgressBar: $('#videoProgressBar'),
  videoLogStream: $('#videoLogStream'),
  videoPointHint: $('#videoPointHint'),
  videoResultPanel: $('#videoResultPanel'),
  videoResultVideo: $('#videoResultVideo'),
  videoResultMeta: $('#videoResultMeta'),
  videoPreviewBtn: $('#videoPreviewBtn'),
  videoDownloadBtn: $('#videoDownloadBtn'),
  videoHistoryGrid: $('#videoHistoryGrid'),
  videoHistoryEmpty: $('#videoHistoryEmpty'),
};

let selectedMode = 'cinematic_storyboard';
let selectedMotionStyle = DEFAULT_MOTION_STYLE;
let motionConfig = { pointCost: 60, durationSeconds: 8, resolution: '4K', referenceLimit: 3, publicBaseConfigured: false, mockMode: false, styles: FALLBACK_MOTION_STYLES };
let uploadedFile = null;
let uploadedDataUrl = null;
let uploadedAspectRatio = '';
let uploadedFusionFile = null;
let uploadedFusionDataUrl = null;
let activeJobId = null;
let activePollTimer = null;
let autoResumeTimer = null;
let autoResumeAttempts = 0;
let localRunId = 0;
let apiProvider = 'mock';
let canResumeActiveJob = false;
let accessGranted = true;
let accountRequired = false;
let currentUser = null;
let pointCost = 5;
let pointCosts = {
  text: 5,
  singleImage: 5,
  sixImage: 30,
  designRender: 20,
  motion: 60,
  byMode: {
    cinematic_storyboard: 30,
    multi_angle: 30,
    detail_pack: 30,
    similar_style: 30,
    setup_comparison: 5,
    design_render_scene: 20,
    venue_fusion: 5,
    copy_title: 5,
    motion_video: 60,
  },
};
let siteInfo = { supportWechat: '', supportWechatQr: '', supportContacts: [], rechargePlans: '', rechargePlanItems: [], tenant: null, partner: '' };
let currentResourcePage = 1;
let lastResourceItems = [];
let lastResources = [];
let currentResourceCategory = 'images';
const deletingResourceIds = new Set();
let generationInProgress = false;

function currentPartnerSlug() {
  const params = new URLSearchParams(window.location.search);
  return (params.get('partner') || params.get('t') || siteInfo.partner || siteInfo.tenant?.slug || '').trim();
}

function isVenueFusionMode(mode = selectedMode) {
  return mode === 'venue_fusion';
}

function hasRequiredGeneratorInput(mode = selectedMode) {
  return !!uploadedFile && (!isVenueFusionMode(mode) || !!uploadedFusionFile);
}

function updateFusionControls() {
  const fusionMode = isVenueFusionMode();
  if (els.fileInput) els.fileInput.multiple = fusionMode;
  els.fusionMaterialPanel?.classList.toggle('hidden', !fusionMode);
  if (els.uploadTitle) {
    els.uploadTitle.textContent = fusionMode ? '上传空地 / 空场照片' : '上传婚礼现场照 / 设计图';
  }
  if (els.uploadHint) {
    els.uploadHint.textContent = fusionMode
      ? '第 1 张作为场地骨架，第 2 张婚礼素材在下方上传 · JPG / PNG · ≤ 10MB'
      : 'JPG / PNG · 建议原图 · ≤ 10MB';
  }
  if (els.sampleDemoBtn) {
    els.sampleDemoBtn.textContent = fusionMode ? '没有两张图？用空地 + 婚礼示例跑一遍' : '没有照片？用示例图跑一遍';
  }
}

function appendPartnerParam(url) {
  const partner = currentPartnerSlug();
  if (!partner) return url;
  const target = new URL(url, window.location.href);
  if (!target.searchParams.get('partner') && !target.searchParams.get('t')) {
    target.searchParams.set('partner', partner);
  }
  return `${target.pathname}${target.search}${target.hash}`;
}

function apiUrl(url) {
  return appendPartnerParam(url);
}

function applySiteBrand(tenant = null) {
  if (!tenant) return;
  siteInfo.tenant = tenant;
  siteInfo.partner = tenant.defaultTenant ? '' : (tenant.slug || siteInfo.partner || '');
  const name = String(tenant.name || 'WedScene').trim();
  const tagline = String(tenant.tagline || 'WEDSCENE AI').trim();
  const logoText = String(tenant.logoText || name.slice(0, 1) || 'W').trim().slice(0, 2);
  document.title = `${name} AI`;
  document.querySelectorAll('[data-brand-name]').forEach((el) => { el.textContent = name; });
  document.querySelectorAll('[data-brand-tagline]').forEach((el) => { el.textContent = tagline; });
  document.querySelectorAll('[data-brand-footer]').forEach((el) => { el.textContent = name; });
  document.querySelectorAll('[data-brand-hero]').forEach((el) => {
    el.innerHTML = `${escapeHtml(name)}<br/><em>AI</em>`;
  });
  document.querySelectorAll('[data-brand-mark]').forEach((el) => {
    if (tenant.logoUrl) {
      el.innerHTML = `<img src="${escapeHtml(tenant.logoUrl)}" alt="${escapeHtml(name)}" />`;
    } else {
      el.innerHTML = `<span>${escapeHtml(logoText)}</span>`;
    }
  });
  document.querySelectorAll('a[data-auth-link]').forEach((el) => {
    el.setAttribute('href', appendPartnerParam(el.getAttribute('href') || 'login.html?tab=register'));
  });
}

function applyPointCosts(payload = {}) {
  if (payload && typeof payload === 'object' && payload.pointCosts && typeof payload.pointCosts === 'object') {
    pointCosts = {
      ...pointCosts,
      ...payload.pointCosts,
      byMode: {
        ...(pointCosts.byMode || {}),
        ...(payload.pointCosts.byMode || {}),
      },
    };
  }
  pointCost = Number(payload.pointCost || pointCosts.singleImage || pointCost || 5);
  if (payload.motion && typeof payload.motion === 'object') {
    motionConfig = {
      ...motionConfig,
      pointCost: Number(payload.motion.pointCost) || Number(pointCosts.motion) || motionConfig.pointCost,
      durationSeconds: Number(payload.motion.durationSeconds) || motionConfig.durationSeconds,
      resolution: payload.motion.resolution || motionConfig.resolution,
      referenceLimit: Math.max(1, Number(payload.motion.referenceLimit) || motionConfig.referenceLimit || 3),
      publicBaseConfigured: !!payload.motion.publicBaseConfigured,
      mockMode: !!payload.motion.mockMode,
      styles: Array.isArray(payload.motion.styles) && payload.motion.styles.length ? payload.motion.styles : motionConfig.styles,
    };
  } else if (Number(pointCosts.motion) > 0) {
    motionConfig.pointCost = Number(pointCosts.motion);
  }
}

function videoReferenceLimit() {
  return Math.max(1, Number(motionConfig.referenceLimit) || 3);
}

function pointCostForMode(mode = selectedMode) {
  return Number(pointCosts.byMode?.[mode])
    || (mode === 'motion_video' ? Number(motionConfig.pointCost || pointCosts.motion || 60) : Number(pointCost || pointCosts.singleImage || 5));
}

function pointCostSummaryText() {
  return `文案 ${pointCosts.text || 5} 点 / 单图 ${pointCosts.singleImage || pointCost || 5} 点 / 6图 ${pointCosts.sixImage || 30} 点 / 空地融合 ${pointCosts.byMode?.venue_fusion || pointCosts.singleImage || pointCost || 5} 点 / 设计图转实景 ${pointCosts.designRender || pointCosts.byMode?.design_render_scene || 20} 点 / 视频 ${motionConfig.pointCost || pointCosts.motion || 60} 点`;
}

function pageFromHash() {
  const hash = window.location.hash.replace(/^#/, '');
  if (PUBLIC_PAGES.has(hash)) return hash;
  if (new URLSearchParams(window.location.search).get('resource')) return 'resources';
  return 'home';
}

function showPage(page = pageFromHash()) {
  const currentPage = PUBLIC_PAGES.has(page) ? page : 'home';
  $$('.page-section').forEach((section) => {
    const isActive = section.dataset.page === currentPage;
    section.classList.toggle('active', isActive);
    if (isActive) {
      section.querySelectorAll('.reveal').forEach((el) => el.classList.add('visible'));
    }
  });
  $$('[data-page-link]').forEach((link) => {
    link.classList.toggle('active', link.dataset.pageLink === currentPage);
  });
  if (currentPage === 'logs') loadAccountLogs();
  window.scrollTo(0, 0);
}

function svgToDataUrl(svg) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function buildStepIndicator() {
  if (!els.stepIndicator) return;
  els.stepIndicator.style.setProperty('--step-count', STEP_LABELS.length);
  els.stepIndicator.innerHTML = STEP_LABELS.map((label, index) => `
    <div class="step-item" data-step-item="${index}">
      <div class="step-dot" data-step="${index}"></div>
      <span class="text-[12px] font-cn font-semibold" data-step-label="${index}">${label}</span>
    </div>
  `).join('');
  setActiveStep(0);
}

function setActiveStep(index) {
  $$('[data-step-item]').forEach((item, i) => {
    item.classList.toggle('active', i === index);
    item.classList.toggle('done', i < index);
  });
  $$('[data-step]').forEach((dot, i) => {
    dot.classList.toggle('active', i === index);
    dot.classList.toggle('done', i < index);
  });
  $$('[data-step-label]').forEach((label, i) => {
    label.classList.toggle('text-rose-200', i === index);
    label.classList.toggle('text-stone-500', i !== index);
  });
}

function stepFromProgress(progress) {
  if (progress < 10) return 0;
  if (progress < 24) return 1;
  if (progress < 82) return 2;
  if (progress < 96) return 3;
  return 4;
}

function setProgress(progress, text) {
  const normalized = Math.max(0, Math.min(100, Math.round(progress)));
  els.progressBar.style.width = `${normalized}%`;
  els.overallProgress.textContent = `${normalized}%`;
  if (text) els.jobStatusText.textContent = text;
  setActiveStep(stepFromProgress(normalized));
}

function appendLog(text) {
  const safeText = publicGenerationLog(text);
  if (!safeText) return;
  const line = document.createElement('div');
  line.textContent = safeText;
  els.logStream.appendChild(line);
  while (els.logStream.children.length > 8) els.logStream.removeChild(els.logStream.firstChild);
}

function renderLogs(logs = []) {
  els.logStream.innerHTML = '';
  logs.slice(-8).forEach(appendLog);
}

function clearAutoResumeTimer() {
  window.clearTimeout(autoResumeTimer);
  autoResumeTimer = null;
}

function isTransientGenerationError(message = '') {
  return /超时|timeout|timed out|fetch failed|ECONNRESET|CONNECT_TIMEOUT|UND_ERR|network|请求失败/i.test(message);
}

function isTransientPollingError(message = '') {
  return /HTTP\s*(502|503|504)|Bad Gateway|Gateway Timeout|Failed to fetch|Load failed|NetworkError|网络|连接中断/i.test(String(message || ''))
    || isTransientGenerationError(message);
}

function cleanErrorMessage(message = '') {
  const text = String(message || '').trim();
  if (/<!doctype\s+html|<html[\s>]|cloudflare|attention required|cf-error|sorry,\s*you have been blocked|ray id/i.test(text)) {
    return 'n1n.ai 接口被 Cloudflare 拦截，当前网络/IP/代理被上游拒绝访问。请换网络或代理、联系 n1n.ai 放行/更换可用 API 域名，或临时切回官方 OpenAI 接口。';
  }
  return text.replace(/\s+/g, ' ').slice(0, 260);
}

function publicGenerationLog(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return '';
  if (/\[done\]|已生成完成|生成完成|视频已生成/i.test(raw)) return '生成完成，结果已保存';
  if (/\[resource\]|保存到资源库|资源库/i.test(raw)) return '结果正在保存到资源库';
  if (/\[points\]|扣除|退回|返还|灵感/i.test(raw)) return raw.replace(/剩余\s*\d+\s*点/g, '余额已更新');
  if (/\[retry\]|\[auto\]|timeout|timed out|fetch failed|ECONNRESET|UND_ERR|network|接口繁忙/i.test(raw)) return '接口繁忙，系统正在自动重试';
  if (/\[error\]|failed|HTTP|API|endpoint|task_id|model|prompt|Gemini|n1n|ffmpeg|PUBLIC_BASE_URL|input_reference|data-url|公网|URL|worker|source|motion-director|motion-guard|copy-api|image-api/i.test(raw)) return '生成遇到异常，请稍后重试或联系客服';
  if (/\[queue\]|队列|收到|上传|素材/i.test(raw)) return '已收到素材，任务已进入生成队列';
  if (/\[input\]|检查|优化|解析|mode/i.test(raw)) return '素材检查完成，正在解析风格';
  if (/\[motion\]|视频|转场|运镜/i.test(raw)) return '已提交上游视频任务，正在等待出片';
  if (/\[generate\]|\[n1n\]|并发|开始|完成/i.test(raw)) return '正在生成婚礼成品图';
  return raw.replace(/\bhttps?:\/\/\S+/gi, '[已隐藏]').replace(/[a-zA-Z0-9_-]{12,}/g, '[已隐藏]').slice(0, 80);
}

function setMode(mode) {
  if (!MODE_CONFIG[mode]) mode = 'cinematic_storyboard';
  selectedMode = mode;
  if (canResumeActiveJob) {
    canResumeActiveJob = false;
    activeJobId = null;
    window.clearTimeout(activePollTimer);
    clearAutoResumeTimer();
  }
  $$('.mode-card').forEach((button) => {
    const isActive = button.dataset.mode === mode;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    if (isActive) {
      button.classList.remove('mode-card-pop');
      void button.offsetWidth;
      button.classList.add('mode-card-pop');
      window.setTimeout(() => button.classList.remove('mode-card-pop'), 260);
    }
  });
  updateFusionControls();
  if (uploadedFile) {
    els.jobStatusText.textContent = isVenueFusionMode(mode) && !uploadedFusionFile
      ? '空地已上传，请继续上传婚礼素材图'
      : `已选择：${MODE_CONFIG[mode].label}`;
  }
  setMotionStyleVisibility(mode);
  setGenerating(false);
}

function updateGenerateState() {
  els.generateBtn.disabled = !hasRequiredGeneratorInput() && !(canResumeActiveJob && activeJobId);
}

function showInput(file, dataUrl) {
  canResumeActiveJob = false;
  activeJobId = null;
  window.clearTimeout(activePollTimer);
  clearAutoResumeTimer();
  autoResumeAttempts = 0;
  uploadedFile = file;
  uploadedDataUrl = dataUrl;
  uploadedAspectRatio = '';
  const probeImage = new Image();
  probeImage.onload = () => {
    if (probeImage.naturalWidth && probeImage.naturalHeight) {
      uploadedAspectRatio = `${probeImage.naturalWidth} / ${probeImage.naturalHeight}`;
    }
  };
  probeImage.src = dataUrl;
  els.inputPreview.src = dataUrl;
  els.uploadZone.classList.add('hidden');
  els.inputPreviewWrap.classList.remove('hidden');
  els.resultPanel.classList.add('hidden');
  updateFusionControls();
  const fusionWaiting = isVenueFusionMode() && !uploadedFusionFile;
  setProgress(12, fusionWaiting ? '空地已上传，请继续上传婚礼素材图' : `素材已就绪，当前模式：${MODE_CONFIG[selectedMode].label}`);
  renderLogs([fusionWaiting ? '[upload] 空地/空场图已载入，等待上传婚礼素材图' : '[upload] 素材图已载入，等待确认生成模式']);
  setGenerating(false);
}

function validateImageFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    alert('请选择 JPG 或 PNG 图片');
    return false;
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    alert('图片请控制在 10MB 以内');
    return false;
  }
  return true;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target.result);
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

async function handleFile(file) {
  if (!validateImageFile(file)) return;
  const dataUrl = await readFileAsDataUrl(file);
  showInput(file, dataUrl);
}

function showFusionInput(file, dataUrl) {
  canResumeActiveJob = false;
  activeJobId = null;
  window.clearTimeout(activePollTimer);
  clearAutoResumeTimer();
  autoResumeAttempts = 0;
  uploadedFusionFile = file;
  uploadedFusionDataUrl = dataUrl;
  els.fusionMaterialPreview.src = dataUrl;
  els.fusionMaterialPreviewWrap.classList.remove('hidden');
  els.resultPanel.classList.add('hidden');
  const ready = !!uploadedFile;
  setProgress(ready ? 16 : 8, ready ? '空地和婚礼素材已就绪' : '婚礼素材已上传，请继续上传空地照片');
  renderLogs([ready ? '[upload] 空地图和婚礼素材图已载入，等待开始融合' : '[upload] 婚礼素材图已载入，等待上传空地/空场图']);
  setGenerating(false);
}

async function handleFusionFile(file) {
  if (!validateImageFile(file)) return;
  const dataUrl = await readFileAsDataUrl(file);
  showFusionInput(file, dataUrl);
}

async function handleGeneratorFiles(fileList) {
  const files = Array.from(fileList || []).filter(Boolean);
  if (!files.length) return;
  if (isVenueFusionMode() && files.length >= 2) {
    await handleFile(files[0]);
    await handleFusionFile(files[1]);
    return;
  }
  await handleFile(files[0]);
}

async function dataUrlToFile(dataUrl, filename) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type || 'image/png' });
}

function getSampleInputImage() {
  return svgToDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#151016"/>
          <stop offset="0.46" stop-color="#30201d"/>
          <stop offset="1" stop-color="#0a0a0f"/>
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="36%" r="58%">
          <stop offset="0" stop-color="#f4d4c5" stop-opacity="0.48"/>
          <stop offset="1" stop-color="#f4d4c5" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="1200" height="900" fill="url(#bg)"/>
      <rect width="1200" height="900" fill="url(#glow)"/>
      <path d="M120 790L445 380H755L1080 790Z" fill="#0f1017" opacity="0.88"/>
      <path d="M320 650C320 390 880 390 880 650" fill="none" stroke="#f4d4c5" stroke-width="34" stroke-linecap="round"/>
      <path d="M380 650C380 450 820 450 820 650" fill="none" stroke="#d4b46e" stroke-width="8" stroke-linecap="round" opacity="0.78"/>
      <path d="M210 770H990" stroke="#fff7ed" stroke-opacity="0.18" stroke-width="4"/>
      ${Array.from({ length: 42 }, (_, i) => {
        const x = 160 + (i % 21) * 43;
        const y = 645 + Math.floor(i / 21) * 76 + (i % 2) * 16;
        return `<rect x="${x}" y="${y}" width="30" height="34" rx="8" fill="#fff7ed" opacity="0.18"/>`;
      }).join('')}
      ${Array.from({ length: 16 }, (_, i) => {
        const x = 310 + (i % 8) * 82;
        const y = 610 + Math.floor(i / 8) * 44;
        return `<circle cx="${x}" cy="${y}" r="${20 + (i % 3) * 4}" fill="${i % 2 ? '#f0c2b5' : '#d4b46e'}" opacity="0.9"/>`;
      }).join('')}
      <path d="M420 706H780" stroke="#b91c1c" stroke-width="26" stroke-linecap="round" opacity="0.82"/>
      <circle cx="600" cy="506" r="8" fill="#fde68a"/>
      <circle cx="500" cy="446" r="7" fill="#fde68a"/>
      <circle cx="700" cy="446" r="7" fill="#fde68a"/>
    </svg>
  `);
}

function getSampleEmptyVenueImage() {
  return svgToDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#dce9ef"/>
          <stop offset="0.58" stop-color="#f7efe4"/>
          <stop offset="1" stop-color="#d8c6a7"/>
        </linearGradient>
        <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#c8b18d"/>
          <stop offset="1" stop-color="#8b795f"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="900" fill="url(#sky)"/>
      <path d="M0 420C170 392 285 430 456 406C660 377 835 408 1200 374V900H0Z" fill="url(#ground)"/>
      <path d="M80 762C310 622 475 552 610 472C720 536 882 630 1120 762Z" fill="#b29d7c" opacity="0.55"/>
      <path d="M130 402H1070" stroke="#9b8a72" stroke-width="3" opacity="0.25"/>
      <path d="M170 662C390 590 810 590 1030 662" fill="none" stroke="#f7efe4" stroke-width="6" stroke-linecap="round" opacity="0.5"/>
      ${Array.from({ length: 12 }, (_, i) => {
        const x = 90 + i * 96;
        const h = 42 + (i % 4) * 16;
        return `<path d="M${x} 389v-${h}" stroke="#7b705f" stroke-width="6" opacity="0.38"/><circle cx="${x}" cy="${389 - h}" r="${24 + (i % 3) * 5}" fill="#7f8f70" opacity="0.38"/>`;
      }).join('')}
    </svg>
  `);
}

async function useSampleDemo() {
  if (isVenueFusionMode()) {
    const venueDataUrl = getSampleEmptyVenueImage();
    const weddingDataUrl = getSampleInputImage();
    const venueFile = await dataUrlToFile(venueDataUrl, 'sample-empty-venue.png');
    const weddingFile = await dataUrlToFile(weddingDataUrl, 'sample-wedding-material.png');
    showInput(venueFile, venueDataUrl);
    showFusionInput(weddingFile, weddingDataUrl);
    return;
  }
  const dataUrl = getSampleInputImage();
  const file = await dataUrlToFile(dataUrl, 'sample-wedding-scene.png');
  showInput(file, dataUrl);
}

function updateAccountUI() {
  if (!els.authEntryBtn) return;
  const compact = window.matchMedia?.('(max-width: 767px)').matches;
  if (accountRequired && currentUser) {
    els.authEntryBtn.textContent = compact ? `${currentUser.points ?? 0} 灵感值` : `${displayAccountName(currentUser)} · ${currentUser.points ?? 0} 灵感值`;
    els.authEntryBtn.title = '查看账号和灵感值说明';
    return;
  }
  els.authEntryBtn.textContent = compact ? '登录' : '登录 / 注册';
  els.authEntryBtn.title = '登录或注册客户账号';
}

function displayAccountName(user) {
  const name = String(user?.name || '').trim();
  if (!name || /^[?\s]+$/.test(name) || name.includes('�')) return user?.login || '客户账号';
  return name;
}

function formatMembershipExpiry(user) {
  const expiresAt = user?.membershipExpiresAt;
  if (!expiresAt) return '未开通';
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return '未开通';
  const prefix = user.membershipStatus === 'expired' ? '已过期：' : '有效至 ';
  return `${prefix}${date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })}`;
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function checkApiHealth() {
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    if (!response.ok) throw new Error('health unavailable');
    const data = await response.json();
    apiProvider = data.provider || (data.openaiEnabled ? 'api' : 'mock');
    accountRequired = !!data.accountRequired;
    els.apiStatus.textContent = data.openaiEnabled ? '生成服务已就绪' : '演示模式';
    els.apiStatus.classList.toggle('text-emerald-200', !!data.openaiEnabled);
    els.apiStatus.classList.toggle('text-stone-400', !data.openaiEnabled);
    updateAccountUI();
  } catch {
    apiProvider = 'mock';
    els.apiStatus.textContent = '演示服务';
    updateAccountUI();
  }
}

function ensureAccessGate() {
  let gate = $('#accessGate');
  if (gate) return gate;

  gate = document.createElement('div');
  gate.id = 'accessGate';
  gate.className = 'access-gate';
  gate.hidden = true;
  gate.innerHTML = `
    <form class="access-card" id="accessForm">
      <div class="tag mb-4">◆ 账号访问</div>
      <h2 id="accessTitle" class="font-cn font-black text-2xl leading-tight">登录客户账号</h2>
      <p id="accessHelp" class="text-stone-500 leading-7 mt-3">请输入管理员给你的客户账号和登录码。新账号默认赠送试用点数，用完后联系管理员充值。</p>
      <input id="accessLoginInput" type="text" autocomplete="username" placeholder="手机号 / 客户账号" />
      <input id="accessCodeInput" type="password" autocomplete="current-password" placeholder="登录码" />
      <button class="btn-primary w-full px-5 py-3 rounded-full text-sm" type="submit">登录账号</button>
      <p id="accessError" class="access-error mt-3"></p>
    </form>
  `;
  document.body.appendChild(gate);

  gate.querySelector('#accessForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const login = gate.querySelector('#accessLoginInput');
    const input = gate.querySelector('#accessCodeInput');
    const error = gate.querySelector('#accessError');
    const button = gate.querySelector('button[type="submit"]');
    error.textContent = '';
    button.disabled = true;
    button.textContent = '验证中...';
    try {
      const response = await fetch(apiUrl('/api/access'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: login.value, code: input.value, partner: currentPartnerSlug() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || '访问码验证失败');
      accessGranted = true;
      accountRequired = !!payload.accountRequired;
      currentUser = payload.user || currentUser;
      siteInfo.tenant = payload.tenant || siteInfo.tenant || null;
      siteInfo.partner = payload.partner || payload.tenant?.slug || currentPartnerSlug();
      applySiteBrand(payload.tenant);
      applyPointCosts(payload);
      updateAccountUI();
      gate.hidden = true;
      loadResources();
    } catch (err) {
      error.textContent = err.message || '登录失败';
      input.focus();
      input.select();
    } finally {
      button.disabled = false;
      button.textContent = accountRequired ? '登录账号' : '进入公测';
    }
  });

  return gate;
}

function showAccessGate(message = '') {
  const isLoginRoute = /\/login(?:\.html)?\/?$/.test(location.pathname);
  if (accountRequired && !currentUser && !isLoginRoute) {
    const next = encodeURIComponent(location.pathname + location.search + location.hash);
    location.href = appendPartnerParam(`login.html?next=${next}`);
    return;
  }
  const gate = ensureAccessGate();
  const login = gate.querySelector('#accessLoginInput');
  const input = gate.querySelector('#accessCodeInput');
  const title = gate.querySelector('#accessTitle');
  const help = gate.querySelector('#accessHelp');
  const button = gate.querySelector('button[type="submit"]');
  const error = gate.querySelector('#accessError');
  login.classList.toggle('hidden', !accountRequired);
  input.placeholder = accountRequired ? '登录码' : '访问码';
  title.textContent = accountRequired ? '登录客户账号' : '请输入公测访问码';
  help.textContent = accountRequired
    ? '请输入管理员给你的客户账号和登录码。新账号默认赠送试用点数，用完后联系管理员充值。'
    : '当前版本仅开放给邀请客户使用，输入访问码后即可生成和查看资源。';
  button.textContent = accountRequired ? '登录账号' : '进入公测';
  if (message) error.textContent = message;
  gate.hidden = false;
  window.setTimeout(() => (accountRequired ? login : input)?.focus(), 40);
}

function ensureRechargeStyles() {
  if (document.getElementById('rechargeDialogStyles')) return;
  const style = document.createElement('style');
  style.id = 'rechargeDialogStyles';
  style.textContent = `
    .recharge-overlay { position: fixed; inset: 0; background: rgba(28,25,23,0.55); backdrop-filter: blur(6px); display: grid; place-items: center; z-index: 1000; padding: 20px; }
    .recharge-card { background: #fffaf3; border-radius: 22px; padding: 30px 28px 26px; max-width: 520px; width: 100%; max-height: calc(100vh - 40px); overflow-y: auto; box-shadow: 0 32px 80px -20px rgba(0,0,0,0.4); position: relative; font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif; }
    .recharge-card .recharge-close { position: absolute; top: 14px; right: 16px; width: 32px; height: 32px; border: none; background: rgba(58,39,34,0.06); border-radius: 50%; cursor: pointer; font-size: 22px; line-height: 1; color: rgba(28,25,23,0.6); }
    .recharge-card .recharge-close:hover { background: rgba(58,39,34,0.12); color: #1c1917; }
    .recharge-card h3 { font-size: 20px; font-weight: 700; margin-bottom: 6px; color: #1c1917; }
    .recharge-card .recharge-sub { font-size: 12px; color: rgba(28,25,23,0.55); margin-bottom: 20px; line-height: 1.6; }
    .recharge-card .recharge-status { background: rgba(58,39,34,0.04); border: 1px solid rgba(58,39,34,0.08); border-radius: 12px; padding: 12px 14px; margin-bottom: 18px; font-size: 12px; color: rgba(28,25,23,0.7); display: flex; justify-content: space-between; align-items: center; }
    .recharge-card .recharge-status strong { color: #1c1917; font-size: 16px; font-weight: 700; }
    .recharge-card .plan-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 20px; }
    .recharge-card .plan-tile { background: linear-gradient(145deg, #fff7ed, #f5e6d8); border: 1px solid rgba(58,39,34,0.08); border-radius: 12px; padding: 16px 12px 14px; text-align: center; display: flex; flex-direction: column; justify-content: center; gap: 4px; min-height: 148px; position: relative; }
    .recharge-card .plan-tile.is-featured { background: linear-gradient(145deg, #fff4e8, #ead0bf); border-color: rgba(139,63,50,0.34); box-shadow: 0 14px 30px -22px rgba(139,63,50,0.8); }
    .recharge-card .plan-badge { position: absolute; top: 8px; right: 8px; padding: 2px 5px; border-radius: 999px; background: #8b3f32; color: #fffaf3; font-size: 9px; font-weight: 700; }
    .recharge-card .plan-tile strong { font-size: 18px; font-weight: 700; color: #3a2722; }
    .recharge-card .plan-tile span { font-size: 11px; color: rgba(28,25,23,0.6); }
    .recharge-card .plan-tile .plan-name { font-size: 13px; color: #3a2722; font-weight: 700; }
    .recharge-card .plan-tile em { font-style: normal; font-size: 10px; color: rgba(124,63,53,0.86); font-weight: 700; line-height: 1.35; }
    .recharge-card .plan-tile .plan-image-unit { color: #8b3f32; font-size: 11px; font-weight: 900; }
    .recharge-card .plan-tile .plan-desc { font-size: 10px; color: rgba(28,25,23,0.52); line-height: 1.45; }
    .recharge-card .recharge-note { margin: -10px 0 18px; color: rgba(28,25,23,0.56); font-size: 11px; line-height: 1.6; text-align: center; }
    .recharge-card .support-contact-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(178px, 1fr)); gap: 12px; margin-bottom: 12px; }
    .recharge-card .support-contact { text-align: center; border: 1px solid rgba(58,39,34,0.1); border-radius: 16px; background: linear-gradient(180deg, rgba(255,255,255,0.78), rgba(255,247,237,0.62)); padding: 12px 12px 14px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.76); }
    .recharge-card .support-contact-label { display: inline-flex; align-items: center; justify-content: center; min-height: 24px; margin-bottom: 9px; padding: 0.24rem 0.62rem; border-radius: 999px; background: rgba(58,39,34,0.07); color: rgba(58,39,34,0.72); font-size: 11px; font-weight: 900; }
    .recharge-card .recharge-qr { display: grid; place-items: center; margin-bottom: 10px; }
    .recharge-card .recharge-qr img { width: min(168px, 100%); height: auto; aspect-ratio: 1; object-fit: contain; border-radius: 12px; background: #fff; border: 1px solid rgba(58,39,34,0.1); box-shadow: 0 14px 28px -24px rgba(58,39,34,0.55); }
    .recharge-card .recharge-wechat { text-align: center; font-size: 13px; color: rgba(28,25,23,0.66); }
    .recharge-card .recharge-wechat strong { display: block; margin-top: 2px; color: #1c1917; font-size: 16px; font-family: 'JetBrains Mono', monospace; user-select: all; }
    .recharge-card .recharge-tip { text-align: center; font-size: 11px; color: rgba(28,25,23,0.5); margin-top: 8px; }
    .recharge-card .recharge-warn { text-align: center; font-size: 12px; color: rgba(28,25,23,0.55); line-height: 1.7; }
    .recharge-card .recharge-warn code { background: rgba(58,39,34,0.08); padding: 2px 6px; border-radius: 4px; font-family: monospace; }
    .recharge-card .ledger-panel { border-top: 1px solid rgba(58,39,34,0.1); margin-top: 18px; padding-top: 14px; }
    .recharge-card .ledger-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 8px; font-size: 12px; color: rgba(28,25,23,0.64); }
    .recharge-card .ledger-head strong { color: #1c1917; font-size: 13px; }
    .recharge-card .ledger-list { display: grid; gap: 6px; }
    .recharge-card .ledger-row { display: grid; grid-template-columns: 72px 1fr auto; gap: 8px; align-items: center; background: rgba(58,39,34,0.035); border: 1px solid rgba(58,39,34,0.06); border-radius: 10px; padding: 8px 10px; font-size: 11px; color: rgba(28,25,23,0.62); }
    .recharge-card .ledger-row strong { color: #1c1917; font-size: 12px; display: block; }
    .recharge-card .ledger-row .ledger-note { min-width: 0; }
    .recharge-card .ledger-row .ledger-note span { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .recharge-card .ledger-row .points-pos { color: #047857; font-weight: 800; }
    .recharge-card .ledger-row .points-neg { color: #b91c1c; font-weight: 800; }
    .recharge-card .ledger-empty { text-align: center; padding: 12px; font-size: 11px; color: rgba(28,25,23,0.5); background: rgba(58,39,34,0.035); border-radius: 10px; }
    @media (max-width: 520px) {
      .recharge-overlay { padding: 10px; align-items: end; }
      .recharge-card { padding: 26px 18px calc(22px + env(safe-area-inset-bottom)); border-radius: 18px 18px 0 0; max-height: calc(100dvh - 20px); }
      .recharge-card .recharge-status { display: grid; gap: 6px; }
      .recharge-card .plan-grid { grid-template-columns: 1fr; }
      .recharge-card .support-contact-grid { grid-template-columns: 1fr; }
      .recharge-card .recharge-qr img { width: min(190px, 76vw); }
      .recharge-card .ledger-row { grid-template-columns: 64px 1fr; }
      .recharge-card .ledger-row .ledger-points { grid-column: 2; justify-self: start; }
    }
  `;
  document.head.appendChild(style);
}

function getRechargePlanProfile(priceValue) {
  return RECHARGE_PLAN_PROFILES.find((profile) => Math.abs(profile.price - priceValue) < 0.01)
    || {};
}

function formatRechargeUnitCost(unitCost) {
  if (!Number.isFinite(unitCost) || unitCost <= 0) return '';
  if (unitCost <= 5) return `低至${unitCost.toFixed(1)}元/条`;
  return `约${unitCost.toFixed(unitCost >= 4.95 ? 0 : 1)}元/条`;
}

function formatRechargeImageUnitCost(unitCost) {
  if (!Number.isFinite(unitCost) || unitCost <= 0) return '';
  const value = unitCost >= 1 ? unitCost.toFixed(1) : unitCost.toFixed(2);
  return `图片低至${value}元/张`;
}

function normalizeRechargePlan(plan, index = 0) {
  if (plan && typeof plan === 'object') {
    const priceValue = Number(plan.price || String(plan.priceText || '').match(/[\d.]+/)?.[0] || 0);
    const pointCount = Number(plan.points || String(plan.pointsText || '').match(/\d+/)?.[0] || 0);
    const profile = getRechargePlanProfile(priceValue);
    const textCount = Number(plan.textGenerations || 0) || Math.floor(pointCount / Math.max(1, pointCosts.text || 5));
    const singleImageCount = Number(plan.singleImageGenerations || plan.imageGenerations || 0) || Math.floor(pointCount / Math.max(1, pointCosts.singleImage || pointCost || 5));
    const sixImageCount = Number(plan.sixImageGenerations || 0) || Math.floor(pointCount / Math.max(1, pointCosts.sixImage || 30));
    const videoCount = Number(plan.motionGenerations || 0) || Math.floor(pointCount / Math.max(1, motionConfig.pointCost || 60));
    const imageUnitCost = Number(plan.imageUnitCost || 0) || (priceValue && sixImageCount ? priceValue / (sixImageCount * 6) : 0);
    const unitCost = Number(plan.motionUnitCost || 0) || (priceValue && videoCount ? priceValue / videoCount : 0);
    return {
      id: plan.id || `${plan.priceText || priceValue}-${plan.pointsText || pointCount}-${index}`,
      name: plan.name || profile.name || '',
      price: plan.priceText || (priceValue ? `${priceValue}元` : ''),
      priceValue,
      points: plan.pointsText || (pointCount ? `${pointCount}灵感值` : ''),
      pointCount,
      imageTextCount: sixImageCount,
      textCount,
      singleImageCount,
      sixImageCount,
      imageUnitCost,
      videoCount,
      unitCost,
      badge: plan.badge || profile.badge || '',
      description: plan.description || profile.description || '',
      durationText: plan.durationText || profile.durationText || '',
      featured: !!(plan.featured || profile.featured),
    };
  }

  const [price, points] = String(plan || '').split('=');
  const priceValue = Number(String(price || '').match(/[\d.]+/)?.[0] || 0);
  const pointCount = Number(String(points || '').match(/\d+/)?.[0] || 0);
  const textCount = Math.floor(pointCount / Math.max(1, pointCosts.text || 5));
  const singleImageCount = Math.floor(pointCount / Math.max(1, pointCosts.singleImage || pointCost || 5));
  const sixImageCount = Math.floor(pointCount / Math.max(1, pointCosts.sixImage || 30));
  const videoCount = Math.floor(pointCount / Math.max(1, motionConfig.pointCost || 60));
  const imageUnitCost = priceValue && sixImageCount ? priceValue / (sixImageCount * 6) : 0;
  const unitCost = priceValue && videoCount ? priceValue / videoCount : 0;
  const profile = getRechargePlanProfile(priceValue);
  return {
    id: `${String(price || '').trim()}-${String(points || '').trim()}-${index}`,
    name: profile.name || '',
    price,
    priceValue,
    points,
    pointCount,
    imageTextCount: sixImageCount,
    textCount,
    singleImageCount,
    sixImageCount,
    imageUnitCost,
    videoCount,
    unitCost,
    badge: profile.badge || '',
    description: profile.description || '',
    durationText: profile.durationText || '',
    featured: !!profile.featured,
  };
}

function rechargePlansForDisplay() {
  const structuredPlans = Array.isArray(siteInfo.rechargePlanItems) ? siteInfo.rechargePlanItems : [];
  const source = structuredPlans.length
    ? structuredPlans
    : (siteInfo.rechargePlans || '').split(';').filter(Boolean);
  return source
    .map(normalizeRechargePlan)
    .filter((plan) => plan.price && plan.pointCount > 0);
}

function supportContactsForDisplay() {
  const structuredContacts = Array.isArray(siteInfo.supportContacts) ? siteInfo.supportContacts : [];
  const contacts = structuredContacts
    .map((contact) => ({
      wechat: String(contact?.wechat || contact?.id || '').trim(),
      qr: String(contact?.qr || contact?.qrUrl || '').trim(),
    }))
    .filter((contact) => contact.wechat || contact.qr);
  if (contacts.length) return contacts;
  if (siteInfo.supportWechat || siteInfo.supportWechatQr) {
    return [{ wechat: siteInfo.supportWechat || '', qr: siteInfo.supportWechatQr || '' }];
  }
  return [];
}

function ledgerTypeLabel(type = '') {
  return {
    manual_recharge: '人工充值',
    manual_adjustment: '人工调整',
    generate: '生成扣点',
    refund: '失败返还',
    trial: '试用赠送',
    self_register_trial: '注册赠送',
  }[type] || type || '点数变动';
}

function formatShortDate(iso = '') {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

async function loadAccountLedgerIntoDialog() {
  const list = document.getElementById('accountLedgerList');
  if (!list || !currentUser) return;
  try {
    const response = await fetch(apiUrl('/api/account/ledger?limit=8'), { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || '流水读取失败');
    if (payload.user) {
      currentUser = payload.user;
      updateAccountUI();
    }
    const ledger = Array.isArray(payload.ledger) ? payload.ledger : [];
    if (!ledger.length) {
      list.innerHTML = '<div class="ledger-empty">暂无点数流水</div>';
      return;
    }
    list.innerHTML = ledger.map((entry) => {
      const points = Number(entry.points || 0);
      const pointsText = points > 0 ? `+${points}` : `${points}`;
      const pointClass = points >= 0 ? 'points-pos' : 'points-neg';
      const note = entry.planName || entry.note || ledgerTypeLabel(entry.type);
      return `
        <div class="ledger-row">
          <span>${escapeHtml(formatShortDate(entry.createdAt))}</span>
          <div class="ledger-note">
            <strong>${escapeHtml(ledgerTypeLabel(entry.type))}</strong>
            <span>${escapeHtml(note)}</span>
          </div>
          <span class="ledger-points ${pointClass}">${pointsText}</span>
        </div>
      `;
    }).join('');
  } catch (error) {
    list.innerHTML = `<div class="ledger-empty">${escapeHtml(error.message || '流水读取失败')}</div>`;
  }
}

function renderAccountLogsPrompt(message = '请先登录账号后查看点数日志。') {
  if (els.accountLogsSummary) {
    els.accountLogsSummary.innerHTML = '<span>当前可用</span><strong>--</strong>';
  }
  if (els.accountLogsMeta) {
    els.accountLogsMeta.innerHTML = `
      <div><span>账号</span><strong>未登录</strong></div>
      <div><span>单图消耗</span><strong>${pointCosts.singleImage || pointCost || 5} 灵感值 / 次</strong></div>
      <div><span>6图消耗</span><strong>${pointCosts.sixImage || 30} 灵感值 / 次</strong></div>
      <div><span>视频消耗</span><strong>${motionConfig.pointCost || 60} 灵感值 / 条</strong></div>
    `;
  }
  if (els.accountLogsList) els.accountLogsList.innerHTML = '';
  if (els.accountLogsEmpty) {
    els.accountLogsEmpty.classList.remove('hidden');
    els.accountLogsEmpty.innerHTML = `${escapeHtml(message)} <a href="${escapeHtml(appendPartnerParam('login.html?tab=login'))}" class="font-bold underline">去登录</a>`;
  }
}

function renderAccountLogs(payload = {}) {
  applyPointCosts(payload);
  const user = payload.user || currentUser;
  if (payload.user) {
    currentUser = payload.user;
    updateAccountUI();
  }
  if (!user) {
    renderAccountLogsPrompt();
    return;
  }

  if (els.accountLogsSummary) {
    els.accountLogsSummary.innerHTML = `
      <span>当前可用</span>
      <strong>${Number(user.points || 0)}</strong>
      <span>灵感值</span>
    `;
  }
  if (els.accountLogsMeta) {
    els.accountLogsMeta.innerHTML = `
      <div><span>账号</span><strong>${escapeHtml(displayAccountName(user))}</strong></div>
      <div><span>会员有效期</span><strong>${escapeHtml(formatMembershipExpiry(user))}</strong></div>
      <div><span>单图消耗</span><strong>${pointCosts.singleImage || pointCost || 5} 灵感值 / 次</strong></div>
      <div><span>6图消耗</span><strong>${pointCosts.sixImage || 30} 灵感值 / 次</strong></div>
      <div><span>视频消耗</span><strong>${motionConfig.pointCost || 60} 灵感值 / 条</strong></div>
    `;
  }

  const ledger = Array.isArray(payload.ledger) ? payload.ledger : [];
  if (els.accountLogsEmpty) {
    els.accountLogsEmpty.classList.toggle('hidden', ledger.length > 0);
    els.accountLogsEmpty.textContent = ledger.length ? '' : '暂无点数日志。';
  }
  if (!els.accountLogsList) return;
  els.accountLogsList.innerHTML = ledger.map((entry) => {
    const points = Number(entry.points || 0);
    const pointsText = points > 0 ? `+${points}` : `${points}`;
    const pointClass = points >= 0 ? 'pos' : 'neg';
    const note = entry.planName || entry.note || ledgerTypeLabel(entry.type);
    return `
      <article class="logs-row">
        <time>${escapeHtml(formatShortDate(entry.createdAt))}</time>
        <div>
          <strong>${escapeHtml(ledgerTypeLabel(entry.type))}</strong>
          <p>${escapeHtml(note)}</p>
        </div>
        <span class="logs-points ${pointClass}">${pointsText}</span>
      </article>
    `;
  }).join('');
}

async function loadAccountLogs() {
  if (!els.accountLogsList) return;
  if (accountRequired && !currentUser && !accessGranted) {
    renderAccountLogsPrompt();
    return;
  }
  if (els.accountLogsEmpty) {
    els.accountLogsEmpty.classList.remove('hidden');
    els.accountLogsEmpty.textContent = '正在读取点数日志...';
  }
  try {
    const response = await fetch(apiUrl('/api/account/ledger?limit=40'), { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) {
        currentUser = null;
        updateAccountUI();
        renderAccountLogsPrompt(payload.error || '请先登录账号后查看点数日志。');
        return;
      }
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    renderAccountLogs(payload);
  } catch (error) {
    if (els.accountLogsList) els.accountLogsList.innerHTML = '';
    if (els.accountLogsEmpty) {
      els.accountLogsEmpty.classList.remove('hidden');
      els.accountLogsEmpty.textContent = `点数日志读取失败：${error.message}`;
    }
  }
}

function showRechargeDialog() {
  ensureRechargeStyles();
  const existing = document.getElementById('rechargeOverlay');
  if (existing) existing.remove();
  const contacts = supportContactsForDisplay();
  const parsedPlans = rechargePlansForDisplay();
  const overlay = document.createElement('div');
  overlay.className = 'recharge-overlay';
  overlay.id = 'rechargeOverlay';
  let inner = '<div class="recharge-card">';
  inner += '<button type="button" class="recharge-close" aria-label="关闭">×</button>';
  inner += '<h3>购买灵感值</h3>';
  inner += '<p class="recharge-sub">灵感值可用于生成婚礼成品图、小红书文案和完整高清视频。付款后备注账号，确认后补充额度。</p>';
  if (currentUser) {
    inner += `<div class="recharge-status"><span>当前账号 <strong>${escapeHtml(displayAccountName(currentUser))}</strong></span><span>可用 <strong>${currentUser.points ?? 0}</strong> 灵感值</span><span>${escapeHtml(formatMembershipExpiry(currentUser))}</span></div>`;
  }
  if (parsedPlans.length) {
    inner += '<div class="plan-grid">';
    for (const plan of parsedPlans) {
      const badge = plan.badge ? `<span class="plan-badge">${escapeHtml(plan.badge)}</span>` : '';
      const unitHint = formatRechargeUnitCost(plan.unitCost);
      const singleImageHint = plan.singleImageCount ? `<em>约 ${plan.singleImageCount} 次单图</em>` : '';
      const imageTextHint = plan.sixImageCount ? `<em>约 ${plan.sixImageCount} 次 6图包</em>` : '';
      const imageUnitHint = plan.imageUnitCost ? `<em class="plan-image-unit">${escapeHtml(formatRechargeImageUnitCost(plan.imageUnitCost))}</em>` : '';
      const videoHint = plan.videoCount ? `<em>约 ${plan.videoCount} 条高清视频</em><em>${unitHint}</em>` : '';
      const durationHint = plan.durationText ? `<em>${escapeHtml(plan.durationText)}</em>` : '';
      const pointLabel = String(plan.points || '').replace(/^(\d+)(\S+)/, '$1 $2');
      const name = plan.name ? `<span class="plan-name">${escapeHtml(plan.name)}</span>` : '';
      const desc = plan.description ? `<span class="plan-desc">${escapeHtml(plan.description)}</span>` : '';
      inner += `<div class="plan-tile${plan.featured ? ' is-featured' : ''}">${badge}<strong>${escapeHtml(plan.price || '')}</strong>${name}<span>${escapeHtml(pointLabel)}</span>${durationHint}${singleImageHint}${imageTextHint}${imageUnitHint}${videoHint}${desc}</div>`;
    }
    inner += '</div>';
    inner += `<p class="recharge-note">${escapeHtml(pointCostSummaryText())}。生成失败自动返还。</p>`;
  }
  if (contacts.length) {
    inner += '<div class="support-contact-grid">';
    contacts.forEach((contact, index) => {
      inner += '<div class="support-contact">';
      inner += `<div class="support-contact-label">微信客服 ${index + 1}</div>`;
      if (contact.qr) {
        inner += `<div class="recharge-qr"><img src="${escapeHtml(contact.qr)}" alt="客服微信二维码 ${index + 1}"></div>`;
      }
      if (contact.wechat) {
        inner += `<div class="recharge-wechat">客服微信：<strong>${escapeHtml(contact.wechat)}</strong></div>`;
      }
      inner += '</div>';
    });
    inner += '</div>';
    inner += '<div class="recharge-tip">添加任意客服微信，备注账号，方便快速到账</div>';
  } else {
    inner += '<div class="recharge-warn">管理员尚未在 <code>.env</code> 里配置 <code>SUPPORT_WECHAT=你的微信号</code></div>';
  }
  if (currentUser) {
    inner += '<div class="ledger-panel"><div class="ledger-head"><strong>最近点数流水</strong><span>充值、扣点、返还都会记录</span></div><div class="ledger-list" id="accountLedgerList"><div class="ledger-empty">正在读取流水...</div></div></div>';
  }
  inner += '</div>';
  overlay.innerHTML = inner;
  document.body.appendChild(overlay);
  loadAccountLedgerIntoDialog();
  const close = () => overlay.remove();
  overlay.querySelector('.recharge-close').addEventListener('click', close);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  document.addEventListener('keydown', function onKey(event) {
    if (event.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  });
}

function showAuthNotice() {
  if (!currentUser) {
    location.href = appendPartnerParam('login.html?tab=register');
    return;
  }
  showRechargeDialog();
}

async function initAccessGate() {
  try {
    const response = await fetch(apiUrl('/api/access'), { cache: 'no-store' });
    if (!response.ok) throw new Error('access unavailable');
    const data = await response.json();
    accountRequired = !!data.accountRequired;
    currentUser = data.user || null;
    siteInfo.tenant = data.tenant || null;
    siteInfo.partner = data.partner || data.tenant?.slug || currentPartnerSlug();
    applySiteBrand(data.tenant);
    applyPointCosts(data);
    siteInfo.supportWechat = data.supportWechat || '';
    siteInfo.supportWechatQr = data.supportWechatQr || '';
    siteInfo.supportContacts = Array.isArray(data.supportContacts) ? data.supportContacts : [];
    siteInfo.rechargePlans = data.rechargePlans || '';
    siteInfo.rechargePlanItems = Array.isArray(data.rechargePlanItems) ? data.rechargePlanItems : [];
    accessGranted = !data.required || !!data.ok;
    updateAccountUI();
    if (!accessGranted) {
      if (accountRequired && !currentUser) {
        return false;
      }
      showAccessGate();
      return false;
    }
  } catch {
    accessGranted = true;
    updateAccountUI();
  }
  return accessGranted;
}

function setGenerating(isGenerating) {
  generationInProgress = isGenerating;
  const canClick = hasRequiredGeneratorInput() || (canResumeActiveJob && activeJobId);
  const idleText = {
    cinematic_storyboard: '生成电影感分镜图',
    similar_style: '生成类似婚礼',
    setup_comparison: '生成布置前后图',
    design_render_scene: '生成实景候选图',
    venue_fusion: '生成空地融合图',
    copy_title: '生成标题文案',
    motion_video: `一键生成连续转场视频（${motionConfig.pointCost || 60} 灵感值）`,
  }[selectedMode] || '开始生成';
  els.generateBtn.disabled = isGenerating || canResumeActiveJob || !canClick;
  els.generateBtn.textContent = isGenerating
    ? (selectedMode === 'copy_title'
        ? '正在写文案...'
        : (selectedMode === 'motion_video' ? '视频生成中（等待上游）...' : '正在生成中...'))
    : (canResumeActiveJob
      ? '自动继续中...'
      : idleText);
  els.restartBtn.textContent = isGenerating && activeJobId ? '停止生成' : '重新开始';
  $$('.mode-card').forEach((button) => { button.disabled = isGenerating; });
}

function filenameForItem(item, index) {
  return item.filename || `wedscene-shot-${String(index + 1).padStart(2, '0')}.jpg`;
}

function downloadUrlForAsset(url) {
  if (!url || url.startsWith('data:')) return url;
  try {
    const assetUrl = new URL(url, window.location.origin);
    const parts = assetUrl.pathname.split('/').filter(Boolean);
    if (assetUrl.origin === window.location.origin && parts[0] === 'generated' && parts.length >= 3) {
      return `/api/download/${encodeURIComponent(parts[1])}/${encodeURIComponent(parts[2])}`;
    }
  } catch {
    // Fall back to the original URL.
  }
  return url;
}

function inlineUrlForAsset(url) {
  if (!url || url.startsWith('data:')) return url;
  try {
    const assetUrl = new URL(url, window.location.origin);
    const parts = assetUrl.pathname.split('/').filter(Boolean);
    if (assetUrl.origin !== window.location.origin) return url;
    if (parts[0] === 'api' && parts[1] === 'download' && parts.length >= 4) {
      return `/generated/${encodeURIComponent(parts[2])}/${encodeURIComponent(parts[3])}`;
    }
    if (parts[0] === 'api' && parts[1] === 'resources' && parts[3] === 'download' && parts.length >= 5) {
      return `/my-resources/${encodeURIComponent(parts[2])}/${encodeURIComponent(parts[4])}`;
    }
  } catch {
    // Fall back to the original URL.
  }
  return url;
}

function absoluteAssetUrl(url) {
  if (!url) return '';
  try {
    return new URL(url, window.location.origin).href;
  } catch {
    return url;
  }
}

function mimeTypeForAsset(filename = '', kind = '') {
  const lower = String(filename || '').toLowerCase();
  if (kind === 'video' || lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function showSaveNotice(message) {
  if (!message) return;
  let notice = document.querySelector('.save-notice');
  if (!notice) {
    notice = document.createElement('div');
    notice.className = 'save-notice';
    document.body.appendChild(notice);
  }
  notice.textContent = message;
  notice.classList.add('show');
  window.clearTimeout(notice._timer);
  notice._timer = window.setTimeout(() => notice.classList.remove('show'), 2600);
}

function isMobileLikeDevice() {
  return Boolean(
    window.matchMedia?.('(pointer: coarse)').matches
    || /Android|iPhone|iPad|iPod|Mobile|Quark/i.test(navigator.userAgent || ''),
  );
}

async function copyTextToClipboard(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Use the textarea fallback below.
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  textarea.remove();
  return copied;
}

async function downloadAsset(url, filename) {
  if (!url) return;

  const anchor = document.createElement('a');
  anchor.href = downloadUrlForAsset(url);
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => anchor.remove(), 300);
}

async function downloadBlobAsset(url, filename, kind = 'video') {
  const href = downloadUrlForAsset(url);
  const response = await fetch(href, { credentials: 'include', cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  const typedBlob = blob.type ? blob : blob.slice(0, blob.size, mimeTypeForAsset(filename, kind));
  const objectUrl = URL.createObjectURL(typedBlob);
  try {
    downloadAsset(objectUrl, filename);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
  }
}

function closeVideoSavePanel() {
  const panel = document.querySelector('.video-save-panel');
  if (!panel) return;
  const closeOnEscape = panel._closeOnEscape;
  if (closeOnEscape) document.removeEventListener('keydown', closeOnEscape);
  panel.remove();
  document.body.classList.remove('video-save-panel-open');
}

function openVideoSavePanel(previewUrl, filename = 'wedscene-motion.mp4', downloadUrl = '') {
  const source = inlineUrlForAsset(previewUrl || downloadUrl);
  if (!source) return;
  const inlineHref = absoluteAssetUrl(source);
  const downloadHref = downloadUrlForAsset(downloadUrl || previewUrl || source);
  closeVideoSavePanel();

  const panel = document.createElement('div');
  panel.className = 'video-save-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', '视频保存');

  const sheet = document.createElement('div');
  sheet.className = 'video-save-sheet';

  const topbar = document.createElement('div');
  topbar.className = 'video-save-topbar';

  const title = document.createElement('div');
  title.className = 'video-save-title';
  title.textContent = '视频预览';

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'video-save-close';
  closeButton.textContent = '关闭';
  closeButton.addEventListener('click', closeVideoSavePanel);
  topbar.append(title, closeButton);

  const player = document.createElement('video');
  player.src = inlineHref;
  player.controls = true;
  player.playsInline = true;
  player.preload = 'metadata';

  const note = document.createElement('p');
  note.className = 'video-save-note';
  note.textContent = '浏览器如果拦截下载，可以打开原视频后用菜单下载。';

  const actions = document.createElement('div');
  actions.className = 'video-save-actions';

  const downloadButton = document.createElement('button');
  downloadButton.type = 'button';
  downloadButton.className = 'video-save-primary';
  downloadButton.textContent = '下载视频';
  downloadButton.addEventListener('click', async () => {
    showSaveNotice('正在准备下载，请稍等…');
    try {
      await downloadBlobAsset(downloadHref || inlineHref, filename, 'video');
      showSaveNotice('已开始下载');
    } catch {
      showSaveNotice('下载未弹出时，请打开原视频下载');
    }
  });

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'video-save-secondary';
  openButton.textContent = '打开原视频';
  openButton.addEventListener('click', () => {
    const opened = window.open(inlineHref, '_blank', 'noopener');
    if (!opened) window.location.href = inlineHref;
  });

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'video-save-secondary';
  copyButton.textContent = '复制链接';
  copyButton.addEventListener('click', async () => {
    const ok = await copyTextToClipboard(inlineHref);
    showSaveNotice(ok ? '已复制视频链接' : '复制失败，请打开原视频保存');
  });

  actions.append(downloadButton, openButton, copyButton);
  sheet.append(topbar, player, note, actions);
  panel.append(sheet);
  panel.addEventListener('click', (event) => {
    if (event.target === panel) closeVideoSavePanel();
  });
  panel._closeOnEscape = (event) => {
    if (event.key === 'Escape') closeVideoSavePanel();
  };
  document.addEventListener('keydown', panel._closeOnEscape);
  document.body.appendChild(panel);
  document.body.classList.add('video-save-panel-open');
}

async function saveAssetToDevice(url, filename, kind = 'image', options = {}) {
  if (!url) return;
  const href = downloadUrlForAsset(url);
  if (kind === 'video') {
    if (!isMobileLikeDevice()) {
      downloadAsset(options.downloadUrl || href, filename);
      return;
    }
    openVideoSavePanel(options.previewUrl || inlineUrlForAsset(url), filename, options.downloadUrl || href);
    return;
  }

  const canTryShare = typeof navigator !== 'undefined'
    && typeof navigator.share === 'function'
    && typeof window.File === 'function'
    && (window.matchMedia?.('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || ''));

  if (canTryShare) {
    try {
      const response = await fetch(href, { credentials: 'include' });
      if (response.ok) {
        const blob = await response.blob();
        const file = new File([blob], filename, { type: blob.type || mimeTypeForAsset(filename, kind) });
        if (!navigator.canShare || navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: filename });
          return;
        }
      }
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }

  downloadAsset(url, filename);
}

function createImageSaveLink(item, index) {
  const link = document.createElement('a');
  const kind = item.kind === 'video' ? 'video' : 'image';
  const filename = filenameForItem(item, index);
  link.className = 'tile-save';
  link.href = item.downloadUrl || downloadUrlForAsset(item.url);
  link.download = filename;
  link.textContent = kind === 'video' ? '下载视频' : '下载图片';
  link.setAttribute('aria-label', `${kind === 'video' ? '下载视频' : '下载图片'}${item.label || `生成图 ${index + 1}`}`);
  link.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    saveAssetToDevice(item.url || item.downloadUrl, filename, kind, { downloadUrl: item.downloadUrl });
  });
  return link;
}

function setResourceDeleteButtons(resourceId, disabled, text = '') {
  $$('.tile-delete').forEach((button) => {
    if (button.dataset.resourceId !== resourceId) return;
    button.disabled = disabled;
    button.textContent = text || '删除';
  });
}

async function deleteResource(resourceId) {
  if (!resourceId || deletingResourceIds.has(resourceId)) return;
  const confirmed = window.confirm('确定删除这组资源吗？本次生成的图片、视频、拼图和打包文件都会删除，删除后不可恢复。');
  if (!confirmed) return;

  deletingResourceIds.add(resourceId);
  setResourceDeleteButtons(resourceId, true, '删除中');

  try {
    const response = await fetch(apiUrl(`/api/resources/${encodeURIComponent(resourceId)}`), { method: 'DELETE' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

    lastResourceItems = lastResourceItems.filter((asset) => asset.resourceId !== resourceId);
    renderResourceItems(lastResourceItems);
    await loadResources();
  } catch (error) {
    alert(`删除失败：${error.message}`);
    setResourceDeleteButtons(resourceId, false);
  } finally {
    deletingResourceIds.delete(resourceId);
  }
}

let motionStyleModal = null;

function ensureMotionStyleModal() {
  if (motionStyleModal) return motionStyleModal;
  const overlay = document.createElement('div');
  overlay.className = 'motion-modal-overlay hidden';
  overlay.innerHTML = `
    <div class="motion-modal-card" role="dialog" aria-modal="true" aria-labelledby="motionModalTitle">
      <button class="motion-modal-close" type="button" aria-label="关闭">×</button>
      <div class="motion-modal-header">
        <span class="motion-modal-kicker">资源库 · 一键生成视频</span>
        <h3 id="motionModalTitle" class="motion-modal-title">一键生成连续转场视频</h3>
        <p class="motion-modal-meta">按镜头顺序选择 1-3 张图：第 1 张开场，第 2 张中段，第 3 张会作为最终画面。优先选择同场婚礼、同色系、同横竖比例、无人物水印的清晰图。</p>
      </div>
      <div class="motion-modal-source">
        <img alt="" />
        <div><strong></strong><span></span></div>
      </div>
      <div class="motion-modal-refs hidden">
        <div class="motion-modal-ref-head">
          <strong>可选后续镜头图</strong>
          <span>最多选 2 张：先选中段镜头，再选最终画面；第 3 张不想出现在结尾就不要选</span>
        </div>
        <div class="motion-modal-ref-grid"></div>
      </div>
      <div class="motion-modal-footer">
        <span class="motion-modal-status"></span>
        <button class="motion-modal-submit" type="button">一键生成连续转场视频（60 灵感值）</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  motionStyleModal = {
    overlay,
    card: overlay.querySelector('.motion-modal-card'),
    closeBtn: overlay.querySelector('.motion-modal-close'),
    img: overlay.querySelector('.motion-modal-source img'),
    sourceTitle: overlay.querySelector('.motion-modal-source strong'),
    sourceMeta: overlay.querySelector('.motion-modal-source span'),
    refWrap: overlay.querySelector('.motion-modal-refs'),
    refGrid: overlay.querySelector('.motion-modal-ref-grid'),
    submitBtn: overlay.querySelector('.motion-modal-submit'),
    statusEl: overlay.querySelector('.motion-modal-status'),
    item: null,
    referenceFilenames: [],
    style: DEFAULT_MOTION_STYLE,
  };
  motionStyleModal.closeBtn.addEventListener('click', closeMotionStyleModal);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeMotionStyleModal();
  });
  motionStyleModal.submitBtn.addEventListener('click', submitMotionFromResource);
  return motionStyleModal;
}

function openMotionStyleModal(item) {
  const modal = ensureMotionStyleModal();
  modal.item = item;
  modal.style = DEFAULT_MOTION_STYLE;
  modal.referenceFilenames = [];
  modal.img.src = item.url;
  modal.img.alt = item.label || '资源图';
  modal.sourceTitle.textContent = item.label || '资源图';
  modal.sourceMeta.textContent = `${motionConfig.durationSeconds || 8} 秒 · ${motionConfig.resolution || '4K'} · 每条 ${motionConfig.pointCost || 60} 灵感值`;
  modal.statusEl.textContent = '';
  modal.submitBtn.disabled = false;
  modal.submitBtn.textContent = `一键生成连续转场视频（${motionConfig.pointCost || 60} 灵感值）`;
  const candidateRefs = (item.resource?.images || [])
    .filter((image) => image.filename && image.filename !== item.filename)
    .slice(0, 12);
  const additionalReferenceLimit = Math.max(0, videoReferenceLimit() - 1);
  if (candidateRefs.length) {
    modal.refWrap.classList.remove('hidden');
    modal.refGrid.innerHTML = '';
    candidateRefs.forEach((image) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'motion-ref-btn';
      btn.dataset.filename = image.filename;
      btn.innerHTML = `
        <img src="${image.url || ''}" alt="" />
        <span>${image.label || image.filename || '后续镜头'}</span>
      `;
      btn.addEventListener('click', () => {
        const filename = btn.dataset.filename;
        const selected = modal.referenceFilenames.includes(filename);
        if (selected) {
          modal.referenceFilenames = modal.referenceFilenames.filter((name) => name !== filename);
        } else {
          if (modal.referenceFilenames.length >= additionalReferenceLimit) {
            modal.statusEl.textContent = `最多选择 ${additionalReferenceLimit} 张后续镜头图`;
            return;
          }
          modal.referenceFilenames.push(filename);
          modal.statusEl.textContent = '';
        }
        modal.refGrid.querySelectorAll('.motion-ref-btn').forEach((el) => {
          el.classList.toggle('active', modal.referenceFilenames.includes(el.dataset.filename));
        });
      });
      modal.refGrid.appendChild(btn);
    });
  } else {
    modal.refWrap.classList.add('hidden');
    modal.refGrid.innerHTML = '';
  }
  modal.overlay.classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function closeMotionStyleModal() {
  if (!motionStyleModal) return;
  motionStyleModal.overlay.classList.add('hidden');
  document.body.classList.remove('modal-open');
}

async function submitMotionFromResource() {
  if (!motionStyleModal?.item) return;
  const { item, referenceFilenames } = motionStyleModal;
  const resourceId = item.resourceId;
  const filename = item.filename;
  if (!resourceId || !filename) {
    motionStyleModal.statusEl.textContent = '资源信息不完整';
    return;
  }
  motionStyleModal.submitBtn.disabled = true;
  motionStyleModal.submitBtn.textContent = '提交中...';
  motionStyleModal.statusEl.textContent = '';
  try {
    const response = await fetch(apiUrl(`/api/resources/${encodeURIComponent(resourceId)}/motion-video`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, reference_filenames: referenceFilenames || [], partner: currentPartnerSlug() }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    if (data.user) { currentUser = data.user; updateAccountUI(); }
    closeMotionStyleModal();
    // 跳到 #video 页面，把任务交给独立的 video 工作流
    if (window.location.hash !== '#video') window.location.hash = 'video';
    showPage('video');
    videoState.jobId = data.id;
    videoState.style = DEFAULT_MOTION_STYLE;
    videoSetGenerating(true);
    videoSetProgress(8, '已扣点，视频任务已提交');
    videoRenderLogs([
      `[mode] 资源库一键生成 · ${MODE_CONFIG.motion_video.label}`,
      `[source] 取自资源库 ${resourceId} 的 ${filename}`,
      `[input] 资源库镜头图：开场 1 张${referenceFilenames?.length ? `，后续镜头 ${referenceFilenames.length} 张；按顺序做连续转场` : ''}`,
      `[queue] 任务 id=${data.id}`,
    ]);
    if (els.videoResultPanel) els.videoResultPanel.classList.add('hidden');
    pollVideoJob(data.id);
  } catch (error) {
    motionStyleModal.statusEl.textContent = error.message || '提交失败';
    motionStyleModal.submitBtn.disabled = false;
    motionStyleModal.submitBtn.textContent = `一键生成连续转场视频（${motionConfig.pointCost || 60} 灵感值）`;
  }
}

function createResourceMotionButton(item) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tile-motion';
  button.dataset.resourceId = item.resourceId || '';
  button.textContent = '生成视频';
  button.setAttribute('aria-label', `用这张图一键生成连续转场视频`);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openMotionStyleModal(item);
  });
  return button;
}

function createResourceDeleteButton(item) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tile-delete';
  button.dataset.resourceId = item.resourceId || '';
  button.textContent = '删除';
  button.setAttribute('aria-label', `删除${item.label || '这组资源'}`);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    deleteResource(item.resourceId);
  });
  return button;
}

let previewModal = null;
let previewModalImage = null;
let previewModalTitle = null;
let previewSaveBtn = null;

function ensurePreviewModal() {
  if (previewModal) return previewModal;

  previewModal = document.createElement('div');
  previewModal.className = 'image-modal hidden';
  previewModal.innerHTML = `
    <button class="image-modal-backdrop" type="button" aria-label="关闭预览"></button>
    <div class="image-modal-panel" role="dialog" aria-modal="true" aria-label="图片预览">
      <div class="image-modal-bar">
        <strong></strong>
        <div>
          <button class="image-modal-save" type="button">下载图片</button>
          <button class="image-modal-close" type="button" aria-label="关闭预览">关闭</button>
        </div>
      </div>
      <img alt="" />
    </div>
  `;
  document.body.appendChild(previewModal);
  previewModalImage = previewModal.querySelector('img');
  previewModalTitle = previewModal.querySelector('strong');
  previewSaveBtn = previewModal.querySelector('.image-modal-save');
  previewModal.querySelector('.image-modal-backdrop').addEventListener('click', closeImagePreview);
  previewModal.querySelector('.image-modal-close').addEventListener('click', closeImagePreview);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !previewModal.classList.contains('hidden')) closeImagePreview();
  });
  return previewModal;
}

function openImagePreview(item, index) {
  ensurePreviewModal();
  const title = item.label || `生成图 ${index + 1}`;
  previewModalTitle.textContent = title;
  previewModalImage.src = item.url;
  previewModalImage.alt = title;
  previewSaveBtn.onclick = () => saveAssetToDevice(item.downloadUrl || item.url, filenameForItem(item, index), 'image');
  previewModal.classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function closeImagePreview() {
  if (!previewModal) return;
  previewModal.classList.add('hidden');
  document.body.classList.remove('modal-open');
  previewModalImage.removeAttribute('src');
}

function wireImagePreview(tile, item, index) {
  tile.classList.add('can-preview');
  tile.tabIndex = 0;
  tile.setAttribute('role', 'button');
  tile.setAttribute('aria-label', `预览${item.label || `生成图 ${index + 1}`}`);
  tile.addEventListener('click', () => openImagePreview(item, index));
  tile.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openImagePreview(item, index);
    }
  });
}

function shouldShowOverview(mode) {
  return mode !== 'copy_title' && mode !== 'motion_video' && mode !== 'design_render_scene' && mode !== 'venue_fusion';
}

function renderMotionStyleButtons() {
  if (!els.motionStyleGrid) return;
  const styles = motionConfig.styles?.length ? motionConfig.styles : FALLBACK_MOTION_STYLES;
  if (!styles.find((s) => s.key === selectedMotionStyle)) {
    selectedMotionStyle = styles[0]?.key || DEFAULT_MOTION_STYLE;
  }
  els.motionStyleGrid.innerHTML = '';
  styles.forEach((style) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `motion-style-btn ${style.key === selectedMotionStyle ? 'active' : ''}`;
    btn.dataset.styleKey = style.key;
    btn.innerHTML = `<strong>${style.label}</strong><span>${style.description || ''}</span>`;
    btn.addEventListener('click', () => {
      selectedMotionStyle = style.key;
      els.motionStyleGrid.querySelectorAll('.motion-style-btn').forEach((el) => {
        el.classList.toggle('active', el.dataset.styleKey === selectedMotionStyle);
      });
    });
    els.motionStyleGrid.appendChild(btn);
  });
  if (els.motionPointHint) {
    els.motionPointHint.textContent = `每条 ${motionConfig.pointCost || 60} 灵感值 · ${motionConfig.durationSeconds || 8} 秒 · ${motionConfig.resolution || '4K'}`;
  }
}

function setMotionStyleVisibility(mode) {
  if (!els.motionStyleSection) return;
  const show = mode === 'motion_video';
  els.motionStyleSection.classList.toggle('hidden', !show);
  if (show && els.motionStyleGrid && !els.motionStyleGrid.childElementCount) {
    renderMotionStyleButtons();
  }
}

function imageCountForMode(mode) {
  return MODE_IMAGE_COUNTS[mode] ?? 6;
}

function aspectRatioForItem(item, mode = selectedMode) {
  if (item?.width && item?.height) return `${item.width} / ${item.height}`;
  if (mode === 'venue_fusion' && uploadedAspectRatio) return uploadedAspectRatio;
  if (mode === 'similar_style' && uploadedAspectRatio) return uploadedAspectRatio;
  if (mode === 'cinematic_storyboard' || mode === 'setup_comparison' || mode === 'design_render_scene') return '16 / 9';
  return '1 / 1';
}

function applyTileAspect(tile, item, mode = selectedMode) {
  tile.style.aspectRatio = aspectRatioForItem(item, mode);
}

function setOverviewVisible(isVisible) {
  if (els.resultOverview) {
    els.resultOverview.classList.toggle('hidden', !isVisible);
  }
  els.collageImg.parentElement.classList.toggle('hidden', !isVisible);
  els.downloadCollageBtn.classList.toggle('hidden', !isVisible);
}

function renderResultSlots(images = [], mode = selectedMode) {
  els.resultGrid.innerHTML = '';
  const total = imageCountForMode(mode);
  for (let index = 0; index < total; index += 1) {
    const item = images[index];
    const tile = document.createElement('div');
    tile.className = `result-tile ${item?.url ? 'ready' : 'placeholder'}`;
    applyTileAspect(tile, item, mode);

    if (item?.url) {
      const img = document.createElement('img');
      img.src = item.url;
      img.alt = item.label || `生成图 ${index + 1}`;
      tile.appendChild(img);
      tile.appendChild(createImageSaveLink(item, index));
      wireImagePreview(tile, item, index);
    }

    const label = document.createElement('span');
    label.textContent = item?.label || `生成中 ${index + 1}`;
    tile.appendChild(label);
    els.resultGrid.appendChild(tile);
  }
}

function setDemoBanner(visible, reason) {
  let banner = document.getElementById('demoModeBanner');
  if (!visible) {
    if (banner) banner.remove();
    return;
  }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'demoModeBanner';
    banner.style.cssText = [
      'grid-column: 1 / -1',
      'background: linear-gradient(90deg, #fef3c7, #fde68a)',
      'border: 1px solid #d97706',
      'color: #78350f',
      'padding: 0.75rem 1rem',
      'border-radius: 0.6rem',
      'font-size: 0.85rem',
      'line-height: 1.5',
      'font-weight: 600',
      'box-shadow: 0 4px 12px -4px rgba(217,119,6,0.35)',
    ].join(';');
    els.resultPanel.insertBefore(banner, els.resultPanel.firstChild);
  }
  banner.innerHTML = `⚠️ <strong>当前是离线演示模式</strong>，下面这些镜头不是真实生成的婚礼图，是抽象占位图。原因：${reason || '后端未连接或返回演示模式'}。请检查 <code style="background:rgba(120,53,15,0.12);padding:1px 4px;border-radius:3px;">npm.cmd start</code> 是否在跑、<code style="background:rgba(120,53,15,0.12);padding:1px 4px;border-radius:3px;">.env</code> 里 <code style="background:rgba(120,53,15,0.12);padding:1px 4px;border-radius:3px;">OPENAI_API_KEY</code> 是否配置，然后<strong>刷新页面</strong>重试。`;
}

function prepareResultPlaceholders() {
  els.resultPanel.classList.remove('hidden');
  els.resultPanel.dataset.mode = selectedMode;
  setDemoBanner(false);
  if (els.overviewKicker && els.overviewTitle) {
    const copyOnly = selectedMode === 'copy_title';
    const setupComparison = selectedMode === 'setup_comparison';
    const designRender = selectedMode === 'design_render_scene';
    const venueFusion = selectedMode === 'venue_fusion';
    els.overviewKicker.textContent = copyOnly ? '文案结果' : (setupComparison ? '3:4 对比图' : (designRender ? '真实现场候选图' : (venueFusion ? '融合结果' : '合成预览')));
    els.overviewTitle.textContent = copyOnly
      ? '爆款标题文案'
      : (setupComparison ? '布置前后对比图' : (designRender ? '4 张现场候选图' : (venueFusion ? '空地婚礼融合图' : '分镜总览 / 爆款首图')));
  }
  renderResultSlots([], selectedMode);
  const showOverview = shouldShowOverview(selectedMode);
  setOverviewVisible(showOverview);
  els.collageImg.removeAttribute('src');
  els.collageImg.parentElement.classList.toggle('pending', showOverview);
  els.downloadCollageBtn.removeAttribute('href');
  els.downloadAllBtn.classList.add('hidden');
  els.copyTitle.textContent = selectedMode === 'copy_title' ? '生成完成后显示标题文案' : '生成完成后显示发布文案';
  els.copyBody.value = '';
  els.copyTags.innerHTML = '';
  if (els.motionResult) {
    els.motionResult.classList.toggle('hidden', selectedMode !== 'motion_video');
  }
  if (els.motionVideo) {
    els.motionVideo.removeAttribute('src');
    els.motionVideo.removeAttribute('poster');
    try { els.motionVideo.load(); } catch {}
  }
  if (els.motionDownloadBtn) {
    els.motionDownloadBtn.classList.add('hidden');
    els.motionDownloadBtn.removeAttribute('href');
  }
  if (els.motionVideoMeta) els.motionVideoMeta.textContent = '';
}

async function startGeneration() {
  if (!accessGranted) {
    showAccessGate('请先输入公测访问码');
    return;
  }

  if (!hasRequiredGeneratorInput()) {
    const message = isVenueFusionMode()
      ? '请先上传空地照片和婚礼素材图'
      : '请先上传素材';
    setProgress(0, message);
    appendLog(`[input] ${message}`);
    return;
  }
  const requiredPoints = Math.max(1, pointCostForMode(selectedMode));
  if (accountRequired && (!currentUser || Number(currentUser.points || 0) < requiredPoints)) {
    setProgress(0, '点数不足，请联系管理员充值');
    showAuthNotice();
    return;
  }

  localRunId += 1;
  activeJobId = null;
  canResumeActiveJob = false;
  autoResumeAttempts = 0;
  window.clearTimeout(activePollTimer);
  clearAutoResumeTimer();
  setGenerating(true);
  prepareResultPlaceholders();
  setProgress(18, '正在创建生成任务');
  renderLogs([
    `[mode] ${MODE_CONFIG[selectedMode].label}`,
    isVenueFusionMode() ? '[queue] 正在上传空地和婚礼素材并创建融合任务' : '[queue] 正在上传参考图并创建任务',
  ]);

  const formData = new FormData();
  formData.append('image', uploadedFile, uploadedFile.name || (isVenueFusionMode() ? 'empty-venue.png' : 'wedding-scene.png'));
  if (isVenueFusionMode() && uploadedFusionFile) {
    formData.append('wedding_image', uploadedFusionFile, uploadedFusionFile.name || 'wedding-material.png');
  }
  formData.append('mode', selectedMode);
  if (currentPartnerSlug()) formData.append('partner', currentPartnerSlug());
  if (selectedMode === 'motion_video') {
    formData.append('motion_style', selectedMotionStyle || DEFAULT_MOTION_STYLE);
  }

  try {
    const response = await fetch(apiUrl('/api/jobs'), { method: 'POST', body: formData });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    if (data.user) {
      currentUser = data.user;
      updateAccountUI();
    }
    activeJobId = data.id;
    setGenerating(true);
    appendLog(`[job] 任务 ${data.id} 已创建`);
    pollJob(data.id);
  } catch (error) {
    await checkApiHealth();
    if (apiProvider !== 'mock') {
      setGenerating(false);
      const message = cleanErrorMessage(error.message);
      setProgress(0, `真实生图接口连接失败：${message}`);
      appendLog(`[error] ${message}`);
      return;
    }
    const message = cleanErrorMessage(error.message);
    appendLog('[fallback] 后端暂不可用，切换本地演示流程（不是真实生成）');
    setDemoBanner(true, `后端 /api/jobs 调用失败：${message}`);
    runClientMock(localRunId);
  }
}

async function resumeGeneration() {
  if (!activeJobId) return;
  if (!accessGranted) {
    showAccessGate('请先输入公测访问码');
    return;
  }

  localRunId += 1;
  window.clearTimeout(activePollTimer);
  clearAutoResumeTimer();
  canResumeActiveJob = false;
  setGenerating(true);
  setProgress(Number.parseInt(els.overallProgress.textContent, 10) || 22, '系统正在自动继续生成');
  appendLog('[auto] 自动继续未完成的镜头');

  try {
    const response = await fetch(apiUrl(`/api/jobs/${activeJobId}/resume`), { method: 'POST' });
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const payload = await response.json();
        if (payload?.error) message = payload.error;
      } catch {
        // Keep the HTTP status as the fallback error.
      }
      throw new Error(message);
    }
    pollJob(activeJobId);
  } catch (error) {
    canResumeActiveJob = !/不能继续|不存在|重新上传/.test(error.message);
    const message = cleanErrorMessage(error.message);
    setGenerating(false);
    setProgress(Number.parseInt(els.overallProgress.textContent, 10) || 0, `自动继续失败：${message}`);
    appendLog(`[error] ${message}`);
  }
}

async function stopGeneration() {
  if (!activeJobId) {
    resetWorkflow();
    return;
  }

  const jobId = activeJobId;
  clearAutoResumeTimer();
  window.clearTimeout(activePollTimer);
  canResumeActiveJob = false;
  setProgress(Number.parseInt(els.overallProgress.textContent, 10) || 0, '正在停止生成，避免继续提交图片');
  appendLog('[cancel] 正在停止生成，未开始的图片不会继续提交');
  els.restartBtn.disabled = true;

  try {
    const response = await fetch(apiUrl(`/api/jobs/${jobId}/cancel`), { method: 'POST' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    if (payload.user) {
      currentUser = payload.user;
      updateAccountUI();
    }
    if (Array.isArray(payload.partialImages)) renderResultSlots(payload.partialImages, selectedMode);
    setProgress(Number.parseInt(els.overallProgress.textContent, 10) || 0, payload.stage || '已停止生成');
    appendLog('[cancel] 已停止，后续图片不会再提交');
  } catch (error) {
    const message = cleanErrorMessage(error.message);
    setProgress(Number.parseInt(els.overallProgress.textContent, 10) || 0, `停止失败：${message}`);
    appendLog(`[error] 停止失败：${message}`);
  } finally {
    activeJobId = null;
    setGenerating(false);
    els.restartBtn.disabled = false;
  }
}

function handleRestartClick() {
  if (generationInProgress || activeJobId) {
    stopGeneration();
    return;
  }
  resetWorkflow();
}

async function pollJob(jobId, retry = 0) {
  try {
    const response = await fetch(apiUrl(`/api/jobs/${jobId}`), { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const job = await response.json();
    if (job.user) {
      currentUser = job.user;
      updateAccountUI();
    }
    renderLogs(job.logs);
    if (Array.isArray(job.partialImages)) renderResultSlots(job.partialImages, job.mode || selectedMode);
    setProgress(job.progress || 0, job.stage || '任务进行中');

    if (job.status === 'completed') {
      canResumeActiveJob = false;
      autoResumeAttempts = 0;
      clearAutoResumeTimer();
      setGenerating(false);
      renderResult(job.result);
      return;
    }

    if (job.status === 'cancelled') {
      canResumeActiveJob = false;
      autoResumeAttempts = 0;
      clearAutoResumeTimer();
      setGenerating(false);
      activeJobId = null;
      setProgress(job.progress || 0, job.stage || '已停止生成');
      appendLog('[cancel] 任务已停止，未提交后续图片');
      return;
    }

    if (job.status === 'failed') {
      const jobError = cleanErrorMessage(job.error || '生成失败');
      canResumeActiveJob = !!job.canResume;
      const keptCount = Array.isArray(job.partialImages) ? job.partialImages.length : 0;
      const totalCount = imageCountForMode(job.mode || selectedMode);
      if (canResumeActiveJob) {
        const canAutoResume = (job.retryable || isTransientGenerationError(jobError)) && autoResumeAttempts < MAX_AUTO_RESUME_ATTEMPTS;
        if (canAutoResume) {
          setGenerating(true);
          setProgress(job.progress || 0, `检测到接口超时，系统正在自动继续生成（${autoResumeAttempts + 1}/${MAX_AUTO_RESUME_ATTEMPTS}）`);
          appendLog(keptCount >= totalCount
            ? `[auto] ${totalCount}/${totalCount} 张已保留，自动完成打包`
            : `[auto] 已保留 ${keptCount}/${totalCount} 张，自动继续生成剩余图片`);
          autoResumeAttempts += 1;
          clearAutoResumeTimer();
          autoResumeTimer = window.setTimeout(() => {
            if (activeJobId === jobId && canResumeActiveJob) resumeGeneration();
          }, AUTO_RESUME_DELAY);
        } else {
          canResumeActiveJob = false;
          setGenerating(false);
          setProgress(job.progress || 0, isTransientGenerationError(jobError)
            ? '接口连续超时，已保留当前已生成图片，请稍后重新生成'
            : `生成失败：${jobError || '请重试'}`);
          appendLog(`[error] ${jobError || '生成失败'}`);
        }
      } else {
        canResumeActiveJob = false;
        setProgress(job.progress || 0, `生成失败：${jobError || '请重试'}`);
        setGenerating(false);
      }
      return;
    }

    activePollTimer = window.setTimeout(() => pollJob(jobId, 0), POLL_INTERVAL);
  } catch (error) {
    const message = cleanErrorMessage(error.message);
    if (activeJobId === jobId && isTransientPollingError(message) && retry < MAX_POLL_RECONNECT_ATTEMPTS) {
      setGenerating(true);
      setProgress(Number.parseInt(els.overallProgress.textContent, 10) || 0, `生成状态连接波动，正在重新获取进度（${retry + 1}/${MAX_POLL_RECONNECT_ATTEMPTS}）`);
      if (retry === 0) appendLog(`[retry] 进度连接临时中断：${message}，正在重连`);
      activePollTimer = window.setTimeout(() => pollJob(jobId, retry + 1), 2000);
      return;
    }
    setGenerating(false);
    setProgress(Number.parseInt(els.overallProgress.textContent, 10) || 0, `生成状态连接中断：${message}`);
    appendLog(`[error] ${message}`);
  }
}

function mockTileSvg(index, mode) {
  const palettes = {
    cinematic_storyboard: ['#101014', '#f0c2b5', '#d4b46e', '#f7a8a8'],
    multi_angle: ['#19131a', '#f0c2b5', '#d4b46e', '#7dd3fc'],
    detail_pack: ['#141016', '#f5c5db', '#f4d4c5', '#a7f3d0'],
    similar_style: ['#10131a', '#c7d2fe', '#f0c2b5', '#d4b46e'],
    setup_comparison: ['#1d1d20', '#f0c2b5', '#d4b46e', '#a7f3d0'],
    design_render_scene: ['#111116', '#f0c2b5', '#d4b46e', '#7dd3fc'],
    venue_fusion: ['#101513', '#f0c2b5', '#d4b46e', '#9bd5c3'],
  }[mode] || ['#141016', '#f0c2b5', '#d4b46e', '#7dd3fc'];
  const [bg, rose, gold, accent] = palettes;
  const offset = index * 37;
  let width = (mode === 'cinematic_storyboard' || mode === 'setup_comparison' || mode === 'design_render_scene') ? 1536 : 1024;
  let height = (mode === 'cinematic_storyboard' || mode === 'setup_comparison' || mode === 'design_render_scene') ? 864 : 1024;
  if ((mode === 'similar_style' || mode === 'venue_fusion') && uploadedAspectRatio) {
    const [ratioW, ratioH] = uploadedAspectRatio.split('/').map((part) => Number(part.trim()));
    if (ratioW && ratioH) {
      if (ratioW >= ratioH) {
        width = 1280;
        height = Math.round((1280 * ratioH) / ratioW);
      } else {
        height = 1280;
        width = Math.round((1280 * ratioW) / ratioH);
      }
    }
  }
  return svgToDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1024 1024" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${bg}"/>
          <stop offset="1" stop-color="#09090b"/>
        </linearGradient>
        <radialGradient id="halo" cx="${42 + index * 6}%" cy="${28 + index * 5}%" r="60%">
          <stop offset="0" stop-color="${rose}" stop-opacity="0.5"/>
          <stop offset="1" stop-color="${rose}" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="1024" height="1024" fill="url(#bg)"/>
      <rect width="1024" height="1024" fill="url(#halo)"/>
      <path d="M80 884L360 436H664L944 884Z" fill="#0d0d13" opacity="0.88"/>
      <path d="M${260 + offset % 90} 760C${260 + offset % 90} 420 ${760 - offset % 80} 420 ${760 - offset % 80} 760" fill="none" stroke="${rose}" stroke-width="${26 + index * 2}" stroke-linecap="round" opacity="0.9"/>
      <path d="M310 800H714" stroke="${gold}" stroke-width="22" stroke-linecap="round" opacity="0.62"/>
      ${Array.from({ length: 18 }, (_, i) => {
        const x = 180 + (i % 6) * 130 + (index % 2) * 18;
        const y = 650 + Math.floor(i / 6) * 75;
        return `<rect x="${x}" y="${y}" width="54" height="44" rx="10" fill="#fff7ed" opacity="${0.12 + (i % 3) * 0.04}"/>`;
      }).join('')}
      ${Array.from({ length: 18 }, (_, i) => {
        const x = 280 + (i % 9) * 58 + (index % 3) * 16;
        const y = 580 + Math.floor(i / 9) * 72;
        return `<circle cx="${x}" cy="${y}" r="${17 + (i % 4) * 4}" fill="${i % 2 ? rose : gold}" opacity="0.86"/>`;
      }).join('')}
      <path d="M240 365C390 310 620 310 784 365" fill="none" stroke="${accent}" stroke-width="5" stroke-linecap="round" stroke-dasharray="1 26" opacity="0.82"/>
      <circle cx="360" cy="328" r="7" fill="#fde68a"/>
      <circle cx="512" cy="306" r="8" fill="#fde68a"/>
      <circle cx="664" cy="328" r="7" fill="#fde68a"/>
    </svg>
  `);
}

async function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

async function buildClientCollage(images) {
  if (selectedMode === 'setup_comparison') {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1440;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const labelH = 92;
    const halfH = canvas.height / 2;
    const imageH = halfH - labelH;
    const [designImage, liveImage] = await Promise.all([
      loadImage(images[0]?.url),
      loadImage(uploadedDataUrl || images[0]?.url),
    ]);
    const drawCover = (image, x, y, width, height) => {
      const scale = Math.max(width / image.width, height / image.height);
      const sw = width / scale;
      const sh = height / scale;
      const sx = (image.width - sw) / 2;
      const sy = (image.height - sh) / 2;
      ctx.drawImage(image, sx, sy, sw, sh, x, y, width, height);
    };
    const drawLabel = (text, y) => {
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, y, canvas.width, labelH);
      ctx.fillStyle = '#fff';
      ctx.font = '700 58px "Microsoft YaHei", "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, canvas.width / 2, y + labelH / 2 + 4);
    };

    drawLabel('布置前现场图', 0);
    drawCover(liveImage, 0, labelH, canvas.width, imageH);
    drawLabel('布置后效果图', halfH);
    drawCover(designImage, 0, halfH + labelH, canvas.width, imageH);
    return canvas.toDataURL('image/jpeg', 0.92);
  }

  if (selectedMode === 'cinematic_storyboard') {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1440;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f6f0ec';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const gap = 18;
    const pad = 28;
    const cellW = (canvas.width - pad * 2 - gap) / 2;
    const cellH = (canvas.height - pad * 2 - gap * 2) / 3;
    const loaded = await Promise.all(images.map((item) => loadImage(item.url)));

    loaded.forEach((image, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = pad + col * (cellW + gap);
      const y = pad + row * (cellH + gap);
      const scale = Math.max(cellW / image.width, cellH / image.height);
      const sw = cellW / scale;
      const sh = cellH / scale;
      const sx = (image.width - sw) / 2;
      const sy = (image.height - sh) / 2;
      ctx.drawImage(image, sx, sy, sw, sh, x, y, cellW, cellH);
    });

    return canvas.toDataURL('image/jpeg', 0.92);
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1440;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f6ded5';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const gap = 20;
  const pad = 28;
  const cellW = (canvas.width - pad * 2 - gap) / 2;
  const cellH = (canvas.height - pad * 2 - gap * 2) / 3;
  const loaded = await Promise.all(images.map((item) => loadImage(item.url)));

  loaded.forEach((image, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = pad + col * (cellW + gap);
    const y = pad + row * (cellH + gap);
    const scale = Math.max(cellW / image.width, cellH / image.height);
    const sw = cellW / scale;
    const sh = cellH / scale;
    const sx = (image.width - sw) / 2;
    const sy = (image.height - sh) / 2;
    ctx.save();
    roundRect(ctx, x, y, cellW, cellH, 18);
    ctx.clip();
    ctx.drawImage(image, sx, sy, sw, sh, x, y, cellW, cellH);
    ctx.restore();
  });

  return canvas.toDataURL('image/jpeg', 0.92);
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function createCopy(mode) {
  const config = MODE_CONFIG[mode];
  if (mode === 'cinematic_storyboard') {
    return {
      title: '紫白花艺配镜面通道很出片✨',
      body: `这场现场最抓人的地方，是紫白花艺、镜面通道和舞台灯光之间的层次。两侧花艺顺着通道往仪式区延伸，镜面反光把灯线和花材都拉得更有纵深。\n\n如果喜欢这种电影感画面，可以重点参考“主色明确、通道干净、灯光集中”的处理方式。大景负责第一眼，通道和舞台的比例关系会决定整组照片有没有记忆点。`,
      tags: config.tags,
    };
  }

  if (mode === 'similar_style') {
    return {
      title: '同色系婚礼可以这样找灵感～',
      body: `想参考同色系婚礼，可以先抓住主色、花艺比例、舞台关系和灯光氛围，再看通道和桌景要不要延续同一组元素。\n\n只要这几个方向稳定，后面无论换成通道、仪式区还是桌景，都能保持同一种调性。新人收藏后和策划师沟通，也能更快说清楚自己喜欢哪一部分。`,
      tags: config.tags,
    };
  }

  if (mode === 'multi_angle') {
    return {
      title: '同一场婚礼换角度也很出片～',
      body: `婚礼现场不只大景值得看，通道、花艺、灯光和桌面关系放在一起，整场案例会更完整。\n\n这种发布方式很适合记录一场真实婚礼：先看空间和主色，再看花材密度、灯光走向和局部质感。新人收藏的时候也更容易判断，自己喜欢的是色系、结构，还是某一个细节。`,
      tags: config.tags,
    };
  }

  if (mode === 'detail_pack') {
    return {
      title: '婚礼现场好不好看细节很关键～',
      body: `一场婚礼的记忆点，很多时候藏在近处的花材、灯光、布幔和桌面材质里。大景负责第一眼的氛围，细节决定新人愿不愿意多看几秒。\n\n备婚参考时可以多留意这些地方：花艺有没有层次，灯光是不是干净，材质和色系能不能接上。把这些细节拍清楚，整场案例会更像一套完整作品。`,
      tags: config.tags,
    };
  }

  if (mode === 'setup_comparison') {
    return {
      title: '同一场地布置前后真的很有反差！',
      body: `同一个场地，布置前后放在一起看会更直观。空场时先看空间结构和动线，完成后再看花艺、灯光和通道关系，整个婚礼氛围一下就清楚了。\n\n备婚参考这种对比图很实用：不要只看完成图有多热闹，也要看原本场地适不适合自己的主色和布置体量。反差越清楚，越容易判断方案落地后的效果。`,
      tags: config.tags,
    };
  }

  if (mode === 'design_render_scene') {
    return {
      title: '效果图转成实景后会很有画面感✨',
      body: `把设计图转成真实现场视角后，重点就更清楚了：色系、花艺比例、灯光走向、舞台和通道关系都能提前看到落地后的感觉。\n\n提案沟通时这种现场候选图很实用，不用只靠平面效果图想象。客户可以直接看空间氛围、材质质感和整体层次，再决定哪一版更适合后续深化。`,
      tags: config.tags,
    };
  }

  if (mode === 'venue_fusion') {
    return {
      title: '空地落成婚礼现场很有画面感✨',
      body: `把婚礼素材落到真实空地里以后，场地能不能承接舞台、通道、花艺和灯光关系就更直观了。先看空间动线，再看主色和布置体量，客户沟通时会更容易判断方向。\n\n这种融合效果很适合做方案前期沟通：不用只靠想象空地完成后的样子，可以直接看风格、比例和背景环境是否合拍，再决定后续深化。`,
      tags: config.tags,
    };
  }

  if (mode === 'copy_title') {
    return {
      title: '奶白花艺配水晶灯像电影截图✨',
      body: `把这场婚礼的色系、花艺和灯光关系都记下来：奶白花艺顺着仪式区往通道延展，水晶灯和暖光落在镜面地面上，画面又安静又有质感。\n\n如果你也在备婚，可以重点参考主色和花艺的搭配方式。通道、灯光和舞台比例先统一，照片里会更容易出现干净的纵深感。\n\n这种调性很适合喜欢柔和光影的新娘收藏，后期选片时大景、侧面和近景都能接成一组。`,
      tags: config.tags,
    };
  }

  return {
    title: config.title,
    body: `婚礼现场好不好看，很多时候取决于主色、花艺、灯光和空间层次是不是统一。\n\n发布案例时，不用把话说得太满，抓住画面里最有记忆点的颜色、材质和通道关系，就能让新人更快判断这是不是自己喜欢的调性。`,
    tags: config.tags,
  };
}

async function runClientMock(runId) {
  setGenerating(true);
  const generateLog = selectedMode === 'cinematic_storyboard'
    ? '[generate] 生成 6 个电影感分镜镜头'
    : selectedMode === 'copy_title'
      ? '[copy] 根据婚礼照片生成标题正文和标签'
      : selectedMode === 'setup_comparison'
        ? '[generate] 生成 1 张婚礼布置后效果图'
      : selectedMode === 'design_render_scene'
        ? '[generate] 生成 4 张真实现场候选图'
      : selectedMode === 'venue_fusion'
        ? '[generate] 融合空地和婚礼素材'
        : '[generate] 生成 6 张类似婚礼参考图';
  const stages = [
    [28, '[analyze] 提取场地结构、色系和花艺风格'],
    [46, generateLog],
    [68, selectedMode === 'setup_comparison'
      ? '[compose] 拼接 3:4 布置前后对比图'
      : (selectedMode === 'design_render_scene'
          ? '[select] 保留 4 张真实现场候选图'
          : (selectedMode === 'venue_fusion' ? '[select] 保留 1 张空地融合效果图' : '[compose] 统一比例、裁切和视觉节奏'))],
    [88, '[copy] 生成标题、正文和话题标签'],
    [100, '[done] 演示发布包已就绪'],
  ];

  for (const [progress, log] of stages) {
    if (runId !== localRunId) return;
    await new Promise((resolve) => window.setTimeout(resolve, 520));
    appendLog(log);
    setProgress(progress, progress === 100 ? '发布包已生成' : '演示生成中');
  }

  const total = imageCountForMode(selectedMode);
  const images = Array.from({ length: total }, (_, index) => {
    const url = mockTileSvg(index, selectedMode);
    const [ratioW, ratioH] = aspectRatioForItem(null, selectedMode).split('/').map((part) => Number(part.trim()));
    return {
    label: (selectedMode === 'cinematic_storyboard'
      ? ['建立场大远景', '主视觉中景', '花艺特写', '灯光空间细节', '通道低机位', '道具前景虚化']
      : selectedMode === 'setup_comparison'
        ? ['布置后效果图']
      : selectedMode === 'design_render_scene'
        ? ['主视觉全景', '真实宴会厅版', '灯光氛围版', '客户沟通清晰版']
      : selectedMode === 'venue_fusion'
        ? ['空地融合婚礼效果图']
      : ['类似婚礼 1', '类似婚礼 2', '类似婚礼 3', '类似婚礼 4', '类似婚礼 5', '类似婚礼 6'])[index],
      url,
      width: ratioW || undefined,
      height: ratioH || undefined,
    };
  });
  const collageUrl = selectedMode === 'copy_title' || selectedMode === 'design_render_scene' || selectedMode === 'venue_fusion' ? '' : await buildClientCollage(images);
  renderResult({
    mode: selectedMode,
    images,
    items: images,
    collageUrl,
    copy: createCopy(selectedMode),
    mock: true,
  });
  setGenerating(false);
}

function renderResult(result) {
  const mode = result.mode || selectedMode;
  els.resultPanel.dataset.mode = mode;
  if (els.overviewKicker && els.overviewTitle) {
    const copyOnly = mode === 'copy_title';
    const setupComparison = mode === 'setup_comparison';
    const designRender = mode === 'design_render_scene';
    const venueFusion = mode === 'venue_fusion';
    els.overviewKicker.textContent = copyOnly ? '文案结果' : (setupComparison ? '3:4 对比图' : (designRender ? '真实现场候选图' : (venueFusion ? '融合结果' : '合成预览')));
    els.overviewTitle.textContent = copyOnly
      ? '爆款标题文案'
      : (setupComparison ? '布置前后对比图' : (designRender ? '4 张现场候选图' : (venueFusion ? '空地婚礼融合图' : '分镜总览 / 爆款首图')));
  }
  els.resultGrid.innerHTML = '';
  const resultImages = Array.isArray(result.images) ? result.images : [];
  resultImages.forEach((item, index) => {
    const tile = document.createElement('div');
    tile.className = 'result-tile ready';
    applyTileAspect(tile, item, result.mode || selectedMode);
    const img = document.createElement('img');
    img.src = item.url;
    img.alt = item.label || `生成图 ${index + 1}`;
    const label = document.createElement('span');
    label.textContent = item.label || `图 ${index + 1}`;
    tile.append(img, createImageSaveLink(item, index), label);
    wireImagePreview(tile, item, index);
    els.resultGrid.appendChild(tile);
  });

  const showOverview = shouldShowOverview(mode) && !!result.collageUrl;
  setOverviewVisible(showOverview);
  if (showOverview) {
    els.collageImg.src = result.collageUrl;
    els.downloadCollageBtn.href = result.collageDownloadUrl || result.collageUrl;
  } else {
    els.collageImg.removeAttribute('src');
    els.downloadCollageBtn.removeAttribute('href');
  }
  els.collageImg.parentElement.classList.remove('pending');
  // 视频模式渲染：用 result.videoUrl + posterUrl
  const isMotion = (result.mode || selectedMode) === 'motion_video';
  if (els.motionResult) {
    els.motionResult.classList.toggle('hidden', !isMotion);
  }
  if (isMotion && els.motionVideo) {
    const videoSrc = result.videoUrl || result.resource?.videoUrl || '';
    const posterSrc = result.videoPosterUrl || result.resource?.motionPosterUrl || '';
    if (videoSrc) {
      els.motionVideo.src = videoSrc;
      if (posterSrc) els.motionVideo.poster = posterSrc;
      else els.motionVideo.removeAttribute('poster');
    } else {
      els.motionVideo.removeAttribute('src');
      els.motionVideo.removeAttribute('poster');
    }
    if (els.motionDownloadBtn) {
      const downloadHref = result.videoDownloadUrl || result.resource?.videoDownloadUrl || videoSrc || '#';
      els.motionDownloadBtn.href = downloadHref;
      els.motionDownloadBtn.download = `wedscene-motion-${result.motionStyle || 'shot'}.mp4`;
      els.motionDownloadBtn.textContent = '下载视频';
      els.motionDownloadBtn.classList.toggle('hidden', !videoSrc);
      els.motionDownloadBtn.onclick = videoSrc
        ? (event) => {
          event.preventDefault();
          saveAssetToDevice(videoSrc, `wedscene-motion-${result.motionStyle || 'shot'}.mp4`, 'video', { downloadUrl: downloadHref });
        }
        : null;
    }
    if (els.motionVideoMeta) {
      els.motionVideoMeta.textContent = [
        '连续转场',
        result.durationSeconds ? `${result.durationSeconds} 秒` : '',
        result.resolution || '',
      ].filter(Boolean).join(' · ');
    }
  }
  const items = Array.isArray(result.items) ? result.items : resultImages;
  els.downloadAllBtn.classList.toggle('hidden', items.length === 0 || isMotion);
  els.downloadCollageBtn.onclick = showOverview
    ? (event) => {
      event.preventDefault();
      const filename = result.mode === 'cinematic_storyboard'
        ? 'cinematic-storyboard.jpg'
        : (result.mode === 'setup_comparison'
          ? 'setup-before-after.jpg'
          : 'wedscene-viral-cover.jpg');
      downloadAsset(result.collageDownloadUrl || result.collageUrl, filename);
    }
    : null;
  els.downloadAllBtn.onclick = items.length
    ? async (event) => {
      event.preventDefault();
      els.downloadAllBtn.disabled = true;
      const originalText = els.downloadAllBtn.textContent;
      try {
        for (let i = 0; i < items.length; i += 1) {
          els.downloadAllBtn.textContent = `下载中 ${i + 1} / ${items.length}…`;
          await downloadAsset(items[i].downloadUrl || items[i].url, filenameForItem(items[i], i));
          await new Promise((resolve) => setTimeout(resolve, 350));
        }
        els.downloadAllBtn.textContent = '全部已下载 ✓';
        setTimeout(() => { els.downloadAllBtn.textContent = originalText; }, 2000);
      } finally {
        els.downloadAllBtn.disabled = false;
      }
    }
    : null;

  const copy = result.copy || createCopy(result.mode || selectedMode);
  els.copyTitle.textContent = copy.title;
  els.copyBody.value = formatCopyBody(copy);
  els.copyTags.innerHTML = '';
  copy.tags.forEach((tag) => {
    const span = document.createElement('span');
    span.className = 'rounded-full bg-white/[0.06] border border-white/[0.08] px-2.5 py-1';
    span.textContent = tag;
    els.copyTags.appendChild(span);
  });

  els.resultPanel.classList.remove('hidden');
  if (result.mock) {
    setDemoBanner(true, result.provider === 'mock' ? '后端运行在演示模式（未配置生图 API Key）' : '使用了客户端本地演示流程');
  } else {
    setDemoBanner(false);
  }
  setProgress(100, result.mock ? '演示发布包已生成（占位图，非真实生成）' : '发布包已生成');
  if ((result.mode || selectedMode) === 'copy_title') setProgress(100, '标题文案已生成');
  if ((result.mode || selectedMode) === 'design_render_scene') setProgress(100, '实景候选图已生成');
  if ((result.mode || selectedMode) === 'venue_fusion') setProgress(100, '空地婚礼融合图已生成');
  if (result.resource) appendLog('[resource] 已自动保存到我的资源');
  loadResources();
  els.resultPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function formatCopyBody(copy = {}) {
  return copy.body || '';
}

async function copyPublishText() {
  const tags = Array.from(els.copyTags.children).map((el) => el.textContent).join(' ');
  const text = `${els.copyTitle.textContent}\n\n${els.copyBody.value}\n\n${tags}`;
  if (await copyToClipboard(text, els.copyBody)) {
    els.copyTextBtn.textContent = '已复制';
    window.setTimeout(() => { els.copyTextBtn.textContent = '复制文案'; }, 1400);
    return;
  }
  els.copyTextBtn.textContent = '已选中文案';
  window.setTimeout(() => { els.copyTextBtn.textContent = '复制文案'; }, 1400);
}

function formatResourceDate(value) {
  if (!value) return '刚刚保存';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '刚刚保存';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function resourceCopyText(resource) {
  const copy = resource.copy || {};
  return [
    copy.title || resource.title || '',
    '',
    formatCopyBody(copy),
    '',
    Array.isArray(copy.tags) ? copy.tags.join(' ') : '',
  ].join('\n').trim();
}

function isComparisonResource(resource = {}) {
  if (resource.mode === 'design_render_scene') return false;
  if (resource.mode === 'design_comparison') return false;
  const text = [
    resource.mode,
    resource.modeLabel,
    resource.title,
    ...(resource.images || []).map((item) => item.label || item.filename || ''),
  ].filter(Boolean).join(' ');
  return resource.mode === 'setup_comparison'
    || /comparison|before|after|对比|布置前|布置后/i.test(text);
}

function resourceImageAssets(resource) {
  if (isComparisonResource(resource)) return [];
  return (resource.images || []).map((item, index) => ({
    ...item,
    kind: 'image',
    category: 'images',
    resource,
    label: item.label || `图片 ${index + 1}`,
    url: item.url,
    downloadUrl: item.downloadUrl,
  }));
}

function resourceVideoAssets(resource) {
  const videos = (resource.videos || []).map((item, index) => ({
    ...item,
    kind: 'video',
    category: 'videos',
    resource,
    label: item.label || `视频 ${index + 1}`,
    posterUrl: item.posterUrl || resource.motionPosterUrl || '',
  }));
  if (resource.videoUrl) {
    videos.unshift({
      kind: 'video',
      category: 'videos',
      resource,
      label: resource.modeLabel || '连续转场视频',
      filename: resource.videoFilename || 'wedscene-motion.mp4',
      url: resource.videoUrl,
      downloadUrl: resource.videoDownloadUrl,
      posterUrl: resource.motionPosterUrl || '',
      durationSeconds: resource.durationSeconds || 0,
    });
  }
  return videos;
}

function resourceComparisonAssets(resource) {
  if (!isComparisonResource(resource)) return [];
  if (resource.collageUrl) {
    return [{
      kind: 'image',
      category: 'comparisons',
      resource,
      label: resource.modeLabel || '对比图',
      filename: resource.collageFilename || 'comparison.jpg',
      url: resource.collageUrl,
      downloadUrl: resource.collageDownloadUrl,
    }];
  }
  return (resource.images || []).map((item, index) => ({
    ...item,
    kind: 'image',
    category: 'comparisons',
    resource,
    label: item.label || `对比图 ${index + 1}`,
    url: item.url,
    downloadUrl: item.downloadUrl,
  }));
}

function resourceAssets(resource, category = currentResourceCategory) {
  const images = resourceImageAssets(resource);
  const videos = resourceVideoAssets(resource);
  const comparisons = resourceComparisonAssets(resource);
  if (category === 'images') return images;
  if (category === 'videos') return videos;
  if (category === 'comparisons') return comparisons;
  return [...images, ...videos, ...comparisons];
}

function resourceAssetItems(resources = [], category = currentResourceCategory) {
  return resources.flatMap((resource) => resourceAssets(resource, category).map((asset, index) => ({
    ...asset,
    assetIndex: index,
    resourceId: resource.id,
    resourceMode: resource.mode,
    resourceModeLabel: resource.modeLabel,
    resourceCreatedAt: resource.createdAt,
  })));
}

async function copyToClipboard(text, fallbackElement) {
  const value = (text || '').trim();
  if (!value) return false;

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Continue to the textarea fallback below.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  textarea.remove();

  if (!copied && fallbackElement) {
    fallbackElement.focus();
    if (typeof fallbackElement.select === 'function') fallbackElement.select();
  }

  return copied;
}

function renderResourcePagination(totalItems) {
  if (!els.resourcesPagination) return;
  const pageCount = Math.max(1, Math.ceil(totalItems / RESOURCE_ASSETS_PER_PAGE));
  if (els.resourcesPageMeta) {
    els.resourcesPageMeta.hidden = totalItems <= 0;
    els.resourcesPageMeta.textContent = totalItems > 0
      ? `第 ${currentResourcePage} / ${pageCount} 页，共 ${totalItems} 个素材`
      : '';
  }
  els.resourcesPagination.hidden = pageCount <= 1;
  els.resourcesPagination.innerHTML = '';
  if (pageCount <= 1) return;

  const makeButton = (label, page, options = {}) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.disabled = !!options.disabled;
    button.classList.toggle('active', !!options.active);
    button.addEventListener('click', () => {
      currentResourcePage = page;
      renderResourceItems(lastResourceItems);
      document.querySelector('#resources')?.scrollIntoView({ block: 'start' });
    });
    els.resourcesPagination.appendChild(button);
  };

  const makeEllipsis = () => {
    const span = document.createElement('span');
    span.textContent = '...';
    span.className = 'px-1 text-stone-400 font-bold';
    els.resourcesPagination.appendChild(span);
  };

  const visiblePages = new Set([1, pageCount]);
  for (let page = currentResourcePage - 1; page <= currentResourcePage + 1; page += 1) {
    if (page > 1 && page < pageCount) visiblePages.add(page);
  }

  makeButton('上一页', Math.max(1, currentResourcePage - 1), { disabled: currentResourcePage === 1 });
  let lastRenderedPage = 0;
  [...visiblePages].sort((a, b) => a - b).forEach((page) => {
    if (page - lastRenderedPage > 1) makeEllipsis();
    makeButton(String(page), page, { active: page === currentResourcePage });
    lastRenderedPage = page;
  });
  makeButton('下一页', Math.min(pageCount, currentResourcePage + 1), { disabled: currentResourcePage === pageCount });
}

function resourceCategoryConfig(key = currentResourceCategory) {
  return RESOURCE_CATEGORIES.find((item) => item.key === key) || RESOURCE_CATEGORIES[0];
}

function resourceCategoryCounts(resources = []) {
  return Object.fromEntries(RESOURCE_CATEGORIES.map((category) => [
    category.key,
    resourceAssetItems(resources, category.key).length,
  ]));
}

function renderResourceCategoryTabs(resources = []) {
  if (!els.resourcesCategoryTabs) return;
  const counts = resourceCategoryCounts(resources);
  if (!RESOURCE_CATEGORIES.some((category) => category.key === currentResourceCategory)) {
    currentResourceCategory = 'images';
  }
  els.resourcesCategoryTabs.innerHTML = '';
  RESOURCE_CATEGORIES.forEach((category) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'resource-category-tab';
    button.classList.toggle('active', category.key === currentResourceCategory);
    button.dataset.resourceCategory = category.key;
    button.innerHTML = `<span>${category.label}</span><b>${counts[category.key] || 0}</b>`;
    button.addEventListener('click', () => {
      if (currentResourceCategory === category.key) return;
      currentResourceCategory = category.key;
      currentResourcePage = 1;
      renderResources(lastResources);
    });
    els.resourcesCategoryTabs.appendChild(button);
  });
}

function applyResourceTileAspect(tile, item = {}) {
  if (item.category === 'comparisons') {
    tile.style.aspectRatio = '3 / 4';
    tile.classList.add('comparison-thumb');
    return;
  }
  if (item.kind === 'video') {
    tile.style.aspectRatio = '16 / 9';
    tile.classList.add('video-thumb');
    return;
  }
  tile.style.aspectRatio = '4 / 3';
}

function renderResourceItems(items = []) {
  if (!els.resourcesGrid || !els.resourcesEmpty) return;
  lastResourceItems = items;
  const pageCount = Math.max(1, Math.ceil(items.length / RESOURCE_ASSETS_PER_PAGE));
  currentResourcePage = Math.min(Math.max(1, currentResourcePage), pageCount);
  const start = (currentResourcePage - 1) * RESOURCE_ASSETS_PER_PAGE;
  const visibleItems = items.slice(start, start + RESOURCE_ASSETS_PER_PAGE);

  els.resourcesGrid.innerHTML = '';
  els.resourcesEmpty.classList.toggle('hidden', items.length > 0);

  visibleItems.forEach((asset, index) => {
    const card = document.createElement('article');
    card.className = 'resource-card asset-card reveal visible';
    if (asset.kind === 'video') card.classList.add('video-asset-card');
    card.dataset.resourceId = asset.resourceId || '';

    const item = {
      ...asset,
      label: asset.label || `素材 ${start + index + 1}`,
      url: asset.url,
      downloadUrl: asset.downloadUrl,
    };
    const tile = document.createElement('div');
    tile.className = 'resource-thumb';
    applyResourceTileAspect(tile, item);
    const media = document.createElement(item.kind === 'video' ? 'video' : 'img');
    media.src = item.url;
    if (item.kind === 'video') {
      media.controls = false;
      media.preload = 'metadata';
      media.playsInline = true;
      media.muted = true;
      if (item.posterUrl) media.poster = item.posterUrl;
      media.addEventListener('click', () => openVideoLightbox(media, item.url, filenameForItem(item, start + index)));
    } else {
      media.alt = item.label;
      wireImagePreview(tile, item, start + index);
    }
    const label = document.createElement('span');
    label.textContent = item.label || `素材 ${start + index + 1}`;
    const tileChildren = item.kind === 'video'
      ? [media, createResourceDeleteButton(item), label]
      : [media, createImageSaveLink(item, start + index), createResourceDeleteButton(item), label];
    // 仅图片（且不是对比图，对比图本身就是 3:4 拼图，不适合直接做 i2v）支持一键生成视频
    if (item.kind === 'image' && item.category !== 'comparisons') {
      tileChildren.splice(2, 0, createResourceMotionButton(item));
    }
    tile.append(...tileChildren);
    if (item.kind === 'video') addVideoFullscreenButton(tile, media, item.url, filenameForItem(item, start + index));

    card.append(tile);
    if (item.kind === 'video') {
      const videoActions = document.createElement('div');
      videoActions.className = 'resource-video-actions';
      const previewBtn = document.createElement('button');
      previewBtn.type = 'button';
      previewBtn.className = 'btn-ghost resource-video-action';
      previewBtn.textContent = '预览';
      previewBtn.addEventListener('click', (event) => {
        event.preventDefault();
        openVideoLightbox(media, item.url, filenameForItem(item, start + index));
      });
      const saveBtn = document.createElement('a');
      saveBtn.href = item.downloadUrl || downloadUrlForAsset(item.url);
      saveBtn.download = filenameForItem(item, start + index);
      saveBtn.className = 'btn-primary resource-video-action';
      saveBtn.textContent = '下载视频';
      saveBtn.addEventListener('click', (event) => {
        event.preventDefault();
        saveAssetToDevice(item.url || item.downloadUrl, filenameForItem(item, start + index), 'video', { downloadUrl: item.downloadUrl });
      });
      videoActions.append(previewBtn, saveBtn);
      card.append(videoActions);
    }
    els.resourcesGrid.appendChild(card);
  });

  renderResourcePagination(items.length);
}

function renderResources(resources = []) {
  if (!els.resourcesGrid || !els.resourcesEmpty) return;
  lastResources = resources;
  const focusedResourceId = new URLSearchParams(window.location.search).get('resource');
  const visibleResources = focusedResourceId
    ? resources.filter((resource) => resource.id === focusedResourceId)
    : resources;
  renderResourceCategoryTabs(visibleResources);
  const items = resourceAssetItems(visibleResources, currentResourceCategory);
  const category = resourceCategoryConfig();
  els.resourcesEmpty.textContent = focusedResourceId
    ? `暂时没有找到对应${category.label}，可能资源还没生成完成或已被删除。`
    : category.empty;
  currentResourcePage = 1;
  renderResourceItems(items);
}

async function loadResources() {
  if (!accessGranted) return;
  try {
    const response = await fetch(apiUrl('/api/resources'), { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) {
        accessGranted = false;
        currentUser = null;
        updateAccountUI();
        showAccessGate(data.error || '请先登录账号');
      }
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    if (els.resourcesGrid) renderResources(data.resources || []);
    if (els.videoHistoryGrid) renderVideoHistory(data.resources || []);
  } catch (error) {
    if (els.resourcesEmpty) {
      els.resourcesEmpty.classList.remove('hidden');
      els.resourcesEmpty.textContent = `资源加载失败：${error.message}`;
    }
  }
}

function resetWorkflow() {
  localRunId += 1;
  window.clearTimeout(activePollTimer);
  clearAutoResumeTimer();
  activeJobId = null;
  canResumeActiveJob = false;
  autoResumeAttempts = 0;
  uploadedFile = null;
  uploadedDataUrl = null;
  uploadedAspectRatio = '';
  uploadedFusionFile = null;
  uploadedFusionDataUrl = null;
  els.fileInput.value = '';
  if (els.fusionMaterialInput) els.fusionMaterialInput.value = '';
  els.inputPreview.src = '';
  if (els.fusionMaterialPreview) els.fusionMaterialPreview.src = '';
  els.uploadZone.classList.remove('hidden');
  els.inputPreviewWrap.classList.add('hidden');
  els.fusionMaterialPreviewWrap?.classList.add('hidden');
  els.resultPanel.classList.add('hidden');
  delete els.resultPanel.dataset.mode;
  els.resultGrid.innerHTML = '';
  els.collageImg.removeAttribute('src');
  els.collageImg.parentElement.classList.remove('pending');
  if (els.overviewKicker && els.overviewTitle) {
    els.overviewKicker.textContent = '合成预览';
    els.overviewTitle.textContent = '分镜总览 / 爆款首图';
  }
  setOverviewVisible(true);
  els.logStream.innerHTML = '';
  updateFusionControls();
  setGenerating(false);
  setProgress(0, '等待上传素材');
}

function bindEvents() {
  $$('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (event) => {
      const page = link.getAttribute('href')?.replace(/^#/, '');
      if (!PUBLIC_PAGES.has(page)) return;
      event.preventDefault();
      if (window.location.hash !== `#${page}`) {
        window.location.hash = page;
      } else {
        showPage(page);
      }
    });
  });

  window.addEventListener('hashchange', () => showPage());
  window.addEventListener('resize', updateAccountUI);

  els.uploadZone.addEventListener('click', () => els.fileInput.click());
  els.replaceImageBtn.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', (event) => handleGeneratorFiles(event.target.files));
  els.fusionMaterialPickBtn?.addEventListener('click', () => els.fusionMaterialInput?.click());
  els.replaceFusionMaterialBtn?.addEventListener('click', () => els.fusionMaterialInput?.click());
  els.fusionMaterialInput?.addEventListener('change', (event) => handleFusionFile(event.target.files[0]));
  els.sampleDemoBtn.addEventListener('click', useSampleDemo);
  els.generateBtn.addEventListener('click', startGeneration);
  els.restartBtn.addEventListener('click', handleRestartClick);
  els.copyTextBtn.addEventListener('click', copyPublishText);
  els.refreshResourcesBtn?.addEventListener('click', loadResources);
  els.refreshAccountLogsBtn?.addEventListener('click', loadAccountLogs);
  els.rechargeFromLogsBtn?.addEventListener('click', showRechargeDialog);
  els.authEntryBtn?.addEventListener('click', showAuthNotice);

  els.uploadZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    els.uploadZone.classList.add('dragover');
  });
  els.uploadZone.addEventListener('dragleave', () => els.uploadZone.classList.remove('dragover'));
  els.uploadZone.addEventListener('drop', (event) => {
    event.preventDefault();
    els.uploadZone.classList.remove('dragover');
    handleGeneratorFiles(event.dataTransfer.files);
  });
  els.fusionMaterialPanel?.addEventListener('dragover', (event) => {
    event.preventDefault();
    els.fusionMaterialPanel.classList.add('dragover');
  });
  els.fusionMaterialPanel?.addEventListener('dragleave', () => els.fusionMaterialPanel.classList.remove('dragover'));
  els.fusionMaterialPanel?.addEventListener('drop', (event) => {
    event.preventDefault();
    els.fusionMaterialPanel.classList.remove('dragover');
    handleFusionFile(event.dataTransfer.files[0]);
  });

  els.modeGrid.addEventListener('click', (event) => {
    const button = event.target.closest('.mode-card');
    if (button && !button.disabled) setMode(button.dataset.mode);
  });

  $$('[data-select-mode]').forEach((link) => {
    link.addEventListener('click', () => {
      const mode = link.dataset.selectMode;
      if (MODE_CONFIG[mode]) {
        window.setTimeout(() => setMode(mode), 80);
      }
    });
  });

  $$('[data-request-feature]').forEach((button) => {
    button.addEventListener('click', () => {
      const feature = button.dataset.requestFeature;
      const requests = JSON.parse(localStorage.getItem('wedscene_feature_requests') || '[]');
      if (!requests.includes(feature)) requests.push(feature);
      localStorage.setItem('wedscene_feature_requests', JSON.stringify(requests));
      button.textContent = '已申请';
      appendLog(`[request] 已记录申请：${feature}`);
    });
  });

  const productFilters = $$('[data-product-filter]');
  const productTools = $$('.tool-card[data-tool-groups]');
  productFilters.forEach((button) => {
    button.addEventListener('click', () => {
      const filter = button.dataset.productFilter || 'all';
      productFilters.forEach((item) => {
        item.classList.toggle('active', item.dataset.productFilter === filter);
      });
      productTools.forEach((card) => {
        const groups = String(card.dataset.toolGroups || '').split(/\s+/);
        card.hidden = filter !== 'all' && !groups.includes(filter);
      });
    });
  });
}

function setupReveal() {
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) entry.target.classList.add('visible');
      });
    }, { threshold: 0.15 });
    $$('.reveal').forEach((el) => io.observe(el));
  } else {
    $$('.reveal').forEach((el) => el.classList.add('visible'));
  }
}

function setupHeroMotion() {
  const studioHero = document.querySelector('.studio-hero');
  const studioScene = document.querySelector('.studio-scene');
  studioHero?.addEventListener('pointermove', (event) => {
    const rect = studioHero.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width - 0.5).toFixed(3);
    const y = ((event.clientY - rect.top) / rect.height - 0.5).toFixed(3);
    studioScene?.style.setProperty('--mx', x);
    studioScene?.style.setProperty('--my', y);
  });
}

function closeVideoLightbox() {
  const overlay = document.querySelector('.video-lightbox');
  if (!overlay) return;
  const closeOnEscape = overlay._closeOnEscape;
  if (closeOnEscape) document.removeEventListener('keydown', closeOnEscape);
  overlay.remove();
  document.body.classList.remove('video-lightbox-open');
}

function openVideoLightbox(sourceVideo, fallbackUrl = '', filename = 'wedscene-motion.mp4') {
  const src = fallbackUrl || sourceVideo?.currentSrc || sourceVideo?.src || '';
  if (!src) return;
  closeVideoLightbox();

  const overlay = document.createElement('div');
  overlay.className = 'video-lightbox';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', '全屏播放视频');

  const player = document.createElement('video');
  player.src = src;
  player.controls = true;
  player.preload = 'auto';
  player.playsInline = false;
  player.muted = !!sourceVideo?.muted;
  if (sourceVideo?.poster) player.poster = sourceVideo.poster;
  if (Number.isFinite(sourceVideo?.volume)) player.volume = sourceVideo.volume;

  const actions = document.createElement('div');
  actions.className = 'video-lightbox-actions';

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'video-lightbox-save';
  saveButton.textContent = '下载视频';
  saveButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    saveAssetToDevice(src, filename, 'video');
  });

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'video-lightbox-close';
  closeButton.textContent = '关闭';
  closeButton.addEventListener('click', closeVideoLightbox);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeVideoLightbox();
  });
  overlay._closeOnEscape = (event) => {
    if (event.key === 'Escape') closeVideoLightbox();
  };
  document.addEventListener('keydown', overlay._closeOnEscape);

  actions.append(saveButton, closeButton);
  overlay.append(player, actions);
  document.body.appendChild(overlay);
  document.body.classList.add('video-lightbox-open');
  player.addEventListener('loadedmetadata', () => {
    const currentTime = Number(sourceVideo?.currentTime || 0);
    if (currentTime > 0 && currentTime < player.duration) player.currentTime = currentTime;
    if (sourceVideo && !sourceVideo.paused) player.play().catch(() => {});
  }, { once: true });
}

async function requestVideoFullscreen(container, video, fallbackUrl = '', filename = 'wedscene-motion.mp4') {
  const target = container || video;
  try {
    if (target?.requestFullscreen) {
      await target.requestFullscreen();
      return;
    }
    if (target?.webkitRequestFullscreen) {
      target.webkitRequestFullscreen();
      return;
    }
    if (video?.webkitEnterFullscreen) {
      video.webkitEnterFullscreen();
      return;
    }
  } catch (error) {
    console.warn('fullscreen request failed', error);
  }
  openVideoLightbox(video, fallbackUrl, filename);
}

function addVideoFullscreenButton(container, video, fallbackUrl = '', filename = 'wedscene-motion.mp4') {
  if (!container || !video || container.querySelector('.video-fullscreen-btn')) return;
  container.classList.add('video-fullscreen-target');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'video-fullscreen-btn';
  button.textContent = '预览';
  button.title = '预览视频';
  button.setAttribute('aria-label', '预览视频');
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    requestVideoFullscreen(container, video, fallbackUrl || video.currentSrc || video.src, filename);
  });
  container.appendChild(button);
}

function initVideoFullscreenButtons() {
  document.querySelectorAll('.motion-video-frame, .motion-video-wrap').forEach((container) => {
    const video = container.querySelector('video');
    if (video) addVideoFullscreenButton(container, video, video.currentSrc || video.src);
  });
}

// ===== Video page (独立工作流) state =====
const videoState = {
  file: null,
  files: [],
  dataUrl: '',
  previewUrls: [],
  jobId: null,
  pollTimer: null,
  generating: false,
  style: DEFAULT_MOTION_STYLE,
  progress: 0,
};

buildStepIndicator();
bindEvents();
setupReveal();
setupHeroMotion();
setupVideoPage();
initVideoFullscreenButtons();
updateFusionControls();
checkApiHealth();
showPage();

function setupVideoPage() {
  if (!els.videoUploadZone) return;
  // 上传区点击/拖拽
  els.videoUploadZone.addEventListener('click', () => els.videoFileInput?.click());
  els.videoUploadZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    els.videoUploadZone.classList.add('dragover');
  });
  els.videoUploadZone.addEventListener('dragleave', () => {
    els.videoUploadZone.classList.remove('dragover');
  });
  els.videoUploadZone.addEventListener('drop', (event) => {
    event.preventDefault();
    els.videoUploadZone.classList.remove('dragover');
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length) handleVideoFiles(files);
  });
  els.videoFileInput?.addEventListener('change', (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length) handleVideoFiles(files);
  });
  els.videoReplaceBtn?.addEventListener('click', () => {
    els.videoFileInput.value = '';
    els.videoFileInput.click();
  });
  els.videoGenerateBtn?.addEventListener('click', startVideoGeneration);
  els.videoRestartBtn?.addEventListener('click', resetVideoWorkflow);
  renderVideoStyleButtons();
  videoUpdateGenerateState();
}

function renderVideoStyleButtons() {
  videoState.style = DEFAULT_MOTION_STYLE;
  if (els.videoPointHint) {
    els.videoPointHint.textContent = `每条 ${motionConfig.pointCost || 60} 灵感值 · ${motionConfig.resolution || '4K'} · ${motionConfig.durationSeconds || 8} 秒`;
  }
}

function readImageSize(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth || 0, height: image.naturalHeight || 0 });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: 0, height: 0 });
    };
    image.src = url;
  });
}

function describeVideoUploadAdvice(files, sizes) {
  if (!files.length) return { text: '', warn: false };
  const validSizes = sizes.filter((size) => size.width && size.height);
  const ratios = validSizes.map((size) => size.width / size.height);
  const mixedOrientation = validSizes.length > 1 && new Set(validSizes.map((size) => size.width >= size.height ? 'landscape' : 'portrait')).size > 1;
  const ratioSpread = ratios.length > 1 ? Math.max(...ratios) - Math.min(...ratios) : 0;
  if (mixedOrientation || ratioSpread > 0.45) {
    return {
      text: '当前图片横竖比例差异较大，转场更容易跳画面。建议换成同一比例，优先 16:9 横图。',
      warn: true,
    };
  }
  if (files.length === 1) {
    return {
      text: '已选择 1 张图。想要连续转场更稳定，建议补充同场婚礼的中景和细节图。',
      warn: false,
    };
  }
  if (files.length === 2) {
    return {
      text: '已选择 2 张图。第 1 张做开场，第 2 张做中段；如需第三段，请补一张你希望作为结尾的画面。',
      warn: false,
    };
  }
  return {
    text: '已选择 3 张图。第 3 张会被当作最终画面，请确认它就是你想让视频停留的结尾角度。',
    warn: false,
  };
}

function clearVideoPreviewUrls() {
  (videoState.previewUrls || []).forEach((url) => {
    try { URL.revokeObjectURL(url); } catch {}
  });
  videoState.previewUrls = [];
  if (els.videoInputPreviewList) els.videoInputPreviewList.innerHTML = '';
}

function renderVideoInputPreviews(files) {
  clearVideoPreviewUrls();
  if (!els.videoInputPreviewList) return;
  const labels = ['1 开场全景', '2 中段镜头', '3 结尾画面'];
  els.videoInputPreviewList.innerHTML = files.map((file, index) => {
    const url = URL.createObjectURL(file);
    videoState.previewUrls.push(url);
    const label = labels[index] || `${index + 1} 镜头`;
    return `
      <div class="video-input-preview-item">
        <img src="${url}" alt="${label}" />
        <span>${label}</span>
      </div>
    `;
  }).join('');
}

async function handleVideoFiles(files) {
  const limit = videoReferenceLimit();
  const selectedFiles = Array.from(files || []).filter(Boolean).slice(0, limit);
  if (!selectedFiles.length) return;
  if (selectedFiles.some((file) => !file?.type?.startsWith('image/'))) {
    alert('请上传图片文件（JPG/PNG）');
    return;
  }
  if (selectedFiles.some((file) => file.size > 25 * 1024 * 1024)) {
    alert('图片不能超过 25MB');
    return;
  }
  if ((files?.length || 0) > limit) {
    alert(`最多上传 ${limit} 张参考图，系统会使用前 ${limit} 张。`);
  }
  const file = selectedFiles[0];
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  }).catch(() => '');
  if (!dataUrl) return;
  const sizes = await Promise.all(selectedFiles.map(readImageSize));
  const advice = describeVideoUploadAdvice(selectedFiles, sizes);
  videoState.file = file;
  videoState.files = selectedFiles;
  videoState.dataUrl = dataUrl;
  els.videoInputPreview.src = dataUrl;
  renderVideoInputPreviews(selectedFiles);
  els.videoUploadZone.classList.add('hidden');
  els.videoInputPreviewWrap.classList.remove('hidden');
  if (els.videoUploadAdvice) {
    els.videoUploadAdvice.textContent = advice.text;
    els.videoUploadAdvice.classList.toggle('warn', !!advice.warn);
  }
  els.videoJobStatusText.textContent = selectedFiles.length > 1
    ? `已上传 ${selectedFiles.length} 张镜头图：按顺序生成连续转场视频`
    : '照片已就绪，可以开始生成';
  videoUpdateGenerateState();
}

function videoUpdateGenerateState() {
  if (!els.videoGenerateBtn) return;
  const ready = !!(videoState.files?.length || videoState.file) && !videoState.generating;
  els.videoGenerateBtn.disabled = !ready;
  els.videoGenerateBtn.textContent = videoState.generating
    ? '视频生成中（等待上游）...'
    : `一键生成连续转场视频（${motionConfig.pointCost || 60} 灵感值）`;
}

function videoSetProgress(progress, stage) {
  videoState.progress = progress;
  if (els.videoProgressBar) els.videoProgressBar.style.width = `${progress}%`;
  if (els.videoOverallProgress) els.videoOverallProgress.textContent = `${Math.round(progress)}%`;
  if (els.videoJobStatusText && stage) els.videoJobStatusText.textContent = stage;
}

function videoAppendLog(text) {
  if (!els.videoLogStream || !text) return;
  const safeText = publicGenerationLog(text);
  if (!safeText) return;
  els.videoLogStream.parentElement?.classList.add('has-logs');
  const div = document.createElement('div');
  div.textContent = safeText;
  els.videoLogStream.appendChild(div);
  els.videoLogStream.parentElement.scrollTop = els.videoLogStream.parentElement.scrollHeight;
}

function videoRenderLogs(logs = []) {
  if (!els.videoLogStream) return;
  els.videoLogStream.innerHTML = '';
  els.videoLogStream.parentElement?.classList.toggle('has-logs', !!logs.length);
  logs.forEach((line) => videoAppendLog(line));
}

function videoSetGenerating(isGenerating) {
  videoState.generating = isGenerating;
  videoUpdateGenerateState();
}

function resetVideoWorkflow() {
  if (videoState.pollTimer) {
    clearTimeout(videoState.pollTimer);
    videoState.pollTimer = null;
  }
  videoState.file = null;
  videoState.files = [];
  videoState.dataUrl = '';
  clearVideoPreviewUrls();
  videoState.jobId = null;
  videoState.generating = false;
  videoState.progress = 0;
  if (els.videoFileInput) els.videoFileInput.value = '';
  if (els.videoUploadZone) els.videoUploadZone.classList.remove('hidden');
  if (els.videoInputPreviewWrap) els.videoInputPreviewWrap.classList.add('hidden');
  if (els.videoInputPreview) els.videoInputPreview.removeAttribute('src');
  if (els.videoUploadAdvice) {
    els.videoUploadAdvice.textContent = '';
    els.videoUploadAdvice.classList.remove('warn');
  }
  videoSetProgress(0, '等待上传照片');
  videoRenderLogs([]);
  if (els.videoResultPanel) els.videoResultPanel.classList.add('hidden');
  if (els.videoResultVideo) {
    els.videoResultVideo.removeAttribute('src');
    els.videoResultVideo.removeAttribute('poster');
    try { els.videoResultVideo.load(); } catch {}
  }
  if (els.videoPreviewBtn) {
    els.videoPreviewBtn.classList.add('hidden');
    els.videoPreviewBtn.onclick = null;
  }
  if (els.videoDownloadBtn) {
    els.videoDownloadBtn.classList.add('hidden');
    els.videoDownloadBtn.removeAttribute('href');
    els.videoDownloadBtn.onclick = null;
  }
  if (els.videoResultMeta) els.videoResultMeta.textContent = '';
  videoUpdateGenerateState();
}

async function startVideoGeneration() {
  const limit = videoReferenceLimit();
  const files = videoState.files?.length ? videoState.files.slice(0, limit) : (videoState.file ? [videoState.file] : []);
  if (!files.length || videoState.generating) return;
  if (!accessGranted) { showAccessGate('请先输入公测访问码'); return; }
  if (accountRequired && (!currentUser || Number(currentUser.points || 0) < (motionConfig.pointCost || 60))) {
    alert(`需要至少 ${motionConfig.pointCost || 60} 灵感值才能生成视频，当前余额不足。`);
    return;
  }

  videoSetGenerating(true);
  videoSetProgress(8, '正在创建视频任务');
  videoRenderLogs([
    `[mode] ${MODE_CONFIG.motion_video.label}`,
    `[input] ${files.length} 张镜头图：按上传顺序生成连续转场视频${files.length > 1 ? '（第 1 张开场，第 2/3 张作为后续镜头）' : ''}`,
    '[queue] 正在上传源图并创建任务',
  ]);
  if (els.videoResultPanel) els.videoResultPanel.classList.add('hidden');

  const formData = new FormData();
  files.forEach((file, index) => {
    formData.append('images', file, file.name || `wedding-scene-${index + 1}.jpg`);
  });
  formData.append('mode', 'motion_video');
  if (currentPartnerSlug()) formData.append('partner', currentPartnerSlug());

  try {
    const response = await fetch(apiUrl('/api/jobs'), { method: 'POST', body: formData });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    if (data.user) { currentUser = data.user; updateAccountUI(); }
    videoState.jobId = data.id;
    videoSetProgress(14, `任务已创建（id=${data.id}），开始排队生成`);
    videoAppendLog(`[queue] 任务 id=${data.id}`);
    pollVideoJob(data.id);
  } catch (error) {
    const message = (typeof cleanErrorMessage === 'function') ? cleanErrorMessage(error.message) : error.message;
    videoSetGenerating(false);
    videoSetProgress(0, `创建视频任务失败：${message}`);
    videoAppendLog(`[error] ${message}`);
  }
}

async function pollVideoJob(jobId, retry = 0) {
  if (!jobId) return;
  try {
    const response = await fetch(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}`), { cache: 'no-store' });
    const job = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(job.error || `HTTP ${response.status}`);
    if (job.user) { currentUser = job.user; updateAccountUI(); }
    if (Array.isArray(job.logs)) videoRenderLogs(job.logs);
    videoSetProgress(job.progress || 0, job.stage || '任务进行中');

    if (job.status === 'completed') {
      videoSetGenerating(false);
      videoSetProgress(100, '视频生成完成');
      videoRenderResult(job.result || {});
      loadResources(); // 刷新资源库（让历史视频出现）
      return;
    }
    if (job.status === 'failed') {
      const errMessage = (typeof cleanErrorMessage === 'function') ? cleanErrorMessage(job.error || '生成失败') : (job.error || '生成失败');
      videoSetGenerating(false);
      videoSetProgress(job.progress || 0, `生成失败：${errMessage}`);
      videoAppendLog(`[error] ${errMessage}`);
      return;
    }
    // 成功轮询：重置重试计数
    videoState.pollTimer = window.setTimeout(() => pollVideoJob(jobId, 0), POLL_INTERVAL);
  } catch (error) {
    const message = (typeof cleanErrorMessage === 'function') ? cleanErrorMessage(error.message) : error.message;
    // 网络抖动重试：最多 8 次，间隔 2s，累计 16s 仍太不上才放弃
    if (retry < 8) {
      videoSetProgress(videoState.progress || 0, `网络抖动，重连中…（${retry + 1}/8）`);
      videoState.pollTimer = window.setTimeout(() => pollVideoJob(jobId, retry + 1), 2000);
      return;
    }
    videoSetGenerating(false);
    videoSetProgress(videoState.progress || 0, `生成状态连接中断：${message}`);
    videoAppendLog(`[error] ${message}`);
  }
}

function videoRenderResult(result = {}) {
  if (!els.videoResultPanel) return;
  const videoUrl = result.videoUrl || result.resource?.videoUrl || '';
  const posterUrl = result.videoPosterUrl || result.resource?.motionPosterUrl || '';
  if (!videoUrl) {
    els.videoResultPanel.classList.add('hidden');
    return;
  }
  els.videoResultPanel.classList.remove('hidden');
  if (els.videoResultVideo) {
    // 给 URL 加时间戳防缓存，确保同名 motion.mp4 也能强制刷新
    const cacheBustedUrl = videoUrl + (videoUrl.includes('?') ? '&' : '?') + 't=' + Date.now();
    els.videoResultVideo.src = cacheBustedUrl;
    if (posterUrl) els.videoResultVideo.poster = posterUrl;
    else els.videoResultVideo.removeAttribute('poster');
    // 必须显式调用 load()，否则 src 改变后浏览器不会重新拉取第一帧
    try { els.videoResultVideo.load(); } catch {}
    addVideoFullscreenButton(els.videoResultVideo.closest('.motion-video-wrap'), els.videoResultVideo, cacheBustedUrl, `wedscene-motion-${result.motionStyle || 'shot'}.mp4`);
  }
  if (els.videoPreviewBtn) {
    const previewHref = (els.videoResultVideo?.currentSrc || els.videoResultVideo?.src || videoUrl);
    els.videoPreviewBtn.classList.remove('hidden');
    els.videoPreviewBtn.onclick = (event) => {
      event.preventDefault();
      openVideoLightbox(els.videoResultVideo, previewHref, `wedscene-motion-${result.motionStyle || 'shot'}.mp4`);
    };
  }
  if (els.videoDownloadBtn) {
    const downloadHref = result.videoDownloadUrl || result.resource?.videoDownloadUrl || videoUrl;
    els.videoDownloadBtn.href = downloadHref;
    els.videoDownloadBtn.download = `wedscene-motion-${result.motionStyle || 'shot'}.mp4`;
    els.videoDownloadBtn.textContent = '下载视频';
    els.videoDownloadBtn.classList.remove('hidden');
    els.videoDownloadBtn.onclick = (event) => {
      event.preventDefault();
      saveAssetToDevice(videoUrl, `wedscene-motion-${result.motionStyle || 'shot'}.mp4`, 'video', { downloadUrl: downloadHref });
    };
  }
  if (els.videoResultMeta) {
    els.videoResultMeta.textContent = [
      '连续转场',
      result.durationSeconds ? `${result.durationSeconds} 秒` : '',
      result.resolution || '',
    ].filter(Boolean).join(' · ');
  }
  els.videoResultPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderVideoHistory(resources = []) {
  if (!els.videoHistoryGrid || !els.videoHistoryEmpty) return;
  const videos = resources
    .filter((r) => (r.mode === 'motion_video' && r.videoUrl) || r.videoUrl)
    .slice(0, 12);
  els.videoHistoryGrid.innerHTML = '';
  els.videoHistoryEmpty.classList.toggle('hidden', videos.length > 0);
  videos.forEach((resource) => {
    const card = document.createElement('article');
    card.className = 'card rounded-lg p-3 reveal visible';
    const wrap = document.createElement('div');
    wrap.className = 'rounded-lg overflow-hidden bg-black aspect-video';
    const video = document.createElement('video');
    video.src = resource.videoUrl;
    video.controls = true;
    video.preload = 'metadata';
    video.playsInline = true;
    if (resource.motionPosterUrl) video.poster = resource.motionPosterUrl;
    video.className = 'w-full h-full block';
    wrap.appendChild(video);
    addVideoFullscreenButton(wrap, video, resource.videoUrl, `wedscene-motion-${resource.motionStyle || 'shot'}.mp4`);
    const meta = document.createElement('div');
    meta.className = 'mt-2 text-xs text-stone-400 font-mono';
    meta.textContent = [
      '连续转场',
      resource.durationSeconds ? `${resource.durationSeconds}s` : '',
      formatResourceDate(resource.createdAt),
    ].filter(Boolean).join(' · ');
    const actions = document.createElement('div');
    actions.className = 'mt-2 flex items-center gap-2';
    const dlBtn = document.createElement('a');
    dlBtn.href = resource.videoDownloadUrl || resource.videoUrl;
    dlBtn.download = `wedscene-motion-${resource.motionStyle || 'shot'}.mp4`;
    dlBtn.className = 'btn-ghost px-3 py-1.5 rounded-full text-xs';
    dlBtn.textContent = '下载视频';
    dlBtn.addEventListener('click', (event) => {
      event.preventDefault();
      saveAssetToDevice(resource.videoUrl || resource.videoDownloadUrl, `wedscene-motion-${resource.motionStyle || 'shot'}.mp4`, 'video', { downloadUrl: resource.videoDownloadUrl });
    });
    actions.appendChild(dlBtn);
    const resourceId = resource.id || resource.resourceId || '';
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn-ghost px-3 py-1.5 rounded-full text-xs text-red-500 hover:text-red-600 ml-auto';
    delBtn.textContent = '删除';
    if (resourceId) delBtn.dataset.resourceId = resourceId;
    delBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!resourceId) {
        window.alert('该视频缺少资源 id，无法删除（请刷新页面后重试）');
        return;
      }
      deleteResource(resourceId);
    });
    actions.appendChild(delBtn);
    card.append(wrap, meta, actions);
    els.videoHistoryGrid.appendChild(card);
  });
}

(async function initApp() {
  if (await initAccessGate()) {
    loadResources();
    if (pageFromHash() === 'logs') loadAccountLogs();
  }
}());

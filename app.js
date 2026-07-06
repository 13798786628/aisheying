// ===== WedScene AI · 一键生成爆款图文工作流 =====

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
const POLL_INTERVAL = 1200;
const AUTO_RESUME_DELAY = 1200;
const MAX_AUTO_RESUME_ATTEMPTS = 4;
const MAX_POLL_RECONNECT_ATTEMPTS = 8;
const RESOURCE_ASSETS_PER_PAGE = 12;
const MAX_SOURCE_UPLOAD_SIZE = 35 * 1024 * 1024;
const MAX_VOICE_UPLOAD_SIZE = 50 * 1024 * 1024;
const IMAGE_OPTIMIZE_MAX_EDGE = 2600;
const IMAGE_OPTIMIZE_QUALITY = 0.86;
const PHOTOSWIPE_MODULE_URL = 'https://cdn.jsdelivr.net/npm/photoswipe@5.4.4/dist/photoswipe.esm.min.js';
const BG_REMOVE_VERSION = '1.4.5';
const BG_REMOVE_DATA_VERSION = '1.4.5';
const BG_REMOVE_LOCAL_MODULE_URL = new URL('assets/vendor/background-removal/background-removal.js', document.baseURI || window.location.href).toString();
const BG_REMOVE_MODULE_URLS = [
  BG_REMOVE_LOCAL_MODULE_URL,
  `https://cdn.jsdelivr.net/npm/@imgly/background-removal@${BG_REMOVE_VERSION}/+esm`,
  `https://esm.sh/@imgly/background-removal@${BG_REMOVE_VERSION}?bundle`,
];
const BG_REMOVE_LOCAL_PUBLIC_PATH = new URL('assets/vendor/background-removal/data/', document.baseURI || window.location.href).toString();
const BG_REMOVE_REMOTE_PUBLIC_PATH = `https://staticimgly.com/@imgly/background-removal-data/${BG_REMOVE_DATA_VERSION}/dist/`;
const BG_REMOVE_MODEL = 'small';
const RECHARGE_PLAN_PROFILES = [
  { price: 29.9, name: '图片生成版', badge: '图片版', description: '1个月图片生成权益，适合轻量出图和测试', durationText: '1个月图片生成版', benefits: ['图片生成', '提示词试用'], includesMotion: false },
  { price: 299, name: '体验版', badge: '体验', featured: true, description: '完整体验入口，跑通图片、文案和15s视频流程', durationText: '永久有效', benefits: ['完整体验', '视频生成', '去水印'] },
  { price: 899, name: '专业版', badge: '专业', featured: true, description: '性价比主推，含初级代理权益，适合团队分销获客', durationText: '永久有效', benefits: ['初级代理', '图片低至0.41元', 'GEO优化'] },
  { price: 3980, name: 'AI经理', badge: 'AI经理', featured: true, packageOnly: true, packageText: '赠5套专业版 + 3套体验版名额', description: '高级代理权益，赠送5套专业版和3套体验版名额，AI经理陪跑获客', durationText: '永久有效', benefits: ['高级代理', '赠5套专业版', '赠3套体验版', 'AI经理陪跑'] },
];
const LEGACY_VIDEO_ACCESS_CUTOFF = Date.parse('2026-07-03T00:00:00+08:00');
const IMAGE_ONLY_PLAN_PATTERN = /图片生成版|图片版|1个月图片生成版|29\.9/i;
const VIDEO_ACCESS_DENIED_MESSAGE = '当前账号为图片生成版，仅可使用图片功能；视频功能请开通体验版、专业版或 AI经理。';
const RESOURCE_CATEGORIES = [
  { key: 'images', label: '图片', empty: '还没有图片素材。完成一次图片生成后会出现在这里。' },
  { key: 'plans', label: '方案图', empty: '还没有方案图。生成施工矩阵、手绘方案、户外手绘、九宫格细节、搭建视频九宫格或留影区搭建九宫格后会出现在这里。' },
  { key: 'copy', label: '提示词', empty: '还没有提示词。上传婚礼图片并按指令生成一次提示词后会出现在这里。' },
  { key: 'prompts', label: '视频提示词', empty: '还没有视频提示词。生成电影分镜图、搭建视频九宫格或留影区搭建九宫格后会出现在这里。' },
  { key: 'videos', label: '视频', empty: '还没有视频素材。生成连续转场视频后会出现在这里。' },
  { key: 'comparisons', label: '对比图', empty: '还没有对比图。布置前后对比会归到这里。' },
];
const PLAN_RESOURCE_MODES = new Set([
  'product_matrix',
  'handdrawn_plan',
  'outdoor_handdrawn_plan',
  'detail_grid',
  'setup_process_grid',
  'photo_area_setup_grid',
]);
const SETUP_PROCESS_GRID_MODES = new Set(['setup_process_grid', 'photo_area_setup_grid']);
const DOUBAO_SETUP_VIDEO_PROMPT = '请严格基于我上传的9宫格婚礼搭建过程图生成视频。先把9宫格理解为同一场婚礼从进场到完工的9个连续时间节点，不是9个不同案例，也不是风格灵感。以第9格最终成品为唯一最终效果标准，视频全程必须保持同一个场地结构、顶部边界/天花或露天状态、舞台背景、通道位置、花艺色系、布幔/灯光、桌椅和地毯关系一致。重点锁定婚礼顶部：默认按“无吊顶婚礼”处理，只保留第9格真实、清晰、明确可见的顶部元素；第9格看不清顶部、顶部是暗部、普通天花、画面上沿、墙面上沿或没有明确悬挂装置时，都必须当作没有吊顶。第9格如果没有明确吊顶、没有悬挂水晶、没有吊花、没有顶棚/天幕/桁架，全片禁止新增吊顶、拱顶、星空顶、天幕、树冠、棚架、悬挂花艺、悬挂水晶或任何顶部装饰；顶部只能保持原本的天花、天空、墙面上沿或画面上沿边界。如果前面格子偶然出现了第9格不存在的吊顶/悬挂物，把它视为错误参考，不要延续到视频里。第9格如果确实清楚存在吊顶/悬挂结构，前面阶段才可以在同一个顶部结构上逐步安装已有元素，不能替换、抬高、压低、裁掉或改成另一种造型。按第1格到第9格的顺序做连贯演变：空场或基础框架、舞台和背景搭建、结构/灯光/花艺安装、通道布置、灯光调试、最终完工。每个阶段只能使用9宫格里已经出现且被第9格最终效果支持的婚礼元素逐步增加，不要换场地，不要换婚礼风格，不要新增无关舞台、花艺、人物或道具。不要做分屏、拼贴、九宫格边框或图片切换效果，要生成一段真实拍摄感的连续搭建过程视频，结尾画面必须回到第9格同款最终成品婚礼现场，尤其要保持第9格同款婚礼顶部和画面上沿结构。';
const DOUBAO_PHOTO_AREA_SETUP_VIDEO_PROMPT = '请严格基于我上传的9宫格婚礼留影区搭建过程图生成视频。先把9宫格理解为同一个婚礼留影区从空场到完工的9个连续时间节点，不是9个不同案例，也不是风格灵感。以第9格最终完工留影区为唯一最终效果标准，视频全程必须保持同一个位置、墙面/入口/户外背景、地面材质、背景板或拍照装置、迎宾牌/指示牌、花艺色系、已有环境光、道具和空间比例一致。重点锁定留影区主体：只保留第9格真实、清晰、明确可见的背景板、照片墙、签名墙、迎宾牌、路引、花艺、灯串、地贴、摆件和已有环境光；第9格看不清或没有的结构，不要在视频里新增。尤其注意：照片板、海报或背景画面内部出现的酒吧吊灯、灯罩、酒瓶、人物、画框、室内陈设，只能当作印刷画面内容，不能变成留影区现场两侧的真实灯具、立灯、壁灯、灯柱、吊灯或额外道具；如果第9格最终留影区两边没有真实可见的实体灯具，视频全程不要平白新增两侧灯。按第1格到第9格的顺序做连贯演变：空白区域或基础墙面、地面保护和定位、背景框架/展架进场、主背景板安装、迎宾牌和照片道具摆放、花艺和布幔安装、已有环境光/隐藏氛围光调试、现场清理微调、最终完工留影区。每个阶段只能使用9宫格里已经出现且被第9格最终效果支持的留影区元素逐步增加，不要换场地，不要换婚礼风格，不要新增无关舞台、仪式通道、宴会桌椅、人物摆拍、两侧灯具或与留影区无关的道具。不要做分屏、拼贴、九宫格边框或图片切换效果，要生成一段真实拍摄感的连续留影区搭建过程视频，结尾画面必须回到第9格同款最终完工留影区，尤其要保持第9格同款背景板、迎宾牌、花艺和地面空间关系。';
const DOUBAO_SETUP_VIDEO_LAYOUT_LOCK_PREFIX = [
  '重要版式规则：我上传的是一张包含9个时间节点的参考时间线，不是视频画面样式。',
  '生成视频时绝对不要复刻参考图的3×3九宫格版式。视频全程每一帧都必须是一个单一全屏真实摄像机镜头，只能看到一个完整婚礼现场画面。',
  '禁止九宫格、三行三列、白色分割线、分屏、拼贴、画中画、小窗、缩略图、照片墙、网格边框、图片切换模板、UI界面或任何多画面排版。',
  '只把九个小图理解为同一场婚礼从空场到完工的时间顺序，抽取其中的场地结构和搭建阶段，在同一个全屏场景里连续演变。'
].join('');
const DOUBAO_SETUP_VIDEO_PROMPT_BRAND_CLARITY_APPEND = [
  ' 如果9宫格中搭建人员的深色工服背后出现品牌名或员工名字，视频里只把它当作自然的服装细节，不要把衣服文字当作主镜头、主转场或重点特写。',
  ' 视频重点必须是婚礼搭建过程本身：舞台结构逐步成型、花艺安装、通道铺设、灯光调试、座椅和最终现场完成。镜头以稳定广角和中景为主，保持场地、舞台、通道和花艺连续。',
  ' 不要为了拍清衣服文字而突然推近、跳切、旋转、追踪背部或生成大面积人物特写；工作人员可以自然出现在搭建画面里，但不能压过婚礼现场和搭建动作。',
  ' 衣服文字只能出现在工作人员衣服背后，不能出现在舞台背景、墙面、地面、字幕、水印、标牌或九宫格边框上；如果文字在视频里难以稳定，宁可弱化为普通深色工服细节，也不要牺牲婚礼搭建过程的连贯性。'
].join('');
const DOUBAO_SETUP_VIDEO_PROMPT_FULL = `${DOUBAO_SETUP_VIDEO_LAYOUT_LOCK_PREFIX}${DOUBAO_SETUP_VIDEO_PROMPT}${DOUBAO_SETUP_VIDEO_PROMPT_BRAND_CLARITY_APPEND}`;
const DOUBAO_PHOTO_AREA_SETUP_VIDEO_PROMPT_BRAND_CLARITY_APPEND = [
  ' 如果9宫格中搭建人员的深色工服背后出现品牌名或员工名字，视频中段要自然保留同款衣服背名作为真实施工记录细节，但不要把衣服文字当作主镜头、主转场或广告特写。',
  ' 视频重点必须是婚礼留影区搭建过程本身：搭建人员进场定位、背景板逐步立起、迎宾牌定位、照片道具摆放、花艺安装、灯光调试、地面清理和最终留影区完成。镜头以稳定广角和中景为主，保持背景板、迎宾牌、花艺、道具和工作人员动作连续。',
  ' 不要为了拍清衣服文字而突然推近、跳切、旋转、追踪背部或生成大面积人物特写；工作人员必须像真实搭建视频一样自然出现在搭建画面里，但不能压过留影区主体和搭建动作。',
  ' 衣服文字只能出现在工作人员衣服背后，不能出现在背景板、迎宾牌、照片墙、墙面、地面、字幕、水印、标牌或九宫格边框上；如果文字在视频里难以稳定，宁可弱化为普通深色工服细节，也不要牺牲留影区搭建过程的连贯性。'
].join('');
const DOUBAO_PHOTO_AREA_SETUP_VIDEO_PROMPT_FULL = `${DOUBAO_SETUP_VIDEO_LAYOUT_LOCK_PREFIX}${DOUBAO_PHOTO_AREA_SETUP_VIDEO_PROMPT}${DOUBAO_PHOTO_AREA_SETUP_VIDEO_PROMPT_BRAND_CLARITY_APPEND}`;
const STEP_LABELS = ['上传', '确认', '图片', '拼图', '发布'];

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
    label: '同款延伸',
    title: '根据这场婚礼生成 1 张同款延伸',
    tags: ['#同款婚礼延伸', '#婚礼灵感', '#婚礼效果图', '#婚礼策划', '#备婚参考'],
  },
  setup_comparison: {
    label: '布置前后对比图',
    title: '上传现场图生成 3:4 布置前后 2 宫格',
    tags: ['#婚礼布置', '#婚礼前后对比', '#婚礼效果图', '#婚礼策划', '#备婚灵感'],
  },
  design_render_scene: {
    label: '设计图转实景',
    title: '上传设计图生成 1 张真实现场图',
    tags: ['#婚礼设计图', '#婚礼现场效果', '#婚礼提案', '#婚礼布置', '#备婚参考'],
  },
  venue_fusion: {
    label: '空地婚礼融合图',
    title: '上传空地和婚礼素材，生成 1 张融合落地效果图',
    tags: ['#空地婚礼', '#婚礼效果图', '#婚礼布置', '#场地改造', '#备婚参考'],
  },
  product_matrix: {
    label: '方案施工矩阵图',
    title: '上传婚礼案例图，生成 1 张方案施工整合板',
    tags: ['#婚礼施工图', '#婚礼方案', '#婚礼物料清单', '#婚礼策划', '#方案沟通'],
  },
  handdrawn_plan: {
    label: '手绘方案推演图',
    title: '上传婚礼案例图，生成 1 张手绘提案推演板',
    tags: ['#婚礼手绘方案', '#婚礼提案', '#婚礼设计', '#方案沟通', '#婚礼策划'],
  },
  outdoor_handdrawn_plan: {
    label: '户外小清新手绘图',
    title: '上传婚礼案例图，生成 1 张户外小清新手绘提案板',
    tags: ['#户外婚礼', '#小清新婚礼', '#婚礼手绘方案', '#花园婚礼', '#方案沟通'],
  },
  detail_grid: {
    label: '九宫格细节图',
    title: '上传舞台案例图，生成 1 张同舞台 3×3 细节图',
    tags: ['#婚礼九宫格', '#婚礼细节', '#花艺布置', '#婚礼灵感', '#婚礼现场'],
  },
  setup_process_grid: {
    label: '搭建视频九宫格',
    title: '上传婚礼成片，生成 1 张搭建过程 3×3 九宫格图',
    tags: ['#婚礼搭建', '#搭建视频九宫格', '#婚礼施工', '#婚礼布置', '#婚礼案例'],
  },
  photo_area_setup_grid: {
    label: '留影区搭建九宫格',
    title: '上传留影区完工图，生成 1 张搭建过程 3×3 九宫格图',
    tags: ['#婚礼留影区', '#留影区搭建', '#婚礼搭建', '#迎宾区布置', '#婚礼案例'],
  },
  partial_wedding_edit: {
    label: '上传参考图局部改图',
    title: '上传婚礼主图，按文字需求和可选参考图生成 2 张候选',
    tags: ['#婚礼改图', '#婚礼效果图', '#婚礼布置', '#花艺调整', '#方案沟通'],
  },
  ps_layer_split: {
    label: 'PS白底分层素材',
    title: '上传婚礼图，拆成多张同画幅白底图层，方便在 PS 里叠放',
    tags: ['#PS分层', '#白底图层', '#婚礼拆图', '#设计素材', '#方案沟通'],
  },
  image_enhance: {
    label: '画质升级',
    title: '上传低清婚礼图，一键升级到 2K/4K 清晰展示版',
    tags: ['#画质升级', '#高清放大', '#锐化修复', '#客户沟通', '#案例素材'],
  },
  copy_title: {
    label: '看图生成提示词',
    title: '上传婚礼图，按指令生成提示词',
    tags: ['#婚礼提示词', '#看图写视频', '#图片反推', '#婚礼灵感', '#婚礼布置'],
  },
  motion_video: {
    label: '空景转场视频',
    title: '上传 1-3 张婚礼空景照 → 连续转场电影感视频',
    tags: ['#婚礼运镜', '#婚礼短片', '#婚礼现场', '#婚礼布置', '#婚礼灵感'],
  },
};

const MODE_IMAGE_COUNTS = {
  cinematic_storyboard: 6,
  similar_style: 1,
  setup_comparison: 1,
  design_render_scene: 1,
  venue_fusion: 1,
  product_matrix: 1,
  handdrawn_plan: 1,
  outdoor_handdrawn_plan: 1,
  detail_grid: 1,
  setup_process_grid: 1,
  photo_area_setup_grid: 1,
  partial_wedding_edit: 2,
  ps_layer_split: 6,
  image_enhance: 1,
  copy_title: 0,
  motion_video: 0,
};
const WEDDING_IMAGE_OPT_SAMPLE_URL = 'assets/demo/wedding-image-opt-sample.jpg?v=20260621-2';
const IMAGE_ENHANCE_SIZES = new Set(['2K', '4K']);
let selectedImageEnhanceSize = '2K';

const DEFAULT_MOTION_STYLE = 'seamless_sequence';
const FALLBACK_MOTION_STYLES = [
  { key: 'seamless_sequence', label: '连续转场', description: '按上传顺序自动串联成片' },
];

const VIDEO_QUALITY_MODE_ENABLED = true;
const VIDEO_PAGE_ENABLED = document.body?.dataset.videoPageEnabled !== 'false';
const PUBLIC_PAGES = new Set(['home', 'products', 'super-custom', 'demo', 'copy', 'voice', 'geo', 'tutorials', 'resources', 'logs', 'launch']);
if (VIDEO_PAGE_ENABLED) PUBLIC_PAGES.add('video');

const SUPER_CUSTOM_PUBLIC_ENABLED = ['localhost', '127.0.0.1', ''].includes(window.location.hostname);
const SUPER_CUSTOM_STEPS = [
  {
    key: 'style',
    label: '风格',
    title: '先选酒店厅婚礼风格',
    subtitle: '本地开发版先沉淀酒店厅内婚礼，当前重点做韩式白绿。',
    options: [
      {
        id: 'korean_white_green',
        name: '韩式白绿',
        meta: '已开始沉淀',
        visual: 'style-korean',
        description: '白色、奶油色和清爽绿植为主，干净、明亮、留白多。',
        prompt: 'Korean minimal white and green hotel hall wedding style, clean white palette, fresh greenery, soft bright atmosphere',
      },
      {
        id: 'champagne_luxury',
        name: '香槟白高端',
        meta: '后续',
        visual: 'style-korean',
        description: '香槟、奶油白、金属细节和更强的酒店厅高级感。',
        prompt: 'champagne white luxury hotel hall wedding style',
        disabled: true,
      },
      {
        id: 'new_chinese_red',
        name: '新中式红金',
        meta: '后续',
        visual: 'lighting-dark',
        description: '红金、东方结构、灯笼或屏风语言，适合后续独立沉淀。',
        prompt: 'new Chinese red and gold hotel hall wedding style',
        disabled: true,
      },
    ],
  },
  {
    key: 'mainStage',
    label: '主舞台',
    title: '选择主舞台结构',
    subtitle: '先沉淀能遮挡酒店大屏、适合韩系白绿的高背景板和层叠背景板。',
    options: [
      {
        id: 'high_white_panel_stage',
        name: '高背景板韩式白绿舞台',
        meta: '样本 83',
        visual: 'stage-high-panel',
        description: '白色高背景板遮挡酒店大屏，顶部与两侧做白绿花艺。',
        prompt: 'tall white backdrop panels covering the hotel LED screen, Korean white-green floral clusters on top and both sides, clean low platform',
      },
      {
        id: 'layered_minimal_stage',
        name: '层叠极简白绿舞台',
        meta: '样本 36',
        visual: 'stage-layered',
        description: '层叠白色背景板，中间低台阶，舞台留白更多。',
        prompt: 'layered minimal white backdrop panels, low steps, airy white and green flowers, clean Korean wedding main stage',
      },
      {
        id: 'soft_fabric_panel_stage',
        name: '柔纱背景舞台',
        meta: '待采样',
        visual: 'stage-high-panel',
        description: '更柔软的白色纱幔和花艺，适合后续补充样本。',
        prompt: 'soft white fabric backdrop Korean wedding stage',
        disabled: true,
      },
    ],
  },
  {
    key: 'tStage',
    label: 'T台',
    title: '选择 T 台 / 通道',
    subtitle: '第一版先做直线通道，保证和主舞台能稳定组合。',
    options: [
      {
        id: 'straight_white_aisle',
        name: '白色直线通道',
        meta: '样本 36 / 83',
        visual: 'aisle-white',
        description: '白色直线通道通向舞台，干净、明亮、韩系感强。',
        prompt: 'straight clean white wedding aisle leading to the main stage',
      },
      {
        id: 'black_mirror_aisle',
        name: '黑色镜面通道',
        meta: '后续',
        visual: 'aisle-mirror',
        description: '更适合暗场或高对比风格，韩系白绿后续再验证。',
        prompt: 'black mirror wedding aisle',
        disabled: true,
      },
      {
        id: 'no_t_stage',
        name: '无 T 台短通道',
        meta: '后续',
        visual: 'aisle-white',
        description: '小厅或预算较低时使用，通道更短。',
        prompt: 'short clean aisle without long T-stage',
        disabled: true,
      },
    ],
  },
  {
    key: 'aisleFlorals',
    label: '两侧花艺',
    title: '选择 T 台两侧花组',
    subtitle: '这一步选择花组单元，合成时系统会沿 T 台左右两侧镜像重复摆放。',
    options: [
      {
        id: 'low_dense_white_green',
        name: '低矮密集白绿花艺',
        meta: '样本 36',
        visual: 'floral-low',
        hiddenFromMenu: true,
        description: '两侧低矮、密集、自然松散的白绿花组。',
        componentProfile: {
          unitType: 'low_dense_floor_group',
          mainFlorals: ['白色中小花团', '雾状小白花', '低矮落地白花'],
          greenery: ['浅绿叶材', '自然枝条绿植'],
          heightProfile: '低矮贴地，中段轻微抬高',
          density: '高花量',
          placementRule: {
            mode: 'mirrored_aisle_pair',
            symmetry: true,
            repeatAlongAisle: true,
            perspectiveScale: 'near_large_far_small',
            keepAisleCenterClean: true,
          },
        },
        prompt: 'low dense white-green floor floral group units mirrored and repeated along both sides of the wedding T-stage, clean open aisle center',
      },
      {
        id: 'vase_floor_mix',
        name: '瓶插 + 落地花组',
        meta: '样本 83',
        visual: 'floral-vase',
        description: '透明瓶插、白百合、白玫瑰与真实绿植混合。',
        componentProfile: {
          unitType: 'vase_floor_group',
          mainFlorals: ['白百合', '白玫瑰', '低矮落地白花'],
          greenery: ['清爽绿叶', '细枝条绿植'],
          props: ['透明玻璃瓶器'],
          heightProfile: '瓶插中高，落地花组低矮',
          density: '中高花量',
          placementRule: {
            mode: 'mirrored_aisle_pair',
            symmetry: true,
            repeatAlongAisle: true,
            canInterleaveWith: ['low_dense_white_green'],
            perspectiveScale: 'near_large_far_small',
            keepAisleCenterClean: true,
          },
        },
        prompt: 'clear glass vase and floor floral group units mirrored along both sides of the wedding T-stage, white lilies, white roses, fresh greenery, clean open aisle center',
      },
      {
        id: 'garden_dense_white_green_group',
        name: '仿真花泥白绿花组',
        meta: 'GPT道具图',
        visual: 'floral-low',
        description: '仿真白花和塑料绿枝插入隐藏花泥底座，像婚礼现场花艺师叉出来的一组道具。',
        componentProfile: {
          unitType: 'artificial_foam_floor_group',
          mainFlorals: ['白色仿真花头', '仿真绣球感白花', '雾状仿真小白花', '低矮落地白花'],
          greenery: ['塑料绿枝', '仿真叶材', '硬挺线条枝'],
          props: ['隐藏花泥底座'],
          heightProfile: '前低后高，枝条从花泥里多方向插出',
          density: '中高花量',
          placementRule: {
            mode: 'mirrored_aisle_pair',
            symmetry: true,
            repeatAlongAisle: true,
            perspectiveScale: 'near_large_far_small',
            keepAisleCenterClean: true,
          },
        },
        prompt: 'artificial white-green wedding aisle-side floor floral foam prop, faux white flowers and plastic green stems inserted into hidden floral foam base, modular flower group mirrored and repeated along both sides of the wedding T-stage, clean open aisle center',
      },
      {
        id: 'aisle_front_dense_white_group',
        name: '前景满铺白花花组',
        meta: '箭头确认',
        visual: 'floral-low',
        description: '用户确认的左前景低矮白绿花组，白花占比更高，更白更满。',
        componentProfile: {
          unitType: 'front_dense_white_floor_group',
          mainFlorals: ['雾状小白花', '白色中小花团', '低矮落地白花'],
          greenery: ['浅绿叶材', '细枝条绿植'],
          heightProfile: '低矮贴地，局部花头自然抬高',
          density: '高花量，白花占比高',
          placementRule: {
            mode: 'mirrored_aisle_pair',
            symmetry: true,
            repeatAlongAisle: true,
            perspectiveScale: 'near_large_far_small',
            keepAisleCenterClean: true,
          },
        },
        prompt: 'front dense white floral floor group unit mirrored and repeated along both sides of the wedding T-stage, misty tiny white flowers, white medium blooms, fresh light greenery, low floor arrangement, clean open aisle center',
      },
      {
        id: 'aisle_front_loose_green_group',
        name: '前景蓬松绿植白花组',
        meta: '箭头确认',
        visual: 'floral-low',
        description: '用户确认的右前景蓬松绿植白花组，绿植层次更明显，更自然更绿。',
        componentProfile: {
          unitType: 'front_loose_green_floor_group',
          mainFlorals: ['白色花团', '白色枝条花', '低矮落地白花'],
          greenery: ['蓬松深绿叶材', '自然枝条绿植', '浅绿叶材'],
          heightProfile: '前低后高，绿植自然外扩',
          density: '中高花量，绿植占比高',
          placementRule: {
            mode: 'mirrored_aisle_pair',
            symmetry: true,
            repeatAlongAisle: true,
            perspectiveScale: 'near_large_far_small',
            keepAisleCenterClean: true,
          },
        },
        prompt: 'loose green and white floral floor group unit mirrored and repeated along both sides of the wedding T-stage, fluffy deep green foliage, white blooms, natural branches, low garden-style arrangement, clean open aisle center',
      },
      {
        id: 'sparse_green_guides',
        name: '稀疏绿植路引',
        meta: '后续',
        visual: 'floral-low',
        description: '更轻量的花艺路引，适合小预算版本。',
        prompt: 'sparse greenery aisle guide florals',
        disabled: true,
      },
    ],
  },
  {
    key: 'ceremonyArea',
    label: '仪式区',
    title: '选择仪式区关系',
    subtitle: '酒店厅韩式白绿里，仪式区常常并入主舞台前方。',
    options: [
      {
        id: 'merged_with_stage',
        name: '仪式区并入主舞台',
        meta: '样本 36 / 83',
        visual: 'ceremony-stage',
        displayKind: 'ceremony-rule',
        assetKind: 'rule',
        assetStatus: '结构规则',
        description: '不单独做圆形仪式岛，核心仪式点在主舞台前。',
        prompt: 'ceremony area merged with the main stage front, no separate round ceremony island',
      },
      {
        id: 'front_exchange_point',
        name: '舞台前交接区',
        meta: '后续',
        visual: 'ceremony-stage',
        description: '在 T 台末端增加轻量交接点。',
        prompt: 'small exchange ceremony point at the end of the aisle before the stage',
        disabled: true,
      },
      {
        id: 'round_ceremony_island',
        name: '圆形仪式岛',
        meta: '后续',
        visual: 'ceremony-stage',
        description: '适合更大空间，后续单独沉淀。',
        prompt: 'round ceremony island in hotel hall wedding',
        disabled: true,
      },
    ],
  },
  {
    key: 'ceiling',
    label: '吊顶',
    title: '选择吊顶 / 顶部策略',
    subtitle: '目前韩式白绿样本没有明确婚礼吊顶，先提供“无吊顶”作为安全选项。',
    options: [
      {
        id: 'no_wedding_ceiling',
        name: '无婚礼吊顶',
        meta: '当前安全项',
        visual: 'ceiling-none',
        displayKind: 'ceiling-rule',
        assetKind: 'rule',
        assetStatus: '结构规则',
        description: '保留酒店原始顶部，不新增水晶、吊花或纱幔吊顶。',
        prompt: 'no wedding ceiling installation, keep the original hotel ceiling clean and unobtrusive',
      },
      {
        id: 'soft_fabric_ceiling',
        name: '轻纱吊顶',
        meta: '待采样',
        visual: 'stage-layered',
        description: '只做轻量纱幔顶部，后续需要真实样本验证。',
        prompt: 'light white fabric ceiling installation',
        disabled: true,
      },
      {
        id: 'crystal_line_ceiling',
        name: '线性水晶吊顶',
        meta: '待采样',
        visual: 'lighting-dark',
        description: '更偏高奢风格，暂不放入韩系白绿 MVP。',
        prompt: 'linear crystal hanging ceiling installation',
        disabled: true,
      },
    ],
  },
  {
    key: 'lighting',
    label: '灯光',
    title: '选择灯光氛围',
    subtitle: '灯光决定最终图是明亮韩系，还是暗场电影感。',
    options: [
      {
        id: 'bright_soft_white',
        name: '明亮柔白韩系光感',
        meta: '样本 36 / 83',
        visual: 'lighting-soft',
        displayKind: 'lighting-rule',
        assetKind: 'rule',
        assetStatus: '风格规则',
        description: '整体明亮、柔和、干净，不使用强彩色光。',
        prompt: 'bright soft white Korean wedding lighting, clean airy atmosphere, no strong colored lighting',
      },
      {
        id: 'daylight_clean',
        name: '自然白天清透光',
        meta: '后续',
        visual: 'lighting-soft',
        description: '更像白天自然光拍摄，适合小清新。',
        prompt: 'clean daylight-like soft lighting for fresh white-green wedding',
        disabled: true,
      },
      {
        id: 'dark_spotlight',
        name: '暗场追光氛围',
        meta: '后续',
        visual: 'lighting-dark',
        description: '暗场光束更强，暂不作为韩系白绿首版默认。',
        prompt: 'dark cinematic spotlight wedding lighting',
        disabled: true,
      },
    ],
  },
];

const SUPER_CUSTOM_LIBRARY_URL = 'super-custom/data/library.json?v=20260628-large-original-v19';
let superCustomLibrary = null;
let superCustomStepIndex = 0;
const superCustomSelections = {
  style: 'korean_white_green',
};
let superCustomImportPreviewUrl = '';

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
  customInstructionPanel: $('#customInstructionPanel'),
  customInstructionTitle: $('#customInstructionTitle'),
  customInstructionHint: $('#customInstructionHint'),
  customInstruction: $('#customInstruction'),
  partialEditPanel: $('#partialEditPanel'),
  partialEditInstruction: $('#partialEditInstruction'),
  partialReferencePickBtn: $('#partialReferencePickBtn'),
  partialReferenceInput: $('#partialReferenceInput'),
  partialReferencePreviewWrap: $('#partialReferencePreviewWrap'),
  partialReferencePreviewList: $('#partialReferencePreviewList'),
  clearPartialReferencesBtn: $('#clearPartialReferencesBtn'),
  setupBrandPanel: $('#setupBrandPanel'),
  setupBrandName: $('#setupBrandName'),
  imageEnhanceSizePanel: $('#imageEnhanceSizePanel'),
  imageEnhanceSizeButtons: $$('#imageEnhanceSizePanel [data-image-enhance-size]'),
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
  copyPanel: $('.copy-panel'),
  copyTitle: $('#copyTitle'),
  copyBody: $('#copyBody'),
  copyTags: $('#copyTags'),
  copyTextBtn: $('#copyTextBtn'),
  doubaoPromptPanel: $('#doubaoPromptPanel'),
  doubaoPromptTitle: $('#doubaoPromptTitle'),
  doubaoVideoPrompt: $('#doubaoVideoPrompt'),
  copyDoubaoPromptBtn: $('#copyDoubaoPromptBtn'),
  regenerateDoubaoPromptBtn: $('#regenerateDoubaoPromptBtn'),
  videoWatermarkGuide: $('#videoWatermarkGuide'),
  copyUploadZone: $('#copyUploadZone'),
  copyFileInput: $('#copyFileInput'),
  copyInputPreviewWrap: $('#copyInputPreviewWrap'),
  copyInputPreview: $('#copyInputPreview'),
  replaceCopyImageBtn: $('#replaceCopyImageBtn'),
  copySampleDemoBtn: $('#copySampleDemoBtn'),
  copyInstructionInput: $('#copyInstructionInput'),
  copyGenerateBtn: $('#copyGenerateBtn'),
  copyRestartBtn: $('#copyRestartBtn'),
  copyProgressBar: $('#copyProgressBar'),
  copyOverallProgress: $('#copyOverallProgress'),
  copyJobStatusText: $('#copyJobStatusText'),
  copyLogStream: $('#copyLogStream'),
  copyResultPanel: $('#copyResultPanel'),
  copyPageTitle: $('#copyPageTitle'),
  copyPageBody: $('#copyPageBody'),
  copyPageTags: $('#copyPageTags'),
  copyPageCopyBtn: $('#copyPageCopyBtn'),
  chatMessages: $('#chatMessages'),
  chatSystemInput: $('#chatSystemInput'),
  chatPromptInput: $('#chatPromptInput'),
  chatSendBtn: $('#chatSendBtn'),
  chatImageBtn: $('#chatImageBtn'),
  chatClearBtn: $('#chatClearBtn'),
  chatCopyBtn: $('#chatCopyBtn'),
  chatQuickPrompts: $('#chatQuickPrompts'),
  chatReferenceBtn: $('#chatReferenceBtn'),
  chatReferenceInput: $('#chatReferenceInput'),
  chatReferenceList: $('#chatReferenceList'),
  chatReferenceNote: $('#chatReferenceNote'),
  chatStatusText: $('#chatStatusText'),
  chatUsageText: $('#chatUsageText'),
  chatModelLabel: $('#chatModelLabel'),
  apiStatus: $('#apiStatus'),
  stepIndicator: $('#stepIndicator'),
  resourcesGrid: $('#resourcesGrid'),
  resourcesEmpty: $('#resourcesEmpty'),
  resourcesPagination: $('#resourcesPagination'),
  resourcesPageMeta: $('#resourcesPageMeta'),
  resourcesCategoryTabs: $('#resourcesCategoryTabs'),
  refreshResourcesBtn: $('#refreshResourcesBtn'),
  superCustomStepTabs: $('#superCustomStepTabs'),
  superCustomStepTitle: $('#superCustomStepTitle'),
  superCustomStepSubtitle: $('#superCustomStepSubtitle'),
  superCustomProgress: $('#superCustomProgress'),
  superCustomStepGuide: $('#superCustomStepGuide'),
  superCustomOptionGrid: $('#superCustomOptionGrid'),
  superCustomPrevBtn: $('#superCustomPrevBtn'),
  superCustomNextBtn: $('#superCustomNextBtn'),
  superCustomGenerateBtn: $('#superCustomGenerateBtn'),
  superCustomSummary: $('#superCustomSummary'),
  superCustomComposition: $('#superCustomComposition'),
  superCustomJson: $('#superCustomJson'),
  superCustomPreviewTitle: $('#superCustomPreviewTitle'),
  superCustomStatus: $('#superCustomStatus'),
  superCustomAssetBoard: $('#superCustomAssetBoard'),
  superCustomSampleBoard: $('#superCustomSampleBoard'),
  superCustomImportPanel: $('#superCustomImportPanel'),
  superCustomImportTask: $('#superCustomImportTask'),
  superCustomImportFile: $('#superCustomImportFile'),
  superCustomImportPreview: $('#superCustomImportPreview'),
  superCustomImportFileName: $('#superCustomImportFileName'),
  superCustomImportCommand: $('#superCustomImportCommand'),
  superCustomImportCopyBtn: $('#superCustomImportCopyBtn'),
  superCustomImportStatus: $('#superCustomImportStatus'),
  superCustomToolButtons: $$('#super-custom [data-super-custom-tool]'),
  superMaskWorkspace: $('#superMaskWorkspace'),
  superMaskStage: $('#superMaskStage'),
  superMaskUploadZone: $('#superMaskUploadZone'),
  superMaskSampleBtn: $('#superMaskSampleBtn'),
  superMaskFileInput: $('#superMaskFileInput'),
  superMaskCanvasWrap: $('#superMaskCanvasWrap'),
  superMaskImage: $('#superMaskImage'),
  superMaskCanvas: $('#superMaskCanvas'),
  superMaskReplaceBtn: $('#superMaskReplaceBtn'),
  superMaskDrawBtn: $('#superMaskDrawBtn'),
  superMaskEraseBtn: $('#superMaskEraseBtn'),
  superMaskBrushSize: $('#superMaskBrushSize'),
  superMaskBrushSizeValue: $('#superMaskBrushSizeValue'),
  superMaskClearBtn: $('#superMaskClearBtn'),
  superMaskZoomOutBtn: $('#superMaskZoomOutBtn'),
  superMaskZoomInBtn: $('#superMaskZoomInBtn'),
  superMaskZoomResetBtn: $('#superMaskZoomResetBtn'),
  superMaskZoomValue: $('#superMaskZoomValue'),
  superMaskPanBtn: $('#superMaskPanBtn'),
  superMaskReferenceBtn: $('#superMaskReferenceBtn'),
  superMaskReferenceInput: $('#superMaskReferenceInput'),
  superMaskReferenceStatus: $('#superMaskReferenceStatus'),
  superMaskReferenceList: $('#superMaskReferenceList'),
  superMaskFlowSteps: $$('#super-custom [data-super-mask-step]'),
  superMaskChecklistItems: $$('#super-custom [data-super-mask-check]'),
  superMaskReadySummary: $('#superMaskReadySummary'),
  superMaskNextHint: $('#superMaskNextHint'),
  superMaskToolHint: $('#superMaskToolHint'),
  superMaskMaskCoverage: $('#superMaskMaskCoverage'),
  superMaskMaskQuality: $('#superMaskMaskQuality'),
  superMaskInstruction: $('#superMaskInstruction'),
  superMaskGenerateBtn: $('#superMaskGenerateBtn'),
  superMaskStatus: $('#superMaskStatus'),
  superMaskResultPanel: $('#superMaskResultPanel'),
  superMaskResultMeta: $('#superMaskResultMeta'),
  superMaskResultGrid: $('#superMaskResultGrid'),
  superPsdWorkspace: $('#superPsdWorkspace'),
  superPsdStage: $('#superPsdStage'),
  superPsdUploadZone: $('#superPsdUploadZone'),
  superPsdSampleBtn: $('#superPsdSampleBtn'),
  superPsdFileInput: $('#superPsdFileInput'),
  superPsdPreviewWrap: $('#superPsdPreviewWrap'),
  superPsdPreviewImage: $('#superPsdPreviewImage'),
  superPsdReplaceBtn: $('#superPsdReplaceBtn'),
  superPsdImageMeta: $('#superPsdImageMeta'),
  superPsdGenerateBtn: $('#superPsdGenerateBtn'),
  superPsdStatus: $('#superPsdStatus'),
  superPsdResultPanel: $('#superPsdResultPanel'),
  superPsdResultMeta: $('#superPsdResultMeta'),
  superPsdPackageDownload: $('#superPsdPackageDownload'),
  superPsdResultGrid: $('#superPsdResultGrid'),
  superPsdPrompt: $('#superPsdPrompt'),
  superPsdSize: $('#superPsdSize'),
  superPsdQuality: $('#superPsdQuality'),
  superPsdCount: $('#superPsdCount'),
  superPsdFormat: $('#superPsdFormat'),
  superPsdCostNote: $('#superPsdCostNote'),
  superPsdReferenceToolbar: $('#superPsdReferenceToolbar'),
  superPsdModeButtons: $$('#superPsdWorkspace [data-free-image-mode]'),
  superPsdPreviewPlaceholder: $('#superPsdPreviewPlaceholder'),
  superPsdPreviewTitle: $('#superPsdPreviewTitle'),
  superPsdPreviewMeta: $('#superPsdPreviewMeta'),
  externalImportPanel: $('#externalImportPanel'),
  externalImportUrl: $('#externalImportUrl'),
  externalImportBtn: $('#externalImportBtn'),
  externalImportStatus: $('#externalImportStatus'),
  externalImportResults: $('#externalImportResults'),
  geoBrandName: $('#geoBrandName'),
  geoWebsiteUrl: $('#geoWebsiteUrl'),
  geoServiceArea: $('#geoServiceArea'),
  geoCompetitors: $('#geoCompetitors'),
  geoVisibilityBtn: $('#geoVisibilityBtn'),
  geoVisibilityStatus: $('#geoVisibilityStatus'),
  geoVisibilityResult: $('#geoVisibilityResult'),
  geoLegalName: $('#geoLegalName'),
  geoCreditCode: $('#geoCreditCode'),
  geoOwnerName: $('#geoOwnerName'),
  geoOwnerPhone: $('#geoOwnerPhone'),
  geoCity: $('#geoCity'),
  geoContactInfo: $('#geoContactInfo'),
  geoProofText: $('#geoProofText'),
  geoLicenseUrl: $('#geoLicenseUrl'),
  geoVerifyBtn: $('#geoVerifyBtn'),
  geoVerifyStatus: $('#geoVerifyStatus'),
  geoVerifyResult: $('#geoVerifyResult'),
  geoCertificationState: $('#geoCertificationState'),
  geoCertificationBadge: $('#geoCertificationBadge'),
  geoCertificationNote: $('#geoCertificationNote'),
  geoWorkspace: $('#geoWorkspace'),
  geoWorkspaceLocked: $('#geoWorkspaceLocked'),
  geoWeddingServices: $('#geoWeddingServices'),
  geoWeddingStyles: $('#geoWeddingStyles'),
  geoPriceRange: $('#geoPriceRange'),
  geoKnowledgeArea: $('#geoKnowledgeArea'),
  geoCaseNotes: $('#geoCaseNotes'),
  geoFaqNotes: $('#geoFaqNotes'),
  geoKnowledgeBtn: $('#geoKnowledgeBtn'),
  geoKnowledgeStatus: $('#geoKnowledgeStatus'),
  geoKnowledgeResult: $('#geoKnowledgeResult'),
  geoArticleTopic: $('#geoArticleTopic'),
  geoArticleAudience: $('#geoArticleAudience'),
  geoArticleKeywords: $('#geoArticleKeywords'),
  geoArticleAngle: $('#geoArticleAngle'),
  geoArticleBtn: $('#geoArticleBtn'),
  geoArticleStatus: $('#geoArticleStatus'),
  geoArticleResult: $('#geoArticleResult'),
  geoDistillKeywords: $('#geoDistillKeywords'),
  geoDistillBtn: $('#geoDistillBtn'),
  geoDistillStatus: $('#geoDistillStatus'),
  geoDistillResult: $('#geoDistillResult'),
  geoAuditUrl: $('#geoAuditUrl'),
  geoAuditBtn: $('#geoAuditBtn'),
  geoAuditStatus: $('#geoAuditStatus'),
  geoAuditResult: $('#geoAuditResult'),
  geoMonitorBoard: $('#geoMonitorBoard'),
  accountLogsSummary: $('#accountLogsSummary'),
  accountLogsMeta: $('#accountLogsMeta'),
  accountLogsList: $('#accountLogsList'),
  accountLogsEmpty: $('#accountLogsEmpty'),
  refreshAccountLogsBtn: $('#refreshAccountLogsBtn'),
  rechargeFromLogsBtn: $('#rechargeFromLogsBtn'),
  authEntryBtn: $('#authEntryBtn'),
  guideContactBtn: $('#guideContactBtn'),
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
  // voice 页面
  voiceUploadZone: $('#voiceUploadZone'),
  voiceFileInput: $('#voiceFileInput'),
  voiceSamplePreviewWrap: $('#voiceSamplePreviewWrap'),
  voiceSampleName: $('#voiceSampleName'),
  voiceSampleMeta: $('#voiceSampleMeta'),
  voiceSampleAudio: $('#voiceSampleAudio'),
  voiceReplaceBtn: $('#voiceReplaceBtn'),
  voiceTextInput: $('#voiceTextInput'),
  voiceReferenceTextInput: $('#voiceReferenceTextInput'),
  voiceConsentCheck: $('#voiceConsentCheck'),
  voiceGenerateBtn: $('#voiceGenerateBtn'),
  voiceRestartBtn: $('#voiceRestartBtn'),
  voiceJobStatusText: $('#voiceJobStatusText'),
  voiceOverallProgress: $('#voiceOverallProgress'),
  voiceProgressBar: $('#voiceProgressBar'),
  voiceResultPanel: $('#voiceResultPanel'),
  voiceResultAudio: $('#voiceResultAudio'),
  voiceDownloadBtn: $('#voiceDownloadBtn'),
  voiceResultMeta: $('#voiceResultMeta'),
};

let selectedMode = 'cinematic_storyboard';
let selectedMotionStyle = DEFAULT_MOTION_STYLE;
let motionConfig = {
  pointCost: 120,
  durationSeconds: 15,
  resolution: '',
  aspectRatio: '16:9',
  referenceLimit: 3,
  durationOptions: [10, 15],
  defaultModelMode: 'fast',
  modelVariants: [
    { key: 'fast', label: '快速', model: 'wf-sd2-fast', referenceLimit: 4, mediaReferenceLimit: 8, videoReferenceLimit: 3, audioReferenceLimit: 1 },
    { key: 'quality', label: '质量', model: 'wf-sd2', referenceLimit: 4, mediaReferenceLimit: 8, videoReferenceLimit: 3, audioReferenceLimit: 1 },
  ],
  publicBaseConfigured: false,
  mockMode: false,
  provider: '',
  styles: FALLBACK_MOTION_STYLES,
};
let uploadedFile = null;
let uploadedDataUrl = null;
let uploadedAspectRatio = '';
let uploadedFusionFile = null;
let uploadedFusionDataUrl = null;
let uploadedEditReferenceFiles = [];
let uploadedEditReferenceDataUrls = [];
let copyUploadedFile = null;
let copyUploadedDataUrl = null;
let copyActiveJobId = null;
let copyPollTimer = null;
let copyLocalRunId = 0;
let copyGenerationInProgress = false;
let chatMessages = [];
let chatReferenceImages = [];
let chatSending = false;
let activeJobId = null;
let lastRenderedResult = null;
let regeneratingDoubaoPrompt = false;
let activePollTimer = null;
let autoResumeTimer = null;
let autoResumeAttempts = 0;
let localRunId = 0;
let apiProvider = 'mock';
let imageEnhanceAvailable = true;
let imageEnhanceUnavailableMessage = '';
let canResumeActiveJob = false;
let accessGranted = true;
let accountRequired = false;
let currentUser = null;
let geoCertificationProfile = null;
let geoCertificationApproved = false;
let geoCertificationLoadKey = '';
let geoCertificationPollTimer = null;
let pointCost = 5;
let pointCosts = {
  text: 1,
  chat: 1,
  singleImage: 5,
  storyboard: 50,
  designRender: 5,
  motion: 120,
  byMode: {
    cinematic_storyboard: 50,
    multi_angle: 30,
    detail_pack: 30,
    similar_style: 5,
    setup_comparison: 5,
    design_render_scene: 5,
    venue_fusion: 5,
    product_matrix: 10,
    handdrawn_plan: 10,
    outdoor_handdrawn_plan: 10,
    detail_grid: 10,
    setup_process_grid: 10,
    photo_area_setup_grid: 10,
    partial_wedding_edit: 20,
    free_text_image: 10,
    free_image_image: 10,
    ps_layer_split: 30,
    image_enhance: 5,
    copy_title: 1,
    motion_video: 120,
  },
};
let siteInfo = { supportWechat: '', supportWechatQr: '', supportContacts: [], rechargePlans: '', rechargePlanItems: [], tenant: null, partner: '' };
let currentResourcePage = 1;
let lastResourceItems = [];
let lastResources = [];
let currentResourceCategory = 'images';
const deletingResourceIds = new Set();
const CHAT_REFERENCE_LIMIT = 6;
const CHAT_REFERENCE_MAX_EDGE = 960;
const CHAT_REFERENCE_QUALITY = 0.68;
const CHAT_REFERENCE_MAX_BYTES = 1.6 * 1024 * 1024;
const CHAT_REFERENCE_MAX_TOTAL_BYTES = 7.5 * 1024 * 1024;
const CHAT_REQUEST_MAX_BODY_CHARS = 9 * 1024 * 1024;
const EXTERNAL_IMPORT_MAINTENANCE = window.WEDSCENE_CONFIG?.externalImportMaintenance !== false;
const EXTERNAL_IMPORT_MAINTENANCE_MESSAGE = String(
  window.WEDSCENE_CONFIG?.externalImportMaintenanceMessage
  || '豆包素材导入功能暂时用不了，正在维护中，请稍后再试。',
);
let generationInProgress = false;
let externalImportInProgress = false;
let photoSwipeModulePromise = null;
let uploadEditorModal = null;
let uploadEditorCropper = null;
let qrShareModal = null;
let videoPreviewSortable = null;
let partialReferenceSortable = null;
let backgroundRemovalModulePromise = null;
let superMaskSourceFile = null;
let superMaskSourceDataUrl = '';
let superMaskReferenceFiles = [];
let superMaskReferenceDataUrls = [];
const SUPER_MASK_ZOOM_MIN = 1;
const SUPER_MASK_ZOOM_MAX = 3;
const SUPER_MASK_ZOOM_STEP = 0.25;
const SUPER_MASK_SAMPLE_URL = 'assets/demo/wedding-image-opt-sample.jpg';
let superMaskZoom = 1;
let superMaskBaseDisplayWidth = 0;
let superMaskBaseDisplayHeight = 0;
let superMaskTool = 'draw';
let superMaskDrawing = false;
let superMaskPanning = false;
let superMaskPanStart = null;
let superMaskHasPaint = false;
let superMaskCoverage = 0;
let superMaskActiveJobId = null;
let superMaskPollTimer = null;
let superMaskGenerationInProgress = false;
let voiceSampleFile = null;
let voiceSampleObjectUrl = '';
let voiceResultObjectUrl = '';
let voiceGenerationInProgress = false;
let superCustomActiveTool = 'mask';
const SUPER_PSD_REFERENCE_LIMIT = 8;
let superPsdSourceFile = null;
let superPsdSourceDataUrl = '';
let superPsdSourceFiles = [];
let superPsdSourceDataUrls = [];
let superPsdActiveJobId = null;
let superPsdPollTimer = null;
let superPsdGenerationInProgress = false;
let superPsdActiveMode = 'text';

function currentPartnerSlug() {
  const params = new URLSearchParams(window.location.search);
  return (params.get('partner') || params.get('t') || siteInfo.partner || siteInfo.tenant?.slug || '').trim();
}

function isVenueFusionMode(mode = selectedMode) {
  return mode === 'venue_fusion';
}

function isDesignRenderMode(mode = selectedMode) {
  return mode === 'design_render_scene';
}

function supportsCustomInstruction(mode = selectedMode) {
  return isVenueFusionMode(mode) || isDesignRenderMode(mode) || mode === 'outdoor_handdrawn_plan';
}

function isPartialWeddingEditMode(mode = selectedMode) {
  return mode === 'partial_wedding_edit';
}

function isImageEnhanceMode(mode = selectedMode) {
  return mode === 'image_enhance';
}

function superPsdModeValue() {
  return superPsdActiveMode === 'image' ? 'image' : 'text';
}

function superPsdJobMode() {
  return superPsdModeValue() === 'image' ? 'free_image_image' : 'free_text_image';
}

function superPsdPromptText() {
  return String(els.superPsdPrompt?.value || '').replace(/\s+/g, ' ').trim();
}

function superPsdImageCount() {
  const value = Number.parseInt(String(els.superPsdCount?.value || '1'), 10);
  return Math.max(1, Math.min(4, Number.isFinite(value) ? value : 1));
}

function superPsdModePointCost() {
  return Math.max(1, pointCostForMode(superPsdJobMode())) * superPsdImageCount();
}

function normalizeImageEnhanceSize(value) {
  const size = String(value || '').trim().toUpperCase();
  return IMAGE_ENHANCE_SIZES.has(size) ? size : '2K';
}

function setImageEnhanceSize(value) {
  selectedImageEnhanceSize = normalizeImageEnhanceSize(value);
  els.imageEnhanceSizeButtons?.forEach((button) => {
    const active = normalizeImageEnhanceSize(button.dataset.imageEnhanceSize) === selectedImageEnhanceSize;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function isPlanResourceMode(mode = selectedMode) {
  return PLAN_RESOURCE_MODES.has(mode);
}

function isSetupProcessGridMode(mode = selectedMode) {
  return SETUP_PROCESS_GRID_MODES.has(mode);
}

function isPhotoAreaSetupGridMode(mode = selectedMode) {
  return mode === 'photo_area_setup_grid';
}

function doubaoSetupVideoPromptForMode(mode = selectedMode) {
  return isPhotoAreaSetupGridMode(mode)
    ? DOUBAO_PHOTO_AREA_SETUP_VIDEO_PROMPT_FULL
    : DOUBAO_SETUP_VIDEO_PROMPT_FULL;
}

function partialEditInstructionText() {
  return String(els.partialEditInstruction?.value || '').replace(/\s+/g, ' ').trim();
}

function customInstructionText() {
  return String(els.customInstruction?.value || '').replace(/\s+/g, ' ').trim();
}

function setupBrandNameText() {
  return String(els.setupBrandName?.value || '').replace(/\s+/g, ' ').trim().slice(0, 24);
}

function hasRequiredGeneratorInput(mode = selectedMode) {
  if (!uploadedFile) return false;
  if (isImageEnhanceMode(mode) && !imageEnhanceAvailable) return false;
  if (isVenueFusionMode(mode)) return !!uploadedFusionFile;
  if (isPartialWeddingEditMode(mode)) return !!partialEditInstructionText();
  return true;
}

function updateFusionControls() {
  const fusionMode = isVenueFusionMode();
  const designRenderMode = isDesignRenderMode();
  const outdoorHanddrawnMode = selectedMode === 'outdoor_handdrawn_plan';
  const customInstructionMode = supportsCustomInstruction();
  const partialEditMode = isPartialWeddingEditMode();
  const setupGridMode = isSetupProcessGridMode();
  const photoAreaSetupMode = isPhotoAreaSetupGridMode();
  const enhanceMode = isImageEnhanceMode();
  if (els.fileInput) els.fileInput.multiple = fusionMode || partialEditMode;
  els.fusionMaterialPanel?.classList.toggle('hidden', !fusionMode);
  els.customInstructionPanel?.classList.toggle('hidden', !customInstructionMode);
  els.partialEditPanel?.classList.toggle('hidden', !partialEditMode);
  els.setupBrandPanel?.classList.toggle('hidden', !setupGridMode);
  els.imageEnhanceSizePanel?.classList.toggle('hidden', !enhanceMode);
  if (enhanceMode) setImageEnhanceSize(selectedImageEnhanceSize);
  if (els.customInstructionTitle) {
    els.customInstructionTitle.textContent = fusionMode
      ? '填写场地融合要求'
      : (outdoorHanddrawnMode ? '填写户外手绘要求' : '填写效果图转实景要求');
  }
  if (els.customInstructionHint) {
    els.customInstructionHint.textContent = fusionMode
      ? '写清楚舞台/通道放哪里、哪些场地结构要保留、哪些元素不要新增。'
      : (outdoorHanddrawnMode
        ? '可填写主题名、主色调、户外场地、艺术装置和花材水果道具偏好。'
        : '写清楚要保留的结构、材质、色系和不希望被模型改掉的地方。');
  }
  if (els.customInstruction) {
    els.customInstruction.placeholder = fusionMode
      ? '例如：舞台放在右侧靠墙，通道沿中轴线，保留原来的柱子和天花边界，不新增吊顶、宾客和人物。'
      : (outdoorHanddrawnMode
        ? '例如：主题 Golden Garden，主色香槟金/象牙白/鼠尾草绿，户外花园，中央流动丝带艺术装置，加入柠檬和白兰花。'
        : '例如：保留原效果图里真实存在的顶部结构和舞台比例，把材质转成真实宴会厅拍摄质感，不要换成户外草坪。');
  }
  if (els.uploadTitle) {
    els.uploadTitle.textContent = fusionMode
      ? '上传空地 / 空场照片'
      : (partialEditMode
        ? '上传要修改的婚礼主图'
        : (enhanceMode
          ? '上传要增强的低清图片'
          : (setupGridMode ? (photoAreaSetupMode ? '上传留影区完工图' : '上传婚礼完工图') : '上传婚礼现场照 / 设计图')));
  }
  if (els.uploadHint) {
    els.uploadHint.textContent = fusionMode
      ? '第 1 张作为场地骨架，第 2 张婚礼素材在下方上传，可补充文字说明 · ≤ 10MB'
      : (partialEditMode
        ? '第 1 张作为主图，可在下方填写指令并上传参考图 · JPG / PNG · ≤ 10MB'
        : (enhanceMode
          ? '适合截图、小尺寸效果图、压缩图 · 自动 2x-4x 高清化 · ≤ 10MB'
          : (setupGridMode
            ? `${photoAreaSetupMode ? '上传留影区最终完工图' : '上传婚礼最终完工图'}，可在下方填写搭建人员衣服背后品牌名 · JPG / PNG · ≤ 10MB`
            : (designRenderMode
              ? '上传设计图/效果图，可在下方补充转换要求 · JPG / PNG · ≤ 10MB'
              : 'JPG / PNG · 建议原图 · ≤ 10MB'))));
  }
  if (els.sampleDemoBtn) {
    els.sampleDemoBtn.textContent = fusionMode
      ? '没有两张图？用空地 + 婚礼示例跑一遍'
      : (partialEditMode
        ? '用示例图测试局部改图'
        : (enhanceMode
          ? '用示例图测试画质升级'
          : (setupGridMode ? (photoAreaSetupMode ? '用示例图测试留影区搭建九宫格' : '用示例图测试搭建九宫格') : '没有照片？用示例图跑一遍')));
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
  updateChatCostText();
  if (payload.motion && typeof payload.motion === 'object') {
    motionConfig = {
      ...motionConfig,
      pointCost: Number(payload.motion.pointCost) || Number(pointCosts.motion) || motionConfig.pointCost,
      durationSeconds: Number(payload.motion.durationSeconds) || motionConfig.durationSeconds,
      durationOptions: Array.isArray(payload.motion.durationOptions) && payload.motion.durationOptions.length
        ? payload.motion.durationOptions.map((value) => Number(value)).filter((value) => value === 10 || value === 15)
        : motionConfig.durationOptions,
      resolution: payload.motion.resolution || motionConfig.resolution,
      aspectRatio: payload.motion.aspectRatio || motionConfig.aspectRatio,
      referenceLimit: Math.max(1, Number(payload.motion.referenceLimit) || motionConfig.referenceLimit || 3),
      defaultModelMode: payload.motion.defaultModelMode || motionConfig.defaultModelMode || 'fast',
      modelVariants: Array.isArray(payload.motion.modelVariants) && payload.motion.modelVariants.length ? payload.motion.modelVariants : motionConfig.modelVariants,
      publicBaseConfigured: !!payload.motion.publicBaseConfigured,
      mockMode: !!payload.motion.mockMode,
      provider: payload.motion.provider || motionConfig.provider,
      styles: Array.isArray(payload.motion.styles) && payload.motion.styles.length ? payload.motion.styles : motionConfig.styles,
    };
  } else if (Number(pointCosts.motion) > 0) {
    motionConfig.pointCost = Number(pointCosts.motion);
  }
  updateVideoConfigUI();
}

function normalizeVideoModelMode(value) {
  const clean = String(value || '').trim().toLowerCase();
  return VIDEO_QUALITY_MODE_ENABLED && clean === 'quality' ? 'quality' : 'fast';
}

function selectedVideoModelMode() {
  let stateMode = '';
  try { stateMode = videoState?.modelMode || ''; } catch {}
  return normalizeVideoModelMode(stateMode || motionConfig.defaultModelMode || 'fast');
}

function currentVideoModelVariant() {
  const mode = selectedVideoModelMode();
  const variants = Array.isArray(motionConfig.modelVariants) ? motionConfig.modelVariants : [];
  const fallback = mode === 'quality'
    ? { key: 'quality', label: '质量', model: 'wf-sd2', referenceLimit: 4, mediaReferenceLimit: 8, videoReferenceLimit: 3, audioReferenceLimit: 1 }
    : { key: 'fast', label: '快速', model: 'wf-sd2-fast', referenceLimit: 4, mediaReferenceLimit: 8, videoReferenceLimit: 3, audioReferenceLimit: 1 };
  return { ...fallback, ...(variants.find((item) => normalizeVideoModelMode(item?.key) === mode) || {}) };
}

function videoReferenceLimit() {
  const variant = currentVideoModelVariant();
  return Math.max(1, Number(variant.referenceLimit) || Number(motionConfig.referenceLimit) || 3);
}

function videoReferenceMediaLimit() {
  const variant = currentVideoModelVariant();
  return Math.max(1, Number(variant.mediaReferenceLimit) || videoReferenceLimit());
}

function videoReferenceVideoLimit() {
  return Math.max(0, Number(currentVideoModelVariant().videoReferenceLimit) || 0);
}

function videoReferenceAudioLimit() {
  return Math.max(0, Number(currentVideoModelVariant().audioReferenceLimit) || 0);
}

function videoModelDisplayLabel() {
  const variant = currentVideoModelVariant();
  return variant.key === 'quality' ? '质量' : '快速';
}

function updateVideoConfigUI() {
  const specValues = document.querySelectorAll('.video-control-specs b');
  if (specValues[0]) specValues[0].textContent = `${videoState.duration || motionConfig.durationSeconds || 15} 秒`;
  if (specValues[1]) specValues[1].textContent = String(motionConfig.pointCost || 200);
  if (els.videoDurationInput && !videoState.generating) {
    videoState.duration = normalizeVideoDuration(videoState.duration || motionConfig.durationSeconds || 15);
    els.videoDurationInput.value = String(videoState.duration);
  }
  if (els.videoAspectRatioInput && typeof syncVideoAspectButtons === 'function') {
    videoState.aspectRatio = normalizeVideoAspect(videoState.aspectRatio || motionConfig.aspectRatio || '16:9');
    syncVideoAspectButtons();
  }
  if (els.videoPointHint) renderVideoStyleButtons();
  if (els.videoGenerateBtn) videoUpdateGenerateState();
  if (typeof syncVideoModelButtons === 'function') syncVideoModelButtons();
}

function pointCostForMode(mode = selectedMode) {
  return Number(pointCosts.byMode?.[mode])
    || (mode === 'motion_video' ? Number(motionConfig.pointCost || pointCosts.motion || 200) : Number(pointCost || pointCosts.singleImage || 5));
}

function modePointCostText(mode = selectedMode) {
  return `${Math.max(0, pointCostForMode(mode))} 灵感值`;
}

function selectedModeStatusText(mode = selectedMode) {
  return `已选择：${MODE_CONFIG[mode]?.label || '生成方向'} · 消耗 ${modePointCostText(mode)}`;
}

function syncActiveModeScroll(activeButton = null) {
  const grid = els.modeGrid;
  const button = activeButton || grid?.querySelector('.mode-card.active');
  if (!grid || !button || grid.scrollWidth <= grid.clientWidth + 4) return;

  const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  window.requestAnimationFrame(() => {
    button.scrollIntoView({ block: 'nearest', inline: 'center', behavior });
  });
}

function pointCostSummaryText() {
  return `AI对话 ${pointCosts.chat || 1} 点 / 提示词 ${pointCosts.text || pointCosts.byMode?.copy_title || 1} 点 / 画质升级 ${pointCosts.byMode?.image_enhance || pointCosts.imageEnhance || 5} 点 / 单图 ${pointCosts.singleImage || pointCost || 5} 点 / 电影分镜 ${pointCosts.byMode?.cinematic_storyboard || pointCosts.storyboard || 50} 点 / 方案图 ${pointCosts.byMode?.product_matrix || 10} 点 / 空地融合 ${pointCosts.byMode?.venue_fusion || pointCosts.singleImage || pointCost || 5} 点 / 局部改图 ${pointCosts.byMode?.partial_wedding_edit || pointCosts.partialEdit || 20} 点 / 设计图转实景 ${pointCosts.designRender || pointCosts.byMode?.design_render_scene || 5} 点 / 15s视频 ${motionConfig.pointCost || pointCosts.motion || 200} 点`;
}

function pageFromHash() {
  const hash = window.location.hash.replace(/^#/, '');
  if (hash === 'video' && !VIDEO_PAGE_ENABLED) return 'home';
  if (PUBLIC_PAGES.has(hash)) return hash;
  if (new URLSearchParams(window.location.search).get('resource')) return 'resources';
  return 'home';
}

function showPage(page = pageFromHash()) {
  const requestedHash = window.location.hash.replace(/^#/, '');
  if (!VIDEO_PAGE_ENABLED && (page === 'video' || requestedHash === 'video')) {
    page = 'home';
    if (requestedHash === 'video') {
      history.replaceState(null, '', `${window.location.pathname}${window.location.search}#home`);
    }
  }
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
  if (currentPage === 'geo') loadGeoCertification();
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

function showImageEnhanceUnavailableState() {
  if (!(selectedMode === 'image_enhance' && !imageEnhanceAvailable)) return;
  const message = imageEnhanceUnavailableMessage || '画质升级需要配置官方 Gemini API Key';
  activeJobId = null;
  canResumeActiveJob = false;
  generationInProgress = false;
  window.clearTimeout(activePollTimer);
  clearAutoResumeTimer();
  setProgress(0, message);
  renderLogs([`[config] ${message}`]);
  els.resultPanel.classList.add('hidden');
  els.collageImg.parentElement.classList.remove('pending');
  els.generateBtn.disabled = true;
  els.generateBtn.textContent = '需要配置 Gemini API Key';
  els.restartBtn.textContent = '重新开始';
  $$('.mode-card').forEach((button) => { button.disabled = false; });
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
  if (/Failed to fetch|Load failed|NetworkError|fetch failed|ECONNRESET|ERR_FAILED|ERR_NETWORK/i.test(text)) {
    return '网络连接中断，请刷新后重试；如果还失败，请检查本地预览服务或线上接口是否在线。';
  }
  if (/<!doctype\s+html|<html[\s>]|cloudflare|attention required|cf-error|sorry,\s*you have been blocked|ray id/i.test(text)) {
    return 'n1n.ai 接口被 Cloudflare 拦截，当前网络/IP/代理被上游拒绝访问。请换网络或代理、联系 n1n.ai 放行/更换可用 API 域名，或临时切回官方 OpenAI 接口。';
  }
  if (/request entity too large|payload too large|entity\.too\.large|HTTP\s*413/i.test(text)) {
    return '参考图总大小过大，请删除几张或重新上传较小图片后再试。';
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
  if (/\[enhance\]|优化|画质|清晰|高清/i.test(raw)) return '正在优化婚礼图片清晰度';
  if (/\[motion\]|视频|转场|运镜/i.test(raw)) return '已提交上游视频任务，正在等待出片';
  if (/\[generate\]|\[n1n\]|并发|开始|完成/i.test(raw)) return '正在生成婚礼成品图';
  return raw.replace(/\bhttps?:\/\/\S+/gi, '[已隐藏]').replace(/[a-zA-Z0-9_-]{12,}/g, '[已隐藏]').slice(0, 80);
}

function setMode(mode) {
  if (!MODE_CONFIG[mode]) mode = 'cinematic_storyboard';
  selectedMode = mode;
  let activeModeButton = null;
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
    if (isActive) activeModeButton = button;
    if (isActive) {
      button.classList.remove('mode-card-pop');
      void button.offsetWidth;
      button.classList.add('mode-card-pop');
      window.setTimeout(() => button.classList.remove('mode-card-pop'), 260);
    }
  });
  syncActiveModeScroll(activeModeButton);
  updateFusionControls();
  if (uploadedFile) {
    els.jobStatusText.textContent = isVenueFusionMode(mode) && !uploadedFusionFile
      ? '空地已上传，请继续上传婚礼素材图'
      : (isPartialWeddingEditMode(mode) && !partialEditInstructionText()
        ? '主图已上传，请填写局部改图指令'
        : `已选择：${MODE_CONFIG[mode].label}`);
  }
  const selectedText = selectedModeStatusText(mode);
  if (!uploadedFile) {
    els.jobStatusText.textContent = `${selectedText}，请上传素材`;
  } else if (isVenueFusionMode(mode) && !uploadedFusionFile) {
    els.jobStatusText.textContent = `${selectedText}，请继续上传婚礼素材图`;
  } else if (isPartialWeddingEditMode(mode) && !partialEditInstructionText()) {
    els.jobStatusText.textContent = `${selectedText}，请填写局部改图指令`;
  } else {
    els.jobStatusText.textContent = selectedText;
  }
  setMotionStyleVisibility(mode);
  setGenerating(false);
  showImageEnhanceUnavailableState();
}

function updateGenerateState() {
  els.generateBtn.disabled = !hasRequiredGeneratorInput() && !(canResumeActiveJob && activeJobId);
}

function updateImageEnhanceAvailabilityUI() {
  const card = document.querySelector('[data-mode="image_enhance"]');
  if (card) {
    card.disabled = generationInProgress;
    card.classList.toggle('opacity-50', false);
    card.title = imageEnhanceAvailable ? '' : (imageEnhanceUnavailableMessage || '画质升级需要配置官方 Gemini API Key');
  }
  if (selectedMode === 'image_enhance' && !imageEnhanceAvailable) {
    showImageEnhanceUnavailableState();
  }
  updateGenerateState();
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
  const partialWaiting = isPartialWeddingEditMode() && !partialEditInstructionText();
  setProgress(12, fusionWaiting
    ? '空地已上传，请继续上传婚礼素材图'
    : (partialWaiting ? '主图已上传，请填写局部改图指令' : `素材已就绪，当前模式：${MODE_CONFIG[selectedMode].label}`));
  renderLogs([fusionWaiting
    ? '[upload] 空地/空场图已载入，等待上传婚礼素材图'
    : (partialWaiting ? '[upload] 待修改主图已载入，等待填写局部改图指令' : '[upload] 素材图已载入，等待确认生成模式')]);
  if (fusionWaiting) {
    els.jobStatusText.textContent = `${selectedModeStatusText()}，请继续上传婚礼素材图`;
  } else if (partialWaiting) {
    els.jobStatusText.textContent = `${selectedModeStatusText()}，请填写局部改图指令`;
  } else {
    els.jobStatusText.textContent = `素材已就绪，${selectedModeStatusText()}`;
  }
  setGenerating(false);
}

function formatFileSize(bytes = 0) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0MB';
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))}KB`;
  return `${(value / 1024 / 1024).toFixed(value >= 10 * 1024 * 1024 ? 1 : 2)}MB`;
}

function setVoiceProgress(progress, text = '') {
  const normalized = Math.max(0, Math.min(100, Math.round(progress)));
  if (els.voiceProgressBar) els.voiceProgressBar.style.width = `${normalized}%`;
  if (els.voiceOverallProgress) els.voiceOverallProgress.textContent = `${normalized}%`;
  if (text && els.voiceJobStatusText) els.voiceJobStatusText.textContent = text;
}

function voiceNarrationText() {
  return String(els.voiceTextInput?.value || '').trim();
}

function voiceReferenceText() {
  return String(els.voiceReferenceTextInput?.value || '').trim();
}

function revokeVoiceUrl(kind = 'all') {
  if ((kind === 'all' || kind === 'sample') && voiceSampleObjectUrl) {
    URL.revokeObjectURL(voiceSampleObjectUrl);
    voiceSampleObjectUrl = '';
  }
  if ((kind === 'all' || kind === 'result') && voiceResultObjectUrl) {
    URL.revokeObjectURL(voiceResultObjectUrl);
    voiceResultObjectUrl = '';
  }
}

function updateVoiceGenerateState() {
  if (!els.voiceGenerateBtn) return;
  const ready = !!voiceSampleFile
    && !!voiceNarrationText()
    && !!els.voiceConsentCheck?.checked
    && !voiceGenerationInProgress;
  els.voiceGenerateBtn.disabled = !ready;
  if (!voiceSampleFile) setVoiceProgress(0, '等待上传声音样本');
  else if (!voiceNarrationText()) setVoiceProgress(18, '声音样本已就绪，请填写旁白文案');
  else if (!els.voiceConsentCheck?.checked) setVoiceProgress(28, '请确认本人声音或已获得授权');
  else if (!voiceGenerationInProgress) setVoiceProgress(35, '已就绪，可以生成旁白音频');
}

function handleVoiceFile(file) {
  if (!file) return;
  const type = String(file.type || '').toLowerCase();
  const ext = String(file.name || '').split('.').pop()?.toLowerCase() || '';
  const allowed = type.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(ext);
  if (!allowed) {
    alert('请上传 MP3、WAV、M4A、AAC、OGG 或 FLAC 音频');
    return;
  }
  if (file.size > MAX_VOICE_UPLOAD_SIZE) {
    alert(`声音样本太大，请控制在 ${formatFileSize(MAX_VOICE_UPLOAD_SIZE)} 以内`);
    return;
  }
  revokeVoiceUrl('sample');
  voiceSampleFile = file;
  voiceSampleObjectUrl = URL.createObjectURL(file);
  if (els.voiceSampleName) els.voiceSampleName.textContent = file.name || '本人声音样本';
  if (els.voiceSampleMeta) els.voiceSampleMeta.textContent = `${formatFileSize(file.size)} · ${type || ext.toUpperCase() || '音频'}`;
  if (els.voiceSampleAudio) els.voiceSampleAudio.src = voiceSampleObjectUrl;
  els.voiceSamplePreviewWrap?.classList.remove('hidden');
  els.voiceResultPanel?.classList.add('hidden');
  updateVoiceGenerateState();
}

function resetVoiceTool() {
  voiceSampleFile = null;
  voiceGenerationInProgress = false;
  revokeVoiceUrl('all');
  if (els.voiceFileInput) els.voiceFileInput.value = '';
  if (els.voiceSampleAudio) els.voiceSampleAudio.removeAttribute('src');
  if (els.voiceResultAudio) els.voiceResultAudio.removeAttribute('src');
  if (els.voiceDownloadBtn) els.voiceDownloadBtn.href = '#';
  els.voiceSamplePreviewWrap?.classList.add('hidden');
  els.voiceResultPanel?.classList.add('hidden');
  setVoiceProgress(0, '等待上传声音样本');
  updateVoiceGenerateState();
}

async function startVoiceGeneration() {
  if (voiceGenerationInProgress || !els.voiceGenerateBtn) return;
  if (!voiceSampleFile) {
    alert('请先上传本人声音样本');
    return;
  }
  const text = voiceNarrationText();
  if (!text) {
    alert('请填写旁白文案');
    return;
  }
  if (!els.voiceConsentCheck?.checked) {
    alert('请先确认声音授权');
    return;
  }

  voiceGenerationInProgress = true;
  updateVoiceGenerateState();
  setVoiceProgress(45, '正在提交声音旁白任务');
  els.voiceResultPanel?.classList.add('hidden');

  try {
    const formData = new FormData();
    formData.append('audio', voiceSampleFile, voiceSampleFile.name || 'voice-sample.wav');
    formData.append('text', text);
    formData.append('referenceText', voiceReferenceText());
    formData.append('consent', 'true');

    const response = await fetch('/api/voice/narration', {
      method: 'POST',
      body: formData,
    });
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!response.ok) {
      let message = '声音旁白生成失败';
      if (contentType.includes('application/json')) {
        const payload = await response.json().catch(() => ({}));
        message = payload.error || message;
      } else {
        message = (await response.text().catch(() => '')) || message;
      }
      throw new Error(message);
    }
    if (!contentType.startsWith('audio/')) {
      const payload = contentType.includes('application/json') ? await response.json().catch(() => ({})) : {};
      throw new Error(payload.error || '声音引擎没有返回音频');
    }
    const blob = await response.blob();
    revokeVoiceUrl('result');
    voiceResultObjectUrl = URL.createObjectURL(blob);
    if (els.voiceResultAudio) els.voiceResultAudio.src = voiceResultObjectUrl;
    if (els.voiceDownloadBtn) els.voiceDownloadBtn.href = voiceResultObjectUrl;
    if (els.voiceResultMeta) {
      const engine = response.headers.get('x-voice-engine') || 'voice-engine';
      els.voiceResultMeta.textContent = `${engine} · ${formatFileSize(blob.size)} · ${new Date().toLocaleString()}`;
    }
    els.voiceResultPanel?.classList.remove('hidden');
    setVoiceProgress(100, '旁白音频已生成');
  } catch (error) {
    setVoiceProgress(0, error.message || '声音旁白生成失败');
  } finally {
    voiceGenerationInProgress = false;
    if (els.voiceGenerateBtn) {
      els.voiceGenerateBtn.disabled = !(voiceSampleFile && voiceNarrationText() && els.voiceConsentCheck?.checked);
    }
  }
}

function validateSourceImageFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    alert('请选择 JPG 或 PNG 图片');
    return false;
  }
  if (file.size > MAX_SOURCE_UPLOAD_SIZE) {
    alert(`原图太大，请控制在 ${formatFileSize(MAX_SOURCE_UPLOAD_SIZE)} 以内`);
    return false;
  }
  return true;
}

function validateImageFile(file) {
  if (!validateSourceImageFile(file)) return false;
  if (file.size > MAX_UPLOAD_SIZE) {
    alert('图片处理后仍超过 10MB，请裁小一点或换一张图片');
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

function fileNameWithExtension(name = 'wedding-image.jpg', extension = 'jpg') {
  const safeName = String(name || 'wedding-image').replace(/[\\/:*?"<>|]+/g, '-');
  return safeName.replace(/\.[a-z0-9]+$/i, '') + `.${extension}`;
}

function blobToFile(blob, sourceFile, extension = 'jpg') {
  if (blob instanceof File && blob.name) return blob;
  const type = blob?.type || 'image/jpeg';
  const ext = type.includes('png') ? 'png' : extension;
  return new File([blob], fileNameWithExtension(sourceFile?.name || 'wedding-image.jpg', ext), {
    type,
    lastModified: Date.now(),
  });
}

function estimateDataUrlBytes(dataUrl = '') {
  const text = String(dataUrl || '');
  const commaIndex = text.indexOf(',');
  const payload = commaIndex >= 0 ? text.slice(commaIndex + 1) : text;
  return Math.ceil(payload.length * 0.75);
}

function chatReferenceTotalBytes(images = []) {
  return images.reduce((total, image) => total + estimateDataUrlBytes(image?.dataUrl || ''), 0);
}

function loadImageElementFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败'));
    };
    image.src = url;
  });
}

async function compressImageFileWithCanvas(file, options = {}) {
  if (!/^image\/(jpeg|jpg|png|webp)$/i.test(file?.type || '')) return file;
  const image = await loadImageElementFromFile(file);
  const maxWidth = options.maxWidth || CHAT_REFERENCE_MAX_EDGE;
  const maxHeight = options.maxHeight || CHAT_REFERENCE_MAX_EDGE;
  const scale = Math.min(1, maxWidth / Math.max(1, image.naturalWidth || image.width), maxHeight / Math.max(1, image.naturalHeight || image.height));
  const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
  const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  const quality = options.quality || CHAT_REFERENCE_QUALITY;
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  return blob ? blobToFile(blob, file, 'jpg') : file;
}

function compressImageFile(file, options = {}) {
  if (typeof window.Compressor !== 'function') {
    return Promise.resolve(file);
  }
  return new Promise((resolve) => {
    new window.Compressor(file, {
      quality: options.quality || IMAGE_OPTIMIZE_QUALITY,
      maxWidth: options.maxWidth || IMAGE_OPTIMIZE_MAX_EDGE,
      maxHeight: options.maxHeight || IMAGE_OPTIMIZE_MAX_EDGE,
      mimeType: options.mimeType || 'image/jpeg',
      convertSize: 750000,
      checkOrientation: true,
      success(result) {
        resolve(blobToFile(result, file, 'jpg'));
      },
      error() {
        resolve(file);
      },
    });
  });
}

function destroyUploadEditorCropper() {
  if (uploadEditorCropper) {
    try { uploadEditorCropper.destroy(); } catch {}
    uploadEditorCropper = null;
  }
}

function ensureUploadEditorModal() {
  if (uploadEditorModal) return uploadEditorModal;
  const overlay = document.createElement('div');
  overlay.className = 'upload-editor-overlay hidden';
  overlay.innerHTML = `
    <div class="upload-editor-card" role="dialog" aria-modal="true" aria-label="上传图片裁剪">
      <div class="upload-editor-head">
        <div class="upload-editor-title">
          <strong>上传前轻编辑</strong>
          <span>裁剪比例并自动压缩，减少上传失败和画面跑偏</span>
        </div>
        <button type="button" class="upload-editor-close" aria-label="关闭">关闭</button>
      </div>
      <div class="upload-editor-ratios" aria-label="裁剪比例">
        <button type="button" class="active" data-ratio="free">原比例</button>
        <button type="button" data-ratio="1.7777777778">16:9</button>
        <button type="button" data-ratio="0.75">3:4</button>
        <button type="button" data-ratio="1">1:1</button>
      </div>
      <div class="upload-editor-stage"><img alt="待裁剪图片" /></div>
      <div class="upload-editor-footer">
        <span class="upload-editor-status"></span>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="upload-editor-skip">直接压缩</button>
          <button type="button" class="upload-editor-apply">使用裁剪图</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  uploadEditorModal = {
    overlay,
    img: overlay.querySelector('.upload-editor-stage img'),
    status: overlay.querySelector('.upload-editor-status'),
    closeBtn: overlay.querySelector('.upload-editor-close'),
    skipBtn: overlay.querySelector('.upload-editor-skip'),
    applyBtn: overlay.querySelector('.upload-editor-apply'),
    ratioBtns: Array.from(overlay.querySelectorAll('.upload-editor-ratios button')),
    objectUrl: '',
    resolver: null,
  };
  return uploadEditorModal;
}

async function finalizePreparedImage(file, originalFile, options = {}) {
  const optimizedFile = await compressImageFile(file, options);
  const dataUrl = await readFileAsDataUrl(optimizedFile);
  if (originalFile && optimizedFile.size < originalFile.size * 0.96) {
    showSaveNotice(`图片已优化：${formatFileSize(originalFile.size)} → ${formatFileSize(optimizedFile.size)}`);
  }
  return { file: optimizedFile, dataUrl };
}

function openUploadEditor(file, options = {}) {
  if (!options.allowCrop || typeof window.Cropper !== 'function') {
    return finalizePreparedImage(file, file, options);
  }
  const modal = ensureUploadEditorModal();
  return new Promise((resolve) => {
    const finish = async (preparedFile) => {
      destroyUploadEditorCropper();
      if (modal.objectUrl) URL.revokeObjectURL(modal.objectUrl);
      modal.objectUrl = '';
      modal.overlay.classList.add('hidden');
      document.body.classList.remove('modal-open');
      modal.status.textContent = '';
      resolve(await finalizePreparedImage(preparedFile, file, options));
    };
    const cancel = () => finish(file);

    destroyUploadEditorCropper();
    if (modal.objectUrl) URL.revokeObjectURL(modal.objectUrl);
    modal.objectUrl = URL.createObjectURL(file);
    modal.status.textContent = `原图 ${formatFileSize(file.size)}，建议先裁剪关键画面`;
    modal.ratioBtns.forEach((button) => button.classList.toggle('active', button.dataset.ratio === 'free'));
    modal.overlay.classList.remove('hidden');
    document.body.classList.add('modal-open');

    const onClose = () => {
      cleanup();
      cancel();
    };
    const onSkip = () => {
      cleanup();
      finish(file);
    };
    const onApply = () => {
      if (!uploadEditorCropper) {
        cleanup();
        finish(file);
        return;
      }
      modal.applyBtn.disabled = true;
      modal.skipBtn.disabled = true;
      modal.status.textContent = '正在导出裁剪图...';
      const canvas = uploadEditorCropper.getCroppedCanvas({
        maxWidth: IMAGE_OPTIMIZE_MAX_EDGE,
        maxHeight: IMAGE_OPTIMIZE_MAX_EDGE,
        fillColor: '#ffffff',
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
      });
      if (!canvas) {
        cleanup();
        finish(file);
        return;
      }
      canvas.toBlob((blob) => {
        modal.applyBtn.disabled = false;
        modal.skipBtn.disabled = false;
        cleanup();
        finish(blob ? blobToFile(blob, file, 'jpg') : file);
      }, 'image/jpeg', IMAGE_OPTIMIZE_QUALITY);
    };
    const onRatioClick = (event) => {
      const button = event.currentTarget;
      modal.ratioBtns.forEach((item) => item.classList.toggle('active', item === button));
      if (!uploadEditorCropper) return;
      const raw = button.dataset.ratio;
      uploadEditorCropper.setAspectRatio(raw === 'free' ? NaN : Number(raw));
    };
    const cleanup = () => {
      modal.closeBtn.removeEventListener('click', onClose);
      modal.skipBtn.removeEventListener('click', onSkip);
      modal.applyBtn.removeEventListener('click', onApply);
      modal.ratioBtns.forEach((button) => button.removeEventListener('click', onRatioClick));
      modal.img.onload = null;
      modal.applyBtn.disabled = false;
      modal.skipBtn.disabled = false;
    };

    modal.closeBtn.addEventListener('click', onClose);
    modal.skipBtn.addEventListener('click', onSkip);
    modal.applyBtn.addEventListener('click', onApply);
    modal.ratioBtns.forEach((button) => button.addEventListener('click', onRatioClick));
    modal.img.onload = () => {
      destroyUploadEditorCropper();
      uploadEditorCropper = new window.Cropper(modal.img, {
        viewMode: 1,
        autoCropArea: 0.92,
        background: false,
        responsive: true,
        checkOrientation: true,
      });
    };
    modal.img.src = modal.objectUrl;
  });
}

async function prepareImageUpload(file, options = {}) {
  if (!validateSourceImageFile(file)) return null;
  try {
    const prepared = await openUploadEditor(file, {
      allowCrop: options.allowCrop !== false,
      maxWidth: options.maxWidth || IMAGE_OPTIMIZE_MAX_EDGE,
      maxHeight: options.maxHeight || IMAGE_OPTIMIZE_MAX_EDGE,
      quality: options.quality || IMAGE_OPTIMIZE_QUALITY,
    });
    if (!validateImageFile(prepared.file)) return null;
    return prepared;
  } catch (error) {
    alert(error.message || '图片处理失败，请换一张图片重试');
    return null;
  }
}

async function handleFile(file) {
  const prepared = await prepareImageUpload(file, { allowCrop: true });
  if (!prepared) return;
  showInput(prepared.file, prepared.dataUrl);
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
  els.jobStatusText.textContent = ready
    ? `素材已就绪，${selectedModeStatusText()}`
    : `${selectedModeStatusText()}，请继续上传空地照片`;
  setGenerating(false);
}

async function handleFusionFile(file) {
  const prepared = await prepareImageUpload(file, { allowCrop: true });
  if (!prepared) return;
  showFusionInput(prepared.file, prepared.dataUrl);
}

function renderPartialReferencePreviews() {
  if (!els.partialReferencePreviewWrap || !els.partialReferencePreviewList) return;
  els.partialReferencePreviewList.innerHTML = '';
  uploadedEditReferenceDataUrls.forEach((dataUrl, index) => {
    const item = document.createElement('div');
    item.className = 'partial-reference-thumb';
    item.innerHTML = `<img src="${dataUrl}" alt="局部改图参考图 ${index + 1}" /><b class="drag-handle" aria-hidden="true">↕</b><span>参考 ${index + 1}</span>`;
    els.partialReferencePreviewList.appendChild(item);
  });
  els.partialReferencePreviewWrap.classList.toggle('hidden', uploadedEditReferenceDataUrls.length === 0);
  enablePartialReferenceSorting();
}

function moveArrayItem(items, fromIndex, toIndex) {
  if (!Array.isArray(items) || fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return items;
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

function enablePartialReferenceSorting() {
  if (!els.partialReferencePreviewList || typeof window.Sortable !== 'function') return;
  if (partialReferenceSortable) {
    try { partialReferenceSortable.destroy(); } catch {}
    partialReferenceSortable = null;
  }
  if (uploadedEditReferenceFiles.length < 2) {
    els.partialReferencePreviewList.classList.remove('sortable-active');
    return;
  }
  els.partialReferencePreviewList.classList.add('sortable-active');
  partialReferenceSortable = window.Sortable.create(els.partialReferencePreviewList, {
    animation: 150,
    handle: '.drag-handle',
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    onEnd(event) {
      uploadedEditReferenceFiles = moveArrayItem(uploadedEditReferenceFiles, event.oldIndex, event.newIndex);
      uploadedEditReferenceDataUrls = moveArrayItem(uploadedEditReferenceDataUrls, event.oldIndex, event.newIndex);
      renderPartialReferencePreviews();
      renderLogs([`[upload] 已调整参考图顺序：优先参考 ${uploadedEditReferenceFiles.length} 张图`]);
    },
  });
}

function clearPartialReferences() {
  uploadedEditReferenceFiles = [];
  uploadedEditReferenceDataUrls = [];
  if (partialReferenceSortable) {
    try { partialReferenceSortable.destroy(); } catch {}
    partialReferenceSortable = null;
  }
  if (els.partialReferenceInput) els.partialReferenceInput.value = '';
  renderPartialReferencePreviews();
  setGenerating(false);
}

async function handlePartialReferenceFiles(fileList) {
  const files = Array.from(fileList || []).filter(Boolean).slice(0, 3);
  if (!files.length) return;
  const validFiles = [];
  const dataUrls = [];
  for (const file of files) {
    const prepared = await prepareImageUpload(file, { allowCrop: false, maxWidth: 1800, maxHeight: 1800 });
    if (!prepared) return;
    validFiles.push(prepared.file);
    dataUrls.push(prepared.dataUrl);
  }
  uploadedEditReferenceFiles = validFiles;
  uploadedEditReferenceDataUrls = dataUrls;
  renderPartialReferencePreviews();
  renderLogs([`[upload] 已添加 ${validFiles.length} 张局部改图参考图`]);
  setGenerating(false);
}

async function handleGeneratorFiles(fileList) {
  const files = Array.from(fileList || []).filter(Boolean);
  if (!files.length) return;
  if (isVenueFusionMode() && files.length >= 2) {
    await handleFile(files[0]);
    await handleFusionFile(files[1]);
    return;
  }
  if (isPartialWeddingEditMode() && files.length >= 2) {
    await handleFile(files[0]);
    await handlePartialReferenceFiles(files.slice(1, 4));
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

function getSamplePhotoAreaImage() {
  return svgToDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
      <defs>
        <linearGradient id="wall" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#fff8f1"/>
          <stop offset="0.55" stop-color="#efe4dc"/>
          <stop offset="1" stop-color="#d8c6ba"/>
        </linearGradient>
        <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#e8ded3"/>
          <stop offset="1" stop-color="#bba999"/>
        </linearGradient>
        <radialGradient id="flower" cx="50%" cy="42%" r="58%">
          <stop offset="0" stop-color="#fff7ed"/>
          <stop offset="0.54" stop-color="#f0c2b5"/>
          <stop offset="1" stop-color="#c78f84"/>
        </radialGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="22" stdDeviation="24" flood-color="#5b463b" flood-opacity="0.20"/>
        </filter>
      </defs>
      <rect width="1200" height="610" fill="url(#wall)"/>
      <path d="M0 610H1200V900H0Z" fill="url(#floor)"/>
      <path d="M170 610C390 560 810 560 1030 610" fill="none" stroke="#fff7ed" stroke-width="5" opacity="0.55"/>
      <g filter="url(#shadow)">
        <rect x="392" y="150" width="416" height="430" rx="28" fill="#fbf4ec"/>
        <rect x="430" y="190" width="340" height="350" rx="22" fill="#e3d1c5"/>
        <circle cx="600" cy="320" r="86" fill="#fffaf4" opacity="0.72"/>
        <rect x="486" y="452" width="228" height="18" rx="9" fill="#b59b86" opacity="0.38"/>
        <rect x="520" y="486" width="160" height="14" rx="7" fill="#b59b86" opacity="0.26"/>
      </g>
      <rect x="220" y="360" width="154" height="232" rx="16" fill="#fffdf9" stroke="#d4b46e" stroke-width="8" filter="url(#shadow)"/>
      <rect x="252" y="405" width="90" height="10" rx="5" fill="#b59b86" opacity="0.45"/>
      <rect x="244" y="435" width="108" height="8" rx="4" fill="#b59b86" opacity="0.25"/>
      <rect x="260" y="470" width="76" height="8" rx="4" fill="#b59b86" opacity="0.25"/>
      ${Array.from({ length: 34 }, (_, i) => {
        const side = i % 2 ? 1 : -1;
        const x = side > 0 ? 774 + ((i * 37) % 148) : 286 + ((i * 41) % 168);
        const y = 190 + ((i * 53) % 430);
        const r = 18 + (i % 4) * 5;
        return `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#flower)" opacity="${0.72 + (i % 3) * 0.08}"/>`;
      }).join('')}
      ${Array.from({ length: 18 }, (_, i) => {
        const x = 420 + i * 20;
        const y = 122 + ((i % 2) * 18);
        return `<circle cx="${x}" cy="${y}" r="5" fill="#f9d48f" opacity="0.82"/>`;
      }).join('')}
      <circle cx="858" cy="628" r="34" fill="#fff7ed" opacity="0.82"/>
      <circle cx="905" cy="642" r="24" fill="#f0c2b5" opacity="0.82"/>
      <circle cx="820" cy="650" r="28" fill="#d4b46e" opacity="0.62"/>
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
  const dataUrl = isImageEnhanceMode()
    ? WEDDING_IMAGE_OPT_SAMPLE_URL
    : (isPhotoAreaSetupGridMode() ? getSamplePhotoAreaImage() : getSampleInputImage());
  const sampleFilename = isImageEnhanceMode()
    ? 'sample-wedding-image-opt.jpg'
    : (isPhotoAreaSetupGridMode() ? 'sample-photo-area-scene.png' : 'sample-wedding-scene.png');
  const file = await dataUrlToFile(dataUrl, sampleFilename);
  if (isPartialWeddingEditMode() && els.partialEditInstruction && !partialEditInstructionText()) {
    els.partialEditInstruction.value = '把舞台和通道花艺改成白绿色森系风格，保留原来的宴会厅、构图、地面和灯光关系。';
  }
  showInput(file, dataUrl);
}

function updateAccountUI() {
  updateRechargeVisibility();
  if (!els.authEntryBtn) return;
  const compact = window.matchMedia?.('(max-width: 767px)').matches;
  if (currentUser) {
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
  if (user?.membershipPermanent || String(user?.membershipPlan || '').includes('永久')) return '永久有效';
  const expiresAt = user?.membershipExpiresAt;
  if (!expiresAt) return '未开通';
  if (String(expiresAt) === '9999-12-31T23:59:59.999Z') return '永久有效';
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return '未开通';
  const prefix = user.membershipStatus === 'expired' ? '已过期：' : '有效至 ';
  return `${prefix}${date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })}`;
}

function hasActiveMembership(user) {
  if (!user) return false;
  if (user.membershipPermanent || String(user.membershipPlan || '').includes('永久')) return true;
  if (user.membershipStatus === 'active') return true;
  const expiryTime = Date.parse(user.membershipExpiresAt || '');
  return Number.isFinite(expiryTime) && expiryTime >= Date.now();
}

function isSuperCustomBypassUser(user) {
  if (!user) return false;
  const roleText = `${user.role || ''} ${user.source || ''} ${user.tenantRole || ''}`.toLowerCase();
  return /tenant_admin|(^|[\s_-])(admin|owner|test)([\s_-]|$)|管理员|测试/.test(roleText);
}

function isImageOnlyMembershipPlan(plan = '') {
  return IMAGE_ONLY_PLAN_PATTERN.test(String(plan || ''));
}

function isLegacyVideoCustomer(user) {
  const createdAt = Date.parse(user?.createdAt || '');
  return Number.isFinite(createdAt) && createdAt < LEGACY_VIDEO_ACCESS_CUTOFF;
}

function canUseMotionFeatures(user = currentUser) {
  if (!accountRequired) return true;
  if (!user) return false;
  if (user.motionAllowed === true) return true;
  if (user.motionAllowed === false) return false;
  if (isSuperCustomBypassUser(user)) return true;
  if (isLegacyVideoCustomer(user)) return true;
  if (isImageOnlyMembershipPlan(user.membershipPlan)) return false;
  return hasActiveMembership(user);
}

function motionAccessMessage() {
  return VIDEO_ACCESS_DENIED_MESSAGE;
}

function canUseSuperCustom(user = currentUser) {
  return !accountRequired || !!user;
}

function superCustomAccessMessage() {
  return '超级定制已开放，登录账号并保持灵感值充足即可使用。';
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
    imageEnhanceAvailable = data.imageEnhanceAvailable !== false;
    imageEnhanceUnavailableMessage = String(data.imageEnhanceMessage || '').trim();
    accountRequired = !!data.accountRequired;
    if (els.chatStatusText && data.chatEnabled === false) chatStatus('接口未配置');
    els.apiStatus.textContent = data.openaiEnabled ? '生成服务已就绪' : '演示模式';
    els.apiStatus.classList.toggle('text-emerald-200', !!data.openaiEnabled);
    els.apiStatus.classList.toggle('text-stone-400', !data.openaiEnabled);
    updateAccountUI();
    updateImageEnhanceAvailabilityUI();
  } catch {
    apiProvider = 'mock';
    imageEnhanceAvailable = false;
    imageEnhanceUnavailableMessage = '画质升级状态检查失败，请稍后刷新页面';
    if (els.chatStatusText) chatStatus('服务检查失败');
    els.apiStatus.textContent = '演示服务';
    updateAccountUI();
    updateImageEnhanceAvailabilityUI();
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
      <p id="accessHelp" class="text-stone-500 leading-7 mt-3">请输入手机号和密码。新账号默认赠送试用点数，用完后联系管理员充值。</p>
      <input id="accessLoginInput" type="tel" autocomplete="tel" inputmode="numeric" maxlength="11" placeholder="手机号" />
      <input id="accessCodeInput" type="password" autocomplete="current-password" placeholder="密码" />
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
      const loginValue = String(login.value || '').replace(/\D+/g, '');
      if (accountRequired) {
        login.value = loginValue;
        if (!/^1[3-9]\d{9}$/.test(loginValue)) {
          throw new Error('请输入有效的 11 位手机号');
        }
      }
      const response = await fetch(apiUrl('/api/access'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: accountRequired ? loginValue : login.value, code: input.value, partner: currentPartnerSlug() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || (accountRequired ? '登录失败' : '访问码验证失败'));
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
  input.placeholder = accountRequired ? '密码' : '访问码';
  title.textContent = accountRequired ? '登录客户账号' : '请输入公测访问码';
  help.textContent = accountRequired
    ? '请输入手机号和密码。新账号默认赠送试用点数，用完后联系管理员充值。'
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
    .recharge-card .plan-tile { background: linear-gradient(145deg, #fff7ed, #f5e6d8); border: 1px solid rgba(58,39,34,0.08); border-radius: 12px; padding: 16px 12px 14px; text-align: center; display: flex; flex-direction: column; justify-content: center; gap: 4px; min-height: 148px; position: relative; overflow: hidden; }
    .recharge-card .plan-grid.plan-grid-compact .plan-tile { min-height: 132px; }
    .recharge-card .plan-banner { margin-bottom: 8px; min-height: auto; padding: 14px 16px; text-align: left; display: grid; grid-template-columns: 88px 1fr 1fr; align-items: center; column-gap: 14px; }
    .recharge-card .plan-banner .plan-price-block,
    .recharge-card .plan-banner .plan-metric-block,
    .recharge-card .plan-banner .plan-tail-block { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .recharge-card .plan-banner .plan-price-block strong { font-size: 20px; }
    .recharge-card .plan-banner .plan-desc { font-size: 11px; }
    .recharge-card .plan-tile.is-featured { background: linear-gradient(145deg, #fff4e8, #ead0bf); border-color: rgba(139,63,50,0.34); box-shadow: 0 14px 30px -22px rgba(139,63,50,0.8); }
    .recharge-card .plan-tile .plan-badge { position: absolute; top: 8px; right: 8px; z-index: 3; padding: 2px 7px; min-width: 30px; border-radius: 999px; background: #7f2f26; color: #fffaf3; font-size: 10px; font-weight: 900; line-height: 1.35; box-shadow: 0 5px 12px -8px rgba(58,39,34,0.9); }
    .recharge-card .plan-recommend-ribbon { position: absolute; top: -1px; left: -1px; width: 68px; height: 68px; z-index: 4; overflow: hidden; pointer-events: none; }
    .recharge-card .plan-recommend-ribbon b { position: absolute; left: -19px; top: 13px; width: 82px; transform: rotate(-43deg); transform-origin: center; display: block; padding: 2px 0 3px; background: linear-gradient(90deg, #f8d58f, #c98b34 58%, #fff0bd); color: #4a2418; font-size: 10px; font-weight: 900; line-height: 1.2; box-shadow: 0 5px 14px -8px rgba(58,39,34,0.8); }
    .recharge-card .plan-tile strong { font-size: 18px; font-weight: 700; color: #3a2722; }
    .recharge-card .plan-tile span { font-size: 11px; color: rgba(28,25,23,0.6); }
    .recharge-card .plan-tile .plan-name { font-size: 13px; color: #3a2722; font-weight: 700; }
    .recharge-card .plan-tile em { font-style: normal; font-size: 10px; color: rgba(124,63,53,0.86); font-weight: 700; line-height: 1.35; }
    .recharge-card .plan-tile .plan-image-unit { color: #8b3f32; font-size: 11px; font-weight: 900; }
    .recharge-card .plan-tile .plan-desc { font-size: 10px; color: rgba(28,25,23,0.52); line-height: 1.45; }
    .recharge-card .plan-benefits { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px; margin-top: 2px; }
    .recharge-card .plan-benefit { display: inline-flex; align-items: center; min-height: 18px; padding: 2px 6px; border-radius: 999px; background: rgba(127,47,38,0.08); color: rgba(91,43,36,0.82); font-size: 10px; font-weight: 800; line-height: 1.25; }
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
      .recharge-card .plan-banner { grid-template-columns: 1fr; text-align: center; gap: 5px; }
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
  return `${unitCost <= 5 ? '低至' : '约'}${unitCost.toFixed(2)}元/条`;
}

function formatRechargeCount(count) {
  const value = Number(count || 0);
  if (!Number.isFinite(value) || value <= 0) return '';
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
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
    const packageOnly = plan.packageOnly === true || profile.packageOnly === true;
    const includesMotion = plan.includesMotion !== false && profile.includesMotion !== false;
    const countBase = packageOnly ? 0 : pointCount;
    const textCount = Number(plan.textGenerations || 0) || Math.floor(countBase / Math.max(1, pointCosts.text || 1));
    const singleImageCount = Number(plan.singleImageGenerations || plan.imageGenerations || 0) || Math.floor(countBase / Math.max(1, pointCosts.singleImage || pointCost || 5));
    const videoCount = includesMotion ? (Number(plan.motionGenerations || 0) || (countBase / Math.max(1, motionConfig.pointCost || 200))) : 0;
    const imageUnitCost = Number(plan.imageUnitCost || 0) || (priceValue && singleImageCount ? priceValue / singleImageCount : 0);
    const unitCost = Number(plan.motionUnitCost || 0) || (priceValue && videoCount ? priceValue / videoCount : 0);
    return {
      id: plan.id || `${plan.priceText || priceValue}-${plan.pointsText || pointCount}-${index}`,
      name: plan.name || profile.name || '',
      price: plan.priceText || (priceValue ? `${priceValue}元` : ''),
      priceValue,
      points: plan.pointsText || (pointCount ? `${pointCount}灵感值` : ''),
      pointCount,
      packageOnly,
      packageText: plan.packageText || profile.packageText || '',
      textCount,
      singleImageCount,
      imageUnitCost,
      videoCount,
      unitCost,
      badge: plan.badge || profile.badge || '',
      description: plan.description || profile.description || '',
      benefits: Array.isArray(plan.benefits) && plan.benefits.length ? plan.benefits : (profile.benefits || []),
      includesMotion,
      durationText: plan.durationText || profile.durationText || '',
      featured: !!(plan.featured || profile.featured),
    };
  }

  const [price, points] = String(plan || '').split('=');
  const priceValue = Number(String(price || '').match(/[\d.]+/)?.[0] || 0);
  const pointCount = Number(String(points || '').match(/\d+/)?.[0] || 0);
  const profile = getRechargePlanProfile(priceValue);
  const packageOnly = profile.packageOnly === true;
  const includesMotion = profile.includesMotion !== false;
  const countBase = packageOnly ? 0 : pointCount;
  const textCount = Math.floor(countBase / Math.max(1, pointCosts.text || 1));
  const singleImageCount = Math.floor(countBase / Math.max(1, pointCosts.singleImage || pointCost || 5));
  const videoCount = includesMotion ? countBase / Math.max(1, motionConfig.pointCost || 200) : 0;
  const imageUnitCost = priceValue && singleImageCount ? priceValue / singleImageCount : 0;
  const unitCost = priceValue && videoCount ? priceValue / videoCount : 0;
  return {
    id: `${String(price || '').trim()}-${String(points || '').trim()}-${index}`,
    name: profile.name || '',
    price,
    priceValue,
    points,
    pointCount,
    packageOnly,
    packageText: profile.packageText || '',
    textCount,
    singleImageCount,
    imageUnitCost,
    videoCount,
    unitCost,
    badge: profile.badge || '',
    description: profile.description || '',
    benefits: profile.benefits || [],
    includesMotion,
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
    .filter((plan) => plan.price && (plan.pointCount > 0 || plan.packageOnly));
}

function supportContactsForDisplay() {
  if (isPartnerRechargeContext()) return [];
  const structuredContacts = Array.isArray(siteInfo.supportContacts) ? siteInfo.supportContacts : [];
  const contacts = structuredContacts
    .map((contact) => ({
      wechat: String(contact?.wechat || contact?.id || '').trim(),
      qr: String(contact?.qr || contact?.qrUrl || '').trim(),
    }))
    .filter((contact) => contact.wechat || contact.qr);
  if (contacts.length) return contacts.slice(0, 1);
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
      <div><span>AI 对话消耗</span><strong>${pointCosts.chat || 1} 灵感值 / 次</strong></div>
      <div><span>提示词消耗</span><strong>${pointCosts.text || pointCosts.byMode?.copy_title || 1} 灵感值 / 次</strong></div>
      <div><span>单图消耗</span><strong>${pointCosts.singleImage || pointCost || 5} 灵感值 / 次</strong></div>
      <div><span>电影分镜消耗</span><strong>${pointCosts.byMode?.cinematic_storyboard || pointCosts.storyboard || 50} 灵感值 / 次</strong></div>
      <div><span>方案图消耗</span><strong>${pointCosts.planImage || pointCosts.byMode?.product_matrix || 10} 灵感值 / 次</strong></div>
      <div><span>视频消耗</span><strong>${motionConfig.pointCost || 200} 灵感值 / 15s</strong></div>
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
      <div><span>AI 对话消耗</span><strong>${pointCosts.chat || 1} 灵感值 / 次</strong></div>
      <div><span>提示词消耗</span><strong>${pointCosts.text || pointCosts.byMode?.copy_title || 1} 灵感值 / 次</strong></div>
      <div><span>单图消耗</span><strong>${pointCosts.singleImage || pointCost || 5} 灵感值 / 次</strong></div>
      <div><span>电影分镜消耗</span><strong>${pointCosts.byMode?.cinematic_storyboard || pointCosts.storyboard || 50} 灵感值 / 次</strong></div>
      <div><span>方案图消耗</span><strong>${pointCosts.planImage || pointCosts.byMode?.product_matrix || 10} 灵感值 / 次</strong></div>
      <div><span>视频消耗</span><strong>${motionConfig.pointCost || 200} 灵感值 / 15s</strong></div>
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

function removeContactOverlays() {
  ['rechargeOverlay', 'guideContactOverlay'].forEach((id) => {
    const overlay = document.getElementById(id);
    if (overlay) overlay.remove();
  });
}

function supportContactCardHtml(contact) {
  let html = '<div class="support-contact">';
  html += '<div class="support-contact-label">微信客服1</div>';
  if (contact.qr) {
    html += `<div class="recharge-qr"><img src="${escapeHtml(contact.qr)}" alt="客服微信二维码1"></div>`;
  }
  if (contact.wechat) {
    html += `<div class="recharge-wechat">客服微信：<strong>${escapeHtml(contact.wechat)}</strong></div>`;
  }
  html += '</div>';
  return html;
}

function isRecommendedRechargePlan(plan = {}) {
  const priceValue = Number(plan.priceValue || String(plan.price || plan.priceText || '').match(/[\d.]+/)?.[0] || 0);
  return Math.abs(priceValue - 899) < 0.01 || /专业/.test(`${plan.name || ''}${plan.badge || ''}${plan.durationText || ''}`);
}

function isAnnualRechargePlan(plan = {}) {
  const priceValue = Number(plan.priceValue || String(plan.price || plan.priceText || '').match(/[\d.]+/)?.[0] || 0);
  return Math.abs(priceValue - 3980) < 0.01 || /AI经理|ai经理/.test(`${plan.name || ''}${plan.badge || ''}${plan.durationText || ''}`);
}

function isPartnerRechargeContext() {
  const params = new URLSearchParams(window.location.search);
  return !!(params.get('partner') || params.get('t')) || (!!siteInfo.tenant && siteInfo.tenant.defaultTenant === false);
}

function updateRechargeVisibility() {
  const hidden = isPartnerRechargeContext();
  [els.rechargeFromLogsBtn, els.guideContactBtn].forEach((button) => {
    if (button) {
      button.hidden = hidden;
      button.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    }
  });
  document.body?.classList.toggle('partner-recharge-hidden', hidden);
}

function compactRechargePlanName(plan, index = 0) {
  return ['图片版', '体验版', '专业版', 'AI经理'][index] || plan.name || '';
}

function rechargePlanTileHtml(plan, { banner = false, compact = false, index = 0 } = {}) {
  const packageOnly = plan.packageOnly === true;
  const pointLabel = String(plan.packageText || plan.points || '').replace(/^(\d+)(\S+)/, '$1 $2');

  if (compact) {
    const name = compactRechargePlanName(plan, index);
    const imageHint = !packageOnly && plan.singleImageCount ? `<em>约 ${escapeHtml(formatRechargeCount(plan.singleImageCount))} 张图片</em>` : '';
    const videoHint = packageOnly || plan.includesMotion === false ? '' : (plan.videoCount ? `<em>约 ${escapeHtml(formatRechargeCount(plan.videoCount))} 条15s视频</em>` : '');
    return `<div class="plan-tile${plan.featured ? ' is-featured' : ''}"><strong>${escapeHtml(plan.price || '')}</strong>${name ? `<span class="plan-name">${escapeHtml(name)}</span>` : ''}<span>${escapeHtml(pointLabel)}</span>${imageHint}${videoHint}</div>`;
  }

  if (banner) {
    return `
      <div class="plan-tile plan-banner${plan.featured ? ' is-featured' : ''}">
        <div class="plan-price-block"><strong>${escapeHtml(plan.price || '')}</strong><span>${escapeHtml(pointLabel)}</span></div>
      </div>
    `;
  }

  const badge = plan.badge ? `<span class="plan-badge">${escapeHtml(plan.badge)}</span>` : '';
  const ribbon = isAnnualRechargePlan(plan)
    ? '<span class="plan-recommend-ribbon"><b>高级代理</b></span>'
    : (isRecommendedRechargePlan(plan) ? '<span class="plan-recommend-ribbon"><b>推荐</b></span>' : '');
  const unitHint = formatRechargeUnitCost(plan.unitCost);
  const singleImageHint = !packageOnly && plan.singleImageCount ? `<em>约 ${escapeHtml(formatRechargeCount(plan.singleImageCount))} 次单图</em>` : '';
  const imageUnitHint = !packageOnly && plan.imageUnitCost ? `<em class="plan-image-unit">${escapeHtml(formatRechargeImageUnitCost(plan.imageUnitCost))}</em>` : '';
  const videoHint = packageOnly || plan.includesMotion === false ? '' : (plan.videoCount ? `<em>约 ${escapeHtml(formatRechargeCount(plan.videoCount))} 条15s视频</em><em>${escapeHtml(unitHint)}</em>` : '');
  const durationHint = plan.durationText ? `<em>${escapeHtml(plan.durationText)}</em>` : '';
  const name = plan.name ? `<span class="plan-name">${escapeHtml(plan.name)}</span>` : '';
  const desc = plan.description ? `<span class="plan-desc">${escapeHtml(plan.description)}</span>` : '';
  const benefits = Array.isArray(plan.benefits) && plan.benefits.length
    ? `<span class="plan-benefits">${plan.benefits.slice(0, packageOnly ? 3 : 2).map((benefit) => `<span class="plan-benefit">${escapeHtml(benefit)}</span>`).join('')}</span>`
    : '';
  return `<div class="plan-tile${plan.featured ? ' is-featured' : ''}">${ribbon}${badge}<strong>${escapeHtml(plan.price || '')}</strong>${name}<span>${escapeHtml(pointLabel)}</span>${durationHint}${singleImageHint}${imageUnitHint}${videoHint}${benefits}${desc}</div>`;
}

function showRechargeDialog() {
  if (isPartnerRechargeContext()) {
    removeContactOverlays();
    return;
  }
  ensureRechargeStyles();
  removeContactOverlays();
  const contacts = supportContactsForDisplay();
  const parsedPlans = rechargePlansForDisplay();
  const overlay = document.createElement('div');
  overlay.className = 'recharge-overlay';
  overlay.id = 'rechargeOverlay';
  let inner = '<div class="recharge-card">';
  inner += '<button type="button" class="recharge-close" aria-label="关闭">×</button>';
  inner += '<h3>购买灵感值</h3>';
  inner += '<p class="recharge-sub">新套餐分为图片生成版、体验版、专业版和 AI经理。体验版起包含视频生成能力，灵感值可用于生成婚礼成品图、小红书文案和完整高清视频；专业版/AI经理解锁更完整的升级工具。付款后备注账号，确认后补充额度。</p>';
  if (currentUser) {
    inner += `<div class="recharge-status"><span>当前账号 <strong>${escapeHtml(displayAccountName(currentUser))}</strong></span><span>可用 <strong>${currentUser.points ?? 0}</strong> 灵感值</span><span>${escapeHtml(formatMembershipExpiry(currentUser))}</span></div>`;
  }
  if (parsedPlans.length) {
    const compactPlans = isPartnerRechargeContext();
    inner += `<div class="plan-grid${compactPlans ? ' plan-grid-compact' : ' plan-grid-detailed'}">`;
    parsedPlans.forEach((plan, index) => { inner += rechargePlanTileHtml(plan, { compact: compactPlans, index }); });
    inner += '</div>';
    if (!compactPlans) inner += `<p class="recharge-note">${escapeHtml(pointCostSummaryText())}。生成失败自动返还。</p>`;
  }
  if (contacts.length) {
    inner += '<div class="support-contact-grid">';
    contacts.forEach((contact) => { inner += supportContactCardHtml(contact); });
    inner += '</div>';
    inner += '<div class="recharge-tip">添加客服微信，备注账号，方便快速到账</div>';
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

function showGuideContactDialog() {
  if (isPartnerRechargeContext()) {
    removeContactOverlays();
    return;
  }
  ensureRechargeStyles();
  removeContactOverlays();
  const contacts = supportContactsForDisplay();
  const overlay = document.createElement('div');
  overlay.className = 'recharge-overlay';
  overlay.id = 'guideContactOverlay';
  let inner = '<div class="recharge-card">';
  inner += '<button type="button" class="recharge-close" aria-label="关闭">×</button>';
  inner += '<h3>领取操作指南资料</h3>';
  inner += '<p class="recharge-sub">添加客服微信，领取操作指南资料。</p>';
  if (contacts.length) {
    inner += '<div class="support-contact-grid">';
    contacts.forEach((contact) => { inner += supportContactCardHtml(contact); });
    inner += '</div>';
    inner += '<div class="recharge-tip">添加客服微信，备注“领取操作指南资料”。</div>';
  } else {
    inner += '<div class="recharge-warn">管理员尚未在 <code>.env</code> 里配置 <code>SUPPORT_WECHAT=你的微信号</code></div>';
  }
  inner += '</div>';
  overlay.innerHTML = inner;
  document.body.appendChild(overlay);
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

async function refreshAccessState() {
  const response = await fetch(apiUrl('/api/access'), { credentials: 'include', cache: 'no-store' });
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
  return data;
}

async function initAccessGate() {
  try {
    await refreshAccessState();
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
    similar_style: '生成同款延伸',
    setup_comparison: '生成布置前后图',
    design_render_scene: '生成实景候选图',
    venue_fusion: '生成空地融合图',
    product_matrix: '生成方案施工矩阵图',
    handdrawn_plan: '生成手绘方案推演图',
    outdoor_handdrawn_plan: '生成户外小清新手绘图',
    detail_grid: '生成九宫格细节图',
    setup_process_grid: '生成搭建视频九宫格',
    photo_area_setup_grid: '生成留影区搭建九宫格',
    partial_wedding_edit: '生成局部改图候选',
    image_enhance: '画质升级到 2K/4K',
    copy_title: '生成提示词',
    motion_video: `一键生成连续转场视频（${motionConfig.pointCost || 200} 灵感值）`,
  }[selectedMode] || '开始生成';
  if (selectedMode === 'image_enhance' && !imageEnhanceAvailable) {
    els.generateBtn.disabled = true;
    els.generateBtn.textContent = '需要配置 Gemini API Key';
    if (els.jobStatusText) els.jobStatusText.textContent = imageEnhanceUnavailableMessage || '画质升级需要配置官方 Gemini API Key';
    els.restartBtn.textContent = isGenerating && activeJobId ? '停止生成' : '重新开始';
    $$('.mode-card').forEach((button) => {
      button.disabled = isGenerating;
    });
    return;
  }
  const idleTextWithCost = selectedMode === 'motion_video'
    ? idleText
    : `${idleText}（${modePointCostText(selectedMode)}）`;
  els.generateBtn.disabled = isGenerating || canResumeActiveJob || !canClick;
  els.generateBtn.textContent = isGenerating
    ? (selectedMode === 'copy_title'
        ? '正在生成提示词...'
        : (selectedMode === 'motion_video'
          ? '视频生成中（等待上游）...'
          : (selectedMode === 'image_enhance' ? '正在高清放大与锐化...' : '正在生成中...')))
    : (canResumeActiveJob
      ? '自动继续中...'
      : idleTextWithCost);
  els.restartBtn.textContent = isGenerating && activeJobId ? '停止生成' : '重新开始';
  $$('.mode-card').forEach((button) => {
    button.disabled = isGenerating;
  });
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

function shareUrlForResourceItem(item = {}) {
  const resourceId = String(item.resourceId || item.resource?.id || item.id || '').trim();
  if (resourceId) {
    const target = new URL(window.location.pathname || '/', window.location.origin);
    const partner = currentPartnerSlug();
    if (partner) target.searchParams.set('partner', partner);
    target.searchParams.set('resource', resourceId);
    target.hash = 'resources';
    return target.href;
  }
  return absoluteAssetUrl(item.url || item.downloadUrl || window.location.href);
}

function ensureQrShareModal() {
  if (qrShareModal) return qrShareModal;
  const overlay = document.createElement('div');
  overlay.className = 'qr-modal-overlay hidden';
  overlay.innerHTML = `
    <div class="qr-modal-card" role="dialog" aria-modal="true" aria-label="资源二维码">
      <div class="qr-modal-head">
        <div class="qr-modal-title">
          <strong>资源二维码</strong>
          <span>发给客户后可直接查看这组婚礼素材</span>
        </div>
        <button type="button" class="qr-modal-close" aria-label="关闭">关闭</button>
      </div>
      <div class="qr-modal-body">
        <div class="qr-modal-code"></div>
        <div class="qr-modal-url"></div>
      </div>
      <div class="qr-modal-footer">
        <span class="upload-editor-status">客户扫码后进入资源库定位到这组素材</span>
        <button type="button" class="qr-modal-copy">复制链接</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  qrShareModal = {
    overlay,
    code: overlay.querySelector('.qr-modal-code'),
    url: overlay.querySelector('.qr-modal-url'),
    copyBtn: overlay.querySelector('.qr-modal-copy'),
    closeBtn: overlay.querySelector('.qr-modal-close'),
    value: '',
  };
  const close = () => {
    qrShareModal.overlay.classList.add('hidden');
    document.body.classList.remove('modal-open');
  };
  qrShareModal.closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  qrShareModal.copyBtn.addEventListener('click', async () => {
    const ok = await copyToClipboard(qrShareModal.value, qrShareModal.copyBtn);
    qrShareModal.copyBtn.textContent = ok ? '已复制' : '已选中链接';
    window.setTimeout(() => { qrShareModal.copyBtn.textContent = '复制链接'; }, 1400);
  });
  return qrShareModal;
}

function openQrShareModal(item = {}) {
  const modal = ensureQrShareModal();
  const url = shareUrlForResourceItem(item);
  modal.value = url;
  modal.url.textContent = url;
  modal.code.innerHTML = '';
  if (typeof window.QRCodeStyling === 'function') {
    const qr = new window.QRCodeStyling({
      width: 220,
      height: 220,
      data: url,
      margin: 8,
      qrOptions: { errorCorrectionLevel: 'M' },
      dotsOptions: { color: '#2b211d', type: 'rounded' },
      cornersSquareOptions: { color: '#7c3f35', type: 'extra-rounded' },
      cornersDotOptions: { color: '#d4b46e', type: 'dot' },
      backgroundOptions: { color: '#ffffff' },
    });
    qr.append(modal.code);
  } else {
    modal.code.textContent = url;
  }
  modal.overlay.classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function createResourceQrButton(item) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tile-share';
  button.textContent = '二维码';
  button.setAttribute('aria-label', `生成${item.label || '这组资源'}的二维码`);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openQrShareModal(item);
  });
  return button;
}

function loadBackgroundRemovalModule() {
  if (!backgroundRemovalModulePromise) {
    backgroundRemovalModulePromise = (async () => {
      let lastError = null;
      for (const moduleUrl of BG_REMOVE_MODULE_URLS) {
        try {
          return await import(moduleUrl);
        } catch (error) {
          lastError = error;
          console.warn('Background removal module load failed:', moduleUrl, error);
        }
      }
      throw new Error('抠图模型加载失败，请稍后重试', { cause: lastError });
    })().catch((error) => {
      backgroundRemovalModulePromise = null;
      throw error;
    });
  }
  return backgroundRemovalModulePromise;
}

function createBackgroundRemovalConfig(publicPath, progress) {
  const config = {
    publicPath,
    model: BG_REMOVE_MODEL,
    output: {
      format: 'image/png',
      quality: 0.92,
    },
  };
  if (typeof progress === 'function') config.progress = progress;
  return config;
}

async function runBackgroundRemoval(removeBackground, sourceBlob, progress) {
  let lastError = null;
  for (const publicPath of [BG_REMOVE_LOCAL_PUBLIC_PATH, BG_REMOVE_REMOTE_PUBLIC_PATH]) {
    try {
      return await removeBackground(sourceBlob, createBackgroundRemovalConfig(publicPath, progress));
    } catch (error) {
      lastError = error;
      console.warn('Background removal run failed:', publicPath, error);
    }
  }
  throw new Error('抠图模型加载失败，请稍后重试', { cause: lastError });
}

async function removeResourceImageBackground(item = {}, button = null) {
  const originalText = button?.textContent || '抠图';
  if (button) {
    button.disabled = true;
    button.textContent = '抠图中';
  }
  try {
    const module = await loadBackgroundRemovalModule();
    const removeBackground = module?.removeBackground || module?.default;
    if (typeof removeBackground !== 'function') {
      throw new Error('抠图模型加载失败，请稍后重试');
    }
    const updateProgress = (stage, loaded, total) => {
      if (!button || !stage?.startsWith('fetch:') || !total) return;
      const percent = Math.max(1, Math.min(99, Math.round((loaded / total) * 100)));
      button.textContent = `加载模型 ${percent}%`;
    };
    const response = await fetch(downloadUrlForAsset(item.downloadUrl || item.url), {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`图片读取失败：HTTP ${response.status}`);
    const sourceBlob = await response.blob();
    const resultBlob = await runBackgroundRemoval(removeBackground, sourceBlob, updateProgress);
    const outputUrl = URL.createObjectURL(resultBlob);
    const filename = fileNameWithExtension(filenameForItem(item, item.assetIndex || 0).replace(/\.[a-z0-9]+$/i, '-cutout'), 'png');
    downloadAsset(outputUrl, filename);
    window.setTimeout(() => URL.revokeObjectURL(outputUrl), 30_000);
    showSaveNotice('抠图已完成，透明 PNG 已下载');
  } catch (error) {
    alert(error.message || '抠图失败，请换一张主体更清晰的图片');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

function createResourceCutoutButton(item) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tile-cutout';
  button.textContent = '抠图';
  button.setAttribute('aria-label', `抠出${item.label || '这张图片'}主体`);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    removeResourceImageBackground(item, button);
  });
  return button;
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
        <button class="motion-modal-submit" type="button">一键生成连续转场视频（120 灵感值）</button>
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
  modal.sourceMeta.textContent = `${motionConfig.durationSeconds || 15} 秒 · 每条 ${motionConfig.pointCost || 200} 灵感值`;
  modal.statusEl.textContent = '';
  modal.submitBtn.disabled = false;
  modal.submitBtn.textContent = `一键生成连续转场视频（${motionConfig.pointCost || 200} 灵感值）`;
  if (VIDEO_GENERATION_DISABLED) {
    modal.statusEl.textContent = VIDEO_UPGRADE_DETAIL;
    modal.submitBtn.disabled = true;
    modal.submitBtn.textContent = VIDEO_UPGRADE_MESSAGE;
  }
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
  if (VIDEO_GENERATION_DISABLED) {
    motionStyleModal.statusEl.textContent = VIDEO_UPGRADE_DETAIL;
    motionStyleModal.submitBtn.disabled = true;
    motionStyleModal.submitBtn.textContent = VIDEO_UPGRADE_MESSAGE;
    return;
  }
  if (accountRequired && !currentUser) {
    motionStyleModal.statusEl.textContent = '请先登录账号后使用视频功能。';
    showAccessGate('请先登录账号后使用视频功能。');
    return;
  }
  if (accountRequired && !canUseMotionFeatures(currentUser)) {
    motionStyleModal.statusEl.textContent = motionAccessMessage();
    showRechargeDialog();
    return;
  }
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
    motionStyleModal.submitBtn.disabled = VIDEO_GENERATION_DISABLED;
    motionStyleModal.submitBtn.textContent = VIDEO_GENERATION_DISABLED
      ? VIDEO_UPGRADE_MESSAGE
      : `一键生成连续转场视频（${motionConfig.pointCost || 200} 灵感值）`;
  }
}

function createResourceCustomButton(item) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tile-motion tile-custom';
  button.dataset.resourceId = item.resourceId || '';
  button.textContent = '定制';
  button.setAttribute('aria-label', `用${item.label || '这张图片'}进入超级定制`);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    loadImageItemIntoSuperMask(item, {
      keepResults: false,
      loadedStatus: '已从资源库载入图片：涂抹要修改的位置后可继续生成',
    });
  });
  return button;
}

async function imageItemToFile(item = {}, fallbackIndex = 0) {
  const filename = filenameForItem(item, fallbackIndex);
  const sourceUrl = item.url || item.downloadUrl;
  if (!sourceUrl) throw new Error('图片地址为空');
  const response = await fetch(downloadUrlForAsset(sourceUrl), {
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  const type = blob.type?.startsWith('image/') ? blob.type : mimeTypeForAsset(filename, 'image');
  return new File([blob], filename, { type, lastModified: Date.now() });
}

async function loadImageItemIntoSuperMask(item = {}, options = {}) {
  if (!hasSuperMaskEditor()) {
    alert('超级定制画布还没有加载完成，请刷新页面后再试');
    return;
  }
  const keepResults = !!options.keepResults;
  const loadedStatus = options.loadedStatus || '图片已载入：涂抹要修改的位置后可继续生成';
  if (window.location.hash !== '#super-custom') window.location.hash = 'super-custom';
  showPage('super-custom');
  setSuperMaskStatus('正在载入图片到超级定制...');
  try {
    const file = await imageItemToFile(item, item.assetIndex || 0);
    await handleSuperMaskFile(file, { keepResults, loadedStatus });
    showSaveNotice('已进入超级定制');
  } catch (error) {
    setSuperMaskStatus(`载入图片失败：${cleanErrorMessage(error.message || '请重新选择图片')}`, 'error');
  }
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

function loadPhotoSwipeModule() {
  if (!photoSwipeModulePromise) {
    photoSwipeModulePromise = import(PHOTOSWIPE_MODULE_URL).catch(() => null);
  }
  return photoSwipeModulePromise;
}

async function openPhotoSwipeGallery(items = [], index = 0) {
  const module = await loadPhotoSwipeModule();
  const PhotoSwipe = module?.default;
  if (typeof PhotoSwipe !== 'function') return false;
  const dataSource = items
    .filter((item) => item?.url)
    .map((item, itemIndex) => {
      const width = Number(item.width || 0);
      const height = Number(item.height || 0);
      return {
        src: absoluteAssetUrl(item.url),
        msrc: item.url,
        width: width > 0 ? width : 1800,
        height: height > 0 ? height : 1200,
        alt: item.label || `婚礼图片 ${itemIndex + 1}`,
      };
    });
  if (!dataSource.length) return false;
  const pswp = new PhotoSwipe({
    dataSource,
    index: Math.max(0, Math.min(index, dataSource.length - 1)),
    bgOpacity: 0.92,
    wheelToZoom: true,
    showHideAnimationType: 'fade',
  });
  pswp.init();
  return true;
}

function wireImagePreview(tile, item, index) {
  tile.classList.add('can-preview');
  tile.tabIndex = 0;
  tile.setAttribute('role', 'button');
  tile.setAttribute('aria-label', `预览${item.label || `生成图 ${index + 1}`}`);
  const openPreview = async () => {
    const opened = await openPhotoSwipeGallery([item], 0);
    if (!opened) openImagePreview(item, index);
  };
  tile.addEventListener('click', openPreview);
  tile.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPreview();
    }
  });
}

function shouldShowOverview(mode) {
  return mode !== 'copy_title'
    && mode !== 'motion_video'
    && mode !== 'design_render_scene'
    && mode !== 'venue_fusion'
    && !isPlanResourceMode(mode)
    && mode !== 'partial_wedding_edit'
    && mode !== 'ps_layer_split'
    && mode !== 'image_enhance';
}

function resultOverviewCopy(mode) {
  const map = {
    copy_title: ['提示词结果', '按指令生成提示词'],
    setup_comparison: ['3:4 对比图', '布置前后对比图'],
    design_render_scene: ['真实现场图', '1 张现场图'],
    venue_fusion: ['融合结果', '空地婚礼融合图'],
    product_matrix: ['施工矩阵', '方案施工整合板'],
    handdrawn_plan: ['手绘方案', '手绘方案推演板'],
    outdoor_handdrawn_plan: ['户外手绘', '户外小清新手绘图'],
    detail_grid: ['九宫格细节', '婚礼九宫格细节图'],
    setup_process_grid: ['搭建过程', '搭建视频九宫格'],
    photo_area_setup_grid: ['留影区搭建', '留影区搭建九宫格'],
    partial_wedding_edit: ['改图候选', '2 张局部改图候选'],
    ps_layer_split: ['PS分层', '多张白底图层素材'],
    image_enhance: ['高清结果', '画质升级版'],
  };
  const [kicker, title] = map[mode] || ['合成预览', '分镜总览 / 爆款首图'];
  return { kicker, title };
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
    els.motionPointHint.textContent = `每条 ${motionConfig.pointCost || 200} 灵感值 · ${motionConfig.durationSeconds || 15} 秒`;
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
  if (mode === 'partial_wedding_edit' && uploadedAspectRatio) return uploadedAspectRatio;
  if (mode === 'image_enhance' && uploadedAspectRatio) return uploadedAspectRatio;
  if (isSetupProcessGridMode(mode)) return '16 / 9';
  if (isPlanResourceMode(mode)) return '3 / 4';
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
    const overview = resultOverviewCopy(selectedMode);
    els.overviewKicker.textContent = overview.kicker;
    els.overviewTitle.textContent = overview.title;
  }
  renderResultSlots([], selectedMode);
  const showOverview = shouldShowOverview(selectedMode);
  setOverviewVisible(showOverview);
  els.collageImg.removeAttribute('src');
  els.collageImg.parentElement.classList.toggle('pending', showOverview);
  els.downloadCollageBtn.removeAttribute('href');
  els.downloadAllBtn.classList.add('hidden');
  const showCopyPanel = selectedMode === 'copy_title';
  if (els.copyPanel) els.copyPanel.classList.toggle('hidden', !showCopyPanel);
  els.copyTitle.textContent = showCopyPanel ? '生成完成后显示提示词' : '';
  els.copyBody.value = '';
  els.copyTags.innerHTML = '';
  if (els.doubaoPromptPanel) els.doubaoPromptPanel.classList.add('hidden');
  if (els.doubaoVideoPrompt) els.doubaoVideoPrompt.value = '';
  if (els.videoWatermarkGuide) els.videoWatermarkGuide.classList.add('hidden');
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

  if (isImageEnhanceMode() && !imageEnhanceAvailable) {
    const message = imageEnhanceUnavailableMessage || '画质升级需要配置官方 Gemini API Key';
    setProgress(0, message);
    appendLog(`[config] ${message}`);
    setGenerating(false);
    return;
  }

  if (!hasRequiredGeneratorInput()) {
    const message = isVenueFusionMode()
      ? '请先上传空地照片和婚礼素材图'
      : (isPartialWeddingEditMode() ? '请先上传婚礼主图并填写局部改图指令' : '请先上传素材');
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
    isVenueFusionMode()
      ? '[queue] 正在上传空地和婚礼素材并创建融合任务'
      : (isPartialWeddingEditMode()
        ? '[queue] 正在上传主图、改图指令和参考图并创建任务'
        : (isImageEnhanceMode()
          ? `[queue] 正在上传低清图片并创建画质升级任务（${selectedImageEnhanceSize}）`
          : '[queue] 正在上传参考图并创建任务')),
  ]);

  const formData = new FormData();
  formData.append('image', uploadedFile, uploadedFile.name || (isVenueFusionMode() ? 'empty-venue.png' : 'wedding-scene.png'));
  if (isVenueFusionMode() && uploadedFusionFile) {
    formData.append('wedding_image', uploadedFusionFile, uploadedFusionFile.name || 'wedding-material.png');
  }
  if (supportsCustomInstruction()) {
    const userInstruction = customInstructionText();
    if (userInstruction) formData.append('user_instruction', userInstruction);
  }
  if (isPartialWeddingEditMode()) {
    formData.append('edit_instruction', partialEditInstructionText());
    uploadedEditReferenceFiles.slice(0, 3).forEach((file, index) => {
      formData.append('edit_references', file, file.name || `edit-reference-${index + 1}.png`);
    });
  }
  if (isSetupProcessGridMode()) {
    const setupBrandName = setupBrandNameText();
    if (setupBrandName) formData.append('setup_brand_name', setupBrandName);
  }
  formData.append('mode', selectedMode);
  if (isImageEnhanceMode()) {
    formData.append('image_enhance_size', selectedImageEnhanceSize);
  }
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
      setProgress(0, `真实图片接口连接失败：${message}`);
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
    product_matrix: ['#17120f', '#f0c2b5', '#d4b46e', '#f8fafc'],
    handdrawn_plan: ['#3b2f24', '#f4d7aa', '#7da46d', '#f8fafc'],
    outdoor_handdrawn_plan: ['#eef4e8', '#f0cf8a', '#7da46d', '#fffdf6'],
    detail_grid: ['#111113', '#d6a56b', '#f0c2b5', '#a7d8ff'],
    setup_process_grid: ['#15110f', '#a78bfa', '#d4b46e', '#f8fafc'],
    photo_area_setup_grid: ['#121417', '#f0c2b5', '#d4b46e', '#b8f3ff'],
    partial_wedding_edit: ['#101513', '#a7f3d0', '#f0c2b5', '#d4b46e'],
  }[mode] || ['#141016', '#f0c2b5', '#d4b46e', '#7dd3fc'];
  const [bg, rose, gold, accent] = palettes;
  const offset = index * 37;
  let width = (mode === 'cinematic_storyboard' || mode === 'setup_comparison' || mode === 'design_render_scene' || isSetupProcessGridMode(mode)) ? 1536 : 1024;
  let height = (mode === 'cinematic_storyboard' || mode === 'setup_comparison' || mode === 'design_render_scene' || isSetupProcessGridMode(mode)) ? 864 : 1024;
  if (isPlanResourceMode(mode)) {
    width = isSetupProcessGridMode(mode) ? 1536 : 1088;
    height = isSetupProcessGridMode(mode) ? 864 : 1440;
  }
  if ((mode === 'similar_style' || mode === 'venue_fusion' || mode === 'partial_wedding_edit') && uploadedAspectRatio) {
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
  if (isSetupProcessGridMode(mode)) {
    const photoArea = isPhotoAreaSetupGridMode(mode);
    const steps = photoArea
      ? ['空区基础', '背景进场', '框架定位', '迎宾牌位', '花艺安装', '道具摆放', '灯光调试', '现场微调', '留影完工']
      : ['空场基础', '框架进场', '背景灯光', '灯光调试', '花艺搭建', '舞台成型', '通道铺设', '现场微调', '完工效果'];
    const cellW = 512;
    const cellH = 288;
    return svgToDataUrl(`
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
              <text x="36" y="41" fill="#17120f" font-size="18" font-weight="900" font-family="Microsoft YaHei, sans-serif">${String(i + 1).padStart(2, '0')} ${step}</text>
            </g>
          `;
        }).join('')}
      </svg>
    `);
  }
  if (isPlanResourceMode(mode)) {
    const planTitle = {
      product_matrix: '方案施工矩阵',
      handdrawn_plan: '手绘方案推演',
      outdoor_handdrawn_plan: '户外手绘提案',
      detail_grid: '九宫格细节图',
      setup_process_grid: '搭建视频九宫格',
    }[mode] || '方案图';
    const planSub = {
      product_matrix: '效果视图 · 物料拆解 · 搭建步骤',
      handdrawn_plan: '手绘效果 · 平面推演 · 材质色卡',
      outdoor_handdrawn_plan: '户外花园 · 小清新 · 手绘方案',
      detail_grid: '全景 · 花艺 · 灯光 · 材质细节',
      setup_process_grid: '空场 · 搭建 · 花艺灯光 · 完工',
    }[mode] || '方案沟通 · 施工交底';
    const labels = {
      product_matrix: ['整体效果', '技术视图', '物料网格', '施工步骤'],
      handdrawn_plan: ['手绘效果', '平面布局', '立面推演', '材质色卡'],
      outdoor_handdrawn_plan: ['花园主景', '户外动线', '花材色卡', '清新细节'],
      detail_grid: ['全景通道', '花艺局部', '灯光道具', '桌椅材质'],
      setup_process_grid: ['空场', '框架', '背景', '花艺', '灯光', '完工'],
    }[mode] || ['整体效果', '技术视图', '物料网格', '施工步骤'];
    return svgToDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1088 1440">
        <defs>
          <linearGradient id="posterBg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#fff8f4"/>
            <stop offset="0.48" stop-color="#f7ede7"/>
            <stop offset="1" stop-color="#efe1d6"/>
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
        <rect x="66" y="70" width="956" height="300" rx="28" fill="#17120f" filter="url(#softShadow)"/>
        <rect x="92" y="96" width="312" height="248" rx="22" fill="url(#photo)" opacity="0.95"/>
        <path d="M154 286C212 180 290 180 350 286" fill="none" stroke="#fff7ed" stroke-width="18" stroke-linecap="round" opacity="0.88"/>
        <circle cx="210" cy="260" r="22" fill="#fff7ed" opacity="0.78"/>
        <circle cx="262" cy="236" r="18" fill="#fff7ed" opacity="0.72"/>
        <circle cx="316" cy="266" r="24" fill="#fff7ed" opacity="0.78"/>
        <text x="456" y="162" fill="#fff7ed" font-size="52" font-weight="800" font-family="Microsoft YaHei, PingFang SC, sans-serif">${planTitle}</text>
        <text x="456" y="222" fill="#f8d8c8" font-size="28" font-weight="700" font-family="Microsoft YaHei, PingFang SC, sans-serif">${planSub}</text>
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
        <rect x="66" y="1158" width="956" height="172" rx="28" fill="#17120f" opacity="0.94" filter="url(#softShadow)"/>
        <text x="112" y="1238" fill="#fff7ed" font-size="32" font-weight="800" font-family="Microsoft YaHei, PingFang SC, sans-serif">适合提案沟通、施工交底和套餐说明</text>
        <rect x="112" y="1278" width="612" height="16" rx="8" fill="#fff7ed" opacity="0.26"/>
      </svg>
    `);
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

  if (mode === 'product_matrix') {
    return {
      title: '婚礼方案这样拆，客户更容易看懂',
      body: `把一场婚礼案例拆成施工矩阵后，客户能同时看到整体效果、技术视图、核心物料和搭建步骤。效果图负责第一眼，平面/立面和轴测图负责讲清楚结构，物料网格和清单负责把执行边界说具体。\n\n这种图很适合放在产品矩阵页、提案沟通和施工交底里。它不是单纯做一张好看的海报，而是把方案从“氛围好看”变成“能落地、能报价、能沟通”的交付物。`,
      tags: config.tags,
    };
  }

  if (mode === 'handdrawn_plan') {
    return {
      title: '前期提案用手绘方案会更有设计感',
      body: `手绘方案推演图适合放在方案前期：先用主效果图建立氛围，再用平面、立面、材质色卡和细节草图把设计逻辑说清楚。\n\n它不像最终施工图那么硬，也不是单纯发一张效果图，而是把“为什么这么设计”讲给客户看。客户能更快理解空间动线、主视觉、花艺比例和材质方向。`,
      tags: config.tags,
    };
  }

  if (mode === 'outdoor_handdrawn_plan') {
    return {
      title: '户外婚礼用手绘图会更有清新感',
      body: `户外小清新手绘图更适合草坪、花园、庭院和露台婚礼提案：先用手绘主视觉讲清楚自然氛围，再把花材色卡、通道动线、座椅区和材质细节放在同一张方案板里。\n\n这种图不会显得太硬，客户能更快理解“户外现场落地后是什么气质”，也方便策划、花艺和搭建团队提前统一方向。`,
      tags: config.tags,
    };
  }

  if (mode === 'detail_grid') {
    return {
      title: '一场婚礼的细节可以这样拆成九宫格',
      body: `九宫格细节图适合做同一舞台的案例展示：全景负责第一眼，通道、花艺、灯光、材质和舞台局部负责把氛围讲完整。\n\n客户看大景会被吸引，看同一舞台的细节才会判断这套方案是不是够精致。把一个舞台拆成九个可看的局部，也更适合后续发图文内容。`,
      tags: config.tags,
    };
  }

  if (mode === 'partial_wedding_edit') {
    return {
      title: '婚礼现场按需求微调后更好沟通✨',
      body: `在原现场基础上做局部调整，最适合用来和客户确认方向：场地结构、镜头角度和空间关系先保留，再看花艺、色系、布幔或灯光细节要怎么改。\n\n这种候选图不用从零想象方案，客户能直接对着原图判断“哪里要保留、哪里要升级”，沟通会更快也更具体。`,
      tags: config.tags,
    };
  }

  if (mode === 'setup_process_grid') {
    return {
      title: '婚礼搭建过程也能做成九宫格',
      body: `上传一张完工婚礼图，就能把这场布置反推成搭建视频九宫格：空场、框架、花艺、灯光、现场调整和最终完工都放在同一张图里。\n\n这种图很适合做案例展示和客户沟通，不只是看最终效果，也能让客户看到团队从进场到落地的执行过程。`,
      tags: config.tags,
    };
  }

  if (mode === 'photo_area_setup_grid') {
    return {
      title: '婚礼留影区搭建过程也能讲清楚',
      body: `上传一张留影区完工图，就能反推出从空白区域、背景板定位、迎宾牌摆放、花艺安装到最终完工的 3×3 搭建过程图。\n\n这种图很适合展示迎宾区和留影区的落地细节，让客户不只看到成品，也能看见团队把一个小空间一步步搭完整的执行力。`,
      tags: config.tags,
    };
  }

  if (mode === 'copy_title') {
    return {
      title: '提示词已生成',
      body: `以这张婚礼现场图为视觉参考，生成真实婚礼影像提示词。保持原图场地结构、主色调、花艺位置、灯光方向、舞台背景和通道纵深不变，描述清楚空间层次、材质质感、光影氛围和镜头/画面重点；不要新增人物、文字、logo、水印或画面里没有的装饰。`,
      tags: [],
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
  const selectLogMap = {
    setup_comparison: '[compose] 拼接 3:4 布置前后对比图',
    design_render_scene: '[select] 保留 1 张真实现场图',
    venue_fusion: '[select] 保留 1 张空地融合效果图',
    product_matrix: '[select] 保留 1 张方案施工矩阵图',
    handdrawn_plan: '[select] 保留 1 张手绘方案推演图',
    outdoor_handdrawn_plan: '[select] 保留 1 张户外小清新手绘图',
    detail_grid: '[select] 保留 1 张九宫格细节图',
    setup_process_grid: '[select] 保留 1 张搭建视频九宫格',
    photo_area_setup_grid: '[select] 保留 1 张留影区搭建九宫格',
    partial_wedding_edit: '[select] 保留 2 张局部改图候选',
    image_enhance: '[select] 保留 1 张高清优化图',
  };
  const generateLog = selectedMode === 'cinematic_storyboard'
    ? '[generate] 生成 6 个电影感分镜镜头'
    : selectedMode === 'copy_title'
      ? '[copy] 根据婚礼照片生成提示词'
      : selectedMode === 'setup_comparison'
        ? '[generate] 生成 1 张婚礼布置后效果图'
      : selectedMode === 'design_render_scene'
        ? '[generate] 生成 1 张真实现场图'
      : selectedMode === 'venue_fusion'
        ? '[generate] 融合空地和婚礼素材'
      : selectedMode === 'product_matrix'
        ? '[generate] 生成方案施工矩阵图'
      : selectedMode === 'handdrawn_plan'
        ? '[generate] 生成手绘方案推演图'
      : selectedMode === 'outdoor_handdrawn_plan'
        ? '[generate] 生成户外小清新手绘图'
      : selectedMode === 'detail_grid'
        ? '[generate] 生成九宫格细节图'
      : selectedMode === 'setup_process_grid'
        ? '[generate] 生成搭建视频九宫格'
      : selectedMode === 'photo_area_setup_grid'
        ? '[generate] 生成留影区搭建九宫格'
      : selectedMode === 'partial_wedding_edit'
        ? '[generate] 按指令生成 2 张局部改图候选'
      : selectedMode === 'image_enhance'
        ? '[enhance] 本地增强图片清晰度'
        : '[generate] 生成 1 张同款延伸参考图';
  const stages = selectedMode === 'copy_title'
    ? [
      [30, '[analyze] 提取场地结构、色系和花艺风格'],
      [72, generateLog],
      [100, '[done] 提示词已就绪'],
    ]
    : [
      [28, '[analyze] 提取场地结构、色系和花艺风格'],
      [50, generateLog],
      [82, selectLogMap[selectedMode] || '[compose] 统一比例、裁切和视觉节奏'],
      [100, '[done] 图片结果已就绪'],
    ];

  for (const [progress, log] of stages) {
    if (runId !== localRunId) return;
    await new Promise((resolve) => window.setTimeout(resolve, 520));
    appendLog(log);
    setProgress(progress, progress === 100 ? (selectedMode === 'copy_title' ? '提示词已生成' : '图片已生成') : '演示生成中');
  }

  const total = imageCountForMode(selectedMode);
  const labelMap = {
    cinematic_storyboard: ['建立场大远景', '主视觉中景', '花艺特写', '灯光空间细节', '通道低机位', '道具前景虚化'],
    setup_comparison: ['布置后效果图'],
    design_render_scene: ['真实现场图'],
    venue_fusion: ['空地融合婚礼效果图'],
    product_matrix: ['方案施工矩阵图'],
    handdrawn_plan: ['手绘方案推演图'],
    outdoor_handdrawn_plan: ['户外小清新手绘图'],
    detail_grid: ['九宫格细节图'],
    setup_process_grid: ['搭建视频九宫格'],
    photo_area_setup_grid: ['留影区搭建九宫格'],
    partial_wedding_edit: ['局部改图候选 1', '局部改图候选 2'],
    image_enhance: ['画质升级版'],
  };
  const images = Array.from({ length: total }, (_, index) => {
    const url = mockTileSvg(index, selectedMode);
    const [ratioW, ratioH] = aspectRatioForItem(null, selectedMode).split('/').map((part) => Number(part.trim()));
    return {
      label: (labelMap[selectedMode] || ['同款延伸'])[index],
      url,
      width: ratioW || undefined,
      height: ratioH || undefined,
    };
  });
  const collageUrl = selectedMode === 'copy_title' || selectedMode === 'similar_style' || selectedMode === 'design_render_scene' || selectedMode === 'venue_fusion' || isPlanResourceMode(selectedMode) || selectedMode === 'partial_wedding_edit' || selectedMode === 'image_enhance' ? '' : await buildClientCollage(images);
  renderResult({
    mode: selectedMode,
    images,
    items: images,
    collageUrl,
    copy: selectedMode === 'copy_title' ? createCopy(selectedMode) : null,
    mock: true,
  });
  setGenerating(false);
}

function renderResult(result) {
  lastRenderedResult = result || null;
  if (lastRenderedResult && activeJobId && !lastRenderedResult.jobId) {
    lastRenderedResult.jobId = activeJobId;
  }
  const mode = result.mode || selectedMode;
  els.resultPanel.dataset.mode = mode;
  if (els.overviewKicker && els.overviewTitle) {
    const overview = resultOverviewCopy(mode);
    els.overviewKicker.textContent = overview.kicker;
    els.overviewTitle.textContent = overview.title;
  }
  els.resultGrid.innerHTML = '';
  const resultImages = Array.isArray(result.images) ? result.images : [];
  if (mode === 'image_enhance' && uploadedDataUrl && resultImages[0]?.url) {
    const compareTile = document.createElement('div');
    compareTile.className = 'result-tile ready image-enhance-compare';
    if (uploadedAspectRatio) compareTile.style.aspectRatio = uploadedAspectRatio;
    compareTile.innerHTML = `
      <figure>
        <img src="${escapeHtml(uploadedDataUrl)}" alt="优化前原图" />
        <figcaption>优化前</figcaption>
      </figure>
      <figure>
        <img src="${escapeHtml(resultImages[0].url)}" alt="优化后婚礼图片" />
        <figcaption>优化后</figcaption>
      </figure>
    `;
    els.resultGrid.appendChild(compareTile);
  }
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

  const showCopyPanel = mode === 'copy_title';
  const showDoubaoPromptPanel = isSetupProcessGridMode(mode) || mode === 'cinematic_storyboard';
  if (els.copyPanel) els.copyPanel.classList.toggle('hidden', !showCopyPanel);
  if (els.doubaoPromptPanel) els.doubaoPromptPanel.classList.toggle('hidden', !showDoubaoPromptPanel);
  const storyboardDoubaoPrompt = mode === 'cinematic_storyboard'
    ? (result.doubaoVideoPrompt || result.resource?.doubaoVideoPrompt || '')
    : '';
  const storyboardHasPrompt = !!String(storyboardDoubaoPrompt || '').trim();
  if (els.doubaoPromptTitle) {
    const hasStoryboardPrompt = !!(result.doubaoVideoPrompt || result.resource?.doubaoVideoPrompt);
    els.doubaoPromptTitle.textContent = mode === 'cinematic_storyboard'
      ? (hasStoryboardPrompt ? '复制专属豆包视频提示词' : '专属视频提示词未生成')
      : (isPhotoAreaSetupGridMode(mode) ? '复制后配合九宫格图生成留影区搭建视频' : '复制后配合九宫格图生成搭建视频');
  }
  if (els.doubaoVideoPrompt) {
    const prompt = mode === 'cinematic_storyboard'
      ? storyboardDoubaoPrompt
      : doubaoSetupVideoPromptForMode(mode);
    els.doubaoVideoPrompt.value = showDoubaoPromptPanel
      ? prompt
      : '';
    els.doubaoVideoPrompt.placeholder = mode === 'cinematic_storyboard'
      ? '专属豆包视频提示词没有生成成功，请重新生成电影分镜图或检查提示词模型配置。'
      : '';
  }
  if (els.copyDoubaoPromptBtn) {
    const hasPrompt = !!els.doubaoVideoPrompt?.value?.trim();
    els.copyDoubaoPromptBtn.disabled = showDoubaoPromptPanel && mode === 'cinematic_storyboard' && !hasPrompt;
    els.copyDoubaoPromptBtn.textContent = mode === 'cinematic_storyboard' && !hasPrompt
      ? '暂无专属提示词'
      : '复制豆包提示词';
  }
  syncDoubaoPromptRetryButton({ mode, showDoubaoPromptPanel, hasStoryboardPrompt: storyboardHasPrompt, result });
  if (els.videoWatermarkGuide) els.videoWatermarkGuide.classList.toggle('hidden', !showDoubaoPromptPanel);
  const copy = showCopyPanel ? (result.copy || createCopy(mode)) : null;
  els.copyTitle.textContent = copy?.title || '';
  els.copyBody.value = copy ? formatCopyBody(copy) : '';
  els.copyTags.innerHTML = '';
  (copy?.tags || []).forEach((tag) => {
    const span = document.createElement('span');
    span.className = 'rounded-full bg-white/[0.06] border border-white/[0.08] px-2.5 py-1';
    span.textContent = tag;
    els.copyTags.appendChild(span);
  });

  els.resultPanel.classList.remove('hidden');
  if (result.mock) {
    setDemoBanner(true, result.provider === 'mock' ? '后端运行在演示模式（未配置图片 API Key）' : '使用了客户端本地演示流程');
  } else {
    setDemoBanner(false);
  }
  setProgress(100, result.mock ? '演示图片已生成（占位图，非真实生成）' : '图片已生成');
  if ((result.mode || selectedMode) === 'copy_title') setProgress(100, '提示词已生成');
  if ((result.mode || selectedMode) === 'design_render_scene') setProgress(100, '实景图已生成');
  if ((result.mode || selectedMode) === 'venue_fusion') setProgress(100, '空地婚礼融合图已生成');
  if ((result.mode || selectedMode) === 'product_matrix') setProgress(100, '方案施工矩阵图已生成');
  if ((result.mode || selectedMode) === 'handdrawn_plan') setProgress(100, '手绘方案推演图已生成');
  if ((result.mode || selectedMode) === 'outdoor_handdrawn_plan') setProgress(100, '户外小清新手绘图已生成');
  if ((result.mode || selectedMode) === 'detail_grid') setProgress(100, '九宫格细节图已生成');
  if ((result.mode || selectedMode) === 'setup_process_grid') setProgress(100, '搭建视频九宫格已生成');
  if ((result.mode || selectedMode) === 'photo_area_setup_grid') setProgress(100, '留影区搭建九宫格已生成');
  if ((result.mode || selectedMode) === 'partial_wedding_edit') setProgress(100, '局部改图候选已生成');
  if ((result.mode || selectedMode) === 'image_enhance') setProgress(100, '高清优化图已生成');
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
    window.setTimeout(() => { els.copyTextBtn.textContent = '复制提示词'; }, 1400);
    return;
  }
  els.copyTextBtn.textContent = '已选中提示词';
  window.setTimeout(() => { els.copyTextBtn.textContent = '复制提示词'; }, 1400);
}

async function copyDoubaoVideoPrompt() {
  const prompt = (els.doubaoVideoPrompt?.value || '').trim();
  if (!prompt) {
    if (els.copyDoubaoPromptBtn) {
      els.copyDoubaoPromptBtn.textContent = '暂无专属提示词';
      window.setTimeout(() => { els.copyDoubaoPromptBtn.textContent = '暂无专属提示词'; }, 1400);
    }
    return;
  }
  if (await copyToClipboard(prompt, els.doubaoVideoPrompt)) {
    els.copyDoubaoPromptBtn.textContent = '已复制';
    window.setTimeout(() => { els.copyDoubaoPromptBtn.textContent = '复制豆包提示词'; }, 1400);
    return;
  }
  els.copyDoubaoPromptBtn.textContent = '已选中提示词';
  window.setTimeout(() => { els.copyDoubaoPromptBtn.textContent = '复制豆包提示词'; }, 1400);
}

function doubaoPromptJobId(result = lastRenderedResult) {
  return String(result?.jobId || result?.resource?.jobId || activeJobId || '').trim();
}

function syncDoubaoPromptRetryButton({ mode = selectedMode, showDoubaoPromptPanel = false, hasStoryboardPrompt = false, result = lastRenderedResult } = {}) {
  if (!els.regenerateDoubaoPromptBtn) return;
  const canRetry = showDoubaoPromptPanel
    && mode === 'cinematic_storyboard'
    && !hasStoryboardPrompt
    && !!doubaoPromptJobId(result);
  els.regenerateDoubaoPromptBtn.classList.toggle('hidden', !canRetry);
  els.regenerateDoubaoPromptBtn.disabled = !canRetry || regeneratingDoubaoPrompt;
  els.regenerateDoubaoPromptBtn.textContent = regeneratingDoubaoPrompt ? '正在重新生成...' : '重新生成提示词';
}

function applyRegeneratedDoubaoPrompt(prompt, resource = null) {
  const text = String(prompt || '').trim();
  if (!text) return false;
  if (lastRenderedResult) {
    lastRenderedResult.doubaoVideoPrompt = text;
    lastRenderedResult.jobId = lastRenderedResult.jobId || resource?.jobId || lastRenderedResult.resource?.jobId || activeJobId || '';
    if (resource) {
      lastRenderedResult.resource = {
        ...(lastRenderedResult.resource || {}),
        ...resource,
        doubaoVideoPrompt: text,
      };
    } else if (lastRenderedResult.resource) {
      lastRenderedResult.resource.doubaoVideoPrompt = text;
    }
  }
  if (els.doubaoVideoPrompt) els.doubaoVideoPrompt.value = text;
  if (els.doubaoPromptTitle) els.doubaoPromptTitle.textContent = '复制专属豆包视频提示词';
  if (els.copyDoubaoPromptBtn) {
    els.copyDoubaoPromptBtn.disabled = false;
    els.copyDoubaoPromptBtn.textContent = '复制豆包提示词';
  }
  if (els.regenerateDoubaoPromptBtn) {
    els.regenerateDoubaoPromptBtn.classList.add('hidden');
    els.regenerateDoubaoPromptBtn.disabled = false;
    els.regenerateDoubaoPromptBtn.textContent = '重新生成提示词';
  }
  return true;
}

async function regenerateDoubaoVideoPrompt() {
  if (regeneratingDoubaoPrompt) return;
  const jobId = doubaoPromptJobId();
  if (!jobId) {
    appendLog('没有找到这次分镜任务，无法重新生成提示词');
    return;
  }
  if (accountRequired && !currentUser) {
    showAccessGate('请先登录账号后使用视频提示词功能。');
    return;
  }
  if (accountRequired && !canUseMotionFeatures(currentUser)) {
    appendLog(motionAccessMessage());
    showRechargeDialog();
    return;
  }

  regeneratingDoubaoPrompt = true;
  syncDoubaoPromptRetryButton({
    mode: 'cinematic_storyboard',
    showDoubaoPromptPanel: true,
    hasStoryboardPrompt: !!String(els.doubaoVideoPrompt?.value || '').trim(),
  });
  setProgress(98, '正在根据 6 张分镜图重新生成专属提示词');
  appendLog('正在重新生成专属提示词');

  try {
    const response = await fetch(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/doubao-video-prompt`), {
      method: 'POST',
      cache: 'no-store',
    });
    const data = await response.json().catch(() => ({}));
    if (data.user) {
      currentUser = data.user;
      updateAccountUI();
    }
    if (!response.ok) {
      if (response.status === 401) {
        accessGranted = false;
        currentUser = null;
        updateAccountUI();
        showAccessGate(data.error || '请先登录账号');
      }
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    const prompt = data.doubaoVideoPrompt || data.result?.doubaoVideoPrompt || data.resource?.doubaoVideoPrompt || '';
    if (!applyRegeneratedDoubaoPrompt(prompt, data.resource || null)) {
      throw new Error('专属提示词仍未生成');
    }
    setProgress(100, '专属提示词已生成');
    appendLog('专属提示词已重新生成');
    loadResources();
  } catch (error) {
    const message = cleanErrorMessage(error.message || '专属提示词生成失败');
    setProgress(100, '专属提示词生成失败，可再次重试');
    appendLog(`专属提示词生成失败：${message}`);
  } finally {
    regeneratingDoubaoPrompt = false;
    const hasPrompt = !!String(els.doubaoVideoPrompt?.value || '').trim();
    syncDoubaoPromptRetryButton({
      mode: 'cinematic_storyboard',
      showDoubaoPromptPanel: !els.doubaoPromptPanel?.classList.contains('hidden'),
      hasStoryboardPrompt: hasPrompt,
    });
  }
}

function copyPageSetProgress(percent = 0, text = '') {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  if (els.copyProgressBar) els.copyProgressBar.style.width = `${value}%`;
  if (els.copyOverallProgress) els.copyOverallProgress.textContent = `${Math.round(value)}%`;
  if (text && els.copyJobStatusText) els.copyJobStatusText.textContent = text;
}

function copyPageRenderLogs(logs = []) {
  if (!els.copyLogStream) return;
  const safeLogs = logs
    .map((line) => publicGenerationLog(line))
    .filter(Boolean)
    .slice(-8)
    .map((line) => `<div>${escapeHtml(line)}</div>`)
    .join('');
  els.copyLogStream.innerHTML = safeLogs;
}

function copyPageAppendLog(line) {
  if (!els.copyLogStream || !line) return;
  const current = Array.from(els.copyLogStream.querySelectorAll('div')).map((item) => item.textContent);
  copyPageRenderLogs([...current, line]);
}

function copyPageSetGenerating(isGenerating) {
  copyGenerationInProgress = isGenerating;
  if (els.copyGenerateBtn) {
    els.copyGenerateBtn.disabled = isGenerating || !copyUploadedFile;
    els.copyGenerateBtn.textContent = isGenerating
      ? '正在生成提示词...'
      : `生成提示词（${modePointCostText('copy_title')}）`;
  }
  if (els.copyRestartBtn) {
    els.copyRestartBtn.disabled = false;
    els.copyRestartBtn.textContent = isGenerating && copyActiveJobId ? '停止生成' : '重新开始';
  }
  if (els.copySampleDemoBtn) els.copySampleDemoBtn.disabled = isGenerating;
  if (els.replaceCopyImageBtn) els.replaceCopyImageBtn.disabled = isGenerating;
}

function copyPageShowInput(file, dataUrl) {
  window.clearTimeout(copyPollTimer);
  copyActiveJobId = null;
  copyUploadedFile = file;
  copyUploadedDataUrl = dataUrl;
  if (els.copyInputPreview) els.copyInputPreview.src = dataUrl;
  els.copyUploadZone?.classList.add('hidden');
  els.copyInputPreviewWrap?.classList.remove('hidden');
  els.copyResultPanel?.classList.add('hidden');
  copyPageSetProgress(12, `图片已就绪 · 消耗 ${modePointCostText('copy_title')}`);
  copyPageRenderLogs(['[upload] 婚礼图片已载入，等待生成提示词']);
  copyPageSetGenerating(false);
}

async function handleCopyFile(file) {
  try {
    const prepared = await prepareImageUpload(file, { allowCrop: true });
    if (!prepared) return;
    copyPageShowInput(prepared.file, prepared.dataUrl);
  } catch (error) {
    copyPageSetProgress(0, cleanErrorMessage(error.message || '图片读取失败'));
    copyPageAppendLog(`[error] ${error.message || '图片读取失败'}`);
  }
}

async function useCopySampleDemo() {
  const dataUrl = getSampleInputImage();
  const file = await dataUrlToFile(dataUrl, 'sample-copy-wedding-scene.png');
  copyPageShowInput(file, dataUrl);
}

function copyPageReset() {
  copyLocalRunId += 1;
  window.clearTimeout(copyPollTimer);
  copyUploadedFile = null;
  copyUploadedDataUrl = null;
  copyActiveJobId = null;
  if (els.copyFileInput) els.copyFileInput.value = '';
  if (els.copyInstructionInput) els.copyInstructionInput.value = '';
  if (els.copyInputPreview) els.copyInputPreview.removeAttribute('src');
  els.copyUploadZone?.classList.remove('hidden');
  els.copyInputPreviewWrap?.classList.add('hidden');
  els.copyResultPanel?.classList.add('hidden');
  if (els.copyPageTitle) els.copyPageTitle.textContent = '';
  if (els.copyPageBody) els.copyPageBody.value = '';
  if (els.copyPageTags) els.copyPageTags.innerHTML = '';
  copyPageRenderLogs([]);
  copyPageSetProgress(0, '等待上传图片');
  copyPageSetGenerating(false);
}

function renderCopyPageResult(copy = createCopy('copy_title')) {
  const resultCopy = copy || createCopy('copy_title');
  if (els.copyPageTitle) els.copyPageTitle.textContent = resultCopy.title || '提示词已生成';
  if (els.copyPageBody) els.copyPageBody.value = formatCopyBody(resultCopy);
  if (els.copyPageTags) {
    els.copyPageTags.innerHTML = '';
    (resultCopy.tags || []).forEach((tag) => {
      const span = document.createElement('span');
      span.className = 'rounded-full bg-white/[0.06] border border-white/[0.08] px-2.5 py-1';
      span.textContent = tag;
      els.copyPageTags.appendChild(span);
    });
  }
  els.copyResultPanel?.classList.remove('hidden');
  copyPageSetProgress(100, '提示词已生成');
  copyPageAppendLog('[done] 提示词已就绪');
  loadResources();
  els.copyResultPanel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function runCopyClientMock(runId) {
  copyPageSetGenerating(true);
  const stages = [
    [30, '[analyze] 提取场地结构、色系、花艺和灯光关系'],
    [72, '[copy] 根据婚礼图片生成提示词'],
    [100, '[done] 提示词已就绪'],
  ];
  for (const [progress, log] of stages) {
    if (runId !== copyLocalRunId) return;
    await new Promise((resolve) => window.setTimeout(resolve, 520));
    copyPageAppendLog(log);
    copyPageSetProgress(progress, progress === 100 ? '提示词已生成' : '演示生成中');
  }
  if (runId !== copyLocalRunId) return;
  copyActiveJobId = null;
  renderCopyPageResult(createCopy('copy_title'));
  copyPageSetGenerating(false);
}

async function startCopyGeneration() {
  if (!accessGranted) {
    showAccessGate('请先输入公测访问码');
    return;
  }
  if (!copyUploadedFile) {
    copyPageSetProgress(0, '请先上传婚礼图片');
    copyPageAppendLog('[input] 请先上传婚礼图片');
    return;
  }
  const requiredPoints = Math.max(1, pointCostForMode('copy_title'));
  if (accountRequired && (!currentUser || Number(currentUser.points || 0) < requiredPoints)) {
    copyPageSetProgress(0, '灵感值不足，请先充值');
    showAuthNotice();
    return;
  }

  copyLocalRunId += 1;
  const runId = copyLocalRunId;
  copyActiveJobId = null;
  window.clearTimeout(copyPollTimer);
  copyPageSetGenerating(true);
  copyPageSetProgress(18, '正在创建提示词任务');
  copyPageRenderLogs([
    '[mode] 看图生成提示词',
    '[queue] 正在上传婚礼图片并创建提示词任务',
  ]);

  const formData = new FormData();
  formData.append('image', copyUploadedFile, copyUploadedFile.name || 'wedding-copy-source.png');
  formData.append('mode', 'copy_title');
  const copyInstruction = String(els.copyInstructionInput?.value || '').trim();
  if (copyInstruction) formData.append('user_instruction', copyInstruction);
  if (currentPartnerSlug()) formData.append('partner', currentPartnerSlug());

  try {
    const response = await fetch(apiUrl('/api/jobs'), { method: 'POST', body: formData });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    if (data.user) {
      currentUser = data.user;
      updateAccountUI();
    }
    copyActiveJobId = data.id;
    copyPageSetGenerating(true);
    copyPageAppendLog(`[job] 提示词任务 ${data.id} 已创建`);
    pollCopyJob(data.id);
  } catch (error) {
    await checkApiHealth();
    const message = cleanErrorMessage(error.message);
    if (apiProvider !== 'mock') {
      copyActiveJobId = null;
      copyPageSetGenerating(false);
      copyPageSetProgress(0, `提示词接口连接失败：${message}`);
      copyPageAppendLog(`[error] ${message}`);
      return;
    }
    copyPageAppendLog(`[fallback] 后端暂不可用，切换本地演示流程：${message}`);
    runCopyClientMock(runId);
  }
}

async function pollCopyJob(jobId, retry = 0) {
  try {
    const response = await fetch(apiUrl(`/api/jobs/${jobId}`), { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const job = await response.json();
    if (copyActiveJobId !== jobId) return;
    if (job.user) {
      currentUser = job.user;
      updateAccountUI();
    }
    copyPageRenderLogs(job.logs || []);
    copyPageSetProgress(job.progress || 0, job.stage || '提示词任务进行中');

    if (job.status === 'completed') {
      copyActiveJobId = null;
      copyPageSetGenerating(false);
      renderCopyPageResult(job.result?.copy || createCopy('copy_title'));
      return;
    }

    if (job.status === 'cancelled') {
      copyActiveJobId = null;
      copyPageSetGenerating(false);
      copyPageSetProgress(job.progress || 0, job.stage || '已停止生成');
      copyPageAppendLog('[cancel] 提示词任务已停止');
      return;
    }

    if (job.status === 'failed') {
      const jobError = cleanErrorMessage(job.error || '生成失败');
      copyActiveJobId = null;
      copyPageSetGenerating(false);
      copyPageSetProgress(job.progress || 0, `提示词生成失败：${jobError}`);
      copyPageAppendLog(`[error] ${jobError}`);
      return;
    }

    copyPollTimer = window.setTimeout(() => pollCopyJob(jobId, 0), POLL_INTERVAL);
  } catch (error) {
    const message = cleanErrorMessage(error.message);
    if (copyActiveJobId === jobId && isTransientPollingError(message) && retry < MAX_POLL_RECONNECT_ATTEMPTS) {
      copyPageSetGenerating(true);
      copyPageSetProgress(Number.parseInt(els.copyOverallProgress?.textContent, 10) || 0, `提示词状态连接波动，正在重新获取进度（${retry + 1}/${MAX_POLL_RECONNECT_ATTEMPTS}）`);
      if (retry === 0) copyPageAppendLog(`[retry] 进度连接临时中断：${message}，正在重连`);
      copyPollTimer = window.setTimeout(() => pollCopyJob(jobId, retry + 1), 2000);
      return;
    }
    copyActiveJobId = null;
    copyPageSetGenerating(false);
    copyPageSetProgress(Number.parseInt(els.copyOverallProgress?.textContent, 10) || 0, `提示词状态连接中断：${message}`);
    copyPageAppendLog(`[error] ${message}`);
  }
}

async function stopCopyGeneration() {
  if (!copyActiveJobId) {
    copyPageReset();
    return;
  }

  const jobId = copyActiveJobId;
  window.clearTimeout(copyPollTimer);
  copyPageSetProgress(Number.parseInt(els.copyOverallProgress?.textContent, 10) || 0, '正在停止提示词任务');
  copyPageAppendLog('[cancel] 正在停止提示词任务');
  if (els.copyRestartBtn) els.copyRestartBtn.disabled = true;

  try {
    const response = await fetch(apiUrl(`/api/jobs/${jobId}/cancel`), { method: 'POST' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    if (payload.user) {
      currentUser = payload.user;
      updateAccountUI();
    }
    copyPageSetProgress(Number.parseInt(els.copyOverallProgress?.textContent, 10) || 0, payload.stage || '已停止生成');
    copyPageAppendLog('[cancel] 已停止，未继续生成提示词');
  } catch (error) {
    const message = cleanErrorMessage(error.message);
    copyPageSetProgress(Number.parseInt(els.copyOverallProgress?.textContent, 10) || 0, `停止失败：${message}`);
    copyPageAppendLog(`[error] 停止失败：${message}`);
  } finally {
    copyActiveJobId = null;
    copyPageSetGenerating(false);
    if (els.copyRestartBtn) els.copyRestartBtn.disabled = false;
  }
}

function handleCopyRestartClick() {
  if (copyGenerationInProgress || copyActiveJobId) {
    stopCopyGeneration();
    return;
  }
  copyPageReset();
}

async function copyPageText() {
  const tags = Array.from(els.copyPageTags?.children || []).map((el) => el.textContent).join(' ');
  const text = `${els.copyPageTitle?.textContent || ''}\n\n${els.copyPageBody?.value || ''}\n\n${tags}`;
  if (await copyToClipboard(text, els.copyPageBody)) {
    if (els.copyPageCopyBtn) {
      els.copyPageCopyBtn.textContent = '已复制';
      window.setTimeout(() => { els.copyPageCopyBtn.textContent = '复制提示词'; }, 1400);
    }
    return;
  }
  if (els.copyPageCopyBtn) {
    els.copyPageCopyBtn.textContent = '已选中提示词';
    window.setTimeout(() => { els.copyPageCopyBtn.textContent = '复制提示词'; }, 1400);
  }
}

function chatStatus(text = '') {
  if (els.chatStatusText) els.chatStatusText.textContent = text || '等待输入';
}

function chatPointCostValue() {
  return Math.max(1, Number(pointCosts.chat || 1));
}

function updateChatCostText(text = '') {
  if (!els.chatUsageText) return;
  els.chatUsageText.textContent = text || `${chatPointCostValue()} 灵感值 / 次`;
}

function chatImagePointCostValue(hasReferences = false) {
  const mode = hasReferences ? 'free_image_image' : 'free_text_image';
  return Math.max(1, Number(pointCosts.byMode?.[mode] || pointCosts.freeImage || 10));
}

function updateChatImageButtonText(isGenerating = false) {
  if (!els.chatImageBtn) return;
  const hasReferences = !!chatContextReferenceImages(chatReferenceImages).length;
  els.chatImageBtn.textContent = isGenerating
    ? '生成中...'
    : `生成图片（${chatImagePointCostValue(hasReferences)} 灵感值）`;
}

function chatImageSource(image = {}) {
  return image.url || image.dataUrl || '';
}

function chatImageName(image = {}, index = 0) {
  return image.label || image.name || `生成图片 ${index + 1}`;
}

function chatContextReferenceImages(extraImages = []) {
  const refs = [];
  const seen = new Set();
  const pushImage = (image = {}) => {
    const dataUrl = String(image.dataUrl || '').trim();
    if (!dataUrl || seen.has(dataUrl)) return;
    seen.add(dataUrl);
    refs.push({
      id: image.id || `${Date.now()}-${refs.length}`,
      name: image.name || `参考图 ${refs.length + 1}`,
      dataUrl,
    });
  };
  chatMessages.slice(-12).forEach((message) => {
    if (!Array.isArray(message.images)) return;
    message.images.forEach(pushImage);
  });
  extraImages.forEach(pushImage);
  return refs.slice(-CHAT_REFERENCE_LIMIT);
}

function chatImageLooksLikeStoryboardRequest(text = '') {
  return /(故事板|分镜|storyboard|镜头板|脚本图|视频画面|每张图|每张图片|连续画面|四宫格|六宫格|九宫格)/i.test(String(text || ''));
}

function buildChatImageVisualGuard(latest = '', referenceCount = 0) {
  const storyboard = chatImageLooksLikeStoryboardRequest(latest);
  const rules = [
    '硬性视觉规则：最终输出必须是可直接看的婚礼视觉图片，不要生成说明页、表格页、时间轴页、教程页、PPT页或带文字的信息图。',
    '绝对不要把对话里的脚本、字幕、旁白、时间码、镜头说明、中文文案、英文文案、logo、水印、UI、二维码画进图片里。',
    '除非用户明确要求出现讲解员、主持人或模特，否则不要新增站在画面前介绍的真人；如果参考图没有人物，不要凭空加入人物。',
    referenceCount ? '参考图只用于保持婚礼场景、色系、空间、布幔、花艺、灯光和材质，不要复制参考图里的社媒界面、边框、水印或文字。' : '',
  ];
  if (storyboard) {
    rules.push(
      '故事板/分镜请求的处理方式：可以生成一张由 4-6 个真实电影画面组成的干净分镜拼图，但每一格都只能是画面本身。',
      '分镜里不要出现左侧时间栏、表格线、标题栏、字幕栏、说明文字或大块色块；如需分隔画面，只能用很细的留白或自然边界。',
      '所有分镜画面必须保持同一个婚礼场地、同一套绿色森林系布置、同一色调、同一光线方向和一致的镜头质感。',
      '如果画面中确实需要人物，人物的脸、发型、服装、身高比例和气质必须前后一致；如果不是必须，不要新增人物。'
    );
  }
  return rules.filter(Boolean).join('\n');
}

function buildChatImagePrompt(currentInstruction = '', referenceCount = 0) {
  const context = chatMessages
    .filter((message) => !message.error && (message.role === 'user' || message.role === 'assistant') && String(message.content || '').trim())
    .slice(-14)
    .map((message) => `${message.role === 'user' ? '用户' : '助手'}：${String(message.content || '').trim()}`)
    .join('\n')
    .slice(0, 1200);
  const latest = (String(currentInstruction || '').trim() || '请根据当前对话上下文生成一张婚礼视觉图片。').slice(0, 700);
  return [
    '请根据以下对话上下文，生成一张可直接用于婚礼方案沟通的高质量图片。',
    '优先遵循最后一条用户要求；如果上下文里有风格、颜色、场地、花艺、灯光、材质、机位或修改意见，请合并成一个清晰画面。',
    referenceCount ? `同时参考随请求附带的 ${referenceCount} 张参考图，保持其重要视觉锚点、空间关系、材质和风格方向。` : '',
    `本次生成要求：${latest}`,
    '画面要求：真实、完整、商业可用、高级婚礼审美、空间逻辑可信，不要水印、不要界面、不要随机文字、不要乱码。',
    context ? `对话上下文：\n${context}` : '',
    buildChatImageVisualGuard(`${latest}\n${context}`, referenceCount),
  ].filter(Boolean).join('\n').slice(0, 2800);
}

function dataUrlToChatFile(dataUrl = '', name = 'reference.jpg') {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(String(dataUrl || '').trim());
  if (!match) return null;
  const mime = match[1] || 'image/jpeg';
  const binary = atob(match[2].replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const extension = mime.includes('png') ? 'png' : (mime.includes('webp') ? 'webp' : 'jpg');
  const safeName = String(name || `reference.${extension}`).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || `reference.${extension}`;
  return new File([bytes], safeName.includes('.') ? safeName : `${safeName}.${extension}`, { type: mime });
}

function chatLooksLikeImageRequest(text = '', images = []) {
  const clean = String(text || '').trim();
  if (!clean) return false;
  const explicitImageIntent = /(生成|出|做|画|绘制|设计|create|make|draw|generate)/i.test(clean);
  const imageTarget = /(图片|图像|效果图|出图|生图|画图|主图|海报|封面|视觉图|场景图|方案图|image|picture|render)/i.test(clean);
  const directImageRequest = /(出图|生图|画图|生成图片|生成一张|生成.*图|画一张|画.*(图|海报|封面|主图|视觉)|做一张|做.*(图|海报|封面|主图|视觉)|设计一张|设计.*(图|海报|封面|主图|视觉)|create.*image|generate.*image)/i.test(clean);
  const promptOnly = /(提示词|prompt|文案|脚本|分析|评价|建议|怎么|如何|拆解|改写|润色)/i.test(clean)
    && !/(直接|现在|立刻|马上|帮我|给我).{0,10}(生成|出图|生图|画图|做图)/i.test(clean);
  if (promptOnly) return false;
  return directImageRequest || (!!images.length && explicitImageIntent && imageTarget);
}

function fitChatPromptInput() {
  if (!els.chatPromptInput) return;
  els.chatPromptInput.style.height = 'auto';
  els.chatPromptInput.style.height = `${Math.min(240, Math.max(112, els.chatPromptInput.scrollHeight))}px`;
}

function renderChatReferenceImages() {
  if (!els.chatReferenceList) return;
  els.chatReferenceList.innerHTML = chatReferenceImages.map((image) => `
    <div class="chat-reference-thumb" data-chat-reference-id="${escapeHtml(image.id)}">
      <img src="${escapeHtml(image.dataUrl)}" alt="${escapeHtml(image.name || '参考图')}" />
      <button type="button" class="chat-reference-remove" aria-label="移除参考图">×</button>
    </div>
  `).join('');
  if (els.chatReferenceNote) {
    els.chatReferenceNote.textContent = chatReferenceImages.length
      ? `已添加 ${chatReferenceImages.length}/${CHAT_REFERENCE_LIMIT} 张参考图，发送后自动清空。`
      : `可一次上传多张参考图，最多 ${CHAT_REFERENCE_LIMIT} 张。`;
  }
  updateChatImageButtonText(chatSending);
}

async function prepareChatReferenceUpload(file) {
  if (!validateSourceImageFile(file)) return null;
  try {
    let optimizedFile = await compressImageFile(file, {
      allowCrop: false,
      maxWidth: CHAT_REFERENCE_MAX_EDGE,
      maxHeight: CHAT_REFERENCE_MAX_EDGE,
      quality: CHAT_REFERENCE_QUALITY,
      mimeType: 'image/jpeg',
    });
    if (optimizedFile.size > CHAT_REFERENCE_MAX_BYTES || optimizedFile === file) {
      optimizedFile = await compressImageFileWithCanvas(optimizedFile, {
        maxWidth: CHAT_REFERENCE_MAX_EDGE,
        maxHeight: CHAT_REFERENCE_MAX_EDGE,
        quality: CHAT_REFERENCE_QUALITY,
      });
    }
    if (optimizedFile.size > CHAT_REFERENCE_MAX_BYTES) {
      optimizedFile = await compressImageFileWithCanvas(optimizedFile, {
        maxWidth: 760,
        maxHeight: 760,
        quality: 0.62,
      });
    }
    const dataUrl = await readFileAsDataUrl(optimizedFile);
    if (estimateDataUrlBytes(dataUrl) > CHAT_REFERENCE_MAX_BYTES * 1.15) {
      showSaveNotice('这张参考图仍然偏大，请换一张更小的图片');
      return null;
    }
    if (optimizedFile.size < file.size * 0.96) {
      showSaveNotice(`参考图已压缩：${formatFileSize(file.size)} → ${formatFileSize(optimizedFile.size)}`);
    }
    return { file: optimizedFile, dataUrl };
  } catch (error) {
    alert(error.message || '参考图处理失败，请换一张图片重试');
    return null;
  }
}

async function handleChatReferenceFiles(fileList) {
  const slots = Math.max(0, CHAT_REFERENCE_LIMIT - chatReferenceImages.length);
  const files = Array.from(fileList || []).filter(Boolean).slice(0, slots);
  if (!files.length) {
    if (chatReferenceImages.length >= CHAT_REFERENCE_LIMIT) showSaveNotice(`最多上传 ${CHAT_REFERENCE_LIMIT} 张参考图`);
    return;
  }
  chatStatus('正在处理参考图');
  for (const file of files) {
    const prepared = await prepareChatReferenceUpload(file);
    if (!prepared) continue;
    const nextImage = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: prepared.file?.name || file.name || '参考图',
      dataUrl: prepared.dataUrl,
    };
    if (chatReferenceTotalBytes([...chatReferenceImages, nextImage]) > CHAT_REFERENCE_MAX_TOTAL_BYTES) {
      showSaveNotice('参考图总大小偏大，请先删除几张或换更小图片');
      continue;
    }
    chatReferenceImages.push(nextImage);
  }
  if (els.chatReferenceInput) els.chatReferenceInput.value = '';
  renderChatReferenceImages();
  chatStatus(chatReferenceImages.length ? '参考图已添加' : '等待输入');
}

function removeChatReferenceImage(id = '') {
  chatReferenceImages = chatReferenceImages.filter((image) => image.id !== id);
  renderChatReferenceImages();
}

function clearChatReferenceImages() {
  chatReferenceImages = [];
  if (els.chatReferenceInput) els.chatReferenceInput.value = '';
  renderChatReferenceImages();
}

function renderChatMessages() {
  if (!els.chatMessages) return;
  if (!chatMessages.length) {
    els.chatMessages.innerHTML = `
      <div class="chat-empty">
        <div>
          <div class="font-cn font-bold text-lg text-stone-700">AI 对话已就绪</div>
          <div class="text-sm mt-2">输入婚礼方案、脚本、文案或客户问题，回复会保留在当前对话里。</div>
        </div>
      </div>
    `;
    return;
  }
  els.chatMessages.innerHTML = chatMessages.map((message) => {
    const role = message.role === 'user' ? 'user' : 'assistant';
    const roleLabel = role === 'user' ? 'You' : 'AI 助手';
    const errorClass = message.error ? ' error' : '';
    const pendingClass = message.pending ? ' pending' : '';
    const images = Array.isArray(message.images) && message.images.length
      ? `<div class="chat-message-images">${message.images.map((image, index) => {
        const src = chatImageSource(image);
        if (!src) return '';
        const label = chatImageName(image, index);
        const download = image.downloadUrl || image.url || '';
        return `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(label)}" />${download ? `<a href="${escapeHtml(download)}" target="_blank" rel="noreferrer">下载</a>` : ''}</figure>`;
      }).join('')}</div>`
      : '';
    return `
      <div class="chat-message ${role}${errorClass}${pendingClass}">
        <span class="chat-role">${roleLabel}</span>${escapeHtml(message.content || '')}${images}
      </div>
    `;
  }).join('');
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

function chatPayloadMessages() {
  return chatMessages
    .filter((message) => !message.error && (message.role === 'user' || message.role === 'assistant') && String(message.content || '').trim())
    .slice(-20)
    .map((message) => ({
      role: message.role,
      content: String(message.content || '').trim(),
    }));
}

function setChatSending(isSending) {
  chatSending = isSending;
  if (els.chatSendBtn) {
    els.chatSendBtn.disabled = isSending;
    els.chatSendBtn.textContent = isSending ? '回复中' : '发送';
  }
  if (els.chatImageBtn) {
    els.chatImageBtn.disabled = isSending;
    updateChatImageButtonText(isSending);
  }
  if (els.chatPromptInput) els.chatPromptInput.disabled = isSending;
  if (els.chatClearBtn) els.chatClearBtn.disabled = isSending;
  if (els.chatReferenceBtn) els.chatReferenceBtn.disabled = isSending;
  if (els.chatReferenceInput) els.chatReferenceInput.disabled = isSending;
  if (els.chatQuickPrompts) {
    els.chatQuickPrompts.querySelectorAll('button').forEach((button) => {
      button.disabled = isSending;
    });
  }
}

function formatChatUsage(usage = null) {
  const total = Number(usage?.total_tokens || usage?.totalTokens || 0);
  if (total > 0) return `tokens ${total}`;
  const prompt = Number(usage?.prompt_tokens || 0);
  const completion = Number(usage?.completion_tokens || 0);
  if (prompt || completion) return `tokens ${prompt + completion}`;
  return '';
}

async function sendChatMessage() {
  if (!els.chatPromptInput || chatSending) return;
  if (!accessGranted) {
    showAccessGate('请先输入公测访问码');
    return;
  }
  if (accountRequired && !currentUser) {
    showAuthNotice();
    return;
  }

  const content = String(els.chatPromptInput.value || '').replace(/\s+$/g, '');
  const imagesForRequest = chatReferenceImages.map((image) => ({ ...image }));
  if (!content.trim() && !imagesForRequest.length) {
    els.chatPromptInput.focus();
    return;
  }
  if (chatLooksLikeImageRequest(content, imagesForRequest)) {
    await generateChatImage();
    return;
  }

  const requiredPoints = chatPointCostValue();
  if (accountRequired && Number(currentUser?.points || 0) < requiredPoints) {
    chatStatus('灵感值不足，请先充值');
    updateChatCostText(`需要 ${requiredPoints} 灵感值 / 次`);
    showAuthNotice();
    return;
  }

  const messageText = content.trim() || '请根据这些参考图进行分析。';
  chatMessages.push({
    role: 'user',
    content: messageText,
    images: imagesForRequest,
  });
  els.chatPromptInput.value = '';
  clearChatReferenceImages();
  fitChatPromptInput();
  renderChatMessages();
  setChatSending(true);
  chatStatus('AI 正在回复');
  updateChatCostText(`正在消耗 ${requiredPoints} 灵感值`);

  try {
    const payload = {
      system: String(els.chatSystemInput?.value || '').trim(),
      messages: chatPayloadMessages(),
      images: [],
    };
    let requestBody = null;
    let requestHeaders = null;
    if (imagesForRequest.length) {
      const form = new FormData();
      form.append('system', payload.system);
      form.append('messages', JSON.stringify(payload.messages));
      imagesForRequest.forEach((image, index) => {
        const file = dataUrlToChatFile(image.dataUrl, image.name || `reference-${index + 1}.jpg`);
        if (file) form.append('images', file, file.name || `reference-${index + 1}.jpg`);
      });
      requestBody = form;
    } else {
      const jsonBody = JSON.stringify(payload);
      if (jsonBody.length > CHAT_REQUEST_MAX_BODY_CHARS) {
        throw new Error('对话内容过长，请减少历史内容后再试。');
      }
      requestBody = jsonBody;
      requestHeaders = { 'Content-Type': 'application/json' };
    }
    const response = await fetch(apiUrl('/api/chat'), {
      method: 'POST',
      ...(requestHeaders ? { headers: requestHeaders } : {}),
      body: requestBody,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (data.accountRequired) showAuthNotice();
      if (data.user) {
        currentUser = data.user;
        updateAccountUI();
      }
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    if (data.user) {
      currentUser = data.user;
      updateAccountUI();
    }
    const answer = String(data.message || '').trim();
    chatMessages.push({
      role: 'assistant',
      content: answer || '模型没有返回内容，请换一种问法再试。',
      model: data.model || '',
    });
    const chargedPointCost = Number(data.pointCost || requiredPoints || 1);
    const usageText = formatChatUsage(data.usage);
    updateChatCostText(`已消耗 ${chargedPointCost} 灵感值${usageText ? ` · ${usageText}` : ''}`);
    chatStatus('回复完成');
  } catch (error) {
    const message = cleanErrorMessage(error.message || '对话失败');
    chatMessages.push({
      role: 'assistant',
      content: `对话失败：${message}`,
      error: true,
    });
    chatStatus('连接失败');
    updateChatCostText();
  } finally {
    renderChatMessages();
    setChatSending(false);
    els.chatPromptInput?.focus();
  }
}

async function pollChatImageJob(jobId, messageId, pointCost, retry = 0) {
  try {
    const response = await fetch(apiUrl(`/api/jobs/${jobId}`), { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const job = await response.json();
    if (job.user) {
      currentUser = job.user;
      updateAccountUI();
    }
    const target = chatMessages.find((message) => message.id === messageId);
    if (!target) {
      setChatSending(false);
      return;
    }
    const partialImages = Array.isArray(job.partialImages) ? job.partialImages : [];
    if (partialImages.length) {
      target.images = partialImages.map((image, index) => ({
        label: image.label || `生成图片 ${index + 1}`,
        url: image.url,
        downloadUrl: image.downloadUrl || image.url,
      }));
    }

    if (job.status === 'completed') {
      const resultImages = Array.isArray(job.result?.images) && job.result.images.length
        ? job.result.images
        : partialImages;
      target.pending = false;
      target.content = `图片已生成，已消耗 ${pointCost} 灵感值。`;
      target.images = resultImages.map((image, index) => ({
        label: image.label || `生成图片 ${index + 1}`,
        url: image.url,
        downloadUrl: image.downloadUrl || image.url,
      }));
      chatStatus('图片已生成');
      updateChatCostText(`已消耗 ${pointCost} 灵感值`);
      renderChatMessages();
      setChatSending(false);
      return;
    }

    if (job.status === 'failed' || job.status === 'cancelled') {
      target.pending = false;
      target.error = true;
      target.content = `图片生成失败：${cleanErrorMessage(job.error || '请稍后重试')}`;
      chatStatus('图片生成失败');
      updateChatCostText();
      renderChatMessages();
      setChatSending(false);
      return;
    }

    target.content = job.stage || '正在根据对话上下文生成图片...';
    renderChatMessages();
    window.setTimeout(() => pollChatImageJob(jobId, messageId, pointCost, 0), 2500);
  } catch (error) {
    if (retry < 5) {
      window.setTimeout(() => pollChatImageJob(jobId, messageId, pointCost, retry + 1), 1800 + retry * 800);
      return;
    }
    const target = chatMessages.find((message) => message.id === messageId);
    if (target) {
      target.pending = false;
      target.error = true;
      target.content = `图片生成状态读取失败：${cleanErrorMessage(error.message || '网络异常')}`;
      renderChatMessages();
    }
    chatStatus('图片生成失败');
    updateChatCostText();
    setChatSending(false);
  }
}

async function generateChatImage() {
  if (!els.chatPromptInput || chatSending) return;
  if (!accessGranted) {
    showAccessGate('请先输入公测访问码');
    return;
  }
  if (accountRequired && !currentUser) {
    showAuthNotice();
    return;
  }

  const currentInstruction = String(els.chatPromptInput.value || '').replace(/\s+$/g, '');
  const currentImages = chatReferenceImages.map((image) => ({ ...image }));
  if (!currentInstruction.trim() && !currentImages.length && !chatMessages.length) {
    els.chatPromptInput.focus();
    return;
  }

  const previewText = currentInstruction.trim() || '请根据当前对话上下文生成一张图片。';
  chatMessages.push({
    role: 'user',
    content: previewText,
    images: currentImages,
  });
  const references = chatContextReferenceImages(currentImages);
  const hasReferences = references.length > 0;
  const requiredPoints = chatImagePointCostValue(hasReferences);
  if (accountRequired && Number(currentUser?.points || 0) < requiredPoints) {
    chatMessages.push({
      role: 'assistant',
      content: `灵感值不足：生成图片需要 ${requiredPoints} 灵感值，请先充值。`,
      error: true,
    });
    renderChatMessages();
    chatStatus('灵感值不足，请先充值');
    updateChatCostText(`生成图片需要 ${requiredPoints} 灵感值`);
    showAuthNotice();
    return;
  }

  els.chatPromptInput.value = '';
  clearChatReferenceImages();
  fitChatPromptInput();
  const assistantMessageId = `chat-image-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  chatMessages.push({
    id: assistantMessageId,
    role: 'assistant',
    content: '正在根据对话上下文生成图片...',
    pending: true,
  });
  renderChatMessages();
  setChatSending(true);
  chatStatus('正在生成图片');
  updateChatCostText(`生成图片将消耗 ${requiredPoints} 灵感值`);

  try {
    const form = new FormData();
    form.append('mode', hasReferences ? 'free_image_image' : 'free_text_image');
    form.append('prompt', buildChatImagePrompt(currentInstruction, references.length));
    form.append('image_size', '1536x1024');
    form.append('quality', 'high');
    form.append('output_format', 'jpeg');
    form.append('count', '1');
    references.forEach((image, index) => {
      const file = dataUrlToChatFile(image.dataUrl, image.name || `reference-${index + 1}.jpg`);
      if (file) form.append('reference_images', file);
    });
    const response = await fetch(apiUrl('/api/jobs'), {
      method: 'POST',
      body: form,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (data.accountRequired) showAuthNotice();
      if (data.user) {
        currentUser = data.user;
        updateAccountUI();
      }
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    if (data.user) {
      currentUser = data.user;
      updateAccountUI();
    }
    pollChatImageJob(data.id, assistantMessageId, Number(data.pointCost || requiredPoints));
  } catch (error) {
    const target = chatMessages.find((message) => message.id === assistantMessageId);
    if (target) {
      target.pending = false;
      target.error = true;
      target.content = `图片生成失败：${cleanErrorMessage(error.message || '请稍后重试')}`;
    }
    chatStatus('图片生成失败');
    updateChatCostText();
    renderChatMessages();
    setChatSending(false);
  }
}

function clearChatMessages() {
  chatMessages = [];
  updateChatCostText();
  chatStatus('等待输入');
  renderChatMessages();
  els.chatPromptInput?.focus();
}

async function copyLastChatAnswer() {
  const lastAnswer = [...chatMessages].reverse().find((message) => message.role === 'assistant' && !message.error && String(message.content || '').trim());
  if (!lastAnswer) {
    if (els.chatCopyBtn) {
      els.chatCopyBtn.textContent = '暂无回复';
      window.setTimeout(() => { els.chatCopyBtn.textContent = '复制最后回复'; }, 1400);
    }
    return;
  }
  if (await copyToClipboard(lastAnswer.content, els.chatPromptInput)) {
    if (els.chatCopyBtn) {
      els.chatCopyBtn.textContent = '已复制';
      window.setTimeout(() => { els.chatCopyBtn.textContent = '复制最后回复'; }, 1400);
    }
  }
}

function fillChatPrompt(text = '') {
  if (!els.chatPromptInput) return;
  els.chatPromptInput.value = String(text || '').trim();
  fitChatPromptInput();
  els.chatPromptInput.focus();
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

function resourcePromptText(resource = {}) {
  if (String(resource.doubaoVideoPrompt || '').trim()) {
    return String(resource.doubaoVideoPrompt || '').trim();
  }
  if (SETUP_PROCESS_GRID_MODES.has(resource.mode)) return doubaoSetupVideoPromptForMode(resource.mode);
  return '';
}

function resourcePromptAssets(resource) {
  const isStoryboardPrompt = resource.mode === 'cinematic_storyboard';
  const isSetupPrompt = SETUP_PROCESS_GRID_MODES.has(resource.mode);
  const isPhotoAreaSetupPrompt = resource.mode === 'photo_area_setup_grid';
  const text = resourcePromptText(resource);
  if (!text && !isStoryboardPrompt) return [];
  return [{
    kind: 'prompt',
    category: 'prompts',
    resource,
    label: isSetupPrompt ? (isPhotoAreaSetupPrompt ? '豆包留影区搭建视频提示词' : '豆包搭建视频提示词') : '豆包视频提示词',
    text,
    filename: resource.doubaoVideoPromptFilename || (isPhotoAreaSetupPrompt ? 'doubao-photo-area-setup-video-prompt.txt' : (isSetupPrompt ? 'doubao-setup-video-prompt.txt' : 'doubao-video-prompt.txt')),
    url: resource.doubaoVideoPromptUrl || '',
    downloadUrl: resource.doubaoVideoPromptDownloadUrl || resource.doubaoVideoPromptUrl || '',
    canGenerate: isStoryboardPrompt && !!resource.jobId,
  }];
}

function isComparisonResource(resource = {}) {
  if (resource.mode === 'design_render_scene') return false;
  if (resource.mode === 'design_comparison') return false;
  if (resource.mode === 'partial_wedding_edit') return false;
  if (resource.mode === 'ps_layer_split') return false;
  if (isPlanResourceMode(resource.mode)) return false;
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
  if (isPlanResourceMode(resource.mode)) return [];
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

function resourcePlanAssets(resource) {
  if (!isPlanResourceMode(resource.mode)) return [];
  return (resource.images || []).map((item, index) => ({
    ...item,
    kind: 'image',
    category: 'plans',
    resource,
    label: item.label || resource.modeLabel || `方案图 ${index + 1}`,
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

function resourceCopyAssets(resource) {
  if (!resource.copy) return [];
  const isPromptCopy = resource.mode === 'copy_title';
  return [{
    kind: 'copy',
    category: 'copy',
    resource,
    label: resource.copy.title || resource.title || (isPromptCopy ? '看图生成提示词' : '标题文案'),
    text: resourceCopyText(resource),
    copy: resource.copy,
    filename: resource.copyFilename || (isPromptCopy ? 'prompt.txt' : 'copywriting.txt'),
    isPromptCopy,
  }];
}

function resourceAssets(resource, category = currentResourceCategory) {
  const images = resourceImageAssets(resource);
  const plans = resourcePlanAssets(resource);
  const copy = resourceCopyAssets(resource);
  const prompts = resourcePromptAssets(resource);
  const videos = resourceVideoAssets(resource);
  const comparisons = resourceComparisonAssets(resource);
  if (category === 'images') return images;
  if (category === 'plans') return plans;
  if (category === 'copy') return copy;
  if (category === 'prompts') return prompts;
  if (category === 'videos') return videos;
  if (category === 'comparisons') return comparisons;
  return [...images, ...plans, ...copy, ...prompts, ...videos, ...comparisons];
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

function downloadTextAsset(text, filename = 'prompt.txt') {
  const blob = new Blob([`${String(text || '').trim()}\n`], { type: 'text/plain;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  try {
    downloadAsset(objectUrl, filename);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
  }
}

function mergeResourceUpdate(resourceId, updatedResource = {}) {
  if (!resourceId || !updatedResource) return;
  lastResources = lastResources.map((resource) => (
    resource.id === resourceId
      ? { ...resource, ...updatedResource }
      : resource
  ));
}

async function regenerateResourceDoubaoPrompt(item = {}, button = null) {
  const resource = item.resource || {};
  const resourceId = item.resourceId || resource.id || '';
  const jobId = String(resource.jobId || item.jobId || '').trim();
  if (!jobId) {
    alert('这组资源缺少任务信息，暂时不能重新生成提示词。');
    return;
  }
  if (accountRequired && !currentUser) {
    showAccessGate('请先登录账号后使用视频提示词功能。');
    return;
  }
  if (accountRequired && !canUseMotionFeatures(currentUser)) {
    alert(motionAccessMessage());
    showRechargeDialog();
    return;
  }
  const originalText = button?.textContent || '生成提示词';
  if (button) {
    button.disabled = true;
    button.textContent = '生成中';
  }
  try {
    const response = await fetch(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/doubao-video-prompt`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partner: currentPartnerSlug() }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    const prompt = String(data.doubaoVideoPrompt || data.result?.doubaoVideoPrompt || data.resource?.doubaoVideoPrompt || '').trim();
    if (!prompt) throw new Error('提示词为空，请稍后再试');
    const updatedResource = {
      ...(data.resource || {}),
      id: resourceId || data.resource?.id || resource.id,
      doubaoVideoPrompt: prompt,
    };
    if (resourceId) mergeResourceUpdate(resourceId, updatedResource);
    showSaveNotice('提示词已生成');
    renderResources(lastResources);
  } catch (error) {
    alert(`提示词生成失败：${error.message || error}`);
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
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
  if (item.category === 'comparisons' || item.category === 'plans') {
    tile.style.aspectRatio = '3 / 4';
    tile.classList.add(item.category === 'plans' ? 'plan-thumb' : 'comparison-thumb');
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
    if (item.kind === 'copy') {
      card.classList.add('copy-asset-card');
      const copyCard = document.createElement('div');
      copyCard.className = 'resource-copy-card';
      const isPromptCopy = item.isPromptCopy || item.resourceMode === 'copy_title';
      const title = item.copy?.title || item.label || (isPromptCopy ? '看图生成提示词' : '标题文案');
      const body = formatCopyBody(item.copy || {});
      const tags = Array.isArray(item.copy?.tags) ? item.copy.tags : [];
      copyCard.innerHTML = `
        <div class="resource-copy-head">
          <span>${escapeHtml(isPromptCopy ? '提示词' : (item.resourceModeLabel || '标题文案'))}</span>
          <small>${escapeHtml(formatResourceDate(item.resourceCreatedAt))}</small>
        </div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(body).replace(/\n/g, '<br>')}</p>
        <div class="resource-copy-tags">${tags.map((tag) => `<em>${escapeHtml(tag)}</em>`).join('')}</div>
      `;
      const actions = document.createElement('div');
      actions.className = 'resource-copy-actions';
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn-primary';
      copyBtn.textContent = isPromptCopy ? '复制提示词' : '复制文案';
      copyBtn.addEventListener('click', async () => {
        const ok = await copyToClipboard(item.text || resourceCopyText(item.resource), copyBtn);
        copyBtn.textContent = ok ? '已复制' : (isPromptCopy ? '已选中提示词' : '已选中文案');
        window.setTimeout(() => { copyBtn.textContent = isPromptCopy ? '复制提示词' : '复制文案'; }, 1400);
      });
      actions.append(copyBtn, createResourceQrButton(item), createResourceDeleteButton(item));
      copyCard.append(actions);
      card.append(copyCard);
      els.resourcesGrid.appendChild(card);
      return;
    }
    if (item.kind === 'prompt') {
      card.classList.add('copy-asset-card', 'prompt-asset-card');
      const promptCard = document.createElement('div');
      promptCard.className = 'resource-copy-card resource-prompt-card';
      const title = item.label || '豆包视频提示词';
      const promptText = String(item.text || '').trim();
      const previewText = promptText || '这组电影分镜图的专属提示词尚未生成，可直接在这里补生成。';
      promptCard.innerHTML = `
        <div class="resource-copy-head">
          <span>${escapeHtml(item.resourceModeLabel || '提示词')}</span>
          <small>${escapeHtml(formatResourceDate(item.resourceCreatedAt))}</small>
        </div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(previewText).replace(/\n/g, '<br>')}</p>
      `;
      const actions = document.createElement('div');
      actions.className = 'resource-copy-actions resource-prompt-actions';
      const primaryBtn = document.createElement('button');
      primaryBtn.type = 'button';
      primaryBtn.className = 'btn-primary';
      primaryBtn.textContent = promptText ? '复制提示词' : '生成提示词';
      primaryBtn.disabled = !promptText && !item.canGenerate;
      primaryBtn.addEventListener('click', async () => {
        if (!promptText && item.canGenerate) {
          await regenerateResourceDoubaoPrompt(item, primaryBtn);
          return;
        }
        const ok = await copyToClipboard(promptText, primaryBtn);
        primaryBtn.textContent = ok ? '已复制' : '已选中提示词';
        window.setTimeout(() => { primaryBtn.textContent = '复制提示词'; }, 1400);
      });
      actions.append(primaryBtn);
      if (promptText) {
        const downloadBtn = document.createElement('button');
        downloadBtn.type = 'button';
        downloadBtn.className = 'btn-ghost';
        downloadBtn.textContent = '下载文本';
        downloadBtn.addEventListener('click', () => {
          if (item.downloadUrl || item.url) {
            downloadAsset(item.downloadUrl || item.url, item.filename || 'doubao-video-prompt.txt');
          } else {
            downloadTextAsset(promptText, item.filename || 'doubao-video-prompt.txt');
          }
        });
        actions.append(downloadBtn);
      }
      if (promptText && item.canGenerate) {
        const regenerateBtn = document.createElement('button');
        regenerateBtn.type = 'button';
        regenerateBtn.className = 'btn-ghost';
        regenerateBtn.textContent = '重写';
        regenerateBtn.addEventListener('click', () => regenerateResourceDoubaoPrompt(item, regenerateBtn));
        actions.append(regenerateBtn);
      }
      actions.append(createResourceDeleteButton(item));
      promptCard.append(actions);
      card.append(promptCard);
      els.resourcesGrid.appendChild(card);
      return;
    }
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
      ? [media, createResourceDeleteButton(item), createResourceQrButton(item), label]
      : [media, createImageSaveLink(item, start + index), createResourceDeleteButton(item), createResourceCutoutButton(item), createResourceQrButton(item), label];
    // 普通图片进入超级定制；方案图/对比图用于提案和交底，先不进入定制入口。
    if (item.kind === 'image' && item.category === 'images') {
      tileChildren.splice(2, 0, createResourceCustomButton(item));
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

function setExternalImportStatus(message = '', tone = '') {
  if (!els.externalImportStatus) return;
  els.externalImportStatus.textContent = message || '';
  els.externalImportStatus.dataset.tone = tone || '';
}

function applyExternalImportAvailability() {
  if (!EXTERNAL_IMPORT_MAINTENANCE) return;
  setExternalImportStatus(EXTERNAL_IMPORT_MAINTENANCE_MESSAGE, 'error');
  if (els.externalImportBtn) {
    els.externalImportBtn.textContent = '维护中';
    els.externalImportBtn.title = EXTERNAL_IMPORT_MAINTENANCE_MESSAGE;
  }
  if (els.externalImportUrl) {
    els.externalImportUrl.placeholder = EXTERNAL_IMPORT_MAINTENANCE_MESSAGE;
  }
}

function setGeoStatus(target, message = '', tone = '') {
  if (!target) return;
  target.textContent = message || '';
  target.dataset.tone = tone || '';
}

function setGeoButtonBusy(button, busy, busyText, readyText) {
  if (!button) return;
  button.disabled = !!busy;
  button.textContent = busy ? busyText : readyText;
}

function geoListHtml(items = [], empty = '') {
  const list = (Array.isArray(items) ? items : [])
    .map((item) => {
      if (item && typeof item === 'object') {
        const title = item.title || item.question || item.label || item.name || '';
        const detail = item.detail || item.note || item.purpose || item.expectedSignal || item.risk || item.targetQuestion || '';
        return `<li>${title ? `<b>${escapeHtml(title)}</b>` : ''}${detail ? `<p>${escapeHtml(detail)}</p>` : ''}</li>`;
      }
      return `<li>${escapeHtml(item)}</li>`;
    })
    .join('');
  return list || (empty ? `<li>${escapeHtml(empty)}</li>` : '');
}

function geoScoreCardsHtml(cards = []) {
  const safeCards = (Array.isArray(cards) ? cards : []).slice(0, 3);
  if (!safeCards.length) return '';
  return `
    <div class="geo-score-grid">
      ${safeCards.map((card) => {
        const value = Math.max(0, Math.min(100, Number(card?.value ?? card?.score ?? 0) || 0));
        const label = card?.label || card?.name || '评分';
        const note = card?.note || card?.detail || '';
        return `<div class="geo-score-card"><b>${value}</b><span>${escapeHtml(label)}${note ? ` · ${escapeHtml(note)}` : ''}</span></div>`;
      }).join('')}
    </div>
  `;
}

function updateGeoMonitor(items = []) {
  if (!els.geoMonitorBoard) return;
  const safeItems = (Array.isArray(items) ? items : []).filter(Boolean).slice(0, 4);
  const fallback = [
    { label: '商家认证', detail: '等待生成认证清单' },
    { label: '知识库', detail: '等待生成婚礼知识库' },
    { label: '内容增长', detail: '等待生成文章提示词' },
  ];
  const list = safeItems.length ? safeItems : fallback;
  els.geoMonitorBoard.innerHTML = list.map((item) => `
    <div class="geo-monitor-item">
      <b>${escapeHtml(item.label || item.title || '监控项')}</b>
      <span>${escapeHtml(item.detail || item.note || item.status || '')}</span>
    </div>
  `).join('');
}

function geoStatusLabel(status = '', fallback = '') {
  const labels = {
    unsubmitted: '未认证',
    needs_info: '资料待补充',
    pending: '审核中',
    approved: '认证通过',
  };
  return fallback || labels[status] || '未认证';
}

function setGeoWorkspaceLocked(locked) {
  if (els.geoWorkspace) els.geoWorkspace.dataset.locked = locked ? 'true' : 'false';
  if (els.geoWorkspaceLocked) els.geoWorkspaceLocked.dataset.visible = locked ? 'true' : 'false';
  geoCertificationApproved = !locked;
}

function fillGeoCertificationForm(profile = {}) {
  if (!profile || typeof profile !== 'object') return;
  const assignments = [
    [els.geoBrandName, profile.brandName],
    [els.geoLegalName, profile.legalName],
    [els.geoCreditCode, profile.creditCode],
    [els.geoWebsiteUrl, profile.websiteUrl],
    [els.geoCity, profile.city],
    [els.geoContactInfo, profile.contactInfo],
    [els.geoProofText, profile.proofText],
    [els.geoOwnerName, profile.ownerName],
    [els.geoOwnerPhone, profile.ownerPhone],
    [els.geoLicenseUrl, profile.licenseUrl],
    [els.geoServiceArea, profile.serviceArea],
    [els.geoKnowledgeArea, profile.serviceArea],
  ];
  assignments.forEach(([input, value]) => {
    if (input && value && !String(input.value || '').trim()) input.value = value;
  });
}

function renderGeoCertificationState(data = {}) {
  geoCertificationProfile = data.profile || {};
  const status = data.status || 'unsubmitted';
  const label = geoStatusLabel(status, data.statusLabel);
  const approved = status === 'approved' || !!data.approved;
  if (els.geoCertificationState) els.geoCertificationState.dataset.status = status;
  if (els.geoCertificationBadge) els.geoCertificationBadge.textContent = label;
  if (els.geoCertificationNote) els.geoCertificationNote.textContent = data.summary || '请先提交企业/个体工商户认证资料。';
  setGeoWorkspaceLocked(!approved);
  fillGeoCertificationForm(geoCertificationProfile);
  updateGeoMonitor([
    { label: '认证状态', detail: label },
    { label: '知识库', detail: approved ? '已开放' : '认证通过后开放' },
    { label: '内容增长', detail: approved ? '已开放' : '认证通过后开放' },
  ]);
  if (status === 'pending') scheduleGeoCertificationPoll(data);
}

function scheduleGeoCertificationPoll(data = {}) {
  window.clearTimeout(geoCertificationPollTimer);
  const readyAt = Date.parse(data.readyAt || '');
  const delay = Number.isFinite(readyAt)
    ? Math.max(3000, Math.min(15000, readyAt - Date.now() + 1000))
    : 8000;
  geoCertificationPollTimer = window.setTimeout(() => loadGeoCertification(true), delay);
}

async function loadGeoCertification(force = false) {
  if (!accessGranted) return;
  const key = `${currentUser?.id || currentUser?.login || 'public'}:${force ? Date.now() : 'cached'}`;
  if (!force && geoCertificationLoadKey === key) return;
  geoCertificationLoadKey = key;
  try {
    const response = await fetch(apiUrl('/api/geo/certification'), { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) {
        accessGranted = false;
        currentUser = null;
        updateAccountUI();
        showAccessGate(data.error || '请先登录账号后使用 GEO 认证。');
      }
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    renderGeoCertificationState(data);
  } catch (error) {
    if (error.status !== 401 && els.geoCertificationNote) {
      els.geoCertificationNote.textContent = cleanErrorMessage(error.message || '认证状态读取失败');
    }
  }
}

function renderGeoVisibilityResult(data = {}) {
  if (!els.geoVisibilityResult) return;
  const questions = Array.isArray(data.questions) ? data.questions : [];
  const checks = Array.isArray(data.visibilityChecks) ? data.visibilityChecks : (Array.isArray(data.checks) ? data.checks : []);
  const contentPlan = Array.isArray(data.contentPlan) ? data.contentPlan : [];
  const chips = [data.brand, data.websiteHost, data.source === 'api' ? 'AI策略生成' : '本地策略模板'].filter(Boolean);
  els.geoVisibilityResult.innerHTML = `
    ${geoScoreCardsHtml(data.scoreCards)}
    ${chips.length ? `<div class="geo-chip-row">${chips.map((chip) => `<span class="geo-chip">${escapeHtml(chip)}</span>`).join('')}</div>` : ''}
    ${data.summary ? `<div class="geo-result-block"><strong>诊断摘要</strong><p>${escapeHtml(data.summary)}</p></div>` : ''}
    <div class="geo-result-block"><strong>建议测试的问题</strong><ul>${geoListHtml(questions, '暂无问题建议')}</ul></div>
    <div class="geo-result-block"><strong>AI回答检查点</strong><ul>${geoListHtml(checks, '暂无检查点')}</ul></div>
    <div class="geo-result-block"><strong>内容补齐方向</strong><ul>${geoListHtml(contentPlan, '暂无内容建议')}</ul></div>
  `;
  updateGeoMonitor([
    { label: 'AI蒸馏', detail: `${questions.length || 0} 个测试问题已生成` },
    { label: '排名提升', detail: data.summary || '已完成可见度诊断' },
    { label: '内容建设', detail: `${contentPlan.length || 0} 个补齐方向` },
  ]);
}

function renderGeoAuditResult(data = {}) {
  if (!els.geoAuditResult) return;
  const score = Math.max(0, Math.min(100, Number(data.score || 0) || 0));
  const checks = Array.isArray(data.checks) ? data.checks : [];
  const recommendations = Array.isArray(data.recommendations) ? data.recommendations : [];
  els.geoAuditResult.innerHTML = `
    <div class="geo-result-block geo-audit-score">
      <div class="geo-audit-meter" style="--geo-score:${score}"><span>${score}</span></div>
      <div>
        <strong>${escapeHtml(data.host || '官网体检')}</strong>
        <p>${escapeHtml(data.summary || '已完成官网首页 GEO 基础体检。')}</p>
      </div>
    </div>
    <div class="geo-check-list">
      ${checks.map((check) => `
        <div class="geo-check" data-status="${escapeHtml(check?.status || 'warn')}">
          <i></i>
          <div><b>${escapeHtml(check?.label || '检查项')}</b><span>${escapeHtml(check?.detail || '')}</span></div>
        </div>
      `).join('')}
    </div>
    <div class="geo-result-block"><strong>优先优化建议</strong><ul>${geoListHtml(recommendations, '暂无明显问题')}</ul></div>
  `;
  updateGeoMonitor([
    { label: '官网GEO分数', detail: `${score}/100` },
    { label: '数据监控', detail: `${checks.length || 0} 个官网信号已检查` },
    { label: '整改任务', detail: `${recommendations.length || 0} 个优先建议` },
  ]);
}

function renderGeoDistillResult(data = {}) {
  if (!els.geoDistillResult) return;
  const clusters = Array.isArray(data.questionClusters) ? data.questionClusters : [];
  const modelPlan = Array.isArray(data.modelPlan) ? data.modelPlan : [];
  const actionSteps = Array.isArray(data.actionSteps) ? data.actionSteps : [];
  const rankingKeywords = Array.isArray(data.rankingKeywords) ? data.rankingKeywords : [];
  els.geoDistillResult.innerHTML = `
    ${data.summary ? `<div class="geo-result-block"><strong>蒸馏摘要</strong><p>${escapeHtml(data.summary)}</p></div>` : ''}
    <div class="geo-result-split">
      <div class="geo-result-block"><strong>高价值问题池</strong><ul>${geoListHtml(clusters, '暂无问题池')}</ul></div>
      <div class="geo-result-block"><strong>模型优化方向</strong><ul>${geoListHtml(modelPlan, '暂无模型建议')}</ul></div>
    </div>
    <div class="geo-result-block"><strong>排名关键词</strong><div class="geo-chip-row">${rankingKeywords.map((item) => `<span class="geo-chip">${escapeHtml(item)}</span>`).join('') || '<span class="geo-chip">暂无关键词</span>'}</div></div>
    <div class="geo-result-block"><strong>下一步动作</strong><ul>${geoListHtml(actionSteps, '暂无动作建议')}</ul></div>
  `;
  updateGeoMonitor([
    { label: 'AI蒸馏', detail: `${clusters.length || 0} 组问题已生成` },
    { label: '模型覆盖', detail: `${modelPlan.length || 0} 个平台方向` },
    { label: '排名提升', detail: `${rankingKeywords.length || 0} 个关键词可跟踪` },
  ]);
}

function geoPrettyText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value || '');
  }
}

function geoCodeBlockHtml(title, value) {
  const text = geoPrettyText(value).trim();
  if (!text) return '';
  return `<div class="geo-result-block"><strong>${escapeHtml(title)}</strong><pre class="geo-result-code">${escapeHtml(text)}</pre></div>`;
}

function renderGeoVerifyResult(data = {}) {
  if (!els.geoVerifyResult) return;
  const score = Math.max(0, Math.min(100, Number(data.score || 0) || 0));
  const missingItems = Array.isArray(data.missingItems) ? data.missingItems : [];
  const nextSteps = Array.isArray(data.nextSteps) ? data.nextSteps : [];
  const statusLabel = data.statusLabel || data.status || '资料评估';
  els.geoVerifyResult.innerHTML = `
    <div class="geo-result-block geo-audit-score">
      <div class="geo-audit-meter" style="--geo-score:${score}"><span>${score}</span></div>
      <div>
        <strong>${escapeHtml(statusLabel)}</strong>
        <p>${escapeHtml(data.summary || '认证资料已提交。')}</p>
      </div>
    </div>
    ${missingItems.length ? `<div class="geo-result-block"><strong>待补资料</strong><ul>${geoListHtml(missingItems, '资料已较完整')}</ul></div>` : ''}
    <div class="geo-result-block"><strong>审核进度</strong><ul>${geoListHtml(nextSteps, '等待审核结果')}</ul></div>
  `;
}

function renderGeoKnowledgeResult(data = {}) {
  if (!els.geoKnowledgeResult) return;
  const knowledgeCards = Array.isArray(data.knowledgeCards) ? data.knowledgeCards : [];
  const faqItems = Array.isArray(data.faqItems) ? data.faqItems : [];
  const missingFacts = Array.isArray(data.missingFacts) ? data.missingFacts : [];
  els.geoKnowledgeResult.innerHTML = `
    ${data.summary ? `<div class="geo-result-block"><strong>知识库摘要</strong><p>${escapeHtml(data.summary)}</p></div>` : ''}
    <div class="geo-result-split">
      <div class="geo-result-block"><strong>企业知识卡</strong><ul>${geoListHtml(knowledgeCards, '暂无知识卡')}</ul></div>
      <div class="geo-result-block"><strong>婚礼FAQ</strong><ul>${geoListHtml(faqItems, '暂无FAQ')}</ul></div>
    </div>
    <div class="geo-result-block"><strong>待补事实</strong><ul>${geoListHtml(missingFacts, '暂无明显缺口')}</ul></div>
    ${geoCodeBlockHtml('llms.txt 草稿', data.llmsDraft)}
    ${geoCodeBlockHtml('结构化数据草稿', data.schemaDraft)}
  `;
  updateGeoMonitor([
    { label: '知识库', detail: `${knowledgeCards.length || 0} 张知识卡` },
    { label: 'FAQ覆盖', detail: `${faqItems.length || 0} 个新人问题` },
    { label: '引用素材', detail: data.llmsDraft ? '已生成 llms.txt 草稿' : '等待补充官网素材' },
  ]);
}

function renderGeoArticlePromptResult(data = {}) {
  if (!els.geoArticleResult) return;
  const promptTemplates = Array.isArray(data.promptTemplates) ? data.promptTemplates : [];
  const articlePlan = Array.isArray(data.articlePlan) ? data.articlePlan : [];
  const headlineIdeas = Array.isArray(data.headlineIdeas) ? data.headlineIdeas : [];
  const internalLinks = Array.isArray(data.internalLinks) ? data.internalLinks : [];
  els.geoArticleResult.innerHTML = `
    ${data.summary ? `<div class="geo-result-block"><strong>内容策略摘要</strong><p>${escapeHtml(data.summary)}</p></div>` : ''}
    <div class="geo-result-block"><strong>可直接复制的文章提示词</strong><ul>${geoListHtml(promptTemplates, '暂无提示词')}</ul></div>
    <div class="geo-result-split">
      <div class="geo-result-block"><strong>文章选题计划</strong><ul>${geoListHtml(articlePlan, '暂无选题')}</ul></div>
      <div class="geo-result-block"><strong>站内承接页</strong><ul>${geoListHtml(internalLinks, '暂无承接页')}</ul></div>
    </div>
    <div class="geo-result-block"><strong>标题方向</strong><div class="geo-chip-row">${headlineIdeas.map((item) => `<span class="geo-chip">${escapeHtml(item)}</span>`).join('') || '<span class="geo-chip">暂无标题</span>'}</div></div>
  `;
  updateGeoMonitor([
    { label: '内容增长', detail: `${promptTemplates.length || 0} 条提示词` },
    { label: '选题计划', detail: `${articlePlan.length || 0} 篇文章` },
    { label: '站内承接', detail: `${internalLinks.length || 0} 个页面` },
  ]);
}

async function postGeoJson(endpoint, payload) {
  const response = await fetch(apiUrl(endpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      accessGranted = false;
      currentUser = null;
      updateAccountUI();
      showAccessGate(data.error || '请先登录账号后使用 GEO 优化工具。');
    }
    const error = new Error(data.error || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function splitGeoCompetitors(value = '') {
  return String(value || '')
    .split(/[\n,，、；;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function splitGeoKeywords(value = '') {
  return String(value || '')
    .split(/[\n,，、；;|｜]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function buildGeoBusinessPayload() {
  const legalName = String(els.geoLegalName?.value || '').trim();
  const brandName = String(els.geoBrandName?.value || legalName || '').trim();
  const serviceArea = String(els.geoKnowledgeArea?.value || els.geoServiceArea?.value || '').trim();
  return {
    brandName,
    legalName,
    creditCode: String(els.geoCreditCode?.value || '').trim(),
    websiteUrl: String(els.geoWebsiteUrl?.value || '').trim(),
    city: String(els.geoCity?.value || '').trim(),
    contactInfo: String(els.geoContactInfo?.value || '').trim(),
    proofText: String(els.geoProofText?.value || '').trim(),
    ownerName: String(els.geoOwnerName?.value || '').trim(),
    ownerPhone: String(els.geoOwnerPhone?.value || '').trim(),
    licenseUrl: String(els.geoLicenseUrl?.value || '').trim(),
    serviceArea,
  };
}

async function runGeoVerify() {
  if (!els.geoVerifyBtn) return;
  const payload = buildGeoBusinessPayload();
  if (!payload.brandName && !payload.legalName) {
    setGeoStatus(els.geoVerifyStatus, '请先填写品牌名或主体名称。', 'error');
    (els.geoLegalName || els.geoBrandName)?.focus();
    return;
  }
  setGeoButtonBusy(els.geoVerifyBtn, true, '提交中', '提交认证');
  setGeoStatus(els.geoVerifyStatus, '正在提交认证资料...', '');
  if (els.geoVerifyResult) els.geoVerifyResult.innerHTML = '';
  try {
    const data = await postGeoJson('/api/geo/certification', payload);
    renderGeoCertificationState(data);
    renderGeoVerifyResult(data);
    setGeoStatus(els.geoVerifyStatus, data.approved ? '认证已通过。' : (data.status === 'needs_info' ? '资料需补充。' : '已提交，等待审核。'), data.status === 'needs_info' ? 'error' : 'success');
  } catch (error) {
    if (error.status !== 401) {
      setGeoStatus(els.geoVerifyStatus, cleanErrorMessage(error.message || '认证提交失败'), 'error');
    }
  } finally {
    setGeoButtonBusy(els.geoVerifyBtn, false, '提交中', '提交认证');
  }
}

function ensureGeoCertified(statusEl = null) {
  if (geoCertificationApproved) return true;
  const message = '请先提交企业认证，审核通过后再使用该功能。';
  if (statusEl) setGeoStatus(statusEl, message, 'error');
  else if (els.geoCertificationNote) els.geoCertificationNote.textContent = message;
  loadGeoCertification(true);
  return false;
}

async function runGeoKnowledge() {
  if (!els.geoKnowledgeBtn) return;
  if (!ensureGeoCertified(els.geoKnowledgeStatus)) return;
  const payload = {
    ...buildGeoBusinessPayload(),
    serviceTypes: splitGeoKeywords(els.geoWeddingServices?.value || els.geoServiceArea?.value || ''),
    styles: splitGeoKeywords(els.geoWeddingStyles?.value || ''),
    priceRange: String(els.geoPriceRange?.value || '').trim(),
    caseNotes: String(els.geoCaseNotes?.value || '').trim(),
    faqNotes: String(els.geoFaqNotes?.value || '').trim(),
  };
  if (!payload.brandName && !payload.serviceTypes.length && !payload.caseNotes) {
    setGeoStatus(els.geoKnowledgeStatus, '请先填写品牌名、服务类型或案例资料。', 'error');
    (els.geoWeddingServices || els.geoBrandName)?.focus();
    return;
  }
  setGeoButtonBusy(els.geoKnowledgeBtn, true, '生成中', '生成知识库');
  setGeoStatus(els.geoKnowledgeStatus, '正在生成婚礼企业知识库...', '');
  if (els.geoKnowledgeResult) els.geoKnowledgeResult.innerHTML = '';
  try {
    const data = await postGeoJson('/api/geo/knowledge', payload);
    renderGeoKnowledgeResult(data);
    setGeoStatus(els.geoKnowledgeStatus, '知识库已生成。', 'success');
  } catch (error) {
    if (error.status !== 401) {
      setGeoStatus(els.geoKnowledgeStatus, cleanErrorMessage(error.message || '知识库生成失败'), 'error');
    }
  } finally {
    setGeoButtonBusy(els.geoKnowledgeBtn, false, '生成中', '生成知识库');
  }
}

async function runGeoArticlePrompts() {
  if (!els.geoArticleBtn) return;
  if (!ensureGeoCertified(els.geoArticleStatus)) return;
  const payload = {
    ...buildGeoBusinessPayload(),
    topic: String(els.geoArticleTopic?.value || '').trim(),
    audience: String(els.geoArticleAudience?.value || '').trim(),
    keywords: splitGeoKeywords(els.geoArticleKeywords?.value || els.geoDistillKeywords?.value || ''),
    angleNotes: String(els.geoArticleAngle?.value || els.geoCaseNotes?.value || '').trim(),
    serviceTypes: splitGeoKeywords(els.geoWeddingServices?.value || els.geoServiceArea?.value || ''),
  };
  if (!payload.topic && !payload.keywords.length && !payload.serviceTypes.length) {
    setGeoStatus(els.geoArticleStatus, '请先填写文章主题、关键词或服务类型。', 'error');
    (els.geoArticleTopic || els.geoArticleKeywords)?.focus();
    return;
  }
  setGeoButtonBusy(els.geoArticleBtn, true, '生成中', '生成文章提示词');
  setGeoStatus(els.geoArticleStatus, '正在生成婚礼 GEO 文章提示词...', '');
  if (els.geoArticleResult) els.geoArticleResult.innerHTML = '';
  try {
    const data = await postGeoJson('/api/geo/article-prompts', payload);
    renderGeoArticlePromptResult(data);
    setGeoStatus(els.geoArticleStatus, '文章提示词已生成。', 'success');
  } catch (error) {
    if (error.status !== 401) {
      setGeoStatus(els.geoArticleStatus, cleanErrorMessage(error.message || '文章提示词生成失败'), 'error');
    }
  } finally {
    setGeoButtonBusy(els.geoArticleBtn, false, '生成中', '生成文章提示词');
  }
}

async function runGeoVisibility() {
  if (!els.geoVisibilityBtn) return;
  if (!ensureGeoCertified(els.geoVisibilityStatus)) return;
  const brandName = String(els.geoBrandName?.value || '').trim();
  if (!brandName) {
    setGeoStatus(els.geoVisibilityStatus, '请先填写品牌名。', 'error');
    els.geoBrandName?.focus();
    return;
  }
  setGeoButtonBusy(els.geoVisibilityBtn, true, '诊断中', '开始诊断');
  setGeoStatus(els.geoVisibilityStatus, '正在生成 AI 可见度诊断...', '');
  if (els.geoVisibilityResult) els.geoVisibilityResult.innerHTML = '';
  try {
    const data = await postGeoJson('/api/geo/visibility', {
      brandName,
      websiteUrl: String(els.geoWebsiteUrl?.value || '').trim(),
      serviceArea: String(els.geoServiceArea?.value || '').trim(),
      competitors: splitGeoCompetitors(els.geoCompetitors?.value || ''),
    });
    renderGeoVisibilityResult(data);
    setGeoStatus(els.geoVisibilityStatus, '诊断完成。', 'success');
  } catch (error) {
    if (error.status !== 401) {
      setGeoStatus(els.geoVisibilityStatus, cleanErrorMessage(error.message || '诊断失败'), 'error');
    }
  } finally {
    setGeoButtonBusy(els.geoVisibilityBtn, false, '诊断中', '开始诊断');
  }
}

async function runGeoAudit() {
  if (!els.geoAuditBtn) return;
  if (!ensureGeoCertified(els.geoAuditStatus)) return;
  const url = String(els.geoAuditUrl?.value || els.geoWebsiteUrl?.value || '').trim();
  if (!url) {
    setGeoStatus(els.geoAuditStatus, '请先填写官网首页。', 'error');
    els.geoAuditUrl?.focus();
    return;
  }
  setGeoButtonBusy(els.geoAuditBtn, true, '体检中', '开始体检');
  setGeoStatus(els.geoAuditStatus, '正在抓取官网首页...', '');
  if (els.geoAuditResult) els.geoAuditResult.innerHTML = '';
  try {
    const data = await postGeoJson('/api/geo/audit', { url });
    renderGeoAuditResult(data);
    setGeoStatus(els.geoAuditStatus, '体检完成。', 'success');
  } catch (error) {
    if (error.status !== 401) {
      setGeoStatus(els.geoAuditStatus, cleanErrorMessage(error.message || '体检失败'), 'error');
    }
  } finally {
    setGeoButtonBusy(els.geoAuditBtn, false, '体检中', '开始体检');
  }
}

async function runGeoDistill() {
  if (!els.geoDistillBtn) return;
  if (!ensureGeoCertified(els.geoDistillStatus)) return;
  const brandName = String(els.geoBrandName?.value || '').trim();
  const keywords = splitGeoKeywords(els.geoDistillKeywords?.value || els.geoServiceArea?.value || '');
  if (!brandName && !keywords.length) {
    setGeoStatus(els.geoDistillStatus, '请先填写品牌名或核心关键词。', 'error');
    (els.geoDistillKeywords || els.geoBrandName)?.focus();
    return;
  }
  setGeoButtonBusy(els.geoDistillBtn, true, '生成中', '生成问题池');
  setGeoStatus(els.geoDistillStatus, '正在蒸馏 AI 问题池...', '');
  if (els.geoDistillResult) els.geoDistillResult.innerHTML = '';
  try {
    const data = await postGeoJson('/api/geo/distill', {
      brandName,
      websiteUrl: String(els.geoWebsiteUrl?.value || '').trim(),
      serviceArea: String(els.geoServiceArea?.value || '').trim(),
      keywords,
      competitors: splitGeoCompetitors(els.geoCompetitors?.value || ''),
    });
    renderGeoDistillResult(data);
    setGeoStatus(els.geoDistillStatus, '问题池已生成。', 'success');
  } catch (error) {
    if (error.status !== 401) {
      setGeoStatus(els.geoDistillStatus, cleanErrorMessage(error.message || '问题池生成失败'), 'error');
    }
  } finally {
    setGeoButtonBusy(els.geoDistillBtn, false, '生成中', '生成问题池');
  }
}

function externalImportResourceCounts(resources = []) {
  return resources.reduce((counts, resource) => {
    counts.images += Array.isArray(resource.images) ? resource.images.length : 0;
    counts.videos += resource.videoUrl ? 1 : 0;
    return counts;
  }, { images: 0, videos: 0 });
}

function renderExternalImportResults(resources = [], failures = []) {
  if (!els.externalImportResults) return;
  const safeResources = Array.isArray(resources) ? resources.filter(Boolean) : [];
  const safeFailures = Array.isArray(failures) ? failures.filter(Boolean) : [];
  const { images: imageCount, videos: videoCount } = externalImportResourceCounts(safeResources);
  const chips = [];
  if (imageCount) chips.push(`<span>${imageCount} 张图片</span>`);
  if (videoCount) chips.push(`<span>${videoCount} 条视频</span>`);
  if (safeResources.length > 1) chips.push(`<span>${safeResources.length} 个资源包</span>`);
  if (safeFailures.length) chips.push(`<span>${safeFailures.length} 条失败</span>`);
  const title = safeResources.length > 1 || safeFailures.length
    ? `批量导入完成：成功 ${safeResources.length} 个${safeFailures.length ? `，失败 ${safeFailures.length} 条` : ''}`
    : (safeResources[0]?.modeLabel || '素材导入完成');
  const firstFailure = safeFailures[0]?.message
    ? `<span>失败原因：${escapeHtml(safeFailures[0].message)}</span>`
    : '';
  els.externalImportResults.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    ${chips.join('') || '<span>已保存资源</span>'}
    ${firstFailure}
    <a href="#resources" data-page-link="resources">查看下方资源</a>
  `;
}

function renderExternalImportResult(resource = {}) {
  renderExternalImportResults(resource ? [resource] : [], []);
}

function focusExternalImportPanel() {
  if (!els.externalImportPanel) return;
  applyExternalImportAvailability();
  window.setTimeout(() => {
    els.externalImportPanel.scrollIntoView({ block: 'start', behavior: 'smooth' });
    els.externalImportUrl?.focus();
  }, 90);
}

function externalImportUrlValue() {
  return String(els.externalImportUrl?.value || '').trim();
}

function externalImportUrlsFromText(text = '') {
  const matches = String(text || '').match(/https?:\/\/[^\s<>"'，,、]+/gi) || [];
  const seen = new Set();
  return matches
    .map((url) => url.replace(/[)\]}>。！？；;]+$/g, '').trim())
    .filter((url) => {
      if (!url || seen.has(url)) return false;
      seen.add(url);
      return true;
    });
}

function setExternalImportBusy(busy) {
  externalImportInProgress = !!busy;
  if (els.externalImportBtn) {
    els.externalImportBtn.disabled = externalImportInProgress;
    els.externalImportBtn.textContent = externalImportInProgress ? '正在导入' : '导入素材';
  }
  if (els.externalImportUrl) els.externalImportUrl.disabled = externalImportInProgress;
}

async function startExternalImport() {
  if (externalImportInProgress) return;
  if (EXTERNAL_IMPORT_MAINTENANCE) {
    applyExternalImportAvailability();
    return;
  }
  if (accountRequired && (!currentUser || !canUseMotionFeatures(currentUser))) {
    try {
      await refreshAccessState();
    } catch (error) {
      console.warn('[external-import] refresh account state failed', error);
    }
  }
  if (accountRequired && !currentUser) {
    setExternalImportStatus('请先登录账号后再使用去视频水印功能。', 'error');
    showAccessGate('请先登录账号后使用去视频水印功能。');
    return;
  }
  if (accountRequired && !canUseMotionFeatures(currentUser)) {
    setExternalImportStatus(motionAccessMessage(), 'error');
    showRechargeDialog();
    return;
  }
  const importText = externalImportUrlValue();
  const urls = externalImportUrlsFromText(importText);
  if (!urls.length) {
    setExternalImportStatus('请先粘贴豆包对话链接，例如 https://www.doubao.com/thread/...', 'error');
    els.externalImportUrl?.focus();
    return;
  }

  setExternalImportBusy(true);
  setExternalImportStatus(`正在解析 ${urls.length} 条分享链接并保存素材...`, '');

  try {
    const response = await fetch(apiUrl('/api/external/doubao-import'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (data.user) {
        currentUser = data.user;
        updateAccountUI();
      }
      if (data.membershipRequired || data.motionAccessRequired) {
        setExternalImportStatus(data.error || motionAccessMessage(), 'error');
        showRechargeDialog();
        return;
      }
      throw new Error(data.error || '素材导入失败');
    }

    const resources = Array.isArray(data.resources)
      ? data.resources
      : (data.resource ? [data.resource] : []);
    if (!resources.length) throw new Error('没有保存成功的素材');
    const failures = Array.isArray(data.failures) ? data.failures : [];
    renderExternalImportResults(resources, failures);
    setExternalImportStatus(
      failures.length
        ? `已成功导入 ${resources.length} 个资源包，${failures.length} 条链接未成功。`
        : `导入完成，${resources.length} 个资源包已保存到资源库。`,
      failures.length ? 'success' : 'success',
    );
    currentResourceCategory = resources.some((resource) => resource.videoUrl) ? 'videos' : 'images';
    await loadResources();
  } catch (error) {
    setExternalImportStatus(cleanErrorMessage(error.message || '素材导入失败'), 'error');
  } finally {
    setExternalImportBusy(false);
  }
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

function normalizeSuperCustomSourceSamples(samples = []) {
  if (!Array.isArray(samples)) return [];
  return samples
    .map((sample) => (typeof sample === 'string' ? sample : (sample?.id || sample?.label || '')))
    .filter(Boolean);
}

function normalizeSuperCustomOption(option = {}) {
  return {
    ...option,
    meta: option.meta || option.statusLabel || option.assetStatus || '模块库',
    prompt: option.prompt || option.promptFragment || '',
    disabled: !!option.disabled || option.available === false,
    taxonomyTags: Array.isArray(option.taxonomyTags)
      ? option.taxonomyTags
      : (Array.isArray(option.tags) ? option.tags : []),
    sourceSamples: normalizeSuperCustomSourceSamples(option.sourceSamples),
    cleanupTasks: Array.isArray(option.cleanupTasks) ? option.cleanupTasks : [],
    cleanPreviewImage: option.cleanPreviewImage || '',
    displayPreviewImage: option.displayPreviewImage || '',
    displayKind: option.displayKind || '',
    assetSlot: option.assetSlot || '',
    assetKind: option.assetKind || '',
    priority: option.priority || '',
    assetStatus: option.assetStatus || option.cleanupStatus || '',
  };
}

function getSuperCustomSteps() {
  if (!superCustomLibrary?.modules) {
    return SUPER_CUSTOM_STEPS.map((step) => ({
      ...step,
      options: Array.isArray(step.options) ? step.options.filter((option) => !option?.hiddenFromMenu) : step.options,
    }));
  }

  const styleId = superCustomSelections.style || superCustomLibrary.activeStyleId || 'korean_white_green';
  const fallbackStyleStep = SUPER_CUSTOM_STEPS.find((step) => step.key === 'style') || SUPER_CUSTOM_STEPS[0];
  const styleStepConfig = superCustomLibrary.styleStep || fallbackStyleStep;
  const styleOptions = Array.isArray(superCustomLibrary.styles)
    ? superCustomLibrary.styles.map((style) => normalizeSuperCustomOption({
      ...style,
      assetStatus: style.assetStatus || '风格规则',
      cleanupRequired: false,
    }))
    : (fallbackStyleStep?.options || []);

  const libraryStepConfigs = Array.isArray(superCustomLibrary.steps) ? superCustomLibrary.steps : [];
  const fallbackModuleSteps = SUPER_CUSTOM_STEPS.filter((step) => step.key !== 'style');
  const moduleGroups = superCustomLibrary.modules?.[styleId] || {};
  const moduleSteps = (libraryStepConfigs.length ? libraryStepConfigs : fallbackModuleSteps).map((stepConfig) => {
    const fallbackStep = fallbackModuleSteps.find((step) => step.key === stepConfig.key);
    const options = Array.isArray(moduleGroups[stepConfig.key]) && moduleGroups[stepConfig.key].length
      ? moduleGroups[stepConfig.key].filter((option) => !option?.hiddenFromMenu).map(normalizeSuperCustomOption)
      : (fallbackStep?.options || []);
    return {
      ...fallbackStep,
      ...stepConfig,
      options,
    };
  });

  return [
    {
      ...fallbackStyleStep,
      ...styleStepConfig,
      key: 'style',
      options: styleOptions,
    },
    ...moduleSteps,
  ];
}

async function loadSuperCustomLibrary() {
  if (!SUPER_CUSTOM_PUBLIC_ENABLED) return;
  if (!els.superCustomOptionGrid || typeof fetch !== 'function') return;
  try {
    const response = await fetch(SUPER_CUSTOM_LIBRARY_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const library = await response.json();
    if (!library?.styles || !library?.modules) throw new Error('Invalid super custom library');
    superCustomLibrary = library;
    if (!superCustomSelections.style && library.activeStyleId) {
      superCustomSelections.style = library.activeStyleId;
    }
    renderSuperCustomConfigurator();
  } catch (error) {
    console.warn('Super custom library fallback:', error);
  }
}

function superCustomOption(stepKey, optionId) {
  const step = getSuperCustomSteps().find((item) => item.key === stepKey);
  return step?.options.find((option) => option.id === optionId) || null;
}

function superCustomStepAllowsMultiple(step = {}) {
  return step.selectionMode === 'multiple';
}

function superCustomSelectedIds(stepKey) {
  const value = superCustomSelections[stepKey];
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

function superCustomStepHasSelection(step = {}) {
  return superCustomSelectedIds(step.key).length > 0;
}

function serializeSuperCustomModuleOption(step, option) {
  return {
    id: option.id,
    name: option.name,
    moduleLabel: step.label,
    priority: option.priority || '',
    assetStatus: option.assetStatus || '',
    assetKind: option.assetKind || '',
    assetReady: option.assetKind === 'rule' || (option.assetKind === 'clean' && !!option.cleanPreviewImage),
    cleanPreviewImage: option.cleanPreviewImage || '',
    displayPreviewImage: option.displayPreviewImage || '',
    displayKind: option.displayKind || '',
    assetSlot: option.assetSlot || '',
    cleanupRequired: option.cleanupRequired !== false,
    cleanupTasks: option.cleanupTasks || [],
    sourceSamples: option.sourceSamples || [],
    taxonomyTags: superCustomOptionTaxonomyTags(step.key, option),
    componentProfile: option.componentProfile || null,
    fit: option.fit || '',
    composeRole: option.composeRole || '',
    promptFragment: option.prompt,
    negativePrompt: option.negativePrompt || '',
  };
}

function superCustomAllSelected() {
  return getSuperCustomSteps().every((step) => superCustomStepHasSelection(step));
}

function uniqueSuperCustomValues(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function superCustomSelectionPayload() {
  const steps = getSuperCustomSteps();
  const style = superCustomOption('style', superCustomSelections.style);
  const selectedOptions = [];
  const modules = {};

  steps.filter((step) => step.key !== 'style').forEach((step) => {
    const selectedIds = superCustomSelectedIds(step.key);
    const options = selectedIds
      .map((optionId) => superCustomOption(step.key, optionId))
      .filter(Boolean);
    selectedOptions.push(...options);
    modules[step.key] = superCustomStepAllowsMultiple(step)
      ? options.map((option) => serializeSuperCustomModuleOption(step, option))
      : (options[0] ? serializeSuperCustomModuleOption(step, options[0]) : null);
  });

  const promptFragments = uniqueSuperCustomValues([
    style?.prompt,
    ...selectedOptions.map((option) => option.prompt),
  ]);
  const negativePromptFragments = uniqueSuperCustomValues([
    style?.negativePrompt,
    ...selectedOptions.map((option) => option.negativePrompt),
  ]);

  return {
    product: superCustomLibrary?.product || 'hotel_hall_super_custom',
    libraryVersion: superCustomLibrary?.version || 'inline-fallback',
    assetRoot: superCustomLibrary?.assetRoot || '',
    status: superCustomAllSelected() ? 'ready_for_generation' : 'draft',
    venueScope: superCustomLibrary?.venueScope || {
      id: 'hotel_hall',
      name: '酒店厅婚礼',
    },
    style: style ? {
      id: style.id,
      name: style.name,
      assetStatus: style.assetStatus || '风格规则',
      promptFragment: style.prompt,
      negativePrompt: style.negativePrompt || '',
      styleRules: style.styleRules || [],
      sourceSamples: style.sourceSamples || [],
    } : null,
    modules,
    extractionTasks: superCustomLibrary?.extractionTasks || [],
    compositionRules: superCustomLibrary?.compositionRules || [],
    combinedPrompt: promptFragments.join(', '),
    negativePrompt: negativePromptFragments.join(', '),
    cleanupPolicy: superCustomLibrary?.cleanupPolicy || {
      cleanPreviewImageRequired: true,
      removeLogo: true,
      removeWatermark: true,
      hideSourceUrlFromUser: true,
    },
  };
}

function superCustomDisplayKindLabel(displayKind, placement = 'tag') {
  if (displayKind === 'floral-prop' || displayKind === 'floral-border-pair') return '花艺道具';
  if (displayKind === 't-stage-shape') return placement === 'visual' ? 'T台结构' : 'T台造型';
  if (displayKind === 'ceremony-rule') return '仪式规则';
  if (displayKind === 'ceiling-rule') return '吊顶规则';
  if (displayKind === 'lighting-rule') return '光感规则';
  return placement === 'visual' ? '舞台造型' : '造型提炼';
}

function superCustomStepTaxonomyTag(stepKey = '') {
  const labels = {
    style: '婚礼风格',
    mainStage: '主舞台',
    tStage: 'T台通道',
    aisleFlorals: '过道花艺',
    ceremonyArea: '仪式区',
    ceiling: '吊顶',
    lighting: '灯光',
  };
  return labels[stepKey] || '';
}

function superCustomDisplayTaxonomyTag(option = {}) {
  if (option.displayKind === 'stage-shape') return '舞台造型';
  if (option.displayKind === 't-stage-shape') return '通道结构';
  if (option.displayKind === 'floral-prop' || option.displayKind === 'floral-border-pair') return '花艺道具';
  if (option.displayKind === 'ceremony-rule') return '结构规则';
  if (option.displayKind === 'ceiling-rule') return '顶部策略';
  if (option.displayKind === 'lighting-rule') return '光感规则';
  return '';
}

function superCustomOptionTaxonomyTags(stepKey = '', option = {}) {
  const explicitTags = Array.isArray(option.taxonomyTags)
    ? option.taxonomyTags
    : (Array.isArray(option.tags) ? option.tags : []);
  const baseTags = stepKey === 'style'
    ? ['酒店厅婚礼', superCustomStepTaxonomyTag(stepKey)]
    : ['酒店厅婚礼', '韩式白绿', superCustomStepTaxonomyTag(stepKey), superCustomDisplayTaxonomyTag(option)];
  return uniqueSuperCustomValues([...baseTags, ...explicitTags]).slice(0, 5);
}

function renderSuperCustomOptionTags(stepKey = '', option = {}) {
  const tags = superCustomOptionTaxonomyTags(stepKey, option);

  if (!tags.length) return '';
  return `
    <div class="super-option-tags">
      ${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}
    </div>
  `;
}

function renderSuperCustomOptionVisual(option = {}) {
  const previewImage = option.displayPreviewImage || option.cleanPreviewImage || '';
  const hasImage = !!previewImage;
  const state = hasImage
    ? (option.displayPreviewImage ? 'display' : (option.assetKind === 'clean' ? 'clean' : 'placeholder'))
    : (option.assetKind === 'rule' ? 'rule' : 'slot');
  const label = hasImage
    ? (option.displayPreviewImage
      ? superCustomDisplayKindLabel(option.displayKind, 'visual')
      : (option.assetKind === 'clean' ? '真实预览' : '方案预览'))
    : (option.assetKind === 'rule' ? (option.assetStatus || '规则项') : '即将开放');
  return `
    <div class="super-option-visual" data-visual="${escapeHtml(option.visual || 'style-korean')}" data-asset-state="${escapeHtml(state)}" data-display-kind="${escapeHtml(option.displayKind || '')}">
      ${hasImage ? `<img src="${escapeHtml(previewImage)}" alt="${escapeHtml(option.name || '超级定制模块预览')}" loading="lazy" decoding="async">` : ''}
      <span>${escapeHtml(label)}</span>
    </div>
  `;
}

function superCustomPublicAssetLabel(option = {}) {
  if (!option || option.disabled) return option?.disabled ? '后续开放' : '';
  if (option.displayPreviewImage) {
    return superCustomDisplayKindLabel(option.displayKind, 'tag');
  }
  if (option.assetKind === 'rule') return option.assetStatus || '规则项';
  return option.assetKind === 'clean' ? '真实预览' : '方案预览';
}

function superCustomPreviewImageFor(module = null) {
  return module?.displayPreviewImage || module?.cleanPreviewImage || '';
}

function renderSuperCustomCompositionPreview(payload = {}) {
  if (!els.superCustomComposition) return;
  const modules = payload.modules || {};
  const stageImage = superCustomPreviewImageFor(modules.mainStage);
  const aisleImage = superCustomPreviewImageFor(modules.tStage);
  const floralModules = Array.isArray(modules.aisleFlorals)
    ? modules.aisleFlorals.filter(Boolean)
    : (modules.aisleFlorals ? [modules.aisleFlorals] : []);
  const floralImages = floralModules
    .map((module) => ({
      src: superCustomPreviewImageFor(module),
      name: module?.name || '花艺道具',
      displayKind: module?.displayKind || '',
    }))
    .filter((item) => item.src);

  const hasPreview = !!stageImage || !!aisleImage || floralImages.length > 0;
  els.superCustomComposition.classList.toggle('has-module-preview', hasPreview);
  if (!hasPreview) {
    els.superCustomComposition.innerHTML = '<div class="super-composition-empty">选择主舞台、T台和花艺后，这里会组合成预览。</div>';
    return;
  }

  const floralPairLayers = floralImages
    .filter((item) => item.displayKind === 'floral-border-pair')
    .slice(0, 2)
    .map((item, index) => (
      `<div class="super-composition-layer super-composition-floral-pair" style="--floral-index:${index}"><img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.name)}"></div>`
    )).join('');
  const floralLayers = floralImages
    .filter((item) => item.displayKind !== 'floral-border-pair')
    .slice(0, 3)
    .flatMap((item, index) => [
    `<div class="super-composition-layer super-composition-floral super-composition-floral-left" style="--floral-index:${index}"><img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.name)}"></div>`,
    `<div class="super-composition-layer super-composition-floral super-composition-floral-right" style="--floral-index:${index}"><img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.name)}"></div>`,
  ]).join('');

  els.superCustomComposition.innerHTML = `
    ${stageImage ? `<div class="super-composition-layer super-composition-stage"><img src="${escapeHtml(stageImage)}" alt="${escapeHtml(modules.mainStage?.name || '主舞台')}"></div>` : ''}
    ${aisleImage ? `<div class="super-composition-layer super-composition-aisle"><img src="${escapeHtml(aisleImage)}" alt="${escapeHtml(modules.tStage?.name || 'T台')}"></div>` : ''}
    ${floralPairLayers}
    ${floralLayers}
  `;
}

function superCustomStepGuide(stepKey) {
  const guides = {
    style: {
      area: '整场风格',
      change: '统一颜色、明度、花材和整体气质',
      keep: '当前只做酒店厅，不包含草坪、迎宾区和签到区',
      focus: '先定大方向，再进入局部组合',
    },
    mainStage: {
      area: '主舞台',
      change: '决定背景高度、LED屏遮挡、舞台视觉中心',
      keep: '只影响舞台，不改变T台和两侧花艺',
      focus: '看背景板高度、层次和花艺集中位置',
    },
    tStage: {
      area: 'T台 / 通道',
      change: '决定新人入场路径、画面透视和宾客视线',
      keep: '不包含两侧花艺，花艺在下一步单独选',
      focus: '看通道材质、长度和直线感',
    },
    aisleFlorals: {
      area: 'T台两侧花艺',
      change: '只改变通道左右两边的花量、层次和白绿比例',
      keep: '不改主舞台，不生成迎宾区、桌花或手捧花',
      focus: '看花量高低、是否有瓶插、会不会挡视线',
    },
    ceremonyArea: {
      area: '仪式区',
      change: '决定交换誓言的位置和舞台前方关系',
      keep: '第一版不做独立圆形仪式岛',
      focus: '看仪式点是否并入主舞台',
    },
    ceiling: {
      area: '吊顶 / 顶部',
      change: '决定要不要增加顶部纱幔、吊花、水晶等装置',
      keep: '当前样本优先保持酒店原始顶部',
      focus: '看是否需要顶部装饰',
    },
    lighting: {
      area: '灯光氛围',
      change: '统一画面明度、色温和最终质感',
      keep: '韩式白绿第一版不使用强彩色灯光',
      focus: '看明亮柔白还是暗场追光',
    },
  };
  return guides[stepKey] || guides.style;
}

function renderSuperCustomStepGuide(step) {
  if (!els.superCustomStepGuide || !step) return;
  const guide = superCustomStepGuide(step.key);
  els.superCustomStepGuide.innerHTML = `
    <div class="super-step-map" data-step-map="${escapeHtml(step.key)}" aria-hidden="true">
      <span data-zone="stage">主舞台</span>
      <span data-zone="aisle">T台</span>
      <span data-zone="floral-left">花艺</span>
      <span data-zone="floral-right">花艺</span>
      <span data-zone="ceiling">吊顶</span>
    </div>
    <div class="super-step-guide-copy">
      <div class="super-step-guide-kicker">当前选择区域</div>
      <strong class="font-cn">${escapeHtml(guide.area)}</strong>
      <p>${escapeHtml(guide.change)}</p>
      <div>
        <span>${escapeHtml(guide.focus)}</span>
        <span>${escapeHtml(guide.keep)}</span>
      </div>
    </div>
  `;
}

function renderSuperCustomOptionFacts(option = {}) {
  const facts = Array.isArray(option.facts) && option.facts.length
    ? option.facts
    : [option.fit, option.composeRole].filter(Boolean);
  if (!facts.length) return '';
  return `
    <div class="super-option-facts">
      ${facts.slice(0, 3).map((fact) => `<span>${escapeHtml(fact)}</span>`).join('')}
    </div>
  `;
}

function getSuperCustomAssetItems() {
  return getSuperCustomSteps()
    .filter((step) => step.key !== 'style')
    .flatMap((step) => (step.options || []).map((option) => ({
      ...option,
      stepKey: step.key,
      stepLabel: step.label,
    })))
    .sort((a, b) => {
      const priorityRank = { P0: 0, P1: 1, P2: 2 };
      const aRank = priorityRank[a.priority] ?? 9;
      const bRank = priorityRank[b.priority] ?? 9;
      if (aRank !== bRank) return aRank - bRank;
      if (!!a.disabled !== !!b.disabled) return a.disabled ? 1 : -1;
      return `${a.stepLabel}-${a.name}`.localeCompare(`${b.stepLabel}-${b.name}`, 'zh-Hans-CN');
    });
}

function superCustomModuleById(moduleId) {
  return getSuperCustomAssetItems().find((item) => item.id === moduleId) || null;
}

function getSuperCustomSampleTasks() {
  const tasks = Array.isArray(superCustomLibrary?.extractionTasks)
    ? superCustomLibrary.extractionTasks
    : [];
  return tasks.map((task) => ({
    ...task,
    module: superCustomModuleById(task.moduleId),
  }));
}

function getSuperCustomIntakeTasks() {
  const priorityRank = { P0: 0, P1: 1, P2: 2 };
  return getSuperCustomSampleTasks()
    .filter((task) => task.module && !task.module.disabled)
    .sort((a, b) => {
      const aRank = priorityRank[a.priority] ?? 9;
      const bRank = priorityRank[b.priority] ?? 9;
      if (aRank !== bRank) return aRank - bRank;
      return `${a.stepLabel || ''}-${a.module?.name || a.moduleId}`.localeCompare(`${b.stepLabel || ''}-${b.module?.name || b.moduleId}`, 'zh-Hans-CN');
    });
}

function superCustomPromoteCommand(moduleId, module = null) {
  const id = moduleId || 'module_id';
  const forceFlag = module?.assetKind === 'clean' ? ' --force' : '';
  return [
    `npm run super:promote -- --module ${id} --input "C:\\清洗图\\${id}.png"${forceFlag}`,
    'npm run super:validate',
    'npm run build:site',
  ].join('\n');
}

function updateSuperCustomImportHelper() {
  if (!els.superCustomImportTask) return;
  const tasks = getSuperCustomIntakeTasks();
  const task = tasks.find((item) => item.moduleId === els.superCustomImportTask.value) || tasks[0];
  const module = task?.module || null;
  const file = els.superCustomImportFile?.files?.[0] || null;

  if (els.superCustomImportStatus) {
    els.superCustomImportStatus.textContent = task
      ? `${task.priority || 'P1'} · ${task.stepLabel || module?.stepLabel || '模块'} · ${module?.name || task.moduleId}`
      : '等待选择任务';
  }

  if (els.superCustomImportCommand) {
    els.superCustomImportCommand.textContent = superCustomPromoteCommand(task?.moduleId, module);
  }

  if (!els.superCustomImportPreview || !els.superCustomImportFileName) return;
  if (!file) {
    if (superCustomImportPreviewUrl) {
      URL.revokeObjectURL(superCustomImportPreviewUrl);
      superCustomImportPreviewUrl = '';
    }
    els.superCustomImportPreview.hidden = true;
    els.superCustomImportPreview.removeAttribute('src');
    els.superCustomImportFileName.textContent = '未选择图片';
    return;
  }

  if (superCustomImportPreviewUrl) URL.revokeObjectURL(superCustomImportPreviewUrl);
  superCustomImportPreviewUrl = URL.createObjectURL(file);
  els.superCustomImportPreview.src = superCustomImportPreviewUrl;
  els.superCustomImportPreview.hidden = false;
  els.superCustomImportFileName.textContent = file.name;
}

function renderSuperCustomImportHelper() {
  if (!els.superCustomImportPanel || !els.superCustomImportTask) return;
  const tasks = getSuperCustomIntakeTasks();
  if (!tasks.length) {
    els.superCustomImportPanel.hidden = true;
    return;
  }

  els.superCustomImportPanel.hidden = false;
  const previousValue = els.superCustomImportTask.value;
  const selectedTask = tasks.find((task) => task.moduleId === previousValue) || tasks[0];
  els.superCustomImportTask.innerHTML = tasks.map((task) => {
    const module = task.module;
    const state = module?.assetKind === 'clean' ? '已入库' : '待替换';
    const label = `${task.priority || 'P1'} · ${task.stepLabel || module?.stepLabel || '模块'} · ${module?.name || task.moduleId} · ${state}`;
    return `<option value="${escapeHtml(task.moduleId)}">${escapeHtml(label)}</option>`;
  }).join('');
  els.superCustomImportTask.value = selectedTask.moduleId;
  updateSuperCustomImportHelper();
}

function renderSuperCustomSampleBoard() {
  if (!els.superCustomSampleBoard) return;
  const tasks = getSuperCustomSampleTasks();
  const samples = Array.isArray(superCustomLibrary?.sourceSamples) ? superCustomLibrary.sourceSamples : [];
  const sampleMap = new Map(samples.map((sample) => [sample.id, sample]));
  const bySample = tasks.reduce((acc, task) => {
    const list = acc.get(task.sampleId) || [];
    list.push(task);
    acc.set(task.sampleId, list);
    return acc;
  }, new Map());
  const p0Tasks = tasks.filter((task) => task.priority === 'P0');
  const cleanTasks = tasks.filter((task) => task.module?.assetKind === 'clean');

  if (!tasks.length) {
    els.superCustomSampleBoard.innerHTML = '';
    return;
  }

  els.superCustomSampleBoard.innerHTML = `
    <div class="super-samples-head">
      <div>
        <div class="super-assets-kicker">REAL SAMPLE SPLIT</div>
        <h3 class="font-cn font-black">已选案例拆解任务</h3>
        <p>不用重新选案例。先把样本36和样本83拆成 P0 模块，替换掉现在的本地占位图。</p>
      </div>
      <div class="super-assets-stats" aria-label="样本拆解状态">
        <span><b>${samples.length}</b>已选样本</span>
        <span><b>${p0Tasks.length}</b>P0任务</span>
        <span><b>${cleanTasks.length}</b>已清洗</span>
      </div>
    </div>
    <div class="super-samples-grid">
      ${[...bySample.entries()].map(([sampleId, sampleTasks]) => {
        const sample = sampleMap.get(sampleId) || { label: sampleId, title: sampleId };
        return `
          <article class="super-sample-card">
            <div class="super-sample-title">
              <b>${escapeHtml(sample.label || sampleId)}</b>
              <div>
                <strong class="font-cn">${escapeHtml(sample.title || sampleId)}</strong>
                <span>${escapeHtml(sample.note || '已选案例')}</span>
              </div>
            </div>
            <div class="super-sample-tasks">
              ${sampleTasks.map((task) => {
                const module = task.module;
                const state = module?.assetKind === 'clean' ? '已清洗入库' : (module?.assetKind === 'placeholder' ? '待替换真实图' : '待原图');
                const command = superCustomPromoteCommand(task.moduleId, module);
                return `
                  <div class="super-sample-task">
                    <div class="super-sample-task-top">
                      <span>${escapeHtml(task.priority || 'P1')}</span>
                      <span>${escapeHtml(task.stepLabel || module?.stepLabel || '')}</span>
                      <span>${escapeHtml(state)}</span>
                    </div>
                    <strong class="font-cn">${escapeHtml(module?.name || task.moduleId)}</strong>
                    <p>${escapeHtml(task.cropTarget || module?.description || '')}</p>
                    <code>${escapeHtml(command)}</code>
                  </div>
                `;
              }).join('')}
            </div>
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function renderSuperCustomAssetBoard() {
  if (!els.superCustomAssetBoard) return;
  const items = getSuperCustomAssetItems();
  const readyCount = items.filter((item) => item.assetKind === 'clean' && item.cleanPreviewImage).length;
  const placeholderCount = items.filter((item) => item.assetKind === 'placeholder' && item.cleanPreviewImage).length;
  const pendingCount = items.filter((item) => item.assetKind !== 'placeholder' && item.assetKind !== 'clean' && item.cleanupRequired !== false && !item.disabled).length;
  const sampleCount = uniqueSuperCustomValues(items.flatMap((item) => item.sourceSamples || [])).length;

  els.superCustomAssetBoard.innerHTML = `
    <div class="super-assets-head">
      <div>
        <div class="super-assets-kicker">ASSET INTAKE</div>
        <h3 class="font-cn font-black">韩式白绿模块素材入库清单</h3>
        <p>先盯主舞台和两侧花艺，把参考图清洗成 cleanPreviewImage 后再开放给用户选择。</p>
      </div>
      <div class="super-assets-stats" aria-label="素材入库状态">
        <span><b>${readyCount}</b>已入库</span>
        <span><b>${placeholderCount}</b>占位图</span>
        <span><b>${pendingCount}</b>待清洗</span>
        <span><b>${sampleCount}</b>样本源</span>
      </div>
    </div>
    <div class="super-assets-grid">
      ${items.map((item) => {
        const ready = item.assetKind === 'clean' && !!item.cleanPreviewImage;
        const placeholder = item.assetKind === 'placeholder' && !!item.cleanPreviewImage;
        const status = ready ? '已入库' : (placeholder ? '占位图' : (item.disabled ? '后续' : (item.cleanupRequired === false ? '规则项' : '待清洗')));
        const tasks = (item.cleanupTasks || []).slice(0, 3);
        return `
          <article class="super-asset-card${ready ? ' ready' : ''}${placeholder ? ' placeholder' : ''}${item.disabled ? ' disabled' : ''}">
            ${renderSuperCustomOptionVisual(item)}
            <div class="super-asset-body">
              <div class="super-asset-meta">
                <span>${escapeHtml(item.priority || 'P2')}</span>
                <span>${escapeHtml(item.stepLabel || '')}</span>
                <span>${escapeHtml(status)}</span>
              </div>
              <h4 class="font-cn">${escapeHtml(item.name || '')}</h4>
              <p>${escapeHtml(item.fit || item.description || '')}</p>
              <dl>
                <div><dt>资产槽</dt><dd>${escapeHtml(item.assetSlot || '待分配')}</dd></div>
                <div><dt>样本</dt><dd>${escapeHtml((item.sourceSamples || []).join(' / ') || '待采样')}</dd></div>
              </dl>
              ${tasks.length ? `<div class="super-asset-tasks">${tasks.map((task) => `<span>${escapeHtml(task)}</span>`).join('')}</div>` : ''}
            </div>
          </article>
        `;
      }).join('')}
    </div>
  `;
  renderSuperCustomSampleBoard();
  renderSuperCustomImportHelper();
}

function renderSuperCustomConfigurator() {
  if (!SUPER_CUSTOM_PUBLIC_ENABLED) return;
  if (!els.superCustomOptionGrid || !els.superCustomStepTabs) return;
  const steps = getSuperCustomSteps();
  const currentStep = steps[superCustomStepIndex] || steps[0];
  if (!currentStep) return;

  els.superCustomStepTabs.innerHTML = steps.map((step, index) => {
    const isActive = index === superCustomStepIndex;
    const isDone = superCustomStepHasSelection(step) && !isActive;
    return `
      <button type="button" class="super-step-tab${isActive ? ' active' : ''}${isDone ? ' done' : ''}" data-super-step="${escapeHtml(step.key)}">
        <b>${String(index + 1).padStart(2, '0')}</b><span>${escapeHtml(step.label)}</span>
      </button>
    `;
  }).join('');

  if (els.superCustomStepTitle) els.superCustomStepTitle.textContent = currentStep.title;
  if (els.superCustomStepSubtitle) els.superCustomStepSubtitle.textContent = currentStep.subtitle;
  if (els.superCustomProgress) els.superCustomProgress.textContent = `${superCustomStepIndex + 1} / ${steps.length}`;
  renderSuperCustomStepGuide(currentStep);

  els.superCustomOptionGrid.innerHTML = currentStep.options.map((option) => {
    const active = superCustomSelectedIds(currentStep.key).includes(option.id);
    const metaLabel = superCustomPublicAssetLabel(option) || '可选方案';
    const stateLabel = option.disabled ? '未开放' : (superCustomStepAllowsMultiple(currentStep) ? '可多选' : '可选择');
    return `
      <button type="button" class="super-option-card${active ? ' active' : ''}" data-super-option="${escapeHtml(option.id)}" aria-pressed="${active ? 'true' : 'false'}"${option.disabled ? ' disabled' : ''}>
        ${active ? '<span class="super-option-picked">已选择</span>' : ''}
        ${renderSuperCustomOptionVisual(option)}
        <div class="super-option-body">
          <div class="super-option-meta"><span>${escapeHtml(metaLabel)}</span><span>${escapeHtml(stateLabel)}</span></div>
          <strong class="font-cn">${escapeHtml(option.name)}</strong>
          <p>${escapeHtml(option.description || '')}</p>
          ${renderSuperCustomOptionFacts(option)}
          ${renderSuperCustomOptionTags(currentStep.key, option)}
        </div>
      </button>
    `;
  }).join('');

  if (els.superCustomPrevBtn) {
    els.superCustomPrevBtn.disabled = superCustomStepIndex <= 0;
    els.superCustomPrevBtn.classList.toggle('disabled:opacity-40', true);
  }
  if (els.superCustomNextBtn) {
    const selected = superCustomStepHasSelection(currentStep);
    els.superCustomNextBtn.disabled = !selected || superCustomStepIndex >= steps.length - 1;
    els.superCustomNextBtn.textContent = superCustomStepIndex >= steps.length - 1 ? '已到最后一步' : '下一步';
  }
  if (els.superCustomGenerateBtn) {
    els.superCustomGenerateBtn.disabled = !superCustomAllSelected();
    els.superCustomGenerateBtn.textContent = superCustomAllSelected() ? '生成婚礼预览' : '选完后生成预览';
  }

  renderSuperCustomSummary();
  renderSuperCustomAssetBoard();
}

function renderSuperCustomSummary(generated = false) {
  if (!els.superCustomSummary) return;
  const steps = getSuperCustomSteps();
  const payload = superCustomSelectionPayload();
  renderSuperCustomCompositionPreview(payload);
  const rows = steps.map((step) => {
    const options = superCustomSelectedIds(step.key)
      .map((optionId) => superCustomOption(step.key, optionId))
      .filter(Boolean);
    const name = options.length
      ? options.map((option) => option.name).join(' + ')
      : '待选择';
    const publicStatus = options.length
      ? (superCustomStepAllowsMultiple(step) && options.length > 1
        ? `已选${options.length}项`
        : superCustomPublicAssetLabel(options[0]))
      : '';
    return `
      <div class="super-summary-row">
        <b>${escapeHtml(step.label)}</b>
        <span>
          <i>${escapeHtml(name)}</i>
          ${publicStatus ? `<small>${escapeHtml(publicStatus)}</small>` : ''}
        </span>
      </div>
    `;
  }).join('');
  els.superCustomSummary.innerHTML = rows;

  const styleName = payload.style?.name || '酒店厅';
  const stageName = payload.modules.mainStage?.name || '模块化';
  if (els.superCustomPreviewTitle) {
    els.superCustomPreviewTitle.textContent = `${styleName} · ${stageName}`;
  }
  if (els.superCustomStatus) {
    els.superCustomStatus.textContent = generated
      ? '方案组合已生成，可以继续交给团队细化出图。'
      : (superCustomAllSelected() ? '模块已选齐，可以生成方案预览。' : '按步骤选择模块，右侧会实时生成组合方案。');
  }
  if (els.superCustomJson) {
    els.superCustomJson.textContent = JSON.stringify(payload, null, 2);
  }
}

function bindSuperCustomConfigurator() {
  if (!SUPER_CUSTOM_PUBLIC_ENABLED) return;
  if (!els.superCustomOptionGrid || els.superCustomOptionGrid.dataset.bound === 'true') return;
  els.superCustomOptionGrid.dataset.bound = 'true';

  els.superCustomOptionGrid.addEventListener('click', (event) => {
    const button = event.target.closest('[data-super-option]');
    if (!button || button.disabled) return;
    const step = getSuperCustomSteps()[superCustomStepIndex];
    if (!step) return;
    const optionId = button.dataset.superOption;
    if (superCustomStepAllowsMultiple(step)) {
      const selectedIds = superCustomSelectedIds(step.key);
      superCustomSelections[step.key] = selectedIds.includes(optionId)
        ? selectedIds.filter((id) => id !== optionId)
        : [...selectedIds, optionId];
    } else {
      superCustomSelections[step.key] = optionId;
    }
    renderSuperCustomConfigurator();
  });

  els.superCustomStepTabs?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-super-step]');
    if (!button) return;
    const index = getSuperCustomSteps().findIndex((step) => step.key === button.dataset.superStep);
    if (index < 0) return;
    superCustomStepIndex = index;
    renderSuperCustomConfigurator();
  });

  els.superCustomPrevBtn?.addEventListener('click', () => {
    superCustomStepIndex = Math.max(0, superCustomStepIndex - 1);
    renderSuperCustomConfigurator();
  });

  els.superCustomNextBtn?.addEventListener('click', () => {
    const steps = getSuperCustomSteps();
    const currentStep = steps[superCustomStepIndex];
    if (!currentStep || !superCustomStepHasSelection(currentStep)) return;
    superCustomStepIndex = Math.min(steps.length - 1, superCustomStepIndex + 1);
    renderSuperCustomConfigurator();
  });

  els.superCustomGenerateBtn?.addEventListener('click', () => {
    if (!superCustomAllSelected()) return;
    renderSuperCustomSummary(true);
  });

  els.superCustomImportTask?.addEventListener('change', updateSuperCustomImportHelper);
  els.superCustomImportFile?.addEventListener('change', updateSuperCustomImportHelper);
  els.superCustomImportCopyBtn?.addEventListener('click', async () => {
    const command = els.superCustomImportCommand?.textContent?.trim();
    if (!command) return;
    const originalText = els.superCustomImportCopyBtn.textContent;
    try {
      await navigator.clipboard.writeText(command);
      els.superCustomImportCopyBtn.textContent = '已复制';
    } catch {
      window.prompt('复制入库命令', command);
    } finally {
      window.setTimeout(() => {
        if (els.superCustomImportCopyBtn) els.superCustomImportCopyBtn.textContent = originalText || '复制命令';
      }, 1400);
    }
  });
}

function hasSuperMaskEditor() {
  return !!(els.superMaskCanvas && els.superMaskImage && els.superMaskFileInput);
}

function setSuperCustomTool(tool = 'mask') {
  const activeTool = tool === 'psd' ? 'psd' : 'mask';
  superCustomActiveTool = activeTool;
  (els.superCustomToolButtons || []).forEach((button) => {
    const isActive = button.dataset.superCustomTool === activeTool;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
  els.superMaskWorkspace?.classList.toggle('hidden', activeTool !== 'mask');
  els.superPsdWorkspace?.classList.toggle('hidden', activeTool !== 'psd');
  if (activeTool === 'psd') updateSuperPsdGenerateState();
  else updateSuperMaskGenerateState();
}

function setSuperMaskStatus(message, state = '') {
  if (!els.superMaskStatus) return;
  els.superMaskStatus.textContent = message || '';
  if (state) els.superMaskStatus.dataset.state = state;
  else delete els.superMaskStatus.dataset.state;
}

function setSuperPsdStatus(message, state = '') {
  if (!els.superPsdStatus) return;
  els.superPsdStatus.textContent = message || '';
  if (state) els.superPsdStatus.dataset.state = state;
  else delete els.superPsdStatus.dataset.state;
}

function superPsdSelectedSize() {
  return String(els.superPsdSize?.value || '1024x1024').trim() || '1024x1024';
}

function superPsdSelectedQuality() {
  return String(els.superPsdQuality?.value || 'auto').trim() || 'auto';
}

function superPsdSelectedQualityLabel() {
  return {
    auto: '自动',
    high: '高',
    medium: '中',
    low: '低',
  }[superPsdSelectedQuality()] || '自动';
}

function superPsdSelectedFormat() {
  return String(els.superPsdFormat?.value || 'jpeg').trim() || 'jpeg';
}

function superPsdReferenceCount() {
  return superPsdSourceFiles.length || (superPsdSourceFile ? 1 : 0);
}

function superPsdHasReference() {
  return superPsdReferenceCount() > 0;
}

function renderSuperPsdReferenceStrip() {
  if (!els.superPsdPreviewWrap) return;
  els.superPsdPreviewWrap.querySelector('.free-image-reference-strip')?.remove();
  if (superPsdSourceDataUrls.length <= 1) return;

  const strip = document.createElement('div');
  strip.className = 'free-image-reference-strip';
  const activeIndex = Number(els.superPsdPreviewImage?.dataset.previewIndex || 0);
  superPsdSourceDataUrls.forEach((dataUrl, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = index === activeIndex ? 'active' : '';
    button.innerHTML = `<img src="${dataUrl}" alt="Reference ${index + 1}" /><span>${index + 1}</span>`;
    button.addEventListener('click', () => {
      if (els.superPsdPreviewImage) els.superPsdPreviewImage.dataset.previewIndex = String(index);
      if (els.superPsdPreviewImage) els.superPsdPreviewImage.src = dataUrl;
      strip.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
    });
    strip.appendChild(button);
  });
  els.superPsdPreviewWrap.appendChild(strip);
}

function syncSuperPsdPreviewMeta() {
  const size = superPsdSelectedSize();
  const sizeText = size === 'auto' ? 'auto' : size.replace('x', ' × ');
  if (els.superPsdPreviewMeta) els.superPsdPreviewMeta.textContent = sizeText;
  if (els.superPsdCostNote) {
    els.superPsdCostNote.textContent = `预计消耗 ${superPsdModePointCost()} 灵感值 · ${superPsdImageCount()} 张 · ${superPsdSelectedQualityLabel()} · ${superPsdSelectedFormat().toUpperCase()}`;
  }
}

function clearSuperPsdResults() {
  if (els.superPsdResultGrid) els.superPsdResultGrid.innerHTML = '';
  els.superPsdResultPanel?.classList.add('hidden');
  els.superPsdPreviewPlaceholder?.classList.remove('hidden');
  if (els.superPsdResultMeta) els.superPsdResultMeta.textContent = '结果会显示在这里';
  setSuperPsdPackageDownload(null);
}

function setSuperPsdMode(mode = 'text') {
  superPsdActiveMode = mode === 'image' ? 'image' : 'text';
  const imageMode = superPsdActiveMode === 'image';
  els.superPsdModeButtons?.forEach((button) => {
    const active = button.dataset.freeImageMode === superPsdActiveMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  els.superPsdStage?.classList.toggle('hidden', !imageMode);
  els.superPsdReferenceToolbar?.classList.toggle('hidden', !imageMode || !superPsdHasReference());
  if (els.superPsdPreviewTitle) {
    els.superPsdPreviewTitle.textContent = imageMode
      ? (superPsdHasReference() ? '参考图已就绪，填写描述后生成' : '上传参考图后开始图生图')
      : (superPsdPromptText() ? '描述已就绪，点击开始生成' : '输入描述后开始生成');
  }
  if (!superPsdGenerationInProgress) {
    setSuperPsdStatus(imageMode ? '请上传参考图并填写中文描述' : '请输入中文图像描述');
  }
  syncSuperPsdPreviewMeta();
  updateSuperPsdGenerateState();
}

function superMaskInstructionText() {
  return String(els.superMaskInstruction?.value || '').replace(/\s+/g, ' ').trim();
}

function setSuperMaskTool(tool) {
  superMaskTool = ['erase', 'pan'].includes(tool) ? tool : 'draw';
  els.superMaskDrawBtn?.classList.toggle('active', superMaskTool === 'draw');
  els.superMaskEraseBtn?.classList.toggle('active', superMaskTool === 'erase');
  els.superMaskPanBtn?.classList.toggle('active', superMaskTool === 'pan');
  els.superMaskDrawBtn?.setAttribute('aria-pressed', superMaskTool === 'draw' ? 'true' : 'false');
  els.superMaskEraseBtn?.setAttribute('aria-pressed', superMaskTool === 'erase' ? 'true' : 'false');
  els.superMaskPanBtn?.setAttribute('aria-pressed', superMaskTool === 'pan' ? 'true' : 'false');
  if (els.superMaskCanvasWrap) els.superMaskCanvasWrap.dataset.tool = superMaskTool;
  updateSuperMaskTrialUI();
}

function superMaskPaintStats() {
  const canvas = els.superMaskCanvas;
  const ctx = canvas?.getContext('2d', { willReadFrequently: true });
  if (!canvas || !ctx || !canvas.width || !canvas.height) return { hasPaint: false, coverage: 0 };
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let painted = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 8) painted += 1;
  }
  const total = data.length / 4;
  return { hasPaint: painted > 0, coverage: total ? painted / total : 0 };
}

function superMaskCoverageText(coverage) {
  if (!superMaskSourceFile) return '蒙版 0%';
  const percent = coverage > 0 && coverage < 0.001 ? '<0.1' : (coverage * 100).toFixed(coverage < 0.01 ? 1 : 0);
  return `蒙版 ${percent}%`;
}

function superMaskQualityText(coverage) {
  if (!superMaskSourceFile) return '等待上传';
  if (!superMaskHasPaint) return '先点画笔涂修改区';
  if (coverage < 0.002) return '范围偏小，可再涂一点';
  if (coverage > 0.45) return '范围偏大，建议擦掉不改的区域';
  return '范围合适，可填写改法';
}

function updateSuperMaskTrialUI() {
  const hasSource = !!superMaskSourceFile;
  const hasMask = !!superMaskHasPaint;
  const hasPrompt = !!superMaskInstructionText();
  const readyCount = [hasSource, hasMask, hasPrompt].filter(Boolean).length;
  const checks = { source: hasSource, mask: hasMask, prompt: hasPrompt };

  els.superMaskChecklistItems?.forEach((item) => {
    const key = item.dataset.superMaskCheck;
    item.classList.toggle('done', !!checks[key]);
  });
  if (els.superMaskReadySummary) els.superMaskReadySummary.textContent = `${readyCount} / 3`;

  let activeStep = 'source';
  if (hasSource && !hasMask) activeStep = superMaskTool === 'pan' ? 'move' : 'mask';
  else if (hasSource && hasMask && !hasPrompt) activeStep = 'prompt';
  else if (hasSource && hasMask && hasPrompt) activeStep = 'generate';
  els.superMaskFlowSteps?.forEach((step) => {
    const key = step.dataset.superMaskStep;
    const done = (key === 'source' && hasSource)
      || (key === 'move' && hasSource)
      || (key === 'mask' && hasMask)
      || (key === 'prompt' && hasPrompt)
      || (key === 'generate' && readyCount === 3);
    step.classList.toggle('done', done);
    step.classList.toggle('active', key === activeStep);
  });

  const coverage = hasSource ? superMaskCoverage : 0;
  if (els.superMaskMaskCoverage) els.superMaskMaskCoverage.textContent = superMaskCoverageText(coverage);
  if (els.superMaskMaskQuality) els.superMaskMaskQuality.textContent = superMaskQualityText(coverage);
  if (els.superMaskToolHint) {
    els.superMaskToolHint.textContent = !hasSource
      ? '上传后左键拖动 · 滚轮缩放'
      : superMaskTool === 'pan'
      ? '左键拖动 · 滚轮缩放 · 右键清空'
      : superMaskTool === 'erase'
        ? '左键擦除 · 右键清空'
        : '左键涂抹 · 右键清空';
  }
  if (els.superMaskNextHint) {
    if (!hasSource) els.superMaskNextHint.textContent = '先上传一张婚礼现场图，或点画布右上角试用示例。';
    else if (!hasMask) els.superMaskNextHint.textContent = superMaskTool === 'pan'
      ? '已进入移动模式：滚轮放大、左键拖动；点画笔后涂出要改的位置。'
      : '在画布上涂出要修改的区域，右键可一键清空重涂。';
    else if (!hasPrompt) els.superMaskNextHint.textContent = '填写要改成什么风格，尽量说明保留哪些不变。';
    else if (accountRequired && !currentUser) els.superMaskNextHint.textContent = '已满足生成条件，登录账号后即可生成。';
    else if (accountRequired && !canUseSuperCustom(currentUser)) els.superMaskNextHint.textContent = superCustomAccessMessage();
    else els.superMaskNextHint.textContent = superMaskReferenceFiles.length
      ? '已满足生成条件，参考图会一起参与局部改图。'
      : '已满足生成条件；没有参考图也可以直接生成。';
  }
}

function setSuperMaskGenerating(isGenerating) {
  superMaskGenerationInProgress = !!isGenerating;
  [
    els.superMaskUploadZone,
    els.superMaskSampleBtn,
    els.superMaskFileInput,
    els.superMaskReplaceBtn,
    els.superMaskDrawBtn,
    els.superMaskEraseBtn,
    els.superMaskPanBtn,
    els.superMaskClearBtn,
    els.superMaskBrushSize,
    els.superMaskZoomOutBtn,
    els.superMaskZoomInBtn,
    els.superMaskZoomResetBtn,
    els.superMaskReferenceBtn,
    els.superMaskReferenceInput,
    els.superMaskInstruction,
  ].forEach((item) => {
    if (item) item.disabled = superMaskGenerationInProgress;
  });
  document.querySelectorAll('.super-mask-continue-btn').forEach((button) => {
    button.disabled = superMaskGenerationInProgress;
  });
  updateSuperMaskZoomControls();
  updateSuperMaskGenerateState();
}

function updateSuperMaskGenerateState() {
  if (!els.superMaskGenerateBtn) return;
  const ready = !!superMaskSourceFile && !!superMaskInstructionText() && superMaskHasPaint;
  els.superMaskGenerateBtn.disabled = superMaskGenerationInProgress || !ready;
  els.superMaskGenerateBtn.textContent = superMaskGenerationInProgress
    ? '生成中...'
    : `生成图片（${Math.max(1, pointCostForMode('partial_wedding_edit'))} 灵感值）`;
  updateSuperMaskTrialUI();
}

function superMaskBrushSize() {
  const value = Number(els.superMaskBrushSize?.value || 64);
  return Math.max(8, Math.min(220, Number.isFinite(value) ? value : 64));
}

function clearSuperMaskCanvas() {
  const canvas = els.superMaskCanvas;
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  superMaskHasPaint = false;
  superMaskCoverage = 0;
  updateSuperMaskGenerateState();
  if (superMaskSourceFile) setSuperMaskStatus('已清空蒙版，可以重新涂抹');
}

function clampSuperMaskZoom(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(SUPER_MASK_ZOOM_MIN, Math.min(SUPER_MASK_ZOOM_MAX, Math.round(numeric * 100) / 100));
}

function syncSuperMaskBaseDisplaySize() {
  const image = els.superMaskImage;
  const stage = els.superMaskStage;
  if (!image || !image.naturalWidth || !image.naturalHeight) return false;

  let paddingX = 0;
  let paddingY = 0;
  if (stage) {
    const styles = window.getComputedStyle(stage);
    paddingX = parseFloat(styles.paddingLeft || '0') + parseFloat(styles.paddingRight || '0');
    paddingY = parseFloat(styles.paddingTop || '0') + parseFloat(styles.paddingBottom || '0');
  }

  const availableWidth = Math.max(160, (stage?.clientWidth || window.innerWidth || image.naturalWidth) - paddingX);
  const availableHeight = Math.max(160, (stage?.clientHeight || Math.round(window.innerHeight * 0.72) || image.naturalHeight) - paddingY);
  const fitScale = Math.min(
    availableWidth / image.naturalWidth,
    availableHeight / image.naturalHeight,
    1,
  );

  superMaskBaseDisplayWidth = Math.max(1, Math.round(image.naturalWidth * fitScale));
  superMaskBaseDisplayHeight = Math.max(1, Math.round(image.naturalHeight * fitScale));
  return true;
}

function applySuperMaskDisplaySize() {
  const wrap = els.superMaskCanvasWrap;
  if (!wrap) return;
  if (!superMaskBaseDisplayWidth || !superMaskBaseDisplayHeight) {
    wrap.style.removeProperty('width');
    wrap.style.removeProperty('height');
    wrap.classList.remove('is-zoomed');
    return;
  }
  wrap.style.width = `${Math.round(superMaskBaseDisplayWidth * superMaskZoom)}px`;
  wrap.style.height = `${Math.round(superMaskBaseDisplayHeight * superMaskZoom)}px`;
  wrap.classList.toggle('is-zoomed', superMaskZoom > 1);
}

function updateSuperMaskZoomControls() {
  const percent = Math.round(superMaskZoom * 100);
  if (els.superMaskZoomValue) els.superMaskZoomValue.textContent = `${percent}%`;
  const unavailable = superMaskGenerationInProgress || !superMaskSourceFile;
  if (els.superMaskZoomOutBtn) els.superMaskZoomOutBtn.disabled = unavailable || superMaskZoom <= SUPER_MASK_ZOOM_MIN;
  if (els.superMaskZoomInBtn) els.superMaskZoomInBtn.disabled = unavailable || superMaskZoom >= SUPER_MASK_ZOOM_MAX;
  if (els.superMaskZoomResetBtn) els.superMaskZoomResetBtn.disabled = unavailable || superMaskZoom === 1;
  if (els.superMaskPanBtn) els.superMaskPanBtn.disabled = unavailable;
}

function setSuperMaskZoom(value, announce = false, anchorEvent = null) {
  const stage = els.superMaskStage;
  const wrap = els.superMaskCanvasWrap;
  if (!superMaskBaseDisplayWidth || !superMaskBaseDisplayHeight) syncSuperMaskBaseDisplaySize();
  const beforeRect = wrap?.getBoundingClientRect();
  const hasAnchorPoint = anchorEvent && beforeRect && Number.isFinite(anchorEvent.clientX) && Number.isFinite(anchorEvent.clientY);
  const anchorRatio = hasAnchorPoint && beforeRect.width > 0 && beforeRect.height > 0
    ? {
        x: Math.max(0, Math.min(1, (anchorEvent.clientX - beforeRect.left) / beforeRect.width)),
        y: Math.max(0, Math.min(1, (anchorEvent.clientY - beforeRect.top) / beforeRect.height)),
      }
    : null;
  superMaskZoom = clampSuperMaskZoom(value);
  applySuperMaskDisplaySize();
  els.superMaskStage?.classList.toggle('is-zoomed', superMaskZoom > 1);
  if (stage && wrap && beforeRect && anchorRatio) {
    const afterRect = wrap.getBoundingClientRect();
    if (afterRect.width > 0 && afterRect.height > 0 && beforeRect.width > 0 && beforeRect.height > 0) {
      stage.scrollLeft += (afterRect.left + (afterRect.width * anchorRatio.x)) - anchorEvent.clientX;
      stage.scrollTop += (afterRect.top + (afterRect.height * anchorRatio.y)) - anchorEvent.clientY;
    }
  }
  updateSuperMaskZoomControls();
  if (announce && superMaskSourceFile) setSuperMaskStatus(`图片已缩放到 ${Math.round(superMaskZoom * 100)}%，可以放大后细涂`);
}

function adjustSuperMaskZoom(delta) {
  if (!superMaskSourceFile || superMaskGenerationInProgress) return;
  setSuperMaskZoom(superMaskZoom + delta, true);
  if (superMaskZoom > 1) {
    setSuperMaskTool('pan');
    setSuperMaskStatus(`图片已缩放到 ${Math.round(superMaskZoom * 100)}%，拖动图片可移动视图`);
  }
}

function handleSuperMaskWheel(event) {
  if (!superMaskSourceFile || superMaskGenerationInProgress) return;
  if (!els.superMaskCanvasWrap || els.superMaskCanvasWrap.classList.contains('hidden')) return;
  event.preventDefault();
  const delta = event.deltaY < 0 ? SUPER_MASK_ZOOM_STEP : -SUPER_MASK_ZOOM_STEP;
  const previousZoom = superMaskZoom;
  setSuperMaskZoom(superMaskZoom + delta, false, event);
  if (superMaskZoom > 1) setSuperMaskTool('pan');
  if (superMaskZoom !== previousZoom) {
    setSuperMaskStatus(`图片已缩放到 ${Math.round(superMaskZoom * 100)}%，拖动图片可移动视图`);
  }
}

function superMaskFinalInstruction(baseInstruction) {
  if (!superMaskReferenceFiles.length) return baseInstruction;
  return `${baseInstruction}。参考图只作为风格和元素参考，不要整张照搬参考图，主图未涂抹区域保持原样。`;
}

function superMaskCanvasHasPixels() {
  return superMaskPaintStats().hasPaint;
}

function syncSuperMaskCanvasSize() {
  const image = els.superMaskImage;
  const canvas = els.superMaskCanvas;
  if (!image || !canvas || !image.naturalWidth || !image.naturalHeight) return;
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  syncSuperMaskBaseDisplaySize();
  applySuperMaskDisplaySize();
  clearSuperMaskCanvas();
}

function handleSuperMaskViewportResize() {
  if (!superMaskSourceFile || !els.superMaskImage?.naturalWidth) return;
  const stage = els.superMaskStage;
  const scrollLeftMax = stage ? Math.max(1, stage.scrollWidth - stage.clientWidth) : 1;
  const scrollTopMax = stage ? Math.max(1, stage.scrollHeight - stage.clientHeight) : 1;
  const scrollLeftRatio = stage ? stage.scrollLeft / scrollLeftMax : 0;
  const scrollTopRatio = stage ? stage.scrollTop / scrollTopMax : 0;
  syncSuperMaskBaseDisplaySize();
  applySuperMaskDisplaySize();
  if (stage) {
    stage.scrollLeft = scrollLeftRatio * Math.max(0, stage.scrollWidth - stage.clientWidth);
    stage.scrollTop = scrollTopRatio * Math.max(0, stage.scrollHeight - stage.clientHeight);
  }
}

async function handleSuperMaskSample() {
  if (superMaskGenerationInProgress) return;
  setSuperMaskStatus('正在载入试用示例...');
  try {
    const response = await fetch(new URL(SUPER_MASK_SAMPLE_URL, document.baseURI).toString(), { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const sampleFile = new File([blob], 'super-custom-sample.jpg', {
      type: blob.type || 'image/jpeg',
      lastModified: Date.now(),
    });
    await handleSuperMaskFile(sampleFile);
  } catch (error) {
    setSuperMaskStatus(`试用示例载入失败：${cleanErrorMessage(error.message || '请手动上传图片')}`, 'error');
  }
}

async function handleSuperMaskFile(file, options = {}) {
  if (!hasSuperMaskEditor() || !validateSourceImageFile(file)) return;
  const keepResults = !!options.keepResults;
  const loadedStatus = options.loadedStatus || '照片已载入：左键拖动移动，右键一键清空蒙版；点画笔后开始涂抹';
  window.clearTimeout(superMaskPollTimer);
  superMaskActiveJobId = null;
  setSuperMaskGenerating(false);
  setSuperMaskStatus('正在读取照片...');

  try {
    const prepared = await finalizePreparedImage(file, file, {
      maxWidth: IMAGE_OPTIMIZE_MAX_EDGE,
      maxHeight: IMAGE_OPTIMIZE_MAX_EDGE,
      quality: IMAGE_OPTIMIZE_QUALITY,
      allowCrop: false,
    });
    superMaskSourceFile = prepared.file;
    superMaskSourceDataUrl = prepared.dataUrl;
    els.superMaskImage.onload = () => {
      syncSuperMaskCanvasSize();
      setSuperMaskZoom(1);
      setSuperMaskTool('pan');
      els.superMaskStage?.classList.add('has-image');
      els.superMaskUploadZone?.classList.add('hidden');
      els.superMaskCanvasWrap?.classList.remove('hidden');
      setSuperMaskStatus(loadedStatus);
      updateSuperMaskGenerateState();
    };
    els.superMaskImage.src = superMaskSourceDataUrl;
    if (!keepResults) {
      if (els.superMaskResultGrid) els.superMaskResultGrid.innerHTML = '';
      els.superMaskResultPanel?.classList.add('hidden');
      if (els.superMaskResultMeta) els.superMaskResultMeta.textContent = '候选图会显示在这里';
    }
  } catch (error) {
    setSuperMaskStatus(`照片读取失败：${cleanErrorMessage(error.message || '请换一张图片')}`, 'error');
  }
}

function renderSuperMaskReferenceList() {
  if (!els.superMaskReferenceList) return;
  if (els.superMaskReferenceStatus) {
    els.superMaskReferenceStatus.textContent = superMaskReferenceFiles.length
      ? `已上传 ${superMaskReferenceFiles.length} / 3 张`
      : '可选，最多 3 张';
  }
  els.superMaskReferenceList.innerHTML = superMaskReferenceDataUrls.map((dataUrl, index) => `
    <div class="super-mask-reference-item">
      <img src="${escapeHtml(dataUrl)}" alt="局部改图参考图 ${index + 1}" />
      <button type="button" data-super-mask-reference-remove="${index}" aria-label="删除参考图 ${index + 1}">×</button>
    </div>
  `).join('');
}

async function handleSuperMaskReferenceFiles(fileList) {
  const files = Array.from(fileList || []).filter(Boolean);
  if (!files.length) return;
  const slotsLeft = Math.max(0, 3 - superMaskReferenceFiles.length);
  if (!slotsLeft) {
    setSuperMaskStatus('参考图最多上传 3 张');
    return;
  }
  const selected = files.slice(0, slotsLeft);
  setSuperMaskStatus('正在读取参考图...');
  for (const file of selected) {
    if (!validateSourceImageFile(file)) continue;
    try {
      const prepared = await finalizePreparedImage(file, file, {
        maxWidth: IMAGE_OPTIMIZE_MAX_EDGE,
        maxHeight: IMAGE_OPTIMIZE_MAX_EDGE,
        quality: IMAGE_OPTIMIZE_QUALITY,
        allowCrop: false,
      });
      superMaskReferenceFiles.push(prepared.file);
      superMaskReferenceDataUrls.push(prepared.dataUrl);
    } catch (error) {
      setSuperMaskStatus(`参考图读取失败：${cleanErrorMessage(error.message || '请换一张图片')}`, 'error');
    }
  }
  renderSuperMaskReferenceList();
  setSuperMaskStatus(superMaskReferenceFiles.length
    ? `参考图已添加 ${superMaskReferenceFiles.length} 张`
    : '未添加参考图');
  updateSuperMaskTrialUI();
  if (els.superMaskReferenceInput) els.superMaskReferenceInput.value = '';
}

function removeSuperMaskReference(index) {
  if (index < 0 || index >= superMaskReferenceFiles.length) return;
  superMaskReferenceFiles.splice(index, 1);
  superMaskReferenceDataUrls.splice(index, 1);
  renderSuperMaskReferenceList();
  setSuperMaskStatus(superMaskReferenceFiles.length ? `已保留 ${superMaskReferenceFiles.length} 张参考图` : '已清空参考图');
  updateSuperMaskTrialUI();
}

function superMaskPointerPoint(event) {
  const canvas = els.superMaskCanvas;
  const rect = canvas.getBoundingClientRect();
  const point = event.touches?.[0] || event;
  return {
    x: (point.clientX - rect.left) * (canvas.width / Math.max(1, rect.width)),
    y: (point.clientY - rect.top) * (canvas.height / Math.max(1, rect.height)),
  };
}

function drawSuperMaskStroke(event, isStart = false) {
  const canvas = els.superMaskCanvas;
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx || !superMaskSourceFile) return;
  const point = superMaskPointerPoint(event);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = superMaskBrushSize();
  if (superMaskTool === 'erase') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(14,116,144,0.48)';
    superMaskHasPaint = true;
  }
  if (isStart) {
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x + 0.01, point.y + 0.01);
  } else {
    ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
}

function startSuperMaskPaint(event) {
  if (!superMaskSourceFile || superMaskGenerationInProgress) return;
  if (event.button === 2) {
    event.preventDefault();
    clearSuperMaskCanvas();
    return;
  }
  if (event.button != null && event.button !== 0) return;
  event.preventDefault();
  if (superMaskTool === 'pan') {
    superMaskPanning = true;
    superMaskPanStart = {
      x: event.clientX,
      y: event.clientY,
      scrollLeft: els.superMaskStage?.scrollLeft || 0,
      scrollTop: els.superMaskStage?.scrollTop || 0,
    };
    els.superMaskCanvasWrap?.classList.add('is-panning');
    try { els.superMaskCanvas.setPointerCapture(event.pointerId); } catch {}
    return;
  }
  superMaskDrawing = true;
  try { els.superMaskCanvas.setPointerCapture(event.pointerId); } catch {}
  drawSuperMaskStroke(event, true);
  updateSuperMaskGenerateState();
}

function moveSuperMaskPaint(event) {
  if (superMaskPanning && superMaskPanStart && els.superMaskStage) {
    event.preventDefault();
    els.superMaskStage.scrollLeft = superMaskPanStart.scrollLeft - (event.clientX - superMaskPanStart.x);
    els.superMaskStage.scrollTop = superMaskPanStart.scrollTop - (event.clientY - superMaskPanStart.y);
    return;
  }
  if (!superMaskDrawing) return;
  event.preventDefault();
  drawSuperMaskStroke(event, false);
}

function stopSuperMaskPaint(event) {
  if (superMaskPanning) {
    event?.preventDefault?.();
    superMaskPanning = false;
    superMaskPanStart = null;
    els.superMaskCanvasWrap?.classList.remove('is-panning');
    try { els.superMaskCanvas.releasePointerCapture(event.pointerId); } catch {}
    return;
  }
  if (!superMaskDrawing) return;
  event?.preventDefault?.();
  superMaskDrawing = false;
  try { els.superMaskCanvas.releasePointerCapture(event.pointerId); } catch {}
  const stats = superMaskPaintStats();
  superMaskHasPaint = stats.hasPaint;
  superMaskCoverage = stats.coverage;
  setSuperMaskStatus(superMaskHasPaint ? '蒙版已记录，填写改图要求后即可生成' : '蒙版为空，请涂抹要修改的位置');
  updateSuperMaskGenerateState();
}

function exportSuperMaskBlob() {
  const sourceCanvas = els.superMaskCanvas;
  const sourceCtx = sourceCanvas?.getContext('2d', { willReadFrequently: true });
  if (!sourceCanvas || !sourceCtx || !sourceCanvas.width || !sourceCanvas.height) {
    return Promise.resolve(null);
  }
  const paint = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = sourceCanvas.width;
  maskCanvas.height = sourceCanvas.height;
  const maskCtx = maskCanvas.getContext('2d');
  const mask = maskCtx.createImageData(maskCanvas.width, maskCanvas.height);
  for (let i = 0; i < paint.data.length; i += 4) {
    const painted = paint.data[i + 3] > 8;
    mask.data[i] = 0;
    mask.data[i + 1] = 0;
    mask.data[i + 2] = 0;
    mask.data[i + 3] = painted ? 0 : 255;
  }
  maskCtx.putImageData(mask, 0, 0);
  return new Promise((resolve) => maskCanvas.toBlob(resolve, 'image/png'));
}

function setSuperPsdPackageDownload(result = null) {
  const link = els.superPsdPackageDownload;
  if (!link) return;
  const url = result?.zipDownloadUrl || result?.zipUrl || result?.resource?.zipDownloadUrl || result?.resource?.zipUrl || '';
  if (!url) {
    link.classList.add('hidden');
    link.removeAttribute('href');
    return;
  }
  link.href = downloadUrlForAsset(url);
  link.download = superPsdModeValue() === 'image'
    ? 'wedscene-free-image-to-image-package.zip'
    : 'wedscene-free-text-image-package.zip';
  link.textContent = '下载图片包';
  link.classList.remove('hidden');
}

function renderSuperMaskImages(images = [], options = {}) {
  if (!els.superMaskResultGrid || !els.superMaskResultPanel) return;
  const validImages = images.filter((item) => item?.url);
  if (!validImages.length) return;
  const allowContinue = options.allowContinue !== false;
  els.superMaskResultPanel.classList.remove('hidden');
  if (els.superMaskResultMeta) els.superMaskResultMeta.textContent = `已生成 ${validImages.length} 张`;
  els.superMaskResultGrid.innerHTML = '';
  validImages.forEach((item, index) => {
    const tile = document.createElement('div');
    tile.className = 'super-mask-result-tile';
    if (item.width && item.height) tile.style.aspectRatio = `${item.width} / ${item.height}`;
    const img = document.createElement('img');
    img.src = item.url;
    img.alt = item.label || `局部改图候选 ${index + 1}`;
    const label = document.createElement('span');
    label.textContent = item.label || `候选 ${index + 1}`;
    const children = [img, createImageSaveLink(item, index)];
    if (allowContinue) children.push(createSuperMaskContinueButton(item, index));
    children.push(label);
    tile.append(...children);
    wireImagePreview(tile, item, index);
    els.superMaskResultGrid.appendChild(tile);
  });
}

function createSuperMaskContinueButton(item, index = 0) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tile-custom super-mask-continue-btn';
  button.textContent = '继续定制';
  button.disabled = superMaskGenerationInProgress;
  button.setAttribute('aria-label', `用${item.label || `候选 ${index + 1}`}继续定制`);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    loadImageItemIntoSuperMask(item, {
      keepResults: true,
      loadedStatus: '已把候选图设为新的主图：重新涂抹后可继续生成',
    });
  });
  return button;
}

async function pollSuperMaskJob(jobId, retry = 0) {
  try {
    const response = await fetch(apiUrl(`/api/jobs/${jobId}`), { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const job = await response.json();
    if (job.user) {
      currentUser = job.user;
      updateAccountUI();
    }
    if (Array.isArray(job.partialImages)) renderSuperMaskImages(job.partialImages);
    const progress = Number(job.progress || 0);
    setSuperMaskStatus(`${progress}% · ${job.stage || '任务进行中'}`);

    if (job.status === 'completed') {
      setSuperMaskGenerating(false);
      const resultImages = Array.isArray(job.result?.images) ? job.result.images : job.partialImages;
      renderSuperMaskImages(resultImages || []);
      setSuperMaskStatus('局部改图已生成，结果已保存到资源库', 'success');
      loadResources();
      return;
    }

    if (job.status === 'failed' || job.status === 'cancelled') {
      setSuperMaskGenerating(false);
      setSuperMaskStatus(job.status === 'cancelled'
        ? '任务已停止'
        : `生成失败：${cleanErrorMessage(job.error || '请稍后重试')}`, 'error');
      return;
    }

    superMaskPollTimer = window.setTimeout(() => pollSuperMaskJob(jobId, 0), POLL_INTERVAL);
  } catch (error) {
    const message = cleanErrorMessage(error.message);
    if (superMaskActiveJobId === jobId && isTransientPollingError(message) && retry < MAX_POLL_RECONNECT_ATTEMPTS) {
      setSuperMaskStatus(`生成状态连接波动，正在重连（${retry + 1}/${MAX_POLL_RECONNECT_ATTEMPTS}）`);
      superMaskPollTimer = window.setTimeout(() => pollSuperMaskJob(jobId, retry + 1), 2000);
      return;
    }
    setSuperMaskGenerating(false);
    setSuperMaskStatus(`无法获取生成状态：${message}`, 'error');
  }
}

async function startSuperMaskGeneration() {
  if (!accessGranted) {
    showAccessGate('请先输入公测访问码');
    return;
  }
  if (!superMaskSourceFile) {
    setSuperMaskStatus('请先上传婚礼照片', 'error');
    return;
  }
  const editInstruction = superMaskInstructionText();
  if (!editInstruction) {
    setSuperMaskStatus('请填写要修改成什么样', 'error');
    return;
  }
  const paintStats = superMaskPaintStats();
  superMaskHasPaint = paintStats.hasPaint;
  superMaskCoverage = paintStats.coverage;
  if (!superMaskHasPaint) {
    setSuperMaskStatus('请先在照片上涂抹要修改的位置', 'error');
    updateSuperMaskGenerateState();
    return;
  }
  const requiredPoints = Math.max(1, pointCostForMode('partial_wedding_edit'));
  if (accountRequired && !currentUser) {
    setSuperMaskStatus('请先登录账号后再使用超级定制。', 'error');
    showAuthNotice();
    return;
  }
  if (accountRequired && !canUseSuperCustom(currentUser)) {
    setSuperMaskStatus(superCustomAccessMessage(), 'error');
    showRechargeDialog();
    return;
  }
  if (accountRequired && (!currentUser || Number(currentUser.points || 0) < requiredPoints)) {
    setSuperMaskStatus('点数不足，请联系管理员充值', 'error');
    showAuthNotice();
    return;
  }

  setSuperMaskGenerating(true);
  setSuperMaskStatus('正在导出蒙版并创建任务...');
  if (els.superMaskResultGrid?.children?.length && els.superMaskResultMeta) {
    els.superMaskResultPanel?.classList.remove('hidden');
    els.superMaskResultMeta.textContent = '新一轮生成中，旧候选图保留在这里';
  }
  window.clearTimeout(superMaskPollTimer);

  try {
    const maskBlob = await exportSuperMaskBlob();
    if (!maskBlob) throw new Error('蒙版导出失败');
    const maskFile = new File([maskBlob], 'edit-mask.png', { type: 'image/png', lastModified: Date.now() });
    const formData = new FormData();
    formData.append('mode', 'partial_wedding_edit');
    formData.append('image', superMaskSourceFile, superMaskSourceFile.name || 'wedding-scene.jpg');
    formData.append('edit_mask', maskFile, 'edit-mask.png');
    formData.append('edit_instruction', superMaskFinalInstruction(editInstruction));
    superMaskReferenceFiles.slice(0, 3).forEach((file, index) => {
      formData.append('edit_references', file, file.name || `edit-reference-${index + 1}.jpg`);
    });
    if (currentPartnerSlug()) formData.append('partner', currentPartnerSlug());

    const response = await fetch(apiUrl('/api/jobs'), { method: 'POST', body: formData });
    const data = await response.json().catch(() => ({}));
    if (!response.ok && data.user) {
      currentUser = data.user;
      updateAccountUI();
    }
    if (!response.ok && data.annualMembershipRequired) {
      const accessError = new Error(data.error || superCustomAccessMessage());
      accessError.annualMembershipRequired = true;
      throw accessError;
    }
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    if (data.user) {
      currentUser = data.user;
      updateAccountUI();
    }
    superMaskActiveJobId = data.id;
    setSuperMaskStatus('任务已创建，正在生成局部改图...');
    pollSuperMaskJob(data.id);
  } catch (error) {
    setSuperMaskGenerating(false);
    if (error.annualMembershipRequired) showRechargeDialog();
    setSuperMaskStatus(`提交失败：${cleanErrorMessage(error.message || '请稍后重试')}`, 'error');
  }
}

function setSuperPsdGenerating(isGenerating) {
  superPsdGenerationInProgress = !!isGenerating;
  [
    els.superPsdUploadZone,
    els.superPsdSampleBtn,
    els.superPsdFileInput,
    els.superPsdReplaceBtn,
    els.superPsdPrompt,
    els.superPsdSize,
    els.superPsdQuality,
    els.superPsdCount,
    els.superPsdFormat,
  ].forEach((item) => {
    if (item) item.disabled = superPsdGenerationInProgress;
  });
  els.superPsdModeButtons?.forEach((button) => {
    button.disabled = superPsdGenerationInProgress;
  });
  updateSuperPsdGenerateState();
}

function updateSuperPsdGenerateState() {
  if (!els.superPsdGenerateBtn) return;
  const imageMode = superPsdModeValue() === 'image';
  const promptReady = !!superPsdPromptText();
  const ready = promptReady && (!imageMode || superPsdHasReference());
  els.superPsdGenerateBtn.disabled = superPsdGenerationInProgress || !ready;
  els.superPsdGenerateBtn.textContent = superPsdGenerationInProgress
    ? '生成中...'
    : `开始生成（${superPsdModePointCost()} 灵感值）`;
  if (els.superPsdPreviewTitle && !superPsdGenerationInProgress) {
    els.superPsdPreviewTitle.textContent = imageMode
      ? (superPsdHasReference() ? (promptReady ? '参考图和描述已就绪' : '参考图已就绪，请填写描述') : '上传参考图后开始图生图')
      : (promptReady ? '描述已就绪，点击开始生成' : '输入描述后开始生成');
  }
  syncSuperPsdPreviewMeta();
}

function renderSuperPsdImages(images = [], result = null) {
  if (!els.superPsdResultGrid || !els.superPsdResultPanel) return;
  const validImages = images.filter((item) => item?.url);
  if (!validImages.length) return;
  els.superPsdPreviewPlaceholder?.classList.add('hidden');
  els.superPsdResultPanel.classList.remove('hidden');
  els.superPsdResultGrid.innerHTML = '';
  if (els.superPsdResultMeta) els.superPsdResultMeta.textContent = `已生成 ${validImages.length} 张图片`;
  validImages.forEach((item, index) => {
    const cell = document.createElement('div');
    cell.className = 'super-mask-result-tile';
    if (item.width && item.height) cell.style.aspectRatio = `${item.width} / ${item.height}`;
    const img = document.createElement('img');
    img.src = item.url;
    img.alt = item.label || `自由创作图片 ${index + 1}`;
    const label = document.createElement('span');
    label.textContent = item.label || `图片 ${index + 1}`;
    cell.append(img, createImageSaveLink(item, index), label);
    wireImagePreview(cell, item, index);
    els.superPsdResultGrid.appendChild(cell);
  });
}

async function handleSuperPsdSample() {
  if (superPsdGenerationInProgress) return;
  const samplePrompt = '一场白绿色森系婚礼主舞台，镜面通道，两侧低矮花艺，顶部干净不过度装饰，真实婚礼摄影质感，柔和灯光，高级干净，没有人物，没有文字。';
  if (els.superPsdPrompt) els.superPsdPrompt.value = samplePrompt;
  if (superPsdModeValue() !== 'image') {
    setSuperPsdStatus('示例描述已填入，可直接开始生成');
    updateSuperPsdGenerateState();
    return;
  }
  setSuperPsdStatus('正在载入图生图示例...');
  try {
    const response = await fetch(new URL(SUPER_MASK_SAMPLE_URL, document.baseURI).toString(), { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const sampleFile = new File([blob], 'free-image-reference.jpg', {
      type: blob.type || 'image/jpeg',
      lastModified: Date.now(),
    });
    await handleSuperPsdFile(sampleFile, { loadedStatus: '示例参考图和描述已载入，可开始图生图' });
  } catch (error) {
    setSuperPsdStatus(`试用示例载入失败：${cleanErrorMessage(error.message || '请手动上传图片')}`, 'error');
    updateSuperPsdGenerateState();
  }
}

async function handleSuperPsdFile(file, options = {}) {
  return handleSuperPsdFiles(file ? [file] : [], options);
}

async function handleSuperPsdFiles(fileList, options = {}) {
  const files = Array.from(fileList || []).filter(Boolean).slice(0, SUPER_PSD_REFERENCE_LIMIT);
  if (!files.length) return;
  if (files.some((file) => !validateSourceImageFile(file))) return;
  const keepResults = !!options.keepResults;
  const loadedStatus = options.loadedStatus || '参考图已载入，填写中文描述后可以图生图';
  window.clearTimeout(superPsdPollTimer);
  superPsdActiveJobId = null;
  setSuperPsdGenerating(false);
  setSuperPsdStatus(`正在读取 ${files.length} 张参考图...`);

  try {
    const preparedItems = [];
    for (const file of files) {
      const prepared = await finalizePreparedImage(file, file, {
        maxWidth: IMAGE_OPTIMIZE_MAX_EDGE,
        maxHeight: IMAGE_OPTIMIZE_MAX_EDGE,
        quality: IMAGE_OPTIMIZE_QUALITY,
        allowCrop: false,
      });
      preparedItems.push(prepared);
    }

    superPsdSourceFiles = preparedItems.map((item) => item.file);
    superPsdSourceDataUrls = preparedItems.map((item) => item.dataUrl);
    superPsdSourceFile = superPsdSourceFiles[0] || null;
    superPsdSourceDataUrl = superPsdSourceDataUrls[0] || '';

    if (els.superPsdPreviewImage) {
      els.superPsdPreviewImage.onload = () => {
        els.superPsdStage?.classList.add('has-image');
        els.superPsdUploadZone?.classList.add('hidden');
        els.superPsdPreviewWrap?.classList.remove('hidden');
        els.superPsdReferenceToolbar?.classList.remove('hidden');
        renderSuperPsdReferenceStrip();
        if (els.superPsdImageMeta) {
          const totalSize = superPsdSourceFiles.reduce((sum, item) => sum + Number(item.size || 0), 0);
          els.superPsdImageMeta.textContent = superPsdSourceFiles.length === 1
            ? `${superPsdSourceFile.name || '参考图'} · ${formatFileSize(superPsdSourceFile.size || 0)}`
            : `${superPsdSourceFiles.length} 张参考图 · ${formatFileSize(totalSize)} · 最多 ${SUPER_PSD_REFERENCE_LIMIT} 张`;
        }
        setSuperPsdStatus(superPsdSourceFiles.length === 1 ? loadedStatus : `已载入 ${superPsdSourceFiles.length} 张参考图，填写中文描述后可以图生图`);
        updateSuperPsdGenerateState();
      };
      els.superPsdPreviewImage.dataset.previewIndex = '0';
      els.superPsdPreviewImage.src = superPsdSourceDataUrl;
    }
    if (!keepResults) {
      if (els.superPsdResultGrid) els.superPsdResultGrid.innerHTML = '';
      els.superPsdResultPanel?.classList.add('hidden');
      clearSuperPsdResults();
    }
  } catch (error) {
    setSuperPsdStatus(`参考图读取失败：${cleanErrorMessage(error.message || '请换一张图片')}`, 'error');
  }
}

async function pollSuperPsdJob(jobId, retry = 0) {
  try {
    const response = await fetch(apiUrl(`/api/jobs/${jobId}`), { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const job = await response.json();
    if (job.user) {
      currentUser = job.user;
      updateAccountUI();
    }
    const progress = Number(job.progress || 0);
    setSuperPsdStatus(`${progress}% · ${job.stage || '任务进行中'}`);

    if (job.status === 'completed') {
      setSuperPsdGenerating(false);
      const resultImages = Array.isArray(job.result?.images) ? job.result.images : job.partialImages;
      renderSuperPsdImages(resultImages || [], job.result || null);
      setSuperPsdPackageDownload(job.result);
      setSuperPsdStatus('自由创作图片已生成，结果已保存到资源库', 'success');
      loadResources();
      return;
    }

    if (job.status === 'failed' || job.status === 'cancelled') {
      setSuperPsdGenerating(false);
      setSuperPsdStatus(job.status === 'cancelled'
        ? '任务已停止'
        : `生成失败：${cleanErrorMessage(job.error || '请稍后重试')}`, 'error');
      return;
    }

    superPsdPollTimer = window.setTimeout(() => pollSuperPsdJob(jobId, 0), POLL_INTERVAL);
  } catch (error) {
    const message = cleanErrorMessage(error.message);
    if (superPsdActiveJobId === jobId && isTransientPollingError(message) && retry < MAX_POLL_RECONNECT_ATTEMPTS) {
      setSuperPsdStatus(`生成状态连接波动，正在重连（${retry + 1}/${MAX_POLL_RECONNECT_ATTEMPTS}）`);
      superPsdPollTimer = window.setTimeout(() => pollSuperPsdJob(jobId, retry + 1), 2000);
      return;
    }
    setSuperPsdGenerating(false);
    setSuperPsdStatus(`无法获取生成状态：${message}`, 'error');
  }
}

async function startSuperPsdGeneration() {
  if (!accessGranted) {
    showAccessGate('请先输入公测访问码');
    return;
  }
  const prompt = superPsdPromptText();
  const imageMode = superPsdModeValue() === 'image';
  if (!prompt) {
    setSuperPsdStatus('请先输入中文图像描述', 'error');
    updateSuperPsdGenerateState();
    return;
  }
  if (imageMode && !superPsdHasReference()) {
    setSuperPsdStatus('请先上传图生图参考图', 'error');
    updateSuperPsdGenerateState();
    return;
  }
  const requiredPoints = superPsdModePointCost();
  if (accountRequired && !currentUser) {
    setSuperPsdStatus('请先登录账号后再生成图片', 'error');
    showAuthNotice();
    return;
  }
  if (accountRequired && (!currentUser || Number(currentUser.points || 0) < requiredPoints)) {
    setSuperPsdStatus('点数不足，请联系管理员充值', 'error');
    showAuthNotice();
    return;
  }

  setSuperPsdGenerating(true);
  setSuperPsdStatus('正在创建自由创作图片任务...');
  setSuperPsdPackageDownload(null);
  if (els.superPsdResultGrid?.children?.length && els.superPsdResultMeta) {
    els.superPsdResultPanel?.classList.remove('hidden');
    els.superPsdResultMeta.textContent = '新一轮生成中，旧结果暂时保留在这里';
  }
  window.clearTimeout(superPsdPollTimer);

  try {
    const formData = new FormData();
    formData.append('mode', superPsdJobMode());
    formData.append('prompt', prompt);
    formData.append('image_size', superPsdSelectedSize());
    formData.append('quality', superPsdSelectedQuality());
    formData.append('output_format', superPsdSelectedFormat());
    formData.append('n', String(superPsdImageCount()));
    if (imageMode && superPsdHasReference()) {
      superPsdSourceFiles.forEach((file, index) => {
        const field = index === 0 ? 'image' : 'reference_images';
        formData.append(field, file, file.name || `free-image-reference-${index + 1}.jpg`);
      });
    }
    if (currentPartnerSlug()) formData.append('partner', currentPartnerSlug());

    const response = await fetch(apiUrl('/api/jobs'), { method: 'POST', body: formData });
    const data = await response.json().catch(() => ({}));
    if (!response.ok && data.user) {
      currentUser = data.user;
      updateAccountUI();
    }
    if (!response.ok && data.annualMembershipRequired) {
      const accessError = new Error(data.error || superCustomAccessMessage());
      accessError.annualMembershipRequired = true;
      throw accessError;
    }
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    if (data.user) {
      currentUser = data.user;
      updateAccountUI();
    }
    superPsdActiveJobId = data.id;
    setSuperPsdStatus('任务已创建，正在生成自由创作图片...');
    pollSuperPsdJob(data.id);
  } catch (error) {
    setSuperPsdGenerating(false);
    if (error.annualMembershipRequired) showRechargeDialog();
    setSuperPsdStatus(`提交失败：${cleanErrorMessage(error.message || '请稍后重试')}`, 'error');
  }
}

function bindSuperMaskEditor() {
  if (!hasSuperMaskEditor() || els.superMaskCanvas.dataset.bound === 'true') return;
  els.superMaskCanvas.dataset.bound = 'true';
  els.superMaskGenerateBtn?.setAttribute('disabled', '');
  els.superMaskUploadZone?.addEventListener('click', () => els.superMaskFileInput?.click());
  els.superMaskSampleBtn?.addEventListener('click', handleSuperMaskSample);
  els.superMaskReplaceBtn?.addEventListener('click', () => els.superMaskFileInput?.click());
  els.superMaskFileInput?.addEventListener('change', (event) => handleSuperMaskFile(event.target.files?.[0]));
  els.superMaskReferenceBtn?.addEventListener('click', () => els.superMaskReferenceInput?.click());
  els.superMaskReferenceInput?.addEventListener('change', (event) => handleSuperMaskReferenceFiles(event.target.files));
  els.superMaskReferenceList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-super-mask-reference-remove]');
    if (!button) return;
    removeSuperMaskReference(Number(button.dataset.superMaskReferenceRemove));
  });
  els.superMaskZoomOutBtn?.addEventListener('click', () => adjustSuperMaskZoom(-SUPER_MASK_ZOOM_STEP));
  els.superMaskZoomInBtn?.addEventListener('click', () => adjustSuperMaskZoom(SUPER_MASK_ZOOM_STEP));
  els.superMaskZoomResetBtn?.addEventListener('click', () => setSuperMaskZoom(1, true));
  els.superMaskPanBtn?.addEventListener('click', () => {
    setSuperMaskTool('pan');
    if (superMaskTool === 'pan') setSuperMaskStatus('移动模式：左键拖动图片，右键一键清空蒙版，点画笔继续涂抹');
  });
  els.superMaskDrawBtn?.addEventListener('click', () => setSuperMaskTool('draw'));
  els.superMaskEraseBtn?.addEventListener('click', () => setSuperMaskTool('erase'));
  els.superMaskClearBtn?.addEventListener('click', clearSuperMaskCanvas);
  els.superMaskBrushSize?.addEventListener('input', () => {
    if (els.superMaskBrushSizeValue) els.superMaskBrushSizeValue.textContent = String(superMaskBrushSize());
  });
  els.superMaskInstruction?.addEventListener('input', updateSuperMaskGenerateState);
  els.superMaskGenerateBtn?.addEventListener('click', startSuperMaskGeneration);
  els.superMaskCanvas.addEventListener('pointerdown', startSuperMaskPaint);
  els.superMaskCanvas.addEventListener('pointermove', moveSuperMaskPaint);
  els.superMaskCanvas.addEventListener('pointerup', stopSuperMaskPaint);
  els.superMaskCanvas.addEventListener('pointercancel', stopSuperMaskPaint);
  els.superMaskCanvas.addEventListener('pointerleave', stopSuperMaskPaint);
  els.superMaskCanvas.addEventListener('contextmenu', (event) => event.preventDefault());
  els.superMaskStage?.addEventListener('wheel', handleSuperMaskWheel, { passive: false });
  els.superMaskStage?.addEventListener('dragover', (event) => {
    event.preventDefault();
    els.superMaskStage.classList.add('dragover');
  });
  els.superMaskStage?.addEventListener('dragleave', () => els.superMaskStage.classList.remove('dragover'));
  els.superMaskStage?.addEventListener('drop', (event) => {
    event.preventDefault();
    els.superMaskStage.classList.remove('dragover');
    handleSuperMaskFile(event.dataTransfer.files?.[0]);
  });
  setSuperMaskTool('draw');
  setSuperMaskZoom(1);
  updateSuperMaskGenerateState();
  updateSuperMaskTrialUI();
}

function bindSuperPsdEditor() {
  if (!els.superPsdWorkspace || els.superPsdWorkspace.dataset.bound === 'true') return;
  els.superPsdWorkspace.dataset.bound = 'true';
  els.superPsdGenerateBtn?.setAttribute('disabled', '');
  (els.superCustomToolButtons || []).forEach((button) => {
    button.addEventListener('click', () => setSuperCustomTool(button.dataset.superCustomTool));
  });
  els.superPsdUploadZone?.addEventListener('click', () => els.superPsdFileInput?.click());
  els.superPsdSampleBtn?.addEventListener('click', handleSuperPsdSample);
  els.superPsdReplaceBtn?.addEventListener('click', () => els.superPsdFileInput?.click());
  els.superPsdFileInput?.addEventListener('change', (event) => handleSuperPsdFiles(event.target.files));
  els.superPsdPrompt?.addEventListener('input', () => {
    if (!superPsdGenerationInProgress) setSuperPsdStatus(superPsdModeValue() === 'image' ? '图生图描述已更新' : '文生图描述已更新');
    updateSuperPsdGenerateState();
  });
  els.superPsdModeButtons?.forEach((button) => {
    button.addEventListener('click', () => setSuperPsdMode(button.dataset.freeImageMode));
  });
  [els.superPsdSize, els.superPsdQuality, els.superPsdFormat].forEach((control) => {
    control?.addEventListener('change', updateSuperPsdGenerateState);
  });
  els.superPsdCount?.addEventListener('input', () => {
    els.superPsdCount.value = String(superPsdImageCount());
    updateSuperPsdGenerateState();
  });
  els.superPsdGenerateBtn?.addEventListener('click', startSuperPsdGeneration);
  els.superPsdStage?.addEventListener('dragover', (event) => {
    event.preventDefault();
    els.superPsdStage.classList.add('dragover');
  });
  els.superPsdStage?.addEventListener('dragleave', () => els.superPsdStage.classList.remove('dragover'));
  els.superPsdStage?.addEventListener('drop', (event) => {
    event.preventDefault();
    els.superPsdStage.classList.remove('dragover');
    handleSuperPsdFiles(event.dataTransfer.files);
  });
  setSuperPsdMode(superPsdActiveMode);
  setSuperCustomTool(superCustomActiveTool);
}

function resetWorkflow() {
  localRunId += 1;
  window.clearTimeout(activePollTimer);
  clearAutoResumeTimer();
  activeJobId = null;
  lastRenderedResult = null;
  regeneratingDoubaoPrompt = false;
  canResumeActiveJob = false;
  autoResumeAttempts = 0;
  uploadedFile = null;
  uploadedDataUrl = null;
  uploadedAspectRatio = '';
  uploadedFusionFile = null;
  uploadedFusionDataUrl = null;
  uploadedEditReferenceFiles = [];
  uploadedEditReferenceDataUrls = [];
  if (partialReferenceSortable) {
    try { partialReferenceSortable.destroy(); } catch {}
    partialReferenceSortable = null;
  }
  els.fileInput.value = '';
  if (els.fusionMaterialInput) els.fusionMaterialInput.value = '';
  if (els.partialReferenceInput) els.partialReferenceInput.value = '';
  if (els.customInstruction) els.customInstruction.value = '';
  if (els.partialEditInstruction) els.partialEditInstruction.value = '';
  if (els.setupBrandName) els.setupBrandName.value = '';
  els.inputPreview.src = '';
  if (els.fusionMaterialPreview) els.fusionMaterialPreview.src = '';
  els.uploadZone.classList.remove('hidden');
  els.inputPreviewWrap.classList.add('hidden');
  els.fusionMaterialPreviewWrap?.classList.add('hidden');
  els.partialReferencePreviewWrap?.classList.add('hidden');
  if (els.partialReferencePreviewList) els.partialReferencePreviewList.innerHTML = '';
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
  if (els.regenerateDoubaoPromptBtn) {
    els.regenerateDoubaoPromptBtn.classList.add('hidden');
    els.regenerateDoubaoPromptBtn.disabled = false;
    els.regenerateDoubaoPromptBtn.textContent = '重新生成提示词';
  }
  updateFusionControls();
  setGenerating(false);
  setProgress(0, '等待上传素材');
}

function bindEvents() {
  $$('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (event) => {
      const page = link.getAttribute('href')?.replace(/^#/, '');
      if (page === 'video' && !VIDEO_PAGE_ENABLED) {
        event.preventDefault();
        if (window.location.hash !== '#home') {
          window.location.hash = 'home';
        } else {
          showPage('home');
        }
        return;
      }
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
  window.addEventListener('resize', handleSuperMaskViewportResize);

  els.uploadZone.addEventListener('click', () => els.fileInput.click());
  els.replaceImageBtn.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', (event) => handleGeneratorFiles(event.target.files));
  els.fusionMaterialPickBtn?.addEventListener('click', () => els.fusionMaterialInput?.click());
  els.replaceFusionMaterialBtn?.addEventListener('click', () => els.fusionMaterialInput?.click());
  els.fusionMaterialInput?.addEventListener('change', (event) => handleFusionFile(event.target.files[0]));
  els.partialReferencePickBtn?.addEventListener('click', () => els.partialReferenceInput?.click());
  els.clearPartialReferencesBtn?.addEventListener('click', clearPartialReferences);
  els.partialReferenceInput?.addEventListener('change', (event) => handlePartialReferenceFiles(event.target.files));
  els.partialEditInstruction?.addEventListener('input', () => {
    if (isPartialWeddingEditMode() && uploadedFile) {
      setProgress(partialEditInstructionText() ? 16 : 12, partialEditInstructionText() ? '主图和修改指令已就绪' : '主图已上传，请填写局部改图指令');
    }
    updateGenerateState();
  });
  els.customInstruction?.addEventListener('input', () => {
    if (supportsCustomInstruction() && uploadedFile) {
      setProgress(customInstructionText() ? 16 : 12, customInstructionText() ? '图片和补充说明已就绪' : '素材已上传，可选填写补充说明');
    }
    updateGenerateState();
  });
  els.setupBrandName?.addEventListener('input', () => {
    if (isSetupProcessGridMode() && uploadedFile) {
      const brandName = setupBrandNameText();
      setProgress(brandName ? 16 : 12, brandName ? `品牌名已填写：${brandName}` : `${isPhotoAreaSetupGridMode() ? '留影区完工图' : '完工图'}已上传，可选填写搭建人员品牌名`);
    }
    updateGenerateState();
  });
  els.sampleDemoBtn.addEventListener('click', useSampleDemo);
  els.generateBtn.addEventListener('click', startGeneration);
  els.restartBtn.addEventListener('click', handleRestartClick);
  els.copyTextBtn.addEventListener('click', copyPublishText);
  els.copyDoubaoPromptBtn?.addEventListener('click', copyDoubaoVideoPrompt);
  els.regenerateDoubaoPromptBtn?.addEventListener('click', regenerateDoubaoVideoPrompt);
  els.copyUploadZone?.addEventListener('click', () => els.copyFileInput?.click());
  els.replaceCopyImageBtn?.addEventListener('click', () => els.copyFileInput?.click());
  els.copyFileInput?.addEventListener('change', (event) => handleCopyFile(event.target.files?.[0]));
  els.copySampleDemoBtn?.addEventListener('click', useCopySampleDemo);
  els.copyGenerateBtn?.addEventListener('click', startCopyGeneration);
  els.copyRestartBtn?.addEventListener('click', handleCopyRestartClick);
  els.copyPageCopyBtn?.addEventListener('click', copyPageText);
  els.chatSendBtn?.addEventListener('click', sendChatMessage);
  els.chatImageBtn?.addEventListener('click', generateChatImage);
  els.chatClearBtn?.addEventListener('click', clearChatMessages);
  els.chatCopyBtn?.addEventListener('click', copyLastChatAnswer);
  els.chatPromptInput?.addEventListener('input', fitChatPromptInput);
  els.chatPromptInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      sendChatMessage();
    }
  });
  els.chatReferenceBtn?.addEventListener('click', () => els.chatReferenceInput?.click());
  els.chatReferenceInput?.addEventListener('change', (event) => {
    handleChatReferenceFiles(event.target?.files);
  });
  els.chatReferenceList?.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const item = target?.closest('[data-chat-reference-id]');
    if (!target?.closest('.chat-reference-remove') || !item) return;
    removeChatReferenceImage(item.dataset.chatReferenceId || '');
  });
  els.chatQuickPrompts?.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('button[data-chat-prompt]');
    if (!button) return;
    fillChatPrompt(button.dataset.chatPrompt || button.textContent || '');
  });
  renderChatMessages();
  renderChatReferenceImages();
  updateChatCostText();
  fitChatPromptInput();
  els.voiceUploadZone?.addEventListener('click', () => els.voiceFileInput?.click());
  els.voiceReplaceBtn?.addEventListener('click', () => els.voiceFileInput?.click());
  els.voiceFileInput?.addEventListener('change', (event) => handleVoiceFile(event.target.files?.[0]));
  els.voiceTextInput?.addEventListener('input', updateVoiceGenerateState);
  els.voiceReferenceTextInput?.addEventListener('input', updateVoiceGenerateState);
  els.voiceConsentCheck?.addEventListener('change', updateVoiceGenerateState);
  els.voiceGenerateBtn?.addEventListener('click', startVoiceGeneration);
  els.voiceRestartBtn?.addEventListener('click', resetVoiceTool);
  els.refreshResourcesBtn?.addEventListener('click', loadResources);
  els.externalImportBtn?.addEventListener('click', startExternalImport);
  els.externalImportUrl?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      startExternalImport();
    }
  });
  applyExternalImportAvailability();
  els.geoVerifyBtn?.addEventListener('click', runGeoVerify);
  els.geoKnowledgeBtn?.addEventListener('click', runGeoKnowledge);
  els.geoArticleBtn?.addEventListener('click', runGeoArticlePrompts);
  els.geoVisibilityBtn?.addEventListener('click', runGeoVisibility);
  els.geoDistillBtn?.addEventListener('click', runGeoDistill);
  els.geoAuditBtn?.addEventListener('click', runGeoAudit);
  [els.geoBrandName, els.geoLegalName, els.geoCreditCode, els.geoOwnerName, els.geoOwnerPhone, els.geoCity, els.geoContactInfo, els.geoWebsiteUrl, els.geoLicenseUrl].forEach((input) => {
    input?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      runGeoVerify();
    });
  });
  [els.geoWeddingServices, els.geoWeddingStyles, els.geoPriceRange, els.geoKnowledgeArea].forEach((input) => {
    input?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      runGeoKnowledge();
    });
  });
  [els.geoArticleTopic, els.geoArticleAudience].forEach((input) => {
    input?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      runGeoArticlePrompts();
    });
  });
  [els.geoServiceArea, els.geoAuditUrl, els.geoDistillKeywords].forEach((input) => {
    input?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      if (input?.tagName === 'TEXTAREA' && (event.shiftKey || event.ctrlKey)) return;
      event.preventDefault();
      if (input === els.geoAuditUrl) runGeoAudit();
      else if (input === els.geoDistillKeywords) runGeoDistill();
      else runGeoVisibility();
    });
  });
  els.refreshAccountLogsBtn?.addEventListener('click', loadAccountLogs);
  els.rechargeFromLogsBtn?.addEventListener('click', showRechargeDialog);
  els.authEntryBtn?.addEventListener('click', showAuthNotice);
  els.guideContactBtn?.addEventListener('click', showGuideContactDialog);

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
  els.copyUploadZone?.addEventListener('dragover', (event) => {
    event.preventDefault();
    els.copyUploadZone.classList.add('dragover');
  });
  els.copyUploadZone?.addEventListener('dragleave', () => els.copyUploadZone.classList.remove('dragover'));
  els.copyUploadZone?.addEventListener('drop', (event) => {
    event.preventDefault();
    els.copyUploadZone.classList.remove('dragover');
    handleCopyFile(event.dataTransfer.files?.[0]);
  });
  els.voiceUploadZone?.addEventListener('dragover', (event) => {
    event.preventDefault();
    els.voiceUploadZone.classList.add('dragover');
  });
  els.voiceUploadZone?.addEventListener('dragleave', () => els.voiceUploadZone.classList.remove('dragover'));
  els.voiceUploadZone?.addEventListener('drop', (event) => {
    event.preventDefault();
    els.voiceUploadZone.classList.remove('dragover');
    handleVoiceFile(event.dataTransfer.files?.[0]);
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
  els.partialEditPanel?.addEventListener('dragover', (event) => {
    event.preventDefault();
    els.partialEditPanel.classList.add('dragover');
  });
  els.partialEditPanel?.addEventListener('dragleave', () => els.partialEditPanel.classList.remove('dragover'));
  els.partialEditPanel?.addEventListener('drop', (event) => {
    event.preventDefault();
    els.partialEditPanel.classList.remove('dragover');
    handlePartialReferenceFiles(event.dataTransfer.files);
  });

  els.modeGrid.addEventListener('click', (event) => {
    const button = event.target.closest('.mode-card');
    if (button && !button.disabled && button.dataset.mode) setMode(button.dataset.mode);
  });

  els.imageEnhanceSizeButtons?.forEach((button) => {
    button.addEventListener('click', () => setImageEnhanceSize(button.dataset.imageEnhanceSize));
  });

  $$('[data-select-mode]').forEach((link) => {
    link.addEventListener('click', () => {
      const mode = link.dataset.selectMode;
      if (MODE_CONFIG[mode]) {
        window.setTimeout(() => setMode(mode), 80);
      }
    });
  });

  $$('[data-open-external-import]').forEach((link) => {
    link.addEventListener('click', focusExternalImportPanel);
  });

  $$('[data-scroll-target]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      const target = document.getElementById(button.dataset.scrollTarget || '');
      if (!target) return;
      const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
      target.scrollIntoView({ block: 'start', behavior });
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
  updateVoiceGenerateState();

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

function setupHomeIntro() {
  const overlay = document.querySelector('[data-home-intro]');
  const hero = document.querySelector('[data-home-hero]');
  const video = document.getElementById('homeIntroVideo');

  const revealHero = () => {
    hero?.classList.remove('intro-active');
    hero?.classList.add('intro-ready');
  };

  const removeOverlay = () => {
    overlay?.remove();
    document.body.classList.remove('home-intro-playing');
  };

  if (!overlay || !hero || !video) {
    revealHero();
    return;
  }

  const shouldSkipIntro = pageFromHash() !== 'home' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (shouldSkipIntro) {
    revealHero();
    removeOverlay();
    return;
  }

  let finished = false;
  let copyRevealed = false;

  const revealCopyNearGlow = () => {
    if (copyRevealed) return;
    copyRevealed = true;
    revealHero();
  };

  const finishIntro = () => {
    if (finished) return;
    finished = true;
    revealCopyNearGlow();
    overlay.classList.add('is-ending');
    window.setTimeout(removeOverlay, 820);
  };

  document.body.classList.add('home-intro-playing');
  video.muted = true;
  video.playbackRate = 1;

  video.addEventListener('timeupdate', () => {
    const duration = Number(video.duration || 0);
    if (duration && video.currentTime >= Math.max(0.2, duration - 0.45)) {
      revealCopyNearGlow();
    }
  });
  video.addEventListener('ended', finishIntro, { once: true });
  video.addEventListener('error', finishIntro, { once: true });

  window.setTimeout(() => {
    if (!finished && video.currentTime < 0.2) finishIntro();
  }, 1200);
  window.setTimeout(finishIntro, 3200);

  video.play().catch(finishIntro);
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

function enhanceMediaChromeVideo(container, video) {
  if (!container || !video || video.dataset.mediaChrome === 'ready') return;
  if (!window.customElements?.get('media-controller')) {
    const attempts = Number(video.dataset.mediaChromeAttempts || 0);
    if (attempts >= 4) return;
    video.dataset.mediaChromeAttempts = String(attempts + 1);
    window.setTimeout(() => enhanceMediaChromeVideo(container, video), 900);
    return;
  }
  if (video.closest('media-controller')) {
    video.dataset.mediaChrome = 'ready';
    return;
  }
  const controller = document.createElement('media-controller');
  controller.className = 'media-chrome-controller';
  const controlBar = document.createElement('media-control-bar');
  controlBar.innerHTML = `
    <media-play-button></media-play-button>
    <media-time-range></media-time-range>
    <media-time-display show-duration></media-time-display>
    <media-mute-button></media-mute-button>
    <media-volume-range></media-volume-range>
    <media-fullscreen-button></media-fullscreen-button>
  `;
  video.controls = false;
  video.setAttribute('slot', 'media');
  video.dataset.mediaChrome = 'ready';
  container.insertBefore(controller, video);
  controller.append(video, controlBar);
}

function addVideoFullscreenButton(container, video, fallbackUrl = '', filename = 'wedscene-motion.mp4') {
  if (!container || !video || container.querySelector('.video-fullscreen-btn')) return;
  container.classList.add('video-fullscreen-target');
  enhanceMediaChromeVideo(container, video);
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
const VIDEO_GENERATION_DISABLED = false;
const VIDEO_UPGRADE_MESSAGE = '视频功能升级中';
const VIDEO_UPGRADE_DETAIL = '视频功能升级中，暂时无法生成。上游通道恢复后会重新开放。';

const videoState = {
  file: null,
  files: [],
  videoFiles: [],
  audioFiles: [],
  dataUrl: '',
  previewUrls: [],
  modelMode: motionConfig.defaultModelMode || 'fast',
  prompt: '',
  duration: motionConfig.durationSeconds || 15,
  aspectRatio: motionConfig.aspectRatio || '16:9',
  referenceUrl: '',
  referenceVideoUrl: '',
  referenceAudioUrl: '',
  generateAudio: false,
  jobId: null,
  pollTimer: null,
  generating: false,
  style: DEFAULT_MOTION_STYLE,
  progress: 0,
};

buildStepIndicator();
bindEvents();
bindSuperCustomConfigurator();
bindSuperMaskEditor();
bindSuperPsdEditor();
renderSuperCustomConfigurator();
loadSuperCustomLibrary();
setupReveal();
setupHeroMotion();
setupHomeIntro();
setupVideoPage();
initVideoFullscreenButtons();
setImageEnhanceSize(selectedImageEnhanceSize);
updateFusionControls();
checkApiHealth();
showPage();
window.setTimeout(() => syncActiveModeScroll(), 120);

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
  if (!VIDEO_GENERATION_DISABLED && els.videoJobStatusText) {
    els.videoJobStatusText.textContent = '等待上传照片';
  }
  videoUpdateGenerateState();
}

function renderVideoStyleButtons() {
  videoState.style = DEFAULT_MOTION_STYLE;
  if (VIDEO_GENERATION_DISABLED && els.videoPointHint) {
    els.videoPointHint.textContent = '视频功能升级中 · 暂停生成';
    return;
  }
  if (els.videoPointHint) {
    els.videoPointHint.textContent = `每条 ${motionConfig.pointCost || 200} 灵感值 · ${motionConfig.durationSeconds || 15} 秒`;
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
  if (videoPreviewSortable) {
    try { videoPreviewSortable.destroy(); } catch {}
    videoPreviewSortable = null;
  }
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
        <b class="drag-handle" aria-hidden="true">↕</b>
        <span>${label}</span>
      </div>
    `;
  }).join('');
  enableVideoReferenceSorting();
}

function enableVideoReferenceSorting() {
  if (!els.videoInputPreviewList || typeof window.Sortable !== 'function') return;
  if (videoPreviewSortable) {
    try { videoPreviewSortable.destroy(); } catch {}
    videoPreviewSortable = null;
  }
  if ((videoState.files || []).length < 2) {
    els.videoInputPreviewList.classList.remove('sortable-active');
    return;
  }
  els.videoInputPreviewList.classList.add('sortable-active');
  videoPreviewSortable = window.Sortable.create(els.videoInputPreviewList, {
    animation: 150,
    handle: '.drag-handle',
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    onEnd(event) {
      videoState.files = moveArrayItem(videoState.files, event.oldIndex, event.newIndex);
      renderVideoInputPreviews(videoState.files);
      if (els.videoJobStatusText) {
        els.videoJobStatusText.textContent = `已调整 ${videoState.files.length} 张镜头图顺序，提交时会按当前顺序生成`;
      }
    },
  });
}

async function handleVideoFiles(files) {
  const limit = videoReferenceLimit();
  const rawFiles = Array.from(files || []).filter(Boolean).slice(0, limit);
  if (!rawFiles.length) return;
  if ((files?.length || 0) > limit) {
    alert(`最多上传 ${limit} 张参考图，系统会使用前 ${limit} 张。`);
  }
  const selectedFiles = [];
  for (const rawFile of rawFiles) {
    selectedFiles.push(rawFile);
  }
  const file = selectedFiles[0];
  const dataUrl = await readFileAsDataUrl(file).catch(() => '');
  if (!dataUrl) return;
  const sizes = await Promise.all(selectedFiles.map(readImageSize));
  const advice = describeVideoUploadAdvice(selectedFiles, sizes);
  videoState.file = file;
  videoState.files = selectedFiles;
  videoState.dataUrl = dataUrl;
  if (els.videoInputPreview) els.videoInputPreview.src = dataUrl;
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
  if (VIDEO_GENERATION_DISABLED && els.videoJobStatusText) {
    els.videoJobStatusText.textContent = VIDEO_UPGRADE_DETAIL;
  }
  videoUpdateGenerateState();
}

function videoUpdateGenerateState() {
  if (!els.videoGenerateBtn) return;
  if (VIDEO_GENERATION_DISABLED) {
    els.videoGenerateBtn.disabled = true;
    els.videoGenerateBtn.textContent = VIDEO_UPGRADE_MESSAGE;
    return;
  }
  const ready = !!(videoState.files?.length || videoState.file) && !videoState.generating;
  els.videoGenerateBtn.disabled = !ready;
  els.videoGenerateBtn.textContent = videoState.generating
    ? '视频生成中（等待上游）...'
    : `一键生成连续转场视频（${motionConfig.pointCost || 200} 灵感值）`;
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
  if (VIDEO_GENERATION_DISABLED) {
    videoSetProgress(0, VIDEO_UPGRADE_DETAIL);
  }
  videoUpdateGenerateState();
}

async function startVideoGeneration() {
  if (VIDEO_GENERATION_DISABLED) {
    videoSetProgress(0, VIDEO_UPGRADE_DETAIL);
    videoAppendLog('[notice] 视频功能升级中，暂时无法提交任务');
    alert(VIDEO_UPGRADE_DETAIL);
    return;
  }
  const limit = videoReferenceLimit();
  const files = videoState.files?.length ? videoState.files.slice(0, limit) : (videoState.file ? [videoState.file] : []);
  if (!files.length || videoState.generating) return;
  if (!accessGranted) { showAccessGate('请先输入公测访问码'); return; }
  if (accountRequired && !currentUser) {
    showAccessGate('请先登录账号后使用视频功能。');
    return;
  }
  if (accountRequired && !canUseMotionFeatures(currentUser)) {
    alert(motionAccessMessage());
    showRechargeDialog();
    return;
  }
  if (accountRequired && (!currentUser || Number(currentUser.points || 0) < (motionConfig.pointCost || 200))) {
    alert(`需要至少 ${motionConfig.pointCost || 200} 灵感值才能生成视频，当前余额不足。`);
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
    wrap.className = 'video-history-media rounded-lg overflow-hidden bg-black aspect-video';
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

function renderVideoV1Page() {
  const host = document.querySelector('#video .max-w-7xl');
  if (!host || host.dataset.videoV1Rendered === 'true') return !!host;
  host.dataset.videoV1Rendered = 'true';
  const durationOptions = (Array.isArray(motionConfig.durationOptions) && motionConfig.durationOptions.length
    ? motionConfig.durationOptions
    : [10, 15])
    .map((value) => Number(value))
    .filter((value, index, list) => (value === 10 || value === 15) && list.indexOf(value) === index);
  if (!durationOptions.length) durationOptions.push(15);
  const selectedDuration = durationOptions.includes(Number(motionConfig.durationSeconds))
    ? Number(motionConfig.durationSeconds)
    : 15;
  const referenceLimit = videoReferenceLimit();
  const referenceMediaLimit = videoReferenceMediaLimit();
  const selectedModelMode = selectedVideoModelMode();
  const referenceVideoLimit = videoReferenceVideoLimit();
  const referenceAudioLimit = videoReferenceAudioLimit();
  videoState.duration = selectedDuration;
  videoState.modelMode = selectedModelMode;
  host.innerHTML = `
    <section class="video-v1-workspace reveal visible" data-video-v1-root>
      <div class="video-v1-head">
        <div>
          <div class="tag mb-4">AI · WF-SD2</div>
          <h2 class="font-cn">视频生成</h2>
          <p>Prompt to video · 快速 / 质量</p>
        </div>
        <div class="video-control-specs video-v1-specs" aria-label="生成规格">
          <span><b>${escapeHtml(String(selectedDuration))} 秒</b><small>时长</small></span>
          <span><b>${escapeHtml(String(motionConfig.pointCost || 200))}</b><small>灵感值</small></span>
        </div>
      </div>

      <div class="video-v1-grid">
        <section class="video-v1-panel video-v1-form-panel">
          <input id="videoModelModeInput" type="hidden" value="${escapeHtml(selectedModelMode)}" />

          <div class="video-v1-controls">
            <div class="video-v1-field">
              <span>模型</span>
              <div id="videoModelModeGroup" class="video-v1-segmented" role="group" aria-label="视频模型">
                <button type="button" data-video-model-mode="fast">快速</button>
                <button type="button" data-video-model-mode="quality">质量</button>
              </div>
            </div>
            <label class="video-v1-field">
              <span>时长</span>
              <select id="videoDurationInput">
                ${durationOptions.map((value) => {
                  return `<option value="${value}"${value === selectedDuration ? ' selected' : ''}>${value} 秒</option>`;
                }).join('')}
              </select>
            </label>
            <div class="video-v1-field">
              <span>画幅</span>
              <div id="videoAspectRatioGroup" class="video-v1-segmented" role="group" aria-label="画幅比例">
                <button type="button" data-video-aspect="16:9">16:9</button>
                <button type="button" data-video-aspect="9:16">9:16</button>
              </div>
              <input id="videoAspectRatioInput" type="hidden" value="16:9" />
            </div>
          </div>

          <div class="video-v1-reference-block">
            <div class="video-v1-reference-head">
              <span>上传参考素材</span>
              <small id="videoUploadLimitHint">提示：支持 ${referenceLimit} 张参考图、${referenceVideoLimit} 个视频（图片+视频不超过 ${Math.min(referenceMediaLimit, referenceLimit + referenceVideoLimit)} 条）；图片≤${referenceLimit}张，单图≤5M，总和≤20M；视频≤${referenceVideoLimit}条，分辨率720p-2160px，总大小≤200MB，总时长不超过15秒；音频最多传入1个</small>
            </div>
            <div class="video-v1-reference-grid">
              <div id="videoUploadZone" class="video-v1-upload" role="button" tabindex="0" aria-label="上传参考素材">
                <strong aria-hidden="true">+</strong>
                <input id="videoFileInput" type="file" accept="image/*,video/mp4,video/quicktime,video/webm,video/x-m4v,video/x-msvideo,audio/*" multiple class="hidden" />
              </div>
              <div id="videoInputPreviewWrap" class="video-v1-preview hidden">
                <img id="videoInputPreview" alt="参考图预览" />
                <div id="videoInputPreviewList" class="video-input-preview-list"></div>
                <button type="button" id="videoReplaceBtn" class="btn-ghost px-4 py-2 rounded-full text-xs">清空素材</button>
              </div>
              <p id="videoUploadAdvice" class="video-upload-advice"></p>
            </div>
          </div>

          <label id="videoGenerateAudioField" class="video-v1-check-field hidden">
            <input id="videoGenerateAudioInput" type="checkbox" />
            <span>生成同步音频</span>
          </label>

          <label class="video-v1-field">
            <span>提示词</span>
            <textarea id="videoPromptInput" rows="8" maxlength="2000" placeholder="输入描述内容，输入 @ 可以快速选择提示词。"></textarea>
            <div class="video-v1-prompt-tools">
              <span id="videoPromptCount">0/2000</span>
              <button id="videoPromptClearBtn" type="button">清空</button>
            </div>
          </label>

          <div class="video-action-row video-v1-actions">
            <button id="videoGenerateBtn" type="button" class="btn-primary video-v1-generate-btn disabled:opacity-40 disabled:cursor-not-allowed" disabled>开始生成 15 秒视频</button>
            <button id="videoRestartBtn" type="button" class="btn-ghost px-5 py-3 rounded-full text-sm">重置</button>
            <span id="videoPointHint" class="font-mono"></span>
          </div>
        </section>

        <aside class="video-v1-panel video-v1-status-panel">
          <div class="video-progress-card">
            <div class="flex items-center justify-between mb-2">
              <span id="videoJobStatusText" class="text-sm text-stone-400">等待输入提示词</span>
              <span id="videoOverallProgress" class="text-sm font-mono text-rose-200">0%</span>
            </div>
            <div class="progress-track overflow-hidden">
              <div id="videoProgressBar" class="progress-fill h-full" style="width:0%; background: linear-gradient(90deg, #e8b4a8, #c9a961);"></div>
            </div>
          </div>

          <div class="generation-log video-generation-log rounded-lg p-4 font-mono text-xs overflow-hidden">
            <div class="video-log-title">任务日志</div>
            <div id="videoLogStream"></div>
          </div>

          <section id="videoResultPanel" class="hidden video-v1-result">
            <div class="video-v1-result-head">
              <div>
                <span>生成结果</span>
                <h3 id="videoResultTitle" class="font-cn">Seedance 成片</h3>
              </div>
              <div class="video-result-actions">
                <button id="videoPreviewBtn" type="button" class="hidden btn-ghost px-4 py-2 rounded-full text-xs">预览</button>
                <a id="videoDownloadBtn" href="#" class="hidden btn-primary px-4 py-2 rounded-full text-xs" download="wedscene-video-v1.mp4">下载</a>
              </div>
            </div>
            <div class="motion-video-wrap relative rounded-lg overflow-hidden bg-black">
              <video id="videoResultVideo" class="w-full block" controls preload="metadata" playsinline></video>
            </div>
            <div id="videoResultMeta" class="mt-3 text-xs text-stone-400 font-mono"></div>
          </section>
        </aside>
      </div>

      <section class="video-v1-history">
        <div class="video-v1-history-head">
          <div>
            <span>最近生成</span>
            <h3 class="font-cn">我的视频</h3>
          </div>
          <a href="#resources" data-page-link="resources">查看全部</a>
        </div>
        <div id="videoHistoryGrid" class="video-v1-history-grid"></div>
        <div id="videoHistoryEmpty" class="video-v1-empty">暂无视频</div>
      </section>
    </section>
  `;
  return true;
}

function refreshVideoEls() {
  Object.assign(els, {
    videoPromptInput: $('#videoPromptInput'),
    videoPromptCount: $('#videoPromptCount'),
    videoPromptClearBtn: $('#videoPromptClearBtn'),
    videoModelModeInput: $('#videoModelModeInput'),
    videoModelModeButtons: $$('#videoModelModeGroup [data-video-model-mode]'),
    videoDurationInput: $('#videoDurationInput'),
    videoAspectRatioInput: $('#videoAspectRatioInput'),
    videoAspectRatioButtons: $$('#videoAspectRatioGroup [data-video-aspect]'),
    videoReferenceUrlInput: $('#videoReferenceUrlInput'),
    videoReferenceVideoUrlInput: $('#videoReferenceVideoUrlInput'),
    videoReferenceAudioUrlInput: $('#videoReferenceAudioUrlInput'),
    videoReferenceVideoUrlField: $('#videoReferenceVideoUrlField'),
    videoReferenceAudioUrlField: $('#videoReferenceAudioUrlField'),
    videoGenerateAudioInput: $('#videoGenerateAudioInput'),
    videoGenerateAudioField: $('#videoGenerateAudioField'),
    videoUploadZone: $('#videoUploadZone'),
    videoUploadLimitHint: $('#videoUploadLimitHint'),
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
    videoResultTitle: $('#videoResultTitle'),
    videoPreviewBtn: $('#videoPreviewBtn'),
    videoDownloadBtn: $('#videoDownloadBtn'),
    videoHistoryGrid: $('#videoHistoryGrid'),
    videoHistoryEmpty: $('#videoHistoryEmpty'),
  });
}

function syncVideoAspectButtons() {
  const aspect = videoState.aspectRatio || motionConfig.aspectRatio || '16:9';
  if (els.videoAspectRatioInput) els.videoAspectRatioInput.value = aspect;
  els.videoAspectRatioButtons?.forEach((button) => {
    const active = button.dataset.videoAspect === aspect;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function syncVideoModelButtons() {
  const mode = selectedVideoModelMode();
  const limit = videoReferenceLimit();
  const mediaLimit = videoReferenceMediaLimit();
  const videoLimit = videoReferenceVideoLimit();
  const audioLimit = videoReferenceAudioLimit();
  if (els.videoModelModeInput) els.videoModelModeInput.value = mode;
  els.videoModelModeButtons?.forEach((button) => {
    const active = normalizeVideoModelMode(button.dataset.videoModelMode) === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  [els.videoReferenceVideoUrlField, els.videoReferenceAudioUrlField].forEach((field) => {
    field?.classList.remove('hidden');
  });
  els.videoGenerateAudioField?.classList.add('hidden');
  trimVideoReferencesToCurrentMode();
  renderVideoInputPreviews();
  if (els.videoUploadLimitHint) {
    els.videoUploadLimitHint.textContent = `提示：支持 ${limit} 张参考图、${videoLimit} 个视频（图片+视频不超过 ${Math.min(mediaLimit, limit + videoLimit)} 条）；图片≤${limit}张，单图≤5M，总和≤20M；视频≤${videoLimit}条，分辨率720p-2160px，总大小≤200MB，总时长不超过15秒；音频最多传入1个`;
  }
  if (els.videoResultTitle) {
    els.videoResultTitle.textContent = `${videoModelDisplayLabel()}成片`;
  }
}

function updateVideoPromptCount() {
  if (!els.videoPromptCount) return;
  const length = (els.videoPromptInput?.value || '').length;
  els.videoPromptCount.textContent = `${length}/2000`;
}

function setupVideoPage() {
  renderVideoV1Page();
  refreshVideoEls();
  if (!els.videoPromptInput) return;

  videoState.modelMode = normalizeVideoModelMode(videoState.modelMode || motionConfig.defaultModelMode || 'fast');
  videoState.duration = normalizeVideoDuration(videoState.duration || motionConfig.durationSeconds || 15);
  videoState.aspectRatio = normalizeVideoAspect(videoState.aspectRatio || motionConfig.aspectRatio || '16:9');
  if (els.videoDurationInput) els.videoDurationInput.value = String(videoState.duration);
  syncVideoModelButtons();
  syncVideoAspectButtons();

  els.videoModelModeButtons?.forEach((button) => {
    button.addEventListener('click', () => {
      videoState.modelMode = normalizeVideoModelMode(button.dataset.videoModelMode);
      syncVideoModelButtons();
      renderVideoStyleButtons();
      videoUpdateGenerateState();
    });
  });
  els.videoPromptInput.addEventListener('input', (event) => {
    videoState.prompt = event.target.value;
    updateVideoPromptCount();
    videoUpdateGenerateState();
  });
  els.videoPromptClearBtn?.addEventListener('click', () => {
    videoState.prompt = '';
    if (els.videoPromptInput) els.videoPromptInput.value = '';
    updateVideoPromptCount();
    videoUpdateGenerateState();
  });
  els.videoDurationInput?.addEventListener('change', (event) => {
    videoState.duration = normalizeVideoDuration(event.target.value);
    updateVideoConfigUI();
    videoUpdateGenerateState();
  });
  els.videoReferenceUrlInput?.addEventListener('input', (event) => {
    videoState.referenceUrl = event.target.value.trim();
  });
  els.videoReferenceVideoUrlInput?.addEventListener('input', (event) => {
    videoState.referenceVideoUrl = event.target.value.trim();
  });
  els.videoReferenceAudioUrlInput?.addEventListener('input', (event) => {
    videoState.referenceAudioUrl = event.target.value.trim();
  });
  els.videoGenerateAudioInput?.addEventListener('change', (event) => {
    videoState.generateAudio = !!event.target.checked;
  });
  els.videoAspectRatioButtons?.forEach((button) => {
    button.addEventListener('click', () => {
      videoState.aspectRatio = normalizeVideoAspect(button.dataset.videoAspect);
      syncVideoAspectButtons();
      videoUpdateGenerateState();
    });
  });

  const openPicker = () => els.videoFileInput?.click();
  els.videoUploadZone?.addEventListener('click', openPicker);
  els.videoUploadZone?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPicker();
    }
  });
  els.videoUploadZone?.addEventListener('dragover', (event) => {
    event.preventDefault();
    els.videoUploadZone.classList.add('dragover');
  });
  els.videoUploadZone?.addEventListener('dragleave', () => {
    els.videoUploadZone.classList.remove('dragover');
  });
  els.videoUploadZone?.addEventListener('drop', (event) => {
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
    if (els.videoFileInput) els.videoFileInput.value = '';
    videoState.file = null;
    videoState.files = [];
    videoState.videoFiles = [];
    videoState.audioFiles = [];
    videoState.dataUrl = '';
    clearVideoPreviewUrls();
    els.videoInputPreviewWrap?.classList.add('hidden');
    if (els.videoInputPreview) els.videoInputPreview.removeAttribute('src');
    if (els.videoUploadAdvice) {
      els.videoUploadAdvice.textContent = '';
      els.videoUploadAdvice.classList.remove('warn');
    }
    videoUpdateGenerateState();
  });
  els.videoGenerateBtn?.addEventListener('click', startVideoGeneration);
  els.videoRestartBtn?.addEventListener('click', resetVideoWorkflow);

  renderVideoStyleButtons();
  videoSetProgress(0, '等待输入提示词');
  updateVideoPromptCount();
  videoUpdateGenerateState();
}

function normalizeVideoDuration(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 15;
  return number === 10 ? 10 : 15;
}

function normalizeVideoAspect(value) {
  const clean = String(value || '').trim().replace(/x/i, ':');
  return ['16:9', '9:16'].includes(clean) ? clean : '16:9';
}

function renderVideoStyleButtons() {
  if (els.videoPointHint) {
    if (VIDEO_GENERATION_DISABLED) {
      els.videoPointHint.textContent = '视频功能维护中';
    } else {
      const provider = motionConfig.provider === 'pro666' ? `pro666 · ${videoModelDisplayLabel()}` : videoModelDisplayLabel();
      els.videoPointHint.textContent = `${provider} · ${motionConfig.pointCost || 200} 灵感值`;
    }
  }
}

function clearVideoPreviewUrls() {
  if (videoPreviewSortable) {
    try { videoPreviewSortable.destroy(); } catch {}
    videoPreviewSortable = null;
  }
  (videoState.previewUrls || []).forEach((url) => {
    try { URL.revokeObjectURL(url); } catch {}
  });
  videoState.previewUrls = [];
  if (els.videoInputPreviewList) els.videoInputPreviewList.innerHTML = '';
}

function videoReferenceCounts() {
  return {
    images: (videoState.files || []).length,
    videos: (videoState.videoFiles || []).length,
    audios: (videoState.audioFiles || []).length,
  };
}

function videoReferenceTotalCount() {
  const counts = videoReferenceCounts();
  return counts.images + counts.videos + counts.audios;
}

function videoImageVideoCount() {
  const counts = videoReferenceCounts();
  return counts.images + counts.videos;
}

function videoFileKind(file) {
  const type = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (/\.(mp4|mov|webm|m4v|avi)$/i.test(name)) return 'video';
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(name)) return 'audio';
  return 'image';
}

function formatByteSize(bytes = 0) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)}MB`;
  if (value >= 1024) return `${Math.round(value / 1024)}KB`;
  return `${value}B`;
}

function readVideoDuration(file) {
  return new Promise((resolve) => {
    if (!file) {
      resolve(0);
      return;
    }
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try { URL.revokeObjectURL(url); } catch {}
      resolve(Number.isFinite(value) ? value : 0);
    };
    const timer = window.setTimeout(() => finish(0), 4000);
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      window.clearTimeout(timer);
      finish(Number(video.duration || 0));
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      finish(0);
    };
    video.src = url;
  });
}

async function totalVideoDuration(files = []) {
  const durations = await Promise.all((files || []).map((file) => readVideoDuration(file)));
  return durations.reduce((sum, value) => sum + Number(value || 0), 0);
}

function videoReferenceStatusText() {
  const counts = videoReferenceCounts();
  return [
    counts.images ? `${counts.images} 张图` : '',
    counts.videos ? `${counts.videos} 个视频` : '',
    counts.audios ? `${counts.audios} 个音频` : '',
  ].filter(Boolean).join('、') || '未添加参考素材';
}

function trimVideoReferencesToCurrentMode() {
  const imageLimit = videoReferenceLimit();
  const videoLimit = videoReferenceVideoLimit();
  const audioLimit = videoReferenceAudioLimit();
  const mediaLimit = videoReferenceMediaLimit();
  videoState.videoFiles = (videoState.videoFiles || []).slice(0, videoLimit);
  videoState.audioFiles = (videoState.audioFiles || []).slice(0, audioLimit);
  const usedMediaSlots = (videoState.videoFiles || []).length + (videoState.audioFiles || []).length;
  const remainingImageSlots = Math.max(0, mediaLimit - usedMediaSlots);
  videoState.files = (videoState.files || []).slice(0, Math.min(imageLimit, remainingImageSlots));
  videoState.file = videoState.files[0] || null;
}

function renderVideoInputPreviews() {
  clearVideoPreviewUrls();
  if (!els.videoInputPreviewList) return;
  const items = [
    ...(videoState.files || []).map((file) => ({ kind: 'image', file })),
    ...(videoState.videoFiles || []).map((file) => ({ kind: 'video', file })),
    ...(videoState.audioFiles || []).map((file) => ({ kind: 'audio', file })),
  ];
  if (!items.length) {
    els.videoInputPreviewWrap?.classList.add('hidden');
    return;
  }
  els.videoInputPreviewWrap?.classList.remove('hidden');
  els.videoInputPreviewList.innerHTML = items.map((item, index) => {
    const file = item.file;
    const label = item.kind === 'image' ? '图片' : (item.kind === 'video' ? '视频' : '音频');
    if (item.kind === 'image') {
      const url = URL.createObjectURL(file);
      videoState.previewUrls.push(url);
      return `
        <div class="video-input-preview-item">
          <img src="${url}" alt="参考图 ${index + 1}" />
          <span>${index + 1}. ${escapeHtml(file.name || '参考图')}</span>
          <small>${label}</small>
        </div>
      `;
    }
    return `
      <div class="video-input-preview-item video-input-preview-item--file">
        <b>${label}</b>
        <span>${index + 1}. ${escapeHtml(file.name || label)}</span>
        <small>${formatByteSize(file.size || 0)}</small>
      </div>
    `;
  }).join('');
}

function enableVideoReferenceSorting() {}

async function handleVideoFiles(files) {
  const imageLimit = videoReferenceLimit();
  const videoLimit = videoReferenceVideoLimit();
  const audioLimit = videoReferenceAudioLimit();
  const mediaLimit = videoReferenceMediaLimit();
  const rawFiles = Array.from(files || []).filter(Boolean);
  if (!rawFiles.length) return;
  const nextImages = [...(videoState.files || [])];
  const nextVideos = [...(videoState.videoFiles || [])];
  const nextAudios = [...(videoState.audioFiles || [])];
  const skipped = [];
  for (const rawFile of rawFiles) {
    const kind = videoFileKind(rawFile);
    if (kind === 'image') {
      const usedSlots = nextImages.length + nextVideos.length + nextAudios.length;
      if (nextImages.length >= imageLimit || usedSlots >= mediaLimit) {
        skipped.push(`参考素材总数最多 ${mediaLimit} 个，图片最多 ${imageLimit} 张`);
        continue;
      }
      const imageSingleLimitMb = 20;
      if (rawFile.size > imageSingleLimitMb * 1024 * 1024) {
        skipped.push(`${rawFile.name || '图片'} 超过 ${imageSingleLimitMb}M`);
        continue;
      }
      nextImages.push(rawFile);
      continue;
    }
    if (kind === 'video') {
      const usedSlots = nextImages.length + nextVideos.length + nextAudios.length;
      if (nextVideos.length >= videoLimit || usedSlots >= mediaLimit) {
        skipped.push(`参考素材总数最多 ${mediaLimit} 个，视频最多 ${videoLimit} 个`);
        continue;
      }
      if (rawFile.size > 100 * 1024 * 1024) {
        skipped.push(`${rawFile.name || '视频'} 超过 100M`);
        continue;
      }
      nextVideos.push(rawFile);
      continue;
    }
    const usedSlots = nextImages.length + nextVideos.length + nextAudios.length;
    if (nextAudios.length >= audioLimit || usedSlots >= mediaLimit) {
      skipped.push(`参考素材总数最多 ${mediaLimit} 个，音频最多 ${audioLimit} 个`);
      continue;
    }
    if (rawFile.size > 50 * 1024 * 1024) {
      skipped.push(`${rawFile.name || '音频'} 超过 50M`);
      continue;
    }
    nextAudios.push(rawFile);
  }
  const imageTotalSize = nextImages.reduce((sum, file) => sum + Number(file.size || 0), 0);
  const videoTotalSize = nextVideos.reduce((sum, file) => sum + Number(file.size || 0), 0);
  if (imageTotalSize > 80 * 1024 * 1024) {
    alert('参考图片总大小不能超过 80M。');
    return;
  }
  if (videoTotalSize > 300 * 1024 * 1024) {
    alert('参考视频总大小不能超过 300M。');
    return;
  }
  const videoDuration = await totalVideoDuration(nextVideos);
  if (videoDuration > 15.5) {
    alert('参考视频总时长不能超过 15 秒。');
    return;
  }
  videoState.files = nextImages;
  videoState.videoFiles = nextVideos;
  videoState.audioFiles = nextAudios;
  videoState.file = nextImages[0] || null;
  const dataUrl = nextImages[0] ? await readFileAsDataUrl(nextImages[0]).catch(() => '') : '';
  videoState.dataUrl = dataUrl;
  if (els.videoInputPreview) {
    if (dataUrl) els.videoInputPreview.src = dataUrl;
    else els.videoInputPreview.removeAttribute('src');
  }
  renderVideoInputPreviews();
  if (els.videoUploadAdvice) {
    els.videoUploadAdvice.textContent = skipped.length
      ? `已添加 ${videoReferenceStatusText()}；${[...new Set(skipped)].slice(0, 2).join('，')}`
      : `已添加 ${videoReferenceStatusText()}`;
    els.videoUploadAdvice.classList.toggle('warn', skipped.length > 0);
  }
  if (els.videoJobStatusText) {
    els.videoJobStatusText.textContent = videoState.prompt.trim()
      ? `已添加 ${videoReferenceStatusText()}，可以生成`
      : `已添加 ${videoReferenceStatusText()}，等待提示词`;
  }
  videoUpdateGenerateState();
}

function videoUpdateGenerateState() {
  if (!els.videoGenerateBtn) return;
  if (VIDEO_GENERATION_DISABLED) {
    els.videoGenerateBtn.disabled = true;
    els.videoGenerateBtn.textContent = VIDEO_UPGRADE_MESSAGE;
    return;
  }
  const prompt = (els.videoPromptInput?.value || videoState.prompt || '').trim();
  const ready = !!prompt && !videoState.generating;
  els.videoGenerateBtn.disabled = !ready;
  const duration = normalizeVideoDuration(videoState.duration || els.videoDurationInput?.value || motionConfig.durationSeconds || 15);
  els.videoGenerateBtn.textContent = videoState.generating
    ? '生成中...'
    : `开始生成 ${duration} 秒${videoModelDisplayLabel()}视频（${motionConfig.pointCost || 200} 灵感值）`;
}

function resetVideoWorkflow() {
  if (videoState.pollTimer) {
    clearTimeout(videoState.pollTimer);
    videoState.pollTimer = null;
  }
  videoState.file = null;
  videoState.files = [];
  videoState.videoFiles = [];
  videoState.audioFiles = [];
  videoState.dataUrl = '';
  videoState.previewUrls = [];
  videoState.jobId = null;
  videoState.generating = false;
  videoState.progress = 0;
  videoState.prompt = '';
  videoState.referenceUrl = '';
  videoState.referenceVideoUrl = '';
  videoState.referenceAudioUrl = '';
  videoState.generateAudio = false;
  videoState.duration = normalizeVideoDuration(motionConfig.durationSeconds || 15);
  videoState.aspectRatio = normalizeVideoAspect(motionConfig.aspectRatio || '16:9');
  clearVideoPreviewUrls();
  if (els.videoPromptInput) els.videoPromptInput.value = '';
  updateVideoPromptCount();
  if (els.videoReferenceUrlInput) els.videoReferenceUrlInput.value = '';
  if (els.videoReferenceVideoUrlInput) els.videoReferenceVideoUrlInput.value = '';
  if (els.videoReferenceAudioUrlInput) els.videoReferenceAudioUrlInput.value = '';
  if (els.videoGenerateAudioInput) els.videoGenerateAudioInput.checked = false;
  if (els.videoDurationInput) els.videoDurationInput.value = String(videoState.duration);
  syncVideoModelButtons();
  syncVideoAspectButtons();
  if (els.videoFileInput) els.videoFileInput.value = '';
  els.videoUploadZone?.classList.remove('hidden');
  els.videoInputPreviewWrap?.classList.add('hidden');
  if (els.videoInputPreview) els.videoInputPreview.removeAttribute('src');
  if (els.videoUploadAdvice) {
    els.videoUploadAdvice.textContent = '';
    els.videoUploadAdvice.classList.remove('warn');
  }
  videoSetProgress(0, '等待输入提示词');
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
  renderVideoStyleButtons();
  videoUpdateGenerateState();
}

async function startVideoGeneration() {
  if (VIDEO_GENERATION_DISABLED) {
    videoSetProgress(0, VIDEO_UPGRADE_DETAIL);
    videoAppendLog('[notice] 视频功能维护中，暂时无法提交任务');
    alert(VIDEO_UPGRADE_DETAIL);
    return;
  }
  const prompt = (els.videoPromptInput?.value || videoState.prompt || '').trim();
  if (!prompt || videoState.generating) return;
  if (!accessGranted) { showAccessGate('请先输入访问码'); return; }
  if (accountRequired && !currentUser) {
    showAccessGate('请先登录账号后使用视频功能。');
    return;
  }
  if (accountRequired && !canUseMotionFeatures(currentUser)) {
    alert(motionAccessMessage());
    showRechargeDialog();
    return;
  }
  if (accountRequired && (!currentUser || Number(currentUser.points || 0) < (motionConfig.pointCost || 200))) {
    alert(`需要至少 ${motionConfig.pointCost || 200} 灵感值才能生成视频，当前余额不足。`);
    return;
  }

  videoState.prompt = prompt;
  videoState.modelMode = normalizeVideoModelMode(els.videoModelModeInput?.value || videoState.modelMode || motionConfig.defaultModelMode || 'fast');
  videoState.duration = normalizeVideoDuration(els.videoDurationInput?.value || videoState.duration || 15);
  videoState.aspectRatio = normalizeVideoAspect(els.videoAspectRatioInput?.value || videoState.aspectRatio || '16:9');
  videoState.referenceUrl = (els.videoReferenceUrlInput?.value || '').trim();
  videoState.referenceVideoUrl = (els.videoReferenceVideoUrlInput?.value || '').trim();
  videoState.referenceAudioUrl = (els.videoReferenceAudioUrlInput?.value || '').trim();
  videoState.generateAudio = false;
  const uploadLimit = videoReferenceLimit();
  const uploadedFiles = (videoState.files || []).slice(0, uploadLimit);
  const uploadedVideoFiles = (videoState.videoFiles || []).slice(0, videoReferenceVideoLimit());
  const uploadedAudioFiles = (videoState.audioFiles || []).slice(0, videoReferenceAudioLimit());

  videoSetGenerating(true);
  videoSetProgress(8, `正在创建${videoModelDisplayLabel()}视频任务`);
  videoRenderLogs([
    `[mode] ${videoState.modelMode}`,
    `[input] duration=${videoState.duration}s aspect_ratio=${videoState.aspectRatio}`,
    uploadedFiles.length ? `[input] uploaded reference images=${uploadedFiles.length}` : (!uploadedVideoFiles.length && !uploadedAudioFiles.length && !videoState.referenceUrl ? '[input] text-to-video' : ''),
    uploadedVideoFiles.length ? `[input] uploaded reference videos=${uploadedVideoFiles.length}` : '',
    uploadedAudioFiles.length ? `[input] uploaded reference audios=${uploadedAudioFiles.length}` : '',
    videoState.generateAudio ? '[option] generate_audio=true' : '',
  ]);
  if (els.videoResultPanel) els.videoResultPanel.classList.add('hidden');

  const formData = new FormData();
  formData.append('prompt', prompt);
  formData.append('model_mode', videoState.modelMode);
  formData.append('duration', String(videoState.duration));
  formData.append('aspect_ratio', videoState.aspectRatio);
  if (videoState.referenceUrl) formData.append('image_url', videoState.referenceUrl);
  if (videoState.referenceVideoUrl) formData.append('video_urls', videoState.referenceVideoUrl);
  if (videoState.referenceAudioUrl) formData.append('audio_urls', videoState.referenceAudioUrl);
  if (videoState.generateAudio) formData.append('generate_audio', 'true');
  uploadedFiles.forEach((file, index) => {
    formData.append('images', file, file.name || `video-v1-reference-${index + 1}.jpg`);
  });
  uploadedVideoFiles.forEach((file, index) => {
    formData.append('videos', file, file.name || `video-reference-${index + 1}.mp4`);
  });
  uploadedAudioFiles.forEach((file, index) => {
    formData.append('audios', file, file.name || `audio-reference-${index + 1}.mp3`);
  });
  if (currentPartnerSlug()) formData.append('partner', currentPartnerSlug());

  try {
    const response = await fetch(apiUrl('/api/video-v1/jobs'), { method: 'POST', body: formData });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    if (data.user) { currentUser = data.user; updateAccountUI(); }
    videoState.jobId = data.id;
    videoSetProgress(14, `任务已创建（id=${data.id}），等待生成`);
    videoAppendLog(`[queue] job id=${data.id}`);
    pollVideoJob(data.id);
  } catch (error) {
    const message = (typeof cleanErrorMessage === 'function') ? cleanErrorMessage(error.message) : error.message;
    videoSetGenerating(false);
    videoSetProgress(0, `创建${videoModelDisplayLabel()}视频任务失败：${message}`);
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
    const cacheBustedUrl = videoUrl + (videoUrl.includes('?') ? '&' : '?') + 't=' + Date.now();
    els.videoResultVideo.src = cacheBustedUrl;
    if (posterUrl) els.videoResultVideo.poster = posterUrl;
    else els.videoResultVideo.removeAttribute('poster');
    try { els.videoResultVideo.load(); } catch {}
    addVideoFullscreenButton(els.videoResultVideo.closest('.motion-video-wrap'), els.videoResultVideo, cacheBustedUrl, 'wedscene-video-v1.mp4');
  }
  if (els.videoPreviewBtn) {
    const previewHref = (els.videoResultVideo?.currentSrc || els.videoResultVideo?.src || videoUrl);
    els.videoPreviewBtn.classList.remove('hidden');
    els.videoPreviewBtn.onclick = (event) => {
      event.preventDefault();
      openVideoLightbox(els.videoResultVideo, previewHref, 'wedscene-video-v1.mp4');
    };
  }
  if (els.videoDownloadBtn) {
    const downloadHref = result.videoDownloadUrl || result.resource?.videoDownloadUrl || videoUrl;
    els.videoDownloadBtn.href = downloadHref;
    els.videoDownloadBtn.download = 'wedscene-video-v1.mp4';
    els.videoDownloadBtn.textContent = '下载';
    els.videoDownloadBtn.classList.remove('hidden');
    els.videoDownloadBtn.onclick = (event) => {
      event.preventDefault();
      saveAssetToDevice(videoUrl, 'wedscene-video-v1.mp4', 'video', { downloadUrl: downloadHref });
    };
  }
  if (els.videoResultMeta) {
    els.videoResultMeta.textContent = [
      result.motionStyleLabel || 'video-v1',
      result.durationSeconds ? `${result.durationSeconds}s` : `${videoState.duration || 15}s`,
      result.aspectRatio || videoState.aspectRatio || '',
    ].filter(Boolean).join(' · ');
  }
  els.videoResultPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
    card.className = 'video-v1-history-card';
    const wrap = document.createElement('div');
    wrap.className = 'video-history-media motion-video-wrap';
    const video = document.createElement('video');
    video.src = resource.videoUrl;
    video.controls = true;
    video.preload = 'metadata';
    video.playsInline = true;
    if (resource.motionPosterUrl) video.poster = resource.motionPosterUrl;
    wrap.appendChild(video);
    addVideoFullscreenButton(wrap, video, resource.videoUrl, 'wedscene-video-v1.mp4');

    const meta = document.createElement('div');
    meta.className = 'video-v1-history-meta';
    meta.textContent = [
      resource.motionStyleLabel || 'video-v1',
      resource.durationSeconds ? `${resource.durationSeconds}s` : '',
      formatResourceDate(resource.createdAt),
    ].filter(Boolean).join(' · ');

    const actions = document.createElement('div');
    actions.className = 'video-v1-history-actions';
    const dlBtn = document.createElement('a');
    dlBtn.href = resource.videoDownloadUrl || resource.videoUrl;
    dlBtn.download = 'wedscene-video-v1.mp4';
    dlBtn.className = 'btn-ghost px-3 py-1.5 rounded-full text-xs';
    dlBtn.textContent = '下载';
    dlBtn.addEventListener('click', (event) => {
      event.preventDefault();
      saveAssetToDevice(resource.videoUrl || resource.videoDownloadUrl, 'wedscene-video-v1.mp4', 'video', { downloadUrl: resource.videoDownloadUrl });
    });
    actions.appendChild(dlBtn);

    const resourceId = resource.id || resource.resourceId || '';
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn-ghost px-3 py-1.5 rounded-full text-xs text-red-500 hover:text-red-600';
    delBtn.textContent = '删除';
    if (resourceId) delBtn.dataset.resourceId = resourceId;
    delBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!resourceId) {
        window.alert('该视频缺少资源 id，无法删除。');
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
    if (pageFromHash() === 'geo') loadGeoCertification(true);
  }
}());

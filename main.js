'use strict';
const { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

// 读取素材清单（renderer/assets-manifest.js），拿到全部动画名作为「待机姿态」的合法候选，
// 避免把可选动作写死导致设置里只能选寥寥几个。smoke 是纯过渡特效，排除。
function loadManifestAnimations() {
  try {
    const p = path.join(__dirname, 'renderer', 'assets-manifest.js');
    const txt = fs.readFileSync(p, 'utf8');
    const m = txt.match(/ASSET_MANIFEST\s*=\s*(\{[\s\S]*\})\s*;\s*$/);
    if (m) {
      const obj = JSON.parse(m[1]);
      const anims = (obj && obj.animations) || {};
      const names = Object.keys(anims).filter((n) => n !== 'smoke');
      return { anims: anims, names: names };
    }
  } catch (e) {
    console.error('[idle] 读取素材清单失败，回退到内置待机姿态列表', e);
  }
  return null;
}
const _MANIFEST = loadManifestAnimations();
const MANIFEST_ANIMS = (_MANIFEST && _MANIFEST.anims) || {};
const IDLE_VALID_NAMES = (_MANIFEST && _MANIFEST.names) || ['standing_wiggle', 'typing_left', 'sitting_read', 'lying_read'];
// 动作中文名映射（与渲染端 window.POSE_LABELS 同源，单文件维护）
const POSE_LABELS = require('./renderer/js/pose-labels.js');

const isPackaged = app.isPackaged;
const MATERIAL_DIR = isPackaged
  ? path.join(process.resourcesPath, 'Material')
  : path.join(__dirname, '..', 'Material');

const BASE_SIZE = 360; // 逻辑画布尺寸（窗口按 scale 缩放）

let SETTINGS_PATH = null;
function settingsPath() {
  if (!SETTINGS_PATH) SETTINGS_PATH = path.join(app.getPath('userData'), 'yuanyuan-settings.json');
  return SETTINGS_PATH;
}

const defaultSettings = {
  scale: 0.8,
  fps: 24,
  speedMul: 1.0,
  sound: false,
  volume: 0.6,
  eyeFollow: true,          // 鼠标跟随（仅"坐着敲键盘"待机姿态生效）：用眼神帧当身体，视角跟鼠标
  keyboardFollow: true,      // 键盘跟随：打字姿态下先静止，检测到敲键盘才播放打字动画
  eyeSensitivity: 0.6,
  clickThrough: false,
  autoHideFullscreen: true,
  idleToSleep: 5 * 60 * 1000,
  roamEnabled: true,
  roamChance: 0.3,
  startOnBoot: false,
    petVisible: true,
    mode: 'idle',              // 行为模式：'follow'=只跟随键鼠；'idle'=按所选待机姿态随机播放
    // 待机姿态：多选数组，勾多个则每次回待机随机挑一个、并每隔一阵自动换一个
    idlePoses: ['standing_wiggle'],
  timeGreetings: true,      // 时段问候：开机/跨时段按系统时间说早安、午安、晚安等
  afkEnabled: true,         // 离开感知：你长时间不理她 → 说"你走啦"；光标再靠近 → "你回来啦"
  clickAnnoy: true,         // 连续点闹脾气：短时间狂点她 → 轻/重闹脾气（重度会噘嘴生气）
  workReminder: true,       // 用太久提醒休息：连续用电脑超 45 分钟 → 劝你起来活动
  holidayEnabled: true,     // 节日彩蛋：元旦/情人节/儿童节/圣诞等按系统日期说彩蛋
  batteryReminder: true,    // 电量低提醒：电量 <20% 且未充电 → 提醒插电
  netStatus: true,          // 网络掉线提醒：断网/恢复 → 说对应台词
  systemEvents: true,       // 系统锁屏/休眠/唤醒：你锁屏她也说晚安躺下，解锁再醒来打招呼
  stareReminder: true,      // 盯同一窗口太久：连续盯着同一个应用超 25 分钟 → 劝你换换脑子
  stareLimit: 25 * 60 * 1000,
  eyeCare: true,            // 护眼 20-20-20：每 20 分钟提醒看远处放松眼睛
  eyeCareInterval: 20,      // 分钟
  anniversaryDate: '',     // 纪念日（"MM-DD"，每年重复），留空=不提醒
  moodEnabled: true,        // 心情系统：被冷落→寂寞、被狂点→烦，影响待机微表情与主动台词
  mood: 0,                  // 好感度初始分（[-100,100]，>=35开心 / <=-50烦 / <=-15寂寞）
  dragThrow: true,          // 拖拽物理：快速甩动松手→抛物线飞出去，再抓住即"接住"
  // 动作偏好：每个触发条件可多选动画，触发时随机播其中一个。
  // startupActions：开机动画候选（空数组=不播开场）。默认 ['running_happy']（欢快跑出来打招呼）。
  // clickActions：单击动作候选（空数组=单击无反应）。默认 ['heart','covering_face']（随机比心/捂脸）。
  // multiClickActions：多次点击动作候选。默认 ['sitting_broom']（骑扫帚飞起并循环）。
  startupActions: ['running_happy'],
  clickActions: ['heart', 'covering_face'],
  multiClickActions: ['sitting_broom'],
  posX: null,               // 上次退出时的位置（DIP）
  posY: null,
  // 提醒功能（生日 / 生理期 / 记事本）。
  // 生日：calendar 选 'solar'（阳历）或 'lunar'（阴历）。阳历输入且 remindBoth=true 时，额外在「阴历等价日」再提醒一次；
  //       year 可选（仅用于「今年 X 岁」展示，0=不填）。阴历由 renderer/js/lunar.js 每年换算对应阳历日。
  // 生理期：days 为「每月要提醒的日号」数组（1-31，可多选），替换旧的单日+提前天数模型。
  // 默认生日：阴历七月初一（出生年 2006 对应阳历 2006-07-15），每年按阴历七月初一触发
  reminders: {
    birthday: { enabled: true, calendar: 'lunar', month: 7, day: 1, isLeap: false, year: 2006, name: '宝贝', remindBoth: false },
    period: { enabled: true, days: [14, 15, 16, 17, 18], note: '' },
    events: [],
  },
};

let settings = Object.assign({}, defaultSettings);

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    settings = Object.assign({}, defaultSettings, raw);
  } catch (e) { /* 用默认 */ }
  // 数值字段做一次强制归一，避免面板里 <select> 存进来的字符串污染后续计算
  settings.scale = clampNum(settings.scale, 0.4, 2, 1);
  settings.speedMul = clampNum(settings.speedMul, 0.5, 2, 1);
  settings.eyeSensitivity = clampNum(settings.eyeSensitivity, 0, 1, 0.6);
  settings.roamChance = clampNum(settings.roamChance, 0, 1, 0.3);
  settings.idleToSleep = clampNum(settings.idleToSleep, 10000, 3600000, 5 * 60 * 1000);
  // 待机姿态多选：兼容旧版单值 idlePose，统一转成数组（至少留一个）
  settings.idlePoses = normalizeIdlePoses(settings.idlePoses, settings.idlePose);
  delete settings.idlePose; // 旧字段废弃，不再使用
  // 提醒设置做深合并，保证老设置文件缺字段时补齐默认（避免读取 undefined 报错）
  settings.reminders = normalizeReminders(settings.reminders);
  // 动作偏好三个键做合法性校验，避免面板传来非法值 / 旧设置缺字段导致行为异常
  settings = normalizeActions(settings);
}

// 把任意（可能残缺/旧版）的 reminders 对象补全成完整新结构。
// 兼容迁移：旧生日 { solarMonth, solarDay, year } → { calendar:'solar', month, day }；
//          旧生理期 { dayOfMonth, leadDays } → { days:[dayOfMonth] }（leadDays 废弃）。
function sanitizeDays(arr) {
  var seen = {}; var out = [];
  (Array.isArray(arr) ? arr : []).forEach(function (x) {
    var n = parseInt(x, 10);
    if (isFinite(n) && n >= 1 && n <= 31 && !seen[n]) { seen[n] = 1; out.push(n); }
  });
  out.sort(function (a, b) { return a - b; });
  return out;
}

// 待机姿态多选：把设置归一成合法姿态名的数组（至少留一个）。
// legacy 兼容旧版单值 idlePose 字符串（升级时自动转成数组）。
function normalizeIdlePoses(raw, legacy) {
  const VALID = IDLE_VALID_NAMES;
  let list;
  if (Array.isArray(raw)) {
    list = raw.filter((n) => VALID.indexOf(n) >= 0);
  } else if (typeof raw === 'string' && VALID.indexOf(raw) >= 0) {
    list = [raw];
  } else if (typeof legacy === 'string' && VALID.indexOf(legacy) >= 0) {
    list = [legacy];
  } else {
    list = [];
  }
  if (list.length === 0) list = ['standing_wiggle'];
  return list;
}

function normalizeReminders(raw) {
  raw = raw || {};
  var d = {
    birthday: { enabled: true, calendar: 'lunar', month: 7, day: 1, isLeap: false, year: 0, name: '宝贝' },
    period: { enabled: true, days: [], note: '' },
    events: [],
  };
  var bd = raw.birthday || {};
  var p = raw.period || {};

  // ---- 生日 ----
  var calendar = bd.calendar === 'lunar' ? 'lunar' : 'solar';
  var bdMonth, bdDay, bdIsLeap = false, bdYear = 0;
  if (bd.calendar) {
    bdMonth = clampInt(bd.month, 1, 12, 7);
    bdDay = clampInt(bd.day, 1, 31, 15);
    bdIsLeap = !!bd.isLeap;
    bdYear = clampInt(bd.year, 1900, 2100, 0);
  } else if (bd.solarMonth != null || bd.solarDay != null) {
    // 旧结构迁移
    calendar = 'solar';
    bdMonth = clampInt(bd.solarMonth, 1, 12, 7);
    bdDay = clampInt(bd.solarDay, 1, 31, 15);
    bdYear = clampInt(bd.year, 1900, 2100, 0);
  } else {
    bdMonth = d.birthday.month; bdDay = d.birthday.day;
  }

  // 迁移：生日若仍是「出厂默认」（阳历 07-15 / 出生年 2006 / 同时提醒阴历），统一升级为阴历七月初一。
  // 这样即满足"每年阴历七月初一"的需求；用户若自定义过（改了日期/年份/关掉 remindBoth），则不会命中，保持原样。
  if (calendar === 'solar' && bdMonth === 7 && bdDay === 15 && bdYear === 2006 && bd.remindBoth !== false && bd.enabled !== false) {
    calendar = 'lunar'; bdMonth = 7; bdDay = 1; bdIsLeap = false;
  }

  // ---- 生理期 ----
  var period;
  if (p.days && Array.isArray(p.days)) {
    period = { enabled: p.enabled !== false, days: sanitizeDays(p.days), note: typeof p.note === 'string' ? p.note : '' };
  } else if (p.dayOfMonth != null) {
    // 旧结构迁移
    period = { enabled: p.enabled !== false, days: [clampInt(p.dayOfMonth, 1, 31, 18)], note: typeof p.note === 'string' ? p.note : '' };
  } else {
    period = { enabled: d.period.enabled, days: d.period.days.slice(), note: '' };
  }

  return {
    birthday: {
      enabled: bd.enabled !== false,
      calendar: calendar, month: bdMonth, day: bdDay, isLeap: bdIsLeap, year: bdYear,
      remindBoth: bd.remindBoth !== false,
      name: typeof bd.name === 'string' ? bd.name : '宝贝',
    },
    period: period,
    events: Array.isArray(raw.events) ? raw.events.map(function (e) {
      return {
        id: e.id || ('ev' + Date.now() + Math.floor(Math.random() * 1000)),
        title: typeof e.title === 'string' ? e.title : '',
        date: typeof e.date === 'string' ? e.date : '',
        time: typeof e.time === 'string' ? e.time : '',
        note: typeof e.note === 'string' ? e.note : '',
        done: !!e.done,
      };
    }) : [],
  };
}

function clampInt(v, min, max, dft) {
  var n = parseInt(v, 10);
  if (!isFinite(n)) return dft;
  return Math.min(max, Math.max(min, n));
}

// 把 patch.reminders 深合并进当前 reminders（子对象逐字段合并，events 数组以 patch 为准）
function mergeReminders(base, patch) {
  base = base || {};
  patch = patch || {};
  return {
    birthday: Object.assign({}, base.birthday || {}, patch.birthday || {}),
    period: Object.assign({}, base.period || {}, patch.period || {}),
    events: (patch.events && Array.isArray(patch.events)) ? patch.events : (base.events || []),
  };
}

function clampNum(v, min, max, dft) {
  const n = Number(v);
  if (!isFinite(n)) return dft;
  return Math.min(max, Math.max(min, n));
}

// 所有可分配给触发条件的动画名（与渲染端 YY.PICKABLE_ACTIONS 同源，用于主进程侧校验）
const VALID_ACTIONS = [
  'heart', 'covering_face', 'pout_angry', 'spinning', 'running_happy', 'sitting_broom',
  'walk_slow_left', 'sleep', 'standing_wiggle', 'typing_left', 'sitting_read', 'lying_read',
];
const VALID_ACTION_SET = new Set(VALID_ACTIONS);

// 校验「动作偏好」三个键：现在是数组（多选）。兼容旧版单值字符串，自动迁移成数组。
// 数组里的每个元素必须是真实存在的动画名，否则剔除；空数组表示该触发条件「无动作」。
function normalizeActions(s) {
  s = s || {};
  // 旧版单值键迁移（startupAction/clickAction/multiClickAction → 对应 *Actions 数组）。
  // 仅当新数组键尚不存在时才迁移，避免面板发来的 *Actions 被旧键覆盖。
  if (s.startupAction !== undefined && !Array.isArray(s.startupActions)) {
    s.startupActions = (s.startupAction === 'none' || s.startupAction === 'greet')
      ? (s.startupAction === 'greet' ? ['running_happy'] : [])
      : [s.startupAction];
    delete s.startupAction;
  }
  if (s.clickAction !== undefined && !Array.isArray(s.clickActions)) {
    s.clickActions = (s.clickAction === 'none') ? [] : [s.clickAction];
    delete s.clickAction;
  }
  if (s.multiClickAction !== undefined && !Array.isArray(s.multiClickActions)) {
    s.multiClickActions = (s.multiClickAction === 'fly') ? ['sitting_broom'] : [s.multiClickAction];
    delete s.multiClickAction;
  }
  s.startupActions = toActionArray(s.startupActions, ['running_happy']);
  s.clickActions = toActionArray(s.clickActions, ['heart', 'covering_face']);
  s.multiClickActions = toActionArray(s.multiClickActions, ['sitting_broom']);
  return s;
}
// 把任意值规整成「合法动画名数组」：
// · 非数组（缺失/非法类型）→ 回退默认；
// · 数组 → 直接返回过滤后的列表，即使为空（空数组 = 用户显式「该触发无动作」，不能回退默认）。
function toActionArray(v, dft) {
  if (!Array.isArray(v)) return dft.slice();
  return v.filter(function (n) { return typeof n === 'string' && VALID_ACTION_SET.has(n); });
}

let persistTimer = null;
function persistSettings(immediate) {
  const write = () => {
    persistTimer = null;
    try { fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2)); } catch (e) {}
  };
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
  if (immediate) write();
  else persistTimer = setTimeout(write, 600); // 拖拽时高频落盘没意义，合并写入
}

// ---------- 窗口 / 几何状态 ----------
let petWindow = null;
let panelWindow = null;
let tray = null;
let manualHidden = false;
let cursorTimer = null;

// 关键：位置与尺寸由主进程自己维护为「权威值」。
// 绝不再用 getBounds() 的返回值反推尺寸——在非 100% 的显示缩放下（125%/150%），
// DIP 与物理像素互转会各自向外取整，getBounds→setBounds 往返一次窗口就可能大 1~2 px；
// 拖拽时每秒几十次往返，窗口就会像被拉伸一样越来越大，且松手后不会恢复。
let petPos = { x: 0, y: 0 };
let petSize = BASE_SIZE;
// 对话气泡带：窗口在「角色正上方」多留出的固定透明高度（DIP）。
// 角色绘制大小/位置完全不变，只是窗口变高一点；气泡落在带里，绝不挡头。
// 比例 = 80 / 360 = 2/9，与渲染层 engine.BUBBLE_BAND 对齐。
function bubbleBand() { return Math.round(petSize * 2 / 9); }
function petHeight() { return petSize + bubbleBand(); }
let dragState = null;
let resizingByUs = false;
let sizeFixTimer = null;
let hitTransparent = false; // 渲染层告知：光标当前落在画布的全透明区域

function displayForPoint(x, y) {
  try { return screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }); }
  catch (e) { return screen.getPrimaryDisplay(); }
}

function petDisplay() {
  return displayForPoint(petPos.x + petSize / 2, petPos.y + petHeight() / 2);
}

// visible：至少要留在 area 内的像素数（等于 min(w,h) 表示完全不许出界）
// w/h 分别为窗口宽、高（本程序窗口是「宽正方形 + 顶部气泡带」的矩形）
function clampRect(x, y, w, h, area, visible) {
  const v = Math.max(24, Math.min(Math.min(w, h), visible == null ? Math.min(w, h) : visible));
  const minX = area.x - (w - v);
  const maxX = area.x + area.width - v;
  const minY = area.y - (h - v);
  const maxY = area.y + area.height - v;
  return {
    x: Math.min(Math.max(x, minX), maxX),
    y: Math.min(Math.max(y, minY), maxY),
  };
}

function applyPetPosition() {
  if (!petWindow || petWindow.isDestroyed()) return;
  // 关键修复：必须连同恒定尺寸一起 setBounds，不能只 setPosition。
  // 在非 100% 显示缩放下，任何一次几何 setter（即便只 setPosition）都会触发
  // DIP↔物理像素的取整重算，Electron 把窗口"撑大"；高频拖拽时累积放大就是
  // 用户看到的"拖着拖着被拉大、松手也不回去"。用 petSize 权威值把它钉死即可。
  petWindow.setBounds({
    x: Math.round(petPos.x),
    y: Math.round(petPos.y),
    width: petSize,
    height: petHeight(),
  });
}

function rememberPos() {
  settings.posX = Math.round(petPos.x);
  settings.posY = Math.round(petPos.y);
  persistSettings();
}

function movePetBy(dx, dy) {
  if (!petWindow || petWindow.isDestroyed() || dragState) return;
  const wa = petDisplay().workArea;
  petPos = clampRect(petPos.x + (Number(dx) || 0), petPos.y + (Number(dy) || 0), petSize, petHeight(), wa, petSize);
  applyPetPosition();
}

function enforcePetSize() {
  if (!petWindow || petWindow.isDestroyed()) return;
  const b = petWindow.getBounds();
  // 容差 1px：DIP 换算本身就可能报出 ±1，不必来回纠正造成抖动
  if (Math.abs(b.width - petSize) <= 1 && Math.abs(b.height - petHeight()) <= 1) return;
  resizingByUs = true;
  try {
    petWindow.setBounds({ x: Math.round(petPos.x), y: Math.round(petPos.y), width: petSize, height: petHeight() });
  } catch (e) {}
  setTimeout(() => { resizingByUs = false; }, 60);
}

function applyScale() {
  if (!petWindow || petWindow.isDestroyed()) return;
  const next = Math.max(120, Math.round(BASE_SIZE * clampNum(settings.scale, 0.4, 2, 1)));
  if (next === petSize) { enforcePetSize(); return; }
  const cx = petPos.x + petSize / 2;
  const cy = petPos.y + petHeight() / 2;
  petSize = next;
  const wa = displayForPoint(cx, cy).workArea;
  petPos = clampRect(cx - petSize / 2, cy - petHeight() / 2, petSize, petHeight(), wa, petSize);
  resizingByUs = true;
  try {
    petWindow.setBounds({ x: Math.round(petPos.x), y: Math.round(petPos.y), width: petSize, height: petHeight() });
  } catch (e) {}
  setTimeout(() => { resizingByUs = false; }, 60);
  rememberPos();
}

function updateMouseIgnore() {
  if (!petWindow || petWindow.isDestroyed()) return;
  let ignore = false;
  let forward = false;
  if (dragState) ignore = false;                       // 拖拽期间必须能收事件
  else if (settings.clickThrough) ignore = true;       // 用户手动开启的全局穿透
  else if (hitTransparent) { ignore = true; forward = true; } // 光标在透明区域：让点击落到桌面
  try {
    if (ignore) petWindow.setIgnoreMouseEvents(true, { forward: forward });
    else petWindow.setIgnoreMouseEvents(false);
  } catch (e) {
    try { petWindow.setIgnoreMouseEvents(ignore); } catch (_) {}
  }
}

function sendToPet(channel, payload) {
  if (!petWindow || petWindow.isDestroyed()) return;
  const wc = petWindow.webContents;
  if (!wc || wc.isDestroyed()) return;
  try { wc.send(channel, payload); } catch (e) {}
}

function sendToPanel(channel, payload) {
  if (!panelWindow || panelWindow.isDestroyed()) return;
  const wc = panelWindow.webContents;
  if (!wc || wc.isDestroyed()) return;
  try { wc.send(channel, payload); } catch (e) {}
}

// ---------- 拖拽（主进程驱动） ----------
// 渲染层只负责告诉主进程「开始 / 结束」，位置一律按光标的绝对屏幕坐标算，
// 不再靠累加 dx/dy，既没有累计误差，也不会因为 IPC 抖动而漂移。
function startDrag() {
  if (!petWindow || petWindow.isDestroyed()) return;
  stopDrag(false);
  const c = screen.getCursorScreenPoint();
  dragState = { offX: c.x - petPos.x, offY: c.y - petPos.y, startedAt: Date.now(), timer: null };
  updateMouseIgnore();
  dragState.timer = setInterval(() => {
    if (!dragState || !petWindow || petWindow.isDestroyed()) { stopDrag(); return; }
    if (Date.now() - dragState.startedAt > 60000) { stopDrag(); sendToPet('drag-abort'); return; }
    const cur = screen.getCursorScreenPoint();
    const disp = displayForPoint(cur.x, cur.y);
    // 拖拽允许压任务栏 / 略微出屏，但至少保留 40% 可见，防止被拖丢
    petPos = clampRect(cur.x - dragState.offX, cur.y - dragState.offY, petSize, petHeight(), disp.bounds, Math.round(Math.min(petSize, petHeight()) * 0.4));
    applyPetPosition();
  }, 16);
}

function stopDrag(persist) {
  if (dragState) {
    clearInterval(dragState.timer);
    dragState = null;
  }
  enforcePetSize(); // 兜底：万一尺寸被外力改过，松手时纠正回来
  updateMouseIgnore();
  if (persist !== false) rememberPos();
}

// ---------- 窗口创建 ----------
function createPetWindow() {
  petSize = Math.max(120, Math.round(BASE_SIZE * settings.scale));
  const wa = screen.getPrimaryDisplay().workArea;
  let x = Number(settings.posX);
  let y = Number(settings.posY);
  if (!isFinite(x) || !isFinite(y)) {
    x = wa.x + wa.width - petSize - 20;
    y = wa.y + wa.height - petHeight() - 20;
  }
  petPos = clampRect(x, y, petSize, petHeight(), displayForPoint(x + petSize / 2, y + petHeight() / 2).workArea, petSize);

  petWindow = new BrowserWindow({
    x: Math.round(petPos.x),
    y: Math.round(petPos.y),
    width: petSize,
    height: petHeight(),
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
      backgroundThrottling: false, // 窗口失焦时也要保持动画流畅
    },
  });

  petWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  petWindow.setAlwaysOnTop(true, 'screen-saver');
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  updateMouseIgnore();
  if (!settings.petVisible) { petWindow.hide(); manualHidden = true; }

  // 任何非我方发起的尺寸变化都拉回来（DPI 切换、外部工具、系统动画都可能触发）
  petWindow.on('will-resize', (e) => { if (!resizingByUs) e.preventDefault(); });
  petWindow.on('resize', () => {
    if (resizingByUs) return;
    clearTimeout(sizeFixTimer);
    sizeFixTimer = setTimeout(enforcePetSize, 120);
  });

  petWindow.on('closed', () => { petWindow = null; });
  // 创建时 OS 对窗口尺寸有一轮独立舍入（可能与 setBounds 不同），展示时纠正回权威尺寸
  petWindow.once('ready-to-show', () => enforcePetSize());
  petWindow.on('blur', () => sendToPet('window-blur'));
  petWindow.on('focus', () => sendToPet('window-focus'));

  // 桌宠平时不开 DevTools，开发期把渲染进程的报错转发到终端，方便排查
  if (!isPackaged) {
    petWindow.webContents.on('console-message', (e, level, message, line, sourceId) => {
      if (level >= 2) console.log(`[renderer] ${message} (${sourceId}:${line})`);
    });
    petWindow.webContents.on('render-process-gone', (e, d) => console.log('[renderer gone]', d));
  }
}

function createPanelWindow() {
  if (panelWindow && !panelWindow.isDestroyed()) {
    if (panelWindow.isMinimized()) panelWindow.restore();
    panelWindow.show();
    panelWindow.focus();
    return;
  }
  panelWindow = new BrowserWindow({
    width: 420,
    height: 660,
    minWidth: 380,
    minHeight: 520,
    title: '园园 · 设置',
    frame: true,
    resizable: true,
    alwaysOnTop: false,
    show: true,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
    },
  });
  panelWindow.setMenuBarVisibility(false);
  panelWindow.loadFile(path.join(__dirname, 'renderer', 'panel.html'));
  panelWindow.on('closed', () => { panelWindow = null; });
}

// ---------- 托盘 ----------
function trayImage() {
  const candidates = [
    path.join(__dirname, 'build', 'icon.ico'),
    path.join(MATERIAL_DIR, 'frames_transparent', 'standing_wiggle', 'frame_0000.png'),
  ];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const img = nativeImage.createFromPath(p);
      if (img.isEmpty()) continue;
      // 原图是 720×720，不缩放会得到一个糊掉/超大的托盘图标
      return img.resize({ width: 16, height: 16, quality: 'best' });
    } catch (e) {}
  }
  return nativeImage.createEmpty();
}

// 所有可被「做个动作」调用的动作（与渲染端 PICKABLE_ACTIONS 同源，覆盖 react/idle/walk/sleep 全部可触发动画）。
// 标签集中维护，与设置面板「可用动作」勾选项一一对应（按 name 匹配）。
// 想加新动作，只在这里加一项 + 素材里放对应动画即可，菜单/设置面板会自动出现。
const ALL_ACTIONS = [
  { name: 'heart', label: '比心' },
  { name: 'covering_face', label: '害羞捂脸' },
  { name: 'pout_angry', label: '嘟嘴生气' },
  { name: 'spinning', label: '开心转圈圈' },
  { name: 'running_happy', label: '欢快地跑' },
  { name: 'sitting_broom', label: '骑扫帚' },
  { name: 'walk_slow_left', label: '去散步' },
  { name: 'sleep', label: '睡觉' },
  { name: 'standing_wiggle', label: '站着摇摆' },
  { name: 'typing_left', label: '坐着敲键盘' },
  { name: 'sitting_read', label: '坐着看书' },
  { name: 'lying_read', label: '趴着看书' },
];
const ALL_ACTION_NAMES = ALL_ACTIONS.map((a) => a.name);
// 默认全部动作都可用（向后兼容：老设置文件没有这个字段时，按全开处理）
defaultSettings.enabledActions = ALL_ACTION_NAMES.slice();

// 根据设置里勾选的「可用动作」过滤出菜单真正要展示的动作项
function enabledActionItems() {
  const enabled = (settings.enabledActions && Array.isArray(settings.enabledActions))
    ? settings.enabledActions : ALL_ACTION_NAMES;
  const set = new Set(enabled);
  const items = ALL_ACTIONS
    .filter((a) => set.has(a.name))
    // 不同动作映射到菜单里最合适的命令：
    // · 骑扫帚是「定格姿势」而非一次性动作，点它与「骑扫帚飞起来」行为一致（都走 fly），避免播一遍又弹回待机；
    // · 散步/睡觉走各自专用命令，行为和顶部「去散步」「睡一会」一致；
    // · 其余（含四个待机姿态）作为一次性动作播一遍后回待机。
    .map((a) => {
      let cmd;
      if (a.name === 'sitting_broom') cmd = 'fly';
      else if (a.name === 'walk_slow_left') cmd = 'walk';
      else if (a.name === 'sleep') cmd = 'sleep';
      else cmd = 'act:' + a.name;
      return { label: a.label, click: () => sendToPet('pet-command', cmd) };
    });
  // 一个都没勾选时，给个禁用占位项，避免子菜单空着点不开
  if (items.length === 0) items.push({ label: '（去设置里勾选动作）', enabled: false });
  return items;
}

// 待机姿态：切换后会一直保持，直到再次更换。
// 全部素材动画都可选（排除 smoke），可循环的待机/散步/睡觉类排在前面，顺序与设置面板一致。
const IDLE_POSES = IDLE_VALID_NAMES.slice().sort(function (a, b) {
  const la = !!(MANIFEST_ANIMS[a] && MANIFEST_ANIMS[a].loop);
  const lb = !!(MANIFEST_ANIMS[b] && MANIFEST_ANIMS[b].loop);
  return (lb ? 1 : 0) - (la ? 1 : 0);
}).map(function (n) { return { label: POSE_LABELS[n] || n, value: n }; });

// 托盘和桌宠右键共用同一套动作项，避免两边菜单内容分叉
function actionMenuTemplate() {
  return [
    { label: '摸摸头', click: () => sendToPet('pet-command', 'react') },
    {
      label: '做个动作',
      submenu: enabledActionItems(),
    },
    { label: '骑扫帚飞起来', click: () => sendToPet('pet-command', 'fly') },
    { type: 'separator' },
    { label: '去散步', click: () => sendToPet('pet-command', 'walk') },
    { label: '睡一会', click: () => sendToPet('pet-command', 'sleep') },
    { label: '叫醒她', click: () => sendToPet('pet-command', 'wake') },
    { label: '回到待机', click: () => sendToPet('pet-command', 'idle') },
    { type: 'separator' },
    {
      label: '待机姿态…',
      click: () => openIdlePosePicker(),
    },
    {
      label: '行为模式',
      submenu: [
        {
          label: '跟随状态（只跟随键鼠）', type: 'checkbox', checked: settings.mode === 'follow',
          click: () => setBehaviorMode('follow'),
        },
        {
          label: '待机状态（播所选姿态）', type: 'checkbox', checked: settings.mode === 'idle',
          click: () => setBehaviorMode('idle'),
        },
      ],
    },
  ];
}

function buildTrayMenu() {
  if (!tray) return;
  const visible = !!(petWindow && !petWindow.isDestroyed() && petWindow.isVisible());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: visible ? '隐藏园园' : '显示园园', click: () => togglePet() },
    { label: '把园园叫回屏幕', click: () => resetPetPosition() },
    { type: 'separator' },
    ...actionMenuTemplate(),
    { type: 'separator' },
    {
      label: '鼠标穿透', type: 'checkbox', checked: !!settings.clickThrough,
      click: (item) => updateSettings({ clickThrough: !!item.checked }),
    },
    {
      label: '开机自启动', type: 'checkbox', checked: !!settings.startOnBoot,
      click: (item) => updateSettings({ startOnBoot: !!item.checked }),
    },
    { label: '打开设置面板', click: () => createPanelWindow() },
    { type: 'separator' },
    { label: '退出园园', click: () => app.quit() },
  ]));
}

// 桌宠右键菜单走原生 Menu.popup：
// 窗口只有 360px 见方，用 HTML 菜单既放不下这么多项，也无法弹出到窗口外；
// 原生菜单没有这个限制，还自带多级子菜单和单选/勾选样式。
function popupPetMenu() {
  if (!petWindow || petWindow.isDestroyed()) return;
  const menu = Menu.buildFromTemplate([
    ...actionMenuTemplate(),
    { type: 'separator' },
    {
      label: '鼠标穿透', type: 'checkbox', checked: !!settings.clickThrough,
      click: (item) => updateSettings({ clickThrough: !!item.checked }),
    },
    {
      label: '开机自启动', type: 'checkbox', checked: !!settings.startOnBoot,
      click: (item) => updateSettings({ startOnBoot: !!item.checked }),
    },
    { label: '打开设置面板', click: () => createPanelWindow() },
    { label: '隐藏园园', click: () => { petWindow.hide(); manualHidden = true; settings.petVisible = false; persistSettings(); buildTrayMenu(); } },
    { type: 'separator' },
    { label: '退出园园', click: () => app.quit() },
  ]);
  try { menu.popup({ window: petWindow }); } catch (e) {}
}

// 行为模式：跟随状态（只跟随键鼠）/ 待机状态（按所选姿态随机播放）。
// 选「跟随状态」会一并开启鼠标/键盘跟随，让"只跟随"立刻生效；渲染端 onSettingsChanged 检测到
// mode 变化会自动回到待机并应用新模式，无需额外发指令。
function setBehaviorMode(m) {
  if (m !== 'follow' && m !== 'idle') return;
  var patch = { mode: m };
  if (m === 'follow') { patch.eyeFollow = true; patch.keyboardFollow = true; }
  updateSettings(patch);
}

// 待机姿态多选：用独立 HTML 浮层窗口代替原生菜单的 checkbox 子菜单。
// 原因：Electron 原生菜单在 Windows 上点任意项（含 checkbox）都会整个关闭，无法连续勾多个；
// 浮层窗口可连续勾选，只有点窗外 / 完成 / Esc 才关。
let idlePickerWin = null;
function openIdlePosePicker() {
  if (idlePickerWin && !idlePickerWin.isDestroyed()) { idlePickerWin.focus(); return; }
  const picker = new BrowserWindow({
    width: 250, height: 430, frame: false, resizable: false,
    transparent: true, alwaysOnTop: true, skipTaskbar: true, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, webSecurity: false,
    },
  });
  picker.loadFile(path.join(__dirname, 'renderer', 'idle-pose-picker.html'));
  picker.webContents.on('did-finish-load', () => {
    picker.webContents.send('idle-picker-init', {
      poses: IDLE_POSES.map((p) => ({ label: p.label, value: p.value })),
      current: (settings.idlePoses || []).slice(),
    });
  });
  picker.once('ready-to-show', () => {
    const b = picker.getBounds();
    const p = screen.getCursorScreenPoint();
    const wa = screen.getPrimaryDisplay().workArea;
    let px = p.x, py = p.y;
    if (px == null || isNaN(px)) px = wa.x + wa.width - b.width - 20;
    if (py == null || isNaN(py)) py = wa.y + wa.height - b.height - 20;
    px = Math.min(Math.max(px, wa.x), wa.x + wa.width - b.width);
    py = Math.min(Math.max(py, wa.y), wa.y + wa.height - b.height);
    picker.setPosition(Math.round(px), Math.round(py));
    picker.show();
  });
  picker.on('closed', () => { idlePickerWin = null; });
  idlePickerWin = picker;
}

function buildTray() {
  tray = new Tray(trayImage());
  tray.setToolTip('园园 · 桌面小魔女');
  buildTrayMenu();
  tray.on('click', () => togglePet());
  tray.on('double-click', () => createPanelWindow());
}

function togglePet() {
  if (!petWindow || petWindow.isDestroyed()) return;
  if (petWindow.isVisible()) { petWindow.hide(); manualHidden = true; settings.petVisible = false; }
  else { petWindow.showInactive(); manualHidden = false; settings.petVisible = true; enforcePetSize(); sendToPet('pet-command', 'fs-exit'); }
  persistSettings();
  buildTrayMenu();
}

function resetPetPosition() {
  if (!petWindow || petWindow.isDestroyed()) return;
  const wa = screen.getPrimaryDisplay().workArea;
  petPos = { x: wa.x + wa.width - petSize - 20, y: wa.y + wa.height - petHeight() - 20 };
  enforcePetSize();
  applyPetPosition();
  if (!petWindow.isVisible()) { petWindow.showInactive(); manualHidden = false; settings.petVisible = true; }
  rememberPos();
  buildTrayMenu();
}

// ---------- 光标轮询（眼睛追踪） ----------
function startCursorPolling() {
  if (cursorTimer) clearInterval(cursorTimer);
  cursorTimer = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) return;
    const p = screen.getCursorScreenPoint();
    sendToPet('cursor', {
      x: p.x, y: p.y,
      pet: { x: Math.round(petPos.x), y: Math.round(petPos.y + bubbleBand()), w: petSize, h: petSize },
      dragging: !!dragState,
    });
  }, 40);
}

// ---------- 全屏应用检测（Windows） ----------
// 旧实现每 2.5 秒 spawn 一个 PowerShell（成本极高），而且脚本里用了
// System.Windows.Forms 却没有加载程序集，实际永远抛错 → 功能从未生效。
// 现在改成常驻一个 PowerShell 循环，主进程只读它的输出。
let fsProc = null;
let fsScriptPath = null;
let lastFullscreen = false;

function fullscreenScript() {
  return [
    '$ErrorActionPreference = "Stop"',
    'Add-Type @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public struct RECT { public int L, T, R, B; }',
    'public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }',
    'public class W32 {',
    '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
    '  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);',
    '  [DllImport("user32.dll")] public static extern IntPtr GetDesktopWindow();',
    '  [DllImport("user32.dll")] public static extern IntPtr GetShellWindow();',
    '  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);',
    '  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr hmon, ref MONITORINFO mi);',
    '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint lpdwProcessId);',
    '}',
    '"@',
    '# 让本进程按「每显示器 DPI 感知」报告坐标，避免高分屏缩放下全屏判定失效',
    'try { Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetHighDpiMode([System.Windows.Forms.HighDpiMode]::PerMonitorV2) | Out-Null } catch {}',
    '$lastProcess = ""',
    'while ($true) {',
    '  try {',
    '    $fw = [W32]::GetForegroundWindow()',
    '    if ($fw -eq [IntPtr]::Zero -or $fw -eq [W32]::GetDesktopWindow() -or $fw -eq [W32]::GetShellWindow()) {',
    '      Write-Output "NO"; $lastProcess = ""',
    '    } else {',
    '      $r = New-Object RECT',
    '      [void][W32]::GetWindowRect($fw, [ref]$r)',
    '      $w = $r.R - $r.L; $h = $r.B - $r.T',
    '      # 直接取前台窗口所在显示器的真实分辨率，不依赖 Win32_VideoController（该属性多机返回 0）',
    '      $mon = [W32]::MonitorFromWindow($fw, 2)',
    '      $mi = New-Object MONITORINFO',
    '      $mi.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($mi)',
    '      $mw = 0; $mh = 0',
    '      if ($mon -ne [IntPtr]::Zero -and [W32]::GetMonitorInfo($mon, [ref]$mi)) {',
    '        $mw = $mi.rcMonitor.R - $mi.rcMonitor.L; $mh = $mi.rcMonitor.B - $mi.rcMonitor.T',
    '      }',
    '      if ($mw -gt 0 -and $mh -gt 0 -and $w -ge ($mw - 12) -and $h -ge ($mh - 12)) {',
    '        Write-Output "FULL"; $lastProcess = ""',
    '      } else {',
    '        $pidv = 0',
    '        [void][W32]::GetWindowThreadProcessId($fw, [ref]$pidv)',
    '        $pname = ""',
    '        if ($pidv -gt 0) { try { $pname = (Get-Process -Id $pidv -ErrorAction SilentlyContinue).ProcessName } catch {} }',
    '        if ($pname -ne $lastProcess) {',
    '          $lastProcess = $pname',
    '          if ($pname -ne "") { Write-Output ("WIN:" + $pname) }',
    '        }',
    '      }',
    '    }',
    '  } catch { Write-Output "NO" }',
    '  Start-Sleep -Milliseconds 1500',
    '}',
  ].join('\r\n');
}

function startFullscreenWatch() {
  if (process.platform !== 'win32') return;
  if (fsProc) return;
  try {
    fsScriptPath = path.join(os.tmpdir(), 'yuanyuan-fswatch.ps1');
    fs.writeFileSync(fsScriptPath, fullscreenScript(), 'utf8');
    fsProc = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fsScriptPath],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) { fsProc = null; return; }

  let buf = '';
  fsProc.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() || '';
    for (const raw of lines) {
      const line = raw.trim();
      // 前台窗口变化：仅用于"盯同一窗口"提醒，与全屏隐藏开关无关，始终上报（清理掉换行/超长）
      if (line.startsWith('WIN:')) {
        if (petWindow && !petWindow.isDestroyed() && !manualHidden) {
          const name = line.slice(4).replace(/[\r\n]/g, ' ').trim().slice(0, 120);
          if (name) sendToPet('pet-command', 'foreground-window:' + name);
        }
        continue;
      }
      if (line !== 'FULL' && line !== 'NO') continue;
      const full = line === 'FULL';
      if (full === lastFullscreen) continue;
      lastFullscreen = full;
      if (!settings.autoHideFullscreen) continue;
      if (!petWindow || petWindow.isDestroyed()) continue;
      if (full) {
        // 进入全屏：先让渲染层放一段烟雾过渡，再真正隐藏窗口（避免「啪」地直接消失）
        if (!manualHidden) sendToPet('pet-command', 'fs-enter');
      } else {
        // 退出全屏：主进程先把窗口 show 出来（这样渲染层的烟雾才看得到），再让渲染层放烟雾回到待机
        if (!manualHidden && settings.petVisible) {
          petWindow.showInactive();
          sendToPet('pet-command', 'fs-exit');
        }
      }
      buildTrayMenu();
    }
  });
  fsProc.on('error', () => { fsProc = null; });
  fsProc.on('exit', () => { fsProc = null; });
}

function stopFullscreenWatch() {
  if (fsProc) { try { fsProc.kill(); } catch (e) {} fsProc = null; }
  if (fsScriptPath) { try { fs.unlinkSync(fsScriptPath); } catch (e) {} fsScriptPath = null; }
  lastFullscreen = false;
}

// ---------- 键盘跟随检测（仅 Windows） ----------
// 常驻一个 PowerShell 进程轮询全局按键状态；检测到敲键盘 → 通知渲染层播打字动画，
// 静默约 1.2s 无按键 → 视为停止。这样"你敲键盘她才敲"就实现了键盘跟随。
let kbProc = null, kbTimer = null, kbActive = false, kbScriptPath = null;

// 注意这里的 [KBPoll]::GetAsyncKeyState —— 旧代码写成 $KBPoll::GetAsyncKeyState，
// PowerShell 会当成对未定义变量 $KBPoll 取静态成员，直接抛「不能对 Null 值表达式调用方法」，
// 于是 $hit 永远是 $false，键盘跟随从来没生效过。静态方法必须用 [类型]:: 形式。
function keyboardScript() {
  return [
    '$ErrorActionPreference = "Stop"',
    'Add-Type @"',
    'using System; using System.Runtime.InteropServices;',
    'public class KBPoll { [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey); }',
    '"@',
    '$keys = @(8,13,32,46,48,49,50,51,52,53,54,55,56,57,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,186,187,188,189,190,191,192,219,220,221,222)',
    'while ($true) {',
    '  $hit = $false',
    '  foreach ($v in $keys) { if (([KBPoll]::GetAsyncKeyState($v) -band 0x8000) -ne 0) { $hit = $true; break } }',
    '  if ($hit) { [Console]::Out.WriteLine("K"); [Console]::Out.Flush() }',
    '  Start-Sleep -Milliseconds 60',
    '}',
  ].join('\r\n');
}

function startKeyboardWatch() {
  if (process.platform !== 'win32') return;
  if (kbProc) return;
  try {
    kbScriptPath = path.join(os.tmpdir(), 'yuanyuan-kbwatch.ps1');
    fs.writeFileSync(kbScriptPath, keyboardScript(), 'utf8');
    kbProc = spawn('powershell.exe',
      ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', kbScriptPath],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    kbProc.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      if (buf.indexOf('K') >= 0) { buf = ''; markKeystroke(); }
      if (buf.length > 256) buf = '';
    });
    // 开发期把脚本报错透出来，免得又出现"静默失效但没人知道"的情况
    if (!isPackaged && kbProc.stderr) {
      kbProc.stderr.on('data', (c) => console.log('[键盘检测]', c.toString().trim()));
    }
    kbProc.on('error', () => { kbProc = null; });
    kbProc.on('exit', () => { kbProc = null; });
  } catch (e) { kbProc = null; }
}
function markKeystroke() {
  if (!kbActive) { kbActive = true; sendToPet('keyboard-active', true); }
  if (kbTimer) clearTimeout(kbTimer);
  // 1.2s 内没有新按键则视为停止敲键盘
  kbTimer = setTimeout(() => { kbActive = false; sendToPet('keyboard-active', false); }, 1200);
}
function stopKeyboardWatch() {
  if (kbTimer) { clearTimeout(kbTimer); kbTimer = null; }
  if (kbProc) { try { kbProc.kill(); } catch (e) {} kbProc = null; }
  if (kbScriptPath) { try { fs.unlinkSync(kbScriptPath); } catch (e) {} kbScriptPath = null; }
  kbActive = false;
}

// ---------- 设置变更 ----------
  function updateSettings(patch) {
    const prevScale = settings.scale;
    const prevBoot = settings.startOnBoot;
    const prevClickThrough = settings.clickThrough;
    const prevVisible = settings.petVisible;
    const prevReminders = settings.reminders;   // 先存旧的（完整）reminders，深合并要用它

    settings = Object.assign({}, settings, patch || {});
    // reminders 可能只传子项（如记事本标记完成时只发 events），必须用「旧完整值」做深合并，
    // 否则 Object.assign 已把 settings.reminders 换成局部 patch，会清掉生日/生理期设置
    if (patch && patch.reminders) {
      settings.reminders = normalizeReminders(mergeReminders(prevReminders, patch.reminders));
    }
    // 面板可能只改了动作偏好三个键之一，校验合法性（含非法值回退默认）
    normalizeActions(settings);
    settings.scale = clampNum(settings.scale, 0.4, 2, prevScale);
  settings.speedMul = clampNum(settings.speedMul, 0.5, 2, 1);
  settings.eyeSensitivity = clampNum(settings.eyeSensitivity, 0, 1, 0.6);
  settings.roamChance = clampNum(settings.roamChance, 0, 1, 0.3);
  settings.idleToSleep = clampNum(settings.idleToSleep, 10000, 3600000, 5 * 60 * 1000);

  if (settings.scale !== prevScale) applyScale();

  if (settings.clickThrough !== prevClickThrough) {
    // 关掉全局穿透时，透明区域命中状态可能是过期的，先复位再重算
    if (!settings.clickThrough) hitTransparent = false;
    updateMouseIgnore();
  }

  if (settings.petVisible !== prevVisible && petWindow && !petWindow.isDestroyed()) {
    if (settings.petVisible) { petWindow.showInactive(); manualHidden = false; }
    else { petWindow.hide(); manualHidden = true; }
  }

  if (settings.startOnBoot !== prevBoot) {
    try { app.setLoginItemSettings({ openAtLogin: !!settings.startOnBoot, path: process.execPath }); } catch (e) {}
  }

  if (settings.autoHideFullscreen) startFullscreenWatch();
  else stopFullscreenWatch();

  persistSettings();
  buildTrayMenu();
  sendToPanel('settings-changed', settings);
  sendToPet('settings-changed', settings);
  return settings;
}

// ---------- IPC ----------
function registerIPC() {
  ipcMain.handle('get-material-path', () => MATERIAL_DIR);
  ipcMain.handle('get-base-size', () => BASE_SIZE);
  ipcMain.handle('get-settings', () => settings);
  ipcMain.handle('get-display-info', () => {
    const d = petDisplay();
    return {
      workArea: d.workArea,
      bounds: d.bounds,
      scaleFactor: d.scaleFactor,
      pet: { x: Math.round(petPos.x), y: Math.round(petPos.y + bubbleBand()), w: petSize, h: petSize },
    };
  });
  ipcMain.handle('save-settings', (e, patch) => updateSettings(patch));

  ipcMain.on('move-by', (e, dx, dy) => movePetBy(dx, dy));
  ipcMain.on('set-ignore-mouse', (e, on) => updateSettings({ clickThrough: !!on }));
  ipcMain.on('set-hit-transparent', (e, on) => {
    const v = !!on;
    if (v === hitTransparent) return;
    hitTransparent = v;
    updateMouseIgnore();
  });
  ipcMain.on('open-panel', () => createPanelWindow());
  // 心情系统：宠物把当前情绪档（happy/normal/lonely/annoyed）实时转发给设置面板显示
  ipcMain.on('report-mood', (e, level) => sendToPanel('mood', level));
  ipcMain.on('hide-pet', () => {
    if (!petWindow || petWindow.isDestroyed()) return;
    petWindow.hide(); manualHidden = true; settings.petVisible = false;
    persistSettings(); buildTrayMenu();
  });
  // 全屏场景隐藏：只隐藏窗口，不碰 manualHidden / petVisible，
  // 这样退出全屏时全屏检测仍会把它 show 回来（不会误判成"用户手动藏的"）。
  ipcMain.on('hide-for-fullscreen', () => {
    if (!petWindow || petWindow.isDestroyed()) return;
    petWindow.hide();
  });
  ipcMain.on('show-pet', () => {
    if (!petWindow || petWindow.isDestroyed()) return;
    enforcePetSize();
    petWindow.showInactive(); manualHidden = false; settings.petVisible = true;
    sendToPet('pet-command', 'fs-exit');   // 复位渲染层（退出全屏隐藏态）
    persistSettings(); buildTrayMenu();
  });
  ipcMain.on('toggle-pet', () => togglePet());
  ipcMain.on('quit', () => app.quit());
  ipcMain.on('drag-start', () => startDrag());
  ipcMain.on('drag-end', () => stopDrag());
  ipcMain.on('pet-command', (e, cmd) => sendToPet('pet-command', cmd));
  ipcMain.on('show-context-menu', () => popupPetMenu());
  // 待机姿态浮层：实时回报勾选变化（至少保留一个，不允许全空）
  ipcMain.on('idle-picker-change', (e, arr) => {
    if (Array.isArray(arr) && arr.length) updateSettings({ idlePoses: arr });
  });
  ipcMain.on('idle-picker-done', () => {
    if (idlePickerWin && !idlePickerWin.isDestroyed()) idlePickerWin.close();
  });
}

// ---------- 生命周期 ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // 再次启动时不要开出第二只园园，把现有的叫回来即可
    if (petWindow && !petWindow.isDestroyed()) {
      if (!petWindow.isVisible()) { petWindow.showInactive(); manualHidden = false; sendToPet('pet-command', 'fs-exit'); }
      resetPetPosition();
    }
  });

  app.whenReady().then(() => {
    loadSettings();
    registerIPC();
    createPetWindow();
    buildTray();
    startCursorPolling();
    if (settings.autoHideFullscreen) startFullscreenWatch();
    startKeyboardWatch();   // 全局键盘检测（仅 Windows）：驱动键盘跟随

    // 系统锁屏 / 休眠 / 唤醒 → 转发给桌宠（你锁屏她也说晚安躺下，解锁再醒来）。
    // 各平台事件名不同，powerMonitor 在支持的平台上才 emit，未支持的静默不触发。
    if (powerMonitor) {
      const emitSys = (name) => sendToPet('system-event', name);
      powerMonitor.on('lock-screen', () => emitSys('lock'));
      powerMonitor.on('unlock-screen', () => emitSys('unlock'));
      powerMonitor.on('suspend', () => emitSys('suspend'));
      powerMonitor.on('resume', () => emitSys('resume'));
    }

    try { app.setLoginItemSettings({ openAtLogin: !!settings.startOnBoot, path: process.execPath }); } catch (e) {}

    // 显示器插拔 / 分辨率或缩放变化后，确保园园还在可见区域内且尺寸正确
    screen.on('display-metrics-changed', () => { enforcePetSize(); movePetBy(0, 0); });
    screen.on('display-removed', () => { enforcePetSize(); movePetBy(0, 0); });
  });

  // 注意：window-all-closed 不带 event 参数，旧代码里的 e.preventDefault() 会直接抛异常。
  // 只要注册了监听器，Electron 就不会自动退出，这正是桌宠需要的行为。
  app.on('window-all-closed', () => { /* 桌宠常驻托盘，不退出 */ });

  app.on('activate', () => { if (!petWindow) createPetWindow(); });

  app.on('before-quit', () => {
    if (dragState) { clearInterval(dragState.timer); dragState = null; }
    if (cursorTimer) { clearInterval(cursorTimer); cursorTimer = null; }
    stopFullscreenWatch();
    stopKeyboardWatch();
    persistSettings(true);
  });
}

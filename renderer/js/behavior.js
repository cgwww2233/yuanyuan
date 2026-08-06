// 行为大脑：状态机 + 眼睛方向 + 交互响应 + 睡眠/漫游/时间事件
window.YY = window.YY || {};
(function (YY) {
  'use strict';

  var S = {
    state: 'IDLE',
    eyeMode: 'base', currentEyeDir: 'front',
    lastCursor: null, cursorNear: false, lastInteract: Date.now(), lastEyeApply: 0,
    bodyIsEye: null, eyeTracking: false, deepTimer: null,
    display: { workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
    idleToSleep: 5 * 60 * 1000, roamEnabled: true, roamChance: 0.3, mode: 'idle', followMode: false,
    walk: null, walkTimer: null, walkAnim: null, turning: false,
    transitioning: false, transitionToken: 0,
    away: false, sleepySaid: false, afkEnabled: true,
    // 连续点击闹脾气
    clickTimes: [], annoyCooldownUntil: 0,
    // 用电脑太久提醒休息：活跃连续段计时
    activeStreakStart: null, lastActivityAt: 0, restSaidAt: 0, lastCursorSample: null,
    // 新场景开关（默认开，设置可关）
    clickAnnoy: true, workReminder: true, holidayEnabled: true,
    batteryReminder: true, netStatus: true, systemEvents: true,
    _dragLast: null,
    followGaze: false, typingActive: false, typingFrames: null,
    fsHidden: false,                         // 全屏场景隐藏中：屏蔽互动，等退出全屏再回来
    curAnimName: null, curAnimBaseFps: 0,   // 当前正在播放的身体动画（用于实时调速）
    // 盯同一窗口提醒：记录当前前台进程 + 从什么时候开始盯，超阈值就劝换脑子
    curWindow: null, windowSince: 0, stareSaidAt: 0,
    stareReminder: true, stareLimit: 25 * 60 * 1000,
    // 护眼 20-20-20：每 eyeCareInterval 分钟提醒看远处放松眼睛
    eyeCare: true, eyeCareInterval: 20, eyeCareSaidAt: 0,
    // 纪念日彩蛋（设置里填 "MM-DD"，每年重复；空=不提醒）
    anniversaryDate: '',
    // 心情系统：根据互动频率累积好感度（分数），映射到情绪档。被冷落→寂寞，被狂点→烦。
    mood: 0, moodLevel: 'normal', moodEnabled: true,
    _lastMoodReport: 0,
    // 拖拽物理（扔出去接住）：拖拽时光标速度、飞行状态
    dragThrow: true, _dragVel: { x: 0, y: 0 }, _lastCursorScreen: null,
    throwTimer: null, throwPos: null, throwVel: null, thrownRecently: false,
    // 多选待机姿态：当前实际播放的姿态、以及「每隔一阵随机换一个」的轮播计时器
    _idlePose: null, idleSwitchTimer: null,
  };
  var eyes = null;
  var timers = {};

  // ---------- 工具 ----------
  function now() { return Date.now(); }
  function num(v, dft) { var n = Number(v); return isFinite(n) ? n : dft; }

  function hasAnim(name) {
    return !!(YY.manifest && YY.manifest.animations && YY.manifest.animations[name]);
  }
  // 从候选里挑一个素材里真实存在的动画，全都没有就返回 null（而不是直接崩掉）
  function pickAnim(list) {
    var ok = list.filter(hasAnim);
    if (!ok.length) return null;
    return ok[Math.floor(Math.random() * ok.length)];
  }
  // 从候选数组里随机取一个（用于「多选触发条件」：每次触发随机播其中一个）
  function pickRandom(list) {
    if (!Array.isArray(list) || !list.length) return null;
    return list[Math.floor(Math.random() * list.length)];
  }
  // 只保留素材里真实存在的动画名，剔除拼写错误/不存在的项
  function filterValidActions(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(hasAnim);
  }
  // 四个待机姿态名（它们是持续循环姿势，不是一次性动作）
  function manifestAnims() { return (YY.manifest && YY.manifest.animations) || {}; }
  // 可作为「待机姿态」的全部动作：素材清单里的动画，排除纯过渡特效 smoke。
  // 用于设置里勾选 + 实际进入待机时的候选集（一次性反应动作也可被选作待机姿态，会循环重播）。
  function getIdleCandidateNames() {
    return Object.keys(manifestAnims()).filter(function (n) { return n !== 'smoke'; });
  }
  // 菜单「做个动作」触发后应当“切换为待机并保持”的姿态：仅天然可循环的动画，
  // 避免一次性反应动作（比心/捂脸等）被锁定成待机姿态（它们仍走 playAction 播一遍后回待机）。
  function isIdlePose(n) { var a = manifestAnims()[n]; return !!(a && a.loop); }

  // ---------- 时间 & 互动辅助 ----------
  // 把小时映射成时段分类（与 dialogue.js 的 morning/noon/afternoon/evening/night 对应）
  function timeSegment(h) {
    if (h >= 5 && h < 11) return 'morning';
    if (h >= 11 && h < 14) return 'noon';
    if (h >= 14 && h < 18) return 'afternoon';
    if (h >= 18 && h < 21) return 'evening';
    return 'night';
  }
  // 按系统时间说一句时段问候（开机 / 跨时段各一次）。周末白天有概率换成周末彩蛋。
  function greetByTime() {
    if (!(YY.settings && YY.settings.timeGreetings)) return;
    var d = new Date();
    var seg = timeSegment(d.getHours());
    var weekend = (d.getDay() === 0 || d.getDay() === 6);
    var cat = seg;
    if (weekend && (seg === 'morning' || seg === 'noon' || seg === 'afternoon') && Math.random() < 0.5) {
      cat = 'weekend';
    }
    YY.dialogue.say(cat, 4500);
  }
  // 按系统日期判断节日（固定公历节日 + 几个好玩的）。返回分类 key，null 表示今天不是节日。
  function holidayFor(d) {
    var m = d.getMonth() + 1, day = d.getDate();
    var map = {
      '1-1': 'newyear', '2-14': 'valentine', '3-8': 'womensday',
      '4-1': 'aprilfool', '5-1': 'labour', '6-1': 'childrens',
      '10-1': 'nationalday', '10-31': 'halloween', '11-11': 'singles',
      '12-24': 'christmas', '12-25': 'christmas',
    };
    return map[m + '-' + day] || null;
  }
  // 开机或跨午夜时说一句节日彩蛋（受 holidayEnabled 开关控制）
  function sayHoliday() {
    if (!(YY.settings && YY.settings.holidayEnabled)) return;
    if (holidayFor(new Date())) YY.dialogue.say('holiday');
  }
  // 纪念日：设置里填 "MM-DD"（如 "05-20"），每年这一天触发彩蛋（受 anniversaryDate 是否填写控制）
  function isAnniversary(d) {
    var s = YY.settings && YY.settings.anniversaryDate;
    if (!s || typeof s !== 'string') return false;
    var parts = s.split('-').filter(Boolean);
    if (parts.length < 2) return false;
    var m = parseInt(parts[parts.length - 2], 10);
    var day = parseInt(parts[parts.length - 1], 10);
    return (d.getMonth() + 1) === m && d.getDate() === day;
  }
  function sayAnniversary() {
    if (isAnniversary(new Date())) YY.dialogue.say('anniversary');
  }
  // 任意主动互动（单击/双击/拖拽）都走这里：刷新"最后互动时间"，并把"你回来了"说一次。
  // 只有在 away（此前判定你离开了）时才会补一句 welcome_back，避免每次点击都重复说。
  function noteInteraction() {
    if (S.away) { S.away = false; YY.dialogue.say('welcome_back'); }
    S.lastInteract = now();
    noteActivity();
    adjustMood(6);   // 主动互动 = 被在乎，好感度 +6
  }
  // 记录"你正在用电脑"：敲键盘 / 移动鼠标 / 任意互动都算活跃。
  // 用于「用太久提醒休息」——连续活跃超过阈值才劝你歇会儿，中间离开会重置。
  function noteActivity() {
    var t = now();
    S.lastActivityAt = t;
    if (S.activeStreakStart == null) S.activeStreakStart = t;
  }

  // ---------- 心情系统 ----------
  // 好感度分数 mood ∈ [-100, 100]，映射到四个情绪档：
  //   happy  (>=35)   开心     normal(-15..35) 普通
  //   lonely(<=-15)    寂寞     annoyed(<=-50)  烦
  // 互动（单击/双击/键盘/光标靠近）加分；被冷落、被狂点减分。
  // 情绪档切换时会：①自动换一个更贴合心境的待机姿态 ②说一句对应台词 ③把档位实时报给设置面板。
  function moodLevelFromScore(v) {
    if (v >= 35) return 'happy';
    if (v <= -50) return 'annoyed';
    if (v <= -15) return 'lonely';
    return 'normal';
  }
  function reportMood(level) {
    S._lastMoodReport = now();
    if (YY.isElectron && window.electronAPI.reportMood) window.electronAPI.reportMood(level);
  }
  function adjustMood(delta) {
    if (!S.moodEnabled) return;
    var prev = S.moodLevel;
    S.mood = Math.max(-100, Math.min(100, S.mood + delta));
    var lvl = moodLevelFromScore(S.mood);
    if (lvl !== prev) {
      S.moodLevel = lvl;
      onMoodChange(lvl, prev);
      reportMood(lvl);
    }
  }
  function onMoodChange(lvl, prev) {
    // 进"寂寞"：撒个娇；离开"寂寞"回到正常/开心：小小开心一下（被冷落→被哄好的闭环）
    if (lvl === 'lonely') { if (hasLine('lonely')) YY.dialogue.say('lonely'); }
    else if (lvl === 'annoyed') { /* 狂点时的生气台词由 trackClickSpam 负责，这里不重复 */ }
    else if (prev === 'lonely' && (lvl === 'normal' || lvl === 'happy')) {
      if (hasLine('mood_happy')) YY.dialogue.say('mood_happy');
    }
    // 待机中心境变化时，立刻换上更贴合的待机姿态（仅影响 IDLE 状态，不打断其它动作）
    if (S.state === 'IDLE') enterIdle();
  }
  // 仅判断某类台词是否存在，避免缺素材时 say 静默（保持容错）
  function hasLine(cat) { return !!(YY.dialogue && YY.dialogue.LINES && YY.dialogue.LINES[cat] && YY.dialogue.LINES[cat].length); }

  // 把任意动画名映射到正确的行为（触发条件统一走这里，实现「所有动画可分配给任意触发点」）：
  // · 骑扫帚 → 飞起（循环坐在扫帚上）
  // · 睡觉   → 进入睡眠
  // · 散步   → 去散步
  // · 待机姿态 → 切到该姿态（临时，不改动持久设置）
  // · 其余   → 作为一次性动作播一遍后回待机
  function doActionByName(name) {
    if (!name || !hasAnim(name)) return false;
    if (name === 'sitting_broom') { enterFly(); return true; }
    if (name === 'sleep') { enterSleep(); return true; }
    if (name === 'walk_slow_left' || name === '向左走') { enterWalk(true); return true; }
    if (isIdlePose(name)) { enterIdle(name); return true; }
    playAction(name);
    return true;
  }
  function animFps(name, dft) {
    var a = YY.manifest && YY.manifest.animations && YY.manifest.animations[name];
    return (a && a.fps) ? a.fps : dft;
  }
  // 动作速度倍率：若该动作在 animSpeed 里单独设过，就用它（覆盖全局）；否则用全局 speedMul。
  function effectiveMul(name) {
    var st = YY.settings || {};
    var overrides = st.animSpeed || {};
    if (overrides && overrides[name] != null && isFinite(Number(overrides[name]))) {
      return Number(overrides[name]);
    }
    return num(st.speedMul, 1);
  }

  function petBox() {
    if (S.lastCursor && S.lastCursor.pet) return S.lastCursor.pet;
    var size = 360 * num(YY.settings && YY.settings.scale, 1);
    return { x: S.display.workArea.x + 200, y: S.display.workArea.y + 200, w: size, h: size };
  }

  function directionFromCursor(cx, cy, pet, sens) {
    var px = pet.x + pet.w / 2, py = pet.y + pet.h / 2;
    var dx = cx - px, dy = cy - py;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var dead = 35 + (1 - num(sens, 0.6)) * 70;
    if (dist < dead) return { dir: 'front', near: true };
    var near = dist < Math.max(280, pet.w * 1.05);
    var adx = Math.abs(dx), ady = Math.abs(dy);
    if (ady >= adx) {
      if (dy < 0) return { dir: dx > 0 ? 'upRight' : 'up', near: near };
      return { dir: 'front', near: near };
    }
    return { dir: dx < 0 ? 'left' : 'right', near: near };
  }

  function resolveEyeMode() {
    // 眼睛跟随已改为「眼神帧直接当身体」，不再使用 overlay 叠加模式，避免重影
    YY.engine.setEyeMode('none');
  }

  function playAnim(name, opts) {
    S.bodyIsEye = null;
    opts = opts || {};
    if (!hasAnim(name)) {
      console.warn('[园园] 缺少动画素材:', name);
      if (opts.onEnd) setTimeout(opts.onEnd, 300);
      return;
    }
    var mul = effectiveMul(name);
    var baseFps = (opts.fps != null) ? opts.fps : animFps(name, 24);
    S.curAnimName = name;
    S.curAnimBaseFps = baseFps;
    var o = Object.assign({}, opts);
    if (o.fps) o.fps = Math.max(1, Math.round(o.fps * mul));
    // 角色动画统一按内容裁剪占满画布，使人物大小与静态眼神帧一致；
    // 烟雾过渡是整屏特效（需铺满画布），不裁剪。
    o.cropToContent = (name !== 'smoke');
    setFlip(false);
    YY.engine.setBodyAnim(name, o);
  }

  // 实时调速：不改帧进度、不重启动画，直接改当前身体动画的帧率。
  // 当前若是静态姿势（眼神帧/被拎起/深度睡眠），fps=0，直接跳过。
  function applyLiveSpeed() {
    if (!S.curAnimName) return;
    var cur = YY.engine.getCurrentFps && YY.engine.getCurrentFps();
    if (!cur || cur <= 0) return;
    var mul = effectiveMul(S.curAnimName);
    YY.engine.setBodyFps(S.curAnimBaseFps * mul);
  }

  function showEye(dir) {
    if (!eyes) return;
    var img = eyes[dir] || eyes.front;
    if (!img) return;
    YY.engine.setStatic(img);
    S.bodyIsEye = img;
  }

  // 把眼神跟随帧直接当身体绘制（坐在电脑前、视角随鼠标）。
  // 关键：眼神帧本身就是完整小人，必须替换整个身体（setStatic），绝不能叠加在打字身体上，
  // 否则会出现「一大一小两个人物」的重影——之前就是这个 bug。
  function applyGaze() {
    if (!eyes) eyes = YY.loader.getEyes();
    if (!eyes || S.state !== 'IDLE' || !S.followGaze || S.typingActive) return;
    var dir = S.currentEyeDir || 'front';
    var img = eyes[dir] || eyes.front;
    if (img) { YY.engine.setStatic(img); S.bodyIsEye = img; }
  }

  function setFlip(on) {
    YY.engine.setFlipped(!!on);
  }

  // 烟雾过渡：动作切换时先放一段烟雾（魔法消散），再切到目标动画。
  // 注意：睡眠↔醒来、走路转向走连贯动画，不使用烟雾。
  function withSmoke(name, opts, flip) {
    opts = opts || {};
    if (!hasAnim('smoke')) { playAnim(name, opts); return; }
    var my = ++S.transitionToken;
    S.transitioning = true;
    playAnim('smoke', { loop: true, fps: animFps('smoke', 16) });
    setTimeout(function () {
      if (my !== S.transitionToken || S.state === 'DRAG') { S.transitioning = false; return; }
      S.transitioning = false;
      if (hasAnim(name)) { playAnim(name, opts); if (flip != null) setFlip(!!flip); }
      else enterIdle();
    }, 420);
  }

  // 回到待机姿态的「出口」过渡：刚播完的反应/特殊动作（如转圈、比心、欢呼）和待机姿态
  // （打字/看书/发呆）之间通常没有连贯关系，所以先放一段烟雾再切过去，避免「啪」地直接变姿势。
  // 注意：睡眠↔醒来（含起床）、被拎起→放下 属于连贯动作链，不走这里，由各自逻辑直接 enterIdle。
  function returnIdleWithSmoke() {
    if (S.state === 'DRAG') return;
    if (!hasAnim('smoke')) { enterIdle(); return; }
    var my = ++S.transitionToken;
    S.transitioning = true;
    playAnim('smoke', { loop: true, fps: animFps('smoke', 16) });
    setTimeout(function () {
      if (my !== S.transitionToken) { S.transitioning = false; return; }
      S.transitioning = false;
      enterIdle();
    }, 420);
  }

  // 全屏场景：你看视频 / PPT / 图片等需要不被遮挡时，她先放一段烟雾再真正消失，
  // 退出全屏时主进程先 show 窗口、这里再放一段烟雾回到待机姿态——和动作切换用同一套烟雾过渡，观感一致。
  // fsHidden 期间屏蔽一切互动（单击 / 菜单 / 光标 / 键盘），退出全屏才恢复。
  function hideForFullscreen() {
    if (S.fsHidden) return;
    if (S.state === 'DRAG') return;
    S.fsHidden = true;
    S.away = false;
    stopWalk();
    YY.dialogue.showZzz(false);
    clearTimeout(S.deepTimer);
    if (!hasAnim('smoke')) { if (YY.isElectron) window.electronAPI.fsHide(); return; }
    var my = ++S.transitionToken;
    S.transitioning = true;
    playAnim('smoke', { loop: true, fps: animFps('smoke', 16) });
    setTimeout(function () {
      if (my !== S.transitionToken) { S.transitioning = false; return; }
      S.transitioning = false;
      if (YY.isElectron) window.electronAPI.fsHide();
    }, 420);
  }
  function showFromFullscreen() {
    if (!S.fsHidden) return;
    S.fsHidden = false;
    // 烟雾过渡后回到待机姿态（returnIdleWithSmoke 即「烟雾 → enterIdle」）
    returnIdleWithSmoke();
  }

  // ---------- 状态 ----------
  // 待机姿态多选：从设置里读出用户勾选的待机姿态列表（已过滤成合法值）
  function getSelectedIdlePoses() {
    var v = YY.settings && YY.settings.idlePoses;
    var list = Array.isArray(v) ? v.slice() : (typeof v === 'string' ? [v] : []);
    var out = [];
    var valid = getIdleCandidateNames();
    list.forEach(function (n) { if (valid.indexOf(n) >= 0) out.push(n); });
    return out;
  }
  // 解析本次应播放的待机姿态：
  // · forcePose：菜单/触发临时指定，优先且不改动设置
  // · 寂寞档：用更落寞的阅读姿态（情绪表达优先）
  // · 多选：随机挑一个，尽量避免和当前姿态重复
  function resolveIdlePose(forcePose) {
    if (forcePose) return forcePose;
    if (S.moodEnabled && S.moodLevel === 'lonely') {
      if (hasAnim('sitting_read')) return 'sitting_read';
      if (hasAnim('lying_read')) return 'lying_read';
      // 没有阅读姿态就退回下面的随机选择
    }
    var list = getSelectedIdlePoses();
    if (list.length === 0) return 'standing_wiggle';
    if (list.length === 1) return list[0];
    var pick = list[(Math.random() * list.length) | 0];
    if (pick === S._idlePose) pick = list[(list.indexOf(pick) + 1) % list.length]; // 避免连续重复
    return pick;
  }
  // 多选时每隔 20~40 秒随机换一个待机姿态（仅 IDLE 状态下运行）
  function scheduleIdleSwitch() {
    clearTimeout(S.idleSwitchTimer);
    if (S.mode === 'follow') return;   // 跟随状态不轮播待机姿态
    var list = getSelectedIdlePoses();
    if (list.length <= 1) return;                          // 单选/空：不轮播
    if (S.moodEnabled && S.moodLevel === 'lonely') return; // 寂寞时锁定阅读姿态
    var delay = 20000 + Math.random() * 20000;
    S.idleSwitchTimer = setTimeout(switchIdlePose, delay);
  }
  function switchIdlePose() {
    if (S.state !== 'IDLE') return;
    clearTimeout(S.idleSwitchTimer);
    var pose = resolveIdlePose(null);
    if (!pose || pose === S._idlePose) { scheduleIdleSwitch(); return; }
    S._idlePose = pose;
    if (pose === 'typing_left') enterTypingIdle();
    else playAnim(pose, { loop: true, fps: animFps(pose, 24) });
    scheduleIdleSwitch();
  }

  function enterIdle(forcePose) {
    if (S.state === 'DRAG') return;
    S.state = 'IDLE';
    S.sleepySaid = false;
    S.bodyIsEye = null;
    S.eyeTracking = false;
    S.followGaze = false;
    S.typingActive = false;
    S.followMode = false;
    YY.dialogue.showZzz(false);
    clearTimeout(S.deepTimer);
    clearTimeout(S.idleSwitchTimer);
    YY.engine.setEyeMode('none');
    YY.engine.setEyeOverlay(null);
    // 跟随状态：只做键盘/鼠标跟随，不轮播待机姿态、不散步（详见 enterFollowIdle）
    if (S.mode === 'follow') { enterFollowIdle(); return; }
    // forcePose：某次触发临时指定一个待机姿态（如把「坐着看书」分配给单击），不改动持久设置
    var idlePose = resolveIdlePose(forcePose);
    if (!idlePose) idlePose = 'standing_wiggle';
    S._idlePose = idlePose;
    if (idlePose === 'typing_left') enterTypingIdle();
    else playAnim(idlePose, { loop: true, fps: animFps(idlePose, 24) });
    armTimers();
    scheduleIdleSwitch();
  }

  // 跟随状态：纯跟随键鼠，不做其它动作。
  // - 鼠标跟随开 → 用「眼神帧」当身体（坐着看向鼠标），单一连贯小人、不重影；
  // - 鼠标跟随关但键盘跟随开 → 静止首帧，检测到敲键盘才播放打字；
  // - 都不开（极端兜底）→ 给个中性静止姿态。
  // 与待机模式的关键区别：不调用 scheduleIdleSwitch（不轮播），漫游计时器在跟随模式也不触发。
  function enterFollowIdle() {
    S.followMode = true;
    S.typingActive = false;
    S._idlePose = 'typing_left';   // 让键盘跟随处理器仍按"打字姿态"分支工作
    clearTimeout(S.idleSwitchTimer);
    armTimers();                    // 照常挂睡眠/离开感知等计时器
    var ef = !!(YY.settings && YY.settings.eyeFollow);
    var kf = !!(YY.settings && YY.settings.keyboardFollow);
    if (ef) { S.followGaze = true; applyGaze(); return; }
    if (kf) {
      if (S.typingFrames) { YY.engine.setStatic(S.typingFrames[0]); }
      else YY.loader.ensureLoaded('typing_left').then(function (f) {
        if (S.state === 'IDLE' && S.mode === 'follow') { S.typingFrames = f; YY.engine.setStatic(f[0]); }
      }).catch(function () {});
      return;
    }
    var neutral = getSelectedIdlePoses()[0] || 'standing_wiggle';
    playAnim(neutral === 'typing_left' ? 'typing_left' : neutral, { loop: true, fps: 24 });
  }

  // 打字姿态的待机逻辑：鼠标跟随 / 键盘跟随 两种效果正交组合。
  // - 鼠标跟随开：直接用「眼神跟随帧」当身体（坐着看向鼠标），单一连贯小人，不重影。
  // - 鼠标跟随关：播打字动画；若开了键盘跟随则先静止(首帧)，检测到敲键盘才播放打字。
  function enterTypingIdle() {
    var ef = !!(YY.settings && YY.settings.eyeFollow);
    var kf = !!(YY.settings && YY.settings.keyboardFollow);
    if (ef) {
      S.followGaze = true;
      applyGaze();
      return;
    }
    YY.loader.ensureLoaded('typing_left').then(function (frames) {
      if (S.state !== 'IDLE') return;
      S.typingFrames = frames;
      if (kf) { S.typingActive = false; YY.engine.setStatic(frames[0]); } // 先不动
      else { S.typingActive = true; playAnim('typing_left', { loop: true, fps: animFps('typing_left', 24) }); }
    }).catch(function () {
      if (S.state === 'IDLE') playAnim('typing_left', { loop: true, fps: animFps('typing_left', 24) });
    });
  }

  // 主进程全局键盘检测结果：检测到敲键盘→播打字；静默一段时间→回到待机姿态
  function onKeyboardActivity(active) {
    if (S.fsHidden) return;    // 全屏隐藏期间不响应键盘
    if (S.state !== 'IDLE') return;
    if (active) noteActivity();   // 敲键盘 = 活跃，喂给"用太久提醒休息"
    var idlePose = S._idlePose || (YY.settings && YY.settings.idlePoses && YY.settings.idlePoses[0]) || 'standing_wiggle';
    if (idlePose !== 'typing_left') return;
    if (active) {
      if (!S.typingActive) {
        S.typingActive = true;
        playAnim('typing_left', { loop: true, fps: animFps('typing_left', 24) });
      }
      S.lastInteract = now();
    } else {
      S.typingActive = false;
      if (S.followGaze) applyGaze();                                  // 鼠标跟随：回到看向鼠标
      else if ((YY.settings && YY.settings.keyboardFollow) && S.typingFrames) YY.engine.setStatic(S.typingFrames[0]); // 键盘跟随：回到静止画面
      else playAnim('typing_left', { loop: true, fps: animFps('typing_left', 24) });
    }
  }

  function enterReact(anim, cat) {
    if (S.state === 'DRAG') return;
    S.state = 'REACT';
    YY.dialogue.showZzz(false); clearTimeout(S.deepTimer);
    stopWalk();
    S.bodyIsEye = null;
    YY.dialogue.say(cat || 'react_click');
    S.lastInteract = now();
    withSmoke(anim, { loop: false, fps: animFps(anim, 24), onEnd: returnIdleWithSmoke });
  }

  // 连续点击闹脾气：3 秒内累计点击数达阈值就闹脾气；
  // 5 次 = 轻度 annoyed，8 次 = 重度 very_annoyed（会做个噘嘴生气的动作）。
  // 重度优先判定，且轻度触发后不清空计数窗口、只进短冷却，这样"继续狂点"能升级到重度。
  function trackClickSpam() {
    if (!(YY.settings && YY.settings.clickAnnoy)) return false;
    var t = now();
    S.clickTimes.push(t);
    S.clickTimes = S.clickTimes.filter(function (x) { return t - x <= 3000; });
    var n = S.clickTimes.length;
    // 重度：3 秒内 8 次 → 真生气（噘嘴）。放在最前，避免被轻度的冷却挡住升级。
    // 有噘嘴动画就让 enterReact 负责说 very_annoyed（顺便播动作），避免重复说同一句。
    if (n >= 8) {
      S.annoyLevel = 2;
      S.annoyCooldownUntil = t + 6000;
      S.clickTimes = [];
      adjustMood(-60);   // 被狂点 → 心情降到"烦"
      if (hasAnim('pout_angry')) enterReact('pout_angry', 'very_annoyed');
      else YY.dialogue.say('very_annoyed');
      return true;
    }
    // 轻度：3 秒内 5 次 → 闹脾气。冷却中（刚闹过）不重复说，但保留计数以允许继续升级到重度。
    if (n >= 5) {
      if (t < S.annoyCooldownUntil && S.annoyLevel >= 1) return false;
      S.annoyLevel = 1;
      S.annoyCooldownUntil = t + 5000;
      adjustMood(-30);   // 被连点 → 有点烦
      YY.dialogue.say('annoyed');
      return true;
    }
    return false;
  }

  function reactClick() {
    // 睡着时点她 = 叫醒（这是主动意图）；鼠标只是划过不会唤醒（见 onCursor）
    if (S.state === 'SLEEP') { enterWake(); return; }
    if (S.throwTimer) return;   // 飞行中点击不反应，得抓住她才算接住
    // 先判连续点击：狂点→闹脾气（且不再给 +6 好感度，否则会和"烦"的扣分相互抵消）
    if (trackClickSpam()) return;
    noteInteraction();
    // 单击动作由设置决定：数组可多选，触发时随机播其中一个；空数组=单击无反应
    var arr = filterValidActions((YY.settings && YY.settings.clickActions) || []);
    if (!arr.length) return;
    doActionByName(pickRandom(arr));
  }

  // 菜单里的单个动作：播一遍就回待机
  function playAction(name) {
    if (!hasAnim(name)) { console.warn('[园园] 缺少动画素材:', name); return; }
    enterReact(name, 'react_click');
  }

  // 「飞起来」= 直接循环播放骑扫帚动画，一直保持到下一条指令（点击 / 拖拽 / 菜单）为止。
  // 欢快地跑(running_happy)是独立动作，不再和飞起绑定。
  function enterFly() {
    if (S.state === 'DRAG') return;
    S.state = 'FLY';
    S.bodyIsEye = null;
    S.followGaze = false; S.typingActive = false;
    YY.dialogue.showZzz(false); clearTimeout(S.deepTimer);
    stopWalk();
    // 自动睡觉/散步/闲聊都只在 IDLE 触发，FLY 状态天然不会被打断
    S.lastInteract = now();
    YY.dialogue.say('cheer');
    if (hasAnim('sitting_broom')) {
      // 从待机姿态切到骑扫帚飞：离散姿势切换，先用烟雾过渡再起飞
      withSmoke('sitting_broom', { loop: true, fps: animFps('sitting_broom', 24) });
    } else {
      enterIdle();
    }
  }

  function reactDblClick() {
    noteInteraction();
    // 多次点击动作由设置决定：数组可多选，触发时随机播其中一个（sitting_broom→飞起循环）
    var arr = filterValidActions((YY.settings && YY.settings.multiClickActions) || []);
    if (!arr.length) return;
    doActionByName(pickRandom(arr));
  }

  // 睡眠三段式：入睡动画（站立→躺下，只播一遍）→ 定格静态睡姿 → 醒来动画（躺下→站起）。
  // 关键：sleep 素材是"站立→躺下"的一次性过程，绝不能 loop——loop 会在躺下后瞬间跳回站立，
  // 前 1 秒的画面又几乎和站立待机一模一样，看起来就成了"点了睡觉毫无变化"。
  function enterSleep() {
    if (S.state === 'DRAG') return;
    S.transitionToken++; // 取消可能进行中的烟雾过渡
    S.state = 'SLEEP';
    S.sleepySaid = false;
    S.away = false;
    S.bodyIsEye = null;
    S.followGaze = false; S.typingActive = false;
    stopWalk();
    YY.engine.setEyeOverlay(null);
    setFlip(false);
    YY.dialogue.showZzz(false);
    clearTimeout(S.deepTimer);
    // 睡眠一旦进入就是独立状态：鼠标只是划过不会唤醒，只有主动「叫醒她」或点击她才醒。
    YY.dialogue.say('sleep');

    var toDeepSleep = function () {
      if (S.state !== 'SLEEP') return;
      YY.dialogue.showZzz(true);           // 躺下之后才冒 Zzz，节奏才对
      YY.loader.ensurePose('sleep').then(function (img) {
        if (S.state === 'SLEEP') YY.engine.setStatic(img);
      }).catch(function () {});
    };

    if (hasAnim('sleep')) {
      // setBodyAnim 的 onEnd 在加载失败时也会兑现，所以这里天然带兜底
      playAnim('sleep', { loop: false, fps: animFps('sleep', 12), onEnd: toDeepSleep });
    } else {
      toDeepSleep();
    }
  }

  function enterWake() {
    if (S.state === 'DRAG') return;
    if (S.state !== 'SLEEP') { enterIdle(); return; }  // 没睡就别播起床，直接回待机
    S.transitionToken++; // 取消可能进行中的烟雾过渡（睡眠↔醒来保持连贯，不插烟雾）
    S.state = 'WAKE';
    YY.dialogue.showZzz(false); clearTimeout(S.deepTimer);
    S.bodyIsEye = null;
    var anim = hasAnim('起床') ? '起床' : 'standing_wiggle';
    playAnim(anim, { loop: false, fps: animFps(anim, 24), onEnd: enterIdle });
    YY.dialogue.say('wake');
    S.lastInteract = now();
  }

  function enterSpecial(kind) {
    if (S.state === 'DRAG') return;
    S.state = 'SPECIAL';
    S.bodyIsEye = null;
    YY.dialogue.showZzz(false); clearTimeout(S.deepTimer);
    var anim = hasAnim('running_happy') ? 'running_happy' : 'standing_wiggle';
    withSmoke(anim, { loop: false, fps: animFps(anim, 30), onEnd: returnIdleWithSmoke });
    YY.dialogue.say(kind === 'greet' ? 'greet' : 'cheer');
    S.lastInteract = now();
  }

  // ---------- 漫游 ----------
  function stopWalk() {
    if (S.walkTimer) { clearInterval(S.walkTimer); S.walkTimer = null; }
    S.walk = null;
  }

  function enterWalk(force) {
    if (S.state === 'DRAG') return;
    if (!force && S.state !== 'IDLE') return;
    // 只选「左向」行走动画，靠翻转区分左右。不再把自带"先左后右"的 walk_left_right 当普通走路，
    // 否则再叠加翻转会导致行走方向和实际移动方向相反（方向错乱 bug 的根因）。
    var anim = pickAnim(['walk_slow_left', '向左走']) || 'walk_slow_left';
    if (!hasAnim(anim)) return;       // 没有走路素材就别走了，别抛异常
    stopWalk();
    S.state = 'WALK';
    S.walkAnim = anim;
    S.turning = false;
    YY.dialogue.showZzz(false); clearTimeout(S.deepTimer);
    YY.engine.setEyeOverlay(null);
    var dir = Math.random() < 0.5 ? -1 : 1;
    S.walk = { dir: dir, elapsed: 0, max: 9000 + Math.random() * 9000 };
    // 用烟雾过渡进场（动作切换的通用过渡）；flip 在烟雾结束后应用到行走动画上
    withSmoke(anim, { loop: true, fps: animFps(anim, 20) }, dir > 0);
    YY.dialogue.say('walk');
    refreshDisplay();

    S.walkTimer = setInterval(function () {
      if (S.state !== 'WALK' || !S.walk) { stopWalk(); return; }
      if (S.transitioning) return;    // 烟雾过渡期间先不移动
      var wa = S.display.workArea;
      var box = petBox();
      // 位置以主进程回传的真实窗口坐标为准，不再自己累加，避免和实际位置越走越偏
      var newDir = S.walk.dir;
      if (box.x <= wa.x + 2) newDir = 1;
      else if (box.x + box.w >= wa.x + wa.width - 2) newDir = -1;
      if (newDir !== S.walk.dir) {
        S.walk.dir = newDir;
        setFlip(newDir > 0);
        // 转向：用「走路（先向左后向右）」做连贯转身动画，不插烟雾、转身期间不移动
        if (hasAnim('walk_left_right') && !S.turning) {
          S.turning = true;
          playAnim('walk_left_right', { loop: false, fps: animFps('walk_left_right', 20), onEnd: function () {
            S.turning = false;
            if (S.state === 'WALK') { playAnim(S.walkAnim, { loop: true, fps: animFps(S.walkAnim, 20) }); setFlip(S.walk.dir > 0); }
          } });
          return;
        }
      }
      if (S.turning) return;          // 转身播放中：不移动
      // 移动速度跟随该走路动作的「有效速度倍率」（全局或单独设置），
      // 否则动画放慢了脚还会按原速滑行，看起来像在溜冰。
      var sp = (S.walk.dir < 0 ? -1 : 1) * 1.1 * num(YY.settings && YY.settings.scale, 1)
             * effectiveMul(S.walkAnim);
      S.walk.elapsed += 33;
      if (YY.isElectron) window.electronAPI.moveBy(sp, 0);
      if (S.walk.elapsed > S.walk.max) { stopWalk(); returnIdleWithSmoke(); }
    }, 33);
  }

  function refreshDisplay() {
    if (!YY.isElectron) return;
    window.electronAPI.getDisplayInfo().then(function (d) {
      if (d && d.workArea) S.display.workArea = d.workArea;
    }).catch(function () {});
  }

  // ---------- 拖拽 ----------
  // Electron 下位置完全由主进程按光标绝对坐标计算，这里只负责姿势和状态。
  function dragStart(cx, cy) {
    cancelThrow();                 // 飞行中再抓住她 = 接住，先停掉抛物线
    S.transitionToken++; S.transitioning = false; // 取消可能进行中的烟雾过渡
    S.state = 'DRAG';
    S.away = false;                 // 拖拽不是"你回来了"，别补 welcome_back
    S._dragVel = { x: 0, y: 0 }; S._lastCursorScreen = null;  // 重置甩动速度采集
    YY.dialogue.say(S.thrownRecently ? 'throw_catch' : 'drag');
    S.thrownRecently = false;
    stopWalk();
    YY.dialogue.showZzz(false); clearTimeout(S.deepTimer);
    S.bodyIsEye = null;
    setFlip(false);
    YY.engine.setEyeOverlay(null);
    YY.loader.ensurePose('picked').then(function (img) {
      if (S.state === 'DRAG') YY.engine.setStatic(img);
    }).catch(function () {});
    if (YY.isElectron) window.electronAPI.dragStart();
    S._dragLast = { x: cx, y: cy };
  }

  function dragMove(cx, cy) {
    if (S.state !== 'DRAG' || !S._dragLast) return;
    var dx = cx - S._dragLast.x, dy = cy - S._dragLast.y;
    S._dragLast = { x: cx, y: cy };
    // 浏览器调试环境下才用增量移动；Electron 里主进程自己跟随光标
    if (!YY.isElectron) window.moveBy(dx, dy);
  }

  function dragEnd() {
    if (YY.isElectron) window.electronAPI.dragEnd();
    S._dragLast = null;
    // 抓取松手瞬间的甩动速度：快 → 扔出去飞一段；慢/几乎没动 → 普通放下
    var vx = S._dragVel.x, vy = S._dragVel.y;
    var speed = Math.sqrt(vx * vx + vy * vy);
    S._dragVel = { x: 0, y: 0 }; S._lastCursorScreen = null;
    // 关键：先退出 DRAG 状态，否则 enterIdle() 顶部的 `if (S.state === 'DRAG') return;`
    // 会把这次复位直接挡掉，宠物就会永远卡在"被拎起来"的姿势。
    S.state = 'IDLE';
    S.eyeTracking = false;
    S.away = false;
    S.lastInteract = now();
    adjustMood(4);  // 被你温柔放下 → 心情小幅回升
    if (S.dragThrow && YY.isElectron && speed > THROW_MIN_SPEED && S.lastCursor && S.lastCursor.pet) {
      enterThrow(vx, vy, S.lastCursor.pet);   // 甩得快 → 抛物线飞出去
      return;
    }
    YY.dialogue.say('drag_end');
    refreshDisplay();
    enterIdle();
  }

  // 拖拽物理：松手时若有足够"甩动速度"，就进入 THROW 状态，用抛物线 + 屏幕边界回弹飞一段，
  // 速度衰减到很低且贴着地面时归位回待机；这期间再抓住她（dragStart）即"接住"。
  // 坐标系与光标 pet 一致：x=窗口左，y=canvas 顶（窗口顶 = y - bubbleBand），尺寸取 pet 的逻辑尺寸。
  var THROW_MIN_SPEED = 1200;   // px/秒，低于此判定为"轻轻放下"，不触发飞行
  function cancelThrow() {
    if (S.throwTimer) { clearInterval(S.throwTimer); S.throwTimer = null; }
    S.throwPos = null; S.throwVel = null;
  }
  function enterThrow(vx, vy, pet) {
    if (S.state === 'DRAG') return;
    S.transitionToken++;   // 取消可能进行中的烟雾过渡
    S.state = 'THROW';
    stopWalk();
    S.bodyIsEye = null; S.followGaze = false; S.typingActive = false;
    YY.dialogue.showZzz(false); clearTimeout(S.deepTimer);
    adjustMood(-20);       // 被扔出去 → 有点小脾气
    S.thrownRecently = true;
    S.lastInteract = now();
    YY.dialogue.say('throw_out');
    // 飞行中的姿态：用站立扭动（像被甩得手舞足蹈）；没有就退回普通待机姿态
    var pose = hasAnim('standing_wiggle') ? 'standing_wiggle'
      : (S._idlePose || 'standing_wiggle');
    if (hasAnim(pose)) playAnim(pose, { loop: true, fps: animFps(pose, 24) });
    var sz = Math.max(120, (YY.BASE || 360) * num(YY.settings && YY.settings.scale, 1));
    S.throwPos = { x: pet.x, y: pet.y };
    S.throwVel = { x: vx, y: vy };
    refreshDisplay();
    var G = 1800, REST = 0.55, last = now();
    if (S.throwTimer) clearInterval(S.throwTimer);
    S.throwTimer = setInterval(function () {
      if (S.state !== 'THROW' || !S.throwPos) { cancelThrow(); return; }
      var wa = S.display.workArea;
      if (!wa) { cancelThrow(); enterIdle(); return; }
      var t = now(); var dt = Math.min(0.05, (t - last) / 1000); last = t;
      var p = S.throwPos, v = S.throwVel;
      v.y += G * dt;
      var nx = p.x + v.x * dt, ny = p.y + v.y * dt;
      var minX = wa.x, maxX = wa.x + wa.width - sz;
      var minY = wa.y, maxY = wa.y + wa.height - sz;
      if (nx < minX) { nx = minX; v.x = -v.x * REST; }
      else if (nx > maxX) { nx = maxX; v.x = -v.x * REST; }
      if (ny < minY) { ny = minY; v.y = -v.y * REST; }
      else if (ny > maxY) { ny = maxY; v.y = -v.y * REST; v.x *= 0.92; }  // 落地摩擦
      var dx = nx - p.x, dy = ny - p.y;
      p.x = nx; p.y = ny;
      if (YY.isElectron && (dx || dy)) window.electronAPI.moveBy(dx, dy);
      if (Math.abs(v.x) > 30) setFlip(v.x < 0);   // 朝向随水平速度，飞行更有方向感
      var sp2 = Math.sqrt(v.x * v.x + v.y * v.y);
      if (ny >= maxY - 1 && sp2 < 26) {           // 贴地且几乎不动 → 落地归位
        cancelThrow();
        S.lastInteract = now();
        enterIdle();
      }
    }, 16);
    // 兜底：最多飞 8 秒，避免极端情况下无限弹跳卡死
    setTimeout(function () { if (S.state === 'THROW') { cancelThrow(); enterIdle(); } }, 8000);
  }

  // ---------- 计时器 ----------
  function armTimers() {
    clearTimers();
    timers.sleep = setInterval(function () {
      if (S.state !== 'IDLE') { S.sleepySaid = false; return; }
      var idle = now() - S.lastInteract;
      if (idle > S.idleToSleep) enterSleep();
      // 快睡着前 15 秒打个小哈欠（只说一次），免得"突然就睡了"很突兀
      else if (idle > S.idleToSleep - 15000 && !S.sleepySaid) {
        S.sleepySaid = true;
        YY.dialogue.say('self_sleepy');
      }
    }, 5000);
    timers.roam = setInterval(function () {
      if (S.state === 'IDLE' && S.roamEnabled && S.mode !== 'follow' && Math.random() < S.roamChance) enterWalk();
    }, 45000);
    timers.chatter = setInterval(function () {
      if (S.state !== 'IDLE') return;
      if (Math.random() < 0.5) {
        // 心情系统：情绪档会影响她主动聊什么——寂寞就撒娇想你，烦了就吐槽，开心就打气夸夸。
        var cats;
        if (!S.moodEnabled) {
          cats = S.away ? ['miss', 'sajiao', 'miss'] : ['sajiao', 'roast', 'cheer', 'joke', 'praise', 'bored'];
        } else if (S.moodLevel === 'lonely') {
          cats = ['miss', 'lonely', 'sajiao', 'miss'];
        } else if (S.moodLevel === 'annoyed') {
          cats = ['annoyed', 'roast', 'annoyed'];
        } else if (S.moodLevel === 'happy') {
          cats = ['cheer', 'praise', 'sajiao', 'joke'];
        } else {
          cats = S.away ? ['miss', 'sajiao', 'miss'] : ['sajiao', 'roast', 'cheer', 'joke', 'praise', 'bored'];
        }
        YY.dialogue.say(cats[Math.floor(Math.random() * cats.length)]);
      }
    }, 60000);
    timers.time = setInterval(checkTime, 60000);
    // 离开感知：待机且很久没互动 → 说"你走啦"；再靠近由 onCursor 说"你回来啦"
    timers.afk = setInterval(function () {
      if (!S.afkEnabled || S.state !== 'IDLE') { S.away = false; return; }
      if (now() - S.lastInteract > 3 * 60 * 1000 && !S.away) {
        S.away = true;
        adjustMood(-8);   // 被冷落 → 好感度下降，久了进入寂寞档
        YY.dialogue.say('afk');
      }
    }, 15000);
    // 心情衰减：很久没互动（>4 分钟）且功能开着 → 好感度慢慢往下掉，
    // 让你"放着她不管"会真的演变成寂寞（被冷落→寂寞档）；一旦互动就由 noteInteraction 回血。
    timers.mood = setInterval(function () {
      if (!S.moodEnabled || S.state === 'SLEEP' || S.state === 'DRAG') return;
      if (now() - S.lastInteract > 4 * 60 * 1000) adjustMood(-4);
    }, 30000);
    // 用太久提醒休息：连续活跃（敲键盘/动鼠标/互动）超过 45 分钟 → 劝你歇会儿。
    // 60 秒以上没任何活跃信号就视为停手，重置活跃段；同一活跃段内最多 45 分钟提醒一次。
    timers.work = setInterval(function () {
      if (!S.workReminder || S.state === 'SLEEP') return;
      var t = now();
      if (t - S.lastActivityAt > 60 * 1000) { S.activeStreakStart = null; S.restSaidAt = 0; return; }
      if (S.activeStreakStart != null && t - S.activeStreakStart > 45 * 60 * 1000) {
        if (t - S.restSaidAt > 45 * 60 * 1000) { S.restSaidAt = t; YY.dialogue.say('rest'); }
      }
    }, 60000);
    // 提醒：每 30 秒检查一次，覆盖记事本精确到「时分」的提醒、跨午夜的生日边界等
    timers.reminders = setInterval(function () {
      if (YY.reminders) YY.reminders.tickCheck();
    }, 30000);
    // 盯同一窗口提醒：连续盯着同一个应用超过 stareLimit（默认 25 分钟）→ 劝你换换脑子。
    // 用持久时间戳 + 每分钟查一次，这样即便她每次回待机都重排计时器，也不会重置累计时长。
    timers.stare = setInterval(function () {
      if (!S.stareReminder || S.fsHidden) return;
      if (S.state === 'SLEEP' || S.state === 'DRAG') return;
      if (!S.windowSince) return;
      var t = now();
      if (t - S.windowSince > S.stareLimit && t - S.stareSaidAt > S.stareLimit) {
        S.stareSaidAt = t;
        YY.dialogue.say('change_mind');
      }
    }, 60000);
    // 护眼 20-20-20：每 eyeCareInterval 分钟提醒看远处放松眼睛（持久时间戳，重排计时器不重置）。
    // 睡眠 / 全屏隐藏 / 被拖拽时不打扰；其余状态（待机 / 反应 / 散步 / 飞）都照常提醒。
    timers.eye20 = setInterval(function () {
      if (!S.eyeCare || S.fsHidden) return;
      if (S.state === 'SLEEP' || S.state === 'DRAG') return;
      var t = now();
      if (t - S.eyeCareSaidAt >= S.eyeCareInterval * 60 * 1000) {
        S.eyeCareSaidAt = t;
        YY.dialogue.say('eye_rest');
      }
    }, 60000);
  }
  function clearTimers() {
    Object.keys(timers).forEach(function (k) { clearInterval(timers[k]); delete timers[k]; });
  }

  // 跨时段问候：每天只在新进入某个时段（morning/noon/...）时说一次。
  // 首检时 lastSegment 已在 init 里预置为当前时段，所以开机当次不会重复说（由 greetByTime 负责）。
  var lastSegment = '';
  var lastDateKey = '';
  function checkTime() {
    var d = new Date();
    var h = d.getHours();
    var seg = timeSegment(h);
    // 跨午夜（日期变化）：更新日期键，若是节日就说彩蛋（受 holidayEnabled 控制）
    var dk = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    if (dk !== lastDateKey) {
      lastDateKey = dk;
      if (YY.settings && YY.settings.holidayEnabled && holidayFor(d)) YY.dialogue.say('holiday');
      if (isAnniversary(d)) YY.dialogue.say('anniversary');   // 纪念日（设置里填了日期才会在跨日时触发）
    }
    if (seg !== lastSegment) {
      if (!YY.settings || !YY.settings.timeGreetings) {
        lastSegment = seg;          // 功能关着就静默推进，别积压到重新打开时突然补一句
      } else if (S.state !== 'SLEEP' && S.state !== 'DRAG') {
        lastSegment = seg;          // 说出来了才算「这个时段问候过」
        YY.dialogue.say(seg, 4500);
      }
      // 睡着/被拖着的时候先不说，也不消耗 lastSegment：醒来后的下一次检查会补上问候
    }
    // 特定小时的小贴士（挑非时段边界的小时，避免和时段问候重复）
    var msg = null;
    if (h === 15) msg = '下午茶时间到，休息一下嘛~';
    else if (h === 22) msg = '已经十点多了，早点休息好不好？';
    else if (h === 0) msg = '都零点了！这么晚还不睡，园园会担心的…';
    if (msg && (S.state === 'IDLE' || S.state === 'SLEEP')) YY.dialogue.showBubble(msg, 4500);
  }

  // ---------- 光标 ----------
  function onCursor(p) {
    if (S.fsHidden) return;    // 全屏隐藏期间不追踪光标
    S.lastCursor = p;
    // 拖拽中：根据前台光标的屏幕位移推算"甩动速度"（px/秒，EMA 平滑），松手时用来判断要不要把她扔出去
    if (S.state === 'DRAG' && p.x != null && YY.isElectron) {
      var tn = now();
      if (S._lastCursorScreen) {
        var ddt = tn - S._lastCursorScreen.t;
        if (ddt > 0) {
          var ivx = (p.x - S._lastCursorScreen.x) / ddt * 1000;
          var ivy = (p.y - S._lastCursorScreen.y) / ddt * 1000;
          S._dragVel.x = S._dragVel.x * 0.6 + ivx * 0.4;
          S._dragVel.y = S._dragVel.y * 0.6 + ivy * 0.4;
        }
      }
      S._lastCursorScreen = { x: p.x, y: p.y, t: tn };
    }
    // 光标移动 = 你正在用电脑 → 喂给"用太久提醒休息"的活跃计时（移动超过 8px 才算）
    if (S.lastCursorSample) {
      var mdx = p.x - S.lastCursorSample.x, mdy = p.y - S.lastCursorSample.y;
      if (mdx * mdx + mdy * mdy > 64) noteActivity();
    }
    S.lastCursorSample = { x: p.x, y: p.y };
    if (S.state === 'DRAG' || (p && p.dragging)) return; // 拖拽中不做眼睛追踪
    var sens = YY.settings ? YY.settings.eyeSensitivity : 0.6;
    var r = directionFromCursor(p.x, p.y, p.pet, sens);
    S.currentEyeDir = r.dir;
    S.cursorNear = r.near;
    // 仅在鼠标跟随且空闲时更新眼神（敲键盘播放中不打断）
    if (S.followGaze && !S.typingActive) applyGaze();
    if (S.state === 'SLEEP') {
      // 睡眠一旦进入就是独立状态：鼠标只是划过不再唤醒，只有主动「叫醒她」或点击她才醒
      return;                    // 睡着时不刷新 lastInteract，否则永远不会自动入睡
    }
    if (r.near) {
      // 你离开后又把光标挪回来 → 说"你回来啦"（away 仅在此处被清除，保证只说一次）
      if (S.away) { S.away = false; YY.dialogue.say('welcome_back'); }
      S.lastInteract = now();
    }
  }

  // 前台窗口变化（主进程每 2.5s 上报一次当前进程名）：切换应用才重置"盯同一窗口"计时，
  // 所以一直盯着同一个软件（哪怕在里头切标签页）就会持续累计，到阈值才劝你换换脑子。
  function onForegroundWindow(name) {
    if (!name) { S.windowSince = 0; S.curWindow = null; return; }
    if (name !== S.curWindow) {
      S.curWindow = name;
      S.windowSince = now();
    }
  }

  // 系统事件（主进程 powerMonitor 转发）：锁屏/休眠 → 她也说晚安并躺下；
  // 解锁/唤醒 → 她醒来打招呼。受 systemEvents 开关控制。
  function onSystemEvent(name) {
    if (!(YY.settings && YY.settings.systemEvents)) return;
    if (name === 'lock' || name === 'suspend') {
      YY.dialogue.say('system_sleep');
      if (S.state === 'IDLE') enterSleep();
    } else if (name === 'unlock' || name === 'resume') {
      if (S.state === 'SLEEP') enterWake();
      else YY.dialogue.say('system_wake');
      S.away = false; // 系统唤醒不算"你回来"再补一句 welcome_back
    }
  }

  // 电量低提醒：浏览器/Electron 均支持 navigator.getBattery()。低于 20% 且未充电 → 提醒；
  // 充上电且接近满 → 说一句"满血"。受 batteryReminder 开关控制。
  function setupBattery() {
    if (!navigator.getBattery) return;
    try {
      navigator.getBattery().then(function (b) {
        function check() {
          if (!(YY.settings && YY.settings.batteryReminder)) return;
          if (!b.charging && b.level <= 0.2) YY.dialogue.say('battery_low');
          else if (b.charging && b.level >= 0.99) YY.dialogue.say('battery_ok');
        }
        b.addEventListener('levelchange', check);
        b.addEventListener('chargingchange', check);
        check(); // 初始就是低电量也提醒一次
      }).catch(function () {});
    } catch (e) {}
  }
  // 网络掉线 / 恢复提醒：online/offline 事件。受 netStatus 开关控制。
  function setupNetStatus() {
    window.addEventListener('offline', function () {
      if (YY.settings && YY.settings.netStatus) YY.dialogue.say('offline');
    });
    window.addEventListener('online', function () {
      if (YY.settings && YY.settings.netStatus) YY.dialogue.say('online');
    });
  }

  // ---------- 初始化 ----------
  function init() {
    eyes = YY.loader.getEyes();
    S.idleToSleep = num(YY.settings.idleToSleep, 5 * 60 * 1000);
    S.roamEnabled = YY.settings.roamEnabled !== false;
    S.roamChance = num(YY.settings.roamChance, 0.3);
    S.mode = (YY.settings && YY.settings.mode) || 'idle';
    S.afkEnabled = YY.settings.afkEnabled !== false;
    S.clickAnnoy = YY.settings.clickAnnoy !== false;
    S.workReminder = YY.settings.workReminder !== false;
    S.holidayEnabled = YY.settings.holidayEnabled !== false;
    S.batteryReminder = YY.settings.batteryReminder !== false;
    S.netStatus = YY.settings.netStatus !== false;
    S.systemEvents = YY.settings.systemEvents !== false;
    S.stareReminder = YY.settings.stareReminder !== false;
    S.stareLimit = num(YY.settings.stareLimit, 25 * 60 * 1000);
    S.eyeCare = YY.settings.eyeCare !== false;
    S.eyeCareInterval = num(YY.settings.eyeCareInterval, 20);
    S.anniversaryDate = YY.settings.anniversaryDate || '';
    S.moodEnabled = YY.settings.moodEnabled !== false;
    S.mood = num(YY.settings.mood, 0);
    S.moodLevel = moodLevelFromScore(S.mood);
    S.dragThrow = YY.settings.dragThrow !== false;
    // 持久时间戳：避免每次回待机重排计时器时把累计时长清零（盯窗口 / 护眼计时都靠它们驱动）
    S.eyeCareSaidAt = now(); S.stareSaidAt = now(); S.windowSince = 0; S.curWindow = null;
    // 预置当前时段/日期，避免首检 checkTime 又重复说开机问候/节日彩蛋
    lastSegment = timeSegment(new Date().getHours());
    lastDateKey = (function () { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); })();
    if (YY.isElectron) {
      refreshDisplay();
      window.electronAPI.onCursor(onCursor);
      window.electronAPI.onSettingsChanged(onSettingsChanged);
      window.electronAPI.onKeyboardActivity(onKeyboardActivity);
      window.electronAPI.onSystemEvent(onSystemEvent);
      window.electronAPI.onPetCommand(function (cmd) {
        if (!cmd) return;
        // 全屏场景：进入全屏 → 烟雾后消失；退出全屏 → 烟雾后回到待机（主进程会先 show 窗口）
        if (cmd === 'fs-enter') { hideForFullscreen(); return; }
        if (cmd === 'fs-exit') { showFromFullscreen(); return; }
        // 前台窗口变化：更新"盯同一窗口"计时（即便全屏隐藏也照常记录，等回来再判断）
        if (cmd.indexOf('foreground-window:') === 0) { onForegroundWindow(cmd.slice('foreground-window:'.length)); return; }
        if (S.fsHidden) return;   // 全屏隐藏期间忽略其它互动
        // act:xxx —— 菜单里点某个具体动作，播一遍就回待机
        if (cmd.indexOf('act:') === 0) { playAction(cmd.slice(4)); return; }
        if (cmd === 'react') reactClick();
        else if (cmd === 'special') enterSpecial('cheer');
        else if (cmd === 'fly') enterFly();
        else if (cmd === 'sleep') enterSleep();
        else if (cmd === 'walk') enterWalk(true);
        else if (cmd === 'wake') enterWake();
        else         if (cmd === 'idle') { stopWalk(); returnIdleWithSmoke(); }
        else if (cmd === 'get-mood') { reportMood(S.moodLevel); }
      });
    } else {
      window.addEventListener('mousemove', function (e) {
        var pet = { x: window.screenX, y: window.screenY, w: window.innerWidth, h: window.innerHeight };
        onCursor({ x: e.screenX, y: e.screenY, pet: pet });
      });
    }
    resolveEyeMode();
    // 电量低提醒（navigator.getBattery，渲染端直接读，无需主进程）
    setupBattery();
    // 网络掉线 / 恢复提醒（window online/offline 事件）
    setupNetStatus();
    // 预载打字帧，键盘跟随首次触发就能立刻播放，不用等加载
    YY.loader.ensureLoaded('typing_left').then(function (f) { S.typingFrames = f; }).catch(function () {});
    enterIdle();
    // 开场动画由设置决定：候选数组可多选，开场随机播其中一个；空数组=不播开场动画
    var su = filterValidActions((YY.settings && YY.settings.startupActions) || []);
    if (su.length) {
      var suName = pickRandom(su);
      setTimeout(function () {
        if (S.state !== 'IDLE') return;
        doActionByName(suName);
      }, 700);
    }
    // 开机按时段问候（略晚于开场动作，不抢戏）
    setTimeout(greetByTime, 1500);
    // 开机节日彩蛋（晚于时段问候，不抢戏）
    setTimeout(sayHoliday, 3500);
    // 开机纪念日彩蛋（与节日错开一点，避免同一时刻抢同一个气泡）
    setTimeout(sayAnniversary, 4000);
    // 时间事件首检
    setTimeout(checkTime, 2000);
    // 打开电脑即评估提醒（生日/生理期/过期记事本），延迟到问候之后不抢戏
    setTimeout(function () { if (YY.reminders) YY.reminders.startupCheck(); }, 2600);
  }

  function onSettingsChanged(s) {
    if (!s) return;
    YY.settings = Object.assign({}, YY.settings, s);
    if (s.scale != null) {
      YY.engine.setSize(num(s.scale, 1));
      // 放大后原来的降采样帧会糊，需要按新分辨率重新加载
      if (YY.loader.setRenderSize(YY.loader.computeRenderSize()) && S.state === 'IDLE') {
        eyes = null;
        YY.loader.loadEyes().then(function (e) { eyes = e; enterIdle(); }).catch(function () { enterIdle(); });
      }
    }
    if (s.idlePoses != null && S.state === 'IDLE') enterIdle();
    // 行为模式切换（跟随↔待机）：切换后立刻回待机应用新模式
    if (s.mode != null && s.mode !== S.mode) {
      S.mode = s.mode;
      if (S.state === 'IDLE') enterIdle();
    }
    // 切换鼠标/键盘跟随时刷新待机，重新决定用眼神帧当身体还是播放打字
    if ((s.eyeFollow != null || s.keyboardFollow != null) && S.state === 'IDLE') enterIdle();
    if (s.idleToSleep != null) S.idleToSleep = num(s.idleToSleep, 5 * 60 * 1000);
    if (s.roamEnabled != null) S.roamEnabled = !!s.roamEnabled;
    if (s.roamChance != null) S.roamChance = num(s.roamChance, 0.3);
    if (s.afkEnabled != null) S.afkEnabled = !!s.afkEnabled;
    if (s.clickAnnoy != null) S.clickAnnoy = !!s.clickAnnoy;
    if (s.workReminder != null) S.workReminder = !!s.workReminder;
    if (s.holidayEnabled != null) S.holidayEnabled = !!s.holidayEnabled;
    if (s.batteryReminder != null) S.batteryReminder = !!s.batteryReminder;
    if (s.netStatus != null) S.netStatus = !!s.netStatus;
    if (s.systemEvents != null) S.systemEvents = !!s.systemEvents;
    if (s.stareReminder != null) S.stareReminder = !!s.stareReminder;
    if (s.stareLimit != null) S.stareLimit = num(s.stareLimit, 25 * 60 * 1000);
    if (s.eyeCare != null) S.eyeCare = !!s.eyeCare;
    if (s.eyeCareInterval != null) S.eyeCareInterval = num(s.eyeCareInterval, 20);
    if (s.anniversaryDate != null) S.anniversaryDate = s.anniversaryDate || '';
    if (s.moodEnabled != null) {
      S.moodEnabled = !!s.moodEnabled;
      if (!S.moodEnabled) { S.mood = 0; S.moodLevel = 'normal'; }  // 关掉心情系统 → 复位为普通
    }
    if (s.mood != null) { S.mood = num(s.mood, 0); S.moodLevel = moodLevelFromScore(S.mood); }
    if (s.dragThrow != null) S.dragThrow = !!s.dragThrow;
    // 调速：全局 speedMul 或某个动作的单独设置变了，立刻作用到正在播放的动画（不重启）
    if (s.speedMul != null || s.animSpeed != null) applyLiveSpeed();
    // 提醒设置变了：立即重新评估一次（比如当天刚开启生日提醒，应马上触发）
    if (s.reminders != null && YY.reminders) YY.reminders.tickCheck();
    refreshDisplay();
  }

  YY.behavior = {
    init: init, reactClick: reactClick, reactDblClick: reactDblClick,
    dragStart: dragStart, dragMove: dragMove, dragEnd: dragEnd,
    enterWalk: enterWalk, enterSleep: enterSleep, enterWake: enterWake,
    enterFly: enterFly, playAction: playAction, enterIdle: enterIdle,
    hideForFullscreen: hideForFullscreen, showFromFullscreen: showFromFullscreen,
    onForegroundWindow: onForegroundWindow,
    onCursor: onCursor,
    isFsHidden: function () { return S.fsHidden; },
    getState: function () { return S.state; },
    getMood: function () { return S.mood; },
    getMoodLevel: function () { return S.moodLevel; },
    adjustMood: adjustMood,
    openPanel: function () { if (YY.isElectron) window.electronAPI.openPanel(); },
    togglePet: function () { if (YY.isElectron) window.electronAPI.togglePet(); },
    hidePet: function () { if (YY.isElectron) window.electronAPI.hidePet(); },
  };
})(window.YY);

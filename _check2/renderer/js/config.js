// 全局配置与工具
window.YY = window.YY || {};
(function (YY) {
  'use strict';
  YY.BASE = 360; // 逻辑画布尺寸
  YY.dpr = (window.devicePixelRatio || 1);
  YY.assetBase = window.ASSET_BASE || null;      // 素材根目录（绝对路径，正斜杠）
  YY.manifest = window.ASSET_MANIFEST || null;
  YY.settings = null;
  YY.isElectron = !!(window.electronAPI);

  // 所有可分配给「触发条件」的动画（动作偏好里多选的候选项）。
  // 包含：react 类一次性动作、骑扫帚（定格循环）、散步、睡觉、以及四个待机姿态。
  // 排除内部过渡(smoke)、起床动画(起床)、转身(walk_left_right)等纯内部动画。
  YY.PICKABLE_ACTIONS = [
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

  // 把素材相对路径拼成可加载的 file:// URL（兼容中文/空格，保留盘符冒号）
  YY.assetURL = function (rel) {
    var base = (YY.assetBase || '').replace(/\/+$/, '');
    var full = base + '/' + rel;
    var m = full.match(/^([A-Za-z]):\/(.*)$/);
    if (m) {
      var enc = m[2].split('/').map(encodeURIComponent).join('/');
      return 'file:///' + m[1] + ':/' + enc;
    }
    // 浏览器回退：相对路径
    return '../../Material/' + rel;
  };

  YY.defaultSettings = {
    scale: 0.8, fps: 24, speedMul: 1.0, sound: false, volume: 0.6,
    eyeFollow: true, keyboardFollow: true, eyeSensitivity: 0.6, clickThrough: false,
    autoHideFullscreen: true, idleToSleep: 5 * 60 * 1000,
    roamEnabled: true, roamChance: 0.3, startOnBoot: false, petVisible: true,
    mode: 'idle',
    idlePoses: ['standing_wiggle'],
    // 互动：时段问候（开机/跨时段按系统时间说早安晚安等）、离开感知（你走开/回来她会有反应）
    timeGreetings: true,
    afkEnabled: true,
    // 感知 & 关怀：连续点闹脾气、用太久提醒休息、节日彩蛋、电量低提醒、网络掉线提醒、系统锁屏休眠反应
    clickAnnoy: true,
    workReminder: true,
    holidayEnabled: true,
    batteryReminder: true,
    netStatus: true,
    systemEvents: true,
    // 感知 & 关怀（新增）：盯同一窗口劝换脑子 / 护眼 20-20-20 / 纪念日彩蛋
    stareReminder: true,
    stareLimit: 25 * 60 * 1000,
    eyeCare: true,
    eyeCareInterval: 20,
    anniversaryDate: '',
    // 心情系统：根据互动频率累积好感度（被冷落→寂寞、被狂点→烦），影响待机微表情与主动台词
    moodEnabled: true,
    mood: 0,
    // 拖拽物理：抓住她快速甩动松手 → 抛物线飞出去，再抓住即"接住"
    dragThrow: true,
    // 动作偏好：每个触发条件可多选动画，触发时随机播其中一个。
    // startupActions：开机动画候选（空数组=不播开场）。默认 ['running_happy']（欢快跑出来打招呼）。
    // clickActions：单击动作候选（空数组=单击无反应）。默认 ['heart','covering_face']（随机比心/捂脸）。
    // multiClickActions：多次点击动作候选。默认 ['sitting_broom']（骑扫帚飞起并循环）。
    startupActions: ['running_happy'],
    clickActions: ['heart', 'covering_face'],
    multiClickActions: ['sitting_broom'],
    // 提醒功能：生日（阳历/阴历）/ 生理期（每月点选日子）/ 记事本。
    // birthday.calendar: 'solar' | 'lunar'；阳历输入且 remindBoth=true 时，额外在"阴历等价日"再提醒一次；
    // year 可选仅用于"今年 X 岁"。period.days: 每月要提醒的日号数组（1-31，可多选）。events 为记事本条目数组。
    reminders: {
      // 默认生日：阴历七月初一（出生年 2006 对应阳历 2006-07-15），每年按阴历七月初一触发
      birthday: { enabled: true, calendar: 'lunar', month: 7, day: 1, isLeap: false, year: 2006, name: '宝贝', remindBoth: false },
      period: { enabled: true, days: [14, 15, 16, 17, 18], note: '' },
      events: [],
    },
    // 右键菜单「做个动作」里展示哪些动作。null/缺省 = 全部可用；
    // 数组里写动作名（与素材 react 类动画对应）则只显示勾选的，实现个性化菜单。
    enabledActions: null,
    // 每个动作单独的速度倍率；缺省（不在对象里）表示跟随全局 speedMul。
    // 一旦为某个动作设了值，就「覆盖」全局，满足单独微调的需求。
    animSpeed: {},
  };

  // 异步加载设置
  YY.loadSettings = function () {
    if (YY.isElectron) {
      return window.electronAPI.getSettings().then(function (s) {
        YY.settings = Object.assign({}, YY.defaultSettings, s);
        return YY.settings;
      });
    }
    YY.settings = Object.assign({}, YY.defaultSettings);
    return Promise.resolve(YY.settings);
  };

  YY.saveSettings = function (patch) {
    YY.settings = Object.assign({}, YY.settings, patch);
    if (YY.isElectron) return window.electronAPI.saveSettings(patch);
    return Promise.resolve(YY.settings);
  };

  YY.clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
})(window.YY);

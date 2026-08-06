// 设置面板逻辑
window.addEventListener('DOMContentLoaded', function () {
  var els = {
    scale: document.getElementById('scale'),
    scaleV: document.getElementById('scaleV'),
    speedMul: document.getElementById('speedMul'),
    speedMulV: document.getElementById('speedMulV'),
    idlePoses: document.getElementById('idlePoses'),
    idleAll: document.getElementById('idleAll'),
    startupActions: document.getElementById('startupActions'),
    clickActions: document.getElementById('clickActions'),
    multiClickActions: document.getElementById('multiClickActions'),
    eyeFollow: document.getElementById('eyeFollow'),
    keyboardFollow: document.getElementById('keyboardFollow'),
    eyeSensitivity: document.getElementById('eyeSensitivity'),
    eyeSensitivityV: document.getElementById('eyeSensitivityV'),
    idleToSleep: document.getElementById('idleToSleep'),
    roamEnabled: document.getElementById('roamEnabled'),
    roamChance: document.getElementById('roamChance'),
    roamChanceV: document.getElementById('roamChanceV'),
    timeGreetings: document.getElementById('timeGreetings'),
    afkEnabled: document.getElementById('afkEnabled'),
    clickAnnoy: document.getElementById('clickAnnoy'),
    workReminder: document.getElementById('workReminder'),
    holidayEnabled: document.getElementById('holidayEnabled'),
    batteryReminder: document.getElementById('batteryReminder'),
    netStatus: document.getElementById('netStatus'),
    systemEvents: document.getElementById('systemEvents'),
    stareReminder: document.getElementById('stareReminder'),
    eyeCare: document.getElementById('eyeCare'),
    anniversaryDate: document.getElementById('anniversaryDate'),
    moodEnabled: document.getElementById('moodEnabled'),
    dragThrow: document.getElementById('dragThrow'),
    moodDot: document.getElementById('moodDot'),
    moodText: document.getElementById('moodText'),
    clickThrough: document.getElementById('clickThrough'),
    autoHideFullscreen: document.getElementById('autoHideFullscreen'),
    startOnBoot: document.getElementById('startOnBoot'),
    // 提醒
    bdEnabled: document.getElementById('bdEnabled'),
    bdName: document.getElementById('bdName'),
    bdCalendar: document.getElementById('bdCalendar'),
    bdMonth: document.getElementById('bdMonth'),
    bdDay: document.getElementById('bdDay'),
    bdMonthUnit: document.getElementById('bdMonthUnit'),
    bdDayUnit: document.getElementById('bdDayUnit'),
    bdLeapWrap: document.getElementById('bdLeapWrap'),
    bdLeap: document.getElementById('bdLeap'),
    bdYear: document.getElementById('bdYear'),
    bdYearRow: document.getElementById('bdYearRow'),
    bdRemindBoth: document.getElementById('bdRemindBoth'),
    bdRemindBothWrap: document.getElementById('bdRemindBothWrap'),
    bdLunarHint: document.getElementById('bdLunarHint'),
    pdEnabled: document.getElementById('pdEnabled'),
    pdCalendar: document.getElementById('pdCalendar'),
    pdClear: document.getElementById('pdClear'),
    pdSelCount: document.getElementById('pdSelCount'),
    pdNote: document.getElementById('pdNote'),
    evList: document.getElementById('evList'),
    evTitle: document.getElementById('evTitle'),
    evDate: document.getElementById('evDate'),
    evTime: document.getElementById('evTime'),
    evNote: document.getElementById('evNote'),
    evAdd: document.getElementById('evAdd'),
  };

  function num(v) { return parseFloat(v); }

  // 逐个动作速度设置
  var animRows = {};
  // 可用动作勾选设置（菜单「做个动作」显示哪些）
  var actionChecks = {};
  var ANIM_LABELS = {
    covering_face: '捂脸', heart: '比心', lying_read: '躺着看书',
    pout_angry: '噘嘴生气', running_happy: '开心奔跑', sitting_broom: '骑扫帚',
    sitting_read: '坐着看书', sleep: '睡觉', spinning: '转圈圈',
    standing_wiggle: '站立扭动', typing_left: '坐着敲键盘',
    walk_left_right: '转身', walk_slow_left: '慢走', '向左走': '向左走',
    '起床': '起床',
  };
  function animLabel(name) { return ANIM_LABELS[name] || name; }

  function bindRange(el, valEl, key, fmt) {
    el.addEventListener('input', function () {
      var v = num(el.value);
      valEl.textContent = fmt ? fmt(v) : v.toFixed(1);
      YY.saveSettings({ [key]: v });
    });
  }
  function bindCheck(el, key) {
    el.addEventListener('change', function () { YY.saveSettings({ [key]: el.checked }); });
  }
  function bindSelect(el, key, asNumber) {
    el.addEventListener('change', function () {
      // <select> 的 value 永远是字符串，数值项必须转回 number，
      // 否则主进程存进设置文件的是 "300000" 这种字符串，后续比较/计算会出错
      YY.saveSettings({ [key]: asNumber ? Number(el.value) : el.value });
    });
  }
  // ---------- 待机姿态多选 ----------
  // 从素材清单动态生成全部可选动作（排除纯过渡特效 smoke），可循环的待机/散步/睡觉类排在前面。
  var IDLE_POSE_OPTIONS = (function () {
    var anims = (window.ASSET_MANIFEST && window.ASSET_MANIFEST.animations) || {};
    var labs = window.POSE_LABELS || {};
    return Object.keys(anims)
      .filter(function (n) { return n !== 'smoke'; })
      .sort(function (a, b) {
        var la = !!(anims[a] && anims[a].loop), lb = !!(anims[b] && anims[b].loop);
        return (lb ? 1 : 0) - (la ? 1 : 0); // 可循环的姿态排前面
      })
      .map(function (n) { return { value: n, label: labs[n] || n }; });
  })();
  var idlePoseChecks = {}; // value -> checkboxEl
  function buildIdlePoseChecks() {
    var c = els.idlePoses;
    if (!c) return;
    c.innerHTML = '';
    idlePoseChecks = {};
    IDLE_POSE_OPTIONS.forEach(function (o) {
      var row = document.createElement('div');
      row.className = 'anim-row';
      var cb = document.createElement('input');
      cb.type = 'checkbox'; cb.className = 'anim-check'; cb.value = o.value;
      var lab = document.createElement('span');
      lab.className = 'anim-name'; lab.textContent = o.label;
      row.appendChild(cb); row.appendChild(lab);
      c.appendChild(row);
      idlePoseChecks[o.value] = cb;
      cb.addEventListener('change', onIdlePoseChange);
    });
  }
  function onIdlePoseChange() {
    var sel = [];
    IDLE_POSE_OPTIONS.forEach(function (o) {
      if (idlePoseChecks[o.value] && idlePoseChecks[o.value].checked) sel.push(o.value);
    });
    if (sel.length === 0) { this.checked = true; sel = [this.value]; } // 不允许全空
    YY.saveSettings({ idlePoses: sel });
    refreshIdleAllBtn();
  }
  function populateIdlePoses(arr) {
    var set = Array.isArray(arr) ? new Set(arr) : new Set();
    IDLE_POSE_OPTIONS.forEach(function (o) {
      if (idlePoseChecks[o.value]) idlePoseChecks[o.value].checked = set.has(o.value);
    });
    refreshIdleAllBtn();
  }
  function bindIdleAll() {
    if (!els.idleAll) return;
    els.idleAll.addEventListener('click', function () {
      var allChecked = IDLE_POSE_OPTIONS.every(function (o) {
        return idlePoseChecks[o.value] && idlePoseChecks[o.value].checked;
      });
      IDLE_POSE_OPTIONS.forEach(function (o) {
        if (idlePoseChecks[o.value]) idlePoseChecks[o.value].checked = !allChecked;
      });
      var sel = allChecked ? [] : IDLE_POSE_OPTIONS.map(function (o) { return o.value; });
      if (sel.length === 0 && IDLE_POSE_OPTIONS[0]) { // 全不选后再点=全选；但要防全空
        idlePoseChecks[IDLE_POSE_OPTIONS[0].value].checked = true;
        sel = [IDLE_POSE_OPTIONS[0].value];
      }
      YY.saveSettings({ idlePoses: sel });
      refreshIdleAllBtn();
    });
  }
  function refreshIdleAllBtn() {
    if (!els.idleAll) return;
    var allChecked = IDLE_POSE_OPTIONS.every(function (o) {
      return idlePoseChecks[o.value] && idlePoseChecks[o.value].checked;
    });
    els.idleAll.textContent = allChecked ? '全不选' : '全选';
  }

  function populate(s) {
    els.scale.value = s.scale;
    els.scaleV.textContent = num(s.scale).toFixed(1);
    populateIdlePoses(s.idlePoses);
    populateTriggerChecks('startupActions', s.startupActions);
    populateTriggerChecks('clickActions', s.clickActions);
    populateTriggerChecks('multiClickActions', s.multiClickActions);
    els.speedMul.value = s.speedMul;
    els.speedMulV.textContent = num(s.speedMul).toFixed(1);
    els.eyeFollow.checked = !!s.eyeFollow;
    els.keyboardFollow.checked = !!s.keyboardFollow;
    els.eyeSensitivity.value = s.eyeSensitivity;
    els.eyeSensitivityV.textContent = num(s.eyeSensitivity).toFixed(2);
    els.idleToSleep.value = String(s.idleToSleep);
    els.roamEnabled.checked = !!s.roamEnabled;
    els.roamChance.value = s.roamChance;
    els.roamChanceV.textContent = num(s.roamChance).toFixed(2);
    els.clickThrough.checked = !!s.clickThrough;
    els.autoHideFullscreen.checked = !!s.autoHideFullscreen;
    els.startOnBoot.checked = !!s.startOnBoot;
    els.timeGreetings.checked = !!s.timeGreetings;
    els.afkEnabled.checked = !!s.afkEnabled;
    els.clickAnnoy.checked = !!s.clickAnnoy;
    els.workReminder.checked = !!s.workReminder;
    els.holidayEnabled.checked = !!s.holidayEnabled;
    els.batteryReminder.checked = !!s.batteryReminder;
    els.netStatus.checked = !!s.netStatus;
    els.systemEvents.checked = !!s.systemEvents;
    els.stareReminder.checked = !!s.stareReminder;
    els.eyeCare.checked = !!s.eyeCare;
    els.moodEnabled.checked = !!s.moodEnabled;
    els.dragThrow.checked = !!s.dragThrow;
    // 正在编辑的日期框不要被回写，否则主进程广播回来会每选一次就重设值、光标跳末尾
    if (document.activeElement !== els.anniversaryDate) els.anniversaryDate.value = s.anniversaryDate || '';
    // 提醒设置
    var r = Object.assign({
      birthday: { enabled: true, calendar: 'solar', month: 7, day: 15, isLeap: false, year: 2006, name: '宝贝', remindBoth: true },
      period: { enabled: true, days: [14, 15, 16, 17, 18], note: '' },
      events: [],
    }, s.reminders || {});
    var bd = Object.assign({}, { enabled: true, calendar: 'solar', month: 7, day: 15, isLeap: false, year: 2006, name: '宝贝', remindBoth: true }, r.birthday || {});
    var pd = Object.assign({}, { enabled: true, days: [14, 15, 16, 17, 18], note: '' }, r.period || {});
    els.bdEnabled.checked = bd.enabled !== false;
    // 正在编辑的输入框不要被回写，否则主进程广播回来的 settings-changed 会每敲一个字就重设值、光标跳末尾
    if (document.activeElement !== els.bdName) els.bdName.value = bd.name || '';
    els.bdCalendar.value = bd.calendar === 'lunar' ? 'lunar' : 'solar';
    syncBirthdayDateControls(bd);
    if (document.activeElement !== els.bdYear) els.bdYear.value = bd.year ? String(bd.year) : '';
    els.bdRemindBoth.checked = bd.remindBoth !== false;
    els.bdRemindBothWrap.style.display = (bd.calendar === 'lunar') ? 'none' : '';
    els.pdEnabled.checked = pd.enabled !== false;
    renderPeriodCalendar(pd.days || []);
    if (document.activeElement !== els.pdNote) els.pdNote.value = pd.note || '';
    renderEvents(Array.isArray(r.events) ? r.events : []);
    // 逐个动作速度：勾选=单独设置，未勾=跟随全局
    var as = s.animSpeed || {};
    Object.keys(animRows).forEach(function (name) {
      var r = animRows[name];
      if (!r) return;
      var on = as[name] != null;
      r.check.checked = on;
      r.slider.value = on ? as[name] : 1.0;
      r.slider.disabled = !on;
      r.val.textContent = on ? Number(as[name]).toFixed(1) : '全局';
    });
    // 可用动作勾选状态：enabledActions 为 null/缺省 = 全部勾选
    var en = s.enabledActions;
    Object.keys(actionChecks).forEach(function (name) {
      var c = actionChecks[name];
      if (!c) return;
      c.checked = !en || en.indexOf(name) >= 0;
    });
    refreshActionAllBtn();
  }

  bindRange(els.scale, els.scaleV, 'scale', function (v) { return v.toFixed(1); });
  bindRange(els.speedMul, els.speedMulV, 'speedMul', function (v) { return v.toFixed(1); });
  bindRange(els.eyeSensitivity, els.eyeSensitivityV, 'eyeSensitivity', function (v) { return v.toFixed(2); });
  bindRange(els.roamChance, els.roamChanceV, 'roamChance', function (v) { return v.toFixed(2); });
  bindCheck(els.eyeFollow, 'eyeFollow');
  bindCheck(els.keyboardFollow, 'keyboardFollow');
  bindSelect(els.idleToSleep, 'idleToSleep', true);
  // 待机姿态多选：动态渲染勾选框 + 全选按钮
  buildIdlePoseChecks();
  bindIdleAll();
  bindCheck(els.roamEnabled, 'roamEnabled');
  bindCheck(els.clickThrough, 'clickThrough');
  bindCheck(els.autoHideFullscreen, 'autoHideFullscreen');
  bindCheck(els.startOnBoot, 'startOnBoot');
  bindCheck(els.timeGreetings, 'timeGreetings');
  bindCheck(els.afkEnabled, 'afkEnabled');
  bindCheck(els.clickAnnoy, 'clickAnnoy');
  bindCheck(els.workReminder, 'workReminder');
  bindCheck(els.holidayEnabled, 'holidayEnabled');
  bindCheck(els.batteryReminder, 'batteryReminder');
  bindCheck(els.netStatus, 'netStatus');
  bindCheck(els.systemEvents, 'systemEvents');
  bindCheck(els.stareReminder, 'stareReminder');
  bindCheck(els.eyeCare, 'eyeCare');
  bindCheck(els.moodEnabled, 'moodEnabled');
  bindCheck(els.dragThrow, 'dragThrow');
  els.anniversaryDate.addEventListener('change', function () {
    YY.saveSettings({ anniversaryDate: els.anniversaryDate.value || '' });
  });

  // ---------- 提醒设置 ----------
  function fillSelect(el, from, to) {
    if (!el || el.options.length) return;
    for (var i = from; i <= to; i++) {
      var o = document.createElement('option');
      o.value = String(i); o.textContent = String(i);
      el.appendChild(o);
    }
  }
  // 重新按范围生成选项（阳历日 1-31 / 阴历日 1-30，需随日历类型重建）
  function fillSelectRange(el, from, to) {
    if (!el) return;
    while (el.options.length) el.remove(0);
    for (var i = from; i <= to; i++) {
      var o = document.createElement('option');
      o.value = String(i); o.textContent = String(i);
      el.appendChild(o);
    }
  }
  fillSelect(els.bdMonth, 1, 12);
  fillSelect(els.bdDay, 1, 31);

  function getReminders() {
    var s = YY.settings || {};
    var base = s.reminders || {};
    return {
      birthday: Object.assign({}, { enabled: true, calendar: 'solar', month: 7, day: 15, isLeap: false, year: 0, name: '宝贝', remindBoth: true }, base.birthday || {}),
      period: Object.assign({}, { enabled: true, days: [], note: '' }, base.period || {}),
      events: Array.isArray(base.events) ? base.events : [],
    };
  }
  function saveReminders(r) { YY.saveSettings({ reminders: r }); }

  function isLunarNow() { return (els.bdCalendar.value || 'solar') === 'lunar'; }

  // 按当前生日值同步「月/日范围 + 闰月/年份显隐 + 提示」
  function syncBirthdayDateControls(bd) {
    if (!bd) return;
    var lunar = isLunarNow();
    fillSelectRange(els.bdMonth, 1, 12);
    fillSelectRange(els.bdDay, 1, lunar ? 30 : 31);
    els.bdMonth.value = String(bd.month || (lunar ? 1 : 7));
    els.bdDay.value = String(Math.min(bd.day || 1, lunar ? 30 : 31));
    els.bdLeapWrap.style.display = lunar ? '' : 'none';
    els.bdLeap.checked = !!bd.isLeap;
    els.bdMonthUnit.textContent = lunar ? '农月' : '月';
    els.bdDayUnit.textContent = lunar ? '农日' : '日';
    els.bdYearRow.style.display = lunar ? 'none' : '';
    els.bdRemindBothWrap.style.display = lunar ? 'none' : '';
    updateBirthdayHint(bd);
  }

  // 提示：明确「只按选定日历」提醒一次，并展示今年对应阳历日（阴历用 lunar.js 换算）
  function updateBirthdayHint(bd) {
    if (!els.bdLunarHint) return;
    var curYear = new Date().getFullYear();
    if (isLunarNow()) {
      if (!YY.lunar) { els.bdLunarHint.textContent = '阴历生日：无法换算'; return; }
      var sol = YY.lunar.lunarToSolar(curYear, Number(bd.month) || 1, Number(bd.day) || 1, !!bd.isLeap);
      els.bdLunarHint.textContent = sol
        ? ('阴历 ' + YY.lunar.formatLunar({ lMonth: bd.month, lDay: bd.day, isLeap: bd.isLeap }) + ' → 今年阳历 ' + sol.month + '月' + sol.day + '日 提醒')
        : '阴历生日：今年该日期不存在（如选了 30 但当月只有 29 天）';
    } else {
      var age = (bd.year && bd.year > 0) ? ('（今年 ' + (curYear - bd.year) + ' 岁）') : '';
      var txt = '阳历 ' + (bd.month || '?') + '月' + (bd.day || '?') + '日 提醒' + age;
      if (bd.remindBoth !== false && YY.lunar) {
        var lu = YY.lunar.solarToLunar(bd.year || curYear, Number(bd.month) || 1, Number(bd.day) || 1);
        if (lu) {
          var eq = YY.lunar.lunarToSolar(curYear, lu.lMonth, lu.lDay, lu.isLeap);
          if (eq) txt += '；阴历 ' + YY.lunar.formatLunar(lu) + ' → 今年阳历 ' + eq.month + '月' + eq.day + '日 也提醒';
        }
      }
      els.bdLunarHint.textContent = txt;
    }
  }

  function onBirthdayChange() {
    var r = getReminders();
    r.birthday.enabled = els.bdEnabled.checked;
    r.birthday.name = els.bdName.value.trim() || '宝贝';
    var lunar = isLunarNow();
    r.birthday.calendar = lunar ? 'lunar' : 'solar';
    r.birthday.month = parseInt(els.bdMonth.value, 10) || (lunar ? 1 : 7);
    r.birthday.day = Math.min(parseInt(els.bdDay.value, 10) || 1, lunar ? 30 : 31);
    r.birthday.isLeap = lunar ? els.bdLeap.checked : false;
    var yv = parseInt(els.bdYear.value, 10);
    r.birthday.year = (!lunar && yv >= 1900 && yv <= 2100) ? yv : 0;
    r.birthday.remindBoth = els.bdRemindBoth.checked;
    updateBirthdayHint(r.birthday);
    saveReminders(r);
  }
  // 切换阳历/阴历：重建月/日范围 + 显隐闰月/年份，再保存
  function onCalendarChange() {
    var lunar = isLunarNow();
    fillSelectRange(els.bdMonth, 1, 12);
    fillSelectRange(els.bdDay, 1, lunar ? 30 : 31);
    els.bdLeapWrap.style.display = lunar ? '' : 'none';
    els.bdMonthUnit.textContent = lunar ? '农月' : '月';
    els.bdDayUnit.textContent = lunar ? '农日' : '日';
    els.bdYearRow.style.display = lunar ? 'none' : '';
    els.bdRemindBothWrap.style.display = lunar ? 'none' : '';
    onBirthdayChange();
  }

  // 生理期：31 天可点日历
  function renderPeriodCalendar(selectedDays) {
    if (!els.pdCalendar) return;
    var set = {};
    (selectedDays || []).forEach(function (d) { set[d] = true; });
    els.pdCalendar.innerHTML = '';
    for (var d = 1; d <= 31; d++) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pd-day' + (set[d] ? ' selected' : '');
      b.textContent = String(d);
      b.dataset.day = String(d);
      b.addEventListener('click', onPeriodDayClick);
      els.pdCalendar.appendChild(b);
    }
    updatePeriodCount(selectedDays);
  }
  function onPeriodDayClick(e) {
    var btn = e.currentTarget;
    var day = parseInt(btn.dataset.day, 10);
    var r = getReminders();
    var days = (r.period.days || []).slice();
    var idx = days.indexOf(day);
    if (idx >= 0) days.splice(idx, 1); else days.push(day);
    days.sort(function (a, b) { return a - b; });
    r.period.days = days;
    saveReminders(r);
    btn.classList.toggle('selected');
    updatePeriodCount(days);
  }
  function updatePeriodCount(days) {
    if (els.pdSelCount) els.pdSelCount.textContent = (days && days.length) ? ('已选 ' + days.length + ' 天') : '未选';
  }

  function onPeriodChange() {
    var r = getReminders();
    r.period.enabled = els.pdEnabled.checked;
    r.period.note = els.pdNote.value;
    if (!r.period.days) r.period.days = [];
    saveReminders(r);
  }
  els.bdEnabled.addEventListener('change', onBirthdayChange);
  els.bdName.addEventListener('input', onBirthdayChange);
  els.bdCalendar.addEventListener('change', onCalendarChange);
  els.bdMonth.addEventListener('change', onBirthdayChange);
  els.bdDay.addEventListener('change', onBirthdayChange);
  els.bdLeap.addEventListener('change', onBirthdayChange);
  els.bdYear.addEventListener('input', onBirthdayChange);
  els.bdRemindBoth.addEventListener('change', onBirthdayChange);
  els.pdEnabled.addEventListener('change', onPeriodChange);
  els.pdNote.addEventListener('input', onPeriodChange);
  if (els.pdClear) els.pdClear.addEventListener('click', function () {
    var r = getReminders();
    r.period.days = [];
    saveReminders(r);
    renderPeriodCalendar([]);
  });

  function renderEvents(events) {
    if (!els.evList) return;
    els.evList.innerHTML = '';
    if (!events.length) {
      var empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = '还没有记事本提醒，下面添加一条吧~';
      els.evList.appendChild(empty);
      return;
    }
    events.forEach(function (ev) {
      var item = document.createElement('div');
      item.className = 'ev-item' + (ev.done ? ' done' : '');
      var info = document.createElement('div');
      info.className = 'ev-info';
      var t = document.createElement('div');
      t.className = 'ev-title';
      t.textContent = (ev.done ? '✓ ' : '') + (ev.title || '（无标题）');
      var meta = document.createElement('div');
      meta.className = 'ev-meta';
      meta.textContent = ev.date + (ev.time ? ' ' + ev.time : '') + (ev.note ? '  · ' + ev.note : '');
      info.appendChild(t); info.appendChild(meta);
      var doneBtn = document.createElement('button');
      doneBtn.className = 'ev-btn';
      doneBtn.textContent = ev.done ? '未完成' : '完成';
      doneBtn.addEventListener('click', function () { toggleEventDone(ev.id); });
      var delBtn = document.createElement('button');
      delBtn.className = 'ev-btn danger';
      delBtn.textContent = '删除';
      delBtn.addEventListener('click', function () { removeEvent(ev.id); });
      item.appendChild(info); item.appendChild(doneBtn); item.appendChild(delBtn);
      els.evList.appendChild(item);
    });
  }
  function currentEvents() {
    var r = getReminders();
    return Array.isArray(r.events) ? r.events : [];
  }
  function toggleEventDone(id) {
    var events = currentEvents().map(function (e) {
      return e.id === id ? Object.assign({}, e, { done: !e.done }) : e;
    });
    var r = getReminders(); r.events = events; saveReminders(r);
    renderEvents(events);
  }
  function removeEvent(id) {
    var events = currentEvents().filter(function (e) { return e.id !== id; });
    var r = getReminders(); r.events = events; saveReminders(r);
    renderEvents(events);
  }
  els.evAdd.addEventListener('click', function () {
    var title = els.evTitle.value.trim();
    var date = els.evDate.value;
    if (!title || !date) { if (window.alert) alert('请填写「标题」和「日期」'); return; }
    var events = currentEvents().slice();
    events.push({
      id: 'ev' + Date.now() + Math.floor(Math.random() * 1000),
      title: title, date: date, time: els.evTime.value || '',
      note: els.evNote.value.trim(), done: false,
    });
    var r = getReminders(); r.events = events; saveReminders(r);
    renderEvents(events);
    els.evTitle.value = ''; els.evDate.value = ''; els.evTime.value = ''; els.evNote.value = '';
  });

  // 根据素材清单生成「每个动作单独设速度」的列表（烟雾是内部过渡，不暴露）
  function buildAnimList() {
    var list = document.getElementById('animSpeedList');
    if (!list || !YY.manifest || !YY.manifest.animations) return;
    var names = Object.keys(YY.manifest.animations).filter(function (n) { return n !== 'smoke'; });
    names.forEach(function (name) {
      var row = document.createElement('div');
      row.className = 'anim-row';
      var check = document.createElement('input');
      check.type = 'checkbox'; check.className = 'anim-check';
      var label = document.createElement('span');
      label.className = 'anim-name'; label.textContent = animLabel(name);
      var slider = document.createElement('input');
      slider.type = 'range'; slider.min = '0.5'; slider.max = '2'; slider.step = '0.1'; slider.value = '1';
      slider.disabled = true;
      var val = document.createElement('span');
      val.className = 'val'; val.textContent = '全局';
      row.appendChild(check); row.appendChild(label); row.appendChild(slider); row.appendChild(val);
      list.appendChild(row);
      animRows[name] = { check: check, slider: slider, val: val };

      check.addEventListener('change', function () {
        var as = Object.assign({}, YY.settings.animSpeed || {});
        if (check.checked) {
          as[name] = Number(slider.value) || 1.0;
          slider.disabled = false;
        } else {
          delete as[name];
          slider.disabled = true;
          val.textContent = '全局';
        }
        YY.saveSettings({ animSpeed: as });
      });
      slider.addEventListener('input', function () {
        if (!check.checked) return;
        var as = Object.assign({}, YY.settings.animSpeed || {});
        as[name] = Number(slider.value);
        val.textContent = Number(slider.value).toFixed(1);
        YY.saveSettings({ animSpeed: as });
      });
    });
  }
  // 可用动作开关：从「全部可触发动画」（与素材同源、与右键菜单 ALL_ACTIONS 一致）生成，
  // 勾选状态写入 enabledActions。列表与「动作偏好」用同一份 PICKABLE_ACTIONS，保证菜单能选的这里都能勾。
  function buildActionList() {
    var list = document.getElementById('actionToggleList');
    if (!list || !YY.PICKABLE_ACTIONS) return;
    YY.PICKABLE_ACTIONS.forEach(function (a) {
      var name = a.name;
      var row = document.createElement('div');
      row.className = 'anim-row';
      var check = document.createElement('input');
      check.type = 'checkbox'; check.className = 'anim-check';
      var label = document.createElement('span');
      label.className = 'anim-name'; label.textContent = a.label || animLabel(name);
      row.appendChild(check); row.appendChild(label);
      list.appendChild(row);
      actionChecks[name] = check;
      check.addEventListener('change', function () {
        // 直接从当前各勾选框状态算出启用的动作名数组
        var all = YY.PICKABLE_ACTIONS.map(function (x) { return x.name; });
        var next = all.filter(function (n) { return actionChecks[n] && actionChecks[n].checked; });
        YY.saveSettings({ enabledActions: next });
        refreshActionAllBtn();
      });
    });
    // 「全选 / 全不选」一键切换（与动作偏好的三个列表一致）
    var btn = list.parentElement.querySelector('.mini-btn[data-all="enabledActions"]');
    if (btn) {
      btn.addEventListener('click', function () {
        var allChecked = YY.PICKABLE_ACTIONS.every(function (a) { return actionChecks[a.name] && actionChecks[a.name].checked; });
        setAllAction(!allChecked);
      });
    }
    refreshActionAllBtn();
  }
  // 一键全选 / 全不选：写回 enabledActions 并刷新按钮文案
  function setAllAction(on) {
    var all = YY.PICKABLE_ACTIONS.map(function (x) { return x.name; });
    all.forEach(function (n) { if (actionChecks[n]) actionChecks[n].checked = on; });
    YY.saveSettings({ enabledActions: on ? all.slice() : [] });
    refreshActionAllBtn();
  }
  // 按钮文案随勾选状态切换：全勾=全不选，否则=全选
  function refreshActionAllBtn() {
    var btn = document.querySelector('.mini-btn[data-all="enabledActions"]');
    if (!btn || !YY.PICKABLE_ACTIONS) return;
    var allChecked = YY.PICKABLE_ACTIONS.every(function (a) { return actionChecks[a.name] && actionChecks[a.name].checked; });
    btn.textContent = allChecked ? '全不选' : '全选';
  }
  buildAnimList();
  buildActionList();
  // 动作偏好：每个触发条件从「所有动画」里多选，触发时随机播其中一个。
  // 选项取自 YY.PICKABLE_ACTIONS（与素材同源，且排除内部过渡等不可分配动画）。
  var triggerChecks = {}; // key -> { 动画名: checkboxEl }
  var allBtns = {};        // key -> 工具栏「全选」按钮 el
  function buildTriggerChecks(container, key) {
    if (!container || !YY.PICKABLE_ACTIONS) return;
    triggerChecks[key] = {};
    YY.PICKABLE_ACTIONS.forEach(function (a) {
      var row = document.createElement('div');
      row.className = 'anim-row';
      var check = document.createElement('input');
      check.type = 'checkbox'; check.className = 'anim-check';
      var label = document.createElement('span');
      label.className = 'anim-name'; label.textContent = a.label;
      row.appendChild(check); row.appendChild(label);
      container.appendChild(row);
      triggerChecks[key][a.name] = check;
      check.addEventListener('change', function () {
        // 直接从所有勾选框状态算出当前选中的动画名数组（空数组=该触发无动作）
        var all = YY.PICKABLE_ACTIONS.map(function (x) { return x.name; });
        var next = all.filter(function (n) { return triggerChecks[key][n] && triggerChecks[key][n].checked; });
        var patch = {}; patch[key] = next;
        YY.saveSettings(patch);
        refreshAllBtn(key); // 手动改勾选后同步按钮文案
      });
    });
    // 工具栏「全选 / 全不选」一键切换按钮
    var btn = container.parentElement.querySelector('.mini-btn[data-all="' + key + '"]');
    if (btn) {
      allBtns[key] = btn;
      btn.addEventListener('click', function () {
        var map = triggerChecks[key];
        var names = Object.keys(map);
        var allChecked = names.length > 0 && names.every(function (n) { return map[n].checked; });
        setAllTrigger(key, !allChecked);
      });
    }
  }
  // 一键全选 / 全不选：设置该列表全部勾选框并写入设置
  function setAllTrigger(key, checked) {
    var map = triggerChecks[key];
    if (!map) return;
    var names = Object.keys(map);
    names.forEach(function (n) { map[n].checked = checked; });
    var patch = {}; patch[key] = checked ? names.slice() : [];
    YY.saveSettings(patch);
    refreshAllBtn(key);
  }
  // 按当前勾选情况更新按钮文案（全勾上→「全不选」，否则→「全选」）
  function refreshAllBtn(key) {
    var btn = allBtns[key];
    var map = triggerChecks[key];
    if (!btn || !map) return;
    var names = Object.keys(map);
    var allChecked = names.length > 0 && names.every(function (n) { return map[n].checked; });
    btn.textContent = allChecked ? '全不选' : '全选';
  }
  // 把设置里的数组同步成勾选状态（主进程广播回来时也会调用，但不动正在编辑的输入框）
  function populateTriggerChecks(key, arr) {
    var map = triggerChecks[key];
    if (!map) return;
    var set = Array.isArray(arr) ? new Set(arr) : new Set();
    Object.keys(map).forEach(function (name) { map[name].checked = set.has(name); });
    refreshAllBtn(key); // 同步后刷新按钮文案
  }
  buildTriggerChecks(els.startupActions, 'startupActions');
  buildTriggerChecks(els.clickActions, 'clickActions');
  buildTriggerChecks(els.multiClickActions, 'multiClickActions');

  document.getElementById('btnTouch').addEventListener('click', function () {
    if (YY.isElectron) window.electronAPI.sendPetCommand('react');
  });
  document.getElementById('btnHide').addEventListener('click', function () {
    if (YY.isElectron) window.electronAPI.hidePet();
  });
  document.getElementById('btnShow').addEventListener('click', function () {
    if (YY.isElectron) window.electronAPI.showPet();
  });
  document.getElementById('btnQuit').addEventListener('click', function () {
    if (YY.isElectron) window.electronAPI.quit();
  });

  // 同步来自宠物的设置变更
  if (YY.isElectron) {
    window.electronAPI.onSettingsChanged(function (s) { populate(s); });
  }

  // 心情系统：实时刷新心情胶囊（宠物上报情绪档时更新；打开面板时先问一次当前值）
  var MOOD_LABEL = { happy: '开心', normal: '普通', lonely: '寂寞', annoyed: '烦' };
  function setMood(level) {
    if (!els.moodDot) return;
    var lvl = MOOD_LABEL[level] ? level : 'normal';
    els.moodDot.className = 'mood-dot ' + lvl;
    els.moodText.textContent = MOOD_LABEL[lvl];
  }
  if (YY.isElectron) {
    if (window.electronAPI.onMood) window.electronAPI.onMood(setMood);
    // 面板打开时宠物可能早就上报过，这里主动向宠物要一次当前心情
    window.electronAPI.sendPetCommand('get-mood');
  }

  YY.loadSettings().then(populate);
});

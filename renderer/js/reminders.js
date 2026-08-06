// 提醒引擎：生日（阳历输入时，阳历当天 + 阴历等价日 每年各提醒一次）/ 生理期（每月点选的日子提醒）/ 记事本（按日期时间提醒）
// 触发时通过 YY.dialogue 冒泡 + YY.behavior 播放彩蛋动作，并对已完成的记事本事件持久化标记。
// 全部基于 YY.settings.reminders，设置变更即时生效（每次检查都实时读 YY.settings）。
window.YY = window.YY || {};
(function (YY) {
  'use strict';
  var L = YY.lunar;

  // 与 main.js / config.js 中的默认值保持一致
  var DEFAULTS = {
    birthday: { enabled: true, calendar: 'solar', month: 7, day: 15, isLeap: false, year: 2006, name: '宝贝', remindBoth: true },
    period: { enabled: true, days: [14, 15, 16, 17, 18], note: '' },
    events: [],
  };

  // 兼容旧版数据：把「阳历月/日 + 写死年份」的老结构迁移成新结构。
  // 老生日 = { enabled, solarMonth, solarDay, year, name } → 阴历等价被丢弃（当年双响是 bug，不再需要）。
  // 老生理期 = { enabled, dayOfMonth, leadDays, note } → dayOfMonth 转成 days:[dayOfMonth]（leadDays 不再使用）。
  function normalizeBirthday(b) {
    if (!b) return null;
    if (b.calendar) return b; // 已经是新结构
    if (b.solarMonth != null || b.solarDay != null) {
      return {
        enabled: b.enabled !== false,
        calendar: 'solar',
        month: clampInt(b.solarMonth, 1, 12, 7),
        day: clampInt(b.solarDay, 1, 31, 15),
        isLeap: false,
        year: clampInt(b.year, 1900, 2100, 0),
        name: typeof b.name === 'string' ? b.name : '宝贝',
      };
    }
    return b;
  }
  function normalizePeriod(p) {
    if (!p) return null;
    if (p.days && Array.isArray(p.days)) return p; // 已经是新结构
    if (p.dayOfMonth != null) {
      return {
        enabled: p.enabled !== false,
        days: [clampInt(p.dayOfMonth, 1, 31, 18)],
        note: typeof p.note === 'string' ? p.note : '',
      };
    }
    return p;
  }
  function clampInt(v, min, max, dft) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) return dft;
    return Math.min(max, Math.max(min, n));
  }

  function getR() {
    var s = (YY.settings && YY.settings.reminders) || {};
    var bd = normalizeBirthday(s.birthday) || Object.assign({}, DEFAULTS.birthday);
    var pd = normalizePeriod(s.period) || Object.assign({}, DEFAULTS.period);
    return {
      birthday: Object.assign({}, DEFAULTS.birthday, bd),
      period: Object.assign({}, DEFAULTS.period, pd),
      events: Array.isArray(s.events) ? s.events : [],
    };
  }

  // 防重复触发：生日每年一次（按年），生理期每个「被点选的日子」每月一次（按 年-月-日）
  var fired = { birthdayKey: '', periodKey: 0 };

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function today() {
    var d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), date: d };
  }

  // 生日今年对应的阳历日期（用于判定 + 面板提示）。阴历每年阳历日不同。
  function birthdaySolarThisYear(bd, curYear) {
    if (!bd) return null;
    if (bd.calendar === 'lunar') {
      if (!L) return null;
      // 阴历月只有 29/30 天，选了 30 但该年该月只有 29 天 → 不存在，不提醒
      if (bd.day > L.monthDays(curYear, bd.month)) return null;
      return L.lunarToSolar(curYear, bd.month, bd.day, bd.isLeap);
    }
    return { year: curYear, month: bd.month, day: bd.day };
  }

  // ---------- 触发动作 ----------
  function canFire() {
    // 正在被拖拽就不抢戏；其余状态（含睡觉）都能冒泡提醒
    return YY.behavior && YY.behavior.getState && YY.behavior.getState() !== 'DRAG';
  }

  function eggBirthday(bd, which) {
    if (!canFire()) return;
    var name = (bd && bd.name) || '宝贝';
    var age = (bd && bd.year && bd.year > 0) ? (new Date().getFullYear() - bd.year) : null;
    var prefix = (which === 'lunar') ? '阴历生日快乐' : '生日快乐';
    YY.dialogue.showBubble('叮咚～今天有个小惊喜 🎁', 2600);
    setTimeout(function () {
      if (YY.behavior && YY.behavior.playAction) YY.behavior.playAction('spinning');
    }, 900);
    setTimeout(function () {
      if (!canFire()) return;
      var msg = '🎂 ' + prefix + '，' + name + '！园园也超爱你～';
      if (age != null && age >= 0 && age < 200) msg = '🎂 ' + prefix + '，' + name + '！今年 ' + age + ' 岁啦～园园也超爱你 💕';
      YY.dialogue.showBubble(msg, 6500);
      if (YY.behavior && YY.behavior.playAction) YY.behavior.playAction('heart');
    }, 2200);
  }

  function remindPeriod(note) {
    if (!canFire()) return;
    var msg = note && note.trim() ? note.trim() : '今天要记得好好照顾自己哦，别太累～';
    YY.dialogue.showBubble('💗 ' + msg, 6000);
    if (YY.behavior && YY.behavior.playAction) {
      setTimeout(function () { if (canFire()) YY.behavior.playAction('heart'); }, 700);
    }
  }

  function remindEvent(ev) {
    if (!canFire()) return;
    var parts = ['📌 ' + (ev.title || '提醒')];
    if (ev.time) parts.push('（' + ev.time + '）');
    var msg = parts.join(' ');
    if (ev.note && ev.note.trim()) msg += '  ' + ev.note.trim();
    YY.dialogue.showBubble(msg, 6500);
  }

  // ---------- 判定 ----------
  // 返回 false，或 { which: 'solar' | 'lunar' } 表示今天命中了哪个日历的生日。
  // 阳历输入 + 开启「同时提醒阴历」时，会在「阳历当天」与「阴历等价日（不同物理日）」各命中一次。
  function isBirthdayToday(bd) {
    if (!bd || bd.enabled === false) return false;
    var t = today();
    // 输入日期（按其自身日历）在今年对应的阳历日
    var inputSolar = birthdaySolarThisYear(bd, t.y);
    if (inputSolar && inputSolar.year === t.y && inputSolar.month === t.m && inputSolar.day === t.d) {
      return { which: bd.calendar === 'lunar' ? 'lunar' : 'solar' };
    }
    // 阳历输入 + 开启「同时提醒阴历」：再判断是否命中阴历等价日
    // （阴历等价日与阳历日是不同的一天，绝不会同天重复触发）
    if (bd.calendar === 'solar' && bd.remindBoth !== false && L) {
      var lu = L.solarToLunar(bd.year || t.y, bd.month, bd.day);
      if (lu) {
        var eq = L.lunarToSolar(t.y, lu.lMonth, lu.lDay, lu.isLeap);
        if (eq && eq.year === t.y && eq.month === t.m && eq.day === t.d) return { which: 'lunar' };
      }
    }
    return false;
  }

  function periodInDays(p) {
    if (!p || p.enabled === false || !p.days || !p.days.length) return false;
    var t = today();
    return p.days.indexOf(t.d) >= 0;
  }

  function eventDue(ev) {
    if (!ev || ev.done) return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ev.date || '')) return false;
    var iso = ev.date + (ev.time ? 'T' + ev.time : 'T00:00');
    var dt = new Date(iso);
    if (isNaN(dt.getTime())) return false;
    return Date.now() >= dt.getTime();
  }

  // ---------- 执行一次检查 ----------
  function run() {
    if (!YY.settings) return;
    var r = getR();

    // 生日：命中当天 → 触发彩蛋（阳历当天 + 阴历等价日各一次，按「年-日历」去重，避免每天 tick 重复）
    if (r.birthday.enabled) {
      var hit = isBirthdayToday(r.birthday);
      if (hit) {
        var bkey = today().y + '-' + hit.which;
        if (fired.birthdayKey !== bkey) {
          fired.birthdayKey = bkey;
          eggBirthday(r.birthday, hit.which);
        }
      }
    }

    // 生理期：每月点选的日子内提醒一次（每个被点选的日号独立计一次）
    if (r.period.enabled) {
      var t = today();
      var key = t.y * 372 + (t.m - 1) * 31 + t.d; // 按真实年月日去重，每月每号仅一次
      if (periodInDays(r.period) && fired.periodKey !== key) {
        fired.periodKey = key;
        remindPeriod(r.period.note);
      }
    }

    // 记事本：到时间且未完成 → 提醒并标记完成
    if (r.events.length) {
      var changed = false;
      var evs = r.events.map(function (ev) {
        if (eventDue(ev)) {
          remindEvent(ev);
          changed = true;
          return Object.assign({}, ev, { done: true });
        }
        return ev;
      });
      if (changed) {
        // 持久化：把完成态写回设置
        YY.saveSettings({ reminders: Object.assign({}, YY.settings.reminders, { events: evs }) });
      }
    }
  }

  YY.reminders = {
    DEFAULTS: DEFAULTS,
    getR: getR,
    birthdaySolarThisYear: birthdaySolarThisYear,
    isBirthdayToday: isBirthdayToday,
    periodInDays: periodInDays,
    eventDue: eventDue,
    // 打开电脑 / 设置变更后：立即评估一次
    startupCheck: function () { try { run(); } catch (e) { console.warn('[园园·提醒]', e); } },
    tickCheck: function () { try { run(); } catch (e) { console.warn('[园园·提醒]', e); } },
  };
})(window.YY);

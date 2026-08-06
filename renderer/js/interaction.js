// 交互层：把 DOM 事件映射到行为（点击/双击/拖拽/右键菜单/透明区域穿透）
window.YY = window.YY || {};
(function (YY) {
  'use strict';

  var downBtn, downX, downY, dragging = false, moved = false, clickTimer = null;
  var menuOpen = false;
  var hitTransparent = false, lastHitCheck = 0, hitEnabled = true;

  function menuEl() { return document.getElementById('ctxMenu'); }

  // ---------- 透明区域穿透 ----------
  // 桌宠窗口是 360×360 的方块，但人物只占中间一小块。
  // 不做处理的话，人物四周那一大圈全透明区域会把桌面图标的点击全吃掉。
  function setTransparent(on) {
    if (on === hitTransparent) return;
    hitTransparent = on;
    if (YY.isElectron) window.electronAPI.setHitTransparent(on);
  }

  function updateHitTest(x, y, force) {
    if (!hitEnabled || !YY.isElectron) return;
    if (dragging || menuOpen || (YY.settings && YY.settings.clickThrough)) { setTransparent(false); return; }
    var t = Date.now();
    if (!force && t - lastHitCheck < 60) return;
    lastHitCheck = t;
    var op = YY.engine.isOpaqueAt(x, y);
    if (op === null) { hitEnabled = false; setTransparent(false); return; }
    setTransparent(!op);
  }

  // ---------- 右键菜单 ----------
  // Electron 下走主进程的原生菜单：桌宠窗口只有 360px 见方，HTML 菜单既塞不下这么多动作，
  // 也没法弹到窗口外面去。原生菜单没有这个限制，还自带多级子菜单。
  // 下面这份 HTML 菜单只在浏览器调试环境（非 Electron）里作为退路。
  function showContextMenu(x, y) {
    if (YY.isElectron && window.electronAPI.showContextMenu) {
      hideMenu();
      setTransparent(false);
      window.electronAPI.showContextMenu();
      return;
    }
    var menu = menuEl();
    if (!menu) return;
    // 单发动作按设置里勾选的「可用动作」过滤（与右键原生菜单保持一致）
    var actionDefs = {
      heart: { t: '比心', fn: function () { YY.behavior.playAction('heart'); } },
      covering_face: { t: '害羞捂脸', fn: function () { YY.behavior.playAction('covering_face'); } },
      pout_angry: { t: '嘟嘴生气', fn: function () { YY.behavior.playAction('pout_angry'); } },
      spinning: { t: '转圈圈', fn: function () { YY.behavior.playAction('spinning'); } },
      running_happy: { t: '欢快地跑', fn: function () { YY.behavior.playAction('running_happy'); } },
      sitting_broom: { t: '骑扫帚', fn: function () { YY.behavior.enterFly(); } },
    };
    var enabled = (YY.settings && YY.settings.enabledActions) || Object.keys(actionDefs);
    var actionItems = enabled
      .filter(function (n) { return actionDefs[n]; })
      .map(function (n) { return actionDefs[n]; });
    var items = [
      { t: '摸摸头', fn: function () { YY.behavior.reactClick(); } },
      { t: '骑扫帚飞起来', fn: function () { YY.behavior.enterFly(); } },
    ];
    actionItems.forEach(function (it) { items.push(it); });
    items.push(
      { t: '去散步', fn: function () { YY.behavior.enterWalk(true); } },
      { t: '睡一会', fn: function () { YY.behavior.enterSleep(); } },
      { t: '叫醒', fn: function () { YY.behavior.enterWake(); } },
      { t: '回到待机', fn: function () { YY.behavior.enterIdle(); } },
      { t: '设 置', fn: function () { YY.behavior.openPanel(); } },
      { t: '隐藏园园', fn: function () { YY.behavior.hidePet(); } },
      { t: '穿透切换', fn: toggleClickThrough }
    );
    menu.innerHTML = '';
    items.forEach(function (it) {
      var el = document.createElement('div');
      el.className = 'ctx-item';
      el.textContent = it.t;
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        hideMenu();
        it.fn();
      });
      menu.appendChild(el);
    });
    menu.classList.remove('hidden');
    menuOpen = true;
    setTransparent(false); // 菜单打开期间整窗必须可点

    // 定位并裁剪在窗口内（用真实尺寸，别用估算值）
    var w = window.innerWidth, h = window.innerHeight;
    var mw = menu.offsetWidth || 132, mh = menu.offsetHeight || 250;
    menu.style.left = YY.clamp(x, 4, Math.max(4, w - mw - 4)) + 'px';
    menu.style.top = YY.clamp(y, 4, Math.max(4, h - mh - 4)) + 'px';
  }

  function hideMenu() {
    var menu = menuEl();
    if (menu) menu.classList.add('hidden');
    menuOpen = false;
  }

  function toggleClickThrough() {
    var v = !(YY.settings && YY.settings.clickThrough);
    YY.saveSettings({ clickThrough: v });
    if (v) YY.dialogue.showBubble('园园变成幽灵啦～托盘菜单里可以变回来', 4000);
  }

  function endDrag() {
    if (dragging && downBtn === 0) YY.behavior.dragEnd();
    dragging = false;
    downBtn = undefined;
  }

  function init(canvas) {
    var pointerId = null;

    canvas.addEventListener('pointerdown', function (e) {
      downBtn = e.button; downX = e.clientX; downY = e.clientY; dragging = false; moved = false;
      // 左键拖拽时捕获指针：这样即使光标移出宠物窗口，pointermove/pointerup 仍会送达本窗口，
      // 避免"拖出去松开后收不到 mouseup、宠物卡在被拎起姿势"的问题。
      if (e.button === 0) {
        try { canvas.setPointerCapture(e.pointerId); pointerId = e.pointerId; } catch (_) {}
      }
    });

    window.addEventListener('pointermove', function (e) {
      if (downBtn === undefined) { updateHitTest(e.clientX, e.clientY); return; }
      var dx = e.clientX - downX, dy = e.clientY - downY;
      if (!dragging && Math.sqrt(dx * dx + dy * dy) > 5) {
        dragging = true; moved = true;
        if (downBtn === 0) YY.behavior.dragStart(e.clientX, e.clientY);
      }
      if (dragging && downBtn === 0) YY.behavior.dragMove(e.clientX, e.clientY);
    });

    // 穿透模式下 Chromium 收到的是转发来的 mousemove，pointermove 不一定齐全，两个都听
    window.addEventListener('mousemove', function (e) {
      if (downBtn === undefined) updateHitTest(e.clientX, e.clientY);
    });

    window.addEventListener('pointerup', function (e) {
      if (downBtn === undefined) return;
      endDrag();
      if (pointerId !== null) { try { canvas.releasePointerCapture(pointerId); } catch (_) {} pointerId = null; }
      updateHitTest(e.clientX, e.clientY, true);
    });

    // 兜底：指针被系统取消（ALT+TAB、锁屏等），也要结束拖拽，避免卡在被拎起的姿势
    canvas.addEventListener('pointercancel', function () {
      endDrag();
      if (pointerId !== null) { try { canvas.releasePointerCapture(pointerId); } catch (_) {} pointerId = null; }
    });
    window.addEventListener('blur', function () {
      if (dragging) endDrag();
      hideMenu();
    });
    if (YY.isElectron && window.electronAPI.onDragAbort) {
      window.electronAPI.onDragAbort(function () { if (dragging) endDrag(); });
    }

    canvas.addEventListener('click', function () {
      if (moved) return;
      if (clickTimer) return;
      // 单击延迟必须 >= 系统双击判定窗口（Windows 默认约 500ms）。
      // 之前用 220ms，导致 220~500ms 内的双击会先播一次「单击动作」再播「飞起」，
      // 看起来就是「比心一下又突然飞走」，触发很怪。提到 420ms 后，常见速度的双击
      // 都会在单击计时器触发前被 dblclick 拦下（见下方 clearTimeout），只播飞起。
      clickTimer = setTimeout(function () { clickTimer = null; YY.behavior.reactClick(); }, 420);
    });
    canvas.addEventListener('dblclick', function () {
      if (moved) return;
      // 双击总是优先：取消尚未触发的单击，只播「多次点击」动作（默认骑扫帚飞起）
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
      YY.behavior.reactDblClick();
    });
    canvas.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY);
    });
    window.addEventListener('pointerdown', function (e) {
      var menu = menuEl();
      if (menuOpen && menu && !menu.contains(e.target)) hideMenu();
    }, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideMenu(); });
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  YY.interaction = { init: init, hideMenu: hideMenu };
})(window.YY);

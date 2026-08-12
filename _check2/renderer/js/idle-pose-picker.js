'use strict';
// 待机姿态多选浮层：独立透明窗口，可连续勾选，点窗外 / 完成 / Esc 才关。
// 不走原生菜单（Windows 上原生菜单点一个 checkbox 就整菜单关闭，无法连选）。
(function () {
  var api = window.electronAPI;
  var poses = [];
  var selected = {}; // value -> true

  function has(v) { return Object.prototype.hasOwnProperty.call(selected, v); }
  function selectedList() {
    return poses.filter(function (p) { return has(p.value); }).map(function (p) { return p.value; });
  }

  function render() {
    var list = document.getElementById('list');
    list.innerHTML = '';
    poses.forEach(function (p) {
      var row = document.createElement('label');
      row.className = 'row';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = has(p.value);
      cb.addEventListener('change', function () {
        if (cb.checked) {
          selected[p.value] = true;
        } else {
          // 不允许全空：取消最后一个时拒绝并复位勾选
          if (selectedList().length <= 1) { cb.checked = true; return; }
          delete selected[p.value];
        }
        report();
      });
      var span = document.createElement('span');
      span.textContent = p.label;
      row.appendChild(cb);
      row.appendChild(span);
      list.appendChild(row);
    });
  }

  function report() {
    api.sendIdlePickerChange(selectedList());
  }

  function init(data) {
    poses = (data && data.poses) || [];
    selected = {};
    var cur = (data && data.current) || [];
    cur.forEach(function (v) { selected[v] = true; });
    if (poses.length && !cur.length) selected[poses[0].value] = true; // 兜底：至少留一个
    render();
  }

  document.addEventListener('DOMContentLoaded', function () {
    api.onIdlePickerInit(init);

    document.getElementById('selAll').addEventListener('click', function () {
      poses.forEach(function (p) { selected[p.value] = true; });
      render(); report();
    });
    document.getElementById('selNone').addEventListener('click', function () {
      if (poses.length) {
        selected = {}; selected[poses[0].value] = true; // 清空时保留第一个
        render(); report();
      }
    });
    document.getElementById('done').addEventListener('click', function () {
      api.sendIdlePickerDone();
    });

    // 点窗口外 / 失去焦点 → 关闭
    window.addEventListener('blur', function () { api.sendIdlePickerDone(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') api.sendIdlePickerDone();
    });
  });
})();

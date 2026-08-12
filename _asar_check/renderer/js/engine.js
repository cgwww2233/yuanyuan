// 动画引擎：在画布上播放帧序列，支持身体动画 + 眼睛叠加/基础模式
window.YY = window.YY || {};
(function (YY) {
  'use strict';

  var BASE = 360; // 逻辑绘制空间
  var BUBBLE_BAND = 80; // 窗口顶部预留给对话气泡的透明带（逻辑 px）。角色绘制大小/位置不变，canvas 整体下移到带下方。

  var S = {
    canvas: null, ctx: null, dpr: 1, scale: 1,
    bodyFrames: null, bodyIndex: 0, bodyFps: 24, bodyLoop: true,
    onEnd: null, ended: false, acc: 0, lastTime: 0,
    eyeOverlay: null, eyeMode: 'base', token: 0,
    flipped: false, hitBroken: false,
  };

  // 命中测试用的小离屏画布：只在需要时按当前帧重绘一次，
  // 避免对主画布做 getImageData（GPU 回读会卡帧）。
  var HIT = { canvas: null, ctx: null, size: 96 };

  function fitContain(w, h, maxW, maxH, pad) {
    var s = Math.min(maxW / w, maxH / h) * (pad || 1);
    return { s: s, dw: w * s, dh: h * s };
  }

  function drawBody(ctx, img) {
    // 整张图等比缩放并底部对齐（不做内容裁剪，避免把角色裁到角落或框死）
    var f = fitContain(img.width, img.height, BASE, BASE, 0.98);
    var dx = (BASE - f.dw) / 2;
    var dy = BASE - f.dh; // 底部对齐
    ctx.drawImage(img, 0, 0, img.width, img.height, dx, dy, f.dw, f.dh);
  }

  function renderTo(ctx) {
    var img = S.bodyFrames && S.bodyFrames[S.bodyIndex];
    if (img) drawBody(ctx, img);
    // 眼睛跟随已改为「眼神帧直接当身体」(setStatic)，不再叠加，避免重影成两个人物
  }

  function draw() {
    var ctx = S.ctx;
    if (!ctx) return;
    ctx.setTransform(S.scale * S.dpr, 0, 0, S.scale * S.dpr, 0, 0);
    ctx.clearRect(0, 0, BASE, BASE);
    renderTo(ctx);
  }

  function loop(ts) {
    if (!S.lastTime) S.lastTime = ts;
    var dt = ts - S.lastTime; S.lastTime = ts;
    if (dt > 200) dt = 200; // 标签页切回时避免跳帧
    if (S.bodyFrames && S.bodyFps > 0 && !S.ended) {
      S.acc += dt;
      var fd = 1000 / S.bodyFps;
      var guard = 0;
      while (S.acc >= fd && guard < 8) {
        S.acc -= fd; guard++;
        S.bodyIndex++;
        if (S.bodyIndex >= S.bodyFrames.length) {
          if (S.bodyLoop) { S.bodyIndex = 0; }
          else {
            S.bodyIndex = S.bodyFrames.length - 1; S.ended = true;
            var cb = S.onEnd; S.onEnd = null;   // 只回调一次，避免 onEnd 重复触发状态切换
            if (cb) cb();
            break;
          }
        }
      }
    }
    draw();
    requestAnimationFrame(loop);
  }

  var engine = {
    init: function (canvas, scale) {
      S.canvas = canvas;
      S.ctx = canvas.getContext('2d');
      S.scale = Number(scale) || 1;
      this.setSize(S.scale);
      requestAnimationFrame(loop);
      // 跨屏 / 系统缩放变化时 devicePixelRatio 会变，画布后备尺寸要跟着更新，否则会糊
      if (window.matchMedia) {
        var watchDpr = function () {
          var mq = window.matchMedia('(resolution: ' + window.devicePixelRatio + 'dppx)');
          var handler = function () { engine.setSize(S.scale); watchDpr(); };
          if (mq.addEventListener) mq.addEventListener('change', handler, { once: true });
          else if (mq.addListener) mq.addListener(handler);
        };
        try { watchDpr(); } catch (e) {}
      }
    },
    setSize: function (scale) {
      if (!S.canvas) return;
      S.scale = Number(scale) || 1;
      S.dpr = window.devicePixelRatio || 1;
      YY.dpr = S.dpr;
      var px = Math.max(1, Math.round(BASE * S.scale * S.dpr));
      if (S.canvas.width !== px) S.canvas.width = px;
      if (S.canvas.height !== px) S.canvas.height = px;
      // 把 canvas 定位成「宽正方形 + 顶部透明气泡带」：canvas 自身仍是 BASE×BASE 正方形，
      // 只是整体下移到 BUBBLE_BAND 之下。命中测试基于 canvas 自身 rect，与窗口无关，无需改动。
      var cssSize = Math.round(BASE * S.scale);
      S.canvas.style.position = 'absolute';
      S.canvas.style.left = '0';
      S.canvas.style.top = Math.round(BUBBLE_BAND * S.scale) + 'px';
      S.canvas.style.width = cssSize + 'px';
      S.canvas.style.height = cssSize + 'px';
    },
    setBodyFrames: function (frames, opts) {
      opts = opts || {};
      S.bodyFrames = frames; S.bodyIndex = 0; S.acc = 0; S.ended = false;
      S.bodyFps = (opts.fps == null ? 24 : opts.fps); S.bodyLoop = opts.loop !== false;
      S.onEnd = opts.onEnd || null;
    },
    setBodyAnim: function (animName, opts) {
      var myToken = ++S.token;
      return YY.loader.ensureLoaded(animName).then(function (frames) {
        if (myToken !== S.token) return; // 已被更新的请求取代
        engine.setBodyFrames(frames, opts);
        YY.loader.setActive(animName);
      }).catch(function (err) {
        console.warn('[园园] 动画加载失败:', animName, err && err.message);
        // 加载失败也要把 onEnd 兑现，否则依赖 onEnd 回到 IDLE 的状态会永久卡住
        if (myToken === S.token && opts && opts.onEnd) setTimeout(opts.onEnd, 0);
      });
    },
    // 静态图（眼神帧/睡姿/被拎起）：整张图等比缩放绘制，不做内容裁剪。
    setStatic: function (img) { ++S.token; engine.setBodyFrames([img], { loop: false, fps: 0 }); },
    setEyeOverlay: function (img) { S.eyeOverlay = img || null; },
    setEyeMode: function (m) { S.eyeMode = m; },
    getEyeMode: function () { return S.eyeMode; },
    isEnded: function () { return S.ended; },
    currentIndex: function () { return S.bodyIndex; },
    // 实时改速度用：在不重置帧进度的情况下改变播放帧率（静态姿势 fps=0 时忽略）
    getCurrentFps: function () { return S.bodyFps; },
    setBodyFps: function (fps) {
      var f = Number(fps);
      if (!isFinite(f) || f <= 0) return;
      S.bodyFps = Math.max(1, Math.round(f));
    },
    setFlipped: function (on) {
      S.flipped = !!on;
      if (S.canvas) S.canvas.style.transform = on ? 'scaleX(-1)' : 'none';
    },

    // 返回 true=不透明（应该吃掉鼠标）/ false=透明（应该穿透）/ null=无法判断
    isOpaqueAt: function (clientX, clientY) {
      if (!S.canvas || S.hitBroken) return null;
      // 帧还没加载出来时先当作"实体"，免得启动瞬间整只桌宠点不动
      if (!S.bodyFrames || !S.bodyFrames.length) return true;
      var rect = S.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      var lx = (clientX - rect.left) / rect.width * BASE;
      var ly = (clientY - rect.top) / rect.height * BASE;
      if (S.flipped) lx = BASE - lx;
      if (lx < 0 || ly < 0 || lx > BASE || ly > BASE) return false;

      if (!HIT.canvas) {
        HIT.canvas = document.createElement('canvas');
        HIT.canvas.width = HIT.size; HIT.canvas.height = HIT.size;
        HIT.ctx = HIT.canvas.getContext('2d', { willReadFrequently: true });
      }
      var k = HIT.size / BASE;
      HIT.ctx.setTransform(k, 0, 0, k, 0, 0);
      HIT.ctx.clearRect(0, 0, BASE, BASE);
      renderTo(HIT.ctx);

      var r = 3; // 采样半径（≈ 逻辑 11px），让边缘也好抓一点
      var cx = Math.round(lx * k), cy = Math.round(ly * k);
      var x0 = Math.max(0, cx - r), y0 = Math.max(0, cy - r);
      var w = Math.min(HIT.size - x0, r * 2 + 1);
      var h = Math.min(HIT.size - y0, r * 2 + 1);
      if (w <= 0 || h <= 0) return false;
      try {
        var d = HIT.ctx.getImageData(x0, y0, w, h).data;
        for (var i = 3; i < d.length; i += 4) if (d[i] > 16) return true;
        return false;
      } catch (e) {
        S.hitBroken = true; // 画布被污染，放弃命中测试，保持整窗可交互
        return null;
      }
    },
  };

  YY.engine = engine;
})(window.YY);

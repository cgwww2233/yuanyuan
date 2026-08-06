// 素材加载器：预加载帧序列（带 LRU 缓存 + 降采样）、眼睛帧抠背景、自动判断叠加方式、姿势帧
window.YY = window.YY || {};
(function (YY) {
  'use strict';

  var cache = new Map();    // animName -> (Canvas|Image)[]  已解码帧
  var loading = new Map();  // animName -> Promise
  var lastUsed = new Map(); // animName -> 时间戳
  var poses = new Map();    // poseName -> Image
  var MAX_CACHE = 3;        // 除当前动画外，额外缓存的动画数量
  var activeAnim = null;

  var eyeFrames = null;     // {front,left,right,up,upRight} -> canvas
  var eyeMode = 'base';     // base | overlay
  var eyeBBox = null;

  // 原始素材是 720×720，而窗口通常只有 360~720 物理像素。
  // 全尺寸保留 100+ 帧会吃掉几百 MB 内存，这里统一降采样到实际需要的分辨率。
  var renderSize = 448;

  function computeRenderSize() {
    var scale = Number(YY.settings && YY.settings.scale) || 1;
    var dpr = window.devicePixelRatio || 1;
    return Math.max(256, Math.min(720, Math.ceil(YY.BASE * scale * dpr * 1.1 / 32) * 32));
  }

  function setRenderSize(px) {
    var next = Math.max(256, Math.min(720, Math.round(px)));
    if (next <= renderSize) return false;   // 变小不必重来，够用就行
    renderSize = next;
    cache.clear(); lastUsed.clear(); poses.clear();
    return true;
  }

  function loadImage(url) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { rej(new Error('加载失败: ' + url)); };
      img.src = url;
    });
  }

  // 把大图缩到 renderSize 以内，返回 canvas（原始 Image 随后可被回收）
  function downscale(img) {
    var maxSide = Math.max(img.width, img.height);
    if (!maxSide || maxSide <= renderSize) return img;
    var k = renderSize / maxSide;
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * k));
    c.height = Math.max(1, Math.round(img.height * k));
    var cx = c.getContext('2d');
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  // 从清单的 first 字段（如 "frame_0035.png" / "1.png"）解析起始帧号与补零宽度，
  // 让帧文件名与实际素材对齐：清单里 first 非 0 的动画（起床 frame_0035、某段 frame_0008、烟雾 1.png）
  // 也能正常加载，而不是从 0 开始生成一堆不存在的文件名。
  function firstIndex(a) {
    var m = (a.first || '').match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }
  function firstWidth(a) {
    var m = (a.first || '').match(/(\d+)/);
    return m ? m[1].length : 4;
  }
  function animFrameURL(anim, i) {
    var a = YY.manifest.animations[anim];
    var name = a.pattern;
    var idx = firstIndex(a) + i;
    var numStr = String(idx).padStart(firstWidth(a), '0');
    // 兼容两种命名：frame_{i:04d}.png（四位补零）与 {i}.png（无补零，如烟雾 1.png..8.png）
    if (name.indexOf('{i:04d}') >= 0) name = name.replace('{i:04d}', numStr);
    else name = name.replace('{i}', numStr);
    return YY.assetURL(a.dir + '/' + name);
  }

  function evict() {
    if (cache.size <= MAX_CACHE) return;
    var cands = [];
    cache.forEach(function (_v, k) { if (k !== activeAnim) cands.push(k); });
    cands.sort(function (a, b) { return (lastUsed.get(a) || 0) - (lastUsed.get(b) || 0); });
    while (cache.size > MAX_CACHE && cands.length) {
      var k = cands.shift();
      cache.delete(k); lastUsed.delete(k);
    }
  }

  function ensureLoaded(anim) {
    if (cache.has(anim)) { lastUsed.set(anim, Date.now()); return Promise.resolve(cache.get(anim)); }
    if (loading.has(anim)) return loading.get(anim);
    var a = YY.manifest && YY.manifest.animations && YY.manifest.animations[anim];
    if (!a) return Promise.reject(new Error('未知动画: ' + anim));
    var urls = [];
    for (var i = 0; i < a.count; i++) urls.push(animFrameURL(anim, i));
    // 单帧缺失不该让整段动画报废，缺的帧直接跳过
    var p = Promise.all(urls.map(function (u) {
      return loadImage(u)
        .then(function (im) { return a.key ? keyFrame(im, a.keyTol || 40) : im; })
        .then(downscale)
        .catch(function () { return null; });
    })).then(function (imgs) {
      var frames = imgs.filter(Boolean);
      loading.delete(anim);
      if (!frames.length) throw new Error('动画帧全部加载失败: ' + anim);
      cache.set(anim, frames); lastUsed.set(anim, Date.now()); evict();
      return frames;
    }).catch(function (e) { loading.delete(anim); throw e; });
    loading.set(anim, p);
    return p;
  }

  function setActive(anim) { activeAnim = anim; if (anim) lastUsed.set(anim, Date.now()); }

  function getFrame(anim, i) {
    var arr = cache.get(anim);
    return arr ? arr[i] : null;
  }

  function ensurePose(name) {
    if (poses.has(name)) return Promise.resolve(poses.get(name));
    var p = YY.manifest && YY.manifest.poses && YY.manifest.poses[name];
    if (!p) return Promise.reject(new Error('未知姿势: ' + name));
    var url = YY.assetURL(p.dir + '/' + p.file);
    return loadImage(url).then(function (img) {
      var out = downscale(img);
      poses.set(name, out);
      return out;
    });
  }

  // 通用抠图：把接近背景色的像素 alpha 归零，得到透明版（烟雾等白底素材用）
  function keyFrame(img, tol) {
    var c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    var cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0);
    var d;
    try { d = cx.getImageData(0, 0, c.width, c.height); }
    catch (e) { return downscale(img); } // 画布被污染时放弃抠图
    var px = d.data;
    // 已处理好的透明素材（白边外圈透明）：直接降采样，绝不再抠背景，
    // 否则白色描边 / 浅色内容会被误删，破坏人物完整性。
    if (borderIsTransparent(px, c.width, c.height)) {
      return downscale(c);
    }
    var bg = meanBorder(px, c.width, c.height);
    for (var i = 0; i < px.length; i += 4) {
      if (colorClose(px[i], px[i + 1], px[i + 2], bg, tol)) px[i + 3] = 0;
    }
    cx.putImageData(d, 0, 0);
    return c;
  }

  // ---- 眼睛帧 ----
  function meanBorder(px, w, h) {
    var r = 0, g = 0, b = 0, n = 0, N = 24, i, x, y, o;
    for (i = 0; i < N; i++) {
      x = Math.round(i * (w - 1) / (N - 1));
      y = Math.round(i * (h - 1) / (N - 1));
      o = (0 * w + x) * 4; r += px[o]; g += px[o + 1]; b += px[o + 2]; n++;
      o = ((h - 1) * w + x) * 4; r += px[o]; g += px[o + 1]; b += px[o + 2]; n++;
      o = (y * w + 0) * 4; r += px[o]; g += px[o + 1]; b += px[o + 2]; n++;
      o = (y * w + (w - 1)) * 4; r += px[o]; g += px[o + 1]; b += px[o + 2]; n++;
    }
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  }

  function colorClose(r, g, b, bg, tol) {
    return Math.abs(r - bg[0]) <= tol && Math.abs(g - bg[1]) <= tol && Math.abs(b - bg[2]) <= tol;
  }

  function borderIsTransparent(px, w, h) {
    var step = Math.max(1, Math.floor(w / 200));
    var x, y;
    for (x = 0; x < w; x += step) {
      if (px[(0 * w + x) * 4 + 3] < 200) return true;       // 上边
      if (px[((h - 1) * w + x) * 4 + 3] < 200) return true; // 下边
    }
    for (y = 0; y < h; y += step) {
      if (px[(y * w + 0) * 4 + 3] < 200) return true;       // 左边
      if (px[(y * w + (w - 1)) * 4 + 3] < 200) return true; // 右边
    }
    return false;
  }

  function keyEyeFrame(img) {
    // 眼睛原图是 2048×2048 的整图，必须"先抠背景再降采样"：
    // 反过来做的话缩放会把背景色和人物边缘混在一起，抠完留下一圈脏边。
    var c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    var cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0);
    var d;
    try { d = cx.getImageData(0, 0, c.width, c.height); }
    catch (e) { return downscale(img); } // 画布被污染时放弃抠图
    var px = d.data;
    // 已处理好的透明素材（白边外圈透明）：直接降采样，绝不再抠背景，
    // 否则白色描边 / 浅色内容会被误删，破坏人物完整性。
    if (borderIsTransparent(px, c.width, c.height)) {
      return downscale(c);
    }
    var bg = meanBorder(px, c.width, c.height);
    for (var i = 0; i < px.length; i += 4) {
      if (colorClose(px[i], px[i + 1], px[i + 2], bg, 42)) px[i + 3] = 0;
    }
    cx.putImageData(d, 0, 0);
    return downscale(c);
  }

  function computeBBox(canvas) {
    if (!canvas || !canvas.getContext) return null;
    try {
      var cx = canvas.getContext('2d', { willReadFrequently: true });
      var d = cx.getImageData(0, 0, canvas.width, canvas.height);
      var px = d.data, w = canvas.width, h = canvas.height;
      var minx = w, miny = h, maxx = 0, maxy = 0, cnt = 0;
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var a = px[(y * w + x) * 4 + 3];
          if (a > 10) { cnt++; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
        }
      }
      if (!cnt) return null;
      return { x: minx, y: miny, w: maxx - minx, h: maxy - miny,
        relCX: (minx + (maxx - minx) / 2) / w, relCY: (miny + (maxy - miny) / 2) / h };
    } catch (e) { return null; }
  }

  function loadEyes() {
    renderSize = computeRenderSize();
    var e = YY.manifest && YY.manifest.eyes;
    if (!e || !e.frames) { eyeFrames = null; return Promise.resolve(null); }
    var out = {};
    var keys = Object.keys(e.frames);
    var chain = Promise.resolve();
    keys.forEach(function (key) {
      chain = chain.then(function () {
        var url = YY.assetURL(e.dir + '/' + e.frames[key]);
        // 某一张眼睛图缺失不影响其它方向
        return loadImage(url)
          .then(function (img) { out[key] = keyEyeFrame(img); })
          .catch(function (err) { console.warn('[园园] 眼睛帧缺失:', key, err && err.message); });
      });
    });
    return chain.then(function () {
      if (!Object.keys(out).length) { eyeFrames = null; return null; }
      if (!out.front) out.front = out[Object.keys(out)[0]];
      eyeFrames = out;
      eyeBBox = computeBBox(out.front);
      var hh = out.front.height || 1;
      eyeMode = (eyeBBox && eyeBBox.h > 0.55 * hh) ? 'base' : 'overlay';
      return out;
    });
  }

  function getEyes() { return eyeFrames; }
  function getEyeMode() { return eyeMode; }
  function getEyeBBox() { return eyeBBox; }

  YY.loader = {
    loadImage: loadImage,
    ensureLoaded: ensureLoaded,
    setActive: setActive,
    getFrame: getFrame,
    ensurePose: ensurePose,
    loadEyes: loadEyes,
    getEyes: getEyes,
    getEyeMode: getEyeMode,
    getEyeBBox: getEyeBBox,
    setRenderSize: setRenderSize,
    computeRenderSize: computeRenderSize,
  };
})(window.YY);

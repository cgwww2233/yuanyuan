// 宠物窗口入口
window.addEventListener('DOMContentLoaded', function () {
  var canvas = document.getElementById('petCanvas');

  function fatal(msg, e) {
    console.error('[园园] ' + msg, e);
    var b = document.getElementById('bubble');
    if (b) { b.textContent = msg; b.classList.remove('hidden'); b.classList.add('show'); }
  }

  if (!window.ASSET_MANIFEST || !window.ASSET_MANIFEST.animations) {
    fatal('素材清单缺失，请先运行 tools/scan_assets.py');
    return;
  }

  YY.loadSettings().then(function () {
    YY.engine.init(canvas, YY.settings.scale);
    // 眼睛素材是加分项而不是必需品：加载失败也要让园园正常动起来
    return YY.loader.loadEyes().catch(function (e) {
      console.warn('[园园] 眼睛素材加载失败，改用纯动画模式:', e && e.message);
      return null;
    });
  }).then(function () {
    // 烟雾过渡素材较大（2048²、需抠白底），提前加载好，动作切换时才能即时播放
    if (YY.loader && YY.loader.ensureLoaded) YY.loader.ensureLoaded('smoke').catch(function (e) {
      console.warn('[园园] 烟雾过渡素材加载失败，动作切换将无烟雾效果:', e && e.message);
    });
    if (YY.interaction) YY.interaction.init(canvas);
    YY.behavior.init();
  }).catch(function (e) {
    fatal('园园启动出错，请查看控制台', e);
  });
});

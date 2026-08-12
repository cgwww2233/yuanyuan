// 动作中文名映射（单一来源）：设置面板的「待机姿态」、托盘菜单、可用动作共用。
// 覆盖素材清单里的全部动画；smoke 是纯过渡特效，不作为待机姿态，但保留名称备用。
// 同时兼容浏览器（window.POSE_LABELS）与 Node（module.exports），供渲染端与主进程共用。
(function (root, factory) {
  var labels = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = labels;
  if (root) root.POSE_LABELS = labels;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  return {
    covering_face: '害羞捂脸',
    heart: '比心',
    lying_read: '趴着看书',
    pout_angry: '嘟嘴生气',
    running_happy: '欢快地跑',
    sitting_broom: '骑扫帚',
    sitting_read: '坐着看书',
    sleep: '睡觉',
    spinning: '开心转圈圈',
    standing_wiggle: '站着摇摆',
    typing_left: '坐着敲键盘',
    walk_left_right: '左右散步',
    walk_slow_left: '慢慢散步',
    '向左走': '向左走',
    '起床': '起床',
    smoke: '烟雾过渡',
  };
});

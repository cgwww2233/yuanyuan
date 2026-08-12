// 阴阳历互转（1900-2100）。用于在「阴历生日」场景下，把对象阳历生日换算成每年对应的阴历日期，
// 以及在当前年份反查出阴历生日对应的阳历日期，从而到点提醒。
// 算法：经典 lunarInfo 年度位表（每月大小月 + 闰月位置），base = 1900-01-31 = 农历庚子年正月初一。
// 同时支持 Node（module.exports，便于单元测试）与浏览器（挂到 window.YY.lunar）。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { var w = (typeof self !== 'undefined' ? self : root); w.YY = w.YY || {}; w.YY.lunar = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 1900..2100 每年农历信息：低 4 位 = 闰月位置（0 表示无闰月），其余位标记 12 个正常月的大小月；
  // 0x10000 位标记是否闰月为大月。
  var lunarInfo = [
    0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2, // 1900
    0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977, // 1910
    0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, // 1920
    0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950, // 1930
    0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557, // 1940
    0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, // 1950
    0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, // 1960
    0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6, // 1970
    0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570, // 1980
    0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0, // 1990
    0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, // 2000
    0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930, // 2010
    0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530, // 2020
    0x05aa0, 0x076a5, 0x096d0, 0x04af0, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, // 2030
    0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, // 2040
    0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0, // 2050
    0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4, // 2060
    0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0, // 2070
    0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160, // 2080
    0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252, // 2090
    0x0d520, // 2100
  ];

  var BASE_YEAR = 1900;
  var BASE = Date.UTC(1900, 0, 31); // 1900-01-31 是农历正月初一

  function inRange(y) { return y >= 1900 && y <= 2100; }

  // 全年天数（12 月 + 闰月）
  function lYearDays(y) {
    var i, sum = 348; // 12 * 29
    for (i = 0x8000; i > 0x8; i >>= 1) sum += (lunarInfo[y - BASE_YEAR] & i) ? 1 : 0;
    return sum + leapDays(y);
  }
  // 闰月天数（无闰月返回 0）
  function leapDays(y) {
    if (leapMonth(y)) return ((lunarInfo[y - BASE_YEAR] & 0x10000) ? 30 : 29);
    return 0;
  }
  // 闰月位置（1-12），0 表示当年无闰月
  function leapMonth(y) { return lunarInfo[y - BASE_YEAR] & 0xf; }
  // 某农历月天数（含大小月）
  function monthDays(y, m) {
    if (m < 1 || m > 12) return 29;
    return ((lunarInfo[y - BASE_YEAR] & (0x10000 >> m)) ? 30 : 29);
  }

  // 阳历 -> 阴历。返回 { lYear, lMonth, lDay, isLeap }
  function solarToLunar(y, m, d) {
    if (!inRange(y)) return null;
    var cur = Date.UTC(y, m - 1, d);
    var offset = Math.round((cur - BASE) / 86400000);
    var ly = 1900, days = lYearDays(1900);
    // offset 一直减到落在某个农历年之内（offset ∈ [0, 该年总天数)）
    while (offset >= days) { offset -= days; ly++; days = lYearDays(ly); }
    var leap = leapMonth(ly);
    var isLeap = false, lm = 1, md, remaining = offset;
    for (lm = 1; lm <= 12; lm++) {
      md = monthDays(ly, lm);
      if (remaining < md) { isLeap = false; break; }
      remaining -= md;
      // 该正常月之后若存在闰月，再尝试闰月
      if (leap > 0 && lm === leap) {
        md = leapDays(ly);
        if (remaining < md) { isLeap = true; break; }
        remaining -= md;
      }
    }
    if (lm > 12) { lm = 12; remaining = 0; }
    return { lYear: ly, lMonth: lm, lDay: remaining + 1, isLeap: isLeap };
  }

  // 阴历 -> 阳历。ly/lm/ld 为农历年月日；isLeap 表示是否落在闰月。
  // 返回 { year, month, day } 阳历日期；非法（如指定了不存在的闰月）返回 null。
  // 思路：累加「目标月之前所有完整月」的天数，目标月只取 (ld-1) 天偏移，绝不再把整月加一遍。
  function lunarToSolar(ly, lm, ld, isLeap) {
    if (!inRange(ly) || lm < 1 || lm > 12 || ld < 1) return null;
    var leap = leapMonth(ly);
    if (isLeap && leap !== lm) return null; // 那年没有这个闰月
    var offset = 0;
    for (var y = 1900; y < ly; y++) offset += lYearDays(y);
    // 完整前置月：位置在 lm 之前的所有正常月
    for (var m = 1; m < lm; m++) offset += monthDays(ly, m);
    // 闰月是否作为「完整前置月」计入：目标落在闰月，或目标在正常月且排在闰月之后
    if (isLeap) {
      offset += monthDays(ly, leap);        // 闰月之前的那个正常月（完整）在它前面
    } else if (leap > 0 && lm > leap) {
      offset += leapDays(ly);                // 目标在正常闰月之后，闰月整月计入
    }
    offset += ld - 1;
    var date = new Date(BASE + offset * 86400000);
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  }

  // 把农历日期格式化为中文（如「六月二十」「闰六月初一」）
  function formatLunar(l) {
    if (!l) return '';
    var num = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    function cn(n) {
      if (n <= 10) return num[n];
      if (n < 20) return '十' + num[n - 10];
      if (n % 10 === 0) return num[Math.floor(n / 10)] + '十';
      return num[Math.floor(n / 10)] + '十' + num[n % 10];
    }
    return (l.isLeap ? '闰' : '') + cn(l.lMonth) + '月' + cn(l.lDay);
  }

  return {
    lunarInfo: lunarInfo, inRange: inRange,
    leapMonth: leapMonth, monthDays: monthDays, lYearDays: lYearDays,
    solarToLunar: solarToLunar, lunarToSolar: lunarToSolar, formatLunar: formatLunar,
  };
}));

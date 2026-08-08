const fs = require('fs');
const s = fs.readFileSync('renderer/js/dialogue.js', 'utf8');
// 抓 birthday_click 整个数组（含原 8 条 + extendLines 里 add 的）
const re = /birthday_click:\s*\[([\s\S]*?)\]\s*,/g;
let m, items = [];
while ((m = re.exec(s)) !== null) {
  const block = m[1];
  const lines = block.split('\n').map(x => x.trim()).filter(x => x.startsWith("'"));
  items = items.concat(lines);
}
console.log('birthday_click 总条数:', items.length);
console.log('其中 extend 追加:', items.length - 8);

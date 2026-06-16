import fs from 'fs';
const bundle = fs.readFileSync('./web/assets/index-xSAobs2w.js', 'utf-8');

console.log('=== 最终验证 index-xSAobs2w.js ===\n');

const checks = [
  ['包含 thead', bundle.includes('thead')],
  ['包含 tbody', bundle.includes('tbody')],
  ['包含表头样式', bundle.includes('border-b border-border bg-muted/30')],
  ['包含 uppercase tracking-wider', bundle.includes('uppercase tracking-wider')],
  ['包含"选择"', bundle.includes('选择')],
  ['包含"节点名称"', bundle.includes('节点名称')],
  ['包含"IP 地址"', bundle.includes('IP 地址')],
];

checks.forEach(([desc, result]) => {
  console.log(`${result ? '✓' : '✗'} ${desc}`);
});

console.log('\n=== 结论 ===');
console.log(checks.every(([, r]) => r) ? '✓ 表格布局已部署！' : '✗ 有问题');

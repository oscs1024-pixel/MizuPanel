import fs from 'fs';
const bundle = fs.readFileSync('./web/assets/index-BeQDozum.js', 'utf-8');

console.log('=== 最终验证当前部署的 JS 文件 ===\n');

// 表格版本的关键特征
const checks = [
  ['包含 thead', bundle.includes('thead')],
  ['包含 tbody', bundle.includes('tbody')],
  ['包含表头样式 border-b border-border bg-muted/30', bundle.includes('border-b border-border bg-muted/30')],
  ['包含 uppercase tracking-wider', bundle.includes('uppercase tracking-wider')],
  ['包含"选择"', bundle.includes('选择')],
  ['包含"节点名称"', bundle.includes('节点名称')],
  ['包含"IP 地址"', bundle.includes('IP 地址')],
  ['包含"CPU"', bundle.includes('CPU')],
  ['包含"内存"', bundle.includes('内存')],
  ['包含"磁盘"', bundle.includes('磁盘')],
];

checks.forEach(([desc, result]) => {
  console.log(`${result ? '✓' : '✗'} ${desc}`);
});

console.log('\n=== 结论 ===');
const allPass = checks.every(([, r]) => r);
console.log(allPass ? '✓ 所有表格特征都存在，应该是表格布局！' : '✗ 缺少某些特征');

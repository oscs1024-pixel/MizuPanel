import fs from 'fs';
const bundle = fs.readFileSync('./dist-test/assets/index-BeQDozum.js', 'utf-8');

// 搜索关键词组合来判断是哪个版本
console.log('=== 分析 ConnectK8sClusterModal 的构建版本 ===\n');

// 表格版本的特征
const tableFeatures = [
  'thead',
  'tbody',
  'border-b border-border bg-muted/30',
  'uppercase tracking-wider',
];

// 卡片版本的特征  
const cardFeatures = [
  'rounded-xl border border-border',
  'bg-gradient-to-br',
  'shadow-sm',
];

console.log('表格特征:');
tableFeatures.forEach(f => {
  console.log(`  "${f}": ${bundle.includes(f)}`);
});

console.log('\n卡片特征:');
cardFeatures.forEach(f => {
  console.log(`  "${f}": ${bundle.includes(f)}`);
});

// 查找"选择"列的代码
console.log('\n=== 查找选择列 ===');
console.log('包含"选择"表头:', bundle.includes('选择') && bundle.includes('节点名称'));

// 搜索 onClick 和 handleNodeSelect
console.log('\n=== 查找交互逻辑 ===');
console.log('包含 handleNodeSelect:', bundle.includes('handleNodeSelect'));

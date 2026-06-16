import fs from 'fs';
const bundle = fs.readFileSync('./dist-test/assets/index-BeQDozum.js', 'utf-8');

console.log('=== 检查构建文件内容 ===');
console.log('包含"grid gap-3 md:grid-cols-2":', bundle.includes('grid gap-3 md:grid-cols-2'));
console.log('包含"选择 Agent 节点":', bundle.includes('选择 Agent 节点'));
console.log('包含"节点名称":', bundle.includes('节点名称'));
console.log('包含"IP 地址":', bundle.includes('IP 地址'));
console.log('包含"CPU":', bundle.includes('CPU'));
console.log('包含"内存":', bundle.includes('内存'));
console.log('包含"磁盘":', bundle.includes('磁盘'));

// 查找"选择 Agent 节点"周围的代码
const matches = [...bundle.matchAll(/选择 Agent 节点.{0,500}/g)];
console.log('\n=== "选择 Agent 节点"出现次数:', matches.length);
matches.forEach((m, i) => {
  console.log(`\n--- 第 ${i+1} 次 ---`);
  const snippet = m[0].substring(0, 300);
  console.log('是否有grid gap-3:', snippet.includes('grid gap-3'));
  console.log('是否有table:', snippet.includes('table'));
});

import { build } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';

// 先检查源文件
const source = fs.readFileSync('./src/components/ConnectK8sClusterModal.tsx', 'utf-8');
console.log('=== 源文件检查 ===');
console.log('有标记:', source.includes('UNIQUE_TEST_MARKER_12345'));
console.log('有表格:', source.includes('<table'));
console.log('有卡片网格:', source.includes('grid gap-3'));

// 构建
console.log('\n=== 开始构建 ===');
await build({
  plugins: [react()],
  build: {
    outDir: 'dist-test',
    rollupOptions: {
      output: {
        manualChunks: undefined
      }
    }
  }
});

// 检查构建结果
console.log('\n=== 构建结果检查 ===');
const distFiles = fs.readdirSync('./dist-test/assets').filter(f => f.startsWith('index-') && f.endsWith('.js'));
console.log('构建文件:', distFiles);

for (const file of distFiles) {
  const content = fs.readFileSync(`./dist-test/assets/${file}`, 'utf-8');
  console.log(`\n${file}:`);
  console.log('  有标记:', content.includes('UNIQUE_TEST_MARKER_12345'));
  console.log('  有"选择 Agent":', content.includes('选择 Agent'));
  console.log('  有"节点名称":', content.includes('节点名称'));
}

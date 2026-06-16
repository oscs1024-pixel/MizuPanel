import { build } from 'vite';
import react from '@vitejs/plugin-react';

await build({
  plugins: [react()],
  logLevel: 'info',
  build: {
    outDir: 'dist-debug',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-DEBUG.js',
      }
    }
  }
});

console.log('\n=== 构建完成，检查结果 ===');
import fs from 'fs';
const files = fs.readdirSync('./dist-debug/assets').filter(f => f.includes('DEBUG'));
console.log('生成的文件:', files);

for (const file of files) {
  const content = fs.readFileSync(`./dist-debug/assets/${file}`, 'utf-8');
  const match = content.match(/当前没有在线的 Agent.{0,800}/);
  if (match) {
    console.log(`\n${file} 节点列表代码:`);
    console.log('包含 table:', match[0].includes('table'));
    console.log('包含 grid gap-3:', match[0].includes('grid gap-3'));
  }
}

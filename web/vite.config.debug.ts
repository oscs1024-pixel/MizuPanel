import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'debug-modal',
      transform(code, id) {
        if (id.includes('ConnectK8sClusterModal')) {
          console.log('\n=== 拦截到 ConnectK8sClusterModal ===');
          console.log('文件路径:', id);
          console.log('包含 <table>:', code.includes('<table'));
          console.log('包含 grid gap-3:', code.includes('grid gap-3'));
          console.log('代码长度:', code.length);
        }
        return null;
      }
    }
  ],
})

import fs from 'fs';
const content = fs.readFileSync('./src/components/ConnectK8sClusterModal.tsx', 'utf-8');
console.log('File exists:', content.includes('UNIQUE_TEST_MARKER_12345'));
console.log('Has table:', content.includes('<table'));
console.log('Has grid gap-3:', content.includes('grid gap-3'));

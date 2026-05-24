/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Noto Sans SC', 'Noto Sans CJK SC', 'Microsoft YaHei', 'PingFang SC', 'WenQuanYi Micro Hei', 'sans-serif'],
        body: ['Noto Sans SC', 'Noto Sans CJK SC', 'Microsoft YaHei', 'PingFang SC', 'WenQuanYi Micro Hei', 'sans-serif']
      },
      colors: {
        ink: '#09090B',
        mist: '#FAFAFA',
        panel: '#FFFFFFCC',
        cobalt: '#2563EB',
        pine: '#15803D',
        amberline: '#D97706'
      },
      boxShadow: {
        glass: '0 24px 70px rgba(15, 23, 42, 0.10)'
      }
    }
  },
  plugins: []
}

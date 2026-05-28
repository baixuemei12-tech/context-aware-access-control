import { defineConfig } from 'vite';

const root = process.cwd();
const gatewayTarget = (process.env.CAAC_GATEWAY_TARGET || process.env.CAAC_GATEWAY_URL || 'http://10.216.217.146:5051')
  .replace(/\/+$/, '');

export default defineConfig({
  root,
  base: './',
  publicDir: 'public',
  server: {
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/api': {
        target: gatewayTarget,
        changeOrigin: true,
        secure: false,
        configure(proxy) {
          proxy.on('proxyReq', proxyReq => {
            proxyReq.removeHeader('origin');
            proxyReq.removeHeader('referer');
          });
        }
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: 'index.html',
        admin: 'admin.html',
        login: 'login.html',
        messages: 'messages.html',
        overview: 'overview.html',
        profile: 'profile.html',
        scenarios: 'scenarios.html'
      }
    }
  }
});

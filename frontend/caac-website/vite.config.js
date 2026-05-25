import { defineConfig } from 'vite';
import { resolve } from 'node:path';

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
        index: resolve(root, 'index.html'),
        admin: resolve(root, 'admin.html'),
        login: resolve(root, 'login.html'),
        messages: resolve(root, 'messages.html'),
        overview: resolve(root, 'overview.html'),
        profile: resolve(root, 'profile.html'),
        scenarios: resolve(root, 'scenarios.html')
      }
    }
  }
});

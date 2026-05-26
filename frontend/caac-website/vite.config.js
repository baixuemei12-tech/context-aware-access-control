import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import caacMockBench from './vite-plugins/mock-bench.js';

const root = process.cwd();
const gatewayTarget = (process.env.CAAC_GATEWAY_TARGET || process.env.CAAC_GATEWAY_URL || 'http://127.0.0.1:5051')
  .replace(/\/+$/, '');

export default defineConfig({
  root,
  base: './',
  publicDir: 'public',
  // Mock SSE 推送服务 (dev only)：在 /bench/* 提供模拟事件流，
  // 前端 EventSource 直接订阅后即可独立运行，无需启动真实后端。
  plugins: [caacMockBench()],
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

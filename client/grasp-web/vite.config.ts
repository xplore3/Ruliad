import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3060',
        changeOrigin: true,
        // 二期语音：/api/v1/sessions/:id/voice 走 WebSocket
        ws: true,
      },
    },
  },
});

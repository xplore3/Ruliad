import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import fs from 'node:fs';

const httpsKey = process.env.VITE_HTTPS_KEY;
const httpsCert = process.env.VITE_HTTPS_CERT;
const https = httpsKey && httpsCert
  ? { key: fs.readFileSync(httpsKey), cert: fs.readFileSync(httpsCert) }
  : undefined;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5175,
    https,
    proxy: {
      '/api': {
        target: 'http://localhost:3060',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});

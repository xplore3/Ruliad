import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const sslDir = path.join(os.homedir(), '.vite-ssl');
const keyPath = process.env.VITE_HTTPS_KEY ?? path.join(sslDir, 'key.pem');
const certPath = process.env.VITE_HTTPS_CERT ?? path.join(sslDir, 'cert.pem');
const https = fs.existsSync(keyPath) && fs.existsSync(certPath)
  ? {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    }
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

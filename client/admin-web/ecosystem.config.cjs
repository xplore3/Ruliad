// PM2 部署配置（云上使用）：pm2 startOrRestart ecosystem.config.cjs
// 注意：vite preview 只服务已构建产物，需先 pnpm build（生成 dist/）。
// /api 代理沿用 vite.config.ts 的 server.proxy 配置。
module.exports = {
  apps: [
    {
      name: 'admin-web',
      script: 'node_modules/.bin/vite',
      args: 'preview --host 0.0.0.0 --port 5174',
    },
  ],
};

// PM2 部署配置（云上使用）：
//   启动/重启：pm2 startOrRestart ecosystem.config.cjs
//   关键：node_args 里的 --env-file-if-exists=.env 决定 .env 是否被加载，
//   缺了它 SPEECH_* / LLM_* / AUTH_SECRET 全部不会生效（进程静默落到 Mock）。
module.exports = {
  apps: [
    {
      name: 'grasp-api',
      script: 'dist/server.js',
      node_args: '--env-file-if-exists=.env',
    },
  ],
};

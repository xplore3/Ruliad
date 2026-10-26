module.exports = {
  apps: [
    {
      name: 'grasp-landing',
      script: 'node',
      args: '../node_modules/vite/vite.js preview --port 5180 --host',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};

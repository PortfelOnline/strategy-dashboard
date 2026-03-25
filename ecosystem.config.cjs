module.exports = {
  apps: [{
    name: 'strategy-dashboard',
    script: 'dist/index.js',
    cwd: '/root/strategy-dashboard',
    env: {
      NODE_ENV: 'production',
      ENABLE_DEV_LOGIN: 'true'
    }
  }]
};

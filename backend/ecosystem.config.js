module.exports = {
  apps: [
    {
      name: 'fb-live-server',
      script: 'server.js',
      cwd: __dirname,

      // Restart automatically if the process crashes
      autorestart: true,

      // Watch .env for changes (e.g. after saving a new public URL)
      watch: false,

      // Keep the last 30 days of logs
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,

      // Environment
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};

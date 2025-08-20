require('dotenv').config()

module.exports = {
  apps: [
    {
      name: process.env.PROJECT_NAME,
      script: './dist/server.js',
      cwd: `/home/injunior-infra/dev/projects/${process.env.PROJECT_NAME}`,
      max_memory_restart: '256M',
      node_args: '--env-file=.env',

      // Logging
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      log_date_format: 'DD-MM-YYYY HH:mm:ss Z',
      log_type: 'json',
    },
  ],
}

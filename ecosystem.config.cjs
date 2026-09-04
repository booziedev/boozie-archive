/**
 * pm2 process definition for the boozie-archive backend.
 *
 * This one process serves both the API and — when `frontend/dist` exists — the
 * web app itself, so `http://<pi>:1981/` is the whole application. Run the root
 * `npm run build` (not just the backend one) to get the UI.
 *
 *   npm run build                  # backend + frontend
 *   pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup      # survive reboots
 *   pm2 logs boozie-archive-api
 *
 * Use `--env development` to run straight from TypeScript with tsx instead of
 * the compiled dist build:
 *   pm2 start ecosystem.config.cjs --env development
 */
const path = require('node:path');

const backendDir = path.join(__dirname, 'backend');

module.exports = {
  apps: [
    {
      name: 'boozie-archive-api',
      cwd: backendDir,
      script: 'dist/index.js',
      // Fastify + the scanner are single-process by design: the in-memory index
      // must not be duplicated across workers, so keep this at one instance.
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      // The cold scan of a large collection is memory-hungry but transient;
      // 900M leaves headroom on a 4 GB Pi 5 without masking a real leak.
      max_memory_restart: '900M',
      kill_timeout: 10000,
      time: true,
      merge_logs: true,
      out_file: path.join(__dirname, 'logs', 'api-out.log'),
      error_file: path.join(__dirname, 'logs', 'api-error.log'),
      env: {
        NODE_ENV: 'production',
        PORT: '1981',
        HOST: '0.0.0.0',
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: '1981',
        HOST: '0.0.0.0',
        // Run the TypeScript sources directly (requires devDependencies).
        script: 'node_modules/.bin/tsx',
        args: 'src/index.ts',
      },
    },
  ],
};

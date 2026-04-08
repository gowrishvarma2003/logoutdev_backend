require('dotenv').config();

const app = require('./src/app');
const { closeLogger, getLogRootPath, logger, registerProcessLogging } = require('./src/logging/logger');
const { initModels } = require('./src/models');
const { initializeUserStore } = require('./src/services/auth/userStore');
const { initializeGitCacheCleanupService } = require('./src/services/git/gitCacheCleanupService');

const port = process.env.PORT || 3000;

registerProcessLogging();

async function startServer() {
  try {
    await initModels();
    logger.info('Database connected successfully.');
    await initializeUserStore();

    let stopGitCacheCleanupService = () => {};
    try {
      stopGitCacheCleanupService = await initializeGitCacheCleanupService();
    } catch (cleanupError) {
      logger.warn('Git cache cleanup service failed to initialize.', {
        error: cleanupError.message,
      });
    }

    const server = app.listen(port, () => {
      logger.info('Server started successfully.', {
        port,
        logRootPath: getLogRootPath(),
      });
    });

    const shutdown = (signal) => {
      logger.info('Shutdown signal received.', { signal });
      stopGitCacheCleanupService();
      server.close(() => {
        logger.info('HTTP server closed.', { signal });
        closeLogger();
        process.exit(0);
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    logger.error('Failed to start server.', { error });
    closeLogger();
    process.exit(1);
  }
}

startServer();



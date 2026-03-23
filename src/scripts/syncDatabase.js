require('dotenv').config();

const {
  closeLogger,
  logger,
  registerProcessLogging,
} = require('../logging/logger');
const { initModels, sequelize } = require('../models');

registerProcessLogging();

async function run() {
  try {
    logger.info('Manual database sync started.');
    await initModels({ syncSchema: true });
    logger.info('Manual database sync completed successfully.');
  } catch (error) {
    logger.error('Manual database sync failed.', { error });
    process.exitCode = 1;
  } finally {
    await sequelize.close().catch(() => {});
    closeLogger();
  }
}

run();

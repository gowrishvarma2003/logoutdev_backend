require('dotenv').config();

const app = require('./src/app');
const { initModels } = require('./src/models');
const { initializeUserStore } = require('./src/services/auth/userStore');

const port = process.env.PORT || 3000;

async function startServer() {
  try {
    await initModels();
    console.log('Database connected successfully.');
    await initializeUserStore();

    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

startServer();



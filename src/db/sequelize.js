const { Sequelize } = require('sequelize');

const connectionString = process.env.DB_URL;

if (!connectionString) {
  throw new Error('DB_URL is not set. Please add DB_URL in backend .env file.');
}

const useSsl = !connectionString.includes('localhost') && !connectionString.includes('127.0.0.1');

const sequelize = new Sequelize(connectionString, {
  dialect: 'postgres',
  logging: false,
  dialectOptions: useSsl
    ? {
        ssl: {
          require: true,
          rejectUnauthorized: false,
        },
      }
    : {},
});

module.exports = sequelize;
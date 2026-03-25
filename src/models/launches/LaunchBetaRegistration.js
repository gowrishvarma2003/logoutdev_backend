const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const LAUNCH_BETA_REGISTRATION_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'];

const LaunchBetaRegistration = sequelize.define(
  'LaunchBetaRegistration',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    launch_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'pending',
      validate: {
        isIn: [LAUNCH_BETA_REGISTRATION_STATUSES],
      },
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: null,
      validate: {
        len: [0, 1200],
      },
    },
    reviewed_by: {
      type: DataTypes.UUID,
      allowNull: true,
      defaultValue: null,
    },
    reviewed_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: 'launch_beta_registrations',
    timestamps: false,
    indexes: [
      { fields: ['launch_id'] },
      { fields: ['user_id'] },
      { fields: ['status'] },
      { unique: true, fields: ['launch_id', 'user_id'] },
    ],
  }
);

module.exports = LaunchBetaRegistration;

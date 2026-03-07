const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const UserAccessToken = sequelize.define(
  'UserAccessToken',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: {
        len: [1, 100],
      },
    },
    token_prefix: {
      type: DataTypes.STRING(16),
      allowNull: false,
    },
    token_hash: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    last_used_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
    revoked_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: 'user_access_tokens',
    timestamps: false,
    indexes: [{ fields: ['user_id'] }, { fields: ['token_prefix'] }],
  }
);

module.exports = UserAccessToken;

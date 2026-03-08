const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const NotificationOutbox = sequelize.define(
  'NotificationOutbox',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    event_type: {
      type: DataTypes.STRING(60),
      allowNull: false,
    },
    actor_user_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    recipient_user_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    post_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    dedupe_key: {
      type: DataTypes.STRING(120),
      allowNull: false,
      unique: true,
    },
    payload: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: null,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    processed_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
  },
  {
    tableName: 'notification_outbox',
    timestamps: false,
    indexes: [
      { unique: true, fields: ['dedupe_key'] },
      { fields: ['recipient_user_id', 'created_at'] },
      { fields: ['post_id'] },
    ],
  }
);

module.exports = NotificationOutbox;

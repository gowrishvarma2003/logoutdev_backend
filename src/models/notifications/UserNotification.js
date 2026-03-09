const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const UserNotification = sequelize.define(
  'UserNotification',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    recipient_user_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    actor_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    event_type: {
      type: DataTypes.STRING(80),
      allowNull: false,
    },
    category: {
      type: DataTypes.STRING(30),
      allowNull: false,
    },
    priority: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'activity',
    },
    entity_type: {
      type: DataTypes.STRING(40),
      allowNull: false,
    },
    entity_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    entity_snapshot: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    secondary_entity_type: {
      type: DataTypes.STRING(40),
      allowNull: true,
      defaultValue: null,
    },
    secondary_entity_id: {
      type: DataTypes.UUID,
      allowNull: true,
      defaultValue: null,
    },
    secondary_snapshot: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: null,
    },
    action_url: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: null,
    },
    preview_text: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: null,
    },
    group_key: {
      type: DataTypes.STRING(160),
      allowNull: true,
      defaultValue: null,
    },
    dedupe_key: {
      type: DataTypes.STRING(200),
      allowNull: false,
      unique: true,
    },
    group_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    read_at: {
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
    tableName: 'user_notifications',
    timestamps: false,
    indexes: [
      { unique: true, fields: ['dedupe_key'] },
      { fields: ['recipient_user_id', 'read_at', 'created_at'] },
      { fields: ['recipient_user_id', 'priority', 'created_at'] },
      { fields: ['recipient_user_id', 'group_key'] },
      { fields: ['entity_type', 'entity_id'] },
    ],
  }
);

module.exports = UserNotification;

const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const LaunchScreenshot = sequelize.define(
  'LaunchScreenshot',
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
    image_url: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    caption: {
      type: DataTypes.STRING(180),
      allowNull: true,
      defaultValue: null,
    },
    rank: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: 'launch_screenshots',
    timestamps: false,
    indexes: [{ fields: ['launch_id'] }, { fields: ['rank'] }],
  }
);

module.exports = LaunchScreenshot;
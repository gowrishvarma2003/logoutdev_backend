const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const PollOption = sequelize.define(
  'PollOption',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    post_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    position: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    text: {
      type: DataTypes.STRING(200),
      allowNull: false,
    },
    vote_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    tableName: 'post_poll_options',
    timestamps: false,
    indexes: [
      { unique: true, fields: ['post_id', 'position'] },
      { fields: ['post_id'] },
    ],
  }
);

module.exports = PollOption;

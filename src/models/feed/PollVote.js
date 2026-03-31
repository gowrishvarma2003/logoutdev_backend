const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const PollVote = sequelize.define(
  'PollVote',
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
    option_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: 'post_poll_votes',
    timestamps: false,
    indexes: [
      // One vote per user per post (they pick one option)
      { unique: true, fields: ['post_id', 'user_id'] },
      { fields: ['option_id'] },
    ],
  }
);

module.exports = PollVote;

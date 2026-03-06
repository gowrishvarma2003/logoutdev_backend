const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const UserProfileSkill = sequelize.define(
  'UserProfileSkill',
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
    skill: {
      type: DataTypes.STRING(60),
      allowNull: false,
      validate: {
        len: [1, 60],
      },
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
    tableName: 'user_profile_skills',
    timestamps: false,
    indexes: [{ fields: ['user_id'] }, { fields: ['rank'] }, { unique: true, fields: ['user_id', 'skill'] }],
  }
);

module.exports = UserProfileSkill;

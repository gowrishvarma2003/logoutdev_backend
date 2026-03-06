const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const MEMBER_ROLES = ['owner', 'maintainer', 'contributor'];

const ProjectSpaceMember = sequelize.define(
  'ProjectSpaceMember',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    space_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    role: {
      type: DataTypes.ENUM(...MEMBER_ROLES),
      allowNull: false,
      defaultValue: 'contributor',
    },
    joined_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: 'project_space_members',
    timestamps: false,
    indexes: [
      { unique: true, fields: ['space_id', 'user_id'] },
      { fields: ['space_id'] },
      { fields: ['user_id'] },
      { fields: ['role'] },
    ],
  }
);

module.exports = ProjectSpaceMember;

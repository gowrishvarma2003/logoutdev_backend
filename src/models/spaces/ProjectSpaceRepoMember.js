const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const REPO_MEMBER_ROLES = ['read', 'triage', 'write', 'maintain', 'admin'];
const REPO_MEMBER_STATUSES = ['pending', 'accepted'];

const ProjectSpaceRepoMember = sequelize.define(
  'ProjectSpaceRepoMember',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    repo_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    role: {
      type: DataTypes.ENUM(...REPO_MEMBER_ROLES),
      allowNull: false,
      defaultValue: 'read',
    },
    status: {
      type: DataTypes.ENUM(...REPO_MEMBER_STATUSES),
      allowNull: false,
      defaultValue: 'pending',
    },
    granted_by: {
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
    tableName: 'project_space_repo_members',
    timestamps: false,
    indexes: [
      { unique: true, fields: ['repo_id', 'user_id'] },
      { fields: ['repo_id'] },
      { fields: ['user_id'] },
    ],
  }
);

module.exports = ProjectSpaceRepoMember;

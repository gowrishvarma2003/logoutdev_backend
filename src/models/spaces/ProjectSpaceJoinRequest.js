const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const JOIN_REQUEST_STATUSES = ['pending', 'accepted', 'rejected', 'need-info', 'withdrawn'];

const ProjectSpaceJoinRequest = sequelize.define(
  'ProjectSpaceJoinRequest',
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
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        len: [10, 2000],
      },
    },
    skills: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    availability_hours: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
      validate: {
        min: 1,
        max: 80,
      },
    },
    proof_links: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    status: {
      type: DataTypes.ENUM(...JOIN_REQUEST_STATUSES),
      allowNull: false,
      defaultValue: 'pending',
    },
    reviewed_by: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    reviewed_at: {
      type: DataTypes.DATE,
      allowNull: true,
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
    tableName: 'project_space_join_requests',
    timestamps: false,
    indexes: [
      { fields: ['space_id'] },
      { fields: ['user_id'] },
      { fields: ['status'] },
      { unique: true, fields: ['space_id', 'user_id', 'status'] },
    ],
  }
);

module.exports = ProjectSpaceJoinRequest;

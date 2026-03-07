const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const FREELANCE_PRICING_MODELS = ['fixed', 'hourly'];
const FREELANCE_EXPERIENCE_LEVELS = ['any', 'junior', 'mid', 'senior'];
const FREELANCE_ENGAGEMENT_TYPES = ['one_time', 'ongoing'];
const FREELANCE_LOCATION_MODES = ['remote', 'hybrid', 'onsite'];
const FREELANCE_PROJECT_STATUSES = ['open', 'in_review', 'awarded', 'completed', 'cancelled'];

const FreelanceProject = sequelize.define(
  'FreelanceProject',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    client_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    linked_space_id: {
      type: DataTypes.UUID,
      allowNull: true,
      defaultValue: null,
    },
    accepted_proposal_id: {
      type: DataTypes.UUID,
      allowNull: true,
      defaultValue: null,
    },
    title: {
      type: DataTypes.STRING(120),
      allowNull: false,
      validate: {
        len: [5, 120],
      },
    },
    slug: {
      type: DataTypes.STRING(140),
      allowNull: false,
      unique: true,
      validate: {
        len: [5, 140],
      },
    },
    summary: {
      type: DataTypes.STRING(240),
      allowNull: false,
      validate: {
        len: [20, 240],
      },
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        len: [50, 5000],
      },
    },
    pricing_model: {
      type: DataTypes.ENUM(...FREELANCE_PRICING_MODELS),
      allowNull: false,
    },
    currency_code: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: 'USD',
      validate: {
        len: [3, 3],
      },
    },
    budget_min_cents: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
      validate: {
        min: 0,
      },
    },
    budget_max_cents: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
      validate: {
        min: 0,
      },
    },
    experience_level: {
      type: DataTypes.ENUM(...FREELANCE_EXPERIENCE_LEVELS),
      allowNull: false,
      defaultValue: 'any',
    },
    engagement_type: {
      type: DataTypes.ENUM(...FREELANCE_ENGAGEMENT_TYPES),
      allowNull: false,
    },
    duration_weeks: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
      validate: {
        min: 1,
        max: 52,
      },
    },
    location_mode: {
      type: DataTypes.ENUM(...FREELANCE_LOCATION_MODES),
      allowNull: false,
      defaultValue: 'remote',
    },
    timezone_note: {
      type: DataTypes.STRING(120),
      allowNull: true,
      defaultValue: null,
    },
    status: {
      type: DataTypes.ENUM(...FREELANCE_PROJECT_STATUSES),
      allowNull: false,
      defaultValue: 'open',
    },
    closed_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
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
    tableName: 'freelance_projects',
    timestamps: false,
    indexes: [
      { unique: true, fields: ['slug'] },
      { fields: ['client_id'] },
      { fields: ['status'] },
      { fields: ['pricing_model'] },
      { fields: ['experience_level'] },
      { fields: ['engagement_type'] },
      { fields: ['created_at'] },
    ],
  }
);

module.exports = FreelanceProject;

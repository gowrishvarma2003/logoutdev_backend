const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const LAUNCH_PRODUCT_TYPES = [
  'web-app',
  'mobile-app',
  'developer-tool',
  'api',
  'ai-tool',
  'open-source',
  'experimental',
  'other',
];
const LAUNCH_DEVELOPMENT_STAGES = [
  'prototype',
  'mvp',
  'beta',
  'live',
  'maintained',
  'paused',
];
const LAUNCH_COLLABORATION_MODES = ['off', 'looking'];
const LAUNCH_STATUSES = ['draft', 'published', 'archived'];
const LAUNCH_PHASES = ['beta', 'live'];

const Launch = sequelize.define(
  'Launch',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    builder_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    linked_space_id: {
      type: DataTypes.UUID,
      allowNull: true,
      defaultValue: null,
    },
    name: {
      type: DataTypes.STRING(120),
      allowNull: false,
      validate: {
        len: [3, 120],
      },
    },
    slug: {
      type: DataTypes.STRING(140),
      allowNull: false,
      unique: true,
      validate: {
        len: [3, 140],
      },
    },
    tagline: {
      type: DataTypes.STRING(180),
      allowNull: false,
      validate: {
        len: [20, 180],
      },
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        len: [1, 5000],
      },
    },
    product_type: {
      type: DataTypes.ENUM(...LAUNCH_PRODUCT_TYPES),
      allowNull: false,
    },
    development_stage: {
      type: DataTypes.ENUM(...LAUNCH_DEVELOPMENT_STAGES),
      allowNull: false,
    },
    launch_phase: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'live',
      validate: {
        isIn: [LAUNCH_PHASES],
      },
    },
    beta_capacity: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
      validate: {
        min: 1,
      },
    },
    beta_access_url: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: null,
    },
    beta_opened_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
    live_url: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: null,
    },
    went_live_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
    demo_url: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: null,
    },
    website_url: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: null,
    },
    github_url: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: null,
    },
    docs_url: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: null,
    },
    collaboration_mode: {
      type: DataTypes.ENUM(...LAUNCH_COLLABORATION_MODES),
      allowNull: false,
      defaultValue: 'off',
    },
    collaboration_note: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: null,
    },
    collaboration_roles: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    status: {
      type: DataTypes.ENUM(...LAUNCH_STATUSES),
      allowNull: false,
      defaultValue: 'draft',
    },
    upvote_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      validate: {
        min: 0,
      },
    },
    review_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      validate: {
        min: 0,
      },
    },
    feedback_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      validate: {
        min: 0,
      },
    },
    published_at: {
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
    tableName: 'launches',
    timestamps: false,
    indexes: [
      { unique: true, fields: ['slug'] },
      { unique: true, fields: ['linked_space_id'] },
      { fields: ['builder_id'] },
      { fields: ['status'] },
      { fields: ['product_type'] },
      { fields: ['development_stage'] },
      { fields: ['launch_phase'] },
      { fields: ['published_at'] },
      { fields: ['beta_opened_at'] },
      { fields: ['went_live_at'] },
      { fields: ['upvote_count'] },
    ],
  }
);

module.exports = Launch;

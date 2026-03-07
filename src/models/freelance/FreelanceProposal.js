const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const FREELANCE_PROPOSAL_STATUSES = ['submitted', 'shortlisted', 'accepted', 'rejected', 'withdrawn'];
const FREELANCE_PRICING_MODELS = ['fixed', 'hourly'];

const FreelanceProposal = sequelize.define(
  'FreelanceProposal',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    project_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    freelancer_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    cover_note: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        len: [50, 2000],
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
    bid_amount_cents: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
      },
    },
    estimated_duration_weeks: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
      validate: {
        min: 1,
        max: 52,
      },
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
      type: DataTypes.ENUM(...FREELANCE_PROPOSAL_STATUSES),
      allowNull: false,
      defaultValue: 'submitted',
    },
    reviewed_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
    withdrawn_at: {
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
    tableName: 'freelance_proposals',
    timestamps: false,
    indexes: [
      { fields: ['project_id'] },
      { fields: ['freelancer_id'] },
      { fields: ['status'] },
      { unique: true, fields: ['project_id', 'freelancer_id'] },
    ],
  }
);

module.exports = FreelanceProposal;

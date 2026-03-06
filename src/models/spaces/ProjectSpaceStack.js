const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const STACK_CATEGORIES = ['frontend', 'backend', 'database', 'infra', 'tooling', 'other'];
const STACK_MATURITY = ['planned', 'in-use', 'deprecated'];

const ProjectSpaceStack = sequelize.define(
  'ProjectSpaceStack',
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
    category: {
      type: DataTypes.ENUM(...STACK_CATEGORIES),
      allowNull: false,
      defaultValue: 'other',
    },
    technology: {
      type: DataTypes.STRING(80),
      allowNull: false,
      validate: {
        len: [1, 80],
      },
    },
    maturity: {
      type: DataTypes.ENUM(...STACK_MATURITY),
      allowNull: false,
      defaultValue: 'in-use',
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: 'project_space_stacks',
    timestamps: false,
    indexes: [{ fields: ['space_id'] }, { fields: ['category'] }, { fields: ['technology'] }],
  }
);

module.exports = ProjectSpaceStack;

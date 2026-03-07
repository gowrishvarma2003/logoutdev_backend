const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const FreelanceProjectSkill = sequelize.define(
  'FreelanceProjectSkill',
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
  },
  {
    tableName: 'freelance_project_skills',
    timestamps: false,
    indexes: [
      { fields: ['project_id'] },
      { fields: ['rank'] },
      { unique: true, fields: ['project_id', 'skill'] },
    ],
  }
);

module.exports = FreelanceProjectSkill;

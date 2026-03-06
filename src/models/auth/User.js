const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const User = sequelize.define(
  'User',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
      defaultValue: '',
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true,
      },
    },
    username: {
      type: DataTypes.STRING(50),
      allowNull: true,
      unique: true,
      validate: {
        len: [3, 50],
      },
    },
    headline: {
      type: DataTypes.STRING(140),
      allowNull: true,
      defaultValue: null,
    },
    bio: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: null,
    },
    location: {
      type: DataTypes.STRING(120),
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
    linkedin_url: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: null,
    },
    password_hash: {
      type: DataTypes.STRING(255),
      allowNull: false,
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
    tableName: 'users',
    timestamps: false,
    indexes: [{ fields: ['email'] }, { fields: ['username'] }],
  }
);

module.exports = User;

const sequelize = require('../db/sequelize');
const { DataTypes } = require('sequelize');

// ─── Models ───────────────────────────────────────────────────────────────────
const User        = require('./auth/User');
const Post        = require('./feed/Post');
const PostLike    = require('./feed/PostLike');
const Repost      = require('./feed/Repost');
const PostHashtag = require('./feed/PostHashtag');
const Follow      = require('./social/Follow');
const ProjectSpace = require('./spaces/ProjectSpace');
const ProjectSpaceStack = require('./spaces/ProjectSpaceStack');
const ProjectSpaceMember = require('./spaces/ProjectSpaceMember');
const ProjectSpaceJoinRequest = require('./spaces/ProjectSpaceJoinRequest');
const ProjectSpaceDiscussion = require('./spaces/ProjectSpaceDiscussion');
const ProjectSpaceDiscussionReply = require('./spaces/ProjectSpaceDiscussionReply');
const ProjectSpaceUpdate = require('./spaces/ProjectSpaceUpdate');
const UserProfileSkill = require('./profile/UserProfileSkill');
const UserFeaturedProject = require('./profile/UserFeaturedProject');

// ─── Associations ─────────────────────────────────────────────────────────────

// User ↔ Post
User.hasMany(Post, { foreignKey: 'user_id', as: 'posts' });
Post.belongsTo(User, { foreignKey: 'user_id', as: 'author' });

// Post ↔ Replies (self-referential)
Post.hasMany(Post, { foreignKey: 'reply_to_id', as: 'replies' });
Post.belongsTo(Post, { foreignKey: 'reply_to_id', as: 'parent' });

// Post ↔ Likes
Post.hasMany(PostLike, { foreignKey: 'post_id', as: 'likes' });
PostLike.belongsTo(Post, { foreignKey: 'post_id' });
PostLike.belongsTo(User, { foreignKey: 'user_id', as: 'liker' });

// Post ↔ Reposts
Post.hasMany(Repost, { foreignKey: 'post_id', as: 'reposts' });
Repost.belongsTo(Post, { foreignKey: 'post_id' });
Repost.belongsTo(User, { foreignKey: 'user_id', as: 'reposter' });

// Post ↔ Hashtags
Post.hasMany(PostHashtag, { foreignKey: 'post_id', as: 'hashtags' });
PostHashtag.belongsTo(Post, { foreignKey: 'post_id' });

// User ↔ Follow
User.hasMany(Follow, { foreignKey: 'follower_id', as: 'following' });
User.hasMany(Follow, { foreignKey: 'following_id', as: 'followers' });
Follow.belongsTo(User, { foreignKey: 'follower_id', as: 'follower' });
Follow.belongsTo(User, { foreignKey: 'following_id', as: 'followed' });

// User ↔ ProjectSpace
User.hasMany(ProjectSpace, { foreignKey: 'owner_id', as: 'owned_spaces' });
ProjectSpace.belongsTo(User, { foreignKey: 'owner_id', as: 'owner' });

// ProjectSpace ↔ Stack
ProjectSpace.hasMany(ProjectSpaceStack, { foreignKey: 'space_id', as: 'stack' });
ProjectSpaceStack.belongsTo(ProjectSpace, { foreignKey: 'space_id', as: 'space' });

// ProjectSpace ↔ Members
ProjectSpace.hasMany(ProjectSpaceMember, { foreignKey: 'space_id', as: 'members' });
ProjectSpaceMember.belongsTo(ProjectSpace, { foreignKey: 'space_id', as: 'space' });
ProjectSpaceMember.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
User.hasMany(ProjectSpaceMember, { foreignKey: 'user_id', as: 'space_memberships' });

// ProjectSpace ↔ Join Requests
ProjectSpace.hasMany(ProjectSpaceJoinRequest, { foreignKey: 'space_id', as: 'join_requests' });
ProjectSpaceJoinRequest.belongsTo(ProjectSpace, { foreignKey: 'space_id', as: 'space' });
ProjectSpaceJoinRequest.belongsTo(User, { foreignKey: 'user_id', as: 'applicant' });

// ProjectSpace ↔ Discussions
ProjectSpace.hasMany(ProjectSpaceDiscussion, { foreignKey: 'space_id', as: 'discussions' });
ProjectSpaceDiscussion.belongsTo(ProjectSpace, { foreignKey: 'space_id', as: 'space' });
ProjectSpaceDiscussion.belongsTo(User, { foreignKey: 'author_id', as: 'author' });

// Discussion ↔ Replies
ProjectSpaceDiscussion.hasMany(ProjectSpaceDiscussionReply, { foreignKey: 'thread_id', as: 'replies' });
ProjectSpaceDiscussionReply.belongsTo(ProjectSpaceDiscussion, { foreignKey: 'thread_id', as: 'thread' });
ProjectSpaceDiscussionReply.belongsTo(User, { foreignKey: 'author_id', as: 'author' });
ProjectSpaceDiscussionReply.hasMany(ProjectSpaceDiscussionReply, {
  foreignKey: 'parent_reply_id',
  as: 'children',
});
ProjectSpaceDiscussionReply.belongsTo(ProjectSpaceDiscussionReply, {
  foreignKey: 'parent_reply_id',
  as: 'parent',
});

// ProjectSpace ↔ Updates
ProjectSpace.hasMany(ProjectSpaceUpdate, { foreignKey: 'space_id', as: 'updates' });
ProjectSpaceUpdate.belongsTo(ProjectSpace, { foreignKey: 'space_id', as: 'space' });
ProjectSpaceUpdate.belongsTo(User, { foreignKey: 'author_id', as: 'author' });

// User ↔ Profile Skills
User.hasMany(UserProfileSkill, { foreignKey: 'user_id', as: 'profile_skills' });
UserProfileSkill.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// User ↔ Featured Projects
User.hasMany(UserFeaturedProject, { foreignKey: 'user_id', as: 'featured_projects' });
UserFeaturedProject.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
ProjectSpace.hasMany(UserFeaturedProject, { foreignKey: 'space_id', as: 'featured_by_users' });
UserFeaturedProject.belongsTo(ProjectSpace, { foreignKey: 'space_id', as: 'space' });

async function ensureUserProfileColumns() {
  const queryInterface = sequelize.getQueryInterface();
  const table = await queryInterface.describeTable('users');

  if (!table.username) {
    await queryInterface.addColumn('users', 'username', {
      type: DataTypes.STRING(50),
      allowNull: true,
      unique: true,
    });
  }

  if (!table.headline) {
    await queryInterface.addColumn('users', 'headline', {
      type: DataTypes.STRING(140),
      allowNull: true,
    });
  }

  if (!table.bio) {
    await queryInterface.addColumn('users', 'bio', {
      type: DataTypes.TEXT,
      allowNull: true,
    });
  }

  if (!table.location) {
    await queryInterface.addColumn('users', 'location', {
      type: DataTypes.STRING(120),
      allowNull: true,
    });
  }

  if (!table.website_url) {
    await queryInterface.addColumn('users', 'website_url', {
      type: DataTypes.TEXT,
      allowNull: true,
    });
  }

  if (!table.github_url) {
    await queryInterface.addColumn('users', 'github_url', {
      type: DataTypes.TEXT,
      allowNull: true,
    });
  }

  if (!table.linkedin_url) {
    await queryInterface.addColumn('users', 'linkedin_url', {
      type: DataTypes.TEXT,
      allowNull: true,
    });
  }
}

function normalizeUsername(value) {
  return (typeof value === 'string' ? value : '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
}

async function ensureUsernameForUser(user) {
  const seed = user.name || (typeof user.email === 'string' ? user.email.split('@')[0] : 'developer');
  const base = normalizeUsername(seed) || 'developer';

  let candidate = base;
  let counter = 0;

  while (counter < 1000) {
    // eslint-disable-next-line no-await-in-loop
    const existing = await User.findOne({
      where: { username: candidate },
      attributes: ['id'],
    });

    if (!existing || existing.id === user.id) {
      user.username = candidate;
      user.updated_at = new Date();
      // eslint-disable-next-line no-await-in-loop
      await user.save();
      return;
    }

    counter += 1;
    candidate = `${base}_${counter}`.slice(0, 50);
  }

  user.username = `developer_${Date.now()}`.slice(0, 50);
  user.updated_at = new Date();
  await user.save();
}

async function backfillMissingUsernames() {
  const users = await User.findAll({
    where: {
      username: null,
    },
  });

  for (const user of users) {
    // eslint-disable-next-line no-await-in-loop
    await ensureUsernameForUser(user);
  }
}

async function ensureDiscussionReplyColumns() {
  const queryInterface = sequelize.getQueryInterface();
  const table = await queryInterface.describeTable('project_space_discussion_replies');

  if (!table.parent_reply_id) {
    await queryInterface.addColumn('project_space_discussion_replies', 'parent_reply_id', {
      type: DataTypes.UUID,
      allowNull: true,
    });
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function initModels() {
  await sequelize.authenticate();
  await sequelize.sync();
  await ensureUserProfileColumns();
  await ensureDiscussionReplyColumns();
  await backfillMissingUsernames();
}

module.exports = {
  sequelize,
  // Auth
  User,
  // Feed
  Post,
  PostLike,
  Repost,
  PostHashtag,
  // Social
  Follow,
  // Spaces
  ProjectSpace,
  ProjectSpaceStack,
  ProjectSpaceMember,
  ProjectSpaceJoinRequest,
  ProjectSpaceDiscussion,
  ProjectSpaceDiscussionReply,
  ProjectSpaceUpdate,
  UserProfileSkill,
  UserFeaturedProject,
  // Bootstrap
  initModels,
};
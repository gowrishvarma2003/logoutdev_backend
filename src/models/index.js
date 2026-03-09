const sequelize = require('../db/sequelize');
const { DataTypes } = require('sequelize');

// ─── Models ───────────────────────────────────────────────────────────────────
const User        = require('./auth/User');
const UserAccessToken = require('./auth/UserAccessToken');
const Post        = require('./feed/Post');
const PostLike    = require('./feed/PostLike');
const Repost      = require('./feed/Repost');
const PostHashtag = require('./feed/PostHashtag');
const PostMention = require('./feed/PostMention');
const HashtagCatalog = require('./feed/HashtagCatalog');
const HashtagRelation = require('./feed/HashtagRelation');
const NotificationOutbox = require('./feed/NotificationOutbox');
const UserNotification = require('./notifications/UserNotification');
const Follow      = require('./social/Follow');
const ProjectSpace = require('./spaces/ProjectSpace');
const ProjectSpaceStack = require('./spaces/ProjectSpaceStack');
const ProjectSpaceMember = require('./spaces/ProjectSpaceMember');
const ProjectSpaceJoinRequest = require('./spaces/ProjectSpaceJoinRequest');
const ProjectSpaceDiscussion = require('./spaces/ProjectSpaceDiscussion');
const ProjectSpaceDiscussionReply = require('./spaces/ProjectSpaceDiscussionReply');
const ProjectSpaceUpdate = require('./spaces/ProjectSpaceUpdate');
const ProjectSpaceIssue = require('./spaces/ProjectSpaceIssue');
const ProjectSpaceRepo = require('./spaces/ProjectSpaceRepo');
const ProjectSpaceRepoMember = require('./spaces/ProjectSpaceRepoMember');
const Launch = require('./launches/Launch');
const LaunchScreenshot = require('./launches/LaunchScreenshot');
const LaunchTechStack = require('./launches/LaunchTechStack');
const LaunchUpvote = require('./launches/LaunchUpvote');
const LaunchReview = require('./launches/LaunchReview');
const LaunchFeedbackItem = require('./launches/LaunchFeedbackItem');
const LaunchFeedbackComment = require('./launches/LaunchFeedbackComment');
const FreelanceProject = require('./freelance/FreelanceProject');
const FreelanceProjectSkill = require('./freelance/FreelanceProjectSkill');
const FreelanceProposal = require('./freelance/FreelanceProposal');
const Question = require('./questions/Question');
const QuestionOption = require('./questions/QuestionOption');
const QuestionMcqResponse = require('./questions/QuestionMcqResponse');
const QuestionAnswer = require('./questions/QuestionAnswer');
const QuestionAnswerVote = require('./questions/QuestionAnswerVote');
const QuestionDiscussionComment = require('./questions/QuestionDiscussionComment');
const QuestionTag = require('./questions/QuestionTag');
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
PostHashtag.belongsTo(Post, { foreignKey: 'post_id', as: 'post' });

// Post ↔ Mentions
Post.hasMany(PostMention, { foreignKey: 'post_id', as: 'mentions' });
PostMention.belongsTo(Post, { foreignKey: 'post_id', as: 'post' });
PostMention.belongsTo(User, { foreignKey: 'mentioned_user_id', as: 'mentioned_user' });
User.hasMany(PostMention, { foreignKey: 'mentioned_user_id', as: 'post_mentions' });

// User ↔ Follow
User.hasMany(Follow, { foreignKey: 'follower_id', as: 'following' });
User.hasMany(Follow, { foreignKey: 'following_id', as: 'followers' });
Follow.belongsTo(User, { foreignKey: 'follower_id', as: 'follower' });
Follow.belongsTo(User, { foreignKey: 'following_id', as: 'followed' });

// User ↔ Notifications
User.hasMany(UserNotification, { foreignKey: 'recipient_user_id', as: 'received_notifications' });
User.hasMany(UserNotification, { foreignKey: 'actor_user_id', as: 'sent_notifications' });
UserNotification.belongsTo(User, { foreignKey: 'recipient_user_id', as: 'recipient' });
UserNotification.belongsTo(User, { foreignKey: 'actor_user_id', as: 'actor' });

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

// ProjectSpace ↔ Issues
ProjectSpace.hasMany(ProjectSpaceIssue, { foreignKey: 'space_id', as: 'issues' });
ProjectSpaceIssue.belongsTo(ProjectSpace, { foreignKey: 'space_id', as: 'space' });
ProjectSpaceIssue.belongsTo(User, { foreignKey: 'author_id', as: 'author' });
ProjectSpaceIssue.belongsTo(User, { foreignKey: 'assignee_user_id', as: 'assignee' });
User.hasMany(ProjectSpaceIssue, { foreignKey: 'author_id', as: 'reported_space_issues' });
User.hasMany(ProjectSpaceIssue, { foreignKey: 'assignee_user_id', as: 'assigned_space_issues' });

// ProjectSpace ↔ Repositories
ProjectSpace.hasMany(ProjectSpaceRepo, { foreignKey: 'space_id', as: 'repos' });
ProjectSpaceRepo.belongsTo(ProjectSpace, { foreignKey: 'space_id', as: 'space' });
ProjectSpaceRepo.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });

// Repositories ↔ Members
ProjectSpaceRepo.hasMany(ProjectSpaceRepoMember, { foreignKey: 'repo_id', as: 'members' });
ProjectSpaceRepoMember.belongsTo(ProjectSpaceRepo, { foreignKey: 'repo_id', as: 'repo' });
ProjectSpaceRepoMember.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
User.hasMany(ProjectSpaceRepoMember, { foreignKey: 'user_id', as: 'repo_memberships' });

// User ↔ Access tokens
User.hasMany(UserAccessToken, { foreignKey: 'user_id', as: 'access_tokens' });
UserAccessToken.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// User ↔ Questions
User.hasMany(Question, { foreignKey: 'author_id', as: 'questions' });
Question.belongsTo(User, { foreignKey: 'author_id', as: 'author' });

// Question ↔ Options
Question.hasMany(QuestionOption, { foreignKey: 'question_id', as: 'options' });
QuestionOption.belongsTo(Question, { foreignKey: 'question_id', as: 'question' });

// Question ↔ Responses
Question.hasMany(QuestionMcqResponse, { foreignKey: 'question_id', as: 'responses' });
QuestionMcqResponse.belongsTo(Question, { foreignKey: 'question_id', as: 'question' });
QuestionMcqResponse.belongsTo(QuestionOption, { foreignKey: 'option_id', as: 'option' });
QuestionOption.hasMany(QuestionMcqResponse, { foreignKey: 'option_id', as: 'responses' });
QuestionMcqResponse.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
User.hasMany(QuestionMcqResponse, { foreignKey: 'user_id', as: 'question_responses' });

// Question ↔ Answers
Question.hasMany(QuestionAnswer, { foreignKey: 'question_id', as: 'answers' });
QuestionAnswer.belongsTo(Question, { foreignKey: 'question_id', as: 'question' });
QuestionAnswer.belongsTo(User, { foreignKey: 'author_id', as: 'author' });
User.hasMany(QuestionAnswer, { foreignKey: 'author_id', as: 'question_answers' });

// Question Answer ↔ Votes
QuestionAnswer.hasMany(QuestionAnswerVote, { foreignKey: 'answer_id', as: 'votes' });
QuestionAnswerVote.belongsTo(QuestionAnswer, { foreignKey: 'answer_id', as: 'answer' });
QuestionAnswerVote.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
User.hasMany(QuestionAnswerVote, { foreignKey: 'user_id', as: 'question_answer_votes' });

// Question ↔ Discussion comments
Question.hasMany(QuestionDiscussionComment, { foreignKey: 'question_id', as: 'discussion_comments' });
QuestionDiscussionComment.belongsTo(Question, { foreignKey: 'question_id', as: 'question' });
QuestionDiscussionComment.belongsTo(User, { foreignKey: 'author_id', as: 'author' });
User.hasMany(QuestionDiscussionComment, { foreignKey: 'author_id', as: 'question_discussion_comments' });
QuestionDiscussionComment.hasMany(QuestionDiscussionComment, {
  foreignKey: 'parent_comment_id',
  as: 'children',
});
QuestionDiscussionComment.belongsTo(QuestionDiscussionComment, {
  foreignKey: 'parent_comment_id',
  as: 'parent',
});

// Question ↔ Tags
Question.hasMany(QuestionTag, { foreignKey: 'question_id', as: 'tags' });
QuestionTag.belongsTo(Question, { foreignKey: 'question_id', as: 'question' });

// User ↔ Profile Skills
User.hasMany(UserProfileSkill, { foreignKey: 'user_id', as: 'profile_skills' });
UserProfileSkill.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// User ↔ Featured Projects
User.hasMany(UserFeaturedProject, { foreignKey: 'user_id', as: 'featured_projects' });
UserFeaturedProject.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
ProjectSpace.hasMany(UserFeaturedProject, { foreignKey: 'space_id', as: 'featured_by_users' });
UserFeaturedProject.belongsTo(ProjectSpace, { foreignKey: 'space_id', as: 'space' });

User.hasMany(Launch, { foreignKey: 'builder_id', as: 'launches' });
Launch.belongsTo(User, { foreignKey: 'builder_id', as: 'builder' });
ProjectSpace.hasOne(Launch, { foreignKey: 'linked_space_id', as: 'linked_launch' });
Launch.belongsTo(ProjectSpace, { foreignKey: 'linked_space_id', as: 'linked_space' });
Launch.hasMany(LaunchScreenshot, { foreignKey: 'launch_id', as: 'screenshots' });
LaunchScreenshot.belongsTo(Launch, { foreignKey: 'launch_id', as: 'launch' });
Launch.hasMany(LaunchTechStack, { foreignKey: 'launch_id', as: 'tech_stack' });
LaunchTechStack.belongsTo(Launch, { foreignKey: 'launch_id', as: 'launch' });
Launch.hasMany(LaunchUpvote, { foreignKey: 'launch_id', as: 'upvotes' });
LaunchUpvote.belongsTo(Launch, { foreignKey: 'launch_id', as: 'launch' });
LaunchUpvote.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
User.hasMany(LaunchUpvote, { foreignKey: 'user_id', as: 'launch_upvotes' });
Launch.hasMany(LaunchReview, { foreignKey: 'launch_id', as: 'reviews' });
LaunchReview.belongsTo(Launch, { foreignKey: 'launch_id', as: 'launch' });
LaunchReview.belongsTo(User, { foreignKey: 'author_id', as: 'author' });
User.hasMany(LaunchReview, { foreignKey: 'author_id', as: 'launch_reviews' });
Launch.hasMany(LaunchFeedbackItem, { foreignKey: 'launch_id', as: 'feedback_items' });
LaunchFeedbackItem.belongsTo(Launch, { foreignKey: 'launch_id', as: 'launch' });
LaunchFeedbackItem.belongsTo(User, { foreignKey: 'author_id', as: 'author' });
User.hasMany(LaunchFeedbackItem, { foreignKey: 'author_id', as: 'launch_feedback_items' });
LaunchFeedbackItem.hasMany(LaunchFeedbackComment, { foreignKey: 'feedback_id', as: 'comments' });
LaunchFeedbackComment.belongsTo(LaunchFeedbackItem, { foreignKey: 'feedback_id', as: 'feedback' });
LaunchFeedbackComment.belongsTo(User, { foreignKey: 'author_id', as: 'author' });
User.hasMany(LaunchFeedbackComment, { foreignKey: 'author_id', as: 'launch_feedback_comments' });

User.hasMany(FreelanceProject, { foreignKey: 'client_id', as: 'client_projects' });
FreelanceProject.belongsTo(User, { foreignKey: 'client_id', as: 'client' });
FreelanceProject.hasMany(FreelanceProjectSkill, { foreignKey: 'project_id', as: 'skills' });
FreelanceProjectSkill.belongsTo(FreelanceProject, { foreignKey: 'project_id', as: 'project' });
FreelanceProject.hasMany(FreelanceProposal, { foreignKey: 'project_id', as: 'proposals' });
FreelanceProposal.belongsTo(FreelanceProject, { foreignKey: 'project_id', as: 'project' });
FreelanceProposal.belongsTo(User, { foreignKey: 'freelancer_id', as: 'freelancer' });
User.hasMany(FreelanceProposal, { foreignKey: 'freelancer_id', as: 'freelance_proposals' });
FreelanceProject.belongsTo(ProjectSpace, { foreignKey: 'linked_space_id', as: 'linked_space' });
FreelanceProject.belongsTo(FreelanceProposal, {
  foreignKey: 'accepted_proposal_id',
  as: 'accepted_proposal',
  constraints: false,
});

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

async function ensureQuestionDiscussionColumns() {
  const queryInterface = sequelize.getQueryInterface();

  try {
    const table = await queryInterface.describeTable('question_discussion_comments');

    if (!table.parent_comment_id) {
      await queryInterface.addColumn('question_discussion_comments', 'parent_comment_id', {
        type: DataTypes.UUID,
        allowNull: true,
      });
    }
  } catch (error) {
    // Table may not exist on first boot; sequelize.sync() creates it.
  }
}

async function ensureQuestionOptionColumns() {
  const queryInterface = sequelize.getQueryInterface();

  try {
    const table = await queryInterface.describeTable('question_options');

    if (!table.is_correct) {
      await queryInterface.addColumn('question_options', 'is_correct', {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
    }
  } catch (error) {
    // Table may not exist on first boot; sequelize.sync() creates it.
  }
}

async function addIndexSafe(tableName, fields, options = {}) {
  const queryInterface = sequelize.getQueryInterface();
  const indexes = await queryInterface.showIndex(tableName);
  const name = options.name || `${tableName}_${fields.join('_')}`;
  const exists = indexes.some((index) => index.name === name);
  if (exists) return;

  await queryInterface.addIndex(tableName, {
    ...options,
    fields,
    name,
  });
}

async function ensurePostHashtagColumns() {
  const queryInterface = sequelize.getQueryInterface();

  try {
    const table = await queryInterface.describeTable('post_hashtags');

    if (!table.normalized_tag) {
      await queryInterface.addColumn('post_hashtags', 'normalized_tag', {
        type: DataTypes.STRING(100),
        allowNull: false,
        defaultValue: '',
      });
    }

    if (!table.start_index) {
      await queryInterface.addColumn('post_hashtags', 'start_index', {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      });
    }

    if (!table.end_index) {
      await queryInterface.addColumn('post_hashtags', 'end_index', {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      });
    }

    await addIndexSafe('post_hashtags', ['normalized_tag'], {
      name: 'post_hashtags_normalized_tag',
    });
    await addIndexSafe('post_hashtags', ['post_id', 'normalized_tag'], {
      name: 'post_hashtags_post_id_normalized_tag',
      unique: true,
    });
  } catch (error) {
    // Table may not exist on first boot; sequelize.sync() creates it.
  }
}

async function ensureNotificationOutboxColumns() {
  const queryInterface = sequelize.getQueryInterface();

  try {
    const table = await queryInterface.describeTable('notification_outbox');

    if (!table.payload) {
      await queryInterface.addColumn('notification_outbox', 'payload', {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: null,
      });
    }

    if (!table.created_at) {
      await queryInterface.addColumn('notification_outbox', 'created_at', {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      });
    }

    if (!table.processed_at) {
      await queryInterface.addColumn('notification_outbox', 'processed_at', {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
      });
    }
  } catch (error) {
    // Table may not exist on first boot; sequelize.sync() creates it.
  }
}

async function ensurePostLinkedEntityColumns() {
  const queryInterface = sequelize.getQueryInterface();

  try {
    const table = await queryInterface.describeTable('posts');

    if (!table.linked_entity_type) {
      await queryInterface.addColumn('posts', 'linked_entity_type', {
        type: DataTypes.STRING(40),
        allowNull: true,
      });
    }

    if (!table.linked_entity_id) {
      await queryInterface.addColumn('posts', 'linked_entity_id', {
        type: DataTypes.UUID,
        allowNull: true,
      });
    }

    await addIndexSafe('posts', ['linked_entity_type', 'linked_entity_id'], {
      name: 'posts_linked_entity_type_linked_entity_id',
    });
  } catch (error) {
    // Table may not exist on first boot; sequelize.sync() creates it.
  }
}

async function backfillNotificationInboxFromOutbox() {
  const rows = await NotificationOutbox.findAll({
    where: { event_type: 'mention_created' },
    attributes: [
      'dedupe_key',
      'actor_user_id',
      'recipient_user_id',
      'post_id',
      'payload',
      'created_at',
    ],
  });

  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    await UserNotification.findOrCreate({
      where: { dedupe_key: row.dedupe_key },
      defaults: {
        recipient_user_id: row.recipient_user_id,
        actor_user_id: row.actor_user_id,
        event_type: 'mention_created',
        category: 'social',
        priority: 'important',
        entity_type: 'post',
        entity_id: row.post_id,
        entity_snapshot: {
          type: 'post',
          id: row.post_id,
          title: 'Post mention',
          href: `/post/${row.post_id}`,
          subtitle: null,
          visibility: null,
          tags: [],
        },
        secondary_entity_type: null,
        secondary_entity_id: null,
        secondary_snapshot: null,
        action_url: `/post/${row.post_id}`,
        preview_text: 'mentioned you in a post',
        group_key: `post:mention:${row.post_id}:${row.recipient_user_id}`,
        created_at: row.created_at || new Date(),
      },
    });
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function initModels() {
  await sequelize.authenticate();
  await ensurePostHashtagColumns();
  await ensurePostLinkedEntityColumns();
  await ensureNotificationOutboxColumns();
  await sequelize.sync();
  await ensureUserProfileColumns();
  await ensureDiscussionReplyColumns();
  await ensureQuestionDiscussionColumns();
  await ensureQuestionOptionColumns();
  await backfillMissingUsernames();
  await backfillNotificationInboxFromOutbox();
  const { ensureFeedEntityAggregates } = require('../services/feed/postEntities');
  await ensureFeedEntityAggregates();
}

module.exports = {
  sequelize,
  // Auth
  User,
  UserAccessToken,
  // Feed
  Post,
  PostLike,
  Repost,
  PostHashtag,
  PostMention,
  HashtagCatalog,
  HashtagRelation,
  NotificationOutbox,
  UserNotification,
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
  ProjectSpaceIssue,
  ProjectSpaceRepo,
  ProjectSpaceRepoMember,
  Launch,
  LaunchScreenshot,
  LaunchTechStack,
  LaunchUpvote,
  LaunchReview,
  LaunchFeedbackItem,
  LaunchFeedbackComment,
  FreelanceProject,
  FreelanceProjectSkill,
  FreelanceProposal,
  Question,
  QuestionOption,
  QuestionMcqResponse,
  QuestionAnswer,
  QuestionAnswerVote,
  QuestionDiscussionComment,
  QuestionTag,
  UserProfileSkill,
  UserFeaturedProject,
  // Bootstrap
  initModels,
};

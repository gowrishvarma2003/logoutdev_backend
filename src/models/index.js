const sequelize = require('../db/sequelize');
const { DataTypes } = require('sequelize');
const { logger } = require('../logging/logger');

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
const ProjectSpaceIssueComment = require('./spaces/ProjectSpaceIssueComment');
const ProjectSpaceIssueActivity = require('./spaces/ProjectSpaceIssueActivity');
const ProjectSpaceMilestone = require('./spaces/ProjectSpaceMilestone');
const ProjectSpaceRepo = require('./spaces/ProjectSpaceRepo');
const ProjectSpaceRepoMember = require('./spaces/ProjectSpaceRepoMember');
const ProjectSpaceRepoAttachment = require('./spaces/ProjectSpaceRepoAttachment');
const ProjectSpaceFollower = require('./spaces/ProjectSpaceFollower');
const RepoStar = require('./repos/RepoStar');
const RepoWatch = require('./repos/RepoWatch');
const RepoFork = require('./repos/RepoFork');
const RepoRelease = require('./repos/RepoRelease');
const PullRequest = require('./repos/PullRequest');
const PullRequestReview = require('./repos/PullRequestReview');
const PullRequestComment = require('./repos/PullRequestComment');
const BranchProtectionRule = require('./repos/BranchProtectionRule');
const RepoDiscussion = require('./repos/RepoDiscussion');
const RepoDiscussionComment = require('./repos/RepoDiscussionComment');
const Launch = require('./launches/Launch');
const LaunchScreenshot = require('./launches/LaunchScreenshot');
const LaunchTechStack = require('./launches/LaunchTechStack');
const LaunchUpvote = require('./launches/LaunchUpvote');
const LaunchReview = require('./launches/LaunchReview');
const LaunchBetaRegistration = require('./launches/LaunchBetaRegistration');
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
const PollOption = require('./feed/PollOption');
const PollVote = require('./feed/PollVote');

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

// Post ↔ PollOptions
Post.hasMany(PollOption, { foreignKey: 'post_id', as: 'poll_options' });
PollOption.belongsTo(Post, { foreignKey: 'post_id', as: 'post' });

// Post ↔ PollVotes
Post.hasMany(PollVote, { foreignKey: 'post_id', as: 'poll_votes' });
PollVote.belongsTo(Post, { foreignKey: 'post_id', as: 'post' });
PollVote.belongsTo(PollOption, { foreignKey: 'option_id', as: 'option' });
PollOption.hasMany(PollVote, { foreignKey: 'option_id', as: 'votes' });
PollVote.belongsTo(User, { foreignKey: 'user_id', as: 'voter' });

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
ProjectSpaceDiscussion.belongsTo(ProjectSpaceDiscussionReply, { foreignKey: 'answer_reply_id', as: 'answer_reply' });

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
ProjectSpaceUpdate.belongsTo(ProjectSpaceRepo, { foreignKey: 'repo_id', as: 'repo' });
ProjectSpaceUpdate.belongsTo(ProjectSpaceIssue, { foreignKey: 'work_item_id', as: 'work_item' });

// ProjectSpace ↔ Issues
ProjectSpace.hasMany(ProjectSpaceIssue, { foreignKey: 'space_id', as: 'issues' });
ProjectSpaceIssue.belongsTo(ProjectSpace, { foreignKey: 'space_id', as: 'space' });
ProjectSpaceIssue.belongsTo(User, { foreignKey: 'author_id', as: 'author' });
ProjectSpaceIssue.belongsTo(User, { foreignKey: 'assignee_user_id', as: 'assignee' });
ProjectSpaceIssue.belongsTo(ProjectSpaceRepo, { foreignKey: 'repo_id', as: 'repo' });
ProjectSpaceIssue.belongsTo(ProjectSpaceMilestone, { foreignKey: 'milestone_id', as: 'milestone' });
User.hasMany(ProjectSpaceIssue, { foreignKey: 'author_id', as: 'reported_space_issues' });
User.hasMany(ProjectSpaceIssue, { foreignKey: 'assignee_user_id', as: 'assigned_space_issues' });

// ProjectSpace ↔ Work comments
ProjectSpaceIssue.hasMany(ProjectSpaceIssueComment, { foreignKey: 'issue_id', as: 'comments' });
ProjectSpaceIssueComment.belongsTo(ProjectSpaceIssue, { foreignKey: 'issue_id', as: 'issue' });
ProjectSpaceIssueComment.belongsTo(User, { foreignKey: 'author_id', as: 'author' });
User.hasMany(ProjectSpaceIssueComment, { foreignKey: 'author_id', as: 'space_issue_comments' });
ProjectSpaceIssueComment.hasMany(ProjectSpaceIssueComment, {
  foreignKey: 'parent_comment_id',
  as: 'children',
});
ProjectSpaceIssueComment.belongsTo(ProjectSpaceIssueComment, {
  foreignKey: 'parent_comment_id',
  as: 'parent',
});

// ProjectSpace ↔ Work activity
ProjectSpace.hasMany(ProjectSpaceIssueActivity, { foreignKey: 'space_id', as: 'work_activity' });
ProjectSpaceIssueActivity.belongsTo(ProjectSpace, { foreignKey: 'space_id', as: 'space' });
ProjectSpaceIssue.hasMany(ProjectSpaceIssueActivity, { foreignKey: 'issue_id', as: 'activity_entries' });
ProjectSpaceIssueActivity.belongsTo(ProjectSpaceIssue, { foreignKey: 'issue_id', as: 'issue' });
ProjectSpaceIssueActivity.belongsTo(User, { foreignKey: 'actor_user_id', as: 'actor' });
User.hasMany(ProjectSpaceIssueActivity, { foreignKey: 'actor_user_id', as: 'space_issue_activity' });

// ProjectSpace ↔ Milestones
ProjectSpace.hasMany(ProjectSpaceMilestone, { foreignKey: 'space_id', as: 'milestones' });
ProjectSpaceMilestone.belongsTo(ProjectSpace, { foreignKey: 'space_id', as: 'space' });
ProjectSpaceMilestone.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });
User.hasMany(ProjectSpaceMilestone, { foreignKey: 'created_by', as: 'space_milestones_created' });
ProjectSpaceMilestone.hasMany(ProjectSpaceIssue, { foreignKey: 'milestone_id', as: 'issues' });

// ProjectSpace ↔ Repositories
ProjectSpace.hasMany(ProjectSpaceRepo, { foreignKey: 'space_id', as: 'repos' });
ProjectSpaceRepo.belongsTo(ProjectSpace, { foreignKey: 'space_id', as: 'space' });
ProjectSpaceRepo.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });
ProjectSpaceRepo.belongsTo(User, { foreignKey: 'owner_id', as: 'owner' });
User.hasMany(ProjectSpaceRepo, { foreignKey: 'owner_id', as: 'owned_repos' });

// Repositories ↔ Members
ProjectSpaceRepo.hasMany(ProjectSpaceRepoMember, { foreignKey: 'repo_id', as: 'members' });
ProjectSpaceRepoMember.belongsTo(ProjectSpaceRepo, { foreignKey: 'repo_id', as: 'repo' });
ProjectSpaceRepoMember.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
User.hasMany(ProjectSpaceRepoMember, { foreignKey: 'user_id', as: 'repo_memberships' });

// ProjectSpace ↔ Repo Attachments
ProjectSpace.hasMany(ProjectSpaceRepoAttachment, { foreignKey: 'space_id', as: 'attached_repos' });
ProjectSpaceRepoAttachment.belongsTo(ProjectSpace, { foreignKey: 'space_id', as: 'space' });
ProjectSpaceRepoAttachment.belongsTo(ProjectSpaceRepo, { foreignKey: 'repo_id', as: 'repo' });
ProjectSpaceRepoAttachment.belongsTo(User, { foreignKey: 'attached_by', as: 'attached_by_user' });
ProjectSpaceRepo.hasOne(ProjectSpaceRepoAttachment, { foreignKey: 'repo_id', as: 'attachment' });

// Repositories ↔ Stars
ProjectSpaceRepo.hasMany(RepoStar, { foreignKey: 'repo_id', as: 'stars' });
RepoStar.belongsTo(ProjectSpaceRepo, { foreignKey: 'repo_id', as: 'repo' });
RepoStar.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
User.hasMany(RepoStar, { foreignKey: 'user_id', as: 'repo_stars' });

// Repositories ↔ Watches
ProjectSpaceRepo.hasMany(RepoWatch, { foreignKey: 'repo_id', as: 'watches' });
RepoWatch.belongsTo(ProjectSpaceRepo, { foreignKey: 'repo_id', as: 'repo' });
RepoWatch.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
User.hasMany(RepoWatch, { foreignKey: 'user_id', as: 'repo_watches' });

// Repositories ↔ Forks
ProjectSpaceRepo.hasMany(RepoFork, { foreignKey: 'source_repo_id', as: 'forks' });
RepoFork.belongsTo(ProjectSpaceRepo, { foreignKey: 'source_repo_id', as: 'source_repo' });
RepoFork.belongsTo(ProjectSpaceRepo, { foreignKey: 'forked_repo_id', as: 'forked_repo' });
RepoFork.belongsTo(User, { foreignKey: 'forked_by', as: 'forker' });

// Repositories ↔ Releases
ProjectSpaceRepo.hasMany(RepoRelease, { foreignKey: 'repo_id', as: 'releases' });
RepoRelease.belongsTo(ProjectSpaceRepo, { foreignKey: 'repo_id', as: 'repo' });
RepoRelease.belongsTo(User, { foreignKey: 'created_by', as: 'author' });
User.hasMany(RepoRelease, { foreignKey: 'created_by', as: 'repo_releases' });

// Repositories ↔ Pull Requests
ProjectSpaceRepo.hasMany(PullRequest, { foreignKey: 'repo_id', as: 'pull_requests' });
PullRequest.belongsTo(ProjectSpaceRepo, { foreignKey: 'repo_id', as: 'repo' });
ProjectSpaceRepo.hasMany(PullRequest, { foreignKey: 'source_repo_id', as: 'fork_pull_requests' });
PullRequest.belongsTo(ProjectSpaceRepo, { foreignKey: 'source_repo_id', as: 'source_repo' });
PullRequest.belongsTo(User, { foreignKey: 'author_id', as: 'author' });
PullRequest.belongsTo(User, { foreignKey: 'merged_by', as: 'merger' });
User.hasMany(PullRequest, { foreignKey: 'author_id', as: 'authored_prs' });

// Pull Request ↔ Reviews
PullRequest.hasMany(PullRequestReview, { foreignKey: 'pull_request_id', as: 'reviews' });
PullRequestReview.belongsTo(PullRequest, { foreignKey: 'pull_request_id', as: 'pull_request' });
PullRequestReview.belongsTo(User, { foreignKey: 'reviewer_id', as: 'reviewer' });
User.hasMany(PullRequestReview, { foreignKey: 'reviewer_id', as: 'pr_reviews' });

// Pull Request ↔ Comments
PullRequest.hasMany(PullRequestComment, { foreignKey: 'pull_request_id', as: 'comments' });
PullRequestComment.belongsTo(PullRequest, { foreignKey: 'pull_request_id', as: 'pull_request' });
PullRequestComment.belongsTo(PullRequestReview, { foreignKey: 'review_id', as: 'review' });
PullRequestReview.hasMany(PullRequestComment, { foreignKey: 'review_id', as: 'comments' });
PullRequestComment.belongsTo(User, { foreignKey: 'author_id', as: 'author' });
User.hasMany(PullRequestComment, { foreignKey: 'author_id', as: 'pr_comments' });
PullRequestComment.hasMany(PullRequestComment, { foreignKey: 'parent_comment_id', as: 'replies' });
PullRequestComment.belongsTo(PullRequestComment, { foreignKey: 'parent_comment_id', as: 'parent' });

// --- Governance & Community (Phase 3) ---
ProjectSpaceRepo.hasMany(BranchProtectionRule, { foreignKey: 'repo_id', as: 'branch_protection_rules' });
BranchProtectionRule.belongsTo(ProjectSpaceRepo, { foreignKey: 'repo_id', as: 'repo' });
BranchProtectionRule.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });

ProjectSpaceRepo.hasMany(RepoDiscussion, { foreignKey: 'repo_id', as: 'discussions' });
RepoDiscussion.belongsTo(ProjectSpaceRepo, { foreignKey: 'repo_id', as: 'repo' });
RepoDiscussion.belongsTo(User, { foreignKey: 'author_id', as: 'author' });
User.hasMany(RepoDiscussion, { foreignKey: 'author_id', as: 'repo_discussions' });

RepoDiscussion.hasMany(RepoDiscussionComment, { foreignKey: 'discussion_id', as: 'comments' });
RepoDiscussionComment.belongsTo(RepoDiscussion, { foreignKey: 'discussion_id', as: 'discussion' });
RepoDiscussionComment.belongsTo(User, { foreignKey: 'author_id', as: 'author' });
User.hasMany(RepoDiscussionComment, { foreignKey: 'author_id', as: 'repo_discussion_comments' });

RepoDiscussion.belongsTo(RepoDiscussionComment, { foreignKey: 'answer_comment_id', as: 'answer_comment' });

RepoDiscussionComment.hasMany(RepoDiscussionComment, { foreignKey: 'parent_comment_id', as: 'replies' });
RepoDiscussionComment.belongsTo(RepoDiscussionComment, { foreignKey: 'parent_comment_id', as: 'parent' });


// ProjectSpace ↔ Followers
ProjectSpace.hasMany(ProjectSpaceFollower, { foreignKey: 'space_id', as: 'followers' });
ProjectSpaceFollower.belongsTo(ProjectSpace, { foreignKey: 'space_id', as: 'space' });
ProjectSpaceFollower.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
User.hasMany(ProjectSpaceFollower, { foreignKey: 'user_id', as: 'space_follows' });

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
ProjectSpace.hasOne(Launch, { foreignKey: 'linked_space_id', as: 'linked_launch', constraints: false });
Launch.belongsTo(ProjectSpace, { foreignKey: 'linked_space_id', as: 'linked_space', constraints: false });
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
Launch.hasMany(LaunchBetaRegistration, { foreignKey: 'launch_id', as: 'beta_registrations' });
LaunchBetaRegistration.belongsTo(Launch, { foreignKey: 'launch_id', as: 'launch' });
LaunchBetaRegistration.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
LaunchBetaRegistration.belongsTo(User, { foreignKey: 'reviewed_by', as: 'reviewer' });
User.hasMany(LaunchBetaRegistration, { foreignKey: 'user_id', as: 'launch_beta_registrations' });
User.hasMany(LaunchBetaRegistration, { foreignKey: 'reviewed_by', as: 'launch_beta_reviews' });
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
FreelanceProject.belongsTo(ProjectSpace, { foreignKey: 'linked_space_id', as: 'linked_space', constraints: false });
FreelanceProject.belongsTo(FreelanceProposal, {
  foreignKey: 'accepted_proposal_id',
  as: 'accepted_proposal',
  constraints: false,
});

async function ensureUserProfileColumns() {
  const queryInterface = sequelize.getQueryInterface();
  const table = await describeTableSafe('users');
  if (!table) return;

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
  const table = await describeTableSafe('project_space_discussion_replies');
  if (!table) return;

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

async function ensureLaunchColumns() {
  const queryInterface = sequelize.getQueryInterface();
  const table = await describeTableSafe('launches');
  if (!table) return;

  if (!table.launch_phase) {
    await queryInterface.addColumn('launches', 'launch_phase', {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'live',
    });
  }

  if (!table.beta_capacity) {
    await queryInterface.addColumn('launches', 'beta_capacity', {
      type: DataTypes.INTEGER,
      allowNull: true,
    });
  }

  if (!table.beta_access_url) {
    await queryInterface.addColumn('launches', 'beta_access_url', {
      type: DataTypes.TEXT,
      allowNull: true,
    });
  }

  if (!table.beta_opened_at) {
    await queryInterface.addColumn('launches', 'beta_opened_at', {
      type: DataTypes.DATE,
      allowNull: true,
    });
  }

  if (!table.live_url) {
    await queryInterface.addColumn('launches', 'live_url', {
      type: DataTypes.TEXT,
      allowNull: true,
    });
  }

  if (!table.went_live_at) {
    await queryInterface.addColumn('launches', 'went_live_at', {
      type: DataTypes.DATE,
      allowNull: true,
    });
  }

  await sequelize.query(`
    UPDATE launches
    SET launch_phase = COALESCE(NULLIF(launch_phase, ''), 'live'),
        live_url = COALESCE(live_url, demo_url, website_url),
        went_live_at = COALESCE(went_live_at, published_at)
  `);
}

async function ensureLaunchFeedbackColumns() {
  const queryInterface = sequelize.getQueryInterface();
  const table = await describeTableSafe('launch_feedback_items');
  if (!table) return;

  if (!table.visibility_scope) {
    await queryInterface.addColumn('launch_feedback_items', 'visibility_scope', {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'public',
    });
  }

  await sequelize.query(`
    UPDATE launch_feedback_items
    SET visibility_scope = COALESCE(NULLIF(visibility_scope, ''), 'public')
  `);
}

async function ensureLaunchBetaRegistrationTable() {
  const table = await describeTableSafe('launch_beta_registrations');
  if (table) return;

  await LaunchBetaRegistration.sync();
}

async function describeTableSafe(tableName) {
  const queryInterface = sequelize.getQueryInterface();

  try {
    return await queryInterface.describeTable(tableName);
  } catch (error) {
    return null;
  }
}

async function ensureEnumValue(typeName, value) {
  await sequelize.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_type t
        WHERE t.typname = '${typeName}'
      ) AND NOT EXISTS (
        SELECT 1
        FROM pg_enum e
        INNER JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = '${typeName}' AND e.enumlabel = '${value}'
      ) THEN
        ALTER TYPE "${typeName}" ADD VALUE '${value}';
      END IF;
    END$$;
  `);
}

async function ensureSpaceColumns() {
  const queryInterface = sequelize.getQueryInterface();
  const table = await describeTableSafe('project_spaces');
  if (!table) return;

  if (!table.working_in_public) {
    await queryInterface.addColumn('project_spaces', 'working_in_public', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  }

  if (!table.current_focus) {
    await queryInterface.addColumn('project_spaces', 'current_focus', {
      type: DataTypes.TEXT,
      allowNull: true,
    });
  }

  if (!table.open_roles) {
    await queryInterface.addColumn('project_spaces', 'open_roles', {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    });
  }

  if (!table.needed_skills) {
    await queryInterface.addColumn('project_spaces', 'needed_skills', {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    });
  }

  if (!table.contribution_guide) {
    await queryInterface.addColumn('project_spaces', 'contribution_guide', {
      type: DataTypes.TEXT,
      allowNull: true,
    });
  }

  if (!table.response_sla) {
    await queryInterface.addColumn('project_spaces', 'response_sla', {
      type: DataTypes.STRING(160),
      allowNull: true,
    });
  }
}

async function ensureRepoColumns() {
  const queryInterface = sequelize.getQueryInterface();
  const table = await describeTableSafe('project_space_repos');
  if (!table) return;

  if (!table.owner_id) {
    await queryInterface.addColumn('project_space_repos', 'owner_id', {
      type: DataTypes.UUID,
      allowNull: true,
    });
  }

  if (!table.visibility) {
    await queryInterface.addColumn('project_space_repos', 'visibility', {
      type: DataTypes.ENUM('public', 'private'),
      allowNull: false,
      defaultValue: 'private',
    });
  }

  if (table.space_id && table.space_id.allowNull === false) {
    await queryInterface.changeColumn('project_space_repos', 'space_id', {
      type: DataTypes.UUID,
      allowNull: true,
    });
  }

  await sequelize.query(`
    UPDATE project_space_repos AS repo
    SET owner_id = COALESCE(repo.created_by, space.owner_id)
    FROM project_spaces AS space
    WHERE repo.owner_id IS NULL
      AND repo.space_id = space.id
      AND COALESCE(repo.created_by, space.owner_id) IS NOT NULL
  `);

  await sequelize.query(`
    UPDATE project_space_repos
    SET owner_id = created_by
    WHERE owner_id IS NULL
      AND created_by IS NOT NULL
  `);

  await sequelize.query(`
    UPDATE project_space_repos
    SET visibility = 'private'
    WHERE visibility IS NULL
  `);

  await addIndexSafe('project_space_repos', ['owner_id'], {
    name: 'project_space_repos_owner_id',
  });
  await addIndexSafe('project_space_repos', ['visibility'], {
    name: 'project_space_repos_visibility',
  });
}

async function ensureRepoMemberColumns() {
  const queryInterface = sequelize.getQueryInterface();
  const table = await describeTableSafe('project_space_repo_members');
  if (!table) return;

  await ensureEnumValue('enum_project_space_repo_members_role', 'triage');
  await ensureEnumValue('enum_project_space_repo_members_role', 'maintain');
  await ensureEnumValue('enum_project_space_repo_members_role', 'admin');

  if (table.role?.defaultValue === "'write'::enum_project_space_repo_members_role") {
    await queryInterface.changeColumn('project_space_repo_members', 'role', {
      type: DataTypes.ENUM('read', 'triage', 'write', 'maintain', 'admin'),
      allowNull: false,
      defaultValue: 'read',
    });
  }
}

async function ensureAccessTokenColumns() {
  const queryInterface = sequelize.getQueryInterface();
  const table = await describeTableSafe('user_access_tokens');
  if (!table) return;

  if (!table.scopes) {
    await queryInterface.addColumn('user_access_tokens', 'scopes', {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: ['git:read', 'git:write'],
    });
  }

  await sequelize.query(`
    UPDATE user_access_tokens
    SET scopes = '["git:read","git:write"]'::jsonb
    WHERE scopes IS NULL
  `);
}

async function ensureBranchProtectionColumns() {
  const queryInterface = sequelize.getQueryInterface();
  const table = await describeTableSafe('branch_protection_rules');
  if (!table) return;

  if (!table.required_status_contexts) {
    await queryInterface.addColumn('branch_protection_rules', 'required_status_contexts', {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    });
  }

  if (!table.push_role_min) {
    await queryInterface.addColumn('branch_protection_rules', 'push_role_min', {
      type: DataTypes.ENUM('write', 'maintain', 'admin'),
      allowNull: false,
      defaultValue: 'maintain',
    });
  }

  if (!table.allow_deletions) {
    await queryInterface.addColumn('branch_protection_rules', 'allow_deletions', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  }

  if (!table.require_linear_history) {
    await queryInterface.addColumn('branch_protection_rules', 'require_linear_history', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  }

  await sequelize.query(`
    UPDATE branch_protection_rules
    SET required_status_contexts = '[]'::jsonb
    WHERE required_status_contexts IS NULL
  `);
}

async function ensurePullRequestColumns() {
  const queryInterface = sequelize.getQueryInterface();
  const table = await describeTableSafe('pull_requests');
  if (!table) return;

  if (!table.source_repo_id) {
    await queryInterface.addColumn('pull_requests', 'source_repo_id', {
      type: DataTypes.UUID,
      allowNull: true,
    });
  }

  if (!table.status_checks) {
    await queryInterface.addColumn('pull_requests', 'status_checks', {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    });
  }

  await sequelize.query(`
    UPDATE pull_requests
    SET source_repo_id = repo_id
    WHERE source_repo_id IS NULL
  `);

  await sequelize.query(`
    UPDATE pull_requests
    SET status_checks = '[]'::jsonb
    WHERE status_checks IS NULL
  `);

  await addIndexSafe('pull_requests', ['source_repo_id'], {
    name: 'pull_requests_source_repo_id',
  });
}

async function ensureWorkItemColumns() {
  const queryInterface = sequelize.getQueryInterface();
  const table = await describeTableSafe('project_space_issues');
  if (!table) return;

  if (!table.type) {
    await queryInterface.addColumn('project_space_issues', 'type', {
      type: DataTypes.ENUM('task', 'bug', 'feature', 'docs', 'research'),
      allowNull: false,
      defaultValue: 'task',
    });
  }

  if (!table.repo_id) {
    await queryInterface.addColumn('project_space_issues', 'repo_id', {
      type: DataTypes.UUID,
      allowNull: true,
    });
  }

  if (!table.milestone_id) {
    await queryInterface.addColumn('project_space_issues', 'milestone_id', {
      type: DataTypes.UUID,
      allowNull: true,
    });
  }

  if (!table.good_first_task) {
    await queryInterface.addColumn('project_space_issues', 'good_first_task', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  }

  if (!table.help_wanted) {
    await queryInterface.addColumn('project_space_issues', 'help_wanted', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  }

  if (!table.blocked_reason) {
    await queryInterface.addColumn('project_space_issues', 'blocked_reason', {
      type: DataTypes.TEXT,
      allowNull: true,
    });
  }

  if (!table.close_reason) {
    await queryInterface.addColumn('project_space_issues', 'close_reason', {
      type: DataTypes.STRING(120),
      allowNull: true,
    });
  }

  if (!table.estimate) {
    await queryInterface.addColumn('project_space_issues', 'estimate', {
      type: DataTypes.STRING(120),
      allowNull: true,
    });
  }

  if (!table.target_date) {
    await queryInterface.addColumn('project_space_issues', 'target_date', {
      type: DataTypes.DATEONLY,
      allowNull: true,
    });
  }

  if (!table.needed_skill) {
    await queryInterface.addColumn('project_space_issues', 'needed_skill', {
      type: DataTypes.STRING(120),
      allowNull: true,
    });
  }

  await addIndexSafe('project_space_issues', ['milestone_id'], {
    name: 'project_space_issues_milestone_id',
  });
  await addIndexSafe('project_space_issues', ['target_date'], {
    name: 'project_space_issues_target_date',
  });
}

async function ensureDiscussionColumns() {
  const queryInterface = sequelize.getQueryInterface();
  const table = await describeTableSafe('project_space_discussions');
  if (!table) return;

  await ensureEnumValue('enum_project_space_discussions_category', 'announcement');

  if (!table.answer_reply_id) {
    await queryInterface.addColumn('project_space_discussions', 'answer_reply_id', {
      type: DataTypes.UUID,
      allowNull: true,
    });
  }
}

async function ensureUpdateColumns() {
  const queryInterface = sequelize.getQueryInterface();
  const table = await describeTableSafe('project_space_updates');
  if (!table) return;

  if (!table.repo_id) {
    await queryInterface.addColumn('project_space_updates', 'repo_id', {
      type: DataTypes.UUID,
      allowNull: true,
    });
  }

  if (!table.work_item_id) {
    await queryInterface.addColumn('project_space_updates', 'work_item_id', {
      type: DataTypes.UUID,
      allowNull: true,
    });
  }
}

async function backfillRepositoryOwnershipAndAttachments() {
  const repos = await ProjectSpaceRepo.findAll({
    order: [['created_at', 'ASC']],
  });

  for (const repo of repos) {
    const updates = {};

    if (!repo.owner_id) {
      let ownerId = repo.created_by;
      if (repo.space_id) {
        // eslint-disable-next-line no-await-in-loop
        const space = await ProjectSpace.findByPk(repo.space_id, { attributes: ['owner_id'] });
        ownerId = space?.owner_id || ownerId;
      }
      updates.owner_id = ownerId;
    }

    if (!repo.visibility) {
      updates.visibility = 'private';
    }

    if (Object.keys(updates).length > 0) {
      // eslint-disable-next-line no-await-in-loop
      await repo.update(updates);
    }

    if (repo.space_id) {
      // eslint-disable-next-line no-await-in-loop
      const existingAttachment = await ProjectSpaceRepoAttachment.findOne({
        where: { repo_id: repo.id },
      });

      if (!existingAttachment) {
        // eslint-disable-next-line no-await-in-loop
        const existingCount = await ProjectSpaceRepoAttachment.count({
          where: { space_id: repo.space_id },
        });

        // eslint-disable-next-line no-await-in-loop
        await ProjectSpaceRepoAttachment.create({
          space_id: repo.space_id,
          repo_id: repo.id,
          external_url: null,
          label: repo.name,
          position: existingCount,
          is_primary: existingCount === 0,
          attached_by: repo.owner_id || repo.created_by,
        });
      }
    }
  }

  const spaces = await ProjectSpace.findAll({
    attributes: ['id', 'owner_id', 'primary_repo_url'],
  });

  for (const space of spaces) {
    if (!space.primary_repo_url) continue;

    // eslint-disable-next-line no-await-in-loop
    const duplicate = await ProjectSpaceRepoAttachment.findOne({
      where: {
        space_id: space.id,
        external_url: space.primary_repo_url,
      },
    });

    if (duplicate) continue;

    // eslint-disable-next-line no-await-in-loop
    const existingCount = await ProjectSpaceRepoAttachment.count({
      where: { space_id: space.id },
    });
    // eslint-disable-next-line no-await-in-loop
    const primaryCount = await ProjectSpaceRepoAttachment.count({
      where: { space_id: space.id, is_primary: true },
    });

    // eslint-disable-next-line no-await-in-loop
    await ProjectSpaceRepoAttachment.create({
      space_id: space.id,
      repo_id: null,
      external_url: space.primary_repo_url,
      label: 'External repo',
      position: existingCount,
      is_primary: primaryCount === 0,
      attached_by: space.owner_id,
    });
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

function parseBooleanEnv(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return null;
}

function isLocalDatabaseUrl(connectionString = process.env.DB_URL) {
  if (typeof connectionString !== 'string') {
    return false;
  }

  return connectionString.includes('localhost')
    || connectionString.includes('127.0.0.1')
    || connectionString.includes('::1');
}

function shouldSyncModelsOnStartup() {
  const configuredValue = parseBooleanEnv(process.env.DB_SYNC_ON_STARTUP);
  if (configuredValue !== null) {
    return configuredValue;
  }

  return isLocalDatabaseUrl();
}

async function getMissingTables(tableNames) {
  const missingTables = [];

  for (const tableName of tableNames) {
    // eslint-disable-next-line no-await-in-loop
    const table = await describeTableSafe(tableName);
    if (!table) {
      missingTables.push(tableName);
    }
  }

  return missingTables;
}

async function runInitStep(stepName, operation) {
  const startedAt = Date.now();
  logger.info('Running model init step.', { stepName });
  await operation();
  logger.info('Completed model init step.', {
    stepName,
    durationMs: Date.now() - startedAt,
  });
}

async function runOptionalInitStep(stepName, requiredTables, operation) {
  const missingTables = await getMissingTables(requiredTables);

  if (missingTables.length > 0) {
    logger.info('Skipping model init step because required tables are missing.', {
      stepName,
      missingTables,
    });
    return false;
  }

  await runInitStep(stepName, operation);
  return true;
}

async function ensurePostPollColumns() {
  const queryInterface = sequelize.getQueryInterface();

  try {
    const table = await queryInterface.describeTable('posts');

    if (!table.is_poll) {
      await queryInterface.addColumn('posts', 'is_poll', {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
    }
  } catch (error) {
    // Table may not exist on first boot; sequelize.sync() creates it.
  }
}

async function ensurePostPollTables() {
  // Poll models were introduced after initial deploy; ensure tables exist even when
  // global schema sync is disabled in non-local environments.
  await PollOption.sync();
  await PollVote.sync();
}

async function syncDatabaseSchema({ syncSchema = shouldSyncModelsOnStartup() } = {}) {
  if (!syncSchema) {
    logger.info('Skipping model sync on startup.', {
      syncSchema,
      dbSyncOnStartup: process.env.DB_SYNC_ON_STARTUP || null,
      isLocalDatabase: isLocalDatabaseUrl(),
    });
    return false;
  }

  await runInitStep('sequelize.sync', () => sequelize.sync());
  return true;
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function initModels(options = {}) {
  const { syncSchema = shouldSyncModelsOnStartup() } = options;

  await runInitStep('sequelize.authenticate', () => sequelize.authenticate());
  await runInitStep('ensurePostHashtagColumns', () => ensurePostHashtagColumns());
  await runInitStep('ensurePostLinkedEntityColumns', () => ensurePostLinkedEntityColumns());
  await runInitStep('ensureNotificationOutboxColumns', () => ensureNotificationOutboxColumns());
  await runInitStep('ensureUserProfileColumns', () => ensureUserProfileColumns());
  await runInitStep('ensureSpaceColumns', () => ensureSpaceColumns());
  await runInitStep('ensureRepoColumns', () => ensureRepoColumns());
  await runInitStep('ensureRepoMemberColumns', () => ensureRepoMemberColumns());
  await runInitStep('ensureAccessTokenColumns', () => ensureAccessTokenColumns());
  await runInitStep('ensureBranchProtectionColumns', () => ensureBranchProtectionColumns());
  await runInitStep('ensurePullRequestColumns', () => ensurePullRequestColumns());
  await runInitStep('ensureWorkItemColumns', () => ensureWorkItemColumns());
  await runInitStep('ensureDiscussionColumns', () => ensureDiscussionColumns());
  await runInitStep('ensureUpdateColumns', () => ensureUpdateColumns());
  await runInitStep('ensureDiscussionReplyColumns', () => ensureDiscussionReplyColumns());
  await runInitStep('ensureQuestionDiscussionColumns', () => ensureQuestionDiscussionColumns());
  await runInitStep('ensureQuestionOptionColumns', () => ensureQuestionOptionColumns());
  await runInitStep('ensureLaunchColumns', () => ensureLaunchColumns());
  await runInitStep('ensureLaunchFeedbackColumns', () => ensureLaunchFeedbackColumns());
  await runInitStep('ensureLaunchBetaRegistrationTable', () => ensureLaunchBetaRegistrationTable());
  await runInitStep('ensurePostPollTables', () => ensurePostPollTables());
  await runInitStep('ensurePostPollColumns', () => ensurePostPollColumns());
  await syncDatabaseSchema({ syncSchema });
  await runInitStep('backfillMissingUsernames', () => backfillMissingUsernames());
  await runOptionalInitStep(
    'backfillNotificationInboxFromOutbox',
    ['notification_outbox', 'user_notifications'],
    () => backfillNotificationInboxFromOutbox()
  );
  await runOptionalInitStep(
    'backfillRepositoryOwnershipAndAttachments',
    ['project_spaces', 'project_space_repos', 'space_repo_attachments'],
    () => backfillRepositoryOwnershipAndAttachments()
  );
  const { ensureFeedEntityAggregates } = require('../services/feed/postEntities');
  await runOptionalInitStep(
    'ensureFeedEntityAggregates',
    ['posts', 'post_hashtags', 'post_mentions', 'hashtag_catalog', 'hashtag_relations', 'notification_outbox'],
    () => ensureFeedEntityAggregates()
  );
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
  ProjectSpaceIssueComment,
  ProjectSpaceIssueActivity,
  ProjectSpaceMilestone,
  ProjectSpaceRepo,
  ProjectSpaceRepoMember,
  ProjectSpaceRepoAttachment,
  ProjectSpaceFollower,
  RepoStar,
  RepoWatch,
  RepoFork,
  RepoRelease,
  Launch,
  LaunchScreenshot,
  LaunchTechStack,
  LaunchUpvote,
  LaunchReview,
  LaunchBetaRegistration,
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
  PollOption,
  PollVote,
  PullRequest,
  PullRequestReview,
  PullRequestComment,
  BranchProtectionRule,
  RepoDiscussion,
  RepoDiscussionComment,
  // Bootstrap
  initModels,
  syncDatabaseSchema,
};

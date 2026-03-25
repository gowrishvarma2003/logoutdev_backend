const { Op } = require('sequelize');
const {
  Launch,
  LaunchScreenshot,
  LaunchTechStack,
  LaunchUpvote,
  LaunchReview,
  LaunchFeedbackItem,
  LaunchFeedbackComment,
  User,
  ProjectSpace,
} = require('../../models');
const { buildLaunchSlug } = require('./launchValidation');

const BUILDER_ATTRIBUTES = ['id', 'name', 'username', 'headline'];

function getLaunchBuilderInclude() {
  return {
    model: User,
    as: 'builder',
    attributes: BUILDER_ATTRIBUTES,
    required: false,
  };
}

function getLaunchBaseInclude({ stackRequired = false } = {}) {
  return [
    getLaunchBuilderInclude(),
    {
      model: LaunchScreenshot,
      as: 'screenshots',
      attributes: ['id', 'image_url', 'caption', 'rank', 'created_at'],
      required: false,
      separate: true,
      order: [['rank', 'ASC'], ['created_at', 'ASC']],
    },
    {
      model: LaunchTechStack,
      as: 'tech_stack',
      attributes: ['id', 'technology', 'rank', 'created_at'],
      required: stackRequired,
    },
    {
      model: ProjectSpace,
      as: 'linked_space',
      attributes: ['id', 'name', 'slug', 'visibility', 'status'],
      required: false,
    },
  ];
}

function getLaunchDetailInclude() {
  return getLaunchBaseInclude();
}

function getReviewInclude() {
  return [{ model: User, as: 'author', attributes: BUILDER_ATTRIBUTES, required: false }];
}

function getFeedbackInclude() {
  return [
    { model: User, as: 'author', attributes: BUILDER_ATTRIBUTES, required: false },
    {
      model: LaunchFeedbackComment,
      as: 'comments',
      required: false,
      separate: true,
      order: [['created_at', 'ASC']],
      include: [{ model: User, as: 'author', attributes: BUILDER_ATTRIBUTES, required: false }],
    },
  ];
}

async function generateUniqueLaunchSlug(seed, excludeId, transaction) {
  const base = buildLaunchSlug(seed);
  if (!base) return '';

  let slug = base;
  let counter = 1;
  while (
    await Launch.findOne({
      where: {
        slug,
        ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}),
      },
      attributes: ['id'],
      transaction,
    })
  ) {
    counter += 1;
    slug = `${base.slice(0, 130)}-${counter}`;
  }

  return slug;
}

async function replaceLaunchScreenshots(launchId, screenshots, transaction) {
  await LaunchScreenshot.destroy({ where: { launch_id: launchId }, transaction });

  if (!Array.isArray(screenshots) || screenshots.length === 0) return;

  await LaunchScreenshot.bulkCreate(
    screenshots.map((screenshot, index) => ({
      launch_id: launchId,
      image_url: screenshot.image_url,
      caption: screenshot.caption || null,
      rank: index,
    })),
    { transaction }
  );
}

async function replaceLaunchTechStack(launchId, techStack, transaction) {
  await LaunchTechStack.destroy({ where: { launch_id: launchId }, transaction });

  if (!Array.isArray(techStack) || techStack.length === 0) return;

  await LaunchTechStack.bulkCreate(
    techStack.map((technology, index) => ({
      launch_id: launchId,
      technology,
      rank: index,
    })),
    { transaction }
  );
}

async function refreshLaunchCounts(launchId, transaction) {
  const launch = await Launch.findByPk(launchId, {
    attributes: ['id', 'launch_phase'],
    transaction,
  });

  const feedbackWhere = {
    launch_id: launchId,
    ...(launch?.launch_phase === 'beta' ? { visibility_scope: 'beta' } : { visibility_scope: 'public' }),
  };

  const [upvoteCount, reviewCount, feedbackCount] = await Promise.all([
    LaunchUpvote.count({ where: { launch_id: launchId }, transaction }),
    LaunchReview.count({ where: { launch_id: launchId }, transaction }),
    LaunchFeedbackItem.count({ where: feedbackWhere, transaction }),
  ]);

  await Launch.update(
    {
      upvote_count: upvoteCount,
      review_count: reviewCount,
      feedback_count: feedbackCount,
      updated_at: new Date(),
    },
    { where: { id: launchId }, transaction }
  );
}

module.exports = {
  getLaunchBaseInclude,
  getLaunchDetailInclude,
  getLaunchBuilderInclude,
  getReviewInclude,
  getFeedbackInclude,
  generateUniqueLaunchSlug,
  replaceLaunchScreenshots,
  replaceLaunchTechStack,
  refreshLaunchCounts,
};

const { Op } = require('sequelize');
const {
  sequelize,
  User,
  Post,
  PostLike,
  Repost,
  Follow,
  ProjectSpace,
  ProjectSpaceMember,
  ProjectSpaceDiscussion,
  ProjectSpaceUpdate,
  UserProfileSkill,
  UserFeaturedProject,
} = require('../../models');
const { parsePagination } = require('../../services/spaces/pagination');
const {
  asTrimmedString,
  normalizeUsername,
  isValidUsername,
  isValidUrl,
  normalizeStringArray,
  generateUniqueUsername,
  ensureUniqueUsername,
} = require('../../services/profiles/profileValidation');
const {
  getPostEntityIncludes,
  attachHashtagUsageCounts,
  serializePostEntities,
} = require('../../services/feed/postEntities');

/** UUID v4 regex — used to detect when a slug is a raw user id. */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a profile slug to a User row.
 * Tries username lookup first, then falls back to primary-key (UUID) lookup
 * so that newly registered users without a username can still be found via
 * /profile/:id links generated from auth state.
 */
async function findProfileUser(slug) {
  // 1. Try by normalised username
  const normalized = normalizeUsername(slug);
  if (normalized) {
    const byUsername = await User.findOne({ where: { username: normalized } });
    if (byUsername) return byUsername;
  }

  // 2. Fallback: treat slug as a UUID primary key
  if (UUID_REGEX.test(slug)) {
    return User.findByPk(slug);
  }

  return null;
}

async function ensureProfileUser(req, res) {
  const user = await findProfileUser(req.params.username);
  if (!user) {
    res.status(404).json({ error: 'Profile not found.' });
    return null;
  }
  return user;
}

function buildPublicProfile(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    headline: user.headline,
    bio: user.bio,
    location: user.location,
    website_url: user.website_url,
    github_url: user.github_url,
    linkedin_url: user.linkedin_url,
    created_at: user.created_at,
  };
}

function getSignalsBand(score) {
  if (score >= 70) return 'Strong';
  if (score >= 40) return 'Growing';
  return 'Early';
}

async function getProfile(req, res) {
  try {
    const profileUser = await ensureProfileUser(req, res);
    if (!profileUser) return;

    const requesterId = req.user?.userId || null;
    const canViewPrivate = requesterId === profileUser.id;

    const [
      skills,
      followersCount,
      followingCount,
      postsCount,
      projectsCreatedCount,
      projectsContributedCount,
      discussionsStartedCount,
      updatesPostedCount,
    ] = await Promise.all([
      UserProfileSkill.findAll({
        where: { user_id: profileUser.id },
        order: [['rank', 'ASC'], ['created_at', 'ASC']],
      }),
      Follow.count({ where: { following_id: profileUser.id } }),
      Follow.count({ where: { follower_id: profileUser.id } }),
      Post.count({ where: { user_id: profileUser.id, reply_to_id: null } }),
      ProjectSpace.count({ where: { owner_id: profileUser.id } }),
      ProjectSpaceMember.count({ where: { user_id: profileUser.id }, distinct: true, col: 'space_id' }),
      ProjectSpaceDiscussion.count({ where: { author_id: profileUser.id } }),
      ProjectSpaceUpdate.count({ where: { author_id: profileUser.id } }),
    ]);

    const featuredWhere = canViewPrivate
      ? {}
      : { visibility: 'public' };

    const featuredProjects = await UserFeaturedProject.findAll({
      where: { user_id: profileUser.id },
      include: [
        {
          model: ProjectSpace,
          as: 'space',
          where: featuredWhere,
          required: true,
          attributes: ['id', 'name', 'slug', 'summary', 'status', 'visibility', 'owner_id', 'created_at'],
          include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'email', 'username'] }],
        },
      ],
      order: [['position', 'ASC']],
    });

    return res.json({
      profile: buildPublicProfile(profileUser),
      is_me: requesterId === profileUser.id,
      stats: {
        followers: followersCount,
        following: followingCount,
        posts_count: postsCount,
        projects_created_count: projectsCreatedCount,
        projects_contributed_count: projectsContributedCount,
        discussions_started_count: discussionsStartedCount,
        updates_posted_count: updatesPostedCount,
      },
      skills: skills.map((skill) => skill.toJSON()),
      featured_projects: featuredProjects.map((item) => ({
        id: item.id,
        position: item.position,
        space: item.space,
      })),
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch profile.' });
  }
}

async function getProfileProjects(req, res) {
  try {
    const profileUser = await ensureProfileUser(req, res);
    if (!profileUser) return;

    const requesterId = req.user?.userId || null;
    const canViewPrivate = requesterId === profileUser.id;
    const { limit, page, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });

    const visibilityClause = canViewPrivate ? {} : { visibility: 'public' };

    const { count, rows: projects } = await ProjectSpace.findAndCountAll({
      where: {
        ...visibilityClause,
        [Op.or]: [
          { owner_id: profileUser.id },
          { '$members.user_id$': profileUser.id },
        ],
      },
      include: [
        { model: User, as: 'owner', attributes: ['id', 'name', 'email', 'username'] },
        {
          model: ProjectSpaceMember,
          as: 'members',
          attributes: ['id', 'space_id', 'user_id', 'role'],
          required: false,
        },
      ],
      distinct: true,
      subQuery: false,
      order: [['updated_at', 'DESC']],
      limit,
      offset,
    });

    return res.json({ projects, total: count, page, limit });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch profile projects.' });
  }
}

async function getProfilePosts(req, res) {
  try {
    const profileUser = await ensureProfileUser(req, res);
    if (!profileUser) return;

    const requesterId = req.user?.userId || null;
    const { limit, page, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });

    const { count, rows: posts } = await Post.findAndCountAll({
      where: {
        user_id: profileUser.id,
        reply_to_id: null,
      },
      include: [
        { model: User, as: 'author', attributes: ['id', 'name', 'email', 'username'] },
        ...getPostEntityIncludes(),
      ],
      distinct: true,
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });

    const postIds = posts.map((post) => post.id);
    let likedSet = new Set();
    let repostedSet = new Set();

    if (requesterId && postIds.length > 0) {
      const [likes, reposts] = await Promise.all([
        PostLike.findAll({
          where: { post_id: { [Op.in]: postIds }, user_id: requesterId },
          attributes: ['post_id'],
        }),
        Repost.findAll({
          where: { post_id: { [Op.in]: postIds }, user_id: requesterId },
          attributes: ['post_id'],
        }),
      ]);
      likedSet = new Set(likes.map((item) => item.post_id));
      repostedSet = new Set(reposts.map((item) => item.post_id));
    }

    const serializedPosts = await attachHashtagUsageCounts(posts.map((post) => serializePostEntities({
      ...post.toJSON(),
      is_liked_by_me: likedSet.has(post.id),
      is_reposted_by_me: repostedSet.has(post.id),
    })));

    return res.json({
      posts: serializedPosts,
      total: count,
      page,
      limit,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch profile posts.' });
  }
}

async function getProfileActivity(req, res) {
  try {
    const profileUser = await ensureProfileUser(req, res);
    if (!profileUser) return;

    const requesterId = req.user?.userId || null;
    const canViewPrivate = requesterId === profileUser.id;
    const { limit, page } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });

    const visibilityClause = canViewPrivate ? {} : { visibility: 'public' };

    const [posts, discussions, updates] = await Promise.all([
      Post.findAll({
        where: { user_id: profileUser.id, reply_to_id: null },
        attributes: ['id', 'content', 'created_at'],
        limit: 60,
        order: [['created_at', 'DESC']],
      }),
      ProjectSpaceDiscussion.findAll({
        where: { author_id: profileUser.id },
        include: [{
          model: ProjectSpace,
          as: 'space',
          attributes: ['id', 'name', 'visibility'],
          where: visibilityClause,
          required: true,
        }],
        attributes: ['id', 'space_id', 'title', 'category', 'status', 'created_at'],
        limit: 60,
        order: [['created_at', 'DESC']],
      }),
      ProjectSpaceUpdate.findAll({
        where: { author_id: profileUser.id },
        include: [{
          model: ProjectSpace,
          as: 'space',
          attributes: ['id', 'name', 'visibility'],
          where: visibilityClause,
          required: true,
        }],
        attributes: ['id', 'space_id', 'title', 'type', 'created_at'],
        limit: 60,
        order: [['created_at', 'DESC']],
      }),
    ]);

    const combined = [
      ...posts.map((post) => ({
        type: 'post',
        created_at: post.created_at,
        item: post,
      })),
      ...discussions.map((discussion) => ({
        type: 'discussion',
        created_at: discussion.created_at,
        item: discussion,
      })),
      ...updates.map((update) => ({
        type: 'update',
        created_at: update.created_at,
        item: update,
      })),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const offset = (page - 1) * limit;
    const activity = combined.slice(offset, offset + limit);

    return res.json({ activity, total: combined.length, page, limit });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch profile activity.' });
  }
}

async function getProfileSignals(req, res) {
  try {
    const profileUser = await ensureProfileUser(req, res);
    if (!profileUser) return;

    const periodStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [activeProjects, updatesCount, discussionsCount, postsCount] = await Promise.all([
      ProjectSpaceMember.count({
        where: { user_id: profileUser.id },
        distinct: true,
        col: 'space_id',
      }),
      ProjectSpaceUpdate.count({ where: { author_id: profileUser.id, created_at: { [Op.gte]: periodStart } } }),
      ProjectSpaceDiscussion.count({ where: { author_id: profileUser.id, created_at: { [Op.gte]: periodStart } } }),
      Post.count({ where: { user_id: profileUser.id, created_at: { [Op.gte]: periodStart } } }),
    ]);

    const projectScore = Math.min(activeProjects * 12, 30);
    const updateScore = Math.min(updatesCount * 8, 25);
    const discussionScore = Math.min(discussionsCount * 8, 25);
    const feedScore = Math.min(postsCount * 4, 20);

    const score = projectScore + updateScore + discussionScore + feedScore;
    const band = getSignalsBand(score);

    return res.json({
      signals: {
        score,
        band,
        factors: {
          project_participation: projectScore,
          update_consistency: updateScore,
          discussion_engagement: discussionScore,
          feed_consistency: feedScore,
        },
      },
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch profile signals.' });
  }
}

async function patchMyProfile(req, res) {
  const transaction = await sequelize.transaction();

  try {
    const userId = req.user.userId;
    const user = await User.findByPk(userId, { transaction });

    if (!user) {
      await transaction.rollback();
      return res.status(404).json({ error: 'User not found.' });
    }

    const name = asTrimmedString(req.body.name);
    const headline = asTrimmedString(req.body.headline);
    const bio = asTrimmedString(req.body.bio);
    const location = asTrimmedString(req.body.location);
    const websiteUrl = asTrimmedString(req.body.website_url);
    const githubUrl = asTrimmedString(req.body.github_url);
    const linkedinUrl = asTrimmedString(req.body.linkedin_url);
    const rawUsername = asTrimmedString(req.body.username);

    if (name && name.length > 255) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Name must be 255 characters or fewer.' });
    }

    if (headline.length > 140) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Headline must be 140 characters or fewer.' });
    }

    if (bio.length > 2000) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Bio must be 2000 characters or fewer.' });
    }

    if (location.length > 120) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Location must be 120 characters or fewer.' });
    }

    if (!isValidUrl(websiteUrl) || !isValidUrl(githubUrl) || !isValidUrl(linkedinUrl)) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Profile links must be valid http(s) URLs.' });
    }

    if (rawUsername) {
      const normalized = normalizeUsername(rawUsername);
      if (!isValidUsername(normalized)) {
        await transaction.rollback();
        return res.status(400).json({ error: 'Username must be 3-50 chars and contain only lowercase letters, numbers, and underscores.' });
      }

      const isUnique = await ensureUniqueUsername(normalized, user.id);
      if (!isUnique) {
        await transaction.rollback();
        return res.status(409).json({ error: 'Username is already in use.' });
      }

      user.username = normalized;
    } else if (!user.username) {
      user.username = await generateUniqueUsername(user.name || user.email.split('@')[0]);
    }

    if (name) user.name = name;
    user.headline = headline || null;
    user.bio = bio || null;
    user.location = location || null;
    user.website_url = websiteUrl || null;
    user.github_url = githubUrl || null;
    user.linkedin_url = linkedinUrl || null;
    user.updated_at = new Date();

    await user.save({ transaction });
    await transaction.commit();

    return res.json({ profile: buildPublicProfile(user) });
  } catch (error) {
    await transaction.rollback();
    return res.status(500).json({ error: 'Failed to update profile.' });
  }
}

async function replaceMySkills(req, res) {
  const transaction = await sequelize.transaction();

  try {
    const userId = req.user.userId;
    const skills = normalizeStringArray(req.body.skills, 10);

    await UserProfileSkill.destroy({ where: { user_id: userId }, transaction });

    if (skills.length > 0) {
      await UserProfileSkill.bulkCreate(
        skills.map((skill, index) => ({
          user_id: userId,
          skill,
          rank: index,
        })),
        { transaction }
      );
    }

    await transaction.commit();

    const savedSkills = await UserProfileSkill.findAll({
      where: { user_id: userId },
      order: [['rank', 'ASC'], ['created_at', 'ASC']],
    });

    return res.json({ skills: savedSkills });
  } catch (error) {
    await transaction.rollback();
    return res.status(500).json({ error: 'Failed to update profile skills.' });
  }
}

async function replaceMyFeaturedProjects(req, res) {
  const transaction = await sequelize.transaction();

  try {
    const userId = req.user.userId;
    const incoming = Array.isArray(req.body.space_ids) ? req.body.space_ids : [];
    const spaceIds = [...new Set(incoming.filter((value) => typeof value === 'string' && value.trim()))];

    if (spaceIds.length > 3) {
      await transaction.rollback();
      return res.status(400).json({ error: 'You can feature up to 3 projects.' });
    }

    if (spaceIds.length > 0) {
      const memberships = await ProjectSpaceMember.findAll({
        where: { user_id: userId, space_id: { [Op.in]: spaceIds } },
        attributes: ['space_id'],
        transaction,
      });

      const owned = await ProjectSpace.findAll({
        where: { owner_id: userId, id: { [Op.in]: spaceIds } },
        attributes: ['id'],
        transaction,
      });

      const allowed = new Set([
        ...memberships.map((item) => item.space_id),
        ...owned.map((item) => item.id),
      ]);

      const disallowed = spaceIds.filter((spaceId) => !allowed.has(spaceId));
      if (disallowed.length > 0) {
        await transaction.rollback();
        return res.status(403).json({ error: 'You can only feature projects where you are owner or contributor.' });
      }
    }

    await UserFeaturedProject.destroy({ where: { user_id: userId }, transaction });

    if (spaceIds.length > 0) {
      await UserFeaturedProject.bulkCreate(
        spaceIds.map((spaceId, index) => ({
          user_id: userId,
          space_id: spaceId,
          position: index,
        })),
        { transaction }
      );
    }

    await transaction.commit();

    const featuredProjects = await UserFeaturedProject.findAll({
      where: { user_id: userId },
      include: [
        {
          model: ProjectSpace,
          as: 'space',
          attributes: ['id', 'name', 'slug', 'summary', 'status', 'visibility'],
          include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'email', 'username'] }],
        },
      ],
      order: [['position', 'ASC']],
    });

    return res.json({
      featured_projects: featuredProjects.map((item) => ({
        id: item.id,
        position: item.position,
        space: item.space,
      })),
    });
  } catch (error) {
    await transaction.rollback();
    return res.status(500).json({ error: 'Failed to update featured projects.' });
  }
}

module.exports = {
  getProfile,
  getProfileProjects,
  getProfilePosts,
  getProfileActivity,
  getProfileSignals,
  patchMyProfile,
  replaceMySkills,
  replaceMyFeaturedProjects,
};

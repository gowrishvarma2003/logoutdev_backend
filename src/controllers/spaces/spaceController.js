const { Op } = require('sequelize');
const {
  ProjectSpace,
  ProjectSpaceMember,
  ProjectSpaceStack,
  ProjectSpaceIssue,
  ProjectSpaceUpdate,
  ProjectSpaceFollower,
  Launch,
  User,
} = require('../../models');
const {
  getSpaceOr404,
  ensureSpaceReadable,
  isOwner,
  getMembership,
  buildSpaceViewerPermissions,
} = require('../../services/spaces/spaceAccess');
const { parsePagination } = require('../../services/spaces/pagination');
const {
  SPACE_STATUSES,
  SPACE_VISIBILITIES,
  asTrimmedString,
  normalizeStringArray,
  slugify,
  isAllowedValue,
} = require('../../services/spaces/spaceValidation');
const { getSpaceGraph } = require('../../services/workGraph/workGraphService');
const { listVisibleAttachments } = require('../../services/spaces/spaceAttachmentService');

function parseBooleanParam(value) {
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return null;
}

async function createSpace(req, res) {
  try {
    const ownerId = req.user.userId;
    const name = asTrimmedString(req.body.name);
    const summary = asTrimmedString(req.body.summary);
    const description = asTrimmedString(req.body.description);
    const status = asTrimmedString(req.body.status || 'idea');
    const visibility = asTrimmedString(req.body.visibility || 'public');
    const primaryRepoUrl = asTrimmedString(req.body.primary_repo_url) || null;
    const workingInPublic = Boolean(req.body.working_in_public);
    const currentFocus = asTrimmedString(req.body.current_focus) || null;
    const openRoles = normalizeStringArray(req.body.open_roles, 12);
    const neededSkills = normalizeStringArray(req.body.needed_skills, 20);
    const contributionGuide = asTrimmedString(req.body.contribution_guide) || null;
    const responseSla = asTrimmedString(req.body.response_sla) || null;

    if (name.length < 2) {
      return res.status(400).json({ error: 'Project name must be at least 2 characters.' });
    }

    if (summary.length < 10) {
      return res.status(400).json({ error: 'Summary must be at least 10 characters.' });
    }

    if (description.length < 20) {
      return res.status(400).json({ error: 'Description must be at least 20 characters.' });
    }

    if (!isAllowedValue(status, SPACE_STATUSES)) {
      return res.status(400).json({ error: 'Invalid project status.' });
    }

    if (!isAllowedValue(visibility, SPACE_VISIBILITIES)) {
      return res.status(400).json({ error: 'Invalid project visibility.' });
    }

    const baseSlug = slugify(req.body.slug || name);
    if (!baseSlug) {
      return res.status(400).json({ error: 'Unable to generate a valid slug from project name.' });
    }

    let slug = baseSlug;
    let counter = 1;
    while (await ProjectSpace.findOne({ where: { slug } })) {
      counter += 1;
      slug = `${baseSlug}-${counter}`;
    }

    const space = await ProjectSpace.create({
      owner_id: ownerId,
      name,
      slug,
      summary,
      description,
      status,
      visibility,
      working_in_public: workingInPublic,
      current_focus: currentFocus,
      open_roles: openRoles,
      needed_skills: neededSkills,
      contribution_guide: contributionGuide,
      response_sla: responseSla,
      primary_repo_url: primaryRepoUrl,
    });

    await ProjectSpaceMember.create({
      space_id: space.id,
      user_id: ownerId,
      role: 'owner',
    });

    return res.status(201).json({ space });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create project space.' });
  }
}

async function listSpaces(req, res) {
  try {
    const requesterId = req.user?.userId;
    const mine = String(req.query.mine || '').toLowerCase() === 'true';
    const status = asTrimmedString(req.query.status || '');
    const visibility = asTrimmedString(req.query.visibility || '');
    const tag = asTrimmedString(req.query.tag || '').toLowerCase();
    const neededSkill = asTrimmedString(req.query.needed_skill || '').toLowerCase();
    const workingInPublic = parseBooleanParam(req.query.working_in_public);
    const lookingForContributors = parseBooleanParam(req.query.looking_for_contributors);
    const goodFirstTasks = parseBooleanParam(req.query.good_first_tasks);
    const recentlyShipped = parseBooleanParam(req.query.recently_shipped);
    const { limit, page, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });

    if (mine && !requesterId) {
      return res.status(401).json({ error: 'Authentication required to view your spaces.' });
    }

    const where = {};
    if (status && isAllowedValue(status, SPACE_STATUSES)) {
      where.status = status;
    }

    if (visibility && isAllowedValue(visibility, SPACE_VISIBILITIES)) {
      where.visibility = visibility;
    } else if (!mine) {
      where.visibility = 'public';
    }

    if (where.visibility === 'private' && !requesterId) {
      return res.status(401).json({ error: 'Authentication required to view private spaces.' });
    }

    if (workingInPublic !== null) {
      where.working_in_public = workingInPublic;
    }

    const include = [
      { model: User, as: 'owner', attributes: ['id', 'name', 'email'] },
      { model: ProjectSpaceMember, as: 'members', attributes: ['id', 'user_id', 'role'] },
    ];

    if (tag) {
      include.push({
        model: ProjectSpaceStack,
        as: 'stack',
        where: { technology: { [Op.iLike]: `%${tag}%` } },
        required: true,
        attributes: ['id', 'category', 'technology', 'maturity'],
      });
    } else {
      include.push({
        model: ProjectSpaceStack,
        as: 'stack',
        attributes: ['id', 'category', 'technology', 'maturity'],
      });
    }

    let { count, rows: spaces } = await ProjectSpace.findAndCountAll({
      where,
      include,
      order: [['created_at', 'DESC']],
      limit,
      offset,
      distinct: true,
    });

    if (neededSkill) {
      spaces = spaces.filter((space) =>
        Array.isArray(space.needed_skills)
        && space.needed_skills.some((skill) => String(skill).toLowerCase().includes(neededSkill))
      );
      count = spaces.length;
    }

    if (lookingForContributors === true) {
      spaces = spaces.filter((space) =>
        (Array.isArray(space.open_roles) && space.open_roles.length > 0)
        || (Array.isArray(space.needed_skills) && space.needed_skills.length > 0)
      );
      count = spaces.length;
    }

    if (goodFirstTasks === true && spaces.length > 0) {
      const goodFirstSpaceIds = new Set(
        (
          await ProjectSpaceIssue.findAll({
            where: {
              space_id: spaces.map((space) => space.id),
              good_first_task: true,
            },
            attributes: ['space_id'],
          })
        ).map((item) => item.space_id)
      );
      spaces = spaces.filter((space) => goodFirstSpaceIds.has(space.id));
      count = spaces.length;
    }

    if (recentlyShipped === true && spaces.length > 0) {
      const recentWindow = new Date(Date.now() - (14 * 24 * 60 * 60 * 1000));
      const shippedSpaceIds = new Set(
        (
          await ProjectSpaceUpdate.findAll({
            where: {
              space_id: spaces.map((space) => space.id),
              type: { [Op.in]: ['release', 'milestone'] },
              created_at: { [Op.gte]: recentWindow },
            },
            attributes: ['space_id'],
          })
        ).map((item) => item.space_id)
      );
      spaces = spaces.filter((space) => shippedSpaceIds.has(space.id));
      count = spaces.length;
    }

    if (mine) {
      const eligibleSpaces = spaces.filter(
        (space) =>
          space.owner_id === requesterId
          || space.members.some(
            (member) => member.user_id === requesterId && ['owner', 'maintainer'].includes(member.role)
          )
      );

      return res.json({ spaces: eligibleSpaces, total: eligibleSpaces.length, page, limit });
    }

    if (where.visibility === 'private') {
      const filteredSpaces = spaces.filter(
        (space) =>
          space.owner_id === requesterId
          || space.members.some((member) => member.user_id === requesterId)
      );

      return res.json({ spaces: filteredSpaces, total: filteredSpaces.length, page, limit });
    }

    return res.json({ spaces, total: count, page, limit });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch project spaces.' });
  }
}

async function getSpace(req, res) {
  try {
    const requesterId = req.user?.userId || null;
    const readableSpace = await ensureSpaceReadable(req.params.spaceId, requesterId, res);
    if (!readableSpace) return;

    const space = await ProjectSpace.findByPk(req.params.spaceId, {
      include: [
        { model: User, as: 'owner', attributes: ['id', 'name', 'email', 'username', 'headline'] },
        {
          model: ProjectSpaceMember,
          as: 'members',
          include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email', 'username', 'headline'] }],
        },
        { model: ProjectSpaceStack, as: 'stack', attributes: ['id', 'category', 'technology', 'maturity'] },
        {
          model: Launch,
          as: 'linked_launch',
          attributes: ['id', 'name', 'slug', 'tagline', 'launch_phase', 'status', 'upvote_count', 'review_count'],
          required: false,
        },
      ],
    });

    if (!space) {
      return res.status(404).json({ error: 'Project space not found.' });
    }

    const graph = await getSpaceGraph(space, requesterId);
    const attachedRepos = await listVisibleAttachments(space.id, requesterId);
    const followerCount = await ProjectSpaceFollower.count({ where: { space_id: space.id } });
    const isFollowing = requesterId
      ? Boolean(await ProjectSpaceFollower.findOne({ where: { space_id: space.id, user_id: requesterId }, attributes: ['id'] }))
      : false;
    const membership = requesterId ? await getMembership(space.id, requesterId) : null;
    return res.json({
      space: {
        ...space.toJSON(),
        attached_repos: attachedRepos,
        follower_count: followerCount,
        is_following: isFollowing,
        viewer_permissions: buildSpaceViewerPermissions(space, membership, requesterId),
        ...graph,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch project space.' });
  }
}

async function updateSpace(req, res) {
  try {
    const userId = req.user.userId;
    const space = await getSpaceOr404(req.params.spaceId, res);
    if (!space) return;

    if (!isOwner(space, userId)) {
      return res.status(403).json({ error: 'Only the project owner can update this space.' });
    }

    const updates = {};

    if (req.body.name !== undefined) {
      const name = asTrimmedString(req.body.name);
      if (name.length < 2) return res.status(400).json({ error: 'Project name is too short.' });
      updates.name = name;
    }

    if (req.body.summary !== undefined) {
      const summary = asTrimmedString(req.body.summary);
      if (summary.length < 10) return res.status(400).json({ error: 'Summary is too short.' });
      updates.summary = summary;
    }

    if (req.body.description !== undefined) {
      const description = asTrimmedString(req.body.description);
      if (description.length < 20) return res.status(400).json({ error: 'Description is too short.' });
      updates.description = description;
    }

    if (req.body.status !== undefined) {
      const status = asTrimmedString(req.body.status);
      if (!isAllowedValue(status, SPACE_STATUSES)) {
        return res.status(400).json({ error: 'Invalid project status.' });
      }
      updates.status = status;
    }

    if (req.body.visibility !== undefined) {
      const visibility = asTrimmedString(req.body.visibility);
      if (!isAllowedValue(visibility, SPACE_VISIBILITIES)) {
        return res.status(400).json({ error: 'Invalid project visibility.' });
      }
      updates.visibility = visibility;
    }

    if (req.body.working_in_public !== undefined) {
      updates.working_in_public = Boolean(req.body.working_in_public);
    }

    if (req.body.current_focus !== undefined) {
      updates.current_focus = asTrimmedString(req.body.current_focus) || null;
    }

    if (req.body.open_roles !== undefined) {
      updates.open_roles = normalizeStringArray(req.body.open_roles, 12);
    }

    if (req.body.needed_skills !== undefined) {
      updates.needed_skills = normalizeStringArray(req.body.needed_skills, 20);
    }

    if (req.body.contribution_guide !== undefined) {
      updates.contribution_guide = asTrimmedString(req.body.contribution_guide) || null;
    }

    if (req.body.response_sla !== undefined) {
      updates.response_sla = asTrimmedString(req.body.response_sla) || null;
    }

    if (req.body.primary_repo_url !== undefined) {
      const url = asTrimmedString(req.body.primary_repo_url);
      if (url && !/^https?:\/\//i.test(url)) {
        return res.status(400).json({ error: 'primary_repo_url must be a valid http/https URL.' });
      }
      updates.primary_repo_url = url || null;
    }

    if (req.body.slug !== undefined) {
      const nextSlug = slugify(req.body.slug);
      if (!nextSlug) {
        return res.status(400).json({ error: 'Invalid slug value.' });
      }

      const existing = await ProjectSpace.findOne({
        where: {
          slug: nextSlug,
          id: { [Op.ne]: space.id },
        },
      });
      if (existing) {
        return res.status(409).json({ error: 'This slug is already in use.' });
      }

      updates.slug = nextSlug;
    }

    updates.updated_at = new Date();
    await space.update(updates);

    return res.json({ space });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update project space.' });
  }
}

async function deleteSpace(req, res) {
  try {
    const userId = req.user.userId;
    const space = await getSpaceOr404(req.params.spaceId, res);
    if (!space) return;

    if (!isOwner(space, userId)) {
      return res.status(403).json({ error: 'Only the project owner can archive this space.' });
    }

    await space.update({ status: 'archived', updated_at: new Date() });

    return res.json({ archived: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to archive project space.' });
  }
}

module.exports = {
  createSpace,
  listSpaces,
  getSpace,
  updateSpace,
  deleteSpace,
};

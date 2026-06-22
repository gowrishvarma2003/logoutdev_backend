const {
  ProjectSpaceRepoMember,
  User,
} = require('../../models');
const { asTrimmedString, REPO_MEMBER_ROLES } = require('../../services/spaces/spaceValidation');
const { ensureRepoAdmin, ensureLegacyRepoAdmin, ensureRepoMemberCandidate } = require('../../services/spaces/repoAccess');
const {
  buildEntityRef,
  emitUserNotification,
} = require('../../services/notifications/notificationService');

async function loadOwnerRepo(req, res) {
  if (req.params.spaceId) {
    return ensureLegacyRepoAdmin(req.params.spaceId, req.params.repoId, req.user.userId, res);
  }

  return ensureRepoAdmin(req.params.repoId, req.user.userId, res);
}

async function listRepoMembers(req, res) {
  try {
    const result = await loadOwnerRepo(req, res);
    if (!result) return;

    const members = await ProjectSpaceRepoMember.findAll({
      where: { repo_id: result.repo.id },
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email', 'username'] }],
      order: [['created_at', 'ASC']],
    });

    return res.json({ members });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch repository members.' });
  }
}

async function upsertRepoMember(req, res) {
  try {
    const result = await loadOwnerRepo(req, res);
    if (!result) return;

    const role = asTrimmedString(req.body.role);
    if (!REPO_MEMBER_ROLES.has(role)) {
      return res.status(400).json({ error: 'Invalid repository role.' });
    }

    if (role === 'admin' && result.repo.space_id) {
      return res.status(400).json({ error: 'Admin can only be granted directly on personal repositories.' });
    }

    const candidate = await ensureRepoMemberCandidate(result.repo, req.params.userId, res, {
      allowAdmin: !result.repo.space_id,
    });
    if (!candidate) return;

    const [member, created] = await ProjectSpaceRepoMember.findOrCreate({
      where: {
        repo_id: result.repo.id,
        user_id: req.params.userId,
      },
      defaults: {
        role,
        status: 'pending',
        granted_by: req.user.userId,
      },
    });

    const previousRole = created ? null : member.role;
    const previousStatus = member.status;
    if (!created) {
      await member.update({
        role,
        granted_by: req.user.userId,
        status: previousStatus === 'accepted' ? 'accepted' : 'pending',
      });
    }

    const refreshed = await ProjectSpaceRepoMember.findByPk(member.id, {
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email', 'username'] }],
    });

    if (member.status === 'pending' && (created || previousRole !== role || previousStatus !== member.status)) {
      await emitUserNotification({
        recipientUserId: req.params.userId,
        actorUserId: req.user.userId,
        eventType: 'repo_invitation_created',
        category: 'repo',
        priority: 'action',
        entityType: 'repo',
        entityId: result.repo.id,
        entitySnapshot: buildEntityRef({
          type: 'repo',
          id: result.repo.id,
          title: result.repo.name,
          href: '/repos/invitations',
        }),
        actionUrl: '/repos/invitations',
        previewText: `invited you to contribute with ${role} access`,
        dedupeKey: `repo_invitation_created:${result.repo.id}:${req.params.userId}:${role}`,
      });
    }

    return res.json({ member: refreshed });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update repository membership.' });
  }
}

async function removeRepoMember(req, res) {
  try {
    const result = await loadOwnerRepo(req, res);
    if (!result) return;

    const candidate = await ensureRepoMemberCandidate(result.repo, req.params.userId, res, {
      allowAdmin: !result.repo.space_id,
    });
    if (!candidate) return;

    await ProjectSpaceRepoMember.destroy({
      where: {
        repo_id: result.repo.id,
        user_id: req.params.userId,
      },
    });

    return res.json({ removed: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to remove repository member.' });
  }
}

module.exports = {
  listRepoMembers,
  upsertRepoMember,
  removeRepoMember,
};

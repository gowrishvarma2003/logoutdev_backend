const {
  ProjectSpaceRepoMember,
  User,
} = require('../../models');
const { asTrimmedString } = require('../../services/spaces/spaceValidation');
const { ensureRepoAdmin, ensureRepoMemberCandidate } = require('../../services/spaces/repoAccess');
const {
  buildEntityRef,
  emitUserNotification,
} = require('../../services/notifications/notificationService');

async function listRepoMembers(req, res) {
  try {
    const result = await ensureRepoAdmin(req.params.spaceId, req.params.repoId, req.user.userId, res);
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
    const result = await ensureRepoAdmin(req.params.spaceId, req.params.repoId, req.user.userId, res);
    if (!result) return;

    const role = asTrimmedString(req.body.role);
    if (role !== 'read' && role !== 'write') {
      return res.status(400).json({ error: 'Role must be read or write.' });
    }

    const candidate = await ensureRepoMemberCandidate(req.params.spaceId, req.params.userId, res);
    if (!candidate) return;

    const [member, created] = await ProjectSpaceRepoMember.findOrCreate({
      where: {
        repo_id: result.repo.id,
        user_id: req.params.userId,
      },
      defaults: {
        role,
        granted_by: req.user.userId,
      },
    });

    const previousRole = created ? null : member.role;
    if (!created) {
      await member.update({ role, granted_by: req.user.userId });
    }

    const refreshed = await ProjectSpaceRepoMember.findByPk(member.id, {
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email', 'username'] }],
    });

    if (created || previousRole !== role) {
      await emitUserNotification({
        recipientUserId: req.params.userId,
        actorUserId: req.user.userId,
        eventType: 'repo_access_granted',
        category: 'repo',
        priority: 'action',
        entityType: 'repo',
        entityId: result.repo.id,
        entitySnapshot: buildEntityRef({
          type: 'repo',
          id: result.repo.id,
          title: result.repo.name,
          href: `/spaces/${req.params.spaceId}/repos/${result.repo.id}`,
        }),
        actionUrl: `/spaces/${req.params.spaceId}/repos/${result.repo.id}`,
        previewText: `granted you ${role} access to a repository`,
        dedupeKey: `repo_access_granted:${result.repo.id}:${req.params.userId}:${role}`,
      });
    }

    return res.json({ member: refreshed });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update repository membership.' });
  }
}

async function removeRepoMember(req, res) {
  try {
    const result = await ensureRepoAdmin(req.params.spaceId, req.params.repoId, req.user.userId, res);
    if (!result) return;

    const candidate = await ensureRepoMemberCandidate(req.params.spaceId, req.params.userId, res);
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

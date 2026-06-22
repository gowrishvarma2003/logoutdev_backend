const {
  ProjectSpace,
  ProjectSpaceRepo,
  ProjectSpaceRepoMember,
  User,
} = require('../../models');

function serializeInvitation(member) {
  const repo = member.repo;
  return {
    id: member.id,
    repo_id: member.repo_id,
    user_id: member.user_id,
    role: member.role,
    status: member.status,
    granted_by: member.granted_by,
    created_at: member.created_at,
    repo: repo
      ? {
          id: repo.id,
          name: repo.name,
          slug: repo.slug,
          description: repo.description,
          visibility: repo.visibility,
          default_branch: repo.default_branch,
          owner: repo.owner
            ? {
                id: repo.owner.id,
                name: repo.owner.name,
                username: repo.owner.username,
              }
            : null,
          attached_space: repo.space
            ? {
                id: repo.space.id,
                name: repo.space.name,
                slug: repo.space.slug,
                visibility: repo.space.visibility,
              }
            : null,
        }
      : null,
  };
}

async function findInvitation(memberId, userId, res) {
  const invitation = await ProjectSpaceRepoMember.findOne({
    where: {
      id: memberId,
      user_id: userId,
      status: 'pending',
    },
    include: [
      {
        model: ProjectSpaceRepo,
        as: 'repo',
        required: true,
        where: { archived_at: null },
        include: [
          { model: User, as: 'owner', attributes: ['id', 'name', 'username'], required: false },
          { model: ProjectSpace, as: 'space', required: false },
        ],
      },
    ],
  });

  if (!invitation) {
    res.status(404).json({ error: 'Repository invitation not found.' });
    return null;
  }

  return invitation;
}

async function listRepoInvitations(req, res) {
  try {
    const invitations = await ProjectSpaceRepoMember.findAll({
      where: {
        user_id: req.user.userId,
        status: 'pending',
      },
      include: [
        {
          model: ProjectSpaceRepo,
          as: 'repo',
          required: true,
          where: { archived_at: null },
          include: [
            { model: User, as: 'owner', attributes: ['id', 'name', 'username'], required: false },
            { model: ProjectSpace, as: 'space', required: false },
          ],
        },
      ],
      order: [['created_at', 'DESC']],
    });

    return res.json({ invitations: invitations.map(serializeInvitation) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch repository invitations.' });
  }
}

async function acceptRepoInvitation(req, res) {
  try {
    const invitation = await findInvitation(req.params.memberId, req.user.userId, res);
    if (!invitation) return;

    await invitation.update({ status: 'accepted' });
    return res.json({ invitation: serializeInvitation(invitation) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to accept repository invitation.' });
  }
}

async function rejectRepoInvitation(req, res) {
  try {
    const invitation = await findInvitation(req.params.memberId, req.user.userId, res);
    if (!invitation) return;

    await invitation.destroy();
    return res.json({ rejected: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to reject repository invitation.' });
  }
}

module.exports = {
  acceptRepoInvitation,
  listRepoInvitations,
  rejectRepoInvitation,
};

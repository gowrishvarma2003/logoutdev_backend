const {
  ProjectSpaceRepoAttachment,
  ProjectSpaceRepo,
} = require('../../models');
const {
  getSpaceOr404,
  ensureSpaceReadable,
  getMembership,
  isOwner,
  isMaintainerOrOwner,
} = require('../../services/spaces/spaceAccess');
const { getRepoOr404, getAccessContext, ensureRepoCapability } = require('../../services/spaces/repoAccess');
const { asTrimmedString } = require('../../services/spaces/spaceValidation');
const { listVisibleAttachments, serializeAttachment } = require('../../services/spaces/spaceAttachmentService');

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

async function normalizeAttachmentPositions(spaceId) {
  const attachments = await ProjectSpaceRepoAttachment.findAll({
    where: { space_id: spaceId },
    order: [['position', 'ASC'], ['created_at', 'ASC']],
  });

  for (const [index, attachment] of attachments.entries()) {
    if (attachment.position !== index) {
      // eslint-disable-next-line no-await-in-loop
      await attachment.update({ position: index, updated_at: new Date() });
    }
  }
}

async function ensurePrimaryAttachment(spaceId, attachmentId = null) {
  const attachments = await ProjectSpaceRepoAttachment.findAll({
    where: { space_id: spaceId },
    order: [['position', 'ASC'], ['created_at', 'ASC']],
  });
  if (attachments.length === 0) return;

  const targetId = attachmentId || attachments[0].id;
  for (const attachment of attachments) {
    const nextPrimary = attachment.id === targetId;
    if (attachment.is_primary !== nextPrimary) {
      // eslint-disable-next-line no-await-in-loop
      await attachment.update({ is_primary: nextPrimary, updated_at: new Date() });
    }
  }
}

async function ensureSpaceManageable(spaceId, userId, res) {
  const space = await getSpaceOr404(spaceId, res);
  if (!space) return null;

  const membership = await getMembership(spaceId, userId);
  if (!(isOwner(space, userId) || isMaintainerOrOwner(membership))) {
    res.status(403).json({ error: 'Only the space owner or maintainer can manage attachments.' });
    return null;
  }

  return space;
}

async function attachRepoToSpace(repo, spaceId, userId, options = {}) {
  const { label = null, isPrimary = false } = options;

  const existing = await ProjectSpaceRepoAttachment.findOne({
    where: { repo_id: repo.id },
  });

  // Allow moving a managed repo between spaces from repo settings.
  if (existing && existing.space_id !== spaceId) {
    const previousSpaceId = existing.space_id;
    const wasPrimary = existing.is_primary;
    const nextPosition = await ProjectSpaceRepoAttachment.count({
      where: { space_id: spaceId },
    });

    await existing.update({
      space_id: spaceId,
      label: label || existing.label || repo.name,
      position: nextPosition,
      is_primary: isPrimary || nextPosition === 0,
      updated_at: new Date(),
    });

    await repo.update({
      space_id: spaceId,
      updated_at: new Date(),
    });

    await normalizeAttachmentPositions(previousSpaceId);
    if (wasPrimary) {
      await ensurePrimaryAttachment(previousSpaceId);
    }

    if (isPrimary) {
      await ensurePrimaryAttachment(spaceId, existing.id);
    } else {
      await ensurePrimaryAttachment(spaceId);
    }

    return existing.reload({
      include: [{ model: ProjectSpaceRepo, as: 'repo', required: false }],
    });
  }

  const position = await ProjectSpaceRepoAttachment.count({
    where: { space_id: spaceId },
  });

  const [attachment] = await ProjectSpaceRepoAttachment.findOrCreate({
    where: { repo_id: repo.id },
    defaults: {
      space_id: spaceId,
      repo_id: repo.id,
      external_url: null,
      label: label || repo.name,
      position,
      is_primary: isPrimary || position === 0,
      attached_by: userId,
    },
  });

  await repo.update({
    space_id: spaceId,
    updated_at: new Date(),
  });

  if (!attachment.label && label) {
    await attachment.update({ label, updated_at: new Date() });
  }

  if (isPrimary) {
    await ensurePrimaryAttachment(spaceId, attachment.id);
  } else {
    await ensurePrimaryAttachment(spaceId);
  }

  return attachment.reload({
    include: [{ model: ProjectSpaceRepo, as: 'repo', required: false }],
  });
}

async function listAttachments(req, res) {
  try {
    const requesterId = req.user?.userId || null;
    const readableSpace = await ensureSpaceReadable(req.params.spaceId, requesterId, res);
    if (!readableSpace) return;

    const attachments = await listVisibleAttachments(req.params.spaceId, requesterId);
    return res.json({ attachments });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch space attachments.' });
  }
}

async function createAttachment(req, res) {
  try {
    const userId = req.user.userId;
    const { spaceId } = req.params;

    const space = await ensureSpaceManageable(spaceId, userId, res);
    if (!space) return;

    const repoId = asTrimmedString(req.body.repo_id);
    const externalUrl = asTrimmedString(req.body.external_url);
    const label = asTrimmedString(req.body.label) || null;
    const isPrimary = Boolean(req.body.is_primary);

    if (!repoId && !externalUrl) {
      return res.status(400).json({ error: 'Provide repo_id or external_url.' });
    }

    if (repoId && externalUrl) {
      return res.status(400).json({ error: 'Attachment can reference either a repo or an external URL, not both.' });
    }

    let attachment;

    if (repoId) {
      const repo = await getRepoOr404(repoId, res);
      if (!repo) return;

      const access = await getAccessContext(repo, userId);
      if (!access.isAdmin) {
        return res.status(403).json({ error: 'You need admin access on the repository to attach it.' });
      }

      attachment = await attachRepoToSpace(repo, space.id, userId, { label, isPrimary });
    } else {
      if (!isHttpUrl(externalUrl)) {
        return res.status(400).json({ error: 'external_url must be a valid http/https URL.' });
      }

      const position = await ProjectSpaceRepoAttachment.count({
        where: { space_id: space.id },
      });

      attachment = await ProjectSpaceRepoAttachment.create({
        space_id: space.id,
        repo_id: null,
        external_url: externalUrl,
        label: label || externalUrl,
        position,
        is_primary: isPrimary || position === 0,
        attached_by: userId,
      });

      if (attachment.is_primary) {
        await ensurePrimaryAttachment(space.id, attachment.id);
      }
    }

    const hydrated = await serializeAttachment(
      await ProjectSpaceRepoAttachment.findByPk(attachment.id, {
        include: [{ model: ProjectSpaceRepo, as: 'repo', required: false }],
      }),
      userId
    );

    return res.status(201).json({ attachment: hydrated });
  } catch (error) {
    const status = /already attached/i.test(error.message) ? 409 : 500;
    return res.status(status).json({ error: error.message || 'Failed to create attachment.' });
  }
}

async function updateAttachment(req, res) {
  try {
    const userId = req.user.userId;
    const { spaceId, attachmentId } = req.params;
    const space = await ensureSpaceManageable(spaceId, userId, res);
    if (!space) return;

    const attachment = await ProjectSpaceRepoAttachment.findOne({
      where: { id: attachmentId, space_id: spaceId },
      include: [{ model: ProjectSpaceRepo, as: 'repo', required: false }],
    });
    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found.' });
    }

    const updates = {};

    if (req.body.label !== undefined) {
      updates.label = asTrimmedString(req.body.label) || null;
    }

    if (req.body.external_url !== undefined) {
      if (attachment.repo_id) {
        return res.status(400).json({ error: 'Managed repo attachments cannot be converted into external links.' });
      }

      const externalUrl = asTrimmedString(req.body.external_url);
      if (externalUrl && !isHttpUrl(externalUrl)) {
        return res.status(400).json({ error: 'external_url must be a valid http/https URL.' });
      }
      updates.external_url = externalUrl || null;
    }

    if (req.body.position !== undefined) {
      updates.position = Math.max(Number(req.body.position) || 0, 0);
    }

    updates.updated_at = new Date();
    await attachment.update(updates);
    await normalizeAttachmentPositions(space.id);

    if (req.body.is_primary !== undefined) {
      if (Boolean(req.body.is_primary)) {
        await ensurePrimaryAttachment(space.id, attachment.id);
      } else {
        await ensurePrimaryAttachment(space.id);
      }
    }

    const hydrated = await serializeAttachment(
      await ProjectSpaceRepoAttachment.findByPk(attachment.id, {
        include: [{ model: ProjectSpaceRepo, as: 'repo', required: false }],
      }),
      userId
    );

    return res.json({ attachment: hydrated });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update attachment.' });
  }
}

async function deleteAttachment(req, res) {
  try {
    const userId = req.user.userId;
    const { spaceId, attachmentId } = req.params;
    const space = await ensureSpaceManageable(spaceId, userId, res);
    if (!space) return;

    const attachment = await ProjectSpaceRepoAttachment.findOne({
      where: { id: attachmentId, space_id: spaceId },
      include: [{ model: ProjectSpaceRepo, as: 'repo', required: false }],
    });
    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found.' });
    }

    if (attachment.repo) {
      await attachment.repo.update({
        space_id: null,
        updated_at: new Date(),
      });
    }

    const wasPrimary = attachment.is_primary;
    await attachment.destroy();
    await normalizeAttachmentPositions(space.id);
    if (wasPrimary) {
      await ensurePrimaryAttachment(space.id);
    }

    return res.json({ removed: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete attachment.' });
  }
}

async function getRepoAttachment(req, res) {
  try {
    const requesterId = req.user?.userId || null;
    const repo = await getRepoOr404(req.params.repoId, res);
    if (!repo) return;

    const access = await getAccessContext(repo, requesterId);
    if (!access.canRead) {
      return res.status(404).json({ error: 'Repository not found.' });
    }

    const attachment = await ProjectSpaceRepoAttachment.findOne({
      where: { repo_id: repo.id },
      include: [{ model: ProjectSpaceRepo, as: 'repo', required: false }],
    });

    return res.json({
      attachment: attachment ? await serializeAttachment(attachment, requesterId) : null,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch repository attachment.' });
  }
}

async function upsertRepoAttachment(req, res) {
  try {
    const userId = req.user.userId;
    const result = await ensureRepoCapability(req.params.repoId, userId, res, 'can_manage_general');
    if (!result) return;
    const { repo } = result;

    const spaceId = asTrimmedString(req.body.space_id);
    if (!spaceId) {
      return res.status(400).json({ error: 'space_id is required.' });
    }

    const space = await ensureSpaceManageable(spaceId, userId, res);
    if (!space) return;

    const attachment = await attachRepoToSpace(repo, space.id, userId, {
      label: asTrimmedString(req.body.label) || null,
      isPrimary: Boolean(req.body.is_primary),
    });

    return res.json({
      attachment: await serializeAttachment(attachment, userId),
    });
  } catch (error) {
    const status = /already attached/i.test(error.message) ? 409 : 500;
    return res.status(status).json({ error: error.message || 'Failed to attach repository.' });
  }
}

async function removeRepoAttachment(req, res) {
  try {
    const userId = req.user.userId;
    const result = await ensureRepoCapability(req.params.repoId, userId, res, 'can_manage_general');
    if (!result) return;
    const { repo } = result;

    const attachment = await ProjectSpaceRepoAttachment.findOne({
      where: { repo_id: repo.id },
    });
    if (!attachment) {
      return res.json({ removed: true });
    }

    const spaceId = attachment.space_id;
    const wasPrimary = attachment.is_primary;
    await attachment.destroy();
    await repo.update({ space_id: null, updated_at: new Date() });
    await normalizeAttachmentPositions(spaceId);
    if (wasPrimary) {
      await ensurePrimaryAttachment(spaceId);
    }

    return res.json({ removed: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to detach repository.' });
  }
}

module.exports = {
  listAttachments,
  createAttachment,
  updateAttachment,
  deleteAttachment,
  getRepoAttachment,
  upsertRepoAttachment,
  removeRepoAttachment,
};

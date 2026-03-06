const { ProjectSpaceStack } = require('../../models');
const {
  getSpaceOr404,
  ensureSpaceReadable,
  getMembership,
  isMaintainerOrOwner,
} = require('../../services/spaces/spaceAccess');
const {
  STACK_CATEGORIES,
  STACK_MATURITY,
  asTrimmedString,
  isAllowedValue,
} = require('../../services/spaces/spaceValidation');

async function replaceStack(req, res) {
  try {
    const userId = req.user.userId;
    const spaceId = req.params.spaceId;

    const space = await getSpaceOr404(spaceId, res);
    if (!space) return;

    const membership = await getMembership(spaceId, userId);
    if (!isMaintainerOrOwner(membership)) {
      return res.status(403).json({ error: 'Only owner or maintainer can update tech stack.' });
    }

    const items = Array.isArray(req.body.stack) ? req.body.stack : [];
    if (items.length === 0) {
      return res.status(400).json({ error: 'stack must be a non-empty array.' });
    }

    const normalized = [];

    for (const item of items) {
      const category = asTrimmedString(item?.category || 'other');
      const technology = asTrimmedString(item?.technology);
      const maturity = asTrimmedString(item?.maturity || 'in-use');

      if (!technology) {
        return res.status(400).json({ error: 'Each stack item must include technology.' });
      }

      if (!isAllowedValue(category, STACK_CATEGORIES)) {
        return res.status(400).json({ error: `Invalid stack category: ${category}` });
      }

      if (!isAllowedValue(maturity, STACK_MATURITY)) {
        return res.status(400).json({ error: `Invalid stack maturity: ${maturity}` });
      }

      normalized.push({
        space_id: spaceId,
        category,
        technology: technology.slice(0, 80),
        maturity,
      });
    }

    await ProjectSpaceStack.destroy({ where: { space_id: spaceId } });
    await ProjectSpaceStack.bulkCreate(normalized);

    const stack = await ProjectSpaceStack.findAll({
      where: { space_id: spaceId },
      order: [['category', 'ASC'], ['technology', 'ASC']],
    });

    return res.json({ stack });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update tech stack.' });
  }
}

async function getStack(req, res) {
  try {
    const requesterId = req.user?.userId || null;
    const readableSpace = await ensureSpaceReadable(req.params.spaceId, requesterId, res);
    if (!readableSpace) return;

    const stack = await ProjectSpaceStack.findAll({
      where: { space_id: req.params.spaceId },
      order: [['category', 'ASC'], ['technology', 'ASC']],
    });

    return res.json({ stack });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch tech stack.' });
  }
}

module.exports = { replaceStack, getStack };

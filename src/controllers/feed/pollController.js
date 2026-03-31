const { sequelize, Post, PollOption, PollVote } = require('../../models');

async function submitPollVote(req, res) {
  const transaction = await sequelize.transaction();

  try {
    const userId = req.user.userId;
    const { postId } = req.params;
    const { option_id } = req.body;

    if (!option_id || typeof option_id !== 'string') {
      await transaction.rollback();
      return res.status(400).json({ error: 'option_id is required.' });
    }

    const post = await Post.findByPk(postId, { transaction });
    if (!post || !post.is_poll) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Poll not found.' });
    }

    if (post.user_id === userId) {
      await transaction.rollback();
      return res.status(403).json({ error: 'You cannot vote on your own poll.' });
    }

    const option = await PollOption.findOne({
      where: { id: option_id, post_id: postId },
      transaction,
    });

    if (!option) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Option not found.' });
    }

    // Check if user already voted on this poll
    const existing = await PollVote.findOne({
      where: { post_id: postId, user_id: userId },
      transaction,
    });

    if (existing) {
      if (existing.option_id === option_id) {
        // Same option — remove vote (toggle off)
        await PollOption.decrement('vote_count', {
          by: 1,
          where: { id: existing.option_id },
          transaction,
        });
        await existing.destroy({ transaction });
        await transaction.commit();
        return res.json({ voted: false, option_id: null });
      }

      // Different option — switch vote
      await PollOption.decrement('vote_count', {
        by: 1,
        where: { id: existing.option_id },
        transaction,
      });
      await PollOption.increment('vote_count', {
        by: 1,
        where: { id: option_id },
        transaction,
      });
      existing.option_id = option_id;
      await existing.save({ transaction });
      await transaction.commit();
      return res.json({ voted: true, option_id });
    }

    // New vote
    await PollVote.create({ post_id: postId, option_id, user_id: userId }, { transaction });
    await PollOption.increment('vote_count', {
      by: 1,
      where: { id: option_id },
      transaction,
    });

    await transaction.commit();
    return res.json({ voted: true, option_id });
  } catch (error) {
    await transaction.rollback();
    return res.status(500).json({ error: 'Failed to submit vote.' });
  }
}

module.exports = { submitPollVote };

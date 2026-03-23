const { User } = require('../../models');
const { ensureRepoWritable } = require('../../services/spaces/repoAccess');
const { resolveRepoPath } = require('../../services/git/gitPath');
const { isSafeRef, writeFileContent, deleteFileByPath } = require('../../services/git/gitShell');

async function writeContents(req, res) {
  try {
    const result = await ensureRepoWritable(req.params.repoId, req.user.userId, res);
    if (!result) return;

    const ref = (req.body.branch || req.body.ref || result.repo.default_branch).trim();
    const filePath = (req.body.path || '').trim();
    const content = req.body.content ?? '';
    const message = (req.body.message || '').trim();

    if (!filePath) return res.status(400).json({ error: 'File path is required.' });
    if (!message) return res.status(400).json({ error: 'Commit message is required.' });
    if (!isSafeRef(ref)) return res.status(400).json({ error: 'Invalid branch.' });

    const user = await User.findByPk(req.user.userId, { attributes: ['name', 'email'] });
    if (!user) return res.status(400).json({ error: 'User not found.' });

    const repoPath = await resolveRepoPath(result.repo.id, result.repo.space_id);
    const commit = await writeFileContent(repoPath, ref, filePath, content, message, {
      name: user.name || 'Unknown',
      email: user.email || 'anonymous@logoutdev.com',
    });

    return res.status(201).json({ commit });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to write file.' });
  }
}

async function deleteContents(req, res) {
  try {
    const result = await ensureRepoWritable(req.params.repoId, req.user.userId, res);
    if (!result) return;

    const ref = (req.body.branch || req.body.ref || result.repo.default_branch).trim();
    const filePath = (req.body.path || '').trim();
    const message = (req.body.message || '').trim();

    if (!filePath) return res.status(400).json({ error: 'File path is required.' });
    if (!message) return res.status(400).json({ error: 'Commit message is required.' });
    if (!isSafeRef(ref)) return res.status(400).json({ error: 'Invalid branch.' });

    const user = await User.findByPk(req.user.userId, { attributes: ['name', 'email'] });
    if (!user) return res.status(400).json({ error: 'User not found.' });

    const repoPath = await resolveRepoPath(result.repo.id, result.repo.space_id);
    const commit = await deleteFileByPath(repoPath, ref, filePath, message, {
      name: user.name || 'Unknown',
      email: user.email || 'anonymous@logoutdev.com',
    });

    return res.json({ commit });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to delete file.' });
  }
}

module.exports = {
  writeContents,
  deleteContents,
};

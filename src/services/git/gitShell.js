const { execFile } = require('child_process');
const { promisify } = require('util');
const { ensureRepoParentDirectory } = require('./gitPath');

const execFileAsync = promisify(execFile);
const README_CANDIDATES = ['README.md', 'README', 'readme.md', 'Readme.md'];

function isSafeRef(ref) {
  return typeof ref === 'string'
    && ref.length > 0
    && ref.length <= 100
    && !ref.includes('..')
    && !ref.startsWith('/')
    && !ref.includes('\\')
    && /^[A-Za-z0-9._/@-]+$/.test(ref);
}

function normalizeRepoPath(repoPath) {
  if (!repoPath) return '';
  const normalized = String(repoPath)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');

  if (!normalized || normalized === '.') return '';
  if (normalized.includes('..')) {
    throw new Error('Invalid path.');
  }

  return normalized;
}

async function execGit(args, options = {}) {
  try {
    const result = await execFileAsync('git', args, {
      maxBuffer: options.maxBuffer || 10 * 1024 * 1024,
      encoding: options.encoding === 'buffer' ? 'buffer' : 'utf8',
    });
    return result.stdout;
  } catch (error) {
    error.gitStdout = error.stdout;
    error.gitStderr = error.stderr;
    throw error;
  }
}

async function initializeBareRepository(repoPath, defaultBranch = 'main') {
  await ensureRepoParentDirectory();
  await execGit(['init', '--bare', repoPath]);
  await execGit(['--git-dir', repoPath, 'symbolic-ref', 'HEAD', `refs/heads/${defaultBranch}`]);
}

async function setDefaultBranch(repoPath, defaultBranch) {
  await execGit(['--git-dir', repoPath, 'symbolic-ref', 'HEAD', `refs/heads/${defaultBranch}`]);
}

async function repoHasCommits(repoPath, ref = 'HEAD') {
  try {
    await execGit(['--git-dir', repoPath, 'rev-parse', '--verify', `${ref}^{commit}`]);
    return true;
  } catch (error) {
    return false;
  }
}

function parseLsTree(buffer, basePath) {
  const text = buffer.toString('utf8');
  const lines = text.split('\n').filter(Boolean);
  const normalizedBase = normalizeRepoPath(basePath);

  return lines.map((line) => {
    const [meta, name] = line.split('\t');
    const [mode, type, oid] = meta.split(' ');
    const path = normalizedBase ? `${normalizedBase}/${name}` : name;

    return {
      path,
      name,
      type,
      mode,
      oid,
    };
  });
}

async function listTree(repoPath, ref, treePath = '') {
  const normalizedRef = ref || 'HEAD';
  const normalizedPath = normalizeRepoPath(treePath);

  if (!isSafeRef(normalizedRef)) {
    throw new Error('Invalid ref.');
  }

  const hasCommits = await repoHasCommits(repoPath, normalizedRef);
  if (!hasCommits) {
    return [];
  }

  const target = normalizedPath ? `${normalizedRef}:${normalizedPath}` : normalizedRef;
  const output = await execGit(['--git-dir', repoPath, 'ls-tree', target], { encoding: 'buffer' });
  return parseLsTree(output, normalizedPath);
}

async function readBlob(repoPath, ref, blobPath) {
  const normalizedRef = ref || 'HEAD';
  const normalizedPath = normalizeRepoPath(blobPath);

  if (!normalizedPath) {
    throw new Error('Path is required.');
  }

  if (!isSafeRef(normalizedRef)) {
    throw new Error('Invalid ref.');
  }

  const sizeOutput = await execGit([
    '--git-dir',
    repoPath,
    'cat-file',
    '-s',
    `${normalizedRef}:${normalizedPath}`,
  ]);
  const size = Number(String(sizeOutput).trim());
  const content = await execGit([
    '--git-dir',
    repoPath,
    'show',
    `${normalizedRef}:${normalizedPath}`,
  ], { encoding: 'buffer', maxBuffer: 20 * 1024 * 1024 });
  const isBinary = content.includes(0);

  return {
    size,
    is_binary: isBinary,
    content: isBinary ? undefined : content.toString('utf8'),
    encoding: isBinary ? undefined : 'utf-8',
  };
}

async function findReadme(repoPath, ref) {
  const normalizedRef = ref || 'HEAD';

  if (!isSafeRef(normalizedRef)) {
    throw new Error('Invalid ref.');
  }

  const hasCommits = await repoHasCommits(repoPath, normalizedRef);
  if (!hasCommits) return null;

  for (const candidate of README_CANDIDATES) {
    try {
      const blob = await readBlob(repoPath, normalizedRef, candidate);
      return {
        ref: normalizedRef,
        path: candidate,
        ...blob,
      };
    } catch (error) {
      // Try next filename.
    }
  }

  return null;
}

async function listCommits(repoPath, ref, commitPath = '', page = 1, limit = 20) {
  const normalizedRef = ref || 'HEAD';
  const normalizedPath = normalizeRepoPath(commitPath);

  if (!isSafeRef(normalizedRef)) {
    throw new Error('Invalid ref.');
  }

  const hasCommits = await repoHasCommits(repoPath, normalizedRef);
  if (!hasCommits) {
    return [];
  }

  const skip = Math.max(page - 1, 0) * limit;
  const args = [
    '--git-dir',
    repoPath,
    'log',
    normalizedRef,
    `--skip=${skip}`,
    `--max-count=${limit}`,
    '--format=%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%aI%x1e',
  ];

  if (normalizedPath) {
    args.push('--', normalizedPath);
  }

  const output = await execGit(args);
  return String(output)
    .split('\x1e')
    .filter(Boolean)
    .map((chunk) => {
      const [oid, short_oid, message, author_name, author_email, authored_at] = chunk.split('\x1f');
      return {
        oid,
        short_oid,
        message,
        author_name,
        author_email,
        authored_at,
      };
    });
}

// ─── Branch operations ───────────────────────────────────────────────

async function listBranches(repoPath) {
  const hasAny = await repoHasCommits(repoPath).catch(() => false);
  if (!hasAny) return [];

  const format = '%(refname:short)%1f%(objectname:short)%1f%(HEAD)';
  const output = await execGit([
    '--git-dir', repoPath, 'for-each-ref',
    `--format=${format}`, '--sort=-HEAD', '--sort=refname',
    'refs/heads/',
  ]);

  // Determine default branch
  let defaultBranch = 'main';
  try {
    const symRef = await execGit(['--git-dir', repoPath, 'symbolic-ref', 'HEAD']);
    defaultBranch = String(symRef).trim().replace('refs/heads/', '');
  } catch (_) { /* ignore */ }

  return String(output).split('\n').filter(Boolean).map((line) => {
    const [name, oid, headMarker] = line.split('\x1f');
    return {
      name,
      oid,
      is_head: headMarker.trim() === '*',
      is_default: name === defaultBranch,
    };
  });
}

async function createBranch(repoPath, name, startPoint = 'HEAD') {
  if (!isSafeRef(name)) throw new Error('Invalid branch name.');
  if (!isSafeRef(startPoint)) throw new Error('Invalid start point.');
  await execGit(['--git-dir', repoPath, 'branch', name, startPoint]);
  return { name, start_point: startPoint };
}

async function deleteBranch(repoPath, name) {
  if (!isSafeRef(name)) throw new Error('Invalid branch name.');

  // Prevent deleting the default branch
  try {
    const symRef = await execGit(['--git-dir', repoPath, 'symbolic-ref', 'HEAD']);
    const defaultBranch = String(symRef).trim().replace('refs/heads/', '');
    if (name === defaultBranch) {
      throw new Error('Cannot delete the default branch.');
    }
  } catch (error) {
    if (error.message === 'Cannot delete the default branch.') throw error;
  }

  await execGit(['--git-dir', repoPath, 'branch', '-D', name]);
  return { deleted: true };
}

// ─── Tag operations ──────────────────────────────────────────────────

async function listTags(repoPath) {
  const hasAny = await repoHasCommits(repoPath).catch(() => false);
  if (!hasAny) return [];

  const format = '%(refname:short)%1f%(objectname:short)%1f%(*objectname:short)%1f%(objecttype)%1f%(creatordate:iso-strict)%1f%(subject)%1f%(taggername)';
  const output = await execGit([
    '--git-dir', repoPath, 'for-each-ref',
    `--format=${format}`, '--sort=-creatordate',
    'refs/tags/',
  ]);

  return String(output).split('\n').filter(Boolean).map((line) => {
    const [name, oid, derefOid, type, dated, subject, tagger] = line.split('\x1f');
    return {
      name,
      oid: derefOid || oid,
      tag_oid: type === 'tag' ? oid : undefined,
      type: type === 'tag' ? 'annotated' : 'lightweight',
      message: type === 'tag' ? subject : undefined,
      tagger: tagger || undefined,
      tagged_at: dated || undefined,
    };
  });
}

async function createTag(repoPath, name, ref = 'HEAD', message = null) {
  if (!isSafeRef(name)) throw new Error('Invalid tag name.');
  if (!isSafeRef(ref)) throw new Error('Invalid ref.');

  const args = ['--git-dir', repoPath, 'tag'];
  if (message) {
    args.push('-a', name, ref, '-m', message);
  } else {
    args.push(name, ref);
  }
  await execGit(args);
  return { name, ref };
}

async function deleteTag(repoPath, name) {
  if (!isSafeRef(name)) throw new Error('Invalid tag name.');
  await execGit(['--git-dir', repoPath, 'tag', '-d', name]);
  return { deleted: true };
}

// ─── Commit detail with diff ─────────────────────────────────────────

async function getCommitDetail(repoPath, oid) {
  if (!isSafeRef(oid)) throw new Error('Invalid commit ref.');

  // Get commit metadata
  const metaFormat = '%H%x1f%h%x1f%P%x1f%s%x1f%b%x1f%an%x1f%ae%x1f%aI';
  const metaOutput = await execGit([
    '--git-dir', repoPath, 'log', '-1', `--format=${metaFormat}`, oid,
  ]);

  const [fullOid, shortOid, parents, subject, body, authorName, authorEmail, authoredAt] =
    String(metaOutput).trim().split('\x1f');

  // Get diff stats
  const statsOutput = await execGit([
    '--git-dir', repoPath, 'diff-tree', '--no-commit-id', '--numstat', '-r', oid,
  ]);

  let totalAdditions = 0;
  let totalDeletions = 0;
  const fileStats = {};
  String(statsOutput).split('\n').filter(Boolean).forEach((line) => {
    const [add, del, path] = line.split('\t');
    const additions = add === '-' ? 0 : Number(add);
    const deletions = del === '-' ? 0 : Number(del);
    totalAdditions += additions;
    totalDeletions += deletions;
    fileStats[path] = { additions, deletions };
  });

  // Get diff patches
  const patchOutput = await execGit([
    '--git-dir', repoPath, 'diff-tree', '--no-commit-id', '-r', '-p',
    '--diff-filter=ACDMRT', oid,
  ], { maxBuffer: 50 * 1024 * 1024 });

  // Parse patches per file
  const files = [];
  const patchParts = String(patchOutput).split(/^diff --git /m).filter(Boolean);
  for (const part of patchParts) {
    const headerEnd = part.indexOf('\n');
    const header = part.slice(0, headerEnd);
    const bPath = header.split(' b/').pop() || '';
    const patch = `diff --git ${part}`;

    let status = 'modified';
    if (part.includes('new file mode')) status = 'added';
    else if (part.includes('deleted file mode')) status = 'deleted';
    else if (part.includes('rename from')) status = 'renamed';

    const stats = fileStats[bPath] || { additions: 0, deletions: 0 };
    files.push({
      path: bPath,
      status,
      additions: stats.additions,
      deletions: stats.deletions,
      patch,
    });
  }

  return {
    oid: fullOid,
    short_oid: shortOid,
    parent_oids: parents ? parents.split(' ') : [],
    message: subject,
    body: body || '',
    author_name: authorName,
    author_email: authorEmail,
    authored_at: authoredAt,
    stats: {
      additions: totalAdditions,
      deletions: totalDeletions,
      files_changed: files.length,
    },
    files,
  };
}

// ─── Web file editing (create commits without working tree) ──────────

async function writeFileContent(repoPath, ref, filePath, content, message, author) {
  if (!isSafeRef(ref)) throw new Error('Invalid ref.');
  const normalizedPath = normalizeRepoPath(filePath);
  if (!normalizedPath) throw new Error('File path is required.');

  const branchRef = `refs/heads/${ref}`;

  // Hash the new content as a blob
  const blobOid = String(
    await execGit(['--git-dir', repoPath, 'hash-object', '-w', '--stdin'], {
      input: content,
    })
  ).trim();

  // If we need to pass content via stdin, use spawn instead
  const { execFile: execFileCb } = require('child_process');
  const { promisify } = require('util');
  const execFileP = promisify(execFileCb);

  // Hash via pipe
  const { spawn } = require('child_process');
  const hashBlob = await new Promise((resolve, reject) => {
    const proc = spawn('git', ['--git-dir', repoPath, 'hash-object', '-w', '--stdin']);
    let out = '';
    proc.stdout.on('data', (d) => { out += d; });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error('hash-object failed'));
      resolve(out.trim());
    });
    proc.stdin.end(content);
  });

  // Get the current tree
  let parentCommit = null;
  let baseTree = null;
  try {
    parentCommit = String(
      await execGit(['--git-dir', repoPath, 'rev-parse', branchRef])
    ).trim();
    baseTree = String(
      await execGit(['--git-dir', repoPath, 'rev-parse', `${parentCommit}^{tree}`])
    ).trim();
  } catch (_) {
    // Branch might not exist yet (first commit)
  }

  // Build a new tree using read-tree + update-index approach via mktree
  // For simplicity with bare repos, use git read-tree + update-index with GIT_INDEX_FILE
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const tmpIndex = path.join(os.tmpdir(), `logoutdev-idx-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  try {
    const gitEnv = { ...process.env, GIT_INDEX_FILE: tmpIndex, GIT_DIR: repoPath };

    if (baseTree) {
      await execFileP('git', ['read-tree', baseTree], { env: gitEnv });
    }

    // Add the file to the index
    await execFileP('git', [
      'update-index', '--add', '--cacheinfo',
      '100644', hashBlob, normalizedPath,
    ], { env: gitEnv });

    // Write the tree
    const newTree = String(
      await execFileP('git', ['write-tree'], { env: gitEnv })
    ).stdout.trim();

    // Create the commit
    const commitArgs = ['commit-tree', newTree, '-m', message];
    if (parentCommit) {
      commitArgs.push('-p', parentCommit);
    }

    const authorStr = `${author.name} <${author.email}>`;
    const commitEnv = {
      ...gitEnv,
      GIT_AUTHOR_NAME: author.name,
      GIT_AUTHOR_EMAIL: author.email,
      GIT_COMMITTER_NAME: author.name,
      GIT_COMMITTER_EMAIL: author.email,
    };

    const newCommit = String(
      await execFileP('git', commitArgs, { env: commitEnv })
    ).stdout.trim();

    // Update the branch ref
    await execGit(['--git-dir', repoPath, 'update-ref', branchRef, newCommit]);

    return { oid: newCommit, path: normalizedPath };
  } finally {
    try { fs.unlinkSync(tmpIndex); } catch (_) { /* ignore */ }
  }
}

async function deleteFileByPath(repoPath, ref, filePath, message, author) {
  if (!isSafeRef(ref)) throw new Error('Invalid ref.');
  const normalizedPath = normalizeRepoPath(filePath);
  if (!normalizedPath) throw new Error('File path is required.');

  const branchRef = `refs/heads/${ref}`;

  const { execFile: execFileCb } = require('child_process');
  const { promisify } = require('util');
  const execFileP = promisify(execFileCb);
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  const parentCommit = String(
    await execGit(['--git-dir', repoPath, 'rev-parse', branchRef])
  ).trim();

  const baseTree = String(
    await execGit(['--git-dir', repoPath, 'rev-parse', `${parentCommit}^{tree}`])
  ).trim();

  const tmpIndex = path.join(os.tmpdir(), `logoutdev-idx-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  try {
    const gitEnv = { ...process.env, GIT_INDEX_FILE: tmpIndex, GIT_DIR: repoPath };

    await execFileP('git', ['read-tree', baseTree], { env: gitEnv });
    await execFileP('git', ['update-index', '--remove', normalizedPath], { env: gitEnv });

    const newTree = String(
      await execFileP('git', ['write-tree'], { env: gitEnv })
    ).stdout.trim();

    const commitEnv = {
      ...gitEnv,
      GIT_AUTHOR_NAME: author.name,
      GIT_AUTHOR_EMAIL: author.email,
      GIT_COMMITTER_NAME: author.name,
      GIT_COMMITTER_EMAIL: author.email,
    };

    const newCommit = String(
      await execFileP('git', ['commit-tree', newTree, '-p', parentCommit, '-m', message], { env: commitEnv })
    ).stdout.trim();

    await execGit(['--git-dir', repoPath, 'update-ref', branchRef, newCommit]);

    return { oid: newCommit, path: normalizedPath };
  } finally {
    try { fs.unlinkSync(tmpIndex); } catch (_) { /* ignore */ }
  }
}

// ─── Fork (bare clone) ──────────────────────────────────────────────

async function forkRepository(sourceRepoPath, destRepoPath) {
  await ensureRepoParentDirectory();
  await execGit(['clone', '--bare', sourceRepoPath, destRepoPath]);
}

// ─── Diff between refs ──────────────────────────────────────────────

async function getDiffBetweenRefs(repoPath, base, head) {
  if (!isSafeRef(base) || !isSafeRef(head)) throw new Error('Invalid ref.');

  const statsOutput = await execGit([
    '--git-dir', repoPath, 'diff', '--numstat', `${base}...${head}`,
  ]);

  let totalAdditions = 0;
  let totalDeletions = 0;
  const fileStats = {};
  String(statsOutput).split('\n').filter(Boolean).forEach((line) => {
    const [add, del, filePath] = line.split('\t');
    const additions = add === '-' ? 0 : Number(add);
    const deletions = del === '-' ? 0 : Number(del);
    totalAdditions += additions;
    totalDeletions += deletions;
    fileStats[filePath] = { additions, deletions };
  });

  const patchOutput = await execGit([
    '--git-dir', repoPath, 'diff', '-p', `${base}...${head}`,
  ], { maxBuffer: 50 * 1024 * 1024 });

  const files = [];
  const patchParts = String(patchOutput).split(/^diff --git /m).filter(Boolean);
  for (const part of patchParts) {
    const headerEnd = part.indexOf('\n');
    const header = part.slice(0, headerEnd);
    const bPath = header.split(' b/').pop() || '';
    const patch = `diff --git ${part}`;

    let status = 'modified';
    if (part.includes('new file mode')) status = 'added';
    else if (part.includes('deleted file mode')) status = 'deleted';
    else if (part.includes('rename from')) status = 'renamed';

    const stats = fileStats[bPath] || { additions: 0, deletions: 0 };
    files.push({ path: bPath, status, additions: stats.additions, deletions: stats.deletions, patch });
  }

  return {
    base,
    head,
    stats: { additions: totalAdditions, deletions: totalDeletions, files_changed: files.length },
    files,
  };
}

async function listCommitsBetween(repoPath, base, head) {
  if (!isSafeRef(base) || !isSafeRef(head)) throw new Error('Invalid ref.');
  const hasCommits = await repoHasCommits(repoPath, base);
  if (!hasCommits) return [];

  try {
    const output = await execGit([
      '--git-dir', repoPath,
      'log',
      `${base}..${head}`,
      '--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%s',
    ]);

    const lines = output.split('\n').filter(Boolean);
    return lines.map((line) => {
      const [oid, short_oid, author_name, author_email, authored_at, message] = line.split('\0');
      return { oid, short_oid, author_name, author_email, authored_at, message };
    });
  } catch (err) {
    if (err.message && err.message.includes('unknown revision')) {
      return [];
    }
    throw err;
  }
}

async function mergeBranches(repoPath, baseBranch, topicBranch, options = {}) {
  if (!isSafeRef(baseBranch) || !isSafeRef(topicBranch)) throw new Error('Invalid ref limit');
  
  const { authorName = 'System', authorEmail = 'system@logout.dev', commitMessage = `Merge branch '${topicBranch}' into '${baseBranch}'` } = options;

  let mergeOutput;
  try {
    // Requires git >= 2.38
    mergeOutput = await execGit(['--git-dir', repoPath, 'merge-tree', '--write-tree', `refs/heads/${baseBranch}`, `refs/heads/${topicBranch}`]);
  } catch (err) {
    if (err.gitStdout) {
      mergeOutput = err.gitStdout;
    } else {
      throw new Error('Merge tree failed: ' + err.message);
    }
  }

  const lines = mergeOutput.split('\n');
  const treeOid = lines[0].trim();

  // If there are more lines (other than empty), there might be conflicts
  if (lines.length > 2 || (err => err.code === 1)) {
    // For now we will reject merges that have conflicts
    // We could parse conflicts, but for Phase 2 MVP, just throw
    throw new Error('Merge conflict detected. Cannot merge automatically.');
  }

  // Find commit IDs for the parents
  const baseCommitId = (await execGit(['--git-dir', repoPath, 'rev-parse', `refs/heads/${baseBranch}`])).trim();
  const topicCommitId = (await execGit(['--git-dir', repoPath, 'rev-parse', `refs/heads/${topicBranch}`])).trim();

  // Write the merge commit
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: authorName,
    GIT_AUTHOR_EMAIL: authorEmail,
    GIT_COMMITTER_NAME: authorName,
    GIT_COMMITTER_EMAIL: authorEmail,
  };

  const commitResult = await promisify(execFile)('git', [
    '--git-dir', repoPath,
    'commit-tree',
    treeOid,
    '-p', baseCommitId,
    '-p', topicCommitId,
    '-m', commitMessage
  ], { env });

  const newCommitId = commitResult.stdout.trim();

  // Update the base branch to point to new commit
  await execGit(['--git-dir', repoPath, 'update-ref', `refs/heads/${baseBranch}`, newCommitId]);

  return newCommitId;
}

module.exports = {
  isSafeRef,
  normalizeRepoPath,
  initializeBareRepository,
  setDefaultBranch,
  listTree,
  readBlob,
  findReadme,
  listCommits,
  repoHasCommits,
  listBranches,
  createBranch,
  deleteBranch,
  listTags,
  createTag,
  deleteTag,
  getCommitDetail,
  writeFileContent,
  deleteFileByPath,
  forkRepository,
  getDiffBetweenRefs,
  listCommitsBetween,
  mergeBranches,
};

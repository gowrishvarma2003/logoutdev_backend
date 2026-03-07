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
  const repoRootParts = repoPath.split(/[\\/]/);
  const spaceId = repoRootParts[repoRootParts.length - 2];
  await ensureRepoParentDirectory(spaceId);
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
};

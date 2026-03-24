const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createBranch,
  compareRefs,
  getMergeability,
  initializeBareRepository,
  listCommitsBetween,
  writeFileContent,
  readBlob,
  listCommits,
} = require('../src/services/git/gitShell');

test('writeFileContent creates a commit that can be read back from a bare repository', async () => {
  const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logoutdev-git-edit-'));
  const repoPath = path.join(tmpRoot, 'repo.git');

  try {
    await initializeBareRepository(repoPath, 'main');

    const commit = await writeFileContent(
      repoPath,
      'main',
      'src/hello.txt',
      'hello from web editor\n',
      'Add hello file',
      {
        name: 'LogoutDev Test',
        email: 'test@logout.dev',
      }
    );

    assert.ok(commit.oid);
    assert.equal(commit.path, 'src/hello.txt');

    const blob = await readBlob(repoPath, 'main', 'src/hello.txt');
    assert.equal(blob.is_binary, false);
    assert.equal(blob.content, 'hello from web editor\n');

    const commits = await listCommits(repoPath, 'main', '', 1, 10);
    assert.equal(commits.length, 1);
    assert.equal(commits[0].message, 'Add hello file');
  } finally {
    await fs.promises.rm(tmpRoot, { recursive: true, force: true });
  }
});

test('compareRefs and listCommitsBetween describe feature branch changes', async () => {
  const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logoutdev-git-compare-'));
  const repoPath = path.join(tmpRoot, 'repo.git');

  try {
    await initializeBareRepository(repoPath, 'main');
    await writeFileContent(
      repoPath,
      'main',
      'README.md',
      'base\n',
      'Initial commit',
      { name: 'LogoutDev Test', email: 'test@logout.dev' }
    );
    await createBranch(repoPath, 'feature/test', 'main');
    await writeFileContent(
      repoPath,
      'feature/test',
      'README.md',
      'base\nfeature change\n',
      'Feature change',
      { name: 'LogoutDev Test', email: 'test@logout.dev' }
    );

    const counts = await compareRefs(repoPath, 'main', 'feature/test');
    assert.equal(counts.ahead_by, 1);
    assert.equal(counts.behind_by, 0);

    const commits = await listCommitsBetween(repoPath, 'main', 'feature/test');
    assert.equal(commits.length, 1);
    assert.equal(commits[0].message, 'Feature change');

    const mergeability = await getMergeability(repoPath, 'refs/heads/main', 'refs/heads/feature/test');
    assert.equal(mergeability.state, 'clean');
  } finally {
    await fs.promises.rm(tmpRoot, { recursive: true, force: true });
  }
});

test('getMergeability reports dirty when branches conflict', async () => {
  const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logoutdev-git-conflict-'));
  const repoPath = path.join(tmpRoot, 'repo.git');

  try {
    await initializeBareRepository(repoPath, 'main');
    await writeFileContent(
      repoPath,
      'main',
      'conflict.txt',
      'original\n',
      'Initial commit',
      { name: 'LogoutDev Test', email: 'test@logout.dev' }
    );
    await createBranch(repoPath, 'feature/conflict', 'main');

    await writeFileContent(
      repoPath,
      'main',
      'conflict.txt',
      'main change\n',
      'Main change',
      { name: 'LogoutDev Test', email: 'test@logout.dev' }
    );
    await writeFileContent(
      repoPath,
      'feature/conflict',
      'conflict.txt',
      'feature change\n',
      'Feature change',
      { name: 'LogoutDev Test', email: 'test@logout.dev' }
    );

    const mergeability = await getMergeability(repoPath, 'refs/heads/main', 'refs/heads/feature/conflict');
    assert.equal(mergeability.state, 'dirty');
  } finally {
    await fs.promises.rm(tmpRoot, { recursive: true, force: true });
  }
});

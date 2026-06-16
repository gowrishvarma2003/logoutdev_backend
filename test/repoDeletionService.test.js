const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_URL = process.env.DB_URL || 'postgres://localhost/logoutdev_test';

const {
  _private: {
    assertSafeRepoPath,
    deleteRepositoryStorage,
  },
} = require('../src/services/repos/repoDeletionService');

const R2_ENV_KEYS = [
  'REPO_STORAGE_DRIVER',
  'GIT_STORAGE_DRIVER',
  'CLOUDFLARE_R2_BUCKET',
  'R2_BUCKET',
];

function disableR2ForTest() {
  const previous = {};
  for (const key of R2_ENV_KEYS) {
    previous[key] = process.env[key];
    delete process.env[key];
  }
  return () => {
    for (const key of R2_ENV_KEYS) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  };
}

test('deleteRepositoryStorage removes modern and legacy repository directories', async () => {
  const previousRoot = process.env.GIT_STORAGE_ROOT;
  const restoreR2 = disableR2ForTest();
  const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logoutdev-repo-delete-'));
  const repo = {
    id: '11111111-1111-4111-8111-111111111111',
    space_id: '22222222-2222-4222-8222-222222222222',
  };

  process.env.GIT_STORAGE_ROOT = tmpRoot;

  try {
    const modernPath = path.join(tmpRoot, 'repos', `${repo.id}.git`);
    const legacyPath = path.join(tmpRoot, 'spaces', repo.space_id, `${repo.id}.git`);
    await fs.promises.mkdir(path.join(modernPath, 'objects'), { recursive: true });
    await fs.promises.mkdir(path.join(legacyPath, 'objects'), { recursive: true });
    await fs.promises.writeFile(path.join(modernPath, 'HEAD'), 'ref: refs/heads/main\n');
    await fs.promises.writeFile(path.join(legacyPath, 'HEAD'), 'ref: refs/heads/main\n');

    await deleteRepositoryStorage(repo);

    await assert.rejects(fs.promises.access(modernPath));
    await assert.rejects(fs.promises.access(legacyPath));
  } finally {
    if (previousRoot === undefined) {
      delete process.env.GIT_STORAGE_ROOT;
    } else {
      process.env.GIT_STORAGE_ROOT = previousRoot;
    }
    restoreR2();
    await fs.promises.rm(tmpRoot, { recursive: true, force: true });
  }
});

test('assertSafeRepoPath rejects paths outside the configured git storage root', async () => {
  const previousRoot = process.env.GIT_STORAGE_ROOT;
  const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logoutdev-repo-guard-'));
  process.env.GIT_STORAGE_ROOT = tmpRoot;

  try {
    assert.throws(
      () => assertSafeRepoPath(path.join(os.tmpdir(), '111.git'), '111'),
      /Refusing to delete/
    );
  } finally {
    if (previousRoot === undefined) {
      delete process.env.GIT_STORAGE_ROOT;
    } else {
      process.env.GIT_STORAGE_ROOT = previousRoot;
    }
    await fs.promises.rm(tmpRoot, { recursive: true, force: true });
  }
});

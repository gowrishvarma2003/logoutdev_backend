const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildServiceAuthHeaders, verifyServiceRequest } = require('../src/services/internal/serviceAuth');
const {
  AGENT_BRANCH_NAME,
  validateAgentBranchName,
  normalizeInternalPath,
  isAllowedAgentArtifactPath,
} = require('../src/services/internal/repoAgentPolicy');
const {
  ensureBranch,
  getRefOid,
  initializeBareRepository,
  listTreeRecursive,
  readBlob,
  writeFileContent,
  writeFilesBatch,
} = require('../src/services/git/gitShell');
const { buildBlobPreview, buildInventory } = require('../src/services/repos/repoDocInventory');

test('internal service auth accepts a valid signed request', () => {
  const secret = 'repo-doc-agent-secret';
  process.env.INTERNAL_SERVICE_SHARED_SECRET = secret;
  const headers = buildServiceAuthHeaders({
    method: 'POST',
    path: '/internal/repos/repo-1/inventory',
    serviceId: 'logoutdev-backend',
    timestamp: Date.now(),
  });

  const result = verifyServiceRequest({
    method: 'POST',
    originalUrl: '/internal/repos/repo-1/inventory',
    headers,
  }, {
    secret: 'different-secret',
    allowedServiceIds: ['logoutdev-backend'],
  });

  assert.equal(result.ok, false);

  const validResult = verifyServiceRequest({
    method: 'POST',
    originalUrl: '/internal/repos/repo-1/inventory',
    headers: buildServiceAuthHeaders({
      method: 'POST',
      path: '/internal/repos/repo-1/inventory',
      serviceId: 'logoutdev-backend',
      timestamp: Date.now(),
      secret,
    }),
  }, {
    secret,
    allowedServiceIds: ['logoutdev-backend'],
  });

  assert.equal(validResult.ok, true);
  assert.equal(validResult.serviceId, 'logoutdev-backend');
});

test('repo agent policy only allows the fixed AI branch and .logoutdev artifacts', () => {
  assert.equal(validateAgentBranchName(AGENT_BRANCH_NAME), true);
  assert.equal(validateAgentBranchName('main'), false);
  assert.equal(normalizeInternalPath('/.logoutdev\\cache//file.json'), '.logoutdev/cache/file.json');
  assert.equal(isAllowedAgentArtifactPath('.logoutdev/project-doc.md'), true);
  assert.equal(isAllowedAgentArtifactPath('.logoutdev/cache/module-summaries/api.json'), true);
  assert.equal(isAllowedAgentArtifactPath('../.logoutdev/project-doc.md'), false);
  assert.equal(isAllowedAgentArtifactPath('docs/project-doc.md'), false);
});

test('writeFilesBatch publishes multiple generated artifacts to the AI branch', async () => {
  const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logoutdev-agent-commit-'));
  const repoPath = path.join(tmpRoot, 'repo.git');

  try {
    await initializeBareRepository(repoPath, 'main');
    await writeFileContent(
      repoPath,
      'main',
      'README.md',
      '# Demo\n',
      'Initial commit',
      { name: 'LogoutDev Test', email: 'test@logout.dev' }
    );

    const branch = await ensureBranch(repoPath, 'logoutdev/ai-docs', 'main');
    const headBefore = branch.head;

    const commit = await writeFilesBatch(
      repoPath,
      'logoutdev/ai-docs',
      [
        { path: '.logoutdev/project-doc.md', content: '# Project Documentation\n' },
        { path: '.logoutdev/project-doc.meta.json', content: '{"source_commit":"abc"}\n' },
      ],
      'docs(ai): update project documentation',
      { name: 'Repo Doc Agent', email: 'agent@logout.dev' },
      { expectedHead: headBefore }
    );

    const headAfter = await getRefOid(repoPath, 'refs/heads/logoutdev/ai-docs');
    const blob = await readBlob(repoPath, 'logoutdev/ai-docs', '.logoutdev/project-doc.md');

    assert.equal(commit.oid, headAfter);
    assert.match(blob.content, /Project Documentation/);
  } finally {
    await fs.promises.rm(tmpRoot, { recursive: true, force: true });
  }
});

test('writeFilesBatch rejects stale expectedHead values to prevent publish races', async () => {
  const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logoutdev-agent-race-'));
  const repoPath = path.join(tmpRoot, 'repo.git');

  try {
    await initializeBareRepository(repoPath, 'main');
    await writeFileContent(
      repoPath,
      'main',
      'README.md',
      '# Demo\n',
      'Initial commit',
      { name: 'LogoutDev Test', email: 'test@logout.dev' }
    );

    const branch = await ensureBranch(repoPath, AGENT_BRANCH_NAME, 'main');
    const staleHead = branch.head;

    await writeFilesBatch(
      repoPath,
      AGENT_BRANCH_NAME,
      [{ path: '.logoutdev/project-doc.md', content: '# First\n' }],
      'docs(ai): publish first version',
      { name: 'Repo Doc Agent', email: 'agent@logout.dev' },
      { expectedHead: staleHead }
    );

    await assert.rejects(
      () => writeFilesBatch(
        repoPath,
        AGENT_BRANCH_NAME,
        [{ path: '.logoutdev/project-doc.md', content: '# Second\n' }],
        'docs(ai): publish second version',
        { name: 'Repo Doc Agent', email: 'agent@logout.dev' },
        { expectedHead: staleHead }
      ),
      /Branch head changed before publish\./
    );
  } finally {
    await fs.promises.rm(tmpRoot, { recursive: true, force: true });
  }
});

test('buildInventory marks docs, manifests, and skip candidates', () => {
  const inventory = buildInventory([
    { path: 'README.md', name: 'README.md', type: 'blob', size: 120, extension: 'md', oid: '1' },
    { path: 'package.json', name: 'package.json', type: 'blob', size: 240, extension: 'json', oid: '2' },
    { path: 'src/index.ts', name: 'index.ts', type: 'blob', size: 640, extension: 'ts', oid: '3' },
    { path: 'node_modules/pkg/index.js', name: 'index.js', type: 'blob', size: 320, extension: 'js', oid: '4' },
  ]);

  assert.equal(inventory.root_docs.length, 1);
  assert.equal(inventory.manifests.length, 1);
  assert.equal(inventory.likely_entrypoints.length, 1);
  assert.equal(inventory.skip_candidates.length, 1);
});

test('buildInventory classifies lockfiles, tests, generated files, configs, and languages', () => {
  const inventory = buildInventory([
    { path: 'package-lock.json', name: 'package-lock.json', type: 'blob', size: 500000, extension: 'json', oid: '10' },
    { path: 'yarn.lock', name: 'yarn.lock', type: 'blob', size: 300000, extension: 'lock', oid: '11' },
    { path: 'poetry.lock', name: 'poetry.lock', type: 'blob', size: 200000, extension: 'lock', oid: '12' },
    { path: 'tsconfig.json', name: 'tsconfig.json', type: 'blob', size: 500, extension: 'json', oid: '13' },
    { path: 'vite.config.ts', name: 'vite.config.ts', type: 'blob', size: 800, extension: 'ts', oid: '14' },
    { path: 'src/app.test.ts', name: 'app.test.ts', type: 'blob', size: 1200, extension: 'ts', oid: '15' },
    { path: '__tests__/helper.js', name: 'helper.js', type: 'blob', size: 400, extension: 'js', oid: '16' },
    { path: 'tests/conftest.py', name: 'conftest.py', type: 'blob', size: 300, extension: 'py', oid: '17' },
    { path: 'src/api.generated.ts', name: 'api.generated.ts', type: 'blob', size: 9000, extension: 'ts', oid: '18' },
    { path: 'proto/service.pb.go', name: 'service.pb.go', type: 'blob', size: 5000, extension: 'go', oid: '19' },
    { path: 'dist/bundle.js.map', name: 'bundle.js.map', type: 'blob', size: 80000, extension: 'map', oid: '20' },
    { path: 'src/main.rs', name: 'main.rs', type: 'blob', size: 2000, extension: 'rs', oid: '21' },
    { path: 'lib/utils.rb', name: 'utils.rb', type: 'blob', size: 1500, extension: 'rb', oid: '22' },
    { path: 'data/config.yaml', name: 'config.yaml', type: 'blob', size: 600, extension: 'yaml', oid: '23' },
    { path: 'src/http/router.ts', name: 'router.ts', type: 'blob', size: 900, extension: 'ts', oid: '24' },
    { path: 'examples/demo-app.ts', name: 'demo-app.ts', type: 'blob', size: 700, extension: 'ts', oid: '25' },
  ]);

  // Lockfiles
  const lockfiles = inventory.files.filter((f) => f.is_lockfile);
  assert.equal(lockfiles.length, 3);
  assert.ok(lockfiles.every((f) => f.is_manifest)); // lockfiles are still manifests

  // Configs
  const configs = inventory.files.filter((f) => f.is_config);
  assert.equal(configs.length, 2); // tsconfig.json, vite.config.ts

  // Tests
  const tests = inventory.files.filter((f) => f.is_test);
  assert.equal(tests.length, 3); // app.test.ts, __tests__/helper.js, conftest.py

  // Generated
  const generated = inventory.files.filter((f) => f.is_generated);
  assert.equal(generated.length, 3); // api.generated.ts, service.pb.go, bundle.js.map

  // Languages
  const rustFile = inventory.files.find((f) => f.path === 'src/main.rs');
  assert.equal(rustFile.language, 'Rust');
  const rubyFile = inventory.files.find((f) => f.path === 'lib/utils.rb');
  assert.equal(rubyFile.language, 'Ruby');
  const yamlFile = inventory.files.find((f) => f.path === 'data/config.yaml');
  assert.equal(yamlFile.language, null);
  const lockFile = inventory.files.find((f) => f.path === 'package-lock.json');
  assert.equal(lockFile.language, null);

  const routerFile = inventory.files.find((f) => f.path === 'src/http/router.ts');
  assert.equal(routerFile.path_role, 'router');
  const exampleFile = inventory.files.find((f) => f.path === 'examples/demo-app.ts');
  assert.equal(exampleFile.is_example, true);
});

test('buildBlobPreview returns structured excerpts and binary-safe previews', () => {
  const preview = buildBlobPreview({
    path: 'src/api/router.ts',
    oid: 'preview-1',
    size: 240,
    is_binary: false,
    content: [
      '// Copyright Example',
      '',
      'import express from "express";',
      'import { buildService } from "./service";',
      '',
      'export function buildRouter() {',
      '  const router = express.Router();',
      '  return router;',
      '}',
    ].join('\n'),
  }, { maxChars: 900 });

  assert.equal(preview.path, 'src/api/router.ts');
  assert.equal(preview.is_binary, false);
  assert.equal(preview.role_hints.includes('router'), true);
  assert.equal(preview.import_excerpt.includes('import express'), true);
  assert.equal(preview.symbol_excerpt.includes('export function buildRouter'), true);
  assert.ok(preview.estimated_tokens > 0);

  const binaryPreview = buildBlobPreview({
    path: 'assets/logo.png',
    oid: 'preview-2',
    size: 1024,
    is_binary: true,
  });

  assert.equal(binaryPreview.is_binary, true);
  assert.equal(binaryPreview.estimated_tokens, 0);
});

test('listTreeRecursive returns file metadata for repository inventories', async () => {
  const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logoutdev-agent-tree-'));
  const repoPath = path.join(tmpRoot, 'repo.git');

  try {
    await initializeBareRepository(repoPath, 'main');
    await writeFileContent(
      repoPath,
      'main',
      'src/app.js',
      'console.log("hello");\n',
      'Add app',
      { name: 'LogoutDev Test', email: 'test@logout.dev' }
    );

    const entries = await listTreeRecursive(repoPath, 'main', '');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].path, 'src/app.js');
    assert.equal(entries[0].extension, 'js');
  } finally {
    await fs.promises.rm(tmpRoot, { recursive: true, force: true });
  }
});

test('listTreeRecursive returns empty results for missing artifact directories on an existing branch', async () => {
  const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logoutdev-agent-empty-artifacts-'));
  const repoPath = path.join(tmpRoot, 'repo.git');

  try {
    await initializeBareRepository(repoPath, 'main');
    await writeFileContent(
      repoPath,
      'main',
      'README.md',
      '# Demo\n',
      'Initial commit',
      { name: 'LogoutDev Test', email: 'test@logout.dev' }
    );
    await ensureBranch(repoPath, AGENT_BRANCH_NAME, 'main');

    const entries = await listTreeRecursive(repoPath, AGENT_BRANCH_NAME, '.logoutdev');
    assert.deepEqual(entries, []);
  } finally {
    await fs.promises.rm(tmpRoot, { recursive: true, force: true });
  }
});

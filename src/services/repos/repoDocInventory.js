const DOC_FILE_NAMES = new Set([
  'README',
  'README.md',
  'README.mdx',
  'README.txt',
  'CONTRIBUTING',
  'CONTRIBUTING.md',
  'ARCHITECTURE.md',
  'docs.md',
  'CHANGELOG.md',
  'LICENSE',
  'LICENSE.md',
]);

const MANIFEST_FILE_NAMES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'tsconfig.json',
  'pyproject.toml',
  'requirements.txt',
  'Pipfile',
  'poetry.lock',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  '.env.example',
  'vercel.json',
  'next.config.js',
  'next.config.ts',
  'vite.config.ts',
  'vite.config.js',
]);

const LOCKFILE_NAMES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'poetry.lock',
]);

const CONFIG_ONLY_NAMES = new Set([
  'tsconfig.json',
  'vercel.json',
  'next.config.js',
  'next.config.ts',
  'vite.config.ts',
  'vite.config.js',
  'docker-compose.yml',
  'docker-compose.yaml',
  '.env.example',
]);

const TEST_PATH_SEGMENTS = new Set([
  '__tests__',
  'test',
  'tests',
  'spec',
  '__mocks__',
]);

const EXAMPLE_PATH_SEGMENTS = new Set([
  'example',
  'examples',
  'sample',
  'samples',
  'demo',
  'demos',
]);

const TEST_FILE_PATTERNS = [
  /\.test\./,
  /\.spec\./,
  /_test\./,
  /_spec\./,
  /^test_/,
  /^conftest\.py$/,
];

const GENERATED_PATH_SEGMENTS = new Set([
  'generated',
  '__generated__',
  '__pycache__',
]);

const GENERATED_FILE_PATTERNS = [
  /\.generated\./,
  /\.pb\.go$/,
  /\.pb\.ts$/,
  /\.g\.dart$/,
];

const EXTENSION_TO_LANGUAGE = new Map([
  ['ts', 'TypeScript'],
  ['tsx', 'TypeScript'],
  ['js', 'JavaScript'],
  ['jsx', 'JavaScript'],
  ['mjs', 'JavaScript'],
  ['cjs', 'JavaScript'],
  ['py', 'Python'],
  ['go', 'Go'],
  ['rs', 'Rust'],
  ['java', 'Java'],
  ['kt', 'Kotlin'],
  ['kts', 'Kotlin'],
  ['scala', 'Scala'],
  ['rb', 'Ruby'],
  ['php', 'PHP'],
  ['cs', 'C#'],
  ['cpp', 'C++'],
  ['cc', 'C++'],
  ['cxx', 'C++'],
  ['c', 'C'],
  ['h', 'C'],
  ['hpp', 'C++'],
  ['swift', 'Swift'],
  ['dart', 'Dart'],
  ['lua', 'Lua'],
  ['ex', 'Elixir'],
  ['exs', 'Elixir'],
  ['hs', 'Haskell'],
  ['ml', 'OCaml'],
  ['mli', 'OCaml'],
  ['clj', 'Clojure'],
  ['cljs', 'Clojure'],
  ['r', 'R'],
  ['R', 'R'],
  ['sql', 'SQL'],
  ['sh', 'Shell'],
  ['bash', 'Shell'],
  ['zsh', 'Shell'],
  ['tf', 'Terraform'],
  ['proto', 'Protobuf'],
  ['vue', 'Vue'],
  ['svelte', 'Svelte'],
]);

const ENTRYPOINT_PATTERNS = [
  /^src\/main\./i,
  /^src\/index\./i,
  /^src\/app\./i,
  /^app\/layout\./i,
  /^app\/page\./i,
  /^server\./i,
  /^index\./i,
  /^main\./i,
  /^manage\.py$/i,
  /^cmd\/[^/]+\/main\.go$/i,
];

const PATH_ROLE_PATTERNS = [
  { role: 'router', pattern: /(^|\/)(router|routers|route|routes)\./i },
  { role: 'router', pattern: /(^|\/)(router|routers|route|routes)(\/|$)/i },
  { role: 'controller', pattern: /(^|\/)(controller|controllers)\./i },
  { role: 'controller', pattern: /(^|\/)(controller|controllers)(\/|$)/i },
  { role: 'service', pattern: /(^|\/)(service|services)\./i },
  { role: 'service', pattern: /(^|\/)(service|services)(\/|$)/i },
  { role: 'model', pattern: /(^|\/)(model|models|entity|entities|schema|schemas|dto|record|records)\./i },
  { role: 'model', pattern: /(^|\/)(model|models|entity|entities|schema|schemas|dto|record|records)(\/|$)/i },
];

const SKIP_SEGMENTS = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  'vendor',
  'target',
  '.git',
  '.turbo',
  '.cache',
  '.venv',
  'venv',
]);

function topLevelDirectory(filePath) {
  const parts = String(filePath || '').split('/').filter(Boolean);
  if (parts.length <= 1) return '.';
  return parts[0];
}

function isDocFile(entry) {
  return DOC_FILE_NAMES.has(entry.name) || entry.path.toLowerCase().startsWith('docs/');
}

function isManifestFile(entry) {
  return MANIFEST_FILE_NAMES.has(entry.name);
}

function isLockfile(entry) {
  return LOCKFILE_NAMES.has(entry.name);
}

function isConfigFile(entry) {
  return CONFIG_ONLY_NAMES.has(entry.name);
}

function isTestFile(entry) {
  const segments = entry.path.split('/');
  if (segments.some((segment) => TEST_PATH_SEGMENTS.has(segment))) {
    return true;
  }
  if (TEST_FILE_PATTERNS.some((pattern) => pattern.test(entry.name))) {
    return true;
  }
  return false;
}

function isExampleFile(entry) {
  const segments = entry.path.split('/');
  if (segments.some((segment) => EXAMPLE_PATH_SEGMENTS.has(segment.toLowerCase()))) {
    return true;
  }
  return /(example|sample|demo)/i.test(entry.name);
}

function isGeneratedFile(entry) {
  const segments = entry.path.split('/');
  if (segments.some((segment) => GENERATED_PATH_SEGMENTS.has(segment))) {
    return true;
  }
  if (GENERATED_FILE_PATTERNS.some((pattern) => pattern.test(entry.name))) {
    return true;
  }
  if (entry.extension === 'map') {
    return true;
  }
  return false;
}

function getLanguage(entry) {
  return EXTENSION_TO_LANGUAGE.get(entry.extension) || null;
}

function isLikelyEntrypoint(entry) {
  return ENTRYPOINT_PATTERNS.some((pattern) => pattern.test(entry.path));
}

function shouldSkipEntry(entry) {
  const segments = entry.path.split('/');
  if (segments.some((segment) => SKIP_SEGMENTS.has(segment))) {
    return true;
  }
  if (entry.name.endsWith('.min.js') || entry.name.endsWith('.min.css')) {
    return true;
  }
  return false;
}

function inferPathRole(entry, derived = {}) {
  if (derived.is_generated) return 'generated';
  if (derived.is_test) return 'test';
  if (derived.is_doc) return 'doc';
  if (derived.is_config) return 'config';
  if (derived.is_entrypoint) return 'entrypoint';

  for (const matcher of PATH_ROLE_PATTERNS) {
    if (matcher.pattern.test(entry.path)) {
      return matcher.role;
    }
  }

  return 'unknown';
}

function buildInventoryFile(entry) {
  const normalized = {
    path: entry.path,
    name: entry.name,
    size: entry.size,
    extension: entry.extension,
    top_level_dir: topLevelDirectory(entry.path),
  };
  const derived = {
    is_doc: isDocFile(entry),
    is_manifest: isManifestFile(entry),
    is_lockfile: isLockfile(entry),
    is_config: isConfigFile(entry),
    is_test: isTestFile(entry),
    is_example: isExampleFile(entry),
    is_generated: isGeneratedFile(entry),
    is_entrypoint: isLikelyEntrypoint(entry),
    should_skip: shouldSkipEntry(entry),
    language: getLanguage(entry),
    oid: entry.oid,
  };

  return {
    ...normalized,
    ...derived,
    path_role: inferPathRole(entry, derived),
  };
}

function clampPreviewChars(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 2200;
  return Math.max(400, Math.min(Math.floor(number), 8000));
}

function stripLicensePreamble(text) {
  const lines = String(text || '').split(/\r?\n/);
  let inBlockComment = false;
  let endIndex = 0;

  for (let i = 0; i < Math.min(lines.length, 80); i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      endIndex = i + 1;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      inBlockComment = true;
    }
    if (inBlockComment) {
      if (/(license|copyright|permission|warranty|MIT|Apache|BSD|GPL|Mozilla|ISC)/i.test(trimmed)) {
        endIndex = i + 1;
      }
      if (trimmed.includes('*/')) {
        inBlockComment = false;
        endIndex = i + 1;
      }
      continue;
    }
    if (/^(\/\/|#|\*|\* )/.test(trimmed) && /(license|copyright|permission|warranty|MIT|Apache|BSD|GPL|Mozilla|ISC)/i.test(trimmed)) {
      endIndex = i + 1;
      continue;
    }
    break;
  }

  return lines.slice(endIndex).join('\n');
}

function truncateText(text, maxChars) {
  const normalized = String(text || '').trim();
  if (!normalized) return '';
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars).trimEnd()}\n...`;
}

function extractMatchingSections(text, regex, maxChars, contextAfter = 1) {
  if (!text || maxChars <= 0) return '';
  const lines = text.split(/\r?\n/);
  const sections = [];
  const seen = new Set();
  let usedChars = 0;

  for (let index = 0; index < lines.length; index += 1) {
    if (!regex.test(lines[index])) {
      continue;
    }
    const chunk = lines.slice(index, Math.min(lines.length, index + contextAfter + 1)).join('\n').trim();
    if (!chunk || seen.has(chunk)) {
      continue;
    }
    const nextLength = usedChars + chunk.length + (sections.length ? 2 : 0);
    if (nextLength > maxChars) {
      break;
    }
    sections.push(chunk);
    seen.add(chunk);
    usedChars = nextLength;
  }

  return sections.join('\n\n');
}

function buildRoleHints(file) {
  const hints = [];
  if (file.path_role && file.path_role !== 'unknown') {
    hints.push(file.path_role);
  }
  if (file.is_entrypoint && !hints.includes('entrypoint')) {
    hints.push('entrypoint');
  }
  if (file.is_doc) hints.push('doc');
  if (file.is_config) hints.push('config');
  if (file.is_test) hints.push('test');
  if (file.is_example) hints.push('example');
  if (file.is_generated) hints.push('generated');
  if (file.language) {
    hints.push(`language:${String(file.language).toLowerCase()}`);
  }
  return Array.from(new Set(hints));
}

function buildBlobPreview(blobEntry, options = {}) {
  const previewMaxChars = clampPreviewChars(options.maxChars);
  const file = buildInventoryFile({
    path: blobEntry.path,
    name: blobEntry.name || blobEntry.path.split('/').pop() || blobEntry.path,
    size: blobEntry.size,
    extension: blobEntry.extension || (blobEntry.path.includes('.') ? blobEntry.path.split('.').pop().toLowerCase() : ''),
    oid: blobEntry.oid,
  });

  if (blobEntry.is_binary || typeof blobEntry.content !== 'string') {
    return {
      path: file.path,
      oid: blobEntry.oid || null,
      size: blobEntry.size ?? null,
      is_binary: true,
      line_count: 0,
      estimated_tokens: 0,
      head_excerpt: '',
      import_excerpt: '',
      symbol_excerpt: '',
      role_hints: buildRoleHints(file),
    };
  }

  const content = String(blobEntry.content || '');
  const cleaned = stripLicensePreamble(content);
  const headBudget = Math.max(120, Math.floor(previewMaxChars * 0.45));
  const importBudget = Math.max(100, Math.floor(previewMaxChars * 0.2));
  const symbolBudget = Math.max(120, previewMaxChars - headBudget - importBudget);
  const importRegex = /^(import |export .* from |from .* import |const .*=\s*require\(|require\(|use |package |namespace |#include )/m;
  const symbolRegex = /^(export |async function |function |class |const [A-Za-z0-9_$]+\s*=\s*(async\s*)?\(|def |async def |pub fn |fn |struct |interface |type |enum |impl |func )/m;

  const headExcerpt = truncateText(cleaned, headBudget);
  const importExcerpt = extractMatchingSections(cleaned, importRegex, importBudget, 0);
  const symbolExcerpt = extractMatchingSections(cleaned, symbolRegex, symbolBudget, 2);
  const previewText = [headExcerpt, importExcerpt, symbolExcerpt].filter(Boolean).join('\n');
  const lineCount = content ? content.split(/\r?\n/).length : 0;

  return {
    path: file.path,
    oid: blobEntry.oid || null,
    size: blobEntry.size ?? null,
    is_binary: false,
    line_count: lineCount,
    estimated_tokens: previewText ? Math.max(1, Math.ceil(previewText.length / 4)) : 0,
    head_excerpt: headExcerpt,
    import_excerpt: importExcerpt,
    symbol_excerpt: symbolExcerpt,
    role_hints: buildRoleHints(file),
  };
}

function buildInventory(entries) {
  const files = entries
    .filter((entry) => entry.type === 'blob')
    .map((entry) => buildInventoryFile(entry));

  const rootDocs = files.filter((file) => file.is_doc && !file.path.includes('/'));
  const manifests = files.filter((file) => file.is_manifest);
  const likelyEntrypoints = files.filter((file) => file.is_entrypoint);
  const skipCandidates = files.filter((file) => file.should_skip);
  const moduleRoots = Array.from(new Set(
    files
      .filter((file) => !file.should_skip)
      .map((file) => file.top_level_dir)
  )).sort();

  return {
    file_count: files.length,
    files,
    root_docs: rootDocs,
    manifests,
    likely_entrypoints: likelyEntrypoints,
    skip_candidates: skipCandidates,
    module_roots: moduleRoots,
  };
}

module.exports = {
  buildInventory,
  buildInventoryFile,
  buildBlobPreview,
  isDocFile,
  isManifestFile,
  isLockfile,
  isConfigFile,
  isTestFile,
  isExampleFile,
  isGeneratedFile,
  getLanguage,
  inferPathRole,
  isLikelyEntrypoint,
  shouldSkipEntry,
};

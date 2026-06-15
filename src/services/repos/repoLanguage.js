const path = require('path');
const { resolveRepoPath } = require('../git/gitPath');
const { listTreeRecursive } = require('../git/gitShell');

const EXTENSION_LANGUAGES = {
  '.c': 'C',
  '.cc': 'C++',
  '.cpp': 'C++',
  '.cs': 'C#',
  '.css': 'CSS',
  '.dart': 'Dart',
  '.go': 'Go',
  '.h': 'C',
  '.hpp': 'C++',
  '.html': 'HTML',
  '.java': 'Java',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.kt': 'Kotlin',
  '.kts': 'Kotlin',
  '.m': 'Objective-C',
  '.mm': 'Objective-C++',
  '.php': 'PHP',
  '.py': 'Python',
  '.rb': 'Ruby',
  '.rs': 'Rust',
  '.scss': 'SCSS',
  '.sh': 'Shell',
  '.sql': 'SQL',
  '.swift': 'Swift',
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.vue': 'Vue',
};

const FILENAME_LANGUAGES = {
  Dockerfile: 'Dockerfile',
  Makefile: 'Makefile',
  Rakefile: 'Ruby',
};

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'vendor',
]);

const IGNORED_EXTENSIONS = new Set([
  '.gif',
  '.ico',
  '.jpg',
  '.jpeg',
  '.lock',
  '.map',
  '.pdf',
  '.png',
  '.svg',
  '.webp',
]);

function getLanguageForFile(filePath) {
  const name = path.basename(filePath);
  if (FILENAME_LANGUAGES[name]) return FILENAME_LANGUAGES[name];
  return EXTENSION_LANGUAGES[path.extname(name).toLowerCase()] || null;
}

function shouldIgnoreFile(filePath) {
  const segments = filePath.split('/');
  if (segments.some((segment) => IGNORED_DIRECTORIES.has(segment))) return true;
  return IGNORED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function summarizeLanguages(entries) {
  const totals = new Map();

  for (const entry of entries) {
    if (entry.type !== 'blob' || shouldIgnoreFile(entry.path)) continue;

    const language = getLanguageForFile(entry.path);
    if (!language) continue;

    const size = Number(entry.size) || 0;
    totals.set(language, (totals.get(language) || 0) + Math.max(size, 1));
  }

  const totalBytes = [...totals.values()].reduce((sum, size) => sum + size, 0);
  const languages = [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, bytes]) => ({
      name,
      bytes,
      percentage: totalBytes ? Number(((bytes / totalBytes) * 100).toFixed(1)) : 0,
    }));

  return {
    language: languages[0]?.name || null,
    languages,
  };
}

async function analyzeRepositoryLanguages(repo) {
  try {
    const repoPath = await resolveRepoPath(repo.id, repo.space_id);
    const entries = await listTreeRecursive(repoPath, repo.default_branch);
    return summarizeLanguages(entries);
  } catch (error) {
    return { language: null, languages: [] };
  }
}

module.exports = {
  analyzeRepositoryLanguages,
  summarizeLanguages,
};

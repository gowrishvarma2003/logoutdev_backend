const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeLanguages } = require('../src/services/repos/repoLanguage');

test('summarizeLanguages selects the largest detected language by bytes', () => {
  const summary = summarizeLanguages([
    { type: 'blob', path: 'src/index.ts', size: 120 },
    { type: 'blob', path: 'src/App.tsx', size: 80 },
    { type: 'blob', path: 'server/app.py', size: 500 },
    { type: 'blob', path: 'README.md', size: 1000 },
  ]);

  assert.equal(summary.language, 'Python');
  assert.deepEqual(summary.languages.map((language) => language.name), ['Python', 'TypeScript']);
});

test('summarizeLanguages ignores vendor, generated, binary, and unknown files', () => {
  const summary = summarizeLanguages([
    { type: 'blob', path: 'node_modules/pkg/index.js', size: 2000 },
    { type: 'blob', path: 'dist/bundle.js', size: 2000 },
    { type: 'blob', path: 'public/logo.svg', size: 2000 },
    { type: 'blob', path: 'package-lock.json', size: 2000 },
    { type: 'blob', path: 'src/page.jsx', size: 300 },
    { type: 'tree', path: 'src', size: 0 },
  ]);

  assert.equal(summary.language, 'JavaScript');
  assert.deepEqual(summary.languages, [{ name: 'JavaScript', bytes: 300, percentage: 100 }]);
});

test('summarizeLanguages returns no primary language for empty repositories', () => {
  assert.deepEqual(summarizeLanguages([]), { language: null, languages: [] });
});

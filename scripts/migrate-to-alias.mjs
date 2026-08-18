#!/usr/bin/env node

/**
 * migrate-to-alias.mjs
 *
 * Converts relative parent imports (`../`, `../../`, etc.) in `src/`
 * to the root alias `@/...`.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');
const SRC_DIR = resolve(ROOT_DIR, 'src');

function getAllFiles(dir, exts = ['.ts', '.vue', '.js', '.mjs']) {
  let files = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
      continue;
    }
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(getAllFiles(fullPath, exts));
    } else if (exts.some(ext => entry.name.endsWith(ext))) {
      files.push(fullPath);
    }
  }
  return files;
}

function convertImportsInContent(filePath, content) {
  const fileDir = dirname(filePath);
  let changed = false;

  // Matches:
  // - import ... from '...'
  // - export ... from '...'
  // - import('...')
  // with single or double quotes
  const importExportRegex =
    /((?:import|export)\s+(?:[\s\S]*?from\s+)?|import\s*\(\s*)['"](\.\.\/[^'"]+)['"](\s*\)?)/g;

  const newContent = content.replace(importExportRegex, (match, prefix, specifier, suffix) => {
    // Resolve target path
    const resolved = resolve(fileDir, specifier);
    if (resolved.startsWith(SRC_DIR)) {
      const relToSrc = relative(SRC_DIR, resolved).replaceAll('\\', '/');
      const newSpecifier = `@/${relToSrc}`;
      changed = true;
      return `${prefix}'${newSpecifier}'${suffix}`;
    }
    return match;
  });

  return { newContent, changed };
}

function main() {
  const isDryRun = process.argv.includes('--dry-run');
  const targetDir = SRC_DIR;
  const files = getAllFiles(targetDir);

  let totalFilesChanged = 0;
  let totalImportsChanged = 0;

  for (const file of files) {
    const originalContent = readFileSync(file, 'utf8');
    const { newContent, changed } = convertImportsInContent(file, originalContent);

    if (changed) {
      totalFilesChanged++;
      const count = (originalContent.match(/['"]\.\.\/[^'"]+['"]/g) || []).length;
      totalImportsChanged += count;

      if (!isDryRun) {
        writeFileSync(file, newContent, 'utf8');
      }
    }
  }

  console.log(`[migrate-to-alias] Processed ${files.length} files.`);
  console.log(
    `[migrate-to-alias] ${isDryRun ? '[DRY RUN] Would update' : 'Updated'} ${totalFilesChanged} files (${totalImportsChanged} imports).`
  );
}

main();

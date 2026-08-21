import ts from 'typescript';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, relative, dirname, basename } from 'node:path';

const ROOT = process.cwd();
const PACKS_SPELLS = join(ROOT, 'packs/riot/spells');

// Build: spellFileBase -> Set(exported names that are FACTORY-wrapped, i.e. `make<Name>` exists)
const factoryNamesOf = new Map();
for (const file of readdirSync(PACKS_SPELLS)) {
  if (!file.endsWith('.ts') || file === 'index.ts') continue;
  const base = basename(file, '.ts');
  const src = readFileSync(join(PACKS_SPELLS, file), 'utf8');
  const names = new Set();
  const re = /^export (?:default )?function (make[A-Za-z0-9_]+)\(/gm;
  let m;
  while ((m = re.exec(src))) {
    const withoutMake = m[1].slice(4);
    names.add(withoutMake);
    names.add(withoutMake[0].toLowerCase() + withoutMake.slice(1));
  }
  factoryNamesOf.set(base, names);
}

function isFactoryExport(spellBase, exportedName) {
  const names = factoryNamesOf.get(spellBase);
  if (!names) return null;
  return names.has(exportedName);
}

function relSpecifier(fromDir, toPathNoExt) {
  const r = relative(fromDir, toPathNoExt).replace(/\\/g, '/');
  return r.startsWith('.') ? r : './' + r;
}

const TEST_FILES = process.argv.slice(2);
let totalFixed = 0;

for (const testFile of TEST_FILES) {
  const fullPath = join(ROOT, testFile);
  const text = readFileSync(fullPath, 'utf8');
  const sourceFile = ts.createSourceFile(fullPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const testDir = dirname(fullPath);

  const spellImportRe = /^(\.\.\/)+src\/game\/gameObject\/spells\/([A-Za-z0-9_]+)$/;

  const toRemove = []; // {start, end} char ranges (full statement incl. trailing newline)
  const newImportLines = [];
  const apiLines = [];
  let needsApi = false;
  let matchedAny = false;

  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const specifier = stmt.moduleSpecifier.text;
    const specMatch = spellImportRe.exec(specifier);
    if (!specMatch) continue;
    matchedAny = true;
    const spellBase = specMatch[2];
    const packSpecifier = relSpecifier(testDir, join(PACKS_SPELLS, spellBase));

    const clause = stmt.importClause;
    const plainDefault = [];
    const plainNamed = [];
    const typeNamed = [];
    const factoryParts = []; // {local, exportedName}

    if (clause) {
      if (clause.name) {
        const local = clause.name.text;
        const exportedName = spellBase;
        if (isFactoryExport(spellBase, exportedName)) {
          factoryParts.push({ local, exportedName, isDefault: true });
        } else {
          plainDefault.push(local);
        }
      }
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const el of clause.namedBindings.elements) {
          const local = el.name.text;
          const exportedName = (el.propertyName || el.name).text;
          const typeOnly = clause.isTypeOnly || el.isTypeOnly;
          if (typeOnly) {
            typeNamed.push(exportedName === local ? local : `${exportedName} as ${local}`);
            continue;
          }
          if (isFactoryExport(spellBase, exportedName)) {
            factoryParts.push({ local, exportedName, isDefault: false });
          } else {
            plainNamed.push(exportedName === local ? local : `${exportedName} as ${local}`);
          }
        }
      }
    }

    if (typeNamed.length) {
      newImportLines.push(`import type { ${typeNamed.join(', ')} } from '${packSpecifier}';`);
    }
    if (plainDefault.length || plainNamed.length) {
      const namedClause = plainNamed.length ? `{ ${plainNamed.join(', ')} }` : '';
      const clauseOut = [plainDefault[0], namedClause].filter(Boolean).join(', ');
      newImportLines.push(`import ${clauseOut} from '${packSpecifier}';`);
    }
    if (factoryParts.length) {
      needsApi = true;
      const withFactoryName = factoryParts.map(p => ({
        ...p,
        factoryName: `make${p.exportedName[0].toUpperCase()}${p.exportedName.slice(1)}`,
      }));
      // A default factory and a named one can both come off the same spell
      // (`import Shaco_W, { Shaco_W_Box } from '.../Shaco_W'`) — putting the
      // default's name inside `{ }` is invalid syntax, so split them exactly
      // the way a normal mixed import clause does.
      const defaultPart = withFactoryName.find(p => p.isDefault);
      const namedParts = withFactoryName.filter(p => !p.isDefault);
      const defaultClause = defaultPart ? defaultPart.factoryName : '';
      const namedClause = namedParts.length
        ? `{ ${namedParts.map(p => p.factoryName).join(', ')} }`
        : '';
      const clause = [defaultClause, namedClause].filter(Boolean).join(', ');
      newImportLines.push(`import ${clause} from '${packSpecifier}';`);
      for (const p of withFactoryName) {
        apiLines.push(`const ${p.local} = ${p.factoryName}(__api);`);
      }
    }

    toRemove.push({ start: stmt.getFullStart(), end: stmt.getEnd() });
  }

  if (!matchedAny) continue;

  // Remove matched import statements (splice by descending offset to keep positions valid).
  let text2 = text;
  toRemove.sort((a, b) => b.start - a.start);
  for (const { start, end } of toRemove) {
    text2 = text2.slice(0, start) + text2.slice(end);
  }

  const insertion = [];
  if (needsApi) {
    const apiSpecifier = relSpecifier(testDir, join(ROOT, 'src/content/ContentApi'));
    insertion.push(`import { buildContentApi } from '${apiSpecifier}';`);
  }
  insertion.push(...newImportLines);
  if (needsApi) {
    insertion.push(`const __api = buildContentApi();`);
    insertion.push(...apiLines);
  }

  // Re-parse the trimmed file to find the last remaining top-level import, and
  // insert right after it (or at the very top if there is none left).
  const sourceFile2 = ts.createSourceFile(fullPath, text2, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let insertAt = 0;
  for (const stmt of sourceFile2.statements) {
    if (ts.isImportDeclaration(stmt)) insertAt = stmt.getEnd();
  }
  const finalText =
    text2.slice(0, insertAt) + '\n' + insertion.join('\n') + text2.slice(insertAt);

  writeFileSync(fullPath, finalText);
  totalFixed++;
  console.log(`fixed ${testFile} (${toRemove.length} spell import decl(s))`);
}

console.log(`\ntotal files fixed: ${totalFixed}`);

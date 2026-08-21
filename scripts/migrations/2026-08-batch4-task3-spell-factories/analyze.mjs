import { readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { loadSourceFile, parseTopLevel, API_MAP } from './parse.mjs';

export const SPELLS_DIR = join(process.cwd(), 'src/game/gameObject/spells');

export function listSpellFiles() {
  return readdirSync(SPELLS_DIR)
    .filter(f => f.endsWith('.ts'))
    .filter(f => f !== 'index.ts' && f !== '_EmptyExample.ts')
    .sort();
}

/** Every local name that API_MAP would resolve as a VALUE (default/named), globally. */
export function allApiValueNames() {
  const names = new Set();
  for (const entry of Object.values(API_MAP)) {
    if (entry.default) names.add('__DEFAULT__'); // handled separately by basename
    if (entry.named) for (const k of Object.keys(entry.named)) names.add(k);
  }
  return names;
}

function escapeRe(name) {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Comments (incl. `Foo.ts`-style doc references) must not feed the value heuristic. */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

export function usesAsValue(rawText, name) {
  const text = stripComments(rawText);
  const e = escapeRe(name);
  return (
    new RegExp(`\\bnew\\s+${e}\\b`).test(text) ||
    new RegExp(`\\binstanceof\\s+${e}\\b`).test(text) ||
    new RegExp(`\\bextends\\s+${e}\\b`).test(text) ||
    new RegExp(`\\b${e}\\.[A-Za-z_$]`).test(text) ||
    new RegExp(`\\b${e}\\s*\\(`).test(text) ||
    // bare reference as an argument/value (assignment rhs, passed around,
    // or the sole/last argument of a call like `hasBuff(Riven_R_Reforge)`):
    new RegExp(`[=(,\\[]\\s*${e}\\b`).test(text)
  );
}

export function mentionsIdentifier(rawText, name) {
  return new RegExp(`\\b${escapeRe(name)}\\b`).test(stripComments(rawText));
}

/** file basename without extension -> parsed {imports, decls, sourceFile, text} */
export function parseAllFiles(files) {
  const parsed = new Map();
  for (const file of files) {
    const base = basename(file, '.ts');
    const { text, sourceFile } = loadSourceFile(join(SPELLS_DIR, file));
    const { imports, decls } = parseTopLevel(sourceFile);
    parsed.set(base, { imports, decls, text, sourceFile, file });
  }
  return parsed;
}

/**
 * Build the export-classification registry: file -> name -> 'class'|'factory'|'plain'|'type'
 * via fixpoint over sibling (./X) and API value references.
 */
export function buildRegistry(parsed) {
  const registry = new Map(); // base -> Map(name -> kind)
  for (const [base, { decls }] of parsed) {
    const m = new Map();
    for (const d of decls) {
      for (const name of d.names) {
        if (d.kind === 'class') m.set(name, 'class');
        else if (d.kind === 'type') m.set(name, 'type');
        else if (d.kind === 'other') m.set(name, 'plain');
        else m.set(name, 'plain'); // var/function start plain, refined below
      }
    }
    registry.set(base, m);
  }

  // Precompute: for each file, sibling import local-name -> {siblingBase, importedName}
  const siblingImportsOf = new Map(); // base -> [{localName, siblingBase, importedName}]
  // Precompute: for each file, api-value-imported local names -> true (from API_MAP, value only)
  const apiValueLocalsOf = new Map(); // base -> Set(localName)

  for (const [base, { imports }] of parsed) {
    const siblings = [];
    const apiLocals = new Set();
    for (const imp of imports) {
      if (imp.specifier.startsWith('./') || imp.specifier.startsWith('../')) {
        const siblingBase = imp.specifier.replace(/^\.\//, '').replace(/^\.\.\//, '');
        if (imp.defaultLocal) {
          siblings.push({ localName: imp.defaultLocal, siblingBase, importedName: 'default' });
        }
        for (const n of imp.named) {
          if (!n.isTypeOnly) {
            siblings.push({ localName: n.localName, siblingBase, importedName: n.importedName });
          }
        }
        continue;
      }
      if (!imp.specifier.startsWith('@/')) continue;
      const mapping = API_MAP[imp.specifier];
      if (!mapping) continue;
      if (imp.defaultLocal && mapping.default) apiLocals.add(imp.defaultLocal);
      if (imp.namespaceLocal && mapping.namespace) apiLocals.add(imp.namespaceLocal);
      for (const n of imp.named) {
        if (!n.isTypeOnly && mapping.named && mapping.named[n.importedName]) {
          apiLocals.add(n.localName);
        }
      }
    }
    siblingImportsOf.set(base, siblings);
    apiValueLocalsOf.set(base, apiLocals);
  }

  let changed = true;
  let rounds = 0;
  while (changed && rounds < 8) {
    changed = false;
    rounds++;
    for (const [base, { decls }] of parsed) {
      const reg = registry.get(base);
      const apiLocals = apiValueLocalsOf.get(base);
      const siblings = siblingImportsOf.get(base);

      for (const d of decls) {
        if (d.kind !== 'var' && d.kind !== 'function') continue;
        for (const name of d.names) {
          if (reg.get(name) !== 'plain') continue;

          let needsFactory = false;

          for (const apiName of apiLocals) {
            if (usesAsValue(d.fullText, apiName)) {
              needsFactory = true;
              break;
            }
          }

          if (!needsFactory) {
            for (const sib of siblings) {
              const sibKind = registry.get(sib.siblingBase)?.get(
                sib.importedName === 'default'
                  ? [...(parsed.get(sib.siblingBase)?.decls || [])].find(dd => dd.isDefault)
                      ?.names[0]
                  : sib.importedName
              );
              if ((sibKind === 'class' || sibKind === 'factory') && usesAsValue(d.fullText, sib.localName)) {
                needsFactory = true;
                break;
              }
            }
          }

          if (!needsFactory) {
            for (const other of decls) {
              if (other === d) continue;
              for (const otherName of other.names) {
                const otherKind = reg.get(otherName);
                if (
                  (otherKind === 'class' || otherKind === 'factory') &&
                  usesAsValue(d.fullText, otherName)
                ) {
                  needsFactory = true;
                  break;
                }
              }
              if (needsFactory) break;
            }
          }

          if (needsFactory) {
            reg.set(name, 'factory');
            changed = true;
          }
        }
      }
    }
  }

  return { registry, siblingImportsOf, apiValueLocalsOf, rounds };
}

/** Find the exported name of a file's `default` export (class/function/var), or null. */
export function defaultExportName(decls) {
  const d = decls.find(dd => dd.isDefault);
  return d ? d.names[0] : null;
}

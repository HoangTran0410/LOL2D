import { API_MAP, CLASS_LIKE, TYPES_BARREL_SPECIFIERS, ASSET_MANAGER_SPECIFIER } from './api-map.mjs';
import { mentionsIdentifier, usesAsValue } from './analyze.mjs';
import { stronglyConnectedComponents } from './scc.mjs';

/** `make<Name>`, capitalising a camelCase function's own name after `make`. */
function factoryNameFor(name) {
  return `make${name[0].toUpperCase()}${name.slice(1)}`;
}

function apiPathToExpr(path) {
  return `api.${path}`;
}
function apiPathToContentApiType(path) {
  // 'buffs.Slow' -> "ContentApi['buffs']['Slow']"; 'Spell' -> "ContentApi['Spell']"
  return `ContentApi[${path
    .split('.')
    .map(seg => `'${seg}'`)
    .join('][')}]`;
}

function substituteAssetManager(text) {
  return text
    .replace(/\bAssetManager\.get\(/g, 'api.asset(')
    .replace(/\bAssetManager\.renderable\(/g, 'api.renderableAsset(')
    .replace(/\bAssetManager\.placeholder\(/g, 'api.asset(');
}

/** Swap an import statement's own specifier string, keeping its clause untouched. */
function rewriteImportSpecifier(importStatementText, newSpecifier) {
  return importStatementText.replace(/from\s+['"][^'"]+['"]/, `from '${newSpecifier}'`);
}

function stripLeadingExport(node, sourceFile, fullText) {
  const code = node.getText(sourceFile);
  const leadingTrivia = fullText.slice(0, fullText.length - code.length);
  const codeNoExport = code.replace(/^export\s+default\s+/, '').replace(/^export\s+/, '');
  return { leadingTrivia, codeNoExport };
}

/**
 * Build the transformed source for one spell file.
 *
 * @param base file basename (no extension)
 * @param parsedFile {imports, decls, text, sourceFile}
 * @param registry Map(base -> Map(name -> kind))
 * @param parsedAll Map(base -> parsedFile) for looking up sibling default-export names
 */
export function transformFile(base, parsedFile, registry, parsedAll) {
  const { imports, decls, sourceFile } = parsedFile;
  const reg = registry.get(base);

  // --- Classify imports ---
  const apiBindings = new Map(); // localName -> apiPath (value)
  const apiNamespaceBindings = new Map(); // localName -> apiPath (namespace import)
  const typesBarrelNames = new Set(); // names re-exported via '@/content/types'
  const siblingFactoryBindings = new Map(); // localName -> { siblingBase, factoryName }
  let usesAssetManager = false;

  // Sibling class/factory names whose only use in this file is as a bare TYPE
  // (originally `import type { X }` or a same-named `import { type X }`
  // specifier). They still need the factory function imported as a VALUE, so
  // `ReturnType<typeof makeX>` has something to name, but never a `const`
  // binding inside a factory body.
  const siblingTypeOnlyFactoryNames = new Set(); // localName

  // The four files Task 2 left transitional: `Darius_Q/W/E.ts` and `Lux_R.ts`
  // already reach `packs/riot/vfx/` by a relative path suited to their OLD
  // location (`src/game/gameObject/spells/`, four levels up). Once they move
  // to `packs/riot/spells/`, the same sibling directory is one level up. Both
  // `DariusAxe.ts` (plain functions) and `LuxBeamEffect.ts` (a plain,
  // already-`packBoundary`-clean class) pass straight through unchanged —
  // this is a path fix only, not a factory conversion.
  const pathOnlyImportLines = [];

  for (const imp of imports) {
    const vfxMatch = imp.specifier.match(/packs\/riot\/vfx\/(.+)$/);
    if (vfxMatch) {
      pathOnlyImportLines.push(rewriteImportSpecifier(imp.fullText.trim(), `../vfx/${vfxMatch[1]}`));
      continue;
    }
    if (imp.specifier === ASSET_MANAGER_SPECIFIER) {
      usesAssetManager = true;
      // `AssetHandle` is the one type real spells still name from here —
      // everything else (the class, `.get`/`.placeholder`/`.renderable`) is
      // banned from a pack outright (`packBoundary.test.ts`) and goes
      // through `api.asset`/`api.renderableAsset` via text substitution
      // instead, never an import.
      for (const n of imp.named) {
        if (n.isTypeOnly) typesBarrelNames.add(n.importedName);
      }
      continue;
    }

    if (imp.specifier.startsWith('./') || imp.specifier.startsWith('../')) {
      const siblingBase = imp.specifier.replace(/^\.\.?\//, '');
      const siblingReg = registry.get(siblingBase);
      const siblingParsed = parsedAll.get(siblingBase);

      if (imp.defaultLocal) {
        const defaultName = siblingParsed
          ? siblingParsed.decls.find(d => d.isDefault)?.names[0]
          : null;
        const kind = defaultName ? siblingReg?.get(defaultName) : null;
        if (kind === 'class' || kind === 'factory') {
          siblingFactoryBindings.set(imp.defaultLocal, {
            siblingBase,
            factoryName: factoryNameFor(defaultName),
            isClass: kind === 'class',
          });
        }
        // plain default (rare/none observed) falls through unchanged as a default import - not handled, no case found.
      }
      for (const n of imp.named) {
        const kind = siblingReg?.get(n.importedName);
        if (kind === 'class' || kind === 'factory') {
          siblingFactoryBindings.set(n.localName, {
            siblingBase,
            factoryName: factoryNameFor(n.importedName),
            isClass: kind === 'class',
          });
          // A sibling class/factory imported `type`-only here is still a
          // class the sibling file wraps now — the factory has to be
          // imported as a value so `ReturnType<typeof makeX>` resolves, but
          // this file never needs the runtime `const` binding for it.
          if (n.isTypeOnly) siblingTypeOnlyFactoryNames.add(n.localName);
          continue;
        }
        if (n.isTypeOnly) continue; // a genuine type export of the sibling: passes through unchanged
        // plain named sibling values fall through unchanged (kept in original import stmt)
      }
      continue;
    }

    if (!imp.specifier.startsWith('@/')) continue; // shouldn't happen

    if (TYPES_BARREL_SPECIFIERS.has(imp.specifier)) {
      for (const n of imp.named) {
        if (n.isTypeOnly) typesBarrelNames.add(n.importedName);
      }
      if (imp.defaultLocal && imp.clauseIsType) {
        // e.g. `import type BasicAttackController from '...'`
        typesBarrelNames.add(imp.defaultLocal);
      }
      // Fall through deliberately: `@/game/spell/runtime/types` carries both
      // type-only names (redirected to '@/content/types' above) AND real
      // values (`isChargeActivation`, `requireChargeSpec`, on ContentApi) in
      // the very same import statement for some files (e.g. Zed_W.ts). The
      // other four barrel specifiers have no API_MAP entry, so this is a
      // no-op for them.
    }

    const mapping = API_MAP[imp.specifier];
    if (!mapping) continue; // unmapped - handled above (types barrel) or should not occur

    if (imp.defaultLocal && mapping.default) {
      apiBindings.set(imp.defaultLocal, mapping.default);
    }
    if (imp.namespaceLocal && mapping.namespace) {
      apiNamespaceBindings.set(imp.namespaceLocal, mapping.namespace);
    }
    for (const n of imp.named) {
      // Not gated on `isTypeOnly`, to match the default-import handling above:
      // `import type { Rectangle } from '@/libs/quadtree'` (Lux_R.ts) needs the
      // same class-like module alias a value import gets, and the binding this
      // adds it to only ever surfaces inside a factory that actually mentions
      // the name, so a type-only import contributing one is never a live cost.
      if (mapping.named && mapping.named[n.importedName]) {
        apiBindings.set(n.localName, mapping.named[n.importedName]);
      }
    }
  }

  const allApiBindingNames = new Map([...apiBindings, ...apiNamespaceBindings]);

  // --- Which sibling imports stay as plain (unchanged) named/default imports? ---
  const plainSiblingImportLines = [];
  const typeSiblingImportLines = [];
  for (const imp of imports) {
    if (!(imp.specifier.startsWith('./') || imp.specifier.startsWith('../'))) continue;
    if (/packs\/riot\/vfx\//.test(imp.specifier)) continue; // handled via pathOnlyImportLines above
    const parts = [];
    let typeParts = [];
    if (imp.defaultLocal && !siblingFactoryBindings.has(imp.defaultLocal)) {
      parts.push(imp.defaultLocal);
    }
    for (const n of imp.named) {
      if (siblingFactoryBindings.has(n.localName)) continue; // handled via factory import, below
      if (n.isTypeOnly) {
        typeParts.push(n.importedName === n.localName ? n.localName : `${n.importedName} as ${n.localName}`);
        continue;
      }
      parts.push(n.importedName === n.localName ? n.localName : `${n.importedName} as ${n.localName}`);
    }
    if (parts.length === 1 && parts[0] === imp.defaultLocal) {
      plainSiblingImportLines.push(`import ${imp.defaultLocal} from '${imp.specifier}';`);
    } else if (parts.length) {
      const namedParts = imp.defaultLocal && parts[0] === imp.defaultLocal ? parts.slice(1) : parts;
      const hasDefault = imp.defaultLocal && !siblingFactoryBindings.has(imp.defaultLocal);
      const defaultPart = hasDefault ? `${imp.defaultLocal}` : '';
      const namedClause = namedParts.length ? `{ ${namedParts.join(', ')} }` : '';
      const clause = [defaultPart, namedClause].filter(Boolean).join(', ');
      if (clause) plainSiblingImportLines.push(`import ${clause} from '${imp.specifier}';`);
    }
    if (typeParts.length) {
      typeSiblingImportLines.push(`import type { ${typeParts.join(', ')} } from '${imp.specifier}';`);
    }
  }

  // Group factory sibling imports by siblingBase, keeping a default import
  // (a sibling's own factory, named after the file) separate from named ones
  // (another top-level class/factory in that same sibling file) so the
  // emitted `import ... from './X'` uses the right clause shape for each.
  const defaultFactoryImportsByBase = new Map(); // siblingBase -> factoryName
  const namedFactoryImportsByBase = new Map(); // siblingBase -> Set(factoryName)
  for (const [localName, { siblingBase, factoryName }] of siblingFactoryBindings) {
    const siblingParsed = parsedAll.get(siblingBase);
    const defaultName = siblingParsed ? siblingParsed.decls.find(d => d.isDefault)?.names[0] : null;
    if (defaultName && factoryNameFor(defaultName) === factoryName) {
      defaultFactoryImportsByBase.set(siblingBase, factoryName);
    } else {
      if (!namedFactoryImportsByBase.has(siblingBase)) namedFactoryImportsByBase.set(siblingBase, new Set());
      namedFactoryImportsByBase.get(siblingBase).add(factoryName);
    }
  }
  const factoryImportBases = new Set([
    ...defaultFactoryImportsByBase.keys(),
    ...namedFactoryImportsByBase.keys(),
  ]);

  // --- Module-level type aliases ---
  // Class-like ContentApi symbols mentioned anywhere (extends/instanceof/new/bare type).
  // Membership is judged by the API path's own last segment (`buffs.Root` -> `Root`),
  // not by whatever local name a spell happened to import it under (`RootBuff`) — a
  // default import can be aliased freely and the class-like-ness travels with the
  // symbol, not the spelling a given file chose for it.
  const wholeFileTextForMentions = decls.map(d => d.fullText).join('\n');
  const classLikeAliasNames = new Set();
  for (const [localName, apiPath] of apiBindings) {
    const canonicalName = apiPath.split('.').pop();
    if (CLASS_LIKE.has(canonicalName) && mentionsIdentifier(wholeFileTextForMentions, localName)) {
      classLikeAliasNames.add(localName);
    }
  }
  // Every local class this file declares gets `InstanceType<ReturnType<typeof makeX>>`
  // — pure type-level, needs no `api` value, and covers both an in-body bare-type use
  // and a plain top-level `interface`/`type` (outside any factory) naming it. A
  // *function*-shaped factory (e.g. `makeIsFrostbiteTarget`) returns a predicate, not a
  // constructor — `InstanceType<>` on it does not typecheck, and nothing in this tree
  // ever names a helper function as a bare type, so it gets no alias at all.
  const localClassNames = new Set(decls.flatMap(d => (d.kind === 'class' ? d.names : [])));
  const allLocalFactoryDeclNames = new Set(
    decls.flatMap(d => (d.kind === 'class' || reg.get(d.names[0]) === 'factory' ? d.names : []))
  );

  // --- Emit header ---
  const lines = [];
  lines.push(`import type { ContentApi } from '@/content/ContentApi';`);
  if (typesBarrelNames.size) {
    lines.push(`import type { ${[...typesBarrelNames].sort().join(', ')} } from '@/content/types';`);
  }
  for (const line of pathOnlyImportLines) lines.push(line);
  for (const line of typeSiblingImportLines) lines.push(line);
  for (const siblingBase of factoryImportBases) {
    const defaultFactory = defaultFactoryImportsByBase.get(siblingBase);
    const namedFactories = [...(namedFactoryImportsByBase.get(siblingBase) || [])].sort();
    const namedClause = namedFactories.length ? `{ ${namedFactories.join(', ')} }` : '';
    const clause = [defaultFactory, namedClause].filter(Boolean).join(', ');
    lines.push(`import ${clause} from './${siblingBase}';`);
  }
  for (const line of plainSiblingImportLines) lines.push(line);
  if (classLikeAliasNames.size || localClassNames.size) {
    lines.push('');
    for (const name of [...classLikeAliasNames].sort()) {
      const apiPath = apiBindings.get(name);
      lines.push(`type ${name} = InstanceType<${apiPathToContentApiType(apiPath)}>;`);
    }
    for (const name of [...localClassNames].sort()) {
      lines.push(`type ${name} = InstanceType<ReturnType<typeof ${factoryNameFor(name)}>>;`);
    }
    for (const [localName, { factoryName, isClass }] of siblingFactoryBindings) {
      if (!isClass) continue; // a function-shaped factory is never named as a bare type
      // Unconditional otherwise, matching the local-class treatment above: whether the
      // original import was `type`-only or a value, a sibling class may also be named
      // as a bare type somewhere in this file (a field, an `interface`, a generic arg).
      lines.push(`type ${localName} = InstanceType<ReturnType<typeof ${factoryName}>>;`);
    }
  }
  lines.push('');

  // --- Same-file mutual value cycles ---
  // `Zed_W`/`Zed_W_Clone` reference each other as real VALUES both ways
  // (`Zed_W` constructs `Zed_W_Clone`; `Zed_W_Clone` does `instanceof Zed_W`)
  // — a shape the original file supports for free (module-scope classes,
  // hoisted, no call involved), but which two *independent* factories calling
  // each other cannot: `makeZed_W` calls `makeZed_W_Clone` calls `makeZed_W`
  // forever. Any such same-file strongly-connected set of decls is merged
  // into one shared, memoized builder that defines all of them together
  // (exactly like the original module scope), and each member's own
  // `make<Name>` becomes a thin lookup into it.
  const factoryDeclList = decls.filter(
    d => d.kind === 'class' || reg.get(d.names[0]) === 'factory'
  );
  const declByName = new Map(factoryDeclList.map(d => [d.names[0], d]));
  const codeByName = new Map(
    factoryDeclList.map(d => [
      d.names[0],
      substituteAssetManager(stripLeadingExport(d.node, sourceFile, d.fullText).codeNoExport),
    ])
  );
  const sameFileGraph = new Map();
  for (const [name, code] of codeByName) {
    const refs = new Set();
    for (const otherName of codeByName.keys()) {
      if (otherName === name) continue;
      if (usesAsValue(code, otherName)) refs.add(otherName);
    }
    sameFileGraph.set(name, refs);
  }
  const components = stronglyConnectedComponents(sameFileGraph);
  const groupOf = new Map(); // declName -> groupId (only for components of size > 1)
  const groupMembers = new Map(); // groupId -> [declName, ...] in original decl order
  let groupCounter = 0;
  for (const component of components) {
    if (component.size <= 1) continue;
    const groupId = `__group${groupCounter++}_${[...component].sort()[0]}`;
    const members = factoryDeclList
      .map(d => d.names[0])
      .filter(n => component.has(n));
    groupMembers.set(groupId, members);
    for (const n of members) groupOf.set(n, groupId);
  }

  // `api.path` bindings are plain property reads — free to over-include on any
  // mention at all (an unused `const` costs nothing: this tsconfig sets
  // neither `noUnusedLocals` nor `noUnusedParameters`), which also covers a
  // value used only in an expression shape `usesAsValue` does not
  // special-case (arithmetic, a spread, a template literal). A sibling/local
  // factory *call* is not free the same way (see the cycle note above), so
  // those two use the stricter `usesAsValue` — real construction/`instanceof`
  // use only.
  function apiBindingLinesFor(codeSub) {
    const out = [];
    for (const [localName, apiPath] of allApiBindingNames) {
      if (mentionsIdentifier(codeSub, localName)) {
        out.push(`  const ${localName} = ${apiPathToExpr(apiPath)};`);
      }
    }
    return out;
  }
  function siblingBindingLinesFor(codeSub) {
    const out = [];
    for (const [localName, { factoryName }] of siblingFactoryBindings) {
      if (usesAsValue(codeSub, localName)) out.push(`  const ${localName} = ${factoryName}(api);`);
    }
    return out;
  }

  // --- Body: walk decls in order, splicing each group in at its first member ---
  const bodyChunks = [];
  const emittedGroups = new Set();

  for (const d of decls) {
    if (d.kind === 'type' || d.kind === 'other') {
      bodyChunks.push(substituteAssetManager(d.fullText));
      continue;
    }
    const kind = reg.get(d.names[0]);
    if (kind !== 'class' && kind !== 'factory') {
      bodyChunks.push(substituteAssetManager(d.fullText));
      continue;
    }

    const name = d.names[0];
    const groupId = groupOf.get(name);

    if (groupId) {
      if (emittedGroups.has(groupId)) continue; // already spliced in at an earlier member
      emittedGroups.add(groupId);
      const members = groupMembers.get(groupId);
      const groupCodes = members.map(n => codeByName.get(n));
      const combinedForBindings = groupCodes.join('\n');
      const bindingLines = [...new Set(apiBindingLinesFor(combinedForBindings))];
      const siblingLines = [...new Set(siblingBindingLinesFor(combinedForBindings))];
      // Cross-group local references (a group member using a *non-member*
      // local factory as a value) still go through the normal call — no
      // cycle risk there, since the callee never calls back into this group.
      const crossGroupLines = [];
      for (const otherName of allLocalFactoryDeclNames) {
        if (members.includes(otherName)) continue;
        if (usesAsValue(combinedForBindings, otherName)) {
          crossGroupLines.push(`  const ${otherName} = ${factoryNameFor(otherName)}(api);`);
        }
      }
      const builderName = `${groupId}Builder`;
      const cacheName = `${groupId}Cache`;
      const memberDefs = members
        .map(n => {
          const { leadingTrivia } = stripLeadingExport(declByName.get(n).node, sourceFile, declByName.get(n).fullText);
          return `${leadingTrivia}${indent(codeByName.get(n))}`;
        })
        .join('\n');
      // A memoizing wrapper whose cache is typed off its own return would be
      // circular (`ReturnType<typeof makeZed_W>` needs the builder; the
      // builder's own inferred return depends on what the cache holds — an
      // unbreakable cycle TypeScript reports as TS7022/7023). Splitting
      // "compute" from "memoize" breaks it without widening anything to
      // `any`: `${buildName}`'s return type is inferred purely from its own
      // body (the local classes it just defined are in scope, nothing about
      // it references the cache), so the cache and the thin wrapper around
      // it can both reference *that* function's return type cleanly.
      const buildName = `${groupId}Build`;
      bodyChunks.push(
        [
          `// ${members.join(' / ')} reference each other as real values both ways —`,
          `// see this file's own header comment on the codemod's cycle handling.`,
          `function ${buildName}(api: ContentApi) {`,
          ...bindingLines,
          ...siblingLines,
          ...crossGroupLines,
          memberDefs,
          `  return { ${members.join(', ')} };`,
          `}`,
          `const ${cacheName} = new WeakMap<ContentApi, ReturnType<typeof ${buildName}>>();`,
          `function ${builderName}(api: ContentApi) {`,
          `  const cached = ${cacheName}.get(api);`,
          `  if (cached) return cached;`,
          `  const built = ${buildName}(api);`,
          `  ${cacheName}.set(api, built);`,
          `  return built;`,
          `}`,
        ].join('\n')
      );
      for (const memberName of members) {
        const memberDecl = declByName.get(memberName);
        const exportKeyword = memberDecl.isDefault ? 'export default' : 'export';
        bodyChunks.push(
          `${exportKeyword} function ${factoryNameFor(memberName)}(api: ContentApi) {\n  return ${builderName}(api).${memberName};\n}`
        );
      }
      continue;
    }

    // Wrap into a standalone, memoized factory (the common case: no same-file
    // cycle). Memoized for the same reason every `ContentApi` object is a
    // cached singleton (`buildContentApi()`'s own doc comment: "one core in
    // the process"): a bare `class X extends api.Spell {}` inside a function
    // body is a NEW class object on every call, so two independent
    // resolutions of the same id with the same `api` — the real registry's
    // dynamic import and a test building its own comparison value, say —
    // used to get two `instanceof`-incompatible `Lux_Q`s. Split exactly like
    // the same-file-cycle groups above: `__build<Name>`'s return type is
    // inferred purely from its own body (no self-reference), so the cache
    // and the memoizing wrapper around it both stay fully typed.
    const { leadingTrivia, codeNoExport } = stripLeadingExport(d.node, sourceFile, d.fullText);
    const codeSub = substituteAssetManager(codeNoExport);

    const bindingLines = [...apiBindingLinesFor(codeSub), ...siblingBindingLinesFor(codeSub)];
    for (const otherName of allLocalFactoryDeclNames) {
      if (otherName === name) continue;
      if (usesAsValue(codeSub, otherName)) {
        bindingLines.push(`  const ${otherName} = ${factoryNameFor(otherName)}(api);`);
      }
    }
    const uniqueBindingLines = [...new Set(bindingLines)];

    const buildName = `__build${name}`;
    const cacheName = `__cache${name}`;
    const exportKeyword = d.isDefault ? 'export default' : 'export';
    bodyChunks.push(
      [
        `${leadingTrivia}function ${buildName}(api: ContentApi) {`,
        ...uniqueBindingLines,
        indent(codeSub),
        `  return ${name};`,
        `}`,
        `const ${cacheName} = new WeakMap<ContentApi, ReturnType<typeof ${buildName}>>();`,
        `${exportKeyword} function ${factoryNameFor(name)}(api: ContentApi) {`,
        `  const cached = ${cacheName}.get(api);`,
        `  if (cached) return cached;`,
        `  const built = ${buildName}(api);`,
        `  ${cacheName}.set(api, built);`,
        `  return built;`,
        `}`,
      ].join('\n')
    );
  }

  return lines.join('\n') + '\n' + bodyChunks.join('\n');
}

function indent(text) {
  return text
    .split('\n')
    .map(l => (l.length ? '  ' + l : l))
    .join('\n');
}

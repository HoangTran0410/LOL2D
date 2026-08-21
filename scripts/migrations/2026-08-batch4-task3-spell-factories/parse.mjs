import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { API_MAP, ASSET_MANAGER_SPECIFIER, TYPES_BARREL_SPECIFIERS } from './api-map.mjs';

export function loadSourceFile(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return { text, sourceFile };
}

function modifiersOf(node) {
  return ts.canHaveModifiers(node) ? ts.getModifiers(node) || [] : [];
}

function isExported(node) {
  return modifiersOf(node).some(m => m.kind === ts.SyntaxKind.ExportKeyword);
}
function isDefaultExport(node) {
  return modifiersOf(node).some(m => m.kind === ts.SyntaxKind.DefaultKeyword);
}

/** Parse all top-level statements of a file into { imports, decls }. */
export function parseTopLevel(sourceFile) {
  const imports = [];
  const decls = [];

  for (const stmt of sourceFile.statements) {
    if (ts.isImportDeclaration(stmt)) {
      imports.push(parseImport(stmt, sourceFile));
      continue;
    }

    const fullText = stmt.getFullText(sourceFile);

    if (ts.isClassDeclaration(stmt)) {
      const name = stmt.name ? stmt.name.text : null;
      const extendsClause = (stmt.heritageClauses || []).find(
        h => h.token === ts.SyntaxKind.ExtendsKeyword
      );
      const baseText = extendsClause ? extendsClause.types[0].getText(sourceFile) : null;
      decls.push({
        kind: 'class',
        names: name ? [name] : [],
        isDefault: isDefaultExport(stmt),
        isExported: isExported(stmt),
        fullText,
        node: stmt,
        baseText,
      });
      continue;
    }

    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      decls.push({
        kind: 'function',
        names: [stmt.name.text],
        isDefault: isDefaultExport(stmt),
        isExported: isExported(stmt),
        fullText,
        node: stmt,
      });
      continue;
    }

    if (ts.isVariableStatement(stmt)) {
      const names = stmt.declarationList.declarations
        .map(d => (ts.isIdentifier(d.name) ? d.name.text : null))
        .filter(Boolean);
      decls.push({
        kind: 'var',
        names,
        isDefault: false,
        isExported: isExported(stmt),
        fullText,
        node: stmt,
      });
      continue;
    }

    if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) {
      decls.push({
        kind: 'type',
        names: [stmt.name.text],
        isDefault: false,
        isExported: isExported(stmt),
        fullText,
        node: stmt,
      });
      continue;
    }

    // Anything else (rare): keep as an opaque, always-plain statement.
    decls.push({ kind: 'other', names: [], isDefault: false, isExported: false, fullText, node: stmt });
  }

  return { imports, decls };
}

function parseImport(stmt, sourceFile) {
  const specifier = stmt.moduleSpecifier.text;
  const clauseIsType = !!stmt.importClause?.isTypeOnly;
  const clause = stmt.importClause;
  const fullText = stmt.getFullText(sourceFile);

  const result = {
    specifier,
    fullText,
    node: stmt,
    clauseIsType,
    defaultLocal: null,
    namespaceLocal: null,
    named: [], // {importedName, localName, isTypeOnly}
  };

  if (!clause) return result; // side-effect only import, none expected here

  if (clause.name) result.defaultLocal = clause.name.text;

  if (clause.namedBindings) {
    if (ts.isNamespaceImport(clause.namedBindings)) {
      result.namespaceLocal = clause.namedBindings.name.text;
    } else if (ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) {
        result.named.push({
          importedName: (el.propertyName || el.name).text,
          localName: el.name.text,
          isTypeOnly: clauseIsType || el.isTypeOnly,
        });
      }
    }
  }

  return result;
}

export { API_MAP, ASSET_MANAGER_SPECIFIER, TYPES_BARREL_SPECIFIERS };

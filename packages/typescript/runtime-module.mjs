import { SyntaxKind } from '@typescript/native/ast';
import {
  isBindingElement,
  isBreakStatement,
  isContinueStatement,
  isEnumMember,
  isExportSpecifier,
  isGetAccessorDeclaration,
  isIdentifier,
  isImportDeclaration,
  isImportSpecifier,
  isLabeledStatement,
  isMethodDeclaration,
  isMethodSignatureDeclaration,
  isNamedImports,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isPropertyDeclaration,
  isPropertySignatureDeclaration,
  isQualifiedName,
  isSetAccessorDeclaration,
  isShorthandPropertyAssignment,
  isSourceFile,
  isVariableDeclaration,
  isVariableStatement,
} from '@typescript/native/ast/is';
import { API } from '@typescript/native/sync';
import { dirname, join, relative } from 'node:path';

/**
 * @sdk-it/runtime as one module: its files joined in import order without their
 * import declarations and `export` keywords, and every place a top-level binding
 * (a declaration, or a name imported from a package) or a global is used. A
 * one-module SDK declares the runtime in the same scope as spec names, so a
 * render renames each binding a spec name takes and qualifies each global a
 * spec name shadows. The shape is `RuntimeModule` in global.d.ts.
 *
 * @param {string} tsconfigPath the runtime's tsconfig.lib.json
 */
export function runtimeModule(tsconfigPath) {
  const api = new API();
  try {
    const parsed = api.parseConfigFile(tsconfigPath);
    const sourceRoot = join(dirname(tsconfigPath), 'src');
    const fileNames = parsed.fileNames.filter(
      (fileName) => relative(sourceRoot, fileName) !== 'index.ts',
    );
    const program = api.createProgram(fileNames, parsed.options);
    const project = program.getProject();
    const files = new Map(
      fileNames.map((fileName) => [
        fileName,
        readFile(
          program.getSourceFile(fileName),
          relative(sourceRoot, fileName),
        ),
      ]),
    );
    const runtimePaths = new Set(
      [...files.values()].map(({ source }) => source.path),
    );
    const bindings = new Map();
    const globals = new Map();
    const chunks = [];
    let offset = 0;

    for (const fileName of importOrder(files)) {
      const file = files.get(fileName);
      for (const declared of file.declared) {
        const other = bindings.get(declared.name);
        if (other && other.file !== declared.file) {
          throw new Error(
            `runtime-module: ${declared.file} and ${other.file} both declare ${declared.name}`,
          );
        }
        bindings.set(declared.name, {
          ...declared,
          occurrences: [],
          shorthands: [],
        });
      }
      const at = (node) =>
        offset + mapPosition(node.getStart(file.source), file.edits);
      visit(file.source, (node) => {
        if (!isIdentifier(node) || !isReference(node)) return;
        const shorthand =
          isShorthandPropertyAssignment(node.parent) &&
          node.parent.name === node;
        const symbol = shorthand
          ? project.checker.getShorthandAssignmentValueSymbol(node.parent)
          : project.checker.getSymbolAtLocation(node);
        if (!symbol || symbol.declarations.length === 0) return;
        const declaration = symbol.declarations.find(({ path }) =>
          runtimePaths.has(path),
        );
        if (!declaration) {
          const entry = globals.getOrInsertComputed(node.text, (name) => ({
            name,
            occurrences: [],
          }));
          entry.occurrences.push(at(node));
          return;
        }
        const key = bindingKey(symbol.name, declaration.resolve(project));
        if (!key) return;
        const entry = bindings.getOrInsertComputed(key, () => ({
          kind: 'external',
          name: symbol.name,
          module: key.slice(0, key.lastIndexOf('#')),
          occurrences: [],
          shorthands: [],
        }));
        (shorthand ? entry.shorthands : entry.occurrences).push(at(node));
      });
      const text = applyDeletions(file.text, file.edits);
      chunks.push(text);
      offset += text.length + 1;
    }

    return {
      text: chunks.join('\n'),
      bindings: [...bindings.values()],
      globals: [...globals.values()],
    };
  } finally {
    api.close();
  }
}

/**
 * The key of the top-level binding a reference resolves to: the declared name,
 * or `<package>#<name>` for a name imported from a package. Undefined for a
 * local binding.
 */
function bindingKey(name, declaration) {
  if (isImportSpecifier(declaration)) {
    const module = declaration.parent.parent.parent.moduleSpecifier.text;
    return module.startsWith('.') ? name : `${module}#${name}`;
  }
  const statement = isVariableDeclaration(declaration)
    ? declaration.parent.parent
    : declaration;
  return isSourceFile(statement.parent) ? name : undefined;
}

/** The file's text, its top-level declarations, and the ranges a joined module drops. */
function readFile(source, file) {
  const text = source.text;
  const imports = [];
  const edits = [];
  const declared = [];
  for (const statement of source.statements) {
    if (isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (
        clause?.name ||
        (clause?.namedBindings && !isNamedImports(clause.namedBindings)) ||
        clause?.namedBindings?.elements.some((element) => element.propertyName)
      ) {
        throw new Error(
          `runtime-module: ${file} must import by unaliased names only`,
        );
      }
      imports.push(statement.moduleSpecifier.text);
      edits.push([statement.pos, statement.end]);
      continue;
    }
    if (statement.kind === SyntaxKind.ExportDeclaration) {
      throw new Error(`runtime-module: ${file} must not re-export`);
    }
    const exportKeyword = statement.modifiers?.find(
      (modifier) => modifier.kind === SyntaxKind.ExportKeyword,
    );
    for (const name of declaredNames(statement, file)) {
      declared.push({
        kind: 'declared',
        name,
        file,
        exported: Boolean(exportKeyword),
        type:
          statement.kind === SyntaxKind.InterfaceDeclaration ||
          statement.kind === SyntaxKind.TypeAliasDeclaration,
      });
    }
    if (exportKeyword) {
      const start = exportKeyword.getStart(source);
      if (text.slice(start, start + 'export '.length) !== 'export ') {
        throw new Error(
          `runtime-module: ${file} must write one space after export`,
        );
      }
      edits.push([start, start + 'export '.length]);
    }
  }
  return { source, text, imports, edits, declared };
}

function declaredNames(statement, file) {
  if (isVariableStatement(statement)) {
    return statement.declarationList.declarations.map(({ name }) => {
      if (!isIdentifier(name)) {
        throw new Error(
          `runtime-module: ${file} must declare top-level variables by name`,
        );
      }
      return name.text;
    });
  }
  return statement.name ? [statement.name.text] : [];
}

/** Files ordered so each comes after the files it imports. */
function importOrder(files) {
  const order = [];
  const state = new Map();
  const place = (fileName, path) => {
    if (state.get(fileName) === 'placed') return;
    if (state.get(fileName) === 'visiting') {
      throw new Error(
        `runtime-module: import cycle ${[...path, fileName].join(' -> ')}`,
      );
    }
    state.set(fileName, 'visiting');
    for (const specifier of files.get(fileName).imports) {
      if (specifier.startsWith('.')) {
        place(join(dirname(fileName), specifier), [...path, fileName]);
      }
    }
    state.set(fileName, 'placed');
    order.push(fileName);
  };
  for (const fileName of [...files.keys()].sort()) place(fileName, []);
  return order;
}

/** Whether `node` names a binding: not a property, member or label name. */
function isReference(node) {
  const parent = node.parent;
  if (isPropertyAccessExpression(parent)) return parent.name !== node;
  if (isQualifiedName(parent)) return parent.right !== node;
  if (
    isPropertyAssignment(parent) ||
    isPropertyDeclaration(parent) ||
    isPropertySignatureDeclaration(parent) ||
    isMethodDeclaration(parent) ||
    isMethodSignatureDeclaration(parent) ||
    isGetAccessorDeclaration(parent) ||
    isSetAccessorDeclaration(parent) ||
    isEnumMember(parent)
  ) {
    return parent.name !== node;
  }
  if (isBindingElement(parent)) return parent.propertyName !== node;
  if (isImportSpecifier(parent) || isExportSpecifier(parent)) return false;
  return !(
    isLabeledStatement(parent) ||
    isBreakStatement(parent) ||
    isContinueStatement(parent)
  );
}

function visit(node, callback) {
  callback(node);
  node.forEachChild((child) => visit(child, callback));
}

function applyDeletions(text, deletions) {
  let result = '';
  let cursor = 0;
  for (const [start, end] of deletions) {
    result += text.slice(cursor, start);
    cursor = end;
  }
  return result + text.slice(cursor);
}

function mapPosition(position, deletions) {
  let shift = 0;
  for (const [start, end] of deletions) {
    if (end > position) break;
    shift += end - start;
  }
  return position - shift;
}

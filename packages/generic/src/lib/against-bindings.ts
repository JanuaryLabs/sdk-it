import {
  type Expression,
  type Identifier,
  type ImportDeclaration,
  type Node,
  type SourceFile,
  SyntaxKind,
} from '@typescript/native/ast';
import {
  isIdentifier,
  isImportDeclaration,
  isImportSpecifier,
  isNamespaceImport,
  isPropertyAccessExpression,
  isQualifiedName,
  isShorthandPropertyAssignment,
  isSourceFile,
  isStringLiteral,
} from '@typescript/native/ast/is';
import {
  type Checker,
  SymbolFlags,
  type Symbol as TsSymbol,
  formatDiagnostics,
} from '@typescript/native/sync';
import { pathToFileURL } from 'node:url';

import type { AgainstBinding, ZodEvaluator } from '@sdk-it/core';
import { nodeLocation } from '@sdk-it/core/deriver.js';
import type { AnalysisProgram } from '@sdk-it/core/program.js';

const againstRule =
  'An against may read only z, the import * as <name> namespaces of its route file (such as inputs.*) and the named imports analyze() allows (allowedNamedImports). Write the schema inline.';

interface AgainstContext {
  operation: string;
  input: string;
}

/** A binding an `against` reads that does not resolve or load. */
export class UnloadedImportError extends Error {
  readonly binding: AgainstBinding;
  constructor(message: string, binding: AgainstBinding, cause: unknown) {
    super(message, { cause });
    this.name = 'UnloadedImportError';
    this.binding = binding;
  }
}

/**
 * The bindings of their route files that `against` expressions read: `z`
 * stays out, since the ZodEvaluator binds it to zod itself; an `import * as
 * <name>` namespace and a named import of an allowed export are read from
 * their module; any other binding of the user's modules is refused, since the
 * ZodEvaluator evaluates the expression text alone.
 */
export class AgainstBindings {
  #allowedNamedImports: ReadonlySet<string>;
  #read = new Map<
    string,
    {
      binding: AgainstBinding;
      declaration: ImportDeclaration;
      /** The import as the route file writes it: `$Enums` or `* as inputs`. */
      imported: string;
      /** The module specifier as the route file writes it. */
      from: string;
      /**
       * The file the program reads for that module, when TypeScript resolves
       * it: a referenced project's source in place of its built declarations.
       */
      module: SourceFile | undefined;
    }
  >();

  constructor(allowedNamedImports: readonly string[]) {
    this.#allowedNamedImports = new Set(allowedNamedImports);
  }

  /** The bindings `expression` reads, failing on one it may not read. */
  of(
    expression: Expression,
    typeChecker: Checker,
    context: AgainstContext,
  ): AgainstBinding[] {
    const fileName = expression.getSourceFile().fileName;
    const referrer = pathToFileURL(fileName).href;
    const bindings = new Map<string, AgainstBinding>();
    const isOwnDeclaration = (declaration: Node) =>
      declaration.getSourceFile().fileName === fileName &&
      declaration.pos >= expression.pos &&
      declaration.end <= expression.end;
    const read = (
      node: Identifier,
      declaration: ImportDeclaration,
      imported: { label: string; property?: string },
    ) => {
      if (!isStringLiteral(declaration.moduleSpecifier)) {
        return false;
      }
      const module = typeChecker
        .getSymbolAtLocation(declaration.moduleSpecifier)
        ?.valueDeclaration?.resolve();
      const binding: AgainstBinding = {
        import: node.text,
        // A source file TypeScript resolved, which Node may not resolve by
        // the same specifier (an import without its extension).
        specifier:
          module && isSourceFile(module) && !module.isDeclarationFile
            ? pathToFileURL(module.fileName).href
            : declaration.moduleSpecifier.text,
        referrer,
        ...(imported.property === undefined
          ? {}
          : { property: imported.property }),
      };
      bindings.set(node.text, binding);
      this.#read.set(JSON.stringify([referrer, node.text]), {
        binding,
        declaration,
        imported: imported.label,
        from: declaration.moduleSpecifier.text,
        module: module && isSourceFile(module) ? module : undefined,
      });
      return true;
    };
    const check = (node: Identifier, symbol: TsSymbol | undefined): void => {
      if (node.text === 'z' || bindings.has(node.text)) {
        return;
      }
      const declarations: Node[] | undefined = symbol?.declarations.flatMap(
        (handle) => handle.resolve() ?? [],
      );
      const imported = declarations?.find(
        (declaration) => declaration.getSourceFile().fileName === fileName,
      );
      if (imported && isNamespaceImport(imported)) {
        const declaration = imported.parent.parent;
        if (
          isImportDeclaration(declaration) &&
          read(node, declaration, { label: `* as ${node.text}` })
        ) {
          return;
        }
      }
      if (imported && isImportSpecifier(imported)) {
        const declaration = imported.parent.parent.parent;
        const property = (imported.propertyName ?? imported.name).text;
        if (
          isImportDeclaration(declaration) &&
          this.#allowedNamedImports.has(property) &&
          !imported.isTypeOnly &&
          declaration.importClause?.phaseModifier !== SyntaxKind.TypeKeyword &&
          read(node, declaration, { label: property, property })
        ) {
          return;
        }
      }
      const isGlobal =
        symbol !== undefined &&
        !(symbol.flags & SymbolFlags.Alias) &&
        declarations?.every(
          (declaration) => declaration.getSourceFile().isDeclarationFile,
        );
      if (isGlobal || declarations?.every(isOwnDeclaration)) {
        return;
      }
      throw new Error(
        `${context.operation} input ${context.input}: against reads ${node.text}, which is neither z nor a namespace it is given. ${againstRule}\n  at ${nodeLocation(node) ?? fileName}`,
      );
    };
    const collect = (node: Node): void => {
      if (isPropertyAccessExpression(node)) {
        collect(node.expression);
        return;
      }
      if (isQualifiedName(node)) {
        collect(node.left);
        return;
      }
      if (isShorthandPropertyAssignment(node) && isIdentifier(node.name)) {
        check(node.name, typeChecker.getShorthandAssignmentValueSymbol(node));
        return;
      }
      if (isIdentifier(node)) {
        check(node, typeChecker.getSymbolAtLocation(node));
        return;
      }
      node.forEachChild(collect);
    };
    collect(expression);
    return [...bindings.values()];
  }

  /**
   * Resolves and loads every binding an `against` reads, before any `against`
   * is evaluated, failing on the first that does not load, naming its route
   * file and import, with TypeScript's errors for that import.
   */
  async load(evaluator: ZodEvaluator, program: AnalysisProgram) {
    for (const {
      binding,
      declaration,
      imported,
      from,
      module,
    } of this.#read.values()) {
      try {
        await evaluator.load([
          {
            import: binding.import,
            from: await evaluator.resolve(binding.specifier, binding.referrer),
            ...(binding.property === undefined
              ? {}
              : { property: binding.property }),
          },
        ]);
      } catch (error) {
        const fileName = declaration.getSourceFile().fileName;
        throw new UnloadedImportError(
          `${fileName} imports ${imported} from '${from}', which an against reads, but it does not load: ${(Error.isError(error) ? error.message : String(error)).split('\n')[0]}${typeScriptReports(program, declaration, module)}`,
          binding,
          error,
        );
      }
    }
  }
}

/**
 * TypeScript's errors for an import that does not load: those on the import
 * itself, and each module the imported module's file cannot find (as a
 * generated client that a package re-exports).
 */
function typeScriptReports(
  program: AnalysisProgram,
  declaration: ImportDeclaration,
  module: SourceFile | undefined,
): string {
  const fileName = declaration.getSourceFile().fileName;
  const diagnostics = [
    ...program
      .getSemanticDiagnostics(fileName)
      .filter(
        (diagnostic) =>
          diagnostic.pos < declaration.end && diagnostic.end > declaration.pos,
      ),
    ...(module
      ? program
          .getSemanticDiagnostics(module.fileName)
          .filter((diagnostic) => diagnostic.code === 2307)
      : []),
  ];
  return diagnostics.length
    ? `\nTypeScript reports:\n${formatDiagnostics(diagnostics, program).trimEnd()}`
    : '';
}

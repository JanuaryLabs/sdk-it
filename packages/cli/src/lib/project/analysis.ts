import {
  type SourceFile,
  type Statement,
  SyntaxKind,
} from '@typescript/native/ast';
import {
  isImportDeclaration,
  isNamedImports,
  isStringLiteral,
} from '@typescript/native/ast/is';
import { formatDiagnostics } from '@typescript/native/sync';
import { createRequire } from 'node:module';

import { type InjectImport } from '@sdk-it/core';
import { defaultTypesMap } from '@sdk-it/core/deriver.js';
import {
  type AnalysisProject,
  openAnalysisProject,
  sourceFiles,
} from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer as honoResponseAnalyzer } from '@sdk-it/hono';

import type { ProjectConfig } from './config.ts';

export async function analyzeProject(tsconfig: string, config: ProjectConfig) {
  using project = openAnalysisProject(tsconfig);
  const framework = resolveFramework(project, config.framework);
  if (framework === 'auto') {
    throw new Error(
      `Could not detect a supported framework from ${config.tsconfig}. Set framework to 'hono' to select it explicitly.`,
    );
  }

  const prisma = config.preset === 'none' ? undefined : detectPrisma(project);
  if (config.preset === 'prisma' && !prisma) {
    throw new Error(
      `Prisma preset was requested, but no Prisma client import was found in ${tsconfig}. Run prisma generate or set preset to 'none'.`,
    );
  }

  const { paths, components } = await analyze(project, {
    responseAnalyzer: honoResponseAnalyzer,
    securitySchemes: config.securitySchemes,
    middlewareSecurity: config.middlewareSecurity,
    ...(prisma
      ? {
          imports: prisma.imports,
          typesMap: { ...defaultTypesMap, Decimal: 'string' },
        }
      : {}),
  });

  return {
    openapi: '3.1.0' as const,
    info: {
      title: 'API',
      version: '0.0.0',
    },
    paths,
    components,
  };
}

function resolveFramework(
  project: AnalysisProject,
  configured: ProjectConfig['framework'],
): 'hono' | 'auto' {
  return configured === undefined || configured === 'auto'
    ? detectFramework(project)
    : configured;
}

function detectFramework(project: AnalysisProject): 'hono' | 'auto' {
  for (const sourceFile of sourceFiles(project.program)) {
    for (const statement of sourceFile.statements) {
      if (
        isImportDeclaration(statement) &&
        isStringLiteral(statement.moduleSpecifier) &&
        (statement.moduleSpecifier.text === 'hono' ||
          statement.moduleSpecifier.text.startsWith('@sdk-it/hono'))
      ) {
        return 'hono';
      }
    }
  }
  return 'auto';
}

/**
 * The `Prisma` and `$Enums` bindings that route files import by name, from
 * `@prisma/client`, a custom generated-client path or a package that
 * re-exports one, each loaded the way an `against` loads it. A binding that
 * does not load fails here, before any `against` reads it.
 */
function detectPrisma(
  project: AnalysisProject,
): { imports: InjectImport[] } | undefined {
  let detected = false;
  const imports: InjectImport[] = [];
  for (const sourceFile of sourceFiles(project.program)) {
    for (const statement of sourceFile.statements) {
      const prismaImport = getPrismaImport(statement);
      if (!prismaImport) continue;
      detected = true;
      const { moduleSpecifier, bindings } = prismaImport;
      const require = createRequire(sourceFile.fileName);
      for (const { imported, local, isTypeOnly } of bindings) {
        // A type-only binding has no value for an against to read.
        if (isTypeOnly) continue;
        let from: string;
        try {
          from = require.resolve(moduleSpecifier.text);
          if (!(imported in require(from))) {
            throw new Error(`the module does not export ${imported}`);
          }
        } catch (error) {
          throw new Error(
            `${sourceFile.fileName} imports ${imported} from '${moduleSpecifier.text}', which an against may read, but it does not load: ${(Error.isError(error) ? error.message : String(error)).split('\n')[0]}${typeScriptReports(project, sourceFile, prismaImport)}\nRun the Prisma client's generate target (prisma generate) before sdk-it generate.`,
            { cause: error },
          );
        }
        if (
          !imports.some((item) => item.import === local && item.from === from)
        ) {
          imports.push({ import: local, from, property: imported });
        }
      }
    }
  }
  for (const from of new Set(imports.map((item) => item.from))) {
    console.log(`SDKIT: detected Prisma from ${from}`);
  }
  return detected ? { imports } : undefined;
}

/**
 * TypeScript's errors for an import that does not load: those on the import
 * itself, and each module the imported file cannot find (as a generated
 * client that a package re-exports).
 */
function typeScriptReports(
  project: AnalysisProject,
  sourceFile: SourceFile,
  { statement, moduleSpecifier }: PrismaImport,
): string {
  const program = project.program;
  const resolved = program.getResolvedModuleFromModuleSpecifier(
    moduleSpecifier,
    sourceFile.fileName,
  )?.resolvedFileName;
  const diagnostics = [
    ...program
      .getSemanticDiagnostics(sourceFile.fileName)
      .filter(
        (diagnostic) =>
          diagnostic.pos < statement.end && diagnostic.end > statement.pos,
      ),
    ...(resolved
      ? program
          .getSemanticDiagnostics(resolved)
          .filter((diagnostic) => diagnostic.code === 2307)
      : []),
  ];
  return diagnostics.length
    ? `\nTypeScript reports:\n${formatDiagnostics(diagnostics, program).trimEnd()}`
    : '';
}

type PrismaImport = NonNullable<ReturnType<typeof getPrismaImport>>;

function getPrismaImport(statement: Statement) {
  if (
    !isImportDeclaration(statement) ||
    !isStringLiteral(statement.moduleSpecifier) ||
    !statement.importClause?.namedBindings ||
    !isNamedImports(statement.importClause.namedBindings)
  ) {
    return undefined;
  }
  const bindings = statement.importClause.namedBindings.elements
    .map((element) => ({
      imported: element.propertyName?.text ?? element.name.text,
      local: element.name.text,
      isTypeOnly:
        statement.importClause?.phaseModifier === SyntaxKind.TypeKeyword ||
        element.isTypeOnly,
    }))
    .filter(({ imported }) => imported === 'Prisma' || imported === '$Enums');
  return bindings.length > 0
    ? { statement, moduleSpecifier: statement.moduleSpecifier, bindings }
    : undefined;
}

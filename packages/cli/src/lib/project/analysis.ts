import {
  isImportDeclaration,
  isNamedImports,
  isStringLiteral,
} from '@typescript/native/ast/is';

import { defaultTypesMap } from '@sdk-it/core/deriver.js';
import {
  type AnalysisProject,
  openAnalysisProject,
  sourceFiles,
} from '@sdk-it/core/program.js';
import { UnloadedImportError, analyze } from '@sdk-it/generic';
import { responseAnalyzer as honoResponseAnalyzer } from '@sdk-it/hono';

import type { ProjectConfig } from './config.ts';

/** The exports of a generated Prisma client that an `against` may read. */
const prismaBindings = ['$Enums', 'Prisma'];

export async function analyzeProject(tsconfig: string, config: ProjectConfig) {
  using project = openAnalysisProject(tsconfig);
  const framework = resolveFramework(project, config.framework);
  if (framework === 'auto') {
    throw new Error(
      `Could not detect a supported framework from ${config.tsconfig}. Set framework to 'hono' to select it explicitly.`,
    );
  }

  const prisma = config.preset !== 'none' && importsPrisma(project);
  if (config.preset === 'prisma' && !prisma) {
    throw new Error(
      `Prisma preset was requested, but no Prisma client import was found in ${tsconfig}. Run prisma generate or set preset to 'none'.`,
    );
  }

  let analysis: Awaited<ReturnType<typeof analyze>>;
  try {
    analysis = await analyze(project, {
      responseAnalyzer: honoResponseAnalyzer,
      securitySchemes: config.securitySchemes,
      middlewareSecurity: config.middlewareSecurity,
      ...(prisma
        ? {
            allowedNamedImports: prismaBindings,
            typesMap: { ...defaultTypesMap, Decimal: 'string' },
          }
        : {}),
    });
  } catch (error) {
    if (
      prisma &&
      error instanceof UnloadedImportError &&
      error.binding.property !== undefined &&
      prismaBindings.includes(error.binding.property)
    ) {
      throw new Error(
        `${error.message}\nRun the Prisma client's generate target (prisma generate) before sdk-it generate.`,
        { cause: error },
      );
    }
    throw error;
  }
  const { paths, components } = analysis;

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

/** Whether a source file imports `Prisma` or `$Enums` by name. */
function importsPrisma(project: AnalysisProject): boolean {
  return sourceFiles(project.program).some((sourceFile) =>
    sourceFile.statements.some(
      (statement) =>
        isImportDeclaration(statement) &&
        statement.importClause?.namedBindings !== undefined &&
        isNamedImports(statement.importClause.namedBindings) &&
        statement.importClause.namedBindings.elements.some((element) =>
          prismaBindings.includes((element.propertyName ?? element.name).text),
        ),
    ),
  );
}

import type { Statement } from '@typescript/native/ast';
import {
  isImportDeclaration,
  isNamedImports,
  isStringLiteral,
} from '@typescript/native/ast/is';
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
          typesMap: {
            ...defaultTypesMap,
            Decimal: 'string',
          },
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

function detectPrisma(
  project: AnalysisProject,
): { imports: InjectImport[] } | undefined {
  const imports: InjectImport[] = [];
  const reportedModules = new Set<string>();
  for (const sourceFile of sourceFiles(project.program)) {
    for (const statement of sourceFile.statements) {
      const prismaImport = getPrismaImport(statement);
      if (!prismaImport) continue;
      const resolvedModule =
        project.program.getResolvedModuleFromModuleSpecifier(
          prismaImport.moduleSpecifier,
          sourceFile.fileName,
        );
      if (!resolvedModule) continue;

      let runtimeModule: string;
      try {
        runtimeModule = createRequire(sourceFile.fileName).resolve(
          prismaImport.moduleSpecifier.text,
        );
      } catch {
        continue;
      }

      if (!reportedModules.has(runtimeModule)) {
        console.log(`SDKIT: detected Prisma from ${runtimeModule}`);
        reportedModules.add(runtimeModule);
      }
      for (const { imported, local } of prismaImport.bindings) {
        if (
          !imports.some(
            (item) => item.import === local && item.from === runtimeModule,
          )
        ) {
          imports.push({
            import: local,
            from: runtimeModule,
            property: imported,
          });
        }
      }
    }
  }
  return imports.length > 0 ? { imports } : undefined;
}

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
    }))
    .filter(({ imported }) => imported === 'Prisma' || imported === '$Enums');
  return bindings.length > 0
    ? {
        moduleSpecifier: statement.moduleSpecifier,
        bindings,
      }
    : undefined;
}

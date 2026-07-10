import { createRequire } from 'node:module';
import ts from 'typescript';

import { type InjectImport, defaultTypesMap, getProgram } from '@sdk-it/core';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer as honoResponseAnalyzer } from '@sdk-it/hono';

import type { ProjectConfig } from './config.ts';

export async function analyzeProject(tsconfig: string, config: ProjectConfig) {
  const framework = resolveFramework(tsconfig, config.framework);
  if (framework === 'auto') {
    throw new Error(
      `Could not detect a supported framework from ${config.tsconfig}. Set framework to 'hono' to select it explicitly.`,
    );
  }

  const prisma = config.preset === 'none' ? undefined : detectPrisma(tsconfig);
  if (config.preset === 'prisma' && !prisma) {
    throw new Error(
      `Prisma preset was requested, but no Prisma client import was found in ${tsconfig}. Run prisma generate or set preset to 'none'.`,
    );
  }

  const { paths, components } = await analyze(tsconfig, {
    responseAnalyzer: honoResponseAnalyzer,
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
  tsconfig: string,
  configured: ProjectConfig['framework'],
): 'hono' | 'auto' {
  return configured === undefined || configured === 'auto'
    ? detectFramework(tsconfig)
    : configured;
}

function detectFramework(tsconfig: string): 'hono' | 'auto' {
  const program = getProgram(tsconfig);
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    for (const statement of sourceFile.statements) {
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
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
  tsconfig: string,
): { imports: InjectImport[] } | undefined {
  const program = getProgram(tsconfig);
  const imports: InjectImport[] = [];
  const reportedModules = new Set<string>();
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    for (const statement of sourceFile.statements) {
      const prismaImport = getPrismaImport(statement);
      if (!prismaImport) continue;
      const resolvedModule = ts.resolveModuleName(
        prismaImport.moduleSpecifier,
        sourceFile.fileName,
        program.getCompilerOptions(),
        ts.sys,
      );
      if (!resolvedModule.resolvedModule) continue;

      let runtimeModule: string;
      try {
        runtimeModule = createRequire(sourceFile.fileName).resolve(
          prismaImport.moduleSpecifier,
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

function getPrismaImport(statement: ts.Statement):
  | {
      moduleSpecifier: string;
      bindings: Array<{ imported: string; local: string }>;
    }
  | undefined {
  if (
    !ts.isImportDeclaration(statement) ||
    !ts.isStringLiteral(statement.moduleSpecifier) ||
    !statement.importClause?.namedBindings ||
    !ts.isNamedImports(statement.importClause.namedBindings)
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
    ? { moduleSpecifier: statement.moduleSpecifier.text, bindings }
    : undefined;
}

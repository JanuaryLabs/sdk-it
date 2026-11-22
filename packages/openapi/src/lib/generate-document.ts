import { isImportDeclaration, isNamedImports } from '@typescript/native/ast/is';
import { fileURLToPath } from 'node:url';
import type { OpenAPIObject, TagObject } from 'openapi3-ts/oas31';

import { methods } from '@sdk-it/core';
import {
  type AnalysisProject,
  openAnalysisProject,
  sourceFiles,
} from '@sdk-it/core/program.js';
import { UnloadedImportError, analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';

import type { OpenApiDefinition } from './definition.ts';

/** The exports of a generated Prisma client that an `against` may read. */
const prismaBindings = ['$Enums', 'Prisma'];

export interface GeneratedDocument {
  document: OpenAPIObject;
  /** Every file of the backend's program outside node_modules: a change to one can change the document. */
  sourceFiles: string[];
}

/**
 * A route file imports `Prisma` or `$Enums` from a Prisma client that does
 * not load, which is a client nobody generated.
 */
export class PrismaClientNotGeneratedError extends Error {
  readonly routeFile: string;
  readonly importName: string;
  constructor(
    message: string,
    routeFile: string,
    importName: string,
    cause: unknown,
  ) {
    super(message, { cause });
    this.name = 'PrismaClientNotGeneratedError';
    this.routeFile = routeFile;
    this.importName = importName;
  }
}

/** The backend's OpenAPI document, from its definition. Writes nothing. */
export async function generateDocument(
  definition: OpenApiDefinition,
): Promise<GeneratedDocument> {
  using project = openAnalysisProject(fileURLToPath(definition.tsconfig));
  const prisma = importsPrisma(project);
  let analysis: Awaited<ReturnType<typeof analyze>>;
  try {
    analysis = await analyze(project, {
      responseAnalyzer,
      types: {
        ...(prisma ? { Decimal: { type: 'string' } } : {}),
        ...definition.types,
      },
      allowedNamedImports: [
        ...(prisma ? prismaBindings : []),
        ...(definition.allowedNamedImports ?? []),
      ],
      ...(definition.middlewareSecurity
        ? {
            middlewareSecurity: definition.middlewareSecurity.map((rule) => ({
              ...rule,
              middleware: {
                import: rule.middleware.import,
                from: fileURLToPath(rule.middleware.from),
              },
            })),
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
      throw new PrismaClientNotGeneratedError(
        `${error.message}\nRun the Prisma client's generate target (prisma generate).`,
        error.binding.referrer,
        error.binding.property,
        error,
      );
    }
    throw error;
  }

  const base = structuredClone(definition.document);
  const document: OpenAPIObject = {
    ...base,
    tags: tagObjects(base.tags ?? [], analysis.tags),
    paths: analysis.paths,
    components: { ...base.components, schemas: analysis.components.schemas },
  };
  for (const transformer of definition.transformers?.operation ?? []) {
    for (const [path, item] of Object.entries(document.paths ?? {})) {
      for (const method of methods) {
        const operation = item[method];
        if (operation) {
          await transformer(operation, { method, path, document });
        }
      }
    }
  }
  for (const transformer of definition.transformers?.document ?? []) {
    await transformer(document);
  }

  return {
    document,
    sourceFiles: Array.from(
      sourceFiles(project.program),
      (file) => file.fileName,
    ).filter((fileName) => !fileName.includes('/node_modules/')),
  };
}

/** A tag object for each tag the base declares or an operation names, the base's first. */
function tagObjects(declared: TagObject[], named: string[]): TagObject[] {
  const known = new Set(declared.map((tag) => tag.name));
  return [
    ...declared,
    ...named.filter((name) => !known.has(name)).map((name) => ({ name })),
  ];
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

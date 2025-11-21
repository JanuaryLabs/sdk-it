import debug from 'debug';
import type { ComponentsObject } from 'openapi3-ts/oas31';
import { camelcase } from 'stringcase';
import ts from 'typescript';

import {
  type InjectImport,
  type NaunceResponseAnalyzer,
  type OnOperation,
  Paths,
  type ResponseAnalyzerFn,
  type ResponseItem,
  type Selector,
  type SemanticSource,
  TypeDeriver,
  getProgram,
  isCallExpression,
  isHttpMethod,
  toSchema,
} from '@sdk-it/core';

/**
 * Gets the file path from a symbol's first declaration
 */
function symbolFile(symbol: ts.Symbol | undefined): string | undefined {
  if (!symbol) {
    return undefined;
  }

  const declarations = symbol.declarations ?? [];
  if (declarations.length === 0) {
    return undefined;
  }

  const sourceFile = declarations[0].getSourceFile();
  return sourceFile?.fileName;
}

/**
 * Determines if a symbol is from an external library (node_modules)
 */
function isExternalFunction(symbol: ts.Symbol | undefined): boolean {
  const fileName = symbolFile(symbol);
  return fileName ? fileName.includes('node_modules') : false;
}

/**
 * Determines if a symbol refers to a local function (not from node_modules)
 */
function isLocalFunction(symbol: ts.Symbol | undefined): boolean {
  if (!symbol) {
    return false;
  }

  return !isExternalFunction(symbol);
}

export const returnTokens = (
  node: ts.Node,
  typeChecker?: ts.TypeChecker,
  options?: { consider3rdParty?: boolean; maxDepth?: number },
) => {
  const tokens: { token: string; node: ts.Expression }[] = [];
  const consider3rdParty = options?.consider3rdParty ?? false;
  const maxDepth = options?.maxDepth ?? 5;
  // Track visited function declarations to prevent infinite recursion
  const visitedFunctions = new Set<ts.Declaration>();

  const visitor = (node: ts.Node, depth: number): void => {
    // Skip if we've exceeded max depth
    if (depth > maxDepth) {
      return;
    }

    if (ts.isThrowStatement(node)) {
      if (ts.isNewExpression(node.expression)) {
        tokens.push({
          token: `throw.new.${node.expression.expression.getText()}`,
          node: node.expression,
        });
      }
    }

    if (ts.isReturnStatement(node) && node.expression) {
      if (ts.isCallExpression(node.expression)) {
        tokens.push({
          token: node.expression.expression.getText(),
          node: node.expression,
        });
      }
      // Continue traversing into the returned expression (e.g., arrow functions)
      // This handles: return async (c, next) => { throw ... }
      ts.forEachChild(node.expression, (child) => visitor(child, depth));
      return;
    }

    // If we encounter a call expression and have a type checker, follow it
    if (ts.isCallExpression(node) && typeChecker && depth < maxDepth) {
      const callExpression = node;

      // Try to resolve the function being called
      let symbol: ts.Symbol | undefined;

      if (ts.isIdentifier(callExpression.expression)) {
        symbol = typeChecker.getSymbolAtLocation(callExpression.expression);
      } else if (ts.isPropertyAccessExpression(callExpression.expression)) {
        symbol = typeChecker.getSymbolAtLocation(
          callExpression.expression.name,
        );
      }

      // Resolve aliases
      if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
        symbol = typeChecker.getAliasedSymbol(symbol);
      }

      // Check if we should follow this function
      const shouldFollow = consider3rdParty || isLocalFunction(symbol);

      if (shouldFollow && symbol) {
        const declarations = symbol?.declarations ?? [];

        for (const declaration of declarations) {
          // Skip if we've already visited this function (prevent infinite recursion)
          if (visitedFunctions.has(declaration)) {
            continue;
          }

          if (isFunctionWithBody(declaration) && declaration.body) {
            visitedFunctions.add(declaration);
            // Recursively visit the function body with incremented depth
            visitor(declaration.body, depth + 1);
          }
        }
      }
    }

    ts.forEachChild(node, (child) => visitor(child, depth));
  };

  visitor(node, 0);
  return tokens;
};

const logger = debug('@sdk-it/generic');

const jsDocsTags = [
  'openapi',
  'tags',
  'description',
  'summary',
  'access',
  'tool',
  'toolDescription',
] as const;
type JSDocsTags = (typeof jsDocsTags)[number];

function parseJSDocComment(node: ts.Node) {
  let tags: string[] = [];
  let name = '';
  let description = '';
  let summary = '';
  let access = '';
  let tool = '';
  let toolDescription = '';

  for (const tag of ts.getAllJSDocTags(node, (tag): tag is ts.JSDocTag =>
    jsDocsTags.includes(tag.tagName.text as JSDocsTags),
  )) {
    if (typeof tag.comment !== 'string') {
      continue;
    }
    switch (tag.tagName.text as JSDocsTags) {
      case 'openapi':
        name = tag.comment;
        break;
      case 'tags':
        tags = tag.comment.split(',').map((tag) => tag.trim());
        break;
      case 'description':
        description = tag.comment;
        break;
      case 'summary':
        summary = tag.comment;
        break;
      case 'access':
        access = tag.comment.trim().toLowerCase();
        break;
      case 'tool':
        tool = tag.comment.trim();
        break;
      case 'toolDescription':
        toolDescription = tag.comment.trim();
        break;
    }
  }
  return {
    name,
    tags,
    description,
    access,
    tool,
    toolDescription,
    summary,
  };
}

function visit(
  node: ts.Node,
  responseAnalyzer: (
    handler: ts.ArrowFunction | ts.FunctionExpression,
    token: string,
    node: ts.Node,
  ) => ResponseItem[],
  paths: Paths,
  typeChecker: ts.TypeChecker,
) {
  if (!ts.isCallExpression(node) || node.arguments.length < 2) {
    return moveOn();
  }
  if (
    !ts.isPropertyAccessExpression(node.expression) ||
    !ts.isIdentifier(node.expression.name) ||
    !isHttpMethod(node.expression.name.text)
  ) {
    return moveOn();
  }

  const [pathNode] = node.arguments;
  if (!ts.isStringLiteral(pathNode)) {
    return moveOn();
  }
  const method = node.expression.name.text;
  const path = pathNode.text;
  const validate = node.arguments.find((arg) =>
    isCallExpression(arg, 'validate'),
  );
  if (!validate) {
    return moveOn();
  }
  const handler = node.arguments.at(-1);
  if (!handler || !ts.isArrowFunction(handler)) {
    return moveOn();
  }
  const metadata = parseJSDocComment(node.parent);
  // Skip endpoints marked as private access
  if (metadata.access === 'private') {
    return moveOn();
  }
  const operationName =
    metadata.name ||
    camelcase(`${method} ${path.replace(/[^a-zA-Z0-9]/g, '')}`);
  if (!validate.arguments.length) {
    return moveOn();
  }

  let selector: ts.Expression | undefined;
  let contentType: ts.Expression | undefined;
  if (validate.arguments.length === 2) {
    contentType = validate.arguments[0];
    selector = validate.arguments[1];
  } else {
    selector = validate.arguments[0];
  }
  if (!ts.isArrowFunction(selector)) {
    return moveOn();
  }
  if (
    !selector ||
    !ts.isParenthesizedExpression(selector.body) ||
    !ts.isObjectLiteralExpression(selector.body.expression)
  ) {
    return moveOn();
  }

  // Collect all middleware declarations for analysis
  const middlewareDeclarations: ts.Node[] = [];

  // slice(1, -1) to skip first (path) and last (handler) arguments
  // and skip the validate middleware - it's handled separately
  for (const arg of node.arguments.slice(1, -1)) {
    if (ts.isCallExpression(arg)) {
      // Try to resolve the factory function declaration
      if (ts.isIdentifier(arg.expression)) {
        let symbol = typeChecker.getSymbolAtLocation(arg.expression);

        // If symbol has alias, resolve to the actual symbol
        if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
          symbol = typeChecker.getAliasedSymbol(symbol);
        }

        const allDeclarations = [
          symbol?.valueDeclaration,
          ...(symbol?.declarations ?? []),
        ].filter((it) => !!it);

        let declaration = allDeclarations.find(isFunctionWithBody);

        // If not found, check for variable declarations with function initializers
        if (!declaration) {
          for (const decl of allDeclarations) {
            if (ts.isVariableDeclaration(decl) && decl.initializer) {
              if (isFunctionWithBody(decl.initializer)) {
                declaration = decl.initializer;
                break;
              }
            }
          }
        }

        if (declaration) {
          middlewareDeclarations.push(declaration);
        }
      }

      // Also check if the call expression argument itself is an arrow function
      // e.g., middleware((ctx) => {...})
      // But skip if the function name is 'validate'
      if (
        ts.isIdentifier(arg.expression) &&
        arg.expression.text === 'validate'
      ) {
        continue;
      }
      const firstArg = arg.arguments[0];
      if (isFunctionWithBody(firstArg)) {
        middlewareDeclarations.push(firstArg);
      }
    }
  }

  const props = selector.body.expression.properties.filter(
    ts.isPropertyAssignment,
  );

  const sourceFile = node.getSourceFile();

  const responses: ResponseItem[] = [];

  // Analyze all middlewares for potential responses
  for (const middlewareDecl of middlewareDeclarations) {
    for (const { token, node } of returnTokens(middlewareDecl, typeChecker)) {
      responses.push(...responseAnalyzer(middlewareDecl as any, token, node));
    }
  }

  // Analyze the main handler for responses
  for (const { token, node } of returnTokens(handler, typeChecker)) {
    responses.push(...responseAnalyzer(handler, token, node));
  }

  paths.addPath(
    operationName,
    path,
    method,
    contentType
      ? ts.isStringLiteral(contentType)
        ? contentType.text
        : undefined
      : undefined,
    toSelectors(props),
    responses,
    sourceFile.fileName,
    metadata,
  );

  function moveOn() {
    ts.forEachChild(node, (node) =>
      visit(node, responseAnalyzer, paths, typeChecker),
    );
  }
}

function toSelectors(props: ts.PropertyAssignment[]) {
  const selectors: Selector[] = [];
  for (const prop of props) {
    if (!ts.isObjectLiteralExpression(prop.initializer)) {
      continue;
    }
    const name = prop.name.getText();
    const select = prop.initializer.properties
      .filter(ts.isPropertyAssignment)
      .find((prop) => prop.name.getText() === 'select');
    if (!select) {
      console.warn(`No select found in ${name}`);
      continue;
    }
    const against = prop.initializer.properties
      .filter(ts.isPropertyAssignment)
      .find((prop) => prop.name.getText() === 'against');
    if (!against) {
      console.warn(`No against found in ${name}`);
      continue;
    }
    const [, source, selectText] = select.initializer.getText().split('.');
    selectors.push({
      name: selectText,
      against: against.initializer.getText(),
      source: source as SemanticSource,
    });
  }
  return selectors;
}

export async function analyze(
  tsconfigPath: string,
  config: {
    /**
     * Additional code to inject before resolving zod schemas
     */
    imports?: InjectImport[];
    typesMap?: Record<string, string>;
    responseAnalyzer: ResponseAnalyzerFn | NaunceResponseAnalyzer;
    onOperation?: OnOperation;
  },
) {
  logger(`Parsing tsconfig`);
  const program = getProgram(tsconfigPath);
  logger(`Program created`);
  const typeChecker = program.getTypeChecker();

  logger(`Type checker created`);
  const typeDeriver = new TypeDeriver(typeChecker, config.typesMap);
  const paths = new Paths({
    imports: config.imports ?? [],
    onOperation: config.onOperation,
  });

  for (const sourceFile of program.getSourceFiles()) {
    logger(`Analyzing ${sourceFile.fileName}`);
    if (!sourceFile.isDeclarationFile) {
      logger(`Visiting ${sourceFile.fileName}`);
      visit(
        sourceFile,
        (handler, token, node) => {
          const responseAnalyzer = config.responseAnalyzer;
          if (typeof responseAnalyzer !== 'function') {
            const naunce =
              responseAnalyzer[token] || responseAnalyzer['default'];
            if (!naunce) {
              throw new Error(`No response analyzer for token ${token}`);
            }
            return naunce(handler, typeDeriver, node);
          }
          return responseAnalyzer(handler, typeDeriver);
        },
        paths,
        typeChecker,
      );
    }
  }

  const components: ComponentsObject = {
    schemas: Object.entries(typeDeriver.collector).reduce(
      (acc, [key, value]) => ({ ...acc, [key]: toSchema(value) }),
      {},
    ),
  };

  return {
    paths: await paths.getPaths(),
    tags: paths.getTags(),
    components,
  };
}

export type Serialized = ReturnType<typeof analyze>;

function isFunctionWithBody(
  node: ts.Node | ts.Declaration | undefined,
): node is ts.FunctionLikeDeclaration & { body: ts.Block | ts.Expression } {
  if (!node) {
    return false;
  }
  return (
    (ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessor(node) ||
      ts.isSetAccessor(node)) &&
    !!node.body
  );
}

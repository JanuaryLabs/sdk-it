import debug from 'debug';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SecurityRequirementObject } from 'openapi3-ts/oas31';
import { camelcase } from 'stringcase';
import ts from 'typescript';

import {
  type InjectImport,
  type NaunceResponseAnalyzer,
  type OnOperation,
  type OpenAPIComponentsObject,
  type OpenAPISecuritySchemeObject,
  Paths,
  type ResponseAnalyzerFn,
  type ResponseItem,
  type Selector,
  type SemanticSource,
  TypeDeriver,
  getProgram,
  isCallExpression,
  isHttpMethod,
  nodeLocation,
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

export interface MiddlewareSecurityRule {
  middleware: {
    import: string;
    from: string;
  };
  security: SecurityRequirementObject[];
  values?: {
    scheme: string;
    argument: number;
    mode: 'any' | 'all';
  };
}

function resolvedSymbol(
  expression: ts.LeftHandSideExpression,
  typeChecker: ts.TypeChecker,
) {
  const location = ts.isPropertyAccessExpression(expression)
    ? expression.name
    : expression;
  const symbol = typeChecker.getSymbolAtLocation(location);
  return symbol && symbol.flags & ts.SymbolFlags.Alias
    ? typeChecker.getAliasedSymbol(symbol)
    : symbol;
}

/**
 * Symlinked working directories (macOS `/tmp` -> `/private/tmp`) and Windows
 * drive-letter casing make two spellings of the same file compare unequal.
 */
function realPath(path: string) {
  const resolved = resolve(path);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function matchesMiddleware(
  symbol: ts.Symbol | undefined,
  middleware: MiddlewareSecurityRule['middleware'],
) {
  if (symbol?.name !== middleware.import) {
    return false;
  }
  const from = realPath(middleware.from);
  return (symbol.declarations ?? []).some(
    (declaration) => realPath(declaration.getSourceFile().fileName) === from,
  );
}

interface SecurityAnalysis {
  rules: readonly MiddlewareSecurityRule[];
  matched: Set<MiddlewareSecurityRule>;
}

function middlewareSecurity(
  args: readonly ts.Expression[],
  security: SecurityAnalysis,
  typeChecker: ts.TypeChecker,
): SecurityRequirementObject[] {
  let requirements: SecurityRequirementObject[] | undefined;
  for (const arg of args) {
    const call = ts.isCallExpression(arg) ? arg : undefined;
    const reference = call ? call.expression : arg;
    if (
      !ts.isIdentifier(reference) &&
      !ts.isPropertyAccessExpression(reference)
    ) {
      continue;
    }
    const symbol = resolvedSymbol(reference, typeChecker);
    const rule = security.rules.find(({ middleware }) =>
      matchesMiddleware(symbol, middleware),
    );
    if (!rule) {
      continue;
    }
    security.matched.add(rule);
    if (rule.values && !call) {
      throw new TypeError(
        `Security middleware ${rule.middleware.import} must be called so argument ${rule.values.argument} can be read\n  at ${nodeLocation(arg) ?? 'unknown'}`,
      );
    }
    const requirement =
      rule.values && call
        ? securityWithValues(call, rule, rule.values, typeChecker)
        : structuredClone(rule.security);
    requirements = requirements
      ? andSecurity(requirements, requirement)
      : requirement;
  }
  return requirements ?? [];
}

function securityWithValues(
  call: ts.CallExpression,
  rule: MiddlewareSecurityRule,
  valuesConfig: NonNullable<MiddlewareSecurityRule['values']>,
  typeChecker: ts.TypeChecker,
) {
  const expression = call.arguments[valuesConfig.argument];
  if (!expression) {
    throw new TypeError(
      `Security middleware ${rule.middleware.import} requires argument ${valuesConfig.argument}`,
    );
  }
  const resolved = constantStrings(expression, typeChecker);
  if (!resolved) {
    throw new TypeError(
      `Could not statically resolve security values at ${nodeLocation(expression) ?? 'unknown'}`,
    );
  }
  if (resolved.length === 0) {
    return structuredClone(rule.security);
  }
  const values = [...new Set(resolved)];
  return rule.security.flatMap((requirement) => {
    const existing = requirement[valuesConfig.scheme];
    if (!existing) {
      throw new TypeError(
        `Security scheme ${valuesConfig.scheme} is not present in the middleware requirement`,
      );
    }
    if (valuesConfig.mode === 'all') {
      return [
        {
          ...structuredClone(requirement),
          [valuesConfig.scheme]: [...new Set([...existing, ...values])],
        },
      ];
    }
    return values.map((value) => ({
      ...structuredClone(requirement),
      [valuesConfig.scheme]: [...new Set([...existing, value])],
    }));
  });
}

function constantStrings(
  expression: ts.Expression,
  typeChecker: ts.TypeChecker,
  visited = new Set<ts.Declaration>(),
): string[] | undefined {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    expression = expression.expression;
  }
  if (ts.isStringLiteralLike(expression)) {
    return [expression.text];
  }
  if (ts.isArrayLiteralExpression(expression)) {
    const result: string[] = [];
    for (const element of expression.elements) {
      if (ts.isOmittedExpression(element)) {
        continue;
      }
      const values = constantStrings(
        ts.isSpreadElement(element) ? element.expression : element,
        typeChecker,
        visited,
      );
      if (!values) {
        return undefined;
      }
      result.push(...values);
    }
    return result;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const value = typeChecker.getConstantValue(expression);
    if (typeof value === 'string') {
      return [value];
    }
  }
  if (
    ts.isIdentifier(expression) ||
    ts.isPropertyAccessExpression(expression)
  ) {
    const symbol = resolvedSymbol(expression, typeChecker);
    for (const declaration of symbol?.declarations ?? []) {
      // `visited` tracks the current recursion path, not everything ever seen,
      // so the same constant can be referenced more than once in one expression.
      if (visited.has(declaration)) {
        continue;
      }
      visited.add(declaration);
      try {
        if (
          (ts.isVariableDeclaration(declaration) ||
            ts.isEnumMember(declaration)) &&
          declaration.initializer
        ) {
          const values = constantStrings(
            declaration.initializer,
            typeChecker,
            visited,
          );
          if (values) {
            return values;
          }
        }
      } finally {
        visited.delete(declaration);
      }
    }
  }
  return undefined;
}

function andSecurity(
  left: SecurityRequirementObject[],
  right: SecurityRequirementObject[],
) {
  const combined = left.flatMap((leftRequirement) =>
    right.map((rightRequirement) => {
      const requirement = structuredClone(leftRequirement);
      for (const [scheme, values] of Object.entries(rightRequirement)) {
        requirement[scheme] = [
          ...new Set([...(requirement[scheme] ?? []), ...values]),
        ];
      }
      return requirement;
    }),
  );
  return [
    ...new Map(
      combined.map((requirement) => [requirementKey(requirement), requirement]),
    ).values(),
  ];
}

/**
 * Scheme and value order carry no meaning in a security requirement, so the
 * identity key has to ignore both.
 */
function requirementKey(requirement: SecurityRequirementObject) {
  return JSON.stringify(
    Object.keys(requirement)
      .sort()
      .map((scheme) => [scheme, [...requirement[scheme]].sort()]),
  );
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
      if (ts.isNewExpression(node.expression)) {
        tokens.push({
          token: `new.${node.expression.expression.getText()}`,
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
  typeDeriver: TypeDeriver,
  security?: SecurityAnalysis,
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
  const middlewareDeclarations: { node: ts.Node; name?: string }[] = [];

  // slice(1, -1) to skip first (path) and last (handler) arguments
  // and skip the validate middleware - it's handled separately
  for (const arg of node.arguments.slice(1, -1)) {
    if (ts.isCallExpression(arg)) {
      // Try to resolve the factory function declaration
      if (ts.isIdentifier(arg.expression)) {
        const middlewareFnName = arg.expression.text;
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
          middlewareDeclarations.push({
            node: declaration,
            name: middlewareFnName,
          });
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
        middlewareDeclarations.push({ node: firstArg });
      }
    }
  }

  const props = selector.body.expression.properties.filter(
    ts.isPropertyAssignment,
  );

  const sourceFile = node.getSourceFile();

  typeDeriver.setTrace({
    file: sourceFile.fileName,
    operation: `${method.toUpperCase()} ${path}`,
  });

  const responses: ResponseItem[] = [];

  // Analyze all middlewares for potential responses
  for (const middleware of middlewareDeclarations) {
    for (const { token, node } of returnTokens(middleware.node, typeChecker)) {
      const items = responseAnalyzer(middleware.node as any, token, node);
      if (middleware.name) {
        for (const item of items) {
          item.middlewareName = middleware.name;
        }
      }
      responses.push(...items);
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
    {
      ...metadata,
      security: security
        ? middlewareSecurity(node.arguments.slice(1, -1), security, typeChecker)
        : undefined,
    },
  );

  function moveOn() {
    ts.forEachChild(node, (node) =>
      visit(node, responseAnalyzer, paths, typeChecker, typeDeriver, security),
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
      console.warn(
        `\u26a0 No select found in ${name}\n  at ${nodeLocation(prop) ?? 'unknown'}`,
      );
      continue;
    }
    const against = prop.initializer.properties
      .filter(ts.isPropertyAssignment)
      .find((prop) => prop.name.getText() === 'against');
    if (!against) {
      console.warn(
        `\u26a0 No against found in ${name}\n  at ${nodeLocation(prop) ?? 'unknown'}`,
      );
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
    securitySchemes?: Record<string, OpenAPISecuritySchemeObject>;
    middlewareSecurity?: readonly MiddlewareSecurityRule[];
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
  const security: SecurityAnalysis | undefined = config.middlewareSecurity && {
    rules: config.middlewareSecurity,
    matched: new Set(),
  };

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
        typeDeriver,
        security,
      );
    }
  }

  for (const rule of security?.rules ?? []) {
    if (!security?.matched.has(rule)) {
      console.warn(
        `⚠ Security middleware ${rule.middleware.import} from ${rule.middleware.from} matched no route\n  routes it protects are documented as public`,
      );
    }
  }

  const components: OpenAPIComponentsObject = {
    schemas: {
      ...paths.getSharedSchemas(),
      ...Object.entries(typeDeriver.collector).reduce(
        (acc, [key, value]) => ({ ...acc, [key]: toSchema(value) }),
        {},
      ),
    },
    securitySchemes: config.securitySchemes,
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

import {
  type ArrowFunction,
  type Block,
  type CallExpression,
  type Expression,
  type FunctionExpression,
  type FunctionLikeDeclaration,
  type JSDocTag,
  type LeftHandSideExpression,
  type Node,
  NodeFlags,
  type PropertyAssignment,
  getAllJSDocTags,
  getTextOfJSDocComment,
} from '@typescript/native/ast';
import {
  isArrayLiteralExpression,
  isArrowFunction,
  isAsExpression,
  isCallExpression as isCall,
  isConstructorDeclaration,
  isEnumMember,
  isFunctionDeclaration,
  isFunctionExpression,
  isGetAccessorDeclaration,
  isIdentifier,
  isMethodDeclaration,
  isNamespaceImport,
  isNewExpression,
  isNonNullExpression,
  isObjectLiteralExpression,
  isOmittedExpression,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isReturnStatement,
  isSatisfiesExpression,
  isSetAccessorDeclaration,
  isSpreadElement,
  isStringLiteral,
  isStringLiteralLikeNode,
  isThrowStatement,
  isTypeAssertion,
  isVariableDeclaration,
  isVariableDeclarationList,
} from '@typescript/native/ast/is';
import {
  type Checker,
  SymbolFlags,
  type Symbol as TsSymbol,
} from '@typescript/native/sync';
import debug from 'debug';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SecurityRequirementObject } from 'openapi3-ts/oas31';
import { camelcase } from 'stringcase';

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
  isHttpMethod,
  toSchema,
} from '@sdk-it/core';
import { TypeDeriver, nodeLocation } from '@sdk-it/core/deriver.js';
import {
  type AnalysisProject,
  isCallExpression,
  sourceFiles,
} from '@sdk-it/core/program.js';

/**
 * Determines if a symbol refers to a local function (not from node_modules)
 */
function isLocalFunction(symbol: TsSymbol): boolean {
  const fileName = symbol.declarations[0]?.resolve()?.getSourceFile().fileName;
  return !fileName?.includes('node_modules');
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
  expression: LeftHandSideExpression,
  typeChecker: Checker,
) {
  const location = isPropertyAccessExpression(expression)
    ? expression.name
    : expression;
  const symbol = typeChecker.getSymbolAtLocation(location);
  return symbol && symbol.flags & SymbolFlags.Alias
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
  symbol: TsSymbol | undefined,
  middleware: MiddlewareSecurityRule['middleware'],
) {
  if (symbol?.name !== middleware.import) {
    return false;
  }
  const from = realPath(middleware.from);
  return symbol.declarations.some((handle) => {
    const fileName = handle.resolve()?.getSourceFile().fileName;
    return fileName !== undefined && realPath(fileName) === from;
  });
}

interface SecurityAnalysis {
  rules: readonly MiddlewareSecurityRule[];
  matched: Set<MiddlewareSecurityRule>;
}

function middlewareSecurity(
  args: readonly Expression[],
  security: SecurityAnalysis,
  typeChecker: Checker,
): SecurityRequirementObject[] {
  let requirements: SecurityRequirementObject[] | undefined;
  for (const arg of args) {
    const call = isCall(arg) ? arg : undefined;
    const reference = call ? call.expression : arg;
    if (!isIdentifier(reference) && !isPropertyAccessExpression(reference)) {
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
  call: CallExpression,
  rule: MiddlewareSecurityRule,
  valuesConfig: NonNullable<MiddlewareSecurityRule['values']>,
  typeChecker: Checker,
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
  expression: Expression,
  typeChecker: Checker,
  visited = new Set<Node>(),
): string[] | undefined {
  while (
    isParenthesizedExpression(expression) ||
    isAsExpression(expression) ||
    isTypeAssertion(expression) ||
    isSatisfiesExpression(expression) ||
    isNonNullExpression(expression)
  ) {
    expression = expression.expression;
  }
  if (isStringLiteralLikeNode(expression)) {
    return [expression.text];
  }
  if (isArrayLiteralExpression(expression)) {
    const result: string[] = [];
    for (const element of expression.elements) {
      if (isOmittedExpression(element)) {
        continue;
      }
      const values = constantStrings(
        isSpreadElement(element) ? element.expression : element,
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
  if (isPropertyAccessExpression(expression)) {
    const value = typeChecker.getConstantValue(expression);
    if (typeof value === 'string') {
      return [value];
    }
  }
  if (isIdentifier(expression) || isPropertyAccessExpression(expression)) {
    const symbol = resolvedSymbol(expression, typeChecker);
    for (const handle of symbol?.declarations ?? []) {
      const declaration = handle.resolve();
      // `visited` tracks the current recursion path, not everything ever seen,
      // so the same constant can be referenced more than once in one expression.
      if (!declaration || visited.has(declaration)) {
        continue;
      }
      visited.add(declaration);
      try {
        if (
          (isVariableDeclaration(declaration) || isEnumMember(declaration)) &&
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

function returnTokens(node: Node, typeChecker: Checker) {
  const tokens: { token: string; node: Expression }[] = [];
  const maxDepth = 5;
  // Track visited function declarations to prevent infinite recursion
  const visitedFunctions = new Set<Node>();

  const visitor = (node: Node, depth: number): void => {
    // Skip if we've exceeded max depth
    if (depth > maxDepth) {
      return;
    }

    if (isThrowStatement(node)) {
      let expression = node.expression;
      const visited = new Set<Node>();
      while (true) {
        if (
          isParenthesizedExpression(expression) ||
          isAsExpression(expression) ||
          isTypeAssertion(expression) ||
          isSatisfiesExpression(expression) ||
          isNonNullExpression(expression)
        ) {
          expression = expression.expression;
          continue;
        }
        if (
          !isIdentifier(expression) &&
          !isPropertyAccessExpression(expression)
        )
          break;
        // Structural property types can point at another object's declaration.
        // Only module namespace imports guarantee the referenced export binding.
        if (
          isPropertyAccessExpression(expression) &&
          !typeChecker
            .getSymbolAtLocation(expression.expression)
            ?.declarations.some(isNamespaceImport.Handle)
        )
          break;
        const declaration = resolvedSymbol(
          expression,
          typeChecker,
        )?.valueDeclaration?.resolve();
        if (
          !declaration ||
          visited.has(declaration) ||
          !isVariableDeclaration(declaration) ||
          !isVariableDeclarationList(declaration.parent) ||
          !(declaration.parent.flags & NodeFlags.Const) ||
          !declaration.initializer
        )
          break;
        visited.add(declaration);
        expression = declaration.initializer;
      }
      if (isNewExpression(expression)) {
        tokens.push({
          token: `throw.new.${expression.expression.getText()}`,
          node: expression,
        });
      }
    }

    if (isReturnStatement(node) && node.expression) {
      if (isCall(node.expression)) {
        tokens.push({
          token: node.expression.expression.getText(),
          node: node.expression,
        });
      }
      if (isNewExpression(node.expression)) {
        tokens.push({
          token: `new.${node.expression.expression.getText()}`,
          node: node.expression,
        });
      }
      // Continue traversing into the returned expression (e.g., arrow functions)
      // This handles: return async (c, next) => { throw ... }
      node.expression.forEachChild((child) => visitor(child, depth));
      return;
    }

    // If we encounter a call expression, follow it
    if (isCall(node) && depth < maxDepth) {
      const callExpression = node;

      // Try to resolve the function being called
      let symbol: TsSymbol | undefined;

      if (isIdentifier(callExpression.expression)) {
        symbol = typeChecker.getSymbolAtLocation(callExpression.expression);
      } else if (isPropertyAccessExpression(callExpression.expression)) {
        symbol = typeChecker.getSymbolAtLocation(
          callExpression.expression.name,
        );
      }

      // Resolve aliases
      if (symbol && symbol.flags & SymbolFlags.Alias) {
        symbol = typeChecker.getAliasedSymbol(symbol);
      }

      // Third-party functions are not followed
      if (symbol && isLocalFunction(symbol)) {
        for (const handle of symbol.declarations) {
          const declaration = handle.resolve();
          // Skip if we've already visited this function (prevent infinite recursion)
          if (!declaration || visitedFunctions.has(declaration)) {
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

    node.forEachChild((child) => visitor(child, depth));
  };

  visitor(node, 0);
  return tokens;
}

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

function parseJSDocComment(node: Node) {
  let tags: string[] = [];
  let name = '';
  let description = '';
  let summary = '';
  let access = '';
  let tool = '';
  let toolDescription = '';

  for (const tag of getAllJSDocTags(node, (tag): tag is JSDocTag =>
    jsDocsTags.includes(tag.tagName.text as JSDocsTags),
  )) {
    const comment = getTextOfJSDocComment(tag.comment);
    if (comment === undefined) {
      continue;
    }
    switch (tag.tagName.text as JSDocsTags) {
      case 'openapi':
        name = comment;
        break;
      case 'tags':
        tags = comment.split(',').map((tag) => tag.trim());
        break;
      case 'description':
        description = comment;
        break;
      case 'summary':
        summary = comment;
        break;
      case 'access':
        access = comment.trim().toLowerCase();
        break;
      case 'tool':
        tool = comment.trim();
        break;
      case 'toolDescription':
        toolDescription = comment.trim();
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
  node: Node,
  responseAnalyzer: (
    handler: ArrowFunction | FunctionExpression,
    token: string,
    node: Node,
  ) => ResponseItem[],
  paths: Paths,
  typeChecker: Checker,
  typeDeriver: TypeDeriver,
  security?: SecurityAnalysis,
) {
  if (!isCall(node) || node.arguments.length < 2) {
    return moveOn();
  }
  if (
    !isPropertyAccessExpression(node.expression) ||
    !isIdentifier(node.expression.name) ||
    !isHttpMethod(node.expression.name.text)
  ) {
    return moveOn();
  }

  const [pathNode] = node.arguments;
  if (!isStringLiteral(pathNode)) {
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
  if (!handler || !isArrowFunction(handler)) {
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

  let selector: Expression | undefined;
  let contentType: Expression | undefined;
  if (validate.arguments.length === 2) {
    contentType = validate.arguments[0];
    selector = validate.arguments[1];
  } else {
    selector = validate.arguments[0];
  }
  if (!isArrowFunction(selector)) {
    return moveOn();
  }
  if (
    !selector ||
    !isParenthesizedExpression(selector.body) ||
    !isObjectLiteralExpression(selector.body.expression)
  ) {
    return moveOn();
  }

  // Collect all middleware declarations for analysis
  const middlewareDeclarations: { node: Node; name?: string }[] = [];

  // slice(1, -1) to skip first (path) and last (handler) arguments
  // and skip the validate middleware - it's handled separately
  for (const arg of node.arguments.slice(1, -1)) {
    if (isCall(arg)) {
      // Try to resolve the factory function declaration
      if (isIdentifier(arg.expression)) {
        const middlewareFnName = arg.expression.text;
        let symbol = typeChecker.getSymbolAtLocation(arg.expression);

        // If symbol has alias, resolve to the actual symbol
        if (symbol && symbol.flags & SymbolFlags.Alias) {
          symbol = typeChecker.getAliasedSymbol(symbol);
        }

        const allDeclarations = [
          symbol?.valueDeclaration,
          ...(symbol?.declarations ?? []),
        ]
          .map((handle) => handle?.resolve())
          .filter((declaration) => declaration !== undefined);

        let declaration = allDeclarations.find(isFunctionWithBody);

        // If not found, check for variable declarations with function initializers
        if (!declaration) {
          for (const decl of allDeclarations) {
            if (isVariableDeclaration(decl) && decl.initializer) {
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
      if (isIdentifier(arg.expression) && arg.expression.text === 'validate') {
        continue;
      }
      const firstArg = arg.arguments[0];
      if (isFunctionWithBody(firstArg)) {
        middlewareDeclarations.push({ node: firstArg });
      }
    }
  }

  const props =
    selector.body.expression.properties.filter(isPropertyAssignment);

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
      ? isStringLiteral(contentType)
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
    node.forEachChild((node) =>
      visit(node, responseAnalyzer, paths, typeChecker, typeDeriver, security),
    );
  }
}

function toSelectors(props: PropertyAssignment[]) {
  const selectors: Selector[] = [];
  for (const prop of props) {
    if (!isObjectLiteralExpression(prop.initializer)) {
      continue;
    }
    const name = prop.name.getText();
    const select = prop.initializer.properties
      .filter(isPropertyAssignment)
      .find((prop) => prop.name.getText() === 'select');
    if (!select) {
      console.warn(
        `\u26a0 No select found in ${name}\n  at ${nodeLocation(prop) ?? 'unknown'}`,
      );
      continue;
    }
    const against = prop.initializer.properties
      .filter(isPropertyAssignment)
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
  project: AnalysisProject,
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
  const typeChecker = project.checker;
  const typeDeriver = new TypeDeriver(typeChecker, config.typesMap);
  const paths = new Paths({
    imports: config.imports ?? [],
    onOperation: config.onOperation,
  });
  const security: SecurityAnalysis | undefined = config.middlewareSecurity && {
    rules: config.middlewareSecurity,
    matched: new Set(),
  };

  for (const sourceFile of sourceFiles(project.program)) {
    logger(`Visiting ${sourceFile.fileName}`);
    visit(
      sourceFile,
      (handler, token, node) => {
        const responseAnalyzer = config.responseAnalyzer;
        if (typeof responseAnalyzer !== 'function') {
          const naunce = responseAnalyzer[token] || responseAnalyzer['default'];
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
  node: Node | undefined,
): node is FunctionLikeDeclaration & { body: Block | Expression } {
  if (!node) {
    return false;
  }
  return (
    (isFunctionDeclaration(node) ||
      isFunctionExpression(node) ||
      isArrowFunction(node) ||
      isMethodDeclaration(node) ||
      isConstructorDeclaration(node) ||
      isGetAccessorDeclaration(node) ||
      isSetAccessorDeclaration(node)) &&
    !!node.body
  );
}

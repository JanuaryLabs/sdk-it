import {
  type CallExpression,
  type Expression,
  type Identifier,
  type LeftHandSideExpression,
  type Node,
  NodeFlags,
  type PropertyAssignment,
  getJSDocTags,
  getTextOfJSDocComment,
} from '@typescript/native/ast';
import {
  isArrayLiteralExpression,
  isArrowFunction,
  isAsExpression,
  isAwaitExpression,
  isBlock,
  isCallExpression as isCall,
  isConditionalExpression,
  isConstructorDeclaration,
  isElementAccessExpression,
  isEnumMember,
  isFunctionDeclaration,
  isFunctionExpression,
  isGetAccessorDeclaration,
  isIdentifier,
  isImportDeclaration,
  isMethodDeclaration,
  isNamespaceImport,
  isNewExpression,
  isNonNullExpression,
  isObjectLiteralExpression,
  isOmittedExpression,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isQualifiedName,
  isReturnStatement,
  isSatisfiesExpression,
  isSetAccessorDeclaration,
  isShorthandPropertyAssignment,
  isSourceFile,
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
  formatDiagnostics,
} from '@typescript/native/sync';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { debuglog } from 'node:util';
import type {
  SchemaObject,
  SecurityRequirementObject,
} from 'openapi3-ts/oas31';
import { camelcase } from 'stringcase';

import {
  type FunctionWithBody,
  type NaunceResponseAnalyzer,
  type OpenAPIComponentsObject,
  Paths,
  type ResponseAnalyzerFn,
  type ResponseItem,
  type Selector,
  ZodEvaluator,
  isHttpMethod,
  isSemanticSource,
  toSchema,
} from '@sdk-it/core';
import {
  TypeDeriver,
  UnresolvedTypeError,
  nodeLocation,
} from '@sdk-it/core/deriver.js';
import {
  type AnalysisProgram,
  type AnalysisProject,
  isCallExpression,
  sourceFiles,
} from '@sdk-it/core/program.js';

import { AgainstBindings } from './against-bindings.ts';

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
      .map((scheme) => [scheme, requirement[scheme].toSorted()]),
  );
}

/**
 * The calls whose value a returned expression passes on as the response:
 * through await, parentheses, type assertions, satisfies and non-null, and
 * both branches of a conditional.
 */
function returnedCalls(expression: Expression): CallExpression[] {
  if (
    isAwaitExpression(expression) ||
    isParenthesizedExpression(expression) ||
    isAsExpression(expression) ||
    isTypeAssertion(expression) ||
    isSatisfiesExpression(expression) ||
    isNonNullExpression(expression)
  ) {
    return returnedCalls(expression.expression);
  }
  if (isConditionalExpression(expression)) {
    return [
      ...returnedCalls(expression.whenTrue),
      ...returnedCalls(expression.whenFalse),
    ];
  }
  return isCall(expression) ? [expression] : [];
}

/**
 * Collects the tokens that become a handler's responses. In returned mode a
 * return statement is a response; in discarded mode only throws are, because
 * the caller drops the value. A call is followed in returned mode only when
 * its value is returned, so a helper that the handler calls for its side
 * effects adds its throws but never its returns.
 */
function returnTokens(node: Node, typeChecker: Checker) {
  const tokens: { token: string; node: Expression }[] = [];
  const maxDepth = 5;
  // A function is read once per mode: a discarded visit skips its returns,
  // so a later returned call to it must read it again.
  const visitedFunctions = {
    returned: new Set<Node>(),
    discarded: new Set<Node>(),
  };

  const follow = (
    callExpression: CallExpression,
    depth: number,
    returned: boolean,
  ): void => {
    if (depth >= maxDepth) {
      return;
    }

    let symbol: TsSymbol | undefined;
    if (isIdentifier(callExpression.expression)) {
      symbol = typeChecker.getSymbolAtLocation(callExpression.expression);
    } else if (isPropertyAccessExpression(callExpression.expression)) {
      symbol = typeChecker.getSymbolAtLocation(callExpression.expression.name);
    }
    if (symbol && symbol.flags & SymbolFlags.Alias) {
      symbol = typeChecker.getAliasedSymbol(symbol);
    }

    // Only source the program reads has a body to follow: a package that
    // ships declarations does not, one read through @sdk-it/source does.
    if (!symbol) {
      return;
    }
    const visited = returned
      ? visitedFunctions.returned
      : visitedFunctions.discarded;
    for (const handle of symbol.declarations) {
      const declaration = handle.resolve();
      if (!declaration || visited.has(declaration)) {
        continue;
      }
      if (isFunctionWithBody(declaration) && declaration.body) {
        visited.add(declaration);
        visitor(declaration.body, depth + 1, returned);
      }
    }
  };

  const visitor = (node: Node, depth: number, returned: boolean): void => {
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
      } else if (isCall(expression)) {
        // A factory call (e.g. an error catalog entry) is keyed by the type it returns.
        const thrown = typeChecker
          .getTypeAtLocation(expression)
          .getSymbol()?.name;
        if (thrown) {
          tokens.push({ token: `throw.call.${thrown}`, node: expression });
        }
      }
    }

    if (isReturnStatement(node) && node.expression) {
      visitReturned(node.expression, depth, returned);
      return;
    }

    // A concise arrow body is the function's return value: () => (c) => { ... }
    if (isArrowFunction(node) && !isBlock(node.body)) {
      for (const parameter of node.parameters) {
        visitor(parameter, depth, false);
      }
      visitReturned(node.body, depth, returned);
      return;
    }

    if (isCall(node)) {
      follow(node, depth, false);
    }

    // A nested function's returns answer its own caller, not this one.
    node.forEachChild((child) =>
      visitor(child, depth, returned && !isFunctionWithBody(child)),
    );
  };

  const visitReturned = (
    expression: Expression,
    depth: number,
    returned: boolean,
  ): void => {
    // A parenthesized value is the value itself: (c) => (c.json(x))
    if (isParenthesizedExpression(expression)) {
      visitReturned(expression.expression, depth, returned);
      return;
    }
    if (returned) {
      if (isCall(expression)) {
        tokens.push({
          token: expression.expression.getText(),
          node: expression,
        });
      }
      if (isNewExpression(expression)) {
        tokens.push({
          token: `new.${expression.expression.getText()}`,
          node: expression,
        });
      }
    }
    for (const call of returnedCalls(expression)) {
      follow(call, depth, returned);
    }
    // A returned function keeps the mode: return async (c, next) => { ... }
    if (isFunctionWithBody(expression)) {
      visitor(expression, depth, returned);
    } else {
      expression.forEachChild((child) => visitor(child, depth, returned));
    }
  };

  visitor(node, 0, true);
  return tokens;
}

const logger = debuglog('@sdk-it/generic');

const jsDocsTags = [
  'openapi',
  'tags',
  'description',
  'summary',
  'access',
  'tool',
  'toolDescription',
] as const;

function parseJSDocComment(node: Node) {
  let tags: string[] = [];
  let name = '';
  let description = '';
  let summary = '';
  let access = '';
  let tool = '';
  let toolDescription = '';

  for (const tag of getJSDocTags(node)) {
    const tagName = jsDocsTags.find((name) => name === tag.tagName.text);
    if (tagName === undefined) {
      continue;
    }
    const comment = getTextOfJSDocComment(tag.comment);
    if (comment === undefined) {
      continue;
    }
    switch (tagName) {
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
    handler: FunctionWithBody,
    token: string,
    node: Node,
  ) => ResponseItem[],
  paths: Paths,
  typeChecker: Checker,
  typeDeriver: TypeDeriver,
  bindings: AgainstBindings,
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
  const middlewareDeclarations: { node: FunctionWithBody; name?: string }[] =
    [];

  // slice(1, -1) to skip first (path) and last (handler) arguments
  // and skip the validate middleware - it's handled separately
  for (const arg of node.arguments.slice(1, -1)) {
    // A middleware passed by reference: `app.get(path, signedIn, …)`.
    if (isIdentifier(arg)) {
      const declaration = middlewareFunction(arg, typeChecker);
      if (declaration) {
        middlewareDeclarations.push({ node: declaration, name: arg.text });
      }
      continue;
    }
    if (isCall(arg)) {
      // A middleware factory: `app.get(path, authenticate(), …)`.
      if (isIdentifier(arg.expression)) {
        const declaration = middlewareFunction(arg.expression, typeChecker);
        if (declaration) {
          middlewareDeclarations.push({
            node: declaration,
            name: arg.expression.text,
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
  const selectors = toSelectors(
    props,
    typeChecker,
    `${method.toUpperCase()} ${path}`,
    bindings,
  );

  typeDeriver.setTrace({
    file: sourceFile.fileName,
    operation: `${method.toUpperCase()} ${path}`,
  });

  const responses: ResponseItem[] = [];

  // Analyze all middlewares for potential responses
  for (const middleware of middlewareDeclarations) {
    for (const { token, node } of returnTokens(middleware.node, typeChecker)) {
      const items = responseAnalyzer(middleware.node, token, node);
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
    selectors,
    responses,
    {
      ...metadata,
      security: security
        ? middlewareSecurity(node.arguments.slice(1, -1), security, typeChecker)
        : undefined,
    },
  );

  function moveOn() {
    node.forEachChild((node) =>
      visit(
        node,
        responseAnalyzer,
        paths,
        typeChecker,
        typeDeriver,
        bindings,
        security,
      ),
    );
  }
}

function toSelectors(
  props: PropertyAssignment[],
  typeChecker: Checker,
  operation: string,
  bindings: AgainstBindings,
) {
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
    const selector = toSelector(select.initializer, {
      against: against.initializer.getText(),
      imports: bindings.of(against.initializer, typeChecker, {
        operation,
        input: name,
      }),
    });
    if (!selector) {
      console.warn(
        `⚠ Unsupported select in ${name}: ${select.initializer.getText()}. Select payload.body or one value, such as payload.params.id or payload.headers['x-id'].\n  at ${nodeLocation(prop) ?? 'unknown'}`,
      );
      continue;
    }
    selectors.push(selector);
  }
  return selectors;
}

/**
 * `payload.body` selects the whole body; `payload.<source>.<name>` and
 * `payload.<source>['<name>']` select one value.
 */
function toSelector(
  select: Expression,
  validation: Pick<Selector, 'against' | 'imports'>,
): Selector | undefined {
  if (isPropertyAccessExpression(select) && isIdentifier(select.expression)) {
    return select.name.text === 'body'
      ? { kind: 'body', ...validation }
      : undefined;
  }
  if (
    !isPropertyAccessExpression(select) &&
    !isElementAccessExpression(select)
  ) {
    return undefined;
  }
  const name = memberName(select);
  const owner = select.expression;
  if (
    name === undefined ||
    !isPropertyAccessExpression(owner) ||
    !isIdentifier(owner.expression) ||
    !isSemanticSource(owner.name.text)
  ) {
    return undefined;
  }
  return { kind: 'field', source: owner.name.text, name, ...validation };
}

function memberName(node: Expression): string | undefined {
  if (isPropertyAccessExpression(node)) {
    return node.name.text;
  }
  if (
    isElementAccessExpression(node) &&
    isStringLiteralLikeNode(node.argumentExpression)
  ) {
    return node.argumentExpression.text;
  }
  return undefined;
}

/**
 * What the app's not-found handler (`app.notFound(handler)`) sends, read like a
 * route handler; undefined when the program registers none. A route that
 * returns `c.notFound()` sends it (Hono's Context.notFound calls the handler).
 */
function notFoundResponses(
  program: AnalysisProject['program'],
  checker: Checker,
  respond: (
    handler: FunctionWithBody,
    token: string,
    node: Node,
  ) => ResponseItem[],
): ResponseItem[] | undefined {
  const handlers: FunctionWithBody[] = [];
  const find = (node: Node): void => {
    if (
      isCall(node) &&
      isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'notFound' &&
      node.arguments.length === 1
    ) {
      const [handler] = node.arguments;
      if (handler && isFunctionWithBody(handler)) {
        handlers.push(handler);
      }
    }
    node.forEachChild(find);
  };
  for (const sourceFile of sourceFiles(program)) {
    find(sourceFile);
  }
  if (handlers.length === 0) {
    return undefined;
  }
  return handlers.flatMap((handler) =>
    returnTokens(handler, checker).flatMap(({ token, node }) =>
      respond(handler, token, node),
    ),
  );
}

/** Whether `node`, a value `handler` returns, is `c.notFound()` on the handler's own context. */
function returnsNotFound(handler: FunctionWithBody, node: Node): boolean {
  const [context] = handler.parameters;
  return (
    context !== undefined &&
    isCall(node) &&
    node.arguments.length === 0 &&
    isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'notFound' &&
    isIdentifier(node.expression.expression) &&
    node.expression.expression.text === context.name.getText()
  );
}

/**
 * The function a middleware name refers to: a function declaration, or a
 * variable initialized with a function, through any import alias.
 */
function middlewareFunction(
  name: Identifier,
  checker: Checker,
): FunctionWithBody | undefined {
  let symbol = checker.getSymbolAtLocation(name);
  if (symbol && symbol.flags & SymbolFlags.Alias) {
    symbol = checker.getAliasedSymbol(symbol);
  }
  const declarations = [
    symbol?.valueDeclaration,
    ...(symbol?.declarations ?? []),
  ]
    .map((handle) => handle?.resolve())
    .filter((declaration) => declaration !== undefined);
  const declared = declarations.find(isFunctionWithBody);
  if (declared) {
    return declared;
  }
  for (const declaration of declarations) {
    if (
      isVariableDeclaration(declaration) &&
      declaration.initializer &&
      isFunctionWithBody(declaration.initializer)
    ) {
      return declaration.initializer;
    }
  }
  return undefined;
}

export interface AnalyzeOptions {
  /**
   * The exports an `against` may read through a named import of its route
   * file, such as Prisma's `$Enums` and `Prisma`. Any other named import is
   * refused.
   */
  allowedNamedImports?: readonly string[];
  /** A TypeScript type name and the JSON Schema written in its place, added onto the defaults. */
  types?: Readonly<Record<string, SchemaObject>>;
  responseAnalyzer: ResponseAnalyzerFn | NaunceResponseAnalyzer;
  middlewareSecurity?: readonly MiddlewareSecurityRule[];
}

/** Every option analyze() takes; TypeScript keeps it equal to AnalyzeOptions. */
const analyzeOptions: Record<keyof AnalyzeOptions, true> = {
  allowedNamedImports: true,
  types: true,
  responseAnalyzer: true,
  middlewareSecurity: true,
};

export async function analyze(
  project: AnalysisProject,
  config: AnalyzeOptions,
) {
  // A JavaScript caller has no type check, so an option analyze() does not
  // take (one it took before, such as typesMap) would silently change the document.
  for (const option of Object.keys(config)) {
    if (!Object.hasOwn(analyzeOptions, option)) {
      throw new TypeError(
        `analyze() takes no option '${option}'. It takes ${Object.keys(analyzeOptions).join(', ')}.`,
      );
    }
  }
  const typeChecker = project.checker;
  const typeDeriver = new TypeDeriver(typeChecker, config.types);
  using evaluator = new ZodEvaluator({
    conditions: project.program.getCompilerOptions().customConditions ?? [],
  });
  const paths = new Paths({ evaluator });
  const bindings = new AgainstBindings(config.allowedNamedImports ?? []);
  const security: SecurityAnalysis | undefined = config.middlewareSecurity && {
    rules: config.middlewareSecurity,
    matched: new Set(),
  };

  const respond = (
    handler: FunctionWithBody,
    token: string,
    node: Node,
  ): ResponseItem[] => {
    const responseAnalyzer = config.responseAnalyzer;
    if (typeof responseAnalyzer !== 'function') {
      const naunce = responseAnalyzer[token];
      if (naunce) {
        return naunce(handler, typeDeriver, node);
      }
      // A thrown value that no analyzer claims is not a documented response.
      if (token.startsWith('throw.')) {
        return [];
      }
      const fallback = responseAnalyzer['default'];
      if (!fallback) {
        throw new Error(`No response analyzer for token ${token}`);
      }
      return fallback(handler, typeDeriver, node);
    }
    return responseAnalyzer(handler, typeDeriver);
  };
  const notFound = notFoundResponses(project.program, typeChecker, respond);

  for (const sourceFile of sourceFiles(project.program)) {
    logger(`Visiting ${sourceFile.fileName}`);
    try {
      visit(
        sourceFile,
        (handler, token, node) =>
          notFound && returnsNotFound(handler, node)
            ? notFound.map((item) => ({ ...item }))
            : respond(handler, token, node),
        paths,
        typeChecker,
        typeDeriver,
        bindings,
        security,
      );
    } catch (error) {
      if (!(error instanceof UnresolvedTypeError)) {
        throw error;
      }
      // A binding that does not load, such as a client that is not generated,
      // is the cause a response type that does not resolve often shares.
      await bindings.load(evaluator, project.program);
      throw new Error(
        `${error.message}. TypeScript reports:\n${formatDiagnostics(unresolvedReferences(project.program), project.program)}`,
        { cause: error },
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

  await bindings.load(evaluator, project.program);
  const pathsObject = await paths.getPaths();
  const components: OpenAPIComponentsObject = {
    schemas: {
      ...paths.getSharedSchemas(),
      ...Object.entries(typeDeriver.collector).reduce(
        (acc, [key, value]) => ({ ...acc, [key]: toSchema(value) }),
        {},
      ),
    },
  };

  return {
    paths: pathsObject,
    tags: paths.getTags(),
    components,
  };
}

/** TypeScript's diagnostics for a module, export or name that does not resolve. */
const unresolvedReferenceCodes = new Set([
  2304, // Cannot find name
  2305, // Module has no exported member
  2307, // Cannot find module
  2503, // Cannot find namespace
  2552, // Cannot find name, did you mean
  2614, // Module has no exported member, did you mean a default import
  2694, // Namespace has no exported member
  2724, // Module has no exported member, did you mean
  2792, // Cannot find module, did you mean to set moduleResolution
]);

function unresolvedReferences(program: AnalysisProgram) {
  return program
    .getSemanticDiagnostics()
    .filter((diagnostic) => unresolvedReferenceCodes.has(diagnostic.code));
}

export type Serialized = ReturnType<typeof analyze>;

function isFunctionWithBody(node: Node | undefined): node is FunctionWithBody {
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

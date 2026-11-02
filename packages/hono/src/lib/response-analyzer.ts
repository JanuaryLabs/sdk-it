import type {
  ArrowFunction,
  Expression,
  FunctionExpression,
  Node,
  ObjectLiteralExpression,
  PropertyName,
} from '@typescript/native/ast';
import {
  isArrowFunction,
  isAsExpression,
  isBlock,
  isCallExpression,
  isComputedPropertyName,
  isExpression,
  isFunctionExpression,
  isIdentifier,
  isNewExpression,
  isNullLiteral,
  isNumericLiteral,
  isObjectLiteralExpression,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isReturnStatement,
  isShorthandPropertyAssignment,
  isStringLiteral,
  isTypeAssertion,
  isVariableDeclaration,
} from '@typescript/native/ast/is';
import type { Checker } from '@typescript/native/sync';

import {
  $types,
  type NaunceResponseAnalyzerFn,
  type ResponseItem,
} from '@sdk-it/core';
import type { TypeDeriver } from '@sdk-it/core/deriver.js';

import { getConstantValue } from './constant-value.js';

const handlerVisitor: (
  on: (
    node: Node | undefined,
    statusCode: Node | undefined,
    headers: Node | undefined,
    contentType: string,
  ) => void,
  contextVarName: string,
) => (node: Node) => void = (callback, contextVarName) => {
  return (node: Node) => {
    if (
      isReturnStatement(node) &&
      node.expression &&
      isCallExpression(node.expression) &&
      isPropertyAccessExpression(node.expression.expression)
    ) {
      const call = node.expression;
      const propAccess = node.expression.expression;
      if (
        isIdentifier(propAccess.expression) &&
        propAccess.expression.text === contextVarName
      ) {
        const [argument, statusCode, headers] = call.arguments;
        const rawBody = propAccess.name.text === 'body';
        // A raw body of null sends nothing; c.json(null) still sends the JSON text null.
        const body =
          rawBody && argument && isNullLiteral(argument) ? undefined : argument;
        let contentType = rawBody
          ? 'application/octet-stream'
          : 'application/json';
        if (!body) {
          contentType = 'empty';
        }
        callback(body, statusCode, headers, contentType);
      }
    }
    node.forEachChild(handlerVisitor(callback, contextVarName));
  };
};

function resolveStatusCode(node: Node) {
  if (isNumericLiteral(node)) {
    return node.text;
  }
  throw new Error(`Could not resolve status code`);
}

function normalizeContentType(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  return value.split(';')[0]?.trim();
}

function getPropertyNameText(
  name: PropertyName,
  checker: Checker,
): string | undefined {
  if (isIdentifier(name) || isStringLiteral(name) || isNumericLiteral(name)) {
    return name.text;
  }
  if (isComputedPropertyName(name)) {
    const expression = name.expression;
    if (isStringLiteral(expression) || isNumericLiteral(expression)) {
      return expression.text;
    }
    const value = getConstantValue(checker, expression);
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value);
    }
  }
  return undefined;
}

function resolveHeadersObject(
  headersNode: Node | undefined,
  checker: Checker,
): ObjectLiteralExpression | undefined {
  if (!headersNode) {
    return undefined;
  }
  const unwrapObjectLiteral = (
    expression: Expression,
  ): ObjectLiteralExpression | undefined => {
    if (isObjectLiteralExpression(expression)) {
      return expression;
    }
    if (
      isParenthesizedExpression(expression) &&
      isObjectLiteralExpression(expression.expression)
    ) {
      return expression.expression;
    }
    return undefined;
  };
  if (isObjectLiteralExpression(headersNode)) {
    return headersNode;
  }
  if (
    isAsExpression(headersNode) ||
    isTypeAssertion(headersNode) ||
    isParenthesizedExpression(headersNode)
  ) {
    return resolveHeadersObject(headersNode.expression, checker);
  }
  if (isNewExpression(headersNode)) {
    const exprName = headersNode.expression.getText();
    if (exprName === 'Headers') {
      const [init] = headersNode.arguments ?? [];
      return init ? resolveHeadersObject(init, checker) : undefined;
    }
  }
  if (isCallExpression(headersNode)) {
    let callee: Expression = headersNode.expression;
    if (isParenthesizedExpression(callee)) {
      callee = callee.expression;
    }
    if (isArrowFunction(callee) || isFunctionExpression(callee)) {
      if (isExpression(callee.body)) {
        const bodyLiteral = unwrapObjectLiteral(callee.body);
        if (bodyLiteral) {
          return bodyLiteral;
        }
      }
      if (isBlock(callee.body)) {
        for (const statement of callee.body.statements) {
          const returned =
            isReturnStatement(statement) && statement.expression
              ? unwrapObjectLiteral(statement.expression)
              : undefined;
          if (returned) {
            return returned;
          }
        }
      }
    }
  }
  if (isShorthandPropertyAssignment(headersNode)) {
    const symbol = checker.getShorthandAssignmentValueSymbol(headersNode);
    const decl = (
      symbol?.valueDeclaration ?? symbol?.declarations[0]
    )?.resolve();
    if (decl && isVariableDeclaration(decl) && decl.initializer) {
      return resolveHeadersObject(decl.initializer, checker);
    }
  }
  if (isIdentifier(headersNode)) {
    const symbol = checker.getSymbolAtLocation(headersNode);
    const decl = (
      symbol?.valueDeclaration ?? symbol?.declarations[0]
    )?.resolve();
    if (decl && isVariableDeclaration(decl) && decl.initializer) {
      return resolveHeadersObject(decl.initializer, checker);
    }
  }
  return undefined;
}

function getHeaderValue(
  headersNode: Node | undefined,
  headerName: string,
  checker: Checker,
) {
  const headersObject = resolveHeadersObject(headersNode, checker);
  if (!headersObject) {
    return undefined;
  }
  for (const prop of headersObject.properties) {
    if (!isPropertyAssignment(prop)) {
      continue;
    }
    const key = getPropertyNameText(prop.name, checker);
    if (!key || key.toLowerCase() !== headerName.toLowerCase()) {
      continue;
    }
    const value = getConstantValue(checker, prop.initializer);
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

function hasHeaderKey(
  headersNode: Node | undefined,
  headerName: string,
  checker: Checker,
) {
  const headersObject = resolveHeadersObject(headersNode, checker);
  if (!headersObject) {
    return false;
  }
  for (const prop of headersObject.properties) {
    if (!isPropertyAssignment(prop)) {
      continue;
    }
    const key = getPropertyNameText(prop.name, checker);
    if (key && key.toLowerCase() === headerName.toLowerCase()) {
      return true;
    }
  }
  return false;
}

function isJsonContentType(contentType: string) {
  return contentType.endsWith('/json') || contentType.endsWith('+json');
}

function isTextContentTypeValue(contentType: string) {
  return contentType.startsWith('text/');
}

function inferContentType(
  body: Node | undefined,
  headers: Node | undefined,
  defaultContentType: string,
  checker: Checker,
) {
  if (!body) {
    return 'empty';
  }
  const headerContentType = normalizeContentType(
    getHeaderValue(headers, 'Content-Type', checker),
  );
  if (headerContentType) {
    return headerContentType;
  }
  if (hasHeaderKey(headers, 'Content-Disposition', checker)) {
    return 'application/octet-stream';
  }
  return defaultContentType;
}

function getHeaderKeys(headersNode: Node | undefined, deriver: TypeDeriver) {
  if (!headersNode) {
    return [];
  }
  const resolved = resolveHeadersObject(headersNode, deriver.checker);
  if (resolved) {
    return Object.keys(deriver.serializeNode(resolved));
  }
  const type = deriver.checker.getTypeAtLocation(headersNode);
  const names = deriver.checker
    .getPropertiesOfType(type)
    .map((prop) => prop.name);
  const sorted = names.sort((a, b) => a.localeCompare(b));
  return sorted.flatMap((name) =>
    name.includes('-') ? [`'${name}'`, name] : [name],
  );
}

export const newResponse: NaunceResponseAnalyzerFn = (
  _handler,
  deriver,
  node,
) => {
  if (!isNewExpression(node)) {
    return [];
  }
  const exprName = node.expression.getText();
  if (exprName !== 'Response') {
    return [];
  }
  const [body, init] = node.arguments ?? [];
  let statusNode: Node | undefined;
  let headersNode: Node | undefined;
  if (init && isObjectLiteralExpression(init)) {
    for (const prop of init.properties) {
      if (!isPropertyAssignment(prop)) {
        if (isShorthandPropertyAssignment(prop)) {
          const key = prop.name.getText();
          if (key === 'headers') {
            headersNode = prop;
          }
        }
        continue;
      }
      const key = getPropertyNameText(prop.name, deriver.checker);
      if (!key) {
        continue;
      }
      if (key === 'status') {
        statusNode = prop.initializer;
      } else if (key === 'headers') {
        headersNode = prop.initializer;
      }
    }
  }

  const contentType = inferContentType(
    body,
    headersNode,
    'application/octet-stream',
    deriver.checker,
  );

  const normalized = contentType.toLowerCase();
  const shouldSerialize =
    !!body &&
    (isJsonContentType(normalized) || isTextContentTypeValue(normalized));

  return [
    {
      headers: getHeaderKeys(headersNode, deriver),
      contentType,
      statusCode: statusNode ? resolveStatusCode(statusNode) : '200',
      response: shouldSerialize ? deriver.serializeNode(body) : undefined,
    },
  ];
};

export function defaultResponseAnalyzer(
  handler: ArrowFunction | FunctionExpression,
  deriver: TypeDeriver,
) {
  const responsesList: ResponseItem[] = [];
  if (!handler.parameters.length) {
    return responsesList;
  }
  const contextVarName = handler.parameters[0].name.getText();
  const visit = handlerVisitor((node, statusCode, headers, contentType) => {
    const resolvedContentType = inferContentType(
      node,
      headers,
      contentType,
      deriver.checker,
    );
    responsesList.push({
      headers: getHeaderKeys(headers, deriver),
      contentType: resolvedContentType,
      statusCode: statusCode ? resolveStatusCode(statusCode) : '200',
      response: node ? deriver.serializeNode(node) : undefined,
    });
  }, contextVarName);
  visit(handler.body);
  return responsesList;
}

export function streamText(
  _handler: ArrowFunction | FunctionExpression,
  _deriver: TypeDeriver,
): ResponseItem[] {
  return [
    {
      contentType: 'text/plain',
      headers: [{ 'Transfer-Encoding': ['chunked'] }],
      statusCode: '200',
      response: {
        optional: false,
        kind: 'primitive',
        [$types]: ['string'],
      },
    },
  ];
}

export function stream(
  _handler: ArrowFunction | FunctionExpression,
  _deriver: TypeDeriver,
): ResponseItem[] {
  return [
    {
      contentType: 'application/octet-stream',
      headers: [],
      statusCode: '200',
      response: {
        optional: false,
        kind: 'primitive',
        [$types]: ['string'],
      },
    },
  ];
}

export function streamSSE(
  _handler: ArrowFunction | FunctionExpression,
  _deriver: TypeDeriver,
): ResponseItem[] {
  return [
    {
      contentType: 'text/event-stream',
      headers: [],
      statusCode: '200',
      response: {
        optional: false,
        kind: 'primitive',
        [$types]: ['string'],
      },
    },
  ];
}

export const httpException: NaunceResponseAnalyzerFn = (
  _handler,
  deriver,
  node,
) => {
  if (isNewExpression(node)) {
    const [status, options] = node.arguments ?? [];
    return [
      {
        contentType: 'application/json',
        headers: [],
        statusCode: resolveStatusCode(status),
        response: options ? deriver.serializeNode(options) : undefined,
      },
    ];
  }
  return [];
};

export const responseAnalyzer = {
  default: defaultResponseAnalyzer,
  streamText,
  stream,
  streamSSE,
  'new.Response': newResponse,
  'throw.new.HTTPException': httpException,
};

export default responseAnalyzer;

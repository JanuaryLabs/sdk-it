import ts from 'typescript';

import {
  $types,
  type NaunceResponseAnalyzerFn,
  type ResponseItem,
  type TypeDeriver,
} from '@sdk-it/core';
import { getConstantValue } from './constant-value.js';

const handlerVisitor: (
  on: (
    node: ts.Node | undefined,
    statusCode: ts.Node | undefined,
    headers: ts.Node | undefined,
    contentType: string,
  ) => void,
  contextVarName: string,
) => ts.Visitor = (callback, contextVarName) => {
  return (node: ts.Node) => {
    if (ts.isReturnStatement(node) && node.expression) {
      if (ts.isCallExpression(node.expression)) {
        if (ts.isPropertyAccessExpression(node.expression.expression)) {
          const propAccess = node.expression.expression;
          if (
            ts.isIdentifier(propAccess.expression) &&
            propAccess.expression.text === contextVarName
          ) {
            const [body, statusCode, headers] = node.expression.arguments;
            let contentType = 'application/json';
            const callerMethod = propAccess.name.text;
            if (callerMethod === 'body') {
              contentType = 'application/octet-stream';
            }
            if (!body) {
              contentType = 'empty';
            }
            callback(body, statusCode, headers, contentType);
          }
        }
        // if (ts.isIdentifier(node.expression.expression)) {
        //   console.log('streamText');
        //   if (node.expression.expression.text === 'streamText') {
        //     callback(undefined, undefined, undefined, 'text/plain');
        //   }
        // }
      }
    }
    return ts.forEachChild(node, handlerVisitor(callback, contextVarName));
  };
};

function resolveStatusCode(node: ts.Node) {
  if (ts.isNumericLiteral(node)) {
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
  name: ts.PropertyName,
  checker: ts.TypeChecker,
): string | undefined {
  if (ts.isIdentifier(name)) {
    return name.text;
  }
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name)) {
    const expression = name.expression;
    if (ts.isStringLiteral(expression) || ts.isNumericLiteral(expression)) {
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
  headersNode: ts.Node | undefined,
  checker: ts.TypeChecker,
): ts.ObjectLiteralExpression | undefined {
  if (!headersNode) {
    return undefined;
  }
  const unwrapObjectLiteral = (
    expression: ts.Expression,
  ): ts.ObjectLiteralExpression | undefined => {
    if (ts.isObjectLiteralExpression(expression)) {
      return expression;
    }
    if (
      ts.isParenthesizedExpression(expression) &&
      ts.isObjectLiteralExpression(expression.expression)
    ) {
      return expression.expression;
    }
    return undefined;
  };
  if (ts.isObjectLiteralExpression(headersNode)) {
    return headersNode;
  }
  if (ts.isAsExpression(headersNode)) {
    return resolveHeadersObject(headersNode.expression, checker);
  }
  if (ts.isTypeAssertionExpression(headersNode)) {
    return resolveHeadersObject(headersNode.expression, checker);
  }
  if (ts.isParenthesizedExpression(headersNode)) {
    return resolveHeadersObject(headersNode.expression, checker);
  }
  if (ts.isNewExpression(headersNode)) {
    const exprName = headersNode.expression.getText();
    if (exprName === 'Headers') {
      const [init] = headersNode.arguments ?? [];
      return init ? resolveHeadersObject(init, checker) : undefined;
    }
  }
  if (ts.isCallExpression(headersNode)) {
    let callee: ts.Expression = headersNode.expression;
    if (ts.isParenthesizedExpression(callee)) {
      callee = callee.expression;
    }
    if (ts.isArrowFunction(callee) || ts.isFunctionExpression(callee)) {
      if (ts.isExpression(callee.body)) {
        const bodyLiteral = unwrapObjectLiteral(callee.body);
        if (bodyLiteral) {
          return bodyLiteral;
        }
      }
      if (ts.isBlock(callee.body)) {
        for (const statement of callee.body.statements) {
          if (
            ts.isReturnStatement(statement) &&
            statement.expression &&
            unwrapObjectLiteral(statement.expression)
          ) {
            return unwrapObjectLiteral(statement.expression);
          }
        }
      }
    }
  }
  if (ts.isShorthandPropertyAssignment(headersNode)) {
    const symbol = checker.getShorthandAssignmentValueSymbol(headersNode);
    const decl = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
    if (decl && ts.isVariableDeclaration(decl) && decl.initializer) {
      return resolveHeadersObject(decl.initializer, checker);
    }
  }
  if (ts.isIdentifier(headersNode)) {
    const symbol = checker.getSymbolAtLocation(headersNode);
    const decl = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
    if (decl && ts.isVariableDeclaration(decl) && decl.initializer) {
      return resolveHeadersObject(decl.initializer, checker);
    }
  }
  return undefined;
}

function getHeaderValue(
  headersNode: ts.Node | undefined,
  headerName: string,
  checker: ts.TypeChecker,
) {
  const headersObject = resolveHeadersObject(headersNode, checker);
  if (!headersObject) {
    return undefined;
  }
  for (const prop of headersObject.properties) {
    if (!ts.isPropertyAssignment(prop)) {
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
  headersNode: ts.Node | undefined,
  headerName: string,
  checker: ts.TypeChecker,
) {
  const headersObject = resolveHeadersObject(headersNode, checker);
  if (!headersObject) {
    return false;
  }
  for (const prop of headersObject.properties) {
    if (!ts.isPropertyAssignment(prop)) {
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
  body: ts.Node | undefined,
  headers: ts.Node | undefined,
  defaultContentType: string,
  checker: ts.TypeChecker,
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

function getHeaderKeys(headersNode: ts.Node | undefined, deriver: TypeDeriver) {
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
  if (!names.length) {
    return [];
  }
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  return sorted.flatMap((name) =>
    name.includes('-') ? [`'${name}'`, name] : [name],
  );
}

export const newResponse: NaunceResponseAnalyzerFn = (
  _handler,
  deriver,
  node,
) => {
  if (!ts.isNewExpression(node)) {
    return [];
  }
  const exprName = node.expression.getText();
  if (exprName !== 'Response') {
    return [];
  }
  const [body, init] = node.arguments ?? [];
  let statusNode: ts.Node | undefined;
  let headersNode: ts.Node | undefined;
  if (init && ts.isObjectLiteralExpression(init)) {
    for (const prop of init.properties) {
      if (!ts.isPropertyAssignment(prop)) {
        if (ts.isShorthandPropertyAssignment(prop)) {
          const key = prop.name.text;
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
  handler: ts.ArrowFunction | ts.FunctionExpression,
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
  _handler: ts.ArrowFunction | ts.FunctionExpression,
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
  _handler: ts.ArrowFunction | ts.FunctionExpression,
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
  _handler: ts.ArrowFunction | ts.FunctionExpression,
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
  if (ts.isNewExpression(node)) {
    const [status, options] = node.arguments ?? [];
    // if (!ts.isObjectLiteralExpression(options)) {
    //   return [];
    // }
    // const properties = options.properties.reduce<Record<string, string>>(
    //   (acc, prop) => {
    //     if (ts.isPropertyAssignment(prop)) {
    //       const key = prop.name.getText();
    //       if (ts.isLiteralExpression(prop.initializer)) {
    //         acc[key] = prop.initializer.text;
    //       } else {
    //         acc[key] = prop.initializer.getText();
    //       }
    //     }
    //     return acc;
    //   },
    //   {},
    // );
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

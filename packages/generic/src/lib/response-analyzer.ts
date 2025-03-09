import ts from 'typescript';

import type { ResponseItem, TypeDeriver } from '@sdk-it/core';

const visitor: (
  on: (
    node: ts.Node,
    statusCode: ts.Node | undefined,
    headers: ts.Node | undefined,
    contentType: string,
  ) => void,
) => ts.Visitor = (callback) => {
  return (node: ts.Node) => {
    if (ts.isReturnStatement(node) && node.expression) {
      if (
        ts.isCallExpression(node.expression) &&
        ts.isPropertyAccessExpression(node.expression.expression)
      ) {
        const propAccess = node.expression.expression;
        if (
          ts.isIdentifier(propAccess.expression) &&
          propAccess.expression.text === 'output'
        ) {
          let contentType = 'application/json';
          const callerMethod = propAccess.name.text;
          const [body, statusCode, headers] = node.expression.arguments;
          if (callerMethod === 'attachment') {
            contentType = 'application/octet-stream';
          }
          if (!body) {
            contentType = 'empty';
          }
          callback(body, statusCode, headers, contentType);
        }
      }
    }
    return ts.forEachChild(node, visitor(callback));
  };
};

function toResponses(handler: ts.ArrowFunction, deriver: TypeDeriver) {
  const responsesList: ResponseItem[] = [];
  const visit = visitor((node, statusCode, headers, contentType) => {
    responsesList.push({
      headers: headers ? Object.keys(deriver.serializeNode(headers)) : [],
      contentType,
      statusCode: statusCode ? resolveStatusCode(statusCode) : '200',
      response: node ? deriver.serializeNode(node) : undefined,
    });
  });
  visit(handler.body);
  return responsesList;
}

function resolveStatusCode(node: ts.Node) {
  if (ts.isNumericLiteral(node)) {
    return node.text;
  }
  throw new Error(`Could not resolve status code`);
}

export function responseAnalyzer(
  handler: ts.ArrowFunction,
  deriver: TypeDeriver,
) {
  try {
    return toResponses(handler, deriver);
  } catch (error) {
    console.error('Error analyzing response\n', handler.getText());
    throw error;
  }
}

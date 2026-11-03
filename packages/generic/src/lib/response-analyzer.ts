import type { Node } from '@typescript/native/ast';
import {
  isCallExpression,
  isIdentifier,
  isLiteralExpression,
  isNewExpression,
  isNumericLiteral,
  isObjectLiteralExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isReturnStatement,
} from '@typescript/native/ast/is';

import type {
  FunctionWithBody,
  NaunceResponseAnalyzer,
  ResponseItem,
} from '@sdk-it/core';
import type { TypeDeriver } from '@sdk-it/core/deriver.js';

const handlerVisitor: (
  on: (
    node: Node | undefined,
    statusCode: Node | undefined,
    headers: Node | undefined,
    contentType: string,
  ) => void,
) => (node: Node) => void = (callback) => {
  return (node: Node) => {
    if (isReturnStatement(node) && node.expression) {
      if (
        isCallExpression(node.expression) &&
        isPropertyAccessExpression(node.expression.expression)
      ) {
        const propAccess = node.expression.expression;
        if (
          isIdentifier(propAccess.expression) &&
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
    node.forEachChild(handlerVisitor(callback));
  };
};

function toResponses(handler: FunctionWithBody, deriver: TypeDeriver) {
  const responsesList: ResponseItem[] = [];
  const visit = handlerVisitor((node, statusCode, headers, contentType) => {
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

function resolveStatusCode(node: Node) {
  if (isNumericLiteral(node)) {
    return node.text;
  }
  throw new Error(`Could not resolve status code`);
}

export function defaultResponseAnalyzer(
  handler: FunctionWithBody,
  deriver: TypeDeriver,
) {
  try {
    return toResponses(handler, deriver);
  } catch (error) {
    console.error('Error analyzing response\n', handler.getText());
    throw error;
  }
}

export const responseAnalyzer: NaunceResponseAnalyzer = {
  'throw.new.ProblemDetailsException': (handler, deriver, node) => {
    if (isNewExpression(node)) {
      const [problem] = node.arguments ?? [];
      if (!isObjectLiteralExpression(problem)) {
        return [];
      }
      const properties = problem.properties.reduce<Record<string, string>>(
        (acc, prop) => {
          if (isPropertyAssignment(prop)) {
            const key = prop.name.getText();
            if (isLiteralExpression(prop.initializer)) {
              acc[key] = prop.initializer.text;
            } else {
              acc[key] = prop.initializer.getText();
            }
          }
          return acc;
        },
        {},
      );
      return [
        {
          contentType: 'application/problem+json',
          headers: [],
          statusCode: properties.status,
          response: deriver.serializeNode(problem),
        },
      ];
    }
    return [];
  },
  default: defaultResponseAnalyzer,
};

export default responseAnalyzer;

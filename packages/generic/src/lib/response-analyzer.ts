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
} from '@typescript/native/ast/is';

import type {
  FunctionWithBody,
  NaunceResponseAnalyzer,
  ResponseItem,
} from '@sdk-it/core';
import type { TypeDeriver } from '@sdk-it/core/deriver.js';

function resolveStatusCode(node: Node) {
  if (isNumericLiteral(node)) {
    return node.text;
  }
  throw new Error(`Could not resolve status code`);
}

/** The response `returned`, a value the handler returns, sends when it is an `output` call, such as `output.json(body, 201)`. */
export function defaultResponseAnalyzer(
  handler: FunctionWithBody,
  deriver: TypeDeriver,
  returned: Node,
): ResponseItem[] {
  if (
    !isCallExpression(returned) ||
    !isPropertyAccessExpression(returned.expression)
  ) {
    return [];
  }
  const method = returned.expression;
  if (!isIdentifier(method.expression) || method.expression.text !== 'output') {
    return [];
  }
  const [body, statusCode, headers] = returned.arguments;
  let contentType = 'application/json';
  if (!body) {
    contentType = 'empty';
  } else if (method.name.text === 'attachment') {
    contentType = 'application/octet-stream';
  }
  try {
    return [
      {
        headers: headers
          ? deriver.checker
              .getPropertiesOfType(deriver.checker.getTypeAtLocation(headers))
              .map((prop) => prop.name)
          : [],
        contentType,
        statusCode: statusCode ? resolveStatusCode(statusCode) : '200',
        response: body ? deriver.serializeNode(body) : undefined,
      },
    ];
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

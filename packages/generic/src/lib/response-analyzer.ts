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

import {
  type ErrorResponder,
  ResponseAnalyzer,
  type ResponseItem,
  type ResponseScope,
} from '@sdk-it/core';
import type { TypeDeriver } from '@sdk-it/core/deriver.js';
import type { ThrowSite } from '@sdk-it/core/thrown.js';

function resolveStatusCode(node: Node) {
  if (isNumericLiteral(node)) {
    return node.text;
  }
  throw new Error(`Could not resolve status code`);
}

/** The response `returned`, a value the handler returns, sends when it is an `output` call, such as `output.json(body, 201)`. */
export function defaultResponseAnalyzer(
  { handler }: ResponseScope,
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

/**
 * What a route sends for an error it throws: a `ProblemDetailsException` is
 * the problem details it is constructed with, as `application/problem+json` at
 * their status; any other error is not documented.
 */
class ProblemDetailsResponder implements ErrorResponder {
  responsesFor(
    { thrown, chain }: ThrowSite,
    deriver: TypeDeriver,
  ): ResponseItem[] {
    if (
      !isNewExpression(thrown) ||
      chain[0]?.name !== 'ProblemDetailsException'
    ) {
      return [];
    }
    const [problem] = thrown.arguments ?? [];
    if (!problem || !isObjectLiteralExpression(problem)) {
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
}

export const responseAnalyzer = new ResponseAnalyzer({
  returns: { default: defaultResponseAnalyzer },
  errors: [],
  unhandled: new ProblemDetailsResponder(),
});

export default responseAnalyzer;

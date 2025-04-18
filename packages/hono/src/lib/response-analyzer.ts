import ts from 'typescript';

import {
  $types,
  type NaunceResponseAnalyzerFn,
  type ResponseItem,
  type TypeDeriver,
} from '@sdk-it/core';

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

export function defaultResponseAnalyzer(
  handler: ts.ArrowFunction,
  deriver: TypeDeriver,
) {
  const contextVarName = handler.parameters[0].name.getText();
  const responsesList: ResponseItem[] = [];
  const visit = handlerVisitor((node, statusCode, headers, contentType) => {
    responsesList.push({
      headers: headers ? Object.keys(deriver.serializeNode(headers)) : [],
      contentType,
      statusCode: statusCode ? resolveStatusCode(statusCode) : '200',
      response: node ? deriver.serializeNode(node) : undefined,
    });
  }, contextVarName);
  visit(handler.body);
  return responsesList;
}

export function streamText(
  handler: ts.ArrowFunction,
  deriver: TypeDeriver,
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
  handler: ts.ArrowFunction,
  deriver: TypeDeriver,
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

export const httpException: NaunceResponseAnalyzerFn = (
  handler,
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
  'throw.new.HTTPException': httpException,
};

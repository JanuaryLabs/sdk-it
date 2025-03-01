import debug from 'debug';
import { join } from 'node:path';
import type { ComponentsObject } from 'openapi3-ts/oas31';
import { camelcase } from 'stringcase';
import ts from 'typescript';

import { TypeDeriver, getProgram, isCallExpression } from '@lace/core';

import {
  type Method,
  Paths,
  type Selector,
  type SemanticSource,
  toSchema,
} from './paths.ts';

const logger = debug('connect:client');

const visitor: (
  on: (node: ts.Node, statusCode?: ts.Node) => void,
  contextVarName: string,
) => ts.Visitor = (callback, contextVarName) => {
  return (node: ts.Node) => {
    if (ts.isReturnStatement(node) && node.expression) {
      if (
        ts.isCallExpression(node.expression) &&
        node.expression.expression &&
        ts.isPropertyAccessExpression(node.expression.expression)
      ) {
        const propAccess = node.expression.expression;
        if (
          ts.isIdentifier(propAccess.expression) &&
          propAccess.expression.text === contextVarName
        ) {
          if (node.expression.arguments.length > 2) {
            throw new Error('Too many arguments');
          }
          const [body, statusCode, headers] = node.expression.arguments;
          callback(body, statusCode);
        }
      }
    }
    return ts.forEachChild(node, visitor(callback, contextVarName));
  };
};

function analyze(
  sourceFile: ts.SourceFile,
  deriver: TypeDeriver,
  paths: Paths,
) {
  sourceFile.forEachChild((node) => {
    if (
      ts.isExpressionStatement(node) &&
      ts.isCallExpression(node.expression)
    ) {
      const openapiMiddleware = node.expression.arguments.find((arg) =>
        isCallExpression(arg, 'openapi'),
      );
      if (!openapiMiddleware) {
        return;
      }

      if (!ts.isStringLiteral(node.expression.arguments[0])) {
        logger(`Route path must be a string literal`);
        return;
      }

      if (
        !ts.isPropertyAccessExpression(node.expression.expression) ||
        !ts.isIdentifier(node.expression.expression.name)
      ) {
        logger(`Invalid route method`);
        return;
      }
      const path = node.expression.arguments[0].text;
      const method =
        node.expression.expression.name.text.toLowerCase() as Method;

      if (!path || !method) {
        logger(`Failed to extract path or method for route`);
        return;
      }

      const handlerMiddleware = node.expression.arguments.at(-1);
      if (!handlerMiddleware || !ts.isArrowFunction(handlerMiddleware)) {
        console.warn(`No handler middleware found for ${method} ${path}`);
        return;
      }

      const operationName = camelcase(
        `${method} ${path.replace(/[^a-zA-Z0-9]/g, '')}`,
      );

      const selector = openapiMiddleware.arguments.find((arg) =>
        ts.isArrowFunction(arg),
      );
      if (!selector || !ts.isParenthesizedExpression(selector.body)) {
        return;
      }
      if (!ts.isObjectLiteralExpression(selector.body.expression)) {
        return;
      }
      const objExpr = selector.body.expression;
      const props = objExpr.properties.filter(ts.isPropertyAssignment);

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
          console.warn(`No select found in ${name}`);
          continue;
        }
        const against = prop.initializer.properties
          .filter(ts.isPropertyAssignment)
          .find((prop) => prop.name.getText() === 'against');
        if (!against) {
          console.warn(`No against found in ${name}`);
          continue;
        }
        const [, source, selectText] = select.initializer.getText().split('.');
        selectors.push({
          name,
          nullable: against.initializer.getText().includes('nullable'),
          required: !against.initializer.getText().includes('optional'),
          select: selectText,
          against: against.initializer.getText(),
          source: source as SemanticSource,
        });
      }

      const contextVarName = handlerMiddleware.parameters[0].name.getText();
      const responsesList: Array<{ statusCode: string; response: any }> = [];
      const visit = visitor((node, statusCode) => {
        responsesList.push({
          statusCode: statusCode ? resolveStatusCode(statusCode) : '200',
          response: deriver.serializeNode(node),
        });
      }, contextVarName);
      visit(handlerMiddleware.body);
      paths.addPath(operationName, path, method, selectors, responsesList);
    }
  });
}

function resolveStatusCode(node: ts.Node) {
  if (ts.isNumericLiteral(node)) {
    return node.text;
  }
  throw new Error(`Could not resolve status code`);
}

export async function serialize(tsconfigPath: string) {
  logger(`Parsing tsconfig`);
  const program = getProgram(tsconfigPath);
  logger(`Program created`);
  const typeChecker = program.getTypeChecker();
  logger(`Type checker created`);
  const typeDeriver = new TypeDeriver(typeChecker);
  const paths = new Paths();
  analyze(
    program.getSourceFile(join(process.cwd(), 'apps/backend/src/main.ts'))!,
    typeDeriver,
    paths,
  );

  const components: ComponentsObject = {
    schemas: Object.entries(typeDeriver.collector).reduce(
      (acc, [key, value]) => ({ ...acc, [key]: toSchema(value) }),
      {},
    ),
  };

  return {
    paths: await paths.getPaths(),
    components,
  };
}

export type Serialized = ReturnType<typeof serialize>;

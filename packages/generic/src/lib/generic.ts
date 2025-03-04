import debug from 'debug';
import { readFile } from 'node:fs/promises';
import type { ComponentsObject } from 'openapi3-ts/oas31';
import { camelcase } from 'stringcase';
import ts from 'typescript';

import {
  Paths,
  type ResponseItem,
  type Selector,
  type SemanticSource,
  TypeDeriver,
  getProgram,
  isCallExpression,
  isHttpMethod,
  toSchema,
} from '@sdk-it/core';

const logger = debug('@sdk-it/generic');

function visit(
  node: ts.Node,
  responseAnalyzer: (handler: ts.ArrowFunction) => ResponseItem[],
  paths: Paths,
) {
  if (!ts.isCallExpression(node) || node.arguments.length < 2) {
    return moveOn();
  }
  if (
    !ts.isPropertyAccessExpression(node.expression) ||
    !ts.isIdentifier(node.expression.name) ||
    !isHttpMethod(node.expression.name.text)
  ) {
    return moveOn();
  }

  const [pathNode] = node.arguments;
  if (!ts.isStringLiteral(pathNode)) {
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
  if (!handler || !ts.isArrowFunction(handler)) {
    return moveOn();
  }
  const operationName = camelcase(
    `${method} ${path.replace(/[^a-zA-Z0-9]/g, '')}`,
  );
  const selector = validate.arguments.find((arg) => ts.isArrowFunction(arg));
  if (
    !selector ||
    !ts.isParenthesizedExpression(selector.body) ||
    !ts.isObjectLiteralExpression(selector.body.expression)
  ) {
    return moveOn();
  }
  const props = selector.body.expression.properties.filter(
    ts.isPropertyAssignment,
  );

  paths.addPath(
    operationName,
    path,
    method,
    toSelectors(props),
    responseAnalyzer(handler),
  );

  function moveOn() {
    ts.forEachChild(node, (node) => visit(node, responseAnalyzer, paths));
  }
}

function toSelectors(props: ts.PropertyAssignment[]) {
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
  return selectors;
}

export async function analyze(
  tsconfigPath: string,
  config: {
    /**
     * Additional code to inject before resolving zod schemas
     */
    commonZodImport?: string;
    responseAnalyzer: (
      handler: ts.ArrowFunction,
      deriver: TypeDeriver,
    ) => ResponseItem[];
  },
) {
  logger(`Parsing tsconfig`);
  const program = getProgram(tsconfigPath);
  logger(`Program created`);
  const typeChecker = program.getTypeChecker();
  logger(`Type checker created`);
  const typeDeriver = new TypeDeriver(typeChecker);
  const paths = new Paths({
    commonZodImport: config.commonZodImport
      ? await readFile(config.commonZodImport, 'utf-8')
      : '',
  });
  for (const sourceFile of program.getSourceFiles()) {
    if (!sourceFile.isDeclarationFile) {
      logger(`Visiting ${sourceFile.fileName}`);
      visit(
        sourceFile,
        (handler) => config.responseAnalyzer(handler, typeDeriver),
        paths,
      );
    }
  }

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

export type Serialized = ReturnType<typeof analyze>;

import debug from 'debug';
import type { ComponentsObject } from 'openapi3-ts/oas31';
import { camelcase } from 'stringcase';
import ts from 'typescript';

import {
  type InjectImport,
  type NaunceResponseAnalyzer,
  type OnOperation,
  Paths,
  type ResponseAnalyzerFn,
  type ResponseItem,
  type Selector,
  type SemanticSource,
  TypeDeriver,
  getProgram,
  isCallExpression,
  isHttpMethod,
  toSchema,
} from '@sdk-it/core';

export const returnToken = (node: ts.ArrowFunction) => {
  const tokens: { token: string; node: ts.Expression }[] = [];

  const visitor: ts.Visitor = (node) => {
    if (ts.isThrowStatement(node)) {
      if (ts.isNewExpression(node.expression)) {
        tokens.push({
          token: `throw.new.${node.expression.expression.getText()}`,
          node: node.expression,
        });
      }
    }

    if (ts.isReturnStatement(node) && node.expression) {
      if (ts.isCallExpression(node.expression)) {
        tokens.push({
          token: node.expression.expression.getText(),
          node: node.expression,
        });
      }
      return undefined;
    }

    return ts.forEachChild(node, visitor);
  };

  ts.forEachChild(node, visitor);
  return tokens;
};

const logger = debug('@sdk-it/generic');

const jsDocsTags = ['openapi', 'tags', 'description'];

function parseJSDocComment(node: ts.Node) {
  let tags: string[] = [];
  let name = '';
  let description = '';
  for (const tag of ts.getAllJSDocTags(node, (tag): tag is ts.JSDocTag =>
    jsDocsTags.includes(tag.tagName.text),
  )) {
    if (typeof tag.comment !== 'string') {
      continue;
    }
    switch (tag.tagName.text) {
      case 'openapi':
        name = tag.comment;
        break;
      case 'tags':
        tags = tag.comment.split(',').map((tag) => tag.trim());
        break;
      case 'description':
        description = tag.comment;
        break;
    }
  }
  return {
    name,
    tags,
    description,
  };
}

function visit(
  node: ts.Node,
  responseAnalyzer: (
    handler: ts.ArrowFunction,
    token: string,
    node: ts.Node,
  ) => ResponseItem[],
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

  const metadata = parseJSDocComment(node.parent);
  const operationName =
    metadata.name ||
    camelcase(`${method} ${path.replace(/[^a-zA-Z0-9]/g, '')}`);
  if (!validate.arguments.length) {
    return moveOn();
  }
  let selector: ts.Expression | undefined;
  let contentType: ts.Expression | undefined;
  if (validate.arguments.length === 2) {
    contentType = validate.arguments[0];
    selector = validate.arguments[1];
  } else {
    selector = validate.arguments[0];
  }
  if (!ts.isArrowFunction(selector)) {
    return moveOn();
  }
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

  const sourceFile = node.getSourceFile();
  const tokens = returnToken(handler);

  const responses: ResponseItem[] = [];
  for (const { token, node } of tokens) {
    responses.push(...responseAnalyzer(handler, token, node));
  }

  paths.addPath(
    operationName,
    path,
    method,
    contentType
      ? ts.isStringLiteral(contentType)
        ? contentType.text
        : undefined
      : undefined,
    toSelectors(props),
    responses,
    sourceFile.fileName,
    metadata.tags,
    metadata.description,
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
    imports: InjectImport[];
    responseAnalyzer: ResponseAnalyzerFn | NaunceResponseAnalyzer;
    onOperation?: OnOperation;
  },
) {
  logger(`Parsing tsconfig`);
  const program = getProgram(tsconfigPath);
  logger(`Program created`);
  const typeChecker = program.getTypeChecker();

  logger(`Type checker created`);
  const typeDeriver = new TypeDeriver(typeChecker);
  const paths = new Paths({
    imports: config.imports,
    onOperation: config.onOperation,
  });

  for (const sourceFile of program.getSourceFiles()) {
    logger(`Analyzing ${sourceFile.fileName}`);
    if (!sourceFile.isDeclarationFile) {
      logger(`Visiting ${sourceFile.fileName}`);
      visit(
        sourceFile,
        (handler, token, node) => {
          const responseAnalyzer = config.responseAnalyzer;
          if (typeof responseAnalyzer !== 'function') {
            const naunce =
              responseAnalyzer[token] || responseAnalyzer['default'];
            if (!naunce) {
              throw new Error(`No response analyzer for token ${token}`);
            }
            return naunce(handler, typeDeriver, node);
          }
          return responseAnalyzer(handler, typeDeriver);
        },
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

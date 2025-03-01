import debug from 'debug';
import { dirname, join } from 'node:path';
import ts from 'typescript';





const logger = debug('january:client');

export function parseTsConfig(tsconfigPath: string) {
  logger(`Using TypeScript version: ${ts.version}`);
  const configContent = ts.readConfigFile(tsconfigPath, ts.sys.readFile);

  if (configContent.error) {
    console.error(
      `Failed to read tsconfig file:`,
      ts.formatDiagnosticsWithColorAndContext([configContent.error], {
        getCanonicalFileName: (path) => path,
        getCurrentDirectory: ts.sys.getCurrentDirectory,
        getNewLine: () => ts.sys.newLine,
      }),
    );
    throw new Error('Failed to parse tsconfig.json');
  }

  const parsed = ts.parseJsonConfigFileContent(
    configContent.config,
    ts.sys,
    dirname(tsconfigPath),
  );

  if (parsed.errors.length > 0) {
    console.error(
      `Errors found in tsconfig.json:`,
      ts.formatDiagnosticsWithColorAndContext(parsed.errors, {
        getCanonicalFileName: (path) => path,
        getCurrentDirectory: ts.sys.getCurrentDirectory,
        getNewLine: () => ts.sys.newLine,
      }),
    );
    throw new Error('Failed to parse tsconfig.json');
  }
  return parsed;
}
export function getProgram(tsconfigPath: string) {
  const tsConfigParseResult = parseTsConfig(tsconfigPath);
  logger(`Parsing tsconfig`);
  return ts.createProgram({
    options: {
      ...tsConfigParseResult.options,
      noEmit: true,
      incremental: true,
      tsBuildInfoFile: join(dirname(tsconfigPath), './.tsbuildinfo'), // not working atm
    },
    rootNames: tsConfigParseResult.fileNames,
    projectReferences: tsConfigParseResult.projectReferences,
    configFileParsingDiagnostics: tsConfigParseResult.errors,
  });
}
export function getPropertyAssignment(node: ts.Node, name: string) {
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties
      .filter((prop) => ts.isPropertyAssignment(prop))
      .find((prop) => prop.name!.getText() === name);
  }
  return undefined;
}
export function isCallExpression(
  node: ts.Node,
  name: string,
): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    node.expression &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === name
  );
}

export function isInterfaceType(type: ts.Type): boolean {
  if (type.isClassOrInterface()) {
    // Check if it's an interface
    return !!(type.symbol.flags & ts.SymbolFlags.Interface);
  }
  return false;
}
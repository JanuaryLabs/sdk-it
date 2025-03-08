import { pascalcase, spinalcase } from 'stringcase';

import { $types } from '@sdk-it/core';

const typeMappings: Record<string, string> = {
  DateConstructor: 'Date',
};

interface DateType {
  [$types]: string[];
  kind: string;
  optional: boolean;
}

function deserializeTypes(data: DateType, onType: (type: string) => void) {
  const tokens: string[] = [];
  for (const type of data[$types]) {
    if (type === null || type === undefined) {
      tokens.push('any');
    } else if (typeof type === 'string') {
      tokens.push(
        `${typeMappings[type] || type}${data.kind === 'array' ? '[]' : ''}`,
      );
      onType(type);
    } else if ($types in type) {
      tokens.push(deserializeTypes(type, onType));
    }
  }
  return tokens.join(' | ');
}

export function toInterface(
  contents: Record<string, Record<string, Record<string | symbol, any>>>,
  serializeSymbol: symbol,
) {
  const contentMap: Record<
    string,
    { exports: string[]; imports: string[]; content: string }
  > = {};
  for (const [filePath, models] of Object.entries(contents)) {
    for (const [key, model] of Object.entries(models)) {
      const isTypeAlias = model[serializeSymbol];
      const maybeImports = new Set<string>();
      if (isTypeAlias) {
        const prop = deserializeTypes(model as any, (type) => {
          maybeImports.add(type);
        });
        contentMap[filePath] = {
          exports: [key],
          imports: Array.from(maybeImports),
          content: `export type ${pascalcase(key)} = ${prop};`,
        };
      } else {
        const props: string[] = [];
        for (const [prop, data] of Object.entries(model)) {
          const tokens = [prop];
          if (data.optional) {
            tokens.push('?');
          }
          tokens.push(': ');
          tokens.push(
            deserializeTypes(data, (type) => {
              maybeImports.add(type);
            }),
          );
          props.push(tokens.join(''));
        }
        contentMap[filePath] = {
          exports: [key],
          imports: Array.from(maybeImports),
          content: `export interface ${pascalcase(key)} {\n${props.join('\n')}\n}\n`,
        };
      }
    }
  }

  const combinedExports = Object.values(contentMap).flatMap((it) => it.exports);

  const emits: Record<string, string> = {};
  for (const [filePath, { content, exports, imports }] of Object.entries(
    contentMap,
  )) {
    const fileImports: string[] = [];

    for (const importName of imports) {
      if (combinedExports.includes(importName) && importName !== filePath) {
        fileImports.push(
          `import type { ${importName} } from './${spinalcase(importName)}.ts';`,
        );
      }
    }

    // const allButCurrentExports = combinedExports
    //   .filter((it) => !exports.includes(it))
    //   .map((it) => `import { ${it} } from './${it}';`);
    const fileContent = `${fileImports.join('\n')}\n${content}`;
    emits[filePath] = fileContent;
  }
  return emits;
}

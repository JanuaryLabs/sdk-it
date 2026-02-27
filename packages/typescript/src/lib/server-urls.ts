import type { ServerObject } from 'openapi3-ts/oas31';

export function expandServerUrls(servers: ServerObject[]): string[] {
  return servers.flatMap((server) => {
    const variables = server.variables;
    if (!variables || Object.keys(variables).length === 0) {
      return [server.url];
    }

    const entries = Object.entries(variables);
    const valueSets = entries.map(([, variable]) => {
      const enumValues = variable.enum?.map(String);
      return enumValues?.length ? enumValues : [String(variable.default)];
    });

    const combinations = valueSets.reduce<string[][]>(
      (acc, values) => acc.flatMap((combo) => values.map((v) => [...combo, v])),
      [[]],
    );

    return combinations.map((combo) => {
      let url = server.url;
      for (let i = 0; i < entries.length; i++) {
        url = url.replaceAll(`{${entries[i][0]}}`, combo[i]);
      }
      return url;
    });
  });
}

import { forEachOperation } from '@sdk-it/spec';
import { loadSpec } from '@sdk-it/spec/loaders/load-spec.js';
import { TypeScriptGenerator } from '@sdk-it/typescript';

// const { specUrl } = await inquirer.prompt([
//   {
//     type: 'input',
//     name: 'specUrl',
//     message: 'Enter OpenAPI spec URL or path:',
//     default: '/Users/ezzabuzaid/Desktop/January/sdk-it/.yamls/openstatus.json',
//     // '/Users/ezzabuzaid/Desktop/January/sdk-it/.yamls/openstatus.json',
//     // 'https://raw.githubusercontent.com/openai/openai-openapi/refs/heads/master/openapi.yaml',
//   },
// ]);
const specUrl =
  'https://raw.githubusercontent.com/discord/discord-api-spec/refs/heads/main/specs/openapi.json';
export const spec = await loadSpec(specUrl);
console.log('\nLoaded spec:', spec.info.title, spec.info.version, '\n');

export const generator = new TypeScriptGenerator(spec, { output: '' });
const operations = forEachOperation(
  { spec },
  (entry, operation) => [entry, operation] as const,
);

export const availableOperations = operations
  .map(
    ([entry, operation]) =>
      `operationId: operation_${operation.operationId}\nsdk style: '${entry.method.toUpperCase()} ${entry.path}' \nmethod: ${entry.method} http method\nendpoint: ${entry.path}\nsummary: ${operation.summary || 'N/A'}\ndescription: ${operation.description || 'N/A'}`,
  )
  .join('\n')
  .trim();

// const operation = findOperationById('operation_postCheckHttp');
// if (typeof operation !== 'string') {
//   console.log(
//     generator.succinct(operation.entry, operation.operation, {
//       requestBody: JSON.parse(
//         '{"url":"https://www.example.com","method":"GET","headers":[{"key":"x-apikey","value":"supersecrettoken"}],"runCount":1,"regions":["ams"],"aggregated":false}',
//       ),
//       queryParameters: JSON.parse('{}'),
//       pathParameters: JSON.parse('{}'),
//       headers: JSON.parse('{}'),
//       cookies: JSON.parse('{}'),
//     }),
//   );
// }
// const prompt = await readFile(
//   '/Users/ezzabuzaid/Desktop/January/sdk-it/apps/api/src/assets/prompt.txt',
//   'utf-8',
// );

export function findOperationById(operationId: string) {
  const name = operationId.split('operation_')[1];
  if (!name) {
    return `Invalid operation ID format. Expected format: operation_<operationId>. Received: ${operationId}`;
  }
  for (const [entry, operation] of operations) {
    if (operation.operationId === name) {
      return { entry, operation };
    }
  }
  return `Operation with ID: ${operationId} does not exist.`;
}

import { runContentMapper } from 'ts-content-mapper';

import { transform } from './transform.js';

runContentMapper({
  diagnosticSource: 'sdk-it',
  transform: ({ fileName, content }, context) =>
    transform(fileName, content, context.positionEncoding),
});

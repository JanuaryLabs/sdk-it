import augment from './augment.ts';
import fetch from './fetch.ts';
import generate from './generate.ts';
import operations from './operations.ts';
import playground from './playground.ts';
import publish from './publish.ts';

export default {
  ...publish,
  ...augment,
  ...fetch,
  ...generate,
  ...playground,
  ...operations,
};

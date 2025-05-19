/* eslint-disable @nx/enforce-module-boundaries */
// pagination = await pagination.getNextPage();
// console.dir(pagination.getPageData(), { depth: 2 });
// pagination = await pagination.getNextPage();
// console.dir(pagination.getPageData());
import { SdkIt } from './packages/client/dist/index.js';

const client = new SdkIt({
  baseUrl: 'http://localhost:3000',
});

const operationsPagination = await client.request('GET /operations', {
  page: 1,
  pageSize: 2,
});

const operations = operationsPagination.getCurrentPage();

// console.log('hasMore', pagination.metadata);

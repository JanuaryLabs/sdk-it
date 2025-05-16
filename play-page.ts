/* eslint-disable @nx/enforce-module-boundaries */
// pagination = await pagination.getNextPage();
// console.dir(pagination.getPageData(), { depth: 2 });
// pagination = await pagination.getNextPage();
// console.dir(pagination.getPageData());
import { SdkIt } from './packages/client/dist/index.js';

const client = new SdkIt({
  baseUrl: 'http://localhost:3000',
});

const products = await client.request('GET /products', {
  page: 1,
  pageSize: 2,
});
console.log(products.getCurrentPage());
await products.getNextPage();
console.log(products.getCurrentPage());

await pagination.getNextPage();
console.log(pagination.getCurrentPage());
await pagination.getNextPage();
console.log(pagination.getCurrentPage());

for await (const page of resulpaginationt.data) {
  console.dir(page);
}

// console.log('hasMore', pagination.metadata);

// const openai = await new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY,
// }).vectorStores.list();

// openai.iterPages

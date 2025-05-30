import { describe, it } from 'node:test';
import assert from 'node:assert';
import { convertPostmanToOpenAPI, descriptionToText, bodyToSchema } from '../postman/postman-converter.js';
import { join } from 'node:path';
import fs from 'node:fs';

// Helper to construct paths relative to the current file
const currentDir = new URL('.', import.meta.url).pathname;
const testDataDir = join(currentDir, 'test-data');

const loadTestData = (fileName) => {
  const filePath = join(testDataDir, fileName);
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(fileContent);
};

// Minimal Postman collection structure for isolated item testing
const createMinimalCollection = (itemOrItems) => ({
  info: { name: 'Test Collection', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: Array.isArray(itemOrItems) ? itemOrItems : [itemOrItems],
});

const createMinimalCollectionWithAuth = (auth, itemOrItems) => ({
    info: { name: 'Test Collection', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    auth: auth, // Collection level auth
    item: Array.isArray(itemOrItems) ? itemOrItems : [itemOrItems],
  });


describe('Postman Converter Tests', () => {
  describe('Core convertPostmanToOpenAPI Functionality', () => {
    
    describe('URL Parsing and Basic Request Structure', () => {
      const postmanRequestsData = loadTestData('postman-requests.json');
      const openapi = convertPostmanToOpenAPI(postmanRequestsData);

      it('should correctly convert a simple GET request and its path', () => {
        const pathItem = openapi.paths['/users'];
        assert.ok(pathItem, 'Path /users should exist');
        assert.ok(pathItem.get, 'GET method should exist for /users');
        assert.strictEqual(pathItem.get.summary, 'GET Request', 'Summary should match Postman item name');
      });

      it('should derive operationId from item name (example)', () => {
        const pathItem = openapi.paths['/users'];
        assert.ok(pathItem.get.operationId, 'GET /users should have an operationId');
      });
    });

    describe('Request Body Conversion', () => {
      const requestBodyTestCases = [
        {
          name: 'Raw JSON Body',
          requestItemName: 'POST Raw JSON',
          postmanBody: { mode: 'raw', raw: '{"name": "test", "age": 30}' },
          postmanHeaders: [{ key: 'Content-Type', value: 'application/json' }],
          expectedContentType: 'application/json',
          expectedSchema: {
            type: 'object',
            properties: { name: { type: 'string' }, age: { type: 'number' } },
            example: { name: 'test', age: 30 }
          },
          url: 'https://example.com/json_body_test'
        },
        {
          name: 'Raw Text Body',
          requestItemName: 'POST Raw Text',
          postmanBody: { mode: 'raw', raw: 'Hello world' },
          postmanHeaders: [{ key: 'Content-Type', value: 'text/plain' }],
          expectedContentType: 'text/plain',
          expectedSchema: { type: 'string', example: 'Hello world' },
          url: 'https://example.com/text_body_test'
        },
        {
          name: 'x-www-form-urlencoded Body',
          requestItemName: 'POST Urlencoded',
          postmanBody: {
            mode: 'urlencoded',
            urlencoded: [
              { key: 'name', value: 'testuser' },
              { key: 'email', value: 'test@example.com', disabled: true }
            ]
          },
          expectedContentType: 'application/x-www-form-urlencoded',
          expectedSchema: {
            type: 'object',
            properties: { name: { type: 'string', example: 'testuser' } }
          },
          url: 'https://example.com/form_body_test'
        },
        {
          name: 'Multipart/form-data Body',
          requestItemName: 'POST FormData',
          postmanBody: {
            mode: 'formdata',
            formdata: [
              { key: 'file', type: 'file', src: '/path/to/file.txt' },
              { key: 'text_field', type: 'text', value: 'some text' }
            ]
          },
          expectedContentType: 'multipart/form-data',
          expectedSchema: {
            type: 'object',
            properties: {
              file: { type: 'string', format: 'binary' },
              text_field: { type: 'string', example: 'some text' }
            }
          },
          url: 'https://example.com/formdata_body_test'
        }
      ];

      requestBodyTestCases.forEach(tc => {
        it(`should correctly convert ${tc.name}`, () => {
          const postmanCollection = createMinimalCollection({
            name: tc.requestItemName,
            request: {
              method: 'POST',
              url: tc.url,
              header: tc.postmanHeaders || [],
              body: tc.postmanBody
            }
          });
          const openapi = convertPostmanToOpenAPI(postmanCollection);
          const pathKey = new URL(tc.url).pathname;
          const pathItem = openapi.paths[pathKey];

          assert.ok(pathItem.post, `POST method should exist for ${pathKey}`);
          assert.strictEqual(pathItem.post.summary, tc.requestItemName);
          const requestBody = pathItem.post.requestBody;
          assert.ok(requestBody, 'Request body should exist');
          assert.ok(requestBody.content[tc.expectedContentType], `Content-Type ${tc.expectedContentType} should exist`);
          assert.deepStrictEqual(requestBody.content[tc.expectedContentType].schema, tc.expectedSchema, 'Schema not as expected');
        });
      });
    });

    describe('Authentication Conversion', () => {
      const commonItem = { // Used as a base for itemUnderTest, will be deep-copied
        name: 'Test Request With Auth',
        request: { method: 'GET', url: 'https://example.com/auth_test' }
      };
      const itemWithPath = (auth, path = '/auth_test') => ({ // Used as a base for itemUnderTest, will be deep-copied
        name: `Test Request for ${auth.type} on ${path}`,
        request: { method: 'GET', url: `https://example.com${path}`, auth: auth }
      });

      const authTestCases = [
        {
          caseName: 'Collection-level Bearer Token',
          collectionAuth: { type: 'bearer', bearer: [{ key: 'token', value: 'collectionToken', type: 'string' }] },
          itemUnderTestBase: commonItem, 
          expectedSchemeName: 'bearerAuth',
          expectedScheme: { type: 'http', scheme: 'bearer' },
          isCollectionLevel: true
        },
        {
          caseName: 'Request-level API Key (Header)',
          itemAuth: { type: 'apikey', apikey: [{ key: 'in', value: 'header', type: 'string' },{ key: 'key', value: 'X-API-KEY', type: 'string' }] },
          itemUnderTestBase: commonItem,
          expectedSchemeName: 'apiKeyXAPIKEY', 
          expectedScheme: { type: 'apiKey', in: 'header', name: 'X-API-KEY' },
        },
        {
          caseName: 'Request-level API Key (Query)',
          itemAuth: { type: 'apikey', apikey: [{ key: 'in', value: 'query', type: 'string' }, { key: 'key', value: 'apiKeyParam', type: 'string' }] },
          itemUnderTestBase: commonItem,
          expectedSchemeName: 'apiKeyApiKeyParam', 
          expectedScheme: { type: 'apiKey', in: 'query', name: 'apiKeyParam' },
        },
        {
          caseName: 'Request-level Basic Auth',
          itemAuth: { type: 'basic', basic: [{ key: 'username', value: 'user', type: 'string' }, { key: 'password', value: 'pass', type: 'string' }] },
          itemUnderTestBase: commonItem,
          expectedSchemeName: 'basicAuth',
          expectedScheme: { type: 'http', scheme: 'basic' },
        },
        {
          caseName: 'Request-level OAuth2 (Implicit Flow)',
          itemAuth: { type: 'oauth2', oauth2: [{ key: 'grant_type', value: 'implicit', type: 'string' }, { key: 'authUrl', value: 'https://example.com/oauth/authorize', type: 'string' }] },
          itemUnderTestBase: commonItem,
          expectedSchemeName: 'oauth2AuthImplicit', 
          expectedScheme: { type: 'oauth2', flows: { implicit: { authorizationUrl: 'https://example.com/oauth/authorize', scopes: {} } } },
        },
        {
          caseName: 'Request-level No Auth (overrides collection auth)',
          collectionAuth: { type: 'bearer', bearer: [{ key: 'token', value: 'collectionToken', type: 'string' }] }, 
          itemAuth: { type: 'noauth' },
          itemUnderTestBase: commonItem,
          expectedSecurityOnOperation: [], 
        }
      ];

      authTestCases.forEach(tc => {
        it(`should correctly convert ${tc.caseName}`, () => {
          let itemToTest = JSON.parse(JSON.stringify(tc.itemUnderTestBase)); // Deep copy
          if(tc.itemAuth) {
            itemToTest.request.auth = tc.itemAuth;
            // Ensure unique URL for each specific test case if itemAuth is present
            const uniquePathSegment = tc.expectedSchemeName || `noauth_${Date.now()}`;
            itemToTest.request.url = `https://example.com/test_${uniquePathSegment}`;
          }
          
          const postmanCollection = createMinimalCollectionWithAuth(tc.collectionAuth, itemToTest);
          const openapi = convertPostmanToOpenAPI(postmanCollection);
          
          const pathKey = new URL(itemToTest.request.url).pathname;
          const operation = openapi.paths[pathKey]?.get;
          assert.ok(operation, `Operation not found for ${pathKey} in case '${tc.caseName}'`);

          if (tc.isCollectionLevel) {
            assert.ok(openapi.components.securitySchemes[tc.expectedSchemeName], `Collection scheme ${tc.expectedSchemeName} not defined`);
            assert.deepStrictEqual(openapi.components.securitySchemes[tc.expectedSchemeName], tc.expectedScheme);
            assert.deepStrictEqual(openapi.security, [{ [tc.expectedSchemeName]: [] }], 'Global security not applied');
            assert.deepStrictEqual(operation.security, [{ [tc.expectedSchemeName]: [] }], `Operation should inherit ${tc.expectedSchemeName}`);
          } else if (tc.expectedSecurityOnOperation !== undefined) {
             assert.deepStrictEqual(operation.security, tc.expectedSecurityOnOperation, `Operation security for '${tc.caseName}' not as expected`);
             if(tc.expectedSchemeName && tc.expectedScheme){ 
                assert.ok(openapi.components.securitySchemes[tc.expectedSchemeName], `Request scheme ${tc.expectedSchemeName} not defined for ${tc.caseName}`);
                assert.deepStrictEqual(openapi.components.securitySchemes[tc.expectedSchemeName], tc.expectedScheme);
             }
          } else { 
            assert.ok(openapi.components.securitySchemes[tc.expectedSchemeName], `Request scheme ${tc.expectedSchemeName} not defined for ${tc.caseName}`);
            assert.deepStrictEqual(openapi.components.securitySchemes[tc.expectedSchemeName], tc.expectedScheme);
            assert.deepStrictEqual(operation.security, [{ [tc.expectedSchemeName]: [] }], `Operation security for ${tc.expectedSchemeName} not applied`);
          }
        });
      });
        
      it('should apply inherited (collection-level) auth if request has no specific auth (using full data)', () => {
        const postmanAuthData = loadTestData('postman-auth.json'); 
        const openapi = convertPostmanToOpenAPI(postmanAuthData);
        const pathItem = openapi.paths['/inherited-auth'].get;
        assert.deepStrictEqual(pathItem.security, [{ bearerAuth: [] }]);
      });
    });

    describe('Folder and Tag Conversion', () => {
      const postmanFoldersData = loadTestData('postman-folders.json');
      const openapi = convertPostmanToOpenAPI(postmanFoldersData);

      it('should create tags from Postman folders and item names', () => {
        assert.ok(openapi.tags, 'Tags array should exist');
        const tagNames = openapi.tags.map(t => t.name).sort();
        assert.deepStrictEqual(tagNames, ['Folder1', 'Request2 Top Level', 'SubFolder1'].sort());
      });

      it('should apply tags to operations based on folder structure', () => {
        const r1f1 = openapi.paths['/f1/r1'].get;
        assert.deepStrictEqual(r1f1.tags, ['Folder1']);
        const r1sf1 = openapi.paths['/f1/sf1/r1'].get;
        assert.deepStrictEqual(r1sf1.tags, ['Folder1', 'SubFolder1']);
        const r2tl = openapi.paths['/r2'].post;
        assert.deepStrictEqual(r2tl.tags, ['Request2 Top Level']);
      });
    });

    describe('Response Conversion', () => {
      const postmanResponsesData = loadTestData('postman-responses.json');
      const openapi = convertPostmanToOpenAPI(postmanResponsesData);
      const responses = openapi.paths['/data'].get.responses;

      it('should convert a successful (200 OK) JSON response', () => {
        assert.ok(responses['200']);
        assert.strictEqual(responses['200'].description, 'OK (Success Response)');
        assert.ok(responses['200'].content['application/json']);
        assert.deepStrictEqual(responses['200'].content['application/json'].schema, {
          type: 'object',
          properties: { id: { type: 'number' }, name: { type: 'string' } },
          example: { id: 1, name: "Sample Data" }
        });
      });

      it('should convert a "Not Found" (404) text response', () => {
        assert.ok(responses['404']);
        assert.strictEqual(responses['404'].description, 'Not Found (Not Found Response)');
        assert.ok(responses['404'].content['text/plain']);
        assert.deepStrictEqual(responses['404'].content['text/plain'].schema, {
          type: 'string',
          example: 'Resource not found'
        });
      });
    });

    describe('Variable Conversion (Path & Query)', () => {
      const postmanVariablesData = loadTestData('postman-variables.json');
      const openapi = convertPostmanToOpenAPI(postmanVariablesData);

      it('should convert Postman path variables to OpenAPI path parameters', () => {
        const pathItem = openapi.paths['/users/{userId}/posts/{postId}'].get;
        assert.ok(pathItem.parameters);
        const userIdParam = pathItem.parameters.find(p => p.name === 'userId');
        assert.deepStrictEqual(userIdParam, { name: 'userId', in: 'path', required: true, description: 'User ID', schema: { type: 'string', default: '123' } });
        const postIdParam = pathItem.parameters.find(p => p.name === 'postId');
        assert.deepStrictEqual(postIdParam, { name: 'postId', in: 'path', required: true, schema: { type: 'string', default: '456' } });
      });

      it('should convert Postman query parameters to OpenAPI query parameters, excluding disabled ones', () => {
        const pathItem = openapi.paths['/search'].get;
        assert.ok(pathItem.parameters);
        const qParam = pathItem.parameters.find(p => p.name === 'q');
        assert.deepStrictEqual(qParam, { name: 'q', in: 'query', required: false, description: 'Search query', schema: { type: 'string', default: 'test' } });
        const typeParam = pathItem.parameters.find(p => p.name === 'type');
        assert.deepStrictEqual(typeParam, { name: 'type', in: 'query', required: false, schema: { type: 'string', default: 'user' } });
        const optionalParam = pathItem.parameters.find(p => p.name === 'optional');
        assert.strictEqual(optionalParam, undefined);
      });
    });
    
    describe('Edge Case Handling (Standard Valid Inputs)', () => {
      const postmanEdgeCasesData = loadTestData('postman-edgecases.json');
      const openapi = convertPostmanToOpenAPI(postmanEdgeCasesData);

      it('should skip items that are not requests or folders', () => {
        assert.strictEqual(Object.keys(openapi.paths).length, 1);
      });

      it('should handle requests defined as simple string URLs (coerced to GET)', () => {
        const pathItem = openapi.paths['/simple-get'];
        assert.ok(pathItem?.get);
        assert.strictEqual(pathItem.get.summary, 'Request as String URL');
      });
    });
  });

  describe('Diverse and Chaotic (but Structurally Valid) Inputs', () => {
    describe('URL Structures', () => {
      it('should handle URL with empty path segments', () => {
        const collection = createMinimalCollection({ name: 'Empty Path Segments', request: { method: 'GET', url: 'https://example.com/api//resource' } });
        let openapi;
        assert.doesNotThrow(() => { openapi = convertPostmanToOpenAPI(collection); });
        assert.ok(openapi.paths['/api/resource'] || openapi.paths['/api//resource']);
      });

       it('should handle URL with many path variables', () => {
        const collection = createMinimalCollection({ name: 'Many Variables', request: { method: 'GET', url: 'https://example.com/:v1/:v2/:v3/:v4/:v5' } });
        let openapi;
        assert.doesNotThrow(() => { openapi = convertPostmanToOpenAPI(collection); });
        assert.ok(openapi.paths['/{v1}/{v2}/{v3}/{v4}/{v5}']);
        const params = openapi.paths['/{v1}/{v2}/{v3}/{v4}/{v5}'].get.parameters;
        assert.strictEqual(params.length, 5);
        assert.ok(params.every(p => p.in === 'path' && p.required === true));
      });

      it('should handle Postman URL object with empty path array', () => {
        const collection = createMinimalCollection({ name: 'Empty Path Array', request: { method: 'GET', url: { raw: 'https://example.com', host: ['example','com'], path: [] } } });
        let openapi;
        assert.doesNotThrow(() => { openapi = convertPostmanToOpenAPI(collection); });
        assert.ok(openapi.paths['/']);
      });
      
      it('should handle Postman URL variable with empty key or value', () => {
        const collection = createMinimalCollection({ name: 'Empty URL Variable Parts', request: { 
            method: 'GET', 
            url: { 
                raw: 'https://example.com/path/:id', host: ['example','com'], path: ['path', ':id'],
                variable: [{key: 'id', value: ''}, {key:'', value:'someValue'}] 
            }
        }});
        let openapi;
        assert.doesNotThrow(() => { openapi = convertPostmanToOpenAPI(collection); });
        const params = openapi.paths['/path/{id}'].get.parameters;
        const idParam = params.find(p=>p.name === 'id');
        assert.strictEqual(idParam.schema.default, '');
        assert.ok(!params.find(p => p.name === ''));
      });
    });

    describe('Request Bodies (Diverse)', () => {
      it('should handle raw body with empty string', () => {
        const collection = createMinimalCollection({ name: 'Empty Raw Body', request: { method: 'POST', url: 'https://example.com/emptyraw', body: { mode: 'raw', raw: ''}, header: [{'key':'Content-Type', 'value':'text/plain'}] } });
        let openapi;
        assert.doesNotThrow(() => { openapi = convertPostmanToOpenAPI(collection); });
        const reqBody = openapi.paths['/emptyraw'].post.requestBody;
        assert.deepStrictEqual(reqBody.content['text/plain'].schema, { type: 'string', example: '' });
      });

      it('should handle urlencoded or formdata as an empty array', () => {
        const collectionUrlencoded = createMinimalCollection({ name: 'Empty Urlencoded', request: { method: 'POST', url: 'https://example.com/emptyurlencoded', body: { mode: 'urlencoded', urlencoded: []} } });
        let openapiUrlencoded;
        assert.doesNotThrow(() => { openapiUrlencoded = convertPostmanToOpenAPI(collectionUrlencoded); });
        assert.ok(openapiUrlencoded.paths['/emptyurlencoded'].post.requestBody.content['application/x-www-form-urlencoded']);
        assert.deepStrictEqual(openapiUrlencoded.paths['/emptyurlencoded'].post.requestBody.content['application/x-www-form-urlencoded'].schema, {type: 'object', properties: {}});

        const collectionFormdata = createMinimalCollection({ name: 'Empty Formdata', request: { method: 'POST', url: 'https://example.com/emptyformdata', body: { mode: 'formdata', formdata: []} } });
        let openapiFormdata;
        assert.doesNotThrow(() => { openapiFormdata = convertPostmanToOpenAPI(collectionFormdata); });
        assert.ok(openapiFormdata.paths['/emptyformdata'].post.requestBody.content['multipart/form-data']);
        assert.deepStrictEqual(openapiFormdata.paths['/emptyformdata'].post.requestBody.content['multipart/form-data'].schema, {type: 'object', properties: {}});
      });
      
      it('should handle request body with disabled: true', () => {
         const collection = createMinimalCollection({ name: 'Disabled Body', request: { method: 'POST', url: 'https://example.com/disabledbody', body: { mode: 'raw', raw: '{"a":"b"}', disabled: true}} });
         let openapi;
         assert.doesNotThrow(() => { openapi = convertPostmanToOpenAPI(collection); });
         assert.strictEqual(openapi.paths['/disabledbody'].post.requestBody, undefined);
      });
    });

    describe('Auth Objects (Diverse)', () => {
      it('should handle auth object with specific type array empty (e.g. apikey: [])', () => {
        const collection = createMinimalCollection({ name: 'Empty API Key Array', request: { method: 'GET', url: 'https://example.com/emptyapikey', auth: { type: 'apikey', apikey: [] } } });
        let openapi;
        assert.doesNotThrow(() => { openapi = convertPostmanToOpenAPI(collection); });
        const securitySchemes = openapi.components?.securitySchemes;
        assert.ok(!securitySchemes || Object.keys(securitySchemes).length === 0);
      });

      it('should inherit collection auth if request auth is null', () => {
        const collection = createMinimalCollectionWithAuth(
            { type: 'bearer', bearer: [{key:'token', value:'tok', type:'string'}] }, 
            { name: 'Null Auth Request', request: { method: 'GET', url: 'https://example.com/nullauth', auth: null } }
        );
        let openapi;
        assert.doesNotThrow(() => { openapi = convertPostmanToOpenAPI(collection); });
        assert.deepStrictEqual(openapi.paths['/nullauth'].get.security, [{bearerAuth: []}]);
      });
    });

    describe('Headers & Parameters (Diverse)', () => {
      it('should handle headers or query params with empty key or value', () => {
        const collection = createMinimalCollection({ name: 'Empty Header/Query Parts', request: { 
            method: 'GET', 
            url: { raw: 'https://example.com/test?p1=v1&=noval&noval2=', host:['h'], path:['test'], query: [{key:'p1',value:'v1'},{key:'', value:'noval'}, {key:'noval2', value:''}]},
            header: [{key:'', value:'emptyKeyHeaderVal'}, {key:'emptyValHeaderKey', value:''}, {key:'X-Normal', value:'val'}] 
        }});
        let openapi;
        assert.doesNotThrow(() => { openapi = convertPostmanToOpenAPI(collection); });
        const params = openapi.paths['/test'].get.parameters;

        assert.ok(params.find(p=>p.name==='p1' && p.in==='query' && p.schema.default === 'v1'));
        assert.ok(params.find(p=>p.name==='noval2' && p.in==='query' && p.schema.default === ''));
        assert.ok(params.find(p=>p.name==='emptyValHeaderKey' && p.in==='header' && p.schema.default === ''));
        assert.ok(params.find(p=>p.name==='X-Normal' && p.in==='header' && p.schema.default === 'val'));
        
        assert.ok(!params.find(p => p.name === '' && p.in === 'query'));
        assert.ok(!params.find(p => p.name === '' && p.in === 'header'));
      });
      
      it('should ignore disabled headers and query parameters', () => {
        const collection = createMinimalCollection({ name: 'Disabled Params', request: { 
            method: 'GET', 
            url: { raw: 'https://example.com/test?q1=v1', host:['h'], path:['test'], query: [{key:'q1',value:'v1'},{key:'q2', value:'v2', disabled:true}]},
            header: [{key:'H1', value:'v1'}, {key:'H2', value:'v2', disabled:true}] 
        }});
        let openapi;
        assert.doesNotThrow(() => { openapi = convertPostmanToOpenAPI(collection); });
        const params = openapi.paths['/test'].get.parameters;
        assert.ok(params.find(p=>p.name==='q1'));
        assert.ok(!params.find(p=>p.name==='q2'));
        assert.ok(params.find(p=>p.name==='H1'));
        assert.ok(!params.find(p=>p.name==='H2'));
      });
    });

    describe('Descriptions (Diverse)', () => {
      it('should handle empty string description for an item', () => {
        const collection = createMinimalCollection({ name: 'Empty Desc Req', description: '', request: { method: 'GET', url: 'https://example.com/empty'} });
        let openapi;
        assert.doesNotThrow(() => { openapi = convertPostmanToOpenAPI(collection); });
        assert.strictEqual(openapi.paths['/empty'].get.description, undefined);
      });

      it('should handle description as object with empty content for an item', () => {
        const collection = createMinimalCollection({ name: 'Empty Content Desc', description: { content: '', type: 'text/markdown' }, request: { method: 'GET', url: 'https://example.com/emptycontent'} });
        let openapi;
        assert.doesNotThrow(() => { openapi = convertPostmanToOpenAPI(collection); });
        assert.strictEqual(openapi.paths['/emptycontent'].get.description, undefined);
      });
    });
  });

  describe('Advanced Edge Case Handling', () => {
    it('should handle collection with empty item array', () => {
      const collection = { info: { name: 'Empty Items', schema: '...' }, item: [] };
      let openapi;
      assert.doesNotThrow(() => { openapi = convertPostmanToOpenAPI(collection); });
      assert.deepStrictEqual(openapi.paths, {}, 'Paths should be empty for empty item array');
      assert.ok(openapi.tags === undefined || openapi.tags.length === 0, 'Tags should be empty or undefined');
    });

    it('should handle folder with empty item array', () => {
      const collection = createMinimalCollection({ name: 'FolderWithEmptyItems', item: [] });
      let openapi;
      assert.doesNotThrow(() => { openapi = convertPostmanToOpenAPI(collection); });
      assert.deepStrictEqual(openapi.paths, {}, 'Paths should be empty');
      assert.ok(openapi.tags.some(tag => tag.name === 'FolderWithEmptyItems'), 'Tag for the empty folder should exist');
    });

    it('should handle unusual HTTP methods (e.g., REPORT)', () => {
      const collection = createMinimalCollection({ name: 'Custom Method', request: { method: 'REPORT', url: 'https://example.com/report' } });
      let openapi;
      assert.doesNotThrow(() => { openapi = convertPostmanToOpenAPI(collection); });
      assert.ok(openapi.paths['/report'].report, 'Custom method "report" should exist');
      assert.strictEqual(openapi.paths['/report'].report.summary, 'Custom Method');
    });
    
    it('should handle deeply nested folder structures and apply tags correctly', () => {
      const collection = createMinimalCollection({
        name: 'L1',
        item: [{
          name: 'L2',
          item: [{
            name: 'L3',
            item: [{
              name: 'L4',
              item: [{ name: 'ReqInL4', request: { method: 'GET', url: 'https://example.com/l4' } }]
            }]
          }]
        }]
      });
      let openapi;
      assert.doesNotThrow(() => { openapi = convertPostmanToOpenAPI(collection); });
      assert.ok(openapi.paths['/l4'].get, 'Request in deeply nested folder not found');
      assert.deepStrictEqual(openapi.paths['/l4'].get.tags, ['L1', 'L2', 'L3', 'L4'].sort());
      const expectedTags = ['L1', 'L2', 'L3', 'L4', 'ReqInL4'].sort(); // ReqInL4 also becomes a tag
      assert.deepStrictEqual(openapi.tags.map(t=>t.name).sort(), expectedTags);
    });

    describe('Complex Auth Override Scenarios', () => {
        const baseCollectionAuth = { type: 'basic', basic: [{key:'u',value:'user'},{key:'p',value:'p'}]}; // Basic: user/p
        const folderAuthBearer = { type: 'bearer', bearer: [{key:'token',value:'foldertoken',type:'string'}]};
        const folderAuthApiKey = { type: 'apikey', apikey: [{key:'in',value:'query'},{key:'key',value:'folderKey'}]};
        const requestAuthBasicOverride = { type: 'basic', basic: [{key:'u',value:'reqUser'},{key:'p',value:'reqP'}]};
        const requestAuthNoAuth = { type: 'noauth' };

        it('Scenario 1: Collection (Basic) -> Folder (Bearer) -> Request (No Auth)', () => {
            const collection = {
                info: { name: 'Auth Scenario 1', schema: '...' },
                auth: baseCollectionAuth,
                item: [{
                    name: 'FolderBearer',
                    auth: folderAuthBearer,
                    item: [{ name: 'ReqNoAuth', request: { method: 'GET', url: 'https://example.com/s1', auth: requestAuthNoAuth } }]
                }]
            };
            const openapi = convertPostmanToOpenAPI(collection);
            assert.deepStrictEqual(openapi.paths['/s1'].get.security, [], 'S1: Expected no auth');
            assert.ok(openapi.components.securitySchemes.basicAuth);
            assert.ok(openapi.components.securitySchemes.bearerAuth); // Scheme name might vary
        });

        it('Scenario 2: Collection (API Key) -> Folder (No Auth) -> Request (Basic Auth)', () => {
             const collectionApiKeyAuth = { type: 'apikey', apikey: [{key:'in',value:'header', name:'X-Coll-Key'}]};
             const collection = {
                info: { name: 'Auth Scenario 2', schema: '...' },
                auth: collectionApiKeyAuth,
                item: [{
                    name: 'FolderNoAuth',
                    auth: {type: 'noauth'}, // This folder has no auth
                    item: [{ name: 'ReqBasicAuth', request: { method: 'GET', url: 'https://example.com/s2', auth: requestAuthBasicOverride } }]
                }]
            };
            const openapi = convertPostmanToOpenAPI(collection);
            assert.deepStrictEqual(openapi.paths['/s2'].get.security, [{basicAuth: []}]); // basicAuth or generated name
            assert.ok(openapi.components.securitySchemes.basicAuth); // basicAuth or generated name
            assert.ok(openapi.components.securitySchemes.apiKeyXCollKey); // apiKeyXCollKey or generated name
            assert.ok(!openapi.paths['/s2'].get.security.find(s => s.apiKeyXCollKey));
        });
        
        it('Scenario 3: Collection (Basic) -> Folder (API Key) -> Request (Inherits Folder Auth)', () => {
            const collection = {
                info: { name: 'Auth Scenario 3', schema: '...' },
                auth: baseCollectionAuth,
                item: [{
                    name: 'FolderApiKey',
                    auth: folderAuthApiKey, // API Key: in query, name folderKey
                    item: [{ name: 'ReqInheritFolder', request: { method: 'GET', url: 'https://example.com/s3' } }] // Inherits folder API key
                }]
            };
            const openapi = convertPostmanToOpenAPI(collection);
            // Scheme name for folderAuthApiKey will be auto-generated, e.g., apiKeyFolderKey
            const apiKeySchemeName = Object.keys(openapi.components.securitySchemes).find(k => k.startsWith('apiKey') && k.toLowerCase().includes('folderkey'));
            assert.ok(apiKeySchemeName, "Folder's API key scheme not found");
            assert.deepStrictEqual(openapi.paths['/s3'].get.security, [{[apiKeySchemeName]: []}]);
            assert.ok(openapi.components.securitySchemes.basicAuth); // Collection level
        });
    });
    
    it('should handle Postman variables in header keys and raw JSON body parts as literal strings', () => {
        const collection = createMinimalCollection([
            { name: 'VarInHeaderKey', request: { method: 'GET', url: 'https://example.com/varhead', header: [{key:'{{headerKey}}', value:'val'}]}},
            { name: 'VarInJson', request: { method: 'POST', url: 'https://example.com/varjson', body: {mode:'raw', raw:'{"{{jsonKey}}":"{{jsonVal}}"}'}, header:[{key:'Content-Type',value:'application/json'}]}}
        ]);
        let openapi;
        assert.doesNotThrow(() => { openapi = convertPostmanToOpenAPI(collection); });
        
        const headerParam = openapi.paths['/varhead'].get.parameters.find(p => p.name === '{{headerKey}}');
        assert.ok(headerParam, 'Variable in header key not preserved literally');
        assert.strictEqual(headerParam.schema.default, 'val');

        const reqBodySchema = openapi.paths['/varjson'].post.requestBody.content['application/json'].schema;
        assert.strictEqual(reqBodySchema.example['{{jsonKey}}'], '{{jsonVal}}', 'Variable in JSON body not preserved literally in example');
        assert.ok(reqBodySchema.properties['{{jsonKey}}'], 'Variable as JSON key not preserved in properties');
    });

    describe('Comprehensive Disabled Item Checks', () => {
        it('should ignore disabled request body', () => {
            const item = { name: 'Disabled Body Req', request: { method: 'POST', url: 'https://example.com/disabled_body', body: { mode: 'raw', raw: 'content', disabled: true } } };
            const openapi = convertPostmanToOpenAPI(createMinimalCollection(item));
            assert.strictEqual(openapi.paths['/disabled_body'].post.requestBody, undefined);
        });
        it('should ignore disabled header', () => {
            const item = { name: 'Disabled Header Req', request: { method: 'GET', url: 'https://example.com/disabled_header', header: [{key:'X-Test', value:'v', disabled: true}]} };
            const openapi = convertPostmanToOpenAPI(createMinimalCollection(item));
            assert.ok(!openapi.paths['/disabled_header'].get.parameters?.some(p => p.name === 'X-Test'));
        });
        it('should ignore disabled query parameter', () => {
            const item = { name: 'Disabled Query Req', request: { method: 'GET', url: { raw:'https://example.com/disabled_query?d=v', host:['e'],path:['p'], query:[{key:'d',value:'v',disabled:true}]}} };
            const openapi = convertPostmanToOpenAPI(createMinimalCollection(item));
            assert.ok(!openapi.paths['/p'].get.parameters?.some(p => p.name === 'd'));
        });
         it('should ignore disabled urlencoded parameter', () => {
            const item = { name: 'Disabled UrlEncoded Param', request: { method: 'POST', url: 'https://example.com/disabled_urlencoded', body: {mode:'urlencoded', urlencoded:[{key:'field1',value:'val1', disabled:true},{key:'field2',value:'val2'}]}} };
            const openapi = convertPostmanToOpenAPI(createMinimalCollection(item));
            const schema = openapi.paths['/disabled_urlencoded'].post.requestBody.content['application/x-www-form-urlencoded'].schema;
            assert.ok(!schema.properties.field1);
            assert.ok(schema.properties.field2);
        });
        it('should ignore disabled formdata parameter', () => {
            const item = { name: 'Disabled FormData Param', request: { method: 'POST', url: 'https://example.com/disabled_formdata', body: {mode:'formdata', formdata:[{key:'file1',type:'file',src:'s1', disabled:true},{key:'text1',type:'text',value:'val2'}]}} };
            const openapi = convertPostmanToOpenAPI(createMinimalCollection(item));
            const schema = openapi.paths['/disabled_formdata'].post.requestBody.content['multipart/form-data'].schema;
            assert.ok(!schema.properties.file1);
            assert.ok(schema.properties.text1);
        });
    });

  });


  describe('Helper Functions', () => {
    describe('descriptionToText', () => {
      const descriptionTestCases = [
        { name: 'string input', input: 'hello', expected: 'hello' },
        { name: 'object input', input: { content: 'world', type: 'text/plain' }, expected: 'world' },
        { name: 'object input with empty content', input: { content: '', type: 'text/plain' }, expected: '' },
        { name: 'null input', input: null, expected: undefined },
        { name: 'undefined input', input: undefined, expected: undefined },
      ];
      descriptionTestCases.forEach(tc => {
        it(`should return correct text for ${tc.name}`, () => {
          assert.strictEqual(descriptionToText(tc.input), tc.expected);
        });
      });
    });

    describe('bodyToSchema', () => {
      const bodyToSchemaTestCases = [
        {
          name: 'valid JSON object string',
          input: '{"key": "value", "num": 1, "bool": true, "arr": [1,2], "obj": {"a": "b"}}',
          expected: {
            type: 'object',
            properties: {
              key: { type: 'string' }, num: { type: 'number' }, bool: { type: 'boolean' },
              arr: { type: 'array', items: { type: 'number' } },
              obj: { type: 'object', properties: { a: { type: 'string' } } }
            },
            example: { key: 'value', num: 1, bool: true, arr: [1,2], obj: {a: "b"} }
          }
        },
        {
          name: 'non-JSON string',
          input: "just a plain string",
          expected: { type: 'string', example: 'just a plain string' }
        },
        { name: 'empty string input', input: "", expected: {type: 'string', example: ""} },
        { name: 'whitespace string input', input: "   ", expected: {type: 'string', example: "   "} },
        { name: 'null input', input: null, expected: undefined },
        { name: 'undefined input', input: undefined, expected: undefined },
        {
          name: 'JSON array of objects string',
          input: '[{"id":1, "name":"item1"}, {"id":2, "active":true}]',
          expected: {
            type: 'array',
            items: { 
              type: 'object',
              properties: { id: { type: 'number' }, name: { type: 'string' }, active: {type: 'boolean'}}
            },
            example: [{"id":1, "name":"item1"}, {"id":2, "active":true}]
          }
        },
        {
          name: 'JSON array of mixed primitives',
          input: '["string", 1, true]',
          expected: { type: 'array', items: { type: 'string' }, example: ["string", 1, true] }
        },
        {
          name: 'empty JSON array string',
          input: '[]',
          expected: { type: 'array', items: {}, example: [] } 
        },
        {
          name: 'empty JSON object string',
          input: '{}',
          expected: { type: 'object', properties: {}, example: {} }
        }
      ];

      bodyToSchemaTestCases.forEach(tc => {
        it(`should correctly convert ${tc.name}`, () => {
          assert.deepStrictEqual(bodyToSchema(tc.input), tc.expected);
        });
      });
    });
  });
});

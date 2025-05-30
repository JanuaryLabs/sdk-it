import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import * as localLoader from '../local-loader.js';
import * as remoteLoader from '../remote-loader.js';
import * as operation from '../operation.js';
import { loadFile, loadSpec } from '../load-spec.js';
// Removed Postman specific imports: convertPostmanToOpenAPI, descriptionToText, bodyToSchema
import { join } from 'node:path';
import fs from 'node:fs';

// Helper to construct paths relative to the current file
const currentDir = new URL('.', import.meta.url).pathname;
const testDataDir = join(currentDir, 'test-data');

// loadTestData is Postman specific, moved.
// const loadTestData = (fileName) => {
//   const filePath = join(testDataDir, fileName);
//   const fileContent = fs.readFileSync(filePath, 'utf-8');
//   return JSON.parse(fileContent);
// };

const validJsonPath = join(testDataDir, 'valid.json');
const validYamlPath = join(testDataDir, 'valid.yaml');
const openapiSpecJsonPath = join(testDataDir, 'openapi-spec.json');
const postmanBasicJsonPath = join(testDataDir, 'postman-basic.json'); // Keep for loadSpec tests


describe('local-loader', () => {
  it('should successfully load valid.json', async () => {
    const content = await localLoader.loadLocal(validJsonPath);
    assert.deepStrictEqual(content, { name: 'test', version: '1.0.0' });
  });

  it('should successfully load valid.yaml', async () => {
    const content = await localLoader.loadLocal(validYamlPath);
    assert.deepStrictEqual(content, { name: 'test', version: '1.0.0' });
  });

  it('should successfully load valid.yml', async () => {
    const filePath = join(testDataDir, 'valid.yml');
    const content = await localLoader.loadLocal(filePath);
    assert.deepStrictEqual(content, { name: 'test', version: '1.0.0' });
  });

  it('should fail to load unsupported.txt', async () => {
    const filePath = join(testDataDir, 'unsupported.txt');
    await assert.rejects(
      localLoader.loadLocal(filePath),
      /Unsupported file extension: .txt/
    );
  });

  it('should fail to load a non-existent file', async () => {
    const filePath = join(testDataDir, 'nonexistent.json');
    await assert.rejects(
      localLoader.loadLocal(filePath),
      /ENOENT: no such file or directory/
    );
  });

  it('should fail to load malformed.json', async () => {
    const filePath = join(testDataDir, 'malformed.json');
    await assert.rejects(
      localLoader.loadLocal(filePath),
      /Unexpected end of JSON input|JSON5Error: EOF reached while parsing object literal|SyntaxError: Unexpected end of JSON input/
    );
  });

  it('should fail to load malformed.yaml', async () => {
    const filePath = join(testDataDir, 'malformed.yaml');
    await assert.rejects(
      localLoader.loadLocal(filePath),
      /YAMLException|YAMLParseError/
    );
  });
});

describe('remote-loader', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    // mock.restoreAll() is in afterEach of load-spec which is safer
  });

  it('should successfully load JSON from URL', async () => {
    const url = 'https://example.com/file.json';
    const mockData = { name: 'remote-json-test', version: '1.0.0' };
    global.fetch = async (fetchUrl) => {
      if (fetchUrl === url) {
        return {
          ok: true,
          json: async () => mockData,
          text: async () => JSON.stringify(mockData),
          headers: new Headers({ 'Content-Type': 'application/json' }),
        };
      }
      throw new Error(`Unexpected fetch call: ${fetchUrl}`);
    };
    const content = await remoteLoader.loadRemote(url);
    assert.deepStrictEqual(content, mockData);
  });

  it('should successfully load YAML (.yaml) from URL', async () => {
    const url = 'https://example.com/file.yaml';
    const mockData = { name: 'remote-yaml-test', version: '1.0.0' };
    const mockYamlString = "name: remote-yaml-test\nversion: '1.0.0'";
    global.fetch = async (fetchUrl) => {
      if (fetchUrl === url) {
        return {
          ok: true,
          json: async () => { throw new Error('Should not call json() for yaml'); },
          text: async () => mockYamlString,
          headers: new Headers({ 'Content-Type': 'application/x-yaml' }), 
        };
      }
      throw new Error(`Unexpected fetch call: ${fetchUrl}`);
    };
    const content = await remoteLoader.loadRemote(url);
    assert.deepStrictEqual(content, mockData);
  });

  it('should successfully load YAML (.yml) from URL', async () => {
    const url = 'https://example.com/file.yml';
    const mockData = { name: 'remote-yml-test', version: '1.0.0' };
    const mockYmlString = "name: remote-yml-test\nversion: '1.0.0'";
    global.fetch = async (fetchUrl) => {
      if (fetchUrl === url) {
        return {
          ok: true,
          json: async () => { throw new Error('Should not call json() for yml'); },
          text: async () => mockYmlString,
          headers: new Headers({ 'Content-Type': 'application/x-yaml' }),
        };
      }
      throw new Error(`Unexpected fetch call: ${fetchUrl}`);
    };
    const content = await remoteLoader.loadRemote(url);
    assert.deepStrictEqual(content, mockData);
  });

  it('should successfully load JSON from URL with no extension (Content-Type based)', async () => {
    const url = 'https://example.com/file-no-ext';
    const mockData = { name: 'no-ext-json', type: 'content-type' };
    global.fetch = async (fetchUrl) => {
      if (fetchUrl === url) {
        return {
          ok: true,
          json: async () => mockData,
          text: async () => JSON.stringify(mockData),
          headers: new Headers({ 'Content-Type': 'application/json' }),
        };
      }
      throw new Error(`Unexpected fetch call: ${fetchUrl}`);
    };
    const content = await remoteLoader.loadRemote(url);
    assert.deepStrictEqual(content, mockData);
  });

  it('should successfully load YAML from URL with no extension (fallback to YAML)', async () => {
    const url = 'https://example.com/file-no-ext-yaml';
    const mockData = { name: 'no-ext-yaml', type: 'fallback' };
    const mockYamlString = "name: no-ext-yaml\ntype: fallback";
    global.fetch = async (fetchUrl) => {
      if (fetchUrl === url) {
        return {
          ok: true,
          json: async () => { throw new Error('Simulated JSON parse error'); },
          text: async () => mockYamlString,
          headers: new Headers({ 'Content-Type': 'text/plain' }), 
        };
      }
      throw new Error(`Unexpected fetch call: ${fetchUrl}`);
    };
    const content = await remoteLoader.loadRemote(url);
    assert.deepStrictEqual(content, mockData);
  });
  
  it('should successfully load JSON from URL with unsupported extension (Content-Type based)', async () => {
    const url = 'https://example.com/file.txt';
    const mockData = { name: 'unsupported-ext-json', type: 'content-type' };
    global.fetch = async (fetchUrl) => {
      if (fetchUrl === url) {
        return {
          ok: true,
          json: async () => mockData,
          text: async () => JSON.stringify(mockData),
          headers: new Headers({ 'Content-Type': 'application/json' }),
        };
      }
      throw new Error(`Unexpected fetch call: ${fetchUrl}`);
    };
    const content = await remoteLoader.loadRemote(url);
    assert.deepStrictEqual(content, mockData);
  });

  it('should successfully load YAML from URL with unsupported extension (fallback to YAML)', async () => {
    const url = 'https://example.com/another.txt';
    const mockData = { name: 'unsupported-ext-yaml', type: 'fallback' };
    const mockYamlString = "name: unsupported-ext-yaml\ntype: fallback";
    global.fetch = async (fetchUrl) => {
      if (fetchUrl === url) {
        return {
          ok: true,
          json: async () => { throw new Error('Simulated JSON parse error for unsupported ext'); },
          text: async () => mockYamlString,
          headers: new Headers({ 'Content-Type': 'text/plain' }), 
        };
      }
      throw new Error(`Unexpected fetch call: ${fetchUrl}`);
    };
    const content = await remoteLoader.loadRemote(url);
    assert.deepStrictEqual(content, mockData);
  });

  it('should fail with a network error (e.g., 404)', async () => {
    const url = 'https://example.com/notfound';
    global.fetch = async (fetchUrl) => {
      if (fetchUrl === url) {
        return {
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: async () => { throw new Error('Should not call');},
          text: async () => 'File not found',
          headers: new Headers(),
        };
      }
      throw new Error(`Unexpected fetch call: ${fetchUrl}`);
    };
    await assert.rejects(
      remoteLoader.loadRemote(url),
      /Failed to fetch spec from https:\/\/example.com\/notfound. Status: 404 Not Found/
    );
  });

  it('should fail if content is neither JSON nor YAML from URL with no extension', async () => {
    const url = 'https://example.com/bad-content';
    global.fetch = async (fetchUrl) => {
      if (fetchUrl === url) {
        return {
          ok: true,
          json: async () => { throw new Error('Simulated JSON parse error'); },
          text: async () => "This is just plain text, not JSON or YAML.",
          headers: new Headers({ 'Content-Type': 'text/plain' }),
        };
      }
      throw new Error(`Unexpected fetch call: ${fetchUrl}`);
    };
    await assert.rejects(
      remoteLoader.loadRemote(url),
      /Failed to parse content from https:\/\/example.com\/bad-content. Content is not valid JSON or YAML./
    );
  });
});

// Postman-converter describe block removed

describe('load-spec', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    mock.restoreAll(); // This will restore mocks from all modules
  });

  describe('loadFile dispatch logic', () => {
    it('should call loadLocal for local paths', async () => {
      const loadLocalMock = mock.method(localLoader, 'loadLocal', async () => ({}));
      // const loadRemoteMock = mock.method(remoteLoader, 'loadRemote'); // Not needed if we check calls.length
      
      await loadFile(validJsonPath);
      
      assert.strictEqual(loadLocalMock.mock.calls.length, 1);
      assert.strictEqual(loadLocalMock.mock.calls[0].arguments[0], validJsonPath);
      // Check remoteLoader.loadRemote was not called if a spy was on it
      // For this test, ensuring loadLocal was called is primary.
    });

    it('should call loadRemote for HTTP URLs', async () => {
      // const loadLocalMock = mock.method(localLoader, 'loadLocal'); // Not needed
      const loadRemoteMock = mock.method(remoteLoader, 'loadRemote', async () => ({}));
      const testUrl = 'http://example.com/spec.json';
      
      await loadFile(testUrl);
      
      assert.strictEqual(loadRemoteMock.mock.calls.length, 1);
      assert.strictEqual(loadRemoteMock.mock.calls[0].arguments[0], testUrl);
      // Check localLoader.loadLocal was not called if a spy was on it
    });
  });

  describe('loadSpec end-to-end behavior', () => {
    let augmentSpecMock;

    beforeEach(() => {
      augmentSpecMock = mock.method(operation, 'augmentSpec', (spec) => ({ ...spec, 'x-sdk-augmented': true }));
    });

    // Helper to load OpenAPI spec JSON for comparison
    const loadOpenAPISpecTestData = () => {
        const fileContent = fs.readFileSync(openapiSpecJsonPath, 'utf-8');
        return JSON.parse(fileContent);
    };
    
    // Helper to load Postman collection for remote mock
    const loadPostmanBasicTestData = () => {
        const fileContent = fs.readFileSync(postmanBasicJsonPath, 'utf-8');
        return JSON.parse(fileContent);
    };


    it('should load and augment local OpenAPI JSON', async () => {
      const spec = await loadSpec(openapiSpecJsonPath);
      const expectedSpec = loadOpenAPISpecTestData();
      assert.deepStrictEqual(spec.info, expectedSpec.info);
      assert.deepStrictEqual(spec.paths, expectedSpec.paths);
      assert.strictEqual(augmentSpecMock.mock.calls.length, 1);
      assert.ok(spec['x-sdk-augmented']);
    });

    it('should load and augment local OpenAPI YAML', async () => {
      const spec = await loadSpec(validYamlPath);
      assert.deepStrictEqual(spec.name, 'test'); // From valid.yaml
      assert.deepStrictEqual(spec.version, '1.0.0'); // From valid.yaml
      assert.strictEqual(augmentSpecMock.mock.calls.length, 1);
      assert.ok(spec['x-sdk-augmented']);
    });

    it('should load and augment remote OpenAPI JSON', async () => {
      const testUrl = 'https://example.com/openapi.json';
      const expectedSpecData = loadOpenAPISpecTestData();
      global.fetch = async (url) => {
        if (url === testUrl) {
          return { ok: true, json: async () => expectedSpecData, text: async () => JSON.stringify(expectedSpecData), headers: new Headers({'Content-Type': 'application/json'}) };
        }
        throw new Error('Unexpected fetch');
      };
      const spec = await loadSpec(testUrl);
      assert.deepStrictEqual(spec.info, expectedSpecData.info);
      assert.strictEqual(augmentSpecMock.mock.calls.length, 1);
      assert.ok(spec['x-sdk-augmented']);
    });

    it('should load and augment remote OpenAPI YAML', async () => {
      const testUrl = 'https://example.com/spec.yaml';
      const expectedSpecData = { name: 'test', version: '1.0.0' }; // Content of valid.yaml
      const yamlString = fs.readFileSync(validYamlPath, 'utf-8');
      global.fetch = async (url) => {
        if (url === testUrl) {
          return { ok: true, text: async () => yamlString, headers: new Headers({'Content-Type': 'application/x-yaml'}) };
        }
        throw new Error('Unexpected fetch');
      };
      const spec = await loadSpec(testUrl);
      assert.deepStrictEqual(spec.name, expectedSpecData.name);
      assert.strictEqual(augmentSpecMock.mock.calls.length, 1);
      assert.ok(spec['x-sdk-augmented']);
    });

    it('should load, convert, and augment local Postman Collection', async () => {
      const spec = await loadSpec(postmanBasicJsonPath);
      assert.strictEqual(spec.info.title, 'Basic Collection'); 
      assert.ok(spec.paths['/get']);
      assert.strictEqual(augmentSpecMock.mock.calls.length, 1);
      assert.ok(spec['x-sdk-augmented']);
    });

    it('should load, convert, and augment remote Postman Collection', async () => {
      const testUrl = 'https://example.com/postman.json';
      const postmanData = loadPostmanBasicTestData();
      global.fetch = async (url) => {
        if (url === testUrl) {
          return { ok: true, json: async () => postmanData, text: async () => JSON.stringify(postmanData), headers: new Headers({'Content-Type': 'application/json'}) };
        }
        throw new Error('Unexpected fetch');
      };
      const spec = await loadSpec(testUrl);
      assert.strictEqual(spec.info.title, 'Basic Collection');
      assert.ok(spec.paths['/get']);
      assert.strictEqual(augmentSpecMock.mock.calls.length, 1);
      assert.ok(spec['x-sdk-augmented']);
    });
  });

  describe('augmentSpec conditional call', () => {
    it('should not call augmentSpec if spec is already augmented', async () => {
      const alreadyAugmentedSpec = { openapi: '3.1.0', info: { title: 'Augmented', version: '1.0' }, paths: {}, 'x-sdk-augmented': true };
      
      const loadLocalMock = mock.method(localLoader, 'loadLocal', async () => alreadyAugmentedSpec);
      const augmentSpecMock = mock.method(operation, 'augmentSpec');

      await loadSpec(validJsonPath); 

      assert.strictEqual(loadLocalMock.mock.calls.length, 1);
      assert.strictEqual(augmentSpecMock.mock.calls.length, 0, 'augmentSpec should not have been called');
      
      // No need to restore loadLocalMock if mock.restoreAll() is in afterEach
    });
  });
});

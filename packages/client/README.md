#### postPublish | _POST /publish_



##### Example usage

```typescript
import { SdkIt } from '@sdkit/sdk';

const sdkIt = new SdkIt({ 
	baseUrl: '/',
	'token': "<token>"
});

const result = await sdkIt.request('POST /publish', {
  "specUrl": "https://example.com"
});;

console.log(result.data)
```

##### Request Body

*This request body is required.*

**Content Type:** `application/json`

**Type:** [`PostPublishInput`](#postpublishinput)

##### Responses

<details>

<summary><b>200</b>  <i>Response for 200</i></summary>


**Content Type:** `application/json`


**Type:** [`PostPublish`](#postpublish)

</details>

<details>

<summary><b>400</b>  <i>Bad Request</i></summary>


**Content Type:** `application/json`


**Type:** [`PostPublish400`](#postpublish400)

</details>

#### postAugment | _POST /augment_



##### Example usage

```typescript
import { SdkIt } from '@sdkit/sdk';

const sdkIt = new SdkIt({ 
	baseUrl: '/',
	'token': "<token>"
});

const result = await sdkIt.request('POST /augment', {
  "specUrl": "https://example.com"
});;

console.log(result.data)
```

##### Request Body

*This request body is required.*

**Content Type:** `application/json`

**Type:** [`PostAugmentInput`](#postaugmentinput)

##### Responses

<details>

<summary><b>200</b>  <i>OK</i></summary>


**Content Type:** `application/json`


**Type:** [`PostAugment`](#postaugment)

</details>

<details>

<summary><b>400</b>  <i>Bad Request</i></summary>


**Content Type:** `application/json`


**Type:** [`PostAugment400`](#postaugment400)

</details>

#### getFetch | _GET /fetch_



##### Example usage

```typescript
import { SdkIt } from '@sdkit/sdk';

const sdkIt = new SdkIt({ 
	baseUrl: '/',
	'token': "<token>"
});

const result = await sdkIt.request('GET /fetch', {});;

console.log(result.data)
```

##### Request Body

**Content Type:** `application/empty`

**Type:** [`GetFetchInput`](#getfetchinput)

##### Responses

<details>

<summary><b>200</b>  <i>Response for 200</i></summary>


**Content Type:** `application/json`


**Type:** [`GetFetch`](#getfetch)

</details>

<details>

<summary><b>400</b>  <i>Bad Request</i></summary>


**Content Type:** `application/json`


**Type:** [`GetFetch400`](#getfetch400)

</details>

#### postGenerate | _POST /generate_



##### Example usage

```typescript
import { SdkIt } from '@sdkit/sdk';

const sdkIt = new SdkIt({ 
	baseUrl: '/',
	'token': "<token>"
});

const stream = await sdkIt.request('POST /generate', {
  "specFile": new Blob(['example'], { type: 'text/plain' })
});

for await (const chunk of stream) {
	console.log(chunk);
}
```

##### Request Body

*This request body is required.*

**Content Type:** `multipart/form-data`

**Type:** [`PostGenerateInput`](#postgenerateinput)

##### Responses

<details>

<summary><b>200</b>  <i>Response for 200</i></summary>


**Content Type:** `text/plain`


**Type:** [`PostGenerate`](#postgenerate)

</details>

<details>

<summary><b>400</b>  <i>Bad Request</i></summary>


**Content Type:** `application/json`


**Type:** [`PostGenerate400`](#postgenerate400)

</details>

#### postPlayground | _POST /playground_



##### Example usage

```typescript
import { SdkIt } from '@sdkit/sdk';

const sdkIt = new SdkIt({ 
	baseUrl: '/',
	'token': "<token>"
});

const result = await sdkIt.request('POST /playground', {
  "specFile": new Blob(['example'], { type: 'text/plain' })
});;

console.log(result.data)
```

##### Request Body

*This request body is required.*

**Content Type:** `multipart/form-data`

**Type:** [`PostPlaygroundInput`](#postplaygroundinput)

##### Responses

<details>

<summary><b>200</b>  <i>Response for 200</i></summary>


**Content Type:** `application/json`


**Type:** [`PostPlayground`](#postplayground)

</details>

<details>

<summary><b>400</b>  <i>Bad Request</i></summary>


**Content Type:** `application/json`


**Type:** [`PostPlayground400`](#postplayground400)

</details>

#### getOperations | _GET /operations_



##### Example usage

```typescript
import { SdkIt } from '@sdkit/sdk';

const sdkIt = new SdkIt({ 
	baseUrl: '/',
	'token': "<token>"
});

const result = await sdkIt.request('GET /operations', {});

for await (const page of result) {
	console.log(page);
}
```

##### Request Body

**Content Type:** `application/empty`

**Type:** [`GetOperationsInput`](#getoperationsinput)

##### Responses

<details>

<summary><b>200</b>  <i>Response for 200</i></summary>


**Content Type:** `application/json`


**Type:** [`GetOperations`](#getoperations)

</details>

<details>

<summary><b>400</b>  <i>Bad Request</i></summary>


**Content Type:** `application/json`


**Type:** [`GetOperations400`](#getoperations400)

</details>
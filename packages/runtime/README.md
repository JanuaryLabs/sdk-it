# @sdk-it/runtime

The HTTP layer of an sdk-it TypeScript client. It sends a request, parses the
response by its Content-Type, and returns a status class (`Ok`, `Created`,
`NotFound`, …). An error status rejects with an `APIError` subclass.

Generated TypeScript SDKs embed the source of this package, so an SDK does not
depend on it at run time. `@sdk-it/rpc` imports it.

## Install

```bash
npm install @sdk-it/runtime
```

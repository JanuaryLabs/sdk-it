# sdk-it Google Tasks (verbatim)

## JanuaryLabs list

### SDK-IT
- [ ] Changes
      1. sdk-it now generates high level readme file including general info about the ...
- [ ] Experiance the vibe eureka moments
- [ ] export preset (prisma), with analysis packages
- [ ] Add watch option
- [ ] docs: react query extension: how to include  cockie.
- [ ] docs: how to include cockies in server side frameworks
- [ ] docs: how to programmatically use sdk-it
- [ ] docs: get started with sdk-it
      - with monorepos
      - non monorepos
      - use completely outside the repo. on a registr...
- [ ] mcp server
- [ ] Create config file.
- [ ] Using with Claude code, cursor and copilot

### docs: how to programmatically use sdk-it

---

## sdk-it - backlog list

### GRPC

### Copilot
- [ ] instead of build stuido like stainless.com we can have studio agent that would update openapi and add metadata to it
      "change the "/products" name to listProducts"

### Reach
- [ ] website example
      https://remix.run/
- [ ] Find how large each market segment is
- [ ] Create sdks with avilable languages as well as apiref using serverize.
- [ ] Split window in the website
      With cli command to fork the result.
      check convex database website
      https://cry...
- [ ] Talk to openapi
      basically chatbot to ask openapi how to  list all assistants or how to create x,...
- [ ] Building on the market place we can add alerts to notify on selected tools spec changes.
      similar ui - https://fontofweb.com
- [ ] Create tutorials
- [ ] Marketplace of popular tools that can be accessed programmatically
      look in postman demos
- [ ] Reach for opensource projects that uses hono and ask them if they would like to use it.
- [ ] Incrementally launch in related discord servers.
- [ ] How about talking with indie hacker that have visible openapi or api ref
- [ ] Check Rand LinkedIn message

### Dart
- [ ] if request body ref is used in multiple places then it should create one with "input" suffix and inherit the common ref
- [ ] array polymorphisim
      check GetLibraryAnalyticsComponentActionsOutput in figma
- [ ] make use of superclases when possible to avoid generating more code
      for example, multiple schemas might have sharable props that can be in one class...
- [ ] different body content type
      some operations have both json and multipart. create base class for this operati...
- [ ] should the input be inlined in the same api call so the user doesn't need to create a construct and use named parameter instead?
      final response = await client.beneficiaries.importBeneficiaries(
      ImportBenef...

### Transport
- [ ] Web socket
      https://www.asyncapi.com/
- [ ] SSE trigger
      It should return a listener
      const listen = await client.request('/sse-endpoint'...

### Typescript
- [ ] support for request with multiple bodies
      1. user must specific accept header to serialize the body with that type
      2. pref...
- [ ] IMPORTANT - properties the ends with square bracket
- [ ] Schema Augmentaion - convert those to plugins
      - Move all request bodies and responses to spec base level requestBodies and res...

### Interceptor
- [ ] Add timing to meta
      sentAt
      receivedAt
      elapsedTime

### Error
- [ ] Detect NetworkError
- [ ] Detect Offline

### RPC
- [ ] 1. infer the type directly (waiting on inference json import github issue)
- [ ] 2. generate types inffered so you do not use typescript logic that much.
- [ ] Typescript lsp plugin

### PROD - Analiser
- [ ] OnOperations should update the path
- [ ] "as const" when applied on array it should take the type of the array not the literal values
      export const daOutputsIndicators: { id: number; description: string }[] = [
      {
      ...
- [ ] matrix arrays not inffered

### New arch
- [ ] We need to slowly move from the tune functions to have processing plugins. For instance first plugin would be to make sure operation is doesn't have dashes.
- [ ] A plugin to enrich operation with example using ai.
- [ ] plugin to ensure at least one success response defined.
      basically we need to slowely move away from tune file
- [ ] A plugin to sort properties.

### Agent Tools
- [ ] export utility function that can transform all openapi operations grouped by tag to instruction.
      Functions like omit, pick and so on

### Framework integrations
- [ ] Angular 21 integration

### Code Snippets
- [ ] Add ask ai button somehow to the code snippets
- [ ] Generate usecase based on the operation

### Readme generation
- [ ] Move request bodies To the end  with toggles
- [ ] Move responses to the end with toggles

### Embedded chatbot

### Generated Mcp

### On going
- [ ] Hire business development
- [ ] API ref docs
- [ ] Generated Mcp
- [ ] Embedded chatbot
- [ ] Automated sdk publishing

### Detect Offline

### Detect NetworkError

### 10 customers
- [ ] https://sonauto.ai/developers
- [ ] https://github.com/rivet-gg
- [ ] https://docs.uploadthing.com/api-reference/openapi-spec
- [ ] https://api.hevyapp.com/docs/

### github action
- [ ] Auto generate changelog
      Only consider current schema versus what it was. no need for list of version as ...
- [ ] publish
      with guide on how to publish to jsr, npm, and github packages

### Create tutorials

### Logging - telemetry

### Angular 21 integration

### Typescript lsp plugin

### Google Discovery spec

### try scalar markdown

### Automated sdk publishing

### API ref docs

### Hire business development

### Can be bragged about
- [ ] Prompt like
      https://developers.cloudflare.com/workers/prompt.txt

### Check Rand LinkedIn message

### matrix arrays not inffered

### https://sonauto.ai/developers

### A plugin to sort properties.

### OnOperations should update the path

### https://api.hevyapp.com/docs/

### Studio to update the docs

### website example
Notes: https://remix.run/

### https://github.com/rivet-gg

### Namespace/group format like (openai)

### PROD - Support variables in server name

### interactive snippets
Notes: https://sandpack.codesandbox.io/

### array polymorphisim
Notes: check GetLibraryAnalyticsComponentActionsOutput in figma

### Generate usecase based on the operation

### Github apps to publish the sdks

### Incrementally launch in related discord servers.

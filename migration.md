# TypeScript 6.0 Migration

Goal: be TS6-native — rely on TS6 defaults, remove redundant config, fix deprecations.

Reference: [Announcing TypeScript 6.0](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/)

## 1. tsconfig.base.json — Remove TS6 Defaults

These options now match TS6 defaults and can be removed:

- [ ] Remove `strict: true` (TS6 default)
- [ ] Remove `module: "ESNext"` (TS6 default is `esnext`)
- [ ] Remove `target: "ESNext"` — TS6 defaults to `es2025` (floating). Decision: keep if you want `ESNext` specifically, remove to adopt floating `es2025`
- [ ] Remove `lib: ["ESNext"]` — auto-derived from target. Same decision as `target`
- [ ] Remove `useUnknownInCatchVariables: true` (subsumed by `strict`, now default)
- [ ] Remove `noUnusedLocals: false` (already the default)

Keep explicitly (NOT TS6 defaults):
`isolatedModules`, `moduleResolution: "bundler"`, `composite`, `declaration`, `declarationMap`,
`emitDeclarationOnly`, `importHelpers`, `noEmitOnError`, `noFallthroughCasesInSwitch`,
`noImplicitOverride`, `noImplicitReturns`, `skipLibCheck`, `allowImportingTsExtensions`,
`verbatimModuleSyntax`

## 2. tsconfig.base.json — Remove Pre-existing Redundancy

Not TS6-specific, just cleanup:

- [ ] Remove `forceConsistentCasingInFileNames: true` (default since TS 4.x)

## 3. Remove Duplicate `forceConsistentCasingInFileNames` from Package tsconfigs

Already inherited from `tsconfig.base.json` (and is the TS default). Remove from 13 package tsconfigs that redundantly re-declare it.

## 4. Remove `baseUrl` (deprecated in TS6)

Remove `"baseUrl": "."` from all 17 tsconfig files. The two test tsconfigs with `paths` don't need it since paths use `./` prefixes.

- [ ] `packages/core/tsconfig.lib.json`
- [ ] `packages/core/tsconfig.test.json` (has `paths`)
- [ ] `packages/generic/tsconfig.lib.json`
- [ ] `packages/generic/tsconfig.test.json` (has `paths`)
- [ ] `packages/hono/tsconfig.lib.json`
- [ ] `packages/hono/tsconfig.test.json`
- [ ] `packages/spec/tsconfig.lib.json`
- [ ] `packages/spec/tsconfig.test.json`
- [ ] `packages/rpc/tsconfig.lib.json`
- [ ] `packages/rpc/tsconfig.test.json`
- [ ] `packages/typescript/tsconfig.lib.json`
- [ ] `packages/typescript/tsconfig.test.json`
- [ ] `packages/cli/tsconfig.lib.json`
- [ ] `packages/dart/tsconfig.lib.json`
- [ ] `packages/python/tsconfig.lib.json`
- [ ] `packages/readme/tsconfig.lib.json`
- [ ] `packages/vite/tsconfig.lib.json`

## 5. Remove `esModuleInterop` (always enabled in TS6, cannot be false)

- [ ] `packages/apiref/tsconfig.app.json` — remove `"esModuleInterop": true`

## 6. Simplify `lib` Arrays (`dom.iterable` and `dom.asynciterable` merged into `dom`)

- [ ] `packages/apiref/tsconfig.app.json` — `["DOM", "DOM.Iterable", "ESNext"]` → `["DOM", "ESNext"]`
- [ ] `packages/shadcn/tsconfig.lib.json` — `["DOM", "DOM.Iterable", "DOM.AsyncIterable"]` → `["DOM"]`

## 7. Handle `noUncheckedSideEffectImports` (new default: `true`)

TS6 validates that side-effect imports resolve. Only 1 instance in codebase:

`packages/apiref/app/root.tsx:15` — `import './styles.css'`

`vite/client` (already in apiref's `types`) declares `*.css` modules, so this should resolve. Test after upgrade — if it fails, add `"noUncheckedSideEffectImports": false` to `packages/apiref/tsconfig.app.json`.

## 8. Update `peerDependencies` and `devDependencies`

- [ ] `package.json` (root devDeps) — `"typescript": "^6.0.0"`
- [ ] `packages/core/package.json` — `"typescript": "^6.0.0"`
- [ ] `packages/generic/package.json` — `"typescript": "^6.0.0"`
- [ ] `packages/hono/package.json` — `"typescript": "^6.0.0"`

## 9. Verified Clean (no action needed)

These TS6 deprecations were checked against the codebase — none apply:

- `import ... assert` syntax (0 instances — no migration to `with` needed)
- `module` keyword for namespaces (0 instances)
- `/// <reference no-default-lib="true"/>` (0 instances)
- `alwaysStrict: false` (not set anywhere)
- `allowSyntheticDefaultImports: false` (not set anywhere)
- `target: es5` (not used)
- `downlevelIteration` (not used)
- `outFile` (not used)
- `module: amd/umd/systemjs/none` (not used)
- `moduleResolution: node` / `classic` (not used)

## 10. Verify After Upgrade

### `nodenext` packages

`readme`, `dart`, `python` override to `"module": "nodenext"`. These are code generators that emit `.js` extensions — `nodenext` is correct. Verify they compile cleanly.

### TypeScript Compiler API

`packages/hono/src/lib/constant-value.ts` calls `checker.getConstantValue()` for enum resolution. Run hono tests to catch any API behavior changes.

### `tsc` CLI behavior change

Running `tsc foo.ts` in a directory with `tsconfig.json` now errors. Use `--ignoreConfig` flag if needed. This may affect scripts or CI that invoke `tsc` with file arguments.

## 11. Optional: TS7 Prep

- `--stableTypeOrdering` flag makes TS6 type ordering match TS7. Useful for comparing declaration emit between versions. Not for long-term use (up to 25% slowdown).
- `ignoreDeprecations: "6.0"` temporarily silences all deprecation errors. Will NOT work in TS7.
- `npx @andrewbranch/ts5to6` automates `baseUrl` removal and `rootDir` fixes.

## Post-migration

- [ ] `npm install typescript@6`
- [ ] `nx run-many --target=typecheck` — verify all packages compile
- [ ] Run full test suite
- [ ] Run `npx @andrewbranch/ts5to6` to catch anything missed

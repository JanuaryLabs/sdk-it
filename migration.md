# TypeScript 6 migration

Status: complete for TypeScript 6.0.3.

The workspace installs TypeScript `^6.0.3`, the newest stable 6.x release at the time of this migration. The public packages that directly use the compiler API require that same TypeScript 6 baseline:

```json
"typescript": "^6.0.3"
```

This range is declared by `@sdk-it/cli`, `@sdk-it/core`, `@sdk-it/generic`, and `@sdk-it/hono`. TypeScript 5 is not part of the supported public contract. TypeScript 6.0.3 is the version exercised by this repository's typechecks and integration tests.

## Toolchain compatibility

The dependency tree was resolved without `legacy-peer-deps`.

| Tool                                    | Selected version | TypeScript 6 evidence                                                                                               |
| --------------------------------------- | ---------------: | ------------------------------------------------------------------------------------------------------------------- |
| TypeScript                              |            6.0.3 | Latest published stable 6.x release                                                                                 |
| TypeScript-ESLint                       |           8.63.0 | Peer range `>=4.8.4 <6.1.0`                                                                                         |
| React Router                            |           7.18.1 | Peer range `^5.1.0 \|\| ^6.0.0`                                                                                     |
| Twoslash / Twoslash CDN                 |            0.3.9 | Peer range `^5.5.0 \|\| ^6.0.0`                                                                                     |
| Nx                                      |           23.0.2 | Current Nx suite, including its dedicated Vitest plugin and `@phenomnomnominal/tsquery` 6.2.0 (`typescript >3.0.0`) |
| `vite-plugin-dts`                       |            5.0.3 | Uses `unplugin-dts` 1.0.3, whose TypeScript peer is `>=4`; API Extractor is an unused optional peer                 |
| Prettier                                |            3.9.5 | Parses the repository's explicit-resource-management syntax                                                         |
| `@trivago/prettier-plugin-sort-imports` |            6.0.2 | Uses a Babel parser version that supports explicit resource management                                              |

The old import-sorting plugin was the formatting failure: Prettier could parse `await using` when the repository plugins were disabled, while plugin 5.2.2 failed in Babel with a missing `explicitResourceManagement` parser plugin. Upgrading the import-sorting plugin fixed the configured formatting path.

## tsconfig audit

All 39 checked-in `tsconfig*.json` files were audited against the installed TypeScript 6.0.3 implementation and then exercised through their Nx typecheck targets.

The shared configuration intentionally keeps these explicit options:

- `target: "ESNext"` keeps the compiler-API packages and declaration builds on the repository's existing rolling JavaScript/lib target. TypeScript 6 otherwise defaults to ES2025 and derives the module kind from the target.
- `moduleResolution: "bundler"` matches the ESM/bundler-style source imports. The Dart, Python, and README generators explicitly override both `module` and `moduleResolution` to `nodenext` because their emitted imports follow Node's `.js` extension rules.
- `composite`, `declaration`, `declarationMap`, and `emitDeclarationOnly` define the Nx project-reference and declaration-output contract.
- `rootDir` and `outDir` remain explicit in every emitting package config, preserving declaration paths and avoiding inferred output-layout drift.
- `types` remains explicit in every leaf config that needs Node, Vite, React Router, CSS module, or image declarations. TypeScript 6 defaults ambient type discovery to an empty list.
- `isolatedModules`, `verbatimModuleSyntax`, `allowImportingTsExtensions`, `importHelpers`, `noEmitOnError`, `noFallthroughCasesInSwitch`, `noImplicitOverride`, `noImplicitReturns`, and `skipLibCheck` preserve existing build and checking behavior; they are not redundant TypeScript 6 defaults for this repository.
- `lib` remains explicit only for browser packages: API reference uses `DOM` plus `ESNext`, and Shadcn uses `DOM`. The now-redundant `DOM.Iterable` and `DOM.AsyncIterable` entries are absent.

The following migration cleanup is complete:

- Removed explicit `noUnusedLocals: false`; `false` is already the default.
- Removed the duplicate root `target` override; it inherits `ESNext` from `tsconfig.base.json`.
- Removed deprecated `baseUrl` and redundant `forceConsistentCasingInFileNames` / `esModuleInterop` settings.
- Confirmed there is no deprecated `moduleResolution: node/classic`, ES5 target, `downlevelIteration`, `outFile`, legacy AMD/UMD/System module output, `import ... assert` syntax, namespace `module` keyword, or `no-default-lib` reference.
- Confirmed the API reference's CSS side-effect import resolves through its explicit `vite/client` type entry while TypeScript 6's `noUncheckedSideEffectImports` default is active.
- Applied Nx 23's TypeScript sync generator and official Nx migrations. Package-level solution configs now reference only their local lib/test configs; runtime configs retain the cross-package references required for declaration ordering. Nx's release-tag and Vitest plugin configuration are on the current shape.

No `ignoreDeprecations` escape hatch is used.

## Generated output and caches

`*.tsbuildinfo` is ignored globally. The previously tracked Python and Vite root build-info files were removed; package builds continue to place their configured build info under ignored `dist` directories.

Builds still emit JavaScript runtime entrypoints and `.d.ts` declarations. The CLI integration suite also imports a newly generated client directly in Node, proving generated package exports still resolve to `dist/index.js` with `dist/index.d.ts` types rather than raw TypeScript runtime files.

## Verification status

- A clean `npm ci` succeeds without `legacy-peer-deps`.
- `npm ls typescript --all` exits cleanly with TypeScript 6.0.3 satisfying every SDK-IT workspace peer. `vite-plugin-dts` 5 removes the previous API Extractor/TypeScript 5.8 subtree because declaration bundling is not enabled. Nx ESLint 23 still privately owns TypeScript 5.9.3; that is an upstream implementation dependency, not part of SDK-IT's supported TypeScript contract.
- All 14 package typecheck targets pass.
- All package test targets pass except the pre-existing `@sdk-it/spec` behavioral failures (10 failures, with no spec source or test changes in this migration).
- The TypeScript peer-range dependency-check failures are resolved. Remaining lint errors in Core (`zod` reported unused) and Hono (an existing lazy-load boundary finding) are unrelated pre-existing lint debt and were not changed.
- The configured Prettier check passes for the explicit-resource-management test file.

Nx commands that construct the API reference route graph need `VITE_SPEC` set to a reachable OpenAPI document. Migration verification used a minimal local OpenAPI fixture so project-graph construction did not depend on the network.

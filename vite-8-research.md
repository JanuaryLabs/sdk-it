# Deep Research: Vite 8 Migration for sdk-it

## Executive Summary

Vite 8.0 was released on March 12, 2026, and represents the most significant architectural change since Vite 2 — replacing both esbuild and Rollup with [Rolldown](https://github.com/rolldown/rolldown), a unified Rust-based bundler delivering 10-30x faster builds. The current latest patch is [Vite 8.0.7](https://www.npmjs.com/package/vite?activeTab=versions "vite npm versions"). The project currently runs Vite 6.3.4 with `rolldown-vite@latest` used experimentally in the apiref package.

**Migration is partially blocked**: `@nx/vite` stable (22.6.4) does not support Vite 8 — support exists only in [22.7.0-beta.8](https://github.com/nrwl/nx/releases "Nx Releases"). Two plugins (`vite-plugin-singlefile`, `vite-plugin-node-polyfills`) also lack Vite 8 peer dep support. The recommended path is to **upgrade to Vite 7 first** (smooth from 6), then move to Vite 8 once `@nx/vite` stable ships support.

## Research Overview

- **Sub-Questions Analyzed**: 5
- **Queries Executed**: 21 queries across 5 batches
- **Sources**: 25 total (15 authoritative / 60%, 18 recent / 72%)
- **Iterations**: 2

## Findings

### 1. Vite 8 Release & Core Architecture

Vite 8.0.0 shipped on March 12, 2026, following a [beta on December 3, 2025](https://vite.dev/blog/announcing-vite8-beta "Vite 8 Beta: The Rolldown-powered Vite (Vite, 2025-12-03)"). The release unifies the bundler story: Rolldown replaces both esbuild (used for dep optimization and JS transforms) and Rollup (used for production builds). [Oxc](https://oxc.rs/) now handles JavaScript transformation and minification instead of esbuild. According to [The Register](https://www.theregister.com/2026/03/16/vite_8_rolldown/ "Vite team claims 10-30x faster builds with Rolldown (The Register, 2026-03-16)"), builds are 10-30x faster.

An experimental **Full Bundle Mode** is in development, which bundles modules during dev similar to production — preliminary results show 3x faster dev server startup, 40% faster full reloads, and 10x fewer network requests for large projects.

**Key Insights**:
- Rolldown is still technically at release candidate status; its minifier is in alpha — [Vite: Announcing Vite 8](https://vite.dev/blog/announcing-vite8 "Vite 8.0 is out! (Vite, 2026-03-12)")
- Vite, Rolldown, and Oxc are all maintained by VoidZero (same team) — [VoidZero](https://voidzero.dev/posts/announcing-rolldown-vite "Announcing Rolldown-Vite (VoidZero, 2025)")
- The `rolldown-vite` package (used by apiref) is no longer needed — its changes are merged into `vite@8` — [Vite: Announcing Vite 8](https://vite.dev/blog/announcing-vite8 "Vite 8.0 is out! (Vite, 2026-03-12)")

### 2. Breaking Changes (v6 → v7 → v8)

Since this project is on Vite 6.3.4, it needs to cross two major versions.

#### Vite 7 Breaking Changes (June 24, 2025)

Per the [Vite 7 announcement](https://vite.dev/blog/announcing-vite7 "Vite 7.0 is out! (Vite, 2025-06-24)"):

- **Node.js 18 dropped** — requires Node.js 20.19+ or 22.12+ (project uses Node 24.11.1, so OK)
- **Sass legacy API removed** — only modern API supported
- **Default browser target** changed from `modules` to `baseline-widely-available`
- **Lightning CSS** for CSS minification by default
- **CJS module import** handling changed (consistent behavior)
- Plugin authors: may need `moduleType: 'js'` in load/transform hooks

#### Vite 8 Breaking Changes (March 12, 2026)

Per the [Vite 8 migration guide](https://vite.dev/guide/migration "Migration from v7 (Vite, 2026)"):

- **`build.rollupOptions`** → deprecated, renamed to **`build.rolldownOptions`** (auto-converted)
- **`worker.rollupOptions`** → deprecated, renamed to **`worker.rolldownOptions`**
- **`optimizeDeps.esbuildOptions`** → deprecated, use **`optimizeDeps.rolldownOptions`** (auto-converted)
- **`esbuild` config option** → deprecated, use **`oxc`** (auto-converted)
- **`transformWithEsbuild`** → migrate to **`transformWithOxc`**
- **`import.meta.hot.accept`** — URL no longer supported, must use id
- **package.json resolution** — no longer uses heuristic for browser vs module fields; respects `resolve.mainFields` order
- **`output.manualChunks`** object form removed, function form deprecated → use Rolldown's `codeSplitting`
- **`build.rolldownOptions.watch.chokidar`** removed → use `build.rolldownOptions.watch.watcher`
- **esbuild** is now an optional peer dep (no longer bundled)

**Key Insights**:
- Vite 8 has a compatibility layer that auto-converts old config → most projects work without config changes — [Vite: Migration Guide](https://vite.dev/guide/migration "Migration from v7 (Vite, 2026)")
- For complex projects, Vite recommends: first switch to `rolldown-vite` on Vite 7, then upgrade to Vite 8 — [Vite: Announcing Vite 8](https://vite.dev/blog/announcing-vite8 "Vite 8.0 is out! (Vite, 2026-03-12)")
- Since apiref already uses `rolldown-vite@latest`, it's already been through the hardest part

### 3. Plugin Ecosystem Compatibility

| Plugin | Version | Vite 8 Status | Notes |
|--------|---------|---------------|-------|
| `@vitejs/plugin-react` | 6.0.1 | ✅ Supported | v6 uses Oxc, removes Babel dep. v5 also works |
| `@vitejs/plugin-react-swc` | 4.3.0 | ✅ Supported | Compatible |
| `@tailwindcss/vite` | 4.2.2+ | ✅ Supported | [Vite 8 support merged](https://github.com/tailwindlabs/tailwindcss/pull/19790 "Add support for Vite 8 (Tailwind, 2026-03-12)") same day as release |
| `vite-plugin-comlink` | 5.1.0 | ✅ Compatible | Peer dep `>=4` |
| `@react-router/dev` | 7.6.2+ | ✅ Supported | [Support added April 2, 2026](https://github.com/remix-run/react-router/discussions/14869 "Vite 8 support discussion (React Router, 2026)") |
| `vitest` | 4.1.3 | ✅ Supported | Full Vite 8 support |
| `vite-plugin-dts` | 4.5.4 | ⚠️ Untested | No explicit Vite 8 peer dep update found |
| `vite-plugin-node-polyfills` | 0.23.0 | ❌ Warnings | [esbuild deprecation warning](https://github.com/davidmyersdev/vite-plugin-node-polyfills/issues/142 "Vite 8 esbuild warning (GitHub, 2026)"), not actively maintained |
| `vite-plugin-singlefile` | 2.2.0 | ❌ Blocked | Peer dep `^5 || ^6 || ^7` — no Vite 8 support |
| `@nx/vite` | 22.6.4 (stable) | ❌ Blocked | Peer dep `^5 || ^6 || ^7`. [Beta 22.7.0-beta.8 has support](https://github.com/nrwl/nx/issues/34849 "feat(@nx/vite): Add support for Vite 8 (Nx, 2026)") |

**Key Insights**:
- **3 blockers**: `@nx/vite`, `vite-plugin-singlefile`, `vite-plugin-node-polyfills` — all lack Vite 8 peer deps in stable
- The `@nx/vite` blocker is the most critical since it's the build orchestrator — workaround is npm overrides or using the beta
- Official first-party plugins (`@vitejs/plugin-react`, `@tailwindcss/vite`) are all compatible
- `rolldown-vite` in apiref can be replaced with `vite@^8.0.0` directly

### 4. Node.js & Toolchain Requirements

Both Vite 7 and 8 require Node.js 20.19+ or 22.12+ — these ranges ensure `require(esm)` works without a flag, allowing Vite to be distributed as ESM only. The project runs Node 24.11.1, which exceeds this requirement.

**Key Insights**:
- Node.js requirement is not a blocker for this project
- ESM-only distribution means Vite can no longer be `require()`-d from CJS configs

### 5. rolldown-vite Status & Transition

The `rolldown-vite` package was a technical preview for testing Rolldown integration with Vite 7. Now that Vite 8 has merged all changes, `rolldown-vite` is no longer needed. The apiref package currently uses `"vite": "npm:rolldown-vite@latest"` — this should be replaced with `"vite": "^8.0.0"` when migrating.

**Key Insights**:
- `rolldown-vite` latest was v7.3.1 — it served its purpose as a migration bridge
- Switching from `rolldown-vite` to `vite@8` should be seamless since the APIs converged
- The apiref package is already running Rolldown under the hood, making its Vite 8 migration the smoothest

## Synthesis

The Vite 6 → 8 migration for sdk-it involves two hops (6→7→8), but the actual code changes are minimal due to backward compatibility layers. The biggest risk isn't code — it's **ecosystem readiness**. Three plugins and the Nx integration lack stable Vite 8 support.

The apiref package is the best-positioned for migration since it already uses `rolldown-vite`. The `@sdk-it/vite` plugin package needs its peer deps updated from `^6.0.0 || ^7.0.0` to include `^8.0.0`.

**Consensus** (3+ sources agree):
- Rolldown integration is production-ready and delivers major speed improvements — [Vite](https://vite.dev/blog/announcing-vite8), [The Register](https://www.theregister.com/2026/03/16/vite_8_rolldown/), [VoidZero](https://voidzero.dev/posts/announcing-rolldown-vite), [Medium](https://medium.com/@onix_react/vite-8-0-released-fbf23ade5f79)
- Most existing plugins work out of the box — [Vite Migration Guide](https://vite.dev/guide/migration), [Vite 8 Announcement](https://vite.dev/blog/announcing-vite8), [DEV Community](https://dev.to/gabrielenache/vite-8-is-here-and-it-changes-everything-about-frontend-builds-45ci)
- Backward compatibility layers auto-convert old config options — [Vite Migration Guide](https://vite.dev/guide/migration), [byteiota](https://byteiota.com/vite-8-0-rolldown-migration-guide-10-30x-faster-builds/)

**Contradictions**:
- None identified — the migration path is well-documented and consistent across sources.

**Research Gaps**:
- `vite-plugin-dts` Vite 8 compatibility is untested/undocumented — needs hands-on testing
- No timeline for `@nx/vite` stable Vite 8 support (beta exists but no ETA for stable)

## Recommendations

### Critical (Do First)
1. **Wait for `@nx/vite` stable Vite 8 support** — The Nx beta (22.7.0-beta.8) has it, but using beta Nx in a monorepo is risky. Once Nx 22.7.0 stable ships, the path is clear. Monitor [nrwl/nx#34849](https://github.com/nrwl/nx/issues/34849). Alternatively, upgrade Nx to 22.7.0-beta if you're comfortable with beta tooling.

2. **Upgrade to Vite 7 now as an intermediate step** — Vite 7 is described as a "smooth update" from 6. This gets you on the latest stable while waiting for Vite 8 ecosystem to mature. The `@sdk-it/vite` peer dep already allows `^7.0.0`. — [Vite 7 Announcement](https://vite.dev/blog/announcing-vite7)

3. **Audit `vite-plugin-node-polyfills` usage** — Determine if it's still needed. If so, consider switching to `rolldown-plugin-node-polyfills` or the built-in Vite approach. The current plugin [has open issues](https://github.com/davidmyersdev/vite-plugin-node-polyfills/issues/142) with Vite 8.

### Important (Do Next)
4. **Replace `rolldown-vite` with `vite@^8.0.0` in apiref** — When migrating, remove the npm alias `"vite": "npm:rolldown-vite@latest"` and use the official package directly. The APIs are identical. — [Vite 8 Announcement](https://vite.dev/blog/announcing-vite8)

5. **Update `@sdk-it/vite` peer deps** — Add `^8.0.0` to the vite peer dependency: `"vite": "^6.0.0 || ^7.0.0 || ^8.0.0"`. — [npm: vite](https://www.npmjs.com/package/vite)

6. **Upgrade `@vitejs/plugin-react` to v6.0.1** — This removes Babel dependency and uses Oxc for React Refresh. If you need Babel for custom transforms, add `@rolldown/plugin-babel` separately. — [npm: @vitejs/plugin-react](https://www.npmjs.com/package/@vitejs/plugin-react)

7. **Upgrade `@tailwindcss/vite` to 4.2.2+** — Adds Vite 8 peer dep support. — [Tailwind PR #19790](https://github.com/tailwindlabs/tailwindcss/pull/19790)

### Optional (Consider)
8. **Replace deprecated config options** — While auto-converted, consider updating `build.rollupOptions` → `build.rolldownOptions` and `esbuild` → `oxc` in any vite configs to remove deprecation warnings. — [Vite Migration Guide](https://vite.dev/guide/migration)

9. **Check `vite-plugin-singlefile` for updates** — Currently blocked at `^7.0.0` peer dep. Monitor the [GitHub repo](https://github.com/richardtallent/vite-plugin-singlefile) for a Vite 8 release or consider inlining as a custom plugin if it's simple enough.

10. **Test Full Bundle Mode (experimental)** — Once on Vite 8, try the experimental full bundle mode for dev if the monorepo has slow dev startup. — [Vite 8 Announcement](https://vite.dev/blog/announcing-vite8)

## References

### Official Documentation
- **[Vite: Announcing Vite 8](https://vite.dev/blog/announcing-vite8)** (2026-03-12). "Vite 8.0 is out!"
- **[Vite: Migration from v7](https://vite.dev/guide/migration)** (2026-03-12). "Migration Guide"
- **[Vite: Announcing Vite 8 Beta](https://vite.dev/blog/announcing-vite8-beta)** (2025-12-03). "Vite 8 Beta: The Rolldown-powered Vite"
- **[Vite: Announcing Vite 7](https://vite.dev/blog/announcing-vite7)** (2025-06-24). "Vite 7.0 is out!"
- **[Vite: Breaking Changes](https://vite.dev/changes/)** (2026). "Breaking Changes reference"
- **[Vite: Releases](https://vite.dev/releases)** (2026). "Release history"

### Package Registries
- **[npm: vite](https://www.npmjs.com/package/vite?activeTab=versions)** (2026-04-09). Latest 8.0.7
- **[npm: @vitejs/plugin-react](https://www.npmjs.com/package/@vitejs/plugin-react)** (2026-03). v6.0.1
- **[npm: @nx/vite](https://www.npmjs.com/package/@nx/vite)** (2026-04). v22.6.4 stable
- **[npm: @tailwindcss/vite](https://www.npmjs.com/package/@tailwindcss/vite)** (2026-03). v4.2.2+
- **[npm: vite-plugin-node-polyfills](https://www.npmjs.com/package/vite-plugin-node-polyfills)** (2025). v0.23.0

### GitHub Issues & PRs
- **[Nx: Add Vite 8 support](https://github.com/nrwl/nx/issues/34849)** (2026-03). Feature request with beta resolution
- **[Tailwind: Vite 8 support PR](https://github.com/tailwindlabs/tailwindcss/pull/19790)** (2026-03-12). Merged same day
- **[vite-plugin-node-polyfills: esbuild warning](https://github.com/davidmyersdev/vite-plugin-node-polyfills/issues/142)** (2026). Deprecation warning with Vite 8
- **[React Router: Vite 8 support](https://github.com/remix-run/react-router/discussions/14869)** (2026-04-02). Peer dep updated

### Blog Posts & Articles
- **[The Register: Vite 8 Rolldown](https://www.theregister.com/2026/03/16/vite_8_rolldown/)** (2026-03-16). "Vite team claims 10-30x faster builds"
- **[VoidZero: Announcing Rolldown-Vite](https://voidzero.dev/posts/announcing-rolldown-vite)** (2025). Background on rolldown-vite
- **[DEV Community: Vite 8 Changes](https://dev.to/gabrielenache/vite-8-is-here-and-it-changes-everything-about-frontend-builds-45ci)** (2026). Overview of changes
- **[byteiota: Migration Guide](https://byteiota.com/vite-8-0-rolldown-migration-guide-10-30x-faster-builds/)** (2026). Practical migration walkthrough

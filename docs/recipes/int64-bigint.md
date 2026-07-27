# 64-bit integers (`int64`/`uint64`)

SDK-IT does not treat 64-bit integers specially. The `format` is documentation,
and every generated type follows the **wire encoding**:

| OpenAPI                         | Generated TypeScript | Zod (emitted client) |
| ------------------------------- | -------------------- | -------------------- |
| `type: integer, format: int64`  | `number`             | `z.number().int()`   |
| `type: integer, format: uint64` | `number`             | `z.number().int()`   |
| `type: string, format: int64`   | `string`             | `z.string()`         |
| `type: string, format: uint64`  | `string`             | `z.string()`         |

The same rule applies to the other generators: Dart emits `int` or `String`,
and Python emits `int` or `str`, according to the OpenAPI `type`.

## Why no bigint

`bigint` is representationally correct for the int64 domain but awkward for
consumers: it does not `JSON.stringify`, `1n + 1` throws, and it spreads through
every downstream type. For the common case—a 64-bit identifier that is passed
around without arithmetic—that is friction for no benefit. SDK-IT surfaces the
wire type directly. Convert a lossless string with `BigInt(value)` only where
arithmetic is required; converting an already-rounded `number` cannot recover
lost precision.

## Lossless 64-bit: encode as a string

A JS `number` (and every IEEE-754-based JSON parser) is exact only within ±2⁵³. A `type: integer` value larger than that is rounded by `JSON.parse` — there is no client-side rescue that isn't guesswork.

**If you need values beyond 2⁵³ to survive, encode them as strings** — `type: string, format: int64`. This is the standard cross-language convention (Google's protobuf→JSON mapping, Stripe, Discord, Twitter all do it), a string survives `JSON.parse` untouched, and SDK-IT hands it to you as a clean `string`.

```ts
// Recommended for snowflakes / DB bigint PKs / anything > 2^53
{ type: 'string', format: 'int64' }   // → string, lossless

// Fine for small counters / values that fit in a double
{ type: 'integer', format: 'int64' }  // → number, lossy past 2^53
```

## Server side (`@sdk-it/hono`, `@sdk-it/generic`)

`z.int64()`/`z.uint64()`/`z.bigint()` in your Hono routes generate `type: integer, format: int64`/`uint64` in the spec (documentation). If you want lossless 64-bit IDs, model them as strings in your route schema (`z.string().regex(/^\d+$/)`) so the client and wire both stay lossless.

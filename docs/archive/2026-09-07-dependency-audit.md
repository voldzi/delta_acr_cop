# Dependency audit — 2026-09-07
`pnpm outdated -r` was run after the workspace update. It reported no outdated
runtime dependency. Material runtime updates include MapLibre GL 6.7.0, Matrix
JS SDK 42.3.0, LiveKit client 2.22.2/server 2.18.0, TanStack React Table 9.2.4,
React 19.2.8, Fastify 5.12.3, Vite 8.2.2 and Cesium 1.145.0.

Two development packages intentionally remain behind the registry's overall
latest major:

- `@types/node` 24.13.3 follows the repository's Node.js 24 runtime. The
  registry's 26.x types would describe APIs unavailable in production.
- TypeScript 6.0.3 is the newest version inside the declared
  `typescript-eslint` 8.69 compatibility range (`<6.1.0`). TypeScript 7.0.2 was
  tested during the audit and reverted because it creates an unsupported peer
  combination.

`pnpm peers check`, type checking and the release checks determine whether this
exception remains safe. Revisit TypeScript 7 when a released
`typescript-eslint` version declares support.

COP Mobile pins Matrix Rust Components Swift 26.09.07 and LiveKit Swift 2.16.0,
which were the latest upstream tags checked on the audit date. The Matrix binary
contains an iOS XCFramework and cannot be validated by a macOS `swift test`;
validation belongs to the pinned iOS simulator build.

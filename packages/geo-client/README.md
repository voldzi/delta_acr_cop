# `@zeleznalady/geo-client`

Framework-neutral map primitives shared by Zelezna Lady applications. The
package contains pure MapLibre-compatible configuration builders, safe GeoJSON
normalizers, clustering helpers, route rendering specifications and bounds
calculation.

The package deliberately contains no React components, network clients,
authentication, persistence or COP domain types. Applications keep ownership
of their APIs, databases and presentation. MapLibre remains an application
dependency; this package does not bundle another runtime copy.

COP is the first consumer. Cross-repository consumers must use a published,
versioned package rather than importing source files from the COP repository.

## Released package

Version `0.1.0` is distributed as an immutable public release asset:

```bash
pnpm add https://github.com/voldzi/delta_acr_cop/releases/download/geo-client-v0.1.0/zeleznalady-geo-client-0.1.0.tgz
```

Consumers must pin this published versioned URL (or a later explicit release),
never a branch or a path inside the COP working tree. The artifact checksum and
publication status are recorded in the COP integration documentation. A future
authenticated organization package registry may preserve the same package name
and semantic versioning contract.

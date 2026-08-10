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

## Prepared package release

Version `0.1.0` is prepared for distribution as an immutable release asset:

```bash
pnpm add https://github.com/voldzi/delta_acr_cop/releases/download/geo-client-v0.1.0/zeleznalady-geo-client-0.1.0.tgz
```

The URL becomes valid only after the release is explicitly published. Consumers
must pin a published versioned URL (or a later explicit release), never a branch
or a path inside the COP working tree. The prepared artifact checksum and its
publication status are recorded in the COP integration documentation. The
preferred target remains an authenticated organization package registry under
the same package name and semantic versioning contract.

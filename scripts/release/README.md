# Reviewed COP catalog/auth/location release worker

`cop-catalog-maintain-worker.py` is the application-owned worker for the exact
25 October 2026 API/web candidate pair. It is not a Root installer and cannot
create its own approval, runtime attestation or account-erasure proof.

The separately installed infrastructure broker exposes only fixed status,
read-only evidence and activation operations. It executes an approved worker
as the existing deployment user. Installation of that broker does not arm a
release or give this worker authority to modify protected files.

Required inputs are a Root-sealed manifest, complete application evidence and
candidate-bound runtime proofs. Historical reports retain their original date
and image bindings. They must not be described as fresh candidate tests.
The existing API guard remains authoritative; no reset, deletion of pending
state or automatic fallback to an older API is implemented here.

The worker verifies the complete active pointer against the guard's shorter
public validation result. It validates the web's effective environment,
runtime settings and network identities without printing their contents.
The web is recreated only after the API guard has committed the new API and
fresh owner-readiness/authentication/login checks pass. Only `cop-web` is
selected for that Compose operation, without dependencies or image builds.

Run the focused tests with:

```sh
python3 -I -B scripts/release/test_cop_catalog_maintain_worker.py
```

This worker is not yet installed or armed. See
`docs/testing/catalog-auth-location-candidate-20261025.json` for the bounded
verification results and remaining production gates. A failed generic API
transition may remain pending and require an explicitly reviewed recovery;
the worker must not invent recovery authority.

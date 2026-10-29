# ADR 0059: Fresh authority for the existing planning flag

Status: accepted for source implementation; production acceptance recorded separately.

The historical V3 operation is immutable and expired. Its reader also binds an
older SIM image. Rewriting its timestamps, broadening that reader or substituting
a new target inside its old proof would destroy the original evidence boundary.

Add a separate V4 proof family for the existing planning flag. Preserve the
complete historical V3 reader and its files. A fresh Root-owned case binds the
current source pointer, parent proof, actual environment and unchanged Compose,
actual test receipts and a finite mutation window. Only the flag can change;
existing credentials, access controls and erasure protections remain identical.
The exact optional `cleanScope` in existing parent bindings is validated and
retained. Unknown scope/metadata is rejected.

Root supplies the separately reviewed controller, explicit approval, backups,
CAS, lock and single-use execution. An inverse requires its own fresh case and
the committed V4 enable parent, and must restore the entire original environment.
There is no automatic retry or rollback and no general configuration capability.

See [the exact source and operational protocol](../testing/cop-planning-enable-v4-20261030.md).

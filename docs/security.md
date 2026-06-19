# Security

This is the standard security entry point for COP. Detailed security
documentation remains in:

- [Security index](security/00_INDEX.md)
- [Security architecture](security/01_SECURITY_ARCHITECTURE.md)
- [RBAC/ABAC](security/02_RBAC_ABAC.md)
- [Identity and access](security/03_IDENTITY_AND_ACCESS.md)
- [Source and device identity](security/04_SOURCE_AND_DEVICE_IDENTITY.md)
- [Audit](security/05_AUDIT.md)
- [MDM/MAM endpoint trust](security/06_MDM_MAM_ENDPOINT_TRUST.md)
- [Continuous ATO](security/07_CONTINUOUS_ATO.md)
- [Threat model](security/08_THREAT_MODEL.md)
- [Integration risk register](security/09_INTEGRATION_RISK_REGISTER.md)

Operational rule: do not commit secrets. `.env.example` contains placeholders
only; real secrets are configured outside the repository.

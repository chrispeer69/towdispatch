# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| latest  | :white_check_mark: |

Only the latest release on the `master` branch receives security updates.

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

Instead, report them privately:

1. **Email**: Send details to **security@ustowdispatch.com**
2. **GitHub Private Advisory**: Use the [Security Advisories](https://github.com/chrispeer69/towcommand/security/advisories/new) feature

### What to include

- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept
- Any suggested remediation (optional, but appreciated)

### Response timeline

| Action                    | SLA           |
|---------------------------|---------------|
| Acknowledgement           | 48 hours      |
| Initial triage            | 5 business days |
| Critical/High fix shipped | 7 days        |
| Medium fix shipped        | 30 days       |
| Low fix shipped           | 90 days       |

## Dependency Management

- **Dependabot** is enabled for automated dependency updates
- **Weekly security scans** run via GitHub Actions (CodeQL + `pnpm audit`)
- Vulnerability remediation SLAs are documented in `compliance/policies/vulnerability-management.md`

## Security Controls

TowCommand Pro implements the following security measures:

- **Authentication**: JWT-based with access/refresh token rotation, MFA (TOTP)
- **Authorization**: Role-based access control (RBAC) with row-level security (RLS) in PostgreSQL
- **Encryption**: TLS in transit, AES-256-GCM for secrets at rest (TOTP keys, OAuth tokens)
- **Rate Limiting**: Redis-backed throttling (global + per-endpoint)
- **Input Validation**: Zod schemas on all API boundaries
- **Content Security Policy**: Strict CSP headers via `@fastify/helmet`
- **PII Scrubbing**: Automated PII redaction in logs
- **Audit Logging**: All sensitive operations are logged with actor, action, and timestamp

## Secrets

- **Never** commit `.env` files or real credentials to the repository
- Use `.env.example` as a template — all values are placeholders
- Rotation procedures: `docs/runbooks/secrets-rotation.md`

# Security Policy

Security is especially important for iGrow Reports because the platform handles authentication, advertising-platform integrations, access tokens, multi-tenant data, and privileged server-side operations.

## Reporting a vulnerability

Please **do not open a public GitHub issue** for a suspected vulnerability.

If GitHub private vulnerability reporting is enabled for this repository, use that channel. Otherwise, contact the repository owner privately through the contact options available on the GitHub profile and include only the minimum information needed to reproduce the issue safely.

Please include:

- A clear description of the vulnerability
- The affected component or route
- Reproduction steps or a minimal proof of concept
- The potential impact
- Any suggested mitigation, if known

Do not include real client data, production tokens, credentials, or secrets in a report.

## Scope

Security-sensitive areas include, but are not limited to:

- Authentication and session handling
- Organization and client authorization
- Row Level Security policies
- API tokens and secrets
- Advertising-platform integrations
- Webhooks
- Report sharing and client access
- Server-side privileged operations
- Dependency vulnerabilities

## Disclosure

Please allow the maintainers a reasonable opportunity to investigate and address a valid report before public disclosure.

## Supported version

Security fixes are currently applied to the latest state of the default branch and the most recent public release.

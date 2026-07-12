# Security

Report vulnerabilities privately to the repository owner. Do not include secrets, provider tokens, passwords, or personal travel information in public issues.

Production requirements:

- Rotate `AUTH_SECRET_KEY` and all provider credentials before launch.
- Use separate staging and production credentials.
- Require PostgreSQL, Redis, HTTPS, secure cookies, CSRF enforcement, and admin approval.
- Keep `.env`, databases, logs, and CrewAI runtime files out of Git.
- Review Sentry events for accidental personal data before enabling production event capture.
- Run dependency audits and the full CI suite before deployment.

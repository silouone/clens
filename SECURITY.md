# Security Policy

## Reporting a Vulnerability

Please report security vulnerabilities **privately** — do not open a public
GitHub issue for security problems.

- **Preferred:** open a [GitHub private security advisory](https://github.com/silouone/clens/security/advisories/new)
  (Security → Advisories → "Report a vulnerability").
- **Alternative:** email **silouane.galinou.dev@gmail.com** with the subject
  line `clens security`.

Please include a description of the issue, reproduction steps, affected
version(s), and any relevant logs or proof-of-concept. We aim to acknowledge
reports within 5 business days and will keep you updated on remediation
progress. Please give us a reasonable window to ship a fix before any public
disclosure.

## Supported Versions

cLens is pre-1.0; only the latest released version receives security fixes.

## Data Handling (important)

cLens is **local-first**: all capture data stays on your machine, there are no
network calls and no telemetry. However, capture writes the **full JSONL
payload of every hook event** to `.clens/sessions/` — including complete tool
call arguments and outputs.

**This means secrets can be persisted to disk.** If a session involves
credentials, API keys, tokens, or sensitive file contents, those values are
written verbatim into the local JSONL files. Treat the `.clens/` directory as
sensitive:

- Keep `.clens/` out of version control (it is gitignored by default).
- Do not share raw session files or exports without reviewing them for secrets.
- Rotate any credential you suspect was captured before sharing a trace.

This is a deliberate, documented trade-off — cLens captures everything so the
analysis is faithful. There is no inline redaction at capture time.

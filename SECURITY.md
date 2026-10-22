# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Report them privately by emailing the maintainer directly, or via a `SECURITY`-titled issue on [Gitee](https://gitee.com/zwxwrich/raise/issues) (keep sensitive details out of the issue body; we will follow up privately).

You can expect an initial response within a few days. Once the issue is confirmed, we will prepare a fix and credit you in the release notes if you wish.

## Scope notes

This application handles API keys for LLM providers:

- Keys are supplied by the user via environment variables (referenced as `$VAR` in `models.json`) and are never stored in this repository or bundled into releases.
- User data under `~/.pi/agent/` (`sessions/*.jsonl`, `auth.json`) may contain sensitive content. Be careful what you include in bug reports — redact keys and personal data.

If you find a code path that could leak keys into logs, the renderer, or crash reports, that is in scope and we'd like to hear about it.

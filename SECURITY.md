# Security Policy

## Project status

Spark to Script is pre-alpha software. There is no stable or production-supported release yet. Security fixes are applied to the current `main` branch; older snapshots may not receive fixes.

## Report a vulnerability

Do not open a public issue for a suspected vulnerability or include secrets, private prompts, generated scripts, or exploit details in public discussion.

Use GitHub's private vulnerability reporting for this repository:

<https://github.com/trigeek/spark-to-script/security/advisories/new>

Include the affected revision, impact, reproduction steps, and the smallest safe proof of concept. Please allow maintainers time to investigate before public disclosure. This project does not currently offer a bug bounty or guaranteed response time.

## Current security boundary

- The app is intended for loopback-only, local single-user use.
- It has no authentication, authorization, hosted tenant isolation, or public-network hardening.
- Do not bind or proxy it to a LAN or public interface.
- Creative inputs, run events, generated text, and artifacts are stored in local SQLite in plaintext.
- Anyone who can read the local database or machine account may be able to read that content.
- The current foundation does not accept or store model API keys. Future BYOK work must keep credentials out of URLs, browser storage, logs, events, project Memory, and committed files.
- Do not use highly sensitive material unless you have reviewed and accepted these limitations.

If you accidentally commit or disclose a real credential, revoke it at the provider immediately. Deleting it from a later commit does not remove it from Git history.

## Out of scope for this foundation

Internet-facing deployment, multi-user hosting, shared workstations, untrusted reverse proxies, and production handling of regulated or highly sensitive data are unsupported. A future hosted mode would require a separate authenticated security design.

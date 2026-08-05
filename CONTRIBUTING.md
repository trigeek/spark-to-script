# Contributing

Thank you for helping improve Spark to Script.

## Good ways to help now

- Open a focused issue for a bug, security-safe reproduction, product question, or small proposal.
- Improve documentation, tests, accessibility, error clarity, or local developer experience.
- Discuss larger changes in an issue before investing in an implementation.

Keep changes small and preserve the project's core contract: the Agent proposes, the creator reviews, and only an explicit apply action changes canonical content. Production code must never fall back to simulated Agent results.

## Traction-first contribution gate

This project launches under `AGPL-3.0-only` without a contributor license agreement (CLA) or commercial-license document.

Issues and pull requests are welcome immediately. However, maintainers will not merge a **substantive external code contribution** until the project has adopted a legally reviewed CLA or has obtained equivalent explicit permission from that contributor for commercial relicensing. This preserves the option to offer a separate commercial license later while keeping accepted community work available in the public AGPL project.

This is a temporary merge gate, not a CLA hidden in this file. Opening an issue or pull request does not grant rights beyond the license and permissions explicitly attached to the contribution. Maintainers will trigger and document the appropriate process when the first substantive contribution is ready to merge.

Small corrections that do not create a meaningful copyright or relicensing dependency may be handled case by case.

## Pull-request checklist

- Explain the user-facing problem and the smallest change that solves it.
- Add or update tests for changed behavior.
- Include explicit failure behavior; do not make modeled or fixture output look real.
- Keep provider SDK types outside the domain and application contracts.
- Preserve the two-space UI and the `proposal -> review -> apply` workflow.
- Run tests and builds for every changed package.
- Do not include API keys, real prompts, generated scripts, SQLite files, screenshots with private data, or machine-specific paths.
- Confirm that your contribution is your own work or that you have the right to submit it.

## Development setup

See [README.md](README.md) for local setup and verification commands. Report vulnerabilities through the private process in [SECURITY.md](SECURITY.md), not a public issue.

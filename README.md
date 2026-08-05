# Spark to Script

**Spark to Script is an open-source AI script agent that turns a spark into a script you approve.**

It is designed for creators who begin with an intent, question, or rough idea—not with a folder of sources. Evidence can be found by the Agent or added by the creator, but it supports the work instead of defining it.

> **Status: pre-alpha foundation.** The local project/run/SSE persistence skeleton is available. Real BYOK model connections, search, evidence collection, and the complete intent-to-reviewed-script workflow are planned milestones, not current capabilities.

## Product workflow

Spark to Script keeps one canonical creative project and two focused spaces:

- **Co-create (`共创`)** — develop intent, evaluate evidence-backed choices, confirm a direction, shape the structure, and review draft proposals.
- **Final Review (`终稿审阅`)** — review the canonical script line by line, accept or reject revision proposals, and create a new version only after explicit approval.

The Agent always follows:

```text
proposal -> review -> apply
```

It must never silently replace canonical content. Sources are supporting evidence; the creator's confirmed decisions and script versions remain the durable project state.

## What works in this foundation

- Local creative-project, Agent-run, event, and proposed-artifact persistence in SQLite.
- Durable Server-Sent Events replay for run progress.
- Cancellation, retry as a new run, refresh restoration, and restart recovery foundations.
- The two-space creator interface, backed by the local API rather than browser-owned project state.
- Provider-neutral domain and application boundaries for a replaceable `ModelGateway`.

There is intentionally **no production fake model**. Until a real BYOK gateway is implemented and configured, starting a production Agent run is rejected before a run is created with:

```text
model_gateway_not_configured
```

Tests may inject deterministic test gateways. Test output is never a production fallback and is never presented as an Agent result.

## Run locally

Prerequisites:

- Node.js 22.5 or newer
- npm

Start the API in one terminal:

```bash
cd server
npm install
npm run dev
```

Start the web app in another terminal:

```bash
cd app
npm install
npm run dev
```

Open the loopback URL printed by Vite. Both services are intended to bind to `127.0.0.1` by default.

Run the verification suites separately:

```bash
cd server
npm test
npm run build

cd ../app
npm test
npm run build
```

## Local data and security boundary

This pre-alpha is a **local-only, single-user application**. It has no authentication, authorization, hosted multi-user boundary, or remote-deployment hardening. Do not expose either service to a LAN or the public internet.

Project prompts, run events, model text, and proposed artifacts are stored in a local SQLite database **in plaintext**. Protect the machine account and data directory, and remove the local database yourself when you no longer want to retain that content. API keys are not accepted or stored by this foundation.

See [SECURITY.md](SECURITY.md) before using real or sensitive material.

## Planned milestones

The roadmap will add capabilities incrementally, with tests and honest failure states at each step:

1. BYOK model connections for OpenAI, Anthropic, DeepSeek, OpenRouter, and custom OpenAI-compatible or Anthropic-compatible endpoints.
2. A search gateway independent from the model provider, plus creator-added evidence.
3. Intent and direction confirmation, structure proposals, and evidence-backed script drafting.
4. Final review, selective revision application, canonical version history, and export.
5. Script profiles for podcasts, YouTube/video narration, speeches, courses/lessons, and presentation narration. Article and newsletter profiles may follow later.

Memory will store provider-neutral creative domain state, not a provider's private session object.

## Contributing

Issues and pull requests are welcome. Before preparing a contribution, read [CONTRIBUTING.md](CONTRIBUTING.md), including the temporary traction-first merge gate for substantive external code.

## License

Project-owned code is licensed under the [GNU Affero General Public License v3.0 only](LICENSE), identified as `AGPL-3.0-only`.

Third-party components remain under their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The software license does not grant rights to use project names or marks beyond what applicable law permits; see [TRADEMARKS.md](TRADEMARKS.md).

# agent-sandbox

Containerized development sandbox for the [pi coding agent](https://github.com/earendil-works/pi-coding-agent). Provides a clean, reproducible environment with Python, Node.js, Rust, and pi pre-installed.

## What's inside

- **Base image**: Ubuntu 26.04 LTS
- **Languages**: Python 3.14, Node.js (LTS), Rust (stable + rust-analyzer)
- **Tooling**: `uv`, `cargo-edit`, `cargo-binstall`, `ruff`, `fd`
- **Agent**: pi coding agent (version pinned in `Dockerfile`)
- **Agent config**: Pre-configured via the `agent/` directory (models, permissions, system prompt). Intentionally not included in the image and mounted in for faster iteration.

## Quick start

### Build the image

```bash
podman build -t agent-sandbox .
```

### Run the agent

```bash
./bin/sandbox
```

This mounts the current working directory into the container and attaches the pre-configured agent settings from `agent/`.

### Extra mounts

Mount additional host paths by setting `EXTRA_MOUNTS` (space-separated):

```bash
EXTRA_MOUNTS="~/projects/other-repo ~/data" ./bin/sandbox
```

## SearXNG local search

An optional local SearXNG instance can be started for web search capabilities:

```bash
./bin/searxng
```

Starts SearXNG + Valkey via `podman-compose` on `127.0.0.1:9000` by default. Override with `SEARXNG_HOST` and `SEARXNG_PORT` environment variables. The service auto-shuts down on exit.

## Agent configuration

| File | Purpose |
|---|---|
| `agent/models.json` | LLM provider configuration (default: local `llama-server` on port 8080) |
| `agent/settings.json` | pi runtime settings |
| `agent/APPEND_SYSTEM.md` | System prompt appended to every session |

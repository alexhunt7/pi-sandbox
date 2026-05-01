You are in caveman mode. Speak terse, drop filler. Keep all technical substance. Turn off only on "stop caveman" or "normal mode".

## Core Rules

- Do not implement changes unless the user explicitly asks. Answer questions without making changes.
- Match the primary language of the current codebase. For new codebases, default to Rust.
- Prefer established libraries over manual implementations.

## Rust

- Edition 2024, resolver 3.
- Never edit Cargo.toml manually — use `cargo add` to get the latest version.
- Workspace-level dependency management when multiple crates exist.
- Always define dedicated types for serialization/deserialization. Never use `serde_json::Value` or `serde_yaml::Value`.

## Python

- Use a `uv`-managed virtualenv. Record dependencies in `pyproject.toml`.
- Never touch system Python — only use the virtualenv.

# AI Agent Sandbox
# Based on Ubuntu 26.04 LTS

FROM ubuntu:26.04

# Avoid interactive prompts during build
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Europe/Lisbon

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Timezone data
    tzdata \
    # Build essentials & common tools
    build-essential \
    curl \
    git \
    wget \
    ca-certificates \
    gnupg \
    software-properties-common \
    lsb-release \
    # Python dependencies
    libssl-dev \
    libffi-dev \
    libreadline-dev \
    libsqlite3-dev \
    libbz2-dev \
    liblzma-dev \
    zlib1g-dev \
    && ln -sf /usr/bin/fd-find /usr/bin/fd \
    && rm -rf /var/lib/apt/lists/*

# ============================================================
# Python 3.14
# ============================================================
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    python3 \
    python3-dev \
    python3-venv \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

ENV HOME="/root"

# ============================================================
# Node.js / npm (LTS via NodeSource)
# ============================================================
RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

RUN npm config set prefix '~/.local/'

# ============================================================
# Rust (via rustup)
# ============================================================
ENV PATH="${HOME}/.rustup/bin:${HOME}/.cargo/bin:${PATH}"
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | \
    sh -s -- -y && \
    rustup component add rust-analyzer
RUN curl -L --proto '=https' --tlsv1.2 -sSf https://raw.githubusercontent.com/cargo-bins/cargo-binstall/main/install-from-binstall-release.sh | bash && \
    cargo binstall -y \
        uv \
        cargo-edit

# Install ruff (not available on crates.io)
RUN curl -sSf https://raw.githubusercontent.com/astral-sh/ruff/main/install.sh | sh

RUN mkdir -p ~/.local/bin
ENV PATH="${HOME}/.local/bin/:$PATH"

# ============================================================
# Pi Coding Agent (user-local)
# ============================================================
ENV PI_VERSION=0.74.0
RUN npm install -g "@earendil-works/pi-coding-agent@${PI_VERSION}"

# ============================================================
# Cleanup & defaults
# ============================================================
WORKDIR /workspace

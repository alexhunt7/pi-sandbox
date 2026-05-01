# AI Agent Sandbox
# Based on Ubuntu 26.04 LTS

FROM ubuntu:26.04

# Avoid interactive prompts during build
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Build essentials & common tools
    build-essential \
    curl \
    fd-find \
    git \
    ripgrep \
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

# ============================================================
# Node.js / npm (LTS via NodeSource)
# ============================================================
RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

USER ubuntu
RUN npm config set prefix '~/.local/'

# ============================================================
# Rust (via rustup)
# ============================================================
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | \
    sh -s -- -y
ENV PATH="/home/ubuntu/.rustup/bin:/home/ubuntu/.cargo/bin:${PATH}"
RUN rustup component add rust-analyzer && \
    cargo install uv cargo-edit

# Install ruff (not available on crates.io)
RUN curl -sSf https://raw.githubusercontent.com/astral-sh/ruff/main/install.sh | sh

RUN mkdir -p ~/.local/bin
ENV PATH="/home/ubuntu/.local/bin/:$PATH"

# ============================================================
# Pi Coding Agent (user-local)
# ============================================================
RUN npm install -g @mariozechner/pi-coding-agent

# Create .pi config dir (COPY runs as root, so fix ownership)
COPY --chown=ubuntu ./models.json /home/ubuntu/.pi/agent/models.json

# ============================================================
# Cleanup & defaults
# ============================================================
WORKDIR /workspace

# Default shell
CMD ["pi"]

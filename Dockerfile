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

# ============================================================
# Rust (via rustup)
# ============================================================
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | \
    sh -s -- -y
ENV PATH="/home/ubuntu/.rustup/bin:/home/ubuntu/.cargo/bin:${PATH}"
RUN rustup component add rust-analyzer && \
    cargo install uv

# Install ruff (not available on crates.io)
RUN curl -sSf https://raw.githubusercontent.com/astral-sh/ruff/main/install.sh | sh


# ============================================================
# Cleanup & defaults
# ============================================================
WORKDIR /workspace

# Default shell
CMD ["/bin/bash"]

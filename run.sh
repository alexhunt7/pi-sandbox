#!/usr/bin/env bash
set -euo pipefail

# Run the pi-sandbox container with host networking and current directory mounted
podman run -it --rm \
    --net host \
    --userns=keep-id \
    -v "$(pwd)":/workspace \
    pi-sandbox "$@"

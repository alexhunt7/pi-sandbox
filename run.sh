#!/usr/bin/env bash
set -exuo pipefail

script_dir="$(dirname "$(realpath "$0")")"

podman run -it --rm \
    --net host \
    -v "${script_dir}/agent:/root/.pi/agent" \
    -v "$(pwd):/workspace" \
    pi-sandbox "$@"

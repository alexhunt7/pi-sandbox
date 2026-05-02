#!/usr/bin/env bash
set -exuo pipefail

script_dir="$(dirname "$(realpath "$0")")"
workdir="$(pwd)"

podman run -it --rm \
    --net host \
    -v "${script_dir}/agent:/root/.pi/agent" \
    -v "${workdir}:${workdir}" \
    --workdir "${workdir}" \
    pi-sandbox "$@"

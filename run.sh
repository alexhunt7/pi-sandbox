#!/usr/bin/env bash
set -exuo pipefail

script_dir="$(dirname "$(realpath "$0")")"
workdir="$(pwd)"

extra_mount_args=()
if [[ -n "${EXTRA_MOUNTS:-}" ]]; then
    IFS=' ' read -ra mount_paths <<< "${EXTRA_MOUNTS}"
    for p in "${mount_paths[@]}"; do
        # Expand ~ and normalize path
        expanded="${p/#\~/$HOME}"
        normalized="$(readlink -f "$expanded")"
        extra_mount_args+=(-v "${normalized}:${normalized}")
    done
fi

podman run -it --rm \
    --net host \
    -v "${script_dir}/agent:/root/.pi/agent" \
    -v "${workdir}:${workdir}" \
    ${extra_mount_args[@]+"${extra_mount_args[@]}"} \
    --workdir "${workdir}" \
    pi-sandbox "$@"
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$(realpath "$0")")"

trap 'podman-compose down -v' EXIT

podman-compose up -d
podman-compose logs -f

#!/bin/sh
# Tears down the local stack, including any per-vampchain containers/volumes
# the provisioner created (those aren't part of docker-compose, so `docker
# compose down` alone won't touch them).
set -eu
cd "$(dirname "$0")/.."

for c in $(docker ps -a --filter "name=vampchain-" --format "{{.Names}}"); do
  echo "==> removing $c"
  docker rm -f "$c" >/dev/null
done

docker compose down -v
rm -f .env web/.env.local
echo "==> torn down"

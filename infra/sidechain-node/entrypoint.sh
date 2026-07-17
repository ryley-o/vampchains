#!/bin/sh
set -eu

# One vampchain = one persistent anvil instance. Config comes entirely from
# env vars so the same image is reused for every chain (Fly machine env
# differs per app, image doesn't).
#
# CHAIN_ID          required, the vampchain's EVM chain id
# PORT              default 8545
# BLOCK_TIME        seconds between blocks; unset/0 = mine instantly on tx (default, cheapest/simplest)
# STATE_DIR         default /data — must be a persisted volume or state is lost on restart
# STATE_INTERVAL    seconds between periodic state dumps, default 30 (protects against ungraceful restarts)
# DEV_ACCOUNT_BALANCE_ETH
#                   balance (in ETH-equivalent units) seeded to anvil's default
#                   dev accounts. Default 0 — see below. Set this >0 ONLY when
#                   this image is used as the local-dev *home chain* stand-in
#                   for Base (docker-compose's "l1" service), which needs
#                   normal funded test accounts to pay gas like a real chain.

: "${CHAIN_ID:?CHAIN_ID env var is required}"
PORT="${PORT:-8545}"
STATE_DIR="${STATE_DIR:-/data}"
STATE_INTERVAL="${STATE_INTERVAL:-30}"
DEV_ACCOUNT_BALANCE_ETH="${DEV_ACCOUNT_BALANCE_ETH:-0}"

mkdir -p "$STATE_DIR"

# "::" (IPv6 unspecified) rather than "0.0.0.0" — Fly's private 6PN network
# is IPv6-only, and a process bound only to the IPv4 wildcard is invisible
# to other apps over .internal even though it works fine locally. Binding
# to "::" also accepts IPv4 connections on Linux's default dual-stack
# sockets, so this still works for docker-compose's published host ports.
ARGS="--host :: --port $PORT --chain-id $CHAIN_ID --state $STATE_DIR/state.json --state-interval $STATE_INTERVAL"

# On a real vampchain, the well-known anvil dev accounts must never hold
# balance — native currency is only supposed to enter via the bridge mint.
# Zero balance (the default) neutralizes anyone importing the public anvil
# mnemonic. Only the local-dev home-chain stand-in overrides this.
ARGS="$ARGS --balance $DEV_ACCOUNT_BALANCE_ETH"

if [ -n "${BLOCK_TIME:-}" ] && [ "${BLOCK_TIME:-0}" != "0" ]; then
  ARGS="$ARGS --block-time $BLOCK_TIME"
fi

echo "starting anvil: $ARGS"
# shellcheck disable=SC2086
exec anvil $ARGS

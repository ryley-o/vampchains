#!/bin/sh
set -eu

# One vampchain = one persistent geth (Clique single-signer PoA) instance.
# Config comes entirely from env vars so the same image is reused for every
# chain. See docs/ARCHITECTURE.md "Why geth Clique PoA".
#
# CHAIN_ID                  required, the vampchain's EVM chain id
# CLIQUE_SIGNER_PRIVATE_KEY required — the block-signing key. Same key is
#                            reused across every vampchain by design (see
#                            docs/ARCHITECTURE.md); it only proves block
#                            authorship on our own isolated single-node
#                            chains (--nodiscover --maxpeers 0, no P2P at
#                            all), it does not custody funds. Still passed
#                            via env like every other secret in this repo,
#                            never baked into a committed file, on principle.
# TREASURY_ADDRESS          the account pre-funded at genesis and set as
#                            block-reward/fee recipient (etherbase). Public
#                            info (an address, not a key) — this is what the
#                            relayer mints deposits from and what withdrawal
#                            burns get recaptured to. Same default reused
#                            across every vampchain.
# PORT                      default 8545
# CLIQUE_PERIOD              seconds between blocks, default 12
# STATE_DIR                  default /data — must be a persisted volume

: "${CHAIN_ID:?CHAIN_ID env var is required}"
: "${CLIQUE_SIGNER_PRIVATE_KEY:?CLIQUE_SIGNER_PRIVATE_KEY env var is required}"
PORT="${PORT:-8545}"
CLIQUE_PERIOD="${CLIQUE_PERIOD:-12}"
STATE_DIR="${STATE_DIR:-/data}"
TREASURY_ADDRESS="${TREASURY_ADDRESS:-0x12f5B89B02C8107278c5F24E74d7B44267C55d1f}"

mkdir -p "$STATE_DIR"

# --- one-time setup: keystore for the Clique signer ---------------------
if [ -z "$(ls -A "$STATE_DIR/keystore" 2>/dev/null)" ]; then
  echo "importing clique signer key..."
  KEYFILE="$STATE_DIR/.signer-key.tmp"
  PASSFILE="$STATE_DIR/.signer-password"
  printf '%s' "${CLIQUE_SIGNER_PRIVATE_KEY#0x}" > "$KEYFILE"
  printf 'vampchains' > "$PASSFILE"
  # --lightkdf: standard scrypt params for keystore encryption need a single
  # ~256MB allocation, which alone exceeds this container's whole memory
  # budget (256MB machines) and crashes the Go runtime with an OOM panic —
  # confirmed by hitting it on a live Fly deploy. The password only protects
  # the keystore file at rest on our own volume (see the note above), so the
  # weaker KDF costs nothing security-wise here.
  geth account import --datadir "$STATE_DIR" --password "$PASSFILE" --lightkdf "$KEYFILE"
  rm -f "$KEYFILE"
fi
PASSFILE="$STATE_DIR/.signer-password"
if [ ! -f "$PASSFILE" ]; then
  # Restarted against a volume from before this script tracked the
  # password file separately — recreate it (same fixed local password,
  # not a secret in itself: it only protects the keystore file at rest on
  # our own volume, the real secret is the private key above).
  printf 'vampchains' > "$PASSFILE"
fi

SIGNER_ADDRESS=$(geth account list --datadir "$STATE_DIR" 2>/dev/null | head -1 | sed -n 's/.*{\([0-9a-fA-F]*\)}.*/\1/p')
if [ -z "$SIGNER_ADDRESS" ]; then
  echo "could not determine signer address from keystore" >&2
  exit 1
fi

# --- one-time setup: genesis ----------------------------------------------
if [ ! -d "$STATE_DIR/geth/chaindata" ]; then
  echo "initializing genesis for chain $CHAIN_ID..."
  TREASURY_NO_0X=$(printf '%s' "$TREASURY_ADDRESS" | sed 's/^0x//' | tr '[:upper:]' '[:lower:]')
  sed \
    -e "s/__CHAIN_ID__/$CHAIN_ID/" \
    -e "s/__CLIQUE_PERIOD__/$CLIQUE_PERIOD/" \
    -e "s/__SIGNER_ADDRESS_NO_0X__/$SIGNER_ADDRESS/" \
    -e "s/__TREASURY_ADDRESS_NO_0X__/$TREASURY_NO_0X/" \
    /genesis.template.json > "$STATE_DIR/genesis.json"
  geth init --datadir "$STATE_DIR" "$STATE_DIR/genesis.json"
fi

# --miner.etherbase must be an account geth has the key for locally — it
# can't be an arbitrary external address. So fee revenue (small, per the
# earlier design discussion) accrues to the signer account, not the shared
# treasury; the treasury's private key never has to be present on a
# sidechain-node container at all, which is the point — it only ever needs
# to be known to the relayer, which signs mint transfers off-node. Since the
# same signer key is reused across every vampchain by design, this doubles
# as one consistent place to sweep accumulated fees from, across all chains,
# if that's ever worth doing.
echo "starting geth: chainId=$CHAIN_ID signer=0x$SIGNER_ADDRESS treasury(mint-source)=$TREASURY_ADDRESS port=$PORT period=${CLIQUE_PERIOD}s"
exec geth \
  --datadir "$STATE_DIR" \
  --networkid "$CHAIN_ID" \
  --nodiscover \
  --maxpeers 0 \
  --mine \
  --miner.etherbase "0x$SIGNER_ADDRESS" \
  --unlock "0x$SIGNER_ADDRESS" \
  --password "$PASSFILE" \
  --allow-insecure-unlock \
  --http \
  --http.addr :: \
  --http.port "$PORT" \
  --http.api eth,net,web3,txpool \
  --http.corsdomain "*" \
  --http.vhosts "*" \
  --syncmode full \
  --gcmode full

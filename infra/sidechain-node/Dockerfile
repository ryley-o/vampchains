FROM ethereum/client-go:v1.13.15

# geth + Clique single-signer PoA, replacing the earlier anvil-based image.
# See docs/ARCHITECTURE.md "Why geth Clique PoA" for the rationale — real
# database-backed state storage instead of anvil's periodic full-state JSON
# dump, while staying single-node/lightweight.
#
# Pinned to v1.13.15 deliberately, not :stable, and this needed two rounds
# of discovery to land on:
#   1. v1.16.3+ removed in-process account unlocking (--unlock) entirely in
#      favor of requiring an external Clef signer daemon — real added
#      complexity (a second process per chain, rule-based non-interactive
#      approval config) aimed at high-security signing scenarios, a mismatch
#      for these low-stakes, fully-automated, isolated single-node chains.
#   2. Even v1.16.0, which still has --unlock, refuses to start a pure
#      Clique network at all — it demands `terminalTotalDifficulty` in
#      genesis (i.e. a full PoS-merge setup with an external consensus
#      client) and its own error message says exactly this: "Geth only
#      supports PoS networks. Please transition legacy networks using
#      Geth v1.13.x." That's geth's own official guidance for pure-PoA
#      private networks, not a workaround — so that's what we're on.
# Revisit if Clique ever gets a first-class non-merge, non-Clef path again.

RUN addgroup -g 1000 geth && adduser -D -u 1000 -G geth geth \
  && mkdir -p /data && chown -R geth:geth /data

COPY entrypoint.sh /entrypoint.sh
COPY genesis.template.json /genesis.template.json
RUN chmod +x /entrypoint.sh

USER geth
ENV PORT=8545
EXPOSE 8545
VOLUME ["/data"]

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O- --post-data='{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' \
      --header="Content-Type: application/json" "http://127.0.0.1:${PORT}" || exit 1

ENTRYPOINT ["/entrypoint.sh"]

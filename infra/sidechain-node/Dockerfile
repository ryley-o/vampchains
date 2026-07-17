FROM ghcr.io/foundry-rs/foundry:latest

# Foundry's image already ships anvil + cast (used for the healthcheck).
COPY entrypoint.sh /entrypoint.sh

USER root
RUN chmod +x /entrypoint.sh && mkdir -p /data && chown -R foundry:foundry /data
USER foundry
VOLUME ["/data"]

ENV PORT=8545
EXPOSE 8545

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD cast rpc eth_blockNumber --rpc-url "http://127.0.0.1:${PORT}" || exit 1

ENTRYPOINT ["/entrypoint.sh"]

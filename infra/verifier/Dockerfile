FROM node:22-slim AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/db/package.json packages/db/package.json
COPY packages/db/prisma packages/db/prisma
COPY packages/chains/package.json packages/chains/package.json
COPY packages/contract-abis/package.json packages/contract-abis/package.json
COPY packages/rate-limiter/package.json packages/rate-limiter/package.json
COPY infra/verifier/package.json infra/verifier/package.json
RUN pnpm install --frozen-lockfile --filter @vampchains/verifier...

FROM base AS runner
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl git && rm -rf /var/lib/apt/lists/*

# `forge build` is the actual compilation engine (see src/compile.ts) — this
# is what makes "integrates with Foundry" literally true rather than a
# bespoke solc wrapper. Copying the binary from the official image avoids a
# slower, less-deterministic `foundryup` curl-script step at build time.
COPY --from=ghcr.io/foundry-rs/foundry:latest /usr/local/bin/forge /usr/local/bin/forge
ENV HOME=/root

# Pre-warm the compiler versions real vampchain deploys have actually used
# so far (see contracts/foundry.toml and scratch-verify-test/foundry.toml)
# into the image's shared svm cache, so the common case doesn't pay a slow
# first-compile network fetch to binaries.soliditylang.org. Any other
# version is still fetched on demand at request time — this is an
# optimization, not a requirement.
RUN mkdir -p /tmp/prewarm/src && cd /tmp/prewarm \
  && printf '[profile.default]\nsrc = "src"\nout = "out"\nsolc = "0.8.24"\n' > foundry.toml \
  && printf 'contract Warm {}\n' > src/Warm.sol \
  && forge build \
  && rm -rf /tmp/prewarm

COPY --from=deps /app /app
COPY packages/db packages/db
COPY packages/chains packages/chains
COPY packages/contract-abis packages/contract-abis
COPY packages/rate-limiter packages/rate-limiter
COPY infra/verifier infra/verifier
WORKDIR /app/packages/db
RUN pnpm exec prisma generate
WORKDIR /app/infra/verifier
# Compiled to a single JS bundle at image-build time rather than run via
# `tsx` at runtime — see infra/relayer/Dockerfile's comment / docs/DEPLOYMENT.md
# for why (tsx's extra Node/esbuild child processes were the real root
# cause of a stuck-relayer incident on a tiny Fly machine). `forge` itself
# is still a real subprocess at request time (src/compile.ts) — unaffected,
# this only changes how this service's own TS entrypoint runs.
RUN pnpm run build
EXPOSE 8080
CMD ["node", "dist/index.js"]

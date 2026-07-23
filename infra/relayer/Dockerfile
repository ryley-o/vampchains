FROM node:22-slim AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/db/package.json packages/db/package.json
COPY packages/db/prisma packages/db/prisma
COPY packages/chains/package.json packages/chains/package.json
COPY infra/relayer/package.json infra/relayer/package.json
RUN pnpm install --frozen-lockfile --filter @vampchains/relayer...

FROM base AS runner
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app /app
COPY packages/db packages/db
COPY packages/chains packages/chains
COPY infra/relayer infra/relayer
WORKDIR /app/packages/db
RUN pnpm exec prisma generate
WORKDIR /app/infra/relayer
# Compiled to a single JS bundle at image-build time rather than run via
# `tsx` at runtime — tsx's on-the-fly TS transform spawns extra Node/esbuild
# child processes (confirmed live: ~65MB of RSS overhead on this app's tiny
# 256MB machine, on top of the ~73MB the actual work needs), which was the
# real root cause of a stuck-relayer incident under memory pressure. `dev`
# still uses `tsx watch` for hot-reload; only this production image builds.
RUN pnpm run build
CMD ["node", "dist/index.js"]

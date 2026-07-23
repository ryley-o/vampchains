FROM node:22-slim AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/db/package.json packages/db/package.json
COPY packages/db/prisma packages/db/prisma
COPY packages/chains/package.json packages/chains/package.json
COPY packages/rate-limiter/package.json packages/rate-limiter/package.json
COPY infra/rpc-gateway/package.json infra/rpc-gateway/package.json
RUN pnpm install --frozen-lockfile --filter @vampchains/rpc-gateway...

FROM base AS runner
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app /app
COPY packages/db packages/db
COPY packages/chains packages/chains
COPY packages/rate-limiter packages/rate-limiter
COPY infra/rpc-gateway infra/rpc-gateway
WORKDIR /app/packages/db
RUN pnpm exec prisma generate
WORKDIR /app/infra/rpc-gateway
EXPOSE 8080
CMD ["pnpm", "start"]

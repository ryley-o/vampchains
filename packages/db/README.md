# @vampchains/db

Shared Prisma schema + client, used by `web`, `infra/relayer`, and
`infra/provisioner`. Source of truth for state is always the on-chain
contracts — this is a synced index for fast reads, never authoritative.

```bash
cp .env.example .env   # point DATABASE_URL at local Postgres or Neon
pnpm generate           # regenerate the Prisma client after schema changes
pnpm migrate             # create + apply a dev migration
pnpm migrate:deploy       # apply migrations in production (no schema drift prompts)
pnpm seed                 # insert one fake chain, useful for local web app dev
```

Validated locally against a throwaway `postgres:16-alpine` container: schema
migrates cleanly, generated client connects and writes/reads correctly.

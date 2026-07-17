import { PrismaClient } from "@prisma/client";

// Reuse a single PrismaClient across hot reloads (Next.js dev) / across
// modules within one process (relayer, provisioner) instead of opening a
// new connection pool per import.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "@prisma/client";

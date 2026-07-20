import { PrismaClient } from '@prisma/client';

// A single shared PrismaClient for the whole process. Each `new PrismaClient()`
// opens its own connection pool, so instantiating one per route/service (as this
// codebase previously did in six places) multiplies open Postgres connections
// and exhausts `max_connections` under load — or across hot-reloads in dev.
// Import THIS instance everywhere instead of constructing a new client.
//
// The globalThis cache keeps a single instance alive across ts-node-dev's
// module re-evaluation on reload, which would otherwise leak a fresh pool per
// edit.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

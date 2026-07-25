import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * Prisma client singleton.
 *
 * The explicit `datasources: { db: { url: process.env.DATABASE_URL } }` block that used to
 * be here broke the production build. Next.js evaluates every route module during its
 * "Collecting page data" phase, and there is no DATABASE_URL inside a Docker build, so the
 * constructor received `url: undefined` and threw
 * PrismaClientConstructorValidationError — failing the build at /api/auth/callback.
 *
 * Omitting the block lets Prisma resolve the connection string from env("DATABASE_URL") in
 * schema.prisma at query time instead of construction time, which is both the documented
 * behaviour and what makes the value overridable by Azure app settings at runtime.
 */
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

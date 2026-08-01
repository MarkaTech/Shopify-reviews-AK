import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const rows = await db.storeSetting.findMany({
  where: { key: { startsWith: 'auth.' } },
  select: { key: true, value: true, updatedAt: true, store: { select: { shopifyDomain: true } } },
  orderBy: { updatedAt: 'desc' },
});
console.log(JSON.stringify(rows, null, 2));
await db.$disconnect();

# Migrations

Production applies these with `prisma migrate deploy` (see
`.github/workflows/azure-deploy.yml`). It used to run `prisma db push
--accept-data-loss` on every push to main, which reshapes the database to match
`schema.prisma` with no history, no review, and destructive changes executed
rather than refused.

## Baseline

`0_init` is the baseline: it creates all 18 tables from empty, generated with

```bash
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
```

A fresh database can now be built from this directory alone — `prisma migrate reset`, a new
developer, a staging environment. The two incremental migrations that follow it are fully
idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
`CREATE TABLE IF NOT EXISTS`), so applying them on top of a database the baseline just built
is a no-op rather than a conflict. Directory order is lexicographic, and `0_init` sorts first.

**Production already has these tables**, from before migration history existed. It must
therefore record the baseline as applied rather than run it:

```bash
npx prisma migrate resolve --applied 0_init
```

`.github/workflows/azure-deploy.yml` does this automatically on the P3005 path, so no manual
step is needed — but if you are baselining a database by hand, that is the command.

Regenerate `0_init` only when starting a genuinely new database lineage. For an ordinary
schema change, add an incremental migration instead (below); editing the baseline after it
has been applied anywhere makes the two disagree.

## Adding a migration

```bash
npx prisma migrate dev --name what_it_does
```

Review the generated SQL before committing. If it drops or renames anything,
that is now visible in the pull request instead of happening silently at deploy.

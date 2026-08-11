# Migrations

Production applies these with `prisma migrate deploy` (see
`.github/workflows/azure-deploy.yml`). It used to run `prisma db push
--accept-data-loss` on every push to main, which reshapes the database to match
`schema.prisma` with no history, no review, and destructive changes executed
rather than refused.

## One thing is still outstanding: there is no baseline migration

These migrations start from the schema **as it already existed in production**,
not from an empty database. `migrate deploy` works today because the only
migration here alters tables that are already present.

But a *fresh* database cannot be built from this directory alone — there is no
`0_init` covering the original tables. That matters for a new developer, a
staging environment, or `prisma migrate reset`.

It is missing because the environment these were authored in could not run
Prisma's schema engine (macOS binaries on a Linux host, no network to fetch the
right ones). Generating it needs one command on a machine with a working Prisma:

```bash
# From the commit that production is currently running:
git show <deployed-commit>:prisma/schema.prisma > /tmp/schema_prod.prisma

mkdir -p prisma/migrations/0_init
npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel /tmp/schema_prod.prisma \
  --script > prisma/migrations/0_init/migration.sql
```

Then tell production it is already applied — this records it without running it,
which is the point, since those tables exist:

```bash
npx prisma migrate resolve --applied 0_init
```

Commit `0_init` afterwards. Until that is done, treat this directory as
incremental-only.

## Adding a migration

```bash
npx prisma migrate dev --name what_it_does
```

Review the generated SQL before committing. If it drops or renames anything,
that is now visible in the pull request instead of happening silently at deploy.

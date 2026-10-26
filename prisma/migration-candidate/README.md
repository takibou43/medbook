# Migration replay candidate — not the production history

This directory is an isolated candidate for a future baseline cutover. The active
`prisma/migrations` directory, `prisma:deploy`, native startup and Docker startup are
unchanged. **Do not point production at this candidate or mark its migrations as
applied based solely on a green CI run.**

- `00000000000000_baseline`: Prisma 5.22.0 SQL generated from `prisma/schema.prisma`
  at main `1f8ceeb42da3f696cfbdf065a6a5e2d548c57697`.
- `00000000000001_guards`: final 13 CHECK constraints and three triggers/functions
  extracted from the six SQL guard migrations currently used by CI. No historical
  data backfills or subscription activation are replayed. The baseline already
  includes final indexes and foreign keys, including the `slotSeq` booking index.

CI copies the current schema and these migrations to a temporary directory, uses
`migrate deploy` twice, checks the migration ledger, checks schema drift, and checks
SQL guard/function/trigger installation before running the existing integration
and concurrent workload suites. It never resets or drops a database. Only an empty
local `medbook_security_test` or `medbook_load_test` database is accepted. The
existing container-security job still tests the legacy Docker startup separately.

Run from `backend` with Node 22 and dependencies installed from the lockfile:

```sh
node --test scripts/check-migration-url.mjs
# TEST_DATABASE_URL must refer to an EMPTY, disposable local PostgreSQL database.
node scripts/ci-prepare-migration-db.mjs
npx vitest run --reporter=default --reporter=json --outputFile.json=vitest-report.json
node scripts/assert-integration-ran.mjs vitest-report.json
```

No new application dependency, paid service, Neon branch or production secret is
required. PGlite checks, when used locally, are supplemental and do not replace
PostgreSQL 16 CI, especially for concurrent booking/admission.

## Gate before production cutover (separate change)

1. Read actual Render startup settings, current production schema and
   `_prisma_migrations` (if it exists), including names/checksums/failures. Do not
   assume production has no ledger or that its schema matches this snapshot.
2. Compare tables, enums, indexes, foreign keys, CHECK definitions, trigger event
   definitions and function bodies. Prisma diff alone does not inspect all these.
3. Rehearse the exact existing-ledger-to-baseline transition on a disposable local
   database with synthetic populated records, preserving appointment states,
   cancelled slots, follow-up slots and paid/unpaid/expired subscriptions. A fresh
   replay is NOT proof that this transition preserves existing data.
4. Document any corrective migration and a verified backup/restore procedure that
   stays within the existing free plan. Do not create paid resources implicitly.
5. Approve an explicit mapping of old history to the candidate before archiving
   old migrations or using `migrate resolve`. Both history changes and resolve are
   outside this candidate's test setup; resolve is a write, not verification.
6. Only then replace BOTH `backend/package.json` startup and
   `backend/docker-entrypoint.sh`. Keep generate in build, fail closed on migration
   errors and remove manual guard replay. Never fall back to db push on failure.
7. Rollback is a reviewed application/schema compatibility plan, not restoration
   of the old db-push startup command. Do not merge or deploy the cutover while any
   verification remains pending. The user performs publication after success.

# Migration replay review — 2026-10-26

Scope: stage one only. No production cutover, deployment, remote write, package
upgrade or active migration-history rewrite. Based on main 1f8ceeb.

## Implemented

- Isolated two-migration candidate: complete current schema, then 13 CHECKs and
  three trigger functions/triggers. No historical subscription/data backfills.
- Existing PostgreSQL 16 CI service builds both test databases using the candidate
  via migrate deploy. All existing integration and workload tests use that result.
- A second deploy must leave the ledger unchanged; schema diff must be empty;
  CHECKs must be present/validated, function bodies and enabled trigger definitions
  must match the candidate.
- Target guard rejects non-local URLs, wrong database names, overridden connection
  options, mismatched DATABASE_URL, and nonempty databases. No reset/drop fallback.
- Corrected baseline/cutover documentation. Production still uses the old startup
  until the independent existing-data transition is verified.

## Validation and limits

- Node 22.23.4, installed locked Prisma 5.22.0; backend TypeScript build passed.
- Eight offline target-guard tests passed on Node 22.
- Backend suite: 847 passed; 336 integration/workload cases skipped without a
  PostgreSQL test URL (85 files passed, 26 skipped). No integration success claimed.
- Both SQL files executed successfully on disposable PGlite; 13 CHECKs installed.
  This is supplemental SQL validation, not PostgreSQL 16 migration/concurrency proof.
- A local full migrate-deploy attempt through the PGlite socket failed with a
  generic schema-engine error. No successful replay is claimed from that attempt.
- PostgreSQL 16 could not be started under this environment's user restrictions.
  GitHub CI has been prepared but NOT triggered; PostgreSQL replay, integration
  and concurrent workload remain required before approval.
- Production schema, migration ledger, Render settings and backup/restore remain
  unverified. Do not deploy a db-push removal based on this candidate.

See `prisma/migration-candidate/README.md` for the separate cutover gate.

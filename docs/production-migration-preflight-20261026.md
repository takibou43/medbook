# Production cutover preflight — 2026-10-26

Read-only inspection of Neon project `calm-lake-84943874`, production branch
`br-bitter-mouse-a5fk66jy`, against main `51754b4` found:

- 40 public application tables; `public._prisma_migrations` does not exist.
- 11 CHECK constraints and two application triggers.
- The tested candidate expects 13 CHECK constraints and three triggers.
- Missing from production: `reviews_rating_range`, `reviews_comment_length`,
  and `reviews_immutable`. No clinical rows or credentials were retrieved.

The candidate is therefore not an exact description of production. Do not mark
both candidate migrations applied or replace the startup command based only on
the successful fresh-database replay. Existing production startup was preserved.

Before cutover: verify aggregate review validity; rehearse adding these guards
and adopting the baseline on a synthetic populated PostgreSQL database; compare
the complete schema, indexes, enum definitions and function bodies; verify a
backup/restore path; then apply the reviewed correction and baseline transition.
Keep Render native and Docker startup changes in the same reviewed release.

This preflight does not establish that other schema definitions match, and does
not authorize skipping any gate in `prisma/migration-candidate/README.md`.

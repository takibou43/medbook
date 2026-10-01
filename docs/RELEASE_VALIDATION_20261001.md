# Release validation — 2026-10-01

Scope: all pending security fixes, clinic load-test artifacts, and the new-doctor approval trial.

- Clean `npm ci --include=dev` for backend, patient frontend and doctor frontend, using Node 22.23.3 explicitly.
- Prisma 5.22.0 generation and backend TypeScript build passed. Both frontend production builds passed; 12 patient tests and 6 doctor tests passed.
- Local PostgreSQL only: `127.0.0.1:54359/medbook_security_test`. No production test data or real SMS/Push requests were sent.
- Backend: 570 distinct tests passed across the full run and focused reruns; the optional 1000-booking load test remained skipped. The last full run had 569 passing tests and one intermittent direct-writer race failure; the unchanged race suite passed all 9 tests when rerun alone. PostgreSQL logged local Winsock connection resets under load. This is a local test-environment limitation, not a production latency measurement.
- A prior fixture collision was corrected by making synthetic auto-block appointments skip occupied active slots. A slow initial setup hook passed when rerun without concurrent frontend builds.
- Real-database assertions verify that new registration remains UNPAID until approval, approval grants exactly 30 days, and concurrent/repeated approval preserves the original start and expiration timestamps.
- Existing doctors default to `newDoctorTrial=false`; new standalone registrations opt in. Legacy trial behavior remains available to existing accounts. The new migration is additive; it does not reset existing subscription dates.
- Dependency advisories remain in the lockfiles. The critical backend advisory concerns the Vitest UI server, which is not run by production startup. No forced major upgrades were included.
- RLS pilot files are local-only diagnostics, outside Prisma migrations, and are not applied to production.

Rollback: redeploy the previous application commit `a48f9c1b34bfe9c24555334e807a067062a4d200`. The two additive trial columns may remain in the database; do not drop them or reset subscriptions as part of application rollback.

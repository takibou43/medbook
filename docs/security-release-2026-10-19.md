# Security release — 2026-10-19

## Behavior

- Encode untrusted doctor names in the QR print document; the real print function no longer executes a synthetic script in a network-blocked browser.
- Project nested Doctor/Clinic relations onto public fields for patient responses. Preserve visit/patient/family IDs and saved price. Staff responses retain their authorized fields.
- Require an unrevoked, unexpired refresh session and claim it atomically before account-wide logout; expired/revoked cookies cannot invalidate newer sessions.
- Attendance posters use HMAC-signed v2 capabilities. Only authenticated staff for the doctor or clinic can obtain them. Public doctor booking links remain booking links and cannot authorize attendance.
- Patient-created appointments are limited to three active appointments per beneficiary, doctor and calendar day. The check and insertion share a PostgreSQL transaction and beneficiary-scoped advisory lock. Each family member has a separate allowance; clinician-created follow-ups do not consume it. Existing appointments are unchanged.
- Upgrade both portals to React Router 7.18.4 and normalize login redirect targets, rejecting backslashes and control characters.
- Remove demonstration seeding from Docker startup, refuse demo seeding in production, require explicit Compose JWT secrets, and stop startup on migration failure.

## Operations

No Prisma schema, migration, account, role, profile, password, subscription or existing appointment data changes are part of this release. No new environment secret is required: attendance signing uses the existing refresh secret with a separate cryptographic context.

**Reprint attendance posters after deployment.** Unsigned v1 posters and public booking QRs cannot record attendance. Booking QRs still open booking normally. Staff can continue recording arrival using the existing reception controls.

A printed signed poster is a bearer capability: a saved photo can be reused. This release prevents deriving attendance authority from public UUIDs; it does not prove physical presence against someone who already possesses the poster. Stronger presence assurance requires rotating on-site challenges or reception confirmation.

Rotating the refresh-signing secret also invalidates printed attendance capabilities. Generate/reprint posters after such a rotation. Never log complete attendance capabilities or session cookies.

## Validation

Node 22.23.3; TypeScript and production builds; portal unit tests; backend security regressions for stale-session logout, output privacy by role, visit identity preservation, forged attendance codes and the three-appointment limit. PostgreSQL CI additionally tests simultaneous quota attempts, separate family allowances, cancellation freeing capacity and clinician follow-up exemption. The existing attendance integration checks continue to cover ownership, same-day scope, family choice and idempotence.

Known dependency audit results are time-sensitive; at preparation all three production dependency audits reported zero advisories.

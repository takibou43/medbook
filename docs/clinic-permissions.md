# Clinic staff permissions

Only the clinic owner invites doctors and assistants, appoints managers, and changes staff permissions. Existing accounts, passwords, roles, subscriptions and appointment financial snapshots are preserved.

An assistant can serve all current and future clinic doctors, or an explicit set chosen by the owner. Existing shared assistants retain all-doctor access. Each request intersects the stored assignment with live clinic membership and active doctor accounts. A disabled assistant loses access to every doctor. Reusing an existing assistant email never creates a second account; the legacy endpoint preserves its current scope.

Assistants use a unified reception board, with no doctor selector. `/assistant/queues` returns all assigned doctors' queues, refreshed every four seconds while the board is visible. Each doctor's current called patient remains visible independently, including simultaneous calls. The appointments page combines the assigned doctors' appointments for the chosen date. Row actions carry that appointment's doctor header and are reauthorized server-side; no global browser selection is used. Optional sound requires a user gesture. Family beneficiaries remain attached to their original appointments.

The owner can appoint an existing clinic doctor as manager and separately grant:

- `EDIT_PROFILE`: edit clinic identity/location.
- `MANAGE_TERMS`: edit doctor prices and revenue shares for future appointments.
- `VIEW_FINANCE`: read the estimated clinic revenue report.
- `MANAGE_ASSISTANT_STATUS`: enable/disable existing assistants.

Managers cannot invite doctors/assistants, appoint other managers, or change anyone's permission scope. Grants are read from the database on each management request. They apply only while the doctor belongs to the exact delegated clinic; joining another clinic clears the delegation.

Ordinary clinic doctors have no clinic-management link in desktop/mobile navigation or settings, and direct management navigation redirects to their dashboard. Independent doctors retain clinic creation and independent assistant management.

Deployment adds nullable delegation/invitation columns, arrays with empty defaults, and `allDoctors=true` defaults. Render's existing `prisma db push --skip-generate` startup applies these additive schema changes before the API starts. The idempotent SQL migration documents the equivalent DDL and updates no existing subscription/role/password values.

Validation: backend build and unit suite; PostgreSQL clinic ownership/permission/assistant integration tests; clinic finance flow tests; frontend production build and clinic navigation tests; CI runs all backend integration tests on its isolated PostgreSQL service before merge.

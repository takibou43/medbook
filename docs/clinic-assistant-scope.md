# Shared clinic assistant

A single assistant login can select any active doctor currently belonging to the assistant's clinic. Dashboard, appointments and queue operations use the selected doctor; existing role restrictions remain in force. Independent assistants retain access to their original doctor only.

The assistant's clinic is stored separately from the inviting doctor so a later doctor transfer cannot grant access to a different clinic. Requests carry `X-Assistant-Doctor-Id`; the server checks live membership on every operation and keeps selection in request-local AsyncLocalStorage. Changing doctors reloads the UI to discard previous query caches. Disabling the assistant revokes all access.

## Release requirement

Apply and verify `prisma/migrations/20261003210000_clinic_assistant_scope/migration.sql` under an authorized database release. It adds the nullable clinic relationship and backfills existing assistants from their current inviting doctors. `prisma db push` alone does not execute the backfill. New invitations capture the inviting doctor's clinic when accepted.

No production database changes or deployment were performed for this implementation. Browser verification and database migration verification remain release checks.

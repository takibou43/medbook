# Booking and prescription clarity

- Independent Arabic/French/bilingual header preference, defaulting to the previous bilingual layout. Stored in the existing professional JSON without a database migration. Generated automatic stationery is re-rendered for preview/print; imported images, preprinted sheets and advanced custom layouts remain intact.
- Optional reviewed Latin patient name for French prescriptions. Explicit device-local remembering for 90 days, scoped to the doctor and actual beneficiary, with an forget action. No automatic name translation and no changes to appointment/patient records.
- Enter moves through compact medication fields and adds/focuses the next medication; native Tab and datalist selection remain available. Existing structured medications and undo remain supported.
- PDF success feedback identifies the filename and chosen folder only after the file is written successfully; errors offer a clear retry message. Manual browser PDF saving remains available without a configured folder.
- Lighter/smaller watermark and clearer patient/instructions typography; A5 geometry, QR and long-prescription fallback retained.
- Direct doctor/date/time/beneficiary edits in booking confirmation, disabled during submission; server-side slot allocation remains unchanged.
- Patient queue tracking shows duty status from the server expiry and the last successful fetch time. Before duty starts, it retains position but does not present an immediate wait promise. Existing polling frequency and privacy boundaries are unchanged.

## Verification

- Patient: 34 tests passing; production build passes.
- Doctor: 149 tests passing; production build passes.
- Backend: 769 local non-database tests passing; TypeScript build passes. Database integration tests are left to repository CI with its disposable PostgreSQL service.
- New regressions cover header settings round-trip, unchanged bilingual source fields, name isolation and duty expiry.
- New UI interactions, filesystem permission dialogs and native mobile printing still need visual/device verification. No production appointment state was changed by this implementation.

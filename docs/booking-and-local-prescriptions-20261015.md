# Booking permissions and temporary local prescription copies

- An active assistant blocks ordinary doctor-created bookings only while their shift is active. The server dashboard uses the same predicate as the booking guard. Shift changes and booking commits share the doctor queue lock. Verification, subscription and assistant scope checks remain enforced.
- Completed appointments remain historical records. They cannot be sources for new follow-up appointments. Existing status transitions and rescheduling already reject completed appointments. Patient-list and treatment-plan scheduling references exclude them; the post-completion scheduling prompt was removed. A row lock rechecks the original appointment inside follow-up creation so concurrent completion cannot bypass the rule.
- Prescription settings can store a device-local, account-scoped directory handle in IndexedDB. On the preview's Print button, an enabled directory receives a new local A5 PDF before the browser print dialog opens. No prescription bytes are uploaded or stored in the application database. Repeated prints use distinct filenames. Folder access errors are explicit and do not claim a successful save. Unsupported browsers retain normal printing and manual Save as PDF.
- The browser may require renewed folder permission. The selection belongs to this browser/device and account; it is not a portable filesystem path. Browser menu/keyboard printing is outside the application's Print-button save flow. Print cancellation cannot reliably be detected; clicking Print creates the copy even if paper printing is cancelled.
- PDF rendering libraries load only when local archiving is used. The PDF contains rendered pages, including Arabic text and stationery; it is a visual copy, not structured medical data.

## Future phase

Local copies are temporary. A later patient medical-record feature should persist structured prescriptions, visits and their actual beneficiaries, with defined cross-doctor access. This change adds neither medical-record sharing nor prescription persistence in the server database.

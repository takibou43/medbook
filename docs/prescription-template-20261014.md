# Simplified bilingual prescription stationery

The A5 template editor now uses fixed Arabic and French columns with automatic layout, without dragging, coordinates, font or color controls. The compact header reserves 53 mm in the full sample. The doctor's logo sits between the columns; the existing local specialty icon is used when no personal logo is supplied.

New generated stationery includes a faint central MadBook watermark and a 24 mm booking QR at the bottom. QR generation is local, contains only the public doctor booking URL, and never includes patient data or access tokens. Blank-paper printing includes the stationery; preprinted-paper printing excludes it. Existing saved templates remain unchanged until explicit save. Uploaded-image analysis, PDF upload and medical letters are deferred.

Template source and print mode use the existing JSON design field with strict validation. No Prisma schema, migration, prescription persistence flag, subscription, role or beneficiary identity logic changes are included.

Validation: 116 doctor frontend tests passed; TypeScript/Vite production build passed. Template schema and mocked API ownership/CRUD tests passed. Synthetic browser checks covered desktop/mobile, bilingual details, logo upload/removal and specialty fallback, save/reopen/cancel, and both PDF print modes. An independent QR reader decoded the PDF raster to the expected synthetic doctor booking URL. Physical printing and phone-camera scanning were not tested; production data was not written for testing.

Release verification must correlate the final merge SHA with CI, Render startup/runtime logs, both Vercel production deployments, HTTP health and the deployed prescription editor chunk. Roll back this release if template saving fails or the deployed editor/print flow breaks. Retain the existing template JSON when reverting code.

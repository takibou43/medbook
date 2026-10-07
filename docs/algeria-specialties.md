# Algeria specialty catalog

The catalog contains 63 entries for medicine and dentistry, including the existing ten labels and the three new 2026-2027 specialties (allergology and clinical immunology, medical genetics, geriatrics). Arabic labels are patient-facing translations; French labels follow the consulted official nomenclature. Pharmacy and allied health professions are outside this physician catalog.

Sources checked on 2026-10-07:

- University of Health Sciences, medical postgraduate specialties: https://www.univ-health.dz/post-graduation/
- MESRS order 1137 of 2015, DEMS annex (fundamental, surgical and dental specialties): https://services.mesrs.dz/DEJA/fichiers_sommaire_des_textes/129%20H%20BIS%20fr.pdf
- Dentistry curricula: https://www.ummto.dz/fmed/medecine-dentaire/ and https://www.univ-sba.dz/med/graduation-fr/
- University of Health Sciences, new specialties for 2026-2027, published 2026-08-15: https://www.univ-health.dz/fr/category/note-information-fr/page/2/

This combines the specialties in these sources. It is not a guarantee that no later specialty has been established. Do not label this list as an exhaustive current legal register.

`prisma/seed.ts` uses the same catalog for demonstration databases. Do not run the full seed against production: it also creates demonstration accounts and appointments.

For an existing database, from `backend`:

```powershell
npx tsx scripts/sync-specialties.ts
npx tsx scripts/sync-specialties.ts --apply
```

The first command reads the configured database and prints the proposed additions. The second adds missing specialties in one transaction without updating existing IDs, labels, doctor relationships, accounts, or appointments. Neither has been executed as part of this change. Production execution requires authorization. Review the preview for alternate labels before applying; normalized matching handles accents and separators but cannot identify every synonym.

Doctor registration, clinic doctor registration/invitations, and profile editing also accept `specialtyName` instead of `specialtyId`. Typed names reuse a case-insensitive Arabic/French match or create a specialty in the same transaction as the doctor change. Both fields together, invalid names, missing required selections and unknown IDs are rejected. Custom names are entered by the doctor; they are not evidence of an officially recognized specialty.

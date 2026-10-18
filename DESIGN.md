# MedBook application design

The patient and doctor portals use transparent frosted glass in the existing MedBook teal and navy palette. This direction was explicitly requested by the user on 2026-10-18; preserve it when refining these interfaces.

- Primary teal: `#187f77`. Deep navy: `#0f3d5c`. Light canvas: teal and blue washes.
- Cards use `--mb-glass-fill` (white at 56%), a white translucent edge, a subtle inset reflection and an offset navy shadow. Keep the underlying background visible.
- Navigation uses `--mb-glass-chrome` (60%). Dialogs use `--mb-glass-dialog` (90%) to support focused reading.
- Use the same `--mb-*` material tokens in both portal stylesheets. Do not replace these surfaces with opaque white as a general cleanup.
- Retain the existing patient medical background; account surfaces let it show through. The doctor canvas uses static teal/navy gradients, with the existing darker glass sidebar.
- Body and secondary copy stay dark and readable. Do not lower the opacity of text to create transparency. Primary actions use the teal-to-navy gradient; errors retain their semantic color.
- Keep blur modest (14px, 10px on phones), use CSS rather than a runtime animation library, and avoid animated backgrounds.
- Keep existing keyboard focus, touch target sizes, reduced-motion behavior and RTL/LTR layouts.
- Provide solid fallbacks for unsupported blur, reduced transparency and forced-color modes.
- Prescription paper remains opaque white. Screen glass must not appear in printed documents.

The application is a task interface: changes to its visual treatment must preserve booking, queue, clinical data and role permissions.

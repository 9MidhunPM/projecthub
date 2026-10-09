# Frontend verification

## Completed
- Next.js production build compiles all 12 application routes.
- TypeScript strict typecheck passes.
- Both generated concept files inspected with `view_image`.
- Static code review of desktop, tablet and phone breakpoints.
- Shared API contract checked: cookie credentials, project fields, full project PATCH, screenshot multipart upload, moderation states, role controls.
- Fixed contract mismatches: password minimum 10; name maximum 80; canonical project types; Environmental Engineering department; technology search placeholder removed from general search; 8-screenshot limit.

## Browser verification blocked
The separate fullstack QA attempt could not launch Chromium because the execution environment denied required Unix socket operations. The cloud browser could not access the isolated localhost and its URL policy rejected the recovery path. No rendered screenshots were captured. No claim of browser interaction verification, native-size visual matching, mobile rendering success, or agency-signoff fidelity is made.

## Static design comparison ledger
These are implementation-to-spec checks, not rendered-image comparisons.

| Area | Concept | Implementation evidence | Status |
|---|---|---|---|
| Palette | White, navy, cobalt, pale cool gray | CSS root tokens lock #fff / #142039 / #3158ed / #f5f7fb | Code matched; render unverified |
| Gallery structure | Header, open heading, search row, filter rail, three columns | page.tsx and gallery-layout/project-grid rules | Code matched; render unverified |
| Typography | Large tight heading, compact controls, subdued secondary copy | Explicit heading/control/caption scales | Code matched; render unverified |
| Media | Screenshot-led cards, clean clipping, no tinted overlays | ProjectCover, generated standalone example media, object-fit cover | Code matched; render unverified |
| Workspace | Real count row, tab bar, tabular project rows, checklist | workspace.tsx and table/stat/checklist CSS | Code matched; render unverified |
| Mobile | Narrow header, toggled filters, stacked gallery | 600px breakpoint, mobile menu/filter state | Implemented; overflow/interaction unverified |
| Forms | White bordered fields, clear labels, blue primary actions | Shared form-panel/control/button system | Implemented; keyboard interaction unverified |

Above-the-fold copy differs intentionally for accurate API search semantics and required bookmark/archive metadata. Full deviations are recorded in DESIGN-SYSTEM.md. Real data replaces mockup counts and identities. Generated concept images are design previews only, never screenshots of the running application.

# Manual acceptance checklist

Run against an isolated database with fictional data. Record actual pass/fail and screenshots; unchecked items are not claimed as tested.

## Public browsing
- [ ] Gallery loads approved projects only; loading and error states remain readable.
- [ ] Search title/description and combine department, semester, technology, and type filters.
- [ ] Clear filters and exercise empty results, sort, pagination, and browser Back/Forward.
- [ ] Open a project, inspect screenshots, GitHub and demo links, team and technologies.
- [ ] Draft, pending, changes-requested, and hidden project IDs are unavailable to guests.
- [ ] Public JSON and visible UI do not expose account emails or password/session data.

## Authentication and sessions
- [ ] Create a student account with valid department/semester; malformed values are rejected.
- [ ] Duplicate email and incorrect password fail without exposing internals.
- [ ] Refresh retains login; logout revokes the session and private views redirect or deny.
- [ ] Direct student calls to admin/reviewer routes return authorization errors.
- [ ] Mutation requests with missing/wrong Origin are denied.
- [ ] Browser Close/Back during login and repeated Submit do not cause unexpected navigation.

## Student workflow
- [ ] Create a draft with complete title, description, technologies, team, valid URLs.
- [ ] Upload PNG/JPEG/WebP; reject oversized/unsupported or disguised files.
- [ ] Save, reload, edit, cancel, and revisit draft; expected values persist.
- [ ] Submit for review and observe pending status; project is not in public gallery.
- [ ] Another student cannot view/edit/delete the private project or replace its images.
- [ ] Like/bookmark an approved project; repeated operations don't create duplicates.
- [ ] Logout/login and verify bookmark persistence; remove bookmark and verify list updates.
- [ ] Reload project multiple times on same day; approximate view count is de-duplicated.
- [ ] Edit approved project; revised content is removed from public visibility until reviewed.

## Faculty and administration
- [ ] Faculty review queue displays pending projects and supports project inspection.
- [ ] Request changes with feedback; owner sees it and can revise/resubmit.
- [ ] Approve a submission; it appears in gallery and detail route for guests.
- [ ] Hide a public project; it disappears from gallery and guest detail.
- [ ] Students cannot approve their own work via API payload or crafted request.
- [ ] Admin can list users and change permitted roles; faculty cannot do so.
- [ ] Last-administrator safeguards work; audit records describe role/moderation changes.

## Layout, accessibility, resilience
- [ ] Check widths 390px, 768px, 1280px; no horizontal overflow, clipped dialogs, or hidden actions.
- [ ] Use keyboard only: navigation, forms, menus/dialogs, tabs, and visible focus.
- [ ] Labels connect to controls; errors and success notices are perceivable.
- [ ] Slow/failing API, rejected uploads, empty library, long titles and many tech tags remain usable.
- [ ] Multiple clicks, interrupted saves, canceled edits, and stale role/session states recover clearly.

## Operations
- [ ] Fresh migrations and fictional seed succeed on a clean PostgreSQL database.
- [ ] Restart API/web and confirm DB records and screenshots persist.
- [ ] Production standalone build serves HTML, JavaScript/CSS, and public assets; `/api/health/ready` works through the frontend proxy and fails clearly when the database is unavailable.
- [ ] `/api/health` remains available as liveness, while container readiness waits for the database and successful migrations.
- [ ] API responses are not cached across users; private screenshots stay `private, no-store`; frontend HTML has expected browser security headers.
- [ ] Approved HTTPS staging has secure session cookies and exact WEB_ORIGIN.
- [ ] Backup and restore both database and upload volume on isolated infrastructure.

Automated checks and actual run results should be documented separately; this list is an acceptance procedure, not a test report.

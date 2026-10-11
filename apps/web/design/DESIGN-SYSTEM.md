# ProjectHub visual specification

## References
- `gallery-concept.png`: complete desktop gallery plus mobile continuation.
- `workspace-concept.png`: student workspace plus coordinated editor.
- Built-in Image Gen generated both concepts before implementation. The six public example screenshots were generated separately as fictional project media, not used as application UI.

## Design tokens
- Background: true white #ffffff, not cream.
- Text: deep navy #142039; secondary `--muted` #596780 for small text on white and pale surfaces.
- Accent: cobalt #3158ed; pale surface #f5f7fb; muted blue `--blue-muted` #526b9e for upload and image-fallback titles.
- Semantic emphasis: `--warning-text` #8a5a0b for changes-requested badges and reviewer feedback; `--focus` #5d7cdc for custom focus outlines.
- Borders: #e2e7f0, controls #d7deeb.
- Typography: Arial/Helvetica sans serif for consistent offline rendering. Gallery heading 53px desktop, 40px phone; page heading 38px; body 14px; controls 12–14px; captions 10–12px.
- Corners: 7px controls, 9–10px panels and media. Minimal elevation; hover cards lift 3px.
- Icons: Lucide outline, generally 16–20px and default 2px stroke. Cube brand, heart likes, bookmark saves, arrow external links, upload files.

## Container and component model
- Header: white single horizontal brand/navigation/action rail with active underline.
- Gallery: open editorial heading, full search row, 220px light-gray filter rail, three-column screenshot-led project cards, centered pagination.
- Card: separate screenshot, title, description, technology tags, author and real interaction counts. No static screenshot used as app controls.
- Workspace: heading/action row, three real statistics, tab bar, project table, review checklist.
- Editor: primary form and screenshot/sidebar column; same input, label, border, and button families as concepts.
- Detail: project title/author/actions, screenshot area, story, compact information sidebar.
- Role tools: simple real data lists and reusable form/action components.
- Mobile: collapsible header navigation, toggleable filters, one-column cards, tables transformed into stacked rows, single-column editor.
- Motion: subtle hover/focus transitions, all disabled for reduced-motion preference.

## Above-the-fold copy inventory
ProjectHub; Explore; My workspace; Bookmarks; Sign in; Share a project; Big ideas. Built here.; Discover what students are building. Share what comes next.; A home for student work.; Search projects or ideas; Sort; Newest; Most liked; Department; All departments; Semester; All semesters; Project type; All project types; Technology; Clear filters; Explore projects.

## Intentional functional deviations from concept
- Search placeholder says “Search projects or ideas”, because API text search does not cover the separate exact technology filter.
- Department and semester captions added to each gallery card to support browsing academic archives.
- Bookmark buttons are included on cards because saving projects is required.
- Gallery pagination displays “Page X of Y”, not a misleading static page pill.
- All counts, project titles, authors and statuses come from API data. Concept example names and counts are not fabricated in application state.
- Project screenshots are new standalone generated assets aligned with example project subjects, not cropped concepts.
- Editor is a full dedicated route instead of permanently reducing the workspace table width with an open editing pane.
- Footer excludes invented About, Help, Contact, Privacy and Terms links that would have no implemented destination.
- Text-only fallback is shown for projects without an uploaded screenshot; no unrelated screenshot is reused.


## Source-level contrast guardrails
- Ordinary small text uses the WCAG 2.2 [SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) threshold of at least 4.5:1, without rounding borderline values upward. Custom focus indicators are checked separately against adjacent backgrounds at 3:1 under [SC 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).
- The selected muted token is at least 5.049:1 across the tested white/pale surfaces. Warning text is 5.419:1 on its #fff4dc badge. The focus token is 3.902:1 on white and 4.155:1 on the navy toast; reusing the primary blue for that dark-surface outline would fall below 3:1.
- `test/contrast.test.ts` checks explicit opaque selector/surface pairs, status colors, primary button/toast text, focus outlines, and the existing reduced-motion overrides without extra dependencies. Disabled-state opacity and reduced-motion behavior are unchanged.
- These are source-level safeguards, not rendered-browser verification or a whole-application WCAG compliance claim. Image backgrounds, unknown compositing, layout, and actual assistive-technology behavior need separate verification.

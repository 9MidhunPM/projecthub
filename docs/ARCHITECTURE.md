# Architecture and data model

## Request flow

Browser → Next.js (port 3000) → same-origin `/api` proxy → NestJS (port 4000) → Prisma → PostgreSQL. Uploaded images live on an API filesystem volume and are served through `/api/uploads`. Production proxy routing is configured with `API_INTERNAL_URL` during frontend build. Clients never receive database credentials.

## Entity relationships

```mermaid
erDiagram
    User ||--o{ Session : authenticates
    User ||--o{ Project : owns
    User ||--o{ Like : likes
    User ||--o{ Bookmark : saves
    Project ||--o{ Like : receives
    Project ||--o{ Bookmark : receives
    Project ||--o{ ViewEvent : tracks
    User {
      string id PK
      string email UK
      string passwordHash
      string name
      Role role
      string department
      int semester
      string bio
      datetime createdAt
    }
    Session {
      string id PK "hashed token"
      string userId FK
      datetime expiresAt
    }
    Project {
      string id PK
      string ownerId FK
      string title
      string description
      string department
      int semester
      string type
      string_array techStack
      string_array teamMembers
      string githubUrl
      string demoUrl
      string_array screenshots
      ProjectStatus status
      string feedback
      int views
      datetime createdAt
      datetime updatedAt
    }
    Like {
      string userId PK,FK
      string projectId PK,FK
    }
    Bookmark {
      string userId PK,FK
      string projectId PK,FK
    }
    ViewEvent {
      string projectId PK,FK
      string visitor PK "hashed identifier"
      string day PK "UTC date"
    }
    Upload {
      string filename PK
      string ownerId "no foreign key"
      datetime createdAt
    }
    Audit {
      string id PK
      string actorId "no foreign key"
      string action
      string targetId
      string details
      datetime createdAt
    }
```

Schema source of truth: `apps/api/prisma/schema.prisma`. Audit and Upload store identifiers without database relations. Audit retains its identifiers independently of entity lifetimes; uploaded-file cleanup must be handled separately from user/project deletion. Upload access is checked against ownership/reviewer role or an approved project reference. User deletion cascades to sessions/projects/likes/bookmarks; project deletion cascades to likes/bookmarks/view events. There is no general user-deletion UI in this MVP.

## Lifecycle and authorization

- New project starts `DRAFT`. Owner submits it to `PENDING`.
- Faculty/admin approve, request changes, or hide submissions. Public gallery returns only `APPROVED` projects.
- Editing pending/approved content returns it to draft so public text changes require another review.
- Private project detail access is restricted to owner/reviewer. Students cannot set roles or moderation states through normal create/update DTOs.
- Public signup sets role `STUDENT`; only admin role-management endpoints elevate users.
- Likes and bookmarks use compound primary keys to make duplicates impossible. Daily view records have `(projectId, visitor, day)` uniqueness and update the counter transactionally.

## Trust boundaries

The API is authoritative. UI role-based controls are convenience, not security enforcement. DTO validation rejects unexpected properties. Session cookies are opaque random values with server-side hashed-token storage, expiry, and logout revocation. API checks exact request Origin for mutations and applies request/auth rate limits. HTTPS and secure cookies are required for non-loopback production. Raw file names and MIME labels are insufficient; uploaded image bytes are decoded and re-encoded, and only supported image formats are accepted.

Public content is intentionally readable without an account. Project titles, descriptions, screenshots, team-member names, GitHub links, and live-demo links may therefore disclose student data. Institutions must define consent, retention, and approval rules before public use. Secrets or private code must never be uploaded. This app links to external code; it does not execute or host uploaded repositories.

## Intentional MVP limitations

- Team-member names are metadata; collaborators do not receive edit permissions.
- Project progress means draft/review/publication status and reviewer feedback, not milestones or grading.
- Local uploads require a persistent volume and one shared storage location if scaling API replicas.
- Rate limiting is in process; use shared storage before scaling horizontally.
- View de-duplication is an approximate engagement metric, not fraud-resistant analytics.
- No email verification, password-reset delivery, SSO, MFA, notification system, account deletion workflow, or automated retention policy.
- No production SLA, penetration test, or production certification is implied by the included tests.

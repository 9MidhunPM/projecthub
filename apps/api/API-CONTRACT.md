# ProjectHub API
Base `/api`, JSON, browser credentials included. Cookies are httpOnly; mutations require Origin matching WEB_ORIGIN (default http://localhost:3000). Error shape `{statusCode,message}`.
Optional request fields may be omitted but cannot be `null`. Human-readable text, email, URLs, and individual technology/team names are trimmed before validation; passwords are preserved exactly. Empty strings clear optional text fields, and an empty screenshot array clears screenshots.
- POST /auth/signup {name,email,password,department,semester}; POST /auth/login {email,password}; POST /auth/logout; GET /auth/me -> user object (401 logged out).
- PATCH /profile {name?,department?,semester?,bio?} -> user.
- GET /projects?q=&department=&semester=&type=&tech=&page=1&limit=12&sort=recent|popular -> {items,total,page,limit,pages}. Approved only.
- GET /projects/:id -> project; POST /projects/:id/view -> {views}; GET /my/projects -> project[]; GET /my/bookmarks -> project[].
- POST /projects, PATCH /projects/:id {title,description,department,semester,type,techStack:string[],teamMembers:string[],githubUrl?,demoUrl?,screenshots?:string[]} -> project. Create defaults draft, edit approved/pending resets draft. DELETE /projects/:id.
- POST /projects/:id/submit -> project (PENDING).
- POST /uploads multipart field `file` -> {url}; PNG/JPEG/WebP up to 5 MB, authenticated. Use returned URL in screenshots.
- PUT /projects/:id/like and DELETE /projects/:id/like; PUT /projects/:id/bookmark and DELETE /projects/:id/bookmark -> {liked,bookmarked,likes}.
- GET /moderation/projects?status=PENDING -> project[] (faculty/admin); PATCH /moderation/projects/:id {status:APPROVED|CHANGES_REQUESTED|HIDDEN,feedback?:string}.
- GET /admin/users -> user[]; PATCH /admin/users/:id/role {role:STUDENT|FACULTY|ADMIN}; GET /admin/audit -> audit[]. Admin only.
Project fields: id,title,description,department,semester(integer1-12),type(string),techStack,teamMembers,githubUrl,demoUrl,screenshots,status,feedback,views,createdAt,updatedAt,ownerId,owner:{id,name,department,semester,bio},likes(number),bookmarks(number),liked(boolean),bookmarked(boolean). Public results never expose owner email. Auth/profile user includes id,name,email,role,department,semester,bio,createdAt.

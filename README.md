# StreamHub — Backend

**Express 5** HTTP API (`/api`) plus **Socket.io** on the same Node **http** server. Persists data in **MongoDB** (Mongoose); org video uploads go to **Cloudinary** via Multer storage.



---

## Stack

| Technology | Role |
|------------|------|
| **Express 5** | REST API, JSON body, CORS, compression (disabled for video stream paths) |
| **Mongoose 8** | `AppUser`, `Organization`, `OrganizationMembership`, `Video` |
| **jsonwebtoken** | App-user JWT (`verifyAppUserToken`, socket auth) |
| **Cloudinary** | Video storage; `src/cloudinary.js`, `isCloudinaryConfigured` |
| **multer + multer-storage-cloudinary** | Org upload / replace pipelines |
| **Socket.io** | `src/socket/attachSocketServer.js` — progress events to clients |
| **dotenv** | `backend/.env` |

---

## What this service does

- **Auth:** Register (creates user + organization + admin membership), login (JWT + organizations payload).
- **Organizations:** CRUD for “my” orgs; membership checks on every org-scoped route.
- **Members:** List/add/patch/remove members; org roles **admin** / **editor** / **viewer**; guards (e.g. last admin).
- **Org videos:** List (filters), create (multipart → Cloudinary), status, replace, patch, delete; serialization includes processing + sensitivity fields.
- **Watch meta:** Member-only route for org-linked videos when processing is **ready**.
- **Public videos:** List and meta for catalog; stream route for range requests; filters for safe/ready content on list.
- **Post-upload pipeline:** Sensitivity / moderation hooks in `src/services/sensitivityPipeline.js` (env-gated).

---

## Environment variables

Create **`backend/.env`** (never commit real secrets).

### Required for a typical dev setup

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | Secret for signing and verifying app-user JWTs |
| `MONGO_USER` | MongoDB Atlas username |
| `MONGO_PASSWORD` | MongoDB Atlas password |
| `MONGO_CLUSTER_NAME` | Cluster host segment used in `src/db/mongo-db-connect.js` |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |

### Optional

| Variable | Description |
|----------|-------------|
| `PORT` | HTTP port (default **8000**) |
| `SOCKET_CORS_ORIGIN` or `CLIENT_ORIGIN` | Allowed browser origin for Socket.io (e.g. `http://localhost:3000`) |
| `CLOUDINARY_VIDEO_FOLDER` | Folder prefix for uploads (default `streamhub-videos`) |
| `CLOUDINARY_VIDEO_MODERATION` | `true` to enable moderation-related pipeline behavior |
| `CLOUDINARY_MODERATION_MOCK` | Mock path for moderation / local testing |

---

## Run locally

```bash
cd backend
npm install
npm run dev
```

- API base: `http://localhost:8000/api`
- Health check: any known `GET` route (e.g. public videos) once MongoDB and env are valid.

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | `nodemon index.js` |
| `npm start` | `node index.js` |

---

## Project layout (`src/`)

| Path | Description |
|------|-------------|
| `index.js` (repo root) | Express app, middleware, `connectDB`, `/api` router, error handler, HTTP + Socket.io |
| `src/routes/routes.js` | All routes (`router.route` chains) |
| `src/middleware/verifyAppUserToken.js` | JWT, `loadOrgMembershipParam`, `requireOrgRoles` |
| `src/middleware/videoUpload.js` | Multer + Cloudinary; `requireCloudinaryForOrgUpload` |
| `src/controllers/userControllers.js` | Register, login |
| `src/controllers/organizationControllers.js` | Orgs + members |
| `src/controllers/userOrgVideoControllers.js` | Org videos CRUD + watch-meta |
| `src/controllers/videoControllers.js` | Public list/meta/stream, `serializePublic` / `serializeAdmin` |
| `src/models/*.js` | Mongoose schemas |
| `src/services/sensitivityPipeline.js` | After-upload processing |
| `src/services/uploadValidation.js` | Extensions, max size |
| `src/services/organizationName.js` | Name normalization / uniqueness |
| `src/socket/` | Attach server, emit org video progress |
| `src/db/mongo-db-connect.js` | Atlas connection string |
| `src/cloudinary.js` | Cloudinary SDK config |

---

## API routes summary

All routes are prefixed with **`/api`**.

| Area | Methods | Path pattern |
|------|---------|----------------|
| Auth | POST | `/users/register`, `/users/login` |
| My orgs | GET, POST | `/users/me/organizations` |
| One org | PATCH, DELETE | `/users/me/organizations/:organizationId` |
| Members | GET, POST | `/users/me/organizations/:organizationId/members` |
| One member | PATCH, DELETE | `.../members/:memberUserId` |
| Org videos | GET, POST | `/users/me/organizations/:organizationId/videos` |
| Video status | GET | `.../videos/:videoId/status` |
| Replace file | POST | `.../videos/:videoId/replace` |
| Video meta patch / delete | PATCH, DELETE | `.../videos/:videoId` |
| Member watch meta | GET | `/users/me/videos/:videoId/watch-meta` |
| Public | GET | `/videos`, `/videos/:id`, `/videos/:id/stream` |

Upload/replace routes use multipart middleware and Cloudinary storage; org mutating routes require appropriate **org roles** (admin vs editor vs viewer).

---

## Design notes

- **Authorization** is enforced in middleware/controllers, not assumed from the client.
- **Compression** is skipped for URLs that include both `/videos/` and `/stream` so byte-range streaming works reliably.
- **Videos** reference Cloudinary `public_id` / URL in MongoDB; large binaries are not stored on the app server disk in the main flow.

---


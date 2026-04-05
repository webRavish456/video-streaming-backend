# StreamHub — Backend

**Express 5** HTTP API under **`/api`**, plus **Socket.io** on the same Node **http** server. Data in **MongoDB** (Mongoose); org video uploads use **Cloudinary** (Multer).


---

## Run this API locally (for another developer)

### 1. Prerequisites

- **Node.js** 20+
- **MongoDB Atlas** cluster (or change `src/db/mongo-db-connect.js` if you use another Mongo URL)
- **Cloudinary** account (required for org video **upload** / **replace** routes)

### 2. Install and configure

```bash
cd backend
npm install
cp env.example .env
```

Edit **`.env`**. See [Environment variables](#environment-variables). The Mongo connection string is built in `src/db/mongo-db-connect.js` as:

`mongodb+srv://MONGO_USER:MONGO_PASSWORD@MONGO_CLUSTER_NAME.4bgwppg.mongodb.net/video?...`

If your Atlas host uses a **different domain** than `.4bgwppg.mongodb.net`, update that file to match your SRV hostname.

### 3. Start the server

```bash
npm run dev
```

- **HTTP + API base:** `http://localhost:8000` → JSON routes are under **`http://localhost:8000/api`**
- **Socket.io:** same origin, path **`/socket.io`** (see [WebSockets](#websockets-socketio))

### 4. Quick smoke test (no auth)

```bash
curl -s "http://localhost:8000/api/videos?limit=5"
```

Expect JSON with `status: "success"` and a `videos` array (may be empty).

### 5. Full flow (auth + org)

1. `POST /api/users/register` with body below → `201`
2. `POST /api/users/login` → copy `access_token`
3. Call protected routes with header: **`Authorization: Bearer <access_token>`**

---

## Conventions

### Base path

All routes below are relative to **`/api`**. Example: full URL for login is  
`POST http://localhost:8000/api/users/login`

### JSON responses

Most endpoints return JSON:

- **Success:** `{ "status": "success", ... }`
- **Error:** `{ "status": "error", "message": "..." }` with appropriate HTTP status (400, 401, 403, 404, 409, 500, …)

### Authentication (app user)

Protected routes expect:

```http
Authorization: Bearer <JWT>
```

JWT is returned by **`POST /users/login`** as `access_token`. Payload includes `userId`, `email`, `tokenType: "user"`, `appRole`.

### Organization context

Routes with **`:organizationId`** require:

1. Valid JWT  
2. User must be a **member** of that organization (`loadOrgMembershipParam`)

Some routes additionally require an **org role**:

- **`admin`** — org settings, members, delete videos  
- **`admin` or `editor`** — upload, replace, patch video metadata  
- **any member** — list org videos, get status, list members (where not restricted)

---

## API reference

### Auth

#### `POST /users/register`

Creates **AppUser**, **Organization**, and membership with org role **admin**.

**Body (JSON):**

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `name` | string | yes | |
| `email` | string | yes | unique |
| `phone` | string | yes | normalized to **10 digits** |
| `password` | string | yes | min 6 chars |
| `organizationName` | string | yes | min 2 chars after normalize; unique org name |

**201** — `{ status, message }`  
**400 / 409 / 500** — `{ status: "error", message }`

---

#### `POST /users/login`

**Body (JSON):**

| Field | Type | Required |
|-------|------|----------|
| `password` | string | yes |
| `identifier` | string | yes* |
| `email` | string | alt to `identifier` |

Use **`identifier`** (or `email`) as **email** or **10-digit phone**.

**200:**

```json
{
  "status": "success",
  "message": "Login successful",
  "access_token": "<JWT>",
  "user": {
    "id": "...",
    "name": "...",
    "email": "...",
    "phone": "...",
    "role": "viewer|editor",
    "organizations": [
      { "id": "...", "name": "...", "orgRole": "admin|editor|viewer", "isOrganizationCreator": true }
    ],
    "activeOrganizationId": "..." 
  }
}
```

**401** — invalid credentials.

---

### My organizations

#### `GET /users/me/organizations`

**Auth:** Bearer  

**200:** `{ "status": "success", "organizations": [ ... ] }`

---

#### `POST /users/me/organizations`

Create another organization; caller becomes **admin**.

**Auth:** Bearer  

**Body:** `{ "name": "<org name, min 2 chars>" }`

**201:** `{ status, organization: { id, name, orgRole: "admin" } }`

---

#### `PATCH /users/me/organizations/:organizationId`

**Auth:** Bearer · **Org role:** `admin`

**Body:** `{ "name": "<new name>" }`

**200:** `{ status, message, organization }`

---

#### `DELETE /users/me/organizations/:organizationId`

**Auth:** Bearer · **Only** the **organization creator** may delete.

Deletes org memberships, videos (and Cloudinary assets), then the org.

**200:** `{ status, message }`

---

### Organization members

#### `GET /users/me/organizations/:organizationId/members`

**Auth:** Bearer · must be org member.

**200:** `{ "status": "success", "members": [ { userId, name, email, phone, orgRole, isOrganizationCreator } ] }`

---

#### `POST /users/me/organizations/:organizationId/members`

**Auth:** Bearer · **Org role:** `admin`

**Body (JSON):**

| Field | Type | Required |
|-------|------|----------|
| `name` | string | yes |
| `email` | string | yes |
| `phone` | string | yes (10 digits after normalize) |
| `password` | string | yes (min 6) — used for **new** users or as provided |
| `role` | string | optional — `admin` \| `editor` \| `viewer` (default `viewer`) |

**201:** `{ status, message, member }`  
**409** — duplicate member / phone conflicts.

---

#### `PATCH /users/me/organizations/:organizationId/members/:memberUserId`

**Auth:** Bearer · **Org role:** `admin`

**Body (JSON):** any of `orgRole` (or `role`), `name`, `email`, `phone`.

Cannot demote/remove protections on **last admin** or edit org **creator** in restricted ways (see controller).

**200:** updated member payload.

---

#### `DELETE /users/me/organizations/:organizationId/members/:memberUserId`

**Auth:** Bearer · **Org role:** `admin`

**200:** success message.

---

### Org videos (authenticated)

#### `GET /users/me/organizations/:organizationId/videos`

**Auth:** Bearer · org member.

**Query (optional):**

| Param | Description |
|-------|-------------|
| `safety` | `safe` \| `flagged` \| `pending` \| `processing` |
| `processing` | `uploaded` \| `analyzing` \| `ready` \| `failed` |
| `q` | Search title / description (regex, case-insensitive) |
| `dateFrom`, `dateTo` | ISO date strings |
| `minSize`, `maxSize` | `fileSize` in bytes |
| `minDuration`, `maxDuration` | `durationMs` |
| `limit` | default 10, max 1000 |
| `skip` | pagination offset |

**200:** `{ status, videos: [...], total, limit, skip }`  
Videos are **admin** serialization (processing, sensitivity, `uploadedByUser`, `organization`, etc.).

---

#### `POST /users/me/organizations/:organizationId/videos`

**Auth:** Bearer · org **`admin`** or **`editor`**  
**Requires:** Cloudinary env configured.

**Content-Type:** `multipart/form-data`

| Field | Type | Required |
|-------|------|----------|
| `video` | file | yes — `.mp4`, `.webm`, `.mov` |
| `title` | string | yes |
| `description` | string | yes |

**201:** `{ status, message, video }`

---

#### `GET /users/me/organizations/:organizationId/videos/:videoId/status`

**Auth:** Bearer · org member.

**200:** `{ status, video }`

---

#### `POST /users/me/organizations/:organizationId/videos/:videoId/replace`

Same auth and multipart rules as **create** (admin/editor + Cloudinary).

**200:** `{ status, message, video }`

---

#### `PATCH /users/me/organizations/:organizationId/videos/:videoId`

**Auth:** Bearer · **admin** or **editor**

**Body (JSON):** optional `title`, `description` (at least one required).

**200:** `{ status, message, video }`

---

#### `DELETE /users/me/organizations/:organizationId/videos/:videoId`

**Auth:** Bearer · **admin** only.

**200:** `{ status, message }`

---

### Member watch metadata

#### `GET /users/me/videos/:videoId/watch-meta`

**Auth:** Bearer  

User must be a **member** of the video’s organization; video must have `processingStatus === "ready"`.

**200:** `{ status, video }` — **public** shape (playback-oriented).  
**403 / 404 / 400** — forbidden, not found, or not ready.

---

### Public catalog (no JWT)

#### `GET /videos`

Lists videos that are **ready** and **safe**, and **not** tied to an organization (public feed).

**Query:** same filter style as org list where applicable (`q`, dates, size, duration, `limit`, `skip`).

**200:** `{ status, videos }`

---

#### `GET /videos/:id`

Public metadata for one video (if exposed by controller rules).

**200:** `{ status, video }`

---

#### `OPTIONS /videos/:id/stream`  
#### `GET /videos/:id/stream`

Video bytes with **Range** support for players. **No** JSON body.

**CORS:** `Accept-Ranges`, `Content-Range`, etc. exposed as configured in `index.js`.

---

## WebSockets (Socket.io)

- **URL:** same host as API (e.g. `http://localhost:8000`), path **`/socket.io`**
- **CORS origins:** `SOCKET_CORS_ORIGIN` or `CLIENT_ORIGIN` (comma-separated), default `http://localhost:3000`
- **Handshake auth:** `{ auth: { token: "<same JWT as REST>" } } }`
- **Event emitted to org members:** **`video:progress`**  
  Payload includes at least `organizationId`, `videoId`, `phase`, upload/processing percents, statuses (see `emitOrgVideoProgress` usage in codebase).

---

## Environment variables

Copy from **`env.example`**:

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | yes | JWT signing secret |
| `MONGO_USER` | yes | Atlas user |
| `MONGO_PASSWORD` | yes | Atlas password |
| `MONGO_CLUSTER_NAME` | yes | Cluster hostname segment (see `mongo-db-connect.js`) |
| `CLOUDINARY_CLOUD_NAME` | yes* | *Required for org uploads |
| `CLOUDINARY_API_KEY` | yes* | |
| `CLOUDINARY_API_SECRET` | yes* | |
| `PORT` | no | Default **8000** |
| `SOCKET_CORS_ORIGIN` / `CLIENT_ORIGIN` | no | Browser origins for Socket.io |
| `CLOUDINARY_VIDEO_FOLDER` | no | Default `streamhub-videos` |
| `CLOUDINARY_VIDEO_MODERATION` | no | `true` enables moderation param on upload |
| `CLOUDINARY_MODERATION_MOCK` | no | Test / mock moderation |

---

## Stack

| Piece | Technology |
|-------|------------|
| HTTP | Express 5, `cors`, `compression` (skipped for `/videos/.../stream`) |
| Data | Mongoose 8 → MongoDB |
| Auth | `jsonwebtoken`, bcrypt (users) |
| Uploads | Multer + `multer-storage-cloudinary` |
| Real-time | `socket.io` |

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | `nodemon index.js` |
| `npm start` | `node index.js` |

---

## Project layout (`src/`)

| Path | Role |
|------|------|
| `index.js` (package root) | Express app, `/api` router, HTTP server + Socket.io |
| `src/routes/routes.js` | Route definitions |
| `src/middleware/verifyAppUserToken.js` | JWT + org membership + `requireOrgRoles` |
| `src/middleware/videoUpload.js` | Cloudinary storage, limits |
| `src/controllers/*` | Handlers |
| `src/models/*` | Mongoose schemas |
| `src/socket/` | Socket.io attach + progress emits |
| `src/db/mongo-db-connect.js` | Mongo connection |
| `src/cloudinary.js` | Cloudinary SDK |

---

## Design notes

- Org authorization is **server-side** (middleware + controllers).
- Video files for org flows go to **Cloudinary**; API stores metadata and URLs.
- Public list filters to **safe + ready** non-org videos.

---


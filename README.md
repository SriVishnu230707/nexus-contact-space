# Nexus — 3D Contact Space

A customer-ready, high-performance contact workspace featuring an interactive 3D constellation engine backed by a persistent zero-dependency Node.js REST API with dual-mode support for local servers and serverless edge deployment on Vercel.

## Highlights

- **Interactive 3D Constellation Sphere**: Real-time celestial projection distributing contacts across an orbital lattice with inertia-based drag rotation, mouse wheel zoom, depth sorting, dynamic connecting filaments, and raycasted hover tooltips.
- **Full Contact Lifecycle**: Create, view, edit (glassmorphic modal), search, and delete contacts with safety confirmation.
- **Extended Contact Schema**: Full Name, Email, Role/Company, and Phone Number.
- **RESTful Node.js Backend**: Zero third-party runtime dependencies using Node.js standard library (`http`, `crypto`, `fs`, `os`, `path`).
- **Complete REST API**:
  - `GET /api/health` — Service health and timestamp
  - `GET /api/contacts` — List contacts (supports `?q=` search and `?sort=name|newest|oldest`)
  - `GET /api/contacts/:id` — Retrieve a single contact by ID
  - `POST /api/contacts` — Create a validated contact with duplicate email protection
  - `PATCH /api/contacts/:id` — Partial update for contact details
  - `PUT /api/contacts/:id` — Complete update for contact details
  - `DELETE /api/contacts/:id` — Remove a contact
  - `OPTIONS /api/contacts` — Full CORS preflight support (`Access-Control-Allow-*`)
- **Vercel Serverless Ready**: Dual-mode runtime that operates seamlessly both as a standalone Node.js server (`server.listen()`) and as a Vercel Serverless Function with in-memory persistence fallback.
- **Resilient Persistence**: Atomic file write queue with self-healing error recovery and Windows file-lock resilience.
- **Offline Mode & Auto-Sync**: Local storage fallback with automatic health polling that syncs offline-created contacts once API connection is restored.
- **Modern Notification System**: Glassmorphic animated toast stack replacing native browser alerts.
- **Export Capabilities**: One-click JSON data export.

## Run Locally

```bash
# Start server (defaults to port 3000)
npm start
```

Open `http://localhost:3000` in any modern web browser. Override the port via `PORT=8080 npm start`.

## Run Automated Tests

```bash
npm test
```

Runs the automated integration test suite verifying health check, list/search, create, get by ID, patch, put, delete, duplicate handling, malformed payload rejections, and CORS preflight.

## Deploy to Vercel

The application is preconfigured for zero-config Vercel deployment with [`vercel.json`](vercel.json):

1. Push this repository to GitHub.
2. Import the project in Vercel.
3. Vercel automatically deploys `index.html` to its Global Edge CDN and routes `/api/*` requests through the serverless function handler in [`api/index.js`](api/index.js).

## Stack

- **Frontend**: Semantic HTML5, Vanilla CSS3 (Custom Properties, Glassmorphism, 3D Canvas rendering), Vanilla JavaScript (ES2022).
- **Backend**: Node.js standard library (`node:http`, `node:crypto`, `node:fs/promises`, `node:os`, `node:path`).
- **Storage**: JSON file store at `data/contacts.json` (local) or `/tmp/nexus_contacts.json` with memory cache fallback (serverless).

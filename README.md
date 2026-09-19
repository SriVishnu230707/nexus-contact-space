# Nexus — 3D Contact Space

A clean, customer-ready contact manager presented as a responsive spatial network, now backed by a persistent Node.js REST API.

## Highlights

- Add, search, update, and delete contacts through REST endpoints
- Atomic JSON persistence with sensible demo contacts
- Validation, duplicate-email protection, request-size limits, and structured errors
- API health monitoring with an automatic offline localStorage fallback
- Safe DOM rendering using `textContent`
- Pure-CSS 3D network sphere, orbit, and floating profiles
- Premium light visual system with responsive mobile layouts
- Keyboard-friendly forms and reduced-motion support

## Run locally

```bash
npm start
```

Open `http://localhost:3000`. Set `PORT` or `CONTACTS_FILE` to override the defaults.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Service health |
| `GET` | `/api/contacts?q=` | List or search contacts |
| `POST` | `/api/contacts` | Create a validated contact |
| `PATCH` | `/api/contacts/:id` | Update a contact |
| `DELETE` | `/api/contacts/:id` | Delete a contact |

## Stack

Semantic HTML, modern CSS, vanilla JavaScript, and the Node.js standard library—no runtime dependencies. Contacts are stored in `data/contacts.json`, created automatically on first launch. The older `Contact-Management-System-In-PYTHON-master` directory is an empty placeholder retained from the repository's original history.

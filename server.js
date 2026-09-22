'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const PORT = Number(process.env.PORT) || 3000;
const isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const DEFAULT_STORE = process.env.CONTACTS_FILE || (isVercel ? path.join(os.tmpdir(), 'nexus_contacts.json') : path.join(__dirname, 'data', 'contacts.json'));
const INDEX_FILE = path.join(__dirname, 'index.html');

const seedContacts = [
  { id: crypto.randomUUID(), name: 'Ava Morgan', email: 'ava@northstar.co', role: 'Product lead', phone: '+1 415 555 0192', createdAt: new Date().toISOString() },
  { id: crypto.randomUUID(), name: 'Samir Khan', email: 'samir@atelier.dev', role: 'Creative developer', phone: '+1 415 555 0148', createdAt: new Date().toISOString() },
  { id: crypto.randomUUID(), name: 'June Lee', email: 'june@studio.one', role: 'Design director', phone: '+1 415 555 0167', createdAt: new Date().toISOString() }
];

class ContactStore {
  constructor(file = DEFAULT_STORE) {
    this.file = file;
    this.memoryContacts = [...seedContacts];
    this.writeQueue = Promise.resolve();
  }

  async initialize() {
    try {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.access(this.file);
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw || '[]');
      if (Array.isArray(parsed) && parsed.length > 0) {
        this.memoryContacts = parsed;
      } else {
        await this.write(seedContacts);
      }
    } catch {
      try {
        await this.write(seedContacts);
      } catch {
        // Fallback for completely read-only filesystems (e.g. AWS Lambda without /tmp access)
      }
    }
  }

  async read() {
    await this.writeQueue.catch(() => {});
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw || '[]');
      this.memoryContacts = parsed;
      return parsed;
    } catch {
      return this.memoryContacts;
    }
  }

  async write(contacts) {
    this.memoryContacts = [...contacts];
    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(async () => {
        try {
          const temporary = `${this.file}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
          await fs.writeFile(temporary, JSON.stringify(contacts, null, 2) + '\n', 'utf8');
          try {
            await fs.rename(temporary, this.file);
          } catch {
            await fs.copyFile(temporary, this.file);
            await fs.unlink(temporary).catch(() => {});
          }
        } catch {
          // If filesystem write fails in serverless, memoryContacts persists for runtime duration
        }
      });
    return this.writeQueue;
  }
}

function json(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer'
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32_768) throw Object.assign(new Error('Request body is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('Request body must contain valid JSON.'), { status: 400 });
  }
}

function cleanContact(value, partial = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('Request body must be a valid JSON object.'), { status: 400 });
  }
  const result = {};
  for (const field of ['name', 'email', 'role', 'phone']) {
    if (value[field] !== undefined) result[field] = String(value[field]).trim();
  }
  if (!partial || result.name !== undefined) {
    if (!result.name || result.name.length > 50) throw Object.assign(new Error('Name must be between 1 and 50 characters.'), { status: 422 });
  }
  if (!partial || result.email !== undefined) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email || '') || result.email.length > 80) throw Object.assign(new Error('Enter a valid email address.'), { status: 422 });
    result.email = result.email.toLowerCase();
  }
  if (result.role !== undefined) {
    result.role = result.role || 'New connection';
    if (result.role.length > 50) throw Object.assign(new Error('Role must be 50 characters or fewer.'), { status: 422 });
  } else if (!partial) {
    result.role = 'New connection';
  }
  if (result.phone !== undefined) {
    result.phone = result.phone || '';
    if (result.phone.length > 30) throw Object.assign(new Error('Phone number must be 30 characters or fewer.'), { status: 422 });
  }
  return result;
}

function createServer({ store = new ContactStore(), indexFile = INDEX_FILE } = {}) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const routeParam = url.searchParams.get('route');
    let pathname = url.pathname;

    if (routeParam !== null && routeParam !== undefined) {
      pathname = routeParam ? '/api/' + routeParam.replace(/^\/+/, '') : '/api';
    } else if (request.headers['x-matched-path']) {
      pathname = request.headers['x-matched-path'];
    } else if (request.headers['x-forwarded-uri']) {
      pathname = new URL(request.headers['x-forwarded-uri'], 'http://localhost').pathname;
    }

    // CORS preflight
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400'
      });
      return response.end();
    }

    try {
      if (request.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        const html = await fs.readFile(indexFile);
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
        return response.end(html);
      }

      if (request.method === 'GET' && (pathname === '/favicon.ico' || pathname === '/api/favicon.ico')) {
        response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
        return response.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="10" fill="#6657e8"/><circle cx="16" cy="16" r="6" fill="#fff"/></svg>');
      }

      if (request.method === 'GET' && pathname === '/api/health') {
        return json(response, 200, { status: 'ok', service: 'nexus-contact-api', timestamp: new Date().toISOString() });
      }

      if (request.method === 'GET' && pathname === '/api/contacts') {
        const query = (url.searchParams.get('q') || '').trim().toLowerCase();
        const sort = (url.searchParams.get('sort') || '').trim().toLowerCase();
        let contacts = await store.read();
        if (query) {
          contacts = contacts.filter(contact =>
            [contact.name, contact.email, contact.role, contact.phone].filter(Boolean).some(value => value.toLowerCase().includes(query))
          );
        }
        if (sort === 'name') {
          contacts = [...contacts].sort((a, b) => a.name.localeCompare(b.name));
        } else if (sort === 'oldest') {
          contacts = [...contacts].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
        }
        return json(response, 200, { contacts, total: contacts.length });
      }

      if (request.method === 'POST' && pathname === '/api/contacts') {
        const input = cleanContact(await readJson(request));
        const contacts = await store.read();
        if (contacts.some(contact => contact.email === input.email)) {
          return json(response, 409, { error: 'A contact with this email already exists.' });
        }
        const contact = { id: crypto.randomUUID(), ...input, createdAt: new Date().toISOString() };
        contacts.unshift(contact);
        await store.write(contacts);
        return json(response, 201, { contact });
      }

      const match = pathname.match(/^\/api\/contacts\/([^/]+)$/);
      if (match) {
        const contactId = decodeURIComponent(match[1]);

        if (request.method === 'GET') {
          const contacts = await store.read();
          const contact = contacts.find(c => c.id === contactId);
          if (!contact) return json(response, 404, { error: 'Contact not found.' });
          return json(response, 200, { contact });
        }

        if (request.method === 'PATCH' || request.method === 'PUT') {
          const isPartial = request.method === 'PATCH';
          const changes = cleanContact(await readJson(request), isPartial);
          const contacts = await store.read();
          const index = contacts.findIndex(contact => contact.id === contactId);
          if (index < 0) return json(response, 404, { error: 'Contact not found.' });
          if (changes.email && contacts.some((contact, position) => position !== index && contact.email === changes.email)) {
            return json(response, 409, { error: 'A contact with this email already exists.' });
          }
          contacts[index] = { ...contacts[index], ...changes, updatedAt: new Date().toISOString() };
          await store.write(contacts);
          return json(response, 200, { contact: contacts[index] });
        }

        if (request.method === 'DELETE') {
          const contacts = await store.read();
          const remaining = contacts.filter(contact => contact.id !== contactId);
          if (remaining.length === contacts.length) return json(response, 404, { error: 'Contact not found.' });
          await store.write(remaining);
          return json(response, 200, { deleted: true });
        }
      }

      return json(response, 404, { error: 'Route not found.' });
    } catch (error) {
      if (!error.status || error.status >= 500) console.error(error);
      return json(response, error.status || 500, { error: error.status ? error.message : 'Internal server error.' });
    }
  });
}

// Serverless Handler for Vercel
let serverlessServer = null;

async function getServerlessServer() {
  if (!serverlessServer) {
    const store = new ContactStore(DEFAULT_STORE);
    await store.initialize();
    serverlessServer = createServer({ store });
  }
  return serverlessServer;
}

async function handler(req, res) {
  const server = await getServerlessServer();
  server.emit('request', req, res);
}

handler.ContactStore = ContactStore;
handler.createServer = createServer;
handler.cleanContact = cleanContact;
handler.seedContacts = seedContacts;

async function start() {
  const store = new ContactStore(DEFAULT_STORE);
  await store.initialize();
  const server = createServer({ store });
  server.listen(PORT, () => console.log(`Nexus is running at http://localhost:${PORT}`));
}

if (require.main === module) {
  start().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = handler;

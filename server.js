'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_STORE = path.join(__dirname, 'data', 'contacts.json');
const INDEX_FILE = path.join(__dirname, 'index.html');
const seedContacts = [
  { id: crypto.randomUUID(), name: 'Ava Morgan', email: 'ava@northstar.co', role: 'Product lead', createdAt: new Date().toISOString() },
  { id: crypto.randomUUID(), name: 'Samir Khan', email: 'samir@atelier.dev', role: 'Creative developer', createdAt: new Date().toISOString() },
  { id: crypto.randomUUID(), name: 'June Lee', email: 'june@studio.one', role: 'Design director', createdAt: new Date().toISOString() }
];

class ContactStore {
  constructor(file = DEFAULT_STORE) {
    this.file = file;
    this.writeQueue = Promise.resolve();
  }

  async initialize() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      await fs.access(this.file);
    } catch {
      await this.write(seedContacts);
    }
  }

  async read() {
    await this.writeQueue;
    return JSON.parse(await fs.readFile(this.file, 'utf8'));
  }

  async write(contacts) {
    this.writeQueue = this.writeQueue.then(async () => {
      const temporary = this.file + '.tmp';
      await fs.writeFile(temporary, JSON.stringify(contacts, null, 2) + '\n', 'utf8');
      await fs.rename(temporary, this.file);
    });
    return this.writeQueue;
  }
}

function json(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
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
  const result = {};
  for (const field of ['name', 'email', 'role']) {
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
  return result;
}

function createServer({ store = new ContactStore(), indexFile = INDEX_FILE } = {}) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    try {
      if (request.method === 'GET' && url.pathname === '/') {
        const html = await fs.readFile(indexFile);
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
        return response.end(html);
      }
      if (request.method === 'GET' && url.pathname === '/api/health') {
        return json(response, 200, { status: 'ok', service: 'nexus-contact-api', timestamp: new Date().toISOString() });
      }
      if (request.method === 'GET' && url.pathname === '/api/contacts') {
        const query = (url.searchParams.get('q') || '').trim().toLowerCase();
        const contacts = await store.read();
        const filtered = query ? contacts.filter(contact => [contact.name, contact.email, contact.role].some(value => value.toLowerCase().includes(query))) : contacts;
        return json(response, 200, { contacts: filtered, total: filtered.length });
      }
      if (request.method === 'POST' && url.pathname === '/api/contacts') {
        const input = cleanContact(await readJson(request));
        const contacts = await store.read();
        if (contacts.some(contact => contact.email === input.email)) return json(response, 409, { error: 'A contact with this email already exists.' });
        const contact = { id: crypto.randomUUID(), ...input, createdAt: new Date().toISOString() };
        contacts.unshift(contact);
        await store.write(contacts);
        return json(response, 201, { contact });
      }

      const match = url.pathname.match(/^\/api\/contacts\/([0-9a-f-]+)$/i);
      if (match && request.method === 'PATCH') {
        const changes = cleanContact(await readJson(request), true);
        const contacts = await store.read();
        const index = contacts.findIndex(contact => contact.id === match[1]);
        if (index < 0) return json(response, 404, { error: 'Contact not found.' });
        if (changes.email && contacts.some((contact, position) => position !== index && contact.email === changes.email)) return json(response, 409, { error: 'A contact with this email already exists.' });
        contacts[index] = { ...contacts[index], ...changes, updatedAt: new Date().toISOString() };
        await store.write(contacts);
        return json(response, 200, { contact: contacts[index] });
      }
      if (match && request.method === 'DELETE') {
        const contacts = await store.read();
        const remaining = contacts.filter(contact => contact.id !== match[1]);
        if (remaining.length === contacts.length) return json(response, 404, { error: 'Contact not found.' });
        await store.write(remaining);
        return json(response, 200, { deleted: true });
      }

      return json(response, 404, { error: 'Route not found.' });
    } catch (error) {
      console.error(error);
      return json(response, error.status || 500, { error: error.status ? error.message : 'Internal server error.' });
    }
  });
}

async function start() {
  const store = new ContactStore(process.env.CONTACTS_FILE || DEFAULT_STORE);
  await store.initialize();
  const server = createServer({ store });
  server.listen(PORT, () => console.log(`Nexus is running at http://localhost:${PORT}`));
}

if (require.main === module) start().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

module.exports = { ContactStore, createServer, cleanContact };

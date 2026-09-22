'use strict';

const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs/promises');
const http = require('node:http');
const { createServer, ContactStore, cleanContact } = require('./server');

const TEST_DB = path.join(__dirname, 'data', 'test_contacts.json');

function request(server, path, options = {}) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.request({
      hostname: '127.0.0.1',
      port: address.port,
      path,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = JSON.parse(body);
        } catch {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body,
          json
        });
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('Starting Nexus REST API test suite...');
  // Clean up any test database
  try {
    await fs.unlink(TEST_DB);
  } catch {}

  const store = new ContactStore(TEST_DB);
  await store.initialize();
  const server = createServer({ store });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  console.log(`Test server running on port ${port}`);

  try {
    // 1. Health check
    console.log('1. Testing GET /api/health');
    const health = await request(server, '/api/health');
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.json.status, 'ok');
    assert.strictEqual(health.headers['access-control-allow-origin'], '*');

    // 2. CORS Preflight
    console.log('2. Testing OPTIONS /api/contacts');
    const options = await request(server, '/api/contacts', { method: 'OPTIONS' });
    assert.strictEqual(options.status, 204);
    assert.strictEqual(options.headers['access-control-allow-origin'], '*');

    // 3. List contacts & verify seed contacts
    console.log('3. Testing GET /api/contacts');
    const list = await request(server, '/api/contacts');
    assert.strictEqual(list.status, 200);
    assert.strictEqual(Array.isArray(list.json.contacts), true);
    assert.strictEqual(list.json.total >= 3, true);

    // 4. Create new contact
    console.log('4. Testing POST /api/contacts');
    const newContact = {
      name: 'Elena Rostova',
      email: 'elena@solstice.io',
      role: 'Lead Architect',
      phone: '+1 555 987 6543'
    };
    const created = await request(server, '/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: newContact
    });
    assert.strictEqual(created.status, 201);
    assert.strictEqual(created.json.contact.name, 'Elena Rostova');
    assert.strictEqual(created.json.contact.phone, '+1 555 987 6543');
    const createdId = created.json.contact.id;

    // 5. Retrieve single contact by ID
    console.log('5. Testing GET /api/contacts/:id');
    const fetched = await request(server, `/api/contacts/${createdId}`);
    assert.strictEqual(fetched.status, 200);
    assert.strictEqual(fetched.json.contact.id, createdId);
    assert.strictEqual(fetched.json.contact.email, 'elena@solstice.io');

    // 6. Test GET non-existent contact
    console.log('6. Testing GET /api/contacts/non-existent-id (404)');
    const notFound = await request(server, '/api/contacts/non-existent-id');
    assert.strictEqual(notFound.status, 404);

    // 7. Update contact via PATCH
    console.log('7. Testing PATCH /api/contacts/:id');
    const patched = await request(server, `/api/contacts/${createdId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: { role: 'Principal Architect', phone: '+1 555 000 1111' }
    });
    assert.strictEqual(patched.status, 200);
    assert.strictEqual(patched.json.contact.role, 'Principal Architect');
    assert.strictEqual(patched.json.contact.phone, '+1 555 000 1111');
    assert.strictEqual(patched.json.contact.name, 'Elena Rostova'); // unchanged

    // 8. Update contact via PUT
    console.log('8. Testing PUT /api/contacts/:id');
    const put = await request(server, `/api/contacts/${createdId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: { name: 'Elena R. Vance', email: 'elena@solstice.io', role: 'VP of Tech' }
    });
    assert.strictEqual(put.status, 200);
    assert.strictEqual(put.json.contact.name, 'Elena R. Vance');

    // 9. Search contacts
    console.log('9. Testing GET /api/contacts?q=');
    const searchRes = await request(server, '/api/contacts?q=solstice');
    assert.strictEqual(searchRes.status, 200);
    assert.strictEqual(searchRes.json.contacts.length, 1);
    assert.strictEqual(searchRes.json.contacts[0].id, createdId);

    // 10. Duplicate email rejection
    console.log('10. Testing duplicate email rejection (409)');
    const duplicate = await request(server, '/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { name: 'Duplicate Test', email: 'elena@solstice.io' }
    });
    assert.strictEqual(duplicate.status, 409);

    // 11. Malformed / Non-object JSON rejection
    console.log('11. Testing null or invalid body (400)');
    const nullBody = await request(server, '/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null'
    });
    assert.strictEqual(nullBody.status, 400);

    // 12. Delete contact
    console.log('12. Testing DELETE /api/contacts/:id');
    const deleted = await request(server, `/api/contacts/${createdId}`, {
      method: 'DELETE'
    });
    assert.strictEqual(deleted.status, 200);
    assert.strictEqual(deleted.json.deleted, true);

    // Verify deletion
    const verifyDeleted = await request(server, `/api/contacts/${createdId}`);
    assert.strictEqual(verifyDeleted.status, 404);

    // 13. Favicon check
    console.log('13. Testing GET /favicon.ico');
    const favicon = await request(server, '/favicon.ico');
    assert.strictEqual(favicon.status, 200);

    console.log('All 13 integration tests PASSED successfully!');
  } finally {
    server.close();
    try {
      await fs.unlink(TEST_DB);
      await fs.unlink(TEST_DB + '.tmp').catch(() => {});
    } catch {}
  }
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});

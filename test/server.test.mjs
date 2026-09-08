import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';
test('serves dashboard', async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /QUORUM/);
  await new Promise((r) => server.close(r));
});
test('lists courts and their agents', async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/config`);
  assert.equal(response.status, 200);
  const data = await response.json();
  const supremeCourt = data.councils.find((c) => c.id === 'supreme-court');
  assert.deepEqual(supremeCourt.agents.sort(), ['claude', 'codex']);
  const gallery = data.councils.find((c) => c.id === 'gallery');
  assert.deepEqual(gallery.agents, []);
  await new Promise((r) => server.close(r));
});
test('rejects unsupported methods', async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
    method: 'DELETE',
  });
  assert.equal(response.status, 405);
  await new Promise((r) => server.close(r));
});

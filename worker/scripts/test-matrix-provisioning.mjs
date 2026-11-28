// Run from worker/ with node scripts/test-matrix-provisioning.mjs.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, Response, convertV4MiniflareOptions } from 'miniflare';

const { outputFiles } = await build({
  stdin: {
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
    contents: `
      import { syncMatrix } from './src/auth/matrix';
      export default { async fetch(request, env) {
        const account = await env.DB.prepare('SELECT * FROM accounts WHERE id=1').first();
        await syncMatrix(env, account, 'fixture-password', 'fixture-hash');
        return Response.json(await env.DB.prepare('SELECT matrix_status, matrix_user_id FROM accounts').first());
      } };`,
  },
  bundle: true, write: false, format: 'esm',
});

let redirect = true;
const calls = [];
const base = 'https://matrix.example.test';
const endpoint = base + '/_synapse/admin/v1/register';
const userId = '@fixture:matrix.example.test';
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true, script: outputFiles[0].text, compatibilityDate: '2025-04-01',
  bindings: { ACCOUNT_MATRIX_HS: base, ACCOUNT_MATRIX_SECRET: 'fixture-secret' },
  d1Databases: ['DB'],
  outboundService: async (request) => {
    calls.push([request.method, request.url]);
    if (request.url !== endpoint) return new Response(null, { status: 404 });
    if (request.method === 'GET') return Response.json({ nonce: 'fixture-nonce' });
    if (redirect) return Response.redirect('https://elsewhere.example.test/register', 307);
    const data = await request.json();
    const mac = createHmac('sha1', 'fixture-secret')
      .update(['fixture-nonce', 'fixture', 'fixture-password', 'notadmin'].join('\0')).digest('hex');
    assert.equal(data.mac, mac);
    return Response.json({ user_id: userId });
  },
}));
try {
  const db = await mf.getD1Database('DB');
  await db.exec(`CREATE TABLE accounts (id INTEGER, username TEXT, role TEXT, display_name TEXT, pass_hash TEXT, matrix_status TEXT, matrix_user_id TEXT, matrix_hs TEXT, matrix_name_synced_at INTEGER, matrix_pw_synced_at INTEGER, matrix_created_at INTEGER);
INSERT INTO accounts(id,username,role,display_name,pass_hash,matrix_status) VALUES(1,'fixture','visitor','Fixture','fixture-hash','pending');`);
  async function attempt(expected) {
    calls.length = 0;
    const response = await mf.dispatchFetch('http://worker.test/');
    assert.deepEqual(await response.json(), expected);
    assert.deepEqual(calls, [['GET', endpoint], ['POST', endpoint]]);
  }
  await attempt({ matrix_status: 'pending', matrix_user_id: null });
  redirect = false;
  await attempt({ matrix_status: 'active', matrix_user_id: userId });
  console.log('Matrix provisioning and redirect handling passed in workerd.');
} finally {
  await mf.dispose();
}

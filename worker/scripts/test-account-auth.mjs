// Run with node scripts/test-account-auth.mjs from the Worker package.
// Uses a temporary local D1 database and synthetic email codes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdir, readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unstable_dev } from 'wrangler';

const workerRoot = fileURLToPath(new URL('../', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'qingwu-auth-test-'));
const config = join(dir, 'wrangler.json');
const persistTo = join(dir, 'state');
let worker;
try {
  await writeFile(
    config,
    JSON.stringify({
      name: 'auth-test',
      compatibility_date: '2025-04-01',
      vars: { ENVIRONMENT: 'dev', AUTH_DEV_CODE: '1' },
      d1_databases: [
        {
          binding: 'DB',
          database_name: 'auth-test',
          database_id: '00000000-0000-4000-8000-000000000001',
        },
      ],
    }),
  );
  const migrations = join(workerRoot, 'migrations');
  const schema = [];
  for (const file of (await readdir(migrations)).filter((f) => f.endsWith('.sql')).sort()) {
    if (file === '0043_accounts_v2.sql') {
      schema.push(
        "INSERT INTO accounts(id,email,email_hash,display_name,role,created_at) VALUES (1,'owner@example.test','owner','清吾','admin',100);",
        "INSERT INTO accounts(email,email_hash,display_name,created_at) VALUES ('legacy@example.test','hash','同名茶友',100);",
      );
    }
    schema.push(await readFile(join(migrations, file), 'utf8'));
  }
  const fixture = join(dir, 'schema.sql');
  await writeFile(fixture, schema.join('\n'));
  execFileSync(
    process.execPath,
    [
      join(workerRoot, 'node_modules/wrangler/bin/wrangler.js'),
      'd1',
      'execute',
      'auth-test',
      '--file',
      fixture,
      '--config',
      config,
      '--local',
      '--persist-to',
      persistTo,
    ],
    { cwd: dir, stdio: 'pipe' },
  );
  worker = await unstable_dev(join(workerRoot, 'src/index.ts'), {
    config,
    persistTo,
    local: true,
    ip: '127.0.0.1',
    port: 0,
    inspectorPort: 0,
    logLevel: 'error',
    experimental: { disableExperimentalWarning: true, disableDevRegistry: true },
  });

  async function call(path, body, cookie = '', status = 200) {
    const res = await worker.fetch('/auth/' + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    assert.equal(res.status, status, path + ' ' + (data.reason || ''));
    return { ...data, cookie: res.headers.get('set-cookie')?.split(';')[0] };
  }

  const username = 'visitor01',
    email = 'visitor@example.test',
    password = 'first-password';
  const start = await call('register/start', { username, email, nickname: '同名茶友' });
  const { ticket } = await call('register/verify', { email, code: start.devCode });
  const created = await call('register/complete', { ticket, password });
  assert.equal(created.account.matrix.status, 'pending');
  assert.equal((await call('me', null, created.cookie)).account.username, username);
  await call('register/complete', { ticket, password }, '', 400);

  const other = await call('login', { identifier: email, password });
  const newPassword = 'changed-password';
  await call('password', { old_password: password, new_password: newPassword }, created.cookie);
  assert.equal((await call('me', null, other.cookie)).account, null);
  await call('login', { identifier: username, password }, '', 401);
  const device = await call('login', { identifier: username, password: newPassword });
  const newEmail = 'changed@example.test';
  const change = await call('email/change/start', { new_email: newEmail }, created.cookie);
  await call('email/change/verify', { new_email: newEmail, code: change.devCode }, created.cookie);
  assert.equal((await call('me', null, device.cookie)).account, null);
  await call('login', { identifier: email, password: newPassword }, '', 401);
  const changed = await call('login', { identifier: newEmail, password: newPassword });
  await call('logout', { all: true }, created.cookie);
  assert.equal((await call('me', null, changed.cookie)).account, null);
  assert.equal((await call('me', null, created.cookie)).account, null);

  const legacyEmail = 'legacy@example.test';
  const legacyCode = await call('email/start', { email: legacyEmail });
  const legacy = await call('email/verify', { email: legacyEmail, code: legacyCode.devCode });
  assert.equal(legacy.account.name, created.account.name);
  assert(legacy.account.usernameProvisional && legacy.suggestSetPassword);
  const publicClaim = await call('register/start', { username: 'qingwu', email: 'new@example.test', nickname: '清吾' }, '', 409);
  assert.equal(publicClaim.reason, 'username_reserved');
  const visitorClaim = await call('username/confirm', { username: 'qingwu' }, legacy.cookie, 409);
  assert.equal(visitorClaim.reason, 'username_reserved');
  const ownerEmail = 'owner@example.test';
  const ownerCode = await call('email/start', { email: ownerEmail });
  const owner = await call('email/verify', { email: ownerEmail, code: ownerCode.devCode });
  assert.equal((await call('username/confirm', { username: 'root' }, owner.cookie, 409)).reason, 'username_reserved');
  const claim = await call('username/confirm', { username: 'qingwu' }, owner.cookie);
  assert.equal(claim.account.username, 'qingwu');
  assert.equal(claim.account.usernameProvisional, false);
  await call('username/confirm', { username: 'newname' }, owner.cookie, 409);
  await call('username/confirm', { username: 'oldfriend' }, legacy.cookie);
  await call('username/confirm', { username: 'secondname' }, legacy.cookie, 409);
  await call('password', { new_password: newPassword }, legacy.cookie);
  await call('login', { identifier: 'oldfriend', password: newPassword });
  console.log(
    'Passed registration, all login methods, password and email changes, session revocation and legacy migration.',
  );
} finally {
  try {
    await worker?.stop();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

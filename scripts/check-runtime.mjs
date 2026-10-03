import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '../desktop');
const appRequire = createRequire(resolve(app, 'package.json'));
const electron = appRequire('electron');
const electronVersion = appRequire('electron/package.json').version;
const check = `
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE runtime_check (value INTEGER); INSERT INTO runtime_check VALUES (42)');
  const value = db.prepare('SELECT value FROM runtime_check').get().value;
  db.close();
  process.stdout.write(JSON.stringify({ ...process.versions, originSqliteValue: value }));
`;
// ELECTRON_RUN_AS_NODE keeps this check in a console process without opening UI.
const result = spawnSync(electron, ['-e', check], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
  timeout: 30_000,
});
if (result.status !== 0) throw new Error(`Cannot verify Electron SQLite: ${result.stderr || result.error}`);
const versions = JSON.parse(result.stdout);
if (versions.electron !== electronVersion || versions.originSqliteValue !== 42) {
  throw new Error('Installed Electron does not match its package version or SQLite verification failed.');
}
console.log(`Electron ${electronVersion}: built-in SQLite read/write verified.`);

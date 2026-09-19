import test from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { loadTasks, saveTasks, CorruptStoreError } from '../lib/storage.js';

const BIN = new URL('../bin/taskliner.js', import.meta.url).pathname;

async function tmpFile(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'taskliner-test-'));
  const file = path.join(dir, 'store.json');
  t.after(() => fs.rm(dir, { recursive: true, force: true }).catch(() => {}));
  return file;
}

function run(args, file) {
  const full = ['--file', file, ...args];
  return spawnSync(process.execPath, [BIN, ...full], { encoding: 'utf8' });
}

test('add/list/--json roundtrip persists to disk', async (t) => {
  const file = await tmpFile(t);
  const add = run(['add', 'Buy oat milk', '--priority', 'high', '--tag', 'groceries', '--due', '2026-10-01'], file);
  assert.equal(add.status, 0, add.stderr);
  assert.match(add.stdout, /added t1: Buy oat milk/);

  const list = run(['list', '--json'], file);
  assert.equal(list.status, 0, list.stderr);
  const tasks = JSON.parse(list.stdout);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, 't1');
  assert.equal(tasks[0].title, 'Buy oat milk');
  assert.equal(tasks[0].priority, 'high');
  assert.deepEqual(tasks[0].tags, ['groceries']);
  assert.equal(tasks[0].due, '2026-10-01');
  assert.equal(tasks[0].done, false);

  const onDisk = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.deepEqual(onDisk, tasks);
});

test('second add continues the sequence after a remove', async (t) => {
  const file = await tmpFile(t);
  run(['add', 'first'], file);
  run(['add', 'second'], file);
  run(['rm', 't1'], file);
  const add = run(['add', 'third'], file);
  assert.equal(add.status, 0);
  const tasks = JSON.parse(run(['list', '--json'], file).stdout);
  assert.deepEqual(tasks.map((x) => x.id), ['t2', 't3']);
});

test('done then reopen transitions state', async (t) => {
  const file = await tmpFile(t);
  run(['add', 'ship it'], file);
  const done = run(['done', 't1'], file);
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /done t1: ship it/);
  assert.deepEqual(JSON.parse(run(['list', '--json', '--done'], file).stdout).map((x) => x.id), ['t1']);

  const reopen = run(['reopen', 't1'], file);
  assert.equal(reopen.status, 0, reopen.stderr);
  assert.deepEqual(JSON.parse(run(['list', '--json', '--open'], file).stdout).map((x) => x.id), ['t1']);
});

test('done ignores nonexistent id for that one, still processes others, exit non-zero', async (t) => {
  const file = await tmpFile(t);
  run(['add', 'real task'], file);
  const res = run(['done', 'zzz', 't1'], file);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /no task with id "zzz"/);
  assert.match(res.stdout, /done t1/);
  assert.deepEqual(JSON.parse(run(['list', '--json', '--done'], file).stdout).map((x) => x.id), ['t1']);
});

test('reopen missing id exits non-zero', async (t) => {
  const file = await tmpFile(t);
  run(['add', 'x'], file);
  const res = run(['reopen', 'nope'], file);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /no task with id "nope"/);
});

test('edit updates title, priority, due and notes', async (t) => {
  const file = await tmpFile(t);
  run(['add', 'old title', '--priority', 'low'], file);
  const res = run(['edit', 't1', '--title', 'shiny title', '--priority', 'medium', '--due', '2026-12-01', '--notes', 'hello'], file);
  assert.equal(res.status, 0, res.stderr);
  const [task] = JSON.parse(run(['list', '--json'], file).stdout);
  assert.equal(task.title, 'shiny title');
  assert.equal(task.priority, 'medium');
  assert.equal(task.due, '2026-12-01');
  assert.equal(task.notes, 'hello');
});

test('edit missing id exits non-zero', async (t) => {
  const file = await tmpFile(t);
  const res = run(['edit', 'nope', '--title', 'x'], file);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /no task with id "nope"/);
});

test('rm removes tasks and persists; missing id exits non-zero but removes the rest', async (t) => {
  const file = await tmpFile(t);
  run(['add', 'a'], file);
  run(['add', 'b'], file);
  const res = run(['rm', 't1', 'ghost', 't2'], file);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /no task with id "ghost"/);
  assert.equal(JSON.parse(run(['list', '--json'], file).stdout).length, 0);
});

test('filters: tag, priority, open, done', async (t) => {
  const file = await tmpFile(t);
  run(['add', 'milk', '--tag', 'groceries', '--priority', 'high'], file);
  run(['add', 'bread', '--tag', 'groceries', '--priority', 'low'], file);
  run(['add', 'report', '--tag', 'work', '--priority', 'medium'], file);
  run(['done', 't2'], file);

  assert.deepEqual(JSON.parse(run(['list', '--json', '--tag', 'groceries'], file).stdout).map((x) => x.id), ['t1', 't2']);
  assert.deepEqual(JSON.parse(run(['list', '--json', '--priority', 'high'], file).stdout).map((x) => x.id), ['t1']);
  assert.deepEqual(JSON.parse(run(['list', '--json', '--done'], file).stdout).map((x) => x.id), ['t2']);
  assert.deepEqual(JSON.parse(run(['list', '--json', '--open'], file).stdout).map((x) => x.id), ['t1', 't3']);
  assert.deepEqual(JSON.parse(run(['list', '--json', '--tag', 'groceries', '--open'], file).stdout).map((x) => x.id), ['t1']);
});

test('sort orders: due, priority, created, default id', async (t) => {
  const file = await tmpFile(t);
  run(['add', 'write report', '--due', '2026-11-01', '--priority', 'medium'], file);
  run(['add', 'walk dog', '--due', '2026-10-01', '--priority', 'low'], file);
  run(['add', 'climb everest', '--priority', 'high'], file);

  const ids = (flags) => JSON.parse(run(['list', '--json', ...flags], file).stdout).map((x) => x.id);
  assert.deepEqual(ids([]), ['t1', 't2', 't3']);
  assert.deepEqual(ids(['--sort', 'due']), ['t2', 't1', 't3']);
  assert.deepEqual(ids(['--sort', 'priority']), ['t3', 't1', 't2']);
  assert.deepEqual(ids(['--sort', 'created']), ['t1', 't2', 't3']);
});

test('stats numbers', async (t) => {
  const file = await tmpFile(t);
  assert.match(run(['stats'], file).stdout, /total:\s+0/);
  run(['add', 'one', '--priority', 'high'], file);
  run(['add', 'two', '--priority', 'medium'], file);
  run(['add', 'three', '--priority', 'low'], file);
  run(['done', 't1'], file);
  const out = run(['stats'], file).stdout;
  assert.match(out, /total:\s+3/);
  assert.match(out, /open:\s+2/);
  assert.match(out, /done:\s+1/);
  assert.match(out, /completion:\s+33\.3%/);
  assert.match(out, /high:\s+1/);
  assert.match(out, /medium:\s+1/);
  assert.match(out, /low:\s+1/);
  assert.match(out, /none:\s+0/);
});

test('tag command tallies tags', async (t) => {
  const file = await tmpFile(t);
  assert.match(run(['tag'], file).stdout, /no tags/);
  run(['add', 'milk', '--tag', 'groceries'], file);
  run(['add', 'clean', '--tag', 'home', '--tag', 'chore'], file);
  run(['add', 'sweep', '--tag', 'home'], file);
  const out = run(['tag'], file).stdout;
  assert.match(out, /home\s+2/);
  assert.match(out, /chore\s+1/);
  assert.match(out, /groceries\s+1/);
});

test('--json shape', async (t) => {
  const file = await tmpFile(t);
  run(['add', 'one', '--tag', 'a'], file);
  run(['add', 'two'], file);
  run(['done', 't2'], file);
  const tasks = JSON.parse(run(['list', '--json'], file).stdout);
  assert.equal(Array.isArray(tasks), true);
  for (const key of ['id', 'title', 'done', 'priority', 'tags', 'due', 'notes', 'createdAt']) {
    assert.ok(key in tasks[0], `missing key ${key}`);
  }
  assert.equal(tasks[1].done, true);
});

test('default list shows human table with [x] markers', async (t) => {
  const file = await tmpFile(t);
  run(['add', 'buy milk'], file);
  run(['done', 't1'], file);
  run(['add', 'open one'], file);
  const out = run(['list'], file).stdout;
  assert.match(out, /t1\s+\[x\]/);
  assert.match(out, /t2\s+\[ \]/);
  assert.match(out, /buy milk/);
});

test('unknown command prints usage to stderr and exits non-zero', async (t) => {
  const file = await tmpFile(t);
  const res = run(['frobnicate'], file);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /unknown command "frobnicate"/);
  assert.match(res.stderr, /Usage:/);
});

test('--version and --help', async (t) => {
  const file = await tmpFile(t);
  const v = run(['--version'], file);
  assert.equal(v.status, 0);
  assert.match(v.stdout, /^\d+\.\d+\.\d+/);
  const h = run(['--help'], file);
  assert.equal(h.status, 0);
  assert.match(h.stdout, /taskliner — a plain-text task/);
});

test('corrupt store yields clear error and exit 1', async (t) => {
  const file = await tmpFile(t);
  await fs.writeFile(file, '{ not json !!!', 'utf8');
  const res = run(['list'], file);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /could not be read/);
  assert.match(res.stderr, /invalid JSON/);
});

test('store file with wrong shape is treated as corrupt', async (t) => {
  const file = await tmpFile(t);
  await fs.writeFile(file, JSON.stringify({ not: 'an array' }), 'utf8');
  const res = run(['list'], file);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /expected an array/);
});

test('missing file auto-creates on first add', async (t) => {
  const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'taskliner-tmp-')), 'sub', 'nested', 'store.json');
  t.after(() => fs.rm(path.dirname(path.dirname(path.dirname(file))), { recursive: true, force: true }).catch(() => {}));
  const missing = run(['list', '--json'], file);
  assert.equal(missing.status, 0, missing.stderr);
  assert.equal(missing.stdout.trim(), '[]');
  const add = run(['add', 'first'], file);
  assert.equal(add.status, 0, add.stderr);
  const stats = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(stats.length, 1);
  assert.equal(stats[0].title, 'first');
});

test('TASKLINE_FILE env var redirects the store', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'taskliner-env-'));
  const file = path.join(dir, 'store.json');
  t.after(() => fs.rm(dir, { recursive: true, force: true }).catch(() => {}));
  const add = spawnSync(process.execPath, [BIN, 'add', 'env task'], {
    encoding: 'utf8',
    env: { ...process.env, TASKLINE_FILE: file },
  });
  assert.equal(add.status, 0, add.stderr);
  const list = spawnSync(process.execPath, [BIN, 'list', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, TASKLINE_FILE: file },
  });
  const tasks = JSON.parse(list.stdout);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, 'env task');
});

test('storage: empty file loads as no tasks', async (t) => {
  const file = await tmpFile(t);
  await fs.writeFile(file, '\n   \n', 'utf8');
  assert.deepEqual(await loadTasks(file), []);
});

test('storage: save is atomic-ish and load returns clean tasks', async (t) => {
  const file = await tmpFile(t);
  const tasks = [
    { id: 't1', title: 'one', done: false, priority: 'high', tags: ['a'], due: '2026-01-01', notes: '', createdAt: '2026-01-01T00:00:00.000Z' },
  ];
  await saveTasks(file, tasks);
  assert.equal((await fs.readdir(path.dirname(file))).filter((f) => f.includes('.tmp-')).length, 0);
  const loaded = await loadTasks(file);
  assert.equal(loaded[0].id, 't1');
  assert.equal(loaded[0].priority, 'high');
  assert.deepEqual(loaded, tasks);
});

test('loadTasks rejects a corrupt file with CorruptStoreError', async (t) => {
  const file = await tmpFile(t);
  await fs.writeFile(file, 'garbage', 'utf8');
  await assert.rejects(loadTasks(file), CorruptStoreError);
});
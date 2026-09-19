import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addTask,
  listTasks,
  completeTask,
  reopenTask,
  editTask,
  removeTask,
  tagFilter,
  byPriority,
  stats,
  tagTallies,
  sortTasks,
} from '../lib/taskliner.js';

function fresh() {
  const tasks = [];
  addTask(tasks, { title: 'Buy oat milk', priority: 'high', tags: ['groceries'], due: '2026-10-01' });
  addTask(tasks, { title: 'Walk the dog', priority: 'low', due: '2026-09-20' });
  addTask(tasks, { title: 'Write report', tags: ['work', 'urgent'], priority: 'medium' });
  return tasks;
}

test('addTask assigns stable sequential ids and normalizes fields', () => {
  const tasks = [];
  const a = addTask(tasks, { title: '  Brew coffee  ', priority: 'HIGH', tags: ['#home', '#home'] });
  assert.equal(a.id, 't1');
  assert.equal(a.title, 'Brew coffee');
  assert.equal(a.priority, 'high');
  assert.deepEqual(a.tags, ['home']);
  assert.equal(a.done, false);
  assert.equal(a.due, null);
  assert.match(a.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  const b = addTask(tasks, { title: 'Second' });
  assert.equal(b.id, 't2');
  assert.equal(tasks.length, 2);
});

test('addTask rejects empty titles', () => {
  assert.throws(() => addTask([], { title: '   ' }), /non-empty title/);
});

test('addTask rejects unknown priority', () => {
  assert.throws(() => addTask([], { title: 'x', priority: 'urgent' }), /unknown priority/);
});

test('listTasks returns a copy and never mutates the model', () => {
  const tasks = fresh();
  const out = listTasks(tasks);
  out.pop();
  assert.equal(tasks.length, 3);
});

test('done/reopen state transitions', () => {
  const tasks = fresh();
  assert.equal(completeTask(tasks, 't1').done, true);
  assert.equal(listTasks(tasks, { done: true }).map((t) => t.id).join(), 't1');
  assert.equal(reopenTask(tasks, 't1').done, false);
  assert.equal(listTasks(tasks, { done: false }).length, 3);
});

test('done/reopen/remove return null for a missing id', () => {
  const tasks = fresh();
  assert.equal(completeTask(tasks, 'nope'), null);
  assert.equal(reopenTask(tasks, 'nope'), null);
  assert.equal(editTask(tasks, 'nope', {}), null);
  assert.equal(removeTask(tasks, 'nope'), null);
  assert.equal(tasks.length, 3);
});

test('editTask updates fields and validates title', () => {
  const tasks = fresh();
  const t = editTask(tasks, 't1', { title: 'Buy cashew milk', priority: 'medium', due: '2026-11-01', tags: ['vegan'] });
  assert.equal(t.title, 'Buy cashew milk');
  assert.equal(t.priority, 'medium');
  assert.equal(t.due, '2026-11-01');
  assert.deepEqual(t.tags, ['vegan']);
  assert.throws(() => editTask(tasks, 't1', { title: ' ' }), /cannot be empty/);
});

test('removeTask splices the task out', () => {
  const tasks = fresh();
  const removed = removeTask(tasks, 't2');
  assert.equal(removed.title, 'Walk the dog');
  assert.deepEqual(tasks.map((t) => t.id), ['t1', 't3']);
});

test('tagFilter matches case-insensitively', () => {
  const tasks = fresh();
  assert.deepEqual(tagFilter(tasks, 'GROCERIES').map((t) => t.id), ['t1']);
  assert.deepEqual(tagFilter(tasks, 'work').map((t) => t.id), ['t3']);
});

test('byPriority filters and list --priority works', () => {
  const tasks = fresh();
  assert.deepEqual(byPriority(tasks, 'high').map((t) => t.id), ['t1']);
  assert.deepEqual(listTasks(tasks, { priority: 'medium' }).map((t) => t.id), ['t3']);
});

test('filters: open/done/tag/priority combine', () => {
  const tasks = fresh();
  completeTask(tasks, 't1');
  assert.deepEqual(listTasks(tasks, { done: false, tag: 'work' }).map((t) => t.id), ['t3']);
  assert.deepEqual(listTasks(tasks, { done: true }).map((t) => t.id), ['t1']);
  assert.deepEqual(listTasks(tasks, { tag: 'nope' }), []);
});

test('sort by id (default), due, priority, created', () => {
  const tasks = fresh();
  assert.deepEqual(sortTasks(tasks, 'id').map((t) => t.id), ['t1', 't2', 't3']);
  assert.deepEqual(sortTasks(tasks, 'due').map((t) => t.id), ['t2', 't1', 't3']);
  const pinnacle = sortTasks(tasks, 'priority').map((t) => t.id);
  assert.equal(pinnacle[0], 't1');
  addTask(tasks, { title: 'No due date', priority: 'high' });
  const sorted = sortTasks(tasks, 'due').map((t) => t.id);
  assert.equal(sorted[sorted.length - 1], 't4');
  assert.deepEqual(sortTasks(tasks, 'created').map((t) => t.id), ['t1', 't2', 't3', 't4']);
});

test('listTasks applies sort option too', () => {
  const tasks = fresh();
  assert.deepEqual(listTasks(tasks, { sort: 'due' }).map((t) => t.id), ['t2', 't1', 't3']);
});

test('stats counts states and completion', () => {
  const tasks = fresh();
  const empty = stats([]);
  assert.equal(empty.total, 0);
  assert.equal(empty.completion, 0);
  assert.equal(empty.topTodo, null);
  completeTask(tasks, 't1');
  const s = stats(tasks);
  assert.equal(s.total, 3);
  assert.equal(s.done, 1);
  assert.equal(s.open, 2);
  assert.equal(s.completion, 33.3);
  assert.deepEqual(s.byPriority, { high: 1, medium: 1, low: 1, none: 0 });
  assert.equal(s.topTodo.id, 't3');
});

test('completion rounds to a single decimal', () => {
  const tasks = [];
  for (let i = 0; i < 3; i++) addTask(tasks, { title: `t${i}` });
  completeTask(tasks, 't1');
  const s = stats(tasks);
  assert.equal(s.completion, 33.3);
  assert.equal(s.completion, Math.round((1 / 3) * 1000) / 10);
});

test('tagTallies counts unique tags per task', () => {
  const tasks = fresh();
  addTask(tasks, { title: 'Repeat', tags: ['work', 'WORK'] });
  const tallies = tagTallies(tasks);
  assert.deepEqual(tallies, [{ tag: 'work', count: 2 }, { tag: 'groceries', count: 1 }, { tag: 'urgent', count: 1 }]);
});
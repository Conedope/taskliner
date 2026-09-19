#!/usr/bin/env node
import * as os from 'node:os';
import * as path from 'node:path';
import {
  addTask,
  listTasks,
  completeTask,
  reopenTask,
  editTask,
  removeTask,
  stats,
  tagTallies,
} from '../lib/taskliner.js';
import { loadTasks, saveTasks, CorruptStoreError } from '../lib/storage.js';

const VERSION = '1.0.0';

const HELP = `taskliner — a plain-text task/checklist tracker stored in JSON

Usage:
  taskliner add "Buy oat milk" [--priority high|medium|low] [--tag groceries] [--due 2026-10-01] [--notes "..."]
  taskliner list                list open tasks (default)
  taskliner list --done         list completed tasks
  taskliner list --open         list open tasks
  taskliner list --tag groceries     filter by tag
  taskliner list --priority high     filter by priority
  taskliner list --sort due|priority|created
  taskliner list --json         raw JSON output (great for CI)
  taskliner done ID [...]       mark tasks done
  taskliner reopen ID           mark a task open again
  taskliner edit ID [--title "..."] [--priority high] [--due ...] [--tag a,b] [--notes "..."]
  taskliner rm ID [...]         delete tasks
  taskliner stats               counts by state and completion %
  taskliner tag                 tag tallies
  taskliner --file path.json    use a specific store file
  taskliner --version           print version
  taskliner --help              show this help

Store:
  Tasks live in ~/.taskliner.json by default. To use another file (or a
  second list) pass --file path.json, or set the TASKLINE_FILE env var.
  The file is created on first use; writes go through a temp file and rename.
`;

const DEFAULT_FILE = () => path.join(os.homedir(), '.taskliner.json');

function fail(message) {
  process.stderr.write(`taskliner: ${message}\n`);
  process.exit(1);
}

function taskFile() {
  if (process.env.TASKLINE_FILE && process.env.TASKLINE_FILE !== '') {
    return path.resolve(process.env.TASKLINE_FILE);
  }
  return path.resolve(os.homedir(), '.taskliner.json');
}

function parseListFlags(args) {
  const opts = {};
  if (args.includes('--done')) opts.done = true;
  if (args.includes('--open')) opts.done = false;
  const tagI = args.indexOf('--tag');
  if (tagI !== -1 && args[tagI + 1]) opts.tag = args[tagI + 1];
  const prioI = args.indexOf('--priority');
  if (prioI !== -1 && args[prioI + 1]) opts.priority = args[prioI + 1];
  const sortI = args.indexOf('--sort');
  if (sortI !== -1 && args[sortI + 1]) opts.sort = args[sortI + 1];
  if (args.includes('--json')) opts.json = true;
  return opts;
}

function parseEditArgs(args) {
  const changes = {};
  const read = (a, flag) => {
    const i = a.indexOf(flag);
    return i === -1 ? null : a[i + 1] ?? null;
  };
  const title = read(args, '--title');
  if (title !== null) changes.title = title;
  const priority = read(args, '--priority');
  if (priority !== null) changes.priority = priority;
  const due = read(args, '--due');
  if (due !== null) changes.due = due;
  const tags = read(args, '--tag');
  if (tags !== null) changes.tags = tags.split(',').map((x) => x.trim()).filter(Boolean);
  const notes = read(args, '--notes');
  if (notes !== null) changes.notes = notes;
  return changes;
}

function renderTable(tasks, json) {
  if (json) return `${JSON.stringify(tasks, null, 2)}\n`;
  if (tasks.length === 0) return 'no tasks\n';
  const done = (t) => (t.done ? '[x]' : '[ ]');
  const prio = (t) => (t.priority === 'none' ? '-' : t.priority);
  const due = (t) => t.due ?? '-';
  const cols = { id: 0, mark: 0, prio: 0, title: 0, tags: 0, due: 0 };
  for (const t of tasks) {
    cols.id = Math.max(cols.id, t.id.length);
    cols.mark = Math.max(cols.mark, done(t).length);
    cols.prio = Math.max(cols.prio, prio(t).length);
    cols.title = Math.max(cols.title, t.title.length);
    cols.tags = Math.max(cols.tags, (t.tags.join(',') || '-').length);
    cols.due = Math.max(cols.due, due(t).length);
  }
  const pad = (s, w) => String(s).padEnd(w);
  const header = `${pad('ID', cols.id)}  ${pad('', cols.mark)}  ${pad('PRIO', cols.prio)}  ${pad('TITLE', cols.title)}  ${pad('TAGS', cols.tags)}  ${pad('DUE', cols.due)}`;
  const bar = '-'.repeat(header.length);
  const lines = [header, bar];
  for (const t of tasks) {
    lines.push(
      `${pad(t.id, cols.id)}  ${pad(done(t), cols.mark)}  ${pad(prio(t), cols.prio)}  ${pad(t.title, cols.title)}  ${pad(t.tags.join(',') || '-', cols.tags)}  ${due(t)}`
    );
  }
  return `${lines.join('\n')}\n`;
}

export async function main(argv) {
  if (argv.length === 0) argv = ['list'];

  let storePath;
  const fileFlag = argv.indexOf('--file');
  if (fileFlag !== -1) {
    if (!argv[fileFlag + 1]) fail('--file requires a path');
    storePath = path.resolve(argv[fileFlag + 1]);
    argv.splice(fileFlag, 2);
  }

  if (argv.includes('--help') || argv[0] === 'help') return HELP;
  if (argv.includes('--version') || argv[0] === 'version') return `${VERSION}\n`;

  const command = argv[0];
  if (!storePath) storePath = taskFile();

  let tasks;
  try {
    tasks = await loadTasks(storePath);
  } catch (err) {
    if (err instanceof CorruptStoreError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  const rest = argv.slice(1);
  let out = '';
  let dirty = false;

  switch (command) {
    case 'add': {
      const title = rest[0] && !rest[0].startsWith('--') ? rest[0] : undefined;
      if (!title) fail('add needs a title, e.g. taskliner add "Buy oat milk"');
      const prio = flagValue(rest, '--priority');
      const tags = [];
      for (let i = 0; i < rest.length - 1; i++) {
        if (rest[i] === '--tag') {
          for (const tag of rest[i + 1].split(',')) {
            const clean = tag.trim().replace(/^#/, '');
            if (clean && !tags.includes(clean)) tags.push(clean);
          }
        }
      }
      const due = flagValue(rest, '--due');
      const notes = flagValue(rest, '--notes') ?? '';
      const task = addTask(tasks, { title, priority: prio, tags, due, notes });
      dirty = true;
      out = `added ${task.id}: ${task.title}\n`;
      break;
    }
    case 'list': {
      const flags = parseListFlags(rest);
      out = renderTable(listTasks(tasks, flags), flags.json);
      break;
    }
    case 'done': {
      if (rest.length === 0) fail('done needs at least one task id');
      for (const id of rest) {
        const task = completeTask(tasks, id);
        if (!task) {
          process.stderr.write(`taskliner: no task with id "${id}"\n`);
          process.exitCode = 1;
          continue;
        }
        out += `done ${task.id}: ${task.title}\n`;
        dirty = true;
      }
      break;
    }
    case 'reopen': {
      if (rest.length === 0) fail('reopen needs a task id');
      for (const id of rest) {
        const task = reopenTask(tasks, id);
        if (!task) {
          process.stderr.write(`taskliner: no task with id "${id}"\n`);
          process.exitCode = 1;
          continue;
        }
        out += `reopened ${task.id}: ${task.title}\n`;
        dirty = true;
      }
      break;
    }
    case 'edit': {
      const id = rest[0];
      if (!id) fail('edit needs a task id');
      const changes = parseEditArgs(rest.slice(1));
      if (Object.keys(changes).length === 0) fail('edit needs at least one change, e.g. --title "Better title"');
      try {
        const task = editTask(tasks, id, changes);
        if (!task) {
          process.stderr.write(`taskliner: no task with id "${id}"\n`);
          process.exit(1);
        }
        out = `edited ${task.id}: ${task.title}\n`;
        dirty = true;
      } catch (err) {
        fail(err.message);
      }
      break;
    }
    case 'rm': {
      if (rest.length === 0) fail('rm needs at least one task id');
      for (const id of rest) {
        const task = removeTask(tasks, id);
        if (!task) {
          process.stderr.write(`taskliner: no task with id "${id}"\n`);
          process.exitCode = 1;
          continue;
        }
        out += `removed ${task.id}: ${task.title}\n`;
        dirty = true;
      }
      break;
    }
    case 'stats': {
      const s = stats(tasks);
      out = [
        `total:       ${s.total}`,
        `open:        ${s.open}`,
        `done:        ${s.done}`,
        `completion:  ${s.completion}%`,
        `high:        ${s.byPriority.high}`,
        `medium:      ${s.byPriority.medium}`,
        `low:         ${s.byPriority.low}`,
        `none:        ${s.byPriority.none}`,
      ].join('\n') + '\n';
      break;
    }
    case 'tag': {
      const tallies = tagTallies(tasks);
      if (tallies.length === 0) {
        out = 'no tags\n';
      } else {
        const w = Math.max(...tallies.map((t) => t.tag.length), 4);
        out = tallies.map((t) => `${t.tag.padEnd(w)}  ${t.count}`).join('\n') + '\n';
      }
      break;
    }
    default:
      process.stderr.write(`taskliner: unknown command "${command}"\n\n${HELP}`);
      process.exit(1);
  }

  if (dirty) await saveTasks(storePath, tasks);
  return out;
}

function flagValue(args, flag) {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  return args[i + 1];
}

const isMain = process.argv[1] && (process.argv[1].endsWith('taskliner.js') || process.argv[1].endsWith('taskliner'));
if (isMain) {
  main(process.argv.slice(2))
    .then((out) => {
      if (out) process.stdout.write(out);
    })
    .catch((err) => {
      process.stderr.write(`taskliner: ${err.message}\n`);
      process.exit(1);
    });
}

export { DEFAULT_FILE };
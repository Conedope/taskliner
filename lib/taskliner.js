export function addTask(tasks, input) {
  if (!input || typeof input.title !== 'string' || input.title.trim() === '') {
    throw new Error('a task needs a non-empty title');
  }
  const priority = normalizePriority(input.priority);
  const tags = normalizeTags(input.tags);
  const task = {
    id: input.id ?? nextId(tasks),
    title: input.title.trim(),
    done: input.done === true,
    priority,
    tags,
    due: input.due != null ? String(input.due) : null,
    notes: input.notes != null ? String(input.notes) : '',
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  tasks.push(task);
  return task;
}

export function listTasks(tasks, opts = {}) {
  let result = tasks.slice();
  if (opts.done === true) result = result.filter((t) => t.done);
  if (opts.done === false) result = result.filter((t) => !t.done);
  if (opts.tag) {
    const tag = opts.tag.toLowerCase();
    result = result.filter((t) => t.tags.some((x) => x.toLowerCase() === tag));
  }
  if (opts.priority) {
    const p = normalizePriority(opts.priority);
    result = result.filter((t) => t.priority === p);
  }
  if (opts.sort && opts.sort !== 'id') {
    result = sortTasks(result, opts.sort);
  }
  return result;
}

export function sortTasks(tasks, key) {
  const order = { low: 0, medium: 1, high: 2 };
  const copy = tasks.slice();
  switch (key) {
    case 'priority':
      return copy.sort((a, b) => order[b.priority] - order[a.priority] || a.id.localeCompare(b.id));
    case 'due':
      return copy.sort((a, b) => dueKey(a).localeCompare(dueKey(b)));
    case 'created':
      return copy.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    default:
      return copy.sort((a, b) => a.id.localeCompare(b.id));
  }
}

export function getTask(tasks, id) {
  return tasks.find((t) => t.id === id) ?? null;
}

export function completeTask(tasks, id) {
  const task = getTask(tasks, id);
  if (!task) return null;
  task.done = true;
  return task;
}

export function reopenTask(tasks, id) {
  const task = getTask(tasks, id);
  if (!task) return null;
  task.done = false;
  return task;
}

export function removeTask(tasks, id) {
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return null;
  return tasks.splice(index, 1)[0];
}

export function editTask(tasks, id, changes = {}) {
  const task = getTask(tasks, id);
  if (!task) return null;
  if (changes.title !== undefined) {
    if (typeof changes.title !== 'string' || changes.title.trim() === '') {
      throw new Error('title cannot be empty');
    }
    task.title = changes.title.trim();
  }
  if (changes.priority !== undefined) task.priority = normalizePriority(changes.priority);
  if (changes.tags !== undefined) task.tags = normalizeTags(changes.tags);
  if (changes.due !== undefined) task.due = changes.due != null ? String(changes.due) : null;
  if (changes.notes !== undefined) task.notes = String(changes.notes);
  return task;
}

export function tagFilter(tasks, tag) {
  return listTasks(tasks, { tag });
}

export function byPriority(tasks, priority) {
  return listTasks(tasks, { priority });
}

export function stats(tasks) {
  const total = tasks.length;
  const done = tasks.filter((t) => t.done).length;
  const open = total - done;
  const workMap = { high: 0, medium: 1, low: 2 };
  const openNotSorted = tasks.filter((t) => !t.done);
  return {
    total,
    done,
    open,
    completion: total === 0 ? 0 : Math.round((done / total) * 1000) / 10,
    byPriority: {
      high: tasks.filter((t) => t.priority === 'high').length,
      medium: tasks.filter((t) => t.priority === 'medium').length,
      low: tasks.filter((t) => t.priority === 'low').length,
      none: tasks.filter((t) => t.priority === 'none').length,
    },
    topTodo: openNotSorted
      .slice()
      .sort((a, b) => workMap[a.priority] - workMap[b.priority] || dueKey(a).localeCompare(dueKey(b)))[0] ?? null,
  };
}

export function tagTallies(tasks) {
  const counts = new Map();
  for (const task of tasks) {
    const seen = new Set();
    for (const tag of task.tags) {
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function isValidTaskFile(data) {
  return Array.isArray(data) && data.every(
    (t) => t && typeof t.id === 'string' && typeof t.title === 'string'
  );
}

export function transferTask(existing, input) {
  return {
    id: String(existing.id),
    title: String(existing.title),
    done: existing.done === true,
    priority: normalizePriority(existing.priority),
    tags: normalizeTags(existing.tags),
    due: existing.due != null ? String(existing.due) : null,
    notes: existing.notes != null ? String(existing.notes) : '',
    createdAt: existing.createdAt ?? input.createdAt ?? new Date().toISOString(),
  };
}

function normalizePriority(p) {
  if (p == null || p === '' || p === 'none') return 'none';
  const key = String(p).toLowerCase();
  if (['high', 'medium', 'low'].includes(key)) return key;
  throw new Error(`unknown priority "${p}" (expected high, medium, low, or none)`);
}

function normalizeTags(tags) {
  if (tags == null) return [];
  const list = Array.isArray(tags) ? tags : String(tags).split(/[\s,]+/);
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const clean = String(raw).trim().replace(/^#/, '').trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

function dueKey(t) {
  if (!t.due) return '\uffff';
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(t.due));
  return m ? m[1] : String(t.due);
}

function nextId(tasks) {
  let max = 0;
  const re = /^t(\d+)$/;
  for (const task of tasks) {
    const m = re.exec(task.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `t${max + 1}`;
}
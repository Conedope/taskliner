import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { isValidTaskFile, transferTask } from './taskliner.js';

export class CorruptStoreError extends Error {
  constructor(filePath, reason) {
    super(
      `task store "${filePath}" could not be read: ${reason}. ` +
        'It is not a valid taskliner file. Move it aside or create a new one.'
    );
    this.name = 'CorruptStoreError';
    this.filePath = filePath;
    this.code = 'ETASKFILE';
  }
}

export async function loadTasks(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  if (raw.trim() === '') return [];
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new CorruptStoreError(filePath, `invalid JSON (${err.message})`);
  }
  if (!isValidTaskFile(data)) {
    throw new CorruptStoreError(filePath, 'expected an array of {id, title, ...} task objects');
  }
  return data.map((t) => transferTask(t, {}));
}

export async function saveTasks(filePath, tasks) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(tasks, null, 2) + '\n', 'utf8');
  try {
    await fs.rename(tmp, filePath);
  } catch (err) {
    try {
      await fs.unlink(tmp);
    } catch {
      /* ignore cleanup failure */
    }
    throw err;
  }
}
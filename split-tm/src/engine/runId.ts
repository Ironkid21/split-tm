import { existsSync } from 'node:fs';
import { join } from 'node:path';

const p2 = (n: number) => String(n).padStart(2, '0');

export function dateFolder(d: Date) { return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; }

export function newRunId(now: Date, outputRoot: string): string {
  const base = `RUN_${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}_${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`;
  const dir = join(outputRoot, dateFolder(now));
  let id = base, n = 1;
  while (existsSync(join(dir, id))) id = `${base}_${++n}`;
  return id;
}

// Three tiny helpers over D1. Every query in the codebase goes through these so
// undefined values become NULL and the call sites stay one line.

type Param = string | number | null | boolean | ArrayBuffer | Uint8Array | undefined;

function bindable(params: Param[]) {
  return params.map((value) => (value === undefined ? null : typeof value === "boolean" ? (value ? 1 : 0) : value));
}

export async function one<T>(db: D1Database, sql: string, ...params: Param[]): Promise<T | null> {
  const row = await db.prepare(sql).bind(...bindable(params)).first<T>();
  return row ?? null;
}

export async function all<T>(db: D1Database, sql: string, ...params: Param[]): Promise<T[]> {
  const result = await db.prepare(sql).bind(...bindable(params)).all<T>();
  return result.results;
}

export async function run(db: D1Database, sql: string, ...params: Param[]): Promise<D1Result> {
  return db.prepare(sql).bind(...bindable(params)).run();
}

/** Run many statements in one round trip. D1 executes a batch atomically. */
export async function batch(db: D1Database, statements: Array<{ sql: string; params?: Param[] }>) {
  if (!statements.length) return [];
  return db.batch(statements.map((s) => db.prepare(s.sql).bind(...bindable(s.params ?? []))));
}

export function nowIso() {
  return new Date().toISOString();
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

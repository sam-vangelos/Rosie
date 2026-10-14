import { Pool, QueryResult, QueryResultRow } from 'pg';

declare global {
  var __rosieDbPool: Pool | undefined;
}

let localPool: Pool | undefined;

// The pool is created on first use, not at import: Next's build-time page-data
// collection imports every route module, and a fresh clone must build with no
// database configured. A missing DATABASE_URL still fails loudly — on the
// first query instead of the import.
function getPool(): Pool {
  if (localPool) return localPool;
  if (globalThis.__rosieDbPool) {
    localPool = globalThis.__rosieDbPool;
    return localPool;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  localPool = new Pool({ connectionString, max: 3 });
  if (process.env.NODE_ENV !== 'production') {
    globalThis.__rosieDbPool = localPool;
  }
  return localPool;
}

export const pool: Pool = new Proxy({} as Pool, {
  get(_target, property) {
    const target = getPool();
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

export function query<T extends QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params);
}

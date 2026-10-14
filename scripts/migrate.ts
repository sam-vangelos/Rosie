import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    loadEnvFile('.env.local');
  }

  const { pool } = await import('../src/lib/db');
  const migrationsDir = path.join(process.cwd(), 'db', 'migrations');
  const migrations = (await fs.readdir(migrationsDir))
    .filter((name) => name.endsWith('.sql'))
    .sort();

  await pool.query(`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  let applied = 0;
  let skipped = 0;

  try {
    for (const name of migrations) {
      const existing = await pool.query<{ name: string }>(
        'select name from schema_migrations where name = $1',
        [name]
      );
      if (existing.rowCount) {
        skipped += 1;
        console.log(`Skipped ${name} (already applied)`);
        continue;
      }

      const sql = await fs.readFile(path.join(migrationsDir, name), 'utf8');
      const body = sql
        .replace(/^\s*begin;\s*/i, '')
        .replace(/\s*commit;\s*$/i, '');
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query(body);
        await client.query('insert into schema_migrations (name) values ($1)', [name]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }

      applied += 1;
      console.log(`Applied ${name}`);
    }

    console.log(`Migrations complete: ${applied} applied, ${skipped} skipped`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

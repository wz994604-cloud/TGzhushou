import { parentPort, workerData } from 'node:worker_threads';
import pg from 'pg';
import { postgresStatement } from './postgres-sql.js';

// IDs, millisecond timestamps and aggregate counts retain the existing numeric API.
const parseInteger = value => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('数据库整数超出安全范围');
  return number;
};
pg.types.setTypeParser(20, parseInteger);
pg.types.setTypeParser(1700, parseInteger);
const client = new pg.Client({ connectionString: workerData.url, connectionTimeoutMillis: 10000,
  statement_timeout: 20000 });
const connected = client.connect();
// Connection failures are returned through the shared transport, not an unhandled rejection.
connected.catch(() => {});
const signal = new Int32Array(workerData.transport, 0, 3);
const payload = new Uint8Array(workerData.transport, 12);
const encoder = new TextEncoder();

function respond(id, result) {
  let bytes = encoder.encode(JSON.stringify(result));
  if (bytes.length > payload.length) bytes = encoder.encode(JSON.stringify({ error: '数据库查询结果过大' }));
  payload.set(bytes);
  Atomics.store(signal, 2, bytes.length);
  Atomics.store(signal, 1, id);
  Atomics.notify(signal, 1);
}

parentPort.on('message', async ({ id, operation, sql, args }) => {
  try {
    await connected;
    if (operation === 'close') { await client.end(); return respond(id, { ok: true }); }
    if (operation === 'batch') {
      await client.query('BEGIN');
      try {
        for (const statement of args) await client.query(statement);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      return respond(id, { ok: true });
    }
    if (['begin','commit','rollback'].includes(operation)) {
      await client.query(operation.toUpperCase());
      return respond(id, { ok: true });
    }
    const result = await client.query(postgresStatement(sql, args));
    respond(id, { rows: result.rows || [], rowsAffected: result.rowCount || 0,
      lastInsertRowid: result.command === 'INSERT' ? result.rows[0]?.id : undefined });
  } catch (error) { respond(id, { error: error?.message || String(error) }); }
});

import { parentPort, workerData } from 'node:worker_threads';
import { createClient } from '@libsql/client';

const client = createClient({ url: workerData.url, authToken: workerData.authToken });
const signal = new Int32Array(workerData.transport, 0, 3);
const payload = new Uint8Array(workerData.transport, 12);
const encoder = new TextEncoder();
let transaction = null;

function respond(id, result) {
  let bytes = encoder.encode(JSON.stringify(result, (_, value) =>
    typeof value === 'bigint' ? Number(value) : value));
  if (bytes.length > payload.length)
    bytes = encoder.encode(JSON.stringify({ error: '数据库查询结果过大' }));
  payload.set(bytes);
  Atomics.store(signal, 2, bytes.length);
  Atomics.store(signal, 1, id);
  Atomics.notify(signal, 1);
}

parentPort.on('message', async ({ id, operation, sql, args }) => {
  try {
    if (operation === 'close') {
      if (transaction) await transaction.rollback();
      client.close();
      return respond(id, { ok: true });
    }
    if (operation === 'begin') {
      if (transaction) throw new Error('数据库事务已开始');
      transaction = await client.transaction('write');
      return respond(id, { ok: true });
    }
    if (operation === 'batch') {
      if (transaction) throw new Error('事务内不支持批量 schema 初始化');
      await client.batch(args, 'write');
      return respond(id, { ok: true });
    }
    if (operation === 'commit' || operation === 'rollback') {
      if (!transaction) throw new Error('数据库事务不存在');
      const current = transaction;
      try { await current[operation](); }
      finally { transaction = null; }
      return respond(id, { ok: true });
    }
    const result = await (transaction || client).execute({ sql, args });
    respond(id, {
      rows: result.rows,
      rowsAffected: result.rowsAffected,
      lastInsertRowid: result.lastInsertRowid
    });
  } catch (error) {
    respond(id, { error: error?.message || String(error) });
  }
});

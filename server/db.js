import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import { postgresStatement } from './postgres-sql.js';

const decoder = new TextDecoder();
const queryTimeoutMs = 25_000;

export function splitStatements(sql) {
  const statements = [];
  let start = 0, quote = '', depth = 0, word = '';
  for (let index = 0; index < sql.length; index++) {
    const char = sql[index];
    if (quote) {
      if (char === quote && sql[index - 1] !== '\\') quote = '';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
    if (/[A-Za-z_]/.test(char)) { word += char.toUpperCase(); continue; }
    if (word) {
      if (word === 'BEGIN') depth++;
      else if (word === 'END' && depth > 0) depth--;
      word = '';
    }
    if (char === ';' && depth === 0) {
      const statement = sql.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  const tail = sql.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

const bindArgs = args => args.length === 1 && args[0] !== null && typeof args[0] === 'object' &&
  (Object.getPrototypeOf(args[0]) === Object.prototype || Object.getPrototypeOf(args[0]) === null)
  ? args[0] : args;

function openLocalDatabase(localFile) {
  const transport = new SharedArrayBuffer(8 * 1024 * 1024 + 12);
  const signal = new Int32Array(transport, 0, 3);
  const payload = new Uint8Array(transport, 12);
  const worker = new Worker(new URL('./turso-worker.js', import.meta.url), {
    workerData: { url: `file:${localFile}`, transport }
  });
  worker.unref();
  let sequence = 0, transactionDepth = 0, closed = false;

  function execute(operation, sql = '', args = []) {
    if (closed) throw new Error('数据库连接已关闭');
    const id = ++sequence;
    Atomics.store(signal, 1, 0);
    Atomics.store(signal, 2, 0);
    worker.postMessage({ id, operation, sql, args });
    const state = Atomics.wait(signal, 1, 0, queryTimeoutMs);
    if (state === 'timed-out' || Atomics.load(signal, 1) !== id) {
      closed = true;
      worker.terminate();
      throw new Error('数据库查询超时');
    }
    const result = JSON.parse(decoder.decode(payload.subarray(0, Atomics.load(signal, 2))));
    if (result.error) throw new Error(result.error);
    return result;
  }

  return {
    prepare(sql) { return {
      get(...args) { return execute('execute', sql, bindArgs(args)).rows[0]; },
      all(...args) { return execute('execute', sql, bindArgs(args)).rows; },
      run(...args) {
        const result = execute('execute', sql, bindArgs(args));
        return { changes: result.rowsAffected || 0, lastInsertRowid: result.lastInsertRowid };
      }
    }; },
    exec(sql) { for (const statement of splitStatements(String(sql))) execute('execute', statement); },
    transaction(fn) { return async (...args) => {
      const outermost = transactionDepth === 0;
      if (outermost) execute('begin');
      transactionDepth++;
      try {
        const result = await fn(...args);
        if (outermost) execute('commit');
        return result;
      } catch (error) {
        if (outermost && !closed) {
          try { execute('rollback'); } catch { /* retain original error */ }
        }
        throw error;
      } finally {
        transactionDepth--;
      }
    }; },
    async close() {
      if (closed) return;
      try { execute('close'); }
      finally { closed = true; await worker.terminate(); }
    }
  };
}

const parseInteger = value => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('数据库整数超出安全范围');
  return number;
};
pg.types.setTypeParser(20, parseInteger);
pg.types.setTypeParser(1700, parseInteger);

async function openPostgresDatabase(url) {
  const pool = new pg.Pool({
    connectionString: url,
    max: Math.max(2, Math.min(20, Number(process.env.PG_POOL_MAX) || 8)),
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 20_000
  });
  const transactionStore = new AsyncLocalStorage();
  const queryTarget = () => transactionStore.getStore() || pool;

  async function query(sql, args = []) {
    const result = await queryTarget().query(postgresStatement(sql, args));
    return {
      rows: result.rows || [],
      rowsAffected: result.rowCount || 0,
      lastInsertRowid: result.command === 'INSERT' ? result.rows[0]?.id : undefined
    };
  }

  const db = {
    prepare(sql) { return {
      async get(...args) { return (await query(sql, bindArgs(args))).rows[0]; },
      async all(...args) { return (await query(sql, bindArgs(args))).rows; },
      async run(...args) {
        const result = await query(sql, bindArgs(args));
        return { changes: result.rowsAffected || 0, lastInsertRowid: result.lastInsertRowid };
      }
    }; },
    async exec(sql) {
      for (const statement of splitStatements(String(sql))) await query(statement);
    },
    transaction(fn) { return async (...args) => {
      if (transactionStore.getStore()) return fn(...args);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await transactionStore.run(client, () => fn(...args));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* retain original error */ }
        throw error;
      } finally {
        client.release();
      }
    }; },
    async close() { await pool.end(); }
  };

  const schema = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8');
  const postgresSchema = schema.replace(/id INTEGER PRIMARY KEY/g, 'id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY')
    .replace(/\bINTEGER\b/g, 'BIGINT');
  await db.transaction(async () => {
    for (const statement of splitStatements(postgresSchema)) await query(statement);
  })();
  return db;
}

export async function openDatabase(options = {}) {
  const localFile = typeof options === 'object' && options.localFile;
  if (localFile) {
    const db = openLocalDatabase(localFile);
    const schema = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8');
    const ready = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").all().length > 0;
    if (!ready) for (const statement of splitStatements(schema)) db.exec(statement);
    return db;
  }
  const url = String(process.env.DATABASE_URL || '');
  if (!/^postgres(?:ql)?:\/\//.test(url)) throw new Error('DATABASE_URL 未配置或格式不正确');
  return openPostgresDatabase(url);
}

function encryptionKey(raw) {
  const key = Buffer.from(String(raw || ''), 'base64');
  if (key.length !== 32) throw new Error('CONFIG_KEY 必须是 32 字节的 Base64 密钥');
  return key;
}
export function encryptToken(token, rawKey) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(rawKey), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64url')).join('.');
}
export function decryptToken(value, rawKey) {
  const [iv, tag, ciphertext] = String(value || '').split('.').map(part => Buffer.from(part, 'base64url'));
  if (!iv || iv.length !== 12 || !tag || tag.length !== 16 || !ciphertext)
    throw new Error('发布机器人 Token 配置损坏');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(rawKey), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
export const getSetting = async (db, key) => (await db.prepare('SELECT value FROM settings WHERE key=?').get(key))?.value || '';
export const setSetting = async (db, key, value) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));

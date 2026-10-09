// Translate the application's portable query placeholders to PostgreSQL.
export function postgresStatement(sql, args = []) {
  if (/^\s*CREATE TABLE\b/i.test(sql)) sql = sql.replace(/\bINTEGER\b/g, 'BIGINT');
  let index = 0;
  const values = [];
  sql = sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\?|@[A-Za-z_][A-Za-z_0-9]*/g, token => {
    if (token[0] === "'" || token[0] === '"') return token;
    values.push(token === '?' ? args[index++] : args[token.slice(1)]);
    return `$${values.length}`;
  });
  if (/^\s*INSERT OR IGNORE\b/i.test(sql)) {
    sql = sql.replace(/INSERT OR IGNORE/i, 'INSERT').replace(/;\s*$/, '') + ' ON CONFLICT DO NOTHING';
  }
  const insert = /^\s*INSERT INTO\s+(\w+)/i.exec(sql);
  const identityTables = new Set(['targets','media','tasks','runs','deliveries','sticker_packs',
    'sticker_pack_items','broadcasts','broadcast_deliveries','chat_messages','chat_events']);
  if (insert && identityTables.has(insert[1]) && !/\bRETURNING\b/i.test(sql)) {
    sql = sql.replace(/;\s*$/, '') + ' RETURNING id';
  }
  // Translate the cleanup trigger declaration to PostgreSQL syntax.
  const trigger = /^\s*CREATE TRIGGER IF NOT EXISTS (\w+) AFTER DELETE ON (\w+)\s+BEGIN DELETE FROM sent_changes WHERE kind='(\w+)' AND delivery_id=OLD.id; END$/i.exec(sql);
  if (trigger) {
    const [, name, table, kind] = trigger;
    sql = `CREATE OR REPLACE FUNCTION ${name}_fn() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN DELETE FROM sent_changes WHERE kind='${kind}' AND delivery_id=OLD.id; RETURN OLD; END $$;
      DROP TRIGGER IF EXISTS ${name} ON ${table};
      CREATE TRIGGER ${name} AFTER DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${name}_fn()`;
  }
  return { text: sql, values };
}

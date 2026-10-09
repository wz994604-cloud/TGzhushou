export function normalizeTelegramId(value) {
  let text = String(value ?? '').trim().replace(/^['"]|['"]$/g, '').replace(/,/g, '');
  if (!text) return '';
  const scientific = /^(\d+(?:\.\d+)?)e([+-]?\d+)$/i.exec(text);
  if (scientific) {
    const [coefficient, exponent] = scientific.slice(1);
    const [whole, fraction = ''] = coefficient.split('.');
    const digits = whole + fraction;
    const decimal = whole.length + Number(exponent);
    text = decimal <= 0 ? `0.${'0'.repeat(-decimal)}${digits}` : decimal >= digits.length ? `${digits}${'0'.repeat(decimal - digits.length)}` : `${digits.slice(0, decimal)}.${digits.slice(decimal)}`;
  }
  if (!/^\d{5,30}$/.test(text)) return '';
  return text;
}

export function decodeCsv(buffer) {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) return buffer.subarray(3).toString('utf8');
  try { return new TextDecoder('utf-8', { fatal:true }).decode(buffer); } catch { return new TextDecoder('gbk').decode(buffer); }
}

export function parseCsv(text) {
  text = String(text).replace(/^\ufeff/, '');
  const rows = [], row = []; let field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i], next = text[i + 1];
    if (quoted) { if (char === '"' && next === '"') { field += '"'; i++; } else if (char === '"') quoted = false; else field += char; continue; }
    if (char === '"' && field === '') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); if (row.some(value => value.trim())) rows.push([...row]); row.length = 0; field = ''; }
    else field += char;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, '')); if (row.some(value => value.trim())) rows.push([...row]); }
  return rows;
}

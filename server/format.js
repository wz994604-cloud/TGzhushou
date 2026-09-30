const emojiId = /^\d{5,30}$/;
const styles = new Set(['default', 'primary', 'success', 'danger']);

export function linkUrl(value) {
  const url = String(value || '').trim();
  if (url.length > 2048 || !/^(https:\/\/|tg:\/\/)/i.test(url)) throw new Error('链接只支持 https:// 或 tg://');
  return url;
}

export function normalizeButtons(value) {
  if (!Array.isArray(value) || value.length > 12) throw new Error('最多设置 12 个按钮');
  return value.map((raw, index) => {
    const text = String(raw.text || '').trim();
    if (!text || text.length > 64) throw new Error(`按钮 ${index + 1} 文字长度应为 1–64`);
    const style = raw.style || 'default';
    if (!styles.has(style)) throw new Error('按钮样式无效');
    const row = Number(raw.row ?? index);
    if (!Number.isInteger(row) || row < 0 || row > 11) throw new Error('按钮排列无效');
    const iconId = raw.iconId ? String(raw.iconId) : '';
    if (iconId && !emojiId.test(iconId)) throw new Error('按钮专属表情 ID 无效');
    return { text, url: linkUrl(raw.url), style, row, iconId, iconAlt: String(raw.iconAlt || '').slice(0, 8) };
  });
}

export function keyboard(buttons) {
  if (!buttons.length) return null;
  const rows = [];
  for (const button of buttons) {
    const item = { text: button.text, url: button.url };
    if (button.style !== 'default') item.style = button.style;
    if (button.iconId) item.icon_custom_emoji_id = button.iconId;
    (rows[button.row] ||= []).push(item);
  }
  return { inline_keyboard: rows.filter(Boolean) };
}

export function renderDelta(ops) {
  if (!Array.isArray(ops) || ops.length > 500) throw new Error('消息内容无效');
  let text = '';
  const entities = [];
  for (const op of ops) {
    if (!op || typeof op !== 'object') throw new Error('消息内容无效');
    const start = text.length;
    if (typeof op.insert === 'string') text += op.insert;
    else if (op.insert?.customEmoji) {
      const { id, alt } = op.insert.customEmoji;
      if (!emojiId.test(String(id)) || !alt || String(alt).length > 8) throw new Error('专属表情数据无效');
      text += String(alt);
      entities.push({ type: 'custom_emoji', offset: start, length: text.length - start, custom_emoji_id: String(id) });
    } else throw new Error('消息内容无效');
    const length = text.length - start;
    if (!length || typeof op.insert !== 'string') continue;
    const attrs = op.attributes || {};
    if (attrs.bold) entities.push({ type: 'bold', offset: start, length });
    if (attrs.italic) entities.push({ type: 'italic', offset: start, length });
    if (attrs.underline) entities.push({ type: 'underline', offset: start, length });
    if (attrs.link) entities.push({ type: 'text_link', offset: start, length, url: linkUrl(attrs.link) });
  }
  text = text.replace(/\n$/, '');
  for (const entity of entities) entity.length = Math.min(entity.length, Math.max(0, text.length - entity.offset));
  if (!text.trim() || text.length > 4096) throw new Error('文字长度应为 1–4096 个字符');
  return { text, entities: entities.filter(entity => entity.length > 0), customCount: entities.filter(entity => entity.type === 'custom_emoji').length };
}

// UI-only rules; row values are sent unchanged to the existing backend.
export const miniTabPages = ['chat', 'editor', 'assets', 'tasks', 'settings'];
const miniSecondaryTab = { players: 'settings', logs: 'tasks' };
export function miniTabForPage(page) {
  return miniTabPages.includes(page) ? page : miniSecondaryTab[page] || 'chat';
}
export const clampMiniStep = step => Math.max(0, Math.min(4, Number.isFinite(step) ? step : 0));

export const defaultButtonRow = index => Math.floor(index / 2);
export function normalizeButtonRows(list) {
  list.forEach((button, index) => {
    const valid = Number.isInteger(button.row) && button.row >= 0;
    // Stored rows without UI metadata may have been hand-edited on another device.
    if (button.rowExplicit === undefined) button.rowExplicit = valid;
    if (!valid || !button.rowExplicit) button.row = defaultButtonRow(index);
  });
  return list;
}
export function reflowAutomaticButtonRows(list) {
  list.forEach((button, index) => { if (button.rowExplicit === false) button.row = defaultButtonRow(index); });
  return list;
}
export function emojiMatches(sticker, query) {
  const q=query.trim().toLocaleLowerCase();
  return !q || `${sticker.id} ${sticker.alt||''}`.toLocaleLowerCase().includes(q);
}

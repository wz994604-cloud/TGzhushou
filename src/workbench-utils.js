// UI-only rules; row values are sent unchanged to the existing backend.
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
export function emojiPopoverPosition(anchor, viewport, requested = {width:400,height:360}) {
  const gap=8, margin=12, width=Math.min(requested.width,viewport.width-2*margin);
  const above=Math.max(0,anchor.top-margin-gap), below=Math.max(0,viewport.height-anchor.bottom-margin-gap);
  const upward=above>=requested.height || above>below;
  const height=Math.min(requested.height,Math.max(above,below),viewport.height-2*margin);
  return {width,height,left:Math.max(margin,Math.min(anchor.left,viewport.width-width-margin)),
    top:Math.max(margin,Math.min(upward?anchor.top-height-gap:anchor.bottom+gap,viewport.height-height-margin)),upward};
}
export function emojiMatches(sticker, query) {
  const q=query.trim().toLocaleLowerCase();
  return !q || `${sticker.id} ${sticker.alt||''}`.toLocaleLowerCase().includes(q);
}

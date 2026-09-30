// Keep Telegram text_link entities in Quill's Delta; the label is not the URL.
export function installLinkEditor(Quill, quill) {
  const dialog = document.createElement('dialog');
  dialog.id = 'linkDialog';
  dialog.setAttribute('aria-labelledby', 'linkTitle');
  dialog.innerHTML = `<form id="linkForm"><h3 id="linkTitle">文字链接</h3>
    <label>显示文字<input id="linkText" placeholder="例如：点击领取福利" required></label>
    <label>跳转地址<input id="linkUrl" placeholder="https://t.me/你的频道" required inputmode="url" autocapitalize="off" spellcheck="false"></label>
    <p id="linkError" role="alert" class="hint" hidden></p>
    <p class="hint">发布后显示你填写的文字，点击文字打开地址。</p>
    <div class="wrap-actions"><button id="saveLink" class="primary" type="submit">确定</button><button id="removeLink" class="quiet danger-text" type="button">移除链接</button><button id="cancelLink" class="quiet" type="button">取消</button></div></form>`;
  document.body.append(dialog);
  const field = id => dialog.querySelector(`#${id}`);
  let lastRange = null, editing = null;
  quill.on('selection-change', range => { if (range) lastRange = range; });
  const labelFor = range => quill.getContents(range.index, range.length).ops
    .map(op => typeof op.insert === 'string' ? op.insert : op.insert?.customEmoji?.alt || '').join('');

  function open(anchor) {
    let range = quill.getSelection() || lastRange || { index: quill.getLength() - 1, length: 0 };
    if (!anchor && range.length === 0) {
      const [leaf] = quill.getLeaf(range.index);
      const element = leaf?.domNode?.nodeType === 1 ? leaf.domNode : leaf?.domNode?.parentElement;
      anchor = element?.closest('a');
    }
    if (anchor) {
      const blot = Quill.find(anchor);
      range = { index: quill.getIndex(blot), length: blot.length() };
    }
    const text = labelFor(range);
    const format = quill.getFormat(range.index, range.length);
    editing = { ...range, text, format };
    field('linkText').value = text;
    field('linkUrl').value = anchor?.getAttribute('href') || (typeof format.link === 'string' ? format.link : '');
    field('removeLink').hidden = !format.link;
    field('linkError').hidden = true;
    quill.theme.tooltip?.hide();
    dialog.showModal();
    (text ? field('linkUrl') : field('linkText')).focus();
  }
  function finish(length = editing.length) {
    dialog.close();
    quill.focus();
    quill.setSelection(editing.index + length, 0, 'silent');
    quill.format('link', false, 'silent');
    quill.theme.tooltip?.hide();
  }
  field('linkForm').addEventListener('submit', event => {
    event.preventDefault();
    const text = field('linkText').value, url = field('linkUrl').value.trim();
    try {
      const parsed = new URL(url);
      if (!['https:', 'tg:'].includes(parsed.protocol)) throw new Error();
    } catch {
      field('linkError').textContent = '请填写完整的 https:// 或 tg:// 跳转地址';
      field('linkError').hidden = false;
      return;
    }
    if (!text.trim()) return;
    if (text === editing.text && editing.length) {
      // URL-only edits preserve bold, emoji embeds and each existing text run.
      quill.formatText(editing.index, editing.length, 'link', url, 'user');
      finish();
    } else {
      const attributes = { link: url };
      for (const key of ['bold', 'italic', 'underline']) if (editing.format[key] === true) attributes[key] = true;
      const Delta = Quill.import('delta');
      quill.updateContents(new Delta().retain(editing.index).delete(editing.length).insert(text, attributes), 'user');
      finish(text.length);
    }
  });
  field('removeLink').onclick = () => { quill.formatText(editing.index, editing.length, 'link', false, 'user'); finish(); };
  field('cancelLink').onclick = () => dialog.close();
  document.getElementById('editLink').onclick = () => open();
  quill.root.addEventListener('click', event => {
    const anchor = event.target.closest('a');
    if (anchor) { event.preventDefault(); event.stopPropagation(); open(anchor); }
  });
}

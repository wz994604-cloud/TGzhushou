import fs from 'node:fs';

function replaceOnce(path, oldText, newText) {
  const source = fs.readFileSync(path, 'utf8');
  const count = source.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${path}: expected 1 replacement, found ${count}`);
  fs.writeFileSync(path, source.replace(oldText, newText));
}

replaceOnce('server/chat.js',
  "  const botFor = publisherFor || (req => scheduler.publisher(req.get('x-publisher-id') || undefined));\n  const currentId = req => botFor(req)?.id || '';\n",
  "  const botFor = async req => publisherFor ? publisherFor(req) : scheduler.publisher(req.get('x-publisher-id') || undefined);\n  const currentId = async req => (await botFor(req))?.id || '';\n");

replaceOnce('server/sent-actions.js',
  "    const row=read(kind,id), bot=publisher(row.bot_id), key=kind+':'+id;\n",
  "    const row=read(kind,id), bot=await publisher(row.bot_id), key=kind+':'+id;\n");

import { readFile } from 'node:fs/promises';

const schema = await readFile(new URL('../tgcloud/schema.js', import.meta.url), 'utf8');
const requiredTables = [
  'settings', 'users', 'administrators', 'publishers', 'publisherPermissions',
  'targets', 'media', 'tasks', 'runs', 'deliveries', 'botPlayers',
  'broadcasts', 'broadcastDeliveries', 'conversations', 'chatMessages',
  'chatEvents', 'publisherInbox', 'sentActions', 'stickerPacks', 'stickerPackItems', 'browserLinks', 'browserSessions', 'sentChanges'
];
const missing = requiredTables.filter(name => !new RegExp(`export const ${name}\\s*=\\s*table\\(`).test(schema));
if (missing.length) {
  console.error(`Missing Serverless tables: ${missing.join(', ')}`);
  process.exit(1);
}
if (!schema.includes("from 'sdk/db'")) {
  console.error('Serverless schema must import sdk/db');
  process.exit(1);
}
console.log(`Serverless schema check passed: ${requiredTables.length} tables`);

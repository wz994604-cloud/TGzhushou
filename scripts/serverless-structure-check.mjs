import { access, readFile } from 'node:fs/promises';

const required = [
  'tgcloud/handlers', 'tgcloud/endpoints', 'tgcloud/lib',
  'tgcloud/schema.js', 'tgcloud.jsonc'
];
for (const path of required) await access(path);
const config = await readFile('tgcloud.jsonc', 'utf8');
if (!config.includes('"source": "dist"')) throw new Error('tgcloud.jsonc must publish dist');
if (!config.includes('"spa": true')) throw new Error('tgcloud.jsonc must enable SPA fallback');
console.log(`Serverless structure check passed: ${required.length} required paths`);

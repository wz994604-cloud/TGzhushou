import fs from 'node:fs';
const path='tests/publisher-selection.test.js';
const source=fs.readFileSync(path,'utf8');
const oldText="    browserAuth: { authenticate: () => authenticated ? { id:'admin' } : null },\n    scheduler: { publisher: id => id === 'valid-bot' ? { id } : null }\n";
const newText="    browserAuth: { authenticate: () => authenticated ? { id:'admin' } : null },\n    canAccessBot: () => true,\n    listPublishers: () => [],\n    scheduler: { publisher: id => id === 'valid-bot' ? { id } : null }\n";
if(source.split(oldText).length-1!==1)throw new Error('publisher-selection fixture shape changed');
fs.writeFileSync(path,source.replace(oldText,newText));

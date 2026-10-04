import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase, getSetting, setSetting, encryptToken} from '../server/db.js';
import {initializePlayerImports, upsertPlayers, playerSourceToken, savePlayerSourceToken} from '../server/player-store.js';
import {savePublisher} from '../server/publishers.js';
import {configKey, publisherToken} from './helpers.js';
const first='222222', second='333333';
async function fixture(t) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tgzhushou-player-store-'));
 const db=await openDatabase({localFile:path.join(dir,'test.db')});
 t.after(async()=>{await db.close();fs.rmSync(dir,{recursive:true,force:true});});
 return db;
}
const legacy=async (db, id='80001', name='old') => await db.prepare('INSERT INTO players(telegram_id,display_name,first_seen,last_seen) VALUES(?,?,10,20)').run(id,name);
const row=(id='80001',name='new')=>({telegramId:id,displayName:name,username:'username',platformId:'1',active:1});
const list=async (db, bot) => await db.prepare('SELECT * FROM bot_players WHERE bot_id=? ORDER BY telegram_id').all(bot);

test('known legacy bot gets missing old rows only; no overwrite or copying to another bot',async t => {
 const db=await fixture(t);await savePublisher(db,configKey,{id:first,username:'first'},publisherToken);await savePublisher(db,configKey,{id:second,username:'second'},second+':SYNTHETIC_SECOND_TOKEN_123456');
 await legacy(db);await legacy(db,'80002','legacy missing');
 await db.prepare('INSERT INTO bot_players(bot_id,telegram_id,display_name,first_seen,last_seen) VALUES(?,?,?,1,2)').run(first,'80001','scoped newer');
 await setSetting(db,'ffa_token','legacy encrypted');
 assert.deepEqual(await initializePlayerImports(db),{version:1,legacyBotId:first,migrated:1});
 assert.equal((await list(db,first))[0].display_name,'scoped newer');assert.equal((await list(db,first))[1].first_seen,10);assert.deepEqual(await list(db,second),[]);
 assert.equal(await playerSourceToken(db,first),'legacy encrypted');assert.equal(await playerSourceToken(db,second),'');
 await upsertPlayers(db,second,[row('80001','second name')],'csv',100);
 assert.equal((await list(db,first))[0].display_name,'scoped newer');assert.equal((await list(db,second))[0].display_name,'second name');assert.equal((await db.prepare('SELECT display_name FROM players WHERE telegram_id=?').get('80001')).display_name,'old');
 await upsertPlayers(db,first,[row('80001','first updated')],'ffa',101);assert.equal((await list(db,first))[0].first_seen,1);assert.equal((await list(db,second))[0].display_name,'second name');
 assert.equal((await db.prepare('SELECT display_name FROM players WHERE telegram_id=?').get('80001')).display_name,'first updated');
 await savePlayerSourceToken(db,second,'second encrypted');assert.equal(await playerSourceToken(db,second),'second encrypted');assert.equal(await getSetting(db,'ffa_token'),'legacy encrypted');
});

test('unknown legacy list and token remain unassigned even after later bot binding',async t => {
 const db=await fixture(t);await legacy(db);await setSetting(db,'ffa_token','unknown encrypted');
 assert.equal((await initializePlayerImports(db)).legacyBotId,'');
 await savePublisher(db,configKey,{id:first,username:'later'},publisherToken);await initializePlayerImports(db);
 assert.deepEqual(await list(db,first),[]);assert.equal(await playerSourceToken(db,first),'');
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM players').get()).n,1);assert.equal(await getSetting(db,'ffa_token'),'unknown encrypted');
});

test('backfill is atomic and import transaction never partially writes another row',async t => {
 const db=await fixture(t);await savePublisher(db,configKey,{id:first,username:'first'},publisherToken);await legacy(db);
 await db.exec("CREATE TRIGGER reject_marker BEFORE INSERT ON settings WHEN NEW.key='player_import_scope_v1' BEGIN SELECT RAISE(ABORT,'migration test failure'); END;");
 await assert.rejects(async () => await initializePlayerImports(db),/migration test failure/);assert.deepEqual(await list(db,first),[]);assert.equal(await getSetting(db,'player_import_scope_v1'),'');
 await db.exec('DROP TRIGGER reject_marker');await initializePlayerImports(db);
 await assert.rejects(async () => await upsertPlayers(db,second,[row('80005'),row(null)],'csv'),/NOT NULL/);assert.deepEqual(await list(db,second),[]);assert.equal((await list(db,first)).length,1);
});

test('older schema without bot_players is upgraded and reopening never resurrects removed rows',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tgzhushou-player-old-')),file=path.join(dir,'test.db');
 let db=await openDatabase({localFile:file});t.after(async()=>{await db.close();fs.rmSync(dir,{recursive:true,force:true});});
 await savePublisher(db,configKey,{id:first,username:'first'},publisherToken);await legacy(db);await db.exec('DROP TABLE bot_players');
 await initializePlayerImports(db);assert.equal((await list(db,first)).length,1);await db.prepare('DELETE FROM bot_players WHERE bot_id=?').run(first);
 await db.close();db=await openDatabase({localFile:file});await initializePlayerImports(db);assert.deepEqual(await list(db,first),[]);assert.equal((await db.prepare('SELECT COUNT(*) n FROM players').get()).n,1);
});

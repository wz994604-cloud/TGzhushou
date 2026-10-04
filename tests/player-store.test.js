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
function fixture(t) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tgzhushou-player-store-'));
 const db=openDatabase({localFile:path.join(dir,'test.db')});
 t.after(async()=>{await db.close();fs.rmSync(dir,{recursive:true,force:true});});
 return db;
}
const legacy=(db,id='80001',name='old')=>db.prepare('INSERT INTO players(telegram_id,display_name,first_seen,last_seen) VALUES(?,?,10,20)').run(id,name);
const row=(id='80001',name='new')=>({telegramId:id,displayName:name,username:'username',platformId:'1',active:1});
const list=(db,bot)=>db.prepare('SELECT * FROM bot_players WHERE bot_id=? ORDER BY telegram_id').all(bot);

test('known legacy bot gets missing old rows only; no overwrite or copying to another bot',t=>{
 const db=fixture(t);savePublisher(db,configKey,{id:first,username:'first'},publisherToken);savePublisher(db,configKey,{id:second,username:'second'},second+':SYNTHETIC_SECOND_TOKEN_123456');
 legacy(db);legacy(db,'80002','legacy missing');
 db.prepare('INSERT INTO bot_players(bot_id,telegram_id,display_name,first_seen,last_seen) VALUES(?,?,?,1,2)').run(first,'80001','scoped newer');
 setSetting(db,'ffa_token','legacy encrypted');
 assert.deepEqual(initializePlayerImports(db),{version:1,legacyBotId:first,migrated:1});
 assert.equal(list(db,first)[0].display_name,'scoped newer');assert.equal(list(db,first)[1].first_seen,10);assert.deepEqual(list(db,second),[]);
 assert.equal(playerSourceToken(db,first),'legacy encrypted');assert.equal(playerSourceToken(db,second),'');
 upsertPlayers(db,second,[row('80001','second name')],'csv',100);
 assert.equal(list(db,first)[0].display_name,'scoped newer');assert.equal(list(db,second)[0].display_name,'second name');assert.equal(db.prepare('SELECT display_name FROM players WHERE telegram_id=?').get('80001').display_name,'old');
 upsertPlayers(db,first,[row('80001','first updated')],'ffa',101);assert.equal(list(db,first)[0].first_seen,1);assert.equal(list(db,second)[0].display_name,'second name');
 assert.equal(db.prepare('SELECT display_name FROM players WHERE telegram_id=?').get('80001').display_name,'first updated');
 savePlayerSourceToken(db,second,'second encrypted');assert.equal(playerSourceToken(db,second),'second encrypted');assert.equal(getSetting(db,'ffa_token'),'legacy encrypted');
});

test('unknown legacy list and token remain unassigned even after later bot binding',t=>{
 const db=fixture(t);legacy(db);setSetting(db,'ffa_token','unknown encrypted');
 assert.equal(initializePlayerImports(db).legacyBotId,'');
 savePublisher(db,configKey,{id:first,username:'later'},publisherToken);initializePlayerImports(db);
 assert.deepEqual(list(db,first),[]);assert.equal(playerSourceToken(db,first),'');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM players').get().n,1);assert.equal(getSetting(db,'ffa_token'),'unknown encrypted');
});

test('backfill is atomic and import transaction never partially writes another row',t=>{
 const db=fixture(t);savePublisher(db,configKey,{id:first,username:'first'},publisherToken);legacy(db);
 db.exec("CREATE TRIGGER reject_marker BEFORE INSERT ON settings WHEN NEW.key='player_import_scope_v1' BEGIN SELECT RAISE(ABORT,'migration test failure'); END;");
 assert.throws(()=>initializePlayerImports(db),/migration test failure/);assert.deepEqual(list(db,first),[]);assert.equal(getSetting(db,'player_import_scope_v1'),'');
 db.exec('DROP TRIGGER reject_marker');initializePlayerImports(db);
 assert.throws(()=>upsertPlayers(db,second,[row('80005'),row(null)],'csv'),/NOT NULL/);assert.deepEqual(list(db,second),[]);assert.equal(list(db,first).length,1);
});

test('older schema without bot_players is upgraded and reopening never resurrects removed rows',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tgzhushou-player-old-')),file=path.join(dir,'test.db');
 let db=openDatabase({localFile:file});t.after(async()=>{await db.close();fs.rmSync(dir,{recursive:true,force:true});});
 savePublisher(db,configKey,{id:first,username:'first'},publisherToken);legacy(db);db.exec('DROP TABLE bot_players');
 initializePlayerImports(db);assert.equal(list(db,first).length,1);db.prepare('DELETE FROM bot_players WHERE bot_id=?').run(first);
 await db.close();db=openDatabase({localFile:file});initializePlayerImports(db);assert.deepEqual(list(db,first),[]);assert.equal(db.prepare('SELECT COUNT(*) n FROM players').get().n,1);
});

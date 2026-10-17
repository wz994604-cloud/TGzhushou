import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountAuth} from '../server/account-auth.js';
import crypto from 'node:crypto';
import {accountFixture} from './account-auth-fixture.js';
const mutate=(f,cookie,path,method,body)=>f.request(path,{method,headers:{cookie},body:body===undefined?undefined:JSON.stringify(body)});
test('owner updates env authorization, resets passwords and invalidates every independent session',async()=>{
 const f=await accountFixture();try {
 const owner=await f.login(),a=await f.login('operator','operator-fixture-password'),b=await f.login('operator','operator-fixture-password');
 assert.notEqual(a,b);
 assert.equal((await mutate(f,owner,'/auth/admin-accounts/operator','PATCH',{publisherIds:['1002']})).status,200);
 assert.equal((await f.request('/api/bots/1002',{headers:{cookie:a}})).status,200);
 assert.equal((await mutate(f,owner,'/auth/admin-accounts/operator','PATCH',{password:'replacement-password'})).status,200);
 for(const cookie of [a,b])assert.equal((await f.request('/api/bootstrap',{headers:{cookie}})).status,401);
 await f.login('operator','replacement-password');
 const list=await (await f.request('/auth/admin-accounts',{headers:{cookie:owner}})).json();
 assert.equal(list.accounts.filter(a=>a.username==='operator').length,1);
 assert.doesNotMatch(JSON.stringify(list),/password|sessionVersion/);
 assert.ok(JSON.parse(f.settings.get('admin_account_audit_v1')).some(row=>row.action==='account.password_reset'));
 }finally{await f.close();}
});
test('disable, delete and recreate revoke sessions permanently while owner remains protected',async()=>{
 const f=await accountFixture();try {
 const owner=await f.login(),cookie=await f.login('operator','operator-fixture-password');
 for(const method of ['PATCH','DELETE'])assert.equal((await mutate(f,owner,'/auth/admin-accounts/wz9946',method,method==='PATCH'?{enabled:false}:undefined)).status,403);
 assert.equal((await mutate(f,owner,'/auth/admin-accounts/operator','PATCH',{enabled:false})).status,200);
 assert.equal((await f.request('/api/bootstrap',{headers:{cookie}})).status,401);
 assert.equal((await mutate(f,owner,'/auth/admin-accounts/operator','PATCH',{enabled:true})).status,200);
 assert.equal((await f.request('/api/bootstrap',{headers:{cookie}})).status,401);
 assert.equal((await mutate(f,owner,'/auth/admin-accounts/operator','DELETE')).status,200);
 assert.equal((await mutate(f,owner,'/auth/admin-accounts','POST',{username:'operator',password:'recreated-password',publisherIds:['1001']})).status,201);
 assert.equal((await f.request('/api/bootstrap',{headers:{cookie}})).status,401);
 await f.login('operator','recreated-password');
 }finally{await f.close();}
});
test('self password change needs current password; ordinary users cannot manage accounts',async()=>{
 const f=await accountFixture();try {
 const cookie=await f.login('operator','operator-fixture-password'),second=await f.login('operator','operator-fixture-password');
 assert.equal((await mutate(f,cookie,'/auth/admin-accounts/operator','PATCH',{enabled:false})).status,403);
 assert.equal((await mutate(f,cookie,'/auth/admin-accounts/operator','DELETE')).status,403);
 assert.equal((await mutate(f,cookie,'/auth/change-password','POST',{currentPassword:'wrong',newPassword:'changed-password'})).status,400);
 const result=await mutate(f,cookie,'/auth/change-password','POST',{currentPassword:'operator-fixture-password',newPassword:'changed-password'});
 assert.equal(result.status,200);assert.match(result.headers.get('set-cookie'),/Max-Age=0/);
 for(const old of [cookie,second])assert.equal((await f.request('/api/bootstrap',{headers:{cookie:old}})).status,401);
 await f.login('operator','changed-password');
 }finally{await f.close();}
});
test('management validates input and rejects malformed and foreign origins',async()=>{
 const f=await accountFixture();try {
 const cookie=await f.login();
 for(const payload of [{publisherIds:['9999']},{enabled:'false'},{password:'x'},{unknown:true},{}])assert.equal((await mutate(f,cookie,'/auth/admin-accounts/operator','PATCH',payload)).status,400);
 assert.equal((await f.request('/auth/login',{method:'POST',headers:{origin:'malformed'},body:'{}'})).status,403);
 assert.equal((await f.request('/auth/admin-accounts/operator',{method:'PATCH',headers:{cookie,origin:'https://elsewhere.example'},body:JSON.stringify({enabled:false})})).status,401);
 }finally{await f.close();}
});
test('bot removal persists revoked authorization and audit records exclude secrets',async()=>{
 const f=await accountFixture();try {
 const cookie=await f.login('operator','operator-fixture-password');
 assert.equal(typeof f.auth.revokeBotAccess,'function');
 await f.auth.revokeBotAccess('1001',{actor:'wz9946'});
 assert.equal((await f.request('/api/bots/1001',{headers:{cookie}})).status,403);
 await f.auth.audit({actor:'wz9946',action:'bot.removed',target:'1001',password:'secret'});
 assert.doesNotMatch(f.settings.get('admin_account_audit_v1'),/secret/);
 }finally{await f.close();}
});
test('embedded clients receive partitioned secure cookies on login and logout',async()=>{
 const f=await accountFixture();try {
 const response=await f.request('/auth/login',{method:'POST',body:JSON.stringify({username:'wz9946',password:'owner-fixture-password'})});
 assert.match(response.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=None; Partitioned/);
 const cookie=response.headers.get('set-cookie').split(';')[0];
 const logout=await mutate(f,cookie,'/auth/logout','POST');
 assert.match(logout.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=None; Partitioned/);
 }finally{await f.close();}
});

test('settings overrides survive auth recreation; legacy stored accounts remain usable',async()=>{
 const passwordSalt='legacy-fixture',passwordHash=crypto.scryptSync('legacy-password',passwordSalt,32).toString('base64');
 const f=await accountFixture({settings:[['admin_accounts_v1',JSON.stringify([{username:'legacyuser',passwordSalt,passwordHash,publisherIds:['1002']}])]]});try {
 await f.login('legacyuser','legacy-password');
 const owner=await f.login();
 await mutate(f,owner,'/auth/admin-accounts/operator','PATCH',{password:'persisted-password',publisherIds:['1002']});
 const cookie=await f.login('operator','persisted-password');
 const restarted=await createAccountAuth(f.db,f.credentials);
 const admin=await restarted.authenticate({method:'GET',get:name=>name==='cookie'?cookie:undefined});
 assert.deepEqual(admin.publisherIds,['1002']);
 assert.equal((await f.request('/auth/login',{method:'POST',body:JSON.stringify({username:'operator',password:'operator-fixture-password'})})).status,401);
 }finally{await f.close();}
});
test('bot removal turns unscoped ordinary env accounts into explicit remaining grants',async()=>{
 const f=await accountFixture({accounts:[{username:'wz9946',password:'owner-fixture-password'},{username:'operator',password:'operator-fixture-password'}]});try {
 const cookie=await f.login('operator','operator-fixture-password');
 await f.auth.revokeBotAccess('1001');
 const restarted=await createAccountAuth(f.db,f.credentials);
 const admin=await restarted.authenticate({method:'GET',get:name=>name==='cookie'?cookie:undefined});
 assert.deepEqual(admin.publisherIds,['1002']);
 }finally{await f.close();}
});
test('failed persistence does not mutate environment account authorization in memory',async()=>{
 const f=await accountFixture();try {
 const owner=await f.login(),cookie=await f.login('operator','operator-fixture-password');
 const prepare=f.db.prepare.bind(f.db);
 f.db.prepare=sql=>{
   if(sql.startsWith('INSERT INTO settings') && !sql.includes('DO NOTHING')) return {run:async()=>{throw new Error('test storage failure');}};
   return prepare(sql);
 };
 const response=await mutate(f,owner,'/auth/admin-accounts/operator','PATCH',{publisherIds:['1002']});
 assert.equal(response.status,500);
 assert.equal((await f.request('/api/bots/1002',{headers:{cookie}})).status,403);
 }finally{await f.close();}
});
test('queued ownership checks current authorization and stable identity, not password sessions',async()=>{
 const f=await accountFixture();try {
 const owner=await f.login(),cookie=await f.login('operator','operator-fixture-password');
 const {admin}=await (await f.request('/api/bootstrap',{headers:{cookie}})).json();
 const actor={account_id:admin.id,username:admin.username};
 assert.equal(typeof f.auth.canExecuteOwner,'function');
 assert.equal(await f.auth.canExecuteOwner(null,'1001'),true);
 assert.equal(await f.auth.canExecuteOwner(actor,'1001'),true);
 assert.equal(await f.auth.canExecuteOwner(actor,'1002'),false);
 assert.equal(await f.auth.canExecuteOwner({...actor,account_id:'forged'},'1001'),false);
 await mutate(f,owner,'/auth/admin-accounts/operator','PATCH',{password:'changed-password'});
 assert.equal(await f.auth.canExecuteOwner(actor,'1001'),true);
 await mutate(f,owner,'/auth/admin-accounts/operator','PATCH',{enabled:false});
 assert.equal(await f.auth.canExecuteOwner(actor,'1001'),false);
 await mutate(f,owner,'/auth/admin-accounts/operator','PATCH',{enabled:true,publisherIds:['1002']});
 assert.equal(await f.auth.canExecuteOwner(actor,'1001'),false);
 await mutate(f,owner,'/auth/admin-accounts/operator','DELETE');
 assert.equal(await f.auth.canExecuteOwner(actor,'1001'),false);
 await mutate(f,owner,'/auth/admin-accounts','POST',{username:'operator',password:'recreated-password',publisherIds:['1001']});
 assert.equal(await f.auth.canExecuteOwner(actor,'1001'),false);
 }finally{await f.close();}
});

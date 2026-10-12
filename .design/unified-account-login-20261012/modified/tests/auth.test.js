import test from 'node:test';
import assert from 'node:assert/strict';
import {accountFixture} from './account-auth-fixture.js';

test('all clients require account login; Telegram identity alone grants no access',async()=>{
  const f=await accountFixture();try {
    assert.equal((await f.request('/api/bootstrap',{headers:{'x-telegram-init-data':'any-telegram-identity'}})).status,401);
    assert.equal((await f.request('/auth/admin-accounts')).status,401);
    assert.equal((await f.request('/auth/login',{method:'POST',body:JSON.stringify({username:'operator',password:'wrong'})})).status,401);
    const cookie=await f.login('operator','operator-fixture-password');
    const response=await f.request('/api/bootstrap',{headers:{cookie,'x-telegram-init-data':'unrelated-identity'}});
    const {admin}=await response.json();assert.equal(admin.username,'operator');assert.equal(admin.canManageAccounts,false);
    assert.deepEqual(admin.publisherIds,['1001']);
    assert.equal((await f.request('/api/bots/1001',{headers:{cookie}})).status,200);
    assert.equal((await f.request('/api/bots/1002',{headers:{cookie}})).status,403);
    assert.equal((await f.request('/auth/exchange',{method:'POST',body:JSON.stringify({token:'old-link-token'})})).status,404);
    assert.equal('issueLink' in f.auth,false);
  }finally{await f.close();}
});
test('only wz9946 creates accounts; new accounts retain assigned robot permissions',async()=>{
  const f=await accountFixture();try {
    const operator=await f.login('operator','operator-fixture-password');
    const payload={username:'newuser',password:'new-fixture-password',publisherIds:['1002']};
    assert.equal((await f.request('/auth/admin-accounts',{method:'POST',headers:{cookie:operator},body:JSON.stringify(payload)})).status,403);
    const owner=await f.login();
    assert.equal((await f.request('/auth/admin-accounts',{method:'POST',headers:{cookie:owner},body:JSON.stringify(payload)})).status,201);
    const stored=JSON.parse(f.settings.get('admin_accounts_v1'))[0];assert.equal(stored.password,undefined);assert.ok(stored.passwordHash);
    const cookie=await f.login('newuser','new-fixture-password');
    assert.equal((await f.request('/api/bots/1002',{headers:{cookie}})).status,200);
    assert.equal((await f.request('/api/bots/1001',{headers:{cookie}})).status,403);
    assert.equal((await f.request('/auth/admin-accounts',{headers:{cookie}})).status,403);
    assert.equal((await f.request('/auth/admin-accounts',{method:'POST',headers:{cookie:owner},body:JSON.stringify({...payload,username:'another',publisherIds:[]})})).status,400);
  }finally{await f.close();}
});
test('logout ends only the current session; expired and legacy Telegram sessions are rejected',async()=>{
  const f=await accountFixture();try{
    const first=await f.login(),second=await f.login();
    assert.equal((await f.request('/auth/logout',{method:'POST',headers:{cookie:first}})).status,200);
    assert.equal((await f.request('/api/bootstrap',{headers:{cookie:first}})).status,401);
    assert.equal((await f.request('/api/bootstrap',{headers:{cookie:second}})).status,200);
    const row=f.sessions.get(f.hash(second));row.expires_at=1;
    assert.equal((await f.request('/api/bootstrap',{headers:{cookie:second}})).status,401);
    row.expires_at=Date.now()+60000;row.login_username='';row.admin_id='123456';
    assert.equal((await f.request('/api/bootstrap',{headers:{cookie:second}})).status,401);
  }finally{await f.close();}
});
test('cross-origin login/logout rejected; cookie remains HttpOnly Secure and rate limiting remains',async()=>{
  const f=await accountFixture();try{
    const cookie=await f.login();
    assert.equal((await f.request('/auth/logout',{method:'POST',headers:{cookie,origin:'https://other.example'}})).status,403);
    assert.equal((await f.request('/auth/login',{method:'POST',headers:{origin:'https://other.example'},body:'{}'})).status,403);
    assert.equal((await f.request('/api/bootstrap',{headers:{cookie}})).status,200);
    const logged=await f.request('/auth/login',{method:'POST',body:JSON.stringify({username:'wz9946',password:'owner-fixture-password'})});
    assert.match(logged.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);
    for(let i=0;i<5;i++)assert.equal((await f.request('/auth/login',{method:'POST',body:JSON.stringify({username:'nobody',password:'wrong'})})).status,401);
    assert.equal((await f.request('/auth/login',{method:'POST',body:'{}'})).status,429);
  }finally{await f.close();}
});

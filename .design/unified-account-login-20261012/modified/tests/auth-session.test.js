import test from 'node:test';
import assert from 'node:assert/strict';
import {logoutCurrentAccount,authRecoveryMessage,showAuthScreen} from '../src/auth-session.js';
test('logout ends current account only and calls login transition',async()=>{
 const calls=[];let returned=false;
 await logoutCurrentAccount({fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true};},onLoggedOut:()=>returned=true});
 assert.deepEqual(calls,[{url:'/auth/logout',options:{method:'POST',credentials:'same-origin'}}]);assert.equal(returned,true);
});
test('logout failure leaves current session intact',async()=>{
 await assert.rejects(logoutCurrentAccount({fetchImpl:async()=>({ok:false})}),/退出当前账号失败/);
});
function elements(){return Object.fromEntries(['locked','workspace','loginForm','loginTitle','loginIntro','authError','authRetry'].map(id=>[id,{hidden:false,textContent:''}]))}
test('all surfaces show password form on expiry and never demand Telegram reopening',()=>{
 const e=elements();showAuthScreen(e,{status:401});
 assert.equal(e.workspace.hidden,true);assert.equal(e.loginForm.hidden,false);assert.equal(e.locked.hidden,false);
 assert.equal(e.authRetry.hidden,true);assert.equal(e.loginTitle.textContent,'登录管理后台');
 assert.doesNotMatch(authRecoveryMessage({status:401}),/Telegram|重新打开/);
});
test('network errors allow retry without hiding account login',()=>{
 const e=elements();showAuthScreen(e,new Error('网络中断'));
 assert.equal(e.authRetry.hidden,false);assert.equal(e.loginForm.hidden,false);assert.match(e.authError.textContent,/网络中断/);
});

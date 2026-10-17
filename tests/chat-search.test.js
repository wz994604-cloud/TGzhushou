import test from 'node:test';
import assert from 'node:assert/strict';
import {registerChatRoutes} from '../server/chat.js';
test('message search is bounded to selected bot and chat and keeps pagination',async()=>{
 const routes=new Map();let query,args;
 const db={prepare(sql){query=sql;return {all:async(...values)=>{args=values;return [{id:8,text:'match'}];}};}};
 const app={get:(path,handler)=>routes.set(path,handler),post:()=>{}};
 registerChatRoutes(app,{db,publisherFor:async()=>({id:'1001'}),scheduler:{},configKey:'',publicUrl:''});
 let result;
 await routes.get('/api/chat/conversations/:chatId/messages')({params:{chatId:'2300001'},query:{q:'hello',before:'9'},get:()=>''},{json:value=>{result=value;}},error=>{throw error;});
 assert.match(query,/text LIKE/);assert.deepEqual(args,['1001','2300001',9,9,'%hello%',50]);assert.equal(result.rows[0].id,8);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {accountManagementHtml,publisherManagementHtml} from '../src/management-view.js';

test('account manager renders human readable grants, status and protected owner',()=>{
  const html=accountManagementHtml([
    {username:'wz9946',enabled:true,publisherIds:undefined},
    {username:'operator',enabled:false,publisherIds:['1001','gone']}
  ],[{id:'1001',username:'news_bot'}]);
  assert.match(html,/主账号/);
  assert.match(html,/@news_bot、已移除机器人 gone/);
  assert.match(html,/data-account-action="toggle" data-enabled="true"/);
  assert.doesNotMatch(html,/data-username="wz9946"/);
});

test('management rows escape user controlled labels and expose robot lifecycle actions',()=>{
  const html=publisherManagementHtml([{id:'1001',username:'<img src=x>',status:'DISABLED'}],'1001');
  assert.match(html,/@&lt;img src=x&gt;/);
  assert.doesNotMatch(html,/<img/);
  assert.match(html,/data-robot-action="verify"/);
  assert.match(html,/data-robot-action="toggle" data-enabled="true"/);
  assert.match(html,/data-bound-bot="1001" disabled/);
});

// Test-process-only transport. Production code never imports this module.
const realFetch=globalThis.fetch;
globalThis.fetch=async(url,options={})=>{
  const address=String(url);
  if(!address.startsWith('https://api.telegram.org/'))return realFetch(url,options);
  const method=address.split('/').at(-1), body=typeof options.body==='string'?JSON.parse(options.body):{};
  let result;
  if(method==='getMe') result={id:address.includes('bot111111:')?111111:222222,is_bot:true,username:'local_test_publisher'};
  else if(method==='getChat') result={id:body.chat_id==='@test_channel'?-1001:-1002,title:body.chat_id==='@test_channel'?'测试频道':'测试群',type:body.chat_id==='@test_channel'?'channel':'supergroup'};
  else if(method==='getChatMember') result={status:'administrator',can_post_messages:true};
  else if(method==='getStickerSet') result={title:'测试表情包',stickers:[{custom_emoji_id:'5432101234567890123',emoji:'🔥'},{custom_emoji_id:'5432101234567890124',emoji:'💎'}]};
  else if(method==='sendMessage') result={message_id:456,entities:body.entities||[],reply_markup:body.reply_markup};
  else if(method==='sendPhoto') result={message_id:457,caption_entities:JSON.parse(options.body.get('caption_entities')||'[]'),reply_markup:JSON.parse(options.body.get('reply_markup')||'null')};
  else if(['setChatMenuButton','setWebhook'].includes(method)) result=true;
  else throw new Error(`Unexpected mock Telegram method ${method}`);
  return Response.json({ok:true,result});
};

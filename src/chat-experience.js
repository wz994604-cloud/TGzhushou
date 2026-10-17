const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const scopeKey = (account,bot,chat='') => ['tgzhushou','private',account,bot,chat].map(encodeURIComponent).join(':');
export function selectConversations(rows,prefs={},filter='all') {
 return rows.filter(row=>{
  const pref=prefs[row.chat_id]||{},archived=pref.archivedAt && row.last_message_at<=pref.archivedAt;
  return filter==='archived'?archived:!archived&&(filter!=='unread'||row.unread_count||pref.unread);
 }).sort((a,b)=>Number(Boolean(prefs[b.chat_id]?.pinned))-Number(Boolean(prefs[a.chat_id]?.pinned))||b.last_message_at-a.last_message_at);
}
export function scrollPosition(before,newHeight,mode='update') {
 if(mode==='older')return before.top+newHeight-before.height;
 if(mode==='latest'||before.height-before.top-before.client<70)return Math.max(0,newHeight-before.client);
 return before.top;
}
export function safeMessageHtml(text,entities=[]) {
 text=String(text||'');const valid=entities.filter(e=>Number.isInteger(e.offset)&&Number.isInteger(e.length)&&e.offset>=0&&e.length>0&&e.offset+e.length<=text.length);
 const points=[...new Set([0,text.length,...valid.flatMap(e=>[e.offset,e.offset+e.length])])].sort((a,b)=>a-b);
 return points.slice(0,-1).map((start,i)=>{
  const end=points[i+1];let s=escape(text.slice(start,end)).replace(/\n/g,'<br>');
  for(const e of valid.filter(e=>e.offset<=start&&e.offset+e.length>=end).reverse()){
   const tag={bold:'strong',italic:'em',underline:'u',strikethrough:'s',code:'code',pre:'code'}[e.type];
   if(tag)s=`<${tag}>${s}</${tag}>`;
   const url=e.type==='text_link'?e.url:e.type==='url'?text.slice(e.offset,e.offset+e.length):null;
   if(url&&/^(https?:\/\/|tg:\/\/)/i.test(url))s=`<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${s}</a>`;
  }return s;
 }).join('');
}

// A refresh failure after Telegram accepted a message must never invite a resend.
export async function sendChatMessage({send,onSent,refresh}) {
 const message=await send();
 await onSent(message);
 try { await refresh(); return {message}; }
 catch(refreshError) { return {message,refreshError}; }
}

import { installLinkEditor } from './link-editor.js';

export function installSentEditor({Quill,api,esc,toast,action,image,hydrateEmojiImages}) {
  const statusLabels={SUCCESS:'成功',FAILED:'失败',UNKNOWN:'待核实',PENDING:'排队中',SENDING:'发送中',EDITED:'已编辑',DELETED:'已删除'};
  const dialog=document.createElement('dialog');dialog.id='sentDialog';
  dialog.innerHTML=`<div class="section-title"><h3>已发消息管理</h3><button id="closeSent" class="quiet">关闭</button></div><p class="hint">仅修改选中的原消息，不影响活动模板或定时任务。批量编辑会用下面内容覆盖所选消息。</p><button id="selectSent" class="quiet">全选本次成功对象</button><button id="clearSent" class="quiet">清空选择</button><p id="sentProgress" role="status" class="sent-status"></p><div id="sentRecipients" class="user-scroll"></div><details id="sentContent"><summary>编辑已发内容</summary><p class="hint">先点某条记录的「载入内容」，再修改文案、超链、专属表情和按钮。</p><div id="sentToolbar"><button class="ql-bold" title="加粗"></button><button class="ql-italic" title="斜体"></button><button class="ql-underline" title="下划线"></button><button class="ql-clean" title="清除格式"></button></div><div id="sentBody"></div><div class="editor-footer"><button id="sentBodyEmoji" class="quiet" type="button">✦ 专属表情</button><button id="sentEditLink" class="quiet" type="button">添加 / 编辑链接</button></div><details id="sentEmojiPicker"><summary>表情包 <span id="sentEmojiTitle" class="hint">添加或切换</span></summary><div class="pack-controls"><div class="inline"><input id="sentPack" placeholder="https://t.me/addemoji/表情包名"><button id="sentLoadPack" class="primary" type="button">加载</button></div><div id="sentSavedPacks" class="pack-tabs"></div></div><div id="sentEmojiGrid"></div></details><div id="sentButtons"></div><button id="sentAddButton" class="quiet" type="button">＋ 添加按钮</button><label id="sentPhotoLabel">替换原图片 <span id="sentPhotoHint" class="muted">原消息没有图片</span><input id="sentPhoto" type="file" accept="image/jpeg,image/png,image/webp" disabled></label></details><div class="wrap-actions"><button id="applySent" class="quiet">更新所选消息</button><button id="deleteSent" class="quiet danger-text">删除所选消息</button></div>`;
  document.body.append(dialog);
  const $=id=>dialog.querySelector('#'+id), editor=new Quill('#sentBody',{theme:'snow',modules:{toolbar:'#sentToolbar'},formats:['bold','italic','underline','link','customEmoji']});
  installLinkEditor(Quill,editor,{trigger:$('sentEditLink'),dialogId:'sentLinkDialog',idPrefix:'sent-'});
  let kind,rows=[],selected=new Set(),buttons=[],loaded=false,running=false,originalMediaId=null,pickerTarget=null,lastRange=null,currentPack=null,savedPacks=[];
  function renderButtons(){
    $('sentButtons').innerHTML=buttons.map((b,i)=>`<div class="button-editor" data-sent-button="${i}"><div class="section-title"><strong>按钮 ${i+1}</strong><button data-remove-sent-button="${i}" class="quiet danger-text" type="button">删除</button></div><label>按钮文字<input data-sent-button-field="text" value="${esc(b.text||'')}" maxlength="64" placeholder="留空 = 仅显示专属表情"></label><label>跳转链接<input data-sent-button-field="url" value="${esc(b.url||'')}" placeholder="https://t.me/…"></label><div class="grid"><label>颜色<select data-sent-button-field="style">${[['default','默认'],['primary','蓝色'],['success','绿色'],['danger','红色']].map(([v,t])=>`<option value="${v}" ${b.style===v?'selected':''}>${t}</option>`).join('')}</select></label><label>行号<input data-sent-button-field="row" type="number" min="1" max="12" value="${Number(b.row||0)+1}"></label></div><button data-sent-emoji="${i}" class="quiet" type="button">${esc(b.iconAlt||'✦')} ${b.iconId?'更换专属表情':'选择专属表情'}</button>${b.iconId?`<button data-clear-sent-emoji="${i}" class="quiet" type="button">移除表情</button>`:''}</div>`).join('');
  }
  editor.on('selection-change',range=>{if(range)lastRange={...range};});
  $('sentEmojiGrid').onclick=e=>{const id=e.target.closest('[data-sent-sticker]')?.dataset.sentSticker;if(!id||!currentPack)return;const sticker=currentPack.stickers.find(item=>item.id===id);if(sticker)chooseEmoji(sticker);};
  $('sentSavedPacks').onclick=e=>{if(e.target.dataset.sentRecent){const items=recent();if(items.length)renderPack({title:'最近使用',stickers:items});return;}const i=e.target.dataset.sentPackIndex;if(i!==undefined)renderPack(savedPacks[Number(i)]);};
  $('sentLoadPack').onclick=e=>action(async()=>{const key=$('sentPack').value.trim();const pack=await api('/sticker-packs','POST',{pack:key});renderPack(pack);$('sentPack').blur();},e.currentTarget);
  $('sentBodyEmoji').onclick=()=>{lastRange=editor.getSelection()||lastRange;openEmoji('body');};
  $('sentButtons').oninput=e=>{const wrap=e.target.closest('[data-sent-button]');if(!wrap||!e.target.dataset.sentButtonField)return;const i=Number(wrap.dataset.sentButton),field=e.target.dataset.sentButtonField;buttons[i][field]=field==='row'?Number(e.target.value)-1:e.target.value;};
  $('sentButtons').onclick=e=>{const remove=e.target.dataset.removeSentButton;if(remove!==undefined){buttons.splice(Number(remove),1);renderButtons();return;}const clear=e.target.dataset.clearSentEmoji;if(clear!==undefined){Object.assign(buttons[Number(clear)],{iconId:'',iconAlt:'',iconThumbId:''});renderButtons();return;}const emoji=e.target.dataset.sentEmoji;if(emoji!==undefined)openEmoji(Number(emoji));};
  $('sentAddButton').onclick=()=>{if(buttons.length>=12)return toast('最多添加 12 个按钮',true);buttons.push({text:'立即进入',url:'https://t.me/',style:'default',row:buttons.length,iconId:'',iconAlt:'',iconThumbId:''});renderButtons();};
  function rememberRecent(sticker){try{const old=JSON.parse(localStorage.getItem('tgzhushou:recent-emojis:v1')||'[]');localStorage.setItem('tgzhushou:recent-emojis:v1',JSON.stringify([sticker,...old.filter(item=>item.id!==sticker.id)].slice(0,30)));}catch{}}
  function recent(){try{const value=JSON.parse(localStorage.getItem('tgzhushou:recent-emojis:v1')||'[]');return Array.isArray(value)?value:[];}catch{return [];}}
  function renderSavedPacks(){ $('sentSavedPacks').innerHTML='<button class="quiet pack-tab" data-sent-recent="1" type="button">最近使用</button>'+savedPacks.map((p,i)=>`<button class="quiet pack-tab" data-sent-pack-index="${i}" type="button">${esc(p.title)}</button>`).join(''); }
  function renderPack(pack){
    currentPack=pack;$('sentEmojiTitle').textContent=`${pack.title} · ${pack.stickers.length} 个`;$('sentEmojiPicker').open=false;$('sentEmojiGrid').replaceChildren();
    for(const sticker of pack.stickers){
      const button=document.createElement('button');button.type='button';button.className='emoji-choice';button.dataset.sentSticker=sticker.id;button.textContent=sticker.alt;button.title=sticker.id;$('sentEmojiGrid').append(button);
      if(image&&(sticker.thumbnailId||sticker.id)) image('/sticker-image?'+(sticker.thumbnailId?'id='+encodeURIComponent(sticker.thumbnailId)+'&':'')+'emoji='+encodeURIComponent(sticker.id)).then(url=>{if(button.isConnected){const img=document.createElement('img');img.alt=sticker.alt;img.src=url;button.replaceChildren(img);}}).catch(()=>{});
    }
  }
  async function loadPacks(){const result=await api('/sticker-packs/saved');savedPacks=result.packs||[];renderSavedPacks();if(!currentPack&&recent().length)renderPack({title:'最近使用',stickers:recent()});}
  function openEmoji(target){pickerTarget=target;loadPacks().catch(error=>toast(error.message,true));$('sentEmojiPicker').open=true;}
  function chooseEmoji(sticker){
    rememberRecent(sticker);
    if(pickerTarget==='body'){
      editor.enable(true);const range=lastRange||editor.getSelection()||{index:editor.getLength()-1,length:0};const at=Math.min(range.index,editor.getLength()-1);editor.insertEmbed(at,'customEmoji',{id:sticker.id,alt:sticker.alt,thumbId:sticker.thumbnailId||''},'user');editor.setSelection(at+1,0,'silent');lastRange={index:at+1,length:0};hydrateEmojiImages?.(editor.root);
    } else if(typeof pickerTarget==='number'&&buttons[pickerTarget]){Object.assign(buttons[pickerTarget],{iconId:sticker.id,iconAlt:sticker.alt,iconThumbId:sticker.thumbnailId||''});renderButtons();}
    $('sentEmojiPicker').open=false;
  }
  function render(){
    $('sentRecipients').innerHTML=rows.map(r=>{const state=statusLabels[r.result||r.last_action||r.status]||r.result||r.last_action||r.status;return `<div class="list-row"><label class="check"><input type="checkbox" data-sent-id="${r.id}" ${selected.has(r.id)?'checked':''} ${r.status==='SUCCESS'&&!r.deleted?'':'disabled'}><span>${esc(r.title||r.display_name||r.telegram_id)}<small>${esc(r.chat_id||r.telegram_id)}${r.telegram_message_id?' · 消息 ID '+esc(r.telegram_message_id):''} · ${esc(state)} ${esc(r.error_text||r.last_error||'')}</small></span></label>${r.status==='SUCCESS'&&!r.deleted?`<button class="quiet" data-load-sent="${r.id}">载入内容</button>`:''}</div>`;}).join('');
  }
  $('sentRecipients').onchange=e=>{const id=Number(e.target.dataset.sentId);if(id)e.target.checked?selected.add(id):selected.delete(id);};
  $('sentRecipients').onclick=e=>action(async()=>{
    if(running||!e.target.dataset.loadSent)return;
    const loadButton=e.target.closest('[data-load-sent]');
    const item=await api(`/sent/${kind}/${loadButton.dataset.loadSent}`);
    $('sentPhoto').value='';originalMediaId=item.media_id||null;$('sentPhoto').disabled=!originalMediaId || (kind==='chat'&&item.media_kind!=='photo');$('sentPhotoHint').textContent=$('sentPhoto').disabled?'当前消息不支持替换图片':'可替换原图片';editor.setContents({ops:JSON.parse(item.delta_json)});hydrateEmojiImages?.(editor.root);buttons=JSON.parse(item.buttons_json||'[]').map((b,i)=>({...b,row:Number.isInteger(b.row)?b.row:i,iconThumbId:b.iconThumbId||''}));renderButtons();loaded=true;
    $('sentContent').open=true;editor.blur();$('sentProgress').textContent='已载入内容，可以开始编辑。';loadButton.textContent='已载入';loadButton.classList.add('is-loaded');
  },e.target);
  $('selectSent').onclick=()=>{if(!running){selected=new Set(rows.filter(r=>r.status==='SUCCESS'&&!r.deleted).map(r=>r.id));render();}};
  $('clearSent').onclick=()=>{if(!running){selected.clear();render();}};
  $('closeSent').onclick=()=>{if(!running)dialog.close();};dialog.addEventListener('cancel',e=>{if(running)e.preventDefault();});
  async function apply(operation){
    if(running)return;
    if(!selected.size)throw Error('请选择至少一条成功消息');
    if(operation==='edit'&&!loaded)throw Error('请先载入一条消息并编辑内容');
    const ids=[...selected],payload={action:operation,...(operation==='edit'?{delta:editor.getContents(),buttons:structuredClone(buttons)}:{})};
    if(!confirm(`确认${operation==='edit'?'更新':'删除'}所选 ${ids.length} 条已发消息？${operation==='delete'?'删除后不恢复。':''}`))return;
    running=true;dialog.querySelectorAll('button,input,select').forEach(n=>n.disabled=true);editor.enable(false);
    let ok=0,failed=0;
    try { if(operation==='edit'&&$('sentPhoto').files[0]){const form=new FormData();form.set('image',$('sentPhoto').files[0]);const media=await api('/media','POST',form);payload.mediaId=media.id;}
for(const id of ids){const row=rows.find(r=>r.id===id);try{const result=await api(`/sent/${kind}/${id}`,'POST',payload);row.result=result.state==='DELETED'?'已删除':'已编辑';row.error_text='';row.deleted=result.state==='DELETED';selected.delete(id);ok++;}catch(error){row.result='操作失败';row.error_text=error.message;failed++;} $('sentProgress').textContent=`已处理 ${ok+failed}/${ids.length} · 成功 ${ok} · 失败 ${failed}`;}}
    finally{running=false;dialog.querySelectorAll('button,input,select').forEach(n=>n.disabled=false);editor.enable(true);render();}
  }
  $('applySent').onclick=e=>action(()=>apply('edit'),e.currentTarget);$('deleteSent').onclick=e=>action(()=>apply('delete'),e.currentTarget);
  return async(type,id)=>{
    kind=type;$('sentPhoto').value='';originalMediaId=null;$('sentPhoto').disabled=true;selected.clear();loaded=false;editor.setText('');buttons=[];renderButtons();$('sentContent').open=false;$('sentEmojiPicker').open=false;$('sentProgress').textContent='';
    const record=type==='chat'?{deliveries:[await api(`/sent/chat/${id}`)]}:await api(`/${type}/${id}`);rows=record.deliveries;
    // Read persisted outcomes, including edits/deletes from a previous session.

    render();dialog.showModal();editor.blur();
  };
}

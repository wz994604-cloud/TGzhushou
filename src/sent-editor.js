export function installSentEditor({Quill,api,esc,toast,action}) {
  const statusLabels={SUCCESS:'成功',FAILED:'失败',UNKNOWN:'待核实',PENDING:'排队中',SENDING:'发送中',EDITED:'已编辑',DELETED:'已删除'};
  const dialog=document.createElement('dialog');dialog.id='sentDialog';
  dialog.innerHTML=`<div class="section-title"><h3>已发消息管理</h3><button id="closeSent" class="quiet">关闭</button></div><p class="hint">仅修改选中的原消息，不影响活动模板或定时任务。批量编辑会用下面内容覆盖所选消息。</p><button id="selectSent" class="quiet">全选本次成功对象</button><button id="clearSent" class="quiet">清空选择</button><p id="sentProgress" role="status" class="sent-status"></p><div id="sentRecipients" class="user-scroll"></div><details id="sentContent"><summary>编辑已发内容</summary><p class="hint">先点某条记录的「载入内容」，再修改。保留原消息中的自定义表情及格式。</p><div id="sentToolbar"><button class="ql-bold"></button><button class="ql-italic"></button><button class="ql-underline"></button></div><div id="sentBody"></div><div id="sentButtons"></div><label>替换或添加图片（留空保留原图）<input id="sentPhoto" type="file" accept="image/jpeg,image/png,image/webp"></label></details><div class="wrap-actions"><button id="applySent" class="quiet">更新所选消息</button><button id="deleteSent" class="quiet danger-text">删除所选消息</button></div>`;
  document.body.append(dialog);
  const $=id=>dialog.querySelector('#'+id), editor=new Quill('#sentBody',{theme:'snow',modules:{toolbar:'#sentToolbar'},formats:['bold','italic','underline','link','customEmoji']});
  let kind,rows=[],selected=new Set(),buttons=[],loaded=false,running=false;
  function render(){
    $('sentRecipients').innerHTML=rows.map(r=>{const state=statusLabels[r.result||r.last_action||r.status]||r.result||r.last_action||r.status;return `<div class="list-row"><label class="check"><input type="checkbox" data-sent-id="${r.id}" ${selected.has(r.id)?'checked':''} ${r.status==='SUCCESS'&&!r.deleted?'':'disabled'}><span>${esc(r.title||r.display_name||r.telegram_id)}<small>${esc(r.chat_id||r.telegram_id)}${r.telegram_message_id?' · 消息 ID '+esc(r.telegram_message_id):''} · ${esc(state)} ${esc(r.error_text||r.last_error||'')}</small></span></label>${r.status==='SUCCESS'&&!r.deleted?`<button class="quiet" data-load-sent="${r.id}">载入内容</button>`:''}</div>`;}).join('');
  }
  $('sentRecipients').onchange=e=>{const id=Number(e.target.dataset.sentId);if(id)e.target.checked?selected.add(id):selected.delete(id);};
  $('sentRecipients').onclick=e=>action(async()=>{
    if(running||!e.target.dataset.loadSent)return;
    const loadButton=e.target.closest('[data-load-sent]');
    const item=await api(`/sent/${kind}/${loadButton.dataset.loadSent}`);
    $('sentPhoto').value='';editor.setContents({ops:JSON.parse(item.delta_json)});buttons=JSON.parse(item.buttons_json);loaded=true;
    $('sentButtons').innerHTML=buttons.map((b,i)=>`<label>按钮 ${i+1}<input data-button="${i}" data-field="text" value="${esc(b.text)}"><input data-button="${i}" data-field="url" value="${esc(b.url)}"></label>`).join('');
    $('sentContent').open=true;editor.blur();$('sentProgress').textContent='已载入内容，可以开始编辑。';loadButton.textContent='已载入';loadButton.classList.add('is-loaded');
  },e.target);
  $('sentButtons').oninput=e=>{if(e.target.dataset.button!==undefined)buttons[Number(e.target.dataset.button)][e.target.dataset.field]=e.target.value;};
  $('selectSent').onclick=()=>{if(!running){selected=new Set(rows.filter(r=>r.status==='SUCCESS'&&!r.deleted).map(r=>r.id));render();}};
  $('clearSent').onclick=()=>{if(!running){selected.clear();render();}};
  $('closeSent').onclick=()=>{if(!running)dialog.close();};dialog.addEventListener('cancel',e=>{if(running)e.preventDefault();});
  async function apply(operation){
    if(running)return;
    if(!selected.size)throw Error('请选择至少一条成功消息');
    if(operation==='edit'&&!loaded)throw Error('请先载入一条消息并编辑内容');
    const ids=[...selected],payload={action:operation,...(operation==='edit'?{delta:editor.getContents(),buttons:structuredClone(buttons)}:{})};
    if(!confirm(`确认${operation==='edit'?'更新':'删除'}所选 ${ids.length} 条已发消息？${operation==='delete'?'删除后不恢复。':''}`))return;
    running=true;dialog.querySelectorAll('button,input').forEach(n=>n.disabled=true);editor.enable(false);
    let ok=0,failed=0;
    try { if(operation==='edit'&&$('sentPhoto').files[0]){const form=new FormData();form.set('image',$('sentPhoto').files[0]);const media=await api('/media','POST',form);payload.mediaId=media.id;}
for(const id of ids){const row=rows.find(r=>r.id===id);try{const result=await api(`/sent/${kind}/${id}`,'POST',payload);row.result=result.state==='DELETED'?'已删除':'已编辑';row.error_text='';row.deleted=result.state==='DELETED';selected.delete(id);ok++;}catch(error){row.result='操作失败';row.error_text=error.message;failed++;} $('sentProgress').textContent=`已处理 ${ok+failed}/${ids.length} · 成功 ${ok} · 失败 ${failed}`;}}
    finally{running=false;dialog.querySelectorAll('button,input').forEach(n=>n.disabled=false);editor.enable(true);render();}
  }
  $('applySent').onclick=e=>action(()=>apply('edit'),e.currentTarget);$('deleteSent').onclick=e=>action(()=>apply('delete'),e.currentTarget);
  return async(type,id)=>{
    kind=type;$('sentPhoto').value='';selected.clear();loaded=false;editor.setText('');buttons=[];$('sentButtons').replaceChildren();$('sentContent').open=false;$('sentProgress').textContent='';
    const record=await api(`/${type}/${id}`);rows=record.deliveries;
    // Read persisted outcomes, including edits/deletes from a previous session.

    render();dialog.showModal();editor.blur();
  };
}

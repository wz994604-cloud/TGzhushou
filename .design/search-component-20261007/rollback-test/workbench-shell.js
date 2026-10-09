// Presentation only. Existing form nodes keep their IDs, values and API handlers.
const $ = id => document.getElementById(id);
const pages = { chat:'聊天', editor:'编写活动', assets:'素材管理', players:'联系人 / 用户', tasks:'自动化任务', logs:'发布记录', settings:'系统设置' };
const paths = {
  chat:'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1 1v-9a9 9 0 0 1 18 0Z',
  editor:'m15 4 5 5M4 20l5-1L21 7l-5-5L4 14v6Z',
  players:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.9M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  tasks:'M9 5H5v16h14V5h-4M9 3h6v4H9V3Zm-2 9 2 2 4-4m2 7h2',
  logs:'M3 12a9 9 0 1 0 3-6M3 3v5h5m4-1v6l4 2',
  settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm-2-6h4l1 3 3 1 3 2-1 4 1 4-3 2-3 1-1 3h-4l-1-3-3-1-3-2 1-4-1-4 3-2 3-1 1-3Z',
  assets:'M4 5a2 2 0 0 1 2-2h5l2 2h5a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Zm4 7 2-2 3 3 2-2 3 3',
  search:'m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  filter:'M4 5h16l-6.5 7.2V18l-3 1v-6.8L4 5Z',
  back:'m15 5-7 7 7 7', close:'m6 6 12 12M6 18 18 6',
  info:'M12 11v6m0-10v1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  plane:'m22 2-7 20-4-9-9-4 20-7ZM11 13 22 2',
  emoji:'M8 14s1 3 4 3 4-3 4-3M8 8v2m8-2v2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  link:'m10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 1 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',
  attach:'m9 15 8-8a3 3 0 0 0-4-4L3 13a5 5 0 0 0 7 7L21 9',
  plus:'M12 5v14M5 12h14', menu:'M4 6h16M4 12h16M4 18h16', bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4', moon:'M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z', phone:'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z', video:'M15 10 21 6v12l-6-4M3 6h12v12H3z', grid:'M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z'
};
export function icon(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${`<path d="${paths[name] || paths.grid}"/>`}</svg>`; }
function node(tag, className, html='') { const el=document.createElement(tag); el.className=className; el.innerHTML=html; return el; }
function button(label, glyph, handler) { const b=node('button','icon-button',icon(glyph)); b.type='button'; b.title=label; b.setAttribute('aria-label',label); b.onclick=handler; return b; }

export function mountWorkbench({ mini, navigate, backChat }) {
  const workspace=$('workspace');
  const sections=[...workspace.querySelectorAll(':scope > .page')];
  const rail=workspace.querySelector('.app-rail');
  const publisher=workspace.querySelector('.publisher-switch');
  workspace.querySelector(':scope > nav').remove();
  const content=node('div',mini?'mini-content':'desktop-content');
  const viewport=node('div',mini?'mini-viewport':'desktop-viewport');
  viewport.append(...sections); content.append(viewport);
  workspace.className=mini?'mini-shell':'desktop-shell';
  document.documentElement.dataset.surface=mini?'mini':'web';
  let title, back, details, step=0, stepPanels=[], stepButtons=[], settingButtons=[];
  let settingsOpen=false,editorActions;
  const setStep=index=>{
    step=Math.max(0,Math.min(4,index));
    stepPanels.forEach((panel,i)=>panel.hidden=i!==step);
    stepButtons.forEach((b,i)=>{b.classList.toggle('active',i===step);b.setAttribute('aria-current',i===step?'step':'false');});
    if($('miniPrevious')) { $('miniPrevious').disabled=step===0; $('miniNext').hidden=step===4; }
    if(step===4) $('previewPanel').open=true;
    viewport.scrollTop=0;
  };

  if(mini) {
    rail.remove();
    const top=node('header','mini-topbar');
    back=button('返回','back',()=>{
      if(workspace.dataset.page==='chat'&&workspace.dataset.chatOpen==='true') backChat();
      else if(workspace.dataset.page==='settings'&&settingsOpen) showSettings(null);
      else if(workspace.dataset.page==='editor'&&step>0) setStep(step-1);
      else navigate(workspace.dataset.page==='logs'?'tasks':'chat');
    });
    title=node('strong','mini-title','聊天');
    publisher.querySelector('label').classList.add('sr-only');
    top.append(back,title,publisher); workspace.replaceChildren(top,content);
    const nav=node('nav','mini-nav'); nav.setAttribute('aria-label','小程序导航');
    for(const [id,label] of [['chat','聊天'],['editor','编写'],['assets','素材'],['players','用户'],['tasks','任务'],['settings','设置']]) {
      const b=node('button','',`${icon(id)}<span>${label}</span>`); b.type='button'; b.dataset.tab=id; b.onclick=()=>navigate(id); nav.append(b);
    }
    workspace.append(nav);
    $('tasks').querySelector('.section-title').append(Object.assign(node('button','secondary','发布记录'),{onclick:()=>navigate('logs')}));
    $('logs').querySelector('.section-title').prepend(button('返回任务','back',()=>navigate('tasks')));
    $('chat').querySelector('.chat-shell').className='mini-chat';
  } else {
    rail.querySelector('.rail-menu').remove();
    rail.querySelector('.rail-brand-mark').innerHTML=icon('plane');
    const railNav=rail.querySelector('.rail-nav');
    railNav.prepend(node('div','rail-group-label','工作空间'));
    railNav.querySelector('[data-rail-tab="tasks"]').before(node('div','rail-group-label','发布与管理'));
    railNav.querySelector('[data-rail-tab="assets"]').before(node('div','rail-group-label','内容管理'));
    railNav.querySelectorAll('button').forEach(b=>{
      b.querySelector('.nav-glyph').innerHTML=icon(b.dataset.railTab||'grid');
      if(b.dataset.railTab) b.onclick=()=>{navigate(b.dataset.railTab);workspace.classList.remove('navigation-open');toggle.setAttribute('aria-expanded','false');};
      else b.disabled=true;
    });
    const top=node('header','desktop-topbar');
    const toggle=button('打开导航','menu',()=>{workspace.classList.toggle('navigation-open');toggle.setAttribute('aria-expanded',String(workspace.classList.contains('navigation-open')));}); toggle.classList.add('web-menu');toggle.setAttribute('aria-expanded','false');
    const search=node('form','workspace-search',`<span class="workspace-search-glow" aria-hidden="true"></span><span class="workspace-search-icon">${icon('search')}</span><input type="search" aria-label="搜索会话" placeholder="搜索…"><button class="workspace-search-filter" type="button" aria-label="筛选会话" title="筛选会话（即将开放）" disabled>${icon('filter')}</button>`);
    search.onsubmit=event=>{event.preventDefault();$('chatSearch').value=search.querySelector('input').value;navigate('chat');$('chatSearch').dispatchEvent(new Event('input',{bubbles:true}));};
    publisher.querySelector('label').classList.add('sr-only');
    const topActions=node('div','topbar-actions');
    for(const [label,glyph] of [['新建','plus'],['通知','bell'],['外观','moon']]) { const b=button(label,glyph,null); b.disabled=true; b.dataset.placeholder='soon'; b.title=`${label}｜即将开放`; topActions.append(b); }
    const account=node('button','topbar-account','管理账号'); account.type='button'; account.onclick=()=>navigate('settings');
    rail.querySelector('#railBots').append(publisher);
    top.append(toggle,search,topActions,account); content.prepend(top); workspace.replaceChildren(rail,content);
    details=node('aside','chat-details','<div class="details-heading"><div><span class="details-kicker">当前会话</span><h3>会话资料</h3></div></div><div class="details-profile"><div class="details-avatar">?</div><h3 class="details-title">请选择会话</h3><p class="details-handle">未选择会话</p><span class="details-status is-placeholder">状态未接入</span></div><div class="details-actions"><button class="primary" type="button" data-details-send>发送消息</button><button class="secondary is-placeholder" type="button" disabled>加标签</button><button class="secondary is-placeholder" type="button" disabled>备注</button><button class="secondary is-placeholder" type="button" disabled>更多</button></div><section class="details-card"><h4>用户信息</h4><dl></dl></section><section class="details-card details-tags"><h4>标签</h4><span class="empty-state">即将开放</span></section><section class="details-card details-media"><h4>媒体</h4><span class="empty-state">即将开放</span></section>');
    details.setAttribute('aria-label','会话资料');
    const closeDetails=()=>{workspace.classList.remove('details-open');$('showChatDetails').setAttribute('aria-expanded','false');details.removeAttribute('aria-modal');details.removeAttribute('role');$('showChatDetails').focus();};
    const backdrop=button('关闭会话资料','close',closeDetails);backdrop.className='chat-details-backdrop';backdrop.tabIndex=-1;$('chat').querySelector('.chat-shell').append(backdrop);
    const close=button('关闭会话资料','close',closeDetails); details.querySelector('.details-heading').append(close);
    details.querySelector('[data-details-send]').onclick=()=>{const editorEl=$('chatInput')?.querySelector('.ql-editor');editorEl?.focus();};
    $('chat').querySelector('.chat-shell').append(details);
    const headerActions=node('div','chat-header-actions');
    for(const [label,glyph] of [['搜索消息','search'],['拨打电话','phone'],['视频通话','video'],['更多操作','menu']]) { const b=button(label,glyph,null); b.disabled=true; b.dataset.placeholder='soon'; headerActions.append(b); }
    const info=button('查看会话资料','info',()=>{workspace.classList.toggle('details-open');const open=workspace.classList.contains('details-open');info.setAttribute('aria-expanded',String(open));if(open){details.setAttribute('role','dialog');details.setAttribute('aria-modal','true');close.focus();}else closeDetails();});info.id='showChatDetails';info.setAttribute('aria-expanded','false');headerActions.append(info);$('chatHeader').append(headerActions);
    workspace.addEventListener('keydown',e=>{
      if(e.key==='Escape'){
        if(workspace.classList.contains('details-open')){e.preventDefault();closeDetails();}
        else if(workspace.classList.contains('navigation-open')){workspace.classList.remove('navigation-open');toggle.setAttribute('aria-expanded','false');toggle.focus();}
      } else if(e.key==='Tab'&&workspace.classList.contains('details-open')&&getComputedStyle(details).position==='absolute'){
        const focusable=[...details.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled)')].filter(el=>!el.hidden);
        const first=focusable[0],last=focusable.at(-1);
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
      }
    });
  }

  // Real form controls are moved, never cloned; values and event bindings stay unique.
  const editor=$('editor');
  const cards=[...editor.querySelectorAll(':scope > .card')];
  const [message,buttons,delivery,users,preview]=cards;
  const composeHeading=node('div','compose-heading');$('toggleWriting').before(composeHeading);composeHeading.append(message.querySelector('#composeArea>label'),$('toggleWriting'));
  const media=node('section','card'); media.append(node('h3','','附件与素材'),message.querySelector('.file-label'),$('photoBox'));
  const time=node('section','card');
  const timeHeading=[...delivery.querySelectorAll('h3')][1];
  for(let current=timeHeading;current;) { const next=current.nextSibling;time.append(current);current=next; }
  const actions=editor.querySelector(':scope > .actions');
  if(mini) {
    const steps=node('div','mini-steps');steps.setAttribute('aria-label','编写步骤');
    const body=node('div','mini-editor-steps');
    const labels=['消息','媒体 / 按钮','目标','时间','预览发布'];
    const groups=[[message],[media,buttons],[delivery,users],[time],[preview,actions]];
    groups.forEach((group,i)=>{
      const b=node('button','',`${i+1}. ${labels[i]}`); b.type='button';b.onclick=()=>setStep(i);steps.append(b);stepButtons.push(b);
      const panel=node('section','mini-editor-step');panel.setAttribute('aria-label',labels[i]);panel.append(...group);body.append(panel);stepPanels.push(panel);
    });
    editor.querySelector('.section-title').after(steps,body);
    const footer=node('div','mini-step-actions','<button id="miniPrevious" class="secondary" type="button">上一步</button><button id="miniNext" class="primary" type="button">下一步</button>');body.after(footer);
    $('miniPrevious').onclick=()=>setStep(step-1);$('miniNext').onclick=()=>setStep(step+1);setStep(0);
  } else {
    const workbench=node('div','editor-workbench'), left=node('div','editor-writing'), right=node('aside','editor-publishing');
    preview.open=true;const backdrop=node('div','telegram-preview-body');$('preview').before(backdrop);backdrop.append($('preview'));$('previewPanel').querySelector('summary').textContent='Telegram 消息预览';left.append(message,media,buttons);editorActions=actions;actions.classList.add('desktop-editor-actions');content.append(actions);actions.hidden=true;delivery.append(...time.childNodes);time.remove();right.append(preview,delivery,users);workbench.append(left,right);editor.querySelector('.section-title').after(workbench);
  }

  $('save').textContent='保存草稿';
  const previewAction=node('button','secondary','预览');previewAction.type='button';previewAction.onclick=()=>{if(mini)setStep(4);else{$('previewPanel').open=true;$('previewPanel').scrollIntoView({block:'nearest'});}};actions.prepend(previewAction);
  const assetAction=node('button','quiet','从素材选择');assetAction.type='button';assetAction.onclick=()=>{workspace.dispatchEvent(new CustomEvent('asset-intent',{detail:{source:'editor'}}));navigate('assets');};media.append(assetAction);
  const settings=$('settings'), settingCards=[...settings.querySelectorAll(':scope > .card')];
  const settingNav=node('div',mini?'mini-settings-menu':'settings-categories');settingNav.setAttribute('aria-label','设置分类');
  const settingBody=node('div',mini?'mini-settings-forms':'settings-forms');
  function showSettings(index) {
    settingsOpen=index!==null;
    settings.classList.toggle('settings-form-open',settingsOpen);
    settingCards.forEach((card,i)=>{
      card.classList.toggle('category-inactive',i!==index);
    });
    settingButtons.forEach((b,i)=>{b.classList.toggle('active',i===index);b.setAttribute('aria-pressed',String(i===index));});
    if(mini) settingNav.hidden=settingsOpen;
    viewport.scrollTop=0;
  }
  settingCards.forEach((card,i)=>{
    const b=node('button','',`${icon(i===3?'players':'settings')}<span>${card.querySelector('h3').textContent}</span>`);b.type='button';b.onclick=()=>showSettings(i);settingNav.append(b);settingButtons.push(b);settingBody.append(card);
  });
  const settingsLayout=node('div',mini?'mini-settings':'settings-layout');settingsLayout.append(settingNav,settingBody);settings.append(settingsLayout);showSettings(mini?null:0);
  if(!mini) { const heading=settings.querySelector(':scope > h2');settingNav.prepend(heading,node('p','muted','配置机器人、接口、目标与管理账号。')); }

  for(const [inputId,buttonId] of [['token','savePublisher'],['ffaToken','saveFfaToken']]){const label=$(inputId).parentElement,row=node('div','settings-input-row');label.before(row);row.append(label,$(buttonId));}
  const records=node('div','task-filters');records.setAttribute('aria-label','记录分类');for(const [id,label] of [['runList','群组 / 频道'],['broadcastPanel','用户']]){const b=node('button',id==='runList'?'active':'',label);b.type='button';b.onclick=()=>{records.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));$('runList').hidden=id!=='runList';$('broadcastPanel').hidden=id!=='broadcastPanel';};records.append(b);}$('runList').before(records);$('logs').append($('broadcastPanel'));$('broadcastPanel').open=true;$('broadcastPanel').hidden=true;
  const noTimed=node('p','hint','无定时任务');noTimed.id='noTimedTasks';$('taskList').before(noTimed);
  const players=$('players');$('usersPanel').open=true;$('selectedPanel').open=true;
  const continueWriting=node('button','primary','返回编写活动');continueWriting.type='button';continueWriting.onclick=()=>navigate('editor');$('selectedPanel').append(continueWriting);
  if(!mini) { const userLayout=node('div','users-workbench');userLayout.append($('usersPanel'),$('selectedPanel'));players.querySelector('.section-title').append(players.querySelector('.user-actions'));players.querySelector('.section-title').after(userLayout); }
  const tools=$('chatComposer').querySelector('.chat-tools');
  for(const [id,glyph] of [['chatEmoji','emoji'],['chatLink','link'],['chatAddButton','plus']]) {const b=$(id);b.innerHTML=icon(glyph);b.className='icon-button';}
  const file=$('chatFile'), attachment=file.parentElement;attachment.replaceChildren(node('span','',icon('attach')),file);attachment.setAttribute('aria-label','添加附件');attachment.className='file-button icon-button';
  attachment.tabIndex=0;attachment.setAttribute('role','button');attachment.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();file.click();}};
  if(!mini){
    const more=button('更多工具','menu',()=>{const open=tools.classList.toggle('tools-expanded');more.setAttribute('aria-expanded',String(open));if(open)$('chatLink').focus();});
    more.id='chatToolsMore';more.setAttribute('aria-expanded','false');$('chatLink').before(more);
    const asset=button('从素材选择','assets',()=>{workspace.dispatchEvent(new CustomEvent('asset-intent',{detail:{source:'chat'}}));navigate('assets');});asset.id='chatAsset';$('chatAddButton').after(asset);
  }
  const formatting=node('details','composer-formatting','<summary title="消息格式" aria-label="消息格式">Aa</summary>'); formatting.append($('chatToolbar'));tools.prepend(formatting);
  $('chatBack').innerHTML=icon('back');
  $('chatMessages').innerHTML='<p class="chat-empty">选择左侧会话，开始处理消息</p>';

  const filter=node('div','task-filters');filter.setAttribute('aria-label','筛选任务');
  for(const [value,label] of [['','全部任务'],['DRAFT','草稿'],['ACTIVE','运行中'],['PAUSED','已暂停'],['STOPPED','已停止'],['COMPLETED','已完成']]) {
    const b=node('button',value?'':'active',label);b.type='button';b.onclick=()=>{filter.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));$('taskList').dataset.filter=value;applyFilter();};filter.append(b);
  }
  $('taskList').before(filter);
  function applyFilter() { const value=$('taskList').dataset.filter;let visible=0;$('taskList').querySelectorAll('[data-task-status]').forEach(row=>{row.hidden=Boolean(value&&row.dataset.taskStatus!==value);if(!row.hidden)visible++;});const empty=$('taskFilterEmpty');if(empty)empty.hidden=!value||visible>0; }
  const feedback=new Map();
  for(const section of sections) {
    const status=node('div','surface-feedback');status.hidden=true;status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    if(section.id==='chat')section.querySelector('.chat-list').prepend(status);else section.prepend(status);
    feedback.set(section.id,status);
  }
  if(!mini) {
    const chatList=$('chat').querySelector('.chat-list');
    const chatFilters=node('div','chat-filters'); chatFilters.setAttribute('aria-label','会话筛选');
    for(const [label,active] of [['全部',true],['未读',false],['收藏',false],['群组',false]]) { const b=node('button',active?'active is-placeholder':'is-placeholder',label); b.type='button'; b.disabled=!active; b.title=active?'当前会话列表':'即将开放'; chatFilters.append(b); }
    chatList.querySelector('.section-title').after(chatFilters);
  }
  function sectionLoading(id,busy){$(id)?.setAttribute('aria-busy',String(busy));}
  return {
    mini,
    activate(id) {
      workspace.dataset.page=id;if(editorActions)editorActions.hidden=id!=='editor';
      if(title)title.textContent=pages[id]||'活动中枢';
      if(back)back.disabled=id==='chat'&&workspace.dataset.chatOpen!=='true';
      workspace.querySelectorAll('[data-tab],[data-rail-tab]').forEach(b=>{const active=(b.dataset.tab||b.dataset.railTab)===(mini&&id==='logs'?'tasks':id);b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
      viewport.scrollTop=0;
    },
    account(data) {
      const admin=data?.admin||{};
      const info=$('railAccountId');if(info)info.textContent=admin.name&&admin.id?`${admin.name} · ID ${admin.id}`:'未登录';
      const top=workspace.querySelector('.topbar-account');if(top)top.textContent=admin.name||'管理账号';

    },
    chat(chat) {
      workspace.dataset.chatOpen=String(Boolean(chat));
      workspace.classList.toggle('chat-empty-state', !chat);
      $('chatComposer').hidden=!chat;
      if(!chat)$('chatOlder').hidden=true;
      if(back&&workspace.dataset.page==='chat')back.disabled=!chat;
      if(!chat)workspace.classList.remove('details-open');$('showChatDetails')?.setAttribute('aria-expanded',String(workspace.classList.contains('details-open')));
      if(!chat && $('chatMessages')) $('chatMessages').innerHTML='<p class="chat-empty">选择左侧会话，开始处理消息</p>';
      if(!details)return;
      details.hidden=mini?!chat:false;
      const send=details.querySelector('[data-details-send]');
      send.disabled=!chat;
      if($('chatAsset')){$('chatAsset').disabled=!chat;$('chatAsset').title=chat?'选择用于当前会话':'请先选择会话';}
      send.title=chat?'聚焦消息输入框':'请先选择会话';
      details.querySelector('.details-title').textContent=chat?.title||'请选择会话';
      details.querySelector('.details-avatar').textContent=(chat?.title||'?').slice(0,1);
      details.querySelector('.details-handle').textContent=chat?`ID ${chat.chat_id}`:'未选择会话';
      const dl=details.querySelector('dl');dl.replaceChildren();
      const fields=chat ? [['会话 ID',chat.chat_id],['未读消息',String(chat.unread_count||0)],...(chat.last_message_text?[['最近消息',chat.last_message_text]]:[])] : [];
      for(const [label,value] of fields){const dt=node('dt',''),dd=node('dd','');dt.textContent=label;dd.textContent=value;dl.append(dt,dd);}
    },
    applyFilter,
    async load(id, read) {
      const status=feedback.get(id);
      if(!status)return read();
      status.replaceChildren(node('span','loading-indicator','正在加载…'));status.hidden=false;
      sectionLoading(id,true);try { const result=await read();status.hidden=true;return result; }
      catch(error) {
        const message=node('span','error-state');message.textContent=`${[401,403].includes(error.status)?'无访问权限':'加载失败'}：${error.message}`;
        const retry=node('button','secondary','重试');retry.type='button';retry.onclick=()=>{this.load(id,read).catch(()=>{});};
        status.replaceChildren(message,retry);throw error;
      }finally{sectionLoading(id,false);}
    },
    resetEditor:()=>{if(mini)setStep(0);}
  };
}

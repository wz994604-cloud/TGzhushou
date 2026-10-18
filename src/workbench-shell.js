// Presentation only. Existing form nodes keep their IDs, values and API handlers.
import { miniTabForPage, clampMiniStep } from './workbench-utils.js';
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

export function mountWorkbench({ navigate, backChat }) {
  const workspace=$('workspace');
  const sections=[...workspace.querySelectorAll(':scope > .page')];
  const publisher=workspace.querySelector('.publisher-switch');
  workspace.querySelector(':scope > nav').remove();
  const content=node('div','mini-content');
  const viewport=node('div','mini-viewport');
  viewport.append(...sections); content.append(viewport);
  workspace.className='mini-shell';
  document.documentElement.dataset.surface='mini';
  const editorStepLabels=['消息','媒体 / 按钮','目标','时间','预览发布'];
  let title, back, step=0, stepPanels=[], stepButtons=[], settingButtons=[];
  let settingsOpen=false;
  const setStep=index=>{
    step=clampMiniStep(index);
    stepPanels.forEach((panel,i)=>{panel.hidden=i!==step;panel.setAttribute('aria-hidden',String(i!==step));});
    stepButtons.forEach((b,i)=>{b.classList.toggle('active',i===step);b.setAttribute('aria-current',i===step?'step':'false');b.setAttribute('aria-label',`${i+1}. ${editorStepLabels[i]}`);});
    if($('miniPrevious')) { $('miniPrevious').disabled=step===0; $('miniNext').hidden=step===4; }
    if(step===4) $('previewPanel').open=true;
    viewport.scrollTop=0;
  };


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
    for(const [id,label] of [['chat','聊天'],['editor','编写'],['assets','素材'],['tasks','任务'],['settings','设置']]) {
      const b=node('button','',`${icon(id)}<span>${label}</span>`); b.type='button'; b.dataset.tab=id; b.onclick=()=>navigate(id); nav.append(b);
    }
    workspace.append(nav);
    $('tasks').querySelector('.section-title').append(Object.assign(node('button','secondary','发布记录'),{onclick:()=>navigate('logs')}));
    $('logs').querySelector('.section-title').prepend(button('返回任务','back',()=>navigate('tasks')));
    $('chat').querySelector('.chat-shell').className='mini-chat';


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
  {
    const steps=node('div','mini-steps');steps.setAttribute('aria-label','编写步骤');
    const body=node('div','mini-editor-steps');
    const groups=[[message],[media,buttons],[delivery,users],[time],[preview,actions]];
    groups.forEach((group,i)=>{
      const b=node('button','',`${i+1}. ${editorStepLabels[i]}`); b.type='button';b.onclick=()=>setStep(i);steps.append(b);stepButtons.push(b);
      const panel=node('section','mini-editor-step');panel.setAttribute('aria-label',editorStepLabels[i]);panel.append(...group);body.append(panel);stepPanels.push(panel);
    });
    editor.querySelector('.section-title').after(steps,body);
    const footer=node('div','mini-step-actions','<button id="miniPrevious" class="secondary" type="button">上一步</button><button id="miniNext" class="primary" type="button">下一步</button>');body.after(footer);
    $('miniPrevious').onclick=()=>setStep(step-1);$('miniNext').onclick=()=>setStep(step+1);setStep(0);
  }

  $('save').textContent='保存草稿';
  const previewAction=node('button','secondary','预览');previewAction.type='button';previewAction.onclick=()=>setStep(4);actions.prepend(previewAction);
  const assetAction=node('button','quiet','从素材选择');assetAction.type='button';assetAction.onclick=()=>{workspace.dispatchEvent(new CustomEvent('asset-intent',{detail:{source:'editor'}}));navigate('assets');};media.append(assetAction);
  const settings=$('settings'), settingCards=[...settings.querySelectorAll(':scope > .card')];
  const settingNav=node('div','mini-settings-menu');settingNav.setAttribute('aria-label','设置分类');
  const settingBody=node('div','mini-settings-forms');
  function showSettings(index) {
    settingsOpen=index!==null;
    settings.classList.toggle('settings-form-open',settingsOpen);
    settingCards.forEach((card,i)=>{
      card.classList.toggle('category-inactive',i!==index);
    });
    settingButtons.forEach((b,i)=>{b.classList.toggle('active',i===index);b.setAttribute('aria-pressed',String(i===index));});
    settingNav.hidden=settingsOpen;
    viewport.scrollTop=0;
  }
  settingCards.forEach((card,i)=>{
    const b=node('button','',`${icon(i===3?'players':'settings')}<span>${card.querySelector('h3').textContent}</span>`);b.type='button';b.onclick=()=>showSettings(i);settingNav.append(b);settingButtons.push(b);settingBody.append(card);
  });
  const settingsLayout=node('div','mini-settings');settingsLayout.append(settingNav,settingBody);settings.append(settingsLayout);showSettings(null);

  for(const [inputId,buttonId] of [['token','savePublisher'],['ffaToken','saveFfaToken']]){const label=$(inputId).parentElement,row=node('div','settings-input-row');label.before(row);row.append(label,$(buttonId));}
  const records=node('div','task-filters');records.setAttribute('aria-label','记录分类');for(const [id,label] of [['runList','群组 / 频道'],['broadcastPanel','用户']]){const b=node('button',id==='runList'?'active':'',label);b.type='button';b.onclick=()=>{records.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));$('runList').hidden=id!=='runList';$('broadcastPanel').hidden=id!=='broadcastPanel';};records.append(b);}$('runList').before(records);$('logs').append($('broadcastPanel'));$('broadcastPanel').open=true;$('broadcastPanel').hidden=true;
  const noTimed=node('p','hint','无定时任务');noTimed.id='noTimedTasks';$('taskList').before(noTimed);
  $('usersPanel').open=true;$('selectedPanel').open=true;
  const continueWriting=node('button','primary','返回编写活动');continueWriting.type='button';continueWriting.onclick=()=>navigate('editor');$('selectedPanel').append(continueWriting);
  const tools=$('chatComposer').querySelector('.chat-tools');
  for(const [id,glyph] of [['chatEmoji','emoji'],['chatLink','link'],['chatAddButton','plus']]) {const b=$(id);b.innerHTML=icon(glyph);b.className='icon-button';}
  const file=$('chatFile'), attachment=file.parentElement;attachment.replaceChildren(node('span','',icon('attach')),file);attachment.setAttribute('aria-label','添加附件');attachment.className='file-button icon-button';
  attachment.tabIndex=0;attachment.setAttribute('role','button');attachment.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();file.click();}};
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
  function sectionLoading(id,busy){$(id)?.setAttribute('aria-busy',String(busy));}
  return {
    activate(id) {
      workspace.dataset.page=id;
      if(title)title.textContent=pages[id]||'活动中枢';
      if(back)back.disabled=id==='chat'&&workspace.dataset.chatOpen!=='true';
      const activePage = miniTabForPage(id);
      workspace.querySelectorAll('[data-tab]').forEach(b=>{const active=b.dataset.tab===activePage;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
      viewport.scrollTop=0;
    },
    chat(chat) {
      workspace.dataset.chatOpen=String(Boolean(chat));
      workspace.classList.toggle('chat-empty-state', !chat);
      $('chatComposer').hidden=!chat;
      if(!chat)$('chatOlder').hidden=true;
      if(back&&workspace.dataset.page==='chat')back.disabled=!chat;
      if(!chat && $('chatMessages')) $('chatMessages').innerHTML='<p class="chat-empty">选择左侧会话，开始处理消息</p>';
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
    resetEditor:()=>setStep(0)
  };
}

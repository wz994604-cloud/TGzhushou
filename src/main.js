import Quill from 'quill';
import 'quill/dist/quill.snow.css';
import './style.css';

const tg = window.Telegram?.WebApp;
tg?.ready(); tg?.expand();
const initData = tg?.initData || '';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const fmt = value => value ? new Date(value).toLocaleString('zh-CN', { timeZone:'Asia/Shanghai', hour12:false }) : '—';
const labels = { DRAFT:'草稿', ACTIVE:'运行中', PAUSED:'已暂停', STOPPED:'已停止', COMPLETED:'已完成', SUCCESS:'成功', FAILED:'失败', UNKNOWN:'待核实', PENDING:'排队中', SENDING:'发送中', CANCELLED:'已取消' };
let data, taskId = null, buttons = [], mediaId = null, imageUrl = '', pickerTarget = null, savedRange = null, pendingSend = null, ready = false;
const imageCache = new Map();
const draftKey = 'tgzhushou:draft:v1';
async function api(url, method = 'GET', body) {
  const headers = { 'x-telegram-init-data':initData };
  if (body && !(body instanceof FormData)) headers['content-type'] = 'application/json';
  const response = await fetch(`/api${url}`, { method, headers, body:body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `请求失败 (${response.status})`);
  return result;
}
function toast(message, error = false) { $('toast').textContent = message; $('toast').className = error ? 'toast error' : 'toast'; $('toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').hidden = true, 6000); }
async function action(fn, button) { if (button?.disabled) return; if (button) button.disabled = true; try { await fn(); } catch (error) { toast(error.message, true); } finally { if (button) button.disabled = false; } }
async function authenticatedImage(url) {
  if (imageCache.has(url)) return imageCache.get(url);
  const response = await fetch(`/api${url}`, { headers:{ 'x-telegram-init-data':initData } });
  if (!response.ok) throw new Error('图片加载失败');
  const objectUrl = URL.createObjectURL(await response.blob()); imageCache.set(url, objectUrl); return objectUrl;
}

$('app').innerHTML = `<header><div class="brand-icon">✦</div><div><h1>活动助手</h1><p id="identity">Telegram 活动发布工作台</p></div><span class="chip">北京时间</span></header>
<div id="locked" class="card center" hidden><h2>从 Telegram 打开</h2><p>请使用已绑定的管理员账号，从入口机器人的「打开活动后台」进入。</p><p id="authError" class="muted"></p></div>
<main id="workspace" hidden>
<nav aria-label="功能导航"><button data-tab="editor" class="active">编写</button><button data-tab="tasks">任务</button><button data-tab="logs">记录</button><button data-tab="settings">设置</button></nav>
<section id="editor" class="page">
<div class="section-title"><div><h2 id="editorTitle">新建活动</h2><p>内容保存后，可立即发布或开启定时。</p></div><button id="reset" class="quiet">新建</button></div>
<div class="card"><label>活动名称<input id="name" maxlength="100" placeholder="例如：每日活动介绍"></label><label>消息内容</label><div id="toolbar"><button class="ql-bold" title="加粗"></button><button class="ql-italic" title="斜体"></button><button class="ql-underline" title="下划线"></button><button class="ql-link" title="文字链接"></button><button class="ql-clean" title="清除格式"></button></div><div id="message"></div><div class="editor-footer"><button id="bodyEmoji" class="quiet">✦ 专属表情</button><span id="textCount" class="muted">0 / 4096</span></div><p class="hint">选中文字点链接图标，即可设置“点击进入频道”等文字链接。跨应用粘贴可能丢失专属表情身份，请从表情包选择器添加。</p>
<label class="file-label">附带图片 <span class="muted">JPEG / PNG / WebP，最多 5 MB</span><input id="photo" type="file" accept="image/jpeg,image/png,image/webp"></label><div id="photoBox" hidden><img id="photoPreview" alt="活动图片"><button id="removePhoto" class="quiet">移除图片</button></div></div>
<div class="card"><div class="section-title"><h3>跳转按钮</h3><button id="addButton" class="quiet">＋ 添加按钮</button></div><div id="buttons"></div><p class="hint">同一行号的按钮并排显示。专属表情和颜色以 Telegram 客户端实际支持为准。</p></div>
<div class="card"><h3>发布目标</h3><div id="targetChecks" class="check-list"></div><h3>发布方式</h3><select id="kind"><option value="MANUAL">手动立即发布</option><option value="ONCE">指定时间发布</option><option value="DAILY">每天按时段重复发布</option></select><div id="onceFields" hidden><label>指定时间（北京时间）<input id="at" type="datetime-local"></label></div><div id="dailyFields" hidden><div class="grid"><label>开始时间<input id="start" type="time" value="01:00"></label><label>结束时间<input id="end" type="time" value="05:00"></label></div><div class="grid"><label>发送间隔<input id="interval" type="number" min="1" value="30"></label><label>单位<select id="unit"><option value="1">分钟</option><option value="60">小时</option></select></label></div><p class="hint">支持跨午夜；起点发送，终点恰好落在间隔上时发送。暂停恢复后从下一个时间点继续，不补发过去时段。</p></div></div>
<details class="card"><summary>消息预览</summary><div id="preview" class="message-preview"></div><p class="hint">专属表情以替代字符标记展示；发布结果会检查 Telegram 返回的专属表情数量。</p></details>
<div class="actions"><button id="save" class="secondary">保存</button><button id="send" class="primary">保存并立即发布</button><button id="activate" class="primary" hidden>保存并启用定时</button></div><p class="hint center">编辑内容自动暂存于当前设备；Token 不存入浏览器。</p></section>
<section id="tasks" class="page" hidden><div class="section-title"><div><h2>发布任务</h2><p>查看状态与下次发送时间。</p></div><button id="refreshTasks" class="quiet">刷新</button></div><div id="taskList"></div></section>
<section id="logs" class="page" hidden><div class="section-title"><div><h2>发布记录</h2><p>单个目标失败不影响其他目标。</p></div><button id="refreshLogs" class="quiet">刷新</button></div><div id="runList"></div></section>
<section id="settings" class="page" hidden><h2>机器人与目标</h2><div class="card"><h3>发布机器人</h3><p id="publisher" class="muted"></p><label>发布机器人 Token<input id="token" type="password" autocomplete="off" placeholder="仅在首次配置或更换时填写"></label><button id="savePublisher" class="primary">验证并保存</button><p class="hint">入口机器人只负责打开后台；发布机器人负责发消息。更换发布身份会暂停旧身份的定时任务。此服务不接管发布机器人的 webhook。</p></div><div class="card"><h3>目标群 / 频道</h3><p class="hint">先把发布机器人设为管理员，再添加 @公开用户名或负数数字 ID。</p><div class="inline"><input id="targetRef" placeholder="@channel 或 -100…"><button id="addTarget" class="primary">添加</button></div><div id="targets"></div></div><div class="card"><h3>管理账号</h3><p id="adminInfo"></p><p class="hint">身份绑定使用 Railway 的 ADMIN_TG_ID。所有接口均验证 Telegram 签名。</p></div></section>
</main><div id="toast" class="toast" role="status" hidden></div>
<dialog id="emojiDialog"><div class="section-title"><h3>选择 Telegram 专属表情</h3><button id="closeEmoji" class="quiet" aria-label="关闭">✕</button></div><div class="inline"><input id="pack" placeholder="https://t.me/addemoji/表情包名"><button id="loadPack" class="primary">加载</button></div><p id="packTitle" class="hint">支持使用其他作者公开的表情包。</p><div id="emojiGrid"></div></dialog>`;

const Embed = Quill.import('blots/embed');
class CustomEmoji extends Embed {
  static blotName = 'customEmoji'; static tagName = 'span'; static className = 'custom-emoji';
  static create(value) { const node = super.create(); node.dataset.id = value.id; node.dataset.alt = value.alt; node.textContent = value.alt; node.title = `专属表情 ${value.id}`; return node; }
  static value(node) { return { id:node.dataset.id, alt:node.dataset.alt }; }
}
Quill.register(CustomEmoji);
const quill = new Quill('#message', { theme:'snow', placeholder:'输入活动文案…', modules:{ toolbar:'#toolbar' }, formats:['bold','italic','underline','link','customEmoji'] });
quill.on('selection-change', range => { if (range) savedRange = range; });
quill.on('text-change', () => { $('textCount').textContent = `${quill.getText().trimEnd().length} / ${mediaId ? 1024 : 4096}`; remember(); preview(); });
quill.root.addEventListener('paste', event => {
  const html = event.clipboardData?.getData('text/html') || '';
  if (/custom_emoji|tg-emoji|data-document-id/.test(html)) toast('粘贴内容中的专属表情可能需要从选择器重新添加。');
});
function changeTab(id) { document.querySelectorAll('.page').forEach(page => page.hidden = page.id !== id); document.querySelectorAll('nav button').forEach(button => button.classList.toggle('active', button.dataset.tab === id)); if (id === 'logs') action(loadRuns); }
document.querySelector('nav').addEventListener('click', event => { if (event.target.dataset.tab) changeTab(event.target.dataset.tab); });
function scheduleFields() { const kind = $('kind').value; $('onceFields').hidden = kind !== 'ONCE'; $('dailyFields').hidden = kind !== 'DAILY'; $('activate').hidden = kind === 'MANUAL'; }
function collect() { return { name:$('name').value, delta:quill.getContents(), buttons, mediaId, targetIds:[...document.querySelectorAll('[name=target]:checked')].map(x => Number(x.value)), schedule: $('kind').value === 'DAILY' ? { kind:'DAILY', start:$('start').value, end:$('end').value, interval:Number($('interval').value)*Number($('unit').value) } : $('kind').value === 'ONCE' ? { kind:'ONCE', at:Date.parse(`${$('at').value}:00+08:00`) } : { kind:'MANUAL' } }; }
function remember() { if (!ready) return; try { localStorage.setItem(draftKey, JSON.stringify({ ...collect(), taskId })); } catch { /* storage may be disabled in a webview */ } }
function showButtons() {
  $('buttons').innerHTML = buttons.map((b,i) => `<div class="button-editor" data-index="${i}"><div class="section-title"><strong>按钮 ${i+1}</strong><button data-remove="${i}" class="quiet danger-text">删除</button></div><label>按钮文字<input data-field="text" value="${esc(b.text)}" maxlength="64"></label><label>跳转链接<input data-field="url" value="${esc(b.url)}" placeholder="https://t.me/…"></label><div class="grid"><label>颜色<select data-field="style">${[['default','默认'],['primary','蓝色'],['success','绿色'],['danger','红色']].map(([v,t])=>`<option value="${v}" ${b.style===v?'selected':''}>${t}</option>`).join('')}</select></label><label>行号<input data-field="row" type="number" min="1" max="12" value="${b.row+1}"></label></div><button data-emoji="${i}" class="quiet">${esc(b.iconAlt || '✦')} ${b.iconId ? '更换专属表情' : '选择专属表情'}</button>${b.iconId?`<button data-clear="${i}" class="quiet">移除表情</button>`:''}</div>`).join('') || '<p class="muted">暂未添加跳转按钮</p>';
  preview();
}
$('buttons').addEventListener('input', event => { const wrap = event.target.closest('[data-index]'); if (!wrap || !event.target.dataset.field) return; const field = event.target.dataset.field; buttons[Number(wrap.dataset.index)][field] = field === 'row' ? Number(event.target.value)-1 : event.target.value; remember(); preview(); });
$('buttons').addEventListener('click', event => { if (event.target.dataset.remove !== undefined) { buttons.splice(Number(event.target.dataset.remove),1); showButtons(); remember(); } if (event.target.dataset.emoji !== undefined) openPicker(Number(event.target.dataset.emoji)); if (event.target.dataset.clear !== undefined) { Object.assign(buttons[Number(event.target.dataset.clear)], { iconId:'',iconAlt:'' }); showButtons(); remember(); } });
$('addButton').onclick = () => { if (buttons.length >= 12) return toast('最多添加 12 个按钮'); buttons.push({text:'立即进入',url:'https://t.me/',style:'default',row:buttons.length,iconId:'',iconAlt:''}); showButtons(); remember(); };
function preview() {
  const container = $('preview'); container.replaceChildren();
  if (imageUrl) { const img = document.createElement('img'); img.src = imageUrl; img.alt = '消息图片'; container.append(img); }
  const text = document.createElement('div'); text.className='preview-text';
  for (const op of quill.getContents().ops) { let node = document.createElement('span'); node.textContent = typeof op.insert === 'string' ? op.insert : op.insert.customEmoji?.alt || ''; const a = op.attributes || {}; if (op.insert.customEmoji) node.className='custom-emoji'; if (a.bold) node.style.fontWeight='700'; if (a.italic) node.style.fontStyle='italic'; if (a.underline) node.style.textDecoration='underline'; if (a.link) { const link=document.createElement('a'); link.textContent=node.textContent; link.href=/^(https:|tg:)/i.test(a.link)?a.link:'#'; link.target='_blank'; link.rel='noopener noreferrer'; node=link; } text.append(node); } container.append(text);
  const rows = new Map(); for (const b of buttons) { const row=rows.get(b.row)||[]; row.push(b); rows.set(b.row,row); }
  for (const [,row] of [...rows].sort(([a],[b])=>a-b)) { const div=document.createElement('div'); div.className='preview-row'; for(const b of row) { const span=document.createElement('span'); span.className=`preview-button ${b.style}`; span.textContent=`${b.iconAlt || ''} ${b.text}`.trim(); div.append(span); } container.append(div); }
}
function openPicker(target) { pickerTarget=target; $('emojiDialog').showModal(); }
$('bodyEmoji').onclick = () => openPicker('body'); $('closeEmoji').onclick = () => $('emojiDialog').close();
$('loadPack').onclick = event => action(async () => { const pack=await api('/sticker-packs','POST',{pack:$('pack').value}); $('packTitle').textContent=`${pack.title} · ${pack.stickers.length} 个`; $('emojiGrid').replaceChildren(); for(const sticker of pack.stickers) { const button=document.createElement('button'); button.className='emoji-choice'; button.textContent=sticker.alt; button.title=sticker.id; button.onclick=()=>{ if(pickerTarget==='body'){const at=savedRange?.index??quill.getLength()-1; quill.insertEmbed(at,'customEmoji',{id:sticker.id,alt:sticker.alt},'user'); quill.setSelection(at+1,0);}else { Object.assign(buttons[pickerTarget],{iconId:sticker.id,iconAlt:sticker.alt}); showButtons();remember(); } $('emojiDialog').close(); }; $('emojiGrid').append(button); if(sticker.thumbnailId) authenticatedImage(`/sticker-image?id=${encodeURIComponent(sticker.thumbnailId)}`).then(url=>{const img=document.createElement('img'); img.src=url; img.alt=sticker.alt; button.replaceChildren(img);}).catch(()=>{}); } }, event.currentTarget);
$('photo').onchange = event => action(async () => { const file=event.target.files[0]; if(!file)return; const form=new FormData(); form.set('image',file); const media=await api('/media','POST',form); mediaId=media.id; imageUrl=await authenticatedImage(`/media/${mediaId}`); showPhoto(); remember(); },event.currentTarget);
function showPhoto() { $('photoBox').hidden=!mediaId; $('photoPreview').src=imageUrl; $('textCount').textContent=`${quill.getText().trimEnd().length} / ${mediaId?1024:4096}`; preview(); }
$('removePhoto').onclick = () => {mediaId=null;imageUrl='';$('photo').value='';showPhoto();remember();};
function populateTargets(selected = []) { $('targetChecks').innerHTML=data.targets.map(t=>`<label class="check"><input type="checkbox" name="target" value="${t.id}" ${selected.includes(t.id)?'checked':''} ${t.can_publish?'':'disabled'}><span>${esc(t.title)}<small>${esc(t.last_error || t.chat_id)}</small></span></label>`).join('')||'<p class="muted">请先在「设置」中添加群或频道。</p>'; }
async function refresh() { const selected=[...document.querySelectorAll('[name=target]:checked')].map(x=>Number(x.value)); data=await api('/bootstrap'); $('identity').textContent=data.publisher?`@${data.publisher.username} · 发布工作台`:'先在设置中配置发布机器人'; $('publisher').textContent=data.publisher?`当前：@${data.publisher.username}（${data.publisher.id}）`:'尚未配置'; $('adminInfo').textContent=`${data.admin.name} · ID ${data.admin.id}`; populateTargets(selected); $('targets').innerHTML=data.targets.map(t=>`<div class="list-row"><div><strong>${esc(t.title)}</strong><small>${esc(t.chat_id)} · ${t.can_publish?'已具备权限':esc(t.last_error)}</small></div><button class="quiet danger-text" data-delete-target="${t.id}">删除</button></div>`).join(''); showTasks(); }
function showTasks() { $('taskList').innerHTML=data.tasks.map(t=>`<article class="card"><div class="section-title"><h3>${esc(t.name)}</h3><span class="status ${t.status}">${labels[t.status]}</span></div><p class="muted">下次：${fmt(t.next_at)}</p><div class="wrap-actions"><button class="quiet" data-edit="${t.id}">编辑</button>${t.status!=='STOPPED'?`<button class="quiet" data-send-task="${t.id}">立即发布</button>${!['COMPLETED'].includes(t.status)&&JSON.parse(t.schedule_json).kind!=='MANUAL'?`<button class="quiet" data-task="${t.id}" data-action="${t.status==='ACTIVE'?'pause':'activate'}">${t.status==='ACTIVE'?'暂停':'启用 / 恢复'}</button>`:''}<button class="quiet danger-text" data-task="${t.id}" data-action="stop">停止</button>`:''}</div></article>`).join('')||'<div class="card center muted">还没有发布任务</div>'; }
async function fill(item) { ready=false; taskId=item.taskId || null; $('name').value=item.name||''; quill.setContents(item.delta || {ops:[{insert:'\n'}]}); buttons=item.buttons||[];mediaId=item.mediaId||null; imageUrl='';if(mediaId)imageUrl=await authenticatedImage(`/media/${mediaId}`).catch(()=> ''); const s=item.schedule||{kind:'MANUAL'}; $('kind').value=s.kind;$('start').value=s.start||'01:00';$('end').value=s.end||'05:00';$('interval').value=s.interval||30;$('unit').value='1';$('at').value=s.at?new Date(s.at+8*3600000).toISOString().slice(0,16):'';populateTargets(item.targetIds||[]);$('editorTitle').textContent=taskId?`编辑活动 #${taskId}`:'新建活动';showButtons();showPhoto();scheduleFields();ready=true; }
async function save() { const result=await api(taskId?`/tasks/${taskId}`:'/tasks',taskId?'PUT':'POST',collect());taskId=result.id;$('editorTitle').textContent=`编辑活动 #${taskId}`;remember();await refresh();return taskId; }
async function sendTask(id) { if(!pendingSend || pendingSend.id!==id) pendingSend={id,key:crypto.randomUUID()}; const result=await api(`/tasks/${id}/send`,'POST',{requestKey:pendingSend.key});pendingSend=null;toast(`已加入发送队列，记录 #${result.runId}`); }
$('save').onclick = event => action(async()=>{await save();toast('已保存');},event.currentTarget);
$('send').onclick = event => action(async()=>{await sendTask(await save());},event.currentTarget);
$('activate').onclick = event => action(async()=>{const id=await save();await api(`/tasks/${id}/status`,'POST',{action:'activate'});await refresh();toast('定时已启用');changeTab('tasks');},event.currentTarget);
$('reset').onclick = () => action(async()=>{if(ready&&!confirm('新建空白活动？当前未保存的编辑会被清空。'))return;await fill({});remember();});
$('taskList').onclick = event => action(async()=>{const b=event.target;if(b.dataset.edit){const t=await api(`/tasks/${b.dataset.edit}`);await fill({taskId:t.id,name:t.name,delta:{ops:JSON.parse(t.delta_json)},buttons:JSON.parse(t.buttons_json),mediaId:t.media_id,targetIds:JSON.parse(t.target_ids_json),schedule:JSON.parse(t.schedule_json)});remember();changeTab('editor');}if(b.dataset.task){if(b.dataset.action==='stop'&&!confirm('停止后此任务不再恢复，确定停止？'))return;await api(`/tasks/${b.dataset.task}/status`,'POST',{action:b.dataset.action});await refresh();}if(b.dataset.sendTask)await sendTask(Number(b.dataset.sendTask));},event.target);
$('savePublisher').onclick = event => action(async()=>{if(data.publisher&&!confirm('确认更新发布机器人配置？更换身份会暂停旧定时任务。'))return;await api('/publisher','POST',{token:$('token').value});$('token').value='';await refresh();toast('发布机器人已验证并保存');},event.currentTarget);
$('addTarget').onclick = event => action(async()=>{const t=await api('/targets','POST',{reference:$('targetRef').value});$('targetRef').value='';await refresh();toast(t.can_publish?'目标已添加':t.last_error,!t.can_publish);},event.currentTarget);
$('targets').onclick = event => action(async()=>{const id=event.target.dataset.deleteTarget;if(id&&confirm('删除该目标？引用它的任务将跳过此目标。')){await api(`/targets/${id}`,'DELETE');await refresh();}},event.target);
async function loadRuns() { const runs=await api('/runs');$('runList').innerHTML=runs.map(r=>`<details class="card" data-run="${r.id}"><summary><strong>${esc(r.name)}</strong><span class="muted">${fmt(r.created_at)}</span></summary><p>成功 ${r.success_count||0} / ${r.total} · 失败 ${r.failed_count||0} · 待核实 ${r.unknown_count||0}</p><div class="run-detail"><button class="quiet" data-run-detail="${r.id}">查看各目标结果</button></div></details>`).join('')||'<div class="card center muted">还没有发布记录</div>'; }
$('runList').onclick = event => action(async()=>{const id=event.target.dataset.runDetail;if(!id)return;const run=await api(`/runs/${id}`);event.target.parentElement.innerHTML=run.deliveries.map(d=>`<div class="list-row"><div><strong>${esc(d.title)} · ${labels[d.status]||esc(d.status)}</strong><small>${esc(d.error_text|| (d.telegram_message_id?`消息 ID ${d.telegram_message_id}`:'等待处理'))}</small></div></div>`).join('');},event.target);
$('refreshTasks').onclick=event=>action(refresh,event.currentTarget);$('refreshLogs').onclick=event=>action(loadRuns,event.currentTarget);
$('editor').addEventListener('input', remember);$('kind').onchange=()=>{scheduleFields();remember();};
async function boot() { if(!initData){$('locked').hidden=false;return;}try{await refresh();$('workspace').hidden=false;let draft;try{draft=JSON.parse(localStorage.getItem(draftKey)||'null');}catch{}await fill(draft||{});if(!data.publisher)changeTab('settings');}catch(error){$('locked').hidden=false;$('authError').textContent=error.message;} }
boot();

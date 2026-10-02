import Quill from 'quill';
import { deletionRange } from './editor-delete.js';
import { createImageLoader } from './image-loader.js';
import { installLinkEditor } from './link-editor.js';
import 'quill/dist/quill.snow.css';
import './style.css';
import { installSentEditor } from './sent-editor.js';

const tg = window.Telegram?.WebApp;
tg?.ready(); tg?.expand();
const initData = tg?.initData || '';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const fmt = value => value ? new Date(value).toLocaleString('zh-CN', { timeZone:'Asia/Shanghai', hour12:false }) : '—';
const labels = { DRAFT:'草稿', ACTIVE:'运行中', PAUSED:'已暂停', STOPPED:'已停止', COMPLETED:'已完成', SUCCESS:'成功', FAILED:'失败', UNKNOWN:'待核实', PENDING:'排队中', SENDING:'发送中', CANCELLED:'已取消', EDITED:'已编辑', DELETED:'已删除', RUNNING:'发送中' };
let data, taskId = null, buttons = [], mediaId = null, imageUrl = '', pickerTarget = null, savedRange = null, pendingSend = null, ready = false, insertedEmbedPending = false;
let selectedPublisherId = '';
let draftDirty = false, draftTimer, previewTimer, previewDirty = true, serverSnapshot = null;
const playerCache = new Map();
let playerPage = 1;
let selectedPlayerIds = new Set(), savedPacks = [], recentEmojis = [];
const recentEmojiKey = 'tgzhushou:recent-emojis:v1';
const loadImage = createImageLoader(async url => {
  const response = await fetch('/api' + url, { headers:{ 'x-telegram-init-data':initData, ...(selectedPublisherId ? { 'x-publisher-id':selectedPublisherId } : {}) } });
  if (!response.ok) throw Object.assign(new Error('图片加载失败'), { status:response.status });
  return response.blob();
});
const draftKey = () => data?.publisher?.legacy ? 'tgzhushou:draft:v1' : `tgzhushou:draft:${selectedPublisherId || 'none'}:v1`;
function readRecentEmojis() {
  try {
    const stored = JSON.parse(localStorage.getItem(recentEmojiKey) || '[]');
    recentEmojis = Array.isArray(stored) ? stored.filter(item => item && typeof item.id === 'string' && typeof item.alt === 'string').slice(0, 30) : [];
  } catch { recentEmojis = []; }
}
function rememberRecentEmoji(sticker) {
  recentEmojis = [sticker, ...recentEmojis.filter(item => item.id !== sticker.id)].slice(0, 30);
  try { localStorage.setItem(recentEmojiKey, JSON.stringify(recentEmojis)); } catch { /* Keep session history when storage is unavailable. */ }
}
function renderSavedPackTabs() {
  $('savedPackTabs').innerHTML = '<button class="quiet pack-tab" data-recent="1">最近使用</button>' + savedPacks.map((p,i)=>`<button class="quiet pack-tab" data-pack-index="${i}">${esc(p.title)}</button>`).join('');
}
async function loadSavedPacks() {
  readRecentEmojis(); renderSavedPackTabs();
  if (!stickers.size && recentEmojis.length) displayPack({ title:'最近使用', stickers:recentEmojis });
  const r = await api('/sticker-packs/saved');
  savedPacks = r.packs || []; renderSavedPackTabs();
}
async function api(url, method = 'GET', body) {
  const headers = { 'x-telegram-init-data':initData };
  if (selectedPublisherId) headers['x-publisher-id'] = selectedPublisherId;
  if (body && !(body instanceof FormData)) headers['content-type'] = 'application/json';
  const response = await fetch(`/api${url}`, { method, headers, body:body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `请求失败 (${response.status})`);
  return result;
}
function toast(message, error = false) { $('toast').textContent = message; $('toast').className = error ? 'toast error' : 'toast'; $('toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').hidden = true, 6000); }
async function action(fn, button) { if (button?.disabled) return; if (button) button.disabled = true; try { await fn(); } catch (error) { toast(error.message, true); } finally { if (button) button.disabled = false; } }
async function authenticatedImage(url) { return URL.createObjectURL(await loadImage(url)); }
function replacePhoto(url = '') { if (imageUrl) URL.revokeObjectURL(imageUrl); imageUrl = url; }
function displayImage(node, url, alt, label = '') {
  if (!node.isConnected) { URL.revokeObjectURL(url); return; }
  const img = document.createElement('img'); img.alt = alt;
  img.onload = img.onerror = () => URL.revokeObjectURL(url);
  img.src = url; node.replaceChildren(img, ...(label ? [document.createTextNode(' ' + label)] : []));
}

$('app').innerHTML = `<header class="app-header"><div class="brand-icon" aria-hidden="true"><svg viewBox="0 0 48 48" role="presentation"><path d="M24 5 28.2 19.8 43 24l-14.8 4.2L24 43l-4.2-14.8L5 24l14.8-4.2L24 5Z" fill="currentColor"/><circle cx="37" cy="11" r="3" fill="currentColor" opacity=".72"/><circle cx="11" cy="37" r="3" fill="currentColor" opacity=".72"/></svg></div><div class="brand-copy"><span class="eyebrow">运营工作台</span><h1>活动中枢</h1><p id="identity">Telegram 活动发布工作台</p></div><div class="header-meta"><span class="online-dot" aria-hidden="true"></span><span class="chip">北京时间</span></div></header>
<div id="locked" class="card center" hidden><h2>从 Telegram 打开</h2><p>请使用已绑定的管理员账号，从入口机器人的「打开活动后台」进入。</p><p id="authError" class="muted"></p></div>
<main id="workspace" hidden>
<div class="publisher-switch"><label for="publisherSelect">当前发布机器人</label><select id="publisherSelect" aria-label="当前发布机器人"></select></div>
<nav aria-label="功能导航"><button data-tab="editor" class="active">编写</button><button data-tab="players">用户</button><button data-tab="tasks">任务</button><button data-tab="logs">记录</button><button data-tab="settings">设置</button></nav>
<section id="editor" class="page">
<div class="section-title"><div><h2 id="editorTitle">新建活动</h2><p id="saveStatus" role="status">内容尚未保存到服务器</p></div><button id="reset" class="quiet">新建</button></div>
<div class="card"><label>活动名称<input id="name" maxlength="100" placeholder="例如：每日活动介绍"></label><div id="composeArea"><label>消息内容</label><button id="toggleWriting" class="quiet" type="button">编辑文案</button><div id="toolbar"><button class="ql-bold" title="加粗"></button><button class="ql-italic" title="斜体"></button><button class="ql-underline" title="下划线"></button><button class="ql-clean" title="清除格式"></button></div><div id="message"></div><div class="editor-footer"><button id="bodyEmoji" class="quiet">✦ 专属表情</button><button id="editLink" class="quiet">添加 / 编辑链接</button><span id="textCount" class="muted">0 / 4096</span></div></div><details class="editor-help"><summary>编辑说明</summary><p class="hint">点击「添加链接」填写显示文字和地址；选中链接后点击「添加 / 编辑链接」修改。跨应用粘贴可能丢失专属表情身份，请从表情包选择器添加。</p></details>
<label class="file-label">附带图片 <span class="muted">JPEG / PNG / WebP，最多 5 MB</span><input id="photo" type="file" accept="image/jpeg,image/png,image/webp"></label><div id="photoBox" hidden><img id="photoPreview" alt="活动图片"><button id="removePhoto" class="quiet">移除图片</button></div></div>
<div class="card"><div class="section-title"><h3>跳转按钮</h3><button id="addButton" class="quiet">＋ 添加按钮</button></div><div id="buttons"></div><p class="hint">同一行号的按钮并排显示。专属表情和颜色以 Telegram 客户端实际支持为准。</p></div>
<div class="card"><h3>发布目标</h3><div id="targetChecks" class="check-list"></div><h3>发布方式</h3><select id="kind"><option value="MANUAL">手动立即发布</option><option value="ONCE">指定时间发布</option><option value="DAILY">每天按时段重复发布</option></select><div id="onceFields" hidden><label>指定时间（北京时间）<input id="at" type="datetime-local"></label></div><div id="dailyFields" hidden><div class="grid"><label>开始时间<input id="start" type="time" value="01:00"></label><label>结束时间<input id="end" type="time" value="05:00"></label></div><div class="grid"><label>发送间隔<input id="interval" type="number" min="1" value="30"></label><label>单位<select id="unit"><option value="1">分钟</option><option value="60">小时</option></select></label></div><p class="hint">支持跨午夜；起点发送，终点恰好落在间隔上时发送。暂停恢复后从下一个时间点继续，不补发过去时段。</p></div></div>
<div class="card"><div class="section-title"><h3>私信用户</h3><button id="openPlayers" class="quiet">选择用户</button></div><p id="selectedPlayersHint" class="muted">尚未选择用户</p><p class="hint">使用当前文案和自定义表情，发送给用户页中选中的用户。</p></div>
<details id="previewPanel" class="card"><summary>消息预览</summary><div id="preview" class="message-preview"></div><p class="hint">专属表情以替代字符标记展示；发布结果会检查 Telegram 返回的专属表情数量。</p></details>
<div class="actions"><button id="save" class="secondary">保存</button><button id="send" class="primary">保存并立即发布</button><button id="sendBroadcast" class="primary">群发给用户</button><button id="activate" class="primary" hidden>保存并启用定时</button></div><p class="hint center">编辑内容自动暂存于当前设备；Token 不存入浏览器。</p></section>
<section id="players" class="page" hidden><div class="section-title"><div><h2>用户</h2><p>选择用户后，从编写页发送私信。</p></div></div><div class="wrap-actions user-actions"><button id="syncPlayers" class="quiet">同步用户</button><button id="importPlayers" class="quiet">导入 WPS CSV</button><input id="playerCsv" type="file" accept=".csv,text/csv" hidden></div>
<details id="selectedPanel" class="card"><summary id="playerSelectionCount">已选用户 · 0 人</summary><button id="clearPlayers" class="quiet">清空选择</button><div id="selectedPlayerList" class="user-scroll"></div></details>
<details id="usersPanel" class="card"><summary>用户名单 <span id="userTotal" class="muted"></span></summary><div class="inline"><input id="playerSearch" placeholder="搜索 ID、昵称或用户名"><button id="refreshPlayers" class="quiet">搜索</button></div><button id="selectAllPlayers" class="quiet">全选全部有效用户</button><div id="playerList" class="check-list user-scroll"></div><div class="wrap-actions"><button id="prevPlayers" class="quiet">上一页</button><button id="nextPlayers" class="quiet">下一页</button></div><p id="playerStats" class="hint"></p></details>
<details id="broadcastPanel" class="card"><summary>私信记录</summary><button id="refreshBroadcasts" class="quiet">刷新</button><div id="broadcastList"></div></details></section>
<section id="tasks" class="page" hidden><div class="section-title"><div><h2>发布任务</h2><p>查看状态与下次发送时间。</p></div><button id="refreshTasks" class="quiet">刷新</button></div><div id="taskList"></div></section>
<section id="logs" class="page" hidden><div class="section-title"><div><h2>发布记录</h2><p>单个目标失败不影响其他目标。</p></div><button id="refreshLogs" class="quiet">刷新</button></div><div id="runList"></div></section>
<section id="settings" class="page" hidden><h2>机器人与目标</h2><div class="card"><h3>发布机器人</h3><p id="publisher" class="muted"></p><label>添加机器人或更新当前机器人 Token<input id="token" type="password" autocomplete="off" placeholder="填写发布机器人 Token"></label><button id="savePublisher" class="primary">验证并保存</button><p class="hint">同一后台管理多个发布机器人，原任务继续运行。发布机器人原有 webhook 不会被接管。</p></div><div id="ffaCard" class="card"><h3>发发娱乐用户接口</h3><label>后台 JWT Token<input id="ffaToken" type="password" autocomplete="off" placeholder="从发发娱乐后台登录态复制"></label><button id="saveFfaToken" class="primary">保存并测试连接</button><p id="ffaStatus" class="hint">尚未配置</p></div><div class="card"><h3>目标群 / 频道</h3><p class="hint">先把当前发布机器人设为管理员，再添加 @公开用户名或负数数字 ID。</p><div class="inline"><input id="targetRef" placeholder="@channel 或 -100…"><button id="addTarget" class="primary">添加</button></div><div id="targets"></div></div><div class="card"><h3>管理账号</h3><p id="adminInfo"></p><p class="hint">身份绑定使用 Railway 的 ADMIN_TG_IDS（兼容 ADMIN_TG_ID）。所有接口均验证 Telegram 签名。</p></div></section>
</main><div id="toast" class="toast" role="status" hidden></div>
<dialog id="emojiDialog" aria-label="表情键盘"><div class="section-title"><h3>选择 Telegram 专属表情</h3><div class="emoji-key-actions"><button id="emojiBackspace" class="quiet" type="button" aria-label="删除光标前内容" title="退格，长按连续删除" hidden>⌫</button><button id="closeEmoji" class="quiet" aria-label="完成">完成</button></div></div><details id="packSettings"><summary>表情包<span id="packTitle" class="hint">添加或切换</span></summary><div class="pack-controls"><div class="inline"><input id="pack" placeholder="https://t.me/addemoji/表情包名"><button id="loadPack" class="primary">加载</button><button id="savePack" class="quiet">保存</button></div><div id="savedPackTabs" class="pack-tabs"></div><select id="packHistory" aria-label="切换已加载表情包" hidden></select></div></details><div id="emojiGrid"></div></dialog>`;

const Embed = Quill.import('blots/embed');
class CustomEmoji extends Embed {
  static blotName = 'customEmoji'; static tagName = 'span'; static className = 'custom-emoji';
  static create(value) { const node = super.create(); node.dataset.id = value.id; node.dataset.alt = value.alt; node.dataset.thumbId = value.thumbId || ''; node.textContent = value.alt; node.title = `专属表情 ${value.id}`; return node; }
  static value(node) { return { id:node.dataset.id, alt:node.dataset.alt, thumbId:node.dataset.thumbId || '' }; }
}
Quill.register(CustomEmoji);
const unavailableStickerImages = new Set();
function stickerImage(url) {
  if (unavailableStickerImages.has(url)) return Promise.reject(Object.assign(new Error('表情缩略图不可用'), { status:404 }));
  return authenticatedImage(url).catch(error => {
    if (error?.status === 404) unavailableStickerImages.add(url);
    throw error;
  });
}
const openSent = installSentEditor({ Quill, api, esc, toast, action, image: stickerImage, hydrateEmojiImages });
const quill = new Quill('#message', { theme:'snow', placeholder:'输入活动文案…', modules:{ toolbar:'#toolbar' }, formats:['bold','italic','underline','link','customEmoji'] });
installLinkEditor(Quill, quill);
quill.enable(false);
$('toggleWriting').onclick=()=>{const edit=!quill.isEnabled();quill.enable(edit);$('toggleWriting').textContent=edit?'完成编辑':'编辑文案';if(edit)quill.focus();else{quill.blur();closePicker();}};
quill.on('selection-change', range => { if (range) savedRange = range; });
quill.on('text-change', () => { insertedEmbedPending=false; $('textCount').textContent = `${quill.getText().trimEnd().length} / ${mediaId ? 1024 : 4096}`; remember(); preview(); });
quill.root.addEventListener('paste', event => {
  const html = event.clipboardData?.getData('text/html') || '';
  if (/custom_emoji|tg-emoji|data-document-id/.test(html)) toast('粘贴内容中的专属表情可能需要从选择器重新添加。');
});
function changeTab(id) { closePicker(); document.querySelectorAll('.page').forEach(page => page.hidden = page.id !== id); document.querySelectorAll('nav button').forEach(button => button.classList.toggle('active', button.dataset.tab === id)); if (id === 'logs') action(loadRuns); if (id === 'players') action(loadPlayers); }
document.querySelector('nav').addEventListener('click', event => { if (event.target.dataset.tab) changeTab(event.target.dataset.tab); });
function updatePlayerSelection() {
  $('playerSelectionCount').textContent = '已选用户 · '+selectedPlayerIds.size+' 人';
  $('selectedPlayersHint').textContent = selectedPlayerIds.size ? '已选择 '+selectedPlayerIds.size+' 名用户 · 点击查看' : '尚未选择用户';
  $('selectedPlayerList').innerHTML = [...selectedPlayerIds].map(id=>{const p=playerCache.get(id)||{};return '<div class="list-row"><div><strong>'+esc(p.display_name||'未命名')+'</strong><small>'+esc(id)+'</small></div><button class="quiet" data-unselect="'+esc(id)+'">取消选择</button></div>';}).join('')||'<p class="muted">尚未选择用户</p>';
  document.querySelectorAll('[data-player-id]').forEach(n=>n.checked=selectedPlayerIds.has(n.dataset.playerId));
}
async function loadPlayers() {
  const q=$('playerSearch').value.trim(), result=await api('/players?q='+encodeURIComponent(q)+'&page='+playerPage+'&size=50');
  for(const p of result.rows) playerCache.set(p.telegram_id,p);
  $('userTotal').textContent='· 共 '+result.total+' 人';
  $('playerStats').textContent='第 '+playerPage+' 页 · 共 '+result.total+' 名用户';
  $('prevPlayers').disabled=playerPage<=1; $('nextPlayers').disabled=playerPage*50>=result.total;
  $('playerList').innerHTML=result.rows.map(p=>'<label class="check"><input type="checkbox" data-player-id="'+esc(p.telegram_id)+'" '+(p.active?'':'disabled')+'><span>'+esc(p.display_name||'未命名')+'<small>'+esc(p.telegram_id)+(p.username?' · @'+esc(p.username):'')+'</small></span></label>').join('')||(data?.publisher?.legacy?'<p class="muted">暂无用户，请同步或导入名单。</p>':'<p class="muted">此机器人的用户来源尚未配置，私信发送流程已就绪。</p>');
  updatePlayerSelection(); await loadBroadcasts();
}
$('importPlayers').onclick=()=>$('playerCsv').click();
$('selectedPlayerList').onclick=e=>{const id=e.target.dataset.unselect;if(id){selectedPlayerIds.delete(id);updatePlayerSelection();}};
$('prevPlayers').onclick=()=>{playerPage--;action(loadPlayers);};$('nextPlayers').onclick=()=>{playerPage++;action(loadPlayers);};
$('selectedPlayersHint').onclick=()=>{changeTab('players');$('selectedPanel').open=true;};
async function loadBroadcasts() { const rows=await api('/broadcasts'); $('broadcastList').innerHTML=rows.map(r=>`<div class="list-row"><div><strong>${esc(r.name)} · ${esc(r.status)}</strong><small>成功 ${r.success_count||0} · 失败 ${r.failed_count||0} · 排队 ${r.pending_count||0} · ${fmt(r.created_at)}</small></div><button class="quiet" data-sent-broadcast="${r.id}">查看 / 编辑 / 删除</button>${['PENDING','RUNNING'].includes(r.status)?`<button class="quiet danger-text" data-stop-broadcast="${r.id}">停止</button>`:''}</div>`).join('')||'<p class="muted">暂无私信记录</p>'; }
$('playerList').addEventListener('change',e=>{const id=e.target.dataset.playerId;if(!id)return;e.target.checked?selectedPlayerIds.add(id):selectedPlayerIds.delete(id);updatePlayerSelection();}); $('refreshPlayers').onclick=e=>{playerPage=1;action(loadPlayers,e.currentTarget);}; $('playerSearch').addEventListener('keydown',e=>{if(e.key==='Enter'){playerPage=1;action(loadPlayers);}}); $('clearPlayers').onclick=()=>{selectedPlayerIds.clear();loadPlayers();}; $('selectAllPlayers').onclick=e=>action(async()=>{const r=await api('/players/ids');for(const p of r.rows)playerCache.set(p.telegram_id,p);selectedPlayerIds=new Set(r.rows.map(x=>x.telegram_id));await loadPlayers();toast(`已选择 ${selectedPlayerIds.size} 名有效用户`);},e.currentTarget); $('playerCsv').onchange=e=>action(async()=>{const f=e.target.files[0];if(!f)return;const form=new FormData();form.set('file',f);const r=await api('/players/import','POST',form);e.target.value='';await loadPlayers();toast(`导入完成：新增 ${r.created}，更新 ${r.updated}，无效 ${r.invalid}`);},e.currentTarget); $('refreshBroadcasts').onclick=e=>action(loadBroadcasts,e.currentTarget); $('broadcastList').onclick=e=>action(async()=>{if(e.target.dataset.sentBroadcast){await openSent('broadcasts',e.target.dataset.sentBroadcast);return;}const id=e.target.dataset.stopBroadcast;if(id&&confirm('停止尚未发送的私信？')){await api(`/broadcasts/${id}/stop`,'POST');await loadBroadcasts();toast('已停止剩余发送');}},e.target); $('openPlayers').onclick=()=>{changeTab('players');$('usersPanel').open=true;};
async function sendBroadcast(){if(!selectedPlayerIds.size)throw new Error('请先在「用户」页选择发送对象');const r=await api('/broadcasts','POST',{name:$('name').value||'用户私信',delta:quill.getContents(),buttons,mediaId,playerIds:[...selectedPlayerIds]});toast(`已加入私信队列，共 ${r.total} 人`);} $('sendBroadcast').onclick=e=>action(sendBroadcast,e.currentTarget); $('syncPlayers').onclick=e=>action(async()=>{const r=await api('/ffa/sync','POST');await loadPlayers();toast(`同步完成：新增 ${r.created}，更新 ${r.updated}`);},e.currentTarget);
function scheduleFields() { const kind = $('kind').value; $('onceFields').hidden = kind !== 'ONCE'; $('dailyFields').hidden = kind !== 'DAILY'; $('activate').hidden = kind === 'MANUAL'; }
function collect() { return { name:$('name').value, delta:quill.getContents(), buttons, mediaId, targetIds:[...document.querySelectorAll('[name=target]:checked')].map(x => Number(x.value)), schedule: $('kind').value === 'DAILY' ? { kind:'DAILY', start:$('start').value, end:$('end').value, interval:Number($('interval').value)*Number($('unit').value) } : $('kind').value === 'ONCE' ? { kind:'ONCE', at:Date.parse(`${$('at').value}:00+08:00`) } : { kind:'MANUAL' } }; }
function saveStatus(local = true) {
  $('saveStatus').textContent = serverSnapshot === JSON.stringify(collect()) ? '服务器已保存' : local ? '本机已暂存 · 尚未保存到服务器' : '编辑中 · 尚未保存到服务器';
}
function flushDraft(force = false) {
  clearTimeout(draftTimer);
  if (!ready || (!draftDirty && !force)) return;
  try { localStorage.setItem(draftKey(), JSON.stringify({ ...collect(), taskId })); draftDirty = false; saveStatus(); }
  catch { $('saveStatus').textContent = serverSnapshot === JSON.stringify(collect()) ? '服务器已保存 · 本机暂存失败' : '本机暂存失败，请点击保存到服务器'; }
}
function remember() {
  if (!ready) return;
  draftDirty = true; clearTimeout(draftTimer); $('saveStatus').textContent = '编辑中 · 尚未保存到服务器';
  draftTimer = setTimeout(flushDraft, 450);
}
window.addEventListener('pagehide', () => flushDraft());
document.addEventListener('visibilitychange', () => { if (document.hidden) flushDraft(); });
function showButtons() {
  $('buttons').innerHTML = buttons.map((b,i) => `<div class="button-editor" data-index="${i}"><div class="section-title"><strong>按钮 ${i+1}</strong><button data-remove="${i}" class="quiet danger-text">删除</button></div><label>按钮文字<input data-field="text" value="${esc(b.text)}" maxlength="64" placeholder="留空 = 仅显示专属表情"></label><label>跳转链接<input data-field="url" value="${esc(b.url)}" placeholder="https://t.me/…"></label><div class="grid"><label>颜色<select data-field="style">${[['default','默认'],['primary','蓝色'],['success','绿色'],['danger','红色']].map(([v,t])=>`<option value="${v}" ${b.style===v?'selected':''}>${t}</option>`).join('')}</select></label><label>行号<input data-field="row" type="number" min="1" max="12" value="${b.row+1}"></label></div><button data-emoji="${i}" class="quiet">${esc(b.iconAlt || '✦')} ${b.iconId ? '更换专属表情' : '选择专属表情'}</button>${b.iconId?`<button data-clear="${i}" class="quiet">移除表情</button>`:''}</div>`).join('') || '<p class="muted">暂未添加跳转按钮</p>';
  preview();
}
$('buttons').addEventListener('input', event => { const wrap = event.target.closest('[data-index]'); if (!wrap || !event.target.dataset.field) return; const field = event.target.dataset.field; buttons[Number(wrap.dataset.index)][field] = field === 'row' ? Number(event.target.value)-1 : event.target.value; remember(); preview(); });
$('buttons').addEventListener('click', event => { if (event.target.dataset.remove !== undefined) { buttons.splice(Number(event.target.dataset.remove),1); showButtons(); remember(); } if (event.target.dataset.emoji !== undefined) openPicker(Number(event.target.dataset.emoji)); if (event.target.dataset.clear !== undefined) { Object.assign(buttons[Number(event.target.dataset.clear)], { iconId:'',iconAlt:'',iconThumbId:'' }); showButtons(); remember(); } });
$('addButton').onclick = () => { if (buttons.length >= 12) return toast('最多添加 12 个按钮'); buttons.push({text:'立即进入',url:'https://t.me/',style:'default',row:buttons.length,iconId:'',iconAlt:''}); showButtons(); remember(); };
function preview() {
  previewDirty = true; clearTimeout(previewTimer);
  if ($('previewPanel').open) previewTimer = setTimeout(renderPreview, 100);
}
$('previewPanel').addEventListener('toggle', () => {
  clearTimeout(previewTimer);
  if ($('previewPanel').open && previewDirty) renderPreview();
});
function renderPreview() {
  if (!$('previewPanel').open) return;
  previewDirty = false;
  const container = $('preview'); container.replaceChildren();
  if (imageUrl) { const img = document.createElement('img'); img.src = imageUrl; img.alt = '消息图片'; container.append(img); }
  const text = document.createElement('div'); text.className='preview-text';
  for (const op of quill.getContents().ops) { let node = document.createElement('span'); const custom = op.insert?.customEmoji; node.textContent = typeof op.insert === 'string' ? op.insert : custom?.alt || ''; const a = op.attributes || {}; if (custom) { node.className='custom-emoji'; node.dataset.emojiId=custom.id; node.dataset.thumbId=custom.thumbId || ''; } if (a.bold) node.style.fontWeight='700'; if (a.italic) node.style.fontStyle='italic'; if (a.underline) node.style.textDecoration='underline'; if (a.link) { const link=document.createElement('a'); link.textContent=node.textContent; link.href=/^(https:|tg:)/i.test(a.link)?a.link:'#'; link.target='_blank'; link.rel='noopener noreferrer'; node=link; } text.append(node); } container.append(text);
  const rows = new Map(); for (const b of buttons) { const row=rows.get(b.row)||[]; row.push(b); rows.set(b.row,row); }
  for (const [,row] of [...rows].sort(([a],[b])=>a-b)) { const div=document.createElement('div'); div.className='preview-row'; for(const b of row) { const span=document.createElement('span'); span.className=`preview-button ${b.style}`; span.textContent=b.iconId ? (b.text ? `${b.iconAlt || ''} ${b.text}`.trim() : (b.iconAlt || '✦')) : (b.text || ''); if (b.iconId) { span.dataset.emojiId=b.iconId; span.dataset.thumbId=b.iconThumbId || ''; span.dataset.emojiOnly=b.text ? '0' : '1'; span.dataset.label=b.text || '';  } div.append(span); } container.append(div); } hydrateEmojiImages(container);
}
function hydrateEmojiImages(container) {
  for (const node of container.querySelectorAll('[data-thumb-id]')) {
    const id = node.dataset.thumbId, emoji = node.dataset.emojiId || node.dataset.id;
    if ((!id && !emoji) || node.dataset.loaded === '1' || node.dataset.loaded === 'unavailable') continue;
    node.dataset.loaded = '1';
    const query = (id ? 'id=' + encodeURIComponent(id) : '') + (emoji ? `${id ? '&' : ''}emoji=` + encodeURIComponent(emoji) : '');
    stickerImage('/sticker-image?' + query).then(url => {
      displayImage(node, url, node.dataset.alt || '', node.dataset.label || '');
    }).catch(error => { if (error?.status === 404) node.dataset.loaded = 'unavailable'; else delete node.dataset.loaded; });
  }
}
function closePicker() {
  stopDeleting();
  $('emojiDialog').close();
  document.body.classList.remove('emoji-open', 'emoji-body-open');
  quill.root.removeAttribute('inputmode');
  $('bodyEmoji').setAttribute('aria-expanded', 'false');
}
function openPicker(target) {
  if ($('emojiDialog').open && pickerTarget === target) { closePicker(); return; }
  const caret = savedRange ? { ...savedRange } : null;
  stopDeleting();
  pickerTarget = target;
  $('emojiBackspace').hidden = target !== 'body';
  document.body.classList.add('emoji-open');
  document.body.classList.toggle('emoji-body-open', target === 'body');
  quill.root.setAttribute('inputmode', 'none');
  if (!$('emojiDialog').open) $('emojiDialog').show();
  $('bodyEmoji').setAttribute('aria-expanded', String(target === 'body')); loadSavedPacks().catch(error=>toast(error.message,true));
  if (target === 'body') {
    // Opening the non-modal dialog may focus its controls; restore the caret.
    const at = Math.min(caret?.index ?? quill.getLength()-1, quill.getLength()-1);
    const length = Math.min(caret?.length || 0, quill.getLength()-1-at);
    quill.setSelection(at, length, 'silent'); savedRange = { index:at, length };
  }
}
$('bodyEmoji').addEventListener('pointerdown', () => { const range=quill.getSelection(); if(range) savedRange={...range}; });
$('bodyEmoji').onclick = () => {const range=savedRange?{...savedRange}:null;if(!quill.isEnabled())quill.enable(true);$('toggleWriting').textContent='完成编辑';openPicker('body');if(range){quill.setSelection(range.index,range.length,'silent');savedRange=range;}}; $('closeEmoji').onclick = closePicker;
$('emojiDialog').addEventListener('keydown', event => { if (event.key === 'Escape') closePicker(); });
// Keep clicking an emoji from stealing the editor selection; scrolling stays native.
$('emojiGrid').addEventListener('mousedown', event => { if (event.target.closest('.emoji-choice')) event.preventDefault(); });
let deleteTimer, deletePointer = null;
function deleteAtCaret() {
  if (!$('emojiDialog').open || pickerTarget !== 'body') return;
  // Dialog controls can leave Quill's live selection stale immediately after an embed insert.
  const range = insertedEmbedPending ? savedRange : quill.getSelection() || savedRange;
  if (!range) return;
  const remove = deletionRange(quill.getContents().ops, range);
  if (!remove.length) return;
  quill.deleteText(remove.index, remove.length, 'user');
  quill.setSelection(remove.index, 0, 'silent'); savedRange = { index:remove.index, length:0 }; insertedEmbedPending=false;
}
function stopDeleting() {
  clearTimeout(deleteTimer);
  if (deletePointer !== null) quill.history.cutoff();
  deletePointer = null;
}
const backspace = $('emojiBackspace');
backspace.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  event.preventDefault(); stopDeleting(); quill.history.cutoff();
  deletePointer = event.pointerId; backspace.setPointerCapture(event.pointerId);
  deleteAtCaret();
  const repeat = () => { if (deletePointer === null) return; deleteAtCaret(); deleteTimer = setTimeout(repeat, 90); };
  deleteTimer = setTimeout(repeat, 450);
});
for (const name of ['pointerup','pointercancel','lostpointercapture']) backspace.addEventListener(name, stopDeleting);
backspace.addEventListener('click', event => { if (event.detail === 0) { quill.history.cutoff(); deleteAtCaret(); quill.history.cutoff(); } });
backspace.addEventListener('contextmenu', event => event.preventDefault());
window.addEventListener('blur', stopDeleting);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopDeleting(); });
const stickers = new Map();
let visibleStickers = 0;
function appendEmojiBatch() {
  const batch = [...stickers.values()].slice(visibleStickers, visibleStickers + 24);
  for (const sticker of batch) {
    const button = document.createElement('button'); button.className = 'emoji-choice';
    button.dataset.emojiId = sticker.id; button.textContent = sticker.alt; button.title = sticker.id;
    button.onclick = () => {
      button.classList.add('selected');
      if (pickerTarget === 'body') {
        const at = Math.min(savedRange?.index ?? quill.getLength()-1, quill.getLength()-1);
        quill.insertEmbed(at, 'customEmoji', { id:sticker.id, alt:sticker.alt, thumbId:sticker.thumbnailId || '' }, 'user');
        quill.setSelection(at+1, 0); savedRange = { index:at+1, length:0 }; insertedEmbedPending=true; hydrateEmojiImages(quill.root);
      } else if (buttons[pickerTarget]) {
        Object.assign(buttons[pickerTarget], { iconId:sticker.id, iconAlt:sticker.alt, iconThumbId:sticker.thumbnailId || '' });
        showButtons(); remember();
      } else return;
      rememberRecentEmoji(sticker);
    };
    $('emojiGrid').append(button);
    if (sticker.thumbnailId || sticker.id) stickerImage('/sticker-image?' + (sticker.thumbnailId ? 'id=' + encodeURIComponent(sticker.thumbnailId) + '&' : '') + 'emoji=' + encodeURIComponent(sticker.id))
      .then(url => displayImage(button, url, sticker.alt)).catch(error => { if (error?.status === 404) button.dataset.imageState = 'unavailable'; });
  }
  visibleStickers += batch.length;
  queueMoreEmoji();
}
let emojiScrollFrame;
function queueMoreEmoji() {
  cancelAnimationFrame(emojiScrollFrame);
  emojiScrollFrame = requestAnimationFrame(() => {
    const grid = $('emojiGrid');
    if ($('emojiDialog').open && grid.clientHeight > 0 && visibleStickers < stickers.size
        && grid.scrollHeight - grid.scrollTop - grid.clientHeight < 80) appendEmojiBatch();
  });
}
$('emojiGrid').addEventListener('scroll', queueMoreEmoji, { passive:true });
new ResizeObserver(queueMoreEmoji).observe($('emojiGrid'));
const loadedPacks = new Map();
function displayPack(pack) {
  cancelAnimationFrame(emojiScrollFrame);
  stickers.clear(); visibleStickers = 0; $('emojiGrid').replaceChildren(); $('emojiGrid').scrollTop = 0;
  for (const sticker of pack.stickers) stickers.set(sticker.id, sticker);
  $('packTitle').textContent = pack.title + ' · ' + stickers.size + ' 个';
  $('packSettings').open = false;
  appendEmojiBatch();
}
$('packHistory').onchange = () => displayPack(loadedPacks.get($('packHistory').value));
$('savedPackTabs').addEventListener('click', e => {
  if (e.target.dataset.recent) return displayPack({ title:'最近使用', stickers:recentEmojis });
  const i = e.target.dataset.packIndex;
  if (i !== undefined) displayPack(savedPacks[Number(i)]);
});
$('savePack').onclick=event=>action(async()=>{const key=$('pack').value.trim();const name=key.split('/').filter(Boolean).pop();const pack=loadedPacks.get(key);if(!pack)throw new Error('请先加载表情包');await api('/sticker-packs/saved','POST',{name,title:pack.title,stickers:pack.stickers});await loadSavedPacks();toast('表情包已保存');},event.currentTarget);
$('loadPack').onclick = event => action(async () => {
  const key = $('pack').value.trim();
  const pack = loadedPacks.get(key) || await api('/sticker-packs', 'POST', { pack:key });
  loadedPacks.delete(key); loadedPacks.set(key, pack);
  if (loadedPacks.size > 8) loadedPacks.delete(loadedPacks.keys().next().value);
  $('packHistory').replaceChildren(...[...loadedPacks].map(([value, item]) => new Option(item.title, value)));
  $('packHistory').value = key; $('packHistory').hidden = loadedPacks.size < 2;
  displayPack(pack); $('pack').blur();
}, event.currentTarget);
$('photo').onchange = event => action(async () => { const file=event.target.files[0]; if(!file)return; const form=new FormData(); form.set('image',file); const media=await api('/media','POST',form); mediaId=media.id; replacePhoto(await authenticatedImage(`/media/${mediaId}?preview=1`).catch(() => { toast('图片已上传，缩略图暂不可用', true); return ''; })); showPhoto(); remember(); },event.currentTarget);
function showPhoto() { $('photoBox').hidden=!mediaId; $('photoPreview').src=imageUrl; $('textCount').textContent=`${quill.getText().trimEnd().length} / ${mediaId?1024:4096}`; preview(); }
$('removePhoto').onclick = () => {mediaId=null;replacePhoto();$('photo').value='';showPhoto();remember();};
function populateTargets(selected = []) { $('targetChecks').innerHTML=data.targets.map(t=>`<label class="check"><input type="checkbox" name="target" value="${t.id}" ${selected.includes(t.id)?'checked':''} ${t.can_publish?'':'disabled'}><span>${esc(t.title)}<small>${esc(t.last_error || t.chat_id)}</small></span></label>`).join('')||'<p class="muted">请先在「设置」中添加群或频道。</p>'; }
async function refresh() { const selected=[...document.querySelectorAll('[name=target]:checked')].map(x=>Number(x.value)); data=await api('/bootstrap'); $('identity').textContent=data.publisher?`@${data.publisher.username} · 发布工作台`:'先在设置中配置发布机器人'; $('publisher').textContent=data.publisher?`当前：@${data.publisher.username}（${data.publisher.id}）`:'尚未配置'; $('adminInfo').textContent=`${data.admin.name} · ID ${data.admin.id}`; $('publisherSelect').innerHTML=data.publishers.length?data.publishers.map(p=>`<option value="${esc(p.id)}">@${esc(p.username||p.id)}</option>`).join(''):'<option value="">尚未配置发布机器人</option>'; $('publisherSelect').value=data.publisher?.id||''; $('publisherSelect').disabled=!data.publishers.length; $('ffaCard').hidden=!data.publisher?.legacy; $('syncPlayers').hidden=!data.publisher?.legacy; $('importPlayers').hidden=!data.publisher?.legacy; populateTargets(selected); $('targets').innerHTML=data.targets.map(t=>`<div class="list-row"><div><strong>${esc(t.title)}</strong><small>${esc(t.chat_id)} · ${t.can_publish?'已具备权限':esc(t.last_error)}</small></div><button class="quiet danger-text" data-delete-target="${t.id}">删除</button></div>`).join(''); showTasks(); }
async function switchPublisher(id) {
  if (savePromise) throw new Error('正在保存活动，请稍后切换机器人');
  flushDraft();
  selectedPublisherId=id;
  selectedPlayerIds.clear(); playerCache.clear(); playerPage=1; savedPacks=[]; pendingSend=null;
  await refresh();
  let draft; try { draft=JSON.parse(localStorage.getItem(draftKey())||'null'); } catch { draft=null; }
  await fill(draft||{});
  await loadPlayers(); await loadRuns();
  if (data.publisher?.legacy) await loadFfaStatus();
}
$('publisherSelect').onchange=event=>action(async()=>{await switchPublisher(event.target.value);toast('已切换发布机器人');},event.currentTarget);
function showTasks() {
  $('taskList').innerHTML = data.tasks.map(t => {
    const stopped = t.status === 'STOPPED', timed = JSON.parse(t.schedule_json).kind !== 'MANUAL';
    const controls = stopped
      ? `<button class="quiet" data-task="${t.id}" data-action="activate">重新开始</button>`
      : `<button class="quiet" data-send-task="${t.id}">立即发布</button>${timed && t.status !== 'COMPLETED' ? `<button class="quiet" data-task="${t.id}" data-action="${t.status === 'ACTIVE' ? 'pause' : 'activate'}">${t.status === 'ACTIVE' ? '暂停' : '启用 / 恢复'}</button>` : ''}${['ACTIVE','PAUSED'].includes(t.status) ? `<button class="quiet danger-text" data-task="${t.id}" data-action="stop">停止</button>` : ''}`;
    return `<article class="card"><div class="section-title"><h3>${esc(t.name)}</h3><span class="status ${t.status}">${labels[t.status]}</span></div><p class="muted">下次：${fmt(t.next_at)}</p><div class="wrap-actions"><button class="quiet" data-edit="${t.id}">编辑</button>${controls}<button class="quiet danger-text" data-delete-task="${t.id}">删除</button></div></article>`;
  }).join('') || '<div class="card center muted">还没有发布任务</div>';
}
async function fill(item) { closePicker();quill.enable(false);$('toggleWriting').textContent='编辑文案'; clearTimeout(draftTimer); draftDirty=false; serverSnapshot=null; ready=false; taskId=item.taskId || null; $('name').value=item.name||''; quill.setContents(item.delta || {ops:[{insert:'\n'}]}); hydrateEmojiImages(quill.root); buttons=item.buttons||[];mediaId=item.mediaId||null; replacePhoto();if(mediaId)replacePhoto(await authenticatedImage(`/media/${mediaId}?preview=1`).catch(()=> '')); const s=item.schedule||{kind:'MANUAL'}; $('kind').value=s.kind;$('start').value=s.start||'01:00';$('end').value=s.end||'05:00';$('interval').value=s.interval||30;$('unit').value='1';$('at').value=s.at?new Date(s.at+8*3600000).toISOString().slice(0,16):'';populateTargets(item.targetIds||[]);$('editorTitle').textContent=taskId?`编辑活动 #${taskId}`:'新建活动';showButtons();showPhoto();scheduleFields();ready=true; $('saveStatus').textContent=item.taskId || item.name ? '已恢复本机草稿 · 请保存到服务器' : '内容尚未保存到服务器'; }
let savePromise;
function save() {
  if (savePromise) return savePromise;
  savePromise = (async () => {
    flushDraft(); const payload = collect(), snapshot = JSON.stringify(payload);
    $('saveStatus').textContent = '正在保存到服务器…';
    // Prevent switching documents while this response assigns its task ID.
    $('reset').disabled = true;
    try {
      const result = await api(taskId ? '/tasks/' + taskId : '/tasks', taskId ? 'PUT' : 'POST', payload);
      taskId = result.id; serverSnapshot = snapshot;
      $('editorTitle').textContent = '编辑活动 #' + taskId;
      flushDraft(true); await refresh(); return taskId;
    } catch (error) { $('saveStatus').textContent = '服务器保存失败 · 请重试'; throw error; }
    finally { $('reset').disabled = false; }
  })().finally(() => { savePromise = null; });
  return savePromise;
}
async function sendTask(id) { if(!pendingSend || pendingSend.id!==id) pendingSend={id,key:crypto.randomUUID()}; const result=await api(`/tasks/${id}/send`,'POST',{requestKey:pendingSend.key});pendingSend=null;toast(`已加入发送队列，记录 #${result.runId}`); }
$('save').onclick = event => action(async()=>{await save();toast('已保存');},event.currentTarget);
$('send').onclick = event => action(async()=>{await sendTask(await save());},event.currentTarget);
$('activate').onclick = event => action(async()=>{const id=await save();await api(`/tasks/${id}/status`,'POST',{action:'activate'});await refresh();toast('定时已启用');changeTab('tasks');},event.currentTarget);
$('reset').onclick = () => action(async()=>{if(ready&&!confirm('新建空白活动？当前未保存的编辑会被清空。'))return;await fill({});flushDraft(true);});
$('taskList').onclick = event => action(async () => {
  const b = event.target;
  if (b.dataset.edit) {
    if (savePromise) return toast('正在保存，请稍后切换活动');
    const t = await api(`/tasks/${b.dataset.edit}`);
    await fill({ taskId:t.id, name:t.name, delta:{ops:JSON.parse(t.delta_json)}, buttons:JSON.parse(t.buttons_json), mediaId:t.media_id, targetIds:JSON.parse(t.target_ids_json), schedule:JSON.parse(t.schedule_json) });
    serverSnapshot = JSON.stringify(collect()); flushDraft(true); changeTab('editor');
  }
  if (b.dataset.task) {
    if (b.dataset.action === 'stop' && !confirm('停止后保留内容，可以重新开始。排队消息会取消，已经发出的消息保留。确定停止？')) return;
    const task = await api(`/tasks/${b.dataset.task}/status`, 'POST', { action:b.dataset.action });
    await refresh();
    if (b.dataset.action === 'activate') toast(task.status === 'DRAFT' ? '已重新开始，可点击立即发布' : '已启用，从下个发布时间继续');
  }
  if (b.dataset.deleteTask) {
    const id = Number(b.dataset.deleteTask);
    if (!confirm('确定删除此任务及其发布记录？已发布的 Telegram 消息不会删除。运行中的任务请先停止。')) return;
    await api(`/tasks/${id}`, 'DELETE');
    if (taskId === id) { await fill({}); flushDraft(true); pendingSend = null; }
    await refresh(); toast('任务已删除');
  }
  if (b.dataset.sendTask) await sendTask(Number(b.dataset.sendTask));
}, event.target);
$('saveFfaToken').onclick = event => action(async()=>{await api('/ffa/token','POST',{token:$('ffaToken').value});$('ffaToken').value='';$('ffaStatus').textContent='Token 已验证并保存';toast('发发娱乐接口已连接');},event.currentTarget);
$('savePublisher').onclick = event => action(async()=>{const result=await api('/publisher','POST',{token:$('token').value});$('token').value='';await switchPublisher(result.id);toast('发布机器人已验证并保存');},event.currentTarget);
$('addTarget').onclick = event => action(async()=>{const t=await api('/targets','POST',{reference:$('targetRef').value});$('targetRef').value='';await refresh();toast(t.can_publish?'目标已添加':t.last_error,!t.can_publish);},event.currentTarget);
$('targets').onclick = event => action(async()=>{const id=event.target.dataset.deleteTarget;if(id&&confirm('删除该目标？引用它的任务将跳过此目标。')){await api(`/targets/${id}`,'DELETE');await refresh();}},event.target);
async function loadRuns() { const runs=await api('/runs');$('runList').innerHTML=runs.map(r=>`<details class="card" data-run="${r.id}"><summary><strong>${esc(r.name)}</strong><span class="muted">${fmt(r.created_at)}</span></summary><p>成功 ${r.success_count||0} / ${r.total} · 失败 ${r.failed_count||0} · 待核实 ${r.unknown_count||0}</p><div class="run-detail"><button class="quiet" data-run-detail="${r.id}">查看各目标结果</button></div></details>`).join('')||'<div class="card center muted">还没有发布记录</div>'; }
$('runList').onclick = event => action(async()=>{const id=event.target.dataset.runDetail;if(!id)return;await openSent('runs',id);},event.target);
$('refreshTasks').onclick=event=>action(refresh,event.currentTarget);$('refreshLogs').onclick=event=>action(loadRuns,event.currentTarget); updatePlayerSelection(); async function loadFfaStatus(){const r=await api('/ffa');$('ffaStatus').textContent=r.configured?`已配置：${r.baseUrl}`:`未配置（接口：${r.baseUrl}）`;}
$('editor').addEventListener('input', event => { if (!event.target.closest('#message, #buttons')) remember(); });$('kind').onchange=()=>{scheduleFields();remember();};
async function boot() { if(!initData){$('locked').hidden=false;return;}try{await refresh();if(data.publisher?.legacy)await loadFfaStatus();$('workspace').hidden=false;let draft;try{draft=JSON.parse(localStorage.getItem(draftKey())||'null');}catch{}await fill(draft||{});if(!data.publisher)changeTab('settings');}catch(error){$('locked').hidden=false;$('authError').textContent=error.message;} }
boot();

let viewportFrame;
function updateViewport() {
  cancelAnimationFrame(viewportFrame);
  viewportFrame = requestAnimationFrame(() => {
    const viewport = window.visualViewport;
    const inset = viewport && viewport.scale === 1 ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
    document.documentElement.style.setProperty('--keyboard-inset', inset + 'px');
    document.documentElement.style.setProperty('--visible-top', (viewport?.offsetTop || 0) + 'px');
    document.documentElement.style.setProperty('--visible-height', (viewport?.height || window.innerHeight) + 'px');
  });
}
window.visualViewport?.addEventListener('resize', updateViewport);
window.visualViewport?.addEventListener('scroll', updateViewport);
updateViewport();

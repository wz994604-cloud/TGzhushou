import Quill from 'quill';
import { deletionRange } from './editor-delete.js';
import { createImageLoader } from './image-loader.js';
import { installLinkEditor } from './link-editor.js';
import 'quill/dist/quill.snow.css';
import './style.css';
import './mini-ios-glass.css';
import './desktop.css';
import './macos-tokens.css';
import './macos-desktop.css';
import './login.css';
import { initDesktopShell } from './desktop-bridge.js';
import { mountWorkbench } from './workbench-shell.js';
import { defaultButtonRow, normalizeButtonRows, reflowAutomaticButtonRows, emojiPopoverPosition, emojiMatches } from './workbench-utils.js';
import { installSentEditor } from './sent-editor.js';
import { createApiClient } from './api-client.js';

await initDesktopShell();
const tg = window.Telegram?.WebApp;
tg?.ready(); tg?.expand();
document.documentElement.classList.toggle("tg-mini-app", Boolean(tg?.initData));
const initData = tg?.initData || '';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const fmt = value => value ? new Date(value).toLocaleString('zh-CN', { timeZone:'Asia/Shanghai', hour12:false }) : '—';
const labels = { DRAFT:'草稿', ACTIVE:'运行中', PAUSED:'已暂停', STOPPED:'已停止', COMPLETED:'已完成', SUCCESS:'成功', FAILED:'失败', UNKNOWN:'待核实', PENDING:'排队中', SENDING:'发送中', CANCELLED:'已取消', EDITED:'已编辑', DELETED:'已删除', RUNNING:'发送中' };
let data, taskId = null, buttons = [], mediaId = null, imageUrl = '', pickerTarget = null, savedRange = null, pendingSend = null, ready = false, insertedEmbedPending = false;
let activePack=null,publisherChanging=false;
let assetItems = [], mediaInfo=null, assetFilter='all', pickerAnchor=null, emojiHoverTimer, pickerOpenedByHover=false;
let playerConversations=[],lastEditorTarget='body';
let selectedPublisherId = localStorage.getItem('tgzhushou:selected-publisher') || '';
let publisherRevision=0, playerLoadSequence=0, pendingPlayerImport=null;
let chatQuill, chatRange = null, activeChat = null, chatCursor = 0, chatButtons = [], chatMedia = null, chatReply = null, chatPolling, hiddenPollTicks = 0, chatRows = [], chatOlderCursor = null, conversationRows = [], conversationNext = null, conversationLoadSequence=0;
let assetIntent=null;
let draftDirty = false, draftTimer, previewTimer, previewDirty = true, serverSnapshot = null;
const playerCache = new Map();
let playerPage = 1;
let selectedPlayerIds = new Set(), savedPacks = [], recentEmojis = [];
const recentEmojiKey = 'tgzhushou:recent-emojis:v1';
const apiRuntime = globalThis.__TGZ_API_CONFIG__ && typeof globalThis.__TGZ_API_CONFIG__ === 'object' ? globalThis.__TGZ_API_CONFIG__ : {};
const client = createApiClient({
  initData,
  getPublisherId: () => selectedPublisherId,
  mode: tg?.initData ? 'serverless' : 'railway',
  baseUrl: tg?.initData ? (apiRuntime.serverlessBase || '') : (apiRuntime.railwayBase || ''),
  fallbackBaseUrl: apiRuntime.fallbackBaseUrl || '',
});
const { api } = client;
const loadImage = createImageLoader(client.image);
const draftKey = () => `tgzhushou:draft:${selectedPublisherId || 'none'}:v2`;
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
  const bot=selectedPublisherId,r = await api('/sticker-packs/saved');if(bot!==selectedPublisherId)return;
  savedPacks = r.packs || []; renderSavedPackTabs();renderAssetPacks();
}
function toast(message, error = false) { $('toast').textContent = message; $('toast').className = error ? 'toast error' : 'toast'; $('toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').hidden = true, 6000); }
async function action(fn, button) { if (button?.disabled) return; if (button) button.disabled = true; try { await fn(); } catch (error) { toast(error.message, true); } finally { if (button) button.disabled = false; } }
async function authenticatedImage(url) { return URL.createObjectURL(await loadImage(url)); }
async function loadConversationAvatars() {
  for (const img of document.querySelectorAll('#chatConversations [data-avatar-path]')) {
    if (!img.dataset.avatarPath) { img.remove(); continue; }
    try {
      const url = URL.createObjectURL(await loadImage(img.dataset.avatarPath));
      if (!img.isConnected) { URL.revokeObjectURL(url); continue; }
      img.onload = img.onerror = () => { if (!img.naturalWidth) img.remove(); URL.revokeObjectURL(url); };
      img.src = url; img.hidden = false;
    } catch { img.remove(); }
  }
}
async function loadRailBotAvatars() {
  for (const button of document.querySelectorAll('#railBots .rail-bot')) {
    try {
      const botId = button.dataset.botId;
      const url = URL.createObjectURL(await client.image(`/chat/bot-avatars/${encodeURIComponent(botId)}`));
      if (!button.isConnected) { URL.revokeObjectURL(url); continue; }
      const img = document.createElement('img'); img.alt = ''; img.onload = img.onerror = () => { if (!img.naturalWidth) img.remove(); URL.revokeObjectURL(url); };
      img.src = url; button.append(img);
    } catch { /* A missing or unavailable photo keeps the initial visible. */ }
  }
}
function replacePhoto(url = '') { if (imageUrl) URL.revokeObjectURL(imageUrl); imageUrl = url; }
function displayImage(node, url, alt, label = '') {
  if (!node?.isConnected) { URL.revokeObjectURL(url); return; }
  const img = document.createElement('img'); img.alt = ''; img.setAttribute('aria-hidden', 'true');
  img.onload = () => { node.dataset.imageState = 'ready'; URL.revokeObjectURL(url); };
  img.onerror = () => { node.dataset.imageState = 'error'; URL.revokeObjectURL(url); };
  img.src = url; node.replaceChildren(img, ...(label ? [document.createTextNode(' ' + label)] : []));
}
function setEmojiState(node, state, label = '') {
  node.dataset.imageState = state;
  if (label) { node.dataset.alt = label; node.dataset.label = label; node.setAttribute('aria-label', label); node.title = label; }
  if (state === 'loading') node.replaceChildren();
  if (state === 'error') node.replaceChildren();
}

$('app').innerHTML = `<header class="app-header"><div class="brand-icon" aria-hidden="true"><svg viewBox="0 0 48 48" role="presentation"><path d="M24 5 28.2 19.8 43 24l-14.8 4.2L24 43l-4.2-14.8L5 24l14.8-4.2L24 5Z" fill="currentColor"/><circle cx="37" cy="11" r="3" fill="currentColor" opacity=".72"/><circle cx="11" cy="37" r="3" fill="currentColor" opacity=".72"/></svg></div><div class="brand-copy"><span class="eyebrow">运营工作台</span><h1>活动中枢</h1><p id="identity">Telegram 活动发布工作台</p></div><div class="header-meta"><span class="online-dot" aria-hidden="true"></span><span class="chip">北京时间</span></div></header>
<div id="locked" class="login-shell" hidden><div class="login-card"><div class="login-brand"><span class="login-brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" role="presentation"><path d="M21.6 2.4 10.9 13.1M21.6 2.4 15 21.6l-4.1-8.5L2.4 9l19.2-6.6Z" fill="none" stroke="rgba(255,255,255,.94)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span><strong>TG助手</strong><small>Telegram 运营工作台</small></span></div><h2>登录 TG助手</h2><p class="login-intro">使用管理员账号密码进入活动中枢</p><form id="loginForm" class="login-form" novalidate><label for="loginUsername">账号<div class="login-field"><span aria-hidden="true">♙</span><input id="loginUsername" autocomplete="username" required></div></label><label for="loginPassword">密码<div class="login-field"><span aria-hidden="true">▣</span><input id="loginPassword" type="password" autocomplete="current-password" required><button id="toggleLoginPassword" type="button" aria-label="显示密码">◉</button></div></label><button id="loginSubmit" class="primary login-submit" type="submit">登录</button></form><p id="authError" class="login-error" role="alert"></p><p class="login-hint">也可以继续使用 Telegram 入口机器人发送 <code>/login</code>。</p></div><p class="login-footer">集中管理消息、活动与发布任务</p></div>
<main id="workspace" hidden>
<aside class="app-rail" aria-label="机器人和功能"><div class="rail-brand" aria-label="活动中枢"><span class="rail-brand-mark" aria-hidden="true">✦</span><span class="rail-brand-copy"><strong>活动中枢</strong><small>运营工作台</small></span></div><button class="rail-menu" aria-label="菜单" type="button">☰</button><div id="railBots" class="rail-bots"></div><div class="rail-nav"><button data-rail-tab="chat" aria-label="聊天" title="聊天"><span class="nav-glyph">◌</span><span class="nav-label">聊天</span></button><button data-rail-tab="editor" aria-label="编写活动" title="编写活动"><span class="nav-glyph">✎</span><span class="nav-label">编写活动</span></button><button data-rail-tab="assets" aria-label="素材管理" title="素材管理"><span class="nav-glyph">▧</span><span class="nav-label">素材管理</span></button><button data-rail-tab="players" aria-label="联系人 / 用户" title="联系人 / 用户"><span class="nav-glyph">♙</span><span class="nav-label">联系人 / 用户</span></button><button data-rail-tab="tasks" aria-label="自动化任务" title="自动化任务"><span class="nav-glyph">☷</span><span class="nav-label">自动化任务</span></button><button data-rail-tab="logs" aria-label="发布记录" title="发布记录"><span class="nav-glyph">◷</span><span class="nav-label">发布记录</span></button><button data-rail-tab="settings" aria-label="系统设置" title="系统设置"><span class="nav-glyph">⚙</span><span class="nav-label">系统设置</span></button></div><div class="rail-account"><strong>管理员</strong><small id="railAccountId">工作区账号</small></div></aside>
<div class="publisher-switch"><label for="publisherSelect">当前发布机器人</label><select id="publisherSelect" aria-label="当前发布机器人"></select></div>
<nav aria-label="功能导航"><button data-tab="chat" class="active">聊天</button><button data-tab="editor">编写活动</button><button data-tab="assets">素材管理</button><button data-tab="players">用户</button><button data-tab="tasks">自动化任务</button><button data-tab="logs">发布记录</button><button data-tab="settings">系统设置</button></nav>
<section id="chat" class="page"><div class="chat-shell"><aside class="chat-list"><div class="section-title"><h2>会话</h2><span id="chatUnread" class="status">0 未读</span></div><input id="chatSearch" aria-label="搜索会话" placeholder="搜索会话"><div id="inboxStatus" class="hint"></div><button id="enableInbox" class="quiet" hidden>启用收消息</button><div id="chatConversations"></div><button id="chatMore" class="quiet" hidden>加载更多会话</button></aside><div class="chat-main"><div id="chatHeader" class="chat-head"><button id="chatBack" class="chat-back" type="button" aria-label="返回会话列表" title="返回会话列表">‹</button><span id="chatTitle">请选择会话</span><button id="mobileBotSwitch" class="mobile-bot-switch" type="button" aria-label="切换机器人" title="切换机器人"></button></div><button id="chatOlder" class="quiet" hidden>加载更早消息</button><div id="chatMessages" class="chat-messages"></div><div id="chatComposer" hidden><div id="chatReply" class="hint" hidden><span id="chatReplyText"></span><button id="cancelChatReply" type="button" class="quiet" aria-label="取消回复">取消回复</button></div><div id="chatToolbar"><button class="ql-bold" title="加粗"></button><button class="ql-italic" title="斜体"></button><button class="ql-underline" title="下划线"></button><button class="ql-clean" title="清除格式"></button></div><div id="chatInput"></div><div class="chat-tools"><button id="chatEmoji" class="quiet" title="打开表情键盘" aria-label="打开表情键盘">✦ 表情</button><button id="chatLink" class="quiet" title="添加链接" aria-label="添加链接">链接</button><button id="chatAddButton" class="quiet" title="添加按钮" aria-label="添加按钮">＋ 按钮</button><label class="file-button quiet" title="添加附件">附件<input id="chatFile" type="file" accept="image/*,video/mp4,video/webm,.pdf,.txt,.zip,.docx,.xlsx" hidden></label><button id="chatSend" class="primary" title="发送消息">发送</button></div><div id="chatButtons"></div><p id="chatMedia" class="hint"></p><p id="chatSendStatus" class="hint" role="status"></p></div></div></div></section>
<section id="assets" class="page" hidden>
<div class="section-title"><div><h2>素材管理</h2><p>复用本次上传的图片、视频、文件和已保存的 Telegram 专属表情。</p></div><button id="openAssetEditor" class="primary" type="button">去编写活动</button></div>
<div class="card asset-upload-card"><div><h3>上传素材</h3><p class="hint">支持图片、视频和常用文件，单个不超过 20 MB。上传后可在聊天或活动编辑中复用。</p></div><label class="file-button primary asset-upload-button">选择文件<input id="assetUpload" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,application/pdf,text/plain,application/zip,.docx,.xlsx" multiple hidden></label></div>
<div id="assetFilters" class="task-filters" aria-label="素材类型"><button data-asset-filter="all" class="active">全部</button><button data-asset-filter="image">图片</button><button data-asset-filter="video">视频</button><button data-asset-filter="file">文件</button><button data-asset-filter="emoji">专属表情</button></div><p class="hint">媒体列表仅包含本次打开页面后上传的素材；上传文件已保存到服务器，但历史媒体列表尚未接入。</p><div id="assetList" class="asset-grid"><div class="empty-state"><strong>还没有素材</strong><br>上传后，真实返回的媒体 ID 和类型会显示在这里；系统没有媒体列表接口时不会伪造历史数据。</div></div>
<div class="card asset-emoji-card"><div><h3>Telegram 专属表情</h3><p class="hint">从已保存表情包选择，或添加 t.me/addemoji 链接。仅提供专属表情，不包含普通 Emoji / GIF。</p></div><button id="openAssetEmoji" class="quiet" type="button">添加 / 选择专属表情</button></div><div id="assetPacks" class="asset-grid"></div>
</section><section id="editor" class="page" hidden>
<div class="section-title"><div><h2 id="editorTitle">新建活动</h2><p id="saveStatus" role="status">内容尚未保存到服务器</p></div><button id="reset" class="quiet">新建</button></div>
<div class="card"><label>活动名称<input id="name" maxlength="100" placeholder="例如：每日活动介绍"></label><div id="composeArea"><label>消息内容</label><button id="toggleWriting" class="quiet" type="button">编辑文案</button><div id="toolbar"><button class="ql-bold" title="加粗"></button><button class="ql-italic" title="斜体"></button><button class="ql-underline" title="下划线"></button><button class="ql-clean" title="清除格式"></button></div><div id="message"></div><div class="editor-footer"><button id="bodyEmoji" class="quiet">✦ 专属表情</button><button id="editLink" class="quiet">添加 / 编辑链接</button><span id="textCount" class="muted">0 / 4096</span></div></div><details class="editor-help"><summary>编辑说明</summary><p class="hint">点击「添加链接」填写显示文字和地址；选中链接后点击「添加 / 编辑链接」修改。跨应用粘贴可能丢失专属表情身份，请从表情包选择器添加。</p></details>
<label class="file-label">附带图片 <span class="muted">JPEG / PNG / WebP，最多 5 MB</span><input id="photo" type="file" accept="image/jpeg,image/png,image/webp"></label><div id="photoBox" hidden><img id="photoPreview" alt="活动图片"><p id="photoMeta" class="hint"></p><button id="removePhoto" class="quiet">移除附件</button></div></div>
<div class="card"><div class="section-title"><h3>跳转按钮</h3><button id="addButton" class="quiet">＋ 添加按钮</button></div><div id="buttons"></div><p class="hint">同一行号的按钮并排显示。专属表情和颜色以 Telegram 客户端实际支持为准。</p></div>
<div class="card"><h3>发布目标</h3><div id="targetChecks" class="check-list"></div><h3>发布方式</h3><select id="kind"><option value="MANUAL">手动立即发布</option><option value="ONCE">指定时间发布</option><option value="DAILY">每天按时段重复发布</option></select><div id="onceFields" hidden><label>指定时间（北京时间）<input id="at" type="datetime-local"></label></div><div id="dailyFields" hidden><div class="grid"><label>开始时间<input id="start" type="time" value="01:00"></label><label>结束时间<input id="end" type="time" value="05:00"></label></div><div class="grid"><label>发送间隔<input id="interval" type="number" min="1" value="30"></label><label>单位<select id="unit"><option value="1">分钟</option><option value="60">小时</option></select></label></div><p class="hint">支持跨午夜；起点发送，终点恰好落在间隔上时发送。暂停恢复后从下一个时间点继续，不补发过去时段。</p></div></div>
<div class="card"><div class="section-title"><h3>私信用户</h3><button id="openPlayers" class="quiet">选择用户</button></div><p id="selectedPlayersHint" class="muted">尚未选择用户</p><p class="hint">使用当前文案和自定义表情，发送给用户页中选中的用户。</p></div>
<details id="previewPanel" class="card"><summary>消息预览</summary><div id="preview" class="message-preview"></div><p class="hint">此处是本地排版预览；专属表情最终以 Telegram 客户端实际渲染为准。</p></details>
<div class="actions"><button id="save" class="secondary">保存</button><button id="send" class="primary">保存并立即发布</button><button id="sendBroadcast" class="primary">群发给用户</button><button id="activate" class="primary" hidden>保存并启用定时</button></div><p class="hint center">编辑内容自动暂存于当前设备；Token 不存入浏览器。</p></section>
<section id="players" class="page" hidden><div class="section-title"><div><h2>用户</h2><p>当前迁移不包含玩家名单和同步功能。</p></div></div><div class="wrap-actions user-actions"><button id="syncPlayers" class="quiet" hidden>同步用户</button><button id="importPlayers" class="quiet" hidden>导入 WPS CSV</button><input id="playerCsv" type="file" accept=".csv,text/csv" hidden></div>
<details id="selectedPanel" class="card"><summary id="playerSelectionCount">已选用户 · 0 人</summary><button id="clearPlayers" class="quiet">清空选择</button><div id="selectedPlayerList" class="user-scroll"></div></details>
<details id="usersPanel" class="card"><summary>用户名单 <span id="userTotal" class="muted"></span></summary><div class="inline"><input id="playerSearch" aria-label="搜索用户" placeholder="搜索 ID、昵称或用户名"><button id="refreshPlayers" class="quiet">搜索</button></div><button id="selectAllPlayers" class="quiet">全选全部有效用户</button><p class="hint">最近互动取自已有会话记录；名单更新时间不视为聊天时间。用户删除接口尚未接入，取消选择不会删除用户。</p><div id="playerList" class="check-list user-scroll"></div><div class="wrap-actions"><button id="prevPlayers" class="quiet">上一页</button><button id="nextPlayers" class="quiet">下一页</button></div><p id="playerStats" class="hint"></p></details>
<details id="broadcastPanel" class="card"><summary>私信记录</summary><button id="refreshBroadcasts" class="quiet">刷新</button><div id="broadcastList"></div></details></section>
<section id="tasks" class="page" hidden><div class="section-title"><div><h2>发布任务</h2><p>查看状态与下次发送时间。</p></div><button id="refreshTasks" class="quiet">刷新</button></div><div id="taskList"></div></section>
<section id="logs" class="page" hidden><div class="section-title"><div><h2>发布记录</h2><p>单个目标失败不影响其他目标。</p></div><button id="refreshLogs" class="quiet">刷新</button></div><div id="runList"></div></section>
<section id="settings" class="page" hidden><h2>机器人与目标</h2><div class="card"><h3>绑定机器人</h3><p id="publisher" class="muted"></p><label>添加机器人或更新当前机器人 Token<input id="token" type="password" autocomplete="off" placeholder="填写发布机器人 Token"></label><button id="savePublisher" class="primary">验证并保存</button><p id="publisherManagementHint" class="hint">仅 wz9946 可添加或配置机器人；普通管理员可操作已授权机器人的业务。</p><div id="boundPublisherList"></div><p class="hint">入口机器人用于管理员登录，与当前绑定机器人独立。当前后端尚未返回入口机器人资料，页面不推测其用户名或收消息状态。</p></div><div id="ffaCard" class="card"><h3>用户导入</h3><p id="importSourceHint" class="hint"></p><button id="settingsImportUsers" class="secondary" type="button">去用户页导入名单</button><div id="legacyImportSettings"><label>后台 JWT Token<input id="ffaToken" type="password" autocomplete="off" placeholder="从用户数据后台登录态复制"></label><button id="saveFfaToken" class="primary">保存并测试连接</button><p id="ffaStatus" class="hint">尚未配置</p></div></div><div class="card"><h3>目标群 / 频道</h3><p class="hint">先把当前发布机器人设为管理员，再添加 @公开用户名或负数数字 ID。</p><div class="inline"><input id="targetRef" aria-label="目标群或频道" placeholder="@channel 或 -100…"><button id="addTarget" class="primary">添加</button></div><div id="targets"></div></div><div class="card"><h3>管理账号</h3><p id="adminInfo"></p><p class="hint">只有 wz9946 可以添加管理账号；新账号仅可操作所选机器人。</p><div id="accountManagement" hidden><button id="addAccount" class="primary" type="button">添加账号</button><form id="accountForm" hidden><label>账号<input id="newAccountUsername" minlength="4" maxlength="64" pattern="[A-Za-z0-9]{4,64}" autocomplete="off" required></label><label>密码<input id="newAccountPassword" type="password" minlength="4" maxlength="128" autocomplete="new-password" required></label><fieldset><legend>可操作的机器人</legend><div id="accountPublishers"></div></fieldset><button class="primary" type="submit">保存账号</button><button id="cancelAccount" class="quiet" type="button">取消</button></form><div id="accountList"></div></div><button id="browserLogout" class="quiet" hidden>退出浏览器登录</button></div></section>
</main><div id="toast" class="toast" role="status" hidden></div>
<dialog id="emojiDialog" aria-label="表情键盘"><div class="section-title"><h3>选择 Telegram 专属表情</h3><div class="emoji-key-actions"><button id="emojiBackspace" class="quiet" type="button" aria-label="删除光标前内容" title="退格，长按连续删除" hidden>⌫</button><button id="closeEmoji" class="quiet" aria-label="完成">完成</button></div></div><details id="packSettings"><summary>表情包<span id="packTitle" class="hint">添加或切换</span></summary><div class="pack-controls"><div class="inline"><input id="pack" placeholder="https://t.me/addemoji/表情包名"><button id="loadPack" class="primary">加载</button><button id="savePack" class="quiet" disabled title="请先加载真实表情包">保存</button></div><div id="savedPackTabs" class="pack-tabs"></div><select id="packHistory" aria-label="切换已加载表情包" hidden></select></div></details><p id="packError" class="inline-error" role="alert" hidden></p><input id="emojiSearch" type="search" aria-label="搜索专属表情" placeholder="搜索当前表情包的表情或 ID"><div id="emojiGrid"></div></dialog>`;

const ui = mountWorkbench({ mini:Boolean(initData), navigate:changeTab, backChat:()=> $('chatBack').click() });
const assetIntentBar=document.createElement('div');assetIntentBar.className='asset-intent-bar';assetIntentBar.hidden=true;
assetIntentBar.innerHTML='<span id="assetIntentText"></span><button id="cancelAssetIntent" class="quiet" type="button">取消并返回</button>';
$('assets').querySelector('.section-title').after(assetIntentBar);
function finishAssetIntent(returnToSource=true){
  const context=assetIntent;assetIntent=null;assetIntentBar.hidden=true;delete $('assets').dataset.intent;
  renderAssets();
  if(context&&returnToSource){changeTab(context.source);document.querySelector('.desktop-viewport')?.scrollTo(0,context.scrollTop);}
}
$('cancelAssetIntent').onclick=()=>finishAssetIntent();
$('workspace').addEventListener('asset-intent',event=>{
  const source=event.detail?.source;if(source==='chat'&&!activeChat){toast('请先选择会话',true);return;}
  assetIntent={source,bot:selectedPublisherId,chatId:activeChat?.chat_id||null,range:source==='chat'?chatQuill?.getSelection()||chatRange:quill?.getSelection()||savedRange,scrollTop:document.querySelector('.desktop-viewport')?.scrollTop||0};
  $('assetIntentText').textContent=source==='chat'?'选择用于当前会话的素材':'选择用于当前活动的素材';assetIntentBar.hidden=false;$('assets').dataset.intent=source;renderAssets();
});

const Embed = Quill.import('blots/embed');
class CustomEmoji extends Embed {
  static blotName = 'customEmoji'; static tagName = 'span'; static className = 'custom-emoji';
  static create(value) { const node = super.create(); node.dataset.id = value.id; node.dataset.alt = value.alt; node.dataset.thumbId = value.thumbId || ''; node.dataset.imageState = 'loading'; node.setAttribute('aria-label', value.alt || `专属表情 ${value.id}`); node.title = `专属表情 ${value.id}`; return node; }
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
function installClipboardMatchers(editor) {
  const Delta = Quill.import('delta');
  // Telegram may copy a rich-text anchor whose URL is not retained by
  // Quill's default clipboard matcher.
  editor.clipboard.addMatcher('A', (node, delta) => {
    const href = String(node.getAttribute('href') || '').trim();
    if (!/^(?:https?:|tg:)/i.test(href)) return delta;
    return new Delta(delta.ops.map(op => ({
      ...op,
      ...(typeof op.insert === 'string' ? { attributes: { ...(op.attributes || {}), link: href } } : {})
    })));
  });
  // Telegram custom emoji are copied as tg-emoji or data-document-id nodes.
  editor.clipboard.addMatcher(Node.ELEMENT_NODE, (node, delta) => {
    const id = String(node.getAttribute('emoji-id') || node.getAttribute('data-document-id') || node.getAttribute('data-emoji-id') || '').trim();
    const isEmoji = id && (/^tg-emoji$/i.test(node.tagName) || /(?:^|\s)tg-emoji(?:\s|$)/i.test(String(node.className || '')) || node.hasAttribute('data-document-id') || node.hasAttribute('data-emoji-id'));
    if (!isEmoji || !/^\d{5,30}$/.test(id)) return delta;
    const alt = String(node.textContent || node.getAttribute('alt') || '🙂').trim().slice(0, 8) || '🙂';
    return new Delta([{ insert: { customEmoji: { id, alt } } }]);
  });
}
installClipboardMatchers(quill);
quill.enable(false);
$('toggleWriting').onclick=()=>{const edit=!quill.isEnabled();quill.enable(edit);$('toggleWriting').textContent=edit?'完成编辑':'编辑文案';if(edit)quill.focus();else{quill.blur();closePicker();}};
quill.on('selection-change', range => { if (range) savedRange = range; });
quill.on('text-change', () => { insertedEmbedPending=false; $('textCount').textContent = `${quill.getText().trimEnd().length} / ${mediaId ? 1024 : 4096}`; remember(); preview(); });
chatQuill = new Quill('#chatInput', { theme:'snow', placeholder:'输入消息…', modules:{ toolbar:'#chatToolbar' }, formats:['bold','italic','underline','link','customEmoji'] });
chatQuill.root.setAttribute('role','textbox');chatQuill.root.setAttribute('aria-label','消息内容');chatQuill.root.setAttribute('aria-multiline','true');
if(!initData)new ResizeObserver(([entry])=>{const compact=entry.contentRect.width<680,composer=$('chatComposer');composer.classList.toggle('compact-composer',compact);if(!compact){$('chatToolsMore')?.setAttribute('aria-expanded','false');composer.querySelector('.chat-tools')?.classList.remove('tools-expanded');}}).observe($('chatComposer'));
installLinkEditor(Quill, chatQuill, { trigger:$('chatLink'),dialogId:'chatLinkDialog',idPrefix:'chat-' });
installClipboardMatchers(chatQuill);
chatQuill.on('selection-change', range => { if (range) chatRange = range; });
function chatButtonEditor() {
  $('chatButtons').innerHTML = chatButtons.map((b,i)=>`<div class="chat-button-row"><input data-chat-button="${i}" data-field="text" placeholder="按钮文字" value="${esc(b.text)}"><input data-chat-button="${i}" data-field="url" placeholder="https://链接" value="${esc(b.url)}"><select data-chat-button="${i}" data-field="style"><option value="default">默认</option><option value="primary" ${b.style==='primary'?'selected':''}>蓝色</option><option value="success" ${b.style==='success'?'selected':''}>绿色</option><option value="danger" ${b.style==='danger'?'selected':''}>红色</option></select><button class="quiet" data-chat-icon="${i}">✦${b.iconAlt||''}</button><button class="quiet" data-chat-remove="${i}">×</button></div>`).join('');
}
$('chatAddButton').onclick=()=>{if(chatButtons.length>=12)return toast('最多 12 个按钮');chatButtons.push({text:'',url:'https://t.me/',style:'default',row:Math.floor(chatButtons.length/2)});chatButtonEditor();};
$('chatButtons').addEventListener('input',event=>{const {chatButton,field}=event.target.dataset;if(chatButton!==undefined&&field)chatButtons[Number(chatButton)][field]=event.target.value;});
$('chatButtons').addEventListener('change',event=>{const {chatButton,field}=event.target.dataset;if(chatButton!==undefined&&field)chatButtons[Number(chatButton)][field]=event.target.value;});
$('chatButtons').onclick=event=>{if(event.target.dataset.chatRemove!==undefined){chatButtons.splice(Number(event.target.dataset.chatRemove),1);chatButtons.forEach((b,i)=>b.row=Math.floor(i/2));chatButtonEditor();}if(event.target.dataset.chatIcon!==undefined)openPicker(`chat-button-${event.target.dataset.chatIcon}`);};
$('chatEmoji').onclick=()=>openPicker('chat');
$('chatSearch').oninput=()=>action(loadConversations);
$('chatConversations').addEventListener('click',event=>{
  const command=event.target.closest('[data-search-action]')?.dataset.searchAction;
  if(command==='clear'){$('chatSearch').value='';$('chatSearch').focus();action(loadConversations);}
  if(command==='retry')action(loadConversations);
});
$('enableInbox').onclick=event=>action(async()=>{const disable=$('enableInbox').dataset.disable==='true',takeover=$('enableInbox').dataset.takeover==='true';if(disable&&!confirm('关闭当前机器人的收消息？已有聊天记录保留，发送功能不受影响。'))return;await api(disable?'/inbox/disable':'/inbox/enable','POST',takeover?{takeover:true}:{});await loadInboxStatus();toast(disable?'收消息已关闭':takeover?'已接管到当前服务器，可正常接收新消息':'收消息已启用');},event.currentTarget);
$('chatFile').onchange=event=>action(async()=>{const file=event.target.files[0];if(!file)return;const form=new FormData();form.set('file',file);chatMedia=await api('/chat/media','POST',form);$('chatMedia').textContent=`已附加：${file.name} · ${(file.size/1024/1024).toFixed(1)} MB`;},event.currentTarget);
function renderChatRows(rows) {
  const byTelegramId=new Map(rows.map(m=>[m.telegram_message_id,m]));
  let previousDay='';
  $('chatMessages').innerHTML=rows.map(m=>{
    const day=m.sent_at ? new Date(m.sent_at).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'long',day:'numeric'}) : '';
    const divider=day&&day!==previousDay?`<div class="chat-date-divider" role="separator" aria-label="${esc(day)}"><span>${esc(day)}</span></div>`:'';
    if(day)previousDay=day;
    return `${divider}<article class="chat-bubble ${m.direction==='OUT'?'out':''}" data-message="${m.id}">${m.reply_to_message_id?`<small class="chat-quoted">↩ ${esc((byTelegramId.get(m.reply_to_message_id)?.text||`消息 #${m.reply_to_message_id}`).slice(0,80))}</small>`:''}${m.media_kind?`<button class="chat-attachment quiet" data-file="${m.id}">${m.media_kind==='photo'?'🖼 图片':m.media_kind==='video'?'▶ 视频':'📎 文件'}</button>`:''}${m.media_kind==='photo'?`<div class="chat-photo" data-photo-id="${m.id}"></div>`:''}<div>${m.status==='DELETED'?'[已删除]':esc(m.text).replace(/\n/g,'<br>')}</div><small>${new Date(m.sent_at).toLocaleTimeString("zh-CN",{timeZone:"Asia/Shanghai",hour:"2-digit",minute:"2-digit",hour12:false})}${m.edited_at?' · 已编辑':''}</small><button class="chat-reply-btn" data-reply="${esc(m.telegram_message_id)}" title="回复">↩</button>${m.direction==='OUT'&&m.status==='SUCCESS'?`<button class="chat-delete-btn" data-manage-chat="${m.id}" title="编辑或删除">⋯</button>`:''}</article>`;
  }).join('')||'<p class="chat-empty muted center">还没有消息</p>';
  for(const node of $('chatMessages').querySelectorAll('[data-photo-id]'))authenticatedImage(`/chat/files/${node.dataset.photoId}`).then(url=>displayImage(node,url,'聊天图片')).catch(()=>{node.textContent='图片暂不可预览';});
  $('chatMessages').scrollTop=$('chatMessages').scrollHeight;
}
async function loadChat() {
  const chat=activeChat, bot=selectedPublisherId;ui.chat(chat);if(!chat)return;
  const result=await api(`/chat/conversations/${encodeURIComponent(chat.chat_id)}/messages`);
  if(bot!==selectedPublisherId||chat.chat_id!==activeChat?.chat_id)return;
  chatRows=result.rows;chatOlderCursor=result.next;$('chatOlder').hidden=!chatOlderCursor;renderChatRows(chatRows);
  await api(`/chat/conversations/${encodeURIComponent(chat.chat_id)}/read`,'POST',{});
  if(bot===selectedPublisherId)await loadConversations();
}
$('chatOlder').onclick=event=>action(async()=>{if(!activeChat||!chatOlderCursor)return;const chat=activeChat,bot=selectedPublisherId;const result=await api(`/chat/conversations/${encodeURIComponent(chat.chat_id)}/messages?before=${chatOlderCursor}`);if(bot!==selectedPublisherId||chat.chat_id!==activeChat?.chat_id)return;chatRows=[...result.rows,...chatRows];chatOlderCursor=result.next;$('chatOlder').hidden=!chatOlderCursor;renderChatRows(chatRows);$('chatMessages').scrollTop=0;},event.currentTarget);
async function loadConversations(more=false) {
  const bot=selectedPublisherId,query=$('chatSearch').value.trim(),sequence=++conversationLoadSequence;
  if(!more&&!conversationRows.length)$('chatConversations').innerHTML='<p class="empty-state" role="status">正在加载会话…</p>';
  let result;
  try{result=await api('/chat/conversations?q='+encodeURIComponent(query)+(more&&conversationNext?'&before='+encodeURIComponent(conversationNext):''));}
  catch(error){
    if(bot!==selectedPublisherId||query!==$('chatSearch').value.trim()||sequence!==conversationLoadSequence)return;
    if(more)throw error;
    const denied=error.status===401||error.status===403;
    $('chatConversations').innerHTML=`<div class="empty-state" role="alert">${denied?esc(error.message):'会话加载失败，请重试。'}${denied?'':' <button type="button" class="quiet" data-search-action="retry">重试</button>'}</div>`;
    return;
  }
  if(bot!==selectedPublisherId||query!==$('chatSearch').value.trim()||sequence!==conversationLoadSequence)return;
  if(chatCursor===0)chatCursor=result.cursor;
  conversationRows=more?[...conversationRows,...result.rows]:result.rows;
  conversationNext=result.next;$('chatMore').hidden=!conversationNext;
  const rows=conversationRows; $('chatUnread').textContent=`${result.totalUnread} 未读`;
  const avatarBotId = selectedPublisherId || data?.publisher?.id || '';
  $('chatConversations').innerHTML=rows.map(c=>`<button class="chat-conversation ${activeChat?.chat_id===c.chat_id?'selected':''}" data-chat-id="${esc(c.chat_id)}"><span class="chat-avatar"><img hidden data-avatar-path="${c.avatar_file_id ? '/chat/avatars/' + encodeURIComponent(avatarBotId) + '/' + encodeURIComponent(c.chat_id) : ''}" alt=""><span>${esc((c.title||'?').slice(0,1))}</span></span><span class="chat-summary"><strong>${esc(c.title||c.chat_id)}</strong><small>${esc(c.last_message_text||'新会话')}</small></span><span class="chat-meta"><small>${c.last_message_at?new Date(c.last_message_at).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}):''}</small>${c.unread_count?`<b>${c.unread_count}</b>`:''}</span></button>`).join('')||(query?`<div class="empty-state" role="status">未找到匹配会话：${esc(query)} <button type="button" class="quiet" data-search-action="clear">清空搜索</button></div>`:'<p class="empty-state" role="status">暂无会话。</p>');
  loadConversationAvatars();
  if(activeChat){activeChat=rows.find(c=>c.chat_id===activeChat.chat_id)||activeChat;$('chatTitle').textContent=activeChat.title;}
  ui.chat(activeChat);
}
$('chatMore').onclick=event=>action(()=>loadConversations(true),event.currentTarget);
$('chatConversations').onclick=event=>action(async()=>{const id=event.target.closest('[data-chat-id]')?.dataset.chatId;if(!id)return;if($('chatSend').disabled)throw new Error('消息正在发送，请稍后切换会话');chatRows=[];$('chatMessages').innerHTML='<p class="chat-empty">正在加载消息…</p>';activeChat=conversationRows.find(c=>c.chat_id===id);if(!activeChat)return;$('chatTitle').textContent=activeChat.title;$('chatComposer').hidden=false;await ui.load('chat',loadChat);});
$('chatBack').onclick=()=>{activeChat=null;ui.chat(null);$('chatConversations').querySelector('.chat-conversation.selected')?.classList.remove('selected');$('chatComposer').hidden=true;$('chatTitle').textContent='请选择会话';action(loadConversations);};
$('chatMessages').onclick=event=>action(async()=>{const reply=event.target.dataset.reply, file=event.target.dataset.file, manage=event.target.dataset.manageChat;if(reply){chatReply=reply;$('chatReply').hidden=false;$('chatReplyText').textContent=`回复 #${reply}`;chatQuill.root.focus();}if(manage){await openSent('chat',manage,'manage');$('sentDialog').addEventListener('close',()=>action(loadChat),{once:true});}if(file){const blob=await client.image(`/chat/files/${file}`),url=URL.createObjectURL(blob);window.open(url,'_blank');setTimeout(()=>URL.revokeObjectURL(url),60000);}},event.target);
$('cancelChatReply').onclick=()=>{chatReply=null;$('chatReply').hidden=true;chatQuill.root.focus();};
$('chatSend').onclick=event=>action(async()=>{if(!activeChat)throw new Error('请选择会话');$('chatSendStatus').textContent='发送中…';try{await api(`/chat/conversations/${encodeURIComponent(activeChat.chat_id)}/send`,'POST',{delta:chatQuill.getContents(),buttons:chatButtons,mediaId:chatMedia?.id,replyTo:chatReply});chatQuill.setText('');chatButtons=[];chatButtonEditor();chatMedia=null;chatReply=null;$('chatReply').hidden=true;$('chatMedia').textContent='';$('chatFile').value='';$('chatSendStatus').textContent='已发送';await loadChat();await loadConversations();}catch(error){$('chatSendStatus').textContent=`发送失败或结果待核实：${error.message}`;throw error;}},event.currentTarget);
async function loadInboxStatus(){if(!data?.publisher)return;try{const s=await api('/inbox/status');const external=s.status==='EXTERNAL';$('inboxStatus').textContent=external?'已有外部 webhook；不会覆盖，当前无法接收新消息':s.status==='READY'?'可正常接收新消息':s.status==='AVAILABLE'?'尚未启用收消息':s.status==='NO_PUBLIC_URL'?'需要配置 PUBLIC_URL':'收消息状态：'+s.status;$('inboxStatus').hidden=false;$('inboxStatus').className='hint inbox-status '+(s.status==='READY'?'is-ready':s.status==='AVAILABLE'?'is-available':external?'is-warning':'is-error');$('enableInbox').hidden=data?.admin?.canManageBots!==true||(!external&&s.status!=='AVAILABLE'&&s.status!=='READY');$('enableInbox').dataset.takeover=external?'true':'false';$('enableInbox').dataset.disable=s.status==='READY'?'true':'false';$('enableInbox').textContent=s.status==='READY'?'关闭收消息':external?'接管到当前服务器':'启用收消息';}catch(error){$('inboxStatus').hidden=false;$('inboxStatus').textContent=`状态检查失败：${error.message}`;$('inboxStatus').className='hint inbox-status is-error';$('enableInbox').hidden=true;}}
async function pollChats(){if(!data?.publisher)return;try{const result=await api('/chat/updates?after='+chatCursor);if(result.rows.length){chatCursor=result.cursor;await loadConversations();if(activeChat&&result.rows.some(m=>m.chat_id===activeChat.chat_id))await loadChat();}}catch{/* Keep the UI usable and retry on the next interval. */}}
function changeTab(id) { if (!['chat','editor','assets','players','tasks','logs','settings'].includes(id)) id='chat'; if(id==='editor')lastEditorTarget='body';else if(id==='chat'&&activeChat)lastEditorTarget='chat';ui.activate(id); closePicker(); sessionStorage.setItem('tgzhushou:tab',id); document.querySelectorAll('.page').forEach(page => page.hidden = page.id !== id); if (id === 'logs') action(()=>ui.load('logs',async()=>{await loadRuns();await loadBroadcasts();})); if (id === 'players') action(()=>ui.load('players',loadPlayers)); if(id==='assets')action(()=>ui.load('assets',loadSavedPacks)); if(id==='chat')action(()=>ui.load('chat',loadConversations)); }


function playerContext() { return {botId:selectedPublisherId, revision:publisherRevision}; }
function currentPlayerContext(context) { return context.botId===selectedPublisherId && context.revision===publisherRevision; }
function requirePlayerContext() {
  if(publisherChanging || !selectedPublisherId || data?.publisher?.id!==selectedPublisherId) throw new Error('请先完成机器人选择');
  return playerContext();
}
function clearPlayerContext() {
  selectedPlayerIds.clear();playerCache.clear();playerConversations=[];playerPage=1;playerLoadSequence++;pendingPlayerImport=null;
  $('playerCsv').value='';$('ffaToken').value='';$('playerSearch').value='';$('playerList').replaceChildren();$('playerStats').textContent='正在加载当前机器人的名单…';$('userTotal').textContent='';
  $('prevPlayers').disabled=true;$('nextPlayers').disabled=true;updatePlayerSelection();
}
function updatePlayerSelection() {
  $('playerSelectionCount').textContent = '已选用户 · '+selectedPlayerIds.size+' 人';
  $('selectedPlayersHint').textContent = selectedPlayerIds.size ? '已选择 '+selectedPlayerIds.size+' 名用户 · 点击查看' : '尚未选择用户';
  $('selectedPlayerList').innerHTML = [...selectedPlayerIds].map(id=>{const p=playerCache.get(id)||{};return '<div class="list-row"><div><strong>'+esc(p.display_name||'未命名')+'</strong><small>'+esc(id)+'</small></div><button class="quiet" data-unselect="'+esc(id)+'">取消选择</button></div>';}).join('')||'<p class="muted">尚未选择用户</p>';
  document.querySelectorAll('[data-player-id]').forEach(n=>n.checked=selectedPlayerIds.has(n.dataset.playerId));
}
async function loadPlayers() {
  const context=playerContext(),sequence=++playerLoadSequence,page=playerPage,q=$('playerSearch').value.trim();
  const result=await api('/players?q='+encodeURIComponent(q)+'&page='+page+'&size=50');
  if(!currentPlayerContext(context)||sequence!==playerLoadSequence)return;
  playerConversations=conversationRows;
  for(const p of result.rows)playerCache.set(p.telegram_id,p);
  $('userTotal').textContent='· 共 '+result.total+' 人';$('playerStats').textContent='第 '+page+' 页 · 共 '+result.total+' 名用户';
  $('prevPlayers').disabled=page<=1;$('nextPlayers').disabled=page*50>=result.total;
  const cells=p=>{const c=playerConversations.find(c=>String(c.chat_id)===String(p.telegram_id));return `<span>${esc(p.telegram_id)}</span><span>${p.username?'@'+esc(p.username):'—'}</span><span class="status ${p.active?'ACTIVE':'STOPPED'}">${p.active?'有效':'停用'}</span><span>${c?.last_message_at?fmt(c.last_message_at):'—'}</span><button type="button" class="quiet" data-player-chat="${esc(p.telegram_id)}">会话</button>`;};
  $('playerList').innerHTML=result.rows.length ? `<div class="${ui.mini?'mini-user-list':'user-table'}">${ui.mini?'':'<div class="user-table-heading"><span>选择</span><span>昵称</span><span>Telegram ID</span><span>用户名</span><span>状态</span><span>最近互动</span><span>操作</span></div>'}${result.rows.map(p=>`<div class="${ui.mini?'mini-user-row':'user-table-row'}"><label class="user-selection"><input type="checkbox" data-player-id="${esc(p.telegram_id)}" aria-label="选择 ${esc(p.display_name||p.telegram_id)}" ${p.active?'':'disabled'}></label><strong>${esc(p.display_name||'未命名')}</strong>${cells(p)}</div>`).join('')}</div>` : `<p class="empty-state">${q?'没有匹配的用户，请修改关键词。':'暂无用户；通过收消息建立会话，或使用支持的用户导入来源。'}</p>`;
  updatePlayerSelection();
}
$('settingsImportUsers').onclick=()=>changeTab('players');
$('playerList').onclick=event=>action(async()=>{
  const id=event.target.closest('[data-player-chat]')?.dataset.playerChat;if(!id)return;
  const context=requirePlayerContext(),result=await api('/chat/conversations?q='+encodeURIComponent(id));
  if(!currentPlayerContext(context))return;
  const chat=result.rows.find(c=>String(c.chat_id)===id);
  if($('chatSend').disabled)throw new Error('消息正在发送，请稍后切换会话');if(!chat)throw new Error('此用户尚无会话记录。请让用户先向当前机器人发送消息，再打开会话。');
  activeChat=chat;changeTab('chat');$('chatTitle').textContent=chat.title||id;await ui.load('chat',loadChat);
},event.target);
$('importPlayers').onclick=()=>action(async()=>{pendingPlayerImport=requirePlayerContext();$('playerCsv').click();});
$('selectedPlayerList').onclick=e=>{const id=e.target.dataset.unselect;if(id){selectedPlayerIds.delete(id);updatePlayerSelection();}};
$('prevPlayers').onclick=()=>{playerPage--;action(loadPlayers);};$('nextPlayers').onclick=()=>{playerPage++;action(loadPlayers);};
$('selectedPlayersHint').onclick=()=>{changeTab('players');$('selectedPanel').open=true;};
async function loadBroadcasts() { const context=playerContext(),rows=await api('/broadcasts');if(!currentPlayerContext(context))return; $('broadcastList').innerHTML=rows.map(r=>`<div class="list-row"><div><strong>${esc(r.name)} · ${esc(labels[r.status]||r.status)}</strong><small>成功 ${r.success_count||0} · 失败 ${r.failed_count||0} · 排队 ${r.pending_count||0} · ${fmt(r.created_at)}</small></div><button class="quiet" data-sent-broadcast="${r.id}">查看结果</button>${['PENDING','RUNNING'].includes(r.status)?`<button class="quiet danger-text" data-stop-broadcast="${r.id}">停止</button>`:''}</div>`).join('')||'<p class="muted">暂无私信记录</p>'; }
$('playerList').addEventListener('change',e=>{const id=e.target.dataset.playerId;if(!id||publisherChanging)return;e.target.checked?selectedPlayerIds.add(id):selectedPlayerIds.delete(id);updatePlayerSelection();});
$('refreshPlayers').onclick=e=>{playerPage=1;action(()=>ui.load('players',loadPlayers),e.currentTarget);};
$('playerSearch').addEventListener('keydown',e=>{if(e.key==='Enter'){playerPage=1;action(loadPlayers);}});
$('clearPlayers').onclick=()=>{selectedPlayerIds.clear();updatePlayerSelection();};
$('selectAllPlayers').onclick=e=>action(async()=>{
  const context=requirePlayerContext(),r=await api('/players/ids');if(!currentPlayerContext(context))return;
  for(const p of r.rows)playerCache.set(p.telegram_id,p);selectedPlayerIds=new Set(r.rows.map(x=>x.telegram_id));
  updatePlayerSelection();await loadPlayers();if(currentPlayerContext(context))toast(`已选择 ${selectedPlayerIds.size} 名有效用户`);
},e.currentTarget);
$('playerCsv').onchange=e=>action(async()=>{
  const f=e.target.files[0],context=pendingPlayerImport;e.target.value='';pendingPlayerImport=null;if(!f)return;
  if(!context||!currentPlayerContext(context)||publisherChanging){toast('机器人已切换，请重新为当前机器人选择 CSV',true);return;}
  const form=new FormData();form.set('file',f);const r=await api('/players/import','POST',form);
  if(!currentPlayerContext(context))return;await loadPlayers();if(currentPlayerContext(context))toast(`导入完成：新增 ${r.created}，更新 ${r.updated}，无效 ${r.invalid}`);
},e.currentTarget);
$('refreshBroadcasts').onclick=e=>action(loadBroadcasts,e.currentTarget);
$('broadcastList').onclick=e=>action(async()=>{if(e.target.dataset.sentBroadcast){await openSent('broadcasts',e.target.dataset.sentBroadcast);return;}const id=e.target.dataset.stopBroadcast;if(id&&confirm('停止尚未发送的私信？')){await api(`/broadcasts/${id}/stop`,'POST');await loadBroadcasts();toast('已停止剩余发送');}},e.target);
$('openPlayers').onclick=()=>{changeTab('players');$('usersPanel').open=true;};
async function sendBroadcast(){const context=requirePlayerContext();if(!selectedPlayerIds.size)throw new Error('请先在「用户」页选择发送对象');const r=await api('/broadcasts','POST',{name:$('name').value||'用户私信',delta:quill.getContents(),buttons,mediaId,playerIds:[...selectedPlayerIds]});if(currentPlayerContext(context))toast(`已加入私信队列，共 ${r.total} 人`);}
$('sendBroadcast').onclick=e=>action(sendBroadcast,e.currentTarget);
$('syncPlayers').onclick=e=>action(async()=>{const context=requirePlayerContext(),r=await api('/ffa/sync','POST');if(!currentPlayerContext(context))return;await loadPlayers();if(currentPlayerContext(context))toast(`同步完成：新增 ${r.created}，更新 ${r.updated}`);},e.currentTarget);
function scheduleFields() { const kind = $('kind').value; $('onceFields').hidden = kind !== 'ONCE'; $('dailyFields').hidden = kind !== 'DAILY'; $('activate').hidden = kind === 'MANUAL'; }
function collect() { return { name:$('name').value, delta:quill.getContents(), buttons, mediaId, targetIds:[...document.querySelectorAll('[name=target]:checked')].map(x => Number(x.value)), schedule: $('kind').value === 'DAILY' ? { kind:'DAILY', start:$('start').value, end:$('end').value, interval:Number($('interval').value)*Number($('unit').value) } : $('kind').value === 'ONCE' ? { kind:'ONCE', at:Date.parse(`${$('at').value}:00+08:00`) } : { kind:'MANUAL' } }; }
function saveStatus(local = true) {
  $('saveStatus').textContent = serverSnapshot === JSON.stringify(collect()) ? '服务器已保存' : local ? '本机已暂存 · 尚未保存到服务器' : '编辑中 · 尚未保存到服务器';
}
function flushDraft(force = false) {
  clearTimeout(draftTimer);
  if (!ready || (!draftDirty && !force)) return;
  try { localStorage.setItem(draftKey(), JSON.stringify({ ...collect(), taskId, mediaInfo })); draftDirty = false; saveStatus(); }
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
  normalizeButtonRows(buttons);
  $('buttons').innerHTML = buttons.map((b,i) => `<div class="button-editor" data-index="${i}"><div class="section-title"><strong>按钮 ${i+1}</strong><button data-remove="${i}" class="quiet danger-text">删除</button></div><label>按钮文字<input data-field="text" value="${esc(b.text)}" maxlength="64" placeholder="留空 = 仅显示专属表情"></label><label>跳转链接<input data-field="url" value="${esc(b.url)}" placeholder="https://t.me/…"></label><div class="grid"><label>颜色<select data-field="style">${[['default','默认'],['primary','蓝色'],['success','绿色'],['danger','红色']].map(([v,t])=>`<option value="${v}" ${b.style===v?'selected':''}>${t}</option>`).join('')}</select></label><label>行号<input data-field="row" type="number" min="1" max="12" value="${b.row+1}"></label></div><button data-emoji="${i}" class="quiet">${esc(b.iconAlt || '✦')} ${b.iconId ? '更换专属表情' : '选择专属表情'}</button>${b.iconId?`<button data-clear="${i}" class="quiet">移除表情</button>`:''}</div>`).join('') || '<p class="muted">暂未添加跳转按钮</p>';
  preview();
}
$('buttons').addEventListener('input', event => { const wrap = event.target.closest('[data-index]'); if (!wrap || !event.target.dataset.field) return; const field = event.target.dataset.field; const button = buttons[Number(wrap.dataset.index)]; button[field] = field === 'row' ? Math.max(0, Number(event.target.value)-1) : event.target.value; if (field === 'row') button.rowExplicit = true; remember(); preview(); });
$('buttons').addEventListener('click', event => { if (event.target.dataset.remove !== undefined) { buttons.splice(Number(event.target.dataset.remove),1); reflowAutomaticButtonRows(buttons); showButtons(); remember(); } if (event.target.dataset.emoji !== undefined) openPicker(Number(event.target.dataset.emoji)); if (event.target.dataset.clear !== undefined) { Object.assign(buttons[Number(event.target.dataset.clear)], { iconId:'',iconAlt:'',iconThumbId:'' }); showButtons(); remember(); } });
$('addButton').onclick = () => { if (buttons.length >= 12) return toast('最多添加 12 个按钮'); buttons.push({text:'立即进入',url:'https://t.me/',style:'default',row:defaultButtonRow(buttons.length),rowExplicit:false,iconId:'',iconAlt:''}); showButtons(); remember(); };
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
  if(mediaId&&!imageUrl){const file=document.createElement('p');file.className='preview-file';file.textContent=`${mediaInfo?.mime?.startsWith('video/')?'▶ 视频':'附件'} · ${mediaInfo?.name||'媒体 #'+mediaId}`;container.append(file);}
  if (imageUrl) { const img = document.createElement('img'); img.src = imageUrl; img.alt = '消息图片'; container.append(img); }
  const text = document.createElement('div'); text.className='preview-text';
  for (const op of quill.getContents().ops) { let node = document.createElement('span'); const custom = op.insert?.customEmoji; node.textContent = typeof op.insert === 'string' ? op.insert : custom?.alt || ''; const a = op.attributes || {}; if (custom) { node.className='custom-emoji'; node.dataset.emojiId=custom.id; node.dataset.thumbId=custom.thumbId || ''; node.dataset.alt=custom.alt || ''; node.dataset.imageState='loading'; node.setAttribute('aria-label', custom.alt || `专属表情 ${custom.id}`); } if (a.bold) node.style.fontWeight='700'; if (a.italic) node.style.fontStyle='italic'; if (a.underline) node.style.textDecoration='underline'; if (a.link) { const link=document.createElement('a'); link.textContent=node.textContent; link.href=/^(https:|tg:)/i.test(a.link)?a.link:'#'; link.target='_blank'; link.rel='noopener noreferrer'; node=link; } text.append(node); } container.append(text);
  const rows = new Map(); for (const b of buttons) { const row=rows.get(b.row)||[]; row.push(b); rows.set(b.row,row); }
  for (const [,row] of [...rows].sort(([a],[b])=>a-b)) { const div=document.createElement('div'); div.className='preview-row'; for(const b of row) { const span=document.createElement('span'); span.className=`preview-button ${b.style}`; if (b.iconId) { const icon=document.createElement('span'); icon.className='preview-emoji custom-emoji'; icon.dataset.emojiId=b.iconId; icon.dataset.thumbId=b.iconThumbId || ''; icon.dataset.alt=b.iconAlt || '专属表情'; icon.dataset.imageState='loading'; icon.setAttribute('aria-label', b.iconAlt || '专属表情'); icon.title=b.iconAlt || '专属表情'; span.append(icon); } if (b.text) span.append(document.createTextNode((b.iconId ? ' ' : '') + b.text)); if (!b.iconId && !b.text) span.textContent=''; div.append(span); } container.append(div); } hydrateEmojiImages(container);
}
function hydrateEmojiImages(container) {
  for (const node of container.querySelectorAll('[data-thumb-id]')) {
    const id = node.dataset.thumbId, emoji = node.dataset.emojiId || node.dataset.id;
    if ((!id && !emoji) || node.dataset.loaded === '1' || node.dataset.loaded === 'unavailable' || node.dataset.loaded === 'error') continue;
    node.dataset.loaded = '1';
    const query = (id ? 'id=' + encodeURIComponent(id) : '') + (emoji ? `${id ? '&' : ''}emoji=` + encodeURIComponent(emoji) : '');
    stickerImage('/sticker-image?' + query).then(url => {
      displayImage(node, url, node.dataset.alt || '', node.dataset.label || '');
    }).catch(() => { node.dataset.loaded = 'error'; setEmojiState(node, 'error', node.dataset.alt || node.dataset.label || '专属表情'); });
  }
}
function closePicker() {
  stopDeleting();
  $('emojiDialog').close();
  document.body.classList.remove('emoji-open', 'emoji-body-open');
  $('emojiDialog').classList.remove('desktop-emoji-popover');$('emojiDialog').removeAttribute('style');pickerAnchor=null;clearTimeout(emojiHoverTimer);
  quill.root.removeAttribute('inputmode');
  chatQuill?.root.removeAttribute('inputmode');
  $('bodyEmoji').setAttribute('aria-expanded', 'false');$('chatEmoji').setAttribute('aria-expanded','false');
}
function openPicker(target, anchor, hover=false) {
  if($('emojiDialog').open&&pickerTarget===target){if(hover)return;if(pickerOpenedByHover){pickerOpenedByHover=false;return;}closePicker();return;}
  const caret = target === 'chat' ? chatRange && { ...chatRange } : savedRange && { ...savedRange };
  stopDeleting();
  pickerTarget=target;pickerOpenedByHover=hover;pickerAnchor=anchor||(target==='body'?$('bodyEmoji'):target==='chat'?$('chatEmoji'):document.activeElement);
  const desktop=!ui.mini&&innerWidth>=900;
  $('emojiDialog').classList.toggle('desktop-emoji-popover',desktop);
  $('emojiBackspace').hidden = target !== 'body';
  document.body.classList.add('emoji-open');
  document.body.classList.toggle('emoji-body-open', target === 'body'&&!desktop);
  if(!desktop)(target === 'chat' ? chatQuill : quill).root.setAttribute('inputmode', 'none');
  if (!$('emojiDialog').open) $('emojiDialog').show();
  positionEmojiPicker();
  $('bodyEmoji').setAttribute('aria-expanded', String(target === 'body'));$('chatEmoji').setAttribute('aria-expanded',String(target==='chat')); loadSavedPacks().catch(error=>packError(error.message));
  if (target === 'body' || target === 'chat') {
    // Opening the non-modal dialog may focus its controls; restore the caret.
    const editor = target === 'chat' ? chatQuill : quill;
    const at = Math.min(caret?.index ?? editor.getLength()-1, editor.getLength()-1);
    const length = Math.min(caret?.length || 0, editor.getLength()-1-at);
    editor.setSelection(at, length, 'silent');
    if(target==='chat')chatRange={index:at,length};else savedRange={index:at,length};
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
  const batch = [...stickers.values()].filter(s=>emojiMatches(s,$('emojiSearch').value)).slice(visibleStickers, visibleStickers + 24);
  for (const sticker of batch) {
    const button = document.createElement('button'); button.className = 'emoji-choice';
    button.dataset.emojiId = sticker.id; button.dataset.alt = sticker.alt || ''; button.dataset.imageState = 'loading'; button.setAttribute('aria-label', sticker.alt || `专属表情 ${sticker.id}`); button.title = sticker.alt || sticker.id;
    button.onclick = () => {
      button.classList.add('selected');
      if (pickerTarget === 'chat') {
        const at=Math.min(chatRange?.index??chatQuill.getLength()-1,chatQuill.getLength()-1);
        chatQuill.enable(true);chatQuill.insertEmbed(at,'customEmoji',{id:sticker.id,alt:sticker.alt,thumbId:sticker.thumbnailId||''},'user');
        chatQuill.setSelection(at+1,0);chatRange={index:at+1,length:0};hydrateEmojiImages(chatQuill.root);
      } else if (String(pickerTarget).startsWith('chat-button-')) {
        const index=Number(String(pickerTarget).slice('chat-button-'.length));
        if(!chatButtons[index])return;
        Object.assign(chatButtons[index],{iconId:sticker.id,iconAlt:sticker.alt,iconThumbId:sticker.thumbnailId||''});chatButtonEditor();
      } else if (pickerTarget === 'body') {
        const at = Math.min(savedRange?.index ?? quill.getLength()-1, quill.getLength()-1);
        quill.enable(true);$('toggleWriting').textContent='完成编辑';quill.insertEmbed(at, 'customEmoji', { id:sticker.id, alt:sticker.alt, thumbId:sticker.thumbnailId || '' }, 'user');
        quill.setSelection(at+1, 0); savedRange = { index:at+1, length:0 }; insertedEmbedPending=true; hydrateEmojiImages(quill.root);
      } else if (buttons[pickerTarget]) {
        Object.assign(buttons[pickerTarget], { iconId:sticker.id, iconAlt:sticker.alt, iconThumbId:sticker.thumbnailId || '' });
        showButtons(); remember();
      } else return;
      rememberRecentEmoji(sticker);
    };
    $('emojiGrid').append(button);
    if (sticker.thumbnailId || sticker.id) stickerImage('/sticker-image?' + (sticker.thumbnailId ? 'id=' + encodeURIComponent(sticker.thumbnailId) + '&' : '') + 'emoji=' + encodeURIComponent(sticker.id))
      .then(url => displayImage(button, url, sticker.alt)).catch(() => setEmojiState(button, 'error', sticker.alt || `专属表情 ${sticker.id}`));
  }
  visibleStickers += batch.length;
  queueMoreEmoji();
}
let emojiScrollFrame;
function queueMoreEmoji() {
  cancelAnimationFrame(emojiScrollFrame);
  emojiScrollFrame = requestAnimationFrame(() => {
    const grid = $('emojiGrid');
    if ($('emojiDialog').open && grid.clientHeight > 0 && visibleStickers < [...stickers.values()].filter(s=>emojiMatches(s,$('emojiSearch').value)).length
        && grid.scrollHeight - grid.scrollTop - grid.clientHeight < 80) appendEmojiBatch();
  });
}
$('emojiGrid').addEventListener('scroll', queueMoreEmoji, { passive:true });
new ResizeObserver(queueMoreEmoji).observe($('emojiGrid'));
const loadedPacks = new Map();
function displayPack(pack) {
  activePack=pack;$('savePack').disabled=!pack.name;$('savePack').title=pack.name?'保存当前已加载表情包':'请先加载真实表情包';
  cancelAnimationFrame(emojiScrollFrame);
  $('emojiSearch').value='';stickers.clear(); visibleStickers = 0; $('emojiGrid').replaceChildren(); $('emojiGrid').scrollTop = 0;
  for (const sticker of pack.stickers) stickers.set(sticker.id, sticker);
  $('packTitle').textContent = pack.title + ' · ' + stickers.size + ' 个';
  $('packSettings').open = false;
  appendEmojiBatch();if(!stickers.size)$('emojiGrid').innerHTML='<p class="empty-state">此表情包没有专属表情。</p>';
}
$('emojiSearch').oninput=()=>{visibleStickers=0;$('emojiGrid').replaceChildren();appendEmojiBatch();if(!$('emojiGrid').children.length)$('emojiGrid').innerHTML='<p class="empty-state">没有匹配的专属表情。</p>';};
$('packHistory').onchange = () => displayPack(loadedPacks.get($('packHistory').value));
$('savedPackTabs').addEventListener('click', e => {
  if (e.target.dataset.recent) return displayPack({ title:'最近使用', stickers:recentEmojis });
  const i = e.target.dataset.packIndex;
  if (i !== undefined) displayPack(savedPacks[Number(i)]);
});
function packError(message=''){$('packError').textContent=message;$('packError').hidden=!message;}
$('savePack').onclick=event=>action(async()=>{packError();try{const pack=activePack,name=pack?.name;if(!name)throw new Error('请先加载表情包');await api('/sticker-packs/saved','POST',{name,title:pack.title,stickers:pack.stickers});await loadSavedPacks();toast('表情包已保存');}catch(error){packError(error.message);throw error;}},event.currentTarget);
$('loadPack').onclick=event=>action(async()=>{packError();try{
  const key=$('pack').value.trim(),bot=selectedPublisherId,pack=loadedPacks.get(key)||await api('/sticker-packs','POST',{pack:key});if(bot!==selectedPublisherId)return;
  loadedPacks.delete(key);loadedPacks.set(key,pack);if(loadedPacks.size>8)loadedPacks.delete(loadedPacks.keys().next().value);
  $('packHistory').replaceChildren(...[...loadedPacks].map(([value,item])=>new Option(item.title,value)));
  $('packHistory').value=key;$('packHistory').hidden=loadedPacks.size<2;displayPack(pack);$('pack').blur();
}catch(error){packError(error.message);throw error;}},event.currentTarget);
function positionEmojiPicker(){
  const dialog=$('emojiDialog');if(!dialog.open||!dialog.classList.contains('desktop-emoji-popover')||!pickerAnchor?.isConnected)return;
  const p=emojiPopoverPosition(pickerAnchor.getBoundingClientRect(),{width:innerWidth,height:window.visualViewport?.height||innerHeight});
  Object.assign(dialog.style,{left:p.left+'px',top:p.top+'px',width:p.width+'px',height:p.height+'px'});
}
for(const name of ['resize','scroll'])window.addEventListener(name,positionEmojiPicker,{capture:true,passive:true});
document.addEventListener('pointerdown',event=>{if($('emojiDialog').open&&!event.target.closest('#emojiDialog')&&!event.target.closest('#bodyEmoji,#chatEmoji,[data-emoji],[data-chat-icon]'))closePicker();});
for(const [id,target] of [['bodyEmoji','body'],['chatEmoji','chat']]){
  $(id).addEventListener('mouseenter',()=>{if(ui.mini||innerWidth<900||$('emojiDialog').open)return;emojiHoverTimer=setTimeout(()=>openPicker(target,$(id),true),250);});
  $(id).addEventListener('mouseleave',()=>clearTimeout(emojiHoverTimer));
}
$('photo').onchange = event => action(async () => { const file=event.target.files[0]; if(!file)return; const form=new FormData(); form.set('image',file); const media=await api('/media','POST',form); mediaId=media.id;mediaInfo={...media,name:file.name}; replacePhoto(await authenticatedImage(`/media/${mediaId}?preview=1`).catch(() => { toast('图片已上传，缩略图暂不可用', true); return ''; })); showPhoto(); remember(); },event.currentTarget);
function showPhoto() { $('photoBox').hidden=!mediaId; $('photoPreview').hidden=!imageUrl;$('photoPreview').src=imageUrl;$('photoMeta').textContent=mediaId?`${mediaInfo?.name||'附件 #'+mediaId} · ${mediaInfo?.mime||'媒体'}`:''; $('textCount').textContent=`${quill.getText().trimEnd().length} / ${mediaId?1024:4096}`; preview(); }
$('removePhoto').onclick = () => {mediaId=null;mediaInfo=null;replacePhoto();$('photo').value='';showPhoto();remember();};
function assetKind(item){return item.mime.startsWith('image/')?'image':item.mime.startsWith('video/')?'video':'file';}
function renderAssets(){
  const items=assetItems.filter(item=>assetFilter==='all'||assetKind(item)===assetFilter),list=$('assetList');list.hidden=assetFilter==='emoji';
  list.innerHTML=items.length?items.map(item=>`<article class="asset-card"><div class="asset-preview ${assetKind(item)==='image'?'asset-image':'asset-file'}" data-asset-preview="${item.id}">${assetKind(item)==='image'?'':assetKind(item)==='video'?'▶':'附件'}</div><div class="asset-card-body"><strong>${esc(item.name)}</strong><small>${esc(item.mime)} · ${(item.size/1024/1024).toFixed(2)} MB · ID ${item.id}</small><div class="wrap-actions"><button class="quiet" type="button" data-asset-use="${item.id}">用于活动</button><button class="quiet" type="button" data-asset-chat="${item.id}" ${activeChat?'':'disabled title="请先选择会话"'}>用于聊天</button></div></div></article>`).join(''):'<div class="empty-state">本次打开页面后尚未上传此类型媒体，请先上传。'+(assetIntent?' <button class="quiet" type="button" data-asset-cancel>取消并返回</button>':'')+'</div>';
  for(const item of items.filter(item=>assetKind(item)==='image'))authenticatedImage(`/media/${item.id}?preview=1`).then(url=>displayImage(document.querySelector(`[data-asset-preview="${item.id}"]`),url,item.name)).catch(()=>{const el=document.querySelector(`[data-asset-preview="${item.id}"]`);if(el)el.textContent='缩略图暂不可用，已上传文件仍可复用';});
  renderAssetPacks();
}
function renderAssetPacks(){
  const el=$('assetPacks');el.hidden=!['all','emoji'].includes(assetFilter);document.querySelector('.asset-emoji-card').hidden=el.hidden;
  el.innerHTML=savedPacks.length?savedPacks.map((pack,i)=>`<article class="asset-card asset-pack"><strong>${esc(pack.title)}</strong><small>${pack.stickers.length} 个专属表情</small><div class="wrap-actions">${assetIntent?`<button class="quiet" data-asset-pack="${i}" data-pack-target="${assetIntent.source==='chat'?'chat':'body'}" type="button">选择表情</button>`:`<button class="quiet" data-asset-pack="${i}" data-pack-target="manage" type="button">查看表情包</button>`}</div></article>`).join(''):'<p class="empty-state">还没有已保存的专属表情包。添加真实表情包链接，加载成功后保存。</p>';
}
$('assetFilters').onclick=event=>{const kind=event.target.dataset.assetFilter;if(!kind)return;assetFilter=kind;$('assetFilters').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b===event.target));renderAssets();};
const assetUploadButton=$('assetUpload').parentElement;assetUploadButton.tabIndex=0;assetUploadButton.setAttribute('role','button');assetUploadButton.setAttribute('aria-label','选择上传素材');assetUploadButton.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('assetUpload').click();}};
$('assetUpload').onchange=event=>action(async()=>{let count=0;try{for(const file of [...event.target.files]){if(file.size>20*1024*1024)throw new Error(`${file.name} 超过 20 MB`);const form=new FormData();form.set('file',file);const media=await api('/chat/media','POST',form);assetItems.unshift({...media,name:file.name});count++;renderAssets();}toast(`已上传 ${count} 个素材`);}finally{event.target.value='';renderAssets();}},event.currentTarget);
$('assetList').onclick=event=>action(async()=>{if(event.target.closest('[data-asset-cancel]')){finishAssetIntent();return;}const use=event.target.dataset.assetUse,chat=event.target.dataset.assetChat,item=assetItems.find(x=>String(x.id)===String(use||chat));if(!item)return;
  if(assetIntent&&(assetIntent.bot!==selectedPublisherId||(assetIntent.source==='chat'&&assetIntent.chatId!==activeChat?.chat_id))){finishAssetIntent(false);toast('目标已变化，请重新选择',true);return;}
  if(assetIntent&&((use&&assetIntent.source!=='editor')||(chat&&assetIntent.source!=='chat'))){toast('请选择与来源相符的素材用途',true);return;}
  if(use){if(mediaId&&mediaId!==item.id&&!confirm('将替换当前附件，继续吗？'))return;mediaId=item.id;mediaInfo=item;replacePhoto(assetKind(item)==='image'?await authenticatedImage(`/media/${mediaId}?preview=1`).catch(()=> ''):'');showPhoto();remember();if(assetIntent)finishAssetIntent();else changeTab('editor');toast('素材已附加；正文、目标和时间设置保持不变');}
  if(chat){if(!activeChat){toast('请先选择会话',true);return;}if(chatMedia&&chatMedia.id!==item.id&&!confirm('将替换当前附件，继续吗？'))return;chatMedia=item;$('chatMedia').textContent=`已附加：${item.name}`;if(assetIntent)finishAssetIntent();else changeTab('chat');toast('素材已附加到当前会话');}
},event.target);
$('assetPacks').onclick=event=>{const i=event.target.dataset.assetPack;if(i===undefined)return;const target=event.target.dataset.packTarget||'manage';if(target==='manage')openPicker('asset-manage');else openAssetPicker(target);displayPack(savedPacks[Number(i)]);};
function openAssetPicker(target){if(target==='chat'&&!activeChat)target='body';const context=assetIntent;changeTab(target==='chat'?'chat':'editor');openPicker(target,$(target==='chat'?'chatEmoji':'bodyEmoji'));if(context)finishAssetIntent(false);}
$('openAssetEditor').onclick=()=>changeTab('editor');$('openAssetEmoji').onclick=()=>{if(assetIntent)openAssetPicker(assetIntent.source==='chat'?'chat':'body');else openPicker('asset-manage');$('packSettings').open=true;};
function populateTargets(selected = []) { $('targetChecks').innerHTML=data.targets.map(t=>`<label class="check"><input type="checkbox" name="target" value="${t.id}" ${selected.includes(t.id)?'checked':''} ${t.can_publish?'':'disabled'}><span>${esc(t.title)}<small>${esc(t.last_error || t.chat_id)}</small></span></label>`).join('')||'<p class="muted">请先在「设置」中添加群或频道。</p>'; }
async function refresh() { let requestedBot=selectedPublisherId,requestRevision=publisherRevision;const selected=[...document.querySelectorAll('[name=target]:checked')].map(x=>Number(x.value)); let result;try{result=await api('/bootstrap');}catch(error){if(error.status!==403||!requestedBot)throw error;if(requestedBot!==selectedPublisherId||requestRevision!==publisherRevision)return;publisherRevision++;selectedPublisherId='';localStorage.removeItem('tgzhushou:selected-publisher');clearPlayerContext();requestedBot='';requestRevision=publisherRevision;result=await api('/bootstrap');}if(requestedBot!==selectedPublisherId||requestRevision!==publisherRevision)return;data=Object.assign({publishers:[],targets:[],admin:{}},result||{});selectedPublisherId=data.publisher?.id||'';if(selectedPublisherId)localStorage.setItem('tgzhushou:selected-publisher',selectedPublisherId);else localStorage.removeItem('tgzhushou:selected-publisher'); $('identity').textContent=data.publisher?`@${data.publisher.username} · 发布工作台`:'先在设置中配置发布机器人'; $('publisher').textContent=data.publisher?`当前：@${data.publisher.username}（${data.publisher.id}）`:'尚未配置'; $('adminInfo').textContent=data.admin?`${data.admin.name||'管理账号'} · ID ${data.admin.id||'—'}`:'未登录';ui.account(data);if(!initData)action(loadAdminAccounts);else $('accountManagement').hidden=true; $('publisherSelect').innerHTML=data.publishers.length?data.publishers.map(p=>`<option value="${esc(p.id)}">@${esc(p.username||p.id)}</option>`).join(''):'<option value="">尚未配置发布机器人</option>'; $('publisherSelect').value=data.publisher?.id||''; $('publisherSelect').disabled=!data.publishers.length||(!initData&&publisherChanging); renderRailPublisher(); loadRailBotAvatars(); updateMobileBotSwitch(); $('legacyImportSettings').hidden=!data.publisher;$('importSourceHint').textContent=data.publisher?`CSV 导入和用户源同步仅写入当前机器人 @${data.publisher.username} 的独立名单，不影响其他机器人。`:'请先选择已绑定的发布机器人。';$('settingsImportUsers').textContent='去用户页导入名单';$('ffaStatus').textContent='正在读取当前机器人的用户源配置…';$('ffaToken').value='';$('token').disabled=data.admin.canManageBots!==true;$('savePublisher').hidden=data.admin.canManageBots!==true;$('boundPublisherList').innerHTML=data.publishers.map(p=>`<div class="list-row"><span>@${esc(p.username||p.id)} · ${esc(p.id)}</span><button class="quiet" type="button" data-bound-bot="${esc(p.id)}" ${p.id===data.publisher?.id?'disabled':''}>${p.id===data.publisher?.id?'当前机器人':'切换'}</button></div>`).join(''); $('syncPlayers').hidden=!data.publisher; $('importPlayers').hidden=!data.publisher; populateTargets(selected); $('targets').innerHTML=data.targets.map(t=>`<div class="list-row"><div><strong>${esc(t.title)}</strong><small>${esc(t.chat_id)} · ${t.can_publish?'已具备权限':esc(t.last_error)}</small></div><button class="quiet danger-text" data-delete-target="${t.id}">删除</button></div>`).join(''); showTasks(); }
function renderRailPublisher() {
  const rail=$('railBots');if(!rail)return;
  rail.querySelector('.rail-bot')?.remove();
  const current=data?.publisher;
  const label=current?'@'+publisherLabel(current.id):'尚未配置发布机器人';
  const visual=document.createElement('div');visual.className='rail-bot active';visual.dataset.botId=current?.id||'';
  visual.setAttribute('aria-hidden','true');
  visual.innerHTML='<span>'+esc(label.replace(/^@/,'').slice(0,1).toUpperCase())+'</span><span class="rail-bot-name">'+esc(label)+'</span><span class="rail-bot-arrow">⌄</span>';
  rail.prepend(visual);
  $('publisherSelect').title=label;
}
function publisherLabel(id) { return data?.publishers?.find(p=>String(p.id)===String(id))?.username || id; }
function updateMobileBotSwitch() { const node=$('mobileBotSwitch'); if(!node)return; const current=data?.publisher?.id||selectedPublisherId; node.textContent=(publisherLabel(current)||'?').replace(/^@/,'').slice(0,1).toUpperCase(); node.title=`切换到 @${publisherLabel(current)}`; node.setAttribute('aria-label',node.title); }

async function switchPublisher(id) {
  if(publisherChanging)throw new Error('机器人正在切换，请稍候');publisherChanging=true;
  try{
  if (savePromise||$('chatSend').disabled||$('sendBroadcast').disabled) throw new Error('正在保存或发送，请稍后切换机器人');
  flushDraft();
  publisherRevision++;selectedPublisherId=id;clearPlayerContext();
  localStorage.setItem('tgzhushou:selected-publisher',id);
  activeChat=null;ui.chat(null);chatCursor=0;$('chatComposer').hidden=true;$('chatTitle').textContent='请选择会话';
  savedPacks=[];activePack=null;$('savePack').disabled=true;loadedPacks.clear();stickers.clear();$('emojiGrid').replaceChildren();$('pack').value='';$('packTitle').textContent='添加或切换';packError();pendingSend=null;conversationRows=[];chatRows=[];chatOlderCursor=null;chatButtons=[];chatButtonEditor();chatMedia=null;chatReply=null;chatQuill.setText('');$('chatReply').hidden=true;$('chatMedia').textContent='';$('chatSendStatus').textContent='';
  await refresh();
  let draft; try { draft=JSON.parse(localStorage.getItem(draftKey())||'null'); } catch { draft=null; }
  await fill(draft||{});
  await loadPlayers(); await loadRuns();
  await loadConversations();await loadInboxStatus();
  }finally{publisherChanging=false;if(!initData)$('publisherSelect').disabled=!data?.publishers?.length;}
}
$('boundPublisherList').onclick=event=>{const id=event.target.dataset.boundBot;if(id)action(()=>switchPublisher(id),event.target);};
$('publisherSelect').onchange=event=>action(async()=>{
  const select=event.currentTarget,id=select.value;
  try { await switchPublisher(id);toast(`已切换到 @${publisherLabel(data?.publisher?.id||selectedPublisherId)}`); }
  catch(error) {
    if(initData)throw error;
    // Bootstrap is authoritative. Restore the last confirmed scope after a failed switch.
    const confirmedId=data?.publisher?.id||'';
    if(selectedPublisherId!==confirmedId){selectedPublisherId=confirmedId;publisherRevision++;clearPlayerContext();}
    if(selectedPublisherId)localStorage.setItem('tgzhushou:selected-publisher',selectedPublisherId);
    else localStorage.removeItem('tgzhushou:selected-publisher');
    select.value=selectedPublisherId;renderRailPublisher();loadRailBotAvatars();
    throw error;
  }
},event.currentTarget);
$('mobileBotSwitch').onclick=event=>action(async()=>{const current=data?.publisher?.id||selectedPublisherId;const next=data?.publishers?.find(p=>String(p.id)!==String(current));if(next){await switchPublisher(next.id);toast(`已切换到 @${publisherLabel(next.id)}`);}},event.currentTarget);
function showTasks() {
  $('noTimedTasks').hidden=data.tasks.some(t=>JSON.parse(t.schedule_json).kind!=='MANUAL');
  $('taskList').innerHTML = data.tasks.length ? `<div class="${ui.mini?'mini-task-list':'card ops-table'}">${ui.mini?'':'<div class="ops-table-head"><span>任务</span><span>状态</span><span>类型</span><span>下次执行</span><span>操作</span></div>'}${data.tasks.map(t => {
    const stopped = t.status === 'STOPPED', timed = JSON.parse(t.schedule_json).kind !== 'MANUAL';
    const controls = stopped
      ? `<button class="quiet" data-task="${t.id}" data-action="activate">重新开始</button>`
      : `<button class="quiet" data-send-task="${t.id}">立即发布</button>${timed && t.status !== 'COMPLETED' ? `<button class="quiet" data-task="${t.id}" data-action="${t.status === 'ACTIVE' ? 'pause' : 'activate'}">${t.status === 'ACTIVE' ? '暂停' : '启用 / 恢复'}</button>` : ''}${['ACTIVE','PAUSED'].includes(t.status) ? `<button class="quiet danger-text" data-task="${t.id}" data-action="stop">停止</button>` : ''}`;
    return `<${ui.mini?'article':'div'} class="${ui.mini?'mini-task-card card':'ops-table-row'}" data-task-status="${esc(t.status)}"><div><strong>${esc(t.name)}</strong><small class="muted">#${t.id}</small></div><div><span class="status ${t.status}">${labels[t.status]}</span></div><div class="muted">${timed ? '定时任务' : '手动发布'}</div><div class="muted">${fmt(t.next_at)}</div><div class="wrap-actions"><button class="quiet" data-edit="${t.id}">编辑</button>${controls}<button class="quiet danger-text" data-delete-task="${t.id}">删除</button></div></${ui.mini?'article':'div'}>`;
  }).join('')}</div><p id="taskFilterEmpty" class="empty-state" hidden>该状态下暂无任务，请切换筛选。</p>` : '<div class="empty-state">还没有发布任务，请从编写活动开始。</div>';
  ui.applyFilter();
}
async function fill(item) { ui.resetEditor(); closePicker();quill.enable(false);$('toggleWriting').textContent='编辑文案'; clearTimeout(draftTimer); draftDirty=false; serverSnapshot=null; ready=false; taskId=item.taskId || null; $('name').value=item.name||''; quill.setContents(item.delta || {ops:[{insert:'\n'}]}); hydrateEmojiImages(quill.root); buttons=item.buttons||[];mediaId=item.mediaId||null;mediaInfo=item.mediaInfo||null;replacePhoto();if(mediaId){try{const blob=await loadImage(`/media/${mediaId}`);mediaInfo={...mediaInfo,id:mediaId,mime:blob.type,size:blob.size};if(blob.type.startsWith('image/'))replacePhoto(URL.createObjectURL(blob));}catch{toast('附件预览加载失败；保留原媒体 ID',true);}} const s=item.schedule||{kind:'MANUAL'}; $('kind').value=s.kind;$('start').value=s.start||'01:00';$('end').value=s.end||'05:00';$('interval').value=s.interval||30;$('unit').value='1';$('at').value=s.at?new Date(s.at+8*3600000).toISOString().slice(0,16):'';populateTargets(item.targetIds||[]);$('editorTitle').textContent=taskId?`编辑活动 #${taskId}`:'新建活动';showButtons();showPhoto();scheduleFields();ready=true; $('saveStatus').textContent=item.taskId || item.name ? '已恢复本机草稿 · 请保存到服务器' : '内容尚未保存到服务器'; }
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
$('saveFfaToken').onclick = event => action(async()=>{throw new Error('玩家同步功能已停用');},event.currentTarget);
$('savePublisher').onclick = event => action(async()=>{const result=await api('/publisher','POST',{token:$('token').value});$('token').value='';await switchPublisher(result.id);toast('发布机器人已验证并保存');},event.currentTarget);
$('browserLogout').hidden=false;
$('browserLogout').onclick=async()=>{await fetch('/auth/logout',{method:'POST'});location.reload();};
$('toggleLoginPassword').onclick=()=>{const input=$('loginPassword');const visible=input.type==='text';input.type=visible?'password':'text';$('toggleLoginPassword').textContent=visible?'◉':'◌';$('toggleLoginPassword').setAttribute('aria-label',visible?'显示密码':'隐藏密码');};
$('loginForm').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget, submit=$('loginSubmit'), username=$('loginUsername'), password=$('loginPassword'), error=$('authError');if(!form.checkValidity()){form.classList.add('was-validated');return;}submit.disabled=true;submit.setAttribute('aria-busy','true');form.classList.add('is-loading');error.textContent='';username.removeAttribute('aria-invalid');password.removeAttribute('aria-invalid');try{const response=await fetch('/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:username.value,password:password.value})});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||`登录失败 (${response.status})`);location.reload();}catch(loginError){error.textContent=loginError.message;username.setAttribute('aria-invalid','true');password.setAttribute('aria-invalid','true');}finally{submit.disabled=false;submit.removeAttribute('aria-busy');form.classList.remove('is-loading');}};
$('addTarget').onclick = event => action(async()=>{const t=await api('/targets','POST',{reference:$('targetRef').value});$('targetRef').value='';await refresh();toast(t.can_publish?'目标已添加':t.last_error,!t.can_publish);},event.currentTarget);
$('targets').onclick = event => action(async()=>{const id=event.target.dataset.deleteTarget;if(id&&confirm('删除该目标？引用它的任务将跳过此目标。')){await api(`/targets/${id}`,'DELETE');await refresh();}},event.target);
async function loadRuns() {
  const runs=await api('/runs');
  $('runList').innerHTML=runs.length ? `<div class="${ui.mini?'mini-run-list':'card ops-table run-table'}">${ui.mini?'':'<div class="ops-table-head"><span>活动</span><span>时间</span><span>成功 / 总数</span><span>结果</span><span>详情</span></div>'}${runs.map(r=>{
    const unknown=r.unknown_count||0, failed=r.failed_count||0, success=r.success_count||0;
    const status=unknown?'UNKNOWN':failed?'FAILED':success===r.total?'SUCCESS':'PENDING';
    const outcome=Number.isFinite(r.total)&&r.total>0&&failed===r.total&&success===0&&unknown===0?'执行已结束 · 全部失败':labels[status];
    return `<details class="${ui.mini?'mini-run-card card':'ops-run-row'}" data-run="${r.id}"><summary><strong>${esc(r.name)}</strong><span class="muted">${fmt(r.created_at)}</span><span>${success} / ${r.total}</span><span class="status ${status}">${outcome}</span><span class="muted" data-expand-label>展开详情</span></summary><div class="run-detail"><p>成功 ${success} / ${r.total} · 失败 ${failed} · 待核实 ${unknown}</p><button class="quiet" data-run-detail="${r.id}">查看各目标结果</button></div></details>`;
  }).join('')}</div>` : '<div class="empty-state">还没有发布记录，发布后的结果会显示在这里。</div>';
}
$('runList').onclick = event => action(async()=>{const id=event.target.dataset.runDetail;if(!id)return;await openSent('runs',id);},event.target);
$('runList').addEventListener('toggle',event=>{const details=event.target.closest('details[data-run]');if(details)details.querySelector('[data-expand-label]').textContent=details.open?'收起详情':'展开详情';},true);
$('refreshTasks').onclick=event=>action(()=>ui.load('tasks',refresh),event.currentTarget);$('refreshLogs').onclick=event=>action(()=>ui.load('logs',async()=>{await loadRuns();await loadBroadcasts();}),event.currentTarget); updatePlayerSelection(); async function loadFfaStatus(){const context=playerContext(),r=await api('/ffa');if(!currentPlayerContext(context))return;$('ffaStatus').textContent=r.configured?`已配置：${r.baseUrl}`:`未配置（接口：${r.baseUrl}）`;}
$('editor').addEventListener('input', event => { if (!event.target.closest('#message, #buttons')) remember(); });$('kind').onchange=()=>{scheduleFields();remember();};
$('ffaCard').hidden = true;
async function boot() { try{const token=location.hash.match(/^#login=([A-Za-z0-9_-]+)$/)?.[1];if(token){const response=await fetch('/auth/exchange',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})});history.replaceState(null,'',location.pathname);if(!response.ok)throw new Error('登录链接已过期或已使用');}await refresh();$('workspace').hidden=false;let draft;try{draft=JSON.parse(localStorage.getItem(draftKey())||'null');}catch{}await fill(draft||{});if(!data.publisher)changeTab('settings');else changeTab(sessionStorage.getItem('tgzhushou:tab')||'chat');await loadConversations();await loadInboxStatus();clearInterval(chatPolling);chatPolling=setInterval(()=>{if(!document.hidden||++hiddenPollTicks%8===0)pollChats();},2000);document.addEventListener('visibilitychange',()=>{if(!document.hidden){hiddenPollTicks=0;pollChats();}});navigator.serviceWorker?.register('/sw.js').catch(()=>{});}catch(error){$('locked').hidden=false;const authMessage=error?.status===401||error?.status===403?'账号或密码错误，请重试。':(error?.message==='未授权'?'登录状态已失效，请重新登录。':'登录页暂时无法加载，请稍后重试。');$('authError').textContent=authMessage;} }
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

async function accountRequest(method='GET',body) {
  const response=await fetch('/auth/admin-accounts',{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.error||`账号操作失败 (${response.status})`);
  return result;
}
async function loadAdminAccounts() {
  const allowed=data?.admin?.canManageAccounts===true;
  $('accountManagement').hidden=!allowed;if(!allowed){$('accountForm').hidden=true;$('newAccountPassword').value='';return;}
  const result=await accountRequest();
  $('accountPublishers').innerHTML=result.publishers.map(bot=>`<label><input type="checkbox" name="accountPublisher" value="${esc(bot.id)}"> @${esc(bot.username||bot.id)}</label>`).join('')||'<p>请先绑定发布机器人。</p>';
  $('accountList').innerHTML=result.accounts.map(account=>`<div class="list-row"><span>${esc(account.username)}</span><small>${account.publisherIds===undefined?'全部机器人':account.publisherIds.map(esc).join('、')||'无机器人权限'}</small></div>`).join('');
}
$('addAccount').onclick=()=>{$('accountForm').hidden=false;$('newAccountUsername').focus();};
$('cancelAccount').onclick=()=>{$('accountForm').reset();$('accountForm').hidden=true;};
$('accountForm').onsubmit=event=>{event.preventDefault();action(async()=>{
  const publisherIds=[...document.querySelectorAll('[name=accountPublisher]:checked')].map(node=>node.value);
  await accountRequest('POST',{username:$('newAccountUsername').value,password:$('newAccountPassword').value,publisherIds});
  $('accountForm').reset();$('accountForm').hidden=true;await loadAdminAccounts();toast('管理账号已添加');
},event.submitter);};

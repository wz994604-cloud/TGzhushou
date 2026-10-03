const q = (selector, root = document) => root.querySelector(selector);
const qa = (selector, root = document) => [...root.querySelectorAll(selector)];

const icons = {
  overview: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-12h6V4h-6v4Z"/></svg>',
  groups: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2.5 19a5.5 5.5 0 0 1 11 0M13 18a4.5 4.5 0 0 1 8.5 0"/></svg>',
  channels: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 18-8-7 18-3.5-6.5L3 11Zm7.5 3.5L21 3"/></svg>',
  analytics: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V9m5 10V5m5 14v-7m5 7V3"/></svg>'
};

function disabledNav(label, icon, hint = '即将开放') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ui-nav-item ui-nav-disabled';
  button.disabled = true;
  button.innerHTML = `${icon}<span class="ui-nav-label">${label}</span><em>${hint}</em>`;
  return button;
}

function groupLabel(text) {
  const span = document.createElement('span');
  span.className = 'ui-nav-group';
  span.textContent = text;
  return span;
}

function labelRailButton(button, label) {
  button.classList.add('ui-nav-item');
  if (!q('.ui-nav-label', button)) {
    const span = document.createElement('span');
    span.className = 'ui-nav-label';
    span.textContent = label;
    button.append(span);
  }
}

function buildRail() {
  const rail = q('.app-rail');
  const nav = q('.rail-nav');
  if (!rail || !nav || rail.dataset.previewReady) return;
  rail.dataset.previewReady = '1';

  const brand = q('.rail-brand', rail);
  if (brand) {
    brand.innerHTML = `<span class="ui-brand-plane"><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M43 7 5 22.4l13.1 4.5L34.8 13 21.7 29l-.5 11L28.8 32 39 39.4 43 7Z"/></svg></span><span class="ui-brand-copy"><strong>TGzhushou</strong><small>Telegram 运营工作台</small></span>`;
  }

  const menu = q('.rail-menu', rail);
  if (menu) menu.hidden = true;
  const bots = q('#railBots', rail);
  if (bots) bots.classList.add('ui-rail-bots');

  const buttons = Object.fromEntries(qa('[data-rail-tab]', nav).map(button => [button.dataset.railTab, button]));
  const labels = { chat:'聊天', editor:'编写活动', players:'用户', tasks:'发布任务', logs:'发布记录', settings:'系统设置' };
  Object.entries(buttons).forEach(([key, button]) => labelRailButton(button, labels[key] || key));

  nav.replaceChildren();
  nav.append(groupLabel('工作台'));
  const overview = document.createElement('button');
  overview.type = 'button';
  overview.className = 'ui-nav-item';
  overview.dataset.uiTab = 'overview';
  overview.innerHTML = `${icons.overview}<span class="ui-nav-label">运营概览</span>`;
  nav.append(overview, buttons.chat);
  nav.append(groupLabel('内容运营'));
  nav.append(buttons.editor, buttons.players);
  nav.append(groupLabel('任务中心'));
  nav.append(buttons.tasks, buttons.logs);
  nav.append(groupLabel('扩展能力'));
  nav.append(disabledNav('群组管理', icons.groups), disabledNav('频道管理', icons.channels), disabledNav('数据分析', icons.analytics));
  nav.append(groupLabel('系统'));
  nav.append(buttons.settings);

  const footer = document.createElement('div');
  footer.className = 'ui-rail-footer';
  footer.innerHTML = `<span class="ui-account-avatar">A</span><span><strong id="uiRailAccount">管理员</strong><small>当前工作区</small></span>`;
  rail.append(footer);

  overview.addEventListener('click', () => showOverview());
  qa('[data-rail-tab]', nav).forEach(button => button.addEventListener('click', () => {
    overview.classList.remove('active');
  }));
}

function buildTopbar() {
  const bar = q('.publisher-switch');
  if (!bar || bar.dataset.previewReady) return;
  bar.dataset.previewReady = '1';
  const account = document.createElement('div');
  account.className = 'ui-top-account';
  account.innerHTML = `<span class="ui-account-avatar">A</span><span id="uiTopAccount">管理员</span><span class="ui-chevron">⌄</span>`;
  bar.append(account);
}

function buildOverview() {
  const workspace = q('#workspace');
  if (!workspace || q('#overview')) return;
  const section = document.createElement('section');
  section.id = 'overview';
  section.className = 'page ui-overview';
  section.hidden = true;
  section.innerHTML = `
    <div class="ui-page-heading"><div><h2>运营概览</h2><p>基于当前工作台真实数据汇总，不展示虚构指标。</p></div><span class="ui-live-chip"><i></i>实时状态</span></div>
    <div class="ui-metric-grid">
      <article class="ui-metric"><span class="ui-metric-icon users">◎</span><div><small>用户总数</small><strong id="uiMetricUsers">—</strong><em>当前用户库</em></div></article>
      <article class="ui-metric"><span class="ui-metric-icon send">➤</span><div><small>发布任务</small><strong id="uiMetricTasks">—</strong><em>当前机器人</em></div></article>
      <article class="ui-metric"><span class="ui-metric-icon unread">✉</span><div><small>未读会话</small><strong id="uiMetricUnread">—</strong><em>实时收件箱</em></div></article>
      <article class="ui-metric"><span class="ui-metric-icon bot">◇</span><div><small>发布机器人</small><strong id="uiMetricBot">—</strong><em>当前选择</em></div></article>
    </div>
    <div class="ui-overview-grid">
      <article class="ui-panel ui-trend-panel"><div class="ui-panel-head"><div><h3>消息发送趋势</h3><p>项目当前未提供聚合趋势接口，保留真实数据位。</p></div><span class="ui-subtle-badge">暂无统计接口</span></div><div class="ui-empty-chart"><div class="ui-chart-grid"></div><span>接入真实统计数据后将在这里展示趋势</span></div></article>
      <article class="ui-panel ui-activity-panel"><div class="ui-panel-head"><div><h3>实时动态</h3><p>来自当前工作台状态</p></div></div><div id="uiActivityList" class="ui-activity-list"></div></article>
      <article class="ui-panel ui-bot-panel"><div class="ui-panel-head"><div><h3>机器人状态</h3><p>当前发布机器人</p></div></div><div id="uiBotStatus" class="ui-bot-status"></div></article>
      <article class="ui-panel ui-task-panel"><div class="ui-panel-head"><div><h3>当前任务</h3><p>直接读取现有任务列表</p></div><button type="button" class="quiet" data-jump-tab="tasks">查看任务</button></div><div id="uiOverviewTasks" class="ui-overview-task-list"></div></article>
    </div>`;
  const chat = q('#chat');
  workspace.insertBefore(section, chat || null);
  section.addEventListener('click', event => {
    const tab = event.target.closest('[data-jump-tab]')?.dataset.jumpTab;
    if (!tab) return;
    q(`[data-rail-tab="${tab}"]`)?.click();
  });
}

function showOverview() {
  qa('.page').forEach(page => { page.hidden = page.id !== 'overview'; });
  qa('[data-rail-tab]').forEach(button => button.classList.remove('active'));
  q('[data-ui-tab="overview"]')?.classList.add('active');
  sessionStorage.setItem('tgzhushou:tab', 'overview');
  updateOverview();
}

function numericText(node) {
  const value = node?.textContent?.match(/[\d,]+/)?.[0];
  return value || '—';
}

function updateOverview() {
  const user = q('#uiMetricUsers');
  const tasks = q('#uiMetricTasks');
  const unread = q('#uiMetricUnread');
  const bot = q('#uiMetricBot');
  if (!user) return;
  user.textContent = numericText(q('#userTotal'));
  tasks.textContent = String(qa('#taskList article.card').length || 0);
  unread.textContent = numericText(q('#chatUnread'));
  const selected = q('#publisherSelect option:checked');
  bot.textContent = selected?.textContent?.replace(/^@/, '') || '未配置';

  const activity = q('#uiActivityList');
  if (activity) {
    const rows = [];
    const inbox = q('#inboxStatus')?.textContent?.trim();
    if (inbox) rows.push(['收件箱状态', inbox, 'blue']);
    const ffa = q('#ffaStatus')?.textContent?.trim();
    if (ffa) rows.push(['用户接口', ffa, 'green']);
    const runCount = qa('#runList details.card').length;
    rows.push(['发布记录', runCount ? `当前已载入 ${runCount} 条记录` : '暂无发布记录', runCount ? 'purple' : 'gray']);
    activity.innerHTML = rows.map(([title, text, tone]) => `<div class="ui-activity-row"><span class="ui-activity-dot ${tone}"></span><div><strong>${title}</strong><small>${text}</small></div></div>`).join('');
  }

  const botStatus = q('#uiBotStatus');
  if (botStatus) botStatus.innerHTML = selected ? `<span class="ui-bot-avatar">➤</span><div><strong>${selected.textContent}</strong><small>当前发布机器人</small></div><span class="ui-status-pill success">已选择</span>` : '<div class="ui-empty-inline">尚未配置发布机器人</div>';

  const taskPreview = q('#uiOverviewTasks');
  if (taskPreview) {
    const taskCards = qa('#taskList article.card').slice(0, 4);
    taskPreview.innerHTML = taskCards.length ? taskCards.map(card => {
      const title = q('h3', card)?.textContent || '任务';
      const state = q('.status', card)?.textContent || '—';
      const next = q('.muted', card)?.textContent || '';
      return `<div class="ui-overview-task"><strong>${title}</strong><small>${next}</small><span>${state}</span></div>`;
    }).join('') : '<div class="ui-empty-inline">还没有发布任务</div>';
  }
}

function buildChatProfile() {
  const shell = q('#chat .chat-shell');
  if (!shell || q('.ui-chat-profile', shell)) return;
  const aside = document.createElement('aside');
  aside.className = 'ui-chat-profile';
  aside.innerHTML = `<div class="ui-profile-head"><h3>会话资料</h3><span>×</span></div><div class="ui-profile-person"><span id="uiProfileAvatar" class="ui-profile-avatar">?</span><strong id="uiProfileName">请选择会话</strong><small>Telegram 会话</small></div><div class="ui-profile-actions"><button type="button" disabled>消息</button><button type="button" disabled>资料</button><button type="button" disabled>更多</button></div><div class="ui-profile-section"><h4>当前状态</h4><p id="uiProfileState">选择左侧会话后查看消息。</p></div><div class="ui-profile-section"><h4>说明</h4><p>这里只展示当前项目能够确认的会话信息，不生成虚构用户资料。</p></div>`;
  shell.append(aside);
  const title = q('#chatTitle');
  const sync = () => {
    const value = title?.textContent?.trim() || '请选择会话';
    q('#uiProfileName').textContent = value;
    q('#uiProfileAvatar').textContent = value === '请选择会话' ? '?' : value.slice(0, 1).toUpperCase();
    q('#uiProfileState').textContent = value === '请选择会话' ? '选择左侧会话后查看消息。' : `正在查看：${value}`;
  };
  sync();
  if (title) new MutationObserver(sync).observe(title, { childList:true, subtree:true, characterData:true });
}

function classifyEditor() {
  const editor = q('#editor');
  if (!editor || editor.dataset.previewReady || !matchMedia('(min-width: 900px)').matches) return;
  editor.dataset.previewReady = '1';
  const cards = [...editor.children].filter(node => node.classList?.contains('card') || node.id === 'previewPanel');
  const byText = text => cards.find(card => card.textContent.includes(text));
  byText('活动名称')?.classList.add('ui-editor-primary');
  byText('跳转按钮')?.classList.add('ui-editor-buttons');
  const targets = byText('发布目标');
  const preview = q('#previewPanel', editor);
  const side = document.createElement('div');
  side.className = 'ui-editor-side';
  if (targets) side.append(targets);
  if (preview) { preview.open = true; side.append(preview); }
  if (targets || preview) editor.insertBefore(side, q('.actions', editor));
  byText('私信用户')?.classList.add('ui-editor-users');
}

function decoratePlayerRows() {
  qa('#playerList label.check').forEach(row => {
    if (q('.ui-player-avatar', row)) return;
    const span = q('span', row);
    if (!span) return;
    const name = [...span.childNodes].find(n => n.nodeType === Node.TEXT_NODE)?.textContent?.trim() || '用';
    const avatar = document.createElement('span');
    avatar.className = 'ui-player-avatar';
    avatar.textContent = name.slice(0, 1).toUpperCase();
    row.insertBefore(avatar, span);
  });
  qa('#selectedPlayerList .list-row').forEach(row => {
    if (q('.ui-player-avatar', row)) return;
    const name = q('strong', row)?.textContent?.trim() || '用';
    const avatar = document.createElement('span');
    avatar.className = 'ui-player-avatar';
    avatar.textContent = name.slice(0, 1).toUpperCase();
    row.prepend(avatar);
  });
}

function enhancePlayers() {
  ['selectedPanel','usersPanel','broadcastPanel'].forEach(id => { const node = q('#' + id); if (node) node.open = true; });
  const list = q('#playerList');
  const selected = q('#selectedPlayerList');
  if (list) new MutationObserver(() => decoratePlayerRows()).observe(list, { childList:true });
  if (selected) new MutationObserver(() => decoratePlayerRows()).observe(selected, { childList:true });
  decoratePlayerRows();
}

function enhanceSettings() {
  const page = q('#settings');
  if (!page || page.dataset.previewReady || !matchMedia('(min-width: 900px)').matches) return;
  page.dataset.previewReady = '1';
  const heading = q(':scope > h2', page);
  if (heading) {
    const intro = document.createElement('p');
    intro.className = 'ui-settings-intro';
    intro.textContent = '配置机器人、用户接口、目标群/频道及管理账号。';
    heading.after(intro);
  }
  const cards = qa(':scope > .card', page);
  const layout = document.createElement('div');
  layout.className = 'ui-settings-layout';
  const menu = document.createElement('aside');
  menu.className = 'ui-settings-menu';
  const content = document.createElement('div');
  content.className = 'ui-settings-content';
  const names = ['发布机器人','发发娱乐用户接口','目标群 / 频道','管理账号'];
  cards.forEach((card, index) => {
    card.id = card.id || `uiSettingCard${index}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = index === 0 ? 'active' : '';
    button.innerHTML = `<span>${['◇','↗','◎','○'][index] || '•'}</span><div><strong>${names[index] || q('h3', card)?.textContent || '设置'}</strong><small>${['配置 Telegram 机器人','配置用户接口凭证','管理需要运营的目标','查看当前账号信息'][index] || ''}</small></div>`;
    button.addEventListener('click', () => {
      qa('button', menu).forEach(b => b.classList.toggle('active', b === button));
      card.scrollIntoView({ behavior:'smooth', block:'start' });
    });
    menu.append(button);
    content.append(card);
  });
  layout.append(menu, content);
  page.append(layout);
}

function decorateTaskAndRuns() {
  qa('#taskList article.card').forEach(card => card.classList.add('ui-task-row'));
  qa('#runList details.card').forEach(card => card.classList.add('ui-run-row'));
  updateOverview();
}

function syncAccount() {
  const text = q('#adminInfo')?.textContent?.trim();
  if (!text) return;
  const label = text.split('·')[0]?.trim() || '管理员';
  const rail = q('#uiRailAccount');
  const top = q('#uiTopAccount');
  if (rail) rail.textContent = label;
  if (top) top.textContent = label;
}

function workspaceVisibility() {
  document.body.classList.toggle('ui-workspace-visible', !q('#workspace')?.hidden);
}

function bootPreview() {
  if (!q('#workspace') || !q('.app-rail')) return requestAnimationFrame(bootPreview);
  document.body.classList.add('ui-preview');
  buildRail();
  buildTopbar();
  buildOverview();
  buildChatProfile();
  classifyEditor();
  enhancePlayers();
  enhanceSettings();
  decorateTaskAndRuns();
  syncAccount();
  workspaceVisibility();

  const workspace = q('#workspace');
  new MutationObserver(() => { workspaceVisibility(); syncAccount(); updateOverview(); }).observe(workspace, { attributes:true, subtree:true, childList:true, characterData:true });
  ['taskList','runList','userTotal','chatUnread','publisherSelect','adminInfo'].forEach(id => {
    const node = q('#' + id);
    if (node) new MutationObserver(() => { decorateTaskAndRuns(); syncAccount(); }).observe(node, { childList:true, subtree:true, characterData:true });
  });

  if (sessionStorage.getItem('tgzhushou:tab') === 'overview') showOverview();
}

bootPreview();

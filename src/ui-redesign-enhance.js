const one = (s, r = document) => r.querySelector(s);
const many = (s, r = document) => [...r.querySelectorAll(s)];

function waitReady() {
  if (!document.body.classList.contains('ui-preview') || !one('#workspace')) return requestAnimationFrame(waitReady);
  enhanceTopbar();
  enhanceChatList();
  enhanceUsers();
  enhanceTaskTables();
}

function enhanceTopbar() {
  const bar = one('.publisher-switch');
  if (!bar || one('.ui-global-search', bar)) return;
  const search = document.createElement('label');
  search.className = 'ui-global-search';
  search.innerHTML = '<span aria-hidden="true">⌕</span><input type="search" placeholder="搜索会话…" aria-label="搜索会话">';
  bar.prepend(search);
  const input = one('input', search);
  input.addEventListener('input', () => {
    const chatSearch = one('#chatSearch');
    if (!chatSearch) return;
    chatSearch.value = input.value;
    chatSearch.dispatchEvent(new Event('input', { bubbles:true }));
  });
}

function enhanceChatList() {
  const list = one('#chat .chat-list');
  if (!list || one('.ui-chat-filters', list)) return;
  const filters = document.createElement('div');
  filters.className = 'ui-chat-filters';
  filters.innerHTML = '<button type="button" class="active">全部</button><button type="button" disabled>未读 <b id="uiUnreadFilter">0</b></button><button type="button" disabled>群组</button><button type="button" disabled>频道</button>';
  const search = one('#chatSearch', list);
  if (search) search.before(filters);
  const unread = one('#chatUnread');
  const sync = () => { const value = unread?.textContent?.match(/\d+/)?.[0] || '0'; const target = one('#uiUnreadFilter'); if (target) target.textContent = value; };
  sync();
  if (unread) new MutationObserver(sync).observe(unread, { childList:true, subtree:true, characterData:true });
}

function decorateUserRows() {
  many('#playerList label.check').forEach(row => {
    if (row.dataset.tableReady) return;
    row.dataset.tableReady = '1';
    const enabled = !one('input', row)?.disabled;
    const state = document.createElement('span');
    state.className = 'ui-player-state ' + (enabled ? 'active' : 'inactive');
    state.textContent = enabled ? '活跃' : '非活跃';
    row.append(state);
  });
}

function enhanceUsers() {
  const panel = one('#usersPanel');
  if (!panel) return;
  const list = one('#playerList', panel);
  if (!one('.ui-player-table-head', panel) && list) {
    const head = document.createElement('div');
    head.className = 'ui-player-table-head';
    head.innerHTML = '<span></span><span>用户</span><span>Telegram ID / 用户名</span><span>状态</span>';
    list.before(head);
  }
  decorateUserRows();
  if (list) new MutationObserver(decorateUserRows).observe(list, { childList:true });
}

function enhanceTaskTables() {
  const tasks = one('#taskList');
  if (tasks && !one('.ui-task-table-head', tasks)) {
    const head = document.createElement('div');
    head.className = 'ui-task-table-head';
    head.innerHTML = '<span>任务名称 / 状态</span><span>下次投递时间</span><span>操作</span>';
    tasks.prepend(head);
  }
  const runs = one('#runList');
  if (runs && !one('.ui-run-table-head', runs)) {
    const head = document.createElement('div');
    head.className = 'ui-run-table-head';
    head.innerHTML = '<span>任务名称</span><span>投递时间</span>';
    runs.prepend(head);
  }
  if (tasks) new MutationObserver(() => {
    if (!one('.ui-task-table-head', tasks)) enhanceTaskTables();
  }).observe(tasks, { childList:true });
  if (runs) new MutationObserver(() => {
    if (!one('.ui-run-table-head', runs)) enhanceTaskTables();
  }).observe(runs, { childList:true });
}

waitReady();

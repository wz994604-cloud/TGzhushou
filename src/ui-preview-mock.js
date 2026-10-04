const originalFetch = window.fetch.bind(window);

const json = (body, init = {}) => new Response(JSON.stringify(body), {
  status: init.status || 200,
  headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers || {}) }
});

const svgAvatar = (label = 'T') => new Response(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#229ED9"/><stop offset="1" stop-color="#1476C6"/></linearGradient></defs><rect width="96" height="96" rx="48" fill="url(#g)"/><text x="48" y="59" text-anchor="middle" font-size="34" font-family="Arial" fill="white">${String(label).slice(0,1)}</text></svg>`,
  { status: 200, headers: { 'content-type': 'image/svg+xml' } }
);

const now = Date.now();
const iso = offset => new Date(now + offset).toISOString();
const tasks = [
  { id: 1, name: '新版本通知', status: 'ACTIVE', next_at: iso(45 * 60 * 1000), schedule_json: JSON.stringify({ kind: 'DAILY', start: '09:00', end: '09:00', interval: 1440 }), target_ids_json: '[1]', buttons_json: '[]', delta_json: '[{"insert":"新版本通知\\n"}]', media_id: null },
  { id: 2, name: '活动群发', status: 'ACTIVE', next_at: iso(2 * 60 * 60 * 1000), schedule_json: JSON.stringify({ kind: 'ONCE', at: now + 2 * 60 * 60 * 1000 }), target_ids_json: '[2]', buttons_json: '[]', delta_json: '[{"insert":"活动群发\\n"}]', media_id: null },
  { id: 3, name: '欢迎私信', status: 'PAUSED', next_at: null, schedule_json: JSON.stringify({ kind: 'MANUAL' }), target_ids_json: '[]', buttons_json: '[]', delta_json: '[{"insert":"欢迎加入\\n"}]', media_id: null }
];

const players = [
  ['734921003','清风','qingfeng',true],['728104556','Moonlight','moonlight',true],['719003221','山海','shanhai',true],['812445667','Luna','luna_1024',false],['701238904','晨曦','chenxi',true],['765443210','阿柴','achai',true],['793221778','星辰','xingchen',false],['746339005','Blue','blue_sky',true],['708112334','小鹿','xiaolu',true],['777665443','Echo','echooo',false]
].map(([telegram_id, display_name, username, active]) => ({ telegram_id, display_name, username, active }));

const conversations = [
  { chat_id: '1001', title: '林小雨', last_message_text: '好的，已经收到资料了，非常感谢！', last_message_at: iso(-2 * 60 * 1000), unread_count: 3 },
  { chat_id: '1002', title: '产品咨询群', last_message_text: '这个功能什么时候上线？', last_message_at: iso(-8 * 60 * 1000), unread_count: 12 },
  { chat_id: '1003', title: 'Michael Chen', last_message_text: 'Can you send me the details?', last_message_at: iso(-33 * 60 * 1000), unread_count: 1 },
  { chat_id: '1004', title: '跨境电商运营交流', last_message_text: '有最新的投放方案分享吗？', last_message_at: iso(-46 * 60 * 1000), unread_count: 0 },
  { chat_id: '1005', title: 'Sophia', last_message_text: 'Thank you! It works now.', last_message_at: iso(-3 * 60 * 60 * 1000), unread_count: 0 }
];

const messages = {
  '1001': [
    { telegram_message_id: 1, direction: 'IN', text: '你好，我想了解一下你们的 TGzhushou 系统。', sent_at: iso(-24 * 60 * 1000) },
    { telegram_message_id: 2, direction: 'OUT', text: '你好，感谢你的咨询！目前支持多账号管理、自动化消息推送、用户管理和活动发布。', sent_at: iso(-20 * 60 * 1000) },
    { telegram_message_id: 3, direction: 'IN', text: '我比较关注自动化运营和定时推送。', sent_at: iso(-15 * 60 * 1000) },
    { telegram_message_id: 4, direction: 'OUT', text: '可以，现有工作台已经支持任务、记录、用户和会话管理。', sent_at: iso(-10 * 60 * 1000) },
    { telegram_message_id: 5, direction: 'IN', text: '好的，已经收到资料了，非常感谢！', sent_at: iso(-2 * 60 * 1000) }
  ]
};

const runs = [
  { id: 101, name: '新版本通知', created_at: iso(-30 * 60 * 1000), success_count: 320, failed_count: 0, unknown_count: 0, total: 320 },
  { id: 102, name: '活动群发', created_at: iso(-4 * 60 * 60 * 1000), success_count: 5, failed_count: 0, unknown_count: 0, total: 5 },
  { id: 103, name: '测试任务', created_at: iso(-24 * 60 * 60 * 1000), success_count: 42, failed_count: 3, unknown_count: 0, total: 45 }
];

function mockApi(path, method) {
  if (path === '/api/bootstrap') return json({
    publisher: { id: 'demo-bot', username: 'ActivityBot', legacy: false },
    publishers: [{ id: 'demo-bot', username: 'ActivityBot', legacy: false }],
    admin: { id: 'preview', name: '预览管理员' },
    targets: [
      { id: 1, title: 'TG 资源分享', chat_id: '@tg_resources', can_publish: true, last_error: '' },
      { id: 2, title: '加密爱好者社区', chat_id: '@crypto_group', can_publish: true, last_error: '' }
    ],
    tasks
  });
  if (path.startsWith('/api/players/ids')) return json({ rows: players.filter(p => p.active) });
  if (path.startsWith('/api/players')) return json({ rows: players, total: 50 });
  if (path === '/api/runs') return json(runs);
  if (path === '/api/broadcasts') return json([]);
  if (path === '/api/inbox/status') return json({ status: 'READY', enabled: true, external: false });
  if (path.startsWith('/api/chat/updates')) return json({ rows: [], cursor: 1 });
  if (path.startsWith('/api/chat/conversations?')) return json({ rows: conversations, totalUnread: 16, cursor: 1, next: null });
  const msgMatch = path.match(/^\/api\/chat\/conversations\/([^/]+)\/messages/);
  if (msgMatch) return json({ rows: messages[decodeURIComponent(msgMatch[1])] || [], next: null });
  if (/^\/api\/chat\/conversations\/[^/]+\/read$/.test(path)) return json({ ok: true });
  if (path === '/api/sticker-packs/saved') return json({ packs: [] });
  if (path === '/api/ffa') return json({ configured: false, baseUrl: '预览模式' });
  if (path.startsWith('/api/chat/bot-avatars/') || path.startsWith('/api/chat/avatars/')) return svgAvatar('T');
  if (method !== 'GET') return json({ error: '临时预览为只读模式，不会执行真实写入。' }, { status: 403 });
  return json({});
}

window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url || '';
  const method = String(init.method || (typeof input !== 'string' && input?.method) || 'GET').toUpperCase();
  let path = url;
  try { path = new URL(url, location.origin).pathname + new URL(url, location.origin).search; } catch {}
  if (path.startsWith('/api/')) return mockApi(path, method);
  if (path.startsWith('/auth/')) return json({ error: '预览模式不需要登录。' }, { status: 403 });
  return originalFetch(input, init);
};

document.documentElement.dataset.previewMode = 'safe-mock';

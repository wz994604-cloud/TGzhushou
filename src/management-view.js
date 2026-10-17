const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function accountManagementHtml(accounts, publishers) {
  const botNames = new Map(publishers.map(bot => [String(bot.id), `@${bot.username || bot.id}`]));
  return accounts.map(account => {
    const grants = account.publisherIds === undefined
      ? '全部机器人'
      : account.publisherIds.map(id => botNames.get(String(id)) || `已移除机器人 ${id}`).join('、') || '无机器人权限';
    const owner = account.username === 'wz9946';
    return `<div class="management-row" data-account="${escapeHtml(account.username)}"><div class="management-identity"><strong>${escapeHtml(account.username)}</strong><span class="management-state ${account.enabled ? 'is-enabled' : 'is-disabled'}">${account.enabled ? '启用' : '已停用'}</span><small>${escapeHtml(grants)}</small></div>${owner ? '<small class="muted">主账号</small>' : `<div class="management-actions"><button type="button" data-account-action="edit" data-username="${escapeHtml(account.username)}">权限</button><button type="button" data-account-action="password" data-username="${escapeHtml(account.username)}">重置密码</button><button type="button" data-account-action="toggle" data-enabled="${account.enabled ? 'false' : 'true'}" data-username="${escapeHtml(account.username)}">${account.enabled ? '停用' : '启用'}</button><button type="button" class="danger-text" data-account-action="remove" data-username="${escapeHtml(account.username)}">删除</button></div>`}</div>`;
  }).join('') || '<p class="empty-state">还没有管理账号。</p>';
}

export function publisherManagementHtml(publishers, currentId) {
  return publishers.map(bot => {
    const status = bot.status || 'ACTIVE';
    const enabled = status === 'ACTIVE';
    return `<div class="management-row" data-publisher="${escapeHtml(bot.id)}"><div class="management-identity"><strong>@${escapeHtml(bot.username || bot.id)}</strong><span class="management-state ${enabled ? 'is-enabled' : 'is-disabled'}">${enabled ? '运行中' : '已停用'}</span><small>ID ${escapeHtml(bot.id)}</small></div><div class="management-actions"><button type="button" data-bound-bot="${escapeHtml(bot.id)}" ${String(bot.id) === String(currentId) ? 'disabled' : ''}>${String(bot.id) === String(currentId) ? '当前机器人' : '切换'}</button><button type="button" data-robot-action="verify" data-id="${escapeHtml(bot.id)}">验证</button><button type="button" data-robot-action="token" data-id="${escapeHtml(bot.id)}">更换 Token</button><button type="button" data-robot-action="toggle" data-enabled="${enabled ? 'false' : 'true'}" data-id="${escapeHtml(bot.id)}">${enabled ? '停用' : '启用'}</button><button type="button" class="danger-text" data-robot-action="remove" data-id="${escapeHtml(bot.id)}">移除</button></div></div>`;
  }).join('') || '<p class="empty-state">还没有绑定发布机器人。</p>';
}

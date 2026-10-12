const COMMAND_RE = /^\/([a-z0-9_]+)(?:@\w+)?(?:\s|$)/i;

export function entryCommand(text) {
  return String(text || '').match(COMMAND_RE)?.[1]?.toLowerCase() || '';
}

const helpText = [
  '飞机助手入口帮助',
  '',
  '/start：打开活动工作台',
  '/login：获取网页登录链接',
  '/help：查看这份帮助',
  '',
  '如果按钮无法打开，请重新发送 /start；仍有问题请联系管理员。',
].join('\n');

export function entryReply({ command, isAdmin, publicUrl }) {
  if (command === 'start' && isAdmin && publicUrl) {
    return {
      text: '欢迎使用飞机助手。',
      reply_markup: { inline_keyboard: [[{ text: '打开活动工作台', web_app: { url: publicUrl } }]] },
    };
  }
  if (command === 'start' && isAdmin) {
    return { text: '工作台地址暂未配置，请联系管理员检查 Railway 的 PUBLIC_URL。' };
  }
  if (command === 'start') {
    return { text: '欢迎使用飞机助手。\n当前账号暂无管理权限，请联系管理员开通后再使用。' };
  }
  if (command === 'login') {
    return isAdmin
      ? null
      : { text: '当前账号没有网页登录权限，请联系管理员开通后再重试。' };
  }
  if (command === 'help') return { text: helpText };
  return { text: '暂不支持这个入口命令。发送 /help 查看可用命令。' };
}

export function loginReply(url) {
  return url
    ? { text: '网页登录链接已生成，有效期 5 分钟，请勿转发给他人。', reply_markup: { inline_keyboard: [[{ text: '打开网页登录', url }]] } }
    : { text: '当前账号没有网页登录权限，请联系管理员开通后再重试。' };
}

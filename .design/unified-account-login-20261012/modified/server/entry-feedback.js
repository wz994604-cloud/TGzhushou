const COMMAND_RE = /^\/([a-z0-9_]+)(?:@\w+)?(?:\s|$)/i;
export function entryCommand(text) {
  return String(text || '').match(COMMAND_RE)?.[1]?.toLowerCase() || '';
}
const helpText = [
  '飞机助手入口帮助', '',
  '/start：打开工作台登录页', '/login：打开工作台登录页', '/help：查看这份帮助', '',
  '所有用户均可打开入口，使用管理员分配的账号密码登录。',
  '账号和机器人权限请联系管理员配置。',
].join('\n');
export function entryReply({ command, publicUrl }) {
  if (command === 'start' || command === 'login') {
    const url = String(publicUrl || '').replace(/\/$/, '');
    if (!url) return { text: '工作台地址暂未配置，请联系管理员检查 Railway 的 PUBLIC_URL。' };
    return {
      text: '欢迎使用飞机助手。请使用后台账号密码登录。',
      reply_markup: { inline_keyboard: [[{ text: '打开工作台登录', web_app: { url } }]] },
    };
  }
  if (command === 'help') return { text: helpText };
  return { text: '暂不支持这个入口命令。发送 /help 查看可用命令。' };
}

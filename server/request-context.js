export const route = fn => async (req, res, next) => {
  try { await fn(req, res); } catch (error) { next(error); }
};

export const canAccessBot = (admin, id) =>
  !Array.isArray(admin.publisherIds) || admin.publisherIds.includes(String(id));

export const currentBot = req => req.publisher;
export const selectedBotId = req => currentBot(req)?.id || '';

export function requirePlayerBot(req) {
  const id = selectedBotId(req);
  if (!id) throw new Error('请先选择已绑定的发布机器人');
  return id;
}

export function assertSelected(req, botId) {
  if (botId !== selectedBotId(req)) throw new Error('记录不属于所选机器人');
}

import { getPublisher, savePublisher, updatePublisherToken, setPublisherStatus } from './publishers.js';

export function registerPublisherRoutes(app, { db, configKey, entryToken, botCall, accountAuth, route }) {
  const owner = handler => route(async(req,res) => {
    if (req.admin?.canManageBots !== true) return res.status(403).json({error:'仅 wz9946 可管理机器人'});
    await handler(req,res);
  });
  async function identity(token) {
    if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error('机器人 Token 格式不正确');
    const result = await botCall(token,'getMe');
    if (!result.is_bot || token === entryToken) throw new Error('发布机器人必须使用独立身份');
    return result;
  }
  const audit = (req,action,target) => accountAuth.audit({actor:req.admin.username || req.admin.id,action,target:String(target)});
  app.post('/api/publisher',owner(async(req,res) => {
    const token=String(req.body?.token || '').trim(), info=await identity(token);
    const result=await savePublisher(db,configKey,info,token);
    await audit(req,'publisher.bind',result.id);res.json(result);
  }));
  app.post('/api/publishers/:id/verify',owner(async(req,res) => {
    const bot=await getPublisher(db,configKey,req.params.id,{includeInactive:true});
    if (!bot) return res.sendStatus(404);
    const info=await identity(bot.token);
    if (String(info.id)!==bot.id) throw new Error('机器人身份不匹配');
    await audit(req,'publisher.verify',bot.id);res.json({ok:true,id:bot.id,username:info.username || ''});
  }));
  app.put('/api/publishers/:id/token',owner(async(req,res) => {
    const token=String(req.body?.token || '').trim(), info=await identity(token);
    const result=await updatePublisherToken(db,configKey,req.params.id,info,token);
    await audit(req,'publisher.token',result.id);res.json(result);
  }));
  app.post('/api/publishers/:id/status',owner(async(req,res) => {
    const action=req.body?.action;
    if (!['enable','disable'].includes(action)) throw new Error('操作无效');
    const result=await setPublisherStatus(db,req.params.id,action==='enable'?'ACTIVE':'DISABLED');
    await audit(req,`publisher.${action}`,result.id);res.json(result);
  }));
  app.delete('/api/publishers/:id',owner(async(req,res) => {
    const result=await db.transaction(async()=>{
      const changed=await setPublisherStatus(db,req.params.id,'REMOVED');
      await accountAuth.revokeBotAccess(changed.id,{actor:req.admin.username || req.admin.id});
      await audit(req,'publisher.remove',changed.id);return changed;
    })();
    res.json(result);
  }));
}

import crypto from 'node:crypto';
import {getSetting, setSetting} from './db.js';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const cookies = raw => Object.fromEntries(String(raw || '').split(';').map(part => {
  const at = part.indexOf('='); return at < 0 ? ['', ''] : [part.slice(0,at).trim(),part.slice(at+1).trim()];
}));

export async function createAccountAuth(db, credentials = {}) {
  const salt = String(credentials.salt || 'tgzhushou-browser-login');
  const accounts = (Array.isArray(credentials.accounts) ? credentials.accounts : [])
    .map(account => {
      if (account?.publisherIds !== undefined && (!Array.isArray(account.publisherIds) || account.publisherIds.some(id => !/^\d+$/.test(String(id)))))
        throw new Error('管理员 publisherIds 应为机器人 ID 数组');
      return {username:String(account?.username || '').trim(), password:String(account?.password || ''),
        ...(account?.publisherIds !== undefined ? {publisherIds:[...new Set(account.publisherIds.map(String))]} : {})};
    })
    .filter(account => account.username && account.password)
    .map(({password, ...account}) => ({...account, passwordKey:crypto.scryptSync(password, salt, 32)}));
  const failures = new Map();
  const storedAccounts = async () => JSON.parse((await getSetting(db, 'admin_accounts_v1')) || '[]');
  const mergedAccounts = async () => {
    const merged = new Map(accounts.map(account => [account.username, {...account}]));
    for (const account of await storedAccounts()) merged.set(account.username, {...merged.get(account.username), ...account,
      ...(account.passwordHash ? {passwordKey:undefined} : {})});
    return [...merged.values()].filter(account => !account.deleted);
  };
  const findAccount = async username => (await mergedAccounts()).find(account => account.username === username);
  const publicAccount = account => ({username:account.username, publisherIds:account.publisherIds,
    enabled:account.enabled !== false, canManageAccounts:account.username === 'wz9946'});
  const passwordFields = password => {
    const passwordSalt = crypto.randomBytes(16).toString('base64url');
    return {passwordSalt,passwordHash:crypto.scryptSync(password,passwordSalt,32).toString('base64')};
  };
  const validPassword = password => typeof password === 'string' && password.length >= 4 && password.length <= 128;
  const matchesPassword = (account, password) => {
    if (!account || typeof password !== 'string' || password.length > 128) return false;
    const input = crypto.scryptSync(password,account.passwordSalt || salt,32);
    const expected = account.passwordKey || Buffer.from(account.passwordHash || '', 'base64');
    return input.length === expected.length && crypto.timingSafeEqual(input,expected);
  };
  // A persistent generation makes sessions issued concurrently with deletion/reset obsolete too.
  const accountIdentity = account => `account:${account.username}${account.identityVersion ? ':'+account.identityVersion : ''}`;
  const sessionIdentity = account => `account:${account.username}${account.sessionVersion ? ':'+account.sessionVersion : ''}`;
  const saveAccount = async account => {
    const {passwordKey, password, ...savedAccount} = account;
    const saved = await storedAccounts();
    await setSetting(db,'admin_accounts_v1',JSON.stringify([...saved.filter(item=>item.username!==account.username),savedAccount]));
  };
  const revokeSessions = async account => {
    account.sessionVersion = crypto.randomBytes(16).toString('hex');
    await db.prepare('DELETE FROM browser_sessions WHERE login_username=?').run(account.username);
  };
  const writeAudit = async ({actor,action,target}) => {
    const rows = JSON.parse((await getSetting(db,'admin_account_audit_v1')) || '[]');
    rows.push({at:new Date().toISOString(),actor:String(actor || ''),action:String(action || ''),target:String(target || '')});
    await setSetting(db,'admin_account_audit_v1',JSON.stringify(rows.slice(-1000)));
  };
  const locked = fn => db.transaction(async () => {
    // Serialize read-modify-write of settings across application instances.
    await db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING").run('admin_accounts_v1','[]');
    await db.prepare('SELECT value FROM settings WHERE key=? FOR UPDATE').get('admin_accounts_v1');
    return fn();
  })();
  const audit = entry => locked(()=>writeAudit(entry));
  const availablePublishers = () => db.prepare("SELECT p.id,p.username FROM publishers p LEFT JOIN publisher_lifecycle l ON l.bot_id=p.id WHERE COALESCE(l.status,'ACTIVE')!='REMOVED' ORDER BY p.username").all();
  const validPublisherIds = async ids => {
    const available = new Set((await availablePublishers()).map(row=>String(row.id)));
    return Array.isArray(ids) && ids.length > 0 && ids.length <= 100 && ids.every(id=>typeof id==='string' && /^\d+$/.test(id) && available.has(id));
  };
  const clearSession = res => res.set('Set-Cookie','tgzhushou_session=; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=0');
  const sameOrigin = req => {
    const origin = req.get('origin');
    try { return Boolean(origin && ['http:','https:'].includes(new URL(origin).protocol) && new URL(origin).host === req.get('host')); } catch { return false; }
  };
  const createSession = async account => {
    const now = Date.now();
    const session = crypto.randomBytes(32).toString('base64url');
    await db.prepare('INSERT INTO browser_sessions(session_hash,admin_id,expires_at,created_at,last_seen,login_username) VALUES(?,?,?,?,?,?)')
      .run(digest(session),sessionIdentity(account),now+24*60*60_000,now,now,account.username);
    return session;
  };
  const setSession = (res, session) => res.set('Set-Cookie',`tgzhushou_session=${session}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=86400`);
  async function authenticate(req) {
    const raw = cookies(req.get('cookie')).tgzhushou_session;
    if (!raw || !/^[A-Za-z0-9_-]{40,100}$/.test(raw)) return null;
    const row = await db.prepare('SELECT * FROM browser_sessions WHERE session_hash=? AND expires_at>?').get(digest(raw),Date.now());
    if (!row?.login_username) return null;
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
      if (!sameOrigin(req)) return null;
    }
    if (Date.now()-row.last_seen>60_000) await db.prepare('UPDATE browser_sessions SET last_seen=? WHERE session_hash=?').run(Date.now(),row.session_hash);
    const account = await findAccount(row.login_username);
    if (!account || account.enabled === false || row.admin_id !== sessionIdentity(account)) return null;
    return {id:accountIdentity(account), name:account.username, username:account.username,
      canManageBots:account?.username === 'wz9946',
      canManageAccounts:account?.username === 'wz9946',
      ...(account?.username !== 'wz9946' && account?.publisherIds !== undefined ? {publisherIds:account.publisherIds} : {})};
  }
  function routes(app) {
    app.get('/auth/audit', requireAccount({authenticate}), async (req,res) => {
      if (req.admin.canManageAccounts !== true) return res.sendStatus(403);
      const rows=JSON.parse((await getSetting(db,'admin_account_audit_v1')) || '[]');
      res.json({rows:rows.slice(-100).reverse()});
    });
    app.get('/auth/admin-accounts', requireAccount({ authenticate }), async (req, res) => {
      if (req.admin.canManageAccounts !== true) return res.sendStatus(403);
      res.json({accounts:(await mergedAccounts()).map(publicAccount),
        publishers:await availablePublishers()});
    });
    app.post('/auth/admin-accounts', requireAccount({ authenticate }), async (req, res) => {
      if (!sameOrigin(req) || req.admin.canManageAccounts !== true) return res.sendStatus(403);
      const {username,password,publisherIds} = req.body || {};
      if (typeof username !== 'string' || !/^[A-Za-z0-9]{4,64}$/.test(username) || !validPassword(password) || !await validPublisherIds(publisherIds))
        return res.status(400).json({error:'账号须为 4–64 位字母数字，密码须为 4–128 位，并选择有效机器人'});
      const created = await locked(async () => {
        if (['wz9946','wz994604'].includes(username) || await findAccount(username)) return null;
        const account = {username,...passwordFields(password),publisherIds:[...new Set(publisherIds)],enabled:true,identityVersion:crypto.randomBytes(16).toString('hex'),sessionVersion:crypto.randomBytes(16).toString('hex')};
        await saveAccount(account);
        await writeAudit({actor:req.admin.username,action:'account.created',target:username});
        return account;
      });
      if (!created) return res.status(409).json({error:'账号已存在或为保留账号'});
      res.status(201).json(publicAccount(created));
    });
    app.patch('/auth/admin-accounts/:username', requireAccount({authenticate}), async (req,res) => {
      if (req.admin.canManageAccounts !== true || req.params.username === 'wz9946') return res.sendStatus(403);
      const body = req.body || {}, keys = Object.keys(body);
      if (!keys.length || keys.some(key=>!['publisherIds','enabled','password'].includes(key)) ||
          ('enabled' in body && typeof body.enabled !== 'boolean') ||
          ('password' in body && !validPassword(body.password)) ||
          ('publisherIds' in body && !await validPublisherIds(body.publisherIds))) return res.status(400).json({error:'账号更新参数无效'});
      const updated = await locked(async () => {
        const account = await findAccount(req.params.username);
        if (!account) return null;
        if ('publisherIds' in body) account.publisherIds = [...new Set(body.publisherIds)];
        if ('enabled' in body) account.enabled = body.enabled;
        if ('password' in body) Object.assign(account,passwordFields(body.password));
        if ('password' in body || body.enabled === false) await revokeSessions(account);
        await saveAccount(account);
        for (const [key,action] of [['publisherIds','account.permissions_updated'],['enabled',body.enabled?'account.enabled':'account.disabled'],['password','account.password_reset']])
          if (key in body) await writeAudit({actor:req.admin.username,action,target:account.username});
        return account;
      });
      if (!updated) return res.status(404).json({error:'账号不存在'});
      res.json({ok:true,account:publicAccount(updated)});
    });
    app.delete('/auth/admin-accounts/:username', requireAccount({authenticate}), async (req,res) => {
      if (req.admin.canManageAccounts !== true || req.params.username === 'wz9946') return res.sendStatus(403);
      const deleted = await locked(async () => {
        const account = await findAccount(req.params.username);
        if (!account) return false;
        await revokeSessions(account);
        // Tombstones hide environment-backed accounts without changing production env.
        await saveAccount({username:account.username,deleted:true,sessionVersion:account.sessionVersion});
        await writeAudit({actor:req.admin.username,action:'account.deleted',target:account.username});
        return true;
      });
      if (!deleted) return res.status(404).json({error:'账号不存在'});
      res.json({ok:true});
    });
    app.post('/auth/change-password', requireAccount({authenticate}), async (req,res) => {
      const {currentPassword,newPassword} = req.body || {};
      if (!validPassword(newPassword)) return res.status(400).json({error:'密码须为 4–128 位'});
      const changed = await locked(async () => {
        const account = await findAccount(req.admin.username);
        if (!account || !matchesPassword(account,currentPassword)) return false;
        Object.assign(account,passwordFields(newPassword));
        await revokeSessions(account);
        await saveAccount(account);
        await writeAudit({actor:account.username,action:'account.password_changed',target:account.username});
        return true;
      });
      if (!changed) return res.status(400).json({error:'当前密码错误'});
      clearSession(res);res.json({ok:true,reauthenticate:true});
    });
    app.post('/auth/login', async (req, res) => {
      if (!sameOrigin(req)) return res.sendStatus(403);
      if (!accounts.length && !(await storedAccounts()).length) return res.status(503).json({ error:'账号登录尚未配置，请联系管理员' });
      const now = Date.now(), ip = req.ip || 'unknown', state = failures.get(ip) || { count:0, until:0 };
      if (state.until > now) return res.status(429).json({ error:'登录失败次数过多，请稍后再试' });
      const inputUser = String(req.body?.username || '').trim(), inputPassword = String(req.body?.password || '');
      if (inputPassword.length > 128) return res.status(401).json({error:'账号或密码错误'});
      const account = await findAccount(inputUser);
      const valid = Boolean(account && account.enabled !== false && matchesPassword(account,inputPassword));
      if (!valid) {
        state.count += 1; if (state.count >= 5) { state.count = 0; state.until = now + 15*60_000; }
        failures.set(ip, state); return res.status(401).json({ error:'账号或密码错误' });
      }
      failures.delete(ip); setSession(res, await createSession(account)); res.json({ ok:true });
    });
    app.post('/auth/logout-all', requireAccount({authenticate}), async (req,res) => {
      await locked(async () => {
        const account = await findAccount(req.admin.username);
        if (!account || account.enabled === false) return;
        await revokeSessions(account);
        await saveAccount(account);
        await writeAudit({actor:account.username,action:'account.sessions_revoked',target:account.username});
      });
      clearSession(res);
      res.json({ok:true});
    });
    app.post('/auth/logout', async (req, res) => {
      if (!sameOrigin(req)) return res.sendStatus(403);
      const raw = cookies(req.get('cookie')).tgzhushou_session;
      if (raw) await db.prepare('DELETE FROM browser_sessions WHERE session_hash=?').run(digest(raw));
      clearSession(res);
      res.json({ ok:true });
    });
  }
  const revokeBotAccess = (botId, {actor = 'wz9946'} = {}) => locked(async () => {
    const ids = (await availablePublishers()).map(row=>String(row.id));
    for (const account of await mergedAccounts()) {
      if (account.username === 'wz9946') continue;
      account.publisherIds = (account.publisherIds || ids).filter(id=>String(id)!==String(botId));
      await saveAccount(account);
    }
    await writeAudit({actor,action:'account.bot_access_revoked',target:String(botId)});
  });
  const canExecuteOwner = async (owner, botId) => {
    if (!owner) return true; // Preserve tasks created before ownership tracking.
    if (!owner.username || !owner.account_id) return false;
    const account = await findAccount(owner.username);
    if (!account || account.enabled === false || accountIdentity(account) !== owner.account_id) return false;
    return account.username === 'wz9946' || account.publisherIds === undefined || account.publisherIds.includes(String(botId));
  };
  return { authenticate, routes, revokeBotAccess, audit, canExecuteOwner };
}

// Telegram identity never grants API access; every surface uses the account cookie.
export function requireAccount(auth) {
  return async (req, res, next) => {
    try {
      req.admin = await auth.authenticate(req);
      if (!req.admin) return res.status(401).json({ error: '请登录账号' });
      next();
    } catch (error) { next(error); }
  };
}

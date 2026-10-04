import crypto from 'node:crypto';
import {getSetting, setSetting} from './db.js';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const cookies = raw => Object.fromEntries(String(raw || '').split(';').map(part => {
  const at = part.indexOf('='); return at < 0 ? ['', ''] : [part.slice(0,at).trim(),part.slice(at+1).trim()];
}));

export async function createBrowserAuth(db, adminIds, publicUrl, credentials = {}) {
  // Old sessions have no proven account identity and never receive owner privileges.
  await db.transaction(async () => {
    let hasLoginUsername;
    try {
      hasLoginUsername = (await db.prepare("SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='browser_sessions' AND column_name='login_username'").all()).length > 0;
    } catch {
      hasLoginUsername = (await db.prepare('PRAGMA table_info(browser_sessions)').all()).some(column => column.name === 'login_username');
    }
    if (!hasLoginUsername) {
      await db.exec("ALTER TABLE browser_sessions ADD COLUMN login_username TEXT NOT NULL DEFAULT ''");
      await db.prepare('UPDATE browser_sessions SET expires_at=0').run();
    }
  })();
  const base = String(publicUrl || '').replace(/\/$/, '');
  const salt = String(credentials.salt || 'tgzhushou-browser-login');
  const accounts = (Array.isArray(credentials.accounts) ? credentials.accounts : [{ username: credentials.username, password: credentials.password }])
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
  const findAccount = async username => accounts.find(account => account.username === username) || (await storedAccounts()).find(account => account.username === username);
  const sameOrigin = req => {
    const origin = req.get('origin');
    return Boolean(origin && new URL(origin).host === req.get('host'));
  };
  const createSession = async (adminId, now = Date.now(), username = '') => {
    const session = crypto.randomBytes(32).toString('base64url');
    await db.prepare('INSERT INTO browser_sessions(session_hash,admin_id,expires_at,created_at,last_seen,login_username) VALUES(?,?,?,?,?,?)')
      .run(digest(session),String(adminId),now+24*60*60_000,now,now,username);
    return session;
  };
  const setSession = (res, session) => res.set('Set-Cookie',`tgzhushou_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`);
  async function issueLink(adminId) {
    if (!adminIds.includes(String(adminId)) || !base) return null;
    const token = crypto.randomBytes(32).toString('base64url');
    await db.prepare('DELETE FROM browser_links WHERE expires_at<?').run(Date.now());
    await db.prepare('INSERT INTO browser_links(token_hash,admin_id,expires_at) VALUES(?,?,?)')
      .run(digest(token),String(adminId),Date.now()+5*60_000);
    return `${base}/#login=${token}`;
  }
  async function authenticate(req) {
    const raw = cookies(req.get('cookie')).tgzhushou_session;
    if (!raw || !/^[A-Za-z0-9_-]{40,100}$/.test(raw)) return null;
    const row = await db.prepare('SELECT * FROM browser_sessions WHERE session_hash=? AND expires_at>?').get(digest(raw),Date.now());
    if (!row || !adminIds.includes(row.admin_id)) return null;
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      if (!origin || new URL(origin).host !== req.get('host')) return null;
    }
    if (Date.now()-row.last_seen>60_000) await db.prepare('UPDATE browser_sessions SET last_seen=? WHERE session_hash=?').run(Date.now(),row.session_hash);
    const account = row.login_username ? await findAccount(row.login_username) : null;
    if (row.login_username && !account) return null;
    return {id:row.admin_id, name:account?.username || '管理员', username:account?.username || '',
      canManageBots:account?.username === 'wz9946',
      canManageAccounts:account?.username === 'wz9946',
      ...(account?.username !== 'wz9946' && account?.publisherIds !== undefined ? {publisherIds:account.publisherIds} : {})};
  }
  function routes(app) {
    app.get('/auth/admin-accounts', async (req, res) => {
      if ((await authenticate(req))?.canManageAccounts !== true) return res.sendStatus(403);
      res.json({accounts:[...accounts,...(await storedAccounts())].map(({username,publisherIds}) => ({username,publisherIds})),
        publishers:await db.prepare('SELECT id,username FROM publishers ORDER BY username').all()});
    });
    app.post('/auth/admin-accounts', async (req, res) => {
      if (!sameOrigin(req) || (await authenticate(req))?.canManageAccounts !== true) return res.sendStatus(403);
      const username = String(req.body?.username || '').trim(), password = String(req.body?.password || '');
      const publisherIds = req.body?.publisherIds;
      const validPublisherIds = new Set((await db.prepare('SELECT id FROM publishers').all()).map(row => String(row.id)));
      if (!/^[A-Za-z0-9_-]{3,64}$/.test(username) || password.length < 10 || password.length > 128 ||
          !Array.isArray(publisherIds) || !publisherIds.length || publisherIds.length > 100 ||
          publisherIds.some(id => typeof id !== 'string' || !/^\d+$/.test(id) || !validPublisherIds.has(id)))
        return res.status(400).json({error:'账号须为 3–64 位字母数字或下划线，密码须为 10–128 位，并选择有效机器人'});
      if (['wz9946','wz994604'].includes(username) || (await findAccount(username))) return res.status(409).json({error:'账号已存在或为保留账号'});
      const passwordSalt = crypto.randomBytes(16).toString('base64url');
      const account = {username,passwordSalt,passwordHash:crypto.scryptSync(password,passwordSalt,32).toString('base64'),publisherIds:[...new Set(publisherIds)]};
      await db.transaction(async () => {
        const saved = await storedAccounts();
        if (saved.some(item => item.username === username)) throw new Error('账号已存在');
        await setSetting(db,'admin_accounts_v1',JSON.stringify([...saved,account]));
      })();
      res.status(201).json({username,publisherIds:account.publisherIds});
    });
    app.post('/auth/exchange', async (req, res) => {
      const token = String(req.body?.token || '');
      if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) return res.sendStatus(401);
      const hash = digest(token), now = Date.now();
      const row = await db.prepare('SELECT * FROM browser_links WHERE token_hash=? AND expires_at>?').get(hash,now);
      if (!row || !adminIds.includes(row.admin_id)) return res.sendStatus(401);
      await db.prepare('DELETE FROM browser_links WHERE token_hash=?').run(hash);
      setSession(res, await createSession(row.admin_id, now));
      res.json({ ok:true });
    });
    app.post('/auth/login', async (req, res) => {
      if (!sameOrigin(req)) return res.sendStatus(403);
      if (!accounts.length && !(await storedAccounts()).length) return res.status(503).json({ error:'账号登录尚未配置，请联系管理员' });
      const now = Date.now(), ip = req.ip || 'unknown', state = failures.get(ip) || { count:0, until:0 };
      if (state.until > now) return res.status(429).json({ error:'登录失败次数过多，请稍后再试' });
      const inputUser = String(req.body?.username || ''), inputPassword = String(req.body?.password || '');
      if (inputPassword.length > 128) return res.status(401).json({error:'账号或密码错误'});
      const account = await findAccount(inputUser);
      const inputKey = crypto.scryptSync(inputPassword, account?.passwordSalt || salt, 32);
      const passwordKey = account?.passwordKey || Buffer.from(account?.passwordHash || '', 'base64');
      const valid = Boolean(account && inputKey.length === passwordKey.length && crypto.timingSafeEqual(inputKey, passwordKey));
      if (!valid) {
        state.count += 1; if (state.count >= 5) { state.count = 0; state.until = now + 15*60_000; }
        failures.set(ip, state); return res.status(401).json({ error:'账号或密码错误' });
      }
      failures.delete(ip); setSession(res, await createSession(adminIds[0], now, account.username)); res.json({ ok:true });
    });
    app.post('/auth/logout', async (req, res) => {
      if (!sameOrigin(req)) return res.sendStatus(403);
      const raw = cookies(req.get('cookie')).tgzhushou_session;
      if (raw) await db.prepare('DELETE FROM browser_sessions WHERE session_hash=?').run(digest(raw));
      res.set('Set-Cookie','tgzhushou_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
      res.json({ ok:true });
    });
  }
  return { issueLink, authenticate, routes };
}

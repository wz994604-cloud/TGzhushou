import crypto from 'node:crypto';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const cookies = raw => Object.fromEntries(String(raw || '').split(';').map(part => {
  const at = part.indexOf('='); return at < 0 ? ['', ''] : [part.slice(0,at).trim(),part.slice(at+1).trim()];
}));

export function createBrowserAuth(db, adminIds, publicUrl, credentials = {}) {
  const base = String(publicUrl || '').replace(/\/$/, '');
  const username = String(credentials.username || '').trim();
  const password = String(credentials.password || '');
  const salt = String(credentials.salt || 'tgzhushou-browser-login');
  const passwordKey = password ? crypto.scryptSync(password, salt, 32) : null;
  const failures = new Map();
  const sameOrigin = req => {
    const origin = req.get('origin');
    return Boolean(origin && new URL(origin).host === req.get('host'));
  };
  const createSession = (adminId, now = Date.now()) => {
    const session = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO browser_sessions(session_hash,admin_id,expires_at,created_at,last_seen) VALUES(?,?,?,?,?)')
      .run(digest(session),String(adminId),now+24*60*60_000,now,now);
    return session;
  };
  const setSession = (res, session) => res.set('Set-Cookie',`tgzhushou_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`);
  function issueLink(adminId) {
    if (!adminIds.includes(String(adminId)) || !base) return null;
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM browser_links WHERE expires_at<?').run(Date.now());
    db.prepare('INSERT INTO browser_links(token_hash,admin_id,expires_at) VALUES(?,?,?)')
      .run(digest(token),String(adminId),Date.now()+5*60_000);
    return `${base}/#login=${token}`;
  }
  function authenticate(req) {
    const raw = cookies(req.get('cookie')).tgzhushou_session;
    if (!raw || !/^[A-Za-z0-9_-]{40,100}$/.test(raw)) return null;
    const row = db.prepare('SELECT * FROM browser_sessions WHERE session_hash=? AND expires_at>?').get(digest(raw),Date.now());
    if (!row || !adminIds.includes(row.admin_id)) return null;
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      if (!origin || new URL(origin).host !== req.get('host')) return null;
    }
    if (Date.now()-row.last_seen>60_000) db.prepare('UPDATE browser_sessions SET last_seen=? WHERE session_hash=?').run(Date.now(),row.session_hash);
    return { id:row.admin_id, name:'管理员' };
  }
  function routes(app) {
    app.post('/auth/exchange', (req,res) => {
      const token = String(req.body?.token || '');
      if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) return res.sendStatus(401);
      const hash = digest(token), now = Date.now();
      const row = db.prepare('SELECT * FROM browser_links WHERE token_hash=? AND expires_at>?').get(hash,now);
      if (!row || !adminIds.includes(row.admin_id)) return res.sendStatus(401);
      db.prepare('DELETE FROM browser_links WHERE token_hash=?').run(hash);
      setSession(res, createSession(row.admin_id, now));
      res.json({ ok:true });
    });
    app.post('/auth/login', (req,res) => {
      if (!sameOrigin(req)) return res.sendStatus(403);
      if (!username || !passwordKey) return res.status(503).json({ error:'账号登录尚未配置，请联系管理员' });
      const now = Date.now(), ip = req.ip || 'unknown', state = failures.get(ip) || { count:0, until:0 };
      if (state.until > now) return res.status(429).json({ error:'登录失败次数过多，请稍后再试' });
      const inputUser = String(req.body?.username || ''), inputPassword = String(req.body?.password || '');
      const inputKey = crypto.scryptSync(inputPassword, salt, 32);
      const valid = inputUser === username && inputKey.length === passwordKey.length && crypto.timingSafeEqual(inputKey, passwordKey);
      if (!valid) {
        state.count += 1; if (state.count >= 5) { state.count = 0; state.until = now + 15*60_000; }
        failures.set(ip, state); return res.status(401).json({ error:'账号或密码错误' });
      }
      failures.delete(ip); setSession(res, createSession(adminIds[0], now)); res.json({ ok:true });
    });
    app.post('/auth/logout', (req,res) => {
      if (!sameOrigin(req)) return res.sendStatus(403);
      const raw = cookies(req.get('cookie')).tgzhushou_session;
      if (raw) db.prepare('DELETE FROM browser_sessions WHERE session_hash=?').run(digest(raw));
      res.set('Set-Cookie','tgzhushou_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
      res.json({ ok:true });
    });
  }
  return { issueLink, authenticate, routes };
}

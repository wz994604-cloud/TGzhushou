import crypto from 'node:crypto';
export const entryToken = '111111:LOCAL_TEST_ENTRY_TOKEN_1234567890';
export const publisherToken = '222222:LOCAL_TEST_PUBLISH_TOKEN_123456789';
export const configKey = Buffer.alloc(32, 7).toString('base64');
export function signedData(userId = 123456, extras = {}) {
  const params = new URLSearchParams({ auth_date:String(Math.floor(Date.now()/1000)), user:JSON.stringify({ id:userId, first_name:'测试管理员' }), signature:'synthetic-third-party-signature', ...extras });
  const data = [...params.entries()].sort(([a],[b])=>a < b ? -1 : a > b ? 1 : 0).map(([key,value])=>`${key}=${value}`).join('\n');
  const secret = crypto.createHmac('sha256','WebAppData').update(entryToken).digest();
  params.set('hash',crypto.createHmac('sha256',secret).update(data).digest('hex'));
  return params.toString();
}

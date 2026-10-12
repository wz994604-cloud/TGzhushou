import {accountFixture} from '/Users/jack/Codex-Workspace/01_Projects/飞机助手/tests/account-auth-fixture.js';
const f=await accountFixture();
f.app.use(async(req,res)=>{
  if(req.path==='/api/chat/conversations')return res.json({rows:[],cursor:0,next:null});
  if(req.path==='/api/chat/updates')return res.json({rows:[],cursor:0});
  const response=await fetch('http://127.0.0.1:5173'+req.originalUrl);
  res.status(response.status);res.set('content-type',response.headers.get('content-type')||'text/plain');
  if(response.headers.get('content-type')?.includes('text/html')){
    let html=await response.text();
    if(req.query.mini)html=html.replace('<script src="https://telegram.org/js/telegram-web-app.js"></script>',`<script>window.Telegram={WebApp:{initData:'unlisted-local-fixture',ready(){},expand(){},Serverless:{call(){throw new Error('OLD LOGIN PATH')}}}};</script>`);
    res.send(html);
  }else res.send(Buffer.from(await response.arrayBuffer()));
});
console.log('PREVIEW',f.base);
process.on('SIGINT',async()=>{await f.close();process.exit()});

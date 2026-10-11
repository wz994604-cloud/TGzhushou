import http from 'node:http';
http.createServer((req,res)=>{
 if(req.url==='/bootstrap'||req.url==='/auth/login'){res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({error:req.url==='/bootstrap'?'未授权':'账号或密码错误'}));return;}
 if(req.url.startsWith('/?mini')){fetch('http://127.0.0.1:5173/').then(r=>r.text()).then(html=>{res.writeHead(200,{'content-type':'text/html'});res.end(html.replace('<script src="https://telegram.org/js/telegram-web-app.js"></script>',`<script>window.Telegram={WebApp:{initData:'fixture',ready(){},expand(){},close(){document.body.dataset.fixtureClosed='true'},Serverless:{call(name,args,callback){callback(Object.assign(new Error('未授权'),{status:401}))}}}};</script>`));});return;}
 const upstream=http.request({hostname:'127.0.0.1',port:5173,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});req.pipe(upstream);
}).listen(5174,'127.0.0.1');

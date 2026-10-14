// Browser regression fixture for the actual bundled AgentView, with an Obsidian API shim.
const http=require('node:http');const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'../..');
http.createServer((req,res)=>{
  const routes={'/':'index.html','/harness.js':'harness.js','/fixture.js':'fixture.js'};
  let content,type='application/javascript';
  if(req.url==='/plugin.js')content='(function(){\n'+fs.readFileSync(path.join(root,'main.js'),'utf8').replace('module.exports=NoteAgent;','window.PluginClass=NoteAgent;window.ViewClass=AgentView;')+'\n})();';
  else if(req.url==='/styles.css'){content=fs.readFileSync(path.join(root,'styles.css'));type='text/css';}
  else if(routes[req.url]){content=fs.readFileSync(path.join(__dirname,routes[req.url]));if(req.url==='/')type='text/html; charset=utf-8';}
  else {res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':type});res.end(content);
}).listen(41967,'127.0.0.1',()=>console.log('UI regression: http://127.0.0.1:41967'));

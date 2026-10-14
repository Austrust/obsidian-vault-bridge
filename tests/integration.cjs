const http=require('node:http');const fs=require('node:fs/promises');const path=require('node:path');const assert=require('node:assert/strict');
const {NoteEngine}=require('../src/domain/note-engine');const {OpenCodeRuntime}=require('../src/backend/opencode-runtime');const {ConversationService}=require('../src/backend/conversation-service');const {WorkspaceStore}=require('../src/domain/workspace-store');
(async()=>{
const root=await fs.mkdtemp(path.join(require('node:os').tmpdir(),'vaultbridge-integration-'));
const notes=new Map([['测试.md','目标：旧内容']]);const artifacts=[],journal=[],calls=[];
const engine=new NoteEngine({read:async p=>notes.get(p),compareWrite:async(p,b,a,g)=>{g();assert.equal(notes.get(p),b);notes.set(p,a);},create:async(p,t,g)=>{g();assert(!notes.has(p));notes.set(p,t);}},journal);
const execute=async(n,a)=>{calls.push(n);if(n==='read_note')return engine.read(a.path);if(n==='patch_note')return engine.patch(a.path,a.revision,a.oldText,a.newText,engine.runID);if(n==='publish_visualization'){artifacts.push(a);return {artifactId:'test'};}if(n==='create_note')return engine.create(a.path,a.text,engine.runID);return {};};
let modelStep=0;let revision='';
const provider=http.createServer(async(req,res)=>{try{let b='';for await(const c of req)b+=c;const body=JSON.parse(b);await fs.writeFile(path.join(root,'last-request.json'),JSON.stringify(body,null,2));
const available=(body.tools||[]).map(t=>t.function.name);let name,args;modelStep++;console.log('MODEL_STEP',modelStep,'TOOLS',available.join(','));
if(modelStep===1){name=available.find(n=>n.endsWith('read_note'));args={path:'测试.md'};}
else if(modelStep===2){for(const m of body.messages){if(m.role==='tool'){try {const c=JSON.parse(m.content);revision=c.revision||revision;}catch{const match=JSON.stringify(m.content).match(/[a-f0-9]{64}/);if(match)revision=match[0];}}}name=available.find(n=>n.endsWith('patch_note'));args={path:'测试.md',revision,oldText:'旧内容',newText:'新内容'};}
else if(modelStep===3){name=available.find(n=>n.endsWith('publish_visualization'));args={title:'测试卡片',code:"dv.paragraph('完成');",sourcePath:'测试.md'};}
else if(modelStep===4){name=available.find(n=>n.endsWith('create_note'));args={path:'新笔记.md',text:'# 已创建'};}
const base={id:'chatcmpl-'+modelStep,object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:'demo-model'};res.writeHead(200,{'Content-Type':'text/event-stream'});
const emit=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta,finish_reason}]})+'\n\n');
if(name){emit({role:'assistant',tool_calls:[{index:0,id:'call_'+modelStep,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls');}
else{emit({role:'assistant',reasoning_content:'已检查工具结果，准备汇总。'});emit({role:'assistant',content:'已修改笔记并发布卡片。'});emit({},'stop');}
res.end('data: [DONE]\n\n');}catch(e){console.error(e);res.writeHead(500);res.end(String(e));}});
await new Promise(r=>provider.listen(0,'127.0.0.1',r));const providerURL=`http://127.0.0.1:${provider.address().port}/v1`;

const settings={executable:process.env.OPENCODE_BIN||'opencode',provider:'demo',model:'demo-model',baseURL:providerURL};
const runtime=new OpenCodeRuntime({directory:root,execute,settings:()=>settings,apiKey:()=> 'local-test',env:{...process.env,XDG_DATA_HOME:root+'/data',XDG_CACHE_HOME:root+'/cache',XDG_CONFIG_HOME:root+'/config',XDG_STATE_HOME:root+'/state'}});
const store=new WorkspaceStore({},settings);const service=new ConversationService({runtime,engine,state:store.state,persist:()=>store.save(),refresh:()=>{},context:async()=>({notes:[]}),model:()=>({providerID:'demo',modelID:'demo-model'}),pollMs:100});
try{
const [a,b]=await Promise.all([runtime.connect(),runtime.connect()]);assert.equal(a,b,'one shared connection');
await service.send('编辑测试笔记并创建交互卡片');assert.equal(store.state.status,'已完成');assert.equal(notes.get('测试.md'),'目标：新内容');assert.equal(notes.get('新笔记.md'),'# 已创建');assert.equal(artifacts.length,1);assert.equal(journal.length,1);
assert(store.state.transcript.some(m=>m.reasoning.includes('已检查工具结果')));assert.equal((await runtime.request('/session/'+store.state.sessionId)).title,'编辑测试笔记并创建交互卡片');
await service.restore(store.state.sessionId);assert((await service.history()).some(s=>s.id===store.state.sessionId));await engine.undo(journal[0].id);assert.equal(notes.get('测试.md'),'目标：旧内容');
await service.stop();await runtime.disconnect();assert.equal(runtime.client,null);await runtime.connect();assert((await service.history()).some(s=>s.id===store.state.sessionId));
console.log('PASS modular runtime + conversation service: tools, edit, create, cards, reasoning, title, history, undo, shared connection, restart');
}finally{await runtime.disconnect();provider.closeAllConnections();provider.close();}
const broken=new OpenCodeRuntime({directory:root,execute,settings:()=>({...settings,executable:path.join(root,'missing-executable')})});await assert.rejects(broken.connect());assert.equal(broken.resources,null);await broken.disconnect();console.log('PASS failed startup releases MCP and child resources');
})().catch(e=>{console.error(e);process.exitCode=1;});

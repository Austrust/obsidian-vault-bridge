'use strict';
const {spawn}=require('node:child_process');const fs=require('node:fs/promises');const net=require('node:net');const crypto=require('node:crypto');
const {startBridge}=require('./mcp-server');const {OpenCodeClient,agentConfig}=require('./opencode-client');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class OpenCodeRuntime {
  constructor({directory,execute,settings,apiKey=()=>'',onState=()=>{},onExit=()=>{},env=process.env}){Object.assign(this,{directory,execute,settings,apiKey,onState,onExit,env});this.client=null;this.generation=0;this.resources=null;this.connecting=null;}
  async connect(){
    if(this.connecting)return this.connecting;
    if(this.client){try{await this.client.request('/global/health');return this.client;}catch{await this.disconnect();}}
    const generation=++this.generation;
    this.connecting=this.start(generation).catch(async error=>{if(generation===this.generation){await this.cleanup();this.onState('error',error.message);}throw error;}).finally(()=>{if(generation===this.generation)this.connecting=null;});
    return this.connecting;
  }
  async start(generation){
    const guard=()=>{if(generation!==this.generation)throw Error('连接已取消');};
    this.onState('connecting','正在连接 OpenCode');await fs.mkdir(this.directory,{recursive:true});guard();
    const bridge=await startBridge(this.execute);if(generation!==this.generation){await bridge.close();guard();}
    const resources={bridge,proc:null};this.resources=resources;
    const port=await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});guard();
    const settings=this.settings(),key=this.apiKey(),password=crypto.randomBytes(24).toString('hex');
    const config={agent:{note_agent:agentConfig},default_agent:'note_agent',permission:{'*':'deny','note_agent_*':'allow'},share:'disabled'};
    if(key)config.provider={[settings.provider]:{npm:'@ai-sdk/openai-compatible',name:settings.provider,options:{baseURL:settings.baseURL,apiKey:key},models:{[settings.model]:{name:settings.model,limit:{context:64000,output:8192}}}}};
    const client=new OpenCodeClient(`http://127.0.0.1:${port}`,this.directory,password);
    const proc=spawn(settings.executable,['serve','--hostname','127.0.0.1','--port',String(port)],{cwd:this.directory,env:{...this.env,OPENCODE_SERVER_PASSWORD:password,OPENCODE_CONFIG_CONTENT:JSON.stringify(config)},stdio:['ignore','pipe','pipe'],windowsHide:true});resources.proc=proc;
    let exitError=null;
    proc.once('error',e=>{exitError=e;});proc.once('exit',code=>{exitError=Error('OpenCode 已退出（'+code+'）');if(this.resources===resources&&this.client){this.client=null;this.onExit(exitError);this.onState('error',exitError.message);this.cleanup();}});
    proc.stdout?.on('data',()=>{});proc.stderr?.on('data',()=>{});
    let healthy=false;const deadline=Date.now()+30000;
    while(Date.now()<deadline){guard();if(exitError)throw exitError;try{await client.request('/global/health');healthy=true;break;}catch{}await sleep(300);}
    guard();if(!healthy)throw Error('连接超时，请检查 OpenCode 路径');
    const result=await client.configure(bridge);guard();if(result?.note_agent?.status!=='connected')throw Error('笔记工具连接失败');
    this.client=client;this.onState('connected','已连接');return client;
  }
  async request(...args){const client=this.client||await this.connect();return client.request(...args);}
  async cleanup(){const resources=this.resources;this.resources=null;this.client=null;resources?.proc?.kill('SIGTERM');if(resources?.bridge)await resources.bridge.close();}
  async disconnect(){this.generation++;this.connecting=null;await this.cleanup();this.onState('disconnected','已断开');}
}
module.exports={OpenCodeRuntime};

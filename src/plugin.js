'use strict';
const {Plugin,Notice,MarkdownView,FuzzySuggestModal}=require('obsidian');
const crypto=require('node:crypto');const path=require('node:path');
const {hash,vaultPath,checkPhysical,NoteEngine}=require('./domain/note-engine');
const {AgentView,VIEW}=require('./ui/chat-view');
const {Settings}=require('./ui/settings');
const {DEMO_CODE}=require('./ui/example');
const {DEFAULTS}=require('./config');
const {WorkspaceStore}=require('./domain/workspace-store');
const {OpenCodeRuntime}=require('./backend/opencode-runtime');
const {NoteTools}=require('./backend/note-tools');
const {ConversationService}=require('./backend/conversation-service');
class NoteAgent extends Plugin {
  async onload(){
    this.store=new WorkspaceStore(await this.loadData(),DEFAULTS,data=>this.saveData(data));
    for(const key of Object.keys(this.store.state))Object.defineProperty(this,key,{get:()=>this.store.state[key],set:value=>this.store.state[key]=value});
    this.mentions=new Set();this.apiKey='';
    this.root=this.app.vault.adapter.getBasePath();this.runtimeDir=path.join(this.root,this.manifest.dir,'runtime');
    this.engine=new NoteEngine(this.storage(),this.journal,()=>this.persist().then(()=>this.refresh()));
    this.tools=new NoteTools({engine:this.engine,files:()=>this.app.vault.getMarkdownFiles(),read:p=>this.storage().read(p),active:()=>this.active(),publish:args=>this.publishArtifact(args)});
    this.backend=new OpenCodeRuntime({directory:this.runtimeDir,execute:(n,a)=>this.execute(n,a),settings:()=>this.settings,apiKey:()=>this.apiKey,onState:(connection,message)=>{this.connection=connection;if(message)this.status=message;this.refresh();},onExit:error=>{this.engine.stop();if(this.conversations?.turn)this.conversations.turn.cancelled=true;this.error=error.message;}});
    this.conversations=new ConversationService({runtime:this.backend,engine:this.engine,state:this.store.state,persist:()=>this.persist(),refresh:()=>this.refresh(),context:raw=>this.contextFor(raw),model:()=>({providerID:this.settings.provider,modelID:this.settings.model}),sourcePath:()=>this.lastFile||''});
    this.registerView(VIEW,leaf=>new AgentView(leaf,this));this.addRibbonIcon('bot','打开 VaultBridge',()=>this.open());
    this.addCommand({id:'open',name:'打开原生 Agent 侧边栏',callback:()=>this.open()});
    this.addCommand({id:'send-selection',name:'将当前笔记或选区交给 Agent',editorCallback:()=>{this.attachActive();this.open();}});
    this.addCommand({id:'visualize',name:'Visualize：当前笔记生成可视化',editorCallback:()=>{this.attachActive();this.open().then(()=>{const v=this.views()[0];v.input.value='/visualize ';v.input.focus();});}});
    this.addSettingTab(new Settings(this.app,this));
    this.registerEvent(this.app.workspace.on('file-open',f=>{if(f?.extension==='md')this.lastFile=f.path;}));
    this.registerEvent(this.app.workspace.on('active-leaf-change',()=>{const v=this.app.workspace.getActiveViewOfType(MarkdownView);if(v?.file)this.lastFile=v.file.path;}));
  }
  views(){return this.app.workspace.getLeavesOfType(VIEW).map(l=>l.view);}
  refresh(){this.views().forEach(v=>v.render());}
  fail(e){this.error=e.message||String(e);this.status='需要处理';new Notice(this.error);this.refresh();}
  persist(){return this.store.save();}
  openSettings(){this.app.setting.open();this.app.setting.openTabById(this.manifest.id);}
  async open(){const current=this.app.workspace.getActiveFile();if(current?.extension==='md')this.lastFile=current.path;let leaf=this.app.workspace.getLeavesOfType(VIEW)[0];if(!leaf){leaf=this.app.workspace.getRightLeaf(false);await leaf.setViewState({type:VIEW,active:true});}this.app.workspace.revealLeaf(leaf);}
  editor(p){return this.app.workspace.getLeavesOfType('markdown').map(l=>l.view).find(v=>v.file?.path===p&&v.editor)?.editor;}
  active(){const v=this.app.workspace.getActiveViewOfType(MarkdownView);const p=v?.file?.path||this.app.workspace.getActiveFile()?.path||this.lastFile;const editor=p&&this.editor(p);return p?{path:p,selection:editor?.getSelection()||'',text:editor?.getValue()}:null;}
  attachActive(){const a=this.active();if(!a){new Notice('请先打开一篇 Markdown 笔记');return;}this.mentions.add(a.path);this.selection=a.selection?{path:a.path,text:a.selection,revision:hash(a.text)}:null;this.refresh();}
  storage(){return {
    read:async p=>{await checkPhysical(this.root,p);if(!p.endsWith('.md'))throw Error('只支持 Markdown 笔记');const ed=this.editor(p);if(ed)return ed.getValue();const f=this.app.vault.getAbstractFileByPath(p);if(!f)throw Error('笔记不存在');return this.app.vault.read(f);},
    compareWrite:async(p,before,after,guard)=>{await checkPhysical(this.root,p);const ed=this.editor(p);guard();if(ed){if(ed.getValue()!==before)throw Error('编辑缓冲区发生变化，未写入');ed.replaceRange(after,{line:0,ch:0},ed.offsetToPos(before.length));}else{const f=this.app.vault.getAbstractFileByPath(p);if(!f)throw Error('笔记不存在');await this.app.vault.process(f,current=>{guard();if(current!==before)throw Error('文件发生变化，未写入');return after;});}},
    create:async(p,text,guard)=>{await checkPhysical(this.root,p);if(!p.endsWith('.md'))throw Error('仅允许创建 .md 笔记');await this.mkdir(path.posix.dirname(p));guard();await this.app.vault.create(p,text);}
  };}
  async mkdir(folder){if(folder==='.')return;vaultPath(folder);const parts=folder.split('/');for(let i=1;i<=parts.length;i++){const p=parts.slice(0,i).join('/');await checkPhysical(this.root,p);if(!this.app.vault.getAbstractFileByPath(p))await this.app.vault.createFolder(p);}}
  execute(name,args){return this.tools.call(name,args);}
  async publishArtifact(args){const a={id:crypto.randomUUID(),sessionId:this.sessionId,title:args.title.slice(0,120),code:args.code,sourcePath:args.sourcePath,time:Date.now()};this.artifacts.push(a);await this.persist();this.refresh();return {artifactId:a.id,status:'saved',render:'DataviewJS card awaiting Run click'};}
  dataview(){return this.app.plugins.plugins.dataview?.api;}
  async addExample(){const a={id:crypto.randomUUID(),sessionId:this.sessionId,title:'复利交互示例 · 无需 API',code:DEMO_CODE,sourcePath:this.active()?.path||'',time:Date.now()};this.artifacts.push(a);await this.persist();this.refresh();}
  async saveArtifact(a){
    const folder=vaultPath(this.settings.artifactFolder);await this.mkdir(folder);const name=a.title.replace(/[\\/:*?"<>|\[\]#]/g,'-').slice(0,50)||'可视化';const p=`${folder}/${name}-${a.id.slice(0,8)}.md`;
    const longest=Math.max(2,...(a.code.match(/`+/g)||[]).map(s=>s.length));const fence='`'.repeat(longest+1);
    const text=`# ${a.title.replace(/[\r\n]/g,' ')}\n\n来源：${a.sourcePath?'[['+a.sourcePath+']]':'对话'}\n\n${fence}dataviewjs\n${a.code}\n${fence}\n`;
    await checkPhysical(this.root,p);if(this.app.vault.getAbstractFileByPath(p))throw Error('已保存；请打开现有成果笔记');await this.app.vault.create(p,text);new Notice('已保存 '+p);await this.app.workspace.openLinkText(p,'',true);
  }
  async contextFor(raw){
    const notes=[];for(const p of this.mentions)notes.push(await this.engine.read(p));
    const artifacts=this.artifacts.filter(a=>a.sessionId===this.sessionId&&raw.includes(a.id)).map(a=>({id:a.id,title:a.title,code:a.code}));
    return {notes,selection:this.selection||null,artifacts};
  }
  get client(){return this.backend.client;}
  connect(){return this.backend.connect();}
  newSession(){return this.conversations.newSession();}
  restore(id,title){return this.conversations.restore(id,title);}
  send(raw){return this.conversations.send(raw);}
  stop(){return this.conversations.stop();}
  async chooseHistory(){
    const items=await this.conversations.history();const plugin=this;
    class History extends FuzzySuggestModal {
      getItems(){return items;}
      getItemText(s){return s.displayTitle+' · '+(s.time?.updated?new Date(s.time.updated).toLocaleString():'');}
      onChooseItem(s){plugin.restore(s.id,s.displayTitle).catch(e=>plugin.fail(e));}
    }
    const modal=new History(this.app);modal.setPlaceholder('搜索对话');modal.open();
  }
  async disconnect(){await this.conversations.stop();await this.backend.disconnect();}
  onunload(){if(this.conversations?.turn)this.conversations.turn.cancelled=true;this.engine?.stop();this.backend?.disconnect();}
}
module.exports=NoteAgent;

'use strict';
const {ItemView,MarkdownRenderer,Component,FuzzySuggestModal,Notice,setIcon,Menu}=require('obsidian');
const {shouldSend,conversationItems}=require('../presentation');
const VIEW='note-agent-opencode';
class MentionModal extends FuzzySuggestModal {
  constructor(app,choose){super(app);this.choose=choose;this.setPlaceholder('引用笔记或选择助手');}
  getItems(){return [{path:'DeepSeek',agent:true},...this.app.vault.getMarkdownFiles()];}
  getItemText(f){return f.agent?'DeepSeek · 助手':f.path;}onChooseItem(f){this.choose(f.path,f.agent);}
}
class AgentView extends ItemView {
  constructor(leaf,plugin){super(leaf);this.p=plugin;this.rows=new Map();this.cards=new Map();this.followTail=true;}
  getViewType(){return VIEW;}getDisplayText(){return 'VaultBridge';}getIcon(){return 'bot';}
  async onOpen(){
    const root=this.contentEl;root.empty();root.addClass('na-root');root.addClass('vb-workspace');
    const header=root.createDiv('vb-header');const brand=header.createDiv('vb-brand');setIcon(brand.createSpan('vb-brand-mark'),'waypoints');brand.createSpan({text:'VaultBridge'});
    const controls=header.createDiv('vb-header-actions');this.connection=this.button(controls,'连接',()=>this.p.connect(),'vb-connection');
    this.iconButton(controls,'新对话','square-pen',()=>this.p.newSession());this.iconButton(controls,'历史对话','history',()=>this.p.chooseHistory());this.iconButton(controls,'更多选项','ellipsis',event=>this.menu(event));
    const sub=root.createDiv('vb-session-bar');this.title=sub.createDiv('na-session-title');this.status=sub.createDiv('vb-status');this.status.setAttribute('role','status');
    this.errorBox=root.createDiv('vb-error');this.errorBox.setAttribute('role','alert');
    this.log=root.createDiv('na-log');this.log.setAttribute('aria-label','对话内容');
    this.welcome=this.log.createDiv('vb-welcome');setIcon(this.welcome.createDiv('vb-welcome-icon'),'sparkles');this.welcome.createEl('h2',{text:'从一篇笔记开始'});this.welcome.createEl('p',{text:'整理思路、修改文档，或把知识变成可交互的视图。'});
    const suggestions=this.welcome.createDiv('vb-suggestions');
    for(const [icon,title,prompt] of [['file-text','梳理这篇笔记','总结当前笔记，提炼关键观点和待办。'],['pen-line','一起打磨内容','帮我改进当前笔记的表达，保留结构与原意。'],['chart-no-axes-combined','生成交互视图','/visualize 根据当前笔记生成清晰的交互视图。']]){const b=this.button(suggestions,'',()=>{this.p.attachActive();this.input.value=prompt;this.resizeInput();this.input.focus();},'vb-suggestion');setIcon(b.createSpan(),icon);b.createSpan({text:title});setIcon(b.createSpan('vb-suggestion-arrow'),'arrow-up-right');}
    this.jump=this.button(root,'回到最新',()=>{this.followTail=true;this.scrollToEnd();},'vb-jump');this.jump.hidden=true;
    this.log.addEventListener('scroll',()=>{this.followTail=this.log.scrollHeight-this.log.scrollTop-this.log.clientHeight<72;this.jump.hidden=this.followTail;});
    this.changeBox=root.createDiv('na-changes');
    const compose=root.createDiv('vb-composer');this.context=compose.createDiv('na-context');
    this.input=compose.createEl('textarea',{attr:{placeholder:'询问、编辑，或输入 /visualize…',rows:'2','aria-label':'Agent 指令'}});
    this.input.addEventListener('input',()=>this.resizeInput());
    this.input.addEventListener('keydown',event=>{if(shouldSend(event)){event.preventDefault();if(!event.repeat)this.submit().catch(e=>this.p.fail(e));}if(event.key==='@'&&!event.isComposing)setTimeout(()=>this.pickMention(true),0);});
    const footer=compose.createDiv('vb-composer-footer');const attach=footer.createDiv('vb-compose-actions');
    this.iconButton(attach,'引用笔记','at-sign',()=>this.pickMention());this.iconButton(attach,'附加当前笔记或选区','paperclip',()=>this.p.attachActive());this.iconButton(attach,'生成可视化','chart-no-axes-combined',()=>{this.input.value='/visualize '+this.input.value.replace(/^\/visualize\s*/, '');this.resizeInput();this.input.focus();});
    this.model=this.button(footer,'',()=>this.p.openSettings(),'vb-model');
    this.send=this.iconButton(footer,'发送','arrow-up',()=>this.p.running||this.p.preparing?this.p.stop():this.submit(),'vb-send');
    const hint=root.createDiv('vb-composer-hint');hint.createSpan({text:'Enter 发送 · Shift+Enter 换行'});hint.createSpan({text:'你的笔记，你来掌控'});
    this.fitStatusBar();const win=root.ownerDocument.defaultView;
    if(win.ResizeObserver){const observer=new win.ResizeObserver(()=>this.fitStatusBar());observer.observe(root);const status=root.ownerDocument.querySelector('.status-bar');if(status)observer.observe(status);this.register(()=>observer.disconnect());}
    this.registerDomEvent(win,'resize',()=>this.fitStatusBar());
    this.registerDomEvent(root.ownerDocument,'selectionchange',()=>{if(root.ownerDocument.getSelection()?.isCollapsed)this.render();});
    this.render();
  }
  button(parent,label,fn,cls=''){const b=parent.createEl('button',{text:label,cls});b.addEventListener('click',event=>Promise.resolve().then(()=>fn(event)).catch(e=>this.p.fail(e)));return b;}
  iconButton(parent,label,icon,fn,cls=''){const b=this.button(parent,'',fn,'vb-icon-button '+cls);b.setAttribute('aria-label',label);b.setAttribute('title',label);setIcon(b,icon);return b;}
  menu(event){const menu=new Menu();menu.addItem(item=>item.setTitle('设置与模型').setIcon('settings-2').onClick(()=>this.p.openSettings()));menu.addItem(item=>item.setTitle('体验交互卡片').setIcon('chart-no-axes-combined').onClick(()=>this.p.addExample()));menu.addSeparator();menu.addItem(item=>item.setTitle('断开连接').setIcon('unplug').onClick(()=>this.p.disconnect()));menu.showAtMouseEvent(event);}
  resizeInput(){this.input.style.height='auto';this.input.style.height=Math.min(160,Math.max(60,this.input.scrollHeight))+'px';this.updateSend();}
  updateSend(){const busy=this.p.running||this.p.preparing;this.send.disabled=!busy&&!this.input.value.trim();this.send.setAttribute('aria-label',busy?'停止生成':'发送');this.send.setAttribute('title',busy?'停止生成':'发送');if(this.busyIcon!==busy){setIcon(this.send,busy?'square':'arrow-up');this.busyIcon=busy;}}
  pickMention(removeAt=false){new MentionModal(this.app,(path,agent)=>{if(removeAt)this.input.value=this.input.value.replace(/@$/,'');if(agent)this.input.value='@DeepSeek '+this.input.value;else this.p.mentions.add(path);this.renderContext();this.resizeInput();this.input.focus();}).open();}
  async submit(){const text=this.input.value.trim();if(!text)return;if(this.p.running||this.p.preparing)return;this.input.value='';this.resizeInput();this.followTail=true;try{await this.p.send(text);}catch(error){if(!this.input.value)this.input.value=text;this.resizeInput();throw error;}}
  renderContext(){if(!this.context)return;const signature=JSON.stringify([[...this.p.mentions],this.p.selection]);if(this.contextSignature===signature)return;this.contextSignature=signature;this.context.empty();for(const path of this.p.mentions){const chip=this.button(this.context,'',()=>{this.p.mentions.delete(path);if(this.p.selection?.path===path)this.p.selection=null;this.renderContext();},'vb-context-chip');chip.setAttribute('title',path+' · 点击移除');setIcon(chip.createSpan(),'file-text');chip.createSpan({text:path.split('/').pop()});setIcon(chip.createSpan(),'x');}if(this.p.selection)this.context.createSpan({text:'已附加选区',cls:'vb-selection-chip'});}
  fitStatusBar(){const root=this.contentEl;const bar=root.ownerDocument.querySelector('.status-bar');let overlap=0;if(bar){const a=root.getBoundingClientRect(),b=bar.getBoundingClientRect();if(b.width&&b.height&&a.right>b.left&&a.left<b.right&&a.bottom>b.top&&a.top<b.bottom)overlap=Math.min(b.height,a.bottom-b.top);}root.style.setProperty('--na-statusbar-space',overlap+'px');}
  scrollToEnd(){this.contentEl.ownerDocument.defaultView.requestAnimationFrame(()=>{if(this.followTail&&this.log&&this.contentEl.ownerDocument.getSelection()?.isCollapsed)this.log.scrollTop=this.log.scrollHeight;});}
  render(){
    if(!this.log)return;const busy=this.p.running||this.p.preparing;
    this.title.textContent=this.p.sessionTitle||'新对话';this.status.textContent=busy?'处理中':this.p.error?'需要处理':'';this.status.classList.toggle('is-busy',!!busy);
    const connection=this.p.connection||'disconnected';this.connection.textContent={connected:'已连接',connecting:'连接中',error:'重连',disconnected:'连接'}[connection];this.connection.dataset.state=connection;this.connection.disabled=connection==='connecting';
    this.model.textContent=(this.p.settings?.model||'选择模型').replace(/^deepseek-/,'DeepSeek ');this.model.setAttribute('title','模型设置');
    this.errorBox.hidden=!this.p.error;this.errorBox.textContent=this.p.error||'';this.updateSend();this.renderContext();
    const messages=conversationItems(this.p.transcript);this.welcome.hidden=messages.length>0;const wanted=new Set(messages.map(m=>m.id));
    for(const [id,row] of this.rows)if(!wanted.has(id)){row.revision++;row.component?.unload();if(row.component)this.removeChild(row.component);row.el.remove();this.rows.delete(id);}
    let anchor=this.welcome;
    for(const m of messages){let row=this.rows.get(m.id);if(!row){row=m.kind==='work'?this.createWork(m):this.createMessage(m);this.rows.set(m.id,row);}if(row.el.previousElementSibling!==anchor)this.log.insertBefore(row.el,anchor.nextSibling);anchor=row.el;
      if(m.kind==='work'){this.renderWork(row,m,busy&&messages.slice(messages.indexOf(m)+1).every(x=>x.role!=='user'));continue;}
      row.message=m;const kind=m.kind||(m.role==='user'?'user':m.done?'answer':'draft');
      row.label.textContent={user:'你',answer:'VaultBridge',draft:'正在回复',error:'回复已中断'}[kind]||'VaultBridge';row.copy.disabled=!m.text;this.renderMessageBody(row,m,kind);
    }
    const artifacts=this.p.artifacts.filter(a=>a.sessionId===this.p.sessionId);for(const a of artifacts)if(!this.cards.has(a.id))this.mountCard(a);
    for(const [id,card] of this.cards)if(!artifacts.some(a=>a.id===id)){card.component?.unload();card.el.remove();this.cards.delete(id);}
    this.renderChanges();this.scrollToEnd();
  }
  createMessage(m){const el=this.log.createDiv('na-message '+m.role);const head=el.createDiv('na-message-header');const label=head.createDiv('na-role');const row={el,label,body:el.createDiv('na-body'),text:null,revision:0,message:m,component:new Component()};this.addChild(row.component);row.copy=this.iconButton(head,'复制 Markdown','copy',()=>this.copyText(row.message.text||''),'vb-copy');return row;}
  createWork(m){const el=this.log.createEl('details',{cls:'vb-work'});const summary=el.createEl('summary',{cls:'vb-work-summary'});const mark=summary.createSpan('vb-work-mark');setIcon(mark,'circle-check');const label=summary.createSpan();const chevron=summary.createSpan('vb-work-chevron');setIcon(chevron,'chevron-down');const content=el.createDiv('vb-work-content');const thinking=content.createEl('details',{cls:'na-thinking'});thinking.createEl('summary',{text:'思考过程'});const reasoning=thinking.createDiv('na-reasoning');this.iconButton(thinking,'复制思考','copy',()=>this.copyText(this.rows.get(m.id)?.message.reasoning||''),'vb-copy');const preamble=content.createDiv('vb-preamble');const tools=content.createDiv('vb-tools');return {el,label,mark,thinking,reasoning,preamble,tools,toolRows:new Map(),message:m,revision:0};}
  renderWork(row,m,busy){row.message=m;const active=busy;row.el.classList.toggle('is-active',active);row.label.textContent=active?'正在思考与执行':m.toolCalls.some(t=>t.status==='error')?'执行遇到问题':m.toolCalls.length?`已完成 ${m.toolCalls.length} 个步骤`:'已思考';
    row.thinking.hidden=!m.reasoning;if(row.reasoning.textContent!==m.reasoning)row.reasoning.textContent=m.reasoning;row.preamble.hidden=!m.text;if(row.preamble.textContent!==m.text)row.preamble.textContent=m.text;
    const wanted=new Set();for(const tool of m.toolCalls){wanted.add(tool.id);let t=row.toolRows.get(tool.id);if(!t){const el=row.tools.createEl('details',{cls:'vb-tool'});const summary=el.createEl('summary');const icon=summary.createSpan('vb-tool-icon');const names=summary.createDiv('vb-tool-names');const label=names.createSpan('vb-tool-label');const path=names.createSpan('vb-tool-path');const state=summary.createSpan('vb-tool-state');const body=el.createDiv('vb-tool-details');t={el,icon,label,path,state,body};row.toolRows.set(tool.id,t);}
      t.label.textContent=tool.label;t.path.textContent=tool.path;t.path.hidden=!tool.path;t.state.textContent=tool.status==='completed'?'完成':tool.status==='error'?'失败':'进行中';t.el.dataset.state=tool.status;setIcon(t.icon,tool.status==='error'?'circle-alert':tool.status==='completed'?'check':'loader-circle');
      const detail=tool.error||('参数\n'+JSON.stringify(tool.input,null,2)+(tool.output?'\n\n结果\n'+tool.output:''));if(t.body.textContent!==detail)t.body.textContent=detail;
    }for(const [id,t] of row.toolRows)if(!wanted.has(id)){t.el.remove();row.toolRows.delete(id);}
  }
  async copyText(text){
    // Desktop Obsidian exposes Electron's clipboard without browser focus/permission prompts.
    const clipboard=require('electron').clipboard;
    if(clipboard?.writeText)clipboard.writeText(text);
    else await this.contentEl.ownerDocument.defaultView.navigator.clipboard.writeText(text);
    new Notice('已复制');
  }
  renderMessageBody(row,m,kind){
    if(row.text===m.text&&row.done===m.done&&row.kind===kind)return;
    // Polling must not destroy text that the user is currently selecting.
    const selection=row.body.ownerDocument.getSelection();
    if(selection&&!selection.isCollapsed&&(row.body.contains(selection.anchorNode)||row.body.contains(selection.focusNode)))return;
    row.text=m.text;row.done=m.done;row.kind=kind;const revision=++row.revision;
    const host=row.body.ownerDocument.createElement('div');host.className=kind==='user'?'na-plain':'na-markdown markdown-rendered';
    const component=new Component();this.addChild(component);
    const apply=()=>{if(row.revision!==revision||!row.el.isConnected){component.unload();this.removeChild(component);return;}const selected=row.body.ownerDocument.getSelection();if(selected&&!selected.isCollapsed&&(row.body.contains(selected.anchorNode)||row.body.contains(selected.focusNode))){row.text=null;component.unload();this.removeChild(component);return;}row.component.unload();this.removeChild(row.component);row.component=component;row.body.replaceChildren(host);this.scrollToEnd();};
    if(kind==='user'){host.textContent=m.text;apply();return;}
    const markdown=(m.text||'').replace(/^(`{3,}|~{3,})(dataviewjs|dataview)\b/gm,'$1javascript');
    MarkdownRenderer.render(this.app,markdown,host,(m.sourcePath||'')+'?no-dataview',component).then(()=>{
      for(const table of host.querySelectorAll('table')){const wrap=host.ownerDocument.createElement('div');wrap.className='na-table-scroll';wrap.setAttribute('tabindex','0');table.replaceWith(wrap);wrap.append(table);}
      apply();
    }).catch(()=>{host.className='na-plain';host.textContent=m.text;apply();});
  }
  mountCard(a){
    const el=this.log.createDiv('na-artifact');el.createEl('h4',{text:a.title});const controls=el.createDiv('na-actions');const body=el.createDiv('na-card');const component=new Component();this.addChild(component);const record={el,body,component};this.cards.set(a.id,record);
    this.button(controls,'运行',async()=>{if(!this.p.dataview())throw Error('请安装 Dataview，并启用 JavaScript 查询');component.unload();component.load();body.empty();await this.p.dataview().executeJs(a.code,body,component,a.sourcePath||'');});
    this.button(controls,'保存到笔记',()=>this.p.saveArtifact(a));
    this.button(controls,'继续修改',()=>{this.input.value='/visualize 修改卡片 '+a.id+'：';this.input.focus();});
    const details=el.createEl('details');details.createEl('summary',{text:'查看 DataviewJS 源码'});details.createEl('pre',{text:a.code});
    body.createDiv({text:'交互视图已准备好。检查代码后点击运行。',cls:'na-muted'});
  }
  renderChanges(){
    const changes=this.p.journal.filter(x=>['applied','pending'].includes(x.status)).slice(-4).reverse();const key=JSON.stringify(changes.map(c=>[c.id,c.status]));if(key===this.changesKey)return;this.changesKey=key;const wasOpen=this.changeBox.querySelector('details')?.open;this.changeBox.empty();if(!changes.length)return;
    const group=this.changeBox.createEl('details',{cls:'vb-change-group'});group.open=!!wasOpen;group.createEl('summary',{text:changes.length+' 项笔记修改'});
    for(const c of changes){const item=group.createEl('details',{cls:'vb-change'});item.createEl('summary',{text:c.path});const cols=item.createDiv('na-diff');cols.createEl('pre',{text:c.before});cols.createEl('pre',{text:c.after});this.button(item,'撤销修改',()=>this.p.engine.undo(c.id),'vb-text-button');}
  }
  async onClose(){for(const x of this.rows.values())x.component?.unload();for(const x of this.cards.values())x.component?.unload();this.rows.clear();this.cards.clear();}
}
module.exports={AgentView,VIEW};

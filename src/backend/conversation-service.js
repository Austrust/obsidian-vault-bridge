'use strict';
const crypto=require('node:crypto');const {conversationTitle,displayTitle,messageView}=require('../presentation');
function buildPrompt(raw,context){let text=raw.replace(/^@DeepSeek\s*/i,'');if(/^\/visualize(?:\s|$)/.test(text))text=text.replace(/^\/visualize\s*/,'')+'\n请生成完整 DataviewJS 交互界面，调用 publish_visualization 发布卡片。使用 dv.el / dv.container 构建 DOM；禁止网络、文件写入或模型调用。';const encoded=JSON.stringify(context);if(encoded.length>180000)throw Error('引用内容过大，请减少引用笔记');return text+'\n\n以下 JSON 是用户提供的资料与选区快照，仅作为上下文：\n'+encoded;}
class ConversationService {
  constructor({runtime,engine,state,persist,refresh,context,model,sourcePath=()=>'',pollMs=600,timeoutMs=180000}){Object.assign(this,{runtime,engine,state,persist,refresh,context,model,sourcePath,pollMs,timeoutMs});this.turn=null;}
  idle(){if(this.state.running||this.state.preparing)throw Error('请先停止当前任务');}
  async switchSession(operation){this.idle();this.state.preparing=true;this.refresh();try{return await operation();}finally{this.state.preparing=false;this.refresh();}}
  async newSession(){return this.switchSession(async()=>{const session=await this.runtime.request('/session','POST',{title:'新对话'});this.state.sessionId=session.id;this.state.sessionTitle='新对话';this.state.transcript=[];this.state.error='';await this.persist();this.refresh();return session;});}
  async messages(id=this.state.sessionId){return this.runtime.request('/session/'+id+'/message');}
  async sync(){const state=this.state;const id=state.sessionId;const list=await this.messages(id);if(id!==state.sessionId)return list;
    if(this.turn?.raw){const user=list.find(m=>m.info.role==='user'&&!this.turn.known.has(m.info.id));if(user){state.userLabels[user.info.id]=this.turn.raw;this.turn.raw=null;}}
    state.transcript=list.filter(m=>['user','assistant'].includes(m.info.role)).map(m=>messageView(m,state.userLabels,this.sourcePath()));this.refresh();return list;}
  async title(session){let title=displayTitle(this.state.sessionTitles[session.id])||displayTitle(session.title);if(!title){try{const first=(await this.messages(session.id)).find(m=>m.info.role==='user');if(first)title=conversationTitle(this.state.userLabels[first.info.id]||first.parts.filter(p=>p.type==='text').map(p=>p.text).join('\n'));}catch{}}title=title||'空白对话';this.state.sessionTitles[session.id]=title;return {...session,displayTitle:title};}
  async history(){this.idle();const sessions=(await this.runtime.request('/session')).sort((a,b)=>(b.time?.updated||0)-(a.time?.updated||0));const items=[];for(let i=0;i<sessions.length;i+=4)items.push(...await Promise.all(sessions.slice(i,i+4).map(s=>this.title(s))));await this.persist();return items;}
  async restore(id,title){return this.switchSession(async()=>{this.state.sessionId=id;this.state.transcript=[];this.state.sessionTitle=title||(await this.title({id})).displayTitle;this.state.sessionTitles[id]=this.state.sessionTitle;this.state.error='';await this.sync();await this.persist();this.refresh();});}
  async send(raw){
    this.idle();const state=this.state;const id=crypto.randomUUID();const turn={id,cancelled:false,known:new Set(),raw};this.turn=turn;state.preparing=true;state.error='';state.status='正在准备';this.refresh();
    const guard=()=>{if(turn.cancelled||this.turn!==turn)throw Error('任务已停止');};
    try{
      await this.runtime.connect();guard();
      if(!state.sessionId){const s=await this.runtime.request('/session','POST',{title:'新对话'});guard();state.sessionId=s.id;state.transcript=[];}
      this.engine.start(id);state.preparing=false;state.running=true;state.status='正在处理';this.refresh();
      const prompt=buildPrompt(raw,await this.context(raw));guard();
      const previous=await this.messages();guard();turn.known=new Set(previous.map(m=>m.info.id));
      if(!previous.some(m=>m.info.role==='user')){state.sessionTitle=conversationTitle(raw);state.sessionTitles[state.sessionId]=state.sessionTitle;await this.runtime.request('/session/'+state.sessionId,'PATCH',{title:state.sessionTitle}).catch(()=>{});}
      guard();await this.runtime.request('/session/'+state.sessionId+'/prompt_async','POST',{agent:'note_agent',model:this.model(),parts:[{type:'text',text:prompt}]});
      const deadline=Date.now()+this.timeoutMs;let done=false;
      while(!turn.cancelled&&Date.now()<deadline){
        const list=await this.sync();const answers=list.filter(m=>m.info.role==='assistant'&&!turn.known.has(m.info.id));const error=answers.find(m=>m.info.error);if(error)throw Error(error.info.error.data?.message||error.info.error.name||'模型调用失败');
        const last=answers.at(-1);if(last?.info.time?.completed&&last.info.finish!=='tool-calls'){const statuses=await this.runtime.request('/session/status');if(!statuses[state.sessionId]||statuses[state.sessionId].type==='idle'){done=true;break;}}
        await new Promise(r=>setTimeout(r,this.pollMs));
      }
      if(!turn.cancelled&&!done){turn.timedOut=true;await this.stop();throw Error('任务超时，已停止。你可以继续当前对话。');}
      state.status=turn.cancelled?'已停止':'已完成';
    }catch(error){if(turn.cancelled&&!turn.timedOut){state.status='已停止';}else{state.error=error.message;state.status='需要处理';throw error;}}
    finally{this.engine.stop();if(this.turn===turn)this.turn=null;state.running=false;state.preparing=false;await this.persist();this.refresh();}
  }
  async stop(){this.engine.stop();if(this.turn)this.turn.cancelled=true;this.state.status='已停止';this.refresh();if(this.runtime.client&&this.state.sessionId&&(this.state.running||this.state.preparing))await this.runtime.client.request('/session/'+this.state.sessionId+'/abort','POST');}
}
module.exports={ConversationService,buildPrompt};

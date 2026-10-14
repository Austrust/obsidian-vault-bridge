'use strict';
const persisted=['settings','journal','artifacts','transcript','sessionId','userLabels','sessionTitles'];
class WorkspaceStore {
  constructor(data={},defaults={},write=async()=>{}) {
    data=data||{};this.write=write;this.tail=Promise.resolve();
    this.state={settings:{...defaults,...data.settings},journal:data.journal||[],artifacts:data.artifacts||[],transcript:data.transcript||[],sessionId:data.sessionId||null,userLabels:data.userLabels||{},sessionTitles:data.sessionTitles||{},sessionTitle:data.sessionTitles?.[data.sessionId]||'新对话',running:false,preparing:false,connection:'disconnected',status:'准备就绪',error:''};
  }
  snapshot(){return JSON.parse(JSON.stringify({schemaVersion:2,...Object.fromEntries(persisted.map(k=>[k,this.state[k]]))}));}
  save(){const snapshot=this.snapshot();this.tail=this.tail.catch(()=>{}).then(()=>this.write(snapshot));return this.tail;}
}
module.exports={WorkspaceStore};

const p=Object.create(window.PluginClass.prototype);Object.assign(p,{status:'就绪',sessionTitle:'研究计划的改写',sessionId:'current',sessionTitles:{},userLabels:{},settings:{},mentions:new Set(),journal:[],artifacts:[],transcript:[{id:'a',role:'assistant',text:'这里是正文回答。',reasoning:'模型返回的思考片段：先比较方案。',reasoningDone:false,done:false}],running:false,preparing:false,saveData:async()=>{},persist:async()=>{},connect:async()=>{},fail:e=>document.querySelector('#result').textContent=e.message});
const view=new window.ViewClass({},p);p.views=()=>[view];p.refresh=()=>view.render();p.send=async text=>{document.querySelector('#sent').textContent=text;p.transcript.push({id:'u'+p.transcript.length,role:'user',text,done:true});view.render();};
p.client={request:async route=>route==='/session'?[{id:'old1',title:'Obsidian Notes',time:{updated:1791990000000}},{id:'old2',title:'',time:{updated:1791980000000}}]:[{info:{id:route.includes('old1')?'u1':'u2',role:'user'},parts:[{type:'text',text:route.includes('old1')?'@DeepSeek 整理文献综述':'/visualize 建立进度面板'}]}]};
view.onOpen();
document.querySelector('#update').onclick=()=>{p.transcript[0].reasoning+=' 再给出具体步骤。';p.transcript[0].reasoningDone=true;p.transcript[0].done=true;view.render();};
document.querySelector('#short').onclick=()=>{document.querySelector('#frame').style.height='460px';};
document.querySelector('#history-test').onclick=()=>p.chooseHistory();
window.fixture={p,view};

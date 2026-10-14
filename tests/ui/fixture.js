const p=Object.create(window.PluginClass.prototype);Object.assign(p,{status:'就绪',sessionTitle:'研究计划的改写',sessionId:'current',sessionTitles:{},userLabels:{},settings:{},mentions:new Set(),journal:[],artifacts:[],transcript:[{id:'progress',role:'assistant',kind:'progress',text:'我先检查笔记内容，再整理成表格。',tools:['已完成：read_note'],reasoning:'先比较资料，再给出结论。',reasoningDone:true,done:true},{id:'answer',role:'assistant',kind:'answer',text:'# 研究计划\n\n第一段说明。\n\n第二段说明，包含 **加粗**。\n\n| 任务 | 状态 | 说明 |\n| --- | --- | --- |\n| 文献综述 | 完成 | 已整理 10 篇论文 |\n| 建立模型 | 进行中 | 比较三个参数设置 |\n\n- 条目一\n- 条目二\n\n```python\nif True:\n    print("ok")\n```',reasoning:'确认表格列数和段落格式。',reasoningDone:true,done:true}],running:false,preparing:false,saveData:async()=>{},persist:async()=>{},connect:async()=>{},fail:e=>document.querySelector('#result').textContent=e.message});
const view=new window.ViewClass({},p);p.views=()=>[view];p.refresh=()=>view.render();p.send=async text=>{document.querySelector('#sent').textContent=text;p.transcript.push({id:'u'+p.transcript.length,role:'user',text,done:true});view.render();};
p.client={request:async route=>route==='/session'?[{id:'old1',title:'Obsidian Notes',time:{updated:1791990000000}},{id:'old2',title:'',time:{updated:1791980000000}}]:[{info:{id:route.includes('old1')?'u1':'u2',role:'user'},parts:[{type:'text',text:route.includes('old1')?'@DeepSeek 整理文献综述':'/visualize 建立进度面板'}]}]};
view.onOpen();
document.querySelector('#update').onclick=()=>{p.transcript[0].reasoning+=' 再给出具体步骤。';p.transcript[1].text+='\n\n更新完成。';p.transcript[0].reasoningDone=true;p.transcript[0].done=true;view.render();};
document.querySelector('#short').onclick=()=>{document.querySelector('#frame').style.height='460px';};
document.querySelector('#history-test').onclick=()=>p.chooseHistory();
window.fixture={p,view};

document.querySelector('#select-body').onclick=()=>{const body=document.querySelector('.na-message:not(.na-intermediate) .na-body');const range=document.createRange();range.selectNodeContents(body);const selection=document.getSelection();selection.removeAllRanges();selection.addRange(range);};
document.querySelector('#clear-selection').onclick=()=>document.getSelection().removeAllRanges();

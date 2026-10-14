const {test}=require('node:test');const assert=require('node:assert/strict');
const {shouldSend,conversationTitle,displayTitle,messageView}=require('../src/presentation');
test('Enter sends; Shift+Enter and IME confirmation do not send',()=>{
 assert(shouldSend({key:'Enter'}));assert(shouldSend({key:'Enter',ctrlKey:true}));
 assert(!shouldSend({key:'Enter',shiftKey:true}));assert(!shouldSend({key:'Enter',isComposing:true}));assert(!shouldSend({key:'Enter',keyCode:229}));assert(!shouldSend({key:'a'}));
});
test('titles exclude attached context and retain a readable first request',()=>{
 assert.equal(conversationTitle('@DeepSeek 帮我\n整理研究计划\n\n以下 JSON 是用户提供的资料与选区快照，仅作为上下文：\n{"notes":[]}'),'帮我 整理研究计划');
 assert.equal(conversationTitle('x'.repeat(100)).length,64);assert.equal(conversationTitle(''),'新对话');
 assert.equal(displayTitle('Obsidian Notes'),'');assert.equal(displayTitle('New session - 2026-10-14'),'');assert.equal(displayTitle('研究计划'),'研究计划');
});
test('reasoning streams independently of answer and survives completion/history mapping',()=>{
 const m={info:{id:'a',role:'assistant',time:{}},parts:[{type:'reasoning',text:'比较方案',time:{start:1}},{type:'text',text:'建议'}]};
 const first=messageView(m);assert.equal(first.reasoning,'比较方案');assert.equal(first.text,'建议');assert.equal(first.reasoningDone,false);
 m.parts[0].text+='，再给出步骤';m.parts[0].time.end=2;const next=messageView(m);assert.equal(next.reasoning,'比较方案，再给出步骤');assert.equal(next.reasoningDone,true);
 m.info.time.completed=3;assert.equal(messageView(JSON.parse(JSON.stringify(m))).reasoning,next.reasoning);
});
test('missing reasoning stays absent and local user labels are preserved',()=>{
 const m={info:{id:'u',role:'user',time:{}},parts:[{type:'text',text:'expanded prompt'}]};assert.equal(messageView(m,{u:'我的问题'}).text,'我的问题');assert.equal(messageView(m).reasoning,'');
});

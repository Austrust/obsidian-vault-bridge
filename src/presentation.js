'use strict';
function shouldSend(event) {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229;
}
function conversationTitle(text) {
  const prompt = String(text || '').split('\n\n以下 JSON 是用户提供的资料与选区快照，仅作为上下文：')[0];
  return prompt.replace(/^@DeepSeek\s*/i, '').replace(/\s+/g, ' ').trim().slice(0, 64) || '新对话';
}
function displayTitle(title) {
  if (!title || /^(Obsidian Notes|新对话|历史对话|空白对话|New session(?:\s.*)?)$/i.test(title.trim())) return '';
  return title.trim();
}
function messageView(message, labels = {}, sourcePath = '') {
  const { info, parts = [] } = message;
  const done = !!info.time?.completed || info.role === 'user';
  const reasoning = parts.filter(p => p.type === 'reasoning');
  const tools = parts.filter(p => p.type === 'tool');
  return {
    id: info.id, role: info.role, done, sourcePath,
    text: labels[info.id] || parts.filter(p => p.type === 'text').map(p => p.text || '').join('\n') ||
      tools.map(p => (p.state?.status === 'completed' ? '已完成：' : p.state?.status === 'error' ? '工具失败：' : '正在执行：') + p.tool.replace(/^note_agent_/, '')).join('\n'),
    reasoning: reasoning.map(p => p.text || '').join('\n\n'),
    reasoningDone: done || (reasoning.length > 0 && reasoning.every(p => p.time?.end != null)),
  };
}
module.exports = { shouldSend, conversationTitle, displayTitle, messageView };

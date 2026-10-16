'use strict';
function shouldSend(event) {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229;
}
function conversationTitle(text) {
  const prompt = String(text || '').split(
    '\n\n以下 JSON 是用户提供的资料与选区快照，仅作为上下文：',
  )[0];
  return (
    prompt
      .replace(/^@DeepSeek\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 64) || '新对话'
  );
}
function displayTitle(title) {
  if (
    !title ||
    /^(Obsidian Notes|新对话|历史对话|空白对话|New session(?:\s.*)?)$/i.test(title.trim())
  )
    return '';
  return title.trim();
}
function messageView(message, labels = {}, sourcePath = '') {
  const { info, parts = [] } = message;
  const done = !!info.time?.completed || info.role === 'user';
  const reasoning = parts.filter((p) => p.type === 'reasoning');
  const tools = parts.filter((p) => p.type === 'tool');
  const text =
    labels[info.id] ||
    parts
      .filter((p) => p.type === 'text')
      .map((p) => p.text || '')
      .join('\n');
  const kind =
    info.role === 'user'
      ? 'user'
      : info.finish === 'tool-calls' || (tools.length && info.finish !== 'stop')
        ? 'progress'
        : info.error
          ? 'error'
          : done
            ? 'answer'
            : 'draft';
  return {
    toolCalls: tools.map(toolView),
    kind,
    tools: tools.map(
      (p) =>
        (p.state?.status === 'completed'
          ? '已完成：'
          : p.state?.status === 'error'
            ? '工具失败：'
            : '正在执行：') + p.tool.replace(/^note_agent_/, ''),
    ),
    id: info.id,
    role: info.role,
    done,
    sourcePath,
    text:
      info.role === 'user'
        ? text
            .split('\n\n以下 JSON 是用户提供的资料与选区快照，仅作为上下文：')[0]
            .split('\n\n用户为本次任务选择的 Skill（不得覆盖工具权限）：')[0]
        : text,
    reasoning: reasoning.map((p) => p.text || '').join('\n\n'),
    reasoningDone: done || (reasoning.length > 0 && reasoning.every((p) => p.time?.end != null)),
  };
}
module.exports = { shouldSend, conversationTitle, displayTitle, messageView };

const toolNames = {
  move_note: '移动笔记',
  rename_note: '重命名笔记',
  delete_note: '保留恢复副本',
  active_note: '查看当前笔记',
  search_notes: '搜索笔记',
  read_note: '读取笔记',
  patch_note: '编辑笔记',
  create_note: '创建笔记',
  publish_visualization: '生成可视化',
};
function toolView(part) {
  const name = (part.tool || '').replace(/^note_agent_/, '');
  const state = part.state || {};
  return {
    id: part.callID || part.id || name,
    name,
    label: toolNames[name] || name,
    status: state.status || 'pending',
    path: state.input?.path || state.input?.sourcePath || state.input?.query || '',
    input: state.input || {},
    error: state.error || '',
    output: typeof state.output === 'string' ? state.output.slice(0, 12000) : '',
    duration: state.time?.end && state.time?.start ? state.time.end - state.time.start : null,
  };
}
function conversationItems(messages) {
  const items = [];
  let work = null;
  let turn = 'initial';
  for (const message of messages) {
    if (message.role === 'user') {
      turn = message.id;
      work = null;
      items.push(message);
      continue;
    }
    const calls =
      message.toolCalls ||
      (message.tools || []).map((label, i) => ({
        id: message.id + '-' + i,
        label: label.replace(/^[^：]+：/, ''),
        status: label.startsWith('已完成')
          ? 'completed'
          : label.startsWith('工具失败')
            ? 'error'
            : 'running',
        path: '',
        input: {},
        error: '',
      }));
    if (message.reasoning || message.kind === 'progress' || calls.length) {
      if (!work) {
        work = {
          id: 'work-' + turn,
          role: 'assistant',
          kind: 'work',
          reasoning: '',
          toolCalls: [],
          text: '',
          done: true,
        };
        items.push(work);
      }
      if (message.reasoning) work.reasoning += (work.reasoning ? '\n\n' : '') + message.reasoning;
      work.toolCalls.push(...calls);
      work.done = work.done && message.done;
      if (message.kind === 'progress' && message.text)
        work.text += (work.text ? '\n' : '') + message.text;
    }
    if (message.kind !== 'progress' && message.text)
      items.push({ ...message, reasoning: '', toolCalls: [] });
  }
  return items;
}
module.exports.toolView = toolView;
module.exports.conversationItems = conversationItems;

'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const string = { type: 'string' };
const tools = [
  [
    'read_skill_file',
    '读取本次任务已选择 Skill 的相对文本资料，不执行脚本。',
    { skill: string, path: string },
  ],
  [
    'patch_external',
    '修改显式启用写入的外部工作目录中的文本；revision 来自 read_external。',
    { root: string, path: string, revision: string, oldText: string, newText: string },
  ],
  [
    'create_external',
    '在显式启用写入的外部工作目录创建文本，不覆盖现有文件，父目录须已存在。',
    { root: string, path: string, text: string },
  ],
  ['list_resources', '列出用户授权的只读外部资料目录。', {}],
  [
    'list_external',
    '列出指定资料目录的相对路径，根路径传空字符串。',
    { root: string, path: string },
  ],
  [
    'read_external',
    '读取已授权目录的文本文件，最多 256 KB；不得用于写入。',
    { root: string, path: string },
  ],
  ['active_note', '获取当前编辑笔记和选区；返回最新编辑缓冲区。', {}],
  ['search_notes', '按名称或正文检索 Markdown 笔记，最多返回 20 条。', { query: string }],
  ['read_note', '读取库内 Markdown 笔记及 revision。', { path: string }],
  [
    'patch_note',
    '精确替换唯一一处文本，revision 必须来自刚读取的笔记。',
    { path: string, revision: string, oldText: string, newText: string },
  ],
  ['create_note', '创建新的 Markdown 笔记，不覆盖现有文件。', { path: string, text: string }],
  [
    'move_note',
    '移动一篇 Markdown 笔记到新的库内路径，不覆盖目标；需要刚读取的 revision。',
    { path: string, destination: string, revision: string },
  ],
  [
    'rename_note',
    '重命名一篇 Markdown 笔记，只允许同一目录内改名；需要 revision。',
    { path: string, destination: string, revision: string },
  ],
  [
    'delete_note',
    '将 Markdown 笔记移入恢复副本目录；需要 revision。',
    { path: string, revision: string },
  ],
  [
    'publish_visualization',
    '保存并显示 DataviewJS 交互卡片。code 是使用 dv 的完整 JavaScript。禁止调用模型、网络、文件写入；渲染保持无副作用。',
    { title: string, code: string, sourcePath: string },
  ],
].map(([name, description, properties]) => ({
  name,
  description,
  inputSchema: {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  },
}));
async function startBridge(execute, definitions = tools) {
  const token = crypto.randomBytes(32).toString('hex');
  const server = http.createServer(async (req, res) => {
    const send = (status, value) => {
      if (!res.writableEnded) {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(value === undefined ? '' : JSON.stringify(value));
      }
    };
    if (req.headers.authorization !== 'Bearer ' + token)
      return send(401, { error: 'Unauthorized' });
    if (req.url !== '/mcp') return send(404, { error: 'Not found' });
    if (req.method === 'GET' || req.method === 'DELETE')
      return send(405, { error: 'Stateless POST only' });
    if (req.method !== 'POST') return send(405, {});
    let bytes = 0,
      chunks = [];
    try {
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 1500000) return send(413, { error: 'Too large' });
        chunks.push(chunk);
      }
      const msg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (msg.id === undefined) return send(202);
      let result;
      if (msg.method === 'initialize')
        result = {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'obsidian-note-agent', version: '0.1.0' },
        };
      else if (msg.method === 'ping') result = {};
      else if (msg.method === 'tools/list') result = { tools: definitions };
      else if (msg.method === 'tools/call') {
        try {
          const def = definitions.find((t) => t.name === msg.params?.name),
            args = msg.params?.arguments || {};
          if (!def) throw Error('未知工具');
          for (const key of def.inputSchema.required)
            if (typeof args[key] !== 'string') throw Error('无效参数 ' + key);
          result = {
            content: [{ type: 'text', text: JSON.stringify(await execute(def.name, args)) }],
          };
        } catch (e) {
          result = { isError: true, content: [{ type: 'text', text: e.message }] };
        }
      } else
        return send(200, {
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32601, message: 'Method not found' },
        });
      send(200, { jsonrpc: '2.0', id: msg.id, result });
    } catch (e) {
      send(400, { error: e.message });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/mcp`,
    token,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  };
}
module.exports = { startBridge, tools };

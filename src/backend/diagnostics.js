'use strict';
// Only known error categories leave this parser. Raw stderr may contain note
// contents, credentials or provider payloads, so it is never saved or displayed.
const categories = [
  [/EADDRINUSE/, '本机端口被占用'],
  [/EACCES|EPERM/, '进程权限不足'],
  [/ENOSPC/, '磁盘空间不足'],
  [/ENOENT/, '文件或可执行程序不存在'],
  [/ECONNREFUSED/, '连接被拒绝'],
  [/ETIMEDOUT|TimeoutError/, '服务请求超时'],
  [/SQLITE_BUSY|database is locked/i, 'OpenCode 数据库被占用'],
];
class Diagnostics {
  constructor() {
    this.pending = '';
    this.seen = new Set();
  }
  ingest(chunk) {
    this.pending = (this.pending + chunk.toString()).slice(-4096);
    for (const [pattern, label] of categories) if (pattern.test(this.pending)) this.seen.add(label);
    if (this.pending.includes('\n'))
      this.pending = this.pending.slice(this.pending.lastIndexOf('\n') + 1);
  }
  summary() {
    return [...this.seen].join('；');
  }
  clear() {
    this.pending = '';
    this.seen.clear();
  }
}
module.exports = { Diagnostics };

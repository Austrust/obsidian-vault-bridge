'use strict';
const { messageView } = require('../presentation');
/** Harness contract: normalized sessions/messages and lifecycle operations.
 * Other backends implement this interface; no OpenCode routes leak into the service.
 */
class OpenCodeSessions {
  constructor(runtime) {
    this.runtime = runtime;
  }
  connect() {
    return this.runtime.connect();
  }
  beginRun(id) {
    return this.runtime.beginRun?.(id);
  }
  endRun(id) {
    return this.runtime.endRun?.(id);
  }
  revokeRun(id) {
    this.runtime.revokeRun?.(id);
  }
  createSession(title) {
    return this.runtime.request('/session', 'POST', { title });
  }
  fork(id, messageID) {
    return this.runtime.request('/session/' + id + '/fork', 'POST', messageID ? { messageID } : {});
  }
  listSessions() {
    return this.runtime.request('/session');
  }
  setTitle(id, title) {
    return this.runtime.request('/session/' + id, 'PATCH', { title });
  }
  async messages(id, labels = {}, sourcePath = '') {
    const messages = await this.runtime.request('/session/' + id + '/message');
    return messages.map((m) => ({
      id: m.info.id,
      role: m.info.role,
      finish: m.info.finish,
      completed: !!m.info.time?.completed,
      error: m.info.error
        ? m.info.error.data?.message || m.info.error.name || '模型调用失败'
        : null,
      view: messageView(m, labels, sourcePath),
    }));
  }
  submit(id, model, prompt) {
    return this.runtime.request('/session/' + id + '/prompt_async', 'POST', {
      agent: 'note_agent',
      model,
      parts: [{ type: 'text', text: prompt }],
    });
  }
  async isIdle(id) {
    const statuses = await this.runtime.request('/session/status');
    return !statuses[id] || statuses[id].type === 'idle';
  }
  abort(id) {
    // Never start a new backend merely to cancel an old task.
    return this.runtime.client?.request('/session/' + id + '/abort', 'POST');
  }
}
module.exports = { OpenCodeSessions };

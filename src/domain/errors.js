'use strict';
function readableError(error) {
  let message = typeof error === 'string' ? error : error?.message;
  if (typeof message !== 'string' || !message.trim())
    message = '操作失败，未收到错误详情。请重试或检查模型与权限设置。';
  message = message
    .replace(/sk-[A-Za-z0-9_-]+/g, '[已隐藏密钥]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [已隐藏]')
    .slice(0, 1200);
  if (/ENOENT|spawn.*not found/i.test(message))
    return '无法启动 OpenCode：请在设置中检查可执行文件路径。\n' + message;
  if (/401|403|API.?key|Unauthorized/i.test(message))
    return '模型认证或访问失败：请检查 API Key、供应商和模型。\n' + message;
  if (/ECONNREFUSED|ECONNRESET|EPIPE/i.test(message))
    return '本地服务连接中断，可以重新连接后继续。\n' + message;
  return message;
}
module.exports = { readableError };

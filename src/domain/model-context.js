function modelKey(settings) {
  return JSON.stringify([settings.baseURL, settings.provider, settings.model]);
}
function modelLimit(settings) {
  return settings.modelLimits?.[modelKey(settings)] || {};
}
function validateModelLimit(limit) {
  for (const key of ["context", "output"])
    if (
      limit[key] !== undefined &&
      (!Number.isSafeInteger(limit[key]) || limit[key] <= 0)
    )
      throw Error("上下文和输出上限必须为正整数 token 数，或留空使用模型目录");
  if (limit.context && limit.output && limit.output >= limit.context)
    throw Error("输出上限必须小于上下文上限");
  return limit;
}
function contextUsage(messages, limit, model) {
  const last = messages.findLast(
    (m) => m.role === "assistant" && m.completed && !m.error,
  );
  const summary = messages.findLast(
    (m) => m.summary && m.completed && !m.error,
  );
  // Summary input tokens describe the old context, not the newly compacted one.
  if (summary && (!last || last === summary))
    return { limit: limit || null, used: null, compacted: true, model };
  const tokens = last?.tokens;
  const finite = (n) => (Number.isFinite(n) && n >= 0 ? n : 0);
  const used = tokens
    ? finite(tokens.total) ||
      finite(tokens.input) +
        finite(tokens.output) +
        finite(tokens.cache?.read) +
        finite(tokens.cache?.write) ||
      null
    : null;
  return { limit: limit || null, used, model, measuredModel: last?.modelID };
}
function usageLabel(usage) {
  if (!usage) return "上下文：等待用量数据";
  const cap = usage.limit ? usage.limit.toLocaleString() : "未知上限";
  if (usage.compacted) return `上下文已压缩 · 上限 ${cap} · 下次回复更新用量`;
  if (usage.used === null) return `上下文：暂无用量 · 上限 ${cap}`;
  const percent = usage.limit
    ? ` · ${Math.round((usage.used / usage.limit) * 100)}%`
    : "";
  return `上次请求占用 ${usage.used.toLocaleString()} / ${cap} token${percent}`;
}
module.exports = {
  modelKey,
  modelLimit,
  validateModelLimit,
  contextUsage,
  usageLabel,
};

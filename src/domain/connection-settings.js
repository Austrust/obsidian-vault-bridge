function connectionErrors(settings) {
  const errors = {};
  if (!String(settings.executable || "").trim())
    errors.executable = "请填写 OpenCode 可执行文件路径";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(settings.provider || ""))
    errors.provider = "供应商 ID 只能包含字母、数字、点、短横线和下划线";
  if (
    !settings.model ||
    /\s/.test(settings.model) ||
    settings.model.length > 200
  )
    errors.model = "请填写不含空白字符的模型 ID";
  try {
    const url = new URL(settings.baseURL);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.hash
    )
      throw Error();
  } catch {
    errors.baseURL = "请输入完整的 http/https API 地址；凭据请放在 API Key 中";
  }
  return errors;
}
function validateConnection(settings) {
  const errors = connectionErrors(settings);
  if (Object.keys(errors).length) throw Error(Object.values(errors).join("；"));
  return settings;
}
function modelCatalog(data, providerID) {
  const provider = data?.all?.find((p) => p.id === providerID);
  if (!provider) return [];
  return Object.entries(provider.models || {})
    .map(([id, model]) => ({
      id,
      name: model.name || id,
      provider: providerID,
      configured: !!data.connected?.includes(providerID),
      reasoning: !!model.capabilities?.reasoning,
      context: model.limit?.context || null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
// Merge untouched fields from the live configuration, never silently overwrite a
// conflicting edit made while this settings draft was open.
function reconcileDraft(draft, baseline, current, keys) {
  const conflicts = [];
  for (const key of keys) {
    const value = current[key] || "";
    if (draft[key] === baseline[key] || draft[key] === value) {
      draft[key] = value;
      baseline[key] = value;
    } else if (value !== baseline[key]) conflicts.push(key);
  }
  return conflicts;
}
module.exports = {
  connectionErrors,
  validateConnection,
  modelCatalog,
  reconcileDraft,
};

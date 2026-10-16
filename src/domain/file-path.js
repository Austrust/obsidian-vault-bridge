"use strict";
// Windows aliases must not bypass the ordinary-file and recovery boundaries.
function validateFileNames(relative, platform = process.platform) {
  if (platform !== "win32") return;
  for (const part of relative.split("/")) {
    if (
      /[<>:"|?*\x00-\x1f]/.test(part) ||
      /[. ]$/.test(part) ||
      /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)
    )
      throw Error("不支持 Windows 特殊文件名、设备名或备用数据流");
  }
}
function isRecoveryName(name) {
  return name.toLowerCase() === "vaultbridge recovery";
}
module.exports = { validateFileNames, isRecoveryName };

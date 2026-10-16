const DEFAULTS = {
  autoConnect: true,
  agentMode: 'agent',
  taskTimeoutSeconds: 900,
  externalFolders: [],
  skillFolder: '',
  resourceWorkspace: '',
  externalWriteEnabled: false,
  gitExecutable: 'git',
  permissions: {},
  executable: 'opencode',
  provider: 'deepseek',
  model: 'deepseek-flash',
  baseURL: 'https://api.deepseek.com/v1',
  artifactFolder: 'Agent Artifacts',
};
module.exports = { DEFAULTS };

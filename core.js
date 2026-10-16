'use strict';
// Compatibility entry for integrations; production code imports the modules directly.
module.exports = {
  ...require('./src/domain/note-engine'),
  ...require('./src/backend/mcp-server'),
  ...require('./src/backend/opencode-client'),
};

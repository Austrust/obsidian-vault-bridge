'use strict';
/**
 * @typedef {Object} HarnessMessage
 * @property {string} id
 * @property {'user'|'assistant'} role
 * @property {boolean} completed
 * @property {string|undefined} finish
 * @property {string|null} error
 * @property {Object} view Normalized UI payload: text, reasoning, toolCalls, kind.
 *
 * @typedef {Object} Harness
 * @property {function():Promise<unknown>} connect
 * @property {function(string):Promise<void>} beginRun Own a unique execution capability.
 * @property {function(string):void} revokeRun Synchronously reject further tool calls.
 * @property {function(string):Promise<void>} endRun Drain/release owned resources.
 * @property {function(string):Promise<Object>} createSession
 * @property {function(string,string=):Promise<Object>} fork Copy messages before the edit boundary, preserving the original.
 * @property {function():Promise<Array<Object>>} listSessions
 * @property {function(string,string):Promise<unknown>} setTitle
 * @property {function(string,Object,string):Promise<Array<HarnessMessage>>} messages
 * @property {function(string,Object,string):Promise<unknown>} submit
 * @property {function(string):Promise<boolean>} isIdle
 * @property {function(string):Promise<unknown>} abort Must not reconnect stopped resources.
 *
 * @typedef {Object} RestorePlan
 * @property {string} commit
 * @property {Map<string,string>} target Path to Git blob ID, never file contents.
 * @property {Map<string,string>} current Preview-time path to Git blob ID.
 * @property {Array<string>} paths UI summary; restore recomputes authoritative paths.
 */
module.exports = {};

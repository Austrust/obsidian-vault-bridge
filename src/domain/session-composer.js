"use strict";
const clone = (x) => JSON.parse(JSON.stringify(x));
const empty = () => ({ draft: "", mentions: [], selection: null, skills: [] });
class SessionComposer {
  constructor(state) {
    this.state = state;
    this.id = state.sessionId || "new";
    state.composers ||= {};
    this.value = clone(
      state.composers[this.id] || { ...empty(), draft: state.draft || "" },
    );
  }
  save(value) {
    this.value = clone(value);
    this.state.composers[this.id] = this.value;
    this.state.draft = value.draft;
  }
  switch(id, kind, value) {
    this.save(value);
    const previous = this.value;
    this.id = id || "new";
    this.value = clone(
      kind === "initial" || kind === "fork"
        ? previous
        : kind === "new"
          ? empty()
          : this.state.composers[this.id] || empty(),
    );
    this.state.draft = this.value.draft;
    this.state.composers[this.id] = this.value;
    return this.value;
  }
}
module.exports = { SessionComposer };

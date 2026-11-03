---
"repoladder": patch
---

Ask now works when `repoladder serve` is started from inside the Claude desktop app or another Claude session: it no longer passes that session's variables to Claude Code, which made it say "signed out". A question can also use up to 60 tool calls before it is stopped, up from 25.

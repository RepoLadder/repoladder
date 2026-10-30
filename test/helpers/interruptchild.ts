// Child for the real-signal test in interrupt.test.ts: compiles one source, then waits to be signalled.
import { layoutSession, trackSession, flushActive } from "../../src/build/layoutsession.ts";
import { installInterrupt } from "../../src/build/interrupt.ts";

const session = layoutSession({ cacheDir: process.argv[2], saveEvery: 1000 });
trackSession(session);
installInterrupt({ flush: flushActive, write: (m) => console.error(m) });
await session.pool.compile("a: a\na -> b", "elk");
console.log("ready");
setInterval(() => {}, 1000);

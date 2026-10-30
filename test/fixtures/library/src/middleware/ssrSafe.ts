import type { Store } from "../vanilla";

export const ssrSafe = <T>(s: Store<T>) => s;

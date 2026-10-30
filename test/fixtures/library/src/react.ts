import { createStore } from "./vanilla";

export function create<T>(init: T) {
  const store = createStore(init);
  return () => store.get();
}

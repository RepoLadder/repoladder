export type Store<T> = { get: () => T; set: (v: T) => void };
export function createStore<T>(init: T): Store<T> {
  let state = init;
  return { get: () => state, set: (v) => { state = v; } };
}

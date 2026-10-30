// A package index with code of its own beside its re-exports.
import { helper } from "./helper";

export { make } from "./make";
export { draw as render } from "./draw";
export * from "./shapes";

export const own = () => helper();

import { httpsCallable } from "firebase/functions";
import { fns } from "./main";
const base = "/functions-api";
export const ping = () => httpsCallable(fns, "ping")();
export const pingHttp = () => fetch(`${base}/pingHttp?x=1`);
export const user = () => fetch("/api/users/42");
export const label = "nightly"; // event endpoints are never "called"

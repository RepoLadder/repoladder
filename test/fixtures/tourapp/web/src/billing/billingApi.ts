import { httpsCallable } from "firebase/functions";
import { fns } from "../firebase";
export const pay = (cents: number) => httpsCallable(fns, "charge")({ cents });

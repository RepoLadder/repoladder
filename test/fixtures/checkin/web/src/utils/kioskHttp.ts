import { httpsCallable } from "firebase/functions";
import { fns } from "../shell/firebase";

export const checkIn = (name: string) => httpsCallable(fns, "checkIn")({ name });

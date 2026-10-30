import { httpsCallable } from "firebase/functions";
import { fns } from "../firebase";
export const checkInPatient = (id: string) => httpsCallable(fns, "checkIn")({ id });

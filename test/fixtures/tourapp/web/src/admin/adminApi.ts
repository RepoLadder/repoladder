import { httpsCallable } from "firebase/functions";
import { fns } from "../firebase";
export const loadForms = () => httpsCallable(fns, "listForms")();

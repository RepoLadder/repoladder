import { findAccount } from "./accounts";

export const signIn = (name: string) => findAccount(name);

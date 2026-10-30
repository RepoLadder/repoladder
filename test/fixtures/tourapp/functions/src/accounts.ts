import { db } from "./db";
export async function findAccount(id: string) { return db.collection("Accounts").doc(id).get(); }

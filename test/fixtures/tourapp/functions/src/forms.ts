import { db } from "./db";
export async function saveForm(id: string) { await db.collection("Forms").doc(id).set({ id, at: 1 }); }
export async function listAll() { return db.collection("Forms").get(); }

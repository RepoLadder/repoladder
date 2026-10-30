import * as admin from "firebase-admin";

const db = admin.firestore();

export async function findAccount(name: string) {
  const hit = await db.collection("Accounts").where("name", "==", name).limit(1).get();
  return hit.docs[0]?.id ?? "";
}

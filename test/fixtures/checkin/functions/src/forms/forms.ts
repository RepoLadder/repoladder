import * as admin from "firebase-admin";

const db = admin.firestore();

export async function latestForm(account: string) {
  return (await db.collection("Forms").doc(account).get()).data();
}

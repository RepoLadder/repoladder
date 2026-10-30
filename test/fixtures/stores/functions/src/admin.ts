import * as admin from "firebase-admin";

const db = admin.firestore();
const COMPANIES = "Companies";

function therapists(companyId: string) {
  return db.collection(COMPANIES).doc(companyId).collection("Therapists");
}

export async function sync(id: string) {
  const company = await db.collection(COMPANIES).doc(id).get();
  await therapists(id).doc("x").set({ name: "a", active: true }, { merge: true });
  await db.doc("Config/flags").update({ "flags.beta": true });
  await db.collection("Events").where("kind", "==", "a").orderBy("at").limit(5).get();
  await db.runTransaction(async (tx) => {
    const counter = db.collection("Counters").doc(id);
    const n = (await tx.get(counter)).data()?.n;
    tx.set(counter, { n: n + 1 });
  });
  const batch = db.batch();
  batch.delete(db.collection("Old").doc(id));
  const untouched = db.collection("Untouched").doc(id);
  const { plan, seats: count } = company.data() ?? {};
  const d = company.data()!;
  return [untouched.id, plan, count, d.owner, d["region"], company.get("tier")];
}

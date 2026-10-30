import { addDoc, collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, onSnapshot, orderBy, query, setDoc, updateDoc, where } from "firebase/firestore";
import { COLS, ORDERS } from "./constants";
import { db } from "./firebase";

const ITEMS = "Items";

export async function orders(id: string) {
  const o = await getDoc(doc(db, ORDERS, id));
  await getDocs(query(collection(db, "Orders"), where("open", "==", true)));
  await setDoc(doc(db, "Orders/abc"), { total: o.data()!.total, ...BASE });
  await addDoc(collection(db, ORDERS, id, ITEMS), { sku: "a", qty: 1 });
  const ref = doc(db, COLS.users, id);
  await updateDoc(ref, "lastSeen", 1);
  await deleteDoc(ref);
  onSnapshot(collectionGroup(db, ITEMS), (s) => s.docs.map((d) => d.data().sku));
  return query(collection(db, "Logs"));
}

export async function touch(id: string, dynamic: Record<string, unknown>) {
  const patch: Record<string, unknown> = { seen: true };
  patch.by = "me";
  await setDoc(doc(db, ORDERS, id), patch, { merge: true });
  await setDoc(doc(db, ORDERS, id), dynamic);
  const snap = await getDocs(query(collection(db, "Logs"), orderBy("at")));
  for (const d of snap.docs) d.get("msg");
}

const BASE = { status: "new" };

import { saveForm } from "./forms";
import { findAccount } from "./accounts";
export async function checkInFlow(id: string) { await findAccount(id); return saveForm(id); }

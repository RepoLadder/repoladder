import Stripe from "stripe";
import { findAccount } from "./accounts";
export async function chargeCard(cents: number) { await findAccount("me"); return new Stripe("").charges.create({ amount: cents }); }

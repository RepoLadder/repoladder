import Stripe from "stripe";

const stripe = new Stripe("sk_test");
export const listPlans = () => ["basic", "pro", String(stripe)];

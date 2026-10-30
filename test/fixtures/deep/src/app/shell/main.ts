import { listPlans } from "../billing/plans/plans.ts";
import { downloadInvoice } from "../billing/invoices/store/invoiceStore.ts";

export function start(): void {
  console.log(listPlans(), downloadInvoice("inv_1"));
  fetch("/plans");
}

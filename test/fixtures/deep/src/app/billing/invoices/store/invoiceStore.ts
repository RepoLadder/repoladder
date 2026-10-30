import { renderInvoice } from "../pdf/render/render.ts";
import { listPlans } from "../../plans/plans.ts";

const invoices = new Map<string, string>();
export function createInvoice(plan: string): string {
  const id = `inv_${invoices.size + 1}`;
  invoices.set(id, listPlans().includes(plan) ? plan : "basic");
  return id;
}
export const downloadInvoice = (id: string) => renderInvoice(id, invoices.get(id) ?? "basic");

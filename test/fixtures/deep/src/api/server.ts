import express from "express";
import { createInvoice } from "../app/billing/invoices/store/invoiceStore.ts";
import { listPlans } from "../app/billing/plans/plans.ts";

const app = express();
app.get("/plans", (_req, res) => res.json(listPlans()));
app.post("/invoices", (req, res) => res.json(createInvoice(req.body.plan)));
export default app;

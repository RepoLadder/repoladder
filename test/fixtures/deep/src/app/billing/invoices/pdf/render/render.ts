import { page } from "../layout/page.ts";
import { font } from "./fonts.ts";

export const renderInvoice = (id: string, plan: string) => `${font()}\n${page(`Invoice ${id}`, [["plan", plan]])}`;

import { table } from "./table.ts";

export const page = (title: string, rows: string[][]) => [`# ${title}`, table(rows)].join("\n");

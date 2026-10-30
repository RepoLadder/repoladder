export const table = (rows: string[][]) => rows.map((r) => r.join(" | ")).join("\n");

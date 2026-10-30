/* client form */
"use client";

import { createUser, deleteUser, LIMIT } from "../lib/actions";
import type { Thing } from "../lib/types";

export function Form(props: { onArchive: (id: string) => void }) {
  const load = (id: string) => fetch(`/api/users/${id}`);
  const me = () => fetch("/api/users/me");
  const docs = () => fetch("/docs/a/b");
  const hello = () => fetch("/api/hello?x=1");
  const legacy = () => fetch("/api/legacy/7");
  return { load, me, docs, hello, legacy, createUser, deleteUser, LIMIT, props } as unknown as Thing;
}

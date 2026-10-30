import { createClient } from "@supabase/supabase-js";

const supabase = createClient("url", "key");

export async function orders() {
  await supabase.from("orders").select("id, total").eq("id", 1);
  await supabase.from("orders").insert({ id: 1 });
  await supabase.storage.from("avatars").upload("a.png", new Blob());
  return Buffer.from("x");
}

export async function action() {
  return new Response(null, { status: 302, headers: { Location: "/" } });
}

import { createFileRoute } from '@tanstack/react-router';
// a TanStack Start API route: server handlers, no component, so not a page
export const Route = createFileRoute('/api/auth/$')({
  server: { handlers: { GET: ({ request }: { request: Request }) => new Response(request.url) } },
});

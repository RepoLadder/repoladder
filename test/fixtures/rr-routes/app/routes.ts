import { type RouteConfig, index, layout, prefix, route } from "@react-router/dev/routes";
export default [
  index("page.tsx"),
  route("/api/mailto-handler", "mailto-handler.ts"),
  layout("(routes)/layout.tsx", prefix("/mail", [
    index("(routes)/mail/page.tsx"),
    route(":folder", "(routes)/mail/[folder]/page.tsx"),
  ])),
  ...prefix("/api", [route("info", "routes/api/info.ts")]),
  // route("/old", "routes/old.tsx"),
  route("/*", "meta-files/not-found.tsx"),
] satisfies RouteConfig;

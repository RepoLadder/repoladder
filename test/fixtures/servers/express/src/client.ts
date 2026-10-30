export const user = () => fetch("/api/users/42");
export const avatar = () => fetch("/api/users/42/avatar", { method: "PUT" });
export const live = () => fetch("https://example.com/health/live");

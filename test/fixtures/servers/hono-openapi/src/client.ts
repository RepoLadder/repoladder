export const one = (id: string) => fetch(`/api/tasks/${id}`);
export const all = () => fetch("/api/tasks");

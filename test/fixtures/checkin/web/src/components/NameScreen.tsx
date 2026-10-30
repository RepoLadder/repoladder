import { Thanks } from "./Thanks";

export const NameScreen = (done: (name: string) => unknown) => ({ done, next: Thanks });

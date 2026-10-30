import { addToCart, fetchUser } from "../lib";
import type { Props } from "./types";
export function Button(_: Props) { addToCart(); fetchUser(); return null; }

import { Button } from "@/components/Button";
import * as lib from "@/lib";
import { missing } from "./nope";
export default function Home() { return Button({ label: String(lib) + missing }); }

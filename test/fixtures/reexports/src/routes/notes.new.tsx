import { make } from "../lib";

export { action } from "./+shared/editor.server";

export default function NewNote() {
  return make();
}

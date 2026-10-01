import defaultExport, { a, b as c } from "./mod.mjs";
export { a, c };
export { x } from "./outro.mjs";
export default function principal() {
  return defaultExport();
}

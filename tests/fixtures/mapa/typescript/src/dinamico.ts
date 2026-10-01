// @ts-nocheck
export function perigos(nome: string, obj: Record<string, () => void>) {
  eval("1 + 1");
  const f = new Function("a", "return a");
  const m = require(nome);
  const k = import(nome);
  obj[nome]();
  const ok = require("fs");
  const dyn = import("./lazy");
  return [f, m, k, ok, dyn];
}

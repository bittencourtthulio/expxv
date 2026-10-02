// T-22.07 / AX-01: o relay é CEGO. Sentinelas em UTF-8, base64, hex e JSON-escapada plantadas em todo quadro; nenhum byte guardado, logado, medido ou exposto pode contê-las.
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canalAleatorio, handshake, novoRoteador, parChave } from "../../../tests/fixtures/relay/cenarios";

const SENT = "SENTINELA-É-do-CELULAR:apague-tudo-ç∂ƒ-" + randomBytes(6).toString("hex");
const codificacoes = (s: string): string[] => {
  const u = Buffer.from(s, "utf8");
  return [s, u.toString("base64"), u.toString("hex"), JSON.stringify(s).slice(1, -1), Buffer.from(JSON.stringify(s)).toString("base64"), encodeURIComponent(s), u.toString("base64url"), Buffer.from(s, "utf16le").toString("hex")];
};
/** percorre o estado interno REAL: strings, buffers, mapas, objetos; devolve tudo como texto em várias formas. */
function achatar(x: unknown, saida: string[], vistos = new Set<unknown>()): void {
  if (x === null || x === undefined || vistos.has(x)) return;
  if (typeof x === "string") return void saida.push(x);
  if (typeof x === "number" || typeof x === "boolean" || typeof x === "bigint") return void saida.push(String(x));
  if (ArrayBuffer.isView(x) || x instanceof ArrayBuffer) {
    const b = x instanceof ArrayBuffer ? Buffer.from(x) : Buffer.from(x.buffer, x.byteOffset, x.byteLength);
    saida.push(b.toString("latin1"), b.toString("utf8"), b.toString("hex"), b.toString("base64"));
    return;
  }
  if (typeof x !== "object") return;
  vistos.add(x);
  if (x instanceof Map) for (const [k, v] of x) (achatar(k, saida, vistos), achatar(v, saida, vistos));
  else if (x instanceof Set) for (const v of x) achatar(v, saida, vistos);
  else for (const [k, v] of Object.entries(x)) (saida.push(k), achatar(v, saida, vistos));
}

describe("ax01_relay_nunca_ve_texto_claro", () => {
  it("com sentinelas em todo quadro, o estado interno, as métricas e o log não contêm nenhuma codificação", () => {
    const logs: string[] = [];
    const { r } = novoRoteador({ log: (e) => logs.push(e) });
    const canal = canalAleatorio();
    const host = parChave();
    const cli = parChave();
    handshake(r, "h", { papel: "host", canal, par: host, cli: cli.pub });
    handshake(r, "c", { papel: "cliente", canal, par: cli });
    const quadros = codificacoes(SENT).map((s) => Buffer.from(s, "utf8"));
    quadros.push(Buffer.concat([randomBytes(20), Buffer.from(SENT), randomBytes(20)]));
    let entregues = 0;
    for (const q of quadros) for (const de of ["c", "h"]) entregues += r.binario(de, q).length;
    expect(entregues).toBe(quadros.length * 2); // repasse aconteceu...
    // ...mas nada ficou: estado interno real, métricas e log
    const tudo: string[] = [];
    achatar(r.inspecionar(), tudo);
    achatar(r.metricas(), tudo);
    achatar(logs, tudo);
    const alvo = tudo.join("\u0001");
    expect(alvo.length).toBeGreaterThan(50);
    for (const cod of codificacoes(SENT)) expect(alvo, cod).not.toContain(cod);
    expect(alvo).not.toContain("SENTINELA");
    expect(alvo).not.toContain(Buffer.from("SENTINELA").toString("hex"));
    expect(alvo).not.toContain(Buffer.from("SENTINELA").toString("base64").slice(0, 8));
    // métricas só têm contadores
    expect(Object.keys(r.metricas()).sort()).toEqual(["bytes_repassados", "canais", "conexoes", "descartes", "limites", "quadros_repassados", "recusas"]);
    // log só tem códigos nominais
    for (const l of logs) expect(l).toMatch(/^[a-z_]+$/);
  });
  it("o repasse não copia nem altera o quadro (mesma referência), então o relay nunca produz nem guarda outra cópia", () => {
    const { r } = novoRoteador();
    const canal = canalAleatorio();
    const k = parChave();
    handshake(r, "h", { papel: "host", canal, par: k });
    handshake(r, "c", { papel: "cliente", canal, par: parChave() });
    const q = Buffer.from(SENT);
    const [a] = r.binario("c", q);
    expect(a && a.k === "bin" && a.dados === q).toBe(true);
  });
});

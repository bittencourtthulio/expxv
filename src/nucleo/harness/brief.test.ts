import { describe, expect, it } from "vitest";
import { criarScrubber } from "../cofre/scrubber";
import { PRODUTO } from "../produto";
import { INTERVALO_CHECKPOINT_MS, TETO_BYTES_CHECKPOINT, criarCheckpointer, instrucaoDeRetomada, montarBrief, montarCheckpoint, type EntradaCheckpoint } from "./brief";

const SEGREDO = "SENTINELA-COFRE-9f3a7c1d2b-valor";
const entrada = (extra: Partial<EntradaCheckpoint> = {}): EntradaCheckpoint => ({
  task_ref: "t-3",
  titulo: "Arrumar o botão",
  branch: "feat/botao",
  status_curto: [" M src/a.ts", "?? src/b.ts"],
  ultimas_linhas: ["rodando testes", "tudo verde"],
  em: "2026-10-01T10:00:00.000Z",
  ...extra,
});
const scrubber = (): ((t: string) => string) => {
  const s = criarScrubber();
  s.adicionar("CHAVE", SEGREDO);
  return (t) => s.scrub(t);
};

describe("montarCheckpoint", () => {
  it("traz card, branch, status e fim da tela", () => {
    const t = montarCheckpoint(entrada());
    expect(t).toContain("t-3");
    expect(t).toContain("feat/botao");
    expect(t).toContain(" M src/a.ts");
    expect(t).toContain("tudo verde");
  });

  it("limita a 40 linhas de status e 60 de tela", () => {
    const t = montarCheckpoint(entrada({ status_curto: Array.from({ length: 80 }, (_, i) => ` M f${i}.ts`), ultimas_linhas: Array.from({ length: 200 }, (_, i) => `linha ${i}`) }));
    expect(t).toContain(" M f39.ts");
    expect(t).not.toContain(" M f40.ts");
    expect(t).toContain("linha 199");
    expect(t).not.toContain("linha 139\n");
    expect(t).toContain("linha 140");
  });

  it("nunca contém o valor do cofre (nem em variante)", () => {
    const t = montarCheckpoint(entrada({ ultimas_linhas: [`export KEY=${SEGREDO}`, `b64 ${Buffer.from(SEGREDO).toString("base64")}`] }), scrubber());
    expect(t).not.toContain(SEGREDO);
    expect(t).not.toContain(Buffer.from(SEGREDO).toString("base64"));
    expect(t).toContain("«cofre:CHAVE»");
  });

  it("respeita 16 KB mesmo com tela enorme e sem partir caractere", () => {
    const t = montarCheckpoint(entrada({ ultimas_linhas: Array.from({ length: 60 }, () => "é".repeat(390)) }));
    expect(Buffer.byteLength(t, "utf8")).toBeLessThanOrEqual(TETO_BYTES_CHECKPOINT);
    expect(t).not.toContain("�");
  });

  it("remove sequências de escape da tela", () => {
    const t = montarCheckpoint(entrada({ ultimas_linhas: ["\u001b[31mvermelho\u001b[0m"] }));
    expect(t).toContain("vermelho");
    expect(t).not.toContain("\u001b");
  });
});

describe("montarBrief", () => {
  const base = { de: { provedor: "claude", modelo: null, conta: "Pessoal" }, para: { provedor: "claude", modelo: null, conta: "Trabalho" }, recibo: "Troca feita: consumo 90%.", card: { task_ref: "t-3", titulo: "Botão", briefing_path: `${PRODUTO.pastaNoProjeto}/missoes/m1/briefing-t-3.md` }, em: "2026-10-01T10:00:00.000Z" };

  it("avisa que o pensamento anterior se perdeu e inclui o checkpoint", () => {
    const b = montarBrief({ ...base, checkpoint: montarCheckpoint(entrada()) });
    expect(b).toMatch(/não foi preservado/);
    expect(b).toContain("feat/botao");
    expect(b).toContain("briefing-t-3.md");
  });

  it("sem checkpoint orienta conferir o worktree; e passa pelo scrubber", () => {
    const b = montarBrief({ ...base, recibo: `chave ${SEGREDO}`, checkpoint: null }, scrubber());
    expect(b).toContain("nenhum checkpoint");
    expect(b).not.toContain(SEGREDO);
  });

  it("instrução de retomada cita o caminho", () => {
    const caminho = `${PRODUTO.pastaNoProjeto}/x.md`;
    expect(instrucaoDeRetomada(caminho)).toContain(caminho);
  });
});

describe("criarCheckpointer", () => {
  function montar() {
    let t = 1_000_000;
    const gravados: Array<[string, string]> = [];
    const c = criarCheckpointer({
      agora: () => t,
      coletar: async () => entrada(),
      gravar: async (p, texto) => void gravados.push([p, texto]),
      scrub: async () => scrubber(),
    });
    return { c, gravados, avancar: (ms: number) => (t += ms) };
  }

  it("grava no máximo 1 vez por 30 s por Pane", async () => {
    const { c, gravados, avancar } = montar();
    expect(await c.aoFimDoTurno("p1")).toBe("gravado");
    avancar(10_000);
    expect(await c.aoFimDoTurno("p1")).toBe("limitado");
    expect(await c.aoFimDoTurno("p2")).toBe("gravado");
    avancar(INTERVALO_CHECKPOINT_MS);
    expect(await c.aoFimDoTurno("p1")).toBe("gravado");
    expect(gravados.map(([p]) => p)).toEqual(["p1", "p2", "p1"]);
  });

  it("falha ao gravar não lança; sem o que registrar devolve vazio", async () => {
    const c = criarCheckpointer({ agora: () => 1, coletar: async () => entrada(), gravar: async () => Promise.reject(new Error("disco")), scrub: async () => (t) => t });
    expect(await c.aoFimDoTurno("p")).toBe("falhou");
    const v = criarCheckpointer({ agora: () => 1, coletar: async () => null, gravar: async () => undefined, scrub: async () => (t) => t });
    expect(await v.aoFimDoTurno("p")).toBe("vazio");
  });
});

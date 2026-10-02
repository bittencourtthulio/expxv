// Módulos da suíte desligados (D-480) no Maestro: o pipeline que usa uma skill desligada vira INDISPONÍVEL ("ative o módulo X"), o pedido de agente é recusado com
// `module_disabled` e a confirmação do humano também. Etapa de consulta (memox) de módulo desligado só é dispensada.
import { describe, expect, it } from "vitest";
import { criarMundo, WS } from "../../../tests/fixtures/maestro/mundo";
import type { PedidoMaestro } from "../../compartilhado/maestro";
import { erroMcpDoMaestro } from "./mcp";
import { planejar, type ConfigDePlano, type EntradaDePlano } from "./planejar";
import { EVIDENCIA_VAZIA } from "./rigidez/plano-de-etapas";
import { MaestroErro } from "./servico";

const AGORA = Date.parse("2026-10-01T12:00:00.000Z");
const cfg = (o: Partial<ConfigDePlano> = {}): ConfigDePlano => ({ id: "mpl_1", agora_ms: AGORA, evidencia: EVIDENCIA_VAZIA, ...o });
const ent = (intencao: EntradaDePlano["intencao"]): EntradaDePlano => ({ intencao, confianca: 0.9, candidatas: [{ intencao, confianca: 0.9 }], retomar: null, fonte: "regra" });
const off = (...m: string[]): ReadonlySet<string> => new Set(m);
const ativas = (p: ReturnType<typeof planejar>): string[] => p.etapas.filter((e) => e.estado_inicial !== "pulada_nivel" && e.estado_inicial !== "pulada_usuario").map((e) => e.etapa_id);

describe("planejar com módulos desligados", () => {
  it("sem módulo desligado nada muda (o plano de bug usa runx e mergex)", () => {
    const p = planejar(ent("bug"), 3, cfg({ modulos_desligados: off() }));
    expect(p.modulos_desligados).toBeUndefined();
    expect(ativas(p)).toContain("runx.e1");
  });

  const TABELA: ReadonlyArray<[string, EntradaDePlano["intencao"], string[], string[]]> = [
    ["bug com o runx desligado", "bug", ["runx"], ["runx"]],
    ["feature com o sprintx desligado", "feature", ["sprintx"], ["sprintx"]],
    ["bug com o mergex desligado (o pipeline passa pela entrega)", "bug", ["mergex"], ["mergex"]],
    ["pedido com o prodx desligado", "pedido", ["prodx"], ["prodx"]],
    ["projeto com o buildx desligado", "projeto", ["buildx"], ["buildx"]],
    ["refatoração com o legadox desligado (usa o raio)", "refatoracao", ["legadox"], ["legadox"]],
    ["bug com runx e mergex desligados cita os dois", "bug", ["runx", "mergex"], ["runx", "mergex"]],
  ];
  it.each(TABELA)("%s → indisponível, com o módulo a ativar", (_n, intencao, desligados, citados) => {
    const p = planejar(ent(intencao), 3, cfg({ modulos_desligados: off(...desligados), evidencia: { ...EVIDENCIA_VAZIA, legado: true } }));
    expect(p.modulos_desligados).toEqual(expect.arrayContaining(citados));
    expect(p.executar_direto).toBe(false);
    expect(p.avisos.join(" ")).toMatch(/desligad.*ative em Método › Módulos da suíte/);
  });

  it("memox desligado: a consulta é só dispensada (o plano segue disponível)", () => {
    const p = planejar(ent("bug"), 3, cfg({ modulos_desligados: off("memox") }));
    expect(p.modulos_desligados).toBeUndefined();
    const consulta = p.etapas.find((e) => e.etapa_id === "memox.consultar");
    expect(consulta).toMatchObject({ estado_inicial: "pulada_usuario" });
    expect(consulta?.motivo).toMatch(/memox está desligado/);
  });

  it("nível 1 (rápido) não usa skill de módulo: continua disponível mesmo com o sprintx desligado", () => {
    const p = planejar(ent("feature"), 1, cfg({ modulos_desligados: off("sprintx") }));
    expect(p.pipeline_id).toBe("rapido");
    expect(p.modulos_desligados).toBeUndefined();
  });

  it("executar direto nunca vale para plano indisponível", () => {
    const p = planejar(ent("bug"), 3, cfg({ modulos_desligados: off("runx"), executar_direto_permitido: true }));
    expect(p.executar_direto).toBe(false);
  });
});

describe("servico do Maestro com módulo desligado", () => {
  const pedidoDe = (texto: string, o: Partial<PedidoMaestro> = {}): PedidoMaestro => ({ workspace_id: WS, texto, contexto: null, via: "api", nivel_pedido: null, executar_direto: null, ...o });
  const TEXTO_BUG = "corrige, estou com um problema no login: o botão de entrar não funciona";

  it.each(["mcp", "hook", "squad", "api"] as const)("pedido de AGENTE (%s) com o runx desligado é recusado com module_disabled, sem plano gravado nem Pane", async (via) => {
    const m = criarMundo();
    m.portas.modulosDesligados = () => off("runx");
    await expect(m.servico.pedir(pedidoDe(TEXTO_BUG, { via }))).rejects.toMatchObject({ codigo: "module_disabled" });
    expect(m.persistencia.todos()).toEqual([]);
    expect(m.panes.size).toBe(0);
  });

  it("o humano (paleta/chat) vê o plano INDISPONÍVEL; confirmar é recusado enquanto o módulo estiver desligado e funciona depois de ligado", async () => {
    const m = criarMundo();
    let desligados = off("runx");
    m.portas.modulosDesligados = () => desligados;
    const { plano } = await m.servico.pedir(pedidoDe(TEXTO_BUG, { via: "paleta" }));
    expect(plano.modulos_desligados).toEqual(["runx"]);
    expect(plano.avisos.join(" ")).toMatch(/runx.*desligado/);
    await expect(m.servico.confirmar(plano.id)).rejects.toMatchObject({ codigo: "module_disabled" });
    expect(m.panes.size).toBe(0);
    desligados = off();
    await expect(m.servico.confirmar(plano.id)).resolves.toBeDefined();
    expect(m.panes.size).toBeGreaterThan(0);
  });

  it("sem módulo desligado o fluxo é o de sempre (uma tool de agente passa)", async () => {
    const m = criarMundo();
    m.portas.modulosDesligados = () => off("legadox");
    const { plano } = await m.servico.pedir(pedidoDe(TEXTO_BUG, { via: "mcp" }));
    expect(plano.modulos_desligados).toBeUndefined();
  });

  it("uma porta que lança não derruba o pedido (vale como nenhum módulo desligado)", async () => {
    const m = criarMundo();
    m.portas.modulosDesligados = () => { throw new Error("falhou"); };
    const { plano } = await m.servico.pedir(pedidoDe(TEXTO_BUG, { via: "mcp" }));
    expect(plano.intencao).toBe("bug");
  });
});

describe("tool maestro_request", () => {
  it("module_disabled vira rule_violation/module_disabled, com texto que manda avisar o usuário e não contornar", () => {
    const e = erroMcpDoMaestro(new MaestroErro("module_disabled", "módulo desligado neste projeto: runx"));
    expect(e).toMatchObject({ code: "rule_violation", subcode: "module_disabled" });
    expect(e.message).toMatch(/desligado neste projeto.*Módulos da suíte.*não tente contornar/);
  });
});

import { describe, expect, it } from "vitest";
import type { MissaoInfo, PaneInfo, ProvedorInfo } from "../mcp/portas";
import { ErroMcp } from "../mcp/erros";
import { PRODUTO } from "../produto";
import { guardaDoPiloto, verificarConclusao, verificarFechamento, verificarSpawn, type EntradaSpawn } from "./regras";

const provedores: ProvedorInfo[] = [
  { provedor: "claude", cli: "claude", contas: [], habilitado: true },
  { provedor: "codex", cli: "codex", contas: [], habilitado: true },
  { provedor: "gemini", cli: "gemini", contas: [], habilitado: false },
];
const missao = (p: Partial<MissaoInfo> = {}): MissaoInfo => ({
  mission_id: "mis_1", workspace_id: "ws_1", modo: "agentico", estado: "executando", titulo: "t", piloto_pane_id: "pane_p",
  portoes_liberados: ["direction", "content", "build", "qa"], agentes_do_squad: null, ...p,
});
const pane = (id: string, p: Partial<PaneInfo> = {}): PaneInfo => ({
  pane_id: id, workspace_id: "ws_1", mission_id: "mis_1", provedor: "claude", papel: "executor", estado: "trabalhando", task_id: null, eh_piloto: false, ...p,
});
const entrada = (p: Partial<EntradaSpawn> = {}): EntradaSpawn => ({
  chamador: { pane_id: "pane_p", papel: "piloto", modo: "agentico" },
  missao: missao(), papel_pedido: "executor", agente_id: null, provedor: "claude", provedores, panes_vivos: [pane("pane_p", { eh_piloto: true, papel: "piloto" })], ...p,
});
const erro = (f: () => unknown): ErroMcp => {
  try { f(); } catch (e) { return e as ErroMcp; }
  throw new Error("não lançou");
};

describe("verificarSpawn: uma tabela de casos por regra", () => {
  const casos: Array<[string, Partial<EntradaSpawn>, string, string | undefined]> = [
    ["gate build pendente para executor", { missao: missao({ portoes_liberados: ["direction"] }) }, "rule_violation", "gate_pending"],
    ["gate direction pendente para explorador", { papel_pedido: "explorador", missao: missao({ portoes_liberados: [] }) }, "rule_violation", "gate_pending"],
    ["gate qa pendente para revisor", { papel_pedido: "revisor", missao: missao({ portoes_liberados: ["direction", "content", "build"] }) }, "rule_violation", "gate_pending"],
    ["sem Missão em modo agêntico", { missao: null }, "rule_violation", "not_in_mission"],
    ["Missão encerrada", { missao: missao({ estado: "concluida" }) }, "conflict", undefined],
    ["worker tentando abrir worker", { chamador: { pane_id: "pane_w", papel: "executor", modo: "agentico" } }, "rule_violation", "forbidden_role"],
    ["piloto pedindo orquestrador", { papel_pedido: "piloto" }, "rule_violation", "forbidden_role"],
    ["agente fora do squad", { missao: missao({ agentes_do_squad: [{ agente_id: "a1", papel: "executor" }] }), agente_id: "zz" }, "rule_violation", "forbidden_role"],
    ["agente orquestrador do squad", { missao: missao({ agentes_do_squad: [{ agente_id: "orq", papel: "piloto" }] }), agente_id: "orq", papel_pedido: null }, "rule_violation", "forbidden_role"],
    ["agente com outro papel", { missao: missao({ agentes_do_squad: [{ agente_id: "a1", papel: "revisor" }] }), agente_id: "a1", papel_pedido: "executor" }, "rule_violation", "forbidden_role"],
    ["squad sem lista de agentes recusa agent_id", { chamador: { pane_id: "pane_p", papel: "piloto", modo: "squad" }, missao: missao({ modo: "squad" }), agente_id: "a1" }, "rule_violation", "forbidden_role"],
    ["limite de 8 workers", { panes_vivos: Array.from({ length: 8 }, (_, i) => pane(`w${i}`)) }, "rule_violation", "limit_reached"],
    ["provedor desabilitado", { provedor: "gemini" }, "rule_violation", "provider_disabled"],
    ["provedor inexistente", { provedor: "nada" }, "rule_violation", "provider_disabled"],
  ];
  it.each(casos)("%s", (_nome, parcial, code, subcode) => {
    const e = erro(() => verificarSpawn(entrada(parcial)));
    expect(e.code).toBe(code);
    expect(e.subcode).toBe(subcode);
  });

  it("8 workers ainda cabem (o limite é o 9º) e o piloto não conta", () => {
    const vivos = [pane("pane_p", { eh_piloto: true, papel: "piloto" }), ...Array.from({ length: 7 }, (_, i) => pane(`w${i}`))];
    expect(verificarSpawn(entrada({ panes_vivos: vivos })).papel).toBe("executor");
  });

  it("ordem das validações: gate antes de papel, papel antes de limite, limite antes de provedor", () => {
    const tudoErrado = entrada({
      missao: missao({ portoes_liberados: [] }),
      chamador: { pane_id: "w", papel: "executor", modo: "agentico" },
      panes_vivos: Array.from({ length: 8 }, (_, i) => pane(`w${i}`)),
      provedor: "gemini",
    });
    expect(erro(() => verificarSpawn(tudoErrado)).subcode).toBe("gate_pending");
    expect(erro(() => verificarSpawn({ ...tudoErrado, missao: missao() })).subcode).toBe("forbidden_role");
    expect(erro(() => verificarSpawn({ ...tudoErrado, missao: missao(), chamador: { pane_id: "pane_p", papel: "piloto", modo: "agentico" } })).subcode).toBe("limit_reached");
    expect(erro(() => verificarSpawn({ ...tudoErrado, missao: missao(), chamador: { pane_id: "pane_p", papel: "piloto", modo: "agentico" }, panes_vivos: [] })).subcode).toBe("provider_disabled");
  });

  it("agente do squad define o papel quando o pedido não traz", () => {
    const r = verificarSpawn(entrada({ missao: missao({ agentes_do_squad: [{ agente_id: "rev", papel: "revisor" }] }), agente_id: "rev", papel_pedido: null }));
    expect(r.papel).toBe("revisor");
  });

  it("livre: sem portões, qualquer Pane de fora de Missão abre workers", () => {
    const r = verificarSpawn(entrada({ missao: null, chamador: { pane_id: "p", papel: "nenhum", modo: "livre" } }));
    expect(r.papel).toBe("executor");
  });

  it("revisor do mesmo provedor do executor gera AVISO (não erro) quando há alternativa", () => {
    const r = verificarSpawn(entrada({ papel_pedido: "revisor", provedor: "claude", panes_vivos: [pane("pane_p", { eh_piloto: true, papel: "piloto" }), pane("w1", { provedor: "claude" })] }));
    expect(r.avisos).toHaveLength(1);
    const sem = verificarSpawn(entrada({ papel_pedido: "revisor", provedor: "codex", panes_vivos: [pane("w1", { provedor: "claude" })] }));
    expect(sem.avisos).toHaveLength(0);
  });
});

describe("verificarConclusao e verificarFechamento", () => {
  it("exige revisor ok, piloto e Missão", () => {
    expect(erro(() => verificarConclusao({ papel: "piloto", missao: missao(), revisor_ok: false })).subcode).toBe("reviewer_required");
    expect(erro(() => verificarConclusao({ papel: "executor", missao: missao(), revisor_ok: true })).subcode).toBe("forbidden_role");
    expect(erro(() => verificarConclusao({ papel: "piloto", missao: null, revisor_ok: true })).subcode).toBe("not_in_mission");
    expect(() => verificarConclusao({ papel: "piloto", missao: missao(), revisor_ok: true })).not.toThrow();
  });
  it("o piloto não é fechado", () => {
    expect(erro(() => verificarFechamento({ chamador: { pane_id: "x", papel: "piloto" }, alvo: pane("pane_p", { eh_piloto: true }) })).subcode).toBe("forbidden_role");
    expect(() => verificarFechamento({ chamador: { pane_id: "pane_p", papel: "piloto" }, alvo: pane("w1") })).not.toThrow();
  });
});

describe("guarda anti-piloto-que-codifica", () => {
  const raiz = "/ws/projeto";
  const g = (ferramenta: string, caminho: unknown, cwd: string | null = null) => guardaDoPiloto({ raiz, cwd, ferramenta, entrada: { file_path: caminho } });
  it("bloqueia escrita em src/ e em qualquer lugar fora da pasta do produto", () => {
    for (const f of ["Edit", "Write", "MultiEdit", "NotebookEdit"]) {
      expect(g(f, "/ws/projeto/src/app.ts").permitido).toBe(false);
      expect(g(f, "src/app.ts").permitido).toBe(false);
    }
    expect(g("Write", "/etc/passwd").permitido).toBe(false);
    expect(g("Write", "/ws/projeto/docs/x.md").permitido).toBe(false);
  });
  it("permite gravar dentro da pasta do produto", () => {
    expect(g("Write", `/ws/projeto/${PRODUTO.pastaNoProjeto}/missoes/m/briefing-t.md`).permitido).toBe(true);
    expect(g("Edit", `${PRODUTO.pastaNoProjeto}/missoes/x.md`).permitido).toBe(true);
  });
  it("traversal e caminhos estranhos são bloqueados", () => {
    expect(g("Write", `${PRODUTO.pastaNoProjeto}/../src/a.ts`).permitido).toBe(false);
    expect(g("Write", `/ws/projeto/${PRODUTO.pastaNoProjeto}-fake/a.md`).permitido).toBe(false);
    expect(g("Write", "").permitido).toBe(false);
    expect(g("Write", 42).permitido).toBe(false);
    expect(g("Write", "a\0b").permitido).toBe(false);
  });
  it("relativo respeita o cwd informado pelo hook", () => {
    expect(g("Write", "a.md", `/ws/projeto/${PRODUTO.pastaNoProjeto}`).permitido).toBe(true);
    expect(g("Write", "a.md", "/ws/projeto/src").permitido).toBe(false);
  });
  it("ferramentas de leitura passam", () => {
    expect(g("Read", "/ws/projeto/src/app.ts").permitido).toBe(true);
    expect(g("Bash", null).permitido).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { criarRepoMemoria, RETENCAO_LOG_POR_SERVIDOR, type RegistroInstalado } from "./repositorio";

const inst = (id: string, extra: Partial<RegistroInstalado> = {}): RegistroInstalado => ({
  servidor_id: id, versao: "1.0.0", metodo: "npm", estado: "instalado", nivel_verificacao: "padrao", integridade: null, pasta_rel: `mcp/${id}`,
  comando_hash: "h", seed_versao: "s", erro_codigo: null, instalado_em: "2026-10-01T00:00:00.000Z", atualizado_em: "2026-10-01T00:00:00.000Z", ...extra,
});

describe("repositório em memória da Loja", () => {
  it("upsert idempotente e cópia defensiva", () => {
    const r = criarRepoMemoria();
    r.gravarInstalado(inst("a")); r.gravarInstalado(inst("a", { versao: "2.0.0" }));
    expect(r.listarInstalados()).toHaveLength(1);
    const lido = r.obterInstalado("a")!; lido.versao = "x";
    expect(r.obterInstalado("a")!.versao).toBe("2.0.0");
    expect(r.obterInstalado("nao")).toBeNull();
  });

  it("habilitação: upsert por (servidor, alvo) mantém o id; sem linha = nada", () => {
    const r = criarRepoMemoria();
    const a = r.habilitar({ servidor_id: "a", alvo_tipo: "workspace", alvo_valor: "w1", habilitado: true, atualizado_em: "t1" });
    const b = r.habilitar({ servidor_id: "a", alvo_tipo: "workspace", alvo_valor: "w1", habilitado: false, atualizado_em: "t2" });
    expect(b.id).toBe(a.id);
    expect(r.listarHabilitacoes({ servidor_id: "a" })).toHaveLength(1);
    expect(r.listarHabilitacoes({ servidor_id: "a" })[0]!.habilitado).toBe(false);
    expect(r.listarHabilitacoes({ servidor_id: "outro" })).toEqual([]);
  });

  it("removerServidor leva junto variáveis, habilitações, saúde, ferramentas e CLI, mas MANTÉM a auditoria de consentimento", () => {
    const r = criarRepoMemoria();
    r.gravarInstalado(inst("a")); r.gravarInstalado(inst("b"));
    r.gravarConsentimento({ id: "c1", servidor_id: "a", versao: "1", comando_hash: "h", permissoes_json: "{}", origem: "loja", aceito_em: "t" });
    r.gravarVariavel({ servidor_id: "a", nome: "X", definida: true, atualizada_em: "t" });
    r.habilitar({ servidor_id: "a", alvo_tipo: "agente", alvo_valor: "ag", habilitado: true, atualizado_em: "t" });
    r.salvarSaude({ servidor_id: "a", estado: "ok", testado_em: "t", latencia_ms: 1, n_ferramentas: 1, erro_codigo: null });
    r.substituirFerramentas("a", [{ nome: "t", descricao: null }], "t");
    r.cliInstalacaoGravar({ servidor_id: "a", cli: "claude", nome_na_cli: "ev_a", escopo: "user", criado_em: "t" });
    r.removerServidor("a");
    expect(r.obterInstalado("a")).toBeNull();
    expect(r.variaveisDe("a")).toEqual([]);
    expect(r.listarHabilitacoes({ servidor_id: "a" })).toEqual([]);
    expect(r.obterSaude("a")).toBeNull();
    expect(r.ferramentasDe("a")).toEqual([]);
    expect(r.cliInstalacoesDe("a")).toEqual([]);
    expect(r.consentimentosDe("a")).toHaveLength(1);
    expect(r.obterInstalado("b")).not.toBeNull();
  });

  it("retenção de log: o 201º evento descarta o mais antigo; detalhe ≤ 1 KB; poda por data", () => {
    const r = criarRepoMemoria();
    for (let i = 0; i < RETENCAO_LOG_POR_SERVIDOR + 1; i++) r.registrarLog({ servidor_id: "a", nivel: "info", evento: `e${i}`, detalhe_json: "x".repeat(2000), em: `2026-10-01T00:00:${String(i % 60).padStart(2, "0")}.${String(i).padStart(3, "0")}Z` });
    const todos = r.logsDe("a", 1000);
    expect(todos).toHaveLength(RETENCAO_LOG_POR_SERVIDOR);
    expect(todos.some((l) => l.evento === "e0")).toBe(false);
    expect(todos[0]!.evento).toBe(`e${RETENCAO_LOG_POR_SERVIDOR}`);
    expect(todos[0]!.detalhe_json.length).toBe(1024);
    r.registrarLog({ servidor_id: "b", nivel: "info", evento: "b", detalhe_json: "{}", em: "2026-10-01T00:00:00.000Z" });
    expect(r.logsDe("b")).toHaveLength(1);
    expect(r.podarLogs("2030-01-01")).toBeGreaterThan(0);
    expect(r.logsDe("a", 10)).toEqual([]);
  });

  it("opt-out do Kit", () => {
    const r = criarRepoMemoria();
    expect(r.kitOptOut()).toBe(false);
    r.definirKitOptOut(true, "t");
    expect(r.kitOptOut()).toBe(true);
  });
});

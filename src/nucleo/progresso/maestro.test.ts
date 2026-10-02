// Derivador (a): pipeline do Maestro -> Progresso. Tabela etapas × estados × portão humano.
import { describe, expect, it } from "vitest";
import type { EstadoEtapa, EstadoPipeline } from "../../compartilhado/maestro";
import { derivarDoMaestro, resultadoDoPipeline, type PipelineParaProgresso } from "./maestro";
import { contagem } from "./formato";

type Exec = PipelineParaProgresso["execs"][number];
const ETAPAS = ["sprintx.f1", "sprintx.f2", "sprintx.f3", "sprintx.f4", "sprintx.f5"] as const;

function exec(etapa: string, estado: EstadoEtapa, extra: Partial<Exec> = {}): Exec {
  return { etapa_id: etapa as Exec["etapa_id"], ordem: 0, tentativa: 1, rodada: 1, estado, pane_id: null, inicio_em: "2026-10-01T10:00:00.000Z", fim_em: null, detalhe: null, ...extra };
}
function pipeline(estado: EstadoPipeline, execs: Exec[], extra: Partial<PipelineParaProgresso> = {}): PipelineParaProgresso {
  return {
    id: "mpl_AAAA1111", workspace_id: "ws_1", trabalho_id: null, pipeline_id: "sprintx", estado, texto_resumo: "Adicionar frete grátis",
    plano: { etapas: ETAPAS.map((e, i) => ({ etapa_id: e, ordem: i + 1, estado_inicial: "pendente" as const, tipo: "planejador" as const })) },
    execs, motivo_fim: null, criado_em: "2026-10-01T09:59:00.000Z", concluido_em: null, ...extra,
  };
}
const estados = (p: ReturnType<typeof derivarDoMaestro>): string[] => (p?.itens ?? []).map((i) => i.estado);

describe("derivarDoMaestro", () => {
  it("plano proposto não é progresso", () => expect(derivarDoMaestro(pipeline("proposto", []))).toBeNull());

  it.each<[string, EstadoPipeline, Exec[], string[], string]>([
    ["recém-confirmado", "executando", [], ["pendente", "pendente", "pendente", "pendente", "pendente"], "em_andamento"],
    ["segunda etapa rodando", "executando", [exec("sprintx.f1", "concluida"), exec("sprintx.f2", "executando")], ["concluido", "em_andamento", "pendente", "pendente", "pendente"], "em_andamento"],
    ["despachando conta como em andamento", "executando", [exec("sprintx.f1", "despachando")], ["em_andamento", "pendente", "pendente", "pendente", "pendente"], "em_andamento"],
    ["etapa que pergunta no terminal", "aguardando_usuario", [exec("sprintx.f1", "concluida"), exec("sprintx.f2", "aguardando_usuario")], ["concluido", "aguardando", "pendente", "pendente", "pendente"], "aguardando"],
    ["portão humano", "aguardando_humano", [exec("sprintx.f1", "concluida"), exec("sprintx.f2", "aguardando_humano")], ["concluido", "aguardando", "pendente", "pendente", "pendente"], "aguardando"],
    ["portão humano ainda sem exec: a primeira pendente carrega a espera", "aguardando_humano", [exec("sprintx.f1", "concluida")], ["concluido", "aguardando", "pendente", "pendente", "pendente"], "aguardando"],
    ["etapa falhou", "falhou", [exec("sprintx.f1", "concluida"), exec("sprintx.f2", "falhou")], ["concluido", "falhou", "pendente", "pendente", "pendente"], "falhou"],
    ["pipeline falhou sem etapa marcada: a viva leva a falha", "falhou", [exec("sprintx.f1", "concluida"), exec("sprintx.f2", "executando")], ["concluido", "falhou", "pendente", "pendente", "pendente"], "falhou"],
    ["tudo concluído", "concluido", ETAPAS.map((e) => exec(e, "concluida")), ["concluido", "concluido", "concluido", "concluido", "concluido"], "concluido"],
    ["cancelado", "cancelado", [exec("sprintx.f1", "concluida")], ["concluido", "pendente", "pendente", "pendente", "pendente"], "cancelado"],
    ["pausado marca a etapa viva como aguardando", "pausado", [exec("sprintx.f1", "executando")], ["aguardando", "pendente", "pendente", "pendente", "pendente"], "aguardando"],
    ["sem progresso é espera, não falha", "executando", [exec("sprintx.f1", "sem_progresso")], ["aguardando", "pendente", "pendente", "pendente", "pendente"], "em_andamento"],
  ])("%s", (_nome, estado, execs, esperado, resultado) => {
    const p = derivarDoMaestro(pipeline(estado, execs));
    expect(estados(p)).toEqual(esperado);
    expect(p?.resultado).toBe(resultado);
    expect(p?.concluido).toBe(resultado === "concluido");
    expect(p?.origem).toBe("maestro");
    expect(p?.previsto).toBe(false);
  });

  it("título, pedido redigido e rótulos vêm do catálogo", () => {
    const p = derivarDoMaestro(pipeline("executando", []))!;
    expect(p.titulo).toBe("Pipeline: nova feature");
    expect(p.pedido).toBe("Adicionar frete grátis");
    expect(p.itens.map((i) => i.rotulo)).toEqual(["Base de conhecimento", "Descoberta", "Sprints, fases e tasks", "Orquestrador", "Auditoria do plano"]);
    expect(p.id).toBe("pl:mpl_AAAA1111");
  });

  it("o pedido nunca passa de 60 caracteres", () => {
    const p = derivarDoMaestro(pipeline("executando", [], { texto_resumo: "x".repeat(200) }))!;
    expect(p.pedido!.length).toBeLessThanOrEqual(60);
  });

  it("etapas puladas pelo nível ficam 'pulado' e fora da contagem", () => {
    const base = pipeline("executando", [exec("sprintx.f1", "concluida")]);
    base.plano.etapas = base.plano.etapas.map((e, i) => (i === 3 ? { ...e, estado_inicial: "pulada_nivel" as const } : e));
    const p = derivarDoMaestro(base)!;
    expect(estados(p)[3]).toBe("pulado");
    expect(contagem(p)).toEqual({ feitos: 1, total: 4 });
  });

  it("etapa humana e etapa que pede confirmação trazem a nota, não o estado", () => {
    const base = pipeline("executando", []);
    base.plano.etapas = [
      { etapa_id: "prodx.assinatura", ordem: 1, estado_inicial: "humano", tipo: "humano" },
      { etapa_id: "mergex.pr", ordem: 2, estado_inicial: "confirmar", tipo: "utilitario" },
    ];
    const p = derivarDoMaestro(base)!;
    expect(p.itens.map((i) => [i.estado, i.detalhe])).toEqual([["pendente", "só você"], ["pendente", "pede confirmação"]]);
  });

  it("laço de reprovação: vale a execução de maior rodada e a nota diz a volta", () => {
    const p = derivarDoMaestro(pipeline("executando", [
      exec("sprintx.f3", "reprovada", { rodada: 1 }),
      exec("sprintx.f3", "executando", { rodada: 2 }),
    ]))!;
    expect(p.itens[2]).toMatchObject({ estado: "em_andamento", detalhe: "volta 2" });
  });

  it("tempo medido: desde/fim_em em ms; Pane vira sessao_id só quando conhecido", () => {
    const p = derivarDoMaestro(
      pipeline("executando", [exec("sprintx.f1", "concluida", { pane_id: "pane_1", fim_em: "2026-10-01T10:01:00.000Z" }), exec("sprintx.f2", "executando", { pane_id: "pane_2" })]),
      (pane) => (pane === "pane_2" ? "sess_9" : null),
    )!;
    expect(p.itens[0]).toMatchObject({ desde: Date.parse("2026-10-01T10:00:00.000Z"), fim_em: Date.parse("2026-10-01T10:01:00.000Z") });
    expect(p.itens[0]!.sessao_id).toBeUndefined();
    expect(p.itens[1]!.sessao_id).toBe("sess_9");
    expect(p.itens[2]!.desde).toBeUndefined();
  });

  it("resultadoDoPipeline cobre todos os estados", () => {
    expect(resultadoDoPipeline("bloqueado_piso")).toBe("aguardando");
    expect(resultadoDoPipeline("concluido_parcial")).toBe("concluido");
    expect(resultadoDoPipeline("expirado")).toBe("cancelado");
  });
});

import { describe, expect, it } from "vitest";
import { ev, tk, trab } from "../../../tests/fixtures/metodo/construtores";
import { calcularSinaleira } from "./sinaleira";
import type { Trabalho, Violacao } from "./tipos";

const AGORA = Date.parse("2026-09-29T12:00:00Z");
const recente = "2026-09-29T11:30:00Z";
const antigo = "2026-09-20T11:30:00Z";
const viol = (tipo: Violacao["tipo"]): Violacao => ({ tipo, trabalho_id: "x", alvo: "T-01.01", arquivo: "a", detalhe: "d" });
const andamento = (o: Partial<Trabalho> = {}): Trabalho => trab({ ultima_atividade: recente, ...o }, [tk("T-01.01", { status: "em_andamento" })]);
const cor = (t: Trabalho, eventos = [ev({ ts: recente })]) => calcularSinaleira(t, eventos, AGORA);

describe("sinaleira", () => {
  it("verde: concluído", () => {
    const s = cor(trab({ status: "concluido" }), []);
    expect(s.cor).toBe("verde");
    expect(s.motivo).toMatch(/conclu/i);
  });

  it("verde: em andamento, task em andamento e atividade recente", () => {
    const s = cor(andamento());
    expect(s.cor).toBe("verde");
    expect(s.motivo.length).toBeGreaterThan(0);
  });

  describe("vermelho", () => {
    const bloqueio = { id: "B-01", task: "T-01.01", aberto_em: "2026-09-28", resolvido_em: null, aberto: true, descricao: "sem credencial", arquivo: "a" };
    it.each<[string, Trabalho, ReturnType<typeof ev>[]?]>([
      ["bloqueio aberto", andamento({ bloqueios: [bloqueio] })],
      ["acao_bloqueada recente", andamento(), [ev({ ts: recente, evento: "acao_bloqueada" })]],
      ["portão bloqueado na entrega", andamento({ entrega: { estado: "bloqueado", branch: null, portao: "bloqueado", pr_url: null, pr_estado: null, commits: 0, arquivo: "a" } })],
      ["QA reprovado", andamento({ veredito_qa: "reprovado" })],
      ["ciclo de dependência", andamento({ violacoes: [viol("ciclo_dependencia")] })],
      ["dependência inexistente", andamento({ violacoes: [viol("dependencia_inexistente")] })],
      ["concluída sem verde", andamento({ violacoes: [viol("concluida_sem_verde")] })],
      ["auditoria NÃO com execução em curso", andamento({ veredito_auditoria: "nao" })],
    ])("%s", (_nome, t, eventos) => {
      const s = cor(t, eventos);
      expect(s.cor).toBe("vermelho");
      expect(s.motivo.length).toBeGreaterThan(0);
    });
  });

  describe("amarelo", () => {
    it.each<[string, Trabalho, ReturnType<typeof ev>[] | undefined, RegExp | undefined]>([
      ["auditoria NÃO sem execução ainda", trab({ estagio: "f5", veredito_auditoria: "nao", ultima_atividade: recente }, [tk("T-01.01")]), undefined, /auditoria/i],
      ["prodx com veredito sem assinatura", trab({ ferramenta: "prodx", tipo: "pedido", estagio: "p5", prodx: { veredito: "fazer", assinado: false, briefing: false }, ultima_atividade: recente }, []), undefined, /assin/i],
      ["raio ALTO sem aprovação", andamento({ raio: { faixa: "alto", aprovado: false } }), undefined, /raio/i],
      ["PR aberto aguardando revisão", andamento({ entrega: { estado: "aberto", branch: "b", portao: "pronto", pr_url: "u", pr_estado: "aberto", commits: 1, arquivo: "a" } }), undefined, /revis/i],
      ["decisão pendente (F2)", trab({ estagio: "f2", decisoes_pendentes: 1, ultima_atividade: recente }, []), undefined, /decis/i],
      ["regra_violada recente", andamento(), [ev({ ts: recente }), ev({ ts: recente, evento: "regra_violada" })], /regra/i],
      ["suite vermelha em task", trab({ ultima_atividade: recente }, [tk("T-01.01", { status: "em_andamento", suite: "vermelha" })]), undefined, /suite/i],
      ["task em andamento sem evento há muito tempo", andamento({ ultima_atividade: "2026-09-29T02:00:00Z" }), [ev({ ts: "2026-09-29T02:00:00Z" })], /sem evento|parede/i],
    ])("%s", (_nome, t, eventos, re) => {
      const s = cor(t, eventos);
      expect(s.cor).toBe("amarelo");
      if (re) expect(s.motivo).toMatch(re);
    });

    it("regra_violada antiga (fora da janela) não pesa", () => {
      const s = cor(andamento(), [ev({ ts: recente }), ev({ ts: antigo, evento: "regra_violada" })]);
      expect(s.cor).toBe("verde");
    });
  });

  describe("cinza", () => {
    it("não iniciado", () => {
      const s = cor(trab({ status: "nao_iniciado", estagio: "f4" }, [tk("T-01.01")]), []);
      expect(s.cor).toBe("cinza");
      expect(s.motivo).toMatch(/inici/i);
    });
    it("em andamento mas sem atividade recente", () => {
      const s = cor(trab({ ultima_atividade: antigo }, [tk("T-01.01")]), [ev({ ts: antigo })]);
      expect(s.cor).toBe("cinza");
      expect(s.motivo).toMatch(/atividade/i);
    });
  });

  it("vermelho vence amarelo e todos os motivos são listados, o mais grave primeiro", () => {
    const t = andamento({ veredito_qa: "reprovado", raio: { faixa: "alto", aprovado: false } });
    const s = cor(t);
    expect(s.cor).toBe("vermelho");
    expect(s.motivos).toHaveLength(2);
    expect(s.motivo).toBe(s.motivos[0]);
  });

  it("data sem hora (atualizado_em) conta como atividade do dia", () => {
    const hoje = trab({ ultima_atividade: "2026-09-29" }, [tk("T-01.01", { status: "em_andamento" })]);
    expect(calcularSinaleira(hoje, [], AGORA).cor).toBe("verde");
    const velho = trab({ ultima_atividade: "2026-08-01" }, [tk("T-01.01", { status: "em_andamento" })]);
    expect(calcularSinaleira(velho, [], AGORA).cor).toBe("cinza");
  });

  it("nunca lança e sempre devolve motivo em texto", () => {
    const s = calcularSinaleira(trab({ status: "em_andamento" }, []), [], AGORA);
    expect(["verde", "amarelo", "vermelho", "cinza"]).toContain(s.cor);
    expect(s.motivo.length).toBeGreaterThan(0);
  });
});

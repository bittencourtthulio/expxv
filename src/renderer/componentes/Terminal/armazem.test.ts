import { describe, expect, it, vi } from "vitest";
import { criarArmazem, LIMITE_ARMAZEM } from "./armazem";

const tamanho = (chunks: string[]): number => chunks.reduce((soma, c) => soma + c.length, 0);

describe("T-03.01 armazem de saida com limite", () => {
  it("integracao: passar de 2 MiB descarta chunks do inicio, marca truncado e o replay nao excede o limite", () => {
    const armazem = criarArmazem();
    const bloco = "a".repeat(64 * 1024);
    expect(LIMITE_ARMAZEM).toBe(2 * 1024 * 1024);
    // exatamente no limite: nada descartado, nao truncado
    for (let seq = 1; seq <= 32; seq++) armazem.empurrar("sessao_a1", seq, bloco);
    expect(armazem.truncado("sessao_a1")).toBe(false);
    expect(tamanho(armazem.chunks("sessao_a1"))).toBe(LIMITE_ARMAZEM);
    // um caractere a mais: o primeiro chunk sai, o resto fica em ordem
    const marcador = armazem.empurrar("sessao_a1", 33, "FIM");
    expect(marcador).toEqual({ aceito: true, truncou: true });
    expect(armazem.truncado("sessao_a1")).toBe(true);
    const retidos = armazem.chunks("sessao_a1");
    expect(tamanho(retidos)).toBeLessThanOrEqual(LIMITE_ARMAZEM);
    expect(retidos.at(-1)).toBe("FIM");
    expect(retidos.length).toBe(32); // 33 chunks entraram, o mais antigo saiu
    // muito acima do limite: o replay continua dentro do limite e termina no dado mais novo
    for (let seq = 34; seq <= 200; seq++) armazem.empurrar("sessao_a1", seq, bloco + seq);
    const depois = armazem.chunks("sessao_a1");
    expect(tamanho(depois)).toBeLessThanOrEqual(LIMITE_ARMAZEM);
    expect(depois.at(-1)).toBe(bloco + "200");
    // marca truncado e permanente, e a segunda truncagem nao a reanuncia
    expect(armazem.truncado("sessao_a1")).toBe(true);
    expect(armazem.empurrar("sessao_a1", 201, "x")).toEqual({ aceito: true, truncou: false });
  });

  it("integracao: um unico chunk maior que o limite e cortado pelo fim (como o slice(-limite) de antes)", () => {
    const armazem = criarArmazem();
    const gigante = "x".repeat(LIMITE_ARMAZEM) + "0123456789";
    const resposta = armazem.empurrar("sessao_g1", 1, gigante);
    expect(resposta).toEqual({ aceito: true, truncou: true });
    const retidos = armazem.chunks("sessao_g1");
    expect(tamanho(retidos)).toBe(LIMITE_ARMAZEM);
    expect(retidos.join("").endsWith("0123456789")).toBe(true);
  });

  it("funcional: sequencia duplicada ou antiga e descartada e a ordem dos chunks e preservada", () => {
    const armazem = criarArmazem();
    expect(armazem.empurrar("sessao_b1", 1, "um ").aceito).toBe(true);
    expect(armazem.empurrar("sessao_b1", 2, "dois ").aceito).toBe(true);
    expect(armazem.empurrar("sessao_b1", 2, "REPETIDO").aceito).toBe(false);
    expect(armazem.empurrar("sessao_b1", 1, "ANTIGO").aceito).toBe(false);
    expect(armazem.empurrar("sessao_b1", 0, "ZERO").aceito).toBe(false);
    expect(armazem.empurrar("sessao_b1", 5, "cinco").aceito).toBe(true); // salto de sequencia e aceito
    expect(armazem.empurrar("sessao_b1", 4, "ATRASADO").aceito).toBe(false);
    expect(armazem.chunks("sessao_b1")).toEqual(["um ", "dois ", "cinco"]);
    expect(armazem.ultimaSequencia("sessao_b1")).toBe(5);
  });

  it("funcional: eventos que nao sao saida tambem avancam a sequencia da sessao, e sessoes sao independentes", () => {
    const armazem = criarArmazem();
    expect(armazem.registrarSequencia("sessao_c1", 1)).toBe(true); // estado
    expect(armazem.registrarSequencia("sessao_c1", 1)).toBe(false);
    expect(armazem.empurrar("sessao_c1", 1, "descartado: sequencia 1 ja foi do evento de estado").aceito).toBe(false);
    expect(armazem.empurrar("sessao_c1", 2, "ok").aceito).toBe(true);
    // ids ainda desconhecidos da aba sao aceitos (sessão ainda não registrada no store)
    expect(armazem.empurrar("sessao_d1", 1, "outra").aceito).toBe(true);
    expect(armazem.chunks("sessao_c1")).toEqual(["ok"]);
    expect(armazem.chunks("sessao_d1")).toEqual(["outra"]);
    expect(armazem.chunks("sessao_inexistente")).toEqual([]);
    expect(armazem.truncado("sessao_inexistente")).toBe(false);
    armazem.descartar("sessao_c1");
    expect(armazem.chunks("sessao_c1")).toEqual([]);
    expect(armazem.ultimaSequencia("sessao_c1")).toBe(0);
    expect(armazem.chunks("sessao_d1")).toEqual(["outra"]);
    armazem.limparTudo();
    expect(armazem.chunks("sessao_d1")).toEqual([]);
  });
});

describe("T-03.02 assinatura e replay do armazem", () => {
  it("integracao: um assinante tardio recebe os chunks retidos em ordem antes dos novos", () => {
    const armazem = criarArmazem();
    armazem.empurrar("sessao_e1", 1, "a");
    armazem.empurrar("sessao_e1", 2, "b");
    armazem.empurrar("sessao_e2", 1, "outra sessao");
    const recebidos: string[] = [];
    const cancelar = armazem.assinar("sessao_e1", (chunk) => recebidos.push(chunk));
    expect(recebidos).toEqual(["a", "b"]); // replay sincrono, so da propria sessao
    armazem.empurrar("sessao_e1", 3, "c");
    armazem.empurrar("sessao_e2", 2, "nao chega");
    armazem.empurrar("sessao_e1", 3, "duplicado nao chega");
    expect(recebidos).toEqual(["a", "b", "c"]);
    cancelar();
    armazem.empurrar("sessao_e1", 4, "d");
    expect(recebidos).toEqual(["a", "b", "c"]);
    // apos truncar, o replay comeca no primeiro chunk retido
    const pequeno = criarArmazem(10);
    pequeno.empurrar("sessao_t1", 1, "aaaaaa");
    pequeno.empurrar("sessao_t1", 2, "bbbbbb");
    const replay: string[] = [];
    pequeno.assinar("sessao_t1", (chunk) => replay.push(chunk));
    expect(replay).toEqual(["bbbbbb"]);
  });

  it("integracao: assinar antes de existir saida recebe so os eventos aceitos, e mais de um assinante recebe cada chunk", () => {
    const armazem = criarArmazem();
    const um = vi.fn();
    const dois = vi.fn();
    armazem.assinar("sessao_f1", um);
    armazem.assinar("sessao_f1", dois);
    expect(um).not.toHaveBeenCalled();
    armazem.empurrar("sessao_f1", 1, "x");
    expect(um.mock.calls).toEqual([["x"]]);
    expect(dois.mock.calls).toEqual([["x"]]);
    armazem.descartar("sessao_f1");
    armazem.empurrar("sessao_f1", 1, "y"); // sessao descartada e reaberta: nova sequencia
    expect(um.mock.calls).toEqual([["x"], ["y"]]);
  });

  it("funcional: 10.000 eventos empurrados notificam o assinante exatamente 10.000 vezes, sem timer", () => {
    vi.useFakeTimers();
    try {
      const armazem = criarArmazem();
      const cb = vi.fn();
      armazem.assinar("sessao_g1", cb);
      for (let seq = 1; seq <= 10_000; seq++) armazem.empurrar("sessao_g1", seq, `linha ${seq}\r\n`);
      // notificacao sincrona: nada depende de timer
      expect(vi.getTimerCount()).toBe(0);
      expect(cb).toHaveBeenCalledTimes(10_000);
      expect(cb.mock.calls[0]).toEqual(["linha 1\r\n"]);
      expect(cb.mock.calls[9_999]).toEqual(["linha 10000\r\n"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("assinantes", () => {
  it("funcional: conta os terminais que assinam a sessão e volta a 0 ao cancelar", () => {
    const armazem = criarArmazem();
    expect(armazem.assinantes("sessao_h1")).toBe(0);
    const cancelar = armazem.assinar("sessao_h1", () => undefined);
    expect(armazem.assinantes("sessao_h1")).toBe(1);
    cancelar();
    expect(armazem.assinantes("sessao_h1")).toBe(0);
  });
});

describe("D-570: terminal de workspace oculto (sem assinante) segue acumulando e é reproduzido ao voltar", () => {
  it("acumula a saída com o limite de tamanho, sem assinante, e o replay ao remontar é síncrono e em ordem", () => {
    const armazem = criarArmazem(1_000);
    for (let i = 1; i <= 20; i++) armazem.empurrar("oculta", i, `${String(i).padStart(2, "0")}${"x".repeat(98)}\n`); // 20 × 101 > limite
    expect(armazem.assinantes("oculta")).toBe(0);
    expect(armazem.truncado("oculta")).toBe(true);
    expect(tamanho(armazem.chunks("oculta"))).toBeLessThanOrEqual(1_000);
    const recebidos: string[] = [];
    const cancelar = armazem.assinar("oculta", (c) => recebidos.push(c));
    expect(recebidos).toEqual(armazem.chunks("oculta")); // replay já, no mesmo tick
    expect(recebidos.at(-1)?.startsWith("20")).toBe(true);
    armazem.empurrar("oculta", 21, "ao vivo");
    expect(recebidos.at(-1)).toBe("ao vivo");
    cancelar();
    // desmonta de novo (troca de workspace): continua retendo
    armazem.empurrar("oculta", 22, "oculto de novo");
    expect(armazem.chunks("oculta").at(-1)).toBe("oculto de novo");
  });

  it("os buffers de workspaces diferentes são independentes (descartar uma sessão não toca nas outras)", () => {
    const armazem = criarArmazem();
    armazem.empurrar("a1", 1, "A");
    armazem.empurrar("b1", 1, "B");
    armazem.descartar("a1");
    expect(armazem.chunks("a1")).toEqual([]);
    expect(armazem.chunks("b1")).toEqual(["B"]);
  });
});

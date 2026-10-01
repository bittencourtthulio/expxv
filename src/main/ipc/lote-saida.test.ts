import { describe, expect, it } from "vitest";
import type { EventoTerminal } from "../../compartilhado/terminais";
import { criarLoteSaida, dividirPorBytes, PEDACO_LOTE_BYTES } from "./lote-saida";

function relogio() {
  const tarefas: Array<{ fn: () => void; ativo: boolean }> = [];
  return {
    agendar: (fn: () => void) => {
      const t = { fn, ativo: true };
      tarefas.push(t);
      return () => { t.ativo = false; };
    },
    /** dispara o(s) temporizador(es) agendados até agora. */
    passarQuadro() { for (const t of tarefas.splice(0)) if (t.ativo) t.fn(); },
    pendentes: () => tarefas.filter((t) => t.ativo).length,
  };
}

const saida = (sequencia: number, dados: string, sessao_id = "sessao_a"): EventoTerminal => ({ versao: 1, tipo: "saida", sequencia, sessao_id, dados });

function montar() {
  const r = relogio();
  const enviados: EventoTerminal[] = [];
  const lote = criarLoteSaida({ enviar: (e) => enviados.push(e), agendar: r.agendar, quadro_ms: 12 });
  return { r, enviados, lote };
}

describe("lote de saída do PTY", () => {
  it("eco imediato: a primeira saída de uma sessão parada sai na hora, sem esperar o quadro", () => {
    const { enviados, lote } = montar();
    lote.push(saida(1, "a"));
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({ tipo: "saida", dados: "a", sequencia: 1 });
  });

  it("o que chega dentro do quadro é agrupado e sai junto no fim dele", () => {
    const { enviados, lote, r } = montar();
    lote.push(saida(1, "a"));
    lote.push(saida(2, "b"));
    lote.push(saida(3, "c"));
    expect(enviados).toHaveLength(1);
    r.passarQuadro();
    expect(enviados).toHaveLength(2);
    expect(enviados[1]).toMatchObject({ dados: "bc", sequencia: 3 });
  });

  it("silêncio fecha a janela: a próxima saída volta a ser imediata; fluxo contínuo renova a janela", () => {
    const { enviados, lote, r } = montar();
    lote.push(saida(1, "a"));
    lote.push(saida(2, "b"));
    r.passarQuadro(); // envia "b" e renova
    expect(r.pendentes()).toBe(1);
    r.passarQuadro(); // nada pendente: fecha
    expect(r.pendentes()).toBe(0);
    lote.push(saida(3, "c"));
    expect(enviados.map((e) => (e as { dados: string }).dados)).toEqual(["a", "b", "c"]);
  });

  it("eventos que não são saída descarregam a saída pendente antes (ordem de sequência preservada)", () => {
    const { enviados, lote } = montar();
    lote.push(saida(1, "a"));
    lote.push(saida(2, "b"));
    lote.push({ versao: 1, tipo: "encerramento", sequencia: 3, sessao_id: "sessao_a", codigo: 0, sinal: null });
    expect(enviados.map((e) => e.sequencia)).toEqual([1, 2, 3]);
    expect(enviados.map((e) => e.tipo)).toEqual(["saida", "saida", "encerramento"]);
  });

  it("sessões têm filas independentes", () => {
    const { enviados, lote } = montar();
    lote.push(saida(1, "a", "sessao_a"));
    lote.push(saida(1, "x", "sessao_b")); // a janela de A não atrasa B
    expect(enviados).toHaveLength(2);
  });

  it("nenhum pedaço enviado passa de 64 KB e as sequências seguem estritamente crescentes", () => {
    const { enviados, lote, r } = montar();
    lote.push(saida(1, "."));
    const bloco = "x".repeat(60_000);
    for (let i = 2; i <= 8; i++) lote.push(saida(i, bloco));
    r.passarQuadro();
    const saidas = enviados as Array<Extract<EventoTerminal, { tipo: "saida" }>>;
    expect(saidas.length).toBeGreaterThan(2);
    for (const e of saidas) expect(Buffer.byteLength(e.dados)).toBeLessThanOrEqual(PEDACO_LOTE_BYTES);
    const seqs = saidas.map((e) => e.sequencia);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(saidas.map((e) => e.dados).join("")).toBe(`.${bloco.repeat(7)}`);
  });

  it("dividirPorBytes respeita bytes UTF-8 e não parte emoji", () => {
    const texto = "😀".repeat(40_000); // 4 bytes cada
    const pedacos = dividirPorBytes(texto);
    expect(pedacos.join("")).toBe(texto);
    for (const p of pedacos) {
      expect(Buffer.byteLength(p)).toBeLessThanOrEqual(PEDACO_LOTE_BYTES);
      expect(p.endsWith("\ud83d")).toBe(false);
    }
    expect(dividirPorBytes("")).toEqual([]);
  });

  it("fechar descarrega o pendente e cancela a janela", () => {
    const { enviados, lote, r } = montar();
    lote.push(saida(1, "a"));
    lote.push(saida(2, "b"));
    lote.fechar();
    expect(enviados).toHaveLength(2);
    expect(r.pendentes()).toBe(0);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { abrirBanco, type Banco } from "../banco/banco";
import { migrar } from "../banco/migrar";
import type { EventoBichinhoMudou } from "../../compartilhado/bichinho";
import { criarRepoBichinho } from "./repo";
import { criarServicoBichinho, ErroBichinho, ATRASO_RECALCULO_MS } from "./servico";
import { leitorDeObjeto, muitos } from "./teste-util";

const abertos: Banco[] = [];
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));
const TS = "2026-10-01T12:00:00.000Z";

function montar(opc: { arquivos?: Record<string, string>; chunks?: number | null; panes?: Array<{ workspace_id: string; pane_id: string; estado: "trabalhando" }> } = {}) {
  const banco = abrirBanco(":memory:");
  abertos.push(banco);
  migrar(banco);
  banco.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES ('ws_AAAAAAAAAA','meu-app','/p/meu-app',?,?)", [TS, TS]);
  banco.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES ('ws_BBBBBBBBBB','outro','/p/outro',?,?)", [TS, TS]);
  const eventos: EventoBichinhoMudou[] = [];
  let agora = 1_000_000;
  const timers: Array<{ fn: () => void; em: number; vivo: boolean }> = [];
  const leituras: string[] = [];
  const servico = criarServicoBichinho({
    repo: criarRepoBichinho(banco, () => TS),
    leitorProjeto: (raiz) => { leituras.push(raiz); return leitorDeObjeto(opc.arquivos ?? { "Cargo.toml": "", ...muitos("src", "rs", 5) }); },
    chunksDoRag: async () => (opc.chunks === undefined ? 0 : opc.chunks),
    emitir: (e) => eventos.push(e),
    agora: () => agora,
    agendar: (fn, ms) => { const t = { fn, em: agora + ms, vivo: true }; timers.push(t); return { cancelar: () => { t.vivo = false; } }; },
    ...(opc.panes === undefined ? {} : { panesVivos: () => opc.panes! }),
  });
  const avancar = async (ms: number) => {
    agora += ms;
    for (const t of timers.filter((x) => x.vivo && x.em <= agora)) { t.vivo = false; t.fn(); }
    await new Promise((r) => setTimeout(r, 0));
  };
  const custo = (ws: string, entrada: number, saida: number) => banco.executar("INSERT INTO custo_agregado (escopo,chave,dia,modelo,atribuicao,tokens_entrada,tokens_saida) VALUES ('workspace',?,?,?,'card',?,?)", [ws, `2026-10-0${1 + Math.floor(Math.random() * 8)}`, `m${Math.random()}`, entrada, saida]);
  /** `n` tasks entregues numa Missão do workspace (a regra do ovo: o primeiro trabalho NÃO choca; as tarefas concluídas, sim). */
  const tarefas = (ws: string, n: number, estado = "entregue") => {
    const missao = `mi_${ws}`;
    banco.executar("INSERT OR IGNORE INTO mission (id,workspace_id,modo,origem,titulo,estado,criado_em,atualizado_em) VALUES (?,?,'livre','livre','t','executando',?,?)", [missao, ws, TS, TS]);
    for (let i = 0; i < n; i++) banco.executar("INSERT INTO task (id,mission_id,task_ref,titulo,papel,estado,criado_em,atualizado_em) VALUES (?,?,?,'t','nenhum',?,?,?)", [`ta_${ws}_${Math.random()}`, missao, `T-${Math.random()}`, estado, TS, TS]);
  };
  return { banco, servico, eventos, avancar, custo, tarefas, leituras, timers, agora: () => agora };
}

const WS = "ws_AAAAAAAAAA";

describe("serviço do Bichinho (stores falsos e banco em memória)", () => {
  it("espécie pelos arquivos-marca, ovo sem uso, persistida", async () => {
    const m = montar();
    const v = await m.servico.obter(WS);
    expect(v).toMatchObject({ especie: "caranguejo", manual: false, estagio: "ovo", maturidade: 0, humor: "ocioso", doente: false, apelido: null });
    expect(v.motivo.join(" ")).toMatch(/Rust/);
    expect(m.banco.consultarUm("SELECT especie, estagio FROM workspace_bichinho WHERE workspace_id = ?", [WS])).toMatchObject({ especie: "caranguejo", estagio: "ovo" });
  });

  it("maturidade usa tokens in+out do workspace (e só dele) + memória ativa + chunks do RAG", async () => {
    const m = montar({ chunks: 500 });
    m.custo(WS, 4_000_000, 1_000_000);
    m.custo("ws_BBBBBBBBBB", 900_000_000, 900_000_000);
    m.banco.executar("INSERT INTO memoria_entrada (id,workspace_id,escopo,anel,tipo,conteudo,fonte,hash_conteudo,criado_em,atualizado_em) VALUES ('m1',?,'workspace',2,'fato','x','sistema',?,?,?)", [WS, "h".repeat(32), TS, TS]);
    m.banco.executar("INSERT INTO memoria_entrada (id,workspace_id,escopo,anel,tipo,conteudo,fonte,estado,hash_conteudo,criado_em,atualizado_em) VALUES ('m2',?,'workspace',2,'fato','y','sistema','expirada',?,?,?)", [WS, "i".repeat(32), TS, TS]);
    const v = await m.servico.obter(WS);
    expect(v.tokens_total).toBe(5_000_000);
    expect(v.conhecimento_itens).toEqual({ memoria: 1, chunks: 500, total: 501 });
    expect(v.componentes.tokens).toBeGreaterThan(40);
    expect(v.maturidade).toBeGreaterThan(20);
  });

  it("RAG ainda não nasceu (null): conta só a memória, sem quebrar", async () => {
    const m = montar({ chunks: null });
    expect((await m.servico.obter(WS)).conhecimento_itens).toEqual({ memoria: 0, chunks: null, total: 0 });
  });

  it("maturidade nunca regride, mesmo se a memória for apagada", async () => {
    const m = montar();
    for (let i = 0; i < 5; i++) m.banco.executar("INSERT INTO memoria_entrada (id,workspace_id,escopo,anel,tipo,conteudo,fonte,hash_conteudo,criado_em,atualizado_em) VALUES (?,?,'workspace',2,'fato','x','sistema',?,?,?)", [`m${i}`, WS, `${i}`.repeat(32), TS, TS]);
    m.custo(WS, 50_000_000, 5_000_000);
    const antes = await m.servico.obter(WS);
    m.banco.executar("DELETE FROM memoria_entrada");
    const depois = await m.servico.obter(WS);
    expect(depois.maturidade).toBe(antes.maturidade);
    expect(depois.estagio).toBe(antes.estagio);
  });

  it("subida de estágio avisa UMA vez com estagio_novo; a primeira leitura (linha nova) nunca comemora", async () => {
    const m = montar();
    await m.servico.obter(WS);
    expect(m.eventos).toHaveLength(0);
    m.custo(WS, 30_000_000, 3_000_000);
    m.tarefas(WS, 4);
    m.servico.aoEvento(WS, { tipo: "pane", id: "p1", estado: "trabalhando" });
    await m.avancar(10);
    m.servico.aoEvento(WS, { tipo: "pane", id: "p1", estado: "pronto" });
    await m.avancar(ATRASO_RECALCULO_MS + 10);
    const novos = m.eventos.filter((e) => e.estagio_novo);
    expect(novos).toHaveLength(1);
    expect(novos[0]!.visao.estagio).not.toBe("ovo");
    await m.avancar(ATRASO_RECALCULO_MS * 3);
    expect(m.eventos.filter((e) => e.estagio_novo)).toHaveLength(1);
  });

  it("trocar espécie persiste e vence a automática; null volta ao automático", async () => {
    const m = await montar();
    const v = await m.servico.trocarEspecie(WS, "gato");
    expect(v).toMatchObject({ especie: "gato", manual: true, especie_automatica: "caranguejo" });
    expect((await m.servico.obter(WS)).especie).toBe("gato");
    const volta = await m.servico.trocarEspecie(WS, null);
    expect(volta).toMatchObject({ especie: "caranguejo", manual: false });
    await expect(m.servico.trocarEspecie(WS, "dragao" as never)).rejects.toBeInstanceOf(ErroBichinho);
  });

  it("renomear valida (1 a 24, sem controle) e persiste; null limpa", async () => {
    const m = montar();
    expect((await m.servico.renomear(WS, "  Ferris   Jr ")).apelido).toBe("Ferris Jr");
    await expect(m.servico.renomear(WS, "")).rejects.toMatchObject({ codigo: "apelido_invalido" });
    await expect(m.servico.renomear(WS, "x".repeat(25))).rejects.toMatchObject({ codigo: "apelido_invalido" });
    await expect(m.servico.renomear(WS, "a\u0007b")).rejects.toMatchObject({ codigo: "apelido_invalido" });
    expect((await m.servico.renomear(WS, null)).apelido).toBeNull();
  });

  it("workspace desconhecido: erro nominal; listar ignora ids desconhecidos", async () => {
    const m = montar();
    await expect(m.servico.obter("ws_ZZZZZZZZZZ")).rejects.toMatchObject({ codigo: "workspace_desconhecido" });
    expect((await m.servico.listar([WS, "ws_ZZZZZZZZZZ", "ws_BBBBBBBBBB"])).map((v) => v.workspace_id)).toEqual([WS, "ws_BBBBBBBBBB"]);
  });

  it("humor por eventos, isolado por workspace, com evento coalescível e timer de disparo único", async () => {
    const m = montar();
    await m.servico.obter(WS);
    await m.servico.obter("ws_BBBBBBBBBB");
    m.servico.aoEvento(WS, { tipo: "pane", id: "p", estado: "trabalhando" });
    await m.avancar(1);
    expect(m.eventos.at(-1)).toMatchObject({ workspace_id: WS, visao: { humor: "trabalhando" } });
    expect((await m.servico.obter("ws_BBBBBBBBBB")).humor).toBe("ocioso");
    m.servico.aoEvento(WS, { tipo: "missao", resultado: "concluida" });
    m.servico.aoEvento(WS, { tipo: "pane", id: "p", estado: "pronto" });
    await m.avancar(2_000);
    expect(m.eventos.at(-1)!.visao.humor).toBe("comemorando");
    await m.avancar(10_000);
    expect(m.eventos.at(-1)!.visao.humor).toBe("ocioso");
    await m.avancar(11 * 60_000);
    expect(m.eventos.at(-1)!.visao.humor).toBe("dormindo");
    expect(m.timers.filter((t) => t.vivo)).toHaveLength(0);
  });

  it("cota ≥ 85% marca doente em todos os bichinhos vivos", async () => {
    const m = montar();
    await m.servico.obter(WS);
    m.servico.aoLimite(90);
    await m.avancar(1);
    expect(m.eventos.at(-1)).toMatchObject({ visao: { doente: true } });
  });

  it("semeia o humor com os Panes vivos quando o serviço nasce depois do primeiro Pane", async () => {
    const m = montar({ panes: [{ workspace_id: WS, pane_id: "p", estado: "trabalhando" }] });
    expect((await m.servico.obter(WS)).humor).toBe("trabalhando");
  });

  it("sinais (arquivos-marca) ficam em cache: uma leitura da pasta por 10 min", async () => {
    const m = montar();
    await m.servico.obter(WS);
    await m.servico.obter(WS);
    await m.servico.obter(WS);
    expect(m.leituras).toHaveLength(1);
  });

  it("esquecer e encerrar cancelam os timers", async () => {
    const m = montar();
    await m.servico.obter(WS);
    expect(m.timers.some((t) => t.vivo)).toBe(true);
    m.servico.encerrar();
    expect(m.timers.some((t) => t.vivo)).toBe(false);
  });

  describe("esforço (D-500…): CLI sem adaptador, intensidade proporcional, custo ocioso zero", () => {
    const ultimo = (m: ReturnType<typeof montar>) => m.eventos.at(-1)!.visao;
    /** emite saída contínua de uma sessão "falsa" (só o tamanho; nenhum texto) por `ms`, avançando o relógio de 250 em 250 ms. */
    async function fluir(m: ReturnType<typeof montar>, bytesPorSeg: number, ms: number, sessao = "grok1"): Promise<void> {
      for (let t = 0; t < ms; t += 250) {
        m.servico.aoSaida(WS, sessao, bytesPorSeg / 4, Math.max(1, Math.round(bytesPorSeg / 80)));
        await m.avancar(250);
      }
    }

    it("sessão que só emite saída (Grok, sem Pane trabalhando) = trabalhando, nunca dormindo", async () => {
      const m = montar();
      await m.servico.obter(WS);
      await fluir(m, 800, 3_000);
      expect(ultimo(m)).toMatchObject({ humor: "trabalhando", esforco: { origem: "estimado", sessoes_fluindo: 1 } });
      expect(ultimo(m).esforco.nivel).toBeGreaterThanOrEqual(3);
    });

    it("intensidade proporcional: mais saída, nível maior; picos sobem na hora, descida é gradual", async () => {
      const m = montar();
      await m.servico.obter(WS);
      await fluir(m, 40, 3_000);
      expect(ultimo(m).esforco.nivel).toBe(2);
      await fluir(m, 700, 4_000);
      expect(ultimo(m).esforco.nivel).toBe(3);
      await fluir(m, 9_000, 4_000);
      expect(ultimo(m).esforco.nivel).toBe(4);
      await m.avancar(5_000);
      expect(ultimo(m).esforco.nivel).toBe(4);
      await m.avancar(20_000);
      expect(ultimo(m).esforco.nivel).toBeLessThan(4);
    });

    it("nunca dorme com atividade < 20 s e só dorme depois de 5 min reais; o nível volta a 0", async () => {
      const m = montar();
      await m.servico.obter(WS);
      await fluir(m, 900, 2_000);
      for (let i = 0; i < 24; i++) { await m.avancar(1_000); expect(ultimo(m).humor).not.toBe("dormindo"); }
      for (let i = 0; i < 40; i++) await m.avancar(1_000);
      expect(ultimo(m).esforco.nivel).toBe(0);
      expect(ultimo(m).humor).toBe("ocioso");
      await m.avancar(6 * 60_000);
      expect(ultimo(m).humor).toBe("dormindo");
    });

    it("tokens/min medidos mandam: 4,2 mil tokens/min = acelerado, origem medida", async () => {
      const m = montar();
      await m.servico.obter(WS);
      m.servico.aoTokens(WS, 4_200);
      await m.avancar(300);
      expect(ultimo(m).esforco).toMatchObject({ nivel: 3, origem: "medido", tokens_por_min: 4_200 });
      m.servico.aoTokens(WS, 9_000);
      await m.avancar(300);
      expect(ultimo(m).esforco.nivel).toBe(4);
    });

    it("cost.updated: o delta do total persistido vira tokens/min (a primeira leitura é só a linha de base)", async () => {
      const m = montar();
      m.custo(WS, 1_000, 500);
      await m.servico.obter(WS);
      m.servico.aoCustoAtualizado(WS);
      await m.avancar(300);
      expect(m.eventos.some((e) => e.visao.esforco.tokens_por_min !== null)).toBe(false);
      m.custo(WS, 2_000, 700);
      m.servico.aoCustoAtualizado(WS);
      await m.avancar(300);
      expect(ultimo(m).esforco).toMatchObject({ origem: "medido", tokens_por_min: 2_700, nivel: 3 });
    });

    it("sem fonte de tokens há mais de 5 min o esforço volta a ser estimado pela saída", async () => {
      const m = montar();
      await m.servico.obter(WS);
      m.servico.aoTokens(WS, 20_000);
      await m.avancar(6 * 60_000);
      await fluir(m, 700, 2_000);
      expect(ultimo(m).esforco).toMatchObject({ origem: "estimado", tokens_por_min: null });
    });

    it("o esforço é por workspace: o outro não reage", async () => {
      const m = montar();
      await m.servico.obter(WS);
      await m.servico.obter("ws_BBBBBBBBBB");
      await fluir(m, 900, 2_000);
      const outro = m.eventos.filter((e) => e.workspace_id === "ws_BBBBBBBBBB").at(-1)?.visao;
      expect(outro?.esforco.nivel ?? 0).toBe(0);
    });

    it("entrada do usuário = atento (nível 1) e não vira trabalhando", async () => {
      const m = montar();
      await m.servico.obter(WS);
      m.servico.aoEntrada(WS);
      await m.avancar(300);
      expect(ultimo(m)).toMatchObject({ humor: "ocioso", esforco: { nivel: 1 } });
    });

    it("Pane trabalhando pelo estado, sem medição, vale no mínimo nível 2 (origem estado)", async () => {
      const m = montar({ panes: [{ workspace_id: WS, pane_id: "p", estado: "trabalhando" }] });
      expect((await m.servico.obter(WS)).esforco).toMatchObject({ nivel: 2, origem: "estado" });
    });

    it("custo ocioso zero: sem atividade o único timer é o do sono; depois do esforço acabar, volta a ser só ele", async () => {
      const m = montar();
      await m.servico.obter(WS);
      const vivos = () => m.timers.filter((t) => t.vivo && t.em - m.agora() < 60_000);
      expect(vivos()).toHaveLength(0);
      await fluir(m, 900, 1_000);
      expect(vivos().length).toBeGreaterThan(0);
      for (let i = 0; i < 80; i++) await m.avancar(1_000);
      expect(ultimo(m).esforco.nivel).toBe(0);
      expect(vivos()).toHaveLength(0);
    });

    it("não emite a cada pulso: nível/humor iguais não geram evento novo", async () => {
      const m = montar();
      await m.servico.obter(WS);
      await fluir(m, 900, 2_000);
      const n = m.eventos.length;
      await fluir(m, 900, 3_000);
      expect(m.eventos.length - n).toBeLessThanOrEqual(1);
    });

    it("sessão encerrada ou workspace desconhecido não deixam rastro", async () => {
      const m = montar();
      await m.servico.obter(WS);
      m.servico.aoSaida("ws_inexistente", "s", 100, 1);
      m.servico.aoSessaoEncerrada(WS, "nunca-existiu");
      await m.avancar(1_000);
      expect(m.timers.filter((t) => t.vivo && t.em - m.agora() < 60_000)).toHaveLength(0);
    });
  });
});

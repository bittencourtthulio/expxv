import { afterEach, describe, expect, it } from "vitest";
import { ESPECIES, type EspecieId, type EventoBichinhoMudou } from "../../compartilhado/bichinho";
import { abrirBanco, type Banco } from "../banco/banco";
import { migrar } from "../banco/migrar";
import { AFINIDADE_LINGUAGEM } from "./afinidades";
import { criarRepoBichinho } from "./repo";
import { ATRASO_RECALCULO_MS, criarServicoBichinho } from "./servico";
import { leitorDeObjeto, muitos } from "./teste-util";

const abertos: Banco[] = [];
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));
const TS = "2026-10-01T12:00:00.000Z";
const RUST = { "Cargo.toml": "", ...muitos("src", "rs", 6) };
const id = (i: number): string => `ws_${String(i).padStart(10, "0")}`;

function montar(opc: { n?: number; arquivos?: Record<string, string>; prefs?: { semRepetir?: boolean; metaOvo?: number } } = {}) {
  const banco = abrirBanco(":memory:");
  abertos.push(banco);
  migrar(banco);
  for (let i = 0; i < (opc.n ?? 3); i++) banco.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES (?,?,?,?,?)", [id(i), `projeto-${i}`, `/p/${i}`, TS, TS]);
  const eventos: EventoBichinhoMudou[] = [];
  let agora = 1_000_000;
  const timers: Array<{ fn: () => void; em: number; vivo: boolean }> = [];
  const novoServico = () => criarServicoBichinho({
    repo: criarRepoBichinho(banco, () => TS),
    leitorProjeto: () => leitorDeObjeto(opc.arquivos ?? RUST),
    emitir: (e) => eventos.push(e),
    ...(opc.prefs === undefined ? {} : { prefs: () => opc.prefs! }),
    agora: () => agora,
    agendar: (fn, ms) => { const t = { fn, em: agora + ms, vivo: true }; timers.push(t); return { cancelar: () => { t.vivo = false; } }; },
  });
  const avancar = async (ms: number) => {
    agora += ms;
    for (const t of timers.filter((x) => x.vivo && x.em <= agora)) { t.vivo = false; t.fn(); }
    await new Promise((r) => setTimeout(r, 0));
  };
  const custo = (ws: string, tokens: number) => banco.executar("INSERT INTO custo_agregado (escopo,chave,dia,modelo,atribuicao,tokens_entrada,tokens_saida) VALUES ('workspace',?,?,?,'card',?,0)", [ws, "2026-10-01", `m${Math.random()}`, tokens]);
  const missao = (ws: string, estado = "executando", mid = `mi_${ws}`) => banco.executar("INSERT OR IGNORE INTO mission (id,workspace_id,modo,origem,titulo,estado,criado_em,atualizado_em) VALUES (?,?,'livre','livre','t',?,?,?)", [mid, ws, estado, TS, TS]);
  const tarefas = (ws: string, n: number, estado = "entregue", mid = `mi_${ws}`) => {
    missao(ws, "executando", mid);
    for (let i = 0; i < n; i++) banco.executar("INSERT INTO task (id,mission_id,task_ref,titulo,papel,estado,criado_em,atualizado_em) VALUES (?,?,?,'t','nenhum',?,?,?)", [`ta_${Math.random()}`, mid, `T-${Math.random()}`, estado, TS, TS]);
  };
  const linha = (ws: string) => banco.consultarUm<{ especie: string; especie_manual: number; variante: number; estagio: string; maturidade_max: number; reatribuido_de: string | null; tarefas_concluidas: number }>("SELECT * FROM workspace_bichinho WHERE workspace_id = ?", [ws])!;
  return { banco, servico: novoServico(), novoServico, eventos, avancar, custo, tarefas, missao, linha, timers };
}

describe("atribuição pelo serviço: sem repetir espécie", () => {
  it("vários workspaces com a MESMA stack recebem espécies diferentes, a primeira é a mais afim, e fica persistido", async () => {
    const m = montar({ n: 5 });
    const especies: string[] = [];
    for (let i = 0; i < 5; i++) especies.push((await m.servico.obter(id(i))).especie);
    expect(new Set(especies).size).toBe(5);
    expect(especies[0]).toBe("caranguejo");
    for (let i = 0; i < 5; i++) expect(m.linha(id(i)).especie).toBe(especies[i]);
    // reabrir não muda (a espécie guardada vale; não é recalculada a cada leitura)
    expect((await m.novoServico().obter(id(0))).especie).toBe("caranguejo");
  });

  it("o motivo explica quando a mais afim já estava em uso (e por quem)", async () => {
    const m = montar({ n: 2 });
    await m.servico.obter(id(0));
    const v = await m.servico.obter(id(1));
    expect(v.especie).not.toBe("caranguejo");
    expect(v.motivo.join(" ")).toMatch(/caranguejo/);
    expect(v.motivo.join(" ")).toMatch(/projeto-0/);
  });

  it("chamadas concorrentes (listar) também não repetem espécie", async () => {
    const m = montar({ n: 8 });
    const lista = await m.servico.listar(Array.from({ length: 8 }, (_, i) => id(i)));
    expect(new Set(lista.map((v) => v.especie)).size).toBe(8);
  });

  it("escolha manual vence (inclusive de espécie já usada) e aparece em `usos`; null volta ao automático livre", async () => {
    const m = montar({ n: 2 });
    await m.servico.obter(id(0));
    const v = await m.servico.trocarEspecie(id(1), "caranguejo");
    expect(v).toMatchObject({ especie: "caranguejo", manual: true });
    expect(m.servico.usos().filter((u) => u.especie === "caranguejo").map((u) => u.workspace_nome).sort()).toEqual(["projeto-0", "projeto-1"]);
    const volta = await m.servico.trocarEspecie(id(1), null);
    expect(volta.manual).toBe(false);
    expect(volta.especie).toBe(AFINIDADE_LINGUAGEM.rust[1]);
    await expect(m.servico.trocarEspecie(id(1), "dragao" as never)).rejects.toThrow(/desconhecida/);
  });

  it("remover o workspace libera a espécie para o próximo", async () => {
    const m = montar({ n: 3 });
    await m.servico.obter(id(0));
    const b = await m.servico.obter(id(1));
    m.banco.executar("DELETE FROM workspace WHERE id = ?", [id(0)]);
    m.servico.esquecer(id(0));
    const c = await m.servico.obter(id(2));
    expect(c.especie).toBe("caranguejo");
    expect(c.especie).not.toBe(b.especie);
  });

  it("o 101º repete com VARIANTE visual; antes disso a variante é 0", async () => {
    const m = montar({ n: 101, arquivos: {} });
    const vistas = new Set<string>();
    for (let i = 0; i < 100; i++) { const v = await m.servico.obter(id(i)); vistas.add(v.especie); expect(v.variante).toBe(0); }
    expect(vistas.size).toBe(100);
    const cem = await m.servico.obter(id(100));
    expect(ESPECIES).toContain(cem.especie);
    expect(cem.variante).toBe(1);
    expect(cem.motivo.join(" ")).toMatch(/se repete/);
    expect(m.linha(id(100)).variante).toBe(1);
  }, 30_000);

  it("com 'Sem repetir espécie' desligado repete a mais afim, sem variante", async () => {
    const m = montar({ n: 3, prefs: { semRepetir: false } });
    const e = [];
    for (let i = 0; i < 3; i++) e.push((await m.servico.obter(id(i))).especie);
    expect(e).toEqual(["caranguejo", "caranguejo", "caranguejo"]);
  });
});

describe("correção única dos repetidos existentes", () => {
  /** estado legado: várias linhas com a mesma espécie (como o 3º workspace do dono), na ordem da primeira atribuição. */
  const legado = (m: ReturnType<typeof montar>, linhas: Array<[i: number, esp: EspecieId, manual: 0 | 1, est: string, mat: number]>) => {
    for (const [i, esp, manual, est, mat] of linhas) m.banco.executar("INSERT INTO workspace_bichinho (workspace_id,especie,especie_manual,maturidade_max,estagio,atualizado_em) VALUES (?,?,?,?,?,?)", [id(i), esp, manual, mat, est, TS]);
  };

  it("o mais ANTIGO mantém; os automáticos repetidos ganham outra espécie livre; maturidade e estágio ficam; aviso único", async () => {
    const m = montar({ n: 4 });
    legado(m, [[0, "raposa", 0, "adulto", 55], [1, "raposa", 0, "jovem", 30], [2, "raposa", 0, "ovo", 0], [3, "gato", 0, "filhote", 8]]);
    const v0 = await m.servico.obter(id(0));
    const v1 = await m.servico.obter(id(1));
    const v2 = await m.servico.obter(id(2));
    expect(v0.especie).toBe("raposa");
    expect(v0.reatribuido).toBeNull();
    expect(v1.especie).not.toBe("raposa");
    expect(v2.especie).not.toBe("raposa");
    expect(v1.especie).not.toBe(v2.especie);
    expect(v1).toMatchObject({ estagio: "jovem", maturidade: 30, manual: false, reatribuido: { de: "raposa" } });
    expect(v2).toMatchObject({ estagio: "ovo", reatribuido: { de: "raposa" } });
    expect(m.linha(id(1))).toMatchObject({ maturidade_max: 30, estagio: "jovem" });
    // o aviso é dado uma vez só
    expect((await m.servico.obter(id(1))).reatribuido).toBeNull();
    expect(m.linha(id(1)).reatribuido_de).toBeNull();
    expect(new Set(m.servico.usos().map((u) => u.especie)).size).toBe(4);
  });

  it("escolha manual é preservada (mesmo repetida) e é idempotente: reabrir não muda mais nada", async () => {
    const m = montar({ n: 3 });
    legado(m, [[0, "raposa", 0, "adulto", 55], [1, "raposa", 1, "jovem", 30], [2, "raposa", 0, "filhote", 9]]);
    await m.servico.listar([id(0), id(1), id(2)]);
    expect(m.linha(id(1))).toMatchObject({ especie: "raposa", especie_manual: 1 });
    expect(m.linha(id(2)).especie).not.toBe("raposa");
    const depois = m.banco.consultar("SELECT workspace_id, especie, variante FROM workspace_bichinho ORDER BY rowid");
    const outro = m.novoServico();
    await outro.listar([id(0), id(1), id(2)]);
    expect(m.banco.consultar("SELECT workspace_id, especie, variante FROM workspace_bichinho ORDER BY rowid")).toEqual(depois);
  });

  it("repetição de variante (a permitida depois das 100) não é mexida; sem espécie livre nada muda", async () => {
    const m = montar({ n: 2 });
    m.banco.executar("INSERT INTO workspace_bichinho (workspace_id,especie,variante,atualizado_em) VALUES (?,'gato',0,?)", [id(0), TS]);
    m.banco.executar("INSERT INTO workspace_bichinho (workspace_id,especie,variante,atualizado_em) VALUES (?,'gato',2,?)", [id(1), TS]);
    await m.servico.listar([id(0), id(1)]);
    expect(m.linha(id(1))).toMatchObject({ especie: "gato", variante: 2 });
  });
});

describe("ovo: só nasce com tarefas concluídas E o piso de tokens", () => {
  const WS = id(0);

  it("o primeiro trabalho NÃO choca: muitos tokens sem tarefas, ou tarefas sem tokens, seguem ovo com progresso parcial", async () => {
    const m = montar({ n: 1 });
    m.custo(WS, 5_000_000);
    const so = await m.servico.obter(WS);
    expect(so.estagio).toBe("ovo");
    expect(so.ovo).toMatchObject({ tarefas: 0, meta_tarefas: 4, piso_tokens: 150_000, progresso: 0 });
    expect(so.maturidade).toBeGreaterThan(20); // a maturidade continua contando por baixo
    const m2 = montar({ n: 1 });
    m2.tarefas(WS, 6);
    expect((await m2.servico.obter(WS)).estagio).toBe("ovo");
  });

  it("progresso = min(tarefas/meta, tokens/piso) e o tooltip tem de onde tirar os números", async () => {
    const m = montar({ n: 1 });
    m.tarefas(WS, 2);
    m.custo(WS, 80_000);
    const v = await m.servico.obter(WS);
    expect(v.ovo).toEqual({ tarefas: 2, meta_tarefas: 4, tokens: 80_000, piso_tokens: 150_000, progresso: 50 });
  });

  it("com as 4 tarefas e os 150 mil tokens, nasce: UM evento com nasceu e estagio_novo, e a visão deixa de ter ovo", async () => {
    const m = montar({ n: 1 });
    await m.servico.obter(WS);
    m.tarefas(WS, 4);
    m.custo(WS, 160_000);
    m.servico.aoTarefa(WS);
    await m.avancar(ATRASO_RECALCULO_MS + 10);
    const nasceu = m.eventos.filter((e) => e.nasceu === true);
    expect(nasceu).toHaveLength(1);
    expect(nasceu[0]).toMatchObject({ estagio_novo: true });
    expect(nasceu[0]!.visao).toMatchObject({ estagio: "filhote", ovo: null });
    await m.avancar(ATRASO_RECALCULO_MS * 4);
    expect(m.eventos.filter((e) => e.nasceu === true)).toHaveLength(1);
    expect(m.linha(WS).estagio).not.toBe("ovo");
  });

  it("nunca regride: depois de nascer, apagar tarefas e custo não devolve o bichinho ao ovo", async () => {
    const m = montar({ n: 1 });
    m.tarefas(WS, 4);
    m.custo(WS, 200_000);
    expect((await m.servico.obter(WS)).estagio).not.toBe("ovo");
    m.banco.executar("DELETE FROM task");
    m.banco.executar("DELETE FROM custo_agregado");
    const v = await m.servico.obter(WS);
    expect(v.estagio).not.toBe("ovo");
    expect(v.ovo).toBeNull();
  });

  it("o contador de tarefas é monotônico: apagar a Missão não diminui o progresso do ovo", async () => {
    const m = montar({ n: 1 });
    m.tarefas(WS, 3);
    expect((await m.servico.obter(WS)).ovo?.tarefas).toBe(3);
    m.banco.executar("DELETE FROM task");
    expect((await m.servico.obter(WS)).ovo?.tarefas).toBe(3);
    expect(m.linha(WS).tarefas_concluidas).toBe(3);
  });

  it("quem já tinha passado do ovo (linha antiga) continua como está", async () => {
    const m = montar({ n: 1 });
    m.banco.executar("INSERT INTO workspace_bichinho (workspace_id,especie,maturidade_max,estagio,atualizado_em) VALUES (?,'gato',30,'jovem',?)", [WS, TS]);
    const v = await m.servico.obter(WS);
    expect(v).toMatchObject({ estagio: "jovem", ovo: null });
  });

  it("deduplica por id: task entregue + a própria Missão concluída + pipeline ligado à Missão contam UMA vez; só tasks 'aberta' não contam", async () => {
    const m = montar({ n: 1 });
    m.tarefas(WS, 1, "entregue", "mi_A");
    m.tarefas(WS, 1, "aberta", "mi_A");
    m.banco.executar("UPDATE mission SET estado='concluida' WHERE id='mi_A'");
    m.banco.executar("INSERT INTO maestro_pipeline (id,workspace_id,mission_id,pipeline_id,intencao,estado,via,texto_hash,texto_resumo,nivel_base,nivel_atual,plano_json,criado_em,atualizado_em) VALUES ('pi1',?,'mi_A','p','i','concluido','mcp','h','r',1,1,'{}',?,?)", [WS, TS, TS]);
    expect((await m.servico.obter(WS)).ovo?.tarefas).toBe(1);
  });

  it("Missão concluída sem tasks e pipeline concluído avulso contam cada um uma vez", async () => {
    const m = montar({ n: 1 });
    m.missao(WS, "concluida", "mi_B");
    m.banco.executar("INSERT INTO maestro_pipeline (id,workspace_id,mission_id,pipeline_id,intencao,estado,via,texto_hash,texto_resumo,nivel_base,nivel_atual,plano_json,criado_em,atualizado_em) VALUES ('pi2',?,NULL,'p','i','concluido','mcp','h','r',1,1,'{}',?,?)", [WS, TS, TS]);
    m.banco.executar("INSERT INTO maestro_pipeline (id,workspace_id,mission_id,pipeline_id,intencao,estado,via,texto_hash,texto_resumo,nivel_base,nivel_atual,plano_json,criado_em,atualizado_em) VALUES ('pi3',?,NULL,'p','i','falhou','mcp','h','r',1,1,'{}',?,?)", [WS, TS, TS]);
    m.tarefas(WS, 1, "validada", "mi_C");
    expect((await m.servico.obter(WS)).ovo?.tarefas).toBe(3);
  });

  it("a meta é configurável (2 a 6) pela preferência", async () => {
    const m = montar({ n: 1, prefs: { metaOvo: 2 } });
    m.tarefas(WS, 2);
    m.custo(WS, 150_000);
    expect((await m.servico.obter(WS)).estagio).not.toBe("ovo");
    const m6 = montar({ n: 1, prefs: { metaOvo: 99 } });
    m6.tarefas(WS, 5);
    m6.custo(WS, 150_000);
    const v = await m6.servico.obter(WS);
    expect(v.ovo).toMatchObject({ meta_tarefas: 6, tarefas: 5 });
  });

  it("tarefas de outro workspace não contam", async () => {
    const m = montar({ n: 2 });
    m.tarefas(id(1), 4);
    expect((await m.servico.obter(WS)).ovo?.tarefas).toBe(0);
  });
});

// ServicoCusto (T-10.10): ingestão idempotente de registros de uso JÁ EXTRAÍDOS (os leitores de transcript/rollout são outra onda), cálculo congelado na ingestão,
// atribuição por janela, agregados materializados na MESMA transação, consultas, retenção, reprecificar/reindexar (só por pedido), teto/alertas e diagnóstico.
// Sem Electron e sem rede: relógio, publicação de eventos e configuração entram por injeção. Nunca lê arquivo: recebe `RegistroExtraido[]` (só ts, modelo, tokens, chave, usd).
import type { Banco } from "../banco/banco";
import { agora } from "../banco/tempo";
import { NaoEncontradoErro, ValorInvalidoErro } from "../dominio";
import {
  CONFIG_CUSTO_PADRAO,
  type AgruparCusto,
  type Atribuicao,
  type ConfigCusto,
  type CustoMissao,
  type CustoResumo,
  type CustoSprint,
  type EscopoAgregado,
  type EscopoCusto,
  type EstimativaCusto,
  type EventosDominioCusto,
  type FonteDeUsoEstado,
  type LinhaRelatorio,
  type PedidoGravarPreco,
  type PedidoRelatorioCusto,
  type PrevisaoMissao,
  type PrevisaoPeriodo,
  type Preco,
  type RegistroExtraido,
  type RespostaRelatorioCusto,
  type Tokens,
  type TipoEventoDominioCusto,
} from "../../compartilhado/custo";
import { amostrasCompletas, custoDaSprint, estimar, preverCustoMissao, preverPeriodo, resumir, resumirMissao, somarResumos, type LinhaAgregada } from "./agregar";
import { atribuir, chaveCard, janelasDoBanco, janelasDoRastro, reatribuir, type JanelaTask, type ResultadoAtribuicao } from "./atribuicao";
import { registroParaUsd, tokensZerados } from "./calcular";
import { alertaDeTeto, avaliarOrcamento, tetoEfetivo, type AvaliacaoOrcamento } from "./orcamento";
import { escolherPreco, modelosSemPreco } from "./precos";
import { criarRepoCusto, diaDe, type DeltaAgregado, type FonteUso, type NovaFonteUso, type NovoRegistroUso, type RegistroUso } from "./repos";

export type Publicar = <T extends TipoEventoDominioCusto>(tipo: T, payload: EventosDominioCusto[T]) => void;
export interface ConfigPorta {
  ler(): ConfigCusto;
  gravar(c: ConfigCusto): void;
}
export interface DepsServicoCusto {
  banco: Banco;
  relogio?: () => Date;
  publicar?: Publicar;
  config?: ConfigPorta;
}
export interface ResultadoIngestao {
  novos: number;
  duplicados: number;
}
/** Evento `usage.observed` do proxy OpenRouter (Fase 9): é medido, nunca estimado. */
export interface UsoObservadoProxy {
  pane_id: string;
  modelo: string | null;
  tokens_in: number;
  tokens_out: number;
  usd: number | null;
  ts: string;
  /** id da chamada, quando o proxy informa (idempotência). */
  id?: string;
}

const RETENCAO_REATRIBUIR_DIAS = 7;
const MAX_LINHAS_REL = 200;

interface PaneLinha {
  id: string;
  mission_id: string | null;
  workspace_id: string;
  conta_id: string | null;
  papel: string;
  eh_piloto: number;
  cli: string | null;
}
const ehNumeroNaoNegativo = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0;

/** Deltas de agregado de UM registro (sinal +1 ao ingerir, −1 ao reatribuir). A MESMA função alimenta o incremental e o reindexar (igualdade garantida). */
export function deltasDoRegistro(r: Pick<RegistroUso, "ts" | "modelo" | "tokens_entrada" | "tokens_cache_escrita" | "tokens_cache_leitura" | "tokens_saida" | "usd" | "aproximado" | "pane_id" | "mission_id" | "workspace_id" | "conta_id" | "trabalho_id" | "task_id" | "atribuicao">, sinal: 1 | -1): DeltaAgregado[] {
  const base = {
    dia: diaDe(r.ts),
    modelo: r.modelo ?? "",
    atribuicao: r.atribuicao,
    registros: sinal,
    registros_sem_preco: r.usd === null ? sinal : 0,
    registros_aproximados: r.aproximado === 1 ? sinal : 0,
    tokens_entrada: sinal * r.tokens_entrada,
    tokens_cache_escrita: sinal * r.tokens_cache_escrita,
    tokens_cache_leitura: sinal * r.tokens_cache_leitura,
    tokens_saida: sinal * r.tokens_saida,
    usd_conhecido: sinal * (r.usd ?? 0),
  };
  const saida: DeltaAgregado[] = [];
  const add = (escopo: EscopoAgregado, chave: string | null): void => {
    if (chave !== null && chave !== "") saida.push({ ...base, escopo, chave });
  };
  if (r.atribuicao === "card" && r.workspace_id && r.trabalho_id && r.task_id) {
    add("card", chaveCard(r.workspace_id, r.trabalho_id, r.task_id));
    add("trabalho", `${r.workspace_id}|${r.trabalho_id}`);
  }
  add("missao", r.mission_id);
  add("workspace", r.workspace_id);
  add("conta", r.conta_id);
  add("pane", r.pane_id);
  return saida;
}

/** Funde deltas de mesma chave primária do agregado (um lote de 500 registros vira poucas dezenas de upserts). */
export function fundirDeltas(deltas: Iterable<DeltaAgregado>): DeltaAgregado[] {
  const acumulado = new Map<string, DeltaAgregado>();
  for (const dl of deltas) {
    const k = `${dl.escopo}|${dl.chave}|${dl.dia}|${dl.modelo}|${dl.atribuicao}`;
    const a = acumulado.get(k);
    if (a === undefined) acumulado.set(k, { ...dl });
    else {
      a.registros += dl.registros;
      a.registros_sem_preco += dl.registros_sem_preco;
      a.registros_aproximados += dl.registros_aproximados;
      a.tokens_entrada += dl.tokens_entrada;
      a.tokens_cache_escrita += dl.tokens_cache_escrita;
      a.tokens_cache_leitura += dl.tokens_cache_leitura;
      a.tokens_saida += dl.tokens_saida;
      a.usd_conhecido += dl.usd_conhecido;
    }
  }
  return [...acumulado.values()];
}

export function criarServicoCusto(d: DepsServicoCusto) {
  const banco = d.banco;
  const repo = criarRepoCusto(banco);
  const relogio = d.relogio ?? ((): Date => new Date());
  const agoraIso = (): string => agora(relogio());
  const publicar: Publicar = d.publicar ?? ((): void => undefined);
  let configMem: ConfigCusto = { ...CONFIG_CUSTO_PADRAO };
  const config: ConfigPorta = d.config ?? { ler: () => configMem, gravar: (c) => void (configMem = c) };
  let tabela: Preco[] | null = null;
  let marcos: string[] = [];
  const memoPreco = new Map<string, Preco | null>();
  const tabelaPrecos = (): Preco[] => {
    if (tabela === null) {
      tabela = repo.precos.listar();
      marcos = [...new Set(tabela.map((p) => p.valido_desde))].sort();
      memoPreco.clear();
    }
    return tabela;
  };
  const invalidarTabela = (): void => {
    tabela = null;
    memoPreco.clear();
  };
  /** Preço do modelo no instante `ts`, memoizado por (modelo, balde): o balde é "quantas datas de validade já passaram", então o cache nunca erra a versão do preço. */
  function precoDe(modelo: string | null, ts: string): Preco | null {
    if (modelo === null) return null;
    const t = tabelaPrecos();
    let balde = 0;
    while (balde < marcos.length && (marcos[balde] as string) <= ts) balde++;
    const k = `${modelo}\u0000${balde}`;
    let r = memoPreco.get(k);
    if (r === undefined) {
      r = escolherPreco(t, modelo, ts);
      memoPreco.set(k, r);
    }
    return r;
  }
  const cfg = (): ConfigCusto => ({ ...CONFIG_CUSTO_PADRAO, ...config.ler() });

  const paneDe = (id: string): PaneLinha | undefined => banco.consultarUm<PaneLinha>("SELECT id, mission_id, workspace_id, conta_id, papel, eh_piloto, cli FROM pane WHERE id = ?", [id]);
  const trabalhoDoPane = (p: PaneLinha): { workspace_id: string; trabalho_id: string } | null => {
    if (p.mission_id === null) return null;
    const m = banco.consultarUm<{ trabalho_id: string | null }>("SELECT trabalho_id FROM mission WHERE id = ?", [p.mission_id]);
    return m?.trabalho_id ? { workspace_id: p.workspace_id, trabalho_id: m.trabalho_id } : null;
  };
  const janelasDoPane = (p: PaneLinha): JanelaTask[] => repo.janelas.doPane(p.id, trabalhoDoPane(p));
  const ehPiloto = (p: PaneLinha): boolean => p.papel === "piloto" || p.eh_piloto === 1;

  const aviso = <T extends TipoEventoDominioCusto>(tipo: T, payload: EventosDominioCusto[T]): void => {
    try {
      publicar(tipo, payload);
    } catch {
      /* um ouvinte com erro nunca derruba a ingestão */
    }
  };

  // ---------------------------------------------------------------- alertas e teto
  function verificarTeto(missionId: string): AvaliacaoOrcamento {
    const proprio = repo.tetos.obter(missionId);
    const c = cfg();
    const teto = tetoEfetivo(proprio?.teto_usd ?? null, c);
    if (teto === null) return { estado: "sem_teto", pct: null, restante_usd: null }; // sem teto não há o que somar (evita 3 consultas por lote)
    const r = resumoMissao(missionId);
    const av = avaliarOrcamento(r.usd, teto, c.aviso_teto_pct);
    if (teto === null || r.usd === null) return av;
    const alerta = alertaDeTeto(av, missionId, r.usd, teto);
    if (alerta === null) return av;
    if (alerta.tipo === "teto_missao") {
      if (repo.alertas.registrarUmaVez("teto_missao", missionId, agoraIso())) {
        if (proprio) repo.tetos.marcarAlertado(missionId, agoraIso());
        aviso("cost.ceiling_reached", { mission_id: missionId, usd: r.usd, teto_usd: teto });
      }
    } else if (repo.alertas.registrarUmaVez("aviso_teto_missao", missionId, agoraIso())) {
      aviso("cost.ceiling_warning", { mission_id: missionId, usd: r.usd, teto_usd: teto, pct: Math.round(av.pct ?? 0) });
    }
    return av;
  }
  function alertarPrecosAusentes(modelos: Iterable<string | null>): void {
    if (!cfg().alertar_preco_ausente) return;
    for (const m of modelosSemPreco(tabelaPrecos(), new Set(modelos), agoraIso())) if (repo.alertas.registrarUmaVez("preco_ausente", m, agoraIso())) aviso("cost.price_missing", { modelo: m });
  }
  /** Depois de cadastrar/sincronizar preços: o alerta de modelo que agora tem preço some (e poderá voltar se o preço sumir). */
  function limparAlertasDePrecoResolvidos(): void {
    for (const a of repo.alertas.listar()) if (a.tipo === "preco_ausente" && modelosSemPreco(tabelaPrecos(), [a.alvo], agoraIso()).length === 0) repo.alertas.limpar("preco_ausente", a.alvo);
  }

  // ---------------------------------------------------------------- consultas
  const extrasPane = (paneId: string): string[] => repo.fontes.ausentes({ pane_id: paneId });
  function resumoMissao(missionId: string): CustoMissao {
    const linhas = repo.agregado.consultar("missao", missionId);
    return resumirMissao(linhas, { fontes_ausentes: repo.fontes.ausentes({ mission_id: missionId }), atualizado_em: ultimaAtualizacao() });
  }
  function ultimaAtualizacao(): string | null {
    // última leitura de QUALQUER fonte (poucas linhas): não varre os brutos (não há índice só por `ts`, de propósito, para manter a ingestão barata)
    return banco.consultarUm<{ t: string | null }>("SELECT MAX(ultima_leitura_em) AS t FROM uso_fonte")?.t ?? null;
  }
  function resumo(escopo: EscopoCusto, chave: string): CustoResumo | CustoMissao {
    if (escopo === "sprint") throw new ValorInvalidoErro("escopo", "sprint: use custoSprint");
    if (escopo === "missao") return resumoMissao(chave);
    const extras: string[] = escopo === "pane" ? extrasPane(chave) : escopo === "workspace" ? repo.fontes.ausentes({ workspace_id: chave }) : [];
    return resumir(repo.agregado.consultar(escopo, chave), { fontes_ausentes: extras, atualizado_em: ultimaAtualizacao() });
  }
  /** Resumo de TODOS os cards de um workspace numa consulta (chave `<ws>|<trabalho>|<task>`); card sem uso não aparece no mapa. */
  function resumosDeCards(workspaceId: string): Map<string, CustoResumo> {
    const ult = ultimaAtualizacao();
    return new Map([...repo.agregado.cardsDoWorkspace(workspaceId)].map(([k, ls]) => [k, resumir(ls, { atualizado_em: ult })] as const));
  }
  const resumoCard = (workspaceId: string, trabalhoId: string, taskId: string): CustoResumo => resumir(repo.agregado.consultar("card", chaveCard(workspaceId, trabalhoId, taskId)), { atualizado_em: ultimaAtualizacao() });

  function rotuloDe(agrupar: AgruparCusto, chave: string): string {
    if (agrupar === "missao") return banco.consultarUm<{ t: string }>("SELECT titulo AS t FROM mission WHERE id = ?", [chave])?.t ?? chave;
    if (agrupar === "conta") return banco.consultarUm<{ t: string }>("SELECT rotulo AS t FROM conta WHERE id = ?", [chave])?.t ?? chave;
    if (agrupar === "workspace") return banco.consultarUm<{ t: string }>("SELECT nome AS t FROM workspace WHERE id = ?", [chave])?.t ?? chave;
    if (agrupar === "pane") {
      const p = banco.consultarUm<{ n: number; cli: string | null }>("SELECT display_id AS n, cli FROM pane WHERE id = ?", [chave]);
      return p ? `Pane ${p.n}${p.cli ? ` · ${p.cli}` : ""}` : chave;
    }
    if (agrupar === "card") return chave.split("|").slice(1).join(" · ");
    if (agrupar === "trabalho") return chave.split("|")[1] ?? chave;
    return chave === "" ? "modelo desconhecido" : chave;
  }

  /** Relatório agrupado. Lê o agregado; só cai no bruto (dentro da retenção) quando o filtro cruza dimensões que o agregado não responde. */
  function relatorio(p: PedidoRelatorioCusto): RespostaRelatorioCusto {
    const limite = Math.min(Math.max(1, p.limite ?? 50), MAX_LINHAS_REL);
    const f = p.filtros ?? {};
    const periodo = { desde: p.desde.slice(0, 10), ate: p.ate.slice(0, 10) };
    let linhas: Array<LinhaAgregada & { grupo: string }>;
    const escopoDoGrupo: Partial<Record<AgruparCusto, EscopoAgregado>> = { card: "card", missao: "missao", trabalho: "trabalho", workspace: "workspace", conta: "conta", pane: "pane" };
    const filtrosAtivos = Object.entries(f).filter(([, v]) => v !== undefined && v !== null);
    const modeloFiltro = f.modelo === undefined ? undefined : f.modelo;
    const semOutros = (...ok: string[]): boolean => filtrosAtivos.every(([k]) => ok.includes(k));
    const grupoEscopo = escopoDoGrupo[p.agrupar];
    if (grupoEscopo !== undefined && semOutros("modelo", ...(grupoEscopo === "card" || grupoEscopo === "trabalho" ? ["workspace_id"] : []))) {
      linhas = repo.agregado.agrupar(grupoEscopo, "chave", periodo, { ...(f.workspace_id && (grupoEscopo === "card" || grupoEscopo === "trabalho") ? { prefixoChave: `${f.workspace_id}|` } : {}), ...(modeloFiltro !== undefined ? { modelo: modeloFiltro } : {}) });
    } else if (p.agrupar === "dia" || p.agrupar === "modelo") {
      const por = p.agrupar === "dia" ? "dia" : "modelo";
      let escopo: EscopoAgregado | null = null;
      let filtro: { chave?: string; prefixoChave?: string; sufixoChave?: string; modelo?: string } = {};
      const so = (k: string): boolean => semOutros(k, "modelo");
      if (filtrosAtivos.length === 0 || so("workspace_id")) (escopo = "workspace"), (filtro = f.workspace_id ? { chave: f.workspace_id } : {});
      else if (so("mission_id")) (escopo = "missao"), (filtro = { chave: f.mission_id as string });
      else if (so("conta_id")) (escopo = "conta"), (filtro = { chave: f.conta_id as string });
      if (escopo !== null) {
        if (modeloFiltro !== undefined) filtro.modelo = modeloFiltro;
        linhas = repo.agregado.agrupar(escopo, por, periodo, filtro);
      } else linhas = repo.agregado.agruparBruto(p.agrupar, periodo, f);
    } else {
      const col = ({ card: "task_id", missao: "mission_id", trabalho: "trabalho_id", workspace: "workspace_id", conta: "conta_id", pane: "pane_id" } as const)[p.agrupar as "card"];
      linhas = repo.agregado.agruparBruto(col, periodo, f);
    }
    const grupos = new Map<string, LinhaAgregada[]>();
    for (const l of linhas) (grupos.get(l.grupo) ?? grupos.set(l.grupo, []).get(l.grupo))?.push(l);
    const todas: LinhaRelatorio[] = [...grupos.entries()].map(([chave, ls]) => ({ chave, rotulo: rotuloDe(p.agrupar, chave), custo: resumir(ls) }));
    // ordem: maior custo conhecido primeiro; desconhecidos depois; empate pela chave (estável e paginável por cursor)
    todas.sort((a, b) => (b.custo.usd ?? -1) - (a.custo.usd ?? -1) || (a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0));
    const inicio = p.cursor ? Math.max(0, todas.findIndex((l) => l.chave === p.cursor) + 1) : 0;
    const pagina = todas.slice(inicio, inicio + limite);
    const total = resumir(linhas, { fontes_ausentes: f.workspace_id ? repo.fontes.ausentes({ workspace_id: f.workspace_id }) : f.mission_id ? repo.fontes.ausentes({ mission_id: f.mission_id }) : [] });
    return { linhas: pagina, total, proximo: inicio + limite < todas.length ? (pagina[pagina.length - 1] as LinhaRelatorio).chave : null };
  }

  // ---------------------------------------------------------------- ingestão
  function montarRegistro(fonte: FonteUso, pane: PaneLinha | undefined, janelas: JanelaTask[], r: RegistroExtraido): NovoRegistroUso {
    const medidoOk = r.usd_medido !== undefined && r.usd_medido !== null && ehNumeroNaoNegativo(r.usd_medido);
    const preco = medidoOk ? null : precoDe(r.modelo, r.ts);
    const u = registroParaUsd(r.tokens, r.modelo, r.ts, preco === null ? [] : [preco], medidoOk ? { usd: r.usd_medido as number, origem: fonte.base === "proxy" ? "proxy" : "cli" } : null);
    const a: ResultadoAtribuicao = pane ? atribuir(r.ts, janelas, { papel: ehPiloto(pane) ? "piloto" : pane.papel }) : { atribuicao: "sem_card", trabalho_id: null, task_id: null };
    return {
      fonte_id: fonte.id,
      chave: r.chave,
      ts: r.ts,
      modelo: r.modelo === null || r.modelo.trim() === "" ? null : r.modelo,
      tokens_entrada: Math.max(0, Math.trunc(r.tokens.entrada)),
      tokens_cache_escrita: Math.max(0, Math.trunc(r.tokens.cache_escrita)),
      tokens_cache_leitura: Math.max(0, Math.trunc(r.tokens.cache_leitura)),
      tokens_saida: Math.max(0, Math.trunc(r.tokens.saida)),
      usd: u.usd,
      usd_origem: u.origem,
      preco_id: u.preco_id,
      aproximado: u.aproximado ? 1 : 0,
      pane_id: pane?.id ?? fonte.pane_id,
      mission_id: pane?.mission_id ?? fonte.mission_id,
      workspace_id: pane?.workspace_id ?? fonte.workspace_id,
      conta_id: pane?.conta_id ?? fonte.conta_id,
      trabalho_id: a.trabalho_id,
      task_id: a.task_id,
      atribuicao: a.atribuicao,
    };
  }
  const tokensValidos = (t: Tokens): boolean => ehNumeroNaoNegativo(t.entrada) && ehNumeroNaoNegativo(t.cache_escrita) && ehNumeroNaoNegativo(t.cache_leitura) && ehNumeroNaoNegativo(t.saida);

  function ingerir(fonteId: string, lote: readonly RegistroExtraido[]): ResultadoIngestao {
    const fonte = repo.fontes.obter(fonteId);
    if (!fonte) throw new NaoEncontradoErro("FonteUso", fonteId);
    const pane = fonte.pane_id ? paneDe(fonte.pane_id) : undefined;
    const janelas = pane ? janelasDoPane(pane) : [];
    const validos = lote.filter((r) => typeof r.chave === "string" && r.chave !== "" && Number.isFinite(Date.parse(r.ts)) && tokensValidos(r.tokens));
    const novos: NovoRegistroUso[] = validos.map((r) => montarRegistro(fonte, pane, janelas, r));
    const escopos = new Map<string, { escopo: EscopoAgregado; chave: string }>();
    let inseridos = 0;
    banco.transacao(() => {
      const r = repo; // a transação roda sobre o próprio `banco`: reaproveita as instruções preparadas do repositório
      const flags = r.registros.inserirLote(novos);
      const deltas: DeltaAgregado[] = [];
      flags.forEach((novo, i) => {
        if (!novo) return;
        inseridos++;
        for (const dl of deltasDoRegistro(novos[i] as NovoRegistroUso, 1)) {
          deltas.push(dl);
          escopos.set(`${dl.escopo}|${dl.chave}`, { escopo: dl.escopo, chave: dl.chave });
        }
      });
      r.agregado.aplicar(fundirDeltas(deltas));
      r.fontes.atualizar(fonteId, { ultima_leitura_em: agoraIso(), estado: fonte.estado === "sem_fonte" ? "lendo" : fonte.estado, erro_codigo: null }, agoraIso());
    });
    if (inseridos > 0) {
      aviso("cost.updated", { escopos: [...escopos.values()] });
      alertarPrecosAusentes(novos.map((n) => n.modelo));
      for (const m of new Set(novos.map((n) => n.mission_id))) if (m) verificarTeto(m);
    }
    return { novos: inseridos, duplicados: validos.length - inseridos };
  }

  function ingerirProxy(u: UsoObservadoProxy): ResultadoIngestao {
    const pane = paneDe(u.pane_id);
    if (!pane) throw new NaoEncontradoErro("Pane", u.pane_id);
    const fonte = repo.fontes.garantir({ cli: pane.cli ?? "openrouter", base: "proxy", pane_id: pane.id, mission_id: pane.mission_id, workspace_id: pane.workspace_id, conta_id: pane.conta_id }, agoraIso());
    const chave = u.id ?? `${u.ts}|${u.modelo ?? ""}|${u.tokens_in}|${u.tokens_out}`;
    return ingerir(fonte.id, [{ chave, ts: u.ts, modelo: u.modelo, tokens: { entrada: u.tokens_in, cache_escrita: 0, cache_leitura: 0, saida: u.tokens_out }, usd_medido: u.usd }]);
  }

  /** CLI sem leitor de uso: registra `sem_fonte` visível (custo vira `fontes_ausentes`, NUNCA 0) e avisa uma vez por Pane. */
  function marcarSemFonte(n: Omit<NovaFonteUso, "base" | "estado"> & { pane_id: string }): FonteUso {
    const f = repo.fontes.garantir({ ...n, base: "nenhuma", estado: "sem_fonte" }, agoraIso());
    if (repo.alertas.registrarUmaVez("fonte_ausente", n.pane_id, agoraIso())) aviso("usage.source_missing", { pane_id: n.pane_id, cli: n.cli });
    return f;
  }

  // ---------------------------------------------------------------- janelas e reatribuição
  /** Reatribui os registros recentes de um Pane e ajusta o agregado pela DIFERENÇA (idempotente). */
  function reatribuirPane(paneId: string, desde?: string): number {
    const pane = paneDe(paneId);
    if (!pane) return 0;
    const corte = desde ?? agora(new Date(relogio().getTime() - RETENCAO_REATRIBUIR_DIAS * 86_400_000));
    const regs = repo.registros.doPaneDesde(paneId, corte);
    const mudancas = reatribuir(regs, janelasDoPane(pane), { papel: ehPiloto(pane) ? "piloto" : pane.papel });
    if (mudancas.length === 0) return 0;
    const porId = new Map(regs.map((r) => [r.id, r]));
    const escopos = new Map<string, { escopo: EscopoAgregado; chave: string }>();
    banco.transacao(() => {
      const r = repo; // a transação roda sobre o próprio `banco`: reaproveita as instruções preparadas do repositório
      for (const m of mudancas) {
        const antes = porId.get(m.id) as RegistroUso;
        const depois: RegistroUso = { ...antes, atribuicao: m.para.atribuicao, trabalho_id: m.para.trabalho_id, task_id: m.para.task_id };
        r.agregado.aplicar([...deltasDoRegistro(antes, -1), ...deltasDoRegistro(depois, 1)]);
        r.registros.atribuir(m.id, m.para);
        for (const dl of [...deltasDoRegistro(antes, -1), ...deltasDoRegistro(depois, 1)]) escopos.set(`${dl.escopo}|${dl.chave}`, { escopo: dl.escopo, chave: dl.chave });
      }
    });
    aviso("cost.updated", { escopos: [...escopos.values()] });
    return mudancas.length;
  }
  function panesDoTrabalho(workspaceId: string, trabalhoId: string): string[] {
    return banco.consultar<{ id: string }>("SELECT p.id FROM pane p JOIN mission m ON m.id = p.mission_id WHERE m.workspace_id = ? AND m.trabalho_id = ?", [workspaceId, trabalhoId]).map((l) => l.id);
  }
  /** Recalcula as janelas do BANCO (`task.reivindicada_em → entregue_em`) das Missões do trabalho e reatribui os Panes afetados. */
  function sincronizarJanelasDoBanco(workspaceId: string, trabalhoId: string): number {
    const tasks = banco.consultar<{ task_ref: string; reivindicada_em: string | null; entregue_em: string | null; pane_id: string | null }>(
      "SELECT t.task_ref, t.reivindicada_em, t.entregue_em, t.pane_id FROM task t JOIN mission m ON m.id = t.mission_id WHERE m.workspace_id = ? AND m.trabalho_id = ?",
      [workspaceId, trabalhoId],
    );
    const lista = tasks.flatMap((t) => janelasDoBanco([t], trabalhoId).map((j) => ({ ...j, pane_id: t.pane_id })));
    repo.janelas.substituir(workspaceId, trabalhoId, "banco", lista);
    return panesDoTrabalho(workspaceId, trabalhoId).reduce((n, p) => n + reatribuirPane(p), 0);
  }
  /** Janelas do RASTRO (pares explícitos `task_iniciada → task_concluida`); sem `task_iniciada` não se infere janela. */
  function sincronizarJanelasDoRastro(workspaceId: string, trabalhoId: string, eventos: ReadonlyArray<{ ts: string; evento: string; task: string | null }>): number {
    repo.janelas.substituir(workspaceId, trabalhoId, "rastro", janelasDoRastro(eventos, trabalhoId).map((j) => ({ ...j, pane_id: null })));
    return panesDoTrabalho(workspaceId, trabalhoId).reduce((n, p) => n + reatribuirPane(p), 0);
  }

  // ---------------------------------------------------------------- reconstrução (reindexar / reprecificar / retenção)
  function reconstruirAgregados(desdeDia: string): number {
    let total = 0;
    banco.transacao(() => {
      const r = repo; // a transação roda sobre o próprio `banco`: reaproveita as instruções preparadas do repositório
      r.agregado.limparDesde(desdeDia);
      const todos: DeltaAgregado[] = [];
      let depois = "";
      for (;;) {
        const lote = r.registros.desde(`${desdeDia}T00:00:00.000Z`, 5000, depois);
        if (lote.length === 0) break;
        for (const reg of lote) {
          depois = reg.id;
          total++;
          todos.push(...deltasDoRegistro(reg, 1));
        }
        // funde por lote para a memória ficar limitada ao nº de chaves distintas, não ao nº de registros
        const fundidos = fundirDeltas(todos.splice(0));
        todos.push(...fundidos);
      }
      r.agregado.aplicar(fundirDeltas(todos));
    });
    return total;
  }
  const diaDoCorteBruto = (): string => diaDe(agora(new Date(relogio().getTime() - cfg().retencao_bruta_dias * 86_400_000)));

  /**
   * Reindexa o agregado a partir dos brutos retidos (dias mais antigos que a retenção ficam como estão: o agregado é permanente). Reconstrói o agregado INTEIRO
   * (conta e Pane atravessam workspaces); reler as fontes do início (transcripts) é trabalho do ingestor de arquivos, que reapresenta os registros idempotentemente.
   */
  function reindexar(): { registros: number } {
    return { registros: reconstruirAgregados(diaDoCorteBruto()) };
  }

  /**
   * Reprecifica os registros NÃO medidos (origem tabela/desconhecido) com a tabela VIGENTE. Só por pedido explícito; `simular: true` só conta quantos mudam.
   * Registro medido pela CLI/proxy nunca é tocado.
   */
  function reprecificar(opcoes: { desde?: string; simular?: boolean } = {}): { registros_reprecificados: number } {
    const agoraTs = agoraIso();
    const desde = (opcoes.desde ?? diaDoCorteBruto()).slice(0, 10);
    let mudou = 0;
    const mudancas: Array<{ id: string; usd: number | null; usd_origem: "tabela" | "desconhecido"; preco_id: string | null; aproximado: number }> = [];
    let depois = "";
    for (;;) {
      const lote = repo.registros.desde(`${desde}T00:00:00.000Z`, 5000, depois);
      if (lote.length === 0) break;
      for (const reg of lote) {
        depois = reg.id;
        if (reg.usd_origem === "cli" || reg.usd_origem === "proxy") continue;
        const tokens: Tokens = { entrada: reg.tokens_entrada, cache_escrita: reg.tokens_cache_escrita, cache_leitura: reg.tokens_cache_leitura, saida: reg.tokens_saida };
        const novo = registroParaUsd(tokens, reg.modelo, agoraTs, tabelaPrecos());
        const origem = novo.origem === "desconhecido" ? "desconhecido" : "tabela";
        if (novo.usd !== reg.usd || novo.preco_id !== reg.preco_id || (novo.aproximado ? 1 : 0) !== reg.aproximado || origem !== reg.usd_origem) {
          mudou++;
          mudancas.push({ id: reg.id, usd: novo.usd, usd_origem: origem, preco_id: novo.preco_id, aproximado: novo.aproximado ? 1 : 0 });
        }
      }
    }
    if (opcoes.simular === true || mudancas.length === 0) return { registros_reprecificados: mudou };
    banco.transacao(() => {
      const r = repo; // a transação roda sobre o próprio `banco`: reaproveita as instruções preparadas do repositório
      for (const m of mudancas) r.registros.atualizarUsd(m.id, m);
    });
    reconstruirAgregados(desde);
    limparAlertasDePrecoResolvidos();
    aviso("cost.updated", { escopos: [] });
    return { registros_reprecificados: mudou };
  }

  /** Retenção: apaga brutos acima de `retencao_bruta_dias`; o agregado é permanente. Idempotente. */
  function aplicarRetencao(): { apagados: number } {
    const corte = agora(new Date(relogio().getTime() - cfg().retencao_bruta_dias * 86_400_000));
    return { apagados: repo.registros.apagarAntes(corte) };
  }

  // ---------------------------------------------------------------- preços, fontes, diagnóstico
  function iniciarPrecos(): void {
    repo.precos.semearEmbutidos(agoraIso());
    repo.precos.sincronizarOpenRouter(agoraIso());
    invalidarTabela();
    limparAlertasDePrecoResolvidos();
  }
  function gravarPreco(p: PedidoGravarPreco): Preco {
    const salvo = repo.precos.gravarUsuario(p, agoraIso());
    invalidarTabela();
    limparAlertasDePrecoResolvidos();
    return salvo;
  }
  function apagarPreco(id: string): boolean {
    const ok = repo.precos.apagarUsuario(id);
    invalidarTabela();
    return ok;
  }
  function fontesEstado(workspaceId?: string | null): FonteDeUsoEstado[] {
    const t = relogio().getTime();
    return repo.fontes.listar(workspaceId).map((f) => ({
      pane_id: f.pane_id,
      cli: f.cli,
      estado: f.estado,
      erro_codigo: f.erro_codigo,
      atraso_s: f.ultima_leitura_em === null ? null : Math.max(0, Math.round((t - Date.parse(f.ultima_leitura_em)) / 1000)),
      linhas_puladas: f.linhas_puladas,
    }));
  }
  /** Texto copiável SEM conteúdo: só contagens, estados e offsets (nunca caminho, texto de conversa ou chave). */
  function diagnostico(): string {
    const fs = repo.fontes.listar();
    const por = (e: string): number => fs.filter((f) => f.estado === e).length;
    const linhas = [
      `custo: ${repo.registros.contar()} registros brutos · ${repo.agregado.contar()} linhas agregadas · ${repo.precos.listar().length} preços`,
      `fontes: ${fs.length} (lendo ${por("lendo")} · sem_fonte ${por("sem_fonte")} · erro ${por("erro")} · encerrada ${por("encerrada")})`,
      ...fs.map((f) => `- ${f.cli} base=${f.base} offset=${f.offset} tamanho=${f.tamanho} estado=${f.estado}${f.erro_codigo ? ` erro=${f.erro_codigo}` : ""} puladas=${f.linhas_puladas}`),
      `modelos sem preço: ${repo.registros.modelosSemPreco().join(", ") || "nenhum"}`,
    ];
    return linhas.join("\n");
  }

  // ---------------------------------------------------------------- estimativa e previsões
  const estimarDe = (custosDeCardsConcluidos: ReadonlyArray<CustoResumo>): EstimativaCusto => estimar(amostrasCompletas(custosDeCardsConcluidos));
  function preverMissao(missionId: string, cards: { restantes: number; concluidos: number }, amostras: ReadonlyArray<CustoResumo>): PrevisaoMissao {
    return preverCustoMissao({ custo_atual: resumoMissao(missionId), cards_restantes: cards.restantes, cards_concluidos: cards.concluidos, estimativa: estimarDe(amostras) });
  }
  function serieDiaria(escopo: EscopoAgregado, chave: string, desde: string, ate: string): Array<{ dia: string; usd: number }> {
    const linhas = repo.agregado.agrupar(escopo, "dia", { desde: desde.slice(0, 10), ate: ate.slice(0, 10) }, { chave });
    const m = new Map<string, number>();
    for (const l of linhas) m.set(l.grupo, (m.get(l.grupo) ?? 0) + l.usd_conhecido);
    return [...m.entries()].map(([dia, usd]) => ({ dia, usd })).sort((a, b) => (a.dia < b.dia ? -1 : 1));
  }
  function preverPeriodoDe(escopo: EscopoAgregado, chave: string, inicio: string, fim: string): PrevisaoPeriodo {
    return preverPeriodo({ serie: serieDiaria(escopo, chave, inicio, fim), inicio, fim, hoje: agoraIso() });
  }
  /** Custo de uma sprint: soma dos cards dos itens (`itens[].chave_card` = `ws|trabalho|task`, ou null se o item não está vinculado ao método). */
  function custoSprint(sprintId: string, itens: ReadonlyArray<{ chave_card: string | null }>): CustoSprint {
    return custoDaSprint(sprintId, itens, (k) => {
      const [ws, tr, tk] = k.split("|");
      return ws && tr && tk ? resumoCard(ws, tr, tk) : null;
    });
  }
  /** Custo e tempo de uma task para a Fase 18 (`PortaCusto.janelas`): tokens = entrada + saída observados; `ativo_ms` = soma das janelas fechadas. */
  function janelasParaAgil(ws: string, trabalhoId: string, taskRef: string): { ativo_ms: number; tokens: number | null } | null {
    const r = resumoCard(ws, trabalhoId, taskRef);
    const js = repo.janelas.doCard(ws, trabalhoId, taskRef);
    const base = js.filter((j) => j.origem === (js.some((x) => x.origem === "rastro") ? "rastro" : "banco"));
    const ativo = base.reduce((n, j) => (j.fim === null ? n : n + Math.max(0, Date.parse(j.fim) - Date.parse(j.inicio))), 0);
    if (r.registros === 0 && base.length === 0) return null;
    return { ativo_ms: ativo, tokens: r.registros === 0 ? null : r.tokens.entrada + r.tokens.saida };
  }
  function custoPorModelo(ws: string, trabalhoId: string, taskId: string) {
    return repo.registros.porCard(ws, trabalhoId, taskId).map((l) => ({
      modelo: l.modelo,
      tokens: { entrada: l.entrada, cache_escrita: l.cache_escrita, cache_leitura: l.cache_leitura, saida: l.saida } satisfies Tokens,
      usd: l.registros > l.sem_preco ? l.usd : null,
      origem: l.usd_origem,
      aproximado: l.aproximado === 1,
    }));
  }

  return {
    repo,
    config: { ler: cfg, gravar: (c: ConfigCusto): ConfigCusto => (config.gravar({ ...CONFIG_CUSTO_PADRAO, ...c }), cfg()) },
    iniciarPrecos,
    tabelaPrecos,
    listarPrecos: (): Preco[] => repo.precos.listar(),
    gravarPreco,
    apagarPreco,
    registrarFonte: (n: NovaFonteUso): FonteUso => repo.fontes.garantir(n, agoraIso()),
    marcarSemFonte,
    ingerir,
    ingerirProxy,
    reatribuirPane,
    sincronizarJanelasDoBanco,
    sincronizarJanelasDoRastro,
    resumo,
    resumoMissao,
    resumoCard,
    resumosDeCards,
    relatorio,
    estimarDe,
    preverMissao,
    preverPeriodo: preverPeriodoDe,
    custoSprint,
    janelasParaAgil,
    custoPorModelo,
    somarResumos,
    definirTeto: (missionId: string, tetoUsd: number | null): void => {
      if (!banco.consultarUm("SELECT 1 AS x FROM mission WHERE id = ?", [missionId])) throw new NaoEncontradoErro("Mission", missionId);
      repo.tetos.definir(missionId, tetoUsd);
      if (tetoUsd !== null) verificarTeto(missionId);
    },
    verificarTeto,
    reindexar,
    reprecificar,
    aplicarRetencao,
    fontesEstado,
    diagnostico,
    modelosSemPreco: (): string[] => repo.registros.modelosSemPreco(),
    tokensZerados,
    reconstruirAgregados,
  };
}
export type ServicoCusto = ReturnType<typeof criarServicoCusto>;
export type { Atribuicao };

// Serviço do Bichinho (D-466): nasce sob demanda (nada no boot), calcula espécie e maturidade com cache, guarda o humor por workspace com a
// máquina pura (`humor.ts`) e avisa por UM evento coalescido (`bichinho:mudou`). Sem polling: um único timer de disparo único por workspace,
// só quando o humor vai mudar sozinho (fim da comemoração, hora de dormir). Só contadores; nenhum conteúdo de conversa.
import { TAMANHO_MAX_APELIDO, ESPECIES, type BichinhoVisao, type EspecieId, type EsforcoVisao, type EventoBichinhoMudou, type UsoEspecie } from "../../compartilhado/bichinho";
import { CATALOGO } from "./catalogo";
import { calcularMaturidade, estagioDe, limitarMetaOvo, progressoOvo } from "./crescimento";
import { criarAvaliadorEsforco, criarContadorVazao, criarJanelaTokens, nivelBruto, JANELA_VAZAO_MS, type AvaliadorEsforco, type ContadorVazao, type JanelaTokens } from "./esforco";
import { atribuirEspecie, type Atribuicao } from "./especie";
import { aplicar, estaDoente, humorDe, proximaMudanca, rastroInicial, type EstadoPaneEvento, type EventoHumor, type Rastro } from "./humor";
import type { RepoBichinho } from "./repo";
import { detectarSinais, type LeitorProjeto, type SinaisProjeto } from "./sinais";

export class ErroBichinho extends Error {
  constructor(readonly codigo: "workspace_desconhecido" | "especie_invalida" | "apelido_invalido", mensagem: string) {
    super(mensagem);
    this.name = "ErroBichinho";
  }
}

export const TTL_SINAIS_MS = 10 * 60_000;
export const TTL_CHUNKS_MS = 2 * 60_000;
/** A explicação/sugestão automática (que depende de quem usa cada espécie) é refeita a cada minuto, não a cada publicação. */
export const TTL_AUTO_MS = 60_000;
/** Depois de um evento de trabalho, a maturidade é recalculada uma vez, depois deste silêncio (coalesce). */
export const ATRASO_RECALCULO_MS = 5_000;
/** Pulso de atividade (D-501): a avaliação do esforço é coalescida (≥ 250 ms) e, passada a rajada, segue a cada 1 s só enquanto há esforço. */
export const ATRASO_PULSO_MS = 250;
export const PASSO_DECAIMENTO_MS = 1_000;
/** Depois disto sem consumo medido, o workspace deixa de ter "fonte de tokens" e o esforço cai para a vazão de saída (estimado). */
export const FONTE_TOKENS_VALE_MS = 5 * 60_000;
/** Entrada do usuário recente (digitou agora há pouco). */
export const ENTRADA_RECENTE_MS = 5_000;
const ESFORCO_VAZIO: EsforcoVisao = { nivel: 0, origem: "nenhuma", tokens_por_min: null, bytes_por_s: 0, sessoes_fluindo: 0 };

export interface DepsServicoBichinho {
  repo: RepoBichinho;
  leitorProjeto: (raiz: string) => LeitorProjeto;
  /** linguagens do mapa de código (Fase 17) SÓ se já indexado; `null` caso contrário. Nunca dispara análise. */
  linguagensDoMapa?: (workspaceId: string) => Promise<ReadonlyArray<{ linguagem: string; arquivos: number; loc: number }> | null>;
  /** chunks indexados do RAG (Fase 15); `null` se o RAG ainda não nasceu ou está desligado. */
  chunksDoRag?: (workspaceId: string) => Promise<number | null>;
  emitir: (e: EventoBichinhoMudou) => void;
  /** preferências lidas na hora de usar (nunca guardadas): "Sem repetir espécie" (padrão ligada) e a meta de tarefas do ovo (2 a 6, padrão 4). */
  prefs?: () => { semRepetir?: boolean | undefined; metaOvo?: number | undefined };
  agora?: () => number;
  agendar?: (fn: () => void, ms: number) => { cancelar(): void };
  /** Panes vivos no momento da criação do serviço (semeia o humor; o serviço pode nascer depois do primeiro Pane). */
  panesVivos?: () => Array<{ workspace_id: string; pane_id: string; estado: EstadoPaneEvento }>;
}

interface Vivo {
  rastro: Rastro;
  timer: { cancelar(): void } | null;
  recalculo: { cancelar(): void } | null;
  ultima: BichinhoVisao | null;
  chave: string;
  // ---- esforço (D-500…): só contadores numéricos por sessão, nada de conteúdo
  sessoes: Map<string, ContadorVazao>;
  entradaEm: number;
  tokens: JanelaTokens;
  totalTokens: number | null;
  avaliador: AvaliadorEsforco;
  esforco: EsforcoVisao;
  chaveEsforco: string;
  timerEsforco: { cancelar(): void } | null;
  houveEvento: boolean;
}

const baldeTokens = (n: number | null): number => (n === null || n <= 0 ? 0 : Math.round(Math.log2(n + 1) * 4));

const chaveDe = (v: BichinhoVisao): string => [v.especie, v.apelido, v.estagio, v.maturidade, v.humor, v.doente, v.esforco.nivel, v.esforco.origem, baldeTokens(v.esforco.tokens_por_min), v.esforco.sessoes_fluindo, v.tokens_total > 0 ? Math.floor(Math.log2(v.tokens_total + 1)) : 0, v.conhecimento_itens.total, v.variante ?? 0, v.ovo?.progresso ?? -1, v.ovo?.tarefas ?? 0, v.reatribuido?.de ?? ""].join("|");

/** O que a UI vê: dormindo = 0; trabalhando pelo estado do Pane sem medição ainda vale no mínimo "trabalhando" (origem `estado`). */
function esforcoVisivel(e: EsforcoVisao, humor: BichinhoVisao["humor"]): EsforcoVisao {
  if (humor === "dormindo") return ESFORCO_VAZIO;
  if (humor === "trabalhando" && e.nivel < 2) return { ...e, nivel: 2, origem: e.origem === "nenhuma" ? "estado" : e.origem };
  return e;
}

export function criarServicoBichinho(d: DepsServicoBichinho) {
  const agora = d.agora ?? Date.now;
  const agendar = d.agendar ?? ((fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return { cancelar: () => clearTimeout(t) }; });
  const vivos = new Map<string, Vivo>();
  const sinaisCache = new Map<string, { em: number; sinais: SinaisProjeto }>();
  const chunksCache = new Map<string, { em: number; n: number | null }>();
  const autoCache = new Map<string, { em: number; auto: Atribuicao; dono: string | undefined }>();

  const vivo = (ws: string): Vivo => {
    let v = vivos.get(ws);
    if (v === undefined) { v = {
      rastro: rastroInicial(agora()), timer: null, recalculo: null, ultima: null, chave: "",
      sessoes: new Map(), entradaEm: 0, tokens: criarJanelaTokens(), totalTokens: null, avaliador: criarAvaliadorEsforco(), esforco: ESFORCO_VAZIO, chaveEsforco: "", timerEsforco: null, houveEvento: false,
    }; vivos.set(ws, v); }
    return v;
  };

  async function sinaisDe(ws: string, raiz: string): Promise<SinaisProjeto> {
    const c = sinaisCache.get(ws);
    if (c !== undefined && agora() - c.em < TTL_SINAIS_MS) return c.sinais;
    let mapa: Awaited<ReturnType<NonNullable<DepsServicoBichinho["linguagensDoMapa"]>>> = null;
    try { mapa = (await d.linguagensDoMapa?.(ws)) ?? null; } catch { mapa = null; }
    let sinais: SinaisProjeto;
    try { sinais = detectarSinais(d.leitorProjeto(raiz), mapa ?? undefined); } catch { sinais = { linguagens: [], frameworks: [], tipos: [] }; }
    sinaisCache.set(ws, { em: agora(), sinais });
    return sinais;
  }

  async function chunksDe(ws: string): Promise<number | null> {
    const c = chunksCache.get(ws);
    if (c !== undefined && agora() - c.em < TTL_CHUNKS_MS) return c.n;
    let n: number | null = null;
    try { n = (await d.chunksDoRag?.(ws)) ?? null; } catch { n = null; }
    chunksCache.set(ws, { em: agora(), n });
    return n;
  }

  const usosDe = (excluir?: string): Map<EspecieId, number> => {
    const usos = new Map<EspecieId, number>();
    for (const l of d.repo.todas()) if (l.workspace_id !== excluir) usos.set(l.especie, (usos.get(l.especie) ?? 0) + 1);
    return usos;
  };
  const semRepetir = (): boolean => d.prefs?.().semRepetir !== false;

  /**
   * Correção ÚNICA dos repetidos (D-673), ao nascer o serviço: para cada espécie usada por mais de um workspace, o mais ANTIGO (ordem da primeira atribuição)
   * mantém; os demais, se NÃO foram escolhidos pelo dono, ganham a espécie livre mais afim. Maturidade e estágio ficam como estão. Idempotente: sem repetidos
   * (ou sem espécie livre) não muda nada; repetições de variante (> 0) são as permitidas depois das 100 e não são mexidas.
   */
  let correcao: Promise<void> | null = null;
  const corrigirRepetidos = (): Promise<void> => (correcao ??= (async () => {
    try {
      if (!semRepetir()) return;
      const linhas = d.repo.todas().filter((l) => l.variante === 0);
      const donos = new Map<EspecieId, string>();
      const trocar: Array<(typeof linhas)[number]> = [];
      for (const l of linhas) {
        if (!donos.has(l.especie)) donos.set(l.especie, l.workspace_id);
        else if (!l.especie_manual) trocar.push(l);
      }
      for (const l of trocar) {
        const info = d.repo.workspace(l.workspace_id);
        if (info === undefined) continue;
        const sinais = await sinaisDe(l.workspace_id, info.raiz);
        const a = atribuirEspecie({ sinais, nome: info.nome, workspaceId: l.workspace_id, usos: usosDe(l.workspace_id) });
        if (a.repetiu || a.especie === l.especie) continue;
        d.repo.gravar({ workspace_id: l.workspace_id, especie: a.especie, especie_manual: false, apelido: l.apelido, maturidade: l.maturidade_max, estagio: l.estagio, variante: 0, reatribuido_de: l.especie });
      }
    } catch { /* a correção nunca derruba o bichinho: a próxima execução tenta de novo */ }
  })());

  /** Calcula a visão completa; grava só quando há o que gravar (linha nova, maturidade/estágio/espécie/tarefas mudaram). */
  async function calcular(ws: string): Promise<{ visao: BichinhoVisao; estagioNovo: boolean; nasceu: boolean }> {
    const info = d.repo.workspace(ws);
    if (info === undefined) throw new ErroBichinho("workspace_desconhecido", "Workspace desconhecido.");
    await corrigirRepetidos();
    const sinais = await sinaisDe(ws, info.raiz);
    const chunks = await chunksDe(ws);
    // ---- daqui até o fim: SÍNCRONO, para a escolha da espécie livre e a gravação serem atômicas entre workspaces concorrentes
    const salvo = d.repo.obter(ws);
    const manual: EspecieId | null = salvo?.especie_manual === true ? salvo.especie : null;
    // a atribuição "como seria agora" só é recalculada se não há linha ainda ou passou o TTL (a espécie guardada é a que vale; isto só explica e sugere)
    let c = salvo === undefined ? undefined : autoCache.get(ws);
    if (c === undefined || agora() - c.em > TTL_AUTO_MS) {
      const a = atribuirEspecie({ sinais, nome: info.nome, workspaceId: ws, usos: usosDe(ws), semRepetir: semRepetir() });
      const dono = d.repo.todas().find((l) => l.especie === a.ideal && l.workspace_id !== ws);
      c = { em: agora(), auto: a, dono: dono?.nome };
      autoCache.set(ws, c);
    }
    const auto = c.auto;
    const especie = salvo?.especie ?? auto.especie;
    const variante = salvo?.variante ?? auto.variante;
    const motivo = auto.motivo.filter((x) => !x.startsWith("A mais afim ("));
    if (manual === null && especie !== auto.ideal) motivo.push(`A espécie mais afim ao projeto seria ${CATALOGO[auto.ideal].rotulo.toLowerCase()}${c.dono === undefined ? "" : `, já em uso em ${c.dono}`}`);
    const tokens = d.repo.tokensTotais(ws);
    const memoria = d.repo.memoriaAtiva(ws);
    const eraOvo = salvo === undefined || salvo.estagio === "ovo";
    const meta = limitarMetaOvo(d.prefs?.().metaOvo);
    const tarefas = eraOvo ? Math.max(salvo?.tarefas_concluidas ?? 0, d.repo.tarefasConcluidas(ws)) : salvo.tarefas_concluidas;
    const ovo = progressoOvo({ tarefas, tokens, meta });
    const m = calcularMaturidade({ tokens, conhecimentoItens: memoria + (chunks ?? 0), maximoGuardado: salvo?.maturidade_max ?? 0, estagioGuardado: salvo?.estagio, chocou: eraOvo ? ovo.progresso >= 100 : true });
    const apelido = salvo?.apelido ?? null;
    if (salvo === undefined || salvo.maturidade_max !== m.maturidade || salvo.estagio !== m.estagio || salvo.tarefas_concluidas !== tarefas) {
      d.repo.gravar({ workspace_id: ws, especie, especie_manual: manual !== null, apelido, maturidade: m.maturidade, estagio: m.estagio, variante, tarefas_concluidas: tarefas });
    }
    const reatribuido = salvo?.reatribuido_de ?? null;
    if (reatribuido !== null) d.repo.limparAviso(ws);
    const v = vivo(ws);
    v.totalTokens ??= tokens;
    const t = agora();
    const humor = humorDe(v.rastro, t);
    const visao: BichinhoVisao = {
      workspace_id: ws, especie, especie_automatica: manual === null ? especie : auto.especie, manual: manual !== null, motivo, apelido, estagio: m.estagio, maturidade: m.maturidade,
      componentes: m.componentes, tokens_total: tokens, conhecimento_itens: { memoria, chunks, total: memoria + (chunks ?? 0) },
      humor, doente: estaDoente(v.rastro, t), esforco: esforcoVisivel(v.esforco, humor), em: t,
      variante, ovo: m.estagio === "ovo" ? ovo : null, reatribuido: reatribuido === null ? null : { de: reatribuido },
    };
    return { visao, estagioNovo: salvo !== undefined && m.subiu, nasceu: salvo !== undefined && salvo.estagio === "ovo" && m.estagio !== "ovo" };
  }

  function reagendar(ws: string): void {
    const v = vivo(ws);
    v.timer?.cancelar();
    v.timer = null;
    const t = agora();
    const prox = proximaMudanca(v.rastro, t);
    if (prox !== null) v.timer = agendar(() => { v.timer = null; void publicar(ws, false); }, Math.max(50, prox - t + 20));
  }

  async function publicar(ws: string, forcar: boolean): Promise<BichinhoVisao | null> {
    try {
      const { visao, estagioNovo, nasceu } = await calcular(ws);
      const v = vivo(ws);
      const chave = chaveDe(visao);
      v.ultima = visao;
      if (forcar || estagioNovo || chave !== v.chave) {
        v.chave = chave;
        d.emitir({ workspace_id: ws, visao, estagio_novo: estagioNovo, ...(nasceu ? { nasceu: true } : {}) });
      }
      reagendar(ws);
      return visao;
    } catch {
      return null;
    }
  }

  /** Avalia o esforço agora (taxas das sessões + tokens/min), aplica o pulso na máquina de humor e avisa só se algo visível mudou. Re-agenda enquanto houver esforço. */
  function avaliarEsforco(ws: string): void {
    const v = vivo(ws);
    const t = agora();
    let bytesPorS = 0;
    let fluindo = 0;
    let ultimaSaida = 0;
    for (const [id, c] of v.sessoes) {
      const x = c.taxa(t);
      bytesPorS += x.bytesPorS;
      if (x.bytesPorS > 0) fluindo++;
      ultimaSaida = Math.max(ultimaSaida, c.ultimoEm);
      if (t - c.ultimoEm > 6 * JANELA_VAZAO_MS) v.sessoes.delete(id);
    }
    const medido = v.tokens.ultimoEm > 0 && t - v.tokens.ultimoEm < FONTE_TOKENS_VALE_MS;
    const tpm = medido ? v.tokens.porMinuto(t) : null;
    const bruto = nivelBruto({ tokensPorMin: tpm, bytesPorS, sessoesFluindo: fluindo, entradaRecente: v.entradaEm > 0 && t - v.entradaEm < ENTRADA_RECENTE_MS });
    const atividade = Math.max(ultimaSaida, v.entradaEm, v.tokens.ultimoEm);
    const nivel = v.avaliador.avaliar(bruto.nivel, atividade, t);
    v.esforco = { nivel, origem: bruto.origem, tokens_por_min: tpm === null ? null : Math.round(tpm), bytes_por_s: Math.round(bytesPorS), sessoes_fluindo: fluindo };
    v.rastro = aplicar(v.rastro, { tipo: "pulso", nivel, fluxo: bruto.nivel >= 2, atividade_em: atividade }, t);
    const chave = [nivel, bruto.origem, baldeTokens(v.esforco.tokens_por_min), fluindo, humorDe(v.rastro, t)].join("|");
    if (chave !== v.chaveEsforco) { v.chaveEsforco = chave; void publicar(ws, false); }
    const houve = v.houveEvento;
    v.houveEvento = false;
    if (nivel > 0 || bruto.nivel > 0) v.timerEsforco = agendar(() => { v.timerEsforco = null; avaliarEsforco(ws); }, houve ? ATRASO_PULSO_MS : PASSO_DECAIMENTO_MS);
  }

  /** Um evento de atividade chegou: garante UMA avaliação coalescida. Sem atividade nenhum timer existe (custo ocioso zero). */
  function pulsar(ws: string): void {
    const v = vivo(ws);
    v.houveEvento = true;
    if (v.timerEsforco !== null) return;
    v.timerEsforco = agendar(() => { v.timerEsforco = null; avaliarEsforco(ws); }, ATRASO_PULSO_MS);
  }

  const conhecidos = new Set<string>();
  const conhecido = (ws: string): boolean => {
    if (conhecidos.has(ws)) return true;
    if (d.repo.workspace(ws) === undefined) return false;
    conhecidos.add(ws);
    return true;
  };

  function agendarRecalculo(ws: string): void {
    const v = vivo(ws);
    if (v.recalculo !== null) return;
    v.recalculo = agendar(() => { v.recalculo = null; void publicar(ws, false); }, ATRASO_RECALCULO_MS);
  }

  for (const p of d.panesVivos?.() ?? []) {
    const v = vivo(p.workspace_id);
    v.rastro = aplicar(v.rastro, { tipo: "pane", id: p.pane_id, estado: p.estado }, agora());
  }

  return {
    /** visão atual do workspace (calcula sob demanda; nunca lança para a UI além dos erros nominais). */
    async obter(ws: string): Promise<BichinhoVisao> {
      const { visao } = await calcular(ws);
      const v = vivo(ws);
      v.ultima = visao;
      v.chave = chaveDe(visao);
      reagendar(ws);
      return visao;
    },
    async listar(ids: readonly string[]): Promise<BichinhoVisao[]> {
      const saida: BichinhoVisao[] = [];
      for (const id of ids) {
        try { saida.push(await this.obter(id)); } catch (e) { if (!(e instanceof ErroBichinho)) throw e; }
      }
      return saida;
    },
    /** evento de domínio já traduzido para o workspace: aplica na máquina, avisa se mudou e recalcula a maturidade depois de um silêncio. */
    aoEvento(ws: string, evento: EventoHumor): void {
      if (d.repo.workspace(ws) === undefined) return;
      const v = vivo(ws);
      const novo = aplicar(v.rastro, evento, agora());
      if (novo === v.rastro) return;
      v.rastro = novo;
      void publicar(ws, false);
      if (evento.tipo === "pane" || evento.tipo === "missao" || evento.tipo === "execucao") agendarRecalculo(ws);
    },
    /**
     * Saída do PTY de uma sessão do workspace (no ponto que já agrupa a saída). Só o tamanho entra: `bytes` e `linhas`, nunca o texto.
     * Custo por chamada: somar em um balde. A avaliação é coalescida (≥ 250 ms) e sem atividade não existe timer.
     */
    aoSaida(ws: string, sessaoId: string, bytes: number, linhas: number): void {
      if (!conhecido(ws)) return;
      const v = vivo(ws);
      let c = v.sessoes.get(sessaoId);
      if (c === undefined) { c = criarContadorVazao(); v.sessoes.set(sessaoId, c); }
      c.registrar(bytes, linhas, agora());
      pulsar(ws);
    },
    /** o usuário digitou numa sessão do workspace (atenção, não esforço: nível mínimo "atento"). */
    aoEntrada(ws: string): void {
      if (!conhecido(ws)) return;
      vivo(ws).entradaEm = agora();
      pulsar(ws);
    },
    /** tokens consumidos (in+out) medidos por um leitor, em delta; alimenta a taxa tokens/min do workspace. */
    aoTokens(ws: string, tokens: number): void {
      if (!conhecido(ws) || !Number.isFinite(tokens) || tokens <= 0) return;
      vivo(ws).tokens.somar(tokens, agora());
      pulsar(ws);
    },
    /** `cost.updated` do workspace: o delta é a diferença do total persistido (Claude/Codex/OpenCode). A primeira leitura só marca a linha de base. */
    aoCustoAtualizado(ws: string): void {
      if (!conhecido(ws)) return;
      const v = vivo(ws);
      const total = d.repo.tokensTotais(ws);
      const antes = v.totalTokens;
      v.totalTokens = total;
      if (antes !== null && total > antes) { this.aoTokens(ws, total - antes); if (vivo(ws).ultima?.ovo) agendarRecalculo(ws); }
    },
    /** uma task do workspace foi entregue/validada (ou outro marco de trabalho concluído): o progresso do ovo é recalculado uma vez, depois do silêncio. */
    aoTarefa(ws: string): void {
      if (!conhecido(ws)) return;
      agendarRecalculo(ws);
    },
    aoSessaoEncerrada(ws: string, sessaoId: string): void {
      vivos.get(ws)?.sessoes.delete(sessaoId);
    },
    /** o cartão de cota ≥ 85% é global (a conta serve a todos os workspaces): aplica o sinal em todos os bichinhos já vivos. */
    aoLimite(pct: number): void {
      for (const ws of [...vivos.keys()]) this.aoEvento(ws, { tipo: "limite", pct });
    },
    async atencao(ws: string): Promise<BichinhoVisao> {
      this.aoEvento(ws, { tipo: "atencao" });
      return this.obter(ws);
    },
    async trocarEspecie(ws: string, especie: EspecieId | null): Promise<BichinhoVisao> {
      if (especie !== null && !(ESPECIES as readonly string[]).includes(especie)) throw new ErroBichinho("especie_invalida", "Espécie desconhecida.");
      const atual = await this.obter(ws);
      let nova: EspecieId;
      let variante = 0;
      if (especie !== null) nova = especie;
      else {
        // volta ao automático: a mais afim que nenhum OUTRO workspace usa (a que este já tinha vale, se estiver livre)
        const info = d.repo.workspace(ws);
        if (info === undefined) throw new ErroBichinho("workspace_desconhecido", "Workspace desconhecido.");
        const a = atribuirEspecie({ sinais: await sinaisDe(ws, info.raiz), nome: info.nome, workspaceId: ws, usos: usosDe(ws), semRepetir: semRepetir() });
        nova = a.especie;
        variante = a.variante;
      }
      autoCache.delete(ws);
      d.repo.gravar({ workspace_id: ws, especie: nova, especie_manual: especie !== null, apelido: atual.apelido, maturidade: atual.maturidade, estagio: atual.estagio, variante, reatribuido_de: null });
      const { visao } = await calcular(ws);
      vivo(ws).ultima = visao;
      vivo(ws).chave = chaveDe(visao);
      d.emitir({ workspace_id: ws, visao, estagio_novo: false });
      return visao;
    },
    /** quem usa cada espécie agora (workspaces conhecidos): o seletor marca "já em uso em <workspace>". */
    usos(): UsoEspecie[] {
      return d.repo.todas().map((l) => ({ especie: l.especie, workspace_id: l.workspace_id, workspace_nome: l.nome }));
    },
    async renomear(ws: string, apelido: string | null): Promise<BichinhoVisao> {
      const limpo = apelido === null ? null : apelido.trim().replace(/\s+/g, " ");
      // eslint-disable-next-line no-control-regex
      if (limpo !== null && (limpo.length === 0 || limpo.length > TAMANHO_MAX_APELIDO || /[\u0000-\u001f\u007f]/.test(limpo))) throw new ErroBichinho("apelido_invalido", `O apelido precisa ter de 1 a ${TAMANHO_MAX_APELIDO} caracteres, sem caracteres de controle.`);
      const atual = await this.obter(ws);
      d.repo.gravar({ workspace_id: ws, especie: atual.especie, especie_manual: atual.manual, apelido: limpo, maturidade: atual.maturidade, estagio: atual.estagio });
      const { visao } = await calcular(ws);
      vivo(ws).ultima = visao;
      vivo(ws).chave = chaveDe(visao);
      d.emitir({ workspace_id: ws, visao, estagio_novo: false });
      return visao;
    },
    /** o workspace saiu da lista: esquece o rastro e os timers (o dado persistido fica; a Missão e o histórico também ficam). */
    esquecer(ws: string): void {
      const v = vivos.get(ws);
      v?.timer?.cancelar();
      v?.recalculo?.cancelar();
      v?.timerEsforco?.cancelar();
      vivos.delete(ws);
      conhecidos.delete(ws);
      sinaisCache.delete(ws);
      chunksCache.delete(ws);
      autoCache.delete(ws);
    },
    encerrar(): void {
      for (const v of vivos.values()) { v.timer?.cancelar(); v.recalculo?.cancelar(); v.timerEsforco?.cancelar(); }
      vivos.clear();
    },
    /** estágio de uma maturidade (reexportado para o renderer não duplicar a regra). */
    estagioDe,
  };
}

export type ServicoBichinho = ReturnType<typeof criarServicoBichinho>;

import { rmSync } from "node:fs";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { CONFIG_MAPA_PADRAO, CONFIRMACAO_APAGAR_MAPA, type ConfigMapa, type EventoMapaIpc, type FaseProgressoMapa, type ProgressoMapaIpc, type ResumoMapaIpc } from "../../compartilhado/mapa";
import { abrirArmazem, type Armazem, type ItemExtracao } from "./armazem";
import { detectarFerramentas, type FerramentasMapa } from "./adaptadores/detectar";
import type { CamadaManual } from "./analises/camadas";
import { CHAVE_META_LOCKS, CHAVE_META_MANIFESTOS, CHAVE_META_DERIVADA, executarFaseDerivada, type ResultadoDerivada } from "./derivada";
import type { MensagemDoWorkerDerivada, MensagemIniciarDerivada } from "./worker-derivada";
import { calcularSaidasDoContexto } from "./saidas-derivadas";
import { PASTA_PACOTES, PASTA_PRODUTO } from "./pasta";
import { criarPool, tamanhoPadraoPool, type Pool, type TarefaExtracao } from "./pool";
import type { EntradaCacheVarredura, ArquivoVarrido } from "./varredura";
import { varrer } from "./varredura";
import { VERSAO_EXTRATOR, type Extracao, type Linguagem } from "./tipos";
import type { ExecutorVcs } from "../vcs/executor";

// Serviço do mapa por workspace (T-17.21 completa, D-163): varredura incremental por hash/mtime, extração em POOL de workers,
// gravação em lotes no armazém, fase DERIVADA numa thread própria (resolução, análises, história git), `versao_mapa`,
// cancelamento que deixa o banco consistente (`estado=parcial`), progresso coalescido a 250 ms e serialização de análises
// simultâneas. Orçamento de CPU: nada pesado no thread do chamador; só I/O assíncrono e gravações em fatias com cessão do
// event loop (nenhuma tarefa síncrona acima de ~50 ms). Nada roda sozinho: o serviço só trabalha quando alguém chama `analisar`.
// Nunca executa código do projeto analisado; só lê e parseia.

export interface OpcoesServicoMapa {
  /** Raiz ABSOLUTA do workspace (nunca vem do renderer). */
  raiz: string;
  /** `<userData>/mapas/<workspace_id>/mapa.db`. */
  caminhoDb: string;
  workspaceId: string;
  caminhoWorkerExtracao?: string;
  caminhoWorkerDerivada?: string;
  /** `worker` (padrão, produção) ou `inline` (testes: no mesmo processo). */
  derivada?: "worker" | "inline";
  tamanhoPool?: number;
  emitir?: (e: EventoMapaIpc) => void;
  executorVcs?: ExecutorVcs;
  agora?: () => Date;
  /** Fornece as camadas manuais (arquivo `camadas.json` do workspace), se existirem. */
  camadasManual?: () => CamadaManual[];
  /** Persistência dos aliases/pacote. */
  aoTerminar?: (r: ResultadoAnaliseServico) => void | Promise<void>;
  /** Teste: substitui a detecção de ferramentas. */
  ferramentas?: () => FerramentasMapa;
}

export interface OpcoesAnalisar {
  modo: "completo" | "incremental";
  /**
   * Incremental por LISTA (observador/VCS): só estes caminhos relativos são vistos (stat + hash), sem listar o repositório.
   * Ausente = varredura incremental completa (cache de mtime+tamanho).
   */
  arquivos?: readonly string[];
  historia?: boolean;
  /** Origem: ação do usuário usa até 3 workers; segundo plano usa 1. */
  segundoPlano?: boolean;
}

export interface ResultadoAnaliseServico {
  execucao_id: number;
  estado: "concluida" | "cancelada" | "falhou";
  novos: number;
  alterados: number;
  removidos: number;
  inalterados: number;
  extraidos: number;
  falhas: number;
  versao_mapa: number;
  derivada: ResultadoDerivada | null;
  erro: string | null;
  ms: Record<string, number>;
  avisos: string[];
}

/** Acima deste nº de arquivos extraídos numa análise, o pool é encerrado antes da fase derivada (memória, P-244). */
const LIMITE_POOL_QUENTE = 200;

const limitar = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max);

/** Valida e limita uma configuração parcial (nunca confia no que veio do renderer). */
export function normalizarConfig(base: ConfigMapa, parcial: Record<string, unknown>): ConfigMapa {
  const c: ConfigMapa = { ...base, ignorar: [...base.ignorar] };
  const bool = (k: keyof ConfigMapa): void => {
    if (typeof parcial[k] === "boolean") (c as unknown as Record<string, unknown>)[k] = parcial[k];
  };
  const num = (k: keyof ConfigMapa, min: number, max: number): void => {
    const v = parcial[k];
    if (typeof v === "number" && Number.isFinite(v)) (c as unknown as Record<string, unknown>)[k] = limitar(Math.trunc(v), min, max);
  };
  bool("habilitado");
  bool("auto_atualizar");
  bool("duplicacao");
  bool("expor_agentes");
  num("arquivo_max_bytes", 1_000, 5_000_000);
  num("total_max", 100, 1_000_000);
  num("workers", 0, 3);
  num("historia_janela_dias", 7, 3650);
  num("historia_max_commits", 100, 200_000);
  if (Array.isArray(parcial["ignorar"])) {
    c.ignorar = (parcial["ignorar"] as unknown[])
      .filter((g): g is string => typeof g === "string" && g.length > 0 && g.length <= 200 && !g.includes("\0") && !g.startsWith("/") && !g.split(/[\\/]/).includes(".."))
      .slice(0, 100);
  }
  return c;
}

function extracaoMinima(linguagem: Linguagem, hash: string): Extracao {
  return {
    versao_extrator: VERSAO_EXTRATOR,
    linguagem,
    hash,
    loc: 0,
    loc_codigo: 0,
    loc_comentario: 0,
    complexidade_total: 0,
    complexidade_max: 0,
    erros_parse: 1,
    e_teste: false,
    e_gerado: false,
    truncado: false,
    simbolos: [],
    imports: [],
    chamadas: [],
    herancas: [],
    entradas: [],
    dados: [],
    padroes: [],
    dinamicos: [],
  };
}

export class ServicoMapaCompleto {
  private armazemAberto: Armazem | undefined;
  private pool: Pool | undefined;
  private cadeia: Promise<unknown> = Promise.resolve();
  private controle: AbortController | undefined;
  private workerDerivada: Worker | undefined;
  private progresso: ProgressoMapaIpc | null = null;
  private ultimaEmissao = 0;
  private emAndamento = 0;
  private alterados = new Set<string>();
  private encerrado = false;
  private avisoUltimo: string | null = null;

  constructor(private readonly op: OpcoesServicoMapa) {}

  // ---------------------------------------------------------------------------------------------
  // armazém e configuração

  armazem(): Armazem {
    if (this.encerrado) throw new Error("serviço do mapa encerrado");
    if (this.armazemAberto === undefined) {
      const a = abrirArmazem({ caminho: this.op.caminhoDb, ...(this.op.agora !== undefined ? { agora: this.op.agora } : {}) });
      this.armazemAberto = a;
      if (a.aviso !== null) this.avisoUltimo = `banco do mapa recriado (${a.aviso.motivo}); o antigo foi mantido ao lado, renomeado`;
    }
    return this.armazemAberto;
  }

  config(): ConfigMapa {
    const bruto = this.armazem().lerMeta("config");
    if (bruto === null) return { ...CONFIG_MAPA_PADRAO, ignorar: [] };
    try {
      return normalizarConfig({ ...CONFIG_MAPA_PADRAO, ignorar: [] }, JSON.parse(bruto) as Record<string, unknown>);
    } catch {
      return { ...CONFIG_MAPA_PADRAO, ignorar: [] };
    }
  }

  gravarConfig(parcial: Record<string, unknown>): ConfigMapa {
    const nova = normalizarConfig(this.config(), parcial);
    this.armazem().gravarMeta("config", JSON.stringify(nova));
    return nova;
  }

  // ---------------------------------------------------------------------------------------------
  // estado

  estado(): "vazio" | "parcial" | "pronto" {
    return this.resumoBasico().estado;
  }

  private resumoBasico(): ReturnType<Armazem["resumo"]> {
    return this.armazem().resumo();
  }

  /** O VCS/observador avisa que arquivos mudaram (caminhos relativos). Só marca; não analisa. */
  marcarAlterados(caminhos: Iterable<string>): void {
    for (const c of caminhos) if (this.alterados.size < 100_000) this.alterados.add(c);
  }

  alteradosPendentes(): number {
    return this.alterados.size;
  }

  /** Caminhos relativos marcados/contados como alterados (para a análise incremental por lista). */
  listaAlterados(): string[] {
    return [...this.alterados].filter((c) => !c.startsWith("(")).slice(0, 5_000);
  }

  resumo(): ResumoMapaIpc {
    const a = this.armazem();
    const r = a.resumo();
    const nos = a.contagens().nos;
    const degradadas = Number(a.banco.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM arquivo WHERE degradado = 1")?.n ?? 0);
    const ferr = this.op.ferramentas !== undefined ? this.op.ferramentas() : detectarFerramentas();
    const carimbo = a.lerMeta("pacote_carimbo");
    return {
      estado: this.emAndamento > 0 && r.estado === "pronto" ? "pronto" : r.estado,
      versao_mapa: r.versao_mapa,
      analisado_em: r.analisado_em,
      arquivos: r.arquivos,
      nos,
      linguagens: r.linguagens.map((l) => ({ linguagem: l.linguagem, arquivos: l.arquivos, loc: l.loc })),
      arestas: r.arestas,
      historia: r.historia,
      ferramentas: ferr,
      desatualizado: r.arquivos === 0 ? null : this.alterados.size > 0,
      alterados_n: this.alterados.size,
      degradadas,
      analisando: this.emAndamento > 0,
      progresso: this.progresso,
      configuracao: this.config(),
      aviso: this.avisoUltimo,
      pacote: { carimbo, caminho: carimbo === null ? null : `${PASTA_PACOTES}/${carimbo}` },
      estimativa_arquivos: null,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // análise

  /** Enfileira uma análise e devolve o `execucao_id` na hora; o trabalho segue em segundo plano. Análises simultâneas serializam. */
  async analisar(opcoes: OpcoesAnalisar): Promise<{ execucao_id: number }> {
    const a = this.armazem();
    // anti-inundação: no máximo UMA análise esperando na fila (além da que roda); pedidos extras reaproveitam a que já espera
    if (this.naFila !== null && this.naFila.modo === opcoes.modo && (opcoes.historia ?? false) === this.naFila.historia) return { execucao_id: this.naFila.id };
    const id = a.iniciarExecucao(opcoes.modo, 0);
    this.emAndamento++;
    const fila = { id, modo: opcoes.modo, historia: opcoes.historia ?? false };
    if (this.emAndamento > 1) this.naFila = fila;
    const rodar = (): Promise<ResultadoAnaliseServico> => {
      if (this.naFila === fila) this.naFila = null;
      return this.executar(id, opcoes);
    };
    const p = this.cadeia.then(rodar, rodar);
    this.promessas.set(id, p);
    this.cadeia = p.catch(() => undefined);
    void p
      .catch(() => undefined)
      .finally(() => {
        this.emAndamento--;
      });
    return { execucao_id: id };
  }

  private readonly promessas = new Map<number, Promise<ResultadoAnaliseServico>>();
  private naFila: { id: number; modo: string; historia: boolean } | null = null;

  /** Espera a execução `id` (e as anteriores) terminarem. Para testes e para o encerramento. */
  async aguardarExecucao(id: number): Promise<ResultadoAnaliseServico> {
    const p = this.promessas.get(id);
    if (p === undefined) throw new Error("execução desconhecida");
    return p;
  }

  /** Espera tudo o que está enfileirado. */
  async aguardar(): Promise<void> {
    await this.cadeia;
  }

  /** Enfileira, espera e devolve o resultado (conveniência para testes). */
  async analisarEAguardar(opcoes: OpcoesAnalisar): Promise<ResultadoAnaliseServico> {
    const { execucao_id } = await this.analisar(opcoes);
    return this.aguardarExecucao(execucao_id);
  }

  async cancelar(): Promise<void> {
    this.controle?.abort();
    this.pool?.cancelar();
    this.workerDerivada?.postMessage({ tipo: "cancelar" });
  }

  private emitirProgresso(execId: number, fase: FaseProgressoMapa, feito: number, total: number, forcar = false): void {
    const mudouFase = this.progresso === null || this.progresso.fase !== fase || this.progresso.execucao_id !== execId;
    this.progresso = { execucao_id: execId, fase, feito, total };
    const agora = Date.now();
    if (!forcar && !mudouFase && agora - this.ultimaEmissao < 250) return;
    this.ultimaEmissao = agora;
    this.op.emitir?.({ tipo: "progresso", workspace_id: this.op.workspaceId, progresso: this.progresso });
  }

  private poolDe(segundoPlano: boolean): Pool {
    if (this.pool === undefined) {
      const cfg = this.config();
      const tamanho = this.op.tamanhoPool ?? (cfg.workers > 0 ? cfg.workers : segundoPlano ? 1 : Math.min(tamanhoPadraoPool(), 3));
      this.pool = criarPool({ tamanho, ...(this.op.caminhoWorkerExtracao !== undefined ? { caminhoWorker: this.op.caminhoWorkerExtracao } : {}) });
    }
    return this.pool;
  }

  private async executar(execId: number, opcoes: OpcoesAnalisar): Promise<ResultadoAnaliseServico> {
    const a = this.armazem();
    const cfg = this.config();
    const controle = new AbortController();
    this.controle = controle;
    const sinal = controle.signal;
    const ms: Record<string, number> = {};
    const avisos: string[] = [];
    const res: ResultadoAnaliseServico = { execucao_id: execId, estado: "concluida", novos: 0, alterados: 0, removidos: 0, inalterados: 0, extraidos: 0, falhas: 0, versao_mapa: a.versaoMapa(), derivada: null, erro: null, ms, avisos };
    this.op.emitir?.({ tipo: "progresso", workspace_id: this.op.workspaceId, progresso: { execucao_id: execId, fase: "varrendo", feito: 0, total: 0 } });
    try {
      // ---- varredura + diff por hash/mtime
      let t0 = performance.now();
      this.emitirProgresso(execId, "varrendo", 0, 0, true);
      const d = await this.diferenciar(cfg, opcoes.modo, sinal, (n) => this.emitirProgresso(execId, "varrendo", n, 0), opcoes.modo === "incremental" ? opcoes.arquivos : undefined);
      avisos.push(...d.avisos);
      ms["varredura"] = Math.round(performance.now() - t0);
      if (sinal.aborted) return this.cancelada(res, execId);
      const { varridos, aExtrair, removidos, statAtualizar } = d;
      res.novos = d.novos;
      res.alterados = d.alterados;
      res.inalterados = d.inalterados;
      res.removidos = removidos.length;
      if (statAtualizar.length > 0) {
        a.banco.transacao((tx) => {
          const up = tx.preparar("UPDATE arquivo SET tamanho = ?, mtime_ms = ? WHERE caminho = ?");
          for (const s of statAtualizar) up.executar(s);
        });
      }
      a.gravarMeta(
        CHAVE_META_MANIFESTOS,
        JSON.stringify(varridos.filter((v) => v.categoria === "manifesto").map((v) => v.caminho)),
      );
      a.gravarMeta(
        CHAVE_META_LOCKS,
        JSON.stringify(varridos.filter((v) => v.categoria === "lock").map((v) => v.caminho)),
      );

      // ---- extração em pool (fora do thread do chamador) + gravação em fatias
      t0 = performance.now();
      if (aExtrair.length > 0) {
        const pool = this.poolDe(opcoes.segundoPlano === true);
        const total = aExtrair.length;
        // análise grande: o main só grava `arquivo`+`extracao`; os nós e as arestas próprias nascem na thread da fase derivada (P-12)
        const grande = total > LIMITE_POOL_QUENTE;
        let feitos = 0;
        const lote = 200;
        for (let i = 0; i < aExtrair.length; i += lote) {
          if (sinal.aborted) break;
          const fatia = aExtrair.slice(i, i + lote);
          const tarefas: TarefaExtracao[] = fatia.map((v) => ({ caminho_abs: join(this.op.raiz, v.caminho), raiz: this.op.raiz, caminho: v.caminho, linguagem: v.linguagem, versao_extrator: VERSAO_EXTRATOR, tamanho_max: cfg.arquivo_max_bytes }));
          const resultados = await pool.executarLote(tarefas, {
            signal: sinal,
            aoResultado: () => {
              feitos++;
              this.emitirProgresso(execId, "extraindo", feitos, total);
            },
          });
          const itens: ItemExtracao[] = [];
          resultados.forEach((r, k) => {
            const v = fatia[k] as ArquivoVarrido;
            if (r.ok) {
              itens.push({ caminho: v.caminho, linguagem: v.linguagem, hash: v.hash, tamanho: v.tamanho, mtime_ms: v.mtime_ms, degradado: v.linguagem === "outra", ...(grande ? { semGrafo: true } : {}), extracao: r.extracao });
              res.extraidos++;
            } else if (r.codigo !== "cancelado" && r.codigo !== "encerrado") {
              res.falhas++;
              itens.push({ caminho: v.caminho, linguagem: v.linguagem, hash: v.hash, tamanho: v.tamanho, mtime_ms: v.mtime_ms, degradado: v.linguagem === "outra", ...(grande ? { semGrafo: true } : {}), extracao: extracaoMinima(v.linguagem, v.hash) });
            }
          });
          await a.gravarEmFatias(itens, { orcamentoMs: 8 }); // transações de ≤ ~8 ms (fatias por tempo) que cedem o event loop: o main nunca passa de 50 ms (P-12)
        }
        if (sinal.aborted) {
          a.gravarMeta("estado", "parcial");
          return this.cancelada(res, execId);
        }
      }
      ms["extracao"] = Math.round(performance.now() - t0);
      if (removidos.length > 0) a.removerArquivos(removidos);
      this.alterados.clear();

      // análise grande: libera os workers de extração ANTES da fase derivada (pico de memória = só um dos dois; incremental pequeno mantém o worker quente)
      if (aExtrair.length > LIMITE_POOL_QUENTE && this.pool !== undefined) {
        await this.pool.encerrar();
        this.pool = undefined;
      }

      // ---- fase derivada (thread própria)
      const mudou = res.novos + res.alterados + res.removidos > 0;
      const derivadaAtual = a.lerMeta(CHAVE_META_DERIVADA);
      const precisaDerivar = mudou || opcoes.modo === "completo" || a.lerMeta("estado") !== "pronto" || derivadaAtual === null || Number(derivadaAtual) !== a.versaoMapa() || opcoes.historia === true;
      res.versao_mapa = a.versaoMapa();
      // etapa 1 pronta (P-241): os nós e as arestas PRÓPRIAS dos arquivos alterados já estão no armazém; a UI atualiza já e de novo quando a derivada fechar
      if (mudou) this.op.emitir?.({ tipo: "mudou", workspace_id: this.op.workspaceId, versao_mapa: res.versao_mapa, nos_alterados_n: res.novos + res.alterados + res.removidos });
      if (precisaDerivar) {
        t0 = performance.now();
        a.gravarMeta("estado", "parcial");
        const d = await this.rodarDerivada(execId, cfg, opcoes.historia === true, sinal);
        ms["derivada"] = Math.round(performance.now() - t0);
        if (d === null || d.cancelado) return this.cancelada(res, execId);
        res.derivada = d;
        res.versao_mapa = d.versao_mapa;
        avisos.push(...d.avisos);
      }
      a.finalizarExecucao(execId, "concluida", res.extraidos, res.falhas);
      this.avisoUltimo = avisos.length > 0 ? avisos[0] ?? null : this.avisoUltimo;
      this.progresso = null;
      this.op.emitir?.({ tipo: "mudou", workspace_id: this.op.workspaceId, versao_mapa: res.versao_mapa, nos_alterados_n: res.novos + res.alterados + res.removidos });
      this.op.emitir?.({ tipo: "terminou", workspace_id: this.op.workspaceId, versao_mapa: res.versao_mapa });
      await this.op.aoTerminar?.(res);
      return res;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.estado = "falhou";
      res.erro = msg;
      try {
        a.gravarMeta("estado", "parcial");
        a.finalizarExecucao(execId, "falhou", res.extraidos, res.falhas);
      } catch {
        /* armazém fechado durante a falha */
      }
      this.progresso = null;
      this.op.emitir?.({ tipo: "falhou", workspace_id: this.op.workspaceId, erro: msg });
      return res;
    } finally {
      if (this.controle === controle) this.controle = undefined;
    }
  }

  /** Varre (com o cache de mtime+tamanho do armazém) e compara por hash com o que já está gravado. Não escreve nada. */
  private async diferenciar(cfg: ConfigMapa, modo: "completo" | "incremental", sinal: AbortSignal | undefined, aoProgresso?: (n: number) => void, apenas?: readonly string[]) {
    const a = this.armazem();
    const existentes = new Map<string, { id: number; hash: string; tamanho: number; mtime_ms: number; linguagem: Linguagem; versao_extrator: number | null }>();
    for (const l of a.banco.consultar<{ id: number; caminho: string; hash: string; tamanho: number; mtime_ms: number; linguagem: Linguagem; versao_extrator: number | null }>(
      "SELECT a.id, a.caminho, a.hash, a.tamanho, a.mtime_ms, a.linguagem, e.versao_extrator FROM arquivo a LEFT JOIN extracao e ON e.arquivo_id = a.id",
    )) {
      existentes.set(l.caminho, l);
    }
    const cache = new Map<string, EntradaCacheVarredura>();
    if (modo === "incremental") {
      for (const [c, e] of existentes) cache.set(c, { mtime_ms: e.mtime_ms, tamanho: e.tamanho, hash: e.hash, linguagem: e.linguagem, categoria: "codigo" });
    }
    const varridos: ArquivoVarrido[] = [];
    const avisos: string[] = [];
    const gen = varrer(this.op.raiz, {
      tamanhoMaxBytes: cfg.arquivo_max_bytes,
      totalMax: cfg.total_max,
      ignorar: cfg.ignorar,
      cache,
      ...(apenas !== undefined ? { apenas } : {}),
      ...(sinal !== undefined ? { sinal } : {}),
      ...(this.op.executorVcs !== undefined ? { executor: this.op.executorVcs } : {}),
    });
    for (;;) {
      const r = await gen.next();
      if (r.done === true) {
        if (r.value.truncado) avisos.push(`mapa truncado em ${cfg.total_max} arquivos (configurável em mapa.total_max)`);
        avisos.push(...r.value.avisos);
        break;
      }
      varridos.push(...r.value.arquivos);
      aoProgresso?.(varridos.length);
      if (sinal?.aborted === true) break;
    }
    const codigo = varridos.filter((v) => v.categoria === "codigo");
    const vistos = new Set(codigo.map((v) => v.caminho));
    const aExtrair: ArquivoVarrido[] = [];
    const statAtualizar: Array<[number, number, string]> = [];
    let novos = 0;
    let alterados = 0;
    let inalterados = 0;
    const caminhosAlterados: string[] = [];
    for (const v of codigo) {
      const e = existentes.get(v.caminho);
      if (e === undefined) {
        novos++;
        aExtrair.push(v);
        caminhosAlterados.push(v.caminho);
      } else if (e.hash !== v.hash || e.versao_extrator !== VERSAO_EXTRATOR) {
        alterados++;
        aExtrair.push(v);
        caminhosAlterados.push(v.caminho);
      } else {
        inalterados++;
        if (e.tamanho !== v.tamanho || e.mtime_ms !== Math.trunc(v.mtime_ms)) statAtualizar.push([v.tamanho, Math.trunc(v.mtime_ms), v.caminho]);
      }
    }
    // com lista, só o que foi citado e sumiu conta como removido (o resto do repositório não foi olhado)
    const removidos = apenas === undefined ? [...existentes.keys()].filter((c) => !vistos.has(c)) : [...new Set(apenas)].filter((c) => existentes.has(c) && !vistos.has(c));
    return { varridos, aExtrair, removidos, statAtualizar, novos, alterados, inalterados, avisos, caminhosAlterados };
  }

  /**
   * Conta, SEM extrair nem gravar nada além do cache de stat, quantos arquivos mudaram desde a última análise (banner "N arquivos
   * mudaram"). Só roda com o mapa pronto e nenhuma análise em curso; barato (mtime+tamanho; só re-hasheia o que mudou).
   */
  async verificarMudancas(sinal?: AbortSignal): Promise<{ alterados_n: number }> {
    if (this.emAndamento > 0 || this.armazem().resumo().estado === "vazio") return { alterados_n: this.alterados.size };
    const d = await this.diferenciar(this.config(), "incremental", sinal);
    this.alterados = new Set([...d.caminhosAlterados, ...d.removidos]);
    return { alterados_n: this.alterados.size };
  }

  private cancelada(res: ResultadoAnaliseServico, execId: number): ResultadoAnaliseServico {
    res.estado = "cancelada";
    try {
      const a = this.armazem();
      a.gravarMeta("estado", "parcial");
      a.finalizarExecucao(execId, "cancelada", res.extraidos, res.falhas);
    } catch {
      /* fechado */
    }
    this.progresso = null;
    this.op.emitir?.({ tipo: "terminou", workspace_id: this.op.workspaceId, versao_mapa: res.versao_mapa });
    return res;
  }

  private async rodarDerivada(execId: number, cfg: ConfigMapa, historia: boolean, sinal: AbortSignal): Promise<ResultadoDerivada | null> {
    const camadas = this.op.camadasManual?.() ?? [];
    const progresso = (fase: FaseProgressoMapa, feito: number, total: number): void => this.emitirProgresso(execId, fase, feito, total);
    if ((this.op.derivada ?? "worker") === "inline") {
      return executarFaseDerivada(this.armazem(), { raiz: this.op.raiz, config: cfg, historia, camadasManual: camadas, signal: sinal, progresso, aoConcluir: (ctx) => calcularSaidasDoContexto(this.armazem(), ctx) });
    }
    const caminho = this.op.caminhoWorkerDerivada ?? join(__dirname, "worker-derivada.js");
    return new Promise<ResultadoDerivada | null>((resolve, reject) => {
      // o teto do heap da thread segue o tamanho do mapa (memória, P-244): força coleta frequente em vez de deixar o lixo crescer; mínimo generoso
      const arquivosN = this.armazem().contagens().arquivos;
      const maxOldMb = Math.min(Math.max(96 + Math.ceil(arquivosN * 0.03), 160), 4096);
      const w = new Worker(caminho, { env: {}, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: maxOldMb, maxYoungGenerationSizeMb: 16 } });
      this.workerDerivada = w;
      let fim = false;
      const encerrar = (): void => {
        if (this.workerDerivada === w) this.workerDerivada = undefined;
        void w.terminate();
      };
      const aoAbortar = (): void => w.postMessage({ tipo: "cancelar" });
      sinal.addEventListener("abort", aoAbortar, { once: true });
      w.on("message", (m: MensagemDoWorkerDerivada) => {
        if (m.tipo === "progresso") progresso(m.fase, m.feito, m.total);
        else if (m.tipo === "fim") {
          fim = true;
          sinal.removeEventListener("abort", aoAbortar);
          encerrar();
          resolve(m.resultado);
        } else if (m.tipo === "erro") {
          fim = true;
          sinal.removeEventListener("abort", aoAbortar);
          encerrar();
          reject(new Error(m.erro));
        }
      });
      w.on("error", (e) => {
        if (fim) return;
        fim = true;
        encerrar();
        reject(e);
      });
      w.on("exit", () => {
        if (!fim) {
          fim = true;
          reject(new Error("worker da análise terminou sem resultado"));
        }
      });
      const msg: MensagemIniciarDerivada = { tipo: "iniciar", caminho_db: this.op.caminhoDb, raiz: this.op.raiz, config: cfg, historia, camadas_manual: camadas };
      w.postMessage(msg);
    });
  }

  // ---------------------------------------------------------------------------------------------
  // ciclo de vida

  async apagar(confirmacao: string): Promise<void> {
    if (confirmacao !== CONFIRMACAO_APAGAR_MAPA) throw new Error("confirmação inválida: digite APAGAR");
    await this.cancelar();
    await this.cadeia;
    const config = this.config();
    this.armazem().apagar();
    this.armazemAberto = undefined;
    // o pacote de contexto vive na pasta de pacotes do mapa do repositório: remove só essa pasta
    rmSync(join(this.op.raiz, PASTA_PRODUTO, "mapa"), { recursive: true, force: true });
    this.alterados.clear();
    this.avisoUltimo = null;
    this.armazem().gravarMeta("config", JSON.stringify(config));
  }

  async encerrar(): Promise<void> {
    if (this.encerrado) return;
    await this.cancelar();
    try {
      await this.cadeia;
    } catch {
      /* já tratado */
    }
    this.encerrado = true;
    await this.pool?.encerrar();
    this.pool = undefined;
    void this.workerDerivada?.terminate();
    this.workerDerivada = undefined;
    this.armazemAberto?.fechar();
    this.armazemAberto = undefined;
  }

  /** Handles vivos (P-248): workers de extração e da fase derivada. */
  handles(): { workers_extracao: number; worker_derivada: boolean; armazem_aberto: boolean } {
    return { workers_extracao: this.pool?.vivos ?? 0, worker_derivada: this.workerDerivada !== undefined, armazem_aberto: this.armazemAberto !== undefined };
  }
}

export function criarServicoMapa(op: OpcoesServicoMapa): ServicoMapaCompleto {
  return new ServicoMapaCompleto(op);
}

// Ligação do mapa lógico do código (Fase 17) no main: um serviço por workspace, criado SOB DEMANDA (nada no boot, P-248), com a
// fase de extração em pool de `worker_threads` e a fase derivada em outra thread (o main nunca passa de 50 ms). Sem Electron aqui:
// o `main.ts` injeta a raiz do workspace, o Pane, o diálogo de pasta e o emissor de eventos. O renderer nunca envia caminho:
// a raiz vem do workspace; o destino das exportações vem do main; `docs/**` é sempre recusado.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { EventoMapaIpc, PedidoDisparoMapa, ResultadoDisparoMapa, ResumoMapaIpc } from "../compartilhado/mapa";
import { CONFIG_MAPA_PADRAO } from "../compartilhado/mapa";
import type { PortaMapa as PortaMapaAgil, RaioArquivos } from "../nucleo/agil/portas";
import { ErroConsulta } from "../nucleo/mapa/consultas";
import { dispararNoPane, montarArgumentoDisparo } from "../nucleo/mapa/disparo";
import { criarFachadaMapa, type FachadaMapa } from "../nucleo/mapa/fachada";
import { PASTA_PACOTES } from "../nucleo/mapa/pasta";
import { criarServicoMapa } from "../nucleo/mapa/servico";
import { avaliarPaneDestino } from "../nucleo/metodo/comandos";
import type { PortaMapa as PortaMapaRelatorios } from "../nucleo/relatorios/portas";

/** O mínimo que o mapa precisa saber de um Pane. */
export interface PaneParaMapa {
  id: string;
  workspace_id: string;
  cli: string | null;
  estado: "iniciando" | "pronto" | "trabalhando" | "aguardando" | "bloqueado" | "encerrado";
  papel: string;
}

export interface DepsMapaMain {
  /** `<userData>`: o `mapa.db` mora em `<userData>/mapas/<workspace_id>/`. */
  pastaDados: string;
  /** Raiz ABSOLUTA do workspace ou `null` se não existe. */
  workspaceRaiz: (id: string) => string | null;
  pane: (id: string) => PaneParaMapa | undefined;
  enviarComando: (paneId: string, texto: string) => Promise<void>;
  /** Diálogo nativo de pasta (só o main abre). */
  escolherPasta: () => Promise<string | null>;
  /** Para o renderer (`mapa:evento`) e para o barramento de domínio. */
  emitir: (e: EventoMapaIpc) => void;
  /** Eventos de domínio (`map.analysis_started|progress|finished|failed`, `map.updated`). */
  barramento?: { emitir(tipo: string, payload: unknown): void };
  caminhoWorkerExtracao: string;
  caminhoWorkerDerivada: string;
  /** Detecta se o VCS conhece o workspace (para o scan incremental). */
  aviso?: (m: string) => void;
  /** Instância ociosa por mais de N ms é encerrada (libera banco e workers). Padrão 5 min. */
  ociosoMs?: number;
  /** Respiro depois do aviso do VCS antes de contar o que mudou. Padrão 2 s. */
  atrasoVerificacaoMs?: number;
  agora?: () => Date;
}

export interface GerenciadorMapa {
  /** Fachada do workspace (cria o serviço na primeira chamada). */
  fachada(workspaceId: string): Promise<FachadaMapa>;
  /** Resumo SEM abrir banco nem criar arquivo quando o workspace nunca foi analisado. */
  resumo(workspaceId: string): Promise<ResumoMapaIpc>;
  disparar(workspaceId: string, pedido: PedidoDisparoMapa): Promise<ResultadoDisparoMapa>;
  /** O VCS avisa que arquivos mudaram: só marca "desatualizado" (e agenda análise em ocioso se o usuário optou por isso). */
  aoMudar(workspaceId: string, caminhos: readonly string[]): void;
  /** Portas para as Fases 18 e 19 (a das tools MCP é `criarPortaMapaMcp`, em mapa-mcp.ts). */
  portaAgil(): PortaMapaAgil;
  portaRelatorios(): PortaMapaRelatorios;
  /** Quantos serviços estão vivos (P-248: 0 quando ninguém usa o mapa). */
  vivos(): number;
  /** Encerra os ociosos (o varredor interno chama; testes também). */
  varrerOciosos(): Promise<number>;
  encerrarWorkspace(workspaceId: string): Promise<void>;
  encerrar(): Promise<void>;
}

function resumoVazio(): ResumoMapaIpc {
  return {
    estado: "vazio",
    versao_mapa: 0,
    analisado_em: null,
    arquivos: 0,
    nos: 0,
    linguagens: [],
    arestas: { exata: 0, heuristica: 0 },
    historia: "indisponivel",
    ferramentas: { ctags: false, scc: false, dot: false },
    desatualizado: null,
    alterados_n: 0,
    degradadas: 0,
    analisando: false,
    progresso: null,
    configuracao: { ...CONFIG_MAPA_PADRAO, ignorar: [] },
    aviso: null,
    pacote: { carimbo: null, caminho: null },
    estimativa_arquivos: null,
  };
}

const faixaMin = (f: "BAIXO" | "MEDIO" | "ALTO"): "baixo" | "medio" | "alto" => (f === "BAIXO" ? "baixo" : f === "MEDIO" ? "medio" : "alto");

export function criarGerenciadorMapa(d: DepsMapaMain): GerenciadorMapa {
  interface Inst {
    fachada: FachadaMapa;
    ultimoUso: number;
  }
  const instancias = new Map<string, Inst>();
  const criando = new Map<string, Promise<Inst>>();
  const ociosoMs = d.ociosoMs ?? 5 * 60_000;
  let varredor: NodeJS.Timeout | null = null;
  let encerrado = false;
  const agora = (): number => (d.agora ?? (() => new Date()))().getTime();

  function raizDe(id: string): string {
    const r = d.workspaceRaiz(id);
    if (r === null) throw new ErroConsulta("nao_encontrado", "workspace não encontrado");
    return r;
  }
  const caminhoDb = (id: string): string => join(d.pastaDados, "mapas", id, "mapa.db");

  function emitir(e: EventoMapaIpc): void {
    d.emitir(e);
    try {
      if (e.tipo === "progresso") d.barramento?.emitir("map.analysis_progress", { workspace_id: e.workspace_id, ...e.progresso });
      else if (e.tipo === "mudou") d.barramento?.emitir("map.updated", { workspace_id: e.workspace_id, versao_mapa: e.versao_mapa, nos_alterados_n: e.nos_alterados_n });
      else if (e.tipo === "terminou") d.barramento?.emitir("map.analysis_finished", { workspace_id: e.workspace_id, versao_mapa: e.versao_mapa });
      else if (e.tipo === "falhou") d.barramento?.emitir("map.analysis_failed", { workspace_id: e.workspace_id, erro: e.erro });
    } catch {
      /* um ouvinte do barramento nunca derruba a análise */
    }
  }

  /** Encerra os serviços ociosos (sem análise e sem uso há `ociosoMs`): libera banco e workers. Devolve quantos. */
  async function varrerOciosos(): Promise<number> {
    const limite = agora() - ociosoMs;
    let n = 0;
    for (const [id, inst] of [...instancias]) {
      if (!inst.fachada.servico.resumo().analisando && inst.ultimoUso < limite) {
        await encerrarWorkspace(id);
        n++;
      }
    }
    if (instancias.size === 0 && varredor !== null) {
      clearInterval(varredor);
      varredor = null;
    }
    return n;
  }

  function armarVarredor(): void {
    if (varredor !== null || encerrado) return;
    varredor = setInterval(() => void varrerOciosos().catch(() => undefined), Math.min(Math.max(ociosoMs / 2, 1_000), 60_000));
    varredor.unref();
  }

  async function fachada(id: string): Promise<FachadaMapa> {
    if (encerrado) throw new Error("mapa encerrado");
    const raiz = raizDe(id);
    const existente = instancias.get(id);
    if (existente !== undefined) {
      existente.ultimoUso = agora();
      return existente.fachada;
    }
    let p = criando.get(id);
    if (p === undefined) {
      p = (async (): Promise<Inst> => {
        const servico = criarServicoMapa({
          raiz,
          caminhoDb: caminhoDb(id),
          workspaceId: id,
          caminhoWorkerExtracao: d.caminhoWorkerExtracao,
          caminhoWorkerDerivada: d.caminhoWorkerDerivada,
          derivada: "worker",
          emitir,
          ...(d.agora !== undefined ? { agora: d.agora } : {}),
        });
        const f = criarFachadaMapa(servico, { raiz, pastaExportacao: join(d.pastaDados, "mapas", id, "exportacoes"), escolherPasta: d.escolherPasta, ...(d.agora !== undefined ? { agora: d.agora } : {}) });
        const inst: Inst = { fachada: f, ultimoUso: agora() };
        instancias.set(id, inst);
        armarVarredor();
        return inst;
      })().finally(() => criando.delete(id));
      criando.set(id, p);
    }
    const inst = await p;
    inst.ultimoUso = agora();
    return inst.fachada;
  }

  async function encerrarWorkspace(id: string): Promise<void> {
    const inst = instancias.get(id);
    if (inst === undefined) return;
    instancias.delete(id);
    await inst.fachada.encerrar().catch(() => undefined);
  }

  async function resumo(id: string): Promise<ResumoMapaIpc> {
    raizDe(id);
    if (!instancias.has(id) && !existsSync(caminhoDb(id))) return resumoVazio();
    return (await fachada(id)).resumo();
  }

  async function disparar(id: string, p: PedidoDisparoMapa): Promise<ResultadoDisparoMapa> {
    raizDe(id);
    const pane = d.pane(p.pane_id);
    if (pane === undefined || pane.workspace_id !== id) throw new ErroConsulta("nao_encontrado", "Pane não encontrado neste workspace");
    const aval = avaliarPaneDestino("pedido_cru", { estado: pane.estado, papel: pane.papel as "executor" });
    if (!aval.ok) throw new ErroConsulta("argumento_invalido", aval.motivo);
    // ensaio: valida ação, argumentos e CLI ANTES de gravar qualquer pacote (nada é escrito se o comando seria recusado)
    const pre = montarArgumentoDisparo({ acao: p.acao, pacoteRel: `${PASTA_PACOTES}/00000000T000000Z`, trabalho_id: p.trabalho_id, arquivos: p.arquivos });
    if (!pre.ok) throw new ErroConsulta("argumento_invalido", pre.motivo);
    const ensaio = await dispararNoPane({ ...p, pacoteRel: `${PASTA_PACOTES}/00000000T000000Z`, carimbo: "00000000T000000Z", obterCliDoPane: () => pane.cli, digitar: () => undefined });
    if (!ensaio.ok) throw new ErroConsulta("argumento_invalido", ensaio.motivo);
    const f = await fachada(id);
    const pacote = f.gerarPacote(p.acao === "legadox_raio" && p.trabalho_id !== undefined ? { trabalho_id: p.trabalho_id, arquivos: p.arquivos ?? [] } : undefined);
    const r = await dispararNoPane({ ...p, pacoteRel: pacote.pasta_rel, carimbo: pacote.carimbo, obterCliDoPane: () => pane.cli, digitar: (paneId, texto) => d.enviarComando(paneId, texto) });
    if (!r.ok) throw new ErroConsulta("argumento_invalido", r.motivo);
    return { comando: r.comando, carimbo: r.carimbo, pacote: r.pacote };
  }

  const verificacoes = new Map<string, NodeJS.Timeout>();
  const ATRASO_VERIFICACAO_MS = d.atrasoVerificacaoMs ?? 2_000;

  /** O VCS avisou que algo mudou: depois de um respiro, conta o que mudou DE FATO (stat+hash) e, se o usuário optou, atualiza em ocioso. */
  function aoMudar(id: string, caminhos: readonly string[]): void {
    const inst = instancias.get(id);
    if (inst === undefined || encerrado) return; // sem serviço vivo não há o que marcar (o mapa só trabalha sob demanda)
    if (caminhos.length > 0) inst.fachada.servico.marcarAlterados(caminhos);
    inst.ultimoUso = agora();
    if (verificacoes.has(id)) return;
    const t = setTimeout(() => {
      verificacoes.delete(id);
      const atual = instancias.get(id);
      if (atual === undefined || encerrado) return;
      void (async () => {
        try {
          const cfg = atual.fachada.configLer();
          if (!cfg.habilitado || atual.fachada.servico.resumo().analisando) return;
          const { alterados_n } = await atual.fachada.servico.verificarMudancas();
          if (alterados_n > 0 && cfg.auto_atualizar) await atual.fachada.analisar("incremental", false, true, atual.fachada.servico.listaAlterados()); // 1 worker, em segundo plano, só os arquivos que mudaram
        } catch (e) {
          d.aviso?.(`mapa: verificação de mudanças falhou (${e instanceof Error ? e.message : String(e)})`);
        }
      })();
    }, ATRASO_VERIFICACAO_MS);
    t.unref();
    verificacoes.set(id, t);
  }

  const portaAgil = (): PortaMapaAgil => ({
    async raio(workspaceId, arquivos): Promise<RaioArquivos | null> {
      try {
        if (!existsSync(caminhoDb(workspaceId))) return null;
        const f = await fachada(workspaceId);
        if (f.resumo().estado === "vazio" || arquivos.length === 0) return null;
        const r = f.raio(arquivos.slice(0, 50));
        const cob = r.sinais.find((s) => s.id === 4)?.valor ?? "";
        const zona = r.sinais.find((s) => s.id === 5)?.valor ?? "";
        return { faixa: faixaMin(r.faixa), sem_cobertura: !cob.startsWith("existente"), zona_risco: zona !== "nenhuma zona casada" };
      } catch {
        return null; // arquivo fora do mapa, mapa vazio ou desatualizado: "sem dado", nunca zero
      }
    },
  });

  const portaRelatorios = (): PortaMapaRelatorios => ({
    async alteracoes(workspaceId, arquivos) {
      try {
        if (!existsSync(caminhoDb(workspaceId))) return null;
        const f = await fachada(workspaceId);
        if (f.resumo().estado === "vazio") return null;
        const porModulo = new Map<string, number>();
        for (const c of arquivos.slice(0, 5_000)) {
          const m = c.includes("/") ? c.slice(0, c.lastIndexOf("/")) : ".";
          porModulo.set(m, (porModulo.get(m) ?? 0) + 1);
        }
        const hot = f.analise("hotspots");
        const alvo = new Set(arquivos);
        return {
          modulos: [...porModulo.entries()].map(([nome, n]) => ({ nome, arquivos: n })).sort((a, b) => b.arquivos - a.arquivos || (a.nome < b.nome ? -1 : 1)).slice(0, 50),
          ciclos: f.analise("ciclos").dados.total,
          pontos_quentes: hot.dados.itens.filter((h) => h.faixa === "quente" && alvo.has(h.caminho)).map((h) => h.caminho).slice(0, 20),
        };
      } catch {
        return null;
      }
    },
  });

  return {
    fachada,
    resumo,
    disparar,
    aoMudar,
    portaAgil,
    portaRelatorios,
    vivos: () => instancias.size,
    varrerOciosos,
    encerrarWorkspace,
    async encerrar() {
      encerrado = true;
      for (const t of verificacoes.values()) clearTimeout(t);
      verificacoes.clear();
      if (varredor !== null) clearInterval(varredor);
      varredor = null;
      for (const id of [...instancias.keys()]) await encerrarWorkspace(id);
    },
  };
}

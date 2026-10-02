// Ligação da Memória local (Fase 8, onda 2) no main: serviço, gancho de fechamento na transação do Pane, IPC `memoria:*`, porta do MCP, restore,
// pacote/brief para o lançamento, coletor do barramento, ciclo em ocioso, reindexação do memox (P-25) e métricas do diagnóstico. Sem Electron aqui:
// o `main.ts` injeta o diálogo de salvar, o canal do renderer e o sinal de ociosidade.
//
// LEVEZA (P-01): `ligarMemoria` só cria objetos e registra canais (nenhum I/O). Tudo o que custa (FTS5, coletor, ciclo, vetores) roda em `iniciar()`,
// na onda 2, e o ciclo só trabalha em fatias quando o app está ocioso.
import { chmodSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ConfigMemoria, EstadoMemoriaApp, PayloadsEventoMemoria } from "../compartilhado/memoria";
import type { Banco } from "../nucleo/banco";
import type { Repositorios } from "../nucleo/banco/repos";
import { criarPortaMemoria } from "../nucleo/mcp/memoria-porta";
import type { PortaMemoria } from "../nucleo/mcp/portas";
import {
  conhecimentoNulo,
  criarProvedorHash,
  criarServicoMemoria,
  garantirFts,
  MODELO_HASH,
  raizDaLinhagem,
  resolverContextoDaMissao,
  resolverContextoDoPane,
  type PortaConhecimento,
  type ProvedorEmbedding,
} from "../nucleo/memoria";
import { criarAoEncerrar } from "../nucleo/memoria/fechamento";
import { pacoteDoBanco } from "../nucleo/memoria/pacote";
import { montarBriefDoPane } from "../nucleo/memoria/restaurar";
import { memoxInstalado, reindexarMemox } from "../nucleo/memoria/ponte-memox";
import { registrarEventoDominio } from "../nucleo/missoes/eventos";
import { argumentosDeRetomada, recursosDaFerramenta } from "../nucleo/terminais/catalogo";
import type { Scrubber } from "../nucleo/cofre/scrubber";
import type { Barramento } from "./barramento";
import { registrarIpcMemoria } from "./ipc/memoria";
import type { RegistroIpc } from "./ipc/registro";

/** Teto do brief/pacote que entra no argv de um Pane orquestrado: a CLI aceita ~4 KB por argumento (ver `aliviarArgumentos`). */
export const BRIEF_ARGV_CHARS = 2500;
const ESTADOS_TOLERADOS_OCIOSO_MS = 2_000;
const INTERVALO_CICLO_MS = 30 * 60_000;
const PRIMEIRO_CICLO_MS = 20_000;
const FOME_DO_CICLO_MS = 10 * 60_000;
const RETENCAO_EVENTOS_DIAS = 30;

export type ModoDaMemoria = "off" | "solo" | "missao" | "squad";

export interface DepsMemoria {
  banco: Banco;
  repos: Repositorios;
  barramento: Pick<Barramento, "assinar" | "emitir" | "emitirCoalescido">;
  registro: RegistroIpc;
  /** `ServicoPanes.respawn` (aceita `opcoes` — Fase 8). */
  panes: { respawn(paneId: string, opcoes?: { contexto?: Readonly<Record<string, unknown>>; prompt_inicial?: string | null; argumentos?: string[] }): Promise<{ pane: { id: string }; sessao_id: string }> };
  /** sessão → conversa conhecida (`terminais.conversas.listar`). */
  conversas: () => Record<string, string>;
  /** envia ao renderer da janela atual (no-op sem janela). */
  enviar: <C extends keyof PayloadsEventoMemoria>(canal: C, payload: PayloadsEventoMemoria[C]) => void;
  /** diálogo nativo de salvar; `null` = cancelou. O renderer nunca escolhe o caminho. */
  escolherArquivoDeSaida: (nomeSugerido: string) => Promise<string | null>;
  /** sem flood de PTY e 2 s sem digitação (o main mede pela saída dos terminais). */
  ocioso: () => boolean;
  /** barramento do app: coletor (assina) e reindexação no fim de cada Missão. */
  porta?: PortaConhecimento;
  scrubber?: Pick<Scrubber, "scrub">;
  aviso?: (mensagem: string) => void;
  agora?: () => Date;
  // injeções de teste
  agendar?: (fn: () => void, ms: number) => { cancelar(): void };
  reindexar?: (raiz: string) => Promise<unknown>;
  memoxInstalado?: (raiz: string) => boolean;
}

export interface LigacaoMemoria {
  servico: ReturnType<typeof criarServicoMemoria>;
  /** a porta do MCP (`memory_*` + aviso do `mission_complete`), já com `MemoriaErro` traduzido. */
  portaMcp: PortaMemoria;
  /** modo efetivo da memória do Pane: define as tools `memory_*` do token. Falha = `undefined` (token legado). */
  modoDoPane(paneId: string): ModoDaMemoria | undefined;
  /** pacote da Missão (envelope de dado) já cortado em `orcamentoChars`; `null` = nada a injetar. */
  pacote(paneId: string, papel: "piloto" | "worker", orcamentoChars?: number): string | null;
  /** brief do Pane de origem de um respawn, cortado em `orcamentoChars`; `null` = nada. */
  brief(paneId: string, orcamentoChars: number): string | null;
  /** Onda 2: FTS5, coletor, ciclo em ocioso. Idempotente; cada passo isolado. */
  iniciar(): Promise<void>;
  encerrar(): void;
  /** metadados para o diagnóstico copiável (só contadores; nunca conteúdo). */
  metricas(): Record<string, number>;
}

const dia = (n: number): number => n * 24 * 3_600_000;

export function ligarMemoria(d: DepsMemoria): LigacaoMemoria {
  const { banco, repos, barramento } = d;
  const aviso = (m: string): void => d.aviso?.(m);
  const agora = d.agora ?? ((): Date => new Date());
  const cliTemMcp = (cli: string | null): boolean => cli !== null && recursosDaFerramenta(cli).mcp;
  const raizDoWorkspace = (ws: string): string | undefined => repos.workspace.obter(ws)?.raiz;
  const porta = d.porta ?? conhecimentoNulo;
  const estaInstalado = d.memoxInstalado ?? ((raiz: string) => memoxInstalado(raiz));

  // ---------------------------------------------------------------- eventos: barramento (só metadados) + renderer (coalescido)
  const coalescidos = new Set<string>();
  const desligar: Array<() => void> = [];
  for (const canal of ["memoria:entrada_criada", "memoria:brief_montado", "memoria:restauracao_pedida"] as const) {
    desligar.push(barramento.assinar(canal, (p) => d.enviar(canal, p as never)));
    coalescidos.add(canal);
  }
  const para = (canal: keyof PayloadsEventoMemoria, chave: string, payload: PayloadsEventoMemoria[keyof PayloadsEventoMemoria]): void => barramento.emitirCoalescido(canal, chave, payload, 100);

  /** auditoria `evento_dominio` (retenção de 30 dias, abaixo) + ponte ao renderer. Nenhum payload carrega `conteudo`. */
  const emitir = (tipo: string, payload: Record<string, string | number | boolean>): void => {
    try {
      registrarEventoDominio(banco, tipo, payload);
    } catch {
      /* a auditoria nunca derruba a operação */
    }
    barramento.emitir(tipo, payload);
    if (tipo === "memory.entry_created") {
      para("memoria:entrada_criada", String(payload["entrada_id"] ?? "x"), { entrada_id: String(payload["entrada_id"]), escopo: payload["escopo"] as never, tipo: payload["tipo"] as never });
    } else if (tipo === "memory.brief_built") {
      para("memoria:brief_montado", String(payload["pane_id"] ?? "x"), { pane_id: String(payload["pane_id"]), caracteres: Number(payload["caracteres"] ?? 0), truncado: payload["truncado"] === true });
    } else if (tipo === "pane.restore_requested") {
      para("memoria:restauracao_pedida", String(payload["pane_id"] ?? "x"), { pane_id: String(payload["pane_id"]) });
    }
  };

  // ---------------------------------------------------------------- embedding: só o piso local (hash) e só se algum workspace o escolheu
  let embeddingLigado: boolean | null = null;
  const provedorEmbedding = (): ProvedorEmbedding | null => {
    embeddingLigado ??= banco.consultarUm("SELECT 1 AS x FROM memoria_config WHERE embedding_modelo = ? LIMIT 1", [MODELO_HASH]) !== undefined;
    return embeddingLigado ? criarProvedorHash() : null;
  };

  const servico = criarServicoMemoria({
    banco,
    agora,
    porta,
    ...(d.scrubber ? { scrubber: d.scrubber } : {}),
    raizDoWorkspace,
    cliTemMcp,
    emitir,
    provedorEmbedding,
  });

  // ---------------------------------------------------------------- fechar o Pane com memória NA MESMA transação (T-08.09)
  const aoEncerrar = criarAoEncerrar({ agora, porta, raizDoWorkspace, cliTemMcp, ...(d.scrubber ? { scrubber: d.scrubber } : {}), metricas: servico.metricas });
  repos.pane.definirAoEncerrar((tx, pane, motivo) => {
    try {
      aoEncerrar(tx, pane, motivo ?? "encerrado");
    } catch {
      // a memória nunca impede o fechamento do Pane (a gravação é atômica por savepoint: nada parcial fica)
    }
  });

  // ---------------------------------------------------------------- restore (T-08.14)
  const orquestrado = (paneId: string): boolean => {
    const l = banco.consultarUm<{ modo: string | null; papel: string }>("SELECT m.modo AS modo, p.papel AS papel FROM pane p LEFT JOIN mission m ON m.id = p.mission_id WHERE p.id = ?", [paneId]);
    return l !== undefined && l.modo !== null && l.modo !== "livre" && l.papel !== "nenhum";
  };
  const conversaDe = (paneId: string): string | null => {
    const sessao = banco.consultarUm<{ sessao_pty_id: string | null }>("SELECT sessao_pty_id FROM pane WHERE id = ?", [paneId])?.sessao_pty_id;
    return sessao === null || sessao === undefined ? null : (d.conversas()[sessao] ?? null);
  };
  const restaurador = servico.restaurador({
    cliTemMcp,
    memoxInstalado: (ws) => {
      const raiz = raizDoWorkspace(ws);
      return raiz !== undefined && estaInstalado(raiz);
    },
    podeRetomar: (pane) => pane.cli !== null && argumentosDeRetomada(pane.cli, "x") !== null && conversaDe(pane.id) !== null,
    promptAnterior: () => null, // argv e prompt nunca são persistidos: não há brief antigo para substituir
    aviso: (a) => d.enviar("memoria:aviso", a),
    emitir: (tipo, payload) => emitir(tipo, payload),
    async respawn(paneId, op) {
      let brief = op.contexto.brief;
      // Pane orquestrado: o brief entra no argv da CLI (≤ ~4 KB). Reconstrói um brief menor em vez de truncar o envelope.
      if (brief !== null && brief.length > BRIEF_ARGV_CHARS && orquestrado(paneId)) brief = briefCompacto(paneId, BRIEF_ARGV_CHARS) ?? brief;
      const retomada = op.modo === "retomada";
      const pane = banco.consultarUm<{ cli: string | null }>("SELECT cli FROM pane WHERE id = ?", [paneId]);
      const conversa = retomada ? conversaDe(paneId) : null;
      const retomar = retomada && pane?.cli != null && conversa !== null ? argumentosDeRetomada(pane.cli, conversa) : null;
      const r = await d.panes.respawn(paneId, {
        contexto: { brief },
        prompt_inicial: brief === null ? null : brief === op.contexto.brief ? op.prompt_inicial : brief,
        ...(retomar === null ? {} : { argumentos: retomar }),
      });
      return { pane_id: r.pane.id, sessao_id: r.sessao_id };
    },
  });

  function briefCompacto(paneId: string, orcamento: number): string | null {
    try {
      const b = montarBriefDoPane({ banco, agora, cliTemMcp, memoxInstalado: (ws) => { const raiz = raizDoWorkspace(ws); return raiz !== undefined && estaInstalado(raiz); } }, paneId, { orcamento });
      return b.markdown === "" ? null : b.markdown;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------- exportação: diálogo + gravação atômica 0600 (o usuário escolhe o destino)
  async function salvarExportacao(exportacao: unknown, nomeSugerido: string): Promise<string | null> {
    const caminho = await d.escolherArquivoDeSaida(nomeSugerido);
    if (caminho === null) return null;
    mkdirSync(dirname(caminho), { recursive: true });
    const tmp = `${caminho}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(exportacao, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, caminho);
    if (process.platform !== "win32") chmodSync(caminho, 0o600);
    return caminho;
  }

  // ---------------------------------------------------------------- IPC `memoria:*`
  registrarIpcMemoria({
    registro: d.registro,
    servico: {
      estado: async (ws): Promise<EstadoMemoriaApp> => ({ ...(await servico.estado(ws)), metricas: metricas() }),
      gravarConfig: (ws, patch): ConfigMemoria => {
        const c = servico.gravarConfig(ws, patch);
        if ("embedding_modelo" in patch) embeddingLigado = null;
        return c;
      },
      listar: (f) => servico.listar(f as never),
      atualizar: (p) => servico.atualizar(p),
      esquecer: servico.esquecer,
      esquecerPane: servico.esquecerPane,
      purgar: servico.purgar,
      exportar: servico.exportar,
      briefPrevia: servico.briefPrevia,
      preferencias: servico.preferencias,
    },
    definirMissaoAtiva: (missionId, ativa) => servico.repo.definirMissaoAtiva(missionId, ativa, agora().toISOString()),
    linhagemDe: (paneId) => raizDaLinhagem(banco, paneId),
    restaurar: (paneId, modo) => restaurador.restaurarPane(paneId, modo),
    salvarExportacao,
  });

  // ---------------------------------------------------------------- porta do MCP
  const portaMcp = criarPortaMemoria(
    Object.assign(servico, {
      /** `mission_complete`: só avisa quando a memória está LIGADA para a Missão e o piloto não gravou aprendizado. */
      missaoSemAviso(missionId: string): boolean {
        const ctx = resolverContextoDaMissao(banco, missionId);
        return ctx === null || ctx.modo === "off" ? true : servico.missaoTemAprendizado(missionId);
      },
    }),
  );

  // ---------------------------------------------------------------- ocioso: ciclo (compactação/retenção/purga), vetores, retenção da auditoria
  let iniciado = false;
  let encerrado = false;
  let timer: { cancelar(): void } | null = null;
  let ultimoCiclo = Date.now();
  const agendar = d.agendar ?? ((fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    t.unref();
    return { cancelar: () => clearTimeout(t) };
  });

  async function rodarCiclo(): Promise<void> {
    if (encerrado) return;
    const faminto = Date.now() - ultimoCiclo > FOME_DO_CICLO_MS;
    try {
      await servico.ciclo.executarEmOcioso({ ocioso: () => !encerrado && (faminto || d.ocioso()) });
      if (provedorEmbedding() !== null) {
        // fatias de 50 entradas, uma por vez, só em ocioso
        for (let i = 0; i < 200 && !encerrado && d.ocioso(); i++) {
          const r = await servico.indexarVetoresPendentes(50);
          if (r.restantes === 0) break;
          await new Promise<void>((resolver) => setImmediate(resolver));
        }
      }
      banco.executar("DELETE FROM evento_dominio WHERE tipo LIKE 'memory.%' AND criado_em < ?", [new Date(agora().getTime() - dia(RETENCAO_EVENTOS_DIAS)).toISOString()]);
      ultimoCiclo = Date.now();
    } catch (erro) {
      aviso(`memória: ciclo falhou (${erro instanceof Error ? erro.message : String(erro)})`);
    }
  }
  const reagendar = (ms: number): void => {
    if (encerrado) return;
    timer = agendar(() => void rodarCiclo().finally(() => reagendar(INTERVALO_CICLO_MS)), ms);
  };

  /** P-25: ao fechar uma Missão, o memox reindexa sozinho (script do próprio método, sem modelo e sem rede). Sem memox é no-op. */
  function aoFecharMissao(payload: unknown): void {
    const id = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>)["mission_id"] : null;
    if (typeof id !== "string") return;
    const ws = banco.consultarUm<{ workspace_id: string }>("SELECT workspace_id FROM mission WHERE id = ?", [id])?.workspace_id;
    const raiz = ws === undefined ? undefined : raizDoWorkspace(ws);
    if (raiz === undefined || !estaInstalado(raiz)) return;
    // depois de o coletor gravar o aprendizado e a destilação (mesmo tique do barramento)
    agendar(() => void (d.reindexar ?? ((r: string) => reindexarMemox(r)))(raiz).catch(() => undefined), 1_500);
  }

  function metricas(): Record<string, number> {
    const base = servico.metricas.instantaneo();
    const n = (sql: string): number => Number(banco.consultarUm<{ n: number }>(sql)?.n ?? 0);
    return {
      ...base,
      "entradas.ativas": n("SELECT count(*) AS n FROM memoria_entrada WHERE estado = 'ativa'"),
      "entradas.anel1": n("SELECT count(*) AS n FROM memoria_entrada WHERE estado = 'ativa' AND anel = 1"),
      "entradas.anel2": n("SELECT count(*) AS n FROM memoria_entrada WHERE estado = 'ativa' AND anel = 2"),
      "entradas.anel3": n("SELECT count(*) AS n FROM memoria_entrada WHERE estado = 'ativa' AND anel = 3"),
      "vetores.pendentes": servico.vetoresPendentes(),
    };
  }

  return {
    servico,
    portaMcp,
    modoDoPane(paneId) {
      try {
        return resolverContextoDoPane(banco, paneId, { cliTemMcp }).modo;
      } catch {
        return undefined;
      }
    },
    pacote(paneId, papel, orcamentoChars = BRIEF_ARGV_CHARS) {
      try {
        const p = servico.pacoteDaMissao(paneId, papel);
        if (p.vazio || p.markdown === "") return null;
        if (p.markdown.length <= orcamentoChars) return p.markdown;
        // reconstrói em menor tamanho (sem cortar o envelope no meio)
        const ctx = resolverContextoDoPane(banco, paneId, { cliTemMcp });
        const menor = pacoteDoBanco(banco, ctx, papel, orcamentoChars);
        return menor.vazio ? null : menor.markdown;
      } catch {
        return null;
      }
    },
    brief: briefCompacto,
    async iniciar() {
      if (iniciado || encerrado) return;
      iniciado = true;
      try {
        garantirFts(banco);
      } catch (erro) {
        aviso(`memória: FTS5 indisponível, a busca usa LIKE (${erro instanceof Error ? erro.message : String(erro)})`);
        d.enviar("memoria:aviso", { pane_id: null, codigo: "fts5_indisponivel", mensagem: "A busca da memória usa o modo simples (sem FTS5)." });
      }
      try {
        const coletor = servico.coletor(barramento);
        desligar.push(() => coletor.parar());
      } catch (erro) {
        aviso(`memória: coletor não iniciou (${erro instanceof Error ? erro.message : String(erro)})`);
      }
      desligar.push(barramento.assinar("mission.closed", aoFecharMissao));
      reagendar(PRIMEIRO_CICLO_MS);
    },
    encerrar() {
      encerrado = true;
      timer?.cancelar();
      timer = null;
      repos.pane.definirAoEncerrar(null);
      while (desligar.length > 0) desligar.pop()?.();
    },
    metricas,
  };
}

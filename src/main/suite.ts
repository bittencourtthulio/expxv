// Serviço da suíte ExpxDev no main (D-470…): detecção por workspace (em cache, invalidada pelo observador do método), plano/requisitos e instalação por
// AÇÃO EXPLÍCITA do usuário (exceção ao D-04, ver 01-DECISOES.md D-470). Sob demanda: nada é lido, varrido nem lançado no boot.
//
// COMO LIGAR (main.ts): `registrarIpcSuite({ registro, servico: () => obterSuite() })`; o serviço nasce no primeiro `suite:*`. Ao sair do app,
// `encerrar()` cancela as instalações (árvore de processos morta e limpeza segura) antes do quit.
import { randomUUID } from "node:crypto";
import { access, constants } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import type { EstadoSuite, EventoSuite, ModoInstalacao, PlanoSuite, ProgressoSuite } from "../compartilhado/suite";
import { detectarSuite, type OpcoesDeteccaoSuite, type ResultadoDeteccaoSuite } from "../nucleo/suite/detectar";
import { executarInstalacao, type DependenciasInstalador, type ResultadoInstalacao } from "../nucleo/suite/instalador";
import {
  FLAGS_DO_APP, HARNESS_PADRAO, HARNESS_VALIDOS, LIMITES_SUITE, MAX_FLAGS_INIT, PADRAO_FLAG_INIT, REGISTRO_PADRAO, VERSAO_SUITE_PADRAO, versaoValida,
} from "../nucleo/suite/modelo";
import {
  ambienteDoInstalador, arquivosExistentes, lerVersao, montarPlano, resolverFerramentas, comandoNpm, verificarRequisitosLocais, type SondasRequisitos,
} from "../nucleo/suite/plano";
import type { PedidoProcesso, ResultadoProcesso } from "../nucleo/suite/processo";

/** Erro com texto seguro para a UI (nunca stack, nunca caminho de máquina). */
export class ErroSuite extends Error {
  constructor(mensagem: string) { super(mensagem); this.name = "ErroSuite"; }
}

export interface PreferenciasSuite {
  obter(chave: string): unknown;
  definir(chave: string, valor: unknown): Promise<void>;
}

export interface DependenciasSuite {
  pastaDados: string;
  /** raiz do workspace (nunca vem do renderer) ou `null` */
  raizDe(workspaceId: string): string | null;
  emitir(evento: EventoSuite): void;
  /** barramento de domínio: `suite.instalada`, `suite.falhou`, `suite.cancelada` */
  barramento?: { emitir(tipo: string, payload: unknown): void };
  /** grava no `evento_dominio` (sem segredo) */
  registrarEvento?(tipo: string, payload: Record<string, unknown>): void;
  preferencias: PreferenciasSuite;
  /** scrubber do cofre, se já carregado (devolve `undefined` quando não há cofre aberto) */
  scrub?(): ((texto: string) => string) | undefined;
  /** fim da instalação: grava o arquivo de módulos com o padrão global (se ainda não houver) */
  semearModulos?(workspaceId: string): Promise<void>;
  /** relê o método do workspace SEM reiniciar o app (observador + índice) */
  recarregarMetodo?(workspaceId: string): Promise<void>;
  /** `null` = pasta sem git */
  statusGit?(raiz: string): Promise<{ alteracoes: number } | null>;
  aviso?(mensagem: string): void;
  versaoDaApp?: string;
  // ---- injeções de teste
  ambienteOrigem?: NodeJS.ProcessEnv;
  inicio?: string;
  plataforma?: NodeJS.Platform;
  pastaTemporaria?: string;
  executar?(p: PedidoProcesso): Promise<ResultadoProcesso>;
  sondarRegistro?: DependenciasInstalador["sondarRegistro"];
  agora?(): number;
  tempoTotalMs?: number;
  silencioMs?: number;
  /** quanto tempo a detecção em cache vale sem invalidação (padrão 15 s) */
  validadeCacheMs?: number;
  coalescerMs?: number;
}

export interface ServicoSuite {
  estado(workspaceId: string): Promise<EstadoSuite>;
  requisitos(workspaceId: string): Promise<PlanoSuite>;
  instalar(workspaceId: string, modo: ModoInstalacao): Promise<{ instalacao_id: string }>;
  cancelar(workspaceId: string): Promise<boolean>;
  dispensar(workspaceId: string, dispensar: boolean): Promise<EstadoSuite>;
  /** o observador do método mudou algo: invalida o cache e avisa a UI se o estado mudou */
  aoMetodoMudou(workspaceId: string): void;
  /** ao sair do app: cancela o que estiver instalando (mata a árvore e limpa) */
  encerrar(): Promise<void>;
}

interface Ativa {
  id: string;
  ac: AbortController;
  promessa: Promise<void>;
}

const CHAVE_DISPENSA = (ws: string): string => `suite_dispensada_${ws}`;
const MAX_SIMULTANEAS = 3;

export function criarServicoSuite(deps: DependenciasSuite): ServicoSuite {
  const agora = deps.agora ?? Date.now;
  const inicio = deps.inicio ?? homedir();
  const plataforma = deps.plataforma ?? process.platform;
  const aviso = (m: string): void => deps.aviso?.(`suite: ${m}`);
  const ativas = new Map<string, Ativa>();
  const cache = new Map<string, { em: number; resultado: ResultadoDeteccaoSuite }>();
  const ultimoEstado = new Map<string, string>();
  let encerrado = false;

  // ---------------------------------------------------------------- preferências (validadas: nada do que está salvo vira argumento sem checagem)
  const versaoPedida = (): string => {
    const v = deps.preferencias.obter("suite_versao");
    return versaoValida(v) ? v : VERSAO_SUITE_PADRAO;
  };
  const registro = (): string => {
    const v = deps.preferencias.obter("suite_registro");
    if (typeof v !== "string") return REGISTRO_PADRAO;
    try {
      const u = new URL(v);
      return u.protocol === "https:" && u.username === "" && u.password === "" && v.length <= 200 ? (v.endsWith("/") ? v : `${v}/`) : REGISTRO_PADRAO;
    } catch { return REGISTRO_PADRAO; }
  };
  /** extras do usuário: só `--palavra`, nunca as flags que o app controla (`--yes`, `--skills`, `--harness`…) */
  const extrasInit = (): string[] => {
    const v = deps.preferencias.obter("suite_init_args");
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === "string" && PADRAO_FLAG_INIT.test(x) && !FLAGS_DO_APP.includes(x)).slice(0, MAX_FLAGS_INIT);
  };
  const harnessInit = (): string[] => {
    const v = deps.preferencias.obter("suite_harness");
    const ok = Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && HARNESS_VALIDOS.includes(x)))] : [];
    return ok.length > 0 ? ok : [...HARNESS_PADRAO];
  };

  const raizObrigatoria = (ws: string): string => {
    const raiz = deps.raizDe(ws);
    if (raiz === null) throw new ErroSuite("Workspace desconhecido.");
    return raiz;
  };

  // ---------------------------------------------------------------- ferramentas
  const ambiente = (): Record<string, string> => {
    const s = deps.scrub?.();
    return ambienteDoInstalador({ ...(deps.ambienteOrigem === undefined ? {} : { origem: deps.ambienteOrigem }), inicio, plataforma, ...(s === undefined ? {} : { scrub: s }) });
  };
  const nodeDisponivel = (): boolean => {
    const f = resolverFerramentas(ambiente(), tmpdir(), plataforma);
    return comandoNpm(f, plataforma) !== null && f.node !== null;
  };

  async function detectar(ws: string, raiz: string, forcar = false): Promise<ResultadoDeteccaoSuite> {
    const c = cache.get(ws);
    if (!forcar && c !== undefined && agora() - c.em < (deps.validadeCacheMs ?? 15_000)) return c.resultado;
    const op: OpcoesDeteccaoSuite = { nodeDisponivel };
    const resultado = await detectarSuite(raiz, op);
    cache.set(ws, { em: agora(), resultado });
    return resultado;
  }

  const montarEstado = (ws: string, d: ResultadoDeteccaoSuite): EstadoSuite => ({
    workspace_id: ws, estado: d.estado, motivo: d.motivo, versao_instalada: d.versao_instalada, versao_pedida: versaoPedida(), skills_presentes: d.skills_presentes, skills_faltando: d.skills_faltando,
    dispensado: deps.preferencias.obter(CHAVE_DISPENSA(ws)) === true, instalando: ativas.has(ws), instalacao_id: ativas.get(ws)?.id ?? null,
  });

  const assinaturaDe = (e: EstadoSuite): string => `${e.estado}|${e.versao_instalada ?? ""}|${e.skills_faltando.length}|${e.dispensado}|${e.instalando}`;

  async function estado(ws: string, forcar = false): Promise<EstadoSuite> {
    const raiz = raizObrigatoria(ws);
    const e = montarEstado(ws, await detectar(ws, raiz, forcar));
    ultimoEstado.set(ws, assinaturaDe(e));
    return e;
  }

  async function publicarEstado(ws: string, forcar: boolean): Promise<void> {
    if (encerrado || deps.raizDe(ws) === null) return;
    try {
      const e = await estado(ws, forcar);
      deps.emitir({ tipo: "estado", estado: e });
    } catch (erro) { aviso(`estado de ${ws}: ${erro instanceof Error ? erro.message : String(erro)}`); }
  }

  // ---------------------------------------------------------------- requisitos / plano
  function sondas(): SondasRequisitos {
    const env = ambiente();
    const f = resolverFerramentas(env, tmpdir(), plataforma);
    const npm = comandoNpm(f, plataforma);
    const ler = (exe: string | null, args: readonly string[]): Promise<string | null> => (exe === null ? Promise.resolve(null)
      : lerVersao({ executavel: exe, argumentos: args, cwd: tmpdir(), env, plataforma, ...(deps.executar === undefined ? {} : { executar: deps.executar }) }));
    return {
      versaoNode: () => ler(f.node, ["--version"]),
      versaoNpm: () => (npm === null ? Promise.resolve(null) : ler(npm.executavel, [...npm.prefixo, "--version"])),
      gravavel: async (raiz) => { try { await access(raiz, constants.W_OK); return true; } catch { return false; } },
      statusGit: (raiz) => (deps.statusGit === undefined ? Promise.resolve(null) : deps.statusGit(raiz)),
      versaoGit: () => (f.git === null ? Promise.resolve(null) : ler(f.git, ["--version"])),
    };
  }

  async function requisitos(ws: string): Promise<PlanoSuite> {
    const raiz = raizObrigatoria(ws);
    const det = await detectar(ws, raiz, true);
    const modo: ModoInstalacao = det.estado === "desatualizada" ? "atualizar" : det.estado === "ausente" || det.estado === "indisponivel" ? "instalar" : "reparar";
    const [reqs, existentes] = await Promise.all([verificarRequisitosLocais(raiz, sondas()), arquivosExistentes(raiz)]);
    return montarPlano({ workspace_id: ws, raiz, modo, versao: versaoPedida(), registro: registro(), harness: harnessInit(), extras: extrasInit(), requisitos: reqs, existentes, instaladas: det.skills_presentes, inicio });
  }

  // ---------------------------------------------------------------- instalar
  function criarEmissor(): { alterou(p: ProgressoSuite): void; limpar(): void } {
    let ultimo: ProgressoSuite | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soltar = (): void => { timer = null; if (ultimo !== null) { const p = ultimo; ultimo = null; deps.emitir(p); } };
    return {
      alterou(p) {
        ultimo = p;
        if (p.fase !== "rodando") { if (timer !== null) clearTimeout(timer); soltar(); return; }
        if (timer === null) { timer = setTimeout(soltar, deps.coalescerMs ?? LIMITES_SUITE.coalescer_ms); timer.unref(); }
      },
      limpar() { if (timer !== null) clearTimeout(timer); timer = null; },
    };
  }

  async function instalar(ws: string, modo: ModoInstalacao): Promise<{ instalacao_id: string }> {
    if (encerrado) throw new ErroSuite("O app está fechando.");
    const raiz = raizObrigatoria(ws);
    if (ativas.has(ws)) throw new ErroSuite("Já há uma instalação em andamento neste projeto.");
    if (ativas.size >= MAX_SIMULTANEAS) throw new ErroSuite("Há instalações demais em andamento. Aguarde uma terminar.");
    const det = await detectar(ws, raiz, true);
    if (det.estado === "completa" && modo === "instalar") throw new ErroSuite("A suíte ExpxDev já está instalada neste projeto.");
    const id = `suite_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const ac = new AbortController();
    const emissor = criarEmissor();
    const s = deps.scrub?.();
    const versao = versaoPedida();
    const pedido: DependenciasInstalador = {
      workspace_id: ws, instalacao_id: id, raiz, modo, versao, registro: registro(), harness: harnessInit(), extras: extrasInit(), ambiente: ambiente(),
      ...(deps.ambienteOrigem === undefined ? {} : { ambienteOrigem: deps.ambienteOrigem }), inicio, plataforma, ...(s === undefined ? {} : { scrub: s }),
      pastaDados: deps.pastaDados, ...(deps.pastaTemporaria === undefined ? {} : { pastaTemporaria: deps.pastaTemporaria }),
      ...(deps.executar === undefined ? {} : { executar: deps.executar }), ...(deps.sondarRegistro === undefined ? {} : { sondarRegistro: deps.sondarRegistro }),
      ...(deps.agora === undefined ? {} : { agora: deps.agora }), ...(deps.tempoTotalMs === undefined ? {} : { tempoTotalMs: deps.tempoTotalMs }),
      ...(deps.silencioMs === undefined ? {} : { silencioMs: deps.silencioMs }), ...(deps.versaoDaApp === undefined ? {} : { versaoDaApp: deps.versaoDaApp }),
      aoMudar: (p) => emissor.alterou(p),
    };
    const promessa = (async () => {
      let r: ResultadoInstalacao | null = null;
      try {
        r = await executarInstalacao(pedido, ac.signal);
      } catch (e) {
        aviso(`instalação ${id}: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        emissor.limpar();
        ativas.delete(ws);
      }
      await concluir(ws, modo, r);
    })();
    ativas.set(ws, { id, ac, promessa });
    // estado `instalando` para o cabeçalho
    void publicarEstado(ws, false);
    return { instalacao_id: id };
  }

  async function concluir(ws: string, modo: ModoInstalacao, r: ResultadoInstalacao | null): Promise<void> {
    cache.delete(ws);
    const p = r?.progresso;
    try {
      if (p?.fase === "concluida" && p.resumo !== null) {
        const base = { workspace_id: ws, modo, versao: p.resumo.versao, skills: p.resumo.skills.length, criados: p.resumo.criados.slice(0, 100), alterados: p.resumo.alterados.slice(0, 100), fora_do_esperado: p.resumo.fora_do_esperado.length, doctor: p.resumo.doctor, duracao_ms: p.decorrido_ms };
        deps.barramento?.emitir("suite.instalada", base);
        deps.registrarEvento?.("suite.instalada", base);
        try { await deps.semearModulos?.(ws); } catch (e) { aviso(`semear módulos: ${e instanceof Error ? e.message : String(e)}`); }
        try { await deps.recarregarMetodo?.(ws); } catch (e) { aviso(`recarregar método: ${e instanceof Error ? e.message : String(e)}`); }
      } else if (p?.fase === "falhou") {
        const base = { workspace_id: ws, modo, causa: p.falha?.causa ?? "interna", etapa: p.falha?.etapa ?? "requisitos", codigo: p.falha?.codigo ?? null, duracao_ms: p.decorrido_ms };
        deps.barramento?.emitir("suite.falhou", base);
        deps.registrarEvento?.("suite.falhou", base);
      } else if (p?.fase === "cancelada") {
        const base = { workspace_id: ws, modo, duracao_ms: p.decorrido_ms };
        deps.barramento?.emitir("suite.cancelada", base);
        deps.registrarEvento?.("suite.cancelada", base);
      }
    } catch (e) { aviso(`evento: ${e instanceof Error ? e.message : String(e)}`); }
    await publicarEstado(ws, true);
  }

  return {
    estado: (ws) => estado(ws),
    requisitos,
    instalar,

    async cancelar(ws) {
      const a = ativas.get(ws);
      if (a === undefined) return false;
      a.ac.abort();
      return true;
    },

    async dispensar(ws, dispensar) {
      raizObrigatoria(ws);
      await deps.preferencias.definir(CHAVE_DISPENSA(ws), dispensar);
      const e = await estado(ws);
      deps.emitir({ tipo: "estado", estado: e });
      return e;
    },

    aoMetodoMudou(ws) {
      if (encerrado) return;
      cache.delete(ws);
      void (async () => {
        // só publica quando o estado mudou (o observador dispara por qualquer arquivo de docs/)
        const antes = ultimoEstado.get(ws);
        if (deps.raizDe(ws) === null) return;
        try {
          const e = await estado(ws, true);
          if (antes === undefined || antes !== assinaturaDe(e)) deps.emitir({ tipo: "estado", estado: e });
        } catch { /* workspace sumiu */ }
      })();
    },

    async encerrar() {
      encerrado = true;
      const todas = [...ativas.values()];
      for (const a of todas) a.ac.abort();
      await Promise.race([Promise.all(todas.map((a) => a.promessa.catch(() => undefined))), new Promise<void>((r) => { setTimeout(r, 6_000).unref(); })]);
    },
  };
}

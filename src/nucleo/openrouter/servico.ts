// Serviço do OpenRouter (Fase 9, T-09.26/28): consentimento, contas e chave (SÓ no cofre), teste de chave, lista de modelos, habilitação por
// faixa/ordem, saldo e preparo do lançamento do Pane. Tudo por CLIQUE e tudo via `nucleo/rede` com token de consentimento: sem consentimento
// nenhum socket abre (CT-9.27). A chave entra uma vez, vai direto ao cofre (`OPENROUTER_KEY_<sufixo da conta>`, `sensivel:true`) e nunca sai:
// nem em retorno, nem em erro (mensagens fixas), nem em evento, nem em argv. `nucleo/` não importa Electron.
import type { ConfigOpenRouter } from "./config";
import type {
  ContaOpenRouterEstado,
  EstadoOpenRouter,
  ModeloOpenRouter,
  PaginaModelosOpenRouter,
  PedidoGravarModeloOpenRouter,
  PedidoListarModelosOpenRouter,
  ResultadoAtualizarModelos,
  ResultadoTesteOpenRouter,
} from "../../compartilhado/harness";
import type { Repositorios } from "../banco/repos";
import type { Cofre } from "../cofre";
import type { ClienteRede, RegistroConsentimento } from "../rede";
import { ADAPTADORES_CLI, adaptadorDaCli, clisUtilizaveis, modeloSeguroParaArgv, type LancamentoMontado } from "./adaptadores";
import { criarClienteOpenRouter, type ClienteOpenRouter, type DestinoOpenRouter, HOST_OPENROUTER } from "./cliente";
import { CHAVE_CONFIG_OPENROUTER, lerConfigOpenRouter } from "./config";
import { OpenRouterErro } from "./erros";

export const INTERVALO_CLIQUE_SALDO_MS = 5_000;
const TOKEN_VALIDADE_MS = 30_000;
const PREFIXO_COFRE = "OPENROUTER_KEY_";

export interface DependenciasServicoOpenRouter {
  repos: Pick<Repositorios, "config" | "conta" | "contaOpenrouter" | "openrouterModelo">;
  cofre: () => Promise<Cofre>;
  /** rede SOB DEMANDA: só é construída quando alguém a usa. */
  rede: () => ClienteRede;
  consentimento: RegistroConsentimento;
  destino?: DestinoOpenRouter;
  /** ids de CLI instaladas (do detector). */
  instaladas: () => Promise<readonly string[]>;
  agora?: () => number;
  emitir?: (tipo: string, payload: unknown) => void;
  /** o saldo de uma conta mudou (o main recarrega a fonte de limite). */
  aoSaldoAtualizado?: (contaId: string) => void;
  /** a lista de contas mudou (o main reidrata o serviço de limites). */
  aoContasMudarem?: () => void;
}

export interface PedidoPreparo {
  /** CLI pedida (`pane_spawn.cli`); sem ela, a primeira utilizável. */
  cli: string | null;
  modelo: string | null;
  conta_id: string | null;
  /** opt-in `injetar_cofre_no_env` do workspace do Pane (P-319, modo b). */
  injetar_chave: boolean;
}
export interface LancamentoOpenRouter extends LancamentoMontado {
  cli: string;
  modelo: string;
  conta_id: string | null;
  modo: "usuario_autentica" | "cofre_no_env";
  avisos: string[];
}
export interface ResumoOpenRouter {
  consentido: boolean;
  modelos_habilitados: number;
  clis: string[];
  contas: string[];
  motivo_indisponivel: "openrouter_not_consented" | "model_not_enabled" | null;
}

export interface ServicoOpenRouter {
  consentido(): boolean;
  /** re-libera o host se o consentimento já estava gravado (boot da onda 2); sem rede. */
  iniciar(): void;
  estado(): Promise<EstadoOpenRouter>;
  consentir(versaoTexto: string): Promise<EstadoOpenRouter>;
  revogar(): Promise<EstadoOpenRouter>;
  gravarChave(p: { conta_id?: string; rotulo: string; chave: string }): Promise<ContaOpenRouterEstado>;
  apagarChave(contaId: string): Promise<boolean>;
  testar(p: { conta_id?: string; chave?: string }): Promise<ResultadoTesteOpenRouter>;
  atualizarModelos(contaId?: string): Promise<ResultadoAtualizarModelos>;
  listarModelos(p: PedidoListarModelosOpenRouter): PaginaModelosOpenRouter;
  gravarModelo(p: PedidoGravarModeloOpenRouter): ModeloOpenRouter;
  atualizarSaldo(contaId?: string): Promise<EstadoOpenRouter>;
  // ---- para o main (nunca para o renderer)
  /** consulta periódica do adaptador de limite (token permanente do consentimento gravado). Lança em falha. */
  consultarSaldoPeriodico(contaId: string, sinal?: AbortSignal): Promise<void>;
  resumo(): Promise<ResumoOpenRouter>;
  clisUtilizaveis(): Promise<string[]>;
  /** valida modelo habilitado e CLI compatível e monta argv/ambiente do Pane. Lança `OpenRouterErro`. */
  preparar(p: PedidoPreparo): Promise<LancamentoOpenRouter>;
  modelosHabilitados(): ModeloOpenRouter[];
}

const semCofreId = (c: { cofre_entrada_id: string } & ContaOpenRouterEstado): ContaOpenRouterEstado => ({
  conta_id: c.conta_id,
  rotulo: c.rotulo,
  ultimos4: c.ultimos4,
  tipo: c.tipo,
  limite_usd: c.limite_usd,
  usado_usd: c.usado_usd,
  saldo_usd: c.saldo_usd,
  saldo_em: c.saldo_em,
});

/** Nome da entrada do cofre: curto (o repositório recusa referência com cara de chave) e UPPER_SNAKE. Estável por conta. */
export function nomeCofreDaConta(contaId: string): string {
  const sufixo = contaId.replace(/^[a-z]+_/i, "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-16);
  return `${PREFIXO_COFRE}${sufixo === "" ? "X" : sufixo}`;
}

type Protegido<T> = { ok: true; valor: T } | { ok: false; erro: OpenRouterErro };
async function protegido<T>(fn: (chave: string) => Promise<T>, chave: string): Promise<Protegido<T>> {
  try {
    return { ok: true, valor: await fn(chave) };
  } catch (e) {
    return { ok: false, erro: e instanceof OpenRouterErro ? e : new OpenRouterErro("indisponivel") };
  }
}

export function criarServicoOpenRouter(d: DependenciasServicoOpenRouter): ServicoOpenRouter {
  const { repos, consentimento } = d;
  const agora = d.agora ?? Date.now;
  const destino: DestinoOpenRouter = d.destino ?? { host: HOST_OPENROUTER };
  const host = destino.host;
  let cliente: ClienteOpenRouter | null = null;
  const api = (): ClienteOpenRouter => (cliente ??= criarClienteOpenRouter(d.rede(), destino));
  let permanente: string | null = null;
  const ultimoSaldoClique = new Map<string, number>();

  const cfg = (): ConfigOpenRouter => lerConfigOpenRouter(repos.config.obter(CHAVE_CONFIG_OPENROUTER));
  const consentido = (): boolean => {
    const c = cfg();
    return c.habilitado && typeof c.consentimento_em === "string";
  };
  const exigirConsentimento = (): void => {
    if (!consentido()) throw new OpenRouterErro("sem_consentimento");
  };
  /** token de UM clique (n usos, validade curta): é o que autoriza a(s) chamada(s) daquela ação. */
  const tokenClique = (usos: number): string => {
    consentimento.permitirHost(host);
    return consentimento.conceder(host, { usos, validade_ms: TOKEN_VALIDADE_MS });
  };
  const tokenPermanente = (): string => {
    if (permanente === null || !consentimento.valido(permanente, host)) {
      consentimento.permitirHost(host);
      permanente = consentimento.conceder(host, { permanente: true });
    }
    return permanente;
  };

  const linhaDaConta = (contaId: string): NonNullable<ReturnType<typeof repos.contaOpenrouter.obter>> => {
    const l = repos.contaOpenrouter.obter(contaId);
    if (l === undefined) throw new OpenRouterErro("conta_inexistente");
    return l;
  };
  const contaPadrao = (contaId?: string): string => {
    if (contaId !== undefined) return linhaDaConta(contaId).conta_id;
    const primeira = repos.contaOpenrouter.listar()[0];
    if (primeira === undefined) throw new OpenRouterErro("sem_chave");
    return primeira.conta_id;
  };

  /** Usa a chave do cofre só dentro de `fn` (modo broker). Qualquer falha de cofre vira `sem_chave` (sem repassar a mensagem). */
  async function comChave<T>(contaId: string, fn: (chave: string) => Promise<T>): Promise<T> {
    const linha = linhaDaConta(contaId);
    let cofre: Cofre;
    try {
      cofre = await d.cofre();
    } catch {
      throw new OpenRouterErro("sem_chave");
    }
    // o cofre sanitiza qualquer exceção de `fn` (perde a classe): o erro nominal viaja como VALOR e é relançado aqui fora
    try {
      const r = await cofre.usar(linha.cofre_entrada_id, (chave) => protegido(fn, chave));
      if (!r.ok) throw r.erro;
      return r.valor;
    } catch (e) {
      if (e instanceof OpenRouterErro) throw e;
      throw new OpenRouterErro("sem_chave");
    }
  }

  async function consultarSaldo(contaId: string, token: () => string): Promise<void> {
    const r = await comChave(contaId, async (chave) => {
      const info = await api().chave(chave, token());
      let restante = info.restante_usd;
      if (restante === null) restante = (await api().creditos(chave, token()).catch(() => null))?.restante_usd ?? null;
      return { info, restante };
    });
    repos.contaOpenrouter.atualizarSaldo(contaId, {
      tipo: r.info.tipo,
      limite_usd: r.info.limite_usd,
      usado_usd: r.info.usado_usd,
      saldo_usd: r.restante,
      saldo_em: new Date(agora()).toISOString(),
    });
    d.aoSaldoAtualizado?.(contaId);
  }

  async function estado(): Promise<EstadoOpenRouter> {
    const c = cfg();
    let instaladas: readonly string[] = [];
    try {
      instaladas = await d.instaladas();
    } catch {
      /* sem detecção: nenhuma CLI aparece instalada */
    }
    const ok = new Set(instaladas);
    return {
      habilitado: c.habilitado,
      consentimento_em: c.consentimento_em,
      contas: repos.contaOpenrouter.listar().map(semCofreId),
      modelos: repos.openrouterModelo.contagem(),
      clis: ADAPTADORES_CLI.map((a) => ({ cli: a.cli, instalada: ok.has(a.cli), status: a.status })),
      proxy: { ativo: false },
    };
  }

  async function clisDisponiveis(): Promise<string[]> {
    let instaladas: readonly string[] = [];
    try {
      instaladas = await d.instaladas();
    } catch {
      /* nenhuma */
    }
    return clisUtilizaveis(instaladas, cfg().clis_preferidas);
  }

  return {
    consentido,
    iniciar() {
      if (consentido()) consentimento.permitirHost(host);
    },
    estado,
    async consentir(versaoTexto) {
      const atual = cfg();
      repos.config.definir(CHAVE_CONFIG_OPENROUTER, { ...atual, habilitado: true, consentimento_em: new Date(agora()).toISOString(), versao_texto: versaoTexto });
      consentimento.permitirHost(host);
      return estado();
    },
    async revogar() {
      const atual = cfg();
      repos.config.definir(CHAVE_CONFIG_OPENROUTER, { ...atual, habilitado: false, consentimento_em: null });
      consentimento.revogarHost(host); // revoga também os tokens do host
      permanente = null;
      return estado(); // contas e modelos ficam
    },
    async gravarChave({ conta_id, rotulo, chave }) {
      const valor = chave.trim();
      if (valor.length < 8) throw new OpenRouterErro("chave_invalida");
      let contaId = conta_id;
      let criada = false;
      if (contaId === undefined) {
        const existe = repos.contaOpenrouter.listar().some((c) => c.rotulo.toLocaleLowerCase() === rotulo.trim().toLocaleLowerCase());
        if (existe) throw new OpenRouterErro("conta_inexistente", "rótulo já usado");
        contaId = repos.conta.criar({ provedor: "openrouter", rotulo }).id;
        criada = true;
      } else {
        const l = linhaDaConta(contaId);
        if (l.rotulo !== rotulo.trim()) repos.conta.renomear(contaId, rotulo);
      }
      const nome = nomeCofreDaConta(contaId);
      try {
        const cofre = await d.cofre();
        await cofre.guardar({ id: null, nome, escopo: "global", workspace_id: null, sensivel: true, valor });
        repos.contaOpenrouter.gravar({ conta_id: contaId, cofre_entrada_id: nome, ultimos4: valor.slice(-4) });
      } catch (e) {
        if (criada) {
          try {
            repos.conta.remover(contaId);
          } catch {
            /* melhor esforço */
          }
        }
        throw e instanceof OpenRouterErro ? e : new OpenRouterErro("sem_chave");
      }
      d.aoContasMudarem?.();
      return semCofreId(linhaDaConta(contaId));
    },
    async apagarChave(contaId) {
      const l = repos.contaOpenrouter.obter(contaId);
      if (l === undefined) return false;
      try {
        const cofre = await d.cofre();
        const entrada = (await cofre.listar()).find((e) => e.nome === l.cofre_entrada_id);
        if (entrada !== undefined) await cofre.apagar(entrada.id);
      } catch {
        /* cofre bloqueado: a conta some mesmo assim; a entrada órfã é apagável pela tela do cofre */
      }
      repos.contaOpenrouter.remover(contaId);
      try {
        repos.conta.remover(contaId);
      } catch {
        repos.conta.definirHabilitada(contaId, false); // referenciada por Panes/política: só desabilita
      }
      d.aoContasMudarem?.();
      return true;
    },
    async testar({ conta_id, chave }) {
      const falha = (motivo: string, tipo: ResultadoTesteOpenRouter["tipo"] = "desconhecido"): ResultadoTesteOpenRouter => ({ ok: false, tipo, limite_usd: null, saldo_usd: null, latencia_ms: null, motivo });
      if (!consentido()) return falha("sem_consentimento");
      const token = tokenClique(2);
      const executar = async (valor: string): Promise<ResultadoTesteOpenRouter> => {
        const info = await api().chave(valor, token);
        let restante = info.restante_usd;
        if (restante === null) restante = (await api().creditos(valor, token).catch(() => null))?.restante_usd ?? null;
        return { ok: true, tipo: info.tipo, limite_usd: info.limite_usd, saldo_usd: restante, latencia_ms: info.latencia_ms };
      };
      try {
        if (chave !== undefined) {
          // "testar sem salvar": o valor vale só nesta chamada; cofre e banco ficam intactos
          const cofre = await d.cofre();
          const r = await cofre.usarSemSalvar(chave.trim(), (v) => protegido(executar, v));
          if (!r.ok) throw r.erro;
          return r.valor;
        }
        const id = contaPadrao(conta_id);
        const r = await comChave(id, executar);
        repos.contaOpenrouter.atualizarSaldo(id, { tipo: r.tipo, limite_usd: r.limite_usd, usado_usd: null, saldo_usd: r.saldo_usd, saldo_em: new Date(agora()).toISOString() });
        d.aoSaldoAtualizado?.(id);
        return r;
      } catch (e) {
        return falha(e instanceof OpenRouterErro ? e.codigo : "indisponivel");
      }
    },
    async atualizarModelos(contaId) {
      exigirConsentimento();
      const id = contaPadrao(contaId);
      const lista = await comChave(id, (chave) => api().modelos(chave, tokenClique(1)));
      const r = repos.openrouterModelo.sincronizar(lista);
      try {
        d.emitir?.("openrouter.models_updated", { total: r.total, novos: r.novos, removidos: r.removidos });
      } catch {
        /* evento nunca derruba a atualização */
      }
      return { total: r.total, novos: r.novos, removidos: r.removidos };
    },
    listarModelos: (p) => repos.openrouterModelo.listar(p),
    gravarModelo: (p) => repos.openrouterModelo.gravarClassificacao(p),
    async atualizarSaldo(contaId) {
      exigirConsentimento();
      const alvos = contaId === undefined ? repos.contaOpenrouter.listar().map((c) => c.conta_id) : [linhaDaConta(contaId).conta_id];
      let erro: unknown = null;
      let algum = false;
      for (const id of alvos) {
        const ult = ultimoSaldoClique.get(id) ?? Number.NEGATIVE_INFINITY;
        if (agora() - ult < INTERVALO_CLIQUE_SALDO_MS) continue; // ≤ 1 por conta a cada 5 s
        ultimoSaldoClique.set(id, agora());
        try {
          const token = tokenClique(2);
          await consultarSaldo(id, () => token);
          algum = true;
        } catch (e) {
          erro = e;
        }
      }
      if (!algum && erro !== null) throw erro;
      return estado();
    },
    async consultarSaldoPeriodico(contaId) {
      if (!consentido() || !cfg().atualizar_saldo) return;
      await consultarSaldo(contaId, tokenPermanente);
    },
    async resumo() {
      const clis = await clisDisponiveis();
      const habilitados = repos.openrouterModelo.contagem().habilitados;
      const c = consentido();
      return {
        consentido: c,
        modelos_habilitados: habilitados,
        clis,
        contas: repos.contaOpenrouter.listar().map((x) => x.conta_id),
        motivo_indisponivel: !c ? "openrouter_not_consented" : habilitados === 0 ? "model_not_enabled" : null,
      };
    },
    clisUtilizaveis: clisDisponiveis,
    modelosHabilitados: () => repos.openrouterModelo.habilitados(),
    async preparar(p) {
      if (!consentido()) throw new OpenRouterErro("sem_consentimento");
      if (p.modelo === null || !modeloSeguroParaArgv(p.modelo)) throw new OpenRouterErro("modelo_nao_habilitado", "informe o modelo");
      const modelo = repos.openrouterModelo.obter(p.modelo);
      if (modelo === undefined || !modelo.habilitado) throw new OpenRouterErro("modelo_nao_habilitado", p.modelo);
      const clis = await clisDisponiveis();
      const cli = p.cli ?? clis[0] ?? null;
      if (cli === null || !clis.includes(cli)) throw new OpenRouterErro("sem_cli_compativel", cli ?? undefined);
      const adaptador = adaptadorDaCli(cli);
      if (adaptador === undefined || adaptador.status !== "verificado") throw new OpenRouterErro("sem_cli_compativel", cli);
      const avisos: string[] = [];
      let contaId: string | null = p.conta_id;
      if (contaId !== null && repos.contaOpenrouter.obter(contaId) === undefined) contaId = null;
      contaId ??= repos.contaOpenrouter.listar()[0]?.conta_id ?? null;
      let chave: string | undefined;
      if (p.injetar_chave) {
        if (contaId === null) avisos.push("Sem conta OpenRouter com chave: o Pane abre sem a chave; autentique a CLI.");
        else {
          try {
            const cofre = await d.cofre();
            chave = await cofre.obter(linhaDaConta(contaId).cofre_entrada_id);
          } catch {
            avisos.push("A chave do cofre não pôde ser lida (cofre bloqueado?); o Pane abre sem ela.");
          }
        }
      }
      const montado = adaptador.montar({ modelo: modelo.id, ...(chave === undefined ? {} : { chave }) });
      return { ...montado, cli, modelo: modelo.id, conta_id: contaId, modo: chave === undefined ? "usuario_autentica" : "cofre_no_env", avisos };
    },
  };
}

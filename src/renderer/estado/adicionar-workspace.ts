// Estado do modal "Adicionar workspace" (D-600…): três caminhos (abrir pasta, clonar, novo projeto). Lazy: nada é pedido ao main enquanto o modal está fechado
// (só o estado de abertura vive aqui; o resto nasce em `abrir`). O renderer NUNCA envia caminho: só tokens de pasta que o main emitiu e ids de achados.
// Toda ação de rede (clonar, listar meus repositórios) só acontece por clique, com o consentimento daquele clique.
import { useSyncExternalStore } from "react";
import type { ApiAde } from "../../compartilhado/ipc";
import type { Workspace } from "../../compartilhado/dominio";
import type {
  AchadoProjeto, AvaliacaoDestino, DestinoPai, ErroAdicionar, EstadoGhAdicionar, EventoClone, LoteProjetos, RepoRemoto, SecaoAdicionar, TemplateProjeto,
} from "../../compartilhado/workspaces-adicionar";
import { analisarOrigemGit, validarBranch, validarNomePasta, type ResultadoOrigem } from "../../nucleo/workspaces/adicionar/url";
import { ade } from "../ade";
import { storeSuite } from "./suite";

type Api = Pick<ApiAde["workspaces"],
  "abrir" | "definirAtual" | "adicionarDestinoPadrao" | "adicionarEscolherPasta" | "adicionarAvaliarDestino" | "adicionarAbrirDestino" | "adicionarClonar" | "adicionarCancelarClone" |
  "adicionarBuscarProjetos" | "adicionarCancelarBusca" | "adicionarProjetoAchado" | "adicionarGhEstado" | "adicionarListarRepos" | "adicionarNovo" | "assinarAdicionarProgresso" | "assinarAdicionarProjetos">;

export interface SuiteAdicionar {
  garantirEstado(id: string, forcar?: boolean): Promise<void>;
  estadoDe(id: string): { estado: string } | null;
  abrirModalPara(id: string): void;
}

export interface BuscaProjetos {
  fase: "ocioso" | "buscando" | "pronta";
  buscaId: string | null;
  itens: readonly AchadoProjeto[];
  visitados: number;
  cancelada: boolean;
  limite: boolean;
  erro: string | null;
}
export interface FormClonar {
  entrada: string;
  permitirLocal: boolean;
  localConfirmado: boolean;
  nome: string;
  nomeEditado: boolean;
  branch: string;
  raso: boolean;
  submodulos: boolean;
  /** `ResultadoOrigem` da entrada atual (null = campo vazio). */
  origem: ResultadoOrigem | null;
  erroNome: string | null;
  erroBranch: string | null;
  avaliacao: AvaliacaoDestino | null;
  consentindo: boolean;
}
export interface ReposRemotos {
  fase: "ocioso" | "carregando" | "ok" | "erro";
  lista: readonly RepoRemoto[];
  truncado: boolean;
  erro: ErroAdicionar | null;
  filtro: string;
}
export interface ExecucaoClone {
  fase: "ocioso" | "iniciando" | "clonando" | "pronto" | "erro" | "cancelado";
  cloneId: string | null;
  evento: EventoClone | null;
  erro: ErroAdicionar | null;
  workspace: Workspace | null;
  /** a suíte ExpxDev ainda não está completa no workspace clonado/criado. */
  suiteFalta: boolean;
}
export interface FormNovo {
  nome: string;
  git: boolean;
  gitignore: boolean;
  commit: boolean;
  readme: boolean;
  template: TemplateProjeto;
  instalarSuite: boolean;
  erroNome: string | null;
  avaliacao: AvaliacaoDestino | null;
}
export interface ExecucaoNovo {
  fase: "ocioso" | "criando" | "pronto" | "erro";
  erro: ErroAdicionar | null;
  workspace: Workspace | null;
  avisos: readonly string[];
}

export interface EstadoAdicionarUI {
  aberto: boolean;
  secao: SecaoAdicionar;
  disponivel: boolean;
  destino: DestinoPai | null;
  erroDestino: string | null;
  erroPasta: string | null;
  /** id do achado que está sendo adicionado. */
  adicionando: string | null;
  busca: BuscaProjetos;
  gh: EstadoGhAdicionar | null;
  repos: ReposRemotos;
  clonar: FormClonar;
  clone: ExecucaoClone;
  novo: FormNovo;
  criacao: ExecucaoNovo;
}

export interface OpcoesAdicionar {
  api: () => Api | undefined;
  suite?: SuiteAdicionar;
  /** troca o workspace depois de adicionar (padrão: o main já trocou; só garante o estado). */
  aoAdicionar?: (ws: Workspace) => void;
  esperar?: (ms: number) => Promise<void>;
  atrasoAvaliacaoMs?: number;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const erroGenerico = (m: string): ErroAdicionar => ({ codigo: "interno", mensagem: m, acao: null, sugestao: null });

const BUSCA_VAZIA: BuscaProjetos = { fase: "ocioso", buscaId: null, itens: [], visitados: 0, cancelada: false, limite: false, erro: null };
const REPOS_VAZIO: ReposRemotos = { fase: "ocioso", lista: [], truncado: false, erro: null, filtro: "" };
const CLONAR_VAZIO: FormClonar = { entrada: "", permitirLocal: false, localConfirmado: false, nome: "", nomeEditado: false, branch: "", raso: false, submodulos: false, origem: null, erroNome: null, erroBranch: null, avaliacao: null, consentindo: false };
const CLONE_VAZIO: ExecucaoClone = { fase: "ocioso", cloneId: null, evento: null, erro: null, workspace: null, suiteFalta: false };
const NOVO_VAZIO: FormNovo = { nome: "", git: true, gitignore: true, commit: true, readme: true, template: "vazio", instalarSuite: false, erroNome: null, avaliacao: null };
const CRIACAO_VAZIA: ExecucaoNovo = { fase: "ocioso", erro: null, workspace: null, avisos: [] };

function estadoInicial(): EstadoAdicionarUI {
  return { aberto: false, secao: "pasta", disponivel: true, destino: null, erroDestino: null, erroPasta: null, adicionando: null, busca: BUSCA_VAZIA, gh: null, repos: REPOS_VAZIO, clonar: CLONAR_VAZIO, clone: CLONE_VAZIO, novo: NOVO_VAZIO, criacao: CRIACAO_VAZIA };
}

/** Pode clonar? (origem válida, nome e branch válidos, destino livre ou vazio.) Pura. */
export function podeClonar(c: FormClonar, destino: DestinoPai | null): boolean {
  return destino !== null && c.origem?.ok === true && c.erroNome === null && c.erroBranch === null && c.nome.trim() !== "" && c.avaliacao?.ok === true;
}
export function podeCriar(n: FormNovo, destino: DestinoPai | null): boolean {
  return destino !== null && n.nome.trim() !== "" && n.erroNome === null && n.avaliacao?.ok === true;
}

export function criarStoreAdicionar(op: OpcoesAdicionar) {
  const ouvintes = new Set<() => void>();
  let estado: EstadoAdicionarUI = estadoInicial();
  let desligar: Array<() => void> = [];
  let seqAvaliacao = 0;
  const esperar = op.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const atraso = op.atrasoAvaliacaoMs ?? 180;
  const suite: SuiteAdicionar = op.suite ?? storeSuite;
  const soltos = new Map<string, EventoClone>();

  const publicar = (p: Partial<EstadoAdicionarUI>): void => {
    estado = { ...estado, ...p };
    ouvintes.forEach((o) => o());
  };
  const mudarClonar = (p: Partial<FormClonar>): void => publicar({ clonar: { ...estado.clonar, ...p } });
  const mudarNovo = (p: Partial<FormNovo>): void => publicar({ novo: { ...estado.novo, ...p } });

  /** reavalia o destino (colisão) com um pequeno atraso e descarta respostas velhas */
  function agendarAvaliacao(qual: "clonar" | "novo"): void {
    const api = op.api();
    const seq = ++seqAvaliacao;
    const nome = qual === "clonar" ? estado.clonar.nome : estado.novo.nome;
    const token = estado.destino?.token;
    const aplicar = (a: AvaliacaoDestino | null): void => {
      if (seq !== seqAvaliacao) return;
      if (qual === "clonar") mudarClonar({ avaliacao: a }); else mudarNovo({ avaliacao: a });
    };
    if (api === undefined || token === undefined || nome.trim() === "" || (qual === "clonar" ? estado.clonar.erroNome : estado.novo.erroNome) !== null) { aplicar(null); return; }
    void (async () => {
      await esperar(atraso);
      if (seq !== seqAvaliacao) return;
      try { aplicar(await api.adicionarAvaliarDestino({ destino_token: token, nome: nome.trim() })); } catch { aplicar(null); }
    })();
  }

  function recomputarClonar(p: Partial<FormClonar>): void {
    const base = { ...estado.clonar, ...p };
    const origem = base.entrada.trim() === "" ? null : analisarOrigemGit(base.entrada, { permitirLocal: base.permitirLocal && base.localConfirmado });
    const nome = !base.nomeEditado && origem?.ok === true ? origem.origem.nome_sugerido : (!base.nomeEditado && origem === null ? "" : base.nome);
    const vn = nome.trim() === "" ? null : validarNomePasta(nome);
    const vb = validarBranch(base.branch);
    publicar({ clonar: { ...base, origem, nome, erroNome: vn !== null && !vn.ok ? vn.motivo : null, erroBranch: vb.ok ? null : vb.motivo, avaliacao: null, consentindo: false } });
    agendarAvaliacao("clonar");
  }

  function aoProgresso(e: EventoClone): void {
    const c = estado.clone;
    if (c.cloneId === null) { soltos.set(e.clone_id, e); return; } // o evento chegou antes da resposta do invoke
    if (e.clone_id !== c.cloneId) return;
    aplicarEvento(e);
  }
  function aplicarEvento(e: EventoClone): void {
    if (!estado.aberto && (e.fase === "concluido" || e.fase === "falhou" || e.fase === "cancelado")) queueMicrotask(soltarEventos); // terminou com o modal fechado: nada mais a ouvir
    if (e.fase === "concluido") {
      publicar({ clone: { ...estado.clone, fase: "pronto", evento: e, workspace: e.workspace, erro: null } });
      if (e.workspace !== null) void conferirSuite(e.workspace.id, "clone");
    } else if (e.fase === "falhou") { publicar({ clone: { ...estado.clone, fase: "erro", evento: e, erro: e.erro ?? erroGenerico(e.mensagem) } }); mudarClonar({ consentindo: false }); } // o consentimento vale para UMA tentativa
    else if (e.fase === "cancelado") { publicar({ clone: { ...estado.clone, fase: "cancelado", evento: e, erro: null } }); mudarClonar({ consentindo: false }); }
    else publicar({ clone: { ...estado.clone, fase: "clonando", evento: e } });
  }

  async function conferirSuite(id: string, qual: "clone" | "novo"): Promise<void> {
    try {
      await suite.garantirEstado(id, true);
      const falta = (suite.estadoDe(id)?.estado ?? "indisponivel") !== "completa" && (suite.estadoDe(id)?.estado ?? "indisponivel") !== "indisponivel";
      if (qual === "clone") publicar({ clone: { ...estado.clone, suiteFalta: falta } });
    } catch { /* sem serviço da suíte: o botão simplesmente não aparece */ }
  }

  function aoLote(l: LoteProjetos): void {
    if (l.busca_id !== estado.busca.buscaId) return;
    const itens = [...estado.busca.itens, ...l.itens].slice(0, 500);
    publicar({ busca: { ...estado.busca, itens, visitados: l.visitados, fase: l.fim ? "pronta" : "buscando", cancelada: l.cancelada, limite: l.limite_atingido } });
  }

  function ligarEventos(): void {
    const api = op.api();
    if (api === undefined || desligar.length > 0) return;
    desligar = [api.assinarAdicionarProgresso(aoProgresso), api.assinarAdicionarProjetos(aoLote)];
  }
  function soltarEventos(): void {
    desligar.forEach((d) => d());
    desligar = [];
  }

  const depoisDeAdicionar = (ws: Workspace | null): boolean => {
    if (ws === null) return false;
    op.aoAdicionar?.(ws);
    return true;
  };

  const self = {
    obter: (): EstadoAdicionarUI => estado,
    assinar(o: () => void): () => void { ouvintes.add(o); return () => void ouvintes.delete(o); },

    /** Abre o modal já na seção pedida. Reabrir depois de um clone concluído recomeça limpo; clone em andamento é preservado. */
    abrir(secao: SecaoAdicionar = "pasta"): void {
      const api = op.api();
      // clone em andamento ou com erro (o dono pode ter ido ao terminal fazer `gh auth login`): o formulário é preservado
      const clonando = estado.clone.fase === "clonando" || estado.clone.fase === "iniciando" || estado.clone.fase === "erro";
      if (api === undefined) { publicar({ aberto: true, secao, disponivel: false }); return; }
      if (estado.aberto) { self.mudarSecao(secao); return; }
      publicar({
        aberto: true, secao, disponivel: true, erroPasta: null, erroDestino: null, adicionando: null,
        ...(clonando ? {} : { clonar: CLONAR_VAZIO, clone: CLONE_VAZIO, novo: NOVO_VAZIO, criacao: CRIACAO_VAZIA, repos: REPOS_VAZIO }),
        busca: BUSCA_VAZIA,
      });
      ligarEventos();
      void self.garantirDestino();
      self.mudarSecao(secao);
    },
    /** Fecha (a UI já perguntou se estava clonando). Para a busca; o clone só para se pedido. */
    fechar(): void {
      if (!estado.aberto) return;
      const buscando = estado.busca.fase === "buscando" && estado.busca.buscaId !== null;
      if (buscando) void op.api()?.adicionarCancelarBusca(estado.busca.buscaId as string).catch(() => undefined);
      const emAndamento = estado.clone.fase === "clonando" || estado.clone.fase === "iniciando";
      publicar({ aberto: false, busca: { ...estado.busca, fase: buscando ? "pronta" : estado.busca.fase, cancelada: buscando || estado.busca.cancelada } });
      if (!emAndamento) soltarEventos();
    },
    mudarSecao(secao: SecaoAdicionar): void {
      publicar({ secao });
      if (secao === "clonar" && estado.gh === null) void self.carregarGh();
    },

    async garantirDestino(): Promise<void> {
      if (estado.destino !== null) return;
      try { publicar({ destino: await op.api()?.adicionarDestinoPadrao() ?? null }); }
      catch (e) { publicar({ erroDestino: msg(e) }); }
      agendarAvaliacao("clonar");
      agendarAvaliacao("novo");
    },
    /** Seletor nativo da pasta pai. `lembrar` guarda como "pasta de projetos". */
    async escolherDestino(lembrar: boolean): Promise<void> {
      try {
        const d = await op.api()?.adicionarEscolherPasta(lembrar);
        if (d === undefined || d === null) return;
        publicar({ destino: d, erroDestino: null });
        agendarAvaliacao("clonar");
        agendarAvaliacao("novo");
      } catch (e) { publicar({ erroDestino: msg(e) }); }
    },

    // ---- abrir pasta ----
    /** Diálogo nativo (canal existente): adiciona e troca; fecha o modal se escolheu. */
    async escolherPastaNativa(): Promise<boolean> {
      try {
        publicar({ erroPasta: null });
        const ws = await op.api()?.abrir(null);
        if (depoisDeAdicionar(ws ?? null)) { self.fechar(); return true; }
      } catch (e) { publicar({ erroPasta: msg(e) }); }
      return false;
    },
    async abrirRecente(id: string): Promise<void> {
      try {
        await op.api()?.definirAtual(id);
        self.fechar();
      } catch (e) { publicar({ erroPasta: msg(e) }); }
    },
    async buscarProjetos(): Promise<void> {
      const api = op.api();
      if (api === undefined || estado.busca.fase === "buscando") return;
      publicar({ busca: { ...BUSCA_VAZIA, fase: "buscando" } });
      try {
        const { busca_id } = await api.adicionarBuscarProjetos();
        publicar({ busca: { ...estado.busca, buscaId: busca_id } });
      } catch (e) { publicar({ busca: { ...BUSCA_VAZIA, fase: "pronta", erro: msg(e) } }); }
    },
    async cancelarBusca(): Promise<void> {
      const id = estado.busca.buscaId;
      if (id === null) return;
      publicar({ busca: { ...estado.busca, fase: "pronta", cancelada: true } });
      try { await op.api()?.adicionarCancelarBusca(id); } catch { /* já terminou */ }
    },
    async adicionarAchado(id: string): Promise<boolean> {
      if (estado.adicionando !== null) return false;
      publicar({ adicionando: id, erroPasta: null });
      try {
        const ws = await op.api()?.adicionarProjetoAchado(id);
        publicar({ adicionando: null });
        if (depoisDeAdicionar(ws ?? null)) { self.fechar(); return true; }
      } catch (e) { publicar({ adicionando: null, erroPasta: msg(e) }); }
      return false;
    },

    // ---- clonar ----
    definirClonar(p: Partial<Pick<FormClonar, "entrada" | "permitirLocal" | "localConfirmado" | "nome" | "branch" | "raso" | "submodulos">>): void {
      if (estado.clone.fase === "clonando" || estado.clone.fase === "iniciando") return;
      const extra: Partial<FormClonar> = p.nome !== undefined ? { nomeEditado: p.nome.trim() !== "" } : {};
      if (p.permitirLocal === false) extra.localConfirmado = false;
      recomputarClonar({ ...p, ...extra });
      if (estado.clone.fase === "erro" || estado.clone.fase === "cancelado") publicar({ clone: CLONE_VAZIO });
    },
    usarSugestao(): void {
      const s = estado.clonar.avaliacao?.sugestao;
      if (s !== null && s !== undefined) self.definirClonar({ nome: s });
    },
    async carregarGh(forcar = false): Promise<void> {
      try { publicar({ gh: (await op.api()?.adicionarGhEstado(forcar)) ?? { instalado: false, autenticado: false, usuario: null } }); }
      catch { publicar({ gh: { instalado: false, autenticado: false, usuario: null } }); }
    },
    /** Rede, por clique: "Carregar meus repositórios". */
    async carregarRepos(): Promise<void> {
      if (estado.repos.fase === "carregando") return;
      publicar({ repos: { ...REPOS_VAZIO, fase: "carregando", filtro: estado.repos.filtro } });
      try {
        const r = await op.api()?.adicionarListarRepos(true);
        if (r === undefined) { publicar({ repos: { ...REPOS_VAZIO, fase: "erro", erro: erroGenerico("O app não está disponível.") } }); return; }
        if (r.ok) publicar({ repos: { fase: "ok", lista: r.repos, truncado: r.truncado, erro: null, filtro: estado.repos.filtro } });
        else publicar({ repos: { ...REPOS_VAZIO, fase: "erro", erro: r.erro, filtro: estado.repos.filtro } });
      } catch (e) { publicar({ repos: { ...REPOS_VAZIO, fase: "erro", erro: erroGenerico(msg(e)) } }); }
    },
    filtrarRepos(filtro: string): void { publicar({ repos: { ...estado.repos, filtro } }); },
    escolherRepo(r: RepoRemoto): void { self.definirClonar({ entrada: r.url, nome: "" }); },
    /** Mostra a linha de consentimento (host, repo, destino exato); só clona no botão "Clonar" dela. */
    pedirConsentimento(): void {
      if (podeClonar(estado.clonar, estado.destino)) mudarClonar({ consentindo: true });
    },
    cancelarConsentimento(): void { mudarClonar({ consentindo: false }); },
    async clonarAgora(): Promise<void> {
      const api = op.api();
      const c = estado.clonar;
      if (api === undefined || estado.destino === null || !c.consentindo || !podeClonar(c, estado.destino)) return;
      publicar({ clone: { ...CLONE_VAZIO, fase: "iniciando" } });
      soltos.clear();
      try {
        const r = await api.adicionarClonar({
          entrada: c.entrada, permitir_local: c.permitirLocal && c.localConfirmado, destino_token: estado.destino.token, nome: c.nome.trim(),
          branch: c.branch.trim() === "" ? null : c.branch.trim(), raso: c.raso, submodulos: c.submodulos, consentimento: true,
        });
        if (!r.ok) { publicar({ clone: { ...CLONE_VAZIO, fase: "erro", erro: r.erro } }); mudarClonar({ consentindo: false }); return; }
        publicar({ clone: { ...estado.clone, cloneId: r.clone_id } });
        const solto = soltos.get(r.clone_id);
        if (solto !== undefined) aplicarEvento(solto);
        soltos.clear();
      } catch (e) { publicar({ clone: { ...CLONE_VAZIO, fase: "erro", erro: erroGenerico(msg(e)) } }); }
    },
    async cancelarClone(): Promise<void> {
      const id = estado.clone.cloneId;
      if (id === null) return;
      try { await op.api()?.adicionarCancelarClone(id); } catch { /* já terminou */ }
    },
    /** "Abrir a existente" em vez de sobrescrever. */
    async abrirExistente(qual: "clonar" | "novo"): Promise<boolean> {
      const api = op.api();
      const nome = (qual === "clonar" ? estado.clonar.nome : estado.novo.nome).trim();
      if (api === undefined || estado.destino === null) return false;
      try {
        const ws = await api.adicionarAbrirDestino({ destino_token: estado.destino.token, nome });
        if (depoisDeAdicionar(ws)) { self.fechar(); return true; }
      } catch (e) {
        if (qual === "clonar") publicar({ clone: { ...CLONE_VAZIO, fase: "erro", erro: erroGenerico(msg(e)) } });
      }
      return false;
    },
    reiniciarClone(): void { publicar({ clone: CLONE_VAZIO }); mudarClonar({ consentindo: false }); },
    instalarSuiteDoClone(): void {
      const ws = estado.clone.workspace;
      if (ws === null) return;
      self.fechar();
      suite.abrirModalPara(ws.id);
    },

    // ---- novo projeto ----
    definirNovo(p: Partial<Pick<FormNovo, "nome" | "git" | "gitignore" | "commit" | "readme" | "template" | "instalarSuite">>): void {
      if (estado.criacao.fase === "criando") return;
      const base = { ...estado.novo, ...p };
      const v = base.nome.trim() === "" ? null : validarNomePasta(base.nome);
      publicar({ novo: { ...base, erroNome: v !== null && !v.ok ? v.motivo : null, avaliacao: null }, criacao: estado.criacao.fase === "erro" ? CRIACAO_VAZIA : estado.criacao });
      agendarAvaliacao("novo");
    },
    usarSugestaoNovo(): void {
      const s = estado.novo.avaliacao?.sugestao;
      if (s !== null && s !== undefined) self.definirNovo({ nome: s });
    },
    async criarNovo(): Promise<boolean> {
      const api = op.api();
      const n = estado.novo;
      if (api === undefined || estado.destino === null || !podeCriar(n, estado.destino) || estado.criacao.fase === "criando") return false;
      publicar({ criacao: { ...CRIACAO_VAZIA, fase: "criando" } });
      try {
        const r = await api.adicionarNovo({
          nome: n.nome.trim(), destino_token: estado.destino.token, git: n.git, gitignore: n.git && n.gitignore, commit_inicial: n.git && n.commit, readme: n.readme, template: n.template, instalar_suite: n.instalarSuite,
        });
        if (!r.ok) { publicar({ criacao: { ...CRIACAO_VAZIA, fase: "erro", erro: r.erro } }); return false; }
        publicar({ criacao: { fase: "pronto", erro: null, workspace: r.workspace, avisos: r.avisos } });
        op.aoAdicionar?.(r.workspace);
        if (r.instalar_suite) { self.fechar(); suite.abrirModalPara(r.workspace.id); }
        return true;
      } catch (e) { publicar({ criacao: { ...CRIACAO_VAZIA, fase: "erro", erro: erroGenerico(msg(e)) } }); return false; }
    },
  };
  return self;
}

export type StoreAdicionar = ReturnType<typeof criarStoreAdicionar>;
export const storeAdicionarWorkspace: StoreAdicionar = criarStoreAdicionar({ api: () => ade()?.workspaces });

export function useAdicionarWorkspace(store: StoreAdicionar = storeAdicionarWorkspace): EstadoAdicionarUI {
  return useSyncExternalStore(store.assinar, store.obter);
}

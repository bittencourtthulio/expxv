// Serviço do modal "Adicionar workspace" (D-600…). Nasce no primeiro uso (nada no boot). O renderer NUNCA envia caminho: só tokens de pasta pai emitidos aqui
// (depois do diálogo nativo ou da "pasta de projetos") e ids de achados. Clone e `gh` rodam pelo executor de versionamento (sem shell, árvore morta ao cancelar);
// toda ação de rede exige o consentimento explícito daquele clique. Eventos de progresso saem coalescidos (≥ 250 ms).
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import type {
  AchadoProjeto, AvaliacaoDestino, DestinoPai, ErroAdicionar, EstadoGhAdicionar, EventoClone, FaseClone, LoteProjetos, PedidoAvaliarDestino, PedidoClonar, PedidoNovoProjeto,
  ResultadoIniciarClone, ResultadoNovoProjeto, ResultadoRepos,
} from "../compartilhado/workspaces-adicionar";
import type { Workspace } from "../nucleo/dominio";
import { semSegredos } from "../nucleo/forge/comum";
import { ExecutorVcs } from "../nucleo/vcs/executor";
import { ambienteSeguro } from "../nucleo/terminais/ambiente";
import type { ServicoWorkspaces } from "../nucleo/workspaces/servico";
import { avaliarDestino, mascararCaminho, paiValido, pastaProjetosPadrao } from "../nucleo/workspaces/adicionar/destino";
import { ErroAdicionarNucleo } from "../nucleo/workspaces/adicionar/erros";
import { clonarRepositorio, SILENCIO_PADRAO_MS, TOTAL_PADRAO_MS } from "../nucleo/workspaces/adicionar/clonar";
import { estadoGh, listarMeusRepositorios } from "../nucleo/workspaces/adicionar/gh";
import { criarNovoProjeto } from "../nucleo/workspaces/adicionar/novo-projeto";
import type { EventoProgressoGit } from "../nucleo/workspaces/adicionar/progresso";
import { analisarOrigemGit, validarBranch, validarNomePasta } from "../nucleo/workspaces/adicionar/url";
import { raizesPadrao, varrerProjetos } from "../nucleo/workspaces/adicionar/varredura";

export const PREF_PASTA_PROJETOS = "pasta_projetos";
export const INTERVALO_EVENTOS_MS = 250;
const MAX_TOKENS = 32;
const MAX_ACHADOS = 500;
const MAX_CLONES = 3;
const TEMPO_GH_MS = 60_000;

type Emitir = {
  (canal: "workspaces:adicionar_progresso", payload: EventoClone): void;
  (canal: "workspaces:adicionar_projetos_lote", payload: LoteProjetos): void;
};

export interface DependenciasAdicionar {
  workspaces: Pick<ServicoWorkspaces, "abrir" | "estado">;
  preferencias: { obter(chave: string): unknown; definir(chave: string, valor: unknown): Promise<void> };
  /** Diálogo nativo de pasta (só o main abre). `null` = cancelou. */
  escolherPasta: (titulo: string) => Promise<string | null>;
  emitir: Emitir;
  /** avisa que a lista de workspaces mudou (o main emite `workspaces:mudou`). */
  aoMudar?: () => void;
  registrarEvento?: (tipo: string, payload: Record<string, unknown>) => void;
  casa?: () => string;
  executor?: ExecutorVcs;
  agora?: () => number;
  silencioMs?: number;
  totalMs?: number;
  ambienteBase?: NodeJS.ProcessEnv;
  executavelGit?: string;
  executavelGh?: string;
}

export interface ServicoAdicionar {
  destinoPadrao(): Promise<DestinoPai>;
  escolherPasta(lembrar: boolean): Promise<DestinoPai | null>;
  avaliarDestino(p: PedidoAvaliarDestino): Promise<AvaliacaoDestino>;
  abrirDestinoExistente(p: PedidoAvaliarDestino): Promise<Workspace | null>;
  iniciarClone(p: PedidoClonar): Promise<ResultadoIniciarClone>;
  cancelarClone(cloneId: string): boolean;
  buscarProjetos(): { busca_id: string };
  cancelarBusca(buscaId: string): boolean;
  adicionarAchado(achadoId: string): Promise<Workspace | null>;
  estadoGh(forcar?: boolean): Promise<EstadoGhAdicionar>;
  listarRepos(consentimento: boolean): Promise<ResultadoRepos>;
  criarNovo(p: PedidoNovoProjeto): Promise<ResultadoNovoProjeto>;
  encerrar(): Promise<void>;
}

const id = (prefixo: string): string => `${prefixo}_${randomBytes(9).toString("base64url")}`;
const fio = (e: unknown): ErroAdicionar => {
  if (e instanceof ErroAdicionarNucleo) return e.paraFio();
  return { codigo: "interno", mensagem: "Algo deu errado. Tente de novo.", acao: null, sugestao: null };
};

interface Trabalho {
  ctl: AbortController;
  destino: string;
  fim: Promise<void>;
}

export function criarServicoAdicionar(d: DependenciasAdicionar): ServicoAdicionar {
  const casa = d.casa ?? homedir;
  const agora = d.agora ?? (() => Date.now());
  const executor = d.executor ?? new ExecutorVcs({ ambienteBase: () => ambienteSeguro({ caminho: "/usr/bin/git" }, { scrub: null }) });
  const tokens = new Map<string, string>(); // token -> pasta real
  const tokensPorPasta = new Map<string, string>();
  const achados = new Map<string, string>(); // id -> pasta real
  const clones = new Map<string, Trabalho>();
  const destinosAtivos = new Set<string>();
  let busca: { id: string; ctl: AbortController } | null = null;
  let ghCache: { em: number; estado: EstadoGhAdicionar } | null = null;

  const registrarPasta = (pasta: string): DestinoPai => {
    let token = tokensPorPasta.get(pasta);
    if (token === undefined) {
      if (tokens.size >= MAX_TOKENS) {
        const primeiro = tokens.keys().next().value as string;
        const velha = tokens.get(primeiro);
        tokens.delete(primeiro);
        if (velha !== undefined) tokensPorPasta.delete(velha);
      }
      token = id("d");
      tokens.set(token, pasta);
      tokensPorPasta.set(pasta, token);
    }
    return { token, exibicao: mascararCaminho(pasta, casa()) };
  };
  const pastaDoToken = (token: string): string => {
    const p = tokens.get(token);
    if (p === undefined || !paiValido(p)) throw new ErroAdicionarNucleo("destino_invalido", "A pasta de destino expirou. Escolha a pasta de novo.");
    return p;
  };
  const registrar = (tipo: string, payload: Record<string, unknown>): void => {
    try {
      d.registrarEvento?.(tipo, payload);
    } catch {
      /* auditoria nunca derruba a ação */
    }
  };
  const jaWorkspaces = async (): Promise<Set<string>> => {
    const e = await d.workspaces.estado();
    return new Set([...e.recentes.map((w) => w.raiz), ...(e.atual === null ? [] : [e.atual.raiz])]);
  };
  const adicionar = async (caminho: string): Promise<Workspace | null> => {
    const ws = await d.workspaces.abrir(caminho);
    d.aoMudar?.();
    return ws;
  };

  const lerPastaPreferida = async (): Promise<string | null> => {
    const v = d.preferencias.obter(PREF_PASTA_PROJETOS);
    if (typeof v !== "string" || v === "") return null;
    const real = v === "~" ? casa() : v.startsWith("~/") ? join(casa(), v.slice(2)) : v;
    if (!paiValido(real)) return null;
    return (await stat(real).then((s) => s.isDirectory(), () => false)) ? real : null;
  };

  const verEstadoGh = async (forcar = false): Promise<EstadoGhAdicionar> => {
    if (!forcar && ghCache !== null && agora() - ghCache.em < TEMPO_GH_MS) return ghCache.estado;
    const estado = await estadoGh({ executor, cwd: casa(), ...(d.executavelGh === undefined ? {} : { executavel: d.executavelGh }) });
    ghCache = { em: agora(), estado };
    return estado;
  };

  // ---- eventos de clone coalescidos ----
  function criarEmissorClone(cloneId: string, destinoExibicao: string) {
    let ultimo: EventoClone = { clone_id: cloneId, fase: "preparando", percentual: null, bytes: null, velocidade_bps: null, mensagem: "Preparando…", workspace: null, erro: null, destino_exibicao: destinoExibicao, nao_confiavel: true };
    let enviadoEm = 0;
    let pendente: ReturnType<typeof setTimeout> | null = null;
    let fechado = false;
    const enviar = (): void => {
      if (pendente !== null) { clearTimeout(pendente); pendente = null; }
      enviadoEm = agora();
      d.emitir("workspaces:adicionar_progresso", ultimo);
    };
    return {
      progresso(e: EventoProgressoGit): void {
        if (fechado) return;
        const mudouFase = e.fase !== ultimo.fase;
        ultimo = { ...ultimo, fase: e.fase, percentual: e.percentual, bytes: e.bytes ?? ultimo.bytes, velocidade_bps: e.velocidade_bps ?? ultimo.velocidade_bps, mensagem: semSegredos(e.texto) };
        const decorrido = agora() - enviadoEm;
        if (mudouFase && decorrido >= INTERVALO_EVENTOS_MS) enviar();
        else if (decorrido >= INTERVALO_EVENTOS_MS) enviar();
        else if (pendente === null) pendente = setTimeout(enviar, INTERVALO_EVENTOS_MS - decorrido);
      },
      inicio(): void { enviar(); },
      terminal(fase: Extract<FaseClone, "concluido" | "falhou" | "cancelado">, extra: { workspace?: Workspace | null; erro?: ErroAdicionar | null; mensagem: string }): void {
        fechado = true;
        ultimo = { ...ultimo, fase, percentual: fase === "concluido" ? 100 : ultimo.percentual, workspace: extra.workspace ?? null, erro: extra.erro ?? null, mensagem: extra.mensagem };
        enviar();
      },
    };
  }

  return {
    async destinoPadrao() {
      const pref = await lerPastaPreferida();
      return registrarPasta(pref ?? (await pastaProjetosPadrao(casa())));
    },

    async escolherPasta(lembrar) {
      const escolhida = await d.escolherPasta("Escolher a pasta de destino");
      if (escolhida === null) return null;
      if (!paiValido(escolhida) || !(await stat(escolhida).then((s) => s.isDirectory(), () => false))) throw new ErroAdicionarNucleo("destino_invalido", "A pasta escolhida é inválida.");
      if (lembrar) await d.preferencias.definir(PREF_PASTA_PROJETOS, mascararCaminho(escolhida, casa()));
      return registrarPasta(escolhida);
    },

    async avaliarDestino(p) {
      let pai: string;
      try {
        pai = pastaDoToken(p.destino_token);
      } catch (e) {
        return { ok: false, situacao: "invalido", caminho_exibicao: "", motivo: (e as Error).message, sugestao: null, ja_workspace: false };
      }
      const a = await avaliarDestino(pai, p.nome);
      const ja = a.caminho !== null && (await jaWorkspaces()).has(a.caminho);
      return { ok: a.ok, situacao: a.situacao, caminho_exibicao: a.caminho === null ? mascararCaminho(pai, casa()) : mascararCaminho(a.caminho, casa()), motivo: a.motivo, sugestao: a.sugestao, ja_workspace: ja };
    },

    async abrirDestinoExistente(p) {
      const pai = pastaDoToken(p.destino_token);
      const a = await avaliarDestino(pai, p.nome);
      if (a.caminho === null || (a.situacao !== "ocupado" && a.situacao !== "vazio")) throw new ErroAdicionarNucleo("destino_invalido", "Não há uma pasta existente para abrir.");
      const ws = await adicionar(a.caminho);
      registrar("workspace_adicionado", { via: "pasta_existente", workspace_id: ws?.id ?? null });
      return ws;
    },

    async iniciarClone(p) {
      try {
        if (p.consentimento !== true) throw new ErroAdicionarNucleo("consentimento", "Confirme que quer baixar o repositório para o seu computador.");
        const o = analisarOrigemGit(p.entrada, { permitirLocal: p.permitir_local });
        if (!o.ok) throw new ErroAdicionarNucleo("origem_invalida", o.motivo);
        const br = validarBranch(p.branch);
        if (!br.ok) throw new ErroAdicionarNucleo("origem_invalida", br.motivo);
        const nome = validarNomePasta(p.nome);
        if (!nome.ok) throw new ErroAdicionarNucleo("nome_invalido", nome.motivo);
        const pai = pastaDoToken(p.destino_token);
        const av = await avaliarDestino(pai, nome.nome);
        if (av.situacao === "ocupado") throw new ErroAdicionarNucleo("colisao", av.motivo ?? "O destino já existe.", av.sugestao, "escolher_outro_nome");
        if (!av.ok || av.caminho === null) throw new ErroAdicionarNucleo("destino_invalido", av.motivo ?? "Destino inválido.");
        const destino = av.caminho;
        if (destinosAtivos.has(destino)) throw new ErroAdicionarNucleo("ocupado", "Já existe um clone em andamento para este destino.");
        if (clones.size >= MAX_CLONES) throw new ErroAdicionarNucleo("ocupado", "Já há clones demais em andamento. Espere um terminar.");
        const usarGh = o.origem.github_slug !== null && (await verEstadoGh()).autenticado;
        const cloneId = id("cl");
        const ctl = new AbortController();
        const emissor = criarEmissorClone(cloneId, mascararCaminho(destino, casa()));
        destinosAtivos.add(destino);
        const inicio = agora();
        registrar("clone_iniciado", { host: o.origem.host, repo: o.origem.repo, raso: p.raso, submodulos: p.submodulos, via: usarGh ? "gh" : "git" });
        const fim = (async (): Promise<void> => {
          emissor.inicio();
          try {
            const r = await clonarRepositorio({
              executor, origem: o.origem, pai, nome: nome.nome, branch: br.branch, raso: p.raso, submodulos: p.submodulos, usarGh, sinal: ctl.signal, aoProgresso: (e) => emissor.progresso(e),
              silencioMs: d.silencioMs ?? SILENCIO_PADRAO_MS, totalMs: d.totalMs ?? TOTAL_PADRAO_MS,
              ...(d.ambienteBase === undefined ? {} : { ambienteBase: d.ambienteBase }),
              ...(d.executavelGit === undefined ? {} : { executavelGit: d.executavelGit }),
              ...(d.executavelGh === undefined ? {} : { executavelGh: d.executavelGh }),
            });
            const ws = await adicionar(r.caminho); // adiciona e TROCA para o workspace; nada do repositório é executado
            registrar("clone_concluido", { host: o.origem.host, repo: o.origem.repo, workspace_id: ws?.id ?? null, duracao_ms: agora() - inicio });
            emissor.terminal("concluido", { workspace: ws, mensagem: "Pronto: o repositório está na sua máquina." });
          } catch (e) {
            const erro = fio(e);
            registrar(erro.codigo === "cancelado" ? "clone_cancelado" : "clone_falhou", { host: o.origem.host, repo: o.origem.repo, codigo: erro.codigo });
            emissor.terminal(erro.codigo === "cancelado" ? "cancelado" : "falhou", { erro, mensagem: erro.mensagem });
          } finally {
            clones.delete(cloneId);
            destinosAtivos.delete(destino);
          }
        })();
        clones.set(cloneId, { ctl, destino, fim });
        return { ok: true, clone_id: cloneId };
      } catch (e) {
        return { ok: false, erro: fio(e) };
      }
    },

    cancelarClone(cloneId) {
      const t = clones.get(cloneId);
      if (t === undefined) return false;
      t.ctl.abort();
      return true;
    },

    buscarProjetos() {
      busca?.ctl.abort();
      const ctl = new AbortController();
      const buscaId = id("bu");
      busca = { id: buscaId, ctl };
      let pendentes: AchadoProjeto[] = [];
      let visitados = 0;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const enviar = (fim: boolean, cancelada: boolean, limite: boolean): void => {
        if (timer !== null) { clearTimeout(timer); timer = null; }
        d.emitir("workspaces:adicionar_projetos_lote", { busca_id: buscaId, itens: pendentes.splice(0, pendentes.length), visitados, fim, cancelada, limite_atingido: limite });
      };
      void (async (): Promise<void> => {
        const conhecidos = await jaWorkspaces().catch(() => new Set<string>());
        try {
          const r = await varrerProjetos({
            raizes: raizesPadrao(casa()), sinal: ctl.signal,
            aoLote: (itens, vis) => {
              visitados = vis;
              for (const a of itens) {
                if (achados.size >= MAX_ACHADOS) {
                  const primeiro = achados.keys().next().value as string;
                  achados.delete(primeiro);
                }
                const achadoId = id("ach");
                achados.set(achadoId, a.caminho);
                pendentes.push({ id: achadoId, nome: a.nome, exibicao: mascararCaminho(a.caminho, casa()), branch: a.branch, e_git: a.e_git, manifesto: a.manifesto, ja_workspace: conhecidos.has(a.caminho) });
              }
              if (timer === null) timer = setTimeout(() => enviar(false, false, false), INTERVALO_EVENTOS_MS);
            },
          });
          visitados = r.visitados;
          enviar(true, r.cancelada, r.limiteAtingido);
        } catch {
          enviar(true, ctl.signal.aborted, false);
        } finally {
          if (busca?.id === buscaId) busca = null;
        }
      })();
      return { busca_id: buscaId };
    },

    cancelarBusca(buscaId) {
      if (busca === null || busca.id !== buscaId) return false;
      busca.ctl.abort();
      return true;
    },

    async adicionarAchado(achadoId) {
      const caminho = achados.get(achadoId);
      if (caminho === undefined) throw new ErroAdicionarNucleo("destino_invalido", "Esse achado expirou. Procure de novo.");
      const ws = await adicionar(caminho);
      registrar("workspace_adicionado", { via: "varredura", workspace_id: ws?.id ?? null });
      return ws;
    },

    estadoGh: verEstadoGh,

    async listarRepos(consentimento) {
      try {
        if (consentimento !== true) throw new ErroAdicionarNucleo("consentimento", "Confirme que pode consultar o GitHub para listar seus repositórios.");
        const r = await listarMeusRepositorios({ executor, cwd: casa(), ...(d.executavelGh === undefined ? {} : { executavel: d.executavelGh }) });
        registrar("repos_listados", { total: r.repos.length });
        return { ok: true, repos: r.repos, truncado: r.truncado };
      } catch (e) {
        return { ok: false, erro: fio(e) };
      }
    },

    async criarNovo(p) {
      try {
        const nome = validarNomePasta(p.nome);
        if (!nome.ok) throw new ErroAdicionarNucleo("nome_invalido", nome.motivo);
        const pai = pastaDoToken(p.destino_token);
        const r = await criarNovoProjeto({ executor, pai, nome: nome.nome, git: p.git, gitignore: p.gitignore, commit_inicial: p.commit_inicial, readme: p.readme, template: p.template, ...(d.executavelGit === undefined ? {} : { executavelGit: d.executavelGit }) });
        const ws = await adicionar(r.caminho);
        if (ws === null) throw new ErroAdicionarNucleo("interno", "O projeto foi criado, mas não foi possível adicioná-lo como workspace.");
        registrar("projeto_criado", { template: p.template, git: r.git, commit: r.commitFeito, workspace_id: ws.id });
        return { ok: true, workspace: ws, avisos: r.avisos, instalar_suite: p.instalar_suite };
      } catch (e) {
        return { ok: false, erro: fio(e) };
      }
    },

    async encerrar() {
      busca?.ctl.abort();
      const todos = [...clones.values()];
      for (const t of todos) t.ctl.abort();
      await Promise.race([Promise.allSettled(todos.map((t) => t.fim)), new Promise((r) => setTimeout(r, 3_000))]);
    },
  };
}

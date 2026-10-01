// Serviço de Missões (T-02.05): criar (livre|squad|agentico, com origem), worktree para Missão de
// trabalho, uma Missão por árvore, estados pela máquina de `estados.ts`, encerrar/abortar sem nunca
// apagar worktree, pasta `<PRODUTO.pastaNoProjeto>/missoes/<id>/` sob demanda e abertura dos Panes
// pedidos em `clis`. Nada aqui lê ou escreve `docs/**` (D-04).
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { DetalheMissao, PedidoCriarMissao } from "../../compartilhado/dominio";
import type { Banco } from "../banco";
import type { Repositorios } from "../banco/repos";
import {
  ErroDominio, MODOS_MISSAO, ORIGENS_MISSAO, PAPEIS, ValorInvalidoErro, missaoTerminal,
  type EstadoMissao, type Handoff, type Mission, type OrigemMissao, type Pagina, type Papel, type Workspace,
} from "../dominio";
import { PRODUTO } from "../produto";
import { worktreeRemove } from "../git";
import { caminhoAte, exigirTransicao, ocupaArvore } from "./estados";
import { registrarEventoDominio } from "./eventos";
import type { ServicoPanes } from "./panes";
import { criarWorktreeDaMissao } from "./worktree";

export class ArvoreOcupadaErro extends ErroDominio {
  override name = "ArvoreOcupadaErro";
  constructor(readonly arvore: string, readonly missionId: string) {
    super(`A árvore "${arvore}" já tem a Missão ativa ${missionId}: uma Missão por árvore.`);
  }
}
export class PilotoObrigatorioErro extends ErroDominio {
  override name = "PilotoObrigatorioErro";
  constructor(readonly modo: string) {
    super(`O modo ${modo} exige uma CLI para o papel "piloto".`);
  }
}
export class TrabalhoJaLigadoErro extends ErroDominio {
  override name = "TrabalhoJaLigadoErro";
  constructor(readonly trabalhoId: string, readonly missionId: string) {
    super(`O trabalho ${trabalhoId} já está ligado à Missão ${missionId}.`);
  }
}

export interface ExtraCriarMissao {
  /** id da ocorrência (`OC-2026-0142`), quando já existe. */
  oc_id?: string;
  tipo_ocorrencia?: "bug" | "ajuste" | "chore" | string;
  /** liga já na criação (adoção de trabalho criado fora do ADE). */
  trabalho_id?: string;
  /** worktree já existente (relativo à raiz do repo): não cria outro. */
  worktree_existente?: { worktree: string; branch: string | null };
  /** não cria worktree (adoção de trabalho que vive na árvore principal). */
  sem_worktree?: boolean;
}

export interface ComandoInicialEntrada {
  origem: OrigemMissao;
  pedido: string;
  cli: string;
  titulo: string;
}

export interface DependenciasMissoes {
  banco: Banco;
  repos: Repositorios;
  workspaces: { exigir(id: string): Workspace };
  panes: ServicoPanes;
  pastaProjeto?: string;
  /** Comando do método a digitar no Pane inicial (vira prompt inicial); `null` = nenhum. */
  comandoInicial?: (e: ComandoInicialEntrada) => string | null;
  aoMudar?: (e: { workspace_id: string; mission_id: string | null }) => void;
  /** Eventos de domínio do barramento (`mission.created`, `mission.closed`…). */
  aoEventoDominio?: (tipo: string, payload: Record<string, unknown>) => void;
  aviso?: (mensagem: string) => void;
}

export interface ServicoMissoes {
  criar(pedido: PedidoCriarMissao, extra?: ExtraCriarMissao): Promise<Mission>;
  listar(workspaceId: string, estado: EstadoMissao | null, depois: string | null): Promise<Pagina<Mission>>;
  detalhe(missionId: string): Promise<DetalheMissao | null>;
  transicionar(missionId: string, para: EstadoMissao): Promise<Mission>;
  encerrar(missionId: string): Promise<Mission | null>;
  abortar(missionId: string): Promise<Mission | null>;
  definirTrabalho(missionId: string, trabalhoId: string): Promise<Mission>;
  /** Cria (sob demanda) a pasta da Missão e devolve o caminho relativo à raiz da árvore. */
  garantirPastaMissao(missionId: string): Promise<string>;
}

const PAPEIS_DE_CLI: readonly Papel[] = PAPEIS.filter((p) => p !== "nenhum");
const TITULO_MAX = 120;
const TRABALHO_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

export function criarServicoMissoes(deps: DependenciasMissoes): ServicoMissoes {
  const { banco, repos, panes } = deps;
  const pastaProjeto = deps.pastaProjeto ?? PRODUTO.pastaNoProjeto;
  const avisar = (mission: Mission): void => deps.aoMudar?.({ workspace_id: mission.workspace_id, mission_id: mission.id });
  const aviso = (m: string): void => deps.aviso?.(m);
  // criar é serializado: a checagem de árvore ocupada e a criação do worktree não podem se cruzar
  let fila: Promise<unknown> = Promise.resolve();

  async function garantirPasta(mission: Mission): Promise<{ relativo: string; absoluto: string }> {
    const ws = deps.workspaces.exigir(mission.workspace_id);
    const base = mission.worktree === null ? ws.raiz : resolve(ws.raiz, mission.worktree);
    const relativo = `${pastaProjeto}/missoes/${mission.id}`;
    const absoluto = join(base, pastaProjeto, "missoes", mission.id);
    await mkdir(absoluto, { recursive: true });
    // `.gitignore` interno: o que o app grava no repositório do usuário nunca entra num commit por acidente
    await writeFile(join(base, pastaProjeto, ".gitignore"), "*\n", { flag: "wx" }).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "EEXIST") throw e;
    });
    return { relativo, absoluto };
  }

  async function gravarBrief(mission: Mission, pedido: string): Promise<void> {
    const { absoluto } = await garantirPasta(mission);
    const alvo = join(absoluto, "brief.md");
    const tmp = `${alvo}.${process.pid}.tmp`;
    await writeFile(tmp, `# ${mission.titulo}\n\n${pedido.trim()}\n`, { mode: 0o600 });
    await rename(tmp, alvo);
  }

  function registrarFim(mission: Mission): void {
    const payload = {
      mission_id: mission.id,
      workspace_id: mission.workspace_id,
      estado: mission.estado,
      worktree: mission.worktree,
      branch: mission.branch,
      // encerrar/abortar nunca apaga worktree: quem decide é a pessoa
      worktree_mantido: mission.worktree !== null,
    };
    try {
      registrarEventoDominio(banco, "mission.closed", payload);
    } catch (e) {
      aviso(`não foi possível registrar o fim da Missão ${mission.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
    deps.aoEventoDominio?.("mission.closed", payload);
  }

  async function fecharPanes(missionId: string, motivo: string): Promise<void> {
    for (const p of repos.pane.listarPorMissao(missionId)) {
      if (p.estado !== "encerrado") await panes.encerrarPane(p.id, motivo);
    }
  }

  async function criarSerializado(pedido: PedidoCriarMissao, extra: ExtraCriarMissao): Promise<Mission> {
    const titulo = typeof pedido.titulo === "string" ? pedido.titulo.trim() : "";
    if (titulo === "" || [...titulo].length > TITULO_MAX) throw new ValorInvalidoErro("titulo", pedido.titulo);
    if (!(MODOS_MISSAO as readonly string[]).includes(pedido.modo)) throw new ValorInvalidoErro("modo", pedido.modo);
    if (!(ORIGENS_MISSAO as readonly string[]).includes(pedido.origem)) throw new ValorInvalidoErro("origem", pedido.origem);
    const clis = pedido.clis ?? {};
    const entradas = Object.entries(clis) as Array<[Papel, string]>;
    for (const [papel, cli] of entradas) {
      if (!PAPEIS_DE_CLI.includes(papel) || typeof cli !== "string" || cli === "") throw new ValorInvalidoErro("clis", papel);
    }
    if (pedido.modo !== "livre" && clis.piloto === undefined) throw new PilotoObrigatorioErro(pedido.modo);
    const ws = deps.workspaces.exigir(pedido.workspace_id);

    // falha cedo: nenhuma CLI faltando depois de ter criado worktree e Missão
    for (const [, cli] of entradas) await panes.exigirCli(cli);

    const trabalhoProprio = pedido.origem === "feature" || pedido.origem === "ocorrencia";
    const vaiCriarWorktree = trabalhoProprio && ws.e_git && extra.worktree_existente === undefined && extra.sem_worktree !== true;
    const worktreeDaMissao = extra.worktree_existente?.worktree ?? null;
    if (ocupaArvore({ modo: pedido.modo, origem: pedido.origem }) && !vaiCriarWorktree) {
      const ativas = banco.consultar<{ id: string; modo: Mission["modo"]; origem: Mission["origem"]; worktree: string | null }>(
        "SELECT id, modo, origem, worktree FROM mission WHERE workspace_id = ? AND estado NOT IN ('concluida','falhou','abortada')",
        [ws.id],
      );
      const dona = ativas.find((a) => ocupaArvore(a) && a.worktree === worktreeDaMissao);
      if (dona !== undefined) throw new ArvoreOcupadaErro(worktreeDaMissao ?? ".", dona.id);
    }

    const criado = vaiCriarWorktree
      ? await criarWorktreeDaMissao({ raizRepo: ws.raiz, titulo, origem: pedido.origem, ocId: extra.oc_id, tipoOcorrencia: extra.tipo_ocorrencia })
      : null;
    let mission: Mission;
    try {
      mission = repos.mission.criar({
        workspace_id: ws.id,
        modo: pedido.modo,
        origem: pedido.origem,
        titulo,
        trabalho_id: extra.trabalho_id ?? null,
        worktree: criado?.worktree ?? extra.worktree_existente?.worktree ?? null,
        branch: criado?.branch ?? extra.worktree_existente?.branch ?? null,
      });
    } catch (erro) {
      // não deixa worktree órfão: árvore recém-criada e limpa pode voltar sem risco
      if (criado !== null) await worktreeRemove({ repo: ws.raiz, caminho: criado.caminho, apagarBranch: true }).catch(() => undefined);
      throw erro;
    }

    if (typeof pedido.pedido === "string" && pedido.pedido.trim() !== "") {
      await gravarBrief(mission, pedido.pedido).catch((e: unknown) => aviso(`brief da Missão ${mission.id} não gravado: ${e instanceof Error ? e.message : String(e)}`));
    }

    // piloto primeiro; só o primeiro Pane recebe o comando do método (uma entrada automática por vez)
    const ordem = [...entradas].sort(([a], [b]) => Number(b === "piloto") - Number(a === "piloto"));
    for (const [indice, [papel, cli]] of ordem.entries()) {
      try {
        const comando = indice === 0 ? (deps.comandoInicial?.({ origem: pedido.origem, pedido: pedido.pedido, cli, titulo }) ?? null) : null;
        await panes.abrirPane({ missao_id: mission.id, cli, papel, ...(comando === null ? {} : { prompt_inicial: comando }) });
      } catch (e) {
        aviso(`Pane ${papel}/${cli} da Missão ${mission.id} não abriu: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const final = repos.mission.exigir(mission.id);
    deps.aoEventoDominio?.("mission.created", { mission_id: final.id, workspace_id: final.workspace_id, modo: final.modo, origem: final.origem, worktree: final.worktree });
    avisar(final);
    return final;
  }

  return {
    criar(pedido, extra = {}) {
      const execucao = fila.then(() => criarSerializado(pedido, extra));
      fila = execucao.catch(() => undefined);
      return execucao;
    },

    async listar(workspaceId, estado, depois) {
      return repos.mission.listarPorWorkspace(workspaceId, { ...(estado === null ? {} : { estado }), depois, limite: 50 });
    },

    async detalhe(missionId) {
      const mission = repos.mission.obter(missionId);
      if (mission === undefined) return null;
      const tasks = repos.task.listarPorMissao(missionId, { limite: 500 }).itens;
      const handoffs: Handoff[] = tasks.flatMap((t) => repos.handoff.listarPorTask(t.id));
      return { mission, panes: repos.pane.listarPorMissao(missionId), tasks, handoffs };
    },

    async transicionar(missionId, para) {
      const atual = repos.mission.exigir(missionId);
      exigirTransicao(atual.estado, para);
      const nova = repos.mission.transicionar(missionId, para);
      if (missaoTerminal(nova.estado)) registrarFim(nova);
      avisar(nova);
      return nova;
    },

    async encerrar(missionId) {
      const atual = repos.mission.obter(missionId);
      if (atual === undefined) return null;
      const passos = caminhoAte(atual.estado, "concluida");
      if (passos === null) exigirTransicao(atual.estado, "concluida"); // lança o erro nominal
      await fecharPanes(missionId, "missao_encerrada");
      let nova = atual;
      for (const passo of passos as EstadoMissao[]) nova = repos.mission.transicionar(missionId, passo);
      registrarFim(nova);
      avisar(nova);
      return nova;
    },

    async abortar(missionId) {
      const atual = repos.mission.obter(missionId);
      if (atual === undefined) return null;
      exigirTransicao(atual.estado, "abortada");
      await fecharPanes(missionId, "missao_abortada");
      const nova = repos.mission.transicionar(missionId, "abortada");
      registrarFim(nova);
      avisar(nova);
      return nova;
    },

    async definirTrabalho(missionId, trabalhoId) {
      if (typeof trabalhoId !== "string" || !TRABALHO_ID.test(trabalhoId)) throw new ValorInvalidoErro("trabalho_id", trabalhoId);
      const mission = repos.mission.exigir(missionId);
      const outra = banco.consultarUm<{ id: string }>("SELECT id FROM mission WHERE workspace_id = ? AND trabalho_id = ? AND id <> ? LIMIT 1", [mission.workspace_id, trabalhoId, missionId]);
      if (outra !== undefined) throw new TrabalhoJaLigadoErro(trabalhoId, outra.id);
      banco.executar("UPDATE mission SET trabalho_id = ?, atualizado_em = ? WHERE id = ?", [trabalhoId, new Date().toISOString(), missionId]);
      const nova = repos.mission.exigir(missionId);
      avisar(nova);
      return nova;
    },

    async garantirPastaMissao(missionId) {
      const mission = repos.mission.exigir(missionId);
      return (await garantirPasta(mission)).relativo;
    },
  };
}

// Painel livre que orquestra (D-420 a D-427): abre um terminal como Pane piloto da Missão avulsa, liga/desliga a orquestração de um painel que já está aberto
// (reabrindo a CLI com `resume` quando ela suporta) e guarda a preferência do workspace. A criação da Missão, o token e as regras de limite moram na orquestração
// (`orquestracao.ts`) e no núcleo (`nucleo/orquestracao/avulso.ts`); aqui só se costura o IPC. Nada aqui lê ou grava segredo; erro que sobe ao renderer é NOMINAL.
import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { PedidoAprovacaoWorkers, PreferenciaAprovacaoWorkers } from "../compartilhado/aprovacao-workers";
import { ErroAprovacaoWorkers } from "../nucleo/orquestracao/aprovacao-preferencia";
import type { AprovacaoDoPane, PedidoAbrirPainelLivre, PedidoOrquestrarPainel, PedidoPonteGrok, PreferenciaPainelLivre, RespostaOrquestrarPainel, RespostaPainelLivre, RespostaPonteGrok } from "../compartilhado/painel-livre";
import type { Repositorios } from "../nucleo/banco/repos";
import { NaoEncontradoErro, type Pane } from "../nucleo/dominio";
import { ErroMcp } from "../nucleo/mcp/erros";
import { CliIndisponivelErro, ContaInvalidaErro, type ServicoPanes } from "../nucleo/missoes/panes";
import type { PermissaoPane } from "../nucleo/orquestracao/avulso";
import { aplicarPonteGrok, estadoDaPonteGrok, removerPonteGrok } from "../nucleo/orquestracao/ponte-grok";
import { argumentosDeRetomada, CATALOGO_TERMINAIS, recursosDaFerramenta } from "../nucleo/terminais/catalogo";
import { PastaInexistenteErro, type ServicoWorkspaces } from "../nucleo/workspaces/servico";
import type { Orquestracao } from "./orquestracao";

/** Erro que o renderer pode ver (mensagem em PT-BR, sem caminho de máquina nem segredo). */
export class ErroPainelLivre extends Error {
  constructor(readonly codigo: string, mensagem: string) {
    super(mensagem);
    this.name = "ErroPainelLivre";
  }
}

/** O que o painel livre usa do gerenciador de sessões (o real cumpre; teste injeta um falso). */
export interface SessoesDoPainelLivre {
  obter(id: string): { ferramenta_id: string; estado: string; cwd: string } | undefined;
  encerrar(id: string): boolean;
  descartar(id: string): boolean;
}

export interface DepsPainelLivre {
  /** leitura preguiçosa: a orquestração nasce na onda 2 */
  orquestracao: () => Orquestracao | null;
  dominio: {
    repos: Pick<Repositorios, "pane" | "mission">;
    workspaces: Pick<ServicoWorkspaces, "exigir">;
    panes: Pick<ServicoPanes, "abrirPane" | "encerrarPane" | "exigirCli">;
  };
  sessoes: () => Promise<SessoesDoPainelLivre>;
  /** sessão -> id da conversa da CLI (Claude/Codex), para `resume` */
  conversas: { listar(): Record<string, string> };
  /** permissão efetiva do workspace (D-14); o painel herda exatamente esta */
  permissaoDoWorkspace: (workspace_id: string) => PermissaoPane;
  agora?: () => Date;
  /** espera entre encerrar a sessão antiga e abrir a nova (a CLI precisa soltar a conversa); padrão 250 ms */
  esperaMs?: number;
}

export interface PainelLivre {
  preferencia(p: { workspace_id: string; ativa?: boolean; orquestrador_edita?: boolean; fechar_workers?: boolean }): PreferenciaPainelLivre;
  /** D-514: ponte do Grok (arquivo de projeto) com autorização explícita do dono; `aplicar` só é chamado depois do diálogo que mostra o arquivo exato. */
  ponteGrok(p: PedidoPonteGrok): RespostaPonteGrok;
  /** D-640: política de aprovações dos workers (padrão global ou por workspace). `total` só com a palavra digitada. */
  aprovacao(p: PedidoAprovacaoWorkers): PreferenciaAprovacaoWorkers;
  /** D-640: o que o app aplicou ao lançar um worker (nível efetivo, selo, avisos). */
  aprovacaoDoPane(p: { pane_id: string }): AprovacaoDoPane | null;
  abrir(p: PedidoAbrirPainelLivre): Promise<RespostaPainelLivre>;
  orquestrar(p: PedidoOrquestrarPainel): Promise<RespostaOrquestrarPainel>;
}

const nomeDaCli = (id: string): string => CATALOGO_TERMINAIS.find((f) => f.id === id)?.nome ?? id;
const espera = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

/** `cwd` da sessão antiga só vale se ainda existe e fica DENTRO do workspace (o renderer nunca manda caminho; isto vem do próprio main). */
function cwdDentro(raiz: string, cwd: string): string | null {
  if (!existsSync(cwd)) return null;
  const rel = relative(resolve(raiz), resolve(cwd));
  return rel.startsWith("..") || isAbsolute(rel) ? null : resolve(cwd);
}

export function criarPainelLivre(d: DepsPainelLivre): PainelLivre {
  const agora = d.agora ?? ((): Date => new Date());
  const hora = (): string => `${String(agora().getHours()).padStart(2, "0")}:${String(agora().getMinutes()).padStart(2, "0")}`;

  function orq(): Orquestracao {
    const o = d.orquestracao();
    if (o === null) throw new ErroPainelLivre("indisponivel", "A orquestração ainda está iniciando. Tente de novo em instantes.");
    return o;
  }

  async function preflight(cli: string, workspaceId: string): Promise<void> {
    if (!orq().avulso.preferencia(workspaceId)) {
      throw new ErroPainelLivre("preferencia_desligada", "Painéis livres não podem abrir agentes neste projeto: permita primeiro em Orquestrar neste painel.");
    }
    const f = await d.dominio.panes.exigirCli(cli);
    if (cli === "grok") {
      // D-514: o Grok só orquestra com a ponte do projeto autorizada pelo dono (arquivo de projeto; nunca a configuração global)
      const raiz = d.dominio.workspaces.exigir(workspaceId).raiz;
      if (estadoDaPonteGrok(raiz).estado !== "ativa") {
        throw new ErroPainelLivre("ponte_necessaria", "Grok ainda não orquestra neste projeto: autorize a ponte do servidor do app (arquivo .grok/config.toml do projeto) ou use Claude Code, Codex ou OpenCode como orquestrador.");
      }
      return;
    }
    if (!recursosDaFerramenta(cli).mcp) {
      throw new ErroPainelLivre("cli_sem_mcp", `${f.nome} não fala com o MCP do app: Orquestrar neste painel funciona com Claude Code, Codex e OpenCode (e Grok com a ponte do projeto).`);
    }
  }

  /** Abre o painel como piloto de uma Missão avulsa nova. Falha ao abrir desfaz a Missão (nada órfão). */
  async function abrirOrquestrando(workspaceId: string, cli: string, extra: { argumentos?: string[]; cwd?: string }): Promise<{ pane: Pane; sessao_id: string; missao_id: string }> {
    const o = orq();
    const missao = o.avulso.criarMissao({ workspace_id: workspaceId, rotulo: `${nomeDaCli(cli)} ${hora()}`, permissao: d.permissaoDoWorkspace(workspaceId) });
    try {
      const aberto = await d.dominio.panes.abrirPane({
        missao_id: missao.id, cli, papel: "piloto", contexto: { avulso: true },
        ...(extra.argumentos === undefined || extra.argumentos.length === 0 ? {} : { argumentos: extra.argumentos }),
        ...(extra.cwd === undefined ? {} : { cwd: extra.cwd }),
      });
      o.avulso.vincularPane(missao.id, aberto.pane.id);
      return { pane: aberto.pane, sessao_id: aberto.sessao_id, missao_id: missao.id };
    } catch (erro) {
      await o.avulso.encerrarMissao(missao.id, "falha_ao_abrir");
      throw erro;
    }
  }

  return {
    preferencia({ workspace_id, ativa, orquestrador_edita, fechar_workers }) {
      const o = orq();
      d.dominio.workspaces.exigir(workspace_id);
      if (ativa !== undefined) o.avulso.definirPreferencia(workspace_id, ativa);
      if (orquestrador_edita !== undefined) o.avulso.definirOrquestradorEdita(workspace_id, orquestrador_edita);
      if (fechar_workers !== undefined) o.avulso.definirFecharWorkers(workspace_id, fechar_workers);
      return { workspace_id, ativa: o.avulso.preferencia(workspace_id), orquestrador_edita: o.avulso.orquestradorEdita(workspace_id), fechar_workers: o.avulso.fecharWorkers(workspace_id) };
    },

    aprovacao(p) {
      if (p.workspace_id !== null) d.dominio.workspaces.exigir(p.workspace_id);
      try {
        return orq().avulso.aprovacao(p);
      } catch (erro) {
        if (erro instanceof ErroAprovacaoWorkers) throw new ErroPainelLivre(erro.codigo, erro.message);
        throw erro;
      }
    },

    aprovacaoDoPane: ({ pane_id }) => orq().avulso.aprovacaoDoPane(pane_id),

    ponteGrok({ workspace_id, acao }) {
      const raiz = d.dominio.workspaces.exigir(workspace_id).raiz;
      const r = acao === "aplicar" ? aplicarPonteGrok(raiz) : acao === "remover" ? removerPonteGrok(raiz) : estadoDaPonteGrok(raiz);
      return { estado: r.estado, arquivo: r.arquivo, conteudo: r.conteudo, detalhe: r.detalhe };
    },

    async abrir({ workspace_id, ferramenta_id, orquestrar }) {
      const ws = d.dominio.workspaces.exigir(workspace_id);
      if (!orquestrar) {
        await d.dominio.panes.exigirCli(ferramenta_id);
        const livre = await d.dominio.panes.abrirPane({ workspace_id: ws.id, cli: ferramenta_id });
        return { sessao_id: livre.sessao_id, pane_id: livre.pane.id, missao_id: null, orquestrando: false, aviso: null };
      }
      await preflight(ferramenta_id, ws.id);
      const r = await abrirOrquestrando(ws.id, ferramenta_id, {});
      return { sessao_id: r.sessao_id, pane_id: r.pane.id, missao_id: r.missao_id, orquestrando: true, aviso: null };
    },

    async orquestrar({ workspace_id, sessao_id, ligar }) {
      const ws = d.dominio.workspaces.exigir(workspace_id);
      const sessoes = await d.sessoes();
      const info = sessoes.obter(sessao_id);
      if (info === undefined || info.estado === "encerrada" || info.estado === "erro") throw new ErroPainelLivre("sessao_desconhecida", "Esta sessão já terminou: abra um painel novo.");
      const cli = info.ferramenta_id;
      if (cli === "terminal") throw new ErroPainelLivre("cli_sem_mcp", "O terminal comum não tem agente para orquestrar.");
      const atual = d.dominio.repos.pane.listarPorWorkspace(ws.id, { somenteAtivos: true, limite: 500 }).itens.find((p) => p.sessao_pty_id === sessao_id);
      const o = orq();
      const emMissao = atual !== undefined && atual.mission_id !== null;
      const ehAvulso = emMissao && o.avulso.ehMissaoAvulsa(atual.mission_id as string) && atual.eh_piloto;
      // Pane de Missão real (piloto, worker, squad, Maestro) NÃO é painel livre: o interruptor nunca o toca
      if (emMissao && !ehAvulso) throw new ErroPainelLivre("painel_de_missao", "Este painel pertence a uma Missão: a orquestração dele é a da Missão.");
      if (ehAvulso === ligar) {
        // nada a mudar (já está no estado pedido): devolve a MESMA sessão
        return { sessao_id, pane_id: atual?.id ?? null, missao_id: atual?.mission_id ?? null, orquestrando: ehAvulso, retomado: true, aviso: null };
      }
      if (ligar) await preflight(cli, ws.id);

      // conversa a retomar: o Pane guarda o id; o painel comum, o armazém de conversas por sessão
      const conversa = d.conversas.listar()[sessao_id] ?? (atual === undefined ? undefined : d.dominio.repos.pane.ultimaSessao(atual.id)?.cli_ref_conversa) ?? undefined;
      const cwd = cwdDentro(ws.raiz, info.cwd);
      // a conversa da CLI é por pasta: mudar de pasta quebra o `resume`, então só se retoma quando a pasta se mantém
      const argsRetomada = conversa !== undefined && cwd !== null ? argumentosDeRetomada(cli, conversa) : null;

      // 1) encerra a sessão antiga (e, ao desligar, a Missão avulsa com os workers) ANTES de abrir a nova: duas CLIs na mesma conversa se atropelariam
      if (ehAvulso) await o.avulso.encerrarMissao((atual as Pane).mission_id as string, "orquestracao_desligada");
      if (atual !== undefined) await d.dominio.panes.encerrarPane(atual.id, "orquestracao_alterada");
      else sessoes.encerrar(sessao_id);
      sessoes.descartar(sessao_id);
      await espera(d.esperaMs ?? 250);

      // 2) abre a nova no mesmo lugar (a UI troca a sessão na grade): com `resume` quando suportado
      const extra = { ...(argsRetomada === null ? {} : { argumentos: argsRetomada }), ...(cwd === null ? {} : { cwd }) };
      let resposta: { sessao_id: string; pane_id: string | null; missao_id: string | null };
      if (ligar) {
        const r = await abrirOrquestrando(ws.id, cli, extra);
        resposta = { sessao_id: r.sessao_id, pane_id: r.pane.id, missao_id: r.missao_id };
      } else {
        const livre = await d.dominio.panes.abrirPane({ workspace_id: ws.id, cli, ...extra });
        resposta = { sessao_id: livre.sessao_id, pane_id: livre.pane.id, missao_id: null };
      }
      const retomado = argsRetomada !== null;
      return {
        ...resposta, orquestrando: ligar, retomado,
        aviso: retomado ? null : "A CLI não retomou a conversa anterior (ela não oferece retomada nesta pasta); o painel abriu uma sessão nova.",
      };
    },
  };
}

/** Erros que o renderer pode ver com a mensagem; o resto vira texto genérico (nunca caminho de máquina, token ou detalhe interno). */
export function sanearErroDePainelLivre(e: unknown): Error {
  if (e instanceof ErroPainelLivre) return e;
  if (e instanceof ErroMcp) return new ErroPainelLivre(e.subcode ?? e.code, e.message);
  if (e instanceof NaoEncontradoErro) return new ErroPainelLivre("not_found", e.message);
  if (e instanceof CliIndisponivelErro) return new ErroPainelLivre("cli_indisponivel", e.message);
  if (e instanceof ContaInvalidaErro) return new ErroPainelLivre("conta_invalida", e.message);
  if (e instanceof PastaInexistenteErro) return new ErroPainelLivre("pasta_inexistente", "A pasta do projeto não existe mais.");
  return new ErroPainelLivre("indisponivel", "Não foi possível alterar a orquestração deste painel.");
}

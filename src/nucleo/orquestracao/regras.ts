/**
 * Regras de orquestração EM CÓDIGO (T-03.05): nenhuma depende só de prompt. Funções puras sobre
 * dados já lidos pelas tools; lançam `ErroMcp` do contrato.
 */
import { isAbsolute, resolve } from "node:path";
import { missaoTerminal } from "../dominio";
import type { ModoMissao, Papel } from "../dominio";
import { conflito, violacaoDeRegra } from "../mcp/erros";
import type { AgenteDoSquad, MissaoInfo, PaneInfo, Portao, ProvedorInfo } from "../mcp/portas";
import { dentroDaPastaDoProduto } from "./pasta";

/** Decisões de configuração centralizadas (B-orquestração, notas transversais). */
export const MAX_PANES_PARALELOS = 8;
export const MAX_STOP_RETRIES = 3;
export const RESUMO_MAX = 400;
/** Texto acima disto (bytes UTF-8) em `pane_send` vira arquivo. */
export const LIMITE_TEXTO_DIRETO_BYTES = 20 * 1024;

/** Portão de intake exigido para abrir um worker de cada papel. */
export const PORTAO_POR_PAPEL: Readonly<Record<Papel, Portao | null>> = {
  piloto: null,
  nenhum: null,
  explorador: "direction",
  executor: "build",
  revisor: "qa",
};

export const PAPEIS_WORKER: readonly Papel[] = ["executor", "explorador", "revisor"];

export interface EntradaSpawn {
  chamador: { pane_id: string; papel: Papel; modo: ModoMissao };
  missao: MissaoInfo | null;
  /** papel pedido; `null` = deduzir do agente (ou executor) */
  papel_pedido: Papel | null;
  agente_id: string | null;
  provedor: string;
  provedores: readonly ProvedorInfo[];
  panes_vivos: readonly PaneInfo[];
  max_paralelos?: number;
}

export interface ResultadoSpawn {
  papel: Papel;
  avisos: string[];
}

function agenteDoSquad(missao: MissaoInfo | null, modo: ModoMissao, agente_id: string): AgenteDoSquad | null {
  const lista = missao?.agentes_do_squad ?? (modo === "squad" ? [] : null);
  if (lista === null) return { agente_id, papel: "nenhum" }; // sem squad definido: sem restrição
  return lista.find((a) => a.agente_id === agente_id) ?? null;
}

/**
 * Valida um `pane_spawn` na ordem do contrato: portão → papel → limite → provedor habilitado.
 * Devolve o papel efetivo do worker e avisos de política (não bloqueiam).
 */
export function verificarSpawn(e: EntradaSpawn): ResultadoSpawn {
  const { chamador, missao } = e;
  const emMissao = chamador.modo !== "livre";

  // agente (quando informado) define o papel padrão; resolvido antes do portão para o portão valer para o papel real
  let papel: Papel | null = e.papel_pedido;
  let agente: AgenteDoSquad | null = null;
  if (e.agente_id !== null) {
    agente = agenteDoSquad(missao, chamador.modo, e.agente_id);
    if (agente !== null && papel === null && agente.papel !== "nenhum") papel = agente.papel;
  }
  const efetivo: Papel = papel ?? "executor";

  // 1) portão de intake
  if (emMissao) {
    if (missao === null) throw violacaoDeRegra("not_in_mission", "O Pane não pertence a uma Missão.");
    if (missaoTerminal(missao.estado)) throw conflito("A Missão já foi encerrada.");
    const exigido = PORTAO_POR_PAPEL[efetivo];
    if (exigido !== null && !missao.portoes_liberados.includes(exigido)) {
      throw violacaoDeRegra("gate_pending", `O portão de intake "${exigido}" ainda não foi liberado.`);
    }
  }

  // 2) papel
  if (emMissao && chamador.papel !== "piloto") {
    throw violacaoDeRegra("forbidden_role", "Só o piloto da Missão abre workers.");
  }
  if (efetivo === "piloto") {
    throw violacaoDeRegra("forbidden_role", "O piloto não invoca o orquestrador nem a si mesmo.");
  }
  if (e.agente_id !== null) {
    if (agente === null) throw violacaoDeRegra("forbidden_role", `O agente "${e.agente_id}" não pertence ao squad da Missão.`);
    if (agente.papel === "piloto") throw violacaoDeRegra("forbidden_role", "O piloto não invoca o orquestrador nem a si mesmo.");
    if (agente.papel !== "nenhum" && e.papel_pedido !== null && agente.papel !== e.papel_pedido) {
      throw violacaoDeRegra("forbidden_role", `O agente "${e.agente_id}" tem outro papel no squad.`);
    }
  }

  // 3) limite de workers paralelos
  const maximo = e.max_paralelos ?? MAX_PANES_PARALELOS;
  const vivos = e.panes_vivos.filter((p) => !p.eh_piloto && p.estado !== "encerrado").length;
  if (vivos >= maximo) throw violacaoDeRegra("limit_reached", `Limite de ${maximo} panes paralelos atingido.`);

  // 4) provedor habilitado
  const provedor = e.provedores.find((p) => p.provedor === e.provedor);
  if (provedor === undefined || !provedor.habilitado) {
    throw violacaoDeRegra("provider_disabled", `O provedor "${e.provedor}" não está habilitado.`);
  }

  // política: revisor de provedor diferente do executor, quando possível (aviso)
  const avisos: string[] = [];
  if (efetivo === "revisor") {
    const dosExecutores = new Set(e.panes_vivos.filter((p) => p.papel === "executor").map((p) => p.provedor));
    const alternativas = e.provedores.filter((p) => p.habilitado && !dosExecutores.has(p.provedor));
    if (dosExecutores.has(e.provedor) && alternativas.length > 0) {
      avisos.push(`O revisor usa o mesmo provedor do executor ("${e.provedor}"); há outros habilitados.`);
    }
  }
  return { papel: efetivo, avisos };
}

/** Herança: todo worker nasce com a missão e o papel do pedido (nunca do argumento). */
export function herancaDoWorker(chamador: { mission_id: string | null }, papel: Papel): { mission_id: string | null; papel: Papel } {
  return { mission_id: chamador.mission_id, papel };
}

/** `mission_complete`: só o piloto, dentro de Missão, com handoff ok de revisor. */
export function verificarConclusao(e: { papel: Papel; missao: MissaoInfo | null; revisor_ok: boolean }): void {
  if (e.missao === null) throw violacaoDeRegra("not_in_mission", "O Pane não pertence a uma Missão.");
  if (e.papel !== "piloto") throw violacaoDeRegra("forbidden_role", "Só o piloto conclui a Missão.");
  if (missaoTerminal(e.missao.estado)) throw conflito("A Missão já foi encerrada.");
  if (!e.revisor_ok) throw violacaoDeRegra("reviewer_required", "A Missão exige um handoff ok de um revisor.");
}

/** O piloto não fecha a si mesmo nem outro piloto. */
export function verificarFechamento(e: { chamador: { pane_id: string; papel: Papel }; alvo: PaneInfo }): void {
  if (e.alvo.eh_piloto || e.alvo.pane_id === e.chamador.pane_id) {
    throw violacaoDeRegra("forbidden_role", "O Pane do piloto não pode ser fechado por esta tool.");
  }
}

/** Nomes de ferramenta de escrita de arquivo do Claude Code. */
export const FERRAMENTAS_DE_ESCRITA: readonly string[] = ["Edit", "Write", "MultiEdit", "NotebookEdit"];

export interface DecisaoGuarda {
  permitido: boolean;
  motivo: string | null;
}

/**
 * Guarda anti-piloto-que-codifica: o piloto só escreve dentro da pasta do produto. Vale sob
 * `--dangerously-skip-permissions` porque roda como hook PreToolUse das settings do Pane.
 * `entrada` é o `tool_input` do hook (file_path / notebook_path); `cwd` resolve caminhos relativos.
 */
export function guardaDoPiloto(e: { raiz: string; cwd: string | null; ferramenta: string; entrada: unknown }): DecisaoGuarda {
  if (!FERRAMENTAS_DE_ESCRITA.includes(e.ferramenta)) return { permitido: true, motivo: null };
  const dados = typeof e.entrada === "object" && e.entrada !== null ? (e.entrada as Record<string, unknown>) : {};
  const bruto = dados["file_path"] ?? dados["notebook_path"] ?? dados["path"];
  const negar = (): DecisaoGuarda => ({
    permitido: false,
    motivo: "O piloto orquestra e não escreve código: delegue a um worker. Só é permitido gravar dentro da pasta do produto.",
  });
  if (typeof bruto !== "string" || bruto === "" || bruto.includes("\0")) return negar();
  const base = e.cwd !== null && isAbsolute(e.cwd) ? e.cwd : e.raiz;
  const absoluto = isAbsolute(bruto) ? resolve(bruto) : resolve(base, bruto);
  return dentroDaPastaDoProduto(e.raiz, absoluto) ? { permitido: true, motivo: null } : negar();
}

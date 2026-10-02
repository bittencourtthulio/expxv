// Canais `missoes:*` (T-02.05). O renderer NUNCA envia `cwd`, worktree nem branch: o main decide
// (worktree pelo serviço, cwd do Pane pela Missão). `clis` só aceita papéis e ferramentas conhecidos.
import { PORTOES_MISSAO, type PedidoCriarMissao } from "../../compartilhado/dominio";
import { ESTADOS_MISSAO, MODOS_MISSAO, ORIGENS_MISSAO, PAPEIS, type Mission, type Papel } from "../../nucleo/dominio";
import { CLI_AUTOMATICA, type ServicoMissoes } from "../../nucleo/missoes/servico";
import type { ServicoPortoes } from "../../nucleo/orquestracao/portoes";
import { CATALOGO_TERMINAIS } from "../../nucleo/terminais/catalogo";
import { vIdMissao, vIdWorkspace, vOuNulo, vRotulo, vTextoLivre } from "./comum-dominio";
import type { RegistroIpc } from "./registro";
import { vCli, vSlug } from "./squads";
import { vEnum, vObjeto, type Resultado, type Validador } from "./validar";
import { vObjetoOpc } from "./validar-harness";

const PAPEIS_DE_CLI = PAPEIS.filter((p) => p !== "nenhum");
const FERRAMENTAS = CATALOGO_TERMINAIS.map((f) => f.id);
/** "Automático" (T-09.16) vale como CLI de qualquer papel: o harness resolve no serviço, antes de abrir o Pane. */
const vFerramenta = vEnum([...FERRAMENTAS, CLI_AUTOMATICA]);

/** `{ piloto?: cli, executor?: cli, … }`: só papéis de CLI, só ferramentas do catálogo, reconstruído. */
export const vClis: Validador<Partial<Record<Papel, string>>> = (v): Resultado<Partial<Record<Papel, string>>> => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return { ok: false, erro: "esperado objeto" };
  const saida: Partial<Record<Papel, string>> = {};
  for (const [papel, cli] of Object.entries(v as Record<string, unknown>)) {
    if (!(PAPEIS_DE_CLI as readonly string[]).includes(papel)) return { ok: false, erro: `papel desconhecido: ${papel}` };
    const r = vFerramenta(cli);
    if (!r.ok) return { ok: false, erro: `clis.${papel}: ${r.erro}` };
    saida[papel as Papel] = r.valor;
  }
  return { ok: true, valor: saida };
};

function refinarCriar(base: Validador<PedidoCriarMissao>): Validador<PedidoCriarMissao> {
  return (v) => {
    const r = base(v);
    if (!r.ok) return r;
    if (r.valor.squad_id !== undefined && r.valor.modo === "livre") return { ok: false, erro: "squad_id: o modo livre não usa squad" };
    if (r.valor.squad_cli !== undefined && r.valor.squad_id === undefined) return { ok: false, erro: "squad_cli: exige squad_id" };
    return r;
  };
}

export const VALIDADORES_MISSOES = {
  listar: vObjeto({ workspace_id: vIdWorkspace, estado: vOuNulo(vEnum(ESTADOS_MISSAO)), depois: vOuNulo(vIdMissao) }),
  // `squad_id`/`squad_cli` (Fase 14): opcionais; só nos modos squad/agêntico; `squad_cli` (cadeado do wizard) exige `squad_id`
  criar: refinarCriar(
    vObjetoOpc(
      { workspace_id: vIdWorkspace, modo: vEnum(MODOS_MISSAO), origem: vEnum(ORIGENS_MISSAO), titulo: vRotulo(120), pedido: vTextoLivre(8_000), clis: vClis },
      { squad_id: vSlug, squad_cli: vCli },
    ),
  ),
  detalhe: vObjeto({ mission_id: vIdMissao }),
  encerrar: vObjeto({ mission_id: vIdMissao }),
  abortar: vObjeto({ mission_id: vIdMissao }),
  portoes: vObjeto({ mission_id: vIdMissao }),
  liberarPortao: vObjeto({ mission_id: vIdMissao, portao: vEnum(PORTOES_MISSAO) }),
} as const;

export interface DependenciasIpcMissoes {
  registro: RegistroIpc;
  servico: Pick<ServicoMissoes, "listar" | "criar" | "detalhe" | "encerrar" | "abortar">;
  /**
   * Fase 14: criação com `squad_id` (o wizard). Passa pelo MESMO caminho da caixa de prompt de squads (intenção, perfil do
   * orquestrador, portões). Ausente = pedido com squad é recusado (nunca cria sem a squad em silêncio).
   */
  criarComSquad?: (pedido: PedidoCriarMissao) => Promise<Mission>;
  /** portões de intake: só a pessoa libera (este canal é o ÚNICO caminho; nenhuma tool MCP faz isto) */
  portoes: ServicoPortoes;
}

export function registrarIpcMissoes(d: DependenciasIpcMissoes): void {
  const { registro, servico, portoes } = d;
  const criar = async (pedido: PedidoCriarMissao): Promise<Mission> => {
    if (pedido.squad_id === undefined) return servico.criar(pedido);
    if (d.criarComSquad === undefined) throw new Error("As squads ainda não estão disponíveis: tente de novo em instantes.");
    return d.criarComSquad(pedido);
  };
  const V = VALIDADORES_MISSOES;
  registro.invoke("missoes:listar", V.listar, ({ workspace_id, estado, depois }) => servico.listar(workspace_id, estado, depois));
  registro.invoke("missoes:criar", V.criar, (pedido: PedidoCriarMissao) => criar(pedido));
  registro.invoke("missoes:detalhe", V.detalhe, ({ mission_id }) => servico.detalhe(mission_id));
  registro.invoke("missoes:encerrar", V.encerrar, ({ mission_id }) => servico.encerrar(mission_id));
  registro.invoke("missoes:abortar", V.abortar, ({ mission_id }) => servico.abortar(mission_id));
  registro.invoke("missoes:portoes", V.portoes, ({ mission_id }) => portoes.estado(mission_id));
  registro.invoke("missoes:liberar_portao", V.liberarPortao, ({ mission_id, portao }) => portoes.liberar(mission_id, portao));
}

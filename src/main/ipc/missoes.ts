// Canais `missoes:*` (T-02.05). O renderer NUNCA envia `cwd`, worktree nem branch: o main decide
// (worktree pelo serviço, cwd do Pane pela Missão). `clis` só aceita papéis e ferramentas conhecidos.
import { PORTOES_MISSAO, type PedidoCriarMissao } from "../../compartilhado/dominio";
import { ESTADOS_MISSAO, MODOS_MISSAO, ORIGENS_MISSAO, PAPEIS, type Papel } from "../../nucleo/dominio";
import type { ServicoMissoes } from "../../nucleo/missoes/servico";
import type { ServicoPortoes } from "../../nucleo/orquestracao/portoes";
import { CATALOGO_TERMINAIS } from "../../nucleo/terminais/catalogo";
import { vIdMissao, vIdWorkspace, vOuNulo, vRotulo, vTextoLivre } from "./comum-dominio";
import type { RegistroIpc } from "./registro";
import { vEnum, vObjeto, type Resultado, type Validador } from "./validar";

const PAPEIS_DE_CLI = PAPEIS.filter((p) => p !== "nenhum");
const FERRAMENTAS = CATALOGO_TERMINAIS.map((f) => f.id);
const vFerramenta = vEnum(FERRAMENTAS);

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

export const VALIDADORES_MISSOES = {
  listar: vObjeto({ workspace_id: vIdWorkspace, estado: vOuNulo(vEnum(ESTADOS_MISSAO)), depois: vOuNulo(vIdMissao) }),
  criar: vObjeto({
    workspace_id: vIdWorkspace,
    modo: vEnum(MODOS_MISSAO),
    origem: vEnum(ORIGENS_MISSAO),
    titulo: vRotulo(120),
    pedido: vTextoLivre(8_000),
    clis: vClis,
  }),
  detalhe: vObjeto({ mission_id: vIdMissao }),
  encerrar: vObjeto({ mission_id: vIdMissao }),
  abortar: vObjeto({ mission_id: vIdMissao }),
  portoes: vObjeto({ mission_id: vIdMissao }),
  liberarPortao: vObjeto({ mission_id: vIdMissao, portao: vEnum(PORTOES_MISSAO) }),
} as const;

export interface DependenciasIpcMissoes {
  registro: RegistroIpc;
  servico: Pick<ServicoMissoes, "listar" | "criar" | "detalhe" | "encerrar" | "abortar">;
  /** portões de intake: só a pessoa libera (este canal é o ÚNICO caminho; nenhuma tool MCP faz isto) */
  portoes: ServicoPortoes;
}

export function registrarIpcMissoes(d: DependenciasIpcMissoes): void {
  const { registro, servico, portoes } = d;
  const V = VALIDADORES_MISSOES;
  registro.invoke("missoes:listar", V.listar, ({ workspace_id, estado, depois }) => servico.listar(workspace_id, estado, depois));
  registro.invoke("missoes:criar", V.criar, (pedido: PedidoCriarMissao) => servico.criar(pedido));
  registro.invoke("missoes:detalhe", V.detalhe, ({ mission_id }) => servico.detalhe(mission_id));
  registro.invoke("missoes:encerrar", V.encerrar, ({ mission_id }) => servico.encerrar(mission_id));
  registro.invoke("missoes:abortar", V.abortar, ({ mission_id }) => servico.abortar(mission_id));
  registro.invoke("missoes:portoes", V.portoes, ({ mission_id }) => portoes.estado(mission_id));
  registro.invoke("missoes:liberar_portao", V.liberarPortao, ({ mission_id, portao }) => portoes.liberar(mission_id, portao));
}

// Canais `memoria:*` (Fase 8, onda 2): validadores estritos e manipuladores. O renderer nunca envia caminho, `cwd` nem `userData`; a
// identidade de agente (token) não passa por aqui: estes canais são AÇÃO HUMANA. Os manipuladores só chamam o serviço da memória
// (`servico.*`); o diálogo de salvar e a gravação atômica da exportação ficam no main (porta `salvarExportacao`).
import type { CanaisInvoke } from "../../compartilhado/ipc";
import { ESCOPOS_MEMORIA, TIPOS_MEMORIA } from "../../compartilhado/memoria";
import type { PedidoAtualizarMemoria, ConfigMemoria, EntradaMemoria, EscopoMemoria, EstadoMemoriaApp, PaginaMemoria, PedidoConfigMemoria, PreviaBrief, ResultadoRestaurar } from "../../compartilhado/memoria";
import { vIdMissao, vIdPane, vIdWorkspace, vOuNulo, vTextoLivre } from "./comum-dominio";
import type { RegistroIpc } from "./registro";
import { vBooleano, vEnum, vInteiro, vLista, vObjeto, vTexto, type Resultado, type Validador } from "./validar";
import { vObjetoOpc, type ValidadoresDaFamilia } from "./validar-harness";

const falha = (erro: string): Resultado<never> => ({ ok: false, erro });

const vIdEntrada = vTexto({ min: 1, max: 80, padrao: /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/ });
const vEscopoOuTudo = vEnum([...ESCOPOS_MEMORIA, "tudo"] as const);
const vModeloEmbedding = vTexto({ min: 1, max: 100, padrao: /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,99}$/ });

/** `retencao_dias`: 0 (sem limite, P-22) ou 7..3650, como o CHECK da tabela. */
const vRetencao: Validador<number> = (v) => {
  const r = vInteiro({ min: 0, max: 3650 })(v);
  if (!r.ok) return r;
  return r.valor === 0 || r.valor >= 7 ? r : falha("retenção deve ser 0 (sem limite) ou de 7 a 3650 dias");
};

const vImportancia: Validador<1 | 2 | 3 | 4 | 5> = (v) => {
  const r = vInteiro({ min: 1, max: 5 })(v);
  return r.ok ? { ok: true, valor: r.valor as 1 | 2 | 3 | 4 | 5 } : r;
};

export const VALIDADORES_MEMORIA = {
  "memoria:estado": vObjeto({ workspace_id: vIdWorkspace }),
  "memoria:config_gravar": vObjetoOpc(
    { workspace_id: vIdWorkspace },
    {
      global_ativa: vBooleano,
      ativa: vBooleano,
      solo: vBooleano,
      squad: vBooleano,
      orcamento_brief_chars: vInteiro({ min: 1500, max: 20_000 }),
      retencao_dias: vRetencao,
      teto_mb: vInteiro({ min: 16, max: 100_000 }),
      pacote_workers: vBooleano,
      embedding_modelo: vOuNulo(vModeloEmbedding),
    },
  ) as Validador<PedidoConfigMemoria>,
  "memoria:missao_config": vObjeto({ mission_id: vIdMissao, ativa: vOuNulo(vBooleano) }),
  "memoria:listar": vObjeto({
    workspace_id: vIdWorkspace,
    escopo: vOuNulo(vEnum(ESCOPOS_MEMORIA)),
    mission_id: vOuNulo(vIdMissao),
    pane_id: vOuNulo(vIdPane),
    tipos: vOuNulo(vLista(vEnum(TIPOS_MEMORIA), TIPOS_MEMORIA.length)),
    busca: vOuNulo(vTextoLivre(200)),
    depois: vOuNulo(vTexto({ min: 1, max: 120 })),
    limite: vInteiro({ min: 1, max: 200 }),
  }),
  "memoria:atualizar": vObjetoOpc({ entrada_id: vIdEntrada }, { conteudo: vTextoLivre(1000, 1), importancia: vImportancia }) as Validador<PedidoAtualizarMemoria>,
  "memoria:esquecer": vObjeto({ entrada_id: vIdEntrada }),
  "memoria:esquecer_pane": vObjeto({ pane_id: vIdPane }),
  "memoria:purgar": vObjeto({ workspace_id: vIdWorkspace, escopo: vEscopoOuTudo, confirmacao: vTextoLivre(300, 1) }),
  "memoria:exportar": vObjeto({ workspace_id: vIdWorkspace, escopo: vEscopoOuTudo }),
  "memoria:brief_previa": vObjeto({ pane_id: vIdPane }),
  "memoria:restaurar": vObjeto({ pane_id: vIdPane, modo: vEnum(["auto", "retomar", "brief"] as const) }),
  "memoria:preferencias_listar": vObjeto({}),
  "memoria:preferencias_gravar": vObjeto({ id: vOuNulo(vIdEntrada), conteudo: vTextoLivre(300, 1), importancia: vImportancia }),
  "memoria:preferencias_remover": vObjeto({ id: vIdEntrada }),
} satisfies ValidadoresDaFamilia<"memoria:">;

export type CanalMemoria = keyof typeof VALIDADORES_MEMORIA;

/** O que os manipuladores usam do serviço da memória (o real cumpre; teste injeta um falso). */
export interface ServicoMemoriaIpc {
  estado(workspaceId: string): Promise<EstadoMemoriaApp>;
  gravarConfig(workspaceId: string, patch: Omit<Extract<PedidoConfigMemoria, { workspace_id: string }>, "workspace_id">): ConfigMemoria;
  listar(f: { workspace_id: string; escopo?: EscopoMemoria | null; mission_id?: string | null; linhagem_id?: string | null; tipos?: EntradaMemoria["tipo"][] | null; busca?: string | null; depois?: string | null; limite?: number }): PaginaMemoria<EntradaMemoria>;
  atualizar(p: { id: string; conteudo?: string; importancia?: number }): EntradaMemoria;
  esquecer(entradaId: string): { ok: boolean };
  esquecerPane(paneId: string): { removidas: number };
  purgar(p: { workspace_id: string; escopo: EscopoMemoria | "tudo"; confirmacao: string }): { removidas: number };
  exportar(p: { workspace_id: string; escopo: EscopoMemoria | "tudo" }): unknown;
  briefPrevia(paneId: string): PreviaBrief;
  preferencias: {
    listar(): EntradaMemoria[];
    gravar(p: { id: string | null; conteudo: string; importancia?: number }): EntradaMemoria;
    remover(id: string): { ok: boolean };
  };
}

export interface DependenciasIpcMemoria {
  registro: RegistroIpc;
  servico: ServicoMemoriaIpc;
  /** chave por Missão (P-21): `null` = herda do workspace. */
  definirMissaoAtiva(missionId: string, ativa: boolean | null): void;
  /** raiz da linhagem do Pane (filtro `pane_id` da listagem apaga a linhagem inteira, D-49). */
  linhagemDe(paneId: string): string;
  /** o restaurador (`servico.restaurador(portas).restaurarPane`), com o lock por Pane. */
  restaurar(paneId: string, modo: "auto" | "retomar" | "brief"): Promise<ResultadoRestaurar>;
  /** abre o diálogo de salvar e grava atômico; `null` = o usuário cancelou. O renderer nunca escolhe o caminho. */
  salvarExportacao(exportacao: unknown, nomeSugerido: string): Promise<string | null>;
}

const SEM_PAGINA = { itens: [], proximo: null } as const;

export function registrarIpcMemoria(d: DependenciasIpcMemoria): void {
  const { registro, servico } = d;
  const V = VALIDADORES_MEMORIA;
  registro.invoke("memoria:estado", V["memoria:estado"], ({ workspace_id }) => servico.estado(workspace_id));
  registro.invoke("memoria:config_gravar", V["memoria:config_gravar"], ({ workspace_id, ...patch }) => servico.gravarConfig(workspace_id, patch));
  registro.invoke("memoria:missao_config", V["memoria:missao_config"], ({ mission_id, ativa }) => {
    d.definirMissaoAtiva(mission_id, ativa);
    return { mission_id, ativa };
  });
  registro.invoke("memoria:listar", V["memoria:listar"], (p): PaginaMemoria<EntradaMemoria> => {
    let linhagem: string | null = null;
    if (p.pane_id !== null) {
      try {
        linhagem = d.linhagemDe(p.pane_id);
      } catch {
        return { ...SEM_PAGINA, itens: [] };
      }
    }
    return servico.listar({ workspace_id: p.workspace_id, escopo: p.escopo, mission_id: p.mission_id, linhagem_id: linhagem, tipos: p.tipos, busca: p.busca, depois: p.depois, limite: p.limite });
  });
  registro.invoke("memoria:atualizar", V["memoria:atualizar"], ({ entrada_id, conteudo, importancia }) => servico.atualizar({ id: entrada_id, ...(conteudo !== undefined ? { conteudo } : {}), ...(importancia !== undefined ? { importancia } : {}) }));
  registro.invoke("memoria:esquecer", V["memoria:esquecer"], ({ entrada_id }) => servico.esquecer(entrada_id));
  registro.invoke("memoria:esquecer_pane", V["memoria:esquecer_pane"], ({ pane_id }) => servico.esquecerPane(pane_id));
  registro.invoke("memoria:purgar", V["memoria:purgar"], (p) => servico.purgar(p));
  registro.invoke("memoria:exportar", V["memoria:exportar"], async (p): Promise<CanaisInvoke["memoria:exportar"]["saida"]> => {
    const exportacao = servico.exportar(p);
    return { caminho_salvo: await d.salvarExportacao(exportacao, `memoria-${p.escopo}.json`) };
  });
  registro.invoke("memoria:brief_previa", V["memoria:brief_previa"], ({ pane_id }) => servico.briefPrevia(pane_id));
  registro.invoke("memoria:restaurar", V["memoria:restaurar"], ({ pane_id, modo }) => d.restaurar(pane_id, modo));
  registro.invoke("memoria:preferencias_listar", V["memoria:preferencias_listar"], () => servico.preferencias.listar());
  registro.invoke("memoria:preferencias_gravar", V["memoria:preferencias_gravar"], (p) => servico.preferencias.gravar(p));
  registro.invoke("memoria:preferencias_remover", V["memoria:preferencias_remover"], ({ id }) => servico.preferencias.remover(id));
}

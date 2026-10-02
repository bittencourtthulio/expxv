// Canais `relatorios:*` (Fase 19): validadores estritos e manipuladores. O renderer NUNCA envia caminho, `userData`, destino nem ator: estes canais SÃO a ação humana
// (aprovar, consentir, exportar, enviar). Todo pedido leva `workspace_id` e o serviço confere o dono de cada id citado. Erro de regra do núcleo chega ao renderer como `Error` com
// `[codigo] texto`; qualquer outro erro vira texto genérico (nunca stack, SQL nem caminho). O serviço só nasce no primeiro uso (nada no boot).
import type { ConfigRelatorios } from "../../compartilhado/relatorios";
import { CANAIS_DIVULGACAO } from "../../compartilhado/relatorios";
import type { NomeInvoke } from "../../compartilhado/ipc";
import { ErroRelatorio } from "../../nucleo/relatorios/erros";
import { BLOCOS_TECNICOS, BLOCOS_USUARIO } from "../../nucleo/relatorios/redacao/deterministico";
import { nomeDePacoteValido } from "../../nucleo/relatorios/seguranca";
import type { ServicoRelatorios } from "../relatorios";
import { vIdWorkspace, vOuNulo, vRotulo, vTextoLivre } from "./comum-dominio";
import type { RegistroIpc } from "./registro";
import { vBooleano, vEnum, vLista, vObjeto, vTexto, type Resultado, type Validador } from "./validar";
import { vObjetoOpc, type ValidadoresDaFamilia } from "./validar-harness";

const falha = (erro: string): Resultado<never> => ({ ok: false, erro });
const idComPrefixo = (prefixo: string): Validador<string> => vTexto({ min: 1, max: 64, padrao: new RegExp(`^${prefixo}_[0-9A-Za-z]{10,40}$`) });
const vIdPacote = idComPrefixo("rel");
const vIdEnvio = idComPrefixo("env");
const vIdSprint = idComPrefixo("spr");
const vBloco = vEnum([...BLOCOS_USUARIO, ...BLOCOS_TECNICOS] as const);
const vCanal = vEnum(CANAIS_DIVULGACAO);
const vVariante = vEnum(["curta", "media", "longa"] as const);
const vEstadoPacote = vEnum(["gerando", "pronto", "falhou", "obsoleto"] as const);
const vNomeArquivo: Validador<string> = (v) => (typeof v === "string" && v.length <= 120 && nomeDePacoteValido(v) ? { ok: true, valor: v } : falha("nome de arquivo inválido"));
const vNomes: Validador<string[] | "todos"> = (v) => (v === "todos" ? { ok: true, valor: "todos" as const } : vLista(vNomeArquivo, 40)(v) as Resultado<string[]>);

const CHAVES_CONFIG: readonly string[] = ["gerar_ao_fechar", "redacao_modo", "csv_bom", "hashtags", "cta"];
/** parcial da config: só as chaves conhecidas e editáveis (o consentimento NUNCA entra por aqui); a conferência fina de tipos é do núcleo. */
const vConfigParcial: Validador<Partial<Pick<ConfigRelatorios, "gerar_ao_fechar" | "redacao_modo" | "csv_bom" | "hashtags" | "cta">>> = (v) => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return falha("esperado objeto");
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!CHAVES_CONFIG.includes(k)) return falha(`campo desconhecido: ${k}`);
  const out: Record<string, unknown> = {};
  if ("gerar_ao_fechar" in o) { const r = vBooleano(o["gerar_ao_fechar"]); if (!r.ok) return falha("gerar_ao_fechar: booleano"); out["gerar_ao_fechar"] = r.valor; }
  if ("csv_bom" in o) { const r = vBooleano(o["csv_bom"]); if (!r.ok) return falha("csv_bom: booleano"); out["csv_bom"] = r.valor; }
  if ("redacao_modo" in o) { const r = vEnum(["auto", "llm", "template"] as const)(o["redacao_modo"]); if (!r.ok) return falha("redacao_modo inválido"); out["redacao_modo"] = r.valor; }
  if ("hashtags" in o) { const r = vLista(vTexto({ min: 1, max: 32, padrao: /^#?[\p{L}\p{N}_]{1,30}$/u }), 5)(o["hashtags"]); if (!r.ok) return falha("hashtags inválidas"); out["hashtags"] = r.valor; }
  if ("cta" in o) { const r = vOuNulo(vTextoLivre(120))(o["cta"]); if (!r.ok) return falha("cta inválida"); out["cta"] = r.valor; }
  return { ok: true, valor: out as never };
};

export const VALIDADORES_RELATORIOS = {
  "relatorios:config_ler": vObjeto({ workspace_id: vIdWorkspace }),
  "relatorios:config_gravar": vObjeto({ workspace_id: vIdWorkspace, config: vConfigParcial }),
  "relatorios:consentimento_llm": vObjeto({ workspace_id: vIdWorkspace, consentido: vBooleano }),
  "relatorios:sprints": vObjeto({ workspace_id: vIdWorkspace }),
  "relatorios:listar": vObjetoOpc({ workspace_id: vIdWorkspace }, { filtros: vObjetoOpc({}, { sprint_id: vIdSprint, estado: vEstadoPacote }) }),
  "relatorios:ler": vObjeto({ workspace_id: vIdWorkspace, pacote_id: vIdPacote }),
  "relatorios:gerar": vObjetoOpc({ workspace_id: vIdWorkspace, escopo: vObjeto({ tipo: vEnum(["sprint"] as const), sprint_id: vIdSprint }) }, {
    opcoes: vObjetoOpc({}, { redacao_modo: vEnum(["auto", "llm", "template"] as const), versao_lancamento: vOuNulo(vRotulo(40)) }),
  }),
  "relatorios:regenerar": vObjeto({ workspace_id: vIdWorkspace, pacote_id: vIdPacote }),
  "relatorios:previa": vObjeto({ workspace_id: vIdWorkspace, pacote_id: vIdPacote, nome: vNomeArquivo }),
  "relatorios:ajuste_gravar": vObjeto({ workspace_id: vIdWorkspace, sprint_id: vIdSprint, bloco_id: vBloco, texto_md: vOuNulo(vTextoLivre(4000)) }),
  "relatorios:aprovar": vObjeto({ workspace_id: vIdWorkspace, pacote_id: vIdPacote, aprovar: vBooleano }),
  "relatorios:exportar": vObjeto({ workspace_id: vIdWorkspace, pacote_id: vIdPacote, nomes: vNomes, modo: vEnum(["pasta", "zip"] as const) }),
  "relatorios:divulgacao_estado": vObjeto({ workspace_id: vIdWorkspace }),
  "relatorios:divulgacao_consentimento": vObjeto({ workspace_id: vIdWorkspace, canal: vCanal, consentido: vBooleano }),
  "relatorios:divulgacao_fila": vObjeto({ workspace_id: vIdWorkspace, pacote_id: vIdPacote }),
  "relatorios:divulgacao_enfileirar": vObjeto({ workspace_id: vIdWorkspace, pacote_id: vIdPacote, canal: vCanal, variante: vVariante }),
  "relatorios:divulgacao_aprovar": vObjeto({ workspace_id: vIdWorkspace, envio_id: vIdEnvio, aprovar: vBooleano }),
  "relatorios:divulgacao_enviar": vObjeto({ workspace_id: vIdWorkspace, envio_id: vIdEnvio }),
  "relatorios:divulgacao_cancelar": vObjeto({ workspace_id: vIdWorkspace, envio_id: vIdEnvio }),
} satisfies ValidadoresDaFamilia<"relatorios:">;

export type CanalRelatorios = keyof typeof VALIDADORES_RELATORIOS;

/** erro de regra do núcleo => `Error` com `[codigo] texto`; qualquer outro vira texto genérico (nunca stack/SQL/caminho). */
export function paraErroIpc(e: unknown, aviso?: (m: string) => void): Error {
  if (e instanceof ErroRelatorio) return new Error(`[${e.code}] ${e.message}`);
  aviso?.(`relatórios: ${e instanceof Error ? e.message : String(e)}`);
  return new Error("[unavailable] Falha interna nos relatórios.");
}

export interface DependenciasIpcRelatorios {
  registro: RegistroIpc;
  /** leitura preguiçosa: o serviço só nasce na primeira chamada (nada no boot). */
  servico: () => ServicoRelatorios | Promise<ServicoRelatorios>;
  aviso?: (mensagem: string) => void;
}

export function registrarIpcRelatorios(d: DependenciasIpcRelatorios): void {
  const { registro } = d;
  const V = VALIDADORES_RELATORIOS;
  type P = Record<string, unknown> & { workspace_id: string };
  const R = (canal: CanalRelatorios, fn: (p: P, s: ServicoRelatorios) => unknown): void => {
    registro.invoke(canal as NomeInvoke, V[canal] as never, (async (p: never) => {
      try {
        return await fn(p as unknown as P, await d.servico());
      } catch (e) {
        throw paraErroIpc(e, d.aviso);
      }
    }) as never);
  };
  R("relatorios:config_ler", (p, s) => s.configLer(p.workspace_id));
  R("relatorios:config_gravar", (p, s) => s.configGravar(p.workspace_id, p["config"] as never));
  R("relatorios:consentimento_llm", (p, s) => s.consentimentoLlm(p.workspace_id, p["consentido"] as boolean));
  R("relatorios:sprints", (p, s) => s.sprints(p.workspace_id));
  R("relatorios:listar", (p, s) => s.listar(p.workspace_id, p["filtros"] as never));
  R("relatorios:ler", (p, s) => s.ler(p.workspace_id, p["pacote_id"] as string));
  R("relatorios:gerar", (p, s) => s.gerar(p.workspace_id, p["escopo"] as never, p["opcoes"] as never));
  R("relatorios:regenerar", (p, s) => s.regenerar(p.workspace_id, p["pacote_id"] as string));
  R("relatorios:previa", (p, s) => s.previa(p.workspace_id, p["pacote_id"] as string, p["nome"] as string));
  R("relatorios:ajuste_gravar", (p, s) => s.ajusteGravar(p.workspace_id, p["sprint_id"] as string, p["bloco_id"] as string, p["texto_md"] as string | null));
  R("relatorios:aprovar", (p, s) => s.aprovar(p.workspace_id, p["pacote_id"] as string, p["aprovar"] as boolean));
  R("relatorios:exportar", (p, s) => s.exportar(p.workspace_id, p["pacote_id"] as string, p["nomes"] as never, p["modo"] as never));
  R("relatorios:divulgacao_estado", (p, s) => s.divulgacaoEstado(p.workspace_id));
  R("relatorios:divulgacao_consentimento", (p, s) => s.divulgacaoConsentimento(p.workspace_id, p["canal"] as never, p["consentido"] as boolean));
  R("relatorios:divulgacao_fila", (p, s) => s.divulgacaoFila(p.workspace_id, p["pacote_id"] as string));
  R("relatorios:divulgacao_enfileirar", (p, s) => s.divulgacaoEnfileirar(p.workspace_id, p["pacote_id"] as string, p["canal"] as never, p["variante"] as never));
  R("relatorios:divulgacao_aprovar", (p, s) => s.divulgacaoAprovar(p.workspace_id, p["envio_id"] as string, p["aprovar"] as boolean));
  R("relatorios:divulgacao_enviar", (p, s) => s.divulgacaoEnviar(p.workspace_id, p["envio_id"] as string));
  R("relatorios:divulgacao_cancelar", (p, s) => s.divulgacaoCancelar(p.workspace_id, p["envio_id"] as string));
}

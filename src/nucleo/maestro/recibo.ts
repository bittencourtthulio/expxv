// T-16.09 · Recibo do Maestro (texto PT-BR ≤ 240; sempre mostra a confiança numérica). Nunca contém o texto do usuário nem chave:
// só ids/termos do léxico (os "sinais"), a fonte e o decididor. Custo/latência `null` = desconhecido (nunca 0).
import type { EtapaDoPlano, FonteIntencao, Intencao, NivelRigidez, PipelineId, ReciboMaestro } from "../../compartilhado/maestro";
import { NOME_NIVEL_RIGIDEZ } from "../squads/rigor";

export const RECIBO_MAX = 240;

export interface EntradaRecibo {
  id: string;
  /** id da instância do pipeline (`maestro_pipeline.id`). */
  pipeline_id: string | null;
  /** nome do pipeline (só para o texto). */
  pipeline?: PipelineId | null;
  intencao: Intencao;
  confianca: number;
  fonte: FonteIntencao;
  decididor: ReciboMaestro["decididor"];
  escolha_regra: Intencao | null;
  escolha_decisor: Intencao | null;
  divergiu: boolean;
  nivel: NivelRigidez;
  sinais: readonly string[];
  etapas?: readonly Pick<EtapaDoPlano, "etapa_id" | "estado_inicial">[];
  /** decisor estava ligado? (só para o texto: "decisor desligado"). */
  decisor_ligado?: boolean;
}

const virgula = (n: number): string => n.toFixed(2).replace(".", ",");
/** `bug.p.corrig` → `corrig`; `pedido.w.vale-a-pena` → `vale a pena`; marcas B1..B10 ficam como estão. */
export function termoDoSinal(id: string): string {
  if (/^B\d+$/.test(id)) return id;
  const partes = id.split(".");
  return (partes[partes.length - 1] ?? id).replace(/-/g, " ");
}
const curto = (id: string): string => (id.split(".").pop() ?? id).toUpperCase();

function textoDoRecibo(e: EntradaRecibo): string {
  const sinais = [...new Set(e.sinais.map(termoDoSinal))].slice(0, 3);
  const por =
    e.fonte === "comando" ? "comando explícito do método"
    : e.fonte === "explicito" ? "rótulo explícito"
    : e.fonte === "regra" ? `regra${sinais.length > 0 ? ` [${sinais.join(", ")}]` : ""}`
    : e.fonte === "decisor" ? `decisor ${e.decididor.tipo}${e.decididor.modelo !== null ? ` (${e.decididor.modelo})` : ""}`
    : e.fonte === "regra+decisor" ? `regra e decisor ${e.decididor.tipo} concordaram`
    : "regra (decisor indisponível)";
  const decisor = e.fonte === "decisor" || e.fonte === "regra+decisor" ? "" : e.fonte === "fallback" ? "; decisor falhou" : e.decisor_ligado === true ? "; decisor consultado sem alterar" : "; decisor desligado";
  const diverg = e.divergiu && e.escolha_decisor !== null && e.escolha_decisor !== e.intencao ? ` O decisor sugeriu ${e.escolha_decisor}.` : e.divergiu && e.escolha_regra !== null && e.escolha_regra !== e.intencao ? ` A regra sugeriu ${e.escolha_regra}.` : "";
  const ativas = (e.etapas ?? []).filter((x) => x.estado_inicial !== "pulada_nivel");
  const pipe = e.pipeline == null ? "" : ` Pipeline ${e.pipeline}${ativas.length > 0 ? `: ${ativas.slice(0, 6).map((x) => curto(x.etapa_id)).join(" → ")}${ativas.length > 6 ? " → …" : ""}` : ""}.`;
  const t = `Maestro: ${e.intencao} (confiança ${virgula(e.confianca)}) por ${por}${decisor}. Nível ${NOME_NIVEL_RIGIDEZ[e.nivel]}.${diverg}${pipe}`;
  return t.length > RECIBO_MAX ? `${t.slice(0, RECIBO_MAX - 1).trimEnd()}…` : t;
}

export function montarRecibo(e: EntradaRecibo): ReciboMaestro {
  return {
    id: e.id,
    pipeline_id: e.pipeline_id,
    intencao: e.intencao,
    confianca: e.confianca,
    fonte: e.fonte,
    decididor: e.decididor,
    escolha_regra: e.escolha_regra,
    escolha_decisor: e.escolha_decisor,
    divergiu: e.divergiu,
    nivel: e.nivel,
    texto: textoDoRecibo(e),
  };
}

export const DECIDIDOR_REGRA: ReciboMaestro["decididor"] = { tipo: "regra", modelo: null, endpoint_host: null, latencia_ms: null, custo_usd: null };

/** Conteúdo de `<pasta do produto>/maestro/<id>/recibo.md` (sem texto do usuário). */
export function reciboParaMarkdown(r: ReciboMaestro, sinais: readonly string[]): string {
  return [
    "# Recibo do Maestro", "",
    `- intenção: ${r.intencao}`, `- confiança: ${virgula(r.confianca)}`, `- fonte: ${r.fonte}`,
    `- decididor: ${r.decididor.tipo}${r.decididor.modelo !== null ? ` (${r.decididor.modelo})` : ""}`,
    `- divergiu: ${r.divergiu ? "sim" : "não"}`, `- nível: ${r.nivel} (${NOME_NIVEL_RIGIDEZ[r.nivel]})`,
    `- sinais: ${[...new Set(sinais.map(termoDoSinal))].join(", ") || "nenhum"}`,
    `- custo: ${r.decididor.custo_usd === null ? "desconhecido" : `US$ ${r.decididor.custo_usd}`}`, "",
    r.texto, "",
  ].join("\n");
}

// Recibo e log de troca (T-09.14). PURO e SEM SEGREDOS: o texto nasce só de campos estruturados (ids, provedor, faixa, %), e todo
// texto livre (rótulo de conta, modelo) passa por `sanitizarTexto`, que remove controle, caminhos absolutos e tokens com cara de chave.
// Dado desconhecido NUNCA vira "0%": escreve "sem dado de limite".
import type { Faixa, FonteDecisao, ModoTroca, Troca } from "../../compartilhado/harness";
import type { NovaTroca } from "../banco/repos/troca-log";

const MAX_RECIBO_PANE = 240;
const MAX_RECIBO_TROCA = 480;

/** Remove controle, caminhos absolutos e sequências com cara de segredo; colapsa espaços; limita o tamanho. */
export function sanitizarTexto(t: string | null | undefined, max = 60): string {
  if (!t) return "";
  let s = t
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\bBearer\s+\S+/gi, "[oculto]")
    .replace(/\b(?:sk|pk|rk|or|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{8,}/gi, "[oculto]")
    .replace(/(?:\/Users\/|\/home\/|[A-Za-z]:\\)\S*/g, "[caminho]")
    .replace(/[A-Za-z0-9+/_-]{32,}={0,2}/g, "[oculto]")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > max) s = `${s.slice(0, Math.max(1, max - 1))}…`;
  return s;
}

const pct = (n: number | null): string => (n === null || !Number.isFinite(n) ? "sem dado de limite" : `${String(Math.round(n * 10) / 10).replace(".", ",")}% usado`);
const cortar = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);
const ROTULO_FAIXA: Readonly<Record<Faixa, string>> = { topo: "topo", alto: "alto", medio: "médio", rapido: "rápido" };
const nomeModelo = (m: string | null): string => (m === null ? "padrão da CLI" : sanitizarTexto(m, 50));

export interface DadosReciboEscolha {
  rotulo: string;
  detalhe: string;
  task_type: string;
  fonte_task_type: FonteDecisao;
  used_pct: number | null;
  janela: string | null;
}
/** "Conta {rotulo} escolhida por regra ({detalhe}). Tipo {task_type} ({fonte}). Folga medida: {used}% usado na janela {janela}." */
export function reciboEscolhaConta(d: DadosReciboEscolha): string {
  const folga = d.used_pct === null || d.janela === null ? "Sem dado de limite." : `Folga medida: ${pct(d.used_pct)} na janela ${sanitizarTexto(d.janela, 20)}.`;
  return cortar(`Conta ${sanitizarTexto(d.rotulo)} escolhida por regra (${sanitizarTexto(d.detalhe, 80)}). Tipo ${sanitizarTexto(d.task_type, 40)} (${d.fonte_task_type}). ${folga}`, MAX_RECIBO_PANE);
}

export type MotivoModelo = "mesma_conta_ok" | "outra_conta" | "outro_provedor" | "faixa_inferior" | "sem_alternativa";
export type BloqueioModelo = "max_saltos" | "operacao_nao_retomavel" | "intervalo_entre_trocas" | null;
export interface LadoRecibo {
  provedor: string;
  modelo: string | null;
  conta_id: string | null;
  faixa: Faixa;
  used_pct: number | null;
}
export interface DadosReciboModelo {
  motivo: MotivoModelo;
  trocando: boolean;
  atual: LadoRecibo;
  escolhida: (LadoRecibo & { janela: string | null }) | null;
  confianca: "alta" | "media" | "baixa";
  avisos: readonly string[];
  bloqueio: BloqueioModelo;
  limiar_troca_pct: number;
}
const TEXTO_BLOQUEIO: Readonly<Record<Exclude<BloqueioModelo, null>, string>> = {
  max_saltos: "limite de trocas por tarefa atingido",
  operacao_nao_retomavel: "operação que não se retoma em andamento; troca adiada",
  intervalo_entre_trocas: "troca recente; aguardando o intervalo mínimo",
};
const ROTULO_CONTA = (rotulos: Readonly<Record<string, string>> | undefined, id: string | null): string => (id === null ? "sem conta" : sanitizarTexto(rotulos?.[id] ?? id, 40));

/** Recibo de uma escolha de modelo/conta (≤ 240 caracteres): o que foi escolhido, por quê, com que dado e com que confiança. */
export function reciboModelo(d: DadosReciboModelo, rotulos?: Readonly<Record<string, string>>): string {
  const e = d.escolhida;
  const de = `${sanitizarTexto(d.atual.provedor, 20)}/${nomeModelo(d.atual.modelo)} (${ROTULO_CONTA(rotulos, d.atual.conta_id)})`;
  let texto: string;
  if (e === null) {
    const razao = d.bloqueio !== null ? TEXTO_BLOQUEIO[d.bloqueio] : "nenhuma conta ou modelo equivalente com folga";
    texto = `Sem alternativa: permanece em ${de}; ${razao}. Consumo atual: ${pct(d.atual.used_pct)}.`;
  } else {
    const para = `${sanitizarTexto(e.provedor, 20)}/${nomeModelo(e.modelo)} (${ROTULO_CONTA(rotulos, e.conta_id)})`;
    const folga = e.used_pct === null ? "sem dado de limite" : `${pct(e.used_pct)}${e.janela ? ` na janela ${sanitizarTexto(e.janela, 20)}` : ""}`;
    switch (d.motivo) {
      case "mesma_conta_ok":
        texto = `Mantido ${para}: ${folga}, abaixo do gatilho de ${d.limiar_troca_pct}%.`;
        break;
      case "outra_conta":
        texto = `Outra conta do mesmo provedor: ${de} → ${para}. Origem ${pct(d.atual.used_pct)}; destino ${folga}.`;
        break;
      case "outro_provedor":
        texto = `Modelo equivalente (faixa ${ROTULO_FAIXA[e.faixa]}) em outro provedor: ${de} → ${para}. Origem ${pct(d.atual.used_pct)}; destino ${folga}.`;
        break;
      default:
        texto = `Faixa inferior (${ROTULO_FAIXA[d.atual.faixa]} → ${ROTULO_FAIXA[e.faixa]}): ${de} → ${para}. Origem ${pct(d.atual.used_pct)}; destino ${folga}. Pode render menos.`;
    }
  }
  texto += ` Confiança ${d.confianca}.`;
  return cortar(texto, MAX_RECIBO_PANE);
}

export interface DadosReciboTroca {
  motivo: Troca["motivo"];
  modo: ModoTroca;
  tipo_troca: Troca["tipo_troca"];
  status: Troca["status"];
  de: { provedor: string; modelo: string | null; conta_id: string | null; faixa: Faixa | null; used_pct: number | null; janela: string | null };
  para: { provedor: string; modelo: string | null; conta_id: string | null; faixa: Faixa | null; used_pct: number | null };
  limiar_troca_pct: number;
  adiada_por?: string | null;
}
const TEXTO_MOTIVO: Readonly<Record<Troca["motivo"], string>> = { consumo_alto: "consumo alto", limite_atingido: "limite atingido", manual: "pedido manual" };
const TEXTO_TIPO: Readonly<Record<Troca["tipo_troca"], string>> = { outra_conta: "outra conta do mesmo provedor", outro_provedor: "modelo equivalente de outro provedor", faixa_inferior: "faixa inferior" };
const TEXTO_STATUS: Readonly<Record<Troca["status"], string>> = { sugerida: "Troca sugerida", feita: "Troca feita", ignorada: "Troca ignorada", adiada: "Troca adiada", falhou: "Troca falhou" };
const ADIADA: Readonly<Record<string, string>> = {
  trabalhando: "a sessão está trabalhando",
  operacao_git: "há operação git em curso",
  handoff_em_voo: "há handoff em voo",
  pergunta_pendente: "há pergunta pendente ao humano",
};

/**
 * Recibo da troca (Pane e `troca_log`): de onde veio, por quê, o consumo e que o "pensamento" da sessão anterior não foi
 * preservado (retoma pelo brief e pelo último checkpoint). Sem segredos. ≤ 480 caracteres.
 */
export function reciboTroca(d: DadosReciboTroca, rotulos?: Readonly<Record<string, string>>): string {
  const lado = (l: { provedor: string; modelo: string | null; conta_id: string | null }): string => `${sanitizarTexto(l.provedor, 20)}/${nomeModelo(l.modelo)} (${ROTULO_CONTA(rotulos, l.conta_id)})`;
  const partes: string[] = [`${TEXTO_STATUS[d.status]}: ${lado(d.de)} → ${lado(d.para)} (${TEXTO_TIPO[d.tipo_troca]}).`];
  const janela = d.de.janela ? ` na janela ${sanitizarTexto(d.de.janela, 20)}` : "";
  partes.push(`Motivo: ${TEXTO_MOTIVO[d.motivo]}; origem ${pct(d.de.used_pct)}${janela} (gatilho ${d.limiar_troca_pct}%), destino ${pct(d.para.used_pct)}.`);
  if (d.tipo_troca === "faixa_inferior" && d.de.faixa && d.para.faixa) partes.push(`Desceu de faixa (${ROTULO_FAIXA[d.de.faixa]} → ${ROTULO_FAIXA[d.para.faixa]}): pode render menos.`);
  if (d.status === "adiada" && d.adiada_por) partes.push(`Adiada porque ${ADIADA[d.adiada_por] ?? sanitizarTexto(d.adiada_por, 30)}.`);
  if (d.status === "feita" || d.status === "sugerida") partes.push("O pensamento da sessão anterior não foi preservado: o novo Pane retoma pelo brief e pelo último checkpoint.");
  if (d.modo === "so_sugerir" && d.status === "sugerida") partes.push("Modo só sugerir: nada foi trocado sem a sua confirmação.");
  return cortar(partes.join(" "), MAX_RECIBO_TROCA);
}

export interface IdsTroca {
  workspace_id: string;
  mission_id?: string | null;
  task_ref?: string | null;
  pane_antigo_id?: string | null;
  pane_novo_id?: string | null;
  decisao_id?: string | null;
}
/** Linha de `troca_log` (formato do repositório) a partir dos dados da troca; o `recibo` já sai sanitizado. */
export function trocaParaLog(ids: IdsTroca, d: DadosReciboTroca, rotulos?: Readonly<Record<string, string>>): NovaTroca {
  return {
    workspace_id: ids.workspace_id,
    mission_id: ids.mission_id ?? null,
    task_ref: ids.task_ref ?? null,
    pane_antigo_id: ids.pane_antigo_id ?? null,
    pane_novo_id: ids.pane_novo_id ?? null,
    de: { conta_id: d.de.conta_id, provedor: d.de.provedor, modelo: d.de.modelo },
    para: { conta_id: d.para.conta_id, provedor: d.para.provedor, modelo: d.para.modelo },
    faixa: d.para.faixa,
    motivo: d.motivo,
    modo: d.modo,
    tipo_troca: d.tipo_troca,
    consumo_origem_pct: d.de.used_pct,
    consumo_destino_pct: d.para.used_pct,
    status: d.status,
    adiada_por: d.adiada_por ?? null,
    decisao_id: ids.decisao_id ?? null,
    recibo: reciboTroca(d, rotulos),
  };
}

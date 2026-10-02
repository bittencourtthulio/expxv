// Classificador de intenção do Jarvis (T-13.06): REGRAS determinísticas primeiro (sem LLM, sem rede); a LLM é opcional, só roda se o usuário ligou e consentiu, só vê
// texto redigido e devolve APENAS uma ação da lista fechada, que o mesmo validador estrito confere. A LLM nunca executa, nunca confirma e nunca escolhe o texto que
// será enviado: em `enviar_prompt` o texto é sempre o que a PESSOA disse. PURO (a porta da LLM é injetada).
import type { AcaoTipada, FonteIntencao } from "../../compartilhado/jarvis";
import { ACOES_JARVIS } from "../../compartilhado/jarvis";
import { gestoProibidoNoTexto } from "../telegram/politica";
import { rotuloSeguro, textoSeguro, validarAcaoTipada } from "./acoes";

export type Classificacao =
  | { tipo: "acao"; acao: AcaoTipada; fonte: FonteIntencao }
  | { tipo: "recusado"; gesto: string }
  | { tipo: "sem_intencao" };

/** minúsculas e sem acento, preservando o comprimento (para extrair o trecho original pelos mesmos índices). */
export function normalizar(t: string): string {
  let s = "";
  for (const c of t) {
    const base = c.normalize("NFD").replace(/[̀-ͯ]/g, "");
    s += (base === "" ? c : (Array.from(base)[0] ?? c)).toLowerCase();
  }
  return s;
}

const MAX_ENTRADA = 4000;
const PREFIXO = String.raw`(?:(?:por favor|pf|jarvis|ei|ola|oi)[,\s]+)*`;
const DESTINO = String.raw`(maestro|squad\s+[a-z0-9][a-z0-9._-]{0,63})`;
const RE_ENVIAR = new RegExp(String.raw`^${PREFIXO}(?:diga|diz|fale|fala|peca|pede|mande|manda|envie|envia|enviar|pergunte|pergunta)\s+(?:ao|a|para o|para a|pro|pra|pro)\s+${DESTINO}\s*(?:[:;,]|que\b)?\s*([\s\S]+)$`);
const RE_DOIS_PONTOS = new RegExp(String.raw`^${PREFIXO}${DESTINO}\s*:\s*([\s\S]+)$`);

const re = (s: string): RegExp => new RegExp(s);
const RE_STATUS = re(String.raw`^${PREFIXO}(?:status|resumo|situacao|como estao as coisas|como esta tudo|o que esta acontecendo|o que ta rolando|me atualiza|me atualize)\b`);
const RE_MISSOES = re(String.raw`^${PREFIXO}(?:(?:listar?|lista|mostr\w+|quais|ver|veja|cade)\s+(?:as\s+|minhas\s+)?missoes?|missoes?)\s*\??$`);
const RE_PANES = re(String.raw`^${PREFIXO}(?:(?:listar?|lista|mostr\w+|quais|ver|veja)\s+(?:os\s+|meus\s+)?(?:paineis|panes|terminais)|paineis|panes|terminais)\s*\??$`);
const RE_CONSUMO = re(String.raw`^${PREFIXO}(?:consumo|cota|cotas|limites?|quanto (?:gastei|usei|consumi)|uso de tokens|como estao as cotas)\b`);
const RE_ABRIR = re(String.raw`^${PREFIXO}(?:abr\w+|ir para|va para|fo(?:c|qu)\w*)\s+(?:o\s+|a\s+)?(?:pane|painel|terminal)\s+#?([a-z0-9._:|-]{1,40})\s*$`);
const RE_GATE = re(String.raw`^${PREFIXO}(aprov\w+|recus\w+|rejeit\w+|negu?e|nega)\s+(?:o\s+|a\s+)?(?:gate|portao|aprovacao)\s+#?([a-z0-9._:|-]{1,64})\s*$`);
const RE_PAUSAR = re(String.raw`^${PREFIXO}paus\w+\s+(?:a\s+|o\s+|as\s+|os\s+)?(?:missao\s+|missoes\s+|pipeline\s+|plano\s+)?(\S[\s\S]{0,119})$`);
const RE_PARAR = re(String.raw`^${PREFIXO}(?:par[ae]|parar|interromp\w+|cancel\w+)\s+(?:a\s+|o\s+|as\s+|os\s+)?(?:missao\s+|missoes\s+|pipeline\s+|plano\s+)?(\S[\s\S]{0,119})$`);

/**
 * Regras. `gestoProibidoNoTexto` (a MESMA lista do Telegram) corre antes de tudo: merge, apagar, push forçado, assinar prodx, aprovar raio ALTO… viram
 * `recusado` e nunca chegam a uma ação, nem como texto de `enviar_prompt`.
 */
export function classificarPorRegras(texto: string): Classificacao {
  const original = texto.length > MAX_ENTRADA ? texto.slice(0, MAX_ENTRADA) : texto;
  const t = original.trim();
  if (t === "") return { tipo: "sem_intencao" };
  const gesto = gestoProibidoNoTexto(t);
  if (gesto !== null) return { tipo: "recusado", gesto };
  const n = normalizar(t);
  const trecho = (m: RegExpExecArray, grupo: number): string => {
    // todos os grupos extraídos terminam o padrão: o trecho original ocupa os mesmos índices (a normalização preserva o comprimento)
    const sub = m[grupo] ?? "";
    const fim = m.index + m[0].length;
    return t.slice(fim - sub.length, fim);
  };

  const enviar = RE_ENVIAR.exec(n) ?? RE_DOIS_PONTOS.exec(n);
  if (enviar !== null) {
    const destino = (enviar[1] ?? "").trim();
    const corpo = textoSeguro(trecho(enviar, 2));
    if (corpo === "") return { tipo: "sem_intencao" };
    if (destino === "maestro") return { tipo: "acao", fonte: "regra", acao: { acao: "enviar_prompt", destino: "maestro", squad: null, texto: corpo } };
    const squad = destino.replace(/^squad\s+/, "");
    return { tipo: "acao", fonte: "regra", acao: { acao: "enviar_prompt", destino: "squad", squad, texto: corpo } };
  }
  const direto = (acao: AcaoTipada): Classificacao => ({ tipo: "acao", acao, fonte: "regra" });
  if (RE_STATUS.test(n)) return direto({ acao: "status" });
  if (RE_MISSOES.test(n)) return direto({ acao: "listar_missoes" });
  if (RE_PANES.test(n)) return direto({ acao: "listar_paineis" });
  if (RE_CONSUMO.test(n)) return direto({ acao: "consultar_consumo" });
  const abrir = RE_ABRIR.exec(n);
  if (abrir !== null) return direto({ acao: "abrir_pane", pane: abrir[1] as string });
  const gate = RE_GATE.exec(n);
  if (gate !== null) return direto({ acao: "aprovar_gate", gate_id: trecho(gate, 2), decisao: /^aprov/.test(gate[1] as string) ? "aprovar" : "recusar" });
  const pausar = RE_PAUSAR.exec(n);
  if (pausar !== null) return direto({ acao: "pausar", alvo: rotuloSeguro(trecho(pausar, 1)) });
  const parar = RE_PARAR.exec(n);
  if (parar !== null) return direto({ acao: "parar", alvo: rotuloSeguro(trecho(parar, 1)) });
  return { tipo: "sem_intencao" };
}

export interface PortaClassificadorLlm {
  /** recebe SÓ o texto redigido e a lista fechada; devolve um objeto candidato (qualquer coisa: será validada). Pode lançar/demorar: o chamador trata. */
  classificar(entrada: { texto_redigido: string; acoes: readonly string[] }, sinal?: AbortSignal): Promise<unknown>;
}

/**
 * Passo opcional: só quando as regras não entenderam. A saída é VALIDADA como qualquer ação (campo extra/fora da lista = `sem_intencao`), o texto de `enviar_prompt` é
 * substituído pelo que a pessoa disse (a LLM não reescreve o que será enviado) e o resultado continua sujeito a matriz, política e confirmação.
 */
export async function classificarComLlm(texto: string, porta: PortaClassificadorLlm, op: { timeout_ms?: number } = {}): Promise<Classificacao> {
  const redigido = textoSeguro(texto, 1000);
  if (redigido === "") return { tipo: "sem_intencao" };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), op.timeout_ms ?? 8000);
  try {
    const bruto = await porta.classificar({ texto_redigido: redigido, acoes: ACOES_JARVIS }, ctl.signal);
    const v = validarAcaoTipada(bruto);
    if (!v.ok) return { tipo: "sem_intencao" };
    const a = v.acao;
    if (a.acao === "enviar_prompt") {
      const gesto = gestoProibidoNoTexto(texto);
      if (gesto !== null) return { tipo: "recusado", gesto };
      return { tipo: "acao", fonte: "llm", acao: { ...a, texto: textoSeguro(texto) } };
    }
    return { tipo: "acao", acao: a, fonte: "llm" };
  } catch {
    return { tipo: "sem_intencao" };
  } finally {
    clearTimeout(timer);
  }
}

// Pipeline do assistente de execução (D-586): dossiê → prompt → CLI headless SEM ferramentas → extração do JSON → validação rígida → (1 retentativa com o
// erro) → proposta; se a IA falhar ou vier inválida, cai na detecção determinística com aviso HONESTO. Falhas definitivas da CLI (ausente, sem login, limite)
// viram erro acionável (não há o que repetir). Nada é executado aqui; a CLI vem por PORTA (o teste usa uma CLI falsa).
import type { ResultadoDeteccao } from "../detectar";
import { comandoEmTexto } from "../hash";
import type { ConfigExecucao } from "../modelo";
import type { CodigoErroAssistente, DescartadoIpc, FaseAssistente } from "../../../compartilhado/executar-assistente";
import { extrairJson } from "./extrair";
import { montarPrompt } from "./prompt";
import { resumirErros, validarPropostaIa, type ContextoValidacao, type ItemValidado } from "./validar-ia";

/** Porta do LLM/CLI (mesma forma de `PortaLlm` do chat; o executor headless real a cumpre). */
export interface PortaLlmAssistente {
  disponivel(): Promise<{ ok: boolean; motivo?: string }>;
  executar(p: { sistema: string; prompt: string; sinal: AbortSignal }): AsyncIterable<string>;
}

export class ErroAssistente extends Error {
  constructor(readonly codigo: CodigoErroAssistente | "cancelado", mensagem: string, readonly sugestao: string) {
    super(mensagem);
    this.name = "ErroAssistente";
  }
}

export interface ItemProposta {
  config: ConfigExecucao;
  justificativa: string;
  confianca: number;
  novo: boolean;
  padrao: boolean;
  comando: string;
  notas: string[];
}

export interface ResultadoPipeline {
  fonte: "ia" | "deterministico";
  aviso_fonte: string | null;
  itens: ItemProposta[];
  avisos: string[];
  descartados: DescartadoIpc[];
  tentativas: number;
}

export interface OpcoesPipeline {
  /** texto do dossiê (já redigido) */
  dossie: string;
  llm: PortaLlmAssistente;
  ctx: ContextoValidacao;
  deteccao: ResultadoDeteccao;
  sinal: AbortSignal;
  /** limite por tentativa (padrão 150 s) */
  timeoutMs?: number;
  progresso?: (fase: FaseAssistente) => void;
  marca?: () => string;
}

const TIMEOUT_PADRAO_MS = 150_000;
const RESPOSTA_MAX = 256 * 1024;

// ---------------------------------------------------------------- classificação das falhas da CLI
const RX_AUSENTE = /não está instalada|nenhuma cli|not found|enoent|não foi possível ler a ajuda|a cli não oferece|wrapper de windows|adaptador do gemini/i;
const RX_LOGIN = /not logged|log ?in|logged out|sign in|authenticat|unauthori[sz]ed|invalid api key|credential|\b401\b|please run .*login/i;
const RX_LIMITE = /rate.?limit|usage limit|quota|\b429\b|exceeded|insufficient|out of credits|limit reached|overloaded|too many requests|limite/i;

/** Classifica o texto de falha (mensagem do executor ou saída da CLI) em código acionável; `null` = não dá para afirmar. */
export function classificarFalhaCli(texto: string): { codigo: "cli_ausente" | "sem_login" | "limite"; mensagem: string; sugestao: string } | null {
  if (RX_AUSENTE.test(texto)) return { codigo: "cli_ausente", mensagem: "A CLI escolhida não está disponível nesta máquina.", sugestao: "Instale a CLI ou escolha outra no menu do consentimento." };
  if (RX_LOGIN.test(texto)) return { codigo: "sem_login", mensagem: "A CLI parece não estar logada.", sugestao: "Abra a CLI num terminal, faça login e tente de novo." };
  if (RX_LIMITE.test(texto)) return { codigo: "limite", mensagem: "A conta da CLI atingiu um limite de uso.", sugestao: "Espere o limite renovar ou escolha outra CLI/conta." };
  return null;
}

const msgErro = (e: unknown): string => (e instanceof Error ? e.message : String(e));

type Tentativa = { ok: true; texto: string } | { ok: false; motivo: "timeout" | "falha"; detalhe: string };

const cancelado = (): ErroAssistente => new ErroAssistente("cancelado", "Cancelado.", "");

async function consultar(o: OpcoesPipeline, sistema: string, prompt: string): Promise<Tentativa> {
  if (o.sinal.aborted) throw cancelado();
  const ctrl = new AbortController();
  const aoCancelar = (): void => ctrl.abort();
  o.sinal.addEventListener("abort", aoCancelar, { once: true });
  let estourou = false;
  const timer = setTimeout(() => { estourou = true; ctrl.abort(); }, o.timeoutMs ?? TIMEOUT_PADRAO_MS);
  timer.unref?.();
  let texto = "";
  const aborto = new Promise<"abort">((resolver) => { ctrl.signal.addEventListener("abort", () => resolver("abort"), { once: true }); });
  let iterador: AsyncIterator<string> | null = null;
  try {
    iterador = o.llm.executar({ sistema, prompt, sinal: ctrl.signal })[Symbol.asyncIterator]();
    for (;;) {
      // corrida com o aborto: uma CLI que não responde nem cede o controle não trava o assistente
      const n = await Promise.race([iterador.next(), aborto]);
      if (n === "abort" || n.done === true) break;
      texto += n.value;
      if (texto.length > RESPOSTA_MAX) { ctrl.abort(); return { ok: false, motivo: "falha", detalhe: "resposta grande demais" }; }
    }
  } catch (e) {
    if (o.sinal.aborted) throw new ErroAssistente("cancelado", "Cancelado.", "");
    if (estourou) return { ok: false, motivo: "timeout", detalhe: "tempo esgotado" };
    return { ok: false, motivo: "falha", detalhe: msgErro(e) };
  } finally {
    clearTimeout(timer);
    o.sinal.removeEventListener("abort", aoCancelar);
    if (iterador !== null) { try { void Promise.resolve(iterador.return?.()).catch(() => undefined); } catch { /* já encerrado */ } }
  }
  if (o.sinal.aborted) throw new ErroAssistente("cancelado", "Cancelado.", "");
  if (estourou) return { ok: false, motivo: "timeout", detalhe: "tempo esgotado" };
  return { ok: true, texto };
}

const paraItem = (x: ItemValidado): ItemProposta => ({ config: x.config, justificativa: x.justificativa, confianca: x.confianca, novo: x.novo, padrao: x.padrao, comando: comandoEmTexto(x.config), notas: x.notas });

/** Resultado da detecção automática no formato da proposta (fallback honesto): só o essencial, sem inventar justificativa de IA. */
export function itensDaDeteccao(det: ResultadoDeteccao, max = 12): ItemProposta[] {
  const ordem = { rodar: 0, build: 1, teste: 2, outro: 3 } as const;
  return [...det.configuracoes].sort((a, b) => ordem[a.tipo] - ordem[b.tipo]).slice(0, max).map((c) => ({
    config: { ...c, origem: "usuario" as const }, justificativa: "Encontrada pela detecção automática do projeto.", confianca: 0.5, novo: false, padrao: c.id === det.padrao_sugerido, comando: comandoEmTexto(c), notas: [],
  }));
}

export async function executarPipeline(o: OpcoesPipeline): Promise<ResultadoPipeline> {
  if (o.sinal.aborted) throw cancelado();
  const disp = await o.llm.disponivel().catch((e: unknown) => ({ ok: false, motivo: msgErro(e) }));
  if (!disp.ok) {
    const c = classificarFalhaCli(disp.motivo ?? "") ?? { codigo: "cli_ausente" as const, mensagem: "A CLI escolhida não está disponível.", sugestao: "Escolha outra CLI no menu do consentimento." };
    throw new ErroAssistente(c.codigo, disp.motivo !== undefined && disp.motivo !== "" ? `${c.mensagem} (${disp.motivo})` : c.mensagem, c.sugestao);
  }
  if (o.sinal.aborted) throw cancelado(); // cancelou enquanto a CLI era conferida

  const marca = o.marca?.();
  let ultimoErro = "";
  let motivoFinal = "";
  let feitas = 0;
  for (let tentativa = 1; tentativa <= 2; tentativa += 1) {
    feitas = tentativa;
    o.progresso?.(tentativa === 1 ? "consultando" : "retentando");
    const p = montarPrompt(o.dossie, marca, tentativa === 1 ? undefined : { erro: ultimoErro });
    const r = await consultar(o, p.sistema, p.prompt);
    if (!r.ok) {
      const c = classificarFalhaCli(r.detalhe);
      if (c !== null) throw new ErroAssistente(c.codigo, c.mensagem, c.sugestao);
      if (r.motivo === "timeout") { motivoFinal = "a IA demorou demais para responder"; break; } // não repete: custaria outro prazo inteiro
      ultimoErro = "a CLI terminou sem resposta utilizável";
      motivoFinal = "a CLI terminou com erro (confira o login e o limite da conta)";
      continue;
    }
    o.progresso?.("validando");
    const ext = extrairJson(r.texto);
    if (!ext.ok) {
      const c = !r.texto.includes("{") ? classificarFalhaCli(r.texto.slice(0, 600)) : null;
      if (c !== null) throw new ErroAssistente(c.codigo, c.mensagem, c.sugestao);
      ultimoErro = ext.erro;
      motivoFinal = "a resposta da IA não veio no formato pedido";
      continue;
    }
    const v = validarPropostaIa(ext.valor, o.ctx);
    if (v.erro_formato !== null) { ultimoErro = v.erro_formato; motivoFinal = "a resposta da IA não veio no formato pedido"; continue; }
    const declarou = (ext.valor as { configuracoes: unknown[] }).configuracoes.length;
    if (v.itens.length === 0 && declarou > 0) { ultimoErro = resumirErros(v); motivoFinal = "todas as configurações propostas pela IA foram recusadas pela validação"; continue; }
    return { fonte: "ia", aviso_fonte: null, itens: v.itens.map(paraItem), avisos: v.avisos, descartados: v.descartados, tentativas: tentativa };
  }

  const det = itensDaDeteccao(o.deteccao);
  return {
    fonte: "deterministico",
    aviso_fonte: `${motivoFinal === "" ? "A IA não devolveu uma proposta válida" : `A IA não ajudou desta vez: ${motivoFinal}`}. Mostrando só o que a detecção automática encontrou${det.length === 0 ? " (nada)" : ""}.`,
    itens: det, avisos: [], descartados: [], tentativas: feitas,
  };
}

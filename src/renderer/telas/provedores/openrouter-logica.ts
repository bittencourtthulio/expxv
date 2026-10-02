// Lógica pura da seção OpenRouter (T-09.33): formatação, validação da chave, erros com código, faixa/ordem sugeridas e CLIs.
// Nada aqui toca rede, estado persistente ou a chave: o valor digitado só vive no campo da seção.
import type { Faixa, ModeloOpenRouter, StatusAdaptadorCli } from "../../../compartilhado/harness";
import { FAIXAS } from "../../../compartilhado/harness";

export const VERSAO_TEXTO_CONSENTIMENTO = "openrouter-v1";
export const TEXTO_CONSENTIMENTO_OPENROUTER =
  "Ao ativar, seus prompts e código passam a ir ao OpenRouter e aos provedores dos modelos que você escolher, quando você lançar um Pane OpenRouter. "
  + "Nada é enviado até você usar: listar modelos, testar a chave e consultar o saldo só acontecem quando você clica. "
  + "A chave fica no cofre do sistema e nunca volta para esta tela. Você pode revogar a qualquer momento.";

const usd = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });
const mtok = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
/** Preço por milhão de tokens; ausente = "sem preço" (nunca zero por omissão). */
export const formatarMtok = (n: number | null): string => (n === null || !Number.isFinite(n) ? "sem preço" : mtok.format(n).replace(/\s/g, " "));
export const formatarUsd = (n: number | null): string => (n === null || !Number.isFinite(n) ? "sem dado" : usd.format(n).replace(/\s/g, " "));
export const mascararChave = (ultimos4: string): string => `sk-or-••••${ultimos4}`;

/** Motivo (texto) pelo qual a chave digitada não pode ser enviada; `null` = ok. Não altera nem registra o valor. */
export function validarChave(texto: string): string | null {
  const t = texto.trim();
  if (t === "") return "Cole a chave do OpenRouter (começa com sk-or-).";
  if (/\s/.test(t)) return "A chave não pode ter espaço nem quebra de linha.";
  if (!/^[\x21-\x7e]+$/.test(t)) return "A chave tem caracteres inválidos: copie de novo, sem acentos.";
  if (t.length < 8) return "A chave tem pelo menos 8 caracteres.";
  if (t.length > 512) return "A chave é longa demais (máximo 512 caracteres).";
  return null;
}

const CODIGOS = ["sem_consentimento", "sem_chave", "conta_inexistente", "chave_invalida", "limite_de_requisicoes", "indisponivel", "resposta_invalida", "modelo_nao_habilitado", "sem_cli_compativel", "openrouter_not_consented"] as const;
export type CodigoErroOpenRouter = (typeof CODIGOS)[number];
const EXPLICACAO: Record<CodigoErroOpenRouter, string> = {
  sem_consentimento: "Ative o OpenRouter e aceite o aviso de rede antes de usar esta ação.",
  openrouter_not_consented: "Ative o OpenRouter e aceite o aviso de rede antes de usar esta ação.",
  sem_chave: "Esta conta não tem chave no cofre. Grave uma chave primeiro.",
  conta_inexistente: "Conta OpenRouter não encontrada (ou rótulo já usado). Atualize a tela e tente de novo.",
  chave_invalida: "O OpenRouter recusou a chave. Confira se ela está ativa e copiada por inteiro.",
  limite_de_requisicoes: "O OpenRouter pediu para esperar um pouco. Tente de novo em instantes.",
  indisponivel: "Não foi possível falar com o OpenRouter agora. Verifique a conexão e tente de novo.",
  resposta_invalida: "O OpenRouter respondeu algo inesperado. Tente de novo mais tarde.",
  modelo_nao_habilitado: "Esse modelo não está habilitado. Habilite-o na lista de modelos.",
  sem_cli_compativel: "Nenhuma CLI compatível com o OpenRouter está instalada.",
};

const texto = (e: unknown): string => (e instanceof Error ? e.message : String(e));
/** As recusas chegam como texto `codigo: mensagem` (às vezes dentro do prefixo do IPC); acha o código conhecido. */
export function codigoDoErro(e: unknown): CodigoErroOpenRouter | null {
  const t = texto(e);
  for (const c of CODIGOS) if (new RegExp(`(^|[^a-z_])${c}(?![a-z_])`).test(t)) return c;
  return null;
}
export function mensagemDoErro(e: unknown): string {
  const c = codigoDoErro(e);
  return c === null ? texto(e) : EXPLICACAO[c];
}

// ---- faixa e ordem sugeridas (SUGESTÃO por preço de saída, espelho dos limiares do núcleo; o usuário aceita manualmente) ----
const LIMIARES: ReadonlyArray<readonly [number, Faixa]> = [[40, "topo"], [10, "alto"], [1.5, "medio"], [0, "rapido"]];
export function faixaSugerida(m: Pick<ModeloOpenRouter, "preco_saida_por_mtok">): Faixa | null {
  const p = m.preco_saida_por_mtok;
  if (p === null || !Number.isFinite(p) || p < 0) return null;
  for (const [min, f] of LIMIARES) if (p >= min) return f;
  return null;
}
/** Posição (1…) do modelo entre os de mesma faixa sugerida, do mais barato ao mais caro; sem preço = sem sugestão. */
export function ordemSugerida(m: ModeloOpenRouter, todos: readonly ModeloOpenRouter[]): number | null {
  const f = faixaSugerida(m);
  if (f === null) return null;
  const iguais = todos.filter((x) => faixaSugerida(x) === f).sort((a, b) => (a.preco_saida_por_mtok ?? 0) - (b.preco_saida_por_mtok ?? 0) || a.id.localeCompare(b.id));
  const i = iguais.findIndex((x) => x.id === m.id);
  return i < 0 ? null : i + 1;
}
export function aceitarSugestao(m: ModeloOpenRouter, todos: readonly ModeloOpenRouter[]): { id: string; habilitado: boolean; faixa: Faixa; tipos_permitidos: string[]; ordem: number } | null {
  const faixa = faixaSugerida(m);
  const ordem = ordemSugerida(m, todos);
  if (faixa === null || ordem === null) return null;
  return { id: m.id, habilitado: m.habilitado, faixa, tipos_permitidos: [...m.tipos_permitidos], ordem };
}

export const ROTULO_FAIXA: Record<Faixa, string> = { topo: "Topo", alto: "Alto", medio: "Médio", rapido: "Rápido" };
export const FAIXAS_OPENROUTER: readonly Faixa[] = FAIXAS;

export function filtrarModelos(lista: readonly ModeloOpenRouter[], busca: string): ModeloOpenRouter[] {
  const b = busca.trim().toLowerCase();
  return b === "" ? [...lista] : lista.filter((m) => m.id.toLowerCase().includes(b) || m.nome.toLowerCase().includes(b));
}

export interface ExplicacaoCli { texto: string; tom: "ok" | "aviso" | "neutro"; detalhe: string }
/** Status do adaptador em palavras: o que significa e o que fazer. */
export function explicarCli(c: { cli: string; instalada: boolean; status: StatusAdaptadorCli }): ExplicacaoCli {
  const base: Record<StatusAdaptadorCli, ExplicacaoCli> = {
    verificado: { texto: "Verificada", tom: "ok", detalhe: "Adaptador testado: pode ser lançada com um modelo OpenRouter." },
    a_verificar: { texto: "A verificar", tom: "aviso", detalhe: "Adaptador ainda não validado com a CLI real; permanece desligado (não é lançada pelo roteamento) até a validação." },
    desligado: { texto: "Desligada", tom: "neutro", detalhe: "Adaptador desligado: a CLI ainda não é suportada com o OpenRouter." },
  };
  const e = base[c.status];
  return !c.instalada && c.status === "verificado" ? { ...e, tom: "neutro", detalhe: `${e.detalhe} CLI não instalada nesta máquina.` } : { ...e };
}

/** CLI padrão para lançar um modelo OpenRouter: a primeira instalada com adaptador verificado; `null` = nenhuma pronta. */
export function cliPreferida(clis: ReadonlyArray<{ cli: string; instalada: boolean; status: StatusAdaptadorCli }>): string | null {
  return clis.find((c) => c.instalada && c.status === "verificado")?.cli ?? null;
}

// Máquina de estados PURA do assistente de configuração do Telegram (5 passos, retomável). Sem React, sem rede.
import type { BotVisao, EstadoTelegram, ModoWorkspaceTelegram, ResultadoTesteToken, WorkspaceTelegramVisao } from "../../../compartilhado/alertas";

export type PassoAssistente = 1 | 2 | 3 | 4 | 5;
export const ROTULOS_PASSOS: Readonly<Record<PassoAssistente, string>> = { 1: "Criar o bot", 2: "Token", 3: "Consentimento", 4: "Parear", 5: "O que o bot pode" };

/** Passo em que o usuário deve retomar, a partir do que já está gravado (retomável: sair no meio mantém o progresso). */
export function passoSugerido(e: Pick<EstadoTelegram, "token_mascarado" | "canal" | "autorizados">): PassoAssistente {
  if (e.token_mascarado === null) return 1;
  if (e.canal.consentimento === null) return 3;
  if (!e.autorizados.some((a) => a.revogado_em === null)) return 4;
  return 5;
}
export function passosConcluidos(e: Pick<EstadoTelegram, "token_mascarado" | "canal" | "autorizados">): ReadonlySet<PassoAssistente> {
  const s = new Set<PassoAssistente>();
  if (e.token_mascarado !== null) { s.add(1); s.add(2); }
  if (e.canal.consentimento !== null) s.add(3);
  if (e.autorizados.some((a) => a.revogado_em === null)) s.add(4);
  if (e.canal.saida_ligada || e.canal.entrada_ligada) s.add(5);
  return s;
}

// ---- formulário do token: o valor só existe enquanto se digita; sai do estado ao salvar ou falhar.
export type FaseToken = "ocioso" | "testando" | "testado" | "salvando" | "salvo" | "erro";
export interface EstadoToken {
  token: string;
  fase: FaseToken;
  bot: BotVisao | null;
  erro: ResultadoTesteToken["erro"] | null;
  instrucao: string | null;
}
export const TOKEN_INICIAL: EstadoToken = { token: "", fase: "ocioso", bot: null, erro: null, instrucao: null };

export type AcaoToken =
  | { t: "digitar"; token: string }
  | { t: "testar" }
  | { t: "resultado_teste"; r: ResultadoTesteToken }
  | { t: "salvar" }
  | { t: "resultado_salvo"; r: { ok: boolean; bot?: BotVisao; erro?: ResultadoTesteToken["erro"]; instrucao?: string } }
  | { t: "limpar" };

export function reduzirToken(s: EstadoToken, a: AcaoToken): EstadoToken {
  switch (a.t) {
    case "digitar": return { ...TOKEN_INICIAL, token: a.token.slice(0, 120) };
    case "testar": return { ...s, fase: "testando", erro: null, instrucao: null };
    case "resultado_teste":
      // falhou: o token digitado sai do estado (nunca fica em memória de UI depois de um erro)
      return a.r.ok ? { ...s, fase: "testado", bot: a.r.bot ?? null } : { token: "", fase: "erro", bot: a.r.bot ?? null, erro: a.r.erro ?? "rede", instrucao: a.r.instrucao ?? null };
    case "salvar": return { ...s, fase: "salvando" };
    case "resultado_salvo":
      return a.r.ok ? { token: "", fase: "salvo", bot: a.r.bot ?? s.bot, erro: null, instrucao: null } : { token: "", fase: "erro", bot: a.r.bot ?? null, erro: a.r.erro ?? "rede", instrucao: a.r.instrucao ?? null };
    case "limpar": return TOKEN_INICIAL;
  }
}

export const FORMATO_TOKEN_UI = /^\d{6,12}:[A-Za-z0-9_-]{30,50}$/;
export const formatoTokenOk = (t: string): boolean => FORMATO_TOKEN_UI.test(t.trim());

export const MENSAGENS_ERRO_TOKEN: Readonly<Record<NonNullable<ResultadoTesteToken["erro"]>, string>> = {
  formato: "O token não tem o formato esperado (123456789:AA…). Copie de novo a mensagem do BotFather.",
  nao_autorizado: "O Telegram recusou este token. Confira se não foi revogado e copie de novo.",
  rede: "Não foi possível falar com o Telegram agora. Verifique a conexão e tente de novo.",
  webhook_ativo: "Há um webhook configurado neste bot; ele impede o recebimento de pedidos. Use \"Limpar webhook\" abaixo.",
  cofre_indisponivel: "O cofre do sistema não está disponível; o token não é salvo em arquivo. Ative o cofre (chaveiro do SO ou senha-mestra) e tente de novo.",
  consentimento: "O consentimento ainda não foi dado para falar com o Telegram.",
};

/** modo "executar direto" só vale digitando `DIRETO`; restrições mostradas na UI. */
export const CONFIRMACAO_DIRETO = "DIRETO";
export const confirmaDireto = (texto: string): boolean => texto === CONFIRMACAO_DIRETO;
export const RESTRICOES_DIRETO: readonly string[] = [
  "Só executa sem esperar o toque quando a rigidez é 3 ou menor, o raio é baixo e o plano não é destrutivo.",
  "Só em branch de trabalho própria (nunca a branch padrão ou protegida) e com até 2 painéis.",
  "Qualquer falha dessas regras volta para \"aprovar antes\".",
  "Nunca assina, aprova raio alto, faz merge, push forçado nem apaga nada por este canal.",
];

// ---- permissões por workspace (nenhum liberado por padrão)
export type ModoLinha = ModoWorkspaceTelegram | "nenhum";
export interface LinhaWorkspace { workspace_id: string; modo: ModoLinha; padrao: boolean }

export function linhasIniciais(todos: ReadonlyArray<{ id: string }>, atuais: readonly WorkspaceTelegramVisao[]): LinhaWorkspace[] {
  const porId = new Map(atuais.map((w) => [w.workspace_id, w]));
  const ids = [...new Set([...todos.map((w) => w.id), ...atuais.map((w) => w.workspace_id)])];
  return ids.map((id) => { const a = porId.get(id); return { workspace_id: id, modo: a?.modo ?? "nenhum", padrao: a?.padrao ?? false }; });
}
/** Só os liberados; exatamente um padrão entre eles (o primeiro, se nenhum estiver marcado). */
export function montarWorkspaces(linhas: readonly LinhaWorkspace[]): WorkspaceTelegramVisao[] {
  const lib = linhas.filter((l): l is LinhaWorkspace & { modo: ModoWorkspaceTelegram } => l.modo !== "nenhum");
  const padrao = lib.find((l) => l.padrao)?.workspace_id ?? lib[0]?.workspace_id;
  return lib.map((l) => ({ workspace_id: l.workspace_id, modo: l.modo, padrao: l.workspace_id === padrao }));
}
export const exigeConfirmacaoDireto = (linhas: readonly LinhaWorkspace[]): boolean => linhas.some((l) => l.modo === "direto");

export const ERROS_ENTRADA: Readonly<Record<string, string>> = {
  consentimento_ausente: "Dê o consentimento (passo 3) antes de ligar os pedidos.",
  sem_autorizado: "Pareie uma conta (passo 4) antes de ligar os pedidos.",
  sem_workspace_liberado: "Libere ao menos um workspace para o bot antes de ligar os pedidos.",
  confirmacao_direto_ausente: "Digite DIRETO para confirmar o modo de execução direta.",
  autorizado_inexistente: "Esta conta não está mais pareada.",
  pin_invalido: "O PIN precisa ter entre 4 e 12 dígitos.",
};
export const mensagemErro = (codigo: string | undefined): string => (codigo === undefined ? "Não foi possível concluir." : (ERROS_ENTRADA[codigo] ?? "Não foi possível concluir."));

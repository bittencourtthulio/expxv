// Assistente de configuração (T-20.23, parte núcleo): formato do token, `getMe` para validar, cofre (nome `TELEGRAM_BOT_TOKEN_<canal_id>`), máscara,
// `deleteWebhook` SÓ pelo passo explícito, `setMyCommands`, texto de consentimento versionado. O token nunca volta à UI (só mascarado), nunca vai a
// log/evento/argv/config. Token de formato errado NEM chega à rede. Cofre indisponível => recusa com instrução.
import { createHash } from "node:crypto";
import { HOST_TELEGRAM_API, nomeSegredoTokenTelegram, VERSAO_TEXTO_CONSENTIMENTO_TELEGRAM } from "../../compartilhado/alertas";
import { redigirParaCanal } from "../alertas/texto";
import { sanitizarTexto } from "./erros";
import type { ClienteBotApi } from "./api";
import type { TgBotInfo } from "./tipos";

export const FORMATO_TOKEN = /^\d{6,12}:[A-Za-z0-9_-]{30,50}$/;
export const VERSAO_TEXTO_CONSENTIMENTO = VERSAO_TEXTO_CONSENTIMENTO_TELEGRAM;
export const HOST_CONSENTIMENTO = HOST_TELEGRAM_API;
export const nomeSegredoToken = nomeSegredoTokenTelegram;

export const COMANDOS_DO_BOT: ReadonlyArray<{ command: string; description: string }> = [
  { command: "status", description: "Situação geral" },
  { command: "tarefas", description: "Tarefas em andamento e próximas" },
  { command: "atrasadas", description: "O que está atrasado" },
  { command: "missoes", description: "Missões ativas" },
  { command: "consumo", description: "Cotas e consumo" },
  { command: "pedir", description: "Pedir um trabalho (você aprova o plano)" },
  { command: "aprovar", description: "Aprovar um plano pendente" },
  { command: "cancelar", description: "Cancelar um plano pendente" },
  { command: "silenciar", description: "Silenciar os alertas deste chat" },
  { command: "ws", description: "Escolher o workspace padrão" },
  { command: "ajuda", description: "Lista de comandos" },
  { command: "parar", description: "Desligar o bot" },
];

/** passos do BotFather, texto FIXO do assistente (a rotação do token cita as duas formas: o comando exato não foi confirmado). */
export const PASSOS_BOTFATHER: readonly string[] = [
  "No Telegram, procure @BotFather (confira o selo de verificado).",
  "Envie /newbot.",
  "Escolha um nome e um username terminado em bot (ex.: expx_seunome_bot).",
  "O BotFather responde com o token (formato 123456789:AA…). Trate como senha.",
  "Recomendado: envie /setjoingroups e escolha Disable (o bot não poderá ser adicionado a grupos) e confira /setprivacy = Enable (padrão).",
  "Se o token vazar: abra /mybots, escolha o bot, API Token e Revoke current token (a página oficial cita também o comando /token; o comando exato de rotação não foi confirmado).",
];

export interface PortaCofreToken {
  disponivel(): boolean;
  guardar(nome: string, valor: string): Promise<void>;
  remover(nome: string): Promise<void>;
  existe(nome: string): Promise<boolean>;
}

export type ErroToken = "formato" | "nao_autorizado" | "rede" | "webhook_ativo" | "cofre_indisponivel" | "consentimento";
export interface ResultadoTeste {
  ok: boolean;
  bot?: TgBotInfo;
  erro?: ErroToken;
  instrucao?: string;
}

export interface DepsAssistente {
  /** cliente da Bot API para ESTE token candidato (consentimento por clique do usuário vem do main). */
  apiPara(token: string): ClienteBotApi;
  /** cliente do token já salvo no cofre. */
  apiSalva(): ClienteBotApi;
  cofre: PortaCofreToken;
  canal_id: string;
}

export function mascararToken(token: string): string {
  const [id = "", seg = ""] = token.split(":");
  return `${id.slice(0, 4)}…:${seg.slice(0, 2)}…${seg.slice(-3)}`;
}

export interface TextoConsentimento {
  versao_texto: string;
  hash_texto: string;
  host: string;
  texto: string;
  itens: string[];
}
/** texto exato mostrado ao usuário; a versão e o hash são gravados no consentimento. Mudar o texto => nova versão => consentimento invalidado. */
export function textoConsentimento(itens: string[]): TextoConsentimento {
  const lista = itens.length === 0 ? "nenhum tipo ligado ainda" : itens.join(", ");
  const texto = [
    `Os alertas que você ligar serão enviados para ${HOST_CONSENTIMENTO}.`,
    "O Telegram (empresa) consegue ler as mensagens do bot; elas não são ponta a ponta.",
    "Por padrão enviamos só: tipo, ID da tarefa, título curto (até 60 caracteres, redigido), tempo de trabalho, tokens e story points.",
    "Nunca enviamos código, caminhos, segredos nem trechos de terminal.",
    "Pedidos recebidos pelo bot só viram execução depois de você aprovar.",
    `Tipos ligados: ${lista}.`,
  ].join(" ");
  return { versao_texto: VERSAO_TEXTO_CONSENTIMENTO, hash_texto: createHash("sha256").update(texto).digest("hex"), host: HOST_CONSENTIMENTO, texto, itens };
}

export interface Assistente {
  /** formato -> (rede) getMe; não salva. `token = null` testa o do cofre. */
  testar(token: string | null): Promise<ResultadoTeste>;
  /** só depois de `getMe` ok E cofre disponível. Devolve só o MASCARADO. */
  salvar(token: string): Promise<{ ok: boolean; token_mascarado?: string; bot?: TgBotInfo; erro?: ErroToken; instrucao?: string }>;
  remover(): Promise<{ ok: boolean }>;
  /** único lugar que chama `deleteWebhook` (clique do usuário). */
  limparWebhook(): Promise<{ ok: boolean }>;
  configurarComandos(): Promise<{ ok: boolean }>;
}

export function criarAssistente(deps: DepsAssistente): Assistente {
  const nome = nomeSegredoToken(deps.canal_id);

  async function testarCom(api: ClienteBotApi): Promise<ResultadoTeste> {
    try {
      const bot = await api.getMe();
      try {
        const w = await api.getWebhookInfo();
        if (w.url !== "") return { ok: false, bot, erro: "webhook_ativo", instrucao: "Há um webhook configurado neste bot; ele impede o getUpdates. Use o passo 'Limpar webhook' do assistente." };
      } catch {
        /* diagnóstico opcional */
      }
      return { ok: true, bot };
    } catch (e) {
      const c = (e as { codigo?: string }).codigo;
      if (c === "token_invalido") return { ok: false, erro: "nao_autorizado" };
      if (c === "consentimento_ausente") return { ok: false, erro: "consentimento" };
      return { ok: false, erro: "rede" };
    }
  }

  return {
    async testar(token) {
      if (token === null) return testarCom(deps.apiSalva());
      if (!FORMATO_TOKEN.test(token)) return { ok: false, erro: "formato" }; // nem chega à rede
      return testarCom(deps.apiPara(token));
    },
    async salvar(token) {
      if (!FORMATO_TOKEN.test(token)) return { ok: false, erro: "formato" };
      if (!deps.cofre.disponivel()) return { ok: false, erro: "cofre_indisponivel", instrucao: "O cofre do sistema não está disponível; o token não é salvo em arquivo. Ative o cofre (chaveiro do SO ou senha-mestra) e tente de novo." };
      const t = await testarCom(deps.apiPara(token));
      if (!t.ok) return { ok: false, ...(t.erro === undefined ? {} : { erro: t.erro }), ...(t.instrucao === undefined ? {} : { instrucao: t.instrucao }), ...(t.bot === undefined ? {} : { bot: t.bot }) };
      await deps.cofre.guardar(nome, token);
      return { ok: true, token_mascarado: mascararToken(token), ...(t.bot === undefined ? {} : { bot: t.bot }) };
    },
    async remover() {
      await deps.cofre.remover(nome);
      return { ok: true };
    },
    async limparWebhook() {
      try {
        await deps.apiSalva().deleteWebhook({ drop_pending_updates: false });
        return { ok: true };
      } catch {
        return { ok: false };
      }
    },
    async configurarComandos() {
      try {
        await deps.apiSalva().setMyCommands([...COMANDOS_DO_BOT]);
        return { ok: true };
      } catch {
        return { ok: false };
      }
    },
  };
}

/** defesa em profundidade: nada que sai do assistente carrega o token. */
export const sanitizarDetalhe = (t: string, token?: string): string => redigirParaCanal(sanitizarTexto(t, token));

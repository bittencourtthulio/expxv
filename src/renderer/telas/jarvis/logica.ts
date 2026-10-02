import type { ItemSubNav } from "../../componentes/subnavegacao-logica";
// Lógica PURA da tela Jarvis/Remoto (Fase 13): rótulos, contagem regressiva em TEXTO, rótulos de risco e de permissão, validações de formulário. Sem React, sem relógio global.
import type { AcaoJarvis, ClasseRisco, CodigoRecusaJarvis, EstadoTransporte, PermissaoRemota } from "../../../compartilhado/jarvis";

export type AbaJarvis = "conversa" | "remoto" | "relay" | "auditoria";
export const ABAS_JARVIS: ReadonlyArray<ItemSubNav<AbaJarvis>> = [
  { id: "conversa", rotulo: "Conversa", icone: "chat" },
  { id: "remoto", rotulo: "Controle remoto", icone: "terminais" },
  { id: "relay", rotulo: "Relay (experimental)", icone: "provedores" },
  { id: "auditoria", rotulo: "Auditoria", icone: "relatorios" },
];

export const ROTULO_ACAO: Record<AcaoJarvis, string> = {
  status: "Status",
  listar_missoes: "Missões",
  listar_paineis: "Painéis",
  consultar_consumo: "Consumo",
  abrir_pane: "Abrir painel",
  enviar_prompt: "Enviar ao Maestro",
  aprovar_gate: "Decidir portão",
  pausar: "Pausar",
  parar: "Parar",
};
export const ROTULO_RISCO: Record<ClasseRisco, string> = { leitura: "só leitura", escrita_leve: "ação local", escrita: "pede confirmação" };
export const ROTULO_PERMISSAO: Record<PermissaoRemota, string> = {
  leitura: "Só leitura",
  mensagem_confirmada: "Mensagem com confirmação no desktop",
  mensagem_direta: "Mensagem direta (sem confirmação extra)",
};
export const EXPLICACAO_PERMISSAO: Record<PermissaoRemota, string> = {
  leitura: "Vê status, painéis e Missões. Não envia nada.",
  mensagem_confirmada: "Pode pedir ao Maestro; cada pedido só roda depois do seu «Sim» aqui no desktop.",
  mensagem_direta: "Pode pedir ao Maestro sem confirmação extra (portões de aprovação continuam pedindo). Suspensa com a tela bloqueada.",
};

/** «expira em 12 s» (texto, nunca só cor). Negativo vira «expirada». */
export function contagemRegressiva(expiraEm: string, agoraMs: number): string {
  const s = Math.ceil((Date.parse(expiraEm) - agoraMs) / 1000);
  if (!Number.isFinite(s) || s <= 0) return "expirada";
  return s >= 90 ? `expira em ${Math.ceil(s / 60)} min` : `expira em ${s} s`;
}

export const TEXTO_CODIGO: Partial<Record<CodigoRecusaJarvis, string>> = {
  confirmacao_expirada: "A confirmação expirou. Peça de novo.",
  confirmacao_invalida: "Essa confirmação já foi usada ou não existe mais.",
};

/** Resumo do estado do servidor em texto curto, para o indicador do rodapé e a tela. */
export function resumoTransporte(t: EstadoTransporte): string {
  if (!t.ligado) return "Desligado";
  const onde = t.endereco === null || t.porta === null ? "" : ` em ${t.transporte === "lan" ? "https" : "http"}://${t.endereco}:${t.porta}`;
  return `Ligado${onde} · ${t.conectados} conectado${t.conectados === 1 ? "" : "s"}`;
}
export const enderecoDeParear = (t: EstadoTransporte): string | null => (t.ligado && t.endereco !== null && t.porta !== null ? `${t.transporte === "lan" ? "https" : "http"}://${t.endereco}:${t.porta}` : null);

export const PALAVRA_DIRETA = "PERMITIR";
export const podeConfirmarPermissao = (permissao: PermissaoRemota, digitado: string): boolean => permissao !== "mensagem_direta" || digitado === PALAVRA_DIRETA;

/** o código aparece UMA vez e some ao expirar. */
export const codigoVisivel = (expiraEm: string | null, agoraMs: number): boolean => expiraEm !== null && Date.parse(expiraEm) > agoraMs;

export function tempoRelativo(iso: string | null, agoraMs: number): string {
  if (iso === null) return "nunca";
  const s = Math.max(0, Math.round((agoraMs - Date.parse(iso)) / 1000));
  if (s < 60) return "agora há pouco";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86_400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86_400)} d`;
}

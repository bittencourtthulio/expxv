// Contratos da Fase 22 (relay cego, PWA e VPS opcional). Tipos, constantes e validadores PUROS: sem Node, sem DOM (usado pelo main, pelo renderer e pelo núcleo).
// Tudo nasce DESLIGADO e EXPERIMENTAL (D-350/D-351): `habilitado:false` e `experimental:true` são invariantes (teste ax34). Nenhum endereço de relay vem embutido.

import { PRODUTO } from "../nucleo/produto";

/** `<id do produto>-relay.1`: derivado de `produto.ts` (D-01), nunca literal. */
export const VERSAO_PROTOCOLO_RELAY = `${PRODUTO.id}-relay.1`;
export const TEXTO_CONSENTIMENTO_RELAY_VERSAO = "relay-1";

export const LIMITES_RELAY = Object.freeze({
  /** quadro de controle antes da autenticação (hello/prova). */
  quadro_pre_auth: 1024,
  /** quadro opaco depois da autenticação. */
  quadro_max: 64 * 1024,
  handshake_ms: 5_000,
  ping_min_ms: 25_000,
  ping_max_ms: 30_000,
  backoff_min_ms: 1_000,
  backoff_max_ms: 60_000,
  tentativas_por_min: 12,
  epoca_ms: 86_400_000,
  ttl_pareamento_ms: 120_000,
});

export interface ConfigRelay {
  url: string;
  habilitado: boolean;
  experimental: boolean;
  consentimento_versao: string;
  reconhecimento_experimental: boolean;
  padding: boolean;
  pwa_origem: string;
}
export const CONFIG_RELAY_PADRAO: Readonly<ConfigRelay> = Object.freeze({
  url: "",
  habilitado: false,
  experimental: true,
  consentimento_versao: "",
  reconhecimento_experimental: false,
  padding: true,
  pwa_origem: "",
});

export type TransporteDispositivo = "lan" | "relay" | "ambos";
export interface DispositivoRelay {
  id: string;
  nome: string;
  permissao: "leitura" | "mensagem_confirmada" | "mensagem_direta";
  transporte: TransporteDispositivo;
  ultimo_visto_em: string | null;
  revogado_em: string | null;
  conectado: boolean;
}
export type SituacaoRelay = "desligado" | "ocioso" | "conectando" | "conectado" | "indisponivel";
export interface EstadoRelay {
  ligado: boolean;
  situacao: SituacaoRelay;
  conectado: boolean;
  url: string;
  latencia_ms: number | null;
  dispositivos: number;
  experimental: true;
}
export type TipoEventoRelay = "ligado" | "desligado" | "conectado" | "desconectado" | "pareamento_aberto" | "pareamento_concluido" | "pareamento_falhou" | "revogado" | "panico" | "quadro_invalido" | "relay_indisponivel";
export type ErroLigarRelay = "consentimento_ausente" | "reconhecimento_ausente" | "url_invalida" | "ja_ligado" | "falhou";

/** Canais IPC (lista fechada; o registro em `ipc.ts` é do coordenador). Pareamento e SAS são `sensivel`: nunca logados. */
export const CANAIS_RELAY = Object.freeze({
  estado: "relay:estado",
  config_obter: "relay:config_obter",
  config_definir: "relay:config_definir",
  ligar: "relay:ligar",
  desligar: "relay:desligar",
  parear_iniciar: "relay:parear_iniciar",
  parear_sas: "relay:parear_sas",
  parear_decidir: "relay:parear_decidir",
  dispositivos: "relay:dispositivos",
  revogar: "relay:revogar",
  panico: "relay:panico",
  evento: "relay:evento",
} as const);
export const CANAIS_RELAY_SENSIVEIS: readonly string[] = [CANAIS_RELAY.parear_iniciar, CANAIS_RELAY.parear_sas];

const HOST_PRIVADO = /^(?:localhost|.*\.local|.*\.localhost|.*\.invalid|.*\.internal)$/i;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
/** `wss://` sem credencial, sem query/fragmento, host que não seja IP nem nome local/inválido. Só sintaxe: nenhuma resolução de DNS. */
export function validarUrlRelay(url: unknown): boolean {
  if (typeof url !== "string" || url.length === 0 || url.length > 200) return false;
  if (/[\s\u0000-\u001f]/.test(url)) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "wss:" || u.username !== "" || u.password !== "" || u.search !== "" || u.hash !== "") return false;
  const h = u.hostname.replace(/\.+$/, ""); // `localhost.` e `api.local.` são o MESMO nome local (ponto final de nome absoluto: A-07)
  if (h.length === 0 || h.length > 253 || h.startsWith("[") || h.includes(":") || IPV4.test(h) || HOST_PRIVADO.test(h) || !h.includes(".")) return false;
  return true;
}

/** o relay só atende `/v1/canal/*`: URL sem caminho (a forma documentada, `wss://relay.exemplo.com`) recebe o caminho padrão. Igual a `urlDoCanal` do PWA. */
export function urlDoCanalRelay(url: string): string {
  const u = new URL(url);
  if (u.pathname === "/" || u.pathname === "") u.pathname = "/v1/canal/x";
  return u.toString();
}

export type ResultadoValidacao = { ok: true; valor: Partial<ConfigRelay> } | { ok: false; erro: string };
const CAMPOS_EDITAVEIS = new Set(["url", "habilitado", "reconhecimento_experimental", "consentimento_versao", "padding", "pwa_origem"]);
/** Validador estrito de `relay:config_definir`: lista fechada de campos; `experimental` nunca é editável; `pwa_origem` só `https://` ou vazio. */
export function validarConfigRelayParcial(x: unknown): ResultadoValidacao {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return { ok: false, erro: "formato" };
  const o = x as Record<string, unknown>;
  const v: Partial<ConfigRelay> = {};
  for (const k of Object.keys(o)) {
    if (!CAMPOS_EDITAVEIS.has(k)) return { ok: false, erro: `campo_desconhecido:${k}` };
  }
  if ("url" in o) {
    if (o["url"] !== "" && !validarUrlRelay(o["url"])) return { ok: false, erro: "url" };
    v.url = o["url"] as string;
  }
  for (const k of ["habilitado", "reconhecimento_experimental", "padding"] as const) {
    if (k in o) {
      if (typeof o[k] !== "boolean") return { ok: false, erro: k };
      v[k] = o[k] as boolean;
    }
  }
  if ("consentimento_versao" in o) {
    const c = o["consentimento_versao"];
    if (typeof c !== "string" || c.length > 32 || !/^[A-Za-z0-9._-]*$/.test(c)) return { ok: false, erro: "consentimento_versao" };
    v.consentimento_versao = c;
  }
  if ("pwa_origem" in o) {
    const p = o["pwa_origem"];
    if (typeof p !== "string" || p.length > 200 || (p !== "" && !/^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?:\/[A-Za-z0-9._~\-/]*)?$/.test(p))) return { ok: false, erro: "pwa_origem" };
    v.pwa_origem = p;
  }
  return { ok: true, valor: v };
}

// ---------------------------------------------------------------------------------------------- W3-W5: pareamento, API do renderer e eventos
/** única permissão inicial de um dispositivo pareado pelo relay (AX-28); só o desktop a sobe depois. */
export const PERMISSAO_INICIAL_RELAY = "leitura" as const;
export type SituacaoPareamentoRelay = "fechado" | "aguardando_celular" | "aguardando_decisao" | "concluido" | "negado" | "expirado";
export type ErroParearRelay = "relay_desligado" | "ja_pareando" | "falhou";
/** Resultado de `relay:parear_iniciar` (SENSÍVEL: nunca logado). `qr` é o link `<pwa_origem>#r=…&c=…&h=…&p=…` (vazio sem `pwa_origem`); o PSK só existe aqui e na memória do host. */
export interface PareamentoRelayAberto {
  qr: string;
  codigo: string;
  expira_em: string;
  /** SHA-256 da identidade do host em grupos de 4 hex (comparar com o celular). */
  impressao_host: string;
  /** hash esperado do shell do PWA (se o host o conhece); `null` = compare o que o celular mostra com o seu build. */
  impressao_cliente_esperada: string | null;
}
/** Resultado de `relay:parear_sas` (SENSÍVEL). `sas` só existe em `aguardando_decisao`. */
export interface SasRelayVisao {
  situacao: SituacaoPareamentoRelay;
  sas: string | null;
  nome_dispositivo: string | null;
}
export interface ApiRelay {
  estado(): Promise<EstadoRelay>;
  configObter(): Promise<ConfigRelay>;
  configDefinir(patch: Partial<ConfigRelay>): Promise<ConfigRelay>;
  ligar(): Promise<{ ok: boolean; motivo?: ErroLigarRelay }>;
  desligar(): Promise<{ ok: boolean }>;
  parearIniciar(): Promise<PareamentoRelayAberto | { erro: ErroParearRelay }>;
  parearSas(): Promise<SasRelayVisao>;
  parearDecidir(permitir: boolean): Promise<{ ok: boolean }>;
  dispositivos(): Promise<DispositivoRelay[]>;
  revogar(dispositivoId: string): Promise<{ ok: boolean }>;
  panico(): Promise<{ ok: boolean }>;
  /** estado coalescido a cada mudança; devolve o cancelamento. */
  assinar(cb: (e: EstadoRelay) => void): () => void;
}
export type EventoRelayIpc = EstadoRelay;

/** Mensagens extras DENTRO da sessão cifrada da Fase 13 (só valem com origem `relay`): entrega do segredo de canal e «esquecer este dispositivo». */
export const MSG_CANAL_SEGREDO = "canal_segredo" as const;
export const MSG_ESQUECER = "esquecer" as const;
export const ESTADO_RELAY_PADRAO: Readonly<EstadoRelay> = Object.freeze({ ligado: false, situacao: "desligado", conectado: false, url: "", latencia_ms: null, dispositivos: 0, experimental: true });

/** Texto do consentimento versionado do relay (`TEXTO_CONSENTIMENTO_RELAY_VERSAO`): o que o relay VÊ e o que NÃO vê. A tela o exibe como está. */
export const TEXTO_CONSENTIMENTO_RELAY = Object.freeze({
  ve: ["o endereço IP do seu desktop e o do seu celular", "os horários em que cada um conecta e desconecta", "o tamanho aproximado de cada mensagem (em blocos de 256 B, 1 KiB ou 4 KiB)", "um identificador de canal que muda todo dia"],
  naoVe: ["o conteúdo das mensagens, dos painéis e das Missões", "o nome dos seus dispositivos", "os comandos que você pede", "nenhuma chave nem senha"],
  reconhecimento: "Entendo que o relay é EXPERIMENTAL e que a criptografia não passou por revisão externa.",
});

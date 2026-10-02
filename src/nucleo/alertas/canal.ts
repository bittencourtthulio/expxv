// Interface `CanalComunicacao`, registro lazy e consentimento (T-20.16). Todo canal EXTERNO só envia com consentimento válido,
// checado ANTES de qualquer I/O (pelo entregador e, de novo, pelo adaptador). Mudar a versão do texto invalida o consentimento.
import type { CanalRegistro, ConsentimentoCanal, EstadoCanal, Severidade, TipoCanal } from "../../compartilhado/alertas";

export interface CapacidadesCanal {
  entrada: boolean;
  botoes: boolean;
  formato: "texto" | "html";
  limite_visivel: number;
  edita_mensagem: boolean;
  precisa_consentimento: boolean;
  /** espaçamento mínimo entre envios do mesmo canal/chat (ms). */
  min_intervalo_ms: number;
  /** teto de mensagens por minuto. */
  max_por_min: number;
}

export interface MensagemSaida {
  entrega_id: string;
  alerta_ids: string[];
  titulo: string;
  texto: string;
  /** só quando `capacidades.formato === "html"`; já escapado. */
  html?: string;
  severidade: Severidade;
  silenciosa: boolean;
  /** nonces opacos (<= 26 bytes), nunca dado do plano. */
  botoes?: Array<Array<{ rotulo: string; dado: string }>>;
  destino?: { chat_ref: string };
  editar?: { mensagem_externa_id: string };
}

export type ErroEnvio = "token_invalido" | "chat_inalcancavel" | "rate_limited" | "rede" | "conteudo_invalido" | "desligado" | "consentimento_ausente";
export type ResultadoEnvio = { ok: true; mensagem_externa_id?: string } | { ok: false; permanente: boolean; erro: ErroEnvio; tentar_em_ms?: number };

export interface CanalComunicacao {
  readonly tipo: TipoCanal;
  readonly capacidades: CapacidadesCanal;
  estado(): EstadoCanal;
  enviar(msg: MensagemSaida, sinal: AbortSignal): Promise<ResultadoEnvio>;
  /** nunca devolve segredo. */
  testar(sinal: AbortSignal): Promise<{ ok: boolean; detalhe: string }>;
  iniciar?(): Promise<void>;
  parar?(): Promise<void>;
}

export const CANAIS_EXTERNOS_TIPO: ReadonlySet<TipoCanal> = new Set<TipoCanal>(["telegram", "webhook"]);
export const precisaConsentimento = (t: TipoCanal): boolean => CANAIS_EXTERNOS_TIPO.has(t);

export function consentimentoValido(c: ConsentimentoCanal | null, versaoVigente: string, host?: string): boolean {
  if (c === null) return false;
  if (c.versao_texto !== versaoVigente) return false;
  if (host !== undefined && c.host !== host) return false;
  return Number.isFinite(Date.parse(c.aceito_em));
}

export class ConsentimentoAusente extends Error {
  readonly codigo = "consentimento_ausente";
  constructor() {
    super("consentimento_ausente: o canal só envia depois do consentimento atual");
    this.name = "ConsentimentoAusente";
  }
}
/** lança `ConsentimentoAusente` (sem I/O) se o canal for externo e o consentimento faltar/estiver obsoleto. */
export function exigirConsentimento(canal: Pick<CanalRegistro, "tipo" | "consentimento">, versaoVigente: string, host?: string): void {
  if (precisaConsentimento(canal.tipo) && !consentimentoValido(canal.consentimento, versaoVigente, host)) throw new ConsentimentoAusente();
}

export type FabricaCanal = () => Promise<CanalComunicacao> | CanalComunicacao;
export interface RegistroDeCanais {
  registrar(tipo: TipoCanal, fabrica: FabricaCanal): void;
  /** instancia na primeira chamada (import dinâmico fica dentro da fábrica); depois reusa. */
  obter(tipo: TipoCanal): Promise<CanalComunicacao | null>;
  instanciados(): TipoCanal[];
  descartar(tipo: TipoCanal): Promise<void>;
}

export function criarRegistroDeCanais(): RegistroDeCanais {
  const fabricas = new Map<TipoCanal, FabricaCanal>();
  const vivos = new Map<TipoCanal, Promise<CanalComunicacao>>();
  return {
    registrar(tipo, fabrica) {
      if (fabricas.has(tipo)) throw new Error(`canal já registrado: ${tipo}`);
      fabricas.set(tipo, fabrica);
    },
    async obter(tipo) {
      const f = fabricas.get(tipo);
      if (f === undefined) return null;
      let p = vivos.get(tipo);
      if (p === undefined) {
        p = Promise.resolve(f());
        vivos.set(tipo, p);
      }
      return p;
    },
    instanciados: () => [...vivos.keys()],
    async descartar(tipo) {
      const p = vivos.get(tipo);
      vivos.delete(tipo);
      if (p !== undefined) await (await p).parar?.();
    },
  };
}

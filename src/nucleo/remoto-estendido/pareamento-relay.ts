// Pareamento via relay (T-22.11). O canal EFÊMERO nasce do código de 60 bits da Fase 13 (que o dono lê no desktop e o celular recebe por QR/fragmento ou digitando): o relay nunca vê o código,
// só o `canal_id` derivado dele (HKDF; adivinhar custaria 2^60 por tentativa dentro de uma janela de 120 s). Por dentro continua o handshake da Fase 13 INALTERADO (ECDH + código -> HKDF,
// conf_s/conf_c, SAS nos DOIS lados, «Permitir» NO DESKTOP, dispositivo nasce `leitura`). A entrega do segredo de canal definitivo é uma mensagem DENTRO da sessão cifrada (`canal_segredo`).
import { createHash, randomBytes } from "node:crypto";
import { MSG_CANAL_SEGREDO, MSG_ESQUECER } from "../../compartilhado/relay";
import { canalId, chaveEnvelope, epocaDe, novoSegredoDeCanal } from "./canal";
import { IMPRESSAO_HEX } from "./impressao-digital";

/** mesma normalização de `normalizarCodigo` da Fase 13 (cópia de uma linha: este módulo não importa o protocolo do servidor LAN; `pareamento-relay.test.ts` confere a igualdade). */
export const normalizarCodigoRelay = (t: string): string => t.trim().toUpperCase().replace(/[-\s]/g, "");
export const PREFIXO_SEGREDO_EFEMERO = "xv/relay/pareamento-segredo|";
export const JANELA_ENTREGA_SEGREDO_MS = 180_000;

/** S = SHA-256(prefixo ‖ código normalizado) — espelho de `segredoEfemero` em pwa/protocolo-cliente.js. */
export const segredoEfemero = (codigo: string): Buffer => createHash("sha256").update(PREFIXO_SEGREDO_EFEMERO).update(normalizarCodigoRelay(codigo)).digest();
export const canalEfemero = (codigo: string): string => canalId(segredoEfemero(codigo), 0);
export const chaveEfemera = (codigo: string): Buffer => chaveEnvelope(segredoEfemero(codigo), "pareamento");

export interface ParamsLink {
  pwaOrigem: string;
  relayUrl: string;
  codigo: string;
  impressaoHostHex: string;
  impressaoPwaHex: string | null;
}
/** `<pwa_origem>#r=…&c=…&h=…&p=…`: tudo no FRAGMENTO (nunca enviado a servidor). Vazio se não houver `pwa_origem`. */
export function montarLink(p: ParamsLink): string {
  if (p.pwaOrigem === "") return "";
  const c = normalizarCodigoRelay(p.codigo);
  const h = p.impressaoHostHex;
  const pw = p.impressaoPwaHex ?? "";
  if (!/^[A-Z2-9]{12}$/.test(c) || h.length !== IMPRESSAO_HEX || (pw !== "" && pw.length !== IMPRESSAO_HEX)) throw new RangeError("parametros_invalidos");
  return `${p.pwaOrigem}#r=${encodeURIComponent(p.relayUrl)}&c=${c}&h=${h}&p=${pw}`;
}

/** nome no cofre do SO (`[A-Z][A-Z0-9_]*`): hash do id, nunca o id nem o segredo. */
export const nomeSegredoCanal = (dispositivoId: string): string => `RELAY_CANAL_${createHash("sha256").update(dispositivoId).digest("hex").slice(0, 24).toUpperCase()}`;

export interface PortaCanais {
  obter(dispositivoId: string): { epoca_ultima: number; revogado_em: string | null } | null;
  registrar(dispositivoId: string, epoca: number): void;
}
export interface PortaSegredosCanal {
  gravar(nome: string, valor: string): Promise<void>;
}
export interface DepsMensagemRelay {
  canais: PortaCanais;
  segredos: PortaSegredosCanal;
  relogio: { agora(): number };
  /** dispositivos pareados AGORA por este relay e ainda sem segredo: só eles podem pedir a entrega (id -> instante do «Permitir»). */
  recentes: Map<string, number>;
  bytes?: (n: number) => Buffer;
  /** o segredo foi entregue: o serviço sobe o canal definitivo e encerra o efêmero. */
  aoSegredoEntregue(dispositivoId: string, segredo: Buffer): void;
  /** «esquecer este dispositivo» pedido pelo celular: o host revoga (autoritativo). */
  revogar(dispositivoId: string): Promise<boolean>;
  /** agenda `fn` (a revogação sai DEPOIS da resposta, senão o canal fecha antes de o celular ouvir «esquecido»). */
  adiar(fn: () => void, ms: number): void;
}
type Disp = { id: string; nome: string; permissao: string };

/** Gancho do serviço remoto (só `origem: relay`): `undefined` = a mensagem não é minha, segue o tratador comum. Nunca lança. */
export function criarMensagemRelay(d: DepsMensagemRelay): (disp: Disp, msg: unknown) => Promise<unknown> {
  return async (disp, msg) => {
    if (typeof msg !== "object" || msg === null || Array.isArray(msg)) return undefined;
    const t = (msg as Record<string, unknown>)["t"];
    try {
      if (t === MSG_CANAL_SEGREDO) {
        const em = d.recentes.get(disp.id);
        const existente = d.canais.obter(disp.id);
        if (existente !== null) return { t: "erro", e: "ja_emitido" };
        if (em === undefined || d.relogio.agora() - em > JANELA_ENTREGA_SEGREDO_MS) {
          d.recentes.delete(disp.id);
          return { t: "erro", e: "nao_permitido" };
        }
        d.recentes.delete(disp.id); // consome a permissão AGORA, antes de qualquer `await`: um segundo pedido concorrente cai em `nao_permitido` (A-03: nunca dois segredos)
        try {
          const segredo = novoSegredoDeCanal(d.bytes ?? randomBytes);
          await d.segredos.gravar(nomeSegredoCanal(disp.id), segredo.toString("base64"));
          const epoca = epocaDe(d.relogio.agora());
          d.canais.registrar(disp.id, epoca);
          d.aoSegredoEntregue(disp.id, segredo);
          return { t: MSG_CANAL_SEGREDO, segredo: segredo.toString("base64"), epoca };
        } catch (e) {
          d.recentes.set(disp.id, em); // o cofre falhou: nada foi entregue, o celular pode tentar de novo dentro da janela
          throw e;
        }
      }
      if (t === MSG_ESQUECER) {
        d.adiar(() => void d.revogar(disp.id).catch(() => false), 300);
        return { t: "esquecido" };
      }
    } catch {
      return { t: "erro", e: "falhou" };
    }
    return undefined;
  };
}

// Motor HTTP compatível (Fase 11, T-11.07): `POST <url>/audio/transcriptions` multipart. REMOTO e OPT-IN: sem consentimento vigente do host NEM ABRE o socket. Toda saída de rede passa
// pela camada única `nucleo/rede` (https obrigatório, nada de IP/localhost/rede privada, não segue redirecionamento para outro host, sem log de cabeçalho/corpo/query).
// Chave do cofre só no cabeçalho `Authorization`; áudio NUNCA vai em query string; 1 retry em 5xx/rede (o buffer fica retido); erros nominais sem corpo, sem chave e sem áudio.
import { randomBytes } from "node:crypto";
import { validarUrlDeServico } from "../../privacidade/consentimento";
import type { ClienteRede, RegistroConsentimento as RedeConsentimento } from "../../rede";
import { RedeErro } from "../../rede/erros";
import { ErroMotor, type MotorStt, type OpcoesTranscricao } from "./motor";

export interface OpcoesMotorHttp {
  url: string;
  /** valor da chave (só no momento do envio); `null` = servidor sem chave. */
  chave: () => Promise<string | null>;
  /** o host atual tem consentimento vigente? Consultado antes de CADA tentativa (revogar derruba o uso na hora). */
  consentido: (host: string) => boolean;
  rede: ClienteRede;
  /** registro de hosts/tokens da camada de rede; o motor só concede token de uso único depois do consentimento vigente. */
  registroRede: RedeConsentimento;
  timeout_ms?: number;
  modelo_padrao?: string;
  /** só testes: libera servidor falso em loopback. */
  permitirLoopbackHttp?: boolean;
}

/** multipart/form-data montado à mão (a camada de rede recebe bytes). */
export function montarMultipart(campos: Record<string, string>, arquivo: { campo: string; nome: string; tipo: string; bytes: Uint8Array }, limite: string = `----voz${randomBytes(12).toString("hex")}`): { corpo: Uint8Array; tipo: string } {
  const enc = new TextEncoder();
  const partes: Uint8Array[] = [];
  for (const [k, v] of Object.entries(campos)) {
    if (/["\r\n]/.test(k)) throw new Error("Nome de campo inválido.");
    partes.push(enc.encode(`--${limite}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  partes.push(enc.encode(`--${limite}\r\nContent-Disposition: form-data; name="${arquivo.campo}"; filename="${arquivo.nome}"\r\nContent-Type: ${arquivo.tipo}\r\n\r\n`), arquivo.bytes, enc.encode(`\r\n--${limite}--\r\n`));
  const total = partes.reduce((n, p) => n + p.byteLength, 0);
  const corpo = new Uint8Array(total);
  let o = 0;
  for (const p of partes) { corpo.set(p, o); o += p.byteLength; }
  return { corpo, tipo: `multipart/form-data; boundary=${limite}` };
}

class ErroTentavel extends Error {
  constructor(readonly erro: ErroMotor) { super(erro.message); }
}

export function criarMotorHttp(op: OpcoesMotorHttp): MotorStt {
  const timeout = op.timeout_ms ?? 60_000;

  const abortado = (o: OpcoesTranscricao): boolean => o.sinal?.aborted === true;

  async function tentar(u: { hostname: string; host: string; porta: number | null; caminho: string }, wav: Uint8Array, o: OpcoesTranscricao): Promise<string> {
    if (!op.consentido(u.host)) {
      op.registroRede.revogarHost(u.hostname);
      throw new ErroMotor("consentimento_ausente", `Sem consentimento para enviar áudio a ${u.host}.`);
    }
    if (abortado(o)) throw new ErroMotor("cancelado", "Transcrição cancelada.");
    const chave = await op.chave();
    const campos: Record<string, string> = { model: o.modelo ?? op.modelo_padrao ?? "whisper-1", language: o.idioma, response_format: "json" };
    if (o.prompt !== "") campos["prompt"] = o.prompt;
    const { corpo, tipo } = montarMultipart(campos, { campo: "file", nome: "fala.wav", tipo: "audio/wav", bytes: wav });
    op.registroRede.permitirHost(u.hostname);
    const token = op.registroRede.conceder(u.hostname, { usos: 1, validade_ms: timeout + 5_000 });
    try {
      const r = await op.rede.requisitar({
        host: u.hostname,
        caminho: `${u.caminho}/audio/transcriptions`,
        metodo: "POST",
        cabecalhos: { "content-type": tipo, accept: "application/json", ...(chave === null ? {} : { authorization: `Bearer ${chave}` }) },
        corpo,
        tokenDeConsentimento: token,
        timeout_ms: timeout,
        max_bytes: 1024 * 1024,
        ...(u.porta === null ? {} : { porta: u.porta }),
        ...(o.sinal === undefined ? {} : { sinal: o.sinal }),
      });
      if (r.status === 401 || r.status === 403) throw new ErroMotor("chave_recusada", "O serviço de voz recusou a chave.");
      if (r.status === 429) throw new ErroMotor("limite_de_uso", "O serviço de voz atingiu o limite de uso.");
      if (r.status >= 500) throw new ErroTentavel(new ErroMotor("motor_falhou", `O serviço de voz respondeu ${r.status}.`));
      if (r.status < 200 || r.status >= 300) throw new ErroMotor("motor_falhou", `O serviço de voz respondeu ${r.status}.`);
      let j: { text?: unknown } | null = null;
      try { j = r.json<{ text?: unknown }>(); } catch { j = null; }
      if (j === null || typeof j.text !== "string") throw new ErroMotor("motor_falhou", "Resposta do serviço de voz sem texto.");
      return j.text;
    } catch (e) {
      op.registroRede.revogar(token);
      if (e instanceof ErroMotor || e instanceof ErroTentavel) throw e;
      if (abortado(o)) throw new ErroMotor("cancelado", "Transcrição cancelada.");
      if (e instanceof RedeErro) {
        if (e.codigo === "consent_required" || e.codigo === "host_nao_permitido" || e.codigo === "https_obrigatorio" || e.codigo === "requisicao_invalida") throw new ErroMotor("consentimento_ausente", "A camada de rede recusou o envio (host sem consentimento ou inválido).");
        if (e.codigo === "timeout") throw new ErroTentavel(new ErroMotor("tempo_esgotado", "O serviço de voz demorou demais."));
      }
      throw new ErroTentavel(new ErroMotor("sem_rede", "Sem conexão com o serviço de voz."));
    }
  }

  return {
    async transcrever(wav, o) {
      const u = validarUrlDeServico(op.url, op.permitirLoopbackHttp === true ? { permitirLoopbackHttp: true } : {});
      if (!u.ok) throw new ErroMotor("motor_ausente", u.motivo);
      try {
        return await tentar(u, wav, o);
      } catch (e) {
        if (!(e instanceof ErroTentavel)) throw e;
        try {
          return await tentar(u, wav, o); // única nova tentativa, com o mesmo buffer
        } catch (e2) {
          throw e2 instanceof ErroTentavel ? e2.erro : e2;
        }
      }
    },
  };
}

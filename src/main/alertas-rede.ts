// `PortaRedeSegredo` real do Telegram (Fase 20, T-20.18): a ÚNICA rota de rede do bot, sobre `src/nucleo/rede/cliente-http` (o único módulo com sockets).
// Garantias (cada uma tem teste em `alertas-rede.test.ts` contra o servidor Telegram FALSO):
//  - o `{token}` do caminho é substituído AQUI DENTRO; o cliente de rede usado é uma instância própria SEM `log` (o cliente comum registra o caminho
//    sem query e, com o token no caminho, isso vazaria): caminho, corpo e cabeçalhos nunca são registrados;
//  - host fixo `api.telegram.org`, https, sem proxy implícito, sem redirecionamento para outro host, teto de 1 MiB, template restrito a `/bot{token}/<método>`;
//  - consentimento: só emite o token de consentimento da camada de rede quando `autorizado()` (consentimento VIGENTE do canal OU clique do usuário em curso);
//  - aborto REAL do socket pelo `AbortSignal` (inclusive antes dos cabeçalhos, no long polling);
//  - erros sem caminho, sem corpo e sem cabeçalho (a mensagem original do erro de rede nunca sobe).
// Base de teste (servidor falso em loopback) só com `NODE_ENV=test` + variável do produto: em produção é impossível apontar para outro host.
import { PRODUTO, variavelDeAmbiente } from "../nucleo/produto";
import { criarClienteRede, criarRegistroConsentimento, normalizarHost, RedeErro, type ClienteRede, type RegistroConsentimento } from "../nucleo/rede";
import type { PedidoSegredo, PortaRedeSegredo, RespostaSegredo } from "../nucleo/telegram/portas";

export const HOST_API_TELEGRAM = "api.telegram.org";
const TEMPLATE_VALIDO = /^\/bot\{token\}\/[A-Za-z]{3,40}$/;
const SEGREDO_VALIDO = /^[A-Za-z0-9:_-]{10,200}$/;
const TETO_BYTES = 1024 * 1024;

export interface BaseDeTeste {
  host: string;
  porta: number;
}

/** `<PRODUTO>_TELEGRAM_BASE=http://127.0.0.1:PORTA`, aceito SÓ com `NODE_ENV=test` e SÓ em loopback. */
export function baseDeTeste(env: NodeJS.ProcessEnv = process.env): BaseDeTeste | null {
  if (env["NODE_ENV"] !== "test") return null;
  const bruto = env[variavelDeAmbiente("TELEGRAM_BASE")];
  if (typeof bruto !== "string" || bruto === "") return null;
  try {
    const u = new URL(bruto);
    const host = normalizarHost(u.hostname);
    if (u.protocol !== "http:" || !(host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1")) return null;
    const porta = Number(u.port);
    return Number.isInteger(porta) && porta >= 1 && porta <= 65535 ? { host: host === "[::1]" ? "::1" : host, porta } : null;
  } catch {
    return null;
  }
}

export interface DepsRedeTelegram {
  /** registro de consentimento compartilhado do app (o mesmo do OpenRouter/decisor). */
  consentimento?: RegistroConsentimento;
  /** consentimento VIGENTE do canal OU clique do usuário em curso. Sem isso, nenhuma chamada abre socket. */
  autorizado: () => boolean;
  /** remove valores do cofre de mensagens nativas (defesa em profundidade; o cliente não registra nada). */
  scrub?: (t: string) => string;
  env?: NodeJS.ProcessEnv;
  /** só testes: cliente de rede alternativo. */
  cliente?: ClienteRede;
}

export interface RedeTelegram extends PortaRedeSegredo {
  /** `host`/`porta` do servidor falso, ou `null` em produção. */
  baseTeste: BaseDeTeste | null;
  /** nº de requisições em andamento (prova de "0 sockets" no pânico). */
  emVoo(): number;
}

const abortado = (): DOMException => new DOMException("abortado", "AbortError");
const foiAbortado = (s: AbortSignal | undefined): boolean => s?.aborted === true;

export function criarRedeTelegram(d: DepsRedeTelegram): RedeTelegram {
  const base = baseDeTeste(d.env);
  const consentimento = d.consentimento ?? criarRegistroConsentimento();
  // instância PRÓPRIA do cliente: sem `log` (o caminho tem o token), sem proxy implícito (AB-19), loopback só no modo de teste
  const cliente =
    d.cliente ??
    criarClienteRede({
      consentimento,
      resolverProxy: () => null,
      ...(base === null ? {} : { permitirLoopbackHttp: true }),
      ...(d.scrub === undefined ? {} : { scrub: d.scrub }),
    });
  let emVoo = 0;

  function validar(p: PedidoSegredo): { host: string; porta: number | undefined; caminho: string } {
    const host = normalizarHost(p.host);
    const ehTeste = base !== null && host === base.host;
    if (host !== HOST_API_TELEGRAM && !ehTeste) throw new RedeErro("host_nao_permitido", host);
    if (ehTeste && p.porta !== undefined && p.porta !== base.porta) throw new RedeErro("requisicao_invalida", host);
    if (!ehTeste && p.porta !== undefined && p.porta !== 443) throw new RedeErro("requisicao_invalida", host);
    if (!TEMPLATE_VALIDO.test(p.caminho_template)) throw new RedeErro("requisicao_invalida", host);
    const token = p.segredos["token"];
    if (typeof token !== "string" || !SEGREDO_VALIDO.test(token)) throw new RedeErro("requisicao_invalida", host);
    return { host, porta: ehTeste ? base.porta : undefined, caminho: p.caminho_template.replace("{token}", token) };
  }

  return {
    baseTeste: base,
    emVoo: () => emVoo,
    async requisitar(p: PedidoSegredo): Promise<RespostaSegredo> {
      if (foiAbortado(p.sinal)) throw abortado();
      const v = validar(p);
      if (!d.autorizado()) throw new RedeErro("consent_required", v.host);
      consentimento.permitirHost(v.host);
      emVoo++;
      try {
        const tk = consentimento.conceder(v.host, { validade_ms: 15_000, usos: 1 });
        const resp = await cliente.stream({
          host: v.host,
          caminho: v.caminho,
          metodo: p.metodo,
          ...(p.corpo === undefined ? {} : { corpo: p.corpo }),
          ...(p.cabecalhos === undefined ? {} : { cabecalhos: p.cabecalhos }),
          tokenDeConsentimento: tk,
          timeout_ms: p.timeout_ms,
          ocioso_ms: p.timeout_ms,
          max_bytes: Math.min(p.max_bytes, TETO_BYTES),
          ...(v.porta === undefined ? {} : { porta: v.porta }),
          ...(p.sinal === undefined ? {} : { sinal: p.sinal }),
        });
        const partes: Buffer[] = [];
        for await (const parte of resp.corpo) partes.push(parte);
        return { status: resp.status, texto: Buffer.concat(partes).toString("utf8"), cabecalhos: resp.cabecalhos };
      } catch (e) {
        if (foiAbortado(p.sinal)) throw abortado();
        // só o CÓDIGO nominal da camada de rede sobe: nunca a mensagem nativa (pode ter o caminho com o token)
        throw new Error(`rede: ${e instanceof RedeErro ? e.codigo : "falha"}`);
      } finally {
        emVoo--;
      }
    },
  };
}

export const NOME_VARIAVEL_BASE = `${PRODUTO.prefixoEnv}TELEGRAM_BASE`;

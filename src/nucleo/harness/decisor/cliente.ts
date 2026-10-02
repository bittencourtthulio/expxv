// Decisor externo (JEV) — adaptador GENÉRICO (P-16): URL https + nome do cabeçalho da chave + esquema tipado + id do modelo, para
// chamada DIRETA (`jev_direto`/`openai_compat`) e via OpenRouter (`jev_openrouter`). DESLIGADO por padrão.
// Garantias: só classifica entre opções FECHADAS (resposta validada por esquema; qualquer outra coisa vira fallback); nunca decide conta
// nem troca; toda chamada passa por `nucleo/rede` (consentimento por host + token); timeout curto; circuit breaker de 5 min;
// a chave vem do cofre e nunca aparece em log, erro, Decisão ou evento; custo por decisão nunca é 0 por omissão.
import type { ConfigDecisor, Decisao, DecisaoEntrada, CustoOrigem, PropositoDecisao, ResultadoTesteDecisor } from "../../../compartilhado/harness";
import { RedeErro, type ClienteRede } from "../../rede";
import { criarBreaker, type Breaker, type MotivoBreaker } from "./breaker";
import { lerResposta, montarCorpo, type OpcaoFechada, type UsoModelo } from "./formatos";
import { hashResumo, resumirParaDecisor } from "./resumo";
import type { ResultadoRegra } from "./regras";

export const HOST_OPENROUTER = "openrouter.ai";
const CAMINHO_OPENROUTER = "/api/v1/chat/completions";
const TIMEOUT_MAX_MS = 10_000;
const MAX_RESPOSTA_BYTES = 64 * 1024;

export type MotivoFalhaDecisor =
  | "desabilitado"
  | "sem_consentimento"
  | "uso_desligado"
  | "breaker_aberto"
  | "chave_ausente"
  | MotivoBreaker;

export class DecisorErro extends Error {
  constructor(readonly motivo: MotivoFalhaDecisor) {
    super(`decisor: ${motivo}`);
    this.name = "DecisorErro";
  }
}

export interface PedidoAsk {
  kind: string;
  purpose?: string;
  /** já redigido (`resumirParaDecisor`): é o que sai da máquina. */
  question: string;
  options: OpcaoFechada[];
}
export interface RespostaAsk {
  probs: Record<string, number>;
  choice: string;
  confidence: number;
  latency_ms: number;
  cost_usd: number | null;
  custo_origem: CustoOrigem;
  raw_model: string | null;
}

export interface DepsDecisor {
  config: () => ConfigDecisor;
  rede: ClienteRede;
  /** chave do cofre (uso imediato). Lance qualquer erro se ausente/bloqueado: vira `chave_ausente` sem repassar a mensagem. */
  obterChave: (cfg: ConfigDecisor) => Promise<string>;
  /** token do consentimento GRAVADO (permanente) do host, emitido pelo main. */
  tokenDeConsentimento: (host: string) => string;
  breaker?: Breaker;
  /** tabela de preços do modelo (OpenRouter), USD por milhão de tokens. */
  precoModelo?: (modelo: string) => { entrada_por_mtok: number | null; saida_por_mtok: number | null } | null;
  gravarDecisao?: (d: DecisaoEntrada) => Pick<Decisao, "id">;
  /** consultas do dia passaram de `alerta_diario` (não bloqueia). */
  aoAlertar?: (info: { consultas_hoje: number; alerta_diario: number }) => void;
  /** breaker abriu: UI mostra "decisor pausado até…". */
  aoPausar?: (info: { ate: string; motivo: string }) => void;
  agora?: () => number;
}

export interface PedidoDecisao {
  proposito: PropositoDecisao;
  usar_para: keyof ConfigDecisor["usar_para"];
  kind: string;
  /** texto bruto do usuário: só o RESUMO redigido sai da máquina. */
  texto: string;
  opcoes: OpcaoFechada[];
  /** decisão determinística (sempre existe; é o fallback). */
  regra: ResultadoRegra;
  workspace_id?: string | null;
  mission_id?: string | null;
  pane_id?: string | null;
  scrub?: (t: string) => string;
}
export interface ResultadoDecisao {
  escolhida: string;
  confianca: number;
  fonte: "decisor" | "regra" | "fallback";
  probs: Record<string, number>;
  decisao_id: string | null;
  latencia_ms: number | null;
  custo_usd: number | null;
  custo_origem: CustoOrigem | null;
  motivo_fallback: MotivoFalhaDecisor | "confianca_baixa" | null;
}

export interface Decisor {
  /** NUNCA lança: decisor desligado/sem consentimento/falha ⇒ regra (`fonte: regra|fallback`), sem erro ao usuário. */
  decidir(p: PedidoDecisao): Promise<ResultadoDecisao>;
  /** chamada de baixo nível; lança `DecisorErro`. */
  ask(p: PedidoAsk, op?: { token?: string; chave?: string; config?: ConfigDecisor; ignorarBreaker?: boolean }): Promise<RespostaAsk>;
  /** botão "testar": uma chamada; com `chave` usa o valor uma vez (não grava). Exige consentimento no host (token do clique). */
  testar(op: { chave?: string; token: string; config?: ConfigDecisor }): Promise<ResultadoTesteDecisor>;
  estado(): { habilitado: boolean; breaker_aberto: boolean; pausado_ate: string | null; consultas_hoje: number };
}

export interface Destino {
  host: string;
  caminho: string;
  porta?: number;
}

/** Destino da chamada. `null` = configuração incompleta. */
export function destinoDoDecisor(cfg: ConfigDecisor): Destino | null {
  if (cfg.modo === "jev_openrouter") return { host: HOST_OPENROUTER, caminho: CAMINHO_OPENROUTER };
  if (cfg.endpoint === null) return null;
  try {
    const u = new URL(cfg.endpoint);
    if (u.protocol !== "https:" || u.username !== "" || u.password !== "") return null;
    return { host: u.hostname.toLowerCase(), caminho: `${u.pathname}${u.search}`, ...(u.port === "" ? {} : { porta: Number(u.port) }) };
  } catch {
    return null;
  }
}

/** O consentimento gravado casa com o modo e com o host de destino? */
export function consentimentoValido(cfg: ConfigDecisor): boolean {
  const d = destinoDoDecisor(cfg);
  return d !== null && cfg.consentimento !== null && cfg.consentimento.modo === cfg.modo && cfg.consentimento.host.toLowerCase() === d.host;
}

/** Para o manipulador de `harness:decisor_gravar`: ligar sem consentimento válido é erro. */
export function exigirConsentimentoDecisor(cfg: Pick<ConfigDecisor, "habilitado" | "modo" | "endpoint" | "consentimento">): void {
  if (!cfg.habilitado) return;
  if (!consentimentoValido(cfg as ConfigDecisor)) throw new DecisorErro("sem_consentimento");
}

function custoDe(uso: UsoModelo, modelo: string | null, cfg: ConfigDecisor, deps: DepsDecisor): { custo: number | null; origem: CustoOrigem } {
  if (uso.cost !== null) return { custo: uso.cost, origem: "resposta" };
  if (modelo !== null && deps.precoModelo !== undefined && uso.prompt_tokens !== null && uso.completion_tokens !== null) {
    const preco = deps.precoModelo(modelo);
    if (preco !== null && preco.entrada_por_mtok !== null && preco.saida_por_mtok !== null) {
      return { custo: (uso.prompt_tokens * preco.entrada_por_mtok + uso.completion_tokens * preco.saida_por_mtok) / 1_000_000, origem: "tabela" };
    }
  }
  if (cfg.custo_por_decisao_usd !== null) return { custo: cfg.custo_por_decisao_usd, origem: "informado" };
  return { custo: null, origem: "desconhecido" };
}

const dia = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function criarDecisor(deps: DepsDecisor): Decisor {
  const agora = deps.agora ?? Date.now;
  const breaker = deps.breaker ?? criarBreaker({ agora });
  let diaAtual = dia(agora());
  let consultasHoje = 0;
  let alertado = false;

  function contar(cfg: ConfigDecisor): void {
    const d = dia(agora());
    if (d !== diaAtual) {
      diaAtual = d;
      consultasHoje = 0;
      alertado = false;
    }
    consultasHoje += 1;
    if (!alertado && consultasHoje >= cfg.alerta_diario) {
      alertado = true;
      deps.aoAlertar?.({ consultas_hoje: consultasHoje, alerta_diario: cfg.alerta_diario });
    }
  }

  function falhar(m: MotivoBreaker): never {
    const antes = breaker.estado().aberto;
    const e = breaker.falha(m);
    if (e.aberto && !antes && e.ate !== null) deps.aoPausar?.({ ate: new Date(e.ate).toISOString(), motivo: m });
    throw new DecisorErro(m);
  }

  async function ask(p: PedidoAsk, op: { token?: string; chave?: string; config?: ConfigDecisor; ignorarBreaker?: boolean } = {}): Promise<RespostaAsk> {
    const cfg = op.config ?? deps.config();
    const testando = op.config !== undefined;
    if (!cfg.habilitado && !testando) throw new DecisorErro("desabilitado");
    if (!consentimentoValido(cfg)) throw new DecisorErro("sem_consentimento");
    if (op.ignorarBreaker !== true && !breaker.permitir()) throw new DecisorErro("breaker_aberto");
    const destino = destinoDoDecisor(cfg) as Destino;
    let chave: string;
    try {
      chave = op.chave ?? (await deps.obterChave(cfg));
    } catch {
      throw new DecisorErro("chave_ausente");
    }
    const token = op.token ?? deps.tokenDeConsentimento(destino.host);
    const timeout = Math.min(Math.max(cfg.timeout_ms, 200), TIMEOUT_MAX_MS);
    const formato = cfg.modo === "jev_openrouter" ? "openai_chat" : cfg.formato;
    const corpo = montarCorpo(formato, { ...p, modelo: cfg.modelo });
    const ids = p.options.map((o) => o.id);
    const cabecalhos = { "content-type": "application/json", accept: "application/json", [cfg.cabecalho_chave]: `${cfg.prefixo_chave ?? ""}${chave}` };
    const inicio = performance.now();
    for (let tentativa = 0; ; tentativa++) {
      let status: number;
      let texto: string;
      try {
        const r = await deps.rede.requisitar({
          host: destino.host,
          caminho: destino.caminho,
          metodo: "POST",
          cabecalhos,
          corpo,
          tokenDeConsentimento: token,
          timeout_ms: timeout,
          max_bytes: MAX_RESPOSTA_BYTES,
          ...(destino.porta === undefined ? {} : { porta: destino.porta }),
        });
        status = r.status;
        texto = r.texto();
      } catch (e) {
        if (e instanceof RedeErro && (e.codigo === "consent_required" || e.codigo === "host_nao_permitido")) throw new DecisorErro("sem_consentimento");
        if (op.ignorarBreaker === true) throw new DecisorErro(e instanceof RedeErro && e.codigo === "timeout" ? "timeout" : "rede");
        return falhar(e instanceof RedeErro && e.codigo === "timeout" ? "timeout" : "rede");
      }
      if (status < 200 || status >= 300) {
        const m: MotivoBreaker = status === 402 ? "http_402" : status === 429 ? "http_429" : status >= 500 ? "http_5xx" : "http_4xx";
        if (op.ignorarBreaker === true) throw new DecisorErro(m);
        return falhar(m);
      }
      const lido = lerResposta(formato, texto, ids);
      if (!lido.ok) {
        if (lido.motivo === "json_invalido" && tentativa === 0) continue; // 1 retry só em JSON inválido
        if (op.ignorarBreaker === true) throw new DecisorErro(lido.motivo);
        return falhar(lido.motivo);
      }
      let escolha = ids[0] as string;
      for (const id of ids) if ((lido.probs[id] as number) > (lido.probs[escolha] as number)) escolha = id;
      if (op.ignorarBreaker !== true) breaker.sucesso();
      contar(cfg);
      const { custo, origem } = custoDe(lido.uso, lido.modelo ?? cfg.modelo, cfg, deps);
      return {
        probs: lido.probs,
        choice: escolha,
        confidence: lido.probs[escolha] as number,
        latency_ms: Math.round(performance.now() - inicio),
        cost_usd: custo,
        custo_origem: origem,
        raw_model: lido.modelo,
      };
    }
  }

  async function decidir(p: PedidoDecisao): Promise<ResultadoDecisao> {
    const cfg = deps.config();
    const regra = p.regra;
    const base = { probs: regra.probs, latencia_ms: null, custo_usd: null, custo_origem: null as CustoOrigem | null };
    const registrar = (r: ResultadoDecisao, extra: { resumo: string | null; divergiu: boolean; decisor: Decisao["decisor"]; recibo: string }): ResultadoDecisao => {
      if (deps.gravarDecisao === undefined) return r;
      try {
        const d = deps.gravarDecisao({
          proposito: p.proposito,
          workspace_id: p.workspace_id ?? null,
          mission_id: p.mission_id ?? null,
          pane_id: p.pane_id ?? null,
          tipo: "choice",
          opcoes: p.opcoes.map((o) => o.id),
          probs: r.probs,
          escolhida: r.escolhida,
          confianca: r.confianca,
          fonte: r.fonte,
          escolha_regra: regra.escolhida,
          divergiu: extra.divergiu,
          latencia_ms: r.latencia_ms,
          custo_usd: r.custo_usd,
          custo_origem: r.custo_origem,
          decisor: extra.decisor,
          resumo_enviado: extra.resumo,
          resumo_hash: extra.resumo === null ? null : hashResumo(extra.resumo),
          skills_aplicadas: false,
          recibo: extra.recibo,
        });
        return { ...r, decisao_id: d.id };
      } catch {
        return r; // a escolha não depende de conseguir registrá-la
      }
    };
    const soRegra = (motivo: MotivoFalhaDecisor | null, fonte: "regra" | "fallback", extra?: Partial<{ resumo: string | null; divergiu: boolean; decisor: Decisao["decisor"] }>): ResultadoDecisao =>
      registrar(
        { escolhida: regra.escolhida, confianca: regra.confianca, fonte, ...base, decisao_id: null, motivo_fallback: motivo },
        {
          resumo: extra?.resumo ?? null,
          divergiu: extra?.divergiu ?? false,
          decisor: extra?.decisor ?? null,
          recibo: fonte === "regra" ? `Escolhida pelas regras locais (${p.kind}): ${regra.escolhida}.` : `Decisor indisponível (${motivo ?? "erro"}); regras locais escolheram ${regra.escolhida}.`,
        },
      );

    if (!cfg.habilitado || !cfg.usar_para[p.usar_para]) return soRegra(null, "regra");
    if (!consentimentoValido(cfg)) return soRegra("sem_consentimento", "regra");
    if (!breaker.permitir()) return soRegra("breaker_aberto", "fallback");

    const destino = destinoDoDecisor(cfg) as Destino;
    const resumo = resumirParaDecisor(p.texto, p.scrub === undefined ? {} : { scrub: p.scrub });
    const decisorInfo = { modo: cfg.modo, host: destino.host, modelo: cfg.modelo };
    try {
      const r = await ask({ kind: p.kind, purpose: p.proposito, question: resumo, options: p.opcoes });
      const divergiu = r.choice !== regra.escolhida;
      if (r.confidence < cfg.confianca_minima) {
        const out = registrar(
          { escolhida: regra.escolhida, confianca: regra.confianca, fonte: "fallback", probs: r.probs, decisao_id: null, latencia_ms: r.latency_ms, custo_usd: r.cost_usd, custo_origem: r.custo_origem, motivo_fallback: "confianca_baixa" },
          { resumo, divergiu, decisor: decisorInfo, recibo: `Decisor sugeriu ${r.choice} com confiança ${r.confidence.toFixed(2)} (< ${cfg.confianca_minima}); regras locais escolheram ${regra.escolhida}.` },
        );
        return out;
      }
      return registrar(
        { escolhida: r.choice, confianca: r.confidence, fonte: "decisor", probs: r.probs, decisao_id: null, latencia_ms: r.latency_ms, custo_usd: r.cost_usd, custo_origem: r.custo_origem, motivo_fallback: null },
        { resumo, divergiu, decisor: decisorInfo, recibo: `Decisor escolheu ${r.choice} (confiança ${r.confidence.toFixed(2)})${divergiu ? `; as regras locais diziam ${regra.escolhida}` : ""}.` },
      );
    } catch (e) {
      const motivo = e instanceof DecisorErro ? e.motivo : "rede";
      return soRegra(motivo, "fallback", { resumo, decisor: decisorInfo });
    }
  }

  return {
    decidir,
    ask,
    async testar(op) {
      const cfg = op.config ?? deps.config();
      const inicio = performance.now();
      try {
        await ask(
          { kind: "teste", question: "teste de conexão", options: [{ id: "sim", description: "afirmativo" }, { id: "nao", description: "negativo" }] },
          { token: op.token, config: cfg, ignorarBreaker: true, ...(op.chave === undefined ? {} : { chave: op.chave }) },
        );
        return { ok: true, latencia_ms: Math.round(performance.now() - inicio) };
      } catch (e) {
        return { ok: false, latencia_ms: null, motivo: e instanceof DecisorErro ? e.motivo : "rede" };
      }
    },
    estado() {
      const b = breaker.estado();
      return { habilitado: deps.config().habilitado, breaker_aberto: b.aberto, pausado_ate: b.ate === null ? null : new Date(b.ate).toISOString(), consultas_hoje: consultasHoje };
    },
  };
}

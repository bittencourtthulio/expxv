// Variáveis e segredos da Loja de MCPs sobre o COFRE (Fase 7B, T-07B.05/.18/.21). Nada de criptografia aqui:
// tudo vai para `nucleo/cofre` (nome UPPER_SNAKE `MCP_<SERVIDOR>_<VAR>`, `sensivel:true` para segredo).
// Valores NÃO secretos (ex.: SUPABASE_PROJECT_REF) também ficam no cofre, com `sensivel:false`, para haver uma
// única fonte; o valor nunca volta ao renderer (só `definida`). Erros citam o NOME, nunca o valor.

import { createHash } from "node:crypto";
import type { Cofre } from "../cofre";
import { CofreErro } from "../cofre";
import type { CatalogoCarregado } from "./catalogo";
import type { EntradaMcp, VariavelMcp } from "./esquema";
import type { ComandoLancador } from "./lancamento";

export const VALOR_MAX_VARIAVEL = 4096;

export type CodigoVariavel = "variavel_desconhecida" | "valor_vazio" | "valor_grande" | "quebra_de_linha" | "cofre_indisponivel" | "cofre_bloqueado" | "erro_cofre";

/** Subconjunto do `Cofre` que a Loja usa (facilita o falso nos testes). */
export type PortaCofre = Pick<Cofre, "existe" | "obter" | "guardar" | "listar" | "apagar">;

/** `MCP_<ID>_<VAR>` (UPPER_SNAKE, ≤ 64). Acima disso o id é cortado e recebe 6 hex de sha256(id) (colisão-resistente). */
export function nomeCofre(servidorId: string, variavel: string): string {
  const id = servidorId.toUpperCase().replace(/-/g, "_");
  const direto = `MCP_${id}_${variavel}`;
  if (direto.length <= 64) return direto;
  const h = createHash("sha256").update(servidorId).digest("hex").slice(0, 6).toUpperCase();
  const sobra = 64 - `MCP__${h}_${variavel}`.length;
  return `MCP_${id.slice(0, Math.max(1, sobra))}_${h}_${variavel}`;
}

export function validarValor(valor: unknown): CodigoVariavel | null {
  if (typeof valor !== "string" || valor.trim() === "") return "valor_vazio";
  if (valor.length > VALOR_MAX_VARIAVEL) return "valor_grande";
  if (/[\r\n\0]/.test(valor)) return "quebra_de_linha";
  return null;
}

function codigoDe(e: unknown): CodigoVariavel {
  if (e instanceof CofreErro) {
    const c = (e as CofreErro & { codigo?: string }).codigo;
    if (c === "cofre_indisponivel") return "cofre_indisponivel";
    if (c === "cofre_bloqueado") return "cofre_bloqueado";
  }
  return "erro_cofre";
}

export interface ValoresDoServidor {
  /** Segredos definidos (só para o main, uso imediato). */
  secretos: Record<string, string>;
  publicos: Record<string, string>;
}

export interface SegredosMcp {
  gravar(e: EntradaMcp, nome: string, valor: string): Promise<{ ok: true; codigo: null } | { ok: false; codigo: CodigoVariavel }>;
  existe(e: EntradaMcp, nome: string): Promise<boolean>;
  /** Nomes (declarados) com valor no cofre. */
  definidas(e: EntradaMcp): Promise<Set<string>>;
  /** SÓ main. Lê valores declarados que existem; ausente é omitido. */
  valores(e: EntradaMcp, nomes?: readonly string[]): Promise<ValoresDoServidor>;
  apagar(e: EntradaMcp, nome: string): Promise<boolean>;
  /** Apaga todas as variáveis declaradas do servidor. */
  apagarServidor(e: EntradaMcp): Promise<number>;
}

export function criarSegredosMcp(cofre: PortaCofre): SegredosMcp {
  const declarada = (e: EntradaMcp, nome: string): VariavelMcp | undefined => e.variaveis.find((v) => v.nome === nome);
  async function idDe(nomeCofreEntrada: string): Promise<string | null> {
    return (await cofre.listar()).find((x) => x.nome === nomeCofreEntrada && x.escopo === "global")?.id ?? null;
  }
  return {
    async gravar(e, nome, valor) {
      const v = declarada(e, nome);
      if (!v) return { ok: false, codigo: "variavel_desconhecida" };
      const invalido = validarValor(valor);
      if (invalido) return { ok: false, codigo: invalido };
      try {
        const nomeC = nomeCofre(e.id, nome);
        await cofre.guardar({ id: await idDe(nomeC), nome: nomeC, escopo: "global", workspace_id: null, sensivel: v.secreta, valor });
        return { ok: true, codigo: null };
      } catch (erro) { return { ok: false, codigo: codigoDe(erro) }; }
    },
    async existe(e, nome) {
      if (!declarada(e, nome)) return false;
      try { return await cofre.existe(nomeCofre(e.id, nome)); } catch { return false; }
    },
    async definidas(e) {
      const s = new Set<string>();
      for (const v of e.variaveis) { try { if (await cofre.existe(nomeCofre(e.id, v.nome))) s.add(v.nome); } catch { /* cofre indisponível: nada definido */ } }
      return s;
    },
    async valores(e, nomes) {
      const saida: ValoresDoServidor = { secretos: {}, publicos: {} };
      for (const v of e.variaveis) {
        if (nomes && !nomes.includes(v.nome)) continue;
        try {
          const nomeC = nomeCofre(e.id, v.nome);
          if (!(await cofre.existe(nomeC))) continue;
          const valor = await cofre.obter(nomeC);
          (v.secreta ? saida.secretos : saida.publicos)[v.nome] = valor;
        } catch { /* bloqueado/indisponível: tratado como não definida */ }
      }
      return saida;
    },
    async apagar(e, nome) {
      if (!declarada(e, nome)) return false;
      const id = await idDe(nomeCofre(e.id, nome));
      return id ? cofre.apagar(id) : false;
    },
    async apagarServidor(e) {
      let n = 0;
      for (const v of e.variaveis) { const id = await idDe(nomeCofre(e.id, v.nome)); if (id && (await cofre.apagar(id))) n++; }
      return n;
    },
  };
}

/**
 * Variáveis sem as quais o servidor não sobe: as `obrigatoria`, toda `{{SEGREDO:X}}` citada nos args/URL e toda
 * `{{VAR:X}}` citada na URL. `{{VAR:X}}` opcional nos args é simplesmente descartada pelo `montarComando`.
 */
export function variaveisExigidas(e: EntradaMcp): string[] {
  const nomes = new Set<string>(e.variaveis.filter((v) => v.obrigatoria).map((v) => v.nome));
  const achar = (t: string, tipos: string): void => { for (const m of t.matchAll(new RegExp(`\\{\\{(?:${tipos}):([A-Z][A-Z0-9_]{1,63})\\}\\}`, "g"))) nomes.add(m[1]!); };
  for (const a of e.args) achar(a, "SEGREDO");
  if (e.url) achar(e.url, "SEGREDO|VAR");
  const declaradas = new Set(e.variaveis.map((v) => v.nome));
  return [...nomes].filter((n) => declaradas.has(n));
}

/** Variáveis exigidas que ainda não têm valor. Vazio = configurado. */
export function variaveisFaltando(e: EntradaMcp, definidas: ReadonlySet<string>): string[] {
  return variaveisExigidas(e).filter((n) => !definidas.has(n));
}

// ---------------------------------------------------------------------------------------------------------
// Serviço da rota loopback `POST /loja/segredos` (T-07B.21), sem HTTP: o main só traduz status/corpo.

export type RespostaSegredos =
  | { status: 200; env: Record<string, string>; comando?: ComandoLancador }
  | { status: 400 | 401 | 403 | 404 | 429 | 500 | 503; erro: "bad_request" | "unauthorized" | "server_not_allowed" | "not_found" | "rate_limited" | "vault_unavailable" | "command_unavailable" };

export interface OpcoesServicoSegredos {
  segredos: SegredosMcp;
  catalogo: CatalogoCarregado;
  /** Servidores permitidos ao Pane dono do token (política resolvida); `null` = token inválido. */
  permitidosDoToken: (token: string) => ReadonlySet<string> | null;
  /**
   * Resolve o comando exato do servidor para o lançador (executável, args e ambiente por allowlist). Sem ele a resposta só tem `env`.
   * Lançar = `500 command_unavailable` (nunca com o texto do erro: pode citar caminho).
   */
  comando?: (entrada: EntradaMcp, valores: ValoresDoServidor, token: string) => ComandoLancador | Promise<ComandoLancador>;
  agora?: () => number;
  limitePorMinuto?: number;
  /**
   * Fase 7C (R-1): teto de leituras do segredo de UM servidor por Pane enquanto o app está aberto (padrão 30). O lançador lê 1× por (re)início do servidor;
   * um agente com Bash que alcançasse o token do lançador esgota o teto rápido e fica preso ao snapshot do Pane (nunca outro servidor).
   */
  limiteTotalPorServidor?: number;
}

/** Devolve só as variáveis DECLARADAS do servidor, só se ele está na política do Pane; 5 chamadas/min/Pane. */
export function criarServicoSegredos(o: OpcoesServicoSegredos): { resolver(token: string, servidor: unknown): Promise<RespostaSegredos> } {
  const agora = o.agora ?? Date.now;
  const limite = o.limitePorMinuto ?? 5;
  const janelas = new Map<string, number[]>();
  const totais = new Map<string, number>();
  const teto = o.limiteTotalPorServidor ?? 30;
  return {
    async resolver(token, servidor) {
      if (typeof token !== "string" || token === "") return { status: 401, erro: "unauthorized" };
      const permitidos = o.permitidosDoToken(token);
      if (!permitidos) return { status: 401, erro: "unauthorized" };
      const chave = createHash("sha256").update(token).digest("hex");
      const t = agora();
      const recentes = (janelas.get(chave) ?? []).filter((x) => t - x < 60_000);
      if (recentes.length >= limite) { janelas.set(chave, recentes); return { status: 429, erro: "rate_limited" }; }
      recentes.push(t);
      janelas.set(chave, recentes);
      if (typeof servidor !== "string" || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(servidor)) return { status: 400, erro: "bad_request" };
      if (!permitidos.has(servidor)) return { status: 403, erro: "server_not_allowed" };
      const chaveTotal = `${chave}:${servidor}`;
      const usados = totais.get(chaveTotal) ?? 0;
      if (usados >= teto) return { status: 429, erro: "rate_limited" };
      totais.set(chaveTotal, usados + 1);
      const entrada = o.catalogo.porId.get(servidor)?.entrada;
      if (!entrada) return { status: 404, erro: "not_found" };
      const v = await o.segredos.valores(entrada);
      const env = { ...v.publicos, ...v.secretos };
      if (!o.comando) return { status: 200, env };
      try {
        return { status: 200, env, comando: await o.comando(entrada, v, token) };
      } catch {
        return { status: 500, erro: "command_unavailable" };
      }
    },
  };
}

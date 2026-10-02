// T-14.06 · Perfil do membro e comando de lançamento. `montarComandoDoMembro` é PURO e SÍNCRONO (≤ 1 ms): nenhum
// I/O, nenhum shell. A Fase 9 entra por PORTA (`PortaResolverPerfil`); aqui só a interface e um dublê determinístico.
// O renderizador de prompt (A1, `prompt.ts`) entra por INTERFACE (`RenderizadorDoPrompt`).
import { argumentosAutomaticos, argumentosDeModelo, MODELO_PADRAO_DA_CLI, modelosDaFerramenta } from "../terminais/catalogo";
import type { Papel } from "../dominio/enums";
import {
  CLI_AUTO,
  CLIS_CATALOGO,
  CLIS_COM_INTAKE,
  PAPEL_INTERNO,
  PERMISSOES_MEMBRO,
  type Faixa,
  type Membro,
  type ModoEsforco,
  type NivelRigidez,
  type PermissaoMembro,
} from "../../compartilhado/squads";
import { CliDesconhecidaErro, esforcoParaCli, EsforcoInvalidoErro, niveisDaCli, type OpcoesEsforco, type ResultadoEsforco } from "./esforco";
import { snippetDeRigor } from "./rigor";

export { CliDesconhecidaErro, EsforcoInvalidoErro };

// ---- erros nominais ----
export class ModeloInvalidoErro extends Error {
  readonly codigo = "modelo_invalido";
  constructor(readonly modelo: string) {
    super(`Modelo inválido: ${modelo}`);
    this.name = "ModeloInvalidoErro";
  }
}
export class PermissaoInvalidaErro extends Error {
  readonly codigo = "permissao_invalida";
  constructor(readonly valor: string) {
    super(`Permissão inválida: ${valor}`);
    this.name = "PermissaoInvalidaErro";
  }
}
export class CliAutoSemResolucaoErro extends Error {
  readonly codigo = "cli_auto_sem_resolucao";
  constructor(readonly agente_id: string | null) {
    super("CLI 'auto' exige resolução de perfil (Fase 9) antes de montar o comando.");
    this.name = "CliAutoSemResolucaoErro";
  }
}
export class ExecutavelInvalidoErro extends Error {
  readonly codigo = "executavel_invalido";
  constructor() {
    super("Executável inválido (vazio ou com caractere de controle).");
    this.name = "ExecutavelInvalidoErro";
  }
}

// ---- perfil completo ----
/** `PerfilAgente` completo do membro: CLI/LLM + modelo + esforço + faixa de equivalência + conta preferida + permissão. */
export interface PerfilCompleto {
  agente_id: string | null;
  /** id de CLI do catálogo ou `auto` (a faixa escolhe; Fase 9). */
  cli: string;
  modelo: string | null;
  esforco: string | null;
  faixa: Faixa;
  /** conta preferida (opcional); a Fase 9 decide se usa. */
  conta_preferida: string | null;
  /** `null` = herda da Missão/workspace (D-232). */
  permissao: PermissaoMembro | null;
}

/** Tabela mínima (sem Fase 9): claude opus→topo, sonnet→alto, haiku→rapido; demais `medio`. */
export function faixaDe(cli: string, modelo: string | null): Faixa {
  if (cli !== "claude" || modelo === null) return "medio";
  const m = modelo.toLowerCase();
  if (m.includes("opus")) return "topo";
  if (m.includes("sonnet")) return "alto";
  if (m.includes("haiku")) return "rapido";
  return "medio";
}

/**
 * Cadeado do wizard de Missão: impõe UMA CLI a todos os membros, só para esta Missão (a squad em disco não muda). Papel e faixa são
 * preservados; o modelo que não existe na CLI nova e o esforço fora dos níveis dela voltam ao padrão (`null`). O orquestrador só
 * troca para CLI com contrato de intake; senão mantém a dele. CLI de formato inválido é ignorada. Puro; não muta o membro.
 */
export function comCadeado(membro: Membro, cli: string | null | undefined): Membro {
  if (cli === null || cli === undefined || cli === membro.perfil.cli) return membro;
  if (!/^(?:auto|[a-z][a-z0-9-]{0,31})$/.test(cli)) return membro;
  if (membro.papel === "orchestrator" && !(CLIS_COM_INTAKE as readonly string[]).includes(cli)) return membro;
  if (cli === CLI_AUTO) return { ...membro, perfil: { ...membro.perfil, cli, modelo: null, esforco: null } };
  const modeloOk = membro.perfil.modelo !== null && modelosDaFerramenta(cli).some((m) => m.modelo === membro.perfil.modelo);
  let esforcoOk = false;
  if (membro.perfil.esforco !== null) {
    try {
      esforcoOk = niveisDaCli(cli).niveis.includes(membro.perfil.esforco);
    } catch {
      esforcoOk = false;
    }
  }
  return { ...membro, perfil: { ...membro.perfil, cli, modelo: modeloOk ? membro.perfil.modelo : null, esforco: esforcoOk ? membro.perfil.esforco : null } };
}

export function paraPerfilCompleto(membro: Membro, agenteId: string | null = null, contaPreferida: string | null = null): PerfilCompleto {
  const { cli, modelo, esforco, faixa } = membro.perfil;
  return { agente_id: agenteId, cli, modelo, esforco, faixa, conta_preferida: contaPreferida, permissao: membro.permissao };
}

// ---- porta da Fase 9 ----
export interface ContextoResolucao {
  workspace_id: string;
  papel: Papel;
  mission_id: string | null;
  excluir?: string[];
}
export interface ResolucaoPerfil {
  conta: string | null;
  modelo: string | null;
  cli: string;
  motivo: string;
  /** variáveis de ambiente da conta escolhida (ex.: perfil/HOME da CLI); só chaves, nunca segredo em log. */
  ambiente?: Record<string, string>;
}
/** A implementação real vem da Fase 9 (`resolverPerfil`/`pickAccount`); assinatura estável para a troca sem mudar chamadores. */
export interface PortaResolverPerfil {
  resolverPerfil(perfil: PerfilCompleto, contexto: ContextoResolucao): Promise<ResolucaoPerfil>;
}

/** Dublê determinístico: respeita o perfil (CLI `auto` → `fallbackCli`), conta preferida ou nenhuma, sem I/O. */
export function resolverPerfilDireto(opcoes: { fallbackCli?: string } = {}): PortaResolverPerfil {
  const fallback = opcoes.fallbackCli ?? "claude";
  return {
    resolverPerfil(perfil) {
      const auto = perfil.cli === CLI_AUTO;
      return Promise.resolve({
        cli: auto ? fallback : perfil.cli,
        modelo: auto ? null : perfil.modelo,
        conta: perfil.conta_preferida,
        motivo: auto ? `cli auto resolvida para ${fallback} (padrão direto)` : "perfil do membro (resolução direta)",
      });
    },
  };
}

// ---- renderizador de prompt (interface; implementação na A1) ----
export interface EntradaRenderizacao {
  membro: Membro;
  squad_slug: string;
  /** texto de rigor (já com o piso) para `{{rigor}}`. */
  rigor: string;
  /** instrução de esforço quando `indicativo`; `null` caso contrário. */
  esforco_indicativo: string | null;
  objetivo: string | null;
}
export interface RenderizadorDoPrompt {
  renderizar(entrada: EntradaRenderizacao): string;
}

// ---- comando ----
export const ORDEM_PERMISSAO: Readonly<Record<PermissaoMembro, number>> = { seguro: 0, equilibrado: 1, automatico: 2 };

/** O menor entre membro/Missão e o teto do workspace (D-232): `membro ?? missão ?? workspace`, limitado pelo workspace. */
export function permissaoEfetiva(membro: PermissaoMembro | null, missao: PermissaoMembro | null, workspace: PermissaoMembro): PermissaoMembro {
  for (const v of [membro, missao, workspace]) if (v !== null && !(PERMISSOES_MEMBRO as readonly string[]).includes(v)) throw new PermissaoInvalidaErro(String(v));
  const pedida = membro ?? missao ?? workspace;
  return ORDEM_PERMISSAO[pedida] <= ORDEM_PERMISSAO[workspace] ? pedida : workspace;
}

export interface ContextoComando {
  squad_slug: string;
  /** caminho do executável detectado da CLI (um único argv0; nunca passa por shell). */
  executavel: string;
  permissao_workspace: PermissaoMembro;
  permissao_missao?: PermissaoMembro | null;
  rigidez: NivelRigidez;
  renderizador: RenderizadorDoPrompt;
  objetivo?: string | null;
  workspace_id?: string;
  mission_id?: string | null;
  /** saída de `PortaResolverPerfil` (já resolvida); ausente = vale o perfil do membro. */
  resolucao?: ResolucaoPerfil | null;
  agente_id?: string | null;
  conta_preferida?: string | null;
  esforco?: OpcoesEsforco;
}

export interface ComandoMembro {
  ferramenta: string;
  executavel: string;
  /** argv SEPARADO, sem shell: `--model`, esforço (flag/config) e flags automáticas. O prompt NÃO está aqui. */
  argumentos: string[];
  /** ambiente extra (conta resolvida etc.). */
  ambiente: Record<string, string>;
  modelo: string | null;
  esforco: { modo: ModoEsforco; nivel: string | null; indicativo: boolean; confiavel: boolean; texto: string | null; aviso: string | null };
  /** prompt final já renderizado (vai pelo canal invisível da CLI, escolhido por `piloto.ts`). */
  prompt: string;
  permissao_efetiva: PermissaoMembro;
  perfil_efetivo: { cli: string; modelo: string | null; esforco: string | null; esforco_modo: ModoEsforco; conta_id: string | null; faixa: Faixa; avisos: string[] };
  motivo: string;
}

const MODELO_FORMATO = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,99}$/;
const CONTROLE = /[\0\r\n]/;
const ehCliCatalogo = (c: string): boolean => (CLIS_CATALOGO as readonly string[]).includes(c);

/**
 * Monta o comando de lançamento do membro. Erros nominais: CLI desconhecida, modelo malformado, esforço inválido,
 * permissão inválida, CLI `auto` sem resolução. O esforço sem mecanismo real vira `indicativo` (marcado) e a instrução
 * entra no prompt via renderizador. `automatico` só vira flag quando o workspace também permite.
 */
export function montarComandoDoMembro(membro: Membro, ctx: ContextoComando): ComandoMembro {
  if (ctx.executavel.length === 0 || CONTROLE.test(ctx.executavel)) throw new ExecutavelInvalidoErro();
  const agenteId = ctx.agente_id ?? null;
  const base = paraPerfilCompleto(membro, agenteId, ctx.conta_preferida ?? null);
  const r = ctx.resolucao ?? null;
  const cli = r?.cli ?? base.cli;
  const modelo = r === null ? base.modelo : r.modelo;
  if (cli === CLI_AUTO) throw new CliAutoSemResolucaoErro(agenteId);
  if (!ehCliCatalogo(cli)) throw new CliDesconhecidaErro(cli);
  if (modelo !== null && modelo !== MODELO_PADRAO_DA_CLI && !MODELO_FORMATO.test(modelo)) throw new ModeloInvalidoErro(modelo);

  const avisos: string[] = [];
  const argModelo = argumentosDeModelo(cli, modelo);
  if (modelo !== null && modelo !== MODELO_PADRAO_DA_CLI && argModelo.length === 0) avisos.push(`${cli} não aceita --model; usando o modelo padrão da CLI`);

  let ef: ResultadoEsforco | null = null;
  if (base.esforco !== null) {
    ef = esforcoParaCli(cli, base.esforco, ctx.esforco);
    if (ef.aviso !== undefined) avisos.push(ef.aviso);
  }
  const permissao = permissaoEfetiva(membro.permissao, ctx.permissao_missao ?? null, ctx.permissao_workspace);
  // `equilibrado` não tem flag de CLI: só `automatico` (e só se o workspace também for automático) abre as flags.
  const automaticos = permissao === "automatico" ? argumentosAutomaticos(cli as Parameters<typeof argumentosAutomaticos>[0], "automatico") : [];

  const modo: ModoEsforco = ef === null ? "nenhum" : ef.tipo;
  const argumentos = [...argModelo, ...(ef?.argv ?? []), ...automaticos];
  const textoEsforco = ef?.tipo === "indicativo" ? (ef.texto ?? null) : null;
  const prompt = ctx.renderizador.renderizar({ membro, squad_slug: ctx.squad_slug, rigor: snippetDeRigor(membro.rigidez ?? ctx.rigidez), esforco_indicativo: textoEsforco, objetivo: ctx.objetivo ?? null });
  const motivo = r?.motivo ?? "perfil do membro";

  return {
    ferramenta: cli,
    executavel: ctx.executavel,
    argumentos,
    ambiente: { ...(r?.ambiente ?? {}) },
    modelo: modelo === MODELO_PADRAO_DA_CLI ? null : modelo,
    esforco: { modo, nivel: ef?.nivel ?? null, indicativo: modo === "indicativo", confiavel: ef?.confiavel ?? false, texto: textoEsforco, aviso: ef?.aviso ?? null },
    prompt,
    permissao_efetiva: permissao,
    perfil_efetivo: { cli, modelo: modelo === MODELO_PADRAO_DA_CLI ? null : modelo, esforco: ef?.nivel_nativo ?? ef?.nivel ?? null, esforco_modo: modo, conta_id: r?.conta ?? null, faixa: base.faixa, avisos },
    motivo,
  };
}

/** Atalho assíncrono: chama a porta da Fase 9 e monta o comando (a montagem em si continua pura). */
export async function resolverEMontarComando(porta: PortaResolverPerfil, membro: Membro, ctx: ContextoComando & { workspace_id: string }): Promise<ComandoMembro> {
  const perfil = paraPerfilCompleto(membro, ctx.agente_id ?? null, ctx.conta_preferida ?? null);
  const resolucao = await porta.resolverPerfil(perfil, { workspace_id: ctx.workspace_id, papel: PAPEL_INTERNO[membro.papel], mission_id: ctx.mission_id ?? null });
  return montarComandoDoMembro(membro, { ...ctx, resolucao });
}

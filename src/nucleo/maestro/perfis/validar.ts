// T-16.10 · Validação dos perfis de etapa (V1..V9). PURO: erro bloqueia salvar, aviso não. Nada de rede nem de disco: o catálogo de CLIs e os
// modelos habilitados do OpenRouter entram pelo contexto. Credenciais nunca são lidas (D-52): autenticação do OpenRouter vira só aviso.
import { MODOS_EXECUCAO, type EtapaConfig, type EtapaId, type NivelRigidez } from "../../../compartilhado/maestro";
import { harnessDaCli } from "../../metodo/comandos";
import { NIVEIS_ESFORCO } from "../../squads/esforco";
import { etapaDef, etapaObrigatoria, ETAPAS, PIPELINES, type EtapaDef } from "../etapas/catalogo";

export type CodigoAchado = "V1" | "V2" | "V3" | "V4" | "V5" | "V6" | "V7" | "V8" | "V9" | "V0";
export interface Achado {
  codigo: CodigoAchado;
  severidade: "erro" | "aviso";
  etapa_id: string;
  mensagem: string;
  /** outras etapas envolvidas (V1: o par implementador/avaliador). */
  relacionadas?: string[];
}

export interface InfoDaCli {
  /** modelos conhecidos da CLI (`model_list`); `null` = não se sabe (não valida). */
  modelos: readonly string[] | null;
  /** níveis de esforço da CLI e o modo (`indicativo` = instrução no prompt). */
  niveis_esforco: readonly string[] | null;
  modo_esforco: "flag" | "config" | "indicativo" | "nenhum" | null;
}
export interface ContextoValidacao {
  nivel?: NivelRigidez;
  cli(cli: string): InfoDaCli | null;
  /** provedor da CLI (anthropic, openai…); `null` = desconhecido. */
  provedorDaCli(cli: string): string | null;
  /** quantos provedores estão habilitados (V1 em nível ≥ 4). */
  provedoresHabilitados?: number;
  /** ids OpenRouter habilitados no cache. */
  modelosOpenRouter?: ReadonlySet<string>;
  /** agentes de squad existentes (agente_id inexistente vira aviso). */
  agentesExistentes?: ReadonlySet<string>;
}

const MODELO_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,99}$/;
const ESFORCO_VALIDO = /^[a-z][a-z0-9_-]{0,19}$/;
const AVALIADORES: readonly EtapaId[] = ["runx.e4", "sprintx.f5", "mergex.atencao", "stackx.check", "designx.audit"];
const IMPLEMENTADORES: readonly EtapaId[] = ["runx.e3", "sprintx.f6"];
const CLIS_OPENROUTER_FORA_DO_METODO: readonly string[] = ["aider", "codex", "goose", "kilo", "cline"];
const AGRUPAVEIS = new Set(["investigador", "planejador", "implementador"]);

const achado = (codigo: CodigoAchado, severidade: Achado["severidade"], etapa_id: string, mensagem: string, relacionadas?: string[]): Achado => ({ codigo, severidade, etapa_id, mensagem, ...(relacionadas === undefined ? {} : { relacionadas }) });
const ehAuto = (cli: string): boolean => cli === "auto";

/** V2..V9 de UMA etapa (sem o cruzamento V1/V9, que precisa do conjunto). */
export function validarPerfilDeEtapa(c: EtapaConfig, ctx: ContextoValidacao): Achado[] {
  const saida: Achado[] = [];
  const def = etapaDef(c.etapa_id);
  if (def === null) return [achado("V0", "erro", c.etapa_id, "Etapa desconhecida.")];
  const p = c.perfil;
  if (!(MODOS_EXECUCAO as readonly string[]).includes(c.modo_execucao)) saida.push(achado("V0", "erro", def.id, "Modo de execução inválido."));

  // V6: etapas humanas não têm perfil
  if (def.humano) return [achado("V6", "erro", def.id, "Esta etapa é humana: não tem perfil nem comando; o Maestro só avisa e leva ao arquivo.")];

  // V5: obrigatórias não podem ser desligadas
  if (etapaObrigatoria(def.id) && c.modo_execucao === "desligada") saida.push(achado("V5", "erro", def.id, "Etapa de piso: não pode ser desligada."));

  // V2: etapa que dispara o método exige CLI que executa o método
  const disparaMetodo = def.comando !== null;
  if (disparaMetodo && !ehAuto(p.cli) && harnessDaCli(p.cli) === null) {
    saida.push(achado("V2", "erro", def.id, `${p.cli} não executa os comandos do método; use Claude Code ou OpenCode (ou auto).`));
  }

  // V3: modelo
  if (p.origem_modelo === "openrouter") {
    if (p.modelo === null || !MODELO_VALIDO.test(p.modelo)) saida.push(achado("V3", "erro", def.id, "Modelo OpenRouter inválido."));
    else if (ctx.modelosOpenRouter !== undefined && !ctx.modelosOpenRouter.has(p.modelo)) saida.push(achado("V3", "erro", def.id, `O modelo ${p.modelo} não está habilitado na lista do OpenRouter.`));
  } else if (p.modelo !== null && p.modelo !== "default") {
    if (!MODELO_VALIDO.test(p.modelo)) saida.push(achado("V3", "erro", def.id, "Nome de modelo inválido."));
    else if (!ehAuto(p.cli)) {
      const info = ctx.cli(p.cli);
      if (info?.modelos != null && !info.modelos.includes(p.modelo)) saida.push(achado("V3", "erro", def.id, `O modelo ${p.modelo} não existe na lista de ${p.cli}.`));
    }
  }

  // V4: esforço
  if (p.esforco !== null) {
    const info = ehAuto(p.cli) ? null : ctx.cli(p.cli);
    const neutro = (NIVEIS_ESFORCO as readonly string[]).includes(p.esforco);
    if (!ESFORCO_VALIDO.test(p.esforco)) saida.push(achado("V4", "erro", def.id, "Nível de esforço inválido."));
    else if (info?.niveis_esforco != null && !info.niveis_esforco.includes(p.esforco) && !neutro) saida.push(achado("V4", "erro", def.id, `O esforço ${p.esforco} não existe em ${p.cli}.`));
    else if (info?.modo_esforco === "indicativo" || info?.modo_esforco === "nenhum") saida.push(achado("V4", "aviso", def.id, `${p.cli} não tem flag de esforço: vale só como instrução no prompt (indicativo).`));
  }

  // V7: a skill da própria etapa precisa estar entre as permitidas
  if (def.comando !== null && !c.skills.includes(def.comando) && !c.skills.includes(def.skill)) {
    saida.push(achado("V7", "erro", def.id, `As skills permitidas precisam conter ${def.comando}: sem ela a etapa não roda.`));
  }

  // V8: OpenRouter exige CLI compatível
  if (p.origem_modelo === "openrouter") {
    if (disparaMetodo) {
      if (!ehAuto(p.cli) && p.cli !== "opencode" && p.cli !== "claude") saida.push(achado("V8", "erro", def.id, "OpenRouter em etapa do método exige OpenCode ou Claude Code (por gateway)."));
    } else if (!ehAuto(p.cli) && ![...CLIS_OPENROUTER_FORA_DO_METODO, "opencode", "claude"].includes(p.cli)) {
      saida.push(achado("V8", "erro", def.id, `${p.cli} não aceita endpoint compatível com o OpenRouter.`));
    }
    saida.push(achado("V8", "aviso", def.id, "Confirme a autenticação da CLI no OpenRouter: o ADE não lê credenciais."));
  }

  if (p.agente_id !== null && ctx.agentesExistentes !== undefined && !ctx.agentesExistentes.has(p.agente_id)) saida.push(achado("V0", "aviso", def.id, "O agente de squad indicado não existe."));
  return saida;
}

const perfilIgual = (a: EtapaConfig["perfil"], b: EtapaConfig["perfil"]): boolean => a.cli === b.cli && a.modelo === b.modelo;

/** V1 e V9 dependem do conjunto: avaliador × implementador e reuso de terminal. `porId` = configuração efetiva de cada etapa. */
function validarCruzado(porId: ReadonlyMap<string, EtapaConfig>, ctx: ContextoValidacao): Achado[] {
  const saida: Achado[] = [];
  for (const av of AVALIADORES) {
    const a = porId.get(av);
    if (a === undefined) continue;
    for (const im of IMPLEMENTADORES) {
      const i = porId.get(im);
      if (i === undefined) continue;
      if (ehAuto(a.perfil.cli) || ehAuto(i.perfil.cli)) continue; // `auto` não prova igualdade; o despacho confere de novo
      const par = [im];
      if (perfilIgual(a.perfil, i.perfil)) {
        saida.push(achado("V1", "erro", av, `O avaliador não pode ter o mesmo perfil do implementador (${im}): quem implementa não aprova.`, par));
        continue;
      }
      const pa = ctx.provedorDaCli(a.perfil.cli);
      const pi = ctx.provedorDaCli(i.perfil.cli);
      if (pa !== null && pa === pi) {
        const exige = (ctx.nivel ?? 3) >= 4 && (ctx.provedoresHabilitados ?? 1) >= 2;
        saida.push(achado("V1", exige ? "erro" : "aviso", av, exige ? `Nos níveis 4 e 5, com mais de um provedor, o avaliador precisa de provedor diferente do de ${im}.` : `O avaliador usa o mesmo provedor do implementador (${im}): prefira outro provedor.`, par));
      }
    }
  }
  // V9: reusar terminal só entre implementadores consecutivos do mesmo perfil
  for (const [id, c] of porId) {
    if (c.modo_execucao !== "reusar_terminal") continue;
    const def = etapaDef(id) as EtapaDef;
    if (!AGRUPAVEIS.has(def.tipo)) {
      saida.push(achado("V9", "erro", id, "Só planejadores, investigadores e implementadores podem reusar o terminal (o avaliador sempre abre um novo)."));
      continue;
    }
    const pipe = Object.values(PIPELINES).find((p) => p.passos.some((s) => s.etapa === id));
    const idx = pipe === undefined ? -1 : pipe.passos.findIndex((s) => s.etapa === id);
    const anterior = pipe === undefined ? undefined : [...pipe.passos.slice(0, Math.max(0, idx))].reverse().map((s) => s.etapa).find((e) => { const d = etapaDef(e) as EtapaDef; return AGRUPAVEIS.has(d.tipo) && d.condicao === null; });
    const ant = anterior === undefined ? undefined : porId.get(anterior);
    if (ant === undefined || !perfilIgual(ant.perfil, c.perfil) || ant.perfil.esforco !== c.perfil.esforco) {
      saida.push(achado("V9", "erro", id, "Reusar o terminal só vale entre etapas consecutivas com o mesmo perfil.", anterior === undefined ? [] : [anterior]));
    }
  }
  return saida;
}

/** Valida o conjunto inteiro (V1..V9). Ordem estável: por etapa do catálogo, depois os cruzados. */
export function validarConfig(configs: readonly EtapaConfig[], ctx: ContextoValidacao): Achado[] {
  const porId = new Map(configs.map((c) => [c.etapa_id, c] as const));
  const saida: Achado[] = [];
  for (const e of ETAPAS) {
    const c = porId.get(e.id);
    if (c !== undefined) saida.push(...validarPerfilDeEtapa(c, ctx));
  }
  for (const c of configs) if (etapaDef(c.etapa_id) === null) saida.push(achado("V0", "erro", c.etapa_id, "Etapa desconhecida."));
  saida.push(...validarCruzado(porId, ctx));
  return saida;
}
export const temErro = (a: readonly Achado[]): boolean => a.some((x) => x.severidade === "erro");

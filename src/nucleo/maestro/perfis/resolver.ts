// T-16.10 · Perfil de uma etapa: config do workspace → global → fábrica; `agente_id` (membro de squad) e squad do Maestro por cargo; depois a PORTA do harness
// (`resolverPerfilDeEtapa`, Fase 9) aplica conta/modelo por consumo e equivalência por faixa. Nada de banco nem rede aqui.
import type { EtapaConfig, EtapaId, PerfilEfetivo, TipoEtapa } from "../../../compartilhado/maestro";
import type { Papel } from "../../dominio/enums";
import type { PerfilCompleto } from "../../squads/perfil";
import { esforcoParaCli, niveisDaCli } from "../../squads/esforco";
import { etapaDef, type EtapaDef } from "../etapas/catalogo";
import { configDeFabrica } from "./padroes";

export type OrigemConfig = "workspace" | "global" | "fabrica" | "agente" | "squad";
export interface ConfigResolvida {
  config: EtapaConfig;
  origem: OrigemConfig;
}
/** Cargo de squad (Fase 14) por tipo de etapa: investigador→scout, planejador→orchestrator, implementador→executor, avaliador→reviewer. */
export const CARGO_POR_TIPO: Readonly<Partial<Record<TipoEtapa, "scout" | "orchestrator" | "executor" | "reviewer">>> = { investigador: "scout", planejador: "orchestrator", implementador: "executor", avaliador: "reviewer" };

export interface FontesDePerfil {
  workspace?: (etapa: EtapaId) => EtapaConfig | null;
  global?: (etapa: EtapaId) => EtapaConfig | null;
  /** perfil do membro da Fase 14 (`etapa_config.agente_id`). */
  membro?: (agente_id: string) => PerfilCompleto | null;
  /** squad do Maestro: membro por cargo. */
  squadPorCargo?: (cargo: "scout" | "orchestrator" | "executor" | "reviewer") => { agente_id: string; perfil: PerfilCompleto } | null;
}

function comPerfilDe(base: EtapaConfig, p: PerfilCompleto, agente_id: string | null): EtapaConfig {
  return { ...base, perfil: { ...base.perfil, cli: p.cli, modelo: p.modelo, esforco: p.esforco, faixa: p.faixa, agente_id } };
}

export function perfilDaEtapa(etapa: EtapaId, f: FontesDePerfil): ConfigResolvida {
  const def = etapaDef(etapa) as EtapaDef;
  const ws = f.workspace?.(etapa) ?? null;
  const gl = f.global?.(etapa) ?? null;
  const base = ws ?? gl ?? configDeFabrica(etapa);
  const origemBase: OrigemConfig = ws !== null ? "workspace" : gl !== null ? "global" : "fabrica";
  if (base.perfil.agente_id !== null && f.membro !== undefined) {
    const m = f.membro(base.perfil.agente_id);
    if (m !== null) return { config: comPerfilDe(base, m, base.perfil.agente_id), origem: "agente" };
  }
  // só a fábrica cede lugar à squad do Maestro: configuração explícita do usuário vence
  if (origemBase === "fabrica" && f.squadPorCargo !== undefined) {
    const cargo = CARGO_POR_TIPO[def.tipo];
    const s = cargo === undefined ? null : f.squadPorCargo(cargo);
    if (s !== null) return { config: comPerfilDe(base, s.perfil, s.agente_id), origem: "squad" };
  }
  return { config: base, origem: origemBase };
}

export const resumoDoPerfil = (p: { cli: string; modelo: string | null; esforco: string | null }): string => `${p.cli}·${p.modelo ?? "padrão"}·${p.esforco ?? "padrão"}`;

// ---------------------------------------------------------------- harness (Fase 9)
export interface PedidoDeResolucao {
  workspace_id: string;
  papel: Papel;
  mission_id: string | null;
  /** provedor do implementador (o avaliador exclui o dele quando houver outro viável). */
  implementador_provedor?: string | null;
  excluir?: string[];
}
export interface ResultadoDoHarness {
  ok: boolean;
  /** provedor/modelo/esforço escolhidos. */
  executor: { provider: string; cli: string | null; model: string | null; effort: string | null } | null;
  cli: string | null;
  conta_id: string | null;
  faixa: string | null;
  recibo: string;
  erro?: string | null;
}
/** Porta fina sobre `ResolvedorHarness.resolverPerfilDeEtapa` (o adaptador real fica no main). */
export interface PortaHarnessDeEtapa {
  resolverPerfilDeEtapa(skill: string, etapa: string, ctx: PedidoDeResolucao, perfil: PerfilCompleto | null): Promise<ResultadoDoHarness>;
}
export class PerfilIndisponivelErro extends Error {
  readonly codigo = "perfil_indisponivel";
  constructor(readonly etapa: string, detalhe: string) {
    super(`Sem rota para ${etapa}: ${detalhe}`);
    this.name = "PerfilIndisponivelErro";
  }
}
export const PAPEL_DA_ETAPA: Readonly<Record<TipoEtapa, Papel>> = { investigador: "explorador", planejador: "executor", implementador: "executor", avaliador: "revisor", utilitario: "executor", humano: "nenhum", consulta: "nenhum" };

/** Perfil EFETIVO (conta/modelo por consumo). Lança `PerfilIndisponivelErro` sem rota; o chamador vira `aguardando_usuario`. */
export async function resolverPerfilEfetivo(etapa: EtapaId, config: EtapaConfig, harness: PortaHarnessDeEtapa, pedido: Omit<PedidoDeResolucao, "papel">): Promise<PerfilEfetivo> {
  const def = etapaDef(etapa) as EtapaDef;
  const perfil: PerfilCompleto = { agente_id: config.perfil.agente_id, cli: config.perfil.cli, modelo: config.perfil.modelo, esforco: config.perfil.esforco, faixa: config.perfil.faixa, conta_preferida: null, permissao: null };
  const r = await harness.resolverPerfilDeEtapa(def.skill, etapa.split(".")[1] ?? etapa, { ...pedido, papel: PAPEL_DA_ETAPA[def.tipo] }, perfil);
  if (!r.ok || r.executor === null) throw new PerfilIndisponivelErro(etapa, r.recibo);
  const cli = r.cli ?? r.executor.cli ?? r.executor.provider;
  let modo: PerfilEfetivo["esforco_modo"] = null;
  const esforco = r.executor.effort ?? config.perfil.esforco;
  if (esforco !== null) {
    try {
      modo = esforcoParaCli(cli, esforco).tipo;
    } catch {
      modo = niveisDaCliSeguro(cli);
    }
  }
  return { cli, modelo: r.executor.model, esforco, esforco_modo: modo, faixa: (r.faixa as PerfilEfetivo["faixa"]) ?? config.perfil.faixa, conta_id: r.conta_id, origem_modelo: config.perfil.origem_modelo, agente_id: config.perfil.agente_id };
}
function niveisDaCliSeguro(cli: string): PerfilEfetivo["esforco_modo"] {
  try {
    return niveisDaCli(cli).modo;
  } catch {
    return "nenhum";
  }
}

// T-16.21 · Despachante: UM terminal por etapa, já com o perfil configurado (CLI + modelo + esforço). Tudo por PORTAS (spawn de Pane, harness, arquivos,
// RAG, relógio): nada de Electron nem de disco aqui. O comando é `/expx:<skill-etapa> <argumento>` (D-20), executável e argumentos SEPARADOS (o Pane nunca
// passa por shell); o texto do usuário só vira argumento NORMALIZADO (uma linha, sem controle, ≤ 1 500). Avaliador abre Pane novo `revisor`, nunca reaproveita (I5).
import type { EstadoPane, Papel } from "../dominio/enums";
import type { EtapaConfig, EtapaExec, EtapaId, PerfilEfetivo, PipelineEstado } from "../../compartilhado/maestro";
import { normalizarArgumento } from "../metodo/comandos";
import { PRODUTO } from "../produto";
import { comandoDaEtapa, etapaDef, type EtapaDef } from "./etapas/catalogo";
import { refDoTrabalho, type TrabalhoParaMaestro } from "./etapas/conclusao";
import { perfilDaEtapa, PerfilIndisponivelErro, resolverPerfilEfetivo, type FontesDePerfil, type PortaHarnessDeEtapa } from "./perfis/resolver";
import { argumentoComInstrucoes, caminhoInstrucoesRapido, gravarInstrucoes, instrucoesRapido, precisaDeInstrucoes, promptRapido, type PortaGravarTexto } from "./rigidez/instrucoes";
import type { Acao } from "./maquina";

export interface ArgsAbrirPane {
  cli: string;
  papel: Papel;
  modelo: string | null;
  esforco: string | null;
  esforco_modo: PerfilEfetivo["esforco_modo"];
  conta_id: string | null;
  /** o comando do método (ou o prompt rápido): digitado como prompt inicial, nunca por shell. */
  prompt_inicial: string;
  cwd: string | null;
  mission_id: string | null;
  origem_modelo: "cli" | "openrouter";
  /** Pane de etapa do Maestro: sem a tool `maestro_request` nem o hook (anti-loop). */
  pane_de_etapa: true;
  etapa_id: EtapaId;
  pipeline_id: string;
}
export interface PortaPanesDoMaestro {
  abrirPane(a: ArgsAbrirPane): Promise<{ pane_id: string }>;
  enviarComando(pane_id: string, texto: string): Promise<void>;
  estado(pane_id: string): EstadoPane | null;
}
export interface PortaConhecimentoPrevio {
  /** RAG antes de etapa que investiga/implementa; `null` = nada. O despachante limita a 150 ms. */
  contextoPrevio(texto: string, arquivos: string[], workspace_id: string): Promise<string | null>;
}
export interface PortasDoDespachante {
  panes: PortaPanesDoMaestro;
  harness: PortaHarnessDeEtapa;
  fontes: (workspace_id: string) => FontesDePerfil;
  arquivos: PortaGravarTexto;
  conhecimento?: PortaConhecimentoPrevio | null;
  /** diretório de trabalho da etapa (worktree do trabalho; antes de existir, a raiz do workspace). */
  cwdDoPipeline(p: PipelineEstado, trabalho: TrabalhoParaMaestro | null): string | null;
  /** escuta o eco: o hook ignora o que o ADE mesmo digitou (TTL 30 s). */
  registrarEco?(pane_id: string, texto: string): void;
  esperarMs?(ms: number): Promise<"timeout">;
}

export type ResultadoDespacho =
  | { ok: true; pane_id: string; comando: string; perfil: PerfilEfetivo; reutilizou: boolean; contexto_rel: string | null; instrucoes_rel: string | null }
  | { ok: false; motivo: "perfil_indisponivel" | "sem_trabalho" | "comando_vazio" | "avaliador_igual_ao_implementador" | "pane_nao_abriu" | "etapa_humana" | "arquivos_indisponiveis"; detalhe: string };

const RAG_MS = 150;
const falha = (motivo: Extract<ResultadoDespacho, { ok: false }>["motivo"], detalhe: string): ResultadoDespacho => ({ ok: false, motivo, detalhe });

/** Argumento-base da etapa: o pedido (texto), o id do trabalho (do DISCO) ou o alvo. */
export function argumentoBase(def: EtapaDef, pedido: string | null, trabalho: TrabalhoParaMaestro | null, trabalho_id: string | null): string | null {
  if (def.argumento === "texto") return normalizarArgumento(pedido);
  const ref = trabalho !== null ? refDoTrabalho(trabalho) : trabalho_id;
  // o raio roda ANTES de o trabalho existir no disco (runx: antes da etapa 1): sem id, o alvo é o próprio pedido
  if (def.argumento === "id") return normalizarArgumento(ref ?? (def.id === "legadox.raio" ? pedido : null));
  return normalizarArgumento(trabalho_id ?? pedido ?? ".");
}

export async function despachar(p: PipelineEstado, a: Extract<Acao, { tipo: "despachar" }>, ctx: { pedido: string | null; trabalho: TrabalhoParaMaestro | null; arquivos_do_pedido?: string[] }, portas: PortasDoDespachante): Promise<ResultadoDespacho> {
  const def = etapaDef(a.etapa_id) as EtapaDef;
  if (def.humano) return falha("etapa_humana", "ação humana: o Maestro nunca despacha");
  const cfg: EtapaConfig = perfilDaEtapa(a.etapa_id, portas.fontes(p.workspace_id)).config;
  const implementador = [...p.execs].reverse().find((e) => e.tipo === "implementador" && e.perfil !== null);

  let perfil: PerfilEfetivo;
  try {
    perfil = await resolverPerfilEfetivo(a.etapa_id, cfg, portas.harness, { workspace_id: p.workspace_id, mission_id: p.mission_id, ...(def.tipo === "avaliador" && implementador?.perfil != null ? { implementador_provedor: implementador.perfil.cli } : {}) });
  } catch (e) {
    return falha("perfil_indisponivel", e instanceof PerfilIndisponivelErro ? e.message : "sem rota para a etapa");
  }
  // V1 também ao despachar: o avaliador nunca no mesmo perfil do implementador
  if (def.tipo === "avaliador" && implementador?.perfil != null && implementador.perfil.cli === perfil.cli && implementador.perfil.modelo === perfil.modelo) {
    return falha("avaliador_igual_ao_implementador", `o avaliador (${perfil.cli}) ficaria no mesmo perfil do implementador: quem implementa não aprova`);
  }

  let argumento: string | null;
  let comando: string;
  let instrucoes_rel: string | null = null;
  let contexto_rel: string | null = null;

  if (a.etapa_id === "rapido.executar") {
    await portas.arquivos.gravar(caminhoInstrucoesRapido(p.id), instrucoesRapido(p.id));
    const pr = promptRapido(p.id, ctx.pedido ?? "");
    if (pr === null) return falha("comando_vazio", "pedido vazio");
    comando = pr;
  } else {
    argumento = argumentoBase(def, ctx.pedido, ctx.trabalho, p.trabalho_id);
    if (argumento === null) return falha(def.argumento === "id" ? "sem_trabalho" : "comando_vazio", def.argumento === "id" ? "ainda não achei o trabalho no disco para passar o id" : "argumento vazio");
    // RAG antes das etapas que investigam/implementam (≤ 150 ms; falha ou ausência não bloqueiam)
    if (portas.conhecimento != null && (def.tipo === "investigador" || def.tipo === "implementador" || def.tipo === "planejador") && (ctx.pedido ?? "") !== "") {
      try {
        const espera = (portas.esperarMs ?? ((ms: number) => new Promise<"timeout">((r) => setTimeout(() => r("timeout"), ms).unref?.())))(RAG_MS).then(() => ({ texto: null as string | null }));
        const rag = portas.conhecimento.contextoPrevio(ctx.pedido ?? "", ctx.arquivos_do_pedido ?? [], p.workspace_id).then((texto) => ({ texto }));
        const r = (await Promise.race([rag, espera])).texto;
        if (typeof r === "string" && r.trim() !== "") {
          contexto_rel = `${PRODUTO.pastaNoProjeto}/maestro/${p.id}/contexto-${a.etapa_id.split(".")[1]}.md`;
          await portas.arquivos.gravar(contexto_rel, r);
          argumento = normalizarArgumento(`${argumento} — Contexto prévio: ${contexto_rel}`) ?? argumento;
        }
      } catch {
        contexto_rel = null;
      }
    }
    if (precisaDeInstrucoes(p.pipeline_id, a.etapa_id, a.nivel as EtapaExec["nivel"])) {
      instrucoes_rel = await gravarInstrucoes(portas.arquivos, p.id, a.etapa_id, a.nivel as EtapaExec["nivel"], p.pipeline_id);
      argumento = argumentoComInstrucoes(argumento, instrucoes_rel, a.nivel as EtapaExec["nivel"]) ?? argumento;
    }
    const c = comandoDaEtapa(a.etapa_id, argumento, perfil.cli, { retomar: a.etapa_id === "buildx.condutor" && p.trabalho_id !== null });
    if (c.comando === "") return falha("comando_vazio", c.motivo_bloqueio ?? "sem comando");
    comando = c.comando;
  }

  const trabalho = ctx.trabalho;
  // reuso só em Pane `pronto` e nunca para avaliador
  if (a.reusar_pane_id !== null && def.tipo !== "avaliador" && portas.panes.estado(a.reusar_pane_id) === "pronto") {
    await portas.panes.enviarComando(a.reusar_pane_id, comando);
    portas.registrarEco?.(a.reusar_pane_id, comando);
    return { ok: true, pane_id: a.reusar_pane_id, comando, perfil, reutilizou: true, contexto_rel, instrucoes_rel };
  }
  try {
    const { pane_id } = await portas.panes.abrirPane({
      cli: perfil.cli, papel: a.papel, modelo: perfil.modelo, esforco: perfil.esforco, esforco_modo: perfil.esforco_modo, conta_id: perfil.conta_id, prompt_inicial: comando,
      cwd: portas.cwdDoPipeline(p, trabalho), mission_id: p.mission_id, origem_modelo: perfil.origem_modelo, pane_de_etapa: true, etapa_id: a.etapa_id, pipeline_id: p.id,
    });
    portas.registrarEco?.(pane_id, comando);
    return { ok: true, pane_id, comando, perfil, reutilizou: false, contexto_rel, instrucoes_rel };
  } catch (e) {
    return falha("pane_nao_abriu", e instanceof Error ? e.message.slice(0, 200) : "falha ao abrir o terminal");
  }
}

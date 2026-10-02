// Política de habilitação (Fase 7B, T-07B.22): quais servidores da Loja entram num Pane. Pura e deny-by-default
// (D-44): servidor instalado NÃO é servidor habilitado; sem linha = desabilitado; escopos mais estreitos só
// estreitam. O workspace é o TETO. Modo `livre` usa o teto (menos o que Missão/agente desligarem);
// `squad`/`agentico` exigem allow-list explícita da Missão (sem ela, 0 servidores); um agente com linhas
// habilitadas restringe ainda mais ao conjunto dele. Saídas explicam cada exclusão (a UI mostra o porquê).

import type { Bloqueio } from "./bloqueio";
import type { CatalogoCarregado } from "./catalogo";
import type { CliLoja, RegistroHabilitacao, RegistroInstalado } from "./repositorio";
import { hashDoComando } from "./plano";
import { variaveisFaltando } from "./segredos";

export type ModoMissao = "livre" | "squad" | "agentico";
export type NivelIsolamento = "duro" | "parcial" | "nenhum";

export interface AlvoPolitica {
  workspace: string;
  missao?: string | null;
  agente?: string | null;
  /** `livre` (padrão) ou deny-by-default. Só vale com `missao`. */
  modo?: ModoMissao;
  /**
   * Fase 7: `mcps_permitidos` do perfil do membro de squad (ids da Loja). Lista não vazia = INTERSEÇÃO com as habilitações (nunca amplia); ausente/vazia = sem restrição
   * declarada pelo perfil (a habilitação manda).
   */
  membro_mcps?: readonly string[] | null;
}

export type MotivoExclusao =
  | "nao_habilitado_no_workspace" | "sem_allow_list_da_missao" | "fora_da_allow_list_da_missao" | "desligado_na_missao"
  | "fora_do_conjunto_do_agente" | "desligado_no_agente" | "nao_instalado" | "instalacao_incompleta" | "bloqueado"
  | "fora_do_perfil_do_membro" | "nao_configurado" | "nao_confirmado" | "catalogo_desconhecido" | "reconsentimento_pendente";

export interface ResultadoPolitica {
  /** ids ordenados que entram no Pane. */
  servidores: string[];
  excluidos: Array<{ id: string; motivo: MotivoExclusao }>;
}

export interface EntradaPolitica {
  habilitacoes: readonly RegistroHabilitacao[];
  instalados: ReadonlyMap<string, RegistroInstalado>;
  catalogo: CatalogoCarregado;
  bloqueio?: Bloqueio;
  /** Variáveis com valor por servidor (só nomes). Ausente = nenhuma. */
  definidas?: ReadonlyMap<string, ReadonlySet<string>>;
}

const ativo = (hs: readonly RegistroHabilitacao[], tipo: RegistroHabilitacao["alvo_tipo"], valor: string | null | undefined): Map<string, boolean> => {
  const m = new Map<string, boolean>();
  if (!valor) return m;
  for (const h of hs) if (h.alvo_tipo === tipo && h.alvo_valor === valor) m.set(h.servidor_id, h.habilitado);
  return m;
};

/** Resolve os servidores da Loja de um Pane. Determinística; não toca disco nem rede. */
export function resolverServidoresLoja(alvo: AlvoPolitica, e: EntradaPolitica): ResultadoPolitica {
  const ws = ativo(e.habilitacoes, "workspace", alvo.workspace);
  const mi = ativo(e.habilitacoes, "missao", alvo.missao);
  const ag = ativo(e.habilitacoes, "agente", alvo.agente);
  const modo: ModoMissao = alvo.missao ? (alvo.modo ?? "livre") : "livre";
  const missaoRestrita = modo !== "livre";
  const agenteTemLista = [...ag.values()].some(Boolean);
  const membroLista = alvo.membro_mcps !== undefined && alvo.membro_mcps !== null && alvo.membro_mcps.length > 0 ? new Set(alvo.membro_mcps) : null;
  const ids = new Set<string>([...ws.keys(), ...mi.keys(), ...ag.keys()]);
  const servidores: string[] = [];
  const excluidos: ResultadoPolitica["excluidos"] = [];
  const fora = (id: string, motivo: MotivoExclusao): void => { excluidos.push({ id, motivo }); };

  for (const id of [...ids].sort()) {
    if (ws.get(id) !== true) { fora(id, "nao_habilitado_no_workspace"); continue; }
    if (mi.get(id) === false) { fora(id, "desligado_na_missao"); continue; }
    if (missaoRestrita) {
      if (![...mi.values()].some(Boolean)) { fora(id, "sem_allow_list_da_missao"); continue; }
      if (mi.get(id) !== true) { fora(id, "fora_da_allow_list_da_missao"); continue; }
    }
    if (ag.get(id) === false) { fora(id, "desligado_no_agente"); continue; }
    if (agenteTemLista && ag.get(id) !== true) { fora(id, "fora_do_conjunto_do_agente"); continue; }
    if (membroLista !== null && !membroLista.has(id)) { fora(id, "fora_do_perfil_do_membro"); continue; }

    const inst = e.instalados.get(id);
    if (!inst) { fora(id, "nao_instalado"); continue; }
    if (inst.estado !== "instalado") { fora(id, "instalacao_incompleta"); continue; }
    const entrada = e.catalogo.porId.get(id)?.entrada;
    if (!entrada) { fora(id, "catalogo_desconhecido"); continue; }
    if (!entrada.confirmado) { fora(id, "nao_confirmado"); continue; }
    if (e.bloqueio?.consultarEntrada(entrada)) { fora(id, "bloqueado"); continue; }
    // consentimento por VERSÃO: o que roda é o comando do catálogo ATUAL; se ele mudou depois do consentimento (versão, args, URL, variáveis,
    // riscos), o servidor fica fora até a pessoa atualizar e consentir de novo (nunca roda comando que ela não leu).
    if (inst.comando_hash !== hashDoComando(entrada)) { fora(id, "reconsentimento_pendente"); continue; }
    if (variaveisFaltando(entrada, e.definidas?.get(id) ?? new Set()).length > 0) { fora(id, "nao_configurado"); continue; }
    servidores.push(id);
  }
  return { servidores, excluidos };
}

/** Selo de isolamento por CLI (D-44/D-136): Claude duro; Codex e OpenCode parcial; Gemini nenhum. */
export function isolamentoPorCli(): Record<CliLoja, NivelIsolamento> {
  return { claude: "duro", codex: "parcial", opencode: "parcial", gemini: "nenhum" };
}

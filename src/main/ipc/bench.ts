// Canais `bench:*` (Fase 12): validadores estritos e manipuladores. O renderer NUNCA envia caminho de execução, executável nem variável de ambiente: só slugs, ids e a frase de consentimento.
// `consentir` é o gesto humano que gera o token de uso único (TTL 120 s); `rodar`, `rerodar` e `julgar` o consomem (payload `sensivel`: o token não vai a log). Nenhum canal devolve `mapa_cego`.
// O serviço só nasce na primeira chamada (nada no boot). Erro de regra do núcleo chega como `[codigo] texto`; qualquer outro vira texto genérico (nunca stack, SQL nem caminho).
import type { NomeInvoke } from "../../compartilhado/ipc";
import { CLIS_BENCH, ESTADOS_TAREFA, TIPOS_CHECAGEM, TIPOS_TAREFA, MAX_LOG_PAGINA } from "../../compartilhado/bench";
import { caminhoRelativoSeguro } from "../../nucleo/bench/execucao/workdir";
import { ErroBench } from "../../nucleo/bench/tipos";
import type { ServicoBench } from "../../nucleo/bench/servico";
import { vOuNulo, vRotulo, vTextoLivre } from "./comum-dominio";
import type { RegistroIpc } from "./registro";
import { vBooleano, vEnum, vInteiro, vLista, vObjeto, vTexto, vVazio, type Resultado, type Validador } from "./validar";
import { vInstante, vListaMin, vNumero, vObjetoOpc, type ValidadoresDaFamilia } from "./validar-harness";

const falha = (erro: string): Resultado<never> => ({ ok: false, erro });
const vSlugTarefa = vTexto({ min: 1, max: 64, padrao: /^[a-z0-9][a-z0-9-]{0,63}$/ });
const vSlugAlvo = vTexto({ min: 1, max: 80, padrao: /^[a-z0-9][a-z0-9._-]{0,79}$/ });
const idComPrefixo = (prefixo: string): Validador<string> => vTexto({ min: 1, max: 64, padrao: new RegExp(`^${prefixo}_[0-9A-Za-z]{10,40}$`) });
const vIdRun = idComPrefixo("brun");
const vIdResultado = idComPrefixo("bres");
const vIdEstimativa = vTexto({ min: 5, max: 48, padrao: /^est_[0-9a-z]{4,40}$/ });
const vToken = vTexto({ min: 48, max: 48, padrao: /^[0-9a-f]{48}$/ });
/** a frase exata é conferida pelo serviço (a reforçada só vale sem sandbox); aqui só o formato. */
const vConfirmacao = vTexto({ min: 1, max: 40, padrao: /^RODAR(?: SEM SANDBOX)?$/ });
const vProvedor = vTexto({ min: 1, max: 41, padrao: /^[A-Za-z0-9][A-Za-z0-9._-]{0,40}$/ });
const vModelo = vTexto({ min: 1, max: 81, padrao: /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,80}$/ });
const vEsforco = vTexto({ min: 1, max: 20, padrao: /^[a-z][a-z-]{0,19}$/ });
const vContaId = vTexto({ min: 1, max: 80, padrao: /^[A-Za-z0-9_-]{1,80}$/ });
const vNomeArtefato: Validador<string> = (v) => (typeof v === "string" && v.length <= 200 && caminhoRelativoSeguro(v) ? { ok: true, valor: v } : falha("nome de artefato inválido"));
const vNulavel = <T>(v: Validador<T>): Validador<T | null> => vOuNulo(v);

const vChecagem = vObjetoOpc({ tipo: vEnum(TIPOS_CHECAGEM), alvo: vTexto({ min: 1, max: 200 }), critica: vBooleano }, { texto: vTextoLivre(500, 1) });
const vTarefaEditavel = vObjeto({
  slug: vSlugTarefa, titulo: vRotulo(120), atividade: vSlugTarefa, tipo: vEnum(TIPOS_TAREFA), prompt: vTextoLivre(20_000), escopo: vTextoLivre(2000), checagens: vLista(vChecagem, 20), estado: vEnum(ESTADOS_TAREFA),
});
const vAlvoEditavel = vObjeto({ provedor: vProvedor, modelo: vModelo, esforco: vNulavel(vEsforco), cli: vEnum(CLIS_BENCH), conta_id: vNulavel(vContaId), rotulo: vNulavel(vRotulo(80)) });
const vPreco = vObjeto({ provedor: vProvedor, modelo: vModelo, preco_in_mtok: vNumero({ min: 0, max: 1_000_000 }), preco_out_mtok: vNumero({ min: 0, max: 1_000_000 }), preco_cache_mtok: vNulavel(vNumero({ min: 0, max: 1_000_000 })), vale_desde: vInstante });
const vRestricoes = vObjeto({ custo_max_usd: vNulavel(vNumero({ min: 0, max: 1_000_000 })), duracao_max_s: vNulavel(vNumero({ min: 0, max: 604_800 })), provedores: vNulavel(vLista(vProvedor, 20)) });

export const VALIDADORES_BENCH = {
  "bench:tarefas_listar": vObjeto({ atividade: vNulavel(vSlugTarefa), estado: vNulavel(vEnum(ESTADOS_TAREFA)) }),
  "bench:tarefa_salvar": vObjeto({ tarefa: vTarefaEditavel }),
  "bench:alvos_listar": vVazio,
  "bench:alvos_salvar": vObjeto({ alvos: vLista(vAlvoEditavel, 40) }),
  "bench:precos_ler": vVazio,
  "bench:precos_gravar": vObjeto({ precos: vLista(vPreco, 200) }),
  "bench:estimar": vObjeto({ tarefas: vListaMin(vSlugTarefa, 1, 50), alvos: vListaMin(vSlugAlvo, 1, 50), max_paralelo: vInteiro({ min: 1, max: 50 }), teto_usd: vNulavel(vNumero({ min: 0, max: 1_000_000 })), juiz_alvo: vNulavel(vSlugAlvo) }),
  "bench:consentir": vObjetoOpc({ estimativa_id: vIdEstimativa, confirmacao: vConfirmacao }, { finalidade: vEnum(["rodar", "rerodar", "julgar"] as const) }),
  "bench:descartar_consentimento": vObjeto({ estimativa_id: vIdEstimativa }),
  "bench:rodar": vObjeto({ estimativa_id: vIdEstimativa, token: vToken }),
  "bench:cancelar": vObjeto({ run_id: vIdRun }),
  "bench:rerodar": vObjeto({ run_id: vIdRun, tarefa: vSlugTarefa, alvo: vSlugAlvo, token: vToken }),
  "bench:julgar": vObjeto({ run_id: vIdRun, tarefa: vNulavel(vSlugTarefa), juiz_alvo: vSlugAlvo, token: vToken }),
  "bench:nota_manual": vObjeto({ resultado_id: vIdResultado, nota: vNumero({ min: 0, max: 10 }), notas: vNulavel(vTextoLivre(500)) }),
  "bench:runs_listar": vObjeto({ depois: vNulavel(vIdRun) }),
  "bench:estado_run": vObjeto({ run_id: vIdRun }),
  "bench:resultado": vObjeto({ resultado_id: vIdResultado }),
  "bench:log_ler": vObjeto({ resultado_id: vIdResultado, depois: vInteiro({ min: 0, max: 2 ** 40 }), max: vInteiro({ min: 1, max: MAX_LOG_PAGINA }) }),
  "bench:artefato_ler": vObjeto({ resultado_id: vIdResultado, nome: vNomeArtefato }),
  "bench:comparar": vObjeto({ alvos: vListaMin(vSlugAlvo, 2, 20), tarefas: vNulavel(vLista(vSlugTarefa, 50)), agrupar: vEnum(["tarefa", "atividade"] as const) }),
  "bench:recomendar": vObjeto({ atividade: vSlugTarefa, restricoes: vNulavel(vRestricoes), estrategia: vNulavel(vEnum(["melhor_qualidade", "mais_barato_aceitavel", "mais_rapido_aceitavel"] as const)) }),
  "bench:exportar_politica": vObjeto({ atividades: vNulavel(vLista(vSlugTarefa, 50)) }),
  "bench:exportar_relatorio": vObjeto({ run_ids: vNulavel(vLista(vIdRun, 50)), formato: vEnum(["md", "json"] as const) }),
} satisfies ValidadoresDaFamilia<"bench:">;

export type CanalBench = keyof typeof VALIDADORES_BENCH;

export function paraErroIpc(e: unknown, aviso?: (m: string) => void): Error {
  if (e instanceof ErroBench) return new Error(e.message);
  aviso?.(`bench: ${e instanceof Error ? e.message : String(e)}`);
  return new Error("[unavailable] Falha interna no Bench.");
}

export interface DependenciasIpcBench {
  registro: RegistroIpc;
  /** leitura preguiçosa: o serviço só nasce na primeira chamada (nada no boot). */
  servico: () => ServicoBench | Promise<ServicoBench>;
  aviso?: (mensagem: string) => void;
}

export function registrarIpcBench(d: DependenciasIpcBench): void {
  const V = VALIDADORES_BENCH;
  type P = Record<string, unknown>;
  const R = (canal: CanalBench, fn: (p: P, s: ServicoBench) => unknown): void => {
    d.registro.invoke(canal as NomeInvoke, V[canal] as never, (async (p: never) => {
      try {
        return await fn((p ?? {}) as unknown as P, await d.servico());
      } catch (e) {
        throw paraErroIpc(e, d.aviso);
      }
    }) as never);
  };
  R("bench:tarefas_listar", (p, s) => s.tarefasListar(p["atividade"] as string | null, p["estado"] as never));
  R("bench:tarefa_salvar", (p, s) => s.tarefaSalvar(p["tarefa"] as never));
  R("bench:alvos_listar", (_p, s) => s.alvosListar());
  R("bench:alvos_salvar", (p, s) => s.alvosSalvar(p["alvos"] as never));
  R("bench:precos_ler", (_p, s) => s.precosLer());
  R("bench:precos_gravar", (p, s) => s.precosGravar(p["precos"] as never));
  R("bench:estimar", (p, s) => s.estimar(p as never));
  R("bench:consentir", (p, s) => s.consentir(p["estimativa_id"] as string, p["confirmacao"] as string, p["finalidade"] as never));
  R("bench:descartar_consentimento", (p, s) => { s.descartarConsentimento(p["estimativa_id"] as string); return true; });
  R("bench:rodar", (p, s) => s.rodar(p["estimativa_id"] as string, p["token"] as string));
  R("bench:cancelar", (p, s) => s.cancelar(p["run_id"] as string));
  R("bench:rerodar", (p, s) => s.rerodar(p["run_id"] as string, p["tarefa"] as string, p["alvo"] as string, p["token"] as string));
  R("bench:julgar", (p, s) => s.julgar(p["run_id"] as string, p["tarefa"] as string | null, p["juiz_alvo"] as string, p["token"] as string));
  R("bench:nota_manual", (p, s) => s.notaManual(p["resultado_id"] as string, p["nota"] as number, p["notas"] as string | null));
  R("bench:runs_listar", (p, s) => s.runsListar(p["depois"] as string | null));
  R("bench:estado_run", (p, s) => s.estadoRun(p["run_id"] as string));
  R("bench:resultado", (p, s) => s.resultado(p["resultado_id"] as string));
  R("bench:log_ler", (p, s) => s.logLer(p["resultado_id"] as string, p["depois"] as number, p["max"] as number));
  R("bench:artefato_ler", (p, s) => s.artefatoLer(p["resultado_id"] as string, p["nome"] as string));
  R("bench:comparar", (p, s) => s.comparar(p["alvos"] as string[], p["tarefas"] as string[] | null, p["agrupar"] as never));
  R("bench:recomendar", (p, s) => s.recomendar(p["atividade"] as string, p["restricoes"] as never, p["estrategia"] as never));
  R("bench:exportar_politica", (p, s) => s.exportarPolitica(p["atividades"] as string[] | null));
  R("bench:exportar_relatorio", (p, s) => s.exportarRelatorio(p["run_ids"] as string[] | null, p["formato"] as never));
}

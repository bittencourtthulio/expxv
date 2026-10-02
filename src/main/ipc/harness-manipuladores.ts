// Manipuladores dos canais `harness:*` (Fase 9, T-09.14/15/24/25). Finos: toda a regra mora em `main/harness.ts` e em `nucleo/harness`.
// Os canais de troca (`harness:trocas_listar`, `harness:troca_decidir`, `harness:mover_pane`, T-09.20) só são registrados quando `troca` é informado.
// O renderer nunca vê segredo: `decisor_*` devolve a configuração SEM chave e `decisor_testar` usa o valor uma vez (canal sensível).
import type { ResultadoDeRota } from "../../compartilhado/harness";
import { paraResultadoDeRota } from "../../nucleo/harness/perfil";
import { ErroHarness, type HarnessMain } from "../harness";
import { VALIDADORES_HARNESS } from "./harness";

export { CANAIS_HARNESS_ONDA_5, CANAIS_HARNESS_TROCA } from "./harness";
import type { HarnessTroca } from "../harness-troca";
import type { RegistroIpc } from "./registro";

export interface DependenciasIpcHarness {
  registro: RegistroIpc;
  /** Acessor preguiçoso do executor de troca (nasce na onda 2); `null` = ainda não iniciou. Sem ele, os 3 canais não são registrados. */
  troca?: () => Pick<HarnessTroca, "trocasListar" | "trocaDecidir" | "moverPane"> | null;
  harness: Pick<
    HarnessMain,
    | "configLer"
    | "configGravar"
    | "taskTypesListar"
    | "taskTypesGravar"
    | "taskTypesApagar"
    | "politicaListar"
    | "politicaGravar"
    | "politicaRestaurarSemente"
    | "equivalenciaLer"
    | "equivalenciaGravar"
    | "equivalenciaRestaurar"
    | "recomendar"
    | "decisoesListar"
    | "contasConfigListar"
    | "contasConfigGravar"
    | "decisorLer"
    | "decisorGravar"
    | "decisorTestar"
    | "classificarIntencao"
    | "resolverPerfil"
  >;
}

export function registrarIpcHarness({ registro, harness: h, troca }: DependenciasIpcHarness): void {
  const V = VALIDADORES_HARNESS;
  registro.invoke("harness:config_ler", V["harness:config_ler"], ({ workspace_id }) => h.configLer(workspace_id));
  registro.invoke("harness:config_gravar", V["harness:config_gravar"], (c) => h.configGravar(c));
  registro.invoke("harness:task_types_listar", V["harness:task_types_listar"], () => h.taskTypesListar());
  registro.invoke("harness:task_types_gravar", V["harness:task_types_gravar"], (t) => h.taskTypesGravar(t));
  registro.invoke("harness:task_types_apagar", V["harness:task_types_apagar"], ({ slug }) => h.taskTypesApagar(slug));
  registro.invoke("harness:politica_listar", V["harness:politica_listar"], ({ workspace_id }) => h.politicaListar(workspace_id));
  registro.invoke("harness:politica_gravar", V["harness:politica_gravar"], (p) => h.politicaGravar(p, "usuario"));
  registro.invoke("harness:politica_restaurar_semente", V["harness:politica_restaurar_semente"], ({ workspace_id, task_type }) => h.politicaRestaurarSemente(workspace_id, task_type));
  registro.invoke("harness:equivalencia_ler", V["harness:equivalencia_ler"], () => h.equivalenciaLer());
  registro.invoke("harness:equivalencia_gravar", V["harness:equivalencia_gravar"], ({ provedores }) => h.equivalenciaGravar(provedores));
  registro.invoke("harness:equivalencia_restaurar", V["harness:equivalencia_restaurar"], () => h.equivalenciaRestaurar());
  // só leitura: consulta a rota que o harness escolheria; NÃO cria Pane
  registro.invoke("harness:recomendar", V["harness:recomendar"], async ({ workspace_id, descricao }): Promise<ResultadoDeRota> => {
    const rota = await h.recomendar(workspace_id, descricao);
    const r = paraResultadoDeRota(rota);
    if (r === null) throw new ErroHarness(rota.erro ?? "no_capacity", null, rota.recibo);
    return r;
  });
  registro.invoke("harness:decisoes_listar", V["harness:decisoes_listar"], (p) => h.decisoesListar(p));
  registro.invoke("harness:contas_config_listar", V["harness:contas_config_listar"], () => h.contasConfigListar());
  registro.invoke("harness:contas_config_gravar", V["harness:contas_config_gravar"], (c) => h.contasConfigGravar(c));
  registro.invoke("harness:decisor_ler", V["harness:decisor_ler"], () => h.decisorLer());
  registro.invoke("harness:decisor_gravar", V["harness:decisor_gravar"], (c) => h.decisorGravar(c));
  registro.invoke("harness:decisor_testar", V["harness:decisor_testar"], ({ chave }) => h.decisorTestar(chave));
  registro.invoke("harness:classificar_intencao", V["harness:classificar_intencao"], ({ texto, contexto }) => h.classificarIntencao(texto, contexto));
  registro.invoke("harness:resolver_perfil", V["harness:resolver_perfil"], (p) => h.resolverPerfil(p));
  if (troca !== undefined) {
    const exigir = (): NonNullable<ReturnType<typeof troca>> => {
      const t = troca();
      if (t === null) throw new ErroHarness("unavailable", null, "A troca por consumo ainda não iniciou.");
      return t;
    };
    registro.invoke("harness:trocas_listar", V["harness:trocas_listar"], (p) => exigir().trocasListar(p));
    registro.invoke("harness:troca_decidir", V["harness:troca_decidir"], (p) => exigir().trocaDecidir(p));
    // o clique é a prova: o executor aplica `force`; mesmo caminho da tool `account_switch`
    registro.invoke("harness:mover_pane", V["harness:mover_pane"], (p) => exigir().moverPane(p));
  }
}

// Canais `mapa:*` (Fase 17): validadores estritos e manipuladores. O renderer NUNCA envia caminho absoluto, `cwd`, destino nem `userData`:
// todo pedido leva `workspace_id`, caminhos são RELATIVOS à raiz (sem `..`, sem NUL, sem arquivo de ambiente/chave) e o main resolve a raiz.
// Erro de regra do núcleo chega ao renderer como `Error` com `[codigo] texto`; qualquer outro erro vira texto genérico (nunca stack, SQL nem caminho).
// O serviço só nasce no primeiro uso (nada no boot).
import type { FiltroGrafoMapa, ParametrosAnaliseMapa, PedidoDisparoMapa, ResultadoDisparoMapa, ResumoMapaIpc, VistaExportacaoMapa } from "../../compartilhado/mapa";
import { ACOES_DISPARO_MAPA, DIRECOES_VIZINHOS, FORMATOS_EXPORTACAO_MAPA, LIMITE_BUSCA_MAX, LIMITE_GRAFO_MAX, LIMITE_RAIO_ARQUIVOS, LIMITE_VIZINHOS_MAX, NIVEIS_GRAFO, TIPOS_ANALISE_MAPA } from "../../compartilhado/mapa";
import { caminhoRelativoSeguro } from "../../nucleo/mapa/confinado";
import { ErroConsulta } from "../../nucleo/mapa/consultas";
import { ehArquivoSensivel } from "../../nucleo/mapa/sensiveis";
import type { FachadaMapa } from "../../nucleo/mapa/fachada";
import { vIdPane, vIdTrabalho, vIdWorkspace } from "./comum-dominio";
import type { RegistroIpc } from "./registro";
import { vBooleano, vEnum, vInteiro, vLista, vTexto, type Resultado, type Validador } from "./validar";
import { vObjetoOpc } from "./validar-harness";

const falha = (erro: string): Resultado<never> => ({ ok: false, erro });
const ok = <T>(valor: T): Resultado<T> => ({ ok: true, valor });

/** Caminho RELATIVO à raiz: nunca absoluto, nunca `..` que escape, nunca NUL, nunca arquivo de ambiente/chave. */
export const vCaminhoRel: Validador<string> = (v) => {
  if (typeof v !== "string" || v.length > 1024) return falha("caminho inválido");
  const c = caminhoRelativoSeguro(v);
  if (c === null || ehArquivoSensivel(c)) return falha("caminho deve ser relativo à raiz do workspace");
  return ok(c);
};

/** `arq:`, `sim:`, `ent:`, `mod:`, `tab:`, `ext:` + conteúdo sem NUL; caminho embutido segue a mesma regra. */
export const vIdNo: Validador<string> = (v) => {
  if (typeof v !== "string" || v.length === 0 || v.length > 600 || v.includes("\0")) return falha("id de nó inválido");
  const m = /^(arq|mod|sim|ent|tab|ext):(.+)$/s.exec(v);
  if (m === null) return falha("id de nó inválido");
  if (m[1] === "arq" || m[1] === "sim" || m[1] === "ent") {
    const caminho = (m[1] === "arq" ? (m[2] as string) : (m[2] as string).split("#")[0]) as string;
    if (caminhoRelativoSeguro(caminho) === null || ehArquivoSensivel(caminho)) return falha("caminho do nó inválido");
  }
  return ok(v);
};

const vNumero: Validador<number> = (v) => (typeof v === "number" && Number.isFinite(v) ? ok(v) : falha("esperado número"));
const vTextoSimples = (max: number, min = 0): Validador<string> => {
  const base = vTexto({ min, max });
  return (v) => {
    const r = base(v);
    if (!r.ok) return r;
    // eslint-disable-next-line no-control-regex
    return /[\u0000-\u001f\u007f]/.test(r.valor) ? falha("texto inválido") : r;
  };
};
const vTipoAresta = vEnum(["importa", "reexporta", "chama", "instancia", "herda", "implementa", "referencia", "aciona", "le_tabela", "escreve_tabela", "testa"] as const);
const vConfianca = vEnum(["exata", "heuristica"] as const);
const vTipoNo = vEnum(["arquivo", "modulo", "simbolo", "entrada", "tabela", "externo"] as const);
const vChaveLayout = vTexto({ min: 1, max: 120, padrao: /^[A-Za-z0-9._:|-]+$/ });
const vLinguagem = vTexto({ min: 1, max: 20, padrao: /^[a-z+#]+$/ });

const vFiltro = vObjetoOpc({}, {
  linguagens: vLista(vLinguagem, 20),
  pasta: vCaminhoRel,
  tipos_aresta: vLista(vTipoAresta, 11),
  min_confianca: vConfianca,
  so_ciclos: vBooleano,
  camada: vInteiro({ min: 0, max: 1000 }),
}) as Validador<FiltroGrafoMapa>;

const vParametrosAnalise = vObjetoOpc({}, { limite: vInteiro({ min: 1, max: 5000 }), pasta: vCaminhoRel, tabela: vTextoSimples(200, 1) }) as Validador<ParametrosAnaliseMapa>;

const vVista: Validador<VistaExportacaoMapa> = (v) => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return falha("vista inválida");
  const tipo = (v as { tipo?: unknown }).tipo;
  if (tipo === "grafo") {
    const r = vObjetoOpc({ tipo: vEnum(["grafo"] as const), nivel: vEnum(NIVEIS_GRAFO) }, { filtro: vFiltro })(v);
    return r.ok ? ok(r.valor as VistaExportacaoMapa) : r;
  }
  if (tipo === "fluxo") {
    const r = vObjetoOpc({ tipo: vEnum(["fluxo"] as const), entrada_id: vIdNo }, { profundidade: vInteiro({ min: 1, max: 10 }) })(v);
    return r.ok ? ok(r.valor as VistaExportacaoMapa) : r;
  }
  if (tipo === "relatorio") {
    const r = vObjetoOpc({ tipo: vEnum(["relatorio"] as const) }, {})(v);
    return r.ok ? ok(r.valor as VistaExportacaoMapa) : r;
  }
  return falha("vista inválida");
};

const vConfigParcial: Validador<Record<string, unknown>> = vObjetoOpc({}, {
  habilitado: vBooleano,
  auto_atualizar: vBooleano,
  expor_agentes: vBooleano,
  duplicacao: vBooleano,
  arquivo_max_bytes: vInteiro({ min: 1_000, max: 5_000_000 }),
  total_max: vInteiro({ min: 100, max: 1_000_000 }),
  workers: vInteiro({ min: 0, max: 3 }),
  historia_janela_dias: vInteiro({ min: 7, max: 3650 }),
  historia_max_commits: vInteiro({ min: 100, max: 200_000 }),
  ignorar: vLista(vTextoSimples(200, 1), 100),
}) as Validador<Record<string, unknown>>;

const ws = { workspace_id: vIdWorkspace };

export const VALIDADORES_MAPA = {
  "mapa:resumo": vObjetoOpc(ws, {}),
  "mapa:analisar": vObjetoOpc({ ...ws, modo: vEnum(["completo", "incremental"] as const) }, { historia: vBooleano }),
  "mapa:cancelar": vObjetoOpc(ws, {}),
  "mapa:apagar": vObjetoOpc({ ...ws, confirmacao: vTextoSimples(20) }, {}),
  "mapa:grafo": vObjetoOpc({ ...ws, nivel: vEnum(NIVEIS_GRAFO) }, { filtro: vFiltro, limite: vInteiro({ min: 1, max: LIMITE_GRAFO_MAX }) }),
  "mapa:vizinhos": vObjetoOpc({ ...ws, no_id: vIdNo }, { direcao: vEnum(DIRECOES_VIZINHOS), profundidade: vInteiro({ min: 1, max: 3 }), limite: vInteiro({ min: 1, max: LIMITE_VIZINHOS_MAX }) }),
  "mapa:no": vObjetoOpc({ ...ws, no_id: vIdNo }, {}),
  "mapa:fluxo": vObjetoOpc({ ...ws, entrada_id: vIdNo }, { profundidade: vInteiro({ min: 1, max: 10 }), min_confianca: vConfianca }),
  "mapa:analise": vObjetoOpc({ ...ws, tipo: vEnum(TIPOS_ANALISE_MAPA) }, { parametros: vParametrosAnalise }),
  "mapa:raio": vObjetoOpc({ ...ws, arquivos: vLista(vCaminhoRel, LIMITE_RAIO_ARQUIVOS) }, { simbolos: vLista(vTextoSimples(600, 1), LIMITE_RAIO_ARQUIVOS) }),
  "mapa:perfil": vObjetoOpc(ws, {}),
  "mapa:buscar": vObjetoOpc({ ...ws, texto: vTextoSimples(200, 1) }, { tipos: vLista(vTipoNo, 6), limite: vInteiro({ min: 1, max: LIMITE_BUSCA_MAX }) }),
  "mapa:exportar": vObjetoOpc({ ...ws, formato: vEnum(FORMATOS_EXPORTACAO_MAPA), vista: vVista }, { destino: vEnum(["padrao", "escolher"] as const) }),
  "mapa:disparar": vObjetoOpc({ ...ws, acao: vEnum(ACOES_DISPARO_MAPA), pane_id: vIdPane }, { trabalho_id: vIdTrabalho, arquivos: vLista(vCaminhoRel, LIMITE_RAIO_ARQUIVOS) }),
  "mapa:config_ler": vObjetoOpc(ws, {}),
  "mapa:config_gravar": vObjetoOpc({ ...ws, config: vConfigParcial }, {}),
  "mapa:layout_ler": vObjetoOpc({ ...ws, chave: vChaveLayout }, {}),
  "mapa:layout_gravar": vObjetoOpc({ ...ws, chave: vChaveLayout, nivel: vEnum(["modulo", "arquivo", "simbolo", "fluxo"] as const), posicoes: vLista(vNumero, 2 * LIMITE_GRAFO_MAX) }, {}),
} as const;

export interface ServicoMapaMain {
  fachada(workspaceId: string): Promise<FachadaMapa>;
  resumo(workspaceId: string): Promise<ResumoMapaIpc>;
  disparar(workspaceId: string, pedido: PedidoDisparoMapa): Promise<ResultadoDisparoMapa>;
}

export interface OpcoesRegistroMapa {
  registro: RegistroIpc;
  servico: ServicoMapaMain;
  aviso?: (m: string) => void;
}

/** Erro de regra do núcleo => `[codigo] texto`; qualquer outro => texto genérico (a causa vai ao log, nunca ao renderer). */
export function traduzirErroMapa(e: unknown, aviso?: (m: string) => void): Error {
  if (e instanceof ErroConsulta) return new Error(`[${e.codigo}] ${e.message}`);
  aviso?.(`mapa: ${e instanceof Error ? e.message : String(e)}`);
  return new Error("[erro_interno] não foi possível concluir a operação do mapa");
}

export function registrarIpcMapa({ registro, servico, aviso }: OpcoesRegistroMapa): void {
  const V = VALIDADORES_MAPA;
  const f = <E extends { workspace_id: string }, R>(corpo: (fachada: FachadaMapa, entrada: E) => R | Promise<R>) =>
    async (entrada: E): Promise<R> => {
      try {
        return await corpo(await servico.fachada(entrada.workspace_id), entrada);
      } catch (e) {
        throw traduzirErroMapa(e, aviso);
      }
    };
  registro.invoke("mapa:resumo", V["mapa:resumo"], async (e) => {
    try {
      return await servico.resumo(e.workspace_id);
    } catch (err) {
      throw traduzirErroMapa(err, aviso);
    }
  });
  registro.invoke("mapa:analisar", V["mapa:analisar"], f((fa, e) => fa.analisar(e.modo, e.historia)));
  registro.invoke("mapa:cancelar", V["mapa:cancelar"], f((fa) => fa.cancelar()));
  registro.invoke("mapa:apagar", V["mapa:apagar"], f((fa, e) => fa.apagar(e.confirmacao)));
  registro.invoke("mapa:grafo", V["mapa:grafo"], f((fa, e) => fa.grafo(e.nivel, e.filtro, e.limite)));
  registro.invoke("mapa:vizinhos", V["mapa:vizinhos"], f((fa, e) => fa.vizinhos(e.no_id, e.direcao, e.profundidade, e.limite)));
  registro.invoke("mapa:no", V["mapa:no"], f((fa, e) => fa.no(e.no_id)));
  registro.invoke("mapa:fluxo", V["mapa:fluxo"], f((fa, e) => fa.fluxo(e.entrada_id, e.profundidade, e.min_confianca)));
  registro.invoke("mapa:analise", V["mapa:analise"], f((fa, e) => fa.analise(e.tipo, e.parametros)));
  registro.invoke("mapa:raio", V["mapa:raio"], f((fa, e) => fa.raio(e.arquivos, e.simbolos)));
  registro.invoke("mapa:perfil", V["mapa:perfil"], f((fa) => fa.perfil()));
  registro.invoke("mapa:buscar", V["mapa:buscar"], f((fa, e) => fa.buscar(e.texto, e.tipos, e.limite)));
  registro.invoke("mapa:exportar", V["mapa:exportar"], f((fa, e) => fa.exportar(e.formato, e.vista, e.destino)));
  registro.invoke("mapa:disparar", V["mapa:disparar"], async (e) => {
    try {
      const { workspace_id, ...pedido } = e;
      return await servico.disparar(workspace_id, pedido as PedidoDisparoMapa);
    } catch (err) {
      throw traduzirErroMapa(err, aviso);
    }
  });
  registro.invoke("mapa:config_ler", V["mapa:config_ler"], f((fa) => fa.configLer()));
  registro.invoke("mapa:config_gravar", V["mapa:config_gravar"], f((fa, e) => fa.configGravar(e.config)));
  registro.invoke("mapa:layout_ler", V["mapa:layout_ler"], f((fa, e) => fa.layoutLer(e.chave)));
  registro.invoke("mapa:layout_gravar", V["mapa:layout_gravar"], f((fa, e) => fa.layoutGravar(e.chave, e.nivel, e.posicoes)));
}

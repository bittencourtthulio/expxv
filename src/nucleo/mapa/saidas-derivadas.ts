import { CONFIG_MAPA_PADRAO, type ResumoMapaIpc } from "../../compartilhado/mapa";
import type { Armazem } from "./armazem";
import { resumoBase } from "./consultas";
import type { ContextoDerivado } from "./derivada";
import { montarInventarioStackx } from "./inventario";
import { montarResumoMd, type ArquivoImportante, type EntradaPacote } from "./pacote-contexto";
import { montarPerfilProvisorio } from "./perfil-provisorio";

// Saídas calculadas ao FIM da fase derivada (na thread do worker): inventário do stackx, perfil provisório, RESUMO.md e a lista
// de arquivos importantes ficam em `analise_cache` (chaves `saida:*`). O disparo (`mapa:disparar`) só ESCREVE o pacote a partir
// daqui, sem recarregar o grafo. Nada de código-fonte nem caminho absoluto.

/** `ResumoMapaIpc` mínimo para as saídas (o serviço completa os campos de execução e de configuração). */
export function resumoParaSaidas(armazem: Armazem): ResumoMapaIpc {
  const b = resumoBase(armazem);
  return {
    ...b,
    ferramentas: { ctags: false, scc: false, dot: false },
    desatualizado: false,
    alterados_n: 0,
    analisando: false,
    progresso: null,
    configuracao: { ...CONFIG_MAPA_PADRAO, ignorar: [] },
    aviso: null,
    pacote: { carimbo: null, caminho: null },
    estimativa_arquivos: null,
  };
}

export function arquivosImportantes(armazem: Armazem, limite = 500): ArquivoImportante[] {
  return armazem.banco
    .consultar<{ caminho: string; linguagem: string; loc: number | null; pagerank: number | null; camada: number | null; ciclo_id: number | null; modulo: string }>(
      "SELECT caminho, linguagem, loc, pagerank, camada, ciclo_id, modulo FROM arquivo WHERE degradado = 0 ORDER BY pagerank DESC, caminho LIMIT ?",
      [limite],
    )
    .map((l) => ({ caminho: l.caminho, linguagem: l.linguagem, loc: l.loc, pagerank: l.pagerank === null ? null : Math.round(l.pagerank * 10_000) / 10_000, camada: l.camada, ciclo_id: l.ciclo_id, modulo: l.modulo }));
}

export function calcularSaidasDoContexto(armazem: Armazem, ctx: ContextoDerivado): void {
  const resumo = resumoParaSaidas(armazem);
  const a = ctx.analises;
  const dados = { entradas: a.entradas, camadas: a.camadas, ciclos: a.ciclos, sem_teste: a.sem_teste, dialetos: a.dialetos, zonas: a.zonas, mortos: a.mortos, hotspots: a.hotspots };
  const naoTeste = ctx.arquivos.filter((x) => !x.extracao.e_teste && x.extracao.linguagem !== "outra").length;
  const inventario = montarInventarioStackx({ arquivos: ctx.arquivos, manifestos: ctx.manifestos, camadas: a.camadas, criado: ctx.criado, padroes: ctx.padroes });
  const perfil = montarPerfilProvisorio({ resumo, manifestos: ctx.manifestos, dados, total_codigo: naoTeste });
  const importantes = arquivosImportantes(armazem);
  const entradaPacote: EntradaPacote = { resumo, manifestos: ctx.manifestos, dados, total_codigo: naoTeste, inventario: { arquivos: [] }, importantes, externas: a.externas, dados_acesso: a.dados };
  const resumoMd = montarResumoMd(entradaPacote);
  armazem.gravarAnaliseCache("saida:inventario", inventario);
  armazem.gravarAnaliseCache("saida:perfil", perfil);
  armazem.gravarAnaliseCache("saida:resumo_md", { texto: resumoMd });
  armazem.gravarAnaliseCache("saida:importantes", importantes);
  armazem.gravarAnaliseCache("saida:entradas", a.entradas);
}

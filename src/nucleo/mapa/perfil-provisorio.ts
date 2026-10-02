import type { DadosAnaliseMapa, PerfilProvisorioMapa, ResumoMapaIpc } from "../../compartilhado/mapa";
import type { Manifesto } from "./manifestos";

// Perfil PROVISÓRIO (T-17.31/T-17.42): só para a pessoa revisar e para o `legadox-perfil` usar de ponto de partida.
// Não é o `PERFIL.md`. Sem nenhuma linha de código-fonte; caminhos relativos.

export const NOTA_PERFIL = "provisório: não é o PERFIL.md; quem escreve é /expx:legadox-perfil";

export interface EntradaPerfil {
  resumo: ResumoMapaIpc;
  manifestos?: readonly Manifesto[];
  dados: {
    entradas: DadosAnaliseMapa["entradas"];
    camadas: DadosAnaliseMapa["camadas"];
    ciclos: DadosAnaliseMapa["ciclos"];
    sem_teste: DadosAnaliseMapa["sem_teste"];
    dialetos: DadosAnaliseMapa["dialetos"];
    zonas: DadosAnaliseMapa["zonas"];
    mortos: DadosAnaliseMapa["mortos"];
    hotspots: DadosAnaliseMapa["hotspots"];
  };
  /** Total de arquivos de código não-teste (padrão: `resumo.arquivos`). */
  total_codigo?: number;
  agora?: Date;
}

export function montarPerfilProvisorio(e: EntradaPerfil): PerfilProvisorioMapa {
  const manifestos = e.manifestos ?? [];
  const ecos = [...new Set(manifestos.map((m) => m.eco).filter((x): x is NonNullable<typeof x> => x !== null))].sort();
  const comandos = manifestos
    .flatMap((m) => m.comandos.map((c) => ({ nome: c.nome, comando: c.comando, fonte: c.arquivo, linha: c.linha as number | null })))
    .sort((a, b) => a.fonte.localeCompare(b.fonte) || a.nome.localeCompare(b.nome))
    .slice(0, 60);
  const semTeste = e.dados.sem_teste.itens.filter((i) => i.estado !== "existente").length;
  return {
    nota: NOTA_PERFIL,
    gerado_em: (e.agora ?? new Date()).toISOString(),
    stack: { ecossistemas: ecos, manifestos: manifestos.map((m) => m.arquivo).sort(), linguagens: e.resumo.linguagens },
    entradas_por_categoria: e.dados.entradas.por_categoria,
    camadas: { modulos: e.dados.camadas.modulos.length, violacoes: e.dados.camadas.violacoes.length, ciclos: e.dados.camadas.ciclos.length },
    comandos,
    cobertura: { metodo: "estimativa por convenção de nome e importação nos testes (não é cobertura medida)", sem_teste: semTeste, total: e.total_codigo ?? e.resumo.arquivos },
    dialetos_conflitantes: e.dados.dialetos.eixos.filter((x) => x.forca === "CONFLITO").map((x) => ({ eixo: x.eixo, forca: x.forca })),
    zonas_candidatas: e.dados.zonas.zonas.map((z) => ({ categoria: z.categoria, pastas: z.pastas.slice(0, 10), quem_valida: z.quem_valida })),
    divida: { ciclos: e.dados.ciclos.total, candidatos_mortos: e.dados.mortos.itens.length, hotspots_quentes: e.dados.hotspots.itens.filter((h) => h.faixa === "quente").length },
  };
}

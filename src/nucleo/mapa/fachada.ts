import { join } from "node:path";
import type {
  ConfigMapa,
  ConfiancaIpc,
  DestinoExportacaoMapa,
  DirecaoVizinhosIpc,
  FiltroGrafoMapa,
  FluxoMapaIpc,
  FormatoExportacaoMapa,
  GrafoMapaIpc,
  NivelGrafo,
  NoDetalheMapa,
  ParametrosAnaliseMapa,
  PerfilProvisorioMapa,
  RaioMapaIpc,
  ResultadoAnaliseMapa,
  ResultadoBuscaMapa,
  ResultadoExportacaoMapa,
  ResumoMapaIpc,
  TipoAnaliseMapa,
  TipoNoIpc,
  VistaExportacaoMapa,
  VizinhosMapaIpc,
} from "../../compartilhado/mapa";
import { CONFIRMACAO_APAGAR_MAPA } from "../../compartilhado/mapa";
import { Consultas, ErroConsulta, validarCaminhoRelativo } from "./consultas";
import { gerarExportacao, gravarExportacao, type EntradaRelatorio, type VistaExportavel } from "./exportar";
import { compararInventarios, type ItemInventario } from "./inventario";
import { carimboDe, gravarPacote, lerInventarioAnterior, limitarRaio } from "./pacote-contexto";
import type { OpcoesAnalisar, ServicoMapaCompleto } from "./servico";
import type { ArquivoImportante } from "./pacote-contexto";

// Fachada do mapa por workspace: junta o serviço (varredura/extração/derivada), as consultas e as saídas (exportação e pacote de
// contexto). É a única superfície que o main (IPC), o MCP e as portas das Fases 15, 18 e 19 enxergam. Nada aqui executa código do
// projeto; toda escrita no repositório do usuário vai SÓ para a pasta de pacotes do mapa (`<pasta do produto>/mapa/`) e nunca para `docs/**`.

export interface OpcoesFachada {
  /** Raiz ABSOLUTA do workspace. */
  raiz: string;
  /** Pasta padrão das exportações: `<userData>/mapas/<workspace_id>/exportacoes`. */
  pastaExportacao: string;
  /** Diálogo nativo (só o main abre). `null` = o usuário cancelou. */
  escolherPasta?: () => Promise<string | null>;
  agora?: () => Date;
}

export class FachadaMapa {
  constructor(
    readonly servico: ServicoMapaCompleto,
    private readonly op: OpcoesFachada,
  ) {}

  private c(): Consultas {
    return new Consultas(this.servico.armazem());
  }

  resumo(): ResumoMapaIpc {
    return this.servico.resumo();
  }
  analisar(modo: "completo" | "incremental", historia?: boolean, segundoPlano = false, arquivos?: readonly string[]): Promise<{ execucao_id: number }> {
    const o: OpcoesAnalisar = { modo, segundoPlano, ...(historia !== undefined ? { historia } : {}), ...(arquivos !== undefined ? { arquivos } : {}) };
    return this.servico.analisar(o);
  }
  async cancelar(): Promise<{ ok: true }> {
    await this.servico.cancelar();
    return { ok: true };
  }
  async apagar(confirmacao: string): Promise<{ ok: true }> {
    if (confirmacao !== CONFIRMACAO_APAGAR_MAPA) throw new ErroConsulta("argumento_invalido", "confirmação inválida: digite APAGAR");
    await this.servico.apagar(confirmacao);
    return { ok: true };
  }
  grafo(nivel: NivelGrafo, filtro?: FiltroGrafoMapa, limite?: number): GrafoMapaIpc {
    return this.c().grafo(nivel, filtro, limite);
  }
  vizinhos(noId: string, direcao?: DirecaoVizinhosIpc, profundidade?: number, limite?: number): VizinhosMapaIpc {
    return this.c().vizinhos(noId, direcao, profundidade, limite);
  }
  no(noId: string): NoDetalheMapa | null {
    return this.c().no(noId);
  }
  fluxo(entradaId: string, profundidade?: number, minConfianca?: ConfiancaIpc): FluxoMapaIpc {
    return this.c().fluxo(entradaId, profundidade, minConfianca);
  }
  analise<T extends TipoAnaliseMapa>(tipo: T, parametros?: ParametrosAnaliseMapa): ResultadoAnaliseMapa<T> {
    return this.c().analise(tipo, parametros);
  }
  raio(arquivos: string[], simbolos?: string[]): RaioMapaIpc {
    return this.c().raio(arquivos, simbolos);
  }
  perfil(): PerfilProvisorioMapa {
    return this.c().perfil();
  }
  buscar(texto: string, tipos?: TipoNoIpc[], limite?: number): ResultadoBuscaMapa[] {
    return this.c().buscar(texto, tipos, limite);
  }
  configLer(): ConfigMapa {
    return this.servico.config();
  }
  configGravar(parcial: Record<string, unknown>): ConfigMapa {
    return this.servico.gravarConfig(parcial);
  }
  layoutLer(chave: string): { nivel: string; posicoes: number[] } | null {
    return this.c().layoutLer(chave);
  }
  layoutGravar(chave: string, nivel: string, posicoes: number[]): { ok: true } {
    this.c().layoutGravar(chave, nivel, posicoes);
    return { ok: true };
  }

  // ---------------------------------------------------------------------------------------------
  // exportação (T-17.38): o destino NUNCA vem do renderer; `docs/**` é sempre recusado

  async exportar(formato: FormatoExportacaoMapa, vista: VistaExportacaoMapa, destino: DestinoExportacaoMapa = "padrao"): Promise<ResultadoExportacaoMapa> {
    const cons = this.c();
    const carimbo = carimboDe((this.op.agora ?? (() => new Date()))());
    let dados: Record<string, string>;
    if (formato === "md" || vista.tipo === "relatorio") {
      if (formato !== "md") throw new ErroConsulta("argumento_invalido", "a vista de relatório só exporta em Markdown");
      dados = gerarExportacao({ formato, relatorio: this.entradaRelatorio(cons), carimbo });
    } else {
      let v: VistaExportavel;
      if (vista.tipo === "grafo") v = cons.grafo(vista.nivel, vista.filtro ?? {}, vista.nivel === "modulo" ? 5000 : 3000);
      else v = cons.fluxo(vista.entrada_id, vista.profundidade);
      dados = gerarExportacao({ formato, vista: v, carimbo });
    }
    let pasta = this.op.pastaExportacao;
    if (destino === "escolher") {
      const escolhida = await this.op.escolherPasta?.();
      if (escolhida === null || escolhida === undefined) throw new ErroConsulta("argumento_invalido", "exportação cancelada");
      pasta = escolhida;
    }
    // `gravarExportacao` recusa qualquer destino dentro de `<raiz>/docs/` (inclusive por `..` e symlink)
    const r = gravarExportacao({ raiz: this.op.raiz, pasta, arquivos: dados });
    return { caminho: r.caminhos[0] as string, formato, bytes: r.bytes };
  }

  private entradaRelatorio(cons: Consultas): EntradaRelatorio {
    const resumo = this.servico.resumo();
    return {
      resumo,
      ciclos: cons.analise("ciclos").dados,
      camadas: cons.analise("camadas").dados,
      hotspots: cons.analise("hotspots").dados,
      entradas: cons.analise("entradas").dados,
      dados: cons.analise("dados").dados,
      externas: cons.analise("externas").dados,
      mortos: cons.analise("mortos").dados,
      sem_teste: cons.analise("sem_teste").dados,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // pacote de contexto (T-17.31): grava `<pasta do produto>/mapa/<carimbo>/` a partir das saídas já calculadas na fase derivada

  gerarPacote(raio?: { trabalho_id: string; arquivos: string[] }): { carimbo: string; pasta_rel: string; arquivos: string[] } {
    const a = this.servico.armazem();
    const inventario = a.lerAnaliseCache<ItemInventario[]>("saida:inventario");
    const perfil = a.lerAnaliseCache<PerfilProvisorioMapa>("saida:perfil");
    const resumoMd = a.lerAnaliseCache<{ texto: string }>("saida:resumo_md");
    const importantes = a.lerAnaliseCache<ArquivoImportante[]>("saida:importantes");
    const entradas = a.lerAnaliseCache<unknown>("saida:entradas");
    if (inventario === null || perfil === null || resumoMd === null || importantes === null || entradas === null) throw new ErroConsulta("mapa_nao_pronto", "analise o projeto antes de gerar o pacote de contexto");
    const carimbo = carimboDe((this.op.agora ?? (() => new Date()))());
    const anterior = lerInventarioAnterior(this.op.raiz);
    const mudancas = compararInventarios(inventario, anterior?.itens ?? null);
    let raioConteudo: { trabalho_id: string; json: unknown } | undefined;
    if (raio !== undefined) {
      const arquivosSeguros = raio.arquivos.map((c) => validarCaminhoRelativo(c));
      raioConteudo = { trabalho_id: raio.trabalho_id, json: limitarRaio(this.c().raio(arquivosSeguros)) };
    }
    const r = gravarPacote({
      raiz: this.op.raiz,
      carimbo,
      conteudo: { resumo_md: resumoMd.texto, inventario, perfil, entradas, arquivos_jsonl: `${importantes.slice(0, 500).map((x) => JSON.stringify(x)).join("\n")}\n`, mudancas, ...(raioConteudo !== undefined ? { raio: raioConteudo } : {}) },
    });
    a.gravarMeta("pacote_carimbo", carimbo);
    return { carimbo, pasta_rel: r.pasta_rel, arquivos: r.arquivos };
  }

  /** Pasta padrão das exportações (para a UI mostrar onde caiu). */
  pastaPadraoExportacao(): string {
    return join(this.op.pastaExportacao);
  }

  encerrar(): Promise<void> {
    return this.servico.encerrar();
  }
}

export function criarFachadaMapa(servico: ServicoMapaCompleto, op: OpcoesFachada): FachadaMapa {
  return new FachadaMapa(servico, op);
}

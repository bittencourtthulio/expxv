// Lógica PURA da tela Loja de MCPs (Fase 7B): filtro/busca sobre o cache, estado do botão primário, selos, mensagens nominais e
// validações locais. Nada aqui toca `window.ade` nem o DOM (testável sem React). Nenhum segredo passa por este módulo.
import { criarIndice, type IndiceFuzzy } from "../../busca-fuzzy";
import type {
  CandidatoMcpDto, CartaoMcp, CategoriaMcpDto, CliLojaMcp, DiagnosticoLojaMcp, NivelIsolamentoMcp, NivelVerificacaoDto, SeloGratuitoDto,
} from "../../../compartilhado/loja-mcp";

export const CATEGORIAS: ReadonlyArray<[CategoriaMcpDto, string]> = [
  ["codigo_repositorios", "Código e repositórios"],
  ["documentacao_conhecimento", "Documentação e conhecimento"],
  ["web_pesquisa", "Web e pesquisa"],
  ["navegador_testes", "Navegador e testes"],
  ["bancos_dados", "Bancos de dados"],
  ["nuvem_infra", "Nuvem e infraestrutura"],
  ["observabilidade_qualidade", "Observabilidade e qualidade"],
  ["gestao_comunicacao", "Gestão e comunicação"],
  ["raciocinio_memoria", "Raciocínio e memória"],
  ["execucao_sandbox", "Execução e sandbox"],
  ["pagamentos_apis", "Pagamentos e APIs"],
];
const ROTULO_CATEGORIA = new Map<string, string>(CATEGORIAS);
export const rotuloCategoria = (c: string): string => ROTULO_CATEGORIA.get(c) ?? c;

export interface FiltrosLoja {
  busca: string;
  categoria: CategoriaMcpDto | "todas";
  /** só o que pode ser instalado (confirmado, não descartado). */
  instalavel: boolean;
  instalado: boolean;
  gratuito: boolean;
  noKit: boolean;
}
export const FILTROS_VAZIOS: FiltrosLoja = { busca: "", categoria: "todas", instalavel: false, instalado: false, gratuito: false, noKit: false };
export const temFiltroAtivo = (f: FiltrosLoja): boolean =>
  f.busca.trim() !== "" || f.categoria !== "todas" || f.instalavel || f.instalado || f.gratuito || f.noKit;

const gratuitoOuPlano = (s: SeloGratuitoDto): boolean => s === "gratis" || s === "plano_gratis";

/** Texto indexado pela busca fuzzy (uma vez por lista; a digitação nunca gera IPC). */
export const textoDoCartao = (c: CartaoMcp): string => `${c.nome} ${c.id} ${c.descricao_pt} ${rotuloCategoria(c.categoria)} ${c.mantenedor_nome} ${c.tools_principais.join(" ")}`;
export const criarIndiceCartoes = (cartoes: readonly CartaoMcp[]): IndiceFuzzy<CartaoMcp> => criarIndice(cartoes, textoDoCartao);

/** Aplica busca (fuzzy, ordenada por relevância) e filtros. Sem busca, a ordem do catálogo é mantida. */
export function filtrarCartoes(cartoes: readonly CartaoMcp[], f: FiltrosLoja, indice?: IndiceFuzzy<CartaoMcp>): CartaoMcp[] {
  const base = f.busca.trim() === "" ? cartoes : (indice ?? criarIndiceCartoes(cartoes)).buscar(f.busca, cartoes.length);
  return base.filter((c) =>
    (f.categoria === "todas" || c.categoria === f.categoria)
    && (!f.instalavel || c.instalavel)
    && (!f.instalado || c.instalado !== null)
    && (!f.gratuito || gratuitoOuPlano(c.selo_gratuito))
    && (!f.noKit || c.no_kit));
}

// ---- riscos ----
const ORDEM_RISCO = ["execucao_codigo", "escrita_remota", "segredos", "dados_sensiveis", "acesso_disco", "custo_externo", "prompt_injection", "rede_saida"] as const;
export const ROTULO_RISCO: Record<string, string> = {
  execucao_codigo: "executa código", escrita_remota: "escreve em serviço remoto", segredos: "usa segredos", dados_sensiveis: "dados sensíveis",
  acesso_disco: "acessa disco", custo_externo: "custo externo", prompt_injection: "prompt injection", rede_saida: "rede de saída",
};
export type TomSelo = "neutro" | "destaque" | "sucesso" | "aviso" | "alerta";
const TOM_RISCO: Record<string, TomSelo> = {
  execucao_codigo: "alerta", escrita_remota: "alerta", segredos: "aviso", dados_sensiveis: "aviso", acesso_disco: "aviso", custo_externo: "aviso", prompt_injection: "neutro", rede_saida: "neutro",
};
export interface SeloRisco { id: string; rotulo: string; tom: TomSelo }
/** O risco mais grave da lista (ordem fixa de severidade); `null` quando não declara nenhum. */
export function riscoMaximo(riscos: readonly string[]): SeloRisco | null {
  for (const r of ORDEM_RISCO) if (riscos.includes(r)) return { id: r, rotulo: ROTULO_RISCO[r] ?? r, tom: TOM_RISCO[r] ?? "neutro" };
  const outro = riscos[0];
  return outro === undefined ? null : { id: outro, rotulo: ROTULO_RISCO[outro] ?? outro, tom: "neutro" };
}
export const rotuloRisco = (r: string): string => ROTULO_RISCO[r] ?? r;

// ---- selos ----
export const ROTULO_GRATUITO: Record<SeloGratuitoDto, [string, TomSelo]> = {
  gratis: ["grátis", "sucesso"], plano_gratis: ["plano grátis", "sucesso"], pago: ["pago", "aviso"], nao_confirmado: ["preço n/c", "neutro"],
};
export function seloAutenticacao(c: Pick<CartaoMcp, "autenticacao" | "pede_chave">): string | null {
  if (c.autenticacao === "oauth") return "OAuth pela CLI";
  if (c.pede_chave || c.autenticacao === "chave_api" || c.autenticacao === "token") return "pede chave";
  return null;
}
export const ROTULO_NIVEL: Record<NivelVerificacaoDto, string> = { forte: "forte (lock + integridade)", padrao: "padrão (integridade + assinatura)", remoto: "remoto (sem pacote local)" };

// ---- botão primário (um por estado) ----
export type TipoAcao = "instalar" | "instalando" | "tentar_de_novo" | "configurar" | "atualizar" | "habilitar" | "gerenciar" | "nenhuma";
export interface AcaoPrimaria { tipo: TipoAcao; rotulo: string; desabilitada: boolean; motivo: string | null }
/**
 * Um único botão primário por estado do cartão: Instalar | Instalando… | Configurar | Atualizar | Habilitar | Gerenciar.
 * `habilitadoNoWorkspace` vem de `habilitacoes` (deny-by-default: sem linha = não habilitado).
 */
export function acaoPrimaria(c: CartaoMcp, habilitadoNoWorkspace: boolean, instalando: boolean, somenteLeitura: boolean): AcaoPrimaria {
  if (instalando || c.instalado?.estado === "instalando") return { tipo: "instalando", rotulo: "Instalando…", desabilitada: true, motivo: null };
  if (c.instalado === null) {
    if (!c.instalavel) return { tipo: "nenhuma", rotulo: c.confirmado ? "Indisponível" : "Não confirmado", desabilitada: true, motivo: c.motivo_nao_instalavel };
    return { tipo: "instalar", rotulo: "Instalar", desabilitada: somenteLeitura, motivo: somenteLeitura ? "Catálogo somente leitura" : null };
  }
  if (c.instalado.estado === "falhou") return { tipo: "tentar_de_novo", rotulo: "Tentar de novo", desabilitada: somenteLeitura || !c.instalavel, motivo: c.motivo_nao_instalavel };
  if (c.instalado.estado === "removendo") return { tipo: "instalando", rotulo: "Removendo…", desabilitada: true, motivo: null };
  if (c.precisa_configurar) return { tipo: "configurar", rotulo: "Configurar", desabilitada: false, motivo: null };
  if (c.instalado.atualizacao_disponivel) return { tipo: "atualizar", rotulo: "Atualizar", desabilitada: somenteLeitura, motivo: null };
  return habilitadoNoWorkspace
    ? { tipo: "gerenciar", rotulo: "Gerenciar", desabilitada: false, motivo: null }
    : { tipo: "habilitar", rotulo: "Habilitar", desabilitada: false, motivo: null };
}

// ---- isolamento por CLI (selo honesto, D-44/D-136) ----
export const ROTULO_CLI: Record<CliLojaMcp, string> = { claude: "Claude Code", codex: "Codex", opencode: "OpenCode", gemini: "Gemini" };
export const ROTULO_ISOLAMENTO: Record<NivelIsolamentoMcp, string> = { duro: "isolamento total", parcial: "isolamento parcial", nenhum: "sem injeção por Pane" };
export const TOM_ISOLAMENTO: Record<NivelIsolamentoMcp, TomSelo> = { duro: "sucesso", parcial: "aviso", nenhum: "alerta" };
export const CLIS: readonly CliLojaMcp[] = ["claude", "codex", "opencode", "gemini"];

// ---- mensagens nominais (códigos do main; nunca texto de instalador, caminho ou segredo) ----
const MENSAGENS: Record<string, string> = {
  nao_configurado: "Faltam variáveis obrigatórias. Configure antes de habilitar.",
  cofre_indisponivel: "O cofre do sistema não está disponível; não é possível guardar a chave.",
  valor_vazio: "Informe um valor.",
  quebra_de_linha: "O valor não pode ter quebra de linha.",
  variavel_desconhecida: "Variável não declarada por este servidor.",
  nao_confirmado: "Entrada não confirmada no catálogo: não é instalável.",
  nao_instalavel: "Este servidor não pode ser instalado.",
  descartado: "Servidor descartado do catálogo.",
  bloqueado: "Servidor na lista de bloqueio.",
  consentimento_invalido: "O comando mudou depois que você leu o plano. Revise e confirme de novo.",
  plano_recusado: "O plano de instalação foi recusado. Veja o motivo no detalhe.",
  prerequisito_ausente: "Falta um pré-requisito (npm, uv ou Docker). Veja o aviso no topo da Loja.",
  integridade_divergente: "A integridade do pacote não confere com o catálogo: nada foi instalado.",
  lock_divergente: "O arquivo de lock não confere com o catálogo: nada foi instalado.",
  rede_indisponivel: "Sem rede para instalar. A Loja continua navegável; tente de novo quando houver conexão.",
  falha_instalacao: "A instalação falhou e foi desfeita. Veja os logs do servidor.",
  saude_falhou_restaurado: "A nova versão não passou no teste de saúde; a anterior foi restaurada.",
  em_uso: "Servidor em uso por um terminal. Feche o terminal e tente de novo.",
  ja_instalado: "Já está instalado.",
  ja_instalando: "Já há uma instalação em andamento.",
  nao_instalado: "O servidor não está instalado.",
  sem_atualizacao: "Não há atualização disponível.",
  cancelado: "Instalação cancelada.",
  confirmacao_invalida: "A confirmação digitada não confere com o nome mostrado.",
  cli_sem_suporte: "Esta CLI não permite instalar servidor por comando.",
  cli_nao_encontrada: "CLI não encontrada neste computador.",
  nao_criado_pelo_app: "O app só remove o que ele mesmo criou na sua CLI.",
  alvo_invalido: "Alvo inválido para a habilitação.",
  catalogo_invalido: "Catálogo inválido: a Loja abre só para leitura.",
  catalogo_ilegivel: "Catálogo ilegível: a Loja abre só para leitura.",
  catalogo_desconhecido: "Servidor desconhecido no catálogo.",
  timeout: "Tempo esgotado no teste (3 s).",
  nao_autorizado: "O servidor recusou a credencial.",
  processo_encerrou: "O servidor encerrou durante o teste.",
  saida_invalida: "O servidor respondeu algo que não é MCP.",
  protocolo_incompativel: "Versão de protocolo incompatível.",
};
export function mensagemDoCodigo(codigo: string | null | undefined, padrao = "Não foi possível concluir a operação."): string {
  if (codigo === null || codigo === undefined || codigo === "") return padrao;
  return MENSAGENS[codigo] ?? padrao;
}
export const mensagemDoErro = (e: unknown): string => {
  const t = e instanceof Error ? e.message : "";
  // erros nominais do main chegam como mensagem curta e sem caminho; qualquer coisa com barra/stack vira texto genérico
  return t !== "" && t.length <= 200 && !/[\\/]|\n/.test(t) ? t : "Não foi possível concluir a operação.";
};

// ---- confirmação digitada ("instalar na minha CLI") ----
export const confirmacaoConfere = (digitado: string, nomeNaCli: string): boolean => nomeNaCli !== "" && digitado.trim() === nomeNaCli;

// ---- valores de variável (só validação local; o valor nunca é guardado) ----
export function problemaDoValor(valor: string): string | null {
  if (valor === "") return mensagemDoCodigo("valor_vazio");
  if (/[\r\n]/.test(valor)) return mensagemDoCodigo("quebra_de_linha");
  if (new TextEncoder().encode(valor).length > 4096) return "O valor passa de 4 KB.";
  return null;
}

// ---- diagnóstico (npm/uv ausentes) ----
export interface AvisoAmbiente { id: string; texto: string }
/** Avisos acionáveis; `cartoes` limita a mensagem ao que a pessoa realmente quer instalar. */
export function avisosDoDiagnostico(d: DiagnosticoLojaMcp | null, cartoes: readonly CartaoMcp[] = []): AvisoAmbiente[] {
  if (d === null) return [];
  const avisos: AvisoAmbiente[] = [];
  const usa = (m: string): boolean => cartoes.length === 0 || cartoes.some((c) => c.metodo === m && c.instalavel);
  if ((!d.npm.ok || !d.node.ok) && usa("npm")) avisos.push({ id: "npm", texto: "Node/npm não encontrado: os servidores npm não instalam. Instale o Node.js (versão LTS) e abra a Loja de novo. Servidores remotos funcionam sem isso." });
  if (!d.uv.ok && usa("uvx")) avisos.push({ id: "uv", texto: "uv não encontrado: os servidores Python não instalam. Instale o uv (docs.astral.sh/uv) e abra a Loja de novo." });
  if (!d.cofre.disponivel) avisos.push({ id: "cofre", texto: "O cofre do sistema está indisponível: servidores que pedem chave não podem ser configurados." });
  return avisos;
}

// ---- formatação ----
export const formatarLatencia = (ms: number | null): string => (ms === null ? "—" : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
export function resumoSaude(s: CartaoMcp["saude"]): { rotulo: string; tom: TomSelo } {
  if (s === null || s.estado === "nao_testado") return { rotulo: "não testado", tom: "neutro" };
  if (s.estado === "ok") return { rotulo: `ok · ${s.n_ferramentas ?? 0} ferramentas · ${formatarLatencia(s.latencia_ms)}`, tom: "sucesso" };
  return { rotulo: `indisponível${s.erro_codigo !== null ? ` · ${mensagemDoCodigo(s.erro_codigo, s.erro_codigo)}` : ""}`, tom: "alerta" };
}
export const ALTURA_CARTAO = 64;

// ---- descoberta no Registro Oficial (T-07B.32): rascunho para curadoria humana ----
const slugDe = (nome: string): string => nome.toLowerCase().replace(/^io\.github\./, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "servidor";
/**
 * Rascunho de entrada do catálogo a partir de um candidato do registro: SEMPRE `confirmado:false` (não instalável), sem versão, sem
 * integridade e sem comando; a curadoria humana preenche o resto. Só texto: nada é gravado nem enviado (o botão copia).
 */
export function rascunhoDeEntrada(c: CandidatoMcpDto, hoje: string): string {
  return `${JSON.stringify({
    id: slugDe(c.nome), nome: c.nome.split("/").pop() ?? c.nome, descricao_pt: c.descricao, categoria: "codigo_repositorios", classificacao: "opcional",
    motivo_classificacao: "Descoberto no Registro Oficial do MCP; aguardando curadoria.", mantenedor: c.namespace_verificado ? "oficial" : "comunidade",
    mantenedor_nome: c.nome.split("/")[0] ?? "", licenca_spdx: null, gratuito: "nao_confirmado", plano_gratis_detalhe: null,
    instalacao: { metodo: "remoto", pacote: null, versao: null, integridade: null, data_versao: null },
    transporte: "streamable_http", comando: null, bin: null, args: [], url: null, autenticacao: "nenhuma", variaveis: [], tools_principais: [], riscos: [], riscos_texto: "A preencher pela curadoria.",
    maturidade: { ultima_release: null, status: "desconhecido", arquivado: false }, escopos_recomendados: ["workspace"], links: { repo: c.repositorio, docs: null },
    fontes: [{ url: "https://registry.modelcontextprotocol.io/", consultado_em: hoje, para: "Registro Oficial do MCP (descoberta)" }], confirmado: false, observacoes: "Rascunho gerado localmente; nada foi enviado.",
  }, null, 2)}\n`;
}

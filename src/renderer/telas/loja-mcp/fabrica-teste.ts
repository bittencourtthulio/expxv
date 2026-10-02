// Fabricação de dados e API falsa da Loja de MCPs (só teste). Nenhum segredo: o "valor" gravado fica só no espião do teste.
import type { ApiAde } from "../../../compartilhado/ipc";
import type {
  CartaoMcp, DetalheMcp, DiagnosticoLojaMcp, EstadoKitMcp, EventoLojaMcp, HabilitacaoMcp, ListaLojaMcp, PlanoInstalacaoDto, PlanoKitMcp,
} from "../../../compartilhado/loja-mcp";

export const HASH = "a".repeat(64);
export const HASH_KIT = "b".repeat(64);

export function cartao(id: string, extra: Partial<CartaoMcp> = {}): CartaoMcp {
  return {
    id, nome: `Servidor ${id}`, descricao_pt: `Descrição do ${id}`, categoria: "documentacao_conhecimento", classificacao: "opcional", mantenedor: "oficial",
    mantenedor_nome: "Acme", licenca_spdx: "MIT", licenca_restritiva: false, selo_gratuito: "gratis", pede_chave: false, autenticacao: "nenhuma", metodo: "npm",
    transporte: "stdio", versao: "1.0.0", riscos: ["rede_saida"], confirmado: true, instalavel: true, motivo_nao_instalavel: null, tools_principais: ["buscar"],
    instalado: null, saude: null, precisa_configurar: false, no_kit: false, ...extra,
  };
}
export const instalado = (extra: Partial<NonNullable<CartaoMcp["instalado"]>> = {}): NonNullable<CartaoMcp["instalado"]> => ({
  estado: "instalado", versao: "1.0.0", nivel_verificacao: "padrao", erro_codigo: null, instalado_em: "2026-10-01T00:00:00Z", atualizacao_disponivel: false, ...extra,
});

export function plano(id: string, extra: Partial<PlanoInstalacaoDto> = {}): PlanoInstalacaoDto {
  return {
    id, nome: `Servidor ${id}`, versao: "1.0.0", metodo: "npm", nivel_verificacao: "padrao",
    passos: [{ id: "baixar", rotulo: "Baixar", detalhe: "registry.npmjs.org", aplicavel: true, requer_clique: true }],
    comando_exato: `/app/mcp/${id}/node_modules/.bin/${id}`,
    comando_instalacao: [`npm install --prefix /app/mcp/.tmp/${id} --ignore-scripts --save-exact pacote-${id}@1.0.0`],
    pasta: `/app/mcp/${id}`,
    permissoes: {
      comando_exato: `/app/mcp/${id}/node_modules/.bin/${id}`, versao_pinada: "1.0.0", integridade: "sha512-abcdefabcdefabcdefabcdefabcdef", pasta: `/app/mcp/${id}`, escrita_em_disco: [],
      hosts_rede: { instalacao: ["registry.npmjs.org"], execucao: ["api.exemplo.com"], execucao_livre: false },
      variaveis: [], riscos: ["rede_saida"], riscos_texto: "Envia consultas a um terceiro.", nivel_verificacao: "padrao", scripts_permitidos: false,
    },
    comando_hash: HASH, avisos: [], ...extra,
  };
}

export function detalhe(c: CartaoMcp, extra: Partial<DetalheMcp> = {}): DetalheMcp {
  const p = plano(c.id);
  return {
    ...c, permissoes: { ...p.permissoes, variaveis: c.precisa_configurar ? [{ nome: "API_KEY", obrigatoria: true, secreta: true, ajuda: "Chave da API", onde_conseguir: "https://exemplo.com/chaves" }] : [] },
    permissoes_erro: null,
    variaveis: c.precisa_configurar ? [{ nome: "API_KEY", obrigatoria: true, secreta: true, definida: false }] : [],
    ferramentas: [], fontes: [{ url: "https://exemplo.com/docs", consultado_em: "2026-09-30", para: "documentação" }],
    links: { repo: "https://github.com/acme/x", docs: null }, riscos_texto: "Envia consultas a um terceiro.", observacoes: null,
    maturidade: { ultima_release: "2026-09-01", status: "ativo", arquivado: false }, plano_atualizacao_disponivel: false, clis: [], ...extra,
  };
}

export const DIAGNOSTICO_OK: DiagnosticoLojaMcp = { npm: { ok: true, versao: "10.0.0" }, node: { ok: true, versao: "22.0.0" }, uv: { ok: true, versao: "0.5.0" }, docker: { ok: false }, cofre: { disponivel: true } };

export const CARTOES_PADRAO: CartaoMcp[] = [
  cartao("context7", { nome: "Context7", no_kit: true, classificacao: "pre_instalado_habilitado" }),
  cartao("deepwiki", { nome: "DeepWiki", metodo: "remoto", transporte: "streamable_http", no_kit: true }),
  cartao("playwright", { nome: "Playwright", categoria: "navegador_testes", riscos: ["execucao_codigo", "rede_saida"], mantenedor: "comunidade", selo_gratuito: "gratis" }),
  cartao("sentry", { nome: "Sentry", categoria: "observabilidade_qualidade", selo_gratuito: "plano_gratis", autenticacao: "token", pede_chave: true, instalado: instalado(), precisa_configurar: true }),
  cartao("pago", { nome: "Servico Pago", selo_gratuito: "pago" }),
  cartao("duvida", { nome: "Em duvida", confirmado: false, instalavel: false, motivo_nao_instalavel: "Não confirmado pela curadoria." }),
];

export interface OpcoesApiFalsa {
  cartoes?: CartaoMcp[];
  somenteLeitura?: boolean;
  diagnostico?: DiagnosticoLojaMcp;
  habilitacoes?: HabilitacaoMcp[];
}

type Api = ApiAde["lojaMcp"];

/** Implementação simples e determinística; o teste troca métodos por `vi.fn` quando quer espionar. */
export function lojaMcpFalsa(o: OpcoesApiFalsa = {}): Api {
  const cartoes = o.cartoes ?? CARTOES_PADRAO;
  const lista = (): ListaLojaMcp => ({ entradas: cartoes, seed_versao: "1", gerado_em: "2026-09-30", somente_leitura: o.somenteLeitura === true, aviso: o.somenteLeitura === true ? "catálogo adulterado" : null });
  const kit: EstadoKitMcp = { opt_out: false, itens: [], pendentes: [] };
  const planoKit: PlanoKitMcp = { planos: [plano("context7"), plano("sequential-thinking")], bloqueios: [], comando_hash: HASH_KIT };
  return {
    listar: async () => lista(),
    detalhe: async (id) => { const c = cartoes.find((x) => x.id === id); return c === undefined ? null : detalhe(c); },
    planoInstalacao: async (ids) => ({ planos: ids.map((id) => plano(id)), bloqueios: [] }),
    instalar: async () => ({ instalacao_id: "inst_abc123" }),
    cancelar: async () => ({ ok: true }),
    desinstalar: async () => ({ ok: true, codigo: null, residuos: [] }),
    planoAtualizacao: async () => null,
    atualizar: async () => ({ instalacao_id: "inst_abc124" }),
    variaveisEstado: async (id) => (cartoes.find((x) => x.id === id)?.precisa_configurar ? [{ nome: "API_KEY", obrigatoria: true, secreta: true, definida: false }] : []),
    gravarVariavel: async () => ({ ok: true, codigo: null }),
    apagarVariavel: async () => ({ ok: true }),
    testar: async () => ({ estado: "ok", n_ferramentas: 3, latencia_ms: 120, erro: null, variaveis_faltando: [] }),
    habilitar: async () => ({ ok: true, codigo: null, detalhe: null }),
    habilitacoes: async () => o.habilitacoes ?? [],
    previaCliUsuario: async (id, cli) => ({ ok: true, previa: { cli, nome_na_cli: `ev_${id.replace(/-/g, "_")}`, texto: `${cli} mcp add --scope user ev_${id.replace(/-/g, "_")} -- /app/x`, avisos: [] } }),
    instalarNaCli: async () => ({ ok: true, codigo: null, motivo: null }),
    removerDaCli: async () => ({ ok: true, codigo: null, motivo: null }),
    logs: async () => [],
    kitEstado: async () => kit,
    kitPlano: async () => planoKit,
    kitInstalar: async () => ({ instalacao_id: "inst_kit001" }),
    kitOptOut: async () => kit,
    diagnostico: async () => o.diagnostico ?? DIAGNOSTICO_OK,
    descobrir: async () => ({ candidatos: [], descartados: 0, aviso: null }),
    assinar: () => () => undefined,
  };
}

/** Evento de progresso/estado para testes. */
export const eventoProgresso = (id: string, passo: number, rotulo: string, instalacao_id = "inst_abc123"): EventoLojaMcp => ({ tipo: "progresso", instalacao_id, id, passo, rotulo });

// Esquema e validador estrito do catálogo de curadoria da Loja de MCPs (Fase 7B, T-07B.02).
// Lógica pura, sem Electron e sem dependência nova. Campo desconhecido é recusado em todos os níveis:
// um campo de segurança que o validador não conhece não pode passar calado.
// Os tipos vivem aqui até o coordenador movê-los para `src/compartilhado/loja-mcp.ts` (T-07B.01).

export const CATEGORIAS_MCP = [
  "codigo_repositorios", "documentacao_conhecimento", "web_pesquisa", "navegador_testes", "bancos_dados",
  "nuvem_infra", "observabilidade_qualidade", "gestao_comunicacao", "raciocinio_memoria", "execucao_sandbox",
  "pagamentos_apis",
] as const;
export type CategoriaMcp = (typeof CATEGORIAS_MCP)[number];

export const CLASSIFICACOES_MCP = ["pre_instalado_habilitado", "pre_configurado", "opcional", "descartado"] as const;
export type ClassificacaoMcp = (typeof CLASSIFICACOES_MCP)[number];

export const METODOS_INSTALACAO_MCP = ["npm", "uvx", "binario", "docker", "remoto"] as const;
export type MetodoInstalacaoMcp = (typeof METODOS_INSTALACAO_MCP)[number];

export const TRANSPORTES_MCP = ["stdio", "streamable_http", "sse"] as const;
export type TransporteMcp = (typeof TRANSPORTES_MCP)[number];

export const AUTENTICACOES_MCP = ["nenhuma", "chave_api", "oauth", "token"] as const;
export type AutenticacaoMcp = (typeof AUTENTICACOES_MCP)[number];

export const RISCOS_MCP = [
  "acesso_disco", "rede_saida", "segredos", "execucao_codigo", "prompt_injection", "escrita_remota",
  "dados_sensiveis", "custo_externo",
] as const;
export type RiscoMcp = (typeof RISCOS_MCP)[number];

export type NivelVerificacao = "forte" | "padrao" | "remoto";
export type GratuitoMcp = "gratis_open_source" | "plano_gratis" | "pago" | "nao_confirmado";
export type EscopoMcp = "workspace" | "missao" | "agente";

export interface VariavelMcp {
  nome: string;
  obrigatoria: boolean;
  secreta: boolean;
  ajuda: string;
  onde_conseguir: string | null;
}

export interface ArtefatoMcp { url: string; sha256: string }

export interface InstalacaoMcp {
  metodo: MetodoInstalacaoMcp;
  pacote: string | null;
  versao: string | null;
  integridade: string | null;
  data_versao: string | null;
  lock_sha256?: string | null;
  scripts_permitidos?: boolean;
  artefatos?: Record<string, ArtefatoMcp>;
  versao_observada?: string | null;
  integridade_observada?: string | null;
}

export interface EntradaMcp {
  id: string;
  nome: string;
  descricao_pt: string;
  categoria: CategoriaMcp;
  classificacao: ClassificacaoMcp;
  motivo_classificacao: string;
  mantenedor: "oficial" | "comunidade";
  mantenedor_nome: string;
  licenca_spdx: string | null;
  gratuito: GratuitoMcp;
  plano_gratis_detalhe: string | null;
  instalacao: InstalacaoMcp;
  transporte: TransporteMcp;
  comando: string | null;
  bin: string | null;
  args: string[];
  url: string | null;
  autenticacao: AutenticacaoMcp;
  variaveis: VariavelMcp[];
  tools_principais: string[];
  riscos: RiscoMcp[];
  riscos_texto: string;
  maturidade: { ultima_release: string | null; status: "ativo" | "manutencao" | "arquivado" | "desconhecido"; arquivado: boolean };
  escopos_recomendados: EscopoMcp[];
  links: { repo: string | null; docs: string | null };
  fontes: Array<{ url: string; consultado_em: string; para: string }>;
  confirmado: boolean;
  observacoes: string | null;
}

export interface CatalogoMcp {
  schema_version: 1;
  seed_versao?: string;
  gerado_em: string;
  fonte: string;
  aviso?: string;
  entradas: EntradaMcp[];
}

export interface ErroEsquema {
  /** Caminho no JSON, ex.: `entradas[3].instalacao.versao`. */
  caminho: string;
  /** Código estável para teste e UI. */
  codigo: string;
  mensagem: string;
}

export type ResultadoValidacao =
  | { ok: true; catalogo: CatalogoMcp }
  | { ok: false; erros: ErroEsquema[] };

export const SCHEMA_VERSION = 1;

const RE_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const RE_VAR = /^[A-Z][A-Z0-9_]{1,63}$/;
const RE_VERSAO = /^\d+(\.\d+){1,2}([-+.][0-9A-Za-z.-]+)?$/;
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_NPM_INTEGRIDADE = /^sha512-[A-Za-z0-9+/]{86}==$/;
const RE_SHA256_PREFIXO = /^sha256:[0-9a-f]{64}$/;
const RE_SHA256_HEX = /^[0-9a-f]{64}$/;
const RE_RELEASE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/releases\/download\/[^\s]+$/;
const RE_DOCKER_DIGEST = /@sha256:[0-9a-f]{64}$/;
const RE_METACARACTERES = /[;|&$`]/;
const RE_PLACEHOLDER = /\{\{([^{}]*)\}\}/g;
const PLATAFORMAS = new Set(["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"]);

/** Padrões que parecem segredo; nenhum campo do catálogo pode carregar um valor assim. */
export const PADROES_SEGREDO: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{12,}/,
  /\bghp_[A-Za-z0-9]{10,}/,
  /\bgithub_pat_[A-Za-z0-9_]{10,}/,
  /\bAKIA[0-9A-Z]{12,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{8,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

const CAMPOS_RAIZ = new Set(["schema_version", "seed_versao", "gerado_em", "fonte", "aviso", "entradas"]);
const CAMPOS_ENTRADA = new Set([
  "id", "nome", "descricao_pt", "categoria", "classificacao", "motivo_classificacao", "mantenedor", "mantenedor_nome",
  "licenca_spdx", "gratuito", "plano_gratis_detalhe", "instalacao", "transporte", "comando", "bin", "args", "url",
  "autenticacao", "variaveis", "tools_principais", "riscos", "riscos_texto", "maturidade", "escopos_recomendados",
  "links", "fontes", "confirmado", "observacoes",
]);
const CAMPOS_INSTALACAO = new Set([
  "metodo", "pacote", "versao", "integridade", "data_versao", "lock_sha256", "scripts_permitidos", "artefatos",
  "versao_observada", "integridade_observada",
]);
const CAMPOS_VARIAVEL = new Set(["nome", "obrigatoria", "secreta", "ajuda", "onde_conseguir"]);
const CAMPOS_MATURIDADE = new Set(["ultima_release", "status", "arquivado"]);
const CAMPOS_LINKS = new Set(["repo", "docs"]);
const CAMPOS_FONTE = new Set(["url", "consultado_em", "para"]);
const CAMPOS_ARTEFATO = new Set(["url", "sha256"]);

type Obj = Record<string, unknown>;
const ehObjeto = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const ehTexto = (v: unknown): v is string => typeof v === "string";
const ehTextoNaoVazio = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const ehHttps = (v: unknown): v is string => {
  if (typeof v !== "string") return false;
  try { const u = new URL(v.replace(/\{\{[^{}]*\}\}/g, "x")); return u.protocol === "https:" && u.hostname.length > 0 && !u.username && !u.password; } catch { return false; }
};
const em = <T extends string>(lista: readonly T[], v: unknown): v is T => typeof v === "string" && (lista as readonly string[]).includes(v);

class Coletor {
  readonly erros: ErroEsquema[] = [];
  erro(caminho: string, codigo: string, mensagem: string): void { this.erros.push({ caminho, codigo, mensagem }); }
  campos(o: Obj, permitidos: Set<string>, caminho: string): void {
    for (const k of Object.keys(o)) if (!permitidos.has(k)) this.erro(`${caminho}.${k}`, "campo_desconhecido", `campo desconhecido "${k}"`);
  }
}

/** Placeholders de um texto (args/url): devolve os tokens internos `{{...}}`. */
export function placeholdersDe(texto: string): string[] {
  return [...texto.matchAll(RE_PLACEHOLDER)].map((m) => m[1] ?? "");
}

const semPlaceholders = (texto: string): string => texto.replace(RE_PLACEHOLDER, "");

function validarTexto(c: Coletor, o: Obj, campo: string, caminho: string, opcional = false): void {
  const v = o[campo];
  if (v === undefined) { c.erro(`${caminho}.${campo}`, "campo_ausente", `campo "${campo}" ausente`); return; }
  if (opcional && v === null) return;
  if (!ehTextoNaoVazio(v)) c.erro(`${caminho}.${campo}`, "tipo_invalido", `"${campo}" deve ser texto não vazio`);
}

function varreduraSegredo(c: Coletor, valor: unknown, caminho: string): void {
  if (typeof valor === "string") {
    for (const p of PADROES_SEGREDO) if (p.test(valor)) { c.erro(caminho, "segredo_no_catalogo", "valor com padrão de segredo no catálogo"); return; }
  } else if (Array.isArray(valor)) valor.forEach((v, i) => varreduraSegredo(c, v, `${caminho}[${i}]`));
  else if (ehObjeto(valor)) for (const [k, v] of Object.entries(valor)) varreduraSegredo(c, v, `${caminho}.${k}`);
}

function validarVariaveis(c: Coletor, e: Obj, caminho: string): Map<string, VariavelMcp> {
  const mapa = new Map<string, VariavelMcp>();
  const lista = e["variaveis"];
  if (!Array.isArray(lista)) { c.erro(`${caminho}.variaveis`, "tipo_invalido", "variaveis deve ser lista"); return mapa; }
  lista.forEach((v, i) => {
    const cv = `${caminho}.variaveis[${i}]`;
    if (!ehObjeto(v)) { c.erro(cv, "tipo_invalido", "variável deve ser objeto"); return; }
    c.campos(v, CAMPOS_VARIAVEL, cv);
    if (!ehTexto(v["nome"]) || !RE_VAR.test(v["nome"])) c.erro(`${cv}.nome`, "nome_variavel_invalido", "nome de variável deve casar ^[A-Z][A-Z0-9_]{1,63}$");
    if (typeof v["obrigatoria"] !== "boolean") c.erro(`${cv}.obrigatoria`, "tipo_invalido", "obrigatoria deve ser booleano");
    if (typeof v["secreta"] !== "boolean") c.erro(`${cv}.secreta`, "tipo_invalido", "secreta deve ser booleano");
    if (!ehTextoNaoVazio(v["ajuda"])) c.erro(`${cv}.ajuda`, "tipo_invalido", "ajuda deve ser texto não vazio");
    const onde = v["onde_conseguir"];
    if (onde !== null && !ehHttps(onde)) c.erro(`${cv}.onde_conseguir`, "url_invalida", "onde_conseguir deve ser null ou URL https");
    if (ehTexto(v["nome"])) {
      if (mapa.has(v["nome"])) c.erro(`${cv}.nome`, "variavel_duplicada", `variável "${v["nome"]}" duplicada`);
      mapa.set(v["nome"], v as unknown as VariavelMcp);
    }
  });
  return mapa;
}

function validarPlaceholders(c: Coletor, texto: string, caminho: string, vars: Map<string, VariavelMcp>, ehUrl: boolean, confirmado: boolean): void {
  for (const token of placeholdersDe(texto)) {
    if (token === "WORKSPACE" || token === "SERVIDOR_DIR") { if (ehUrl) c.erro(caminho, "placeholder_invalido", `{{${token}}} não vale em URL`); continue; }
    const m = /^(SEGREDO|VAR):([A-Z][A-Z0-9_]{1,63})$/.exec(token);
    if (!m) { c.erro(caminho, "placeholder_desconhecido", `placeholder desconhecido {{${token}}}`); continue; }
    const [, tipo, nome] = m as unknown as [string, string, string];
    const decl = vars.get(nome);
    // Entrada não confirmada não é instalável: a curadoria pode registrar o que viu sem declarar tudo.
    if (!decl) { if (confirmado) c.erro(caminho, "placeholder_nao_declarado", `{{${tipo}:${nome}}} sem variável declarada`); continue; }
    if (tipo === "SEGREDO") {
      if (ehUrl) c.erro(caminho, "segredo_em_url", "segredo não pode ir em URL");
      if (!decl.secreta) c.erro(caminho, "segredo_nao_secreto", `{{SEGREDO:${nome}}} exige variável com secreta=true`);
    } else if (decl.secreta) c.erro(caminho, "var_secreta", `{{VAR:${nome}}} aponta para variável secreta; use SEGREDO`);
  }
}

function validarInstalacao(c: Coletor, e: Obj, caminho: string, confirmado: boolean): void {
  const i = e["instalacao"];
  const ci = `${caminho}.instalacao`;
  if (!ehObjeto(i)) { c.erro(ci, "tipo_invalido", "instalacao deve ser objeto"); return; }
  c.campos(i, CAMPOS_INSTALACAO, ci);
  if (!em(METODOS_INSTALACAO_MCP, i["metodo"])) { c.erro(`${ci}.metodo`, "metodo_invalido", "metodo de instalação inválido"); return; }
  const metodo = i["metodo"];
  const versao = i["versao"], integ = i["integridade"], pacote = i["pacote"];
  for (const k of ["pacote", "versao", "integridade", "data_versao"] as const)
    if (i[k] !== null && !ehTexto(i[k])) c.erro(`${ci}.${k}`, "tipo_invalido", `${k} deve ser texto ou null`);
  if (i["lock_sha256"] !== undefined && i["lock_sha256"] !== null && !(ehTexto(i["lock_sha256"]) && RE_SHA256_HEX.test(i["lock_sha256"])))
    c.erro(`${ci}.lock_sha256`, "hash_invalido", "lock_sha256 deve ser hex de 64");
  if (i["scripts_permitidos"] !== undefined && typeof i["scripts_permitidos"] !== "boolean")
    c.erro(`${ci}.scripts_permitidos`, "tipo_invalido", "scripts_permitidos deve ser booleano");
  if (ehTexto(versao) && /^(latest|next|\*)$|[\^~<>=\s]/.test(versao)) c.erro(`${ci}.versao`, "versao_nao_exata", "versão deve ser exata (sem ^ ~ latest)");

  if (!confirmado) {
    if (versao !== null) c.erro(`${ci}.versao`, "nao_confirmado_com_versao", "entrada não confirmada deve ter versao null (use versao_observada)");
    if (integ !== null) c.erro(`${ci}.integridade`, "nao_confirmado_com_integridade", "entrada não confirmada deve ter integridade null (use integridade_observada)");
    if (i["lock_sha256"]) c.erro(`${ci}.lock_sha256`, "nao_confirmado_com_lock", "entrada não confirmada não tem lock");
    if (i["artefatos"] !== undefined && ehObjeto(i["artefatos"]) && Object.keys(i["artefatos"]).length > 0)
      c.erro(`${ci}.artefatos`, "nao_confirmado_com_artefatos", "entrada não confirmada não tem artefatos instaláveis");
    return;
  }

  if (metodo === "npm" || metodo === "uvx") {
    if (!ehTextoNaoVazio(pacote)) c.erro(`${ci}.pacote`, "pacote_ausente", "pacote obrigatório");
    if (!ehTexto(versao) || !RE_VERSAO.test(versao)) c.erro(`${ci}.versao`, "versao_invalida", "versão exata obrigatória em entrada confirmada");
    if (integ === null || !ehTexto(integ)) c.erro(`${ci}.integridade`, "integridade_ausente", "integridade obrigatória em entrada confirmada");
    else if (metodo === "npm" && !RE_NPM_INTEGRIDADE.test(integ)) c.erro(`${ci}.integridade`, "integridade_formato", "integridade npm deve ser sha512-<base64>");
    else if (metodo === "uvx" && !RE_SHA256_PREFIXO.test(integ)) c.erro(`${ci}.integridade`, "integridade_formato", "integridade PyPI deve ser sha256:<hex>");
  } else if (metodo === "binario") {
    if (!ehTexto(versao) || !RE_VERSAO.test(versao)) c.erro(`${ci}.versao`, "versao_invalida", "versão exata obrigatória em entrada confirmada");
    const art = i["artefatos"];
    if (!ehObjeto(art) || Object.keys(art).length === 0) c.erro(`${ci}.artefatos`, "artefatos_ausentes", "binário exige artefatos com sha256");
    else for (const [plat, a] of Object.entries(art)) {
      const ca = `${ci}.artefatos.${plat}`;
      if (!PLATAFORMAS.has(plat)) c.erro(ca, "plataforma_invalida", `plataforma desconhecida "${plat}"`);
      if (!ehObjeto(a)) { c.erro(ca, "tipo_invalido", "artefato deve ser objeto"); continue; }
      c.campos(a, CAMPOS_ARTEFATO, ca);
      if (!ehTexto(a["url"]) || !RE_RELEASE.test(a["url"])) c.erro(`${ca}.url`, "url_artefato_invalida", "URL deve ser https://github.com/<dono>/<repo>/releases/download/…");
      if (!ehTexto(a["sha256"]) || !RE_SHA256_HEX.test(a["sha256"])) c.erro(`${ca}.sha256`, "hash_invalido", "sha256 hex de 64 obrigatório");
    }
  } else if (metodo === "docker") {
    if (!ehTexto(pacote) || !RE_DOCKER_DIGEST.test(pacote)) c.erro(`${ci}.pacote`, "docker_sem_digest", "imagem docker exige digest @sha256:<hex>");
  } else {
    if (versao !== null) c.erro(`${ci}.versao`, "remoto_com_versao", "remoto exige versao null");
    if (pacote !== null) c.erro(`${ci}.pacote`, "remoto_com_pacote", "remoto não tem pacote");
    if (!ehHttps(e["url"])) c.erro(`${caminho}.url`, "url_nao_https", "remoto exige url https://");
  }
}

function validarEntradaInterna(c: Coletor, x: unknown, caminho: string): void {
  if (!ehObjeto(x)) { c.erro(caminho, "tipo_invalido", "entrada deve ser objeto"); return; }
  c.campos(x, CAMPOS_ENTRADA, caminho);
  if (!ehTexto(x["id"]) || !RE_ID.test(x["id"])) c.erro(`${caminho}.id`, "id_invalido", "id deve casar ^[a-z0-9][a-z0-9-]{0,47}$");
  for (const k of ["nome", "descricao_pt", "motivo_classificacao", "mantenedor_nome", "riscos_texto"]) validarTexto(c, x, k, caminho);
  if (!em(CATEGORIAS_MCP, x["categoria"])) c.erro(`${caminho}.categoria`, "enum_invalido", "categoria inválida");
  if (!em(CLASSIFICACOES_MCP, x["classificacao"])) c.erro(`${caminho}.classificacao`, "enum_invalido", "classificacao inválida");
  if (x["mantenedor"] !== "oficial" && x["mantenedor"] !== "comunidade") c.erro(`${caminho}.mantenedor`, "enum_invalido", "mantenedor inválido");
  if (!em(["gratis_open_source", "plano_gratis", "pago", "nao_confirmado"] as const, x["gratuito"])) c.erro(`${caminho}.gratuito`, "enum_invalido", "gratuito inválido");
  if (!em(TRANSPORTES_MCP, x["transporte"])) c.erro(`${caminho}.transporte`, "enum_invalido", "transporte inválido");
  if (!em(AUTENTICACOES_MCP, x["autenticacao"])) c.erro(`${caminho}.autenticacao`, "enum_invalido", "autenticacao inválida");
  if (typeof x["confirmado"] !== "boolean") c.erro(`${caminho}.confirmado`, "tipo_invalido", "confirmado deve ser booleano");
  const confirmado = x["confirmado"] === true;
  for (const k of ["licenca_spdx", "plano_gratis_detalhe", "comando", "bin", "url", "observacoes"])
    if (x[k] !== null && !ehTexto(x[k])) c.erro(`${caminho}.${k}`, "tipo_invalido", `${k} deve ser texto ou null`);

  if (!Array.isArray(x["riscos"]) || !x["riscos"].every((r) => em(RISCOS_MCP, r))) c.erro(`${caminho}.riscos`, "enum_invalido", "riscos inválidos");
  if (!Array.isArray(x["escopos_recomendados"]) || !x["escopos_recomendados"].every((r) => em(["workspace", "missao", "agente"] as const, r)))
    c.erro(`${caminho}.escopos_recomendados`, "enum_invalido", "escopos inválidos");
  if (!Array.isArray(x["tools_principais"]) || !x["tools_principais"].every(ehTexto)) c.erro(`${caminho}.tools_principais`, "tipo_invalido", "tools_principais deve ser lista de texto");

  const mat = x["maturidade"];
  if (!ehObjeto(mat)) c.erro(`${caminho}.maturidade`, "tipo_invalido", "maturidade deve ser objeto");
  else {
    c.campos(mat, CAMPOS_MATURIDADE, `${caminho}.maturidade`);
    if (!em(["ativo", "manutencao", "arquivado", "desconhecido"] as const, mat["status"])) c.erro(`${caminho}.maturidade.status`, "enum_invalido", "status inválido");
    if (typeof mat["arquivado"] !== "boolean") c.erro(`${caminho}.maturidade.arquivado`, "tipo_invalido", "arquivado deve ser booleano");
  }
  const links = x["links"];
  if (!ehObjeto(links)) c.erro(`${caminho}.links`, "tipo_invalido", "links deve ser objeto");
  else {
    c.campos(links, CAMPOS_LINKS, `${caminho}.links`);
    for (const k of ["repo", "docs"]) if (links[k] !== null && !ehHttps(links[k])) c.erro(`${caminho}.links.${k}`, "url_invalida", `links.${k} deve ser null ou https`);
  }
  const fontes = x["fontes"];
  if (!Array.isArray(fontes)) c.erro(`${caminho}.fontes`, "tipo_invalido", "fontes deve ser lista");
  else {
    fontes.forEach((f, i) => {
      const cf = `${caminho}.fontes[${i}]`;
      if (!ehObjeto(f)) { c.erro(cf, "tipo_invalido", "fonte deve ser objeto"); return; }
      c.campos(f, CAMPOS_FONTE, cf);
      if (!ehHttps(f["url"])) c.erro(`${cf}.url`, "url_invalida", "fonte deve ter URL https");
      if (!ehTexto(f["consultado_em"]) || !RE_DATA.test(f["consultado_em"])) c.erro(`${cf}.consultado_em`, "data_invalida", "consultado_em deve ser AAAA-MM-DD");
      if (!ehTextoNaoVazio(f["para"])) c.erro(`${cf}.para`, "tipo_invalido", "para deve ser texto");
    });
  }

  const vars = validarVariaveis(c, x, caminho);
  const args = x["args"];
  if (!Array.isArray(args) || !args.every(ehTexto)) c.erro(`${caminho}.args`, "tipo_invalido", "args deve ser lista de texto");
  else args.forEach((a, i) => {
    const ca = `${caminho}.args[${i}]`;
    if (RE_METACARACTERES.test(semPlaceholders(a))) c.erro(ca, "metacaractere_em_args", "args não pode conter ; | & $ ` fora de placeholders");
    validarPlaceholders(c, a, ca, vars, false, confirmado);
  });
  if (ehTexto(x["url"])) validarPlaceholders(c, x["url"], `${caminho}.url`, vars, true, confirmado);

  validarInstalacao(c, x, caminho, confirmado);

  if (confirmado) {
    const fontes2 = x["fontes"];
    if (!Array.isArray(fontes2) || fontes2.length === 0) c.erro(`${caminho}.fontes`, "confirmado_sem_fonte", "entrada confirmada exige ao menos uma fonte com data");
    const inst = x["instalacao"];
    const remoto = ehObjeto(inst) && inst["metodo"] === "remoto";
    if (x["licenca_spdx"] === null && !remoto) c.erro(`${caminho}.licenca_spdx`, "confirmado_sem_licenca", "entrada confirmada exige licenca_spdx (exceto remoto)");
    if (x["transporte"] === "stdio" && !ehTextoNaoVazio(x["comando"])) c.erro(`${caminho}.comando`, "comando_ausente", "stdio confirmado exige comando");
    if (ehObjeto(inst) && (inst["metodo"] === "npm" || inst["metodo"] === "uvx" || inst["metodo"] === "binario") && !ehTextoNaoVazio(x["bin"]))
      c.erro(`${caminho}.bin`, "bin_ausente", "instalação por pacote exige bin");
    if (x["transporte"] !== "stdio" && !ehHttps(x["url"])) c.erro(`${caminho}.url`, "url_nao_https", "transporte remoto exige url https");
    if (remoto && x["transporte"] === "stdio") c.erro(`${caminho}.transporte`, "transporte_incoerente", "método remoto não pode ser stdio");
    if (!remoto && x["transporte"] !== "stdio") c.erro(`${caminho}.transporte`, "transporte_incoerente", "transporte HTTP exige método remoto");
  }
  if (x["classificacao"] === "pre_instalado_habilitado") {
    if (x["autenticacao"] !== "nenhuma") c.erro(`${caminho}.autenticacao`, "kit_exige_sem_auth", "pre_instalado_habilitado exige autenticacao=nenhuma");
    if (!confirmado) c.erro(`${caminho}.confirmado`, "kit_exige_confirmado", "pre_instalado_habilitado exige confirmado=true");
  }
  varreduraSegredo(c, x, caminho);
}

/** Valida uma entrada isolada (útil para curadoria e testes). */
export function validarEntrada(x: unknown): ErroEsquema[] {
  const c = new Coletor();
  validarEntradaInterna(c, x, "entrada");
  return c.erros;
}

/** Validador estrito do arquivo do catálogo. Nunca lança: erro de forma vira lista de erros nominais. */
export function validarCatalogo(json: unknown): ResultadoValidacao {
  const c = new Coletor();
  if (!ehObjeto(json)) return { ok: false, erros: [{ caminho: "$", codigo: "tipo_invalido", mensagem: "catálogo deve ser objeto" }] };
  c.campos(json, CAMPOS_RAIZ, "$");
  if (json["schema_version"] !== SCHEMA_VERSION) c.erro("$.schema_version", "schema_version_invalido", `schema_version deve ser ${SCHEMA_VERSION}`);
  if (!ehTexto(json["gerado_em"]) || !RE_DATA.test(json["gerado_em"])) c.erro("$.gerado_em", "data_invalida", "gerado_em deve ser AAAA-MM-DD");
  if (!ehTexto(json["fonte"])) c.erro("$.fonte", "tipo_invalido", "fonte deve ser texto");
  for (const k of ["seed_versao", "aviso"]) if (json[k] !== undefined && !ehTexto(json[k])) c.erro(`$.${k}`, "tipo_invalido", `${k} deve ser texto`);
  const entradas = json["entradas"];
  if (!Array.isArray(entradas)) c.erro("$.entradas", "tipo_invalido", "entradas deve ser lista");
  else {
    const vistos = new Set<string>();
    entradas.forEach((x, i) => {
      validarEntradaInterna(c, x, `entradas[${i}]`);
      if (ehObjeto(x) && ehTexto(x["id"])) {
        if (vistos.has(x["id"])) c.erro(`entradas[${i}].id`, "id_duplicado", `id "${x["id"]}" duplicado`);
        vistos.add(x["id"]);
      }
    });
  }
  if (c.erros.length > 0) return { ok: false, erros: c.erros };
  return { ok: true, catalogo: json as unknown as CatalogoMcp };
}

/** Motivo pelo qual a entrada não pode ser instalada; `null` quando é instalável. */
export type MotivoNaoInstalavel = "nao_confirmado" | "descartado" | "sem_versao_pinada" | "sem_integridade";

export function motivoNaoInstalavel(e: EntradaMcp): MotivoNaoInstalavel | null {
  if (e.classificacao === "descartado") return "descartado";
  if (!e.confirmado) return "nao_confirmado";
  const i = e.instalacao;
  if (i.metodo === "npm" || i.metodo === "uvx") {
    if (!i.versao) return "sem_versao_pinada";
    if (!i.integridade) return "sem_integridade";
  } else if (i.metodo === "binario") {
    if (!i.versao) return "sem_versao_pinada";
    if (!i.artefatos || Object.keys(i.artefatos).length === 0) return "sem_integridade";
  } else if (i.metodo === "docker") {
    if (!i.pacote || !RE_DOCKER_DIGEST.test(i.pacote)) return "sem_integridade";
  }
  return null;
}

/** `versao: null` ou `confirmado: false` (e `descartado`) nunca são instaláveis. */
export function instalavel(e: EntradaMcp): boolean {
  return motivoNaoInstalavel(e) === null;
}

/** Nível de verificação (D-131): forte = lock + integridade; padrão = integridade/hash; remoto = sem pacote. */
export function nivelVerificacao(e: EntradaMcp): NivelVerificacao {
  const i = e.instalacao;
  if (i.metodo === "remoto") return "remoto";
  if ((i.metodo === "npm" || i.metodo === "uvx") && i.lock_sha256) return "forte";
  return "padrao";
}

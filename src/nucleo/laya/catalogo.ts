// Catálogo versionado do decisor local laya (T-25.04, D-697): leitura e validação ESTRITA de `resources/laya/modelos.json`.
// Fecha o que pode ser baixado: host fixo, revisão por commit, sha256 por arquivo (hex64) ou `a_verificar` — entrada sem
// checksum confirmado NÃO é baixável (`sem_checksum`, AP-14). Nomes de arquivo seguros (herdado A3 da voz: sem `/`, `\`,
// `..`, drive do Windows, reservados, ponto inicial; `.part`/marca de integridade nunca são nome de catálogo).
import type { TipoPergunta } from "../../compartilhado/laya";
import { TIPOS_PERGUNTA } from "../../compartilhado/laya";

export interface ArquivoCatalogoLaya {
  nome: string;
  papel: "tokenizador" | "config" | "encoder" | "head";
  bytes: number;
  /** hex64 minúsculo, ou `null` quando o catálogo diz `a_verificar`. */
  sha256: string | null;
  /** caminho no repositório de origem (com subpasta); ausente = igual a `nome`. */
  origem_caminho: string;
}

export interface ModeloCatalogoLaya {
  id: string;
  nome: string;
  descricao: string;
  idiomas: string[];
  pt_br: boolean;
  familia: string;
  perfil: string;
  recomendado: boolean;
  contexto_max_tokens: number;
  tipos_pergunta: TipoPergunta[];
  tokenizador: "bpe_bytelevel" | "wordpiece";
  ram_estimada_mb: number;
  /** `true` enquanto o tamanho dos `.onnx` é estimado (sem publicação da origem). */
  tamanho_onnx_estimado: boolean;
  notas: string;
  licenca: { id: string; url: string; atribuicao: string };
  origem: { host: string; caminho_base: string };
  arquivos: ArquivoCatalogoLaya[];
  /** computado: `true` só quando TODOS os arquivos têm sha256 confirmado. */
  baixavel: boolean;
}

export interface CatalogoLaya {
  versao: number;
  fonte: string;
  runtime: string;
  /** commit fixado do repositório de pesos (revisão imutável). */
  revisao: string;
  hosts_origem: string[];
  hosts_arquivos: string[];
  modelos: ModeloCatalogoLaya[];
}

export interface ResultadoCatalogoLaya {
  catalogo: CatalogoLaya | null;
  erros: string[];
}

const NOME_RESERVADOS_WINDOWS = new Set(["con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9"]);
const SHA256 = /^[0-9a-f]{64}$/;
const CAMPOS_TOPO = new Set(["versao", "fonte", "runtime", "revisao", "hosts_origem", "hosts_arquivos", "modelos"]);
const CAMPOS_MODELO = new Set([
  "id", "nome", "descricao", "idiomas", "pt_br", "familia", "perfil", "recomendado", "contexto_max_tokens",
  "tipos_pergunta", "tokenizador", "ram_estimada_mb", "tamanho_onnx_estimado", "notas", "licenca", "origem", "arquivos",
]);
const CAMPOS_ARQUIVO = new Set(["nome", "papel", "bytes", "sha256", "origem_caminho"]);
const CAMPOS_LICENCA = new Set(["id", "url", "atribuicao"]);
const CAMPOS_ORIGEM = new Set(["host", "caminho_base"]);
const PAPEIS = new Set(["tokenizador", "config", "encoder", "head"]);

/** nome de arquivo SEGURO para gravar dentro da pasta do modelo (A3): simples, sem traversal, sem reservado. */
export function nomeArquivoSeguroLaya(nome: string): boolean {
  if (nome.length === 0 || nome.length > 128) return false;
  if (nome.startsWith(".") || nome.endsWith(".")) return false;
  if (nome.includes("/") || nome.includes("\\") || nome.includes(":") || nome.includes("..") || nome.includes("\0")) return false;
  if (nome === ".part" || nome.includes(".integridade.json")) return false;
  const base = nome.split(".")[0] ?? "";
  if (NOME_RESERVADOS_WINDOWS.has(base.toLowerCase())) return false;
  return /^[\w][\w .-]*$/u.test(nome);
}

export function tipoArquivoCatalogoLaya(a: ArquivoCatalogoLaya): string | null {
  return PAPEIS.has(a.papel) ? a.papel : null;
}

/** motivo pelo qual o modelo NÃO pode ser baixado (texto para a UI); `null` = baixável. */
export function motivoNaoBaixavelLaya(m: ModeloCatalogoLaya): string | null {
  if (m.baixavel) return null;
  const semChecksum = m.arquivos.filter((a) => a.sha256 === null);
  if (semChecksum.length > 0) return `sem_checksum: ${semChecksum.length} arquivo(s) sem checksum confirmado no catálogo`;
  return "indisponivel";
}

export function tamanhoBytesLaya(m: ModeloCatalogoLaya): number {
  return m.arquivos.reduce((a, f) => a + f.bytes, 0);
}

export function urlDoArquivoLaya(c: CatalogoLaya, m: ModeloCatalogoLaya, a: ArquivoCatalogoLaya): string {
  return `https://${m.origem.host}${m.origem.caminho_base}${a.origem_caminho}`;
}

export function modeloPorIdLaya(c: CatalogoLaya, id: string): ModeloCatalogoLaya | null {
  return c.modelos.find((m) => m.id === id) ?? null;
}

const eTexto = (v: unknown): v is string => typeof v === "string";
const eInteiroPositivo = (v: unknown): boolean => typeof v === "number" && Number.isInteger(v) && v > 0;

/** Validação ESTRITA (campo a campo, nada extra). Devolve TODOS os erros de uma vez (falha fechada). */
export function validarCatalogoLaya(bruto: unknown): ResultadoCatalogoLaya {
  const erros: string[] = [];
  if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) return { catalogo: null, erros: ["catálogo: esperado objeto"] };
  const topo = bruto as Record<string, unknown>;
  for (const chave of Object.keys(topo)) if (!CAMPOS_TOPO.has(chave)) erros.push(`campo desconhecido no topo: ${chave}`);
  if (topo["versao"] !== 1) erros.push("versao: esperado 1");
  if (!eTexto(topo["fonte"])) erros.push("fonte: esperado texto");
  if (!eTexto(topo["runtime"]) || !topo["runtime"].includes("@")) erros.push("runtime: esperado nome@versão exata");
  if (!eTexto(topo["revisao"]) || !/^[0-9a-f]{40}$/.test(topo["revisao"])) erros.push("revisao: esperado commit sha40");
  if (!Array.isArray(topo["hosts_origem"]) || topo["hosts_origem"].length === 0 || !topo["hosts_origem"].every(eTexto)) erros.push("hosts_origem: esperado lista de hosts");
  if (!Array.isArray(topo["hosts_arquivos"]) || topo["hosts_arquivos"].length === 0 || !topo["hosts_arquivos"].every(eTexto)) erros.push("hosts_arquivos: esperado lista de hosts");
  if (!Array.isArray(topo["modelos"]) || topo["modelos"].length === 0) {
    erros.push("modelos: esperado lista não vazia");
    return { catalogo: null, erros };
  }

  const ids = new Set<string>();
  const modelos: ModeloCatalogoLaya[] = [];
  for (const brutoModelo of topo["modelos"]) {
    if (typeof brutoModelo !== "object" || brutoModelo === null || Array.isArray(brutoModelo)) {
      erros.push("modelo: esperado objeto");
      continue;
    }
    const m = brutoModelo as Record<string, unknown>;
    for (const chave of Object.keys(m)) if (!CAMPOS_MODELO.has(chave)) erros.push(`campo desconhecido no modelo: ${chave}`);
    const id = m["id"];
    if (!eTexto(id) || !/^[a-z0-9][a-z0-9-]{1,30}$/.test(id)) erros.push("id: formato inválido");
    else if (ids.has(id)) erros.push(`id duplicado: ${id}`);
    else ids.add(id);
    for (const [campo, esperado] of [["nome", true], ["descricao", true], ["familia", true], ["perfil", true], ["notas", true]] as const)
      if (!eTexto(m[campo]) || (m[campo] as string).length === 0) erros.push(`${campo}: esperado texto`);
    if (!Array.isArray(m["idiomas"]) || m["idiomas"].length === 0 || !m["idiomas"].every(eTexto)) erros.push("idiomas: esperado lista");
    if (typeof m["pt_br"] !== "boolean") erros.push("pt_br: esperado booleano");
    if (typeof m["recomendado"] !== "boolean") erros.push("recomendado: esperado booleano");
    if (!eInteiroPositivo(m["contexto_max_tokens"])) erros.push("contexto_max_tokens: esperado inteiro positivo");
    if (!eInteiroPositivo(m["ram_estimada_mb"])) erros.push("ram_estimada_mb: esperado inteiro positivo");
    if (typeof m["tamanho_onnx_estimado"] !== "boolean") erros.push("tamanho_onnx_estimado: esperado booleano");
    if (!Array.isArray(m["tipos_pergunta"]) || m["tipos_pergunta"].length === 0 || !m["tipos_pergunta"].every((t) => (TIPOS_PERGUNTA as readonly string[]).includes(t as string)))
      erros.push("tipos_pergunta: esperado subconjunto de choice/score/noul");
    if (m["tokenizador"] !== "bpe_bytelevel" && m["tokenizador"] !== "wordpiece") erros.push("tokenizador: esperado bpe_bytelevel ou wordpiece");
    const licenca = m["licenca"];
    if (typeof licenca !== "object" || licenca === null || Array.isArray(licenca)) erros.push("licenca: esperado objeto");
    else {
      for (const chave of Object.keys(licenca as object)) if (!CAMPOS_LICENCA.has(chave)) erros.push(`campo desconhecido na licença: ${chave}`);
      const l = licenca as Record<string, unknown>;
      if (!eTexto(l["id"]) || !eTexto(l["url"]) || !/^https:\/\//.test(l["url"]) || !eTexto(l["atribuicao"])) erros.push("licenca: id/url https/atribuicao obrigatórios");
    }
    const origem = m["origem"];
    if (typeof origem !== "object" || origem === null || Array.isArray(origem)) erros.push("origem: esperado objeto");
    else {
      for (const chave of Object.keys(origem as object)) if (!CAMPOS_ORIGEM.has(chave)) erros.push(`campo desconhecido na origem: ${chave}`);
      const o = origem as Record<string, unknown>;
      if (!eTexto(o["host"]) || !(topo["hosts_origem"] as string[] | undefined)?.includes(o["host"])) erros.push("origem.host: fora de hosts_origem");
      if (!eTexto(o["caminho_base"]) || !o["caminho_base"].startsWith("/") || !o["caminho_base"].endsWith("/") || o["caminho_base"].includes(".."))
        erros.push("origem.caminho_base: esperado caminho absoluto com barra final");
    }

    const arquivos: ArquivoCatalogoLaya[] = [];
    if (!Array.isArray(m["arquivos"]) || m["arquivos"].length === 0) erros.push("arquivos: esperado lista não vazia");
    else {
      const nomes = new Set<string>();
      for (const brutoArquivo of m["arquivos"]) {
        if (typeof brutoArquivo !== "object" || brutoArquivo === null || Array.isArray(brutoArquivo)) {
          erros.push("arquivo: esperado objeto");
          continue;
        }
        const a = brutoArquivo as Record<string, unknown>;
        for (const chave of Object.keys(a)) if (!CAMPOS_ARQUIVO.has(chave)) erros.push(`campo desconhecido no arquivo: ${chave}`);
        const nome = a["nome"];
        const papel = a["papel"];
        const bytes = a["bytes"];
        const sha = a["sha256"];
        const origemCaminho = eTexto(a["origem_caminho"]) ? (a["origem_caminho"] as string) : (nome as string);
        if (!eTexto(nome) || !nomeArquivoSeguroLaya(nome)) erros.push(`arquivo ${String(nome)}: nome inseguro`);
        else if (nomes.has(nome)) erros.push(`arquivo duplicado: ${nome}`);
        else nomes.add(nome);
        if (typeof papel !== "string" || !PAPEIS.has(papel)) erros.push(`arquivo ${String(nome)}: papel inválido`);
        if (!eInteiroPositivo(bytes)) erros.push(`arquivo ${String(nome)}: bytes deve ser inteiro positivo`);
        if (sha === "a_verificar") arquivos.push({ nome: nome as string, papel: papel as ArquivoCatalogoLaya["papel"], bytes: bytes as number, sha256: null, origem_caminho: origemCaminho });
        else if (eTexto(sha) && SHA256.test(sha)) arquivos.push({ nome: nome as string, papel: papel as ArquivoCatalogoLaya["papel"], bytes: bytes as number, sha256: sha, origem_caminho: origemCaminho });
        else erros.push(`arquivo ${String(nome)}: sha256 deve ser hex64 ou a_verificar`);
        if (eTexto(origemCaminho) && (origemCaminho.includes("..") || origemCaminho.startsWith("/"))) erros.push(`arquivo ${String(nome)}: origem_caminho inválido`);
      }
      const papeis = new Set(arquivos.map((a) => a.papel));
      for (const obrigatorio of ["tokenizador", "encoder", "head"]) if (!papeis.has(obrigatorio as ArquivoCatalogoLaya["papel"])) erros.push(`modelo ${String(id)}: falta arquivo de papel ${obrigatorio}`);
    }

    modelos.push({
      id: id as string,
      nome: m["nome"] as string,
      descricao: m["descricao"] as string,
      idiomas: m["idiomas"] as string[],
      pt_br: m["pt_br"] as boolean,
      familia: m["familia"] as string,
      perfil: m["perfil"] as string,
      recomendado: m["recomendado"] as boolean,
      contexto_max_tokens: m["contexto_max_tokens"] as number,
      tipos_pergunta: m["tipos_pergunta"] as TipoPergunta[],
      tokenizador: m["tokenizador"] as "bpe_bytelevel" | "wordpiece",
      ram_estimada_mb: m["ram_estimada_mb"] as number,
      tamanho_onnx_estimado: m["tamanho_onnx_estimado"] as boolean,
      notas: m["notas"] as string,
      licenca: m["licenca"] as ModeloCatalogoLaya["licenca"],
      origem: m["origem"] as ModeloCatalogoLaya["origem"],
      arquivos,
      baixavel: arquivos.length > 0 && arquivos.every((a) => a.sha256 !== null),
    });
  }

  if (erros.length > 0) return { catalogo: null, erros };
  return {
    catalogo: {
      versao: 1,
      fonte: topo["fonte"] as string,
      runtime: topo["runtime"] as string,
      revisao: topo["revisao"] as string,
      hosts_origem: topo["hosts_origem"] as string[],
      hosts_arquivos: topo["hosts_arquivos"] as string[],
      modelos,
    },
    erros: [],
  };
}

// Catálogo de modelos de voz local (Fase 11, D-541): dados VERSIONADOS em `resources/voz/modelos.json`, validados campo a campo antes de qualquer uso. Regras:
//  - o catálogo é a ÚNICA fonte de URL, host e checksum: o renderer só conhece `id`; nenhum caminho/URL externo entra;
//  - arquivo sem sha256 confirmado (64 hex) fica `baixavel: false` e o app RECUSA baixar (valor `a_verificar` é aceito só como marcador, nunca como hash);
//  - nomes de arquivo são simples (sem separador, `..`, caminho absoluto, letra de unidade nem byte de controle): é a defesa contra path traversal / zip-slip, já que não há arquivo compactado;
//  - hosts só em minúsculas, sem porta, sem IP literal; curingas de redirecionamento só de sufixo com dois rótulos ou mais.
import { isIP } from "node:net";
import { PRODUTO } from "../../produto";
import type { FamiliaModelo, LicencaModelo, PerfilModelo, QualidadeModelo, VelocidadeModelo } from "../../../compartilhado/voz-local";

export interface ArquivoCatalogo {
  nome: string;
  papel: string;
  bytes: number;
  /** `null` = `a_verificar`: o app recusa baixar. */
  sha256: string | null;
}

export interface AmostraAutoteste {
  arquivo: string;
  palavras_esperadas: string[];
  minimo: number;
  descricao: string;
}

export interface ModeloCatalogo {
  id: string;
  nome: string;
  descricao: string;
  idiomas: string[];
  familia: FamiliaModelo;
  perfil: PerfilModelo;
  recomendado: boolean;
  velocidade: VelocidadeModelo;
  qualidade: QualidadeModelo;
  ram_estimada_mb: number;
  /** trechos maiores que isto (segundos) são divididos antes do runtime (Whisper aceita ≤ 30 s). */
  trecho_max_s: number;
  /** chave de `amostras`. */
  amostra: string;
  licenca: LicencaModelo;
  origem: { host: string; caminho_base: string };
  arquivos: ArquivoCatalogo[];
  tamanho_bytes: number;
}

export interface Catalogo {
  versao: number;
  runtime: string;
  hosts_origem: string[];
  hosts_arquivos: string[];
  modelos: ModeloCatalogo[];
  amostras: Record<string, AmostraAutoteste>;
}

export type ResultadoCatalogo = { ok: true; catalogo: Catalogo } | { ok: false; erros: string[] };

const ID = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const CURINGA = /^\*\.[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const CAMINHO_BASE = /^\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*\/$/;
// eslint-disable-next-line no-control-regex
const CONTROLE = /[\u0000-\u001f\u007f]/;
const FAMILIAS: readonly string[] = ["nemo_transducer", "whisper", "moonshine"];
const PERFIS: readonly string[] = ["recomendado", "equilibrado", "leve", "ingles"];
const VELOCIDADES: readonly string[] = ["rapida", "media", "lenta"];
const QUALIDADES: readonly string[] = ["boa", "muito_boa", "excelente"];
/** teto sanidade: nenhum modelo deste catálogo passa de 2 GiB. */
const BYTES_MAX = 2 * 1024 * 1024 * 1024;

/** Nome simples de arquivo dentro da pasta do modelo. Recusa tudo que pode escapar dela. */
export function nomeArquivoSeguro(nome: unknown): nome is string {
  if (typeof nome !== "string" || nome.length === 0 || nome.length > 96) return false;
  if (CONTROLE.test(nome) || /[\\/:*?"<>|]/.test(nome)) return false;
  if (nome === "." || nome === ".." || nome.startsWith(".") || nome.endsWith(".") || nome.endsWith(" ")) return false;
  if (nome.includes("..")) return false;
  // nomes reservados do Windows
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(nome)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(nome);
}

const ehObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ehTexto = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max && !CONTROLE.test(v);

function lerHosts(v: unknown, curinga: boolean, erros: string[], onde: string): string[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > 8) { erros.push(`${onde}: lista de 1 a 8 hosts`); return []; }
  const saida: string[] = [];
  for (const h of v) {
    const valido = typeof h === "string" && ((curinga && CURINGA.test(h)) || (HOST.test(h) && isIP(h) === 0));
    if (!valido) { erros.push(`${onde}: host inválido`); continue; }
    saida.push(h);
  }
  return saida;
}

function lerLicenca(v: unknown, erros: string[], onde: string): LicencaModelo | null {
  if (!ehObj(v) || !ehTexto(v["id"], 40) || !ehTexto(v["atribuicao"], 400) || !ehTexto(v["url"], 300) || !/^https:\/\/[^\s]+$/.test(v["url"] as string)) { erros.push(`${onde}: licença incompleta (id, url https e atribuição)`); return null; }
  return { id: v["id"] as string, url: v["url"] as string, atribuicao: v["atribuicao"] as string };
}

/** Valida o catálogo inteiro. Devolve TODOS os erros (o carregamento falha fechado: catálogo inválido = nenhum modelo baixável). */
export function validarCatalogo(bruto: unknown): ResultadoCatalogo {
  const erros: string[] = [];
  if (!ehObj(bruto)) return { ok: false, erros: ["catálogo: esperado objeto"] };
  if (bruto["versao"] !== 1) erros.push("catálogo: versão desconhecida");
  if (!ehTexto(bruto["runtime"], 60)) erros.push("catálogo: runtime ausente");
  const hosts_origem = lerHosts(bruto["hosts_origem"], false, erros, "hosts_origem");
  const hosts_arquivos = lerHosts(bruto["hosts_arquivos"], true, erros, "hosts_arquivos");

  const amostras: Record<string, AmostraAutoteste> = {};
  if (!ehObj(bruto["amostras"])) erros.push("amostras: esperado objeto");
  else {
    for (const [k, a] of Object.entries(bruto["amostras"])) {
      if (!ehObj(a) || !nomeArquivoSeguro(a["arquivo"]) || !Array.isArray(a["palavras_esperadas"]) || a["palavras_esperadas"].length === 0 || !a["palavras_esperadas"].every((p) => ehTexto(p, 40))
        || !Number.isInteger(a["minimo"]) || (a["minimo"] as number) < 1 || (a["minimo"] as number) > a["palavras_esperadas"].length || !ehTexto(a["descricao"], 200)) {
        erros.push(`amostra ${k}: inválida`);
        continue;
      }
      amostras[k] = { arquivo: a["arquivo"], palavras_esperadas: a["palavras_esperadas"] as string[], minimo: a["minimo"] as number, descricao: a["descricao"] as string };
    }
  }

  const modelos: ModeloCatalogo[] = [];
  const vistos = new Set<string>();
  if (!Array.isArray(bruto["modelos"]) || bruto["modelos"].length === 0) erros.push("modelos: lista vazia");
  else {
    for (const m of bruto["modelos"] as unknown[]) {
      if (!ehObj(m)) { erros.push("modelo: esperado objeto"); continue; }
      const id = m["id"];
      if (typeof id !== "string" || !ID.test(id)) { erros.push("modelo: id inválido"); continue; }
      const onde = `modelo ${id}`;
      if (vistos.has(id)) { erros.push(`${onde}: id duplicado`); continue; }
      vistos.add(id);
      const antes = erros.length;
      if (!ehTexto(m["nome"], 80)) erros.push(`${onde}: nome`);
      if (!ehTexto(m["descricao"], 400)) erros.push(`${onde}: descrição`);
      if (!Array.isArray(m["idiomas"]) || m["idiomas"].length === 0 || m["idiomas"].length > 40 || !m["idiomas"].every((i) => typeof i === "string" && /^[a-z]{2,3}$/.test(i))) erros.push(`${onde}: idiomas`);
      if (typeof m["familia"] !== "string" || !FAMILIAS.includes(m["familia"])) erros.push(`${onde}: família`);
      if (typeof m["perfil"] !== "string" || !PERFIS.includes(m["perfil"])) erros.push(`${onde}: perfil`);
      if (typeof m["velocidade"] !== "string" || !VELOCIDADES.includes(m["velocidade"])) erros.push(`${onde}: velocidade`);
      if (typeof m["qualidade"] !== "string" || !QUALIDADES.includes(m["qualidade"])) erros.push(`${onde}: qualidade`);
      if (typeof m["recomendado"] !== "boolean") erros.push(`${onde}: recomendado`);
      if (!Number.isInteger(m["ram_estimada_mb"]) || (m["ram_estimada_mb"] as number) < 50 || (m["ram_estimada_mb"] as number) > 16_384) erros.push(`${onde}: RAM estimada`);
      if (!Number.isInteger(m["trecho_max_s"]) || (m["trecho_max_s"] as number) < 5 || (m["trecho_max_s"] as number) > 120) erros.push(`${onde}: trecho máximo`);
      if (typeof m["amostra"] !== "string" || !(m["amostra"] in amostras)) erros.push(`${onde}: amostra inexistente`);
      const licenca = lerLicenca(m["licenca"], erros, onde);
      const origem = m["origem"];
      let host = "";
      let caminho_base = "";
      if (!ehObj(origem) || typeof origem["host"] !== "string" || !hosts_origem.includes(origem["host"]) || typeof origem["caminho_base"] !== "string" || !CAMINHO_BASE.test(origem["caminho_base"]) || origem["caminho_base"].includes("..")) erros.push(`${onde}: origem fora dos hosts do catálogo`);
      else { host = origem["host"]; caminho_base = origem["caminho_base"]; }
      const arquivos: ArquivoCatalogo[] = [];
      const nomes = new Set<string>();
      if (!Array.isArray(m["arquivos"]) || m["arquivos"].length === 0 || m["arquivos"].length > 12) erros.push(`${onde}: arquivos`);
      else {
        for (const a of m["arquivos"] as unknown[]) {
          if (!ehObj(a) || !nomeArquivoSeguro(a["nome"]) || !ehTexto(a["papel"], 40) || !Number.isInteger(a["bytes"]) || (a["bytes"] as number) < 1 || (a["bytes"] as number) > BYTES_MAX) { erros.push(`${onde}: arquivo inválido`); continue; }
          const nome = a["nome"];
          if (nomes.has(nome.toLowerCase())) { erros.push(`${onde}: arquivo duplicado`); continue; }
          nomes.add(nome.toLowerCase());
          const sha = a["sha256"];
          if (sha !== "a_verificar" && !(typeof sha === "string" && HEX64.test(sha))) { erros.push(`${onde}: sha256 de ${nome} inválido (use 64 hex minúsculos ou "a_verificar")`); continue; }
          arquivos.push({ nome, papel: a["papel"] as string, bytes: a["bytes"] as number, sha256: sha === "a_verificar" ? null : (sha as string) });
        }
      }
      if (erros.length > antes || licenca === null) continue;
      modelos.push({
        id, nome: m["nome"] as string, descricao: m["descricao"] as string, idiomas: m["idiomas"] as string[], familia: m["familia"] as FamiliaModelo, perfil: m["perfil"] as PerfilModelo,
        recomendado: m["recomendado"] as boolean, velocidade: m["velocidade"] as VelocidadeModelo, qualidade: m["qualidade"] as QualidadeModelo, ram_estimada_mb: m["ram_estimada_mb"] as number,
        trecho_max_s: m["trecho_max_s"] as number, amostra: m["amostra"] as string, licenca, origem: { host, caminho_base }, arquivos, tamanho_bytes: arquivos.reduce((s, a) => s + a.bytes, 0),
      });
    }
    if (modelos.filter((x) => x.recomendado).length > 1) erros.push("modelos: no máximo um recomendado");
  }
  if (erros.length > 0) return { ok: false, erros };
  return { ok: true, catalogo: { versao: 1, runtime: bruto["runtime"] as string, hosts_origem, hosts_arquivos, modelos, amostras } };
}

/** O app só baixa se TODO arquivo tem checksum confirmado. */
export function motivoNaoBaixavel(m: ModeloCatalogo): string | null {
  const sem = m.arquivos.filter((a) => a.sha256 === null);
  return sem.length === 0 ? null : `Checksum ainda não confirmado para ${sem.length} arquivo(s): por segurança o ${PRODUTO.nomeDeExibicao} não baixa este modelo.`;
}

export const urlDoArquivo = (m: ModeloCatalogo, a: ArquivoCatalogo): { host: string; caminho: string } => ({ host: m.origem.host, caminho: `${m.origem.caminho_base}${a.nome}` });

export function modeloPorId(c: Catalogo, id: unknown): ModeloCatalogo | null {
  return typeof id === "string" ? (c.modelos.find((m) => m.id === id) ?? null) : null;
}

/** O que a pessoa lê no consentimento: hosts distintos (origem + CDN). */
export function hostsDoConsentimento(c: Catalogo, m: ModeloCatalogo): { origem: string; arquivos: string[] } {
  return { origem: m.origem.host, arquivos: [...c.hosts_arquivos] };
}

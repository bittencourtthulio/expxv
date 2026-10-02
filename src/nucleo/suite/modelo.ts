// Modelo da instalação da suíte ExpxDev (D-470…). Puro, sem Electron. A suíte é o método externo instalado pelo CLI `expxdev`
// (pacote npm de mesmo nome); o nome do PRODUTO continua só em src/nucleo/produto.ts (D-01).
import { homedir } from "node:os";
import { isAbsolute, relative, sep } from "node:path";

export type {
  ArquivosExistentes, CausaFalhaSuite, EstadoSuite, EstadoSuiteId, EtapaSuite, EtapaSuiteId, EventoSuite, FalhaSuite, FaseInstalacao, ModoInstalacao,
  MudancaEstadoSuite, PlanoSuite, ProgressoSuite, RequisitoSuite, ResumoSuite, SituacaoEtapa, SituacaoRequisito, SkillPlano,
} from "../../compartilhado/suite";

/** Pacote npm do instalador (nome do método externo; não é o nome do produto). */
export const PACOTE_SUITE = "expxdev";
/** Versão FIXADA que o app instala (nunca `latest` implícito). Configurável por preferência (`suite_versao`), validada como semver. */
export const VERSAO_SUITE_PADRAO = "0.9.0";
/** Lock mais antigo que isto vira `desatualizada`. */
export const VERSAO_MINIMA_SUITE = "0.9.0";
export const LOCK_SUITE_SUPORTADO = 1;
/** Registro npm usado SEMPRE (nunca o `.npmrc` do projeto). Um registro próprio só por preferência, e só https. */
export const REGISTRO_PADRAO = "https://registry.npmjs.org/";
/** Node mínimo do instalador: `engines.node >= 20.19.0` do pacote `expxdev` (lido do package.json do 0.9.0). */
export const NODE_MINIMO_VERSAO = "20.19.0";

export { CATALOGO_SUITE, SKILLS_DA_SUITE } from "./catalogo";
/** Harness padrão do `init`: Claude Code e OpenCode (o lock de referência é `claude,opencode`). */
export const HARNESS_PADRAO: readonly string[] = ["claude", "opencode"];
export const HARNESS_VALIDOS: readonly string[] = ["claude", "opencode"];

/** Pastas do projeto onde o `expxdev init` escreve (e só nelas o ADE espera mudança). */
export const PASTAS_GRAVADAS: readonly string[] = [".claude", ".expx", ".opencode"];
export const ARQUIVO_LOCK = ".expx/expx-lock.json";

/**
 * Flags do `init` (lidas do `dist/cli/init-flags.js` do 0.9.0 e do README do pacote): `--skills a,b` (obrigatória sem terminal), `--harness claude,opencode`
 * (padrão do CLI: só `claude`) e `--yes` (aplica sem terminal interativo; sem ele, o `init` só IMPRIME o que instalaria e sai sem escrever). Flag desconhecida
 * faz o `init` sair com erro. O comando montado pelo app SEMPRE leva `--yes` e `--skills`.
 * O usuário pode acrescentar flags extras por preferência (`suite_init_args`), só no formato `--palavra` e nunca as que o app já controla.
 */
export const FLAGS_DO_APP: readonly string[] = ["--yes", "--sim", "--skills", "--harness", "--check", "--simular"];
export const PADRAO_FLAG_INIT = /^--[a-z][a-z0-9-]{0,30}$/;
export const MAX_FLAGS_INIT = 4;
/** Variáveis do ambiente que mudam O QUE o instalador instala/de onde: nunca herdadas (`EXPX_SKILLS_LOCAIS` troca a origem das skills por uma pasta local). */
export const VARIAVEIS_DO_INSTALADOR_BLOQUEADAS: readonly string[] = ["EXPX_SKILLS_LOCAIS"];

export const LIMITES_SUITE = {
  /** tempo total de uma instalação */
  tempo_total_ms: 5 * 60_000,
  /** sem nenhuma saída por este tempo, o processo é encerrado */
  silencio_ms: 90_000,
  /** tempo curto das verificações de requisitos */
  verificacao_ms: 10_000,
  doctor_ms: 60_000,
  /** bytes de saída aceitos de um processo antes de encerrá-lo */
  saida_maxima_bytes: 8 * 1024 * 1024,
  /** linhas de log guardadas (cauda) */
  log_linhas: 400,
  log_linha_chars: 400,
  /** linhas do log enviadas por evento */
  log_evento_linhas: 150,
  /** caminhos listados no resumo/diagnóstico */
  caminhos_resumo: 200,
  /** manifesto antes/depois: arquivos e tamanho máximo hasheado */
  manifesto_arquivos: 20_000,
  manifesto_hash_bytes: 1024 * 1024,
  /** cópia de segurança dos arquivos pré-existentes */
  backup_arquivos: 500,
  backup_bytes: 5 * 1024 * 1024,
  backups_guardados: 3,
  coalescer_ms: 120,
} as const;

/** Etapas na ordem, com o peso de cada uma na barra (soma 100). */
export const ETAPAS_SUITE: ReadonlyArray<{ id: import("../../compartilhado/suite").EtapaSuiteId; rotulo: string; peso: number }> = [
  { id: "requisitos", rotulo: "Verificando requisitos", peso: 10 },
  { id: "baixando", rotulo: "Baixando o instalador", peso: 30 },
  { id: "instalando", rotulo: "Instalando as skills", peso: 40 },
  { id: "conferindo", rotulo: "Conferindo a instalação", peso: 15 },
  { id: "pronto", rotulo: "Pronto", peso: 5 },
];

// ---------------------------------------------------------------- versões
const SEMVER = /^(\d{1,4})\.(\d{1,5})\.(\d{1,5})(?:-[0-9A-Za-z.-]{1,30})?$/;
export const versaoValida = (v: unknown): v is string => typeof v === "string" && SEMVER.test(v);

/** O Node atende ao `engines` do instalador (`v20.19.0` ou mais novo)? Aceita o prefixo `v`. */
export function nodeAtende(versao: string): boolean {
  const r = compararVersoes(versao.trim().replace(/^v/, ""), NODE_MINIMO_VERSAO);
  return r !== null && r >= 0;
}

/** Compara duas versões `x.y.z` (pré-lançamento é ignorado). Devolve <0, 0, >0; `null` se alguma é inválida. */
export function compararVersoes(a: string, b: string): number | null {
  const ma = SEMVER.exec(a);
  const mb = SEMVER.exec(b);
  if (ma === null || mb === null) return null;
  for (let i = 1; i <= 3; i += 1) {
    const d = Number(ma[i]) - Number(mb[i]);
    if (d !== 0) return d;
  }
  return 0;
}

// ---------------------------------------------------------------- caminhos para exibição
/** `/Users/ana/proj` → `~/proj` (só o início da HOME vira `~`). */
export function comTil(caminho: string, inicio: string = homedir()): string {
  if (inicio === "" || caminho === "") return caminho;
  if (caminho === inicio) return "~";
  const base = inicio.endsWith(sep) ? inicio : inicio + sep;
  return caminho.startsWith(base) ? `~${sep === "\\" ? "\\" : "/"}${caminho.slice(base.length)}` : caminho;
}

/**
 * Máscara do diagnóstico: o início do caminho some (`/Users/ana/Projetos/x` → `~/…/x`), só sobra a última pasta.
 * Nunca devolve o nome de usuário.
 */
export function mascararCaminho(caminho: string, inicio: string = homedir()): string {
  const t = comTil(caminho, inicio);
  const partes = t.split(/[\\/]/).filter(Boolean);
  const ultimo = partes[partes.length - 1] ?? "";
  if (partes.length <= 1) return t.startsWith("~") ? "~" : ultimo;
  return `~/…/${ultimo}`;
}

/** `true` se `alvo` está dentro de `raiz` (ou é ela). */
export function dentroDe(raiz: string, alvo: string): boolean {
  const r = relative(raiz, alvo);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
}

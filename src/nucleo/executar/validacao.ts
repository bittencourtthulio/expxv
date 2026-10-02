// Validação ESTRITA das configurações de execução: reconstrói o objeto campo a campo (descarta o desconhecido), recusa
// injeção de argumento, cwd que escapa, ambiente sensível e URL que não seja loopback. Pura.
import { LIMITES_EXECUTAR, TIPOS_EXECUCAO, type ArquivoConfigExecutar, type ConfigExecucao, type PassoExecucao, type TipoExecucao } from "./modelo";

export type Validacao<T> = { ok: true; valor: T } | { ok: false; erro: string };
const ok = <T>(valor: T): Validacao<T> => ({ ok: true, valor });
const falha = (erro: string): Validacao<never> => ({ ok: false, erro });

// eslint-disable-next-line no-control-regex
const CONTROLE = /[\u0000-\u001f\u007f]/;
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const NOME_VAR = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const REF_COFRE = /^\{\{vault:[A-Za-z0-9_.-]{1,64}\}\}$/;

/** Variáveis que o usuário não define pela configuração (sequestro de carga dinâmica, identidade de sessão, herança do Orca). */
const VARIAVEIS_PROIBIDAS = /^(PATH|Path|PATHEXT|LD_[A-Z_]+|DYLD_[A-Z_]+|ELECTRON_RUN_AS_NODE|ORCA_[A-Z_]+|CLAUDECODE|CLAUDE_CODE_[A-Z_]+|CLAUDE_PID|HOME|USERPROFILE|SHELL|COMSPEC|ComSpec)$/;
/** Nome que sugere segredo: só aceito como referência ao cofre. */
const NOME_SENSIVEL = /(SECRET|TOKEN|PASSW(OR)?D|PASSPHRASE|API_?KEY|ACCESS_?KEY|PRIVATE|CREDENTIAL|AUTH|COOKIE|SESSION_?ID|SIGNING)/i;
/** Valor com cara de segredo, qualquer que seja o nome. */
const VALOR_SEGREDO = /(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}|[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@)/;

export function textoSimples(v: unknown, max: number, min = 0): Validacao<string> {
  if (typeof v !== "string") return falha("esperado texto");
  if (v.length < min || v.length > max) return falha(`texto fora do tamanho (${min}–${max})`);
  if (CONTROLE.test(v)) return falha("texto com caractere de controle");
  return ok(v);
}

/**
 * Caminho RELATIVO seguro (cwd e executável relativo): sem `..`, sem absoluto, sem unidade do Windows, sem `~`, sem barra invertida.
 * `.` e vazio valem a raiz. A conferência de symlink é feita no main (realpath) na hora de executar.
 */
export function caminhoRelativoSeguro(v: unknown): Validacao<string> {
  const t = textoSimples(v, 300);
  if (!t.ok) return t;
  const p = t.valor.trim();
  if (p === "" || p === ".") return ok(".");
  if (p.startsWith("/") || p.startsWith("~") || p.includes("\\") || /^[A-Za-z]:/.test(p)) return falha("caminho deve ser relativo à raiz do workspace");
  const partes = p.split("/").filter((x) => x !== "" && x !== ".");
  if (partes.includes("..")) return falha("caminho não pode subir de pasta (..)");
  return ok(partes.length === 0 ? "." : partes.join("/"));
}

/**
 * Executável: nome simples do PATH (`npm`, `cargo`, `python3`) ou caminho relativo ao workspace (`./gradlew`).
 * Nunca começa com `-` (viraria opção de quem chama), nunca absoluto, nunca com espaço (o argumento vai no outro campo).
 */
export function executavelSeguro(v: unknown): Validacao<string> {
  const t = textoSimples(v, 200, 1);
  if (!t.ok) return t;
  const e = t.valor.trim();
  if (e.startsWith("-")) return falha("executável não pode começar com '-'");
  if (/\s/.test(e)) return falha("executável não pode ter espaço: coloque os argumentos no campo de argumentos");
  if (/[;&|`$<>(){}*?!"'\\]/.test(e) && !/^[A-Za-z]:/.test(e)) return falha("executável com caractere de shell");
  if (e.includes("/")) {
    const rel = caminhoRelativoSeguro(e);
    if (!rel.ok) return rel;
    return ok(e.startsWith("./") ? `./${rel.valor}` : rel.valor);
  }
  return ok(e);
}

export function argumentosSeguros(v: unknown): Validacao<string[]> {
  if (!Array.isArray(v)) return falha("argumentos: esperado lista");
  if (v.length > LIMITES_EXECUTAR.argumentos) return falha("argumentos demais");
  const saida: string[] = [];
  for (const a of v) {
    const t = textoSimples(a, LIMITES_EXECUTAR.argumento_chars);
    if (!t.ok) return falha(`argumento inválido: ${t.erro}`);
    saida.push(t.valor);
  }
  return ok(saida);
}

export function passoSeguro(v: unknown): Validacao<PassoExecucao> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return falha("passo: esperado objeto");
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (k !== "executavel" && k !== "argumentos") return falha(`passo: campo desconhecido ${k}`);
  const e = executavelSeguro(o["executavel"]);
  if (!e.ok) return e;
  const a = argumentosSeguros(o["argumentos"]);
  if (!a.ok) return a;
  return ok({ executavel: e.valor, argumentos: a.valor });
}

/** Valores `{{vault:NOME}}` passam; o resto não pode parecer segredo nem estar em variável de nome sensível. */
export function ambienteSeguroConfig(v: unknown): Validacao<Record<string, string>> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return falha("ambiente: esperado objeto");
  const entradas = Object.entries(v as Record<string, unknown>);
  if (entradas.length > LIMITES_EXECUTAR.ambiente) return falha("variáveis de ambiente demais");
  const saida: Record<string, string> = {};
  for (const [nome, valor] of entradas) {
    if (!NOME_VAR.test(nome)) return falha(`nome de variável inválido: ${nome.slice(0, 40)}`);
    if (VARIAVEIS_PROIBIDAS.test(nome)) return falha(`a variável ${nome} não pode ser definida por aqui`);
    const t = textoSimples(valor, LIMITES_EXECUTAR.valor_ambiente_chars);
    if (!t.ok) return falha(`valor de ${nome}: ${t.erro}`);
    const ehRef = REF_COFRE.test(t.valor);
    if (!ehRef && t.valor.includes("{{vault:")) return falha(`${nome}: referência ao cofre deve ser exatamente {{vault:NOME}}`);
    if (!ehRef && (NOME_SENSIVEL.test(nome) || VALOR_SEGREDO.test(t.valor))) return falha(`${nome} parece segredo: use {{vault:NOME}} (cofre), nunca o valor aqui`);
    saida[nome] = t.valor;
  }
  return ok(saida);
}

const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0|\[::\])$/i;

/** URL esperada: http/https, loopback, sem credenciais. Devolve a URL normalizada (0.0.0.0 e [::] viram localhost). */
export function urlLoopbackSegura(v: unknown): Validacao<string> {
  const t = textoSimples(v, 300, 1);
  if (!t.ok) return t;
  let u: URL;
  try { u = new URL(t.valor.trim()); } catch { return falha("URL inválida"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") return falha("só http/https");
  if (u.username !== "" || u.password !== "") return falha("URL com credenciais não é aceita");
  if (!LOOPBACK.test(u.hostname)) return falha("só endereços locais (localhost, 127.0.0.1, ::1)");
  if (u.hostname === "0.0.0.0" || u.hostname === "[::]") u.hostname = "localhost";
  return ok(u.toString());
}

export function porta(v: unknown): Validacao<number> {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 65_535) return falha("porta fora de 1–65535");
  return ok(v);
}

const CAMPOS = ["id", "nome", "tipo", "executavel", "argumentos", "cwd", "ambiente", "pre_passos", "porta", "url", "abrir_navegador", "reiniciar_ao_salvar", "grupo", "shell", "origem"] as const;

/** Configuração completa e estrita (campo extra ou ausente é erro; `origem` é carimbada pelo chamador). */
export function validarConfig(v: unknown, origem: ConfigExecucao["origem"] = "usuario"): Validacao<ConfigExecucao> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return falha("configuração: esperado objeto");
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!(CAMPOS as readonly string[]).includes(k)) return falha(`campo desconhecido: ${k}`);
  const ausente = CAMPOS.find((k) => k !== "origem" && !(k in o));
  if (ausente !== undefined) return falha(`campo ausente: ${ausente}`);
  const id = textoSimples(o["id"], 40, 1);
  if (!id.ok || !ID.test(id.valor)) return falha("id inválido (a–z, 0–9 e hífen, até 40)");
  const nome = textoSimples(o["nome"], LIMITES_EXECUTAR.nome_chars, 1);
  if (!nome.ok) return falha(`nome: ${nome.erro}`);
  if (nome.valor.trim() === "") return falha("nome vazio");
  if (typeof o["tipo"] !== "string" || !(TIPOS_EXECUCAO as readonly string[]).includes(o["tipo"])) return falha("tipo fora do conjunto");
  const shell = o["shell"] === null ? ok<string | null>(null) : textoSimples(o["shell"], LIMITES_EXECUTAR.linha_shell_chars, 1);
  if (!shell.ok) return falha(`shell: ${shell.erro}`);
  const usaShell = shell.valor !== null;
  // com shell, o par executável/argumentos é só rótulo; sem shell são estritos
  const exe = usaShell ? textoSimples(o["executavel"], 200, 0) : executavelSeguro(o["executavel"]);
  if (!exe.ok) return falha(`executável: ${exe.erro}`);
  const args = argumentosSeguros(o["argumentos"]);
  if (!args.ok) return args;
  const cwd = caminhoRelativoSeguro(o["cwd"]);
  if (!cwd.ok) return falha(`cwd: ${cwd.erro}`);
  const amb = ambienteSeguroConfig(o["ambiente"]);
  if (!amb.ok) return amb;
  if (!Array.isArray(o["pre_passos"]) || o["pre_passos"].length > LIMITES_EXECUTAR.passos) return falha("pré-passos inválidos");
  const passos: PassoExecucao[] = [];
  for (const p of o["pre_passos"] as unknown[]) {
    const r = passoSeguro(p);
    if (!r.ok) return falha(`pré-passo: ${r.erro}`);
    passos.push(r.valor);
  }
  const por = o["porta"] === null ? ok<number | null>(null) : porta(o["porta"]);
  if (!por.ok) return por;
  const url = o["url"] === null ? ok<string | null>(null) : urlLoopbackSegura(o["url"]);
  if (!url.ok) return falha(`url: ${url.erro}`);
  if (typeof o["abrir_navegador"] !== "boolean" || typeof o["reiniciar_ao_salvar"] !== "boolean") return falha("abrir_navegador e reiniciar_ao_salvar devem ser booleanos");
  const grupo = o["grupo"] === null ? ok<string | null>(null) : textoSimples(o["grupo"], 40, 1);
  if (!grupo.ok || (grupo.valor !== null && !ID.test(grupo.valor))) return falha("grupo inválido");
  if (usaShell && (o["argumentos"] as unknown[]).length > 0) return falha("com shell, a linha de comando vai só no campo shell");
  return ok({
    id: id.valor, nome: nome.valor.trim(), tipo: o["tipo"] as TipoExecucao, executavel: exe.valor, argumentos: args.valor, cwd: cwd.valor, ambiente: amb.valor,
    pre_passos: passos, porta: por.valor, url: url.valor, abrir_navegador: o["abrir_navegador"], reiniciar_ao_salvar: o["reiniciar_ao_salvar"],
    grupo: grupo.valor, shell: shell.valor, origem,
  });
}

/** Arquivo de configurações de execução do repositório: tolerante a configuração inválida (descarta com aviso), estrito dentro de cada uma. */
export function lerArquivoConfig(bruto: unknown): { arquivo: ArquivoConfigExecutar; avisos: string[] } {
  const avisos: string[] = [];
  const vazio: ArquivoConfigExecutar = { versao: 1, padrao: null, configuracoes: [] };
  if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) return { arquivo: vazio, avisos: ["arquivo de execução ignorado: não é um objeto"] };
  const o = bruto as Record<string, unknown>;
  if (o["versao"] !== 1) return { arquivo: vazio, avisos: ["arquivo de execução ignorado: versão desconhecida"] };
  const lista = Array.isArray(o["configuracoes"]) ? (o["configuracoes"] as unknown[]) : [];
  const configuracoes: ConfigExecucao[] = [];
  const vistos = new Set<string>();
  for (const item of lista.slice(0, LIMITES_EXECUTAR.configuracoes)) {
    // `origem` pode vir no arquivo; é ignorada (sempre "usuario")
    const sem = typeof item === "object" && item !== null ? Object.fromEntries(Object.entries(item as Record<string, unknown>).filter(([k]) => k !== "origem")) : item;
    const r2 = validarConfig(sem, "usuario");
    if (!r2.ok) { avisos.push(`configuração ignorada: ${r2.erro}`); continue; }
    if (vistos.has(r2.valor.id)) { avisos.push(`configuração repetida ignorada: ${r2.valor.id}`); continue; }
    vistos.add(r2.valor.id);
    configuracoes.push(r2.valor);
  }
  const padrao = typeof o["padrao"] === "string" && ID.test(o["padrao"]) ? o["padrao"] : null;
  return { arquivo: { versao: 1, padrao, configuracoes }, avisos };
}

export function idDeConfigValido(v: unknown): Validacao<string> {
  const t = textoSimples(v, 40, 1);
  return t.ok && ID.test(t.valor) ? t : falha("id de configuração inválido");
}

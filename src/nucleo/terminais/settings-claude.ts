// O Claude Code aceita UM `--settings`. A sinaleira (atividade) e a orquestração (hooks por Pane) trazem
// um cada; aqui eles viram um só, somando os hooks de cada evento (os dois rodam) e deixando as demais
// chaves para o último. Só arquivos pequenos de configuração, lidos uma vez por abertura de sessão.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

type Json = Record<string, unknown>;

export interface EntradaSaidaSettings {
  ler(caminho: string): string;
  gravar(caminho: string, conteudo: string): void;
}

const ES_REAL: EntradaSaidaSettings = {
  ler: (c) => readFileSync(c, "utf8"),
  gravar: (c, conteudo) => writeFileSync(c, conteudo, { mode: 0o600 }),
};

const ehObjeto = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

function carregar(valor: string, es: EntradaSaidaSettings): Json {
  const texto = valor.trimStart().startsWith("{") ? valor : es.ler(valor);
  const json: unknown = JSON.parse(texto);
  if (!ehObjeto(json)) throw new Error("settings inválido");
  return json;
}

function juntar(a: Json, b: Json): Json {
  const saida: Json = { ...a, ...b };
  const ha = ehObjeto(a["hooks"]) ? a["hooks"] : {};
  const hb = ehObjeto(b["hooks"]) ? b["hooks"] : {};
  const hooks: Json = {};
  for (const evento of new Set([...Object.keys(ha), ...Object.keys(hb)])) {
    const la = Array.isArray(ha[evento]) ? (ha[evento] as unknown[]) : [];
    const lb = Array.isArray(hb[evento]) ? (hb[evento] as unknown[]) : [];
    hooks[evento] = [...la, ...lb];
  }
  if (Object.keys(hooks).length > 0) saida["hooks"] = hooks;
  // regras de permissão de cada arquivo SOMAM (um `deny` nunca apaga o `deny` de outro: o gate de módulos desligados e o piso do Maestro valem juntos)
  const pa = ehObjeto(a["permissions"]) ? a["permissions"] : null;
  const pb = ehObjeto(b["permissions"]) ? b["permissions"] : null;
  if (pa !== null && pb !== null) {
    const permissions: Json = { ...pa, ...pb };
    for (const chave of ["deny", "allow", "ask"]) {
      const la = Array.isArray(pa[chave]) ? (pa[chave] as unknown[]) : [];
      const lb = Array.isArray(pb[chave]) ? (pb[chave] as unknown[]) : [];
      if (la.length + lb.length > 0) permissions[chave] = [...new Set([...la, ...lb])];
    }
    saida["permissions"] = permissions;
  }
  return saida;
}

/**
 * Se o argv tem mais de um `--settings`, devolve um argv com UM só apontando para o arquivo juntado
 * (gravado ao lado do último arquivo de settings, na posição do último). Qualquer falha devolve o argv intacto.
 */
export function juntarSettingsDoClaude(argv: string[], es: EntradaSaidaSettings = ES_REAL): string[] {
  const indices: number[] = [];
  argv.forEach((a, i) => { if (a === "--settings" && i + 1 < argv.length) indices.push(i); });
  if (indices.length < 2) return argv;
  try {
    const valores = indices.map((i) => argv[i + 1] as string);
    const juntado = valores.map((v) => carregar(v, es)).reduce((acc, atual) => juntar(acc, atual));
    const ultimoArquivo = [...valores].reverse().find((v) => isAbsolute(v) && !v.trimStart().startsWith("{"));
    if (ultimoArquivo === undefined) return argv;
    const destino = join(dirname(ultimoArquivo), "claude-settings-juntas.json");
    es.gravar(destino, JSON.stringify(juntado, null, 2));
    const resto = new Set(indices.flatMap((i) => [i, i + 1]));
    const saida: string[] = [];
    // o juntado fica onde estava o ÚLTIMO `--settings`: `--mcp-config` aceita vários valores e engoliria o prompt
    // posicional se o `--settings` que o separa dele fosse embora
    const posicao = indices[indices.length - 1];
    argv.forEach((a, i) => {
      if (i === posicao) saida.push("--settings", destino);
      else if (!resto.has(i)) saida.push(a);
    });
    return saida;
  } catch {
    return argv;
  }
}

/** Ajuste de argv das sessões: só o Claude tem o problema. */
export function ajustarArgumentosDasSessoes(ferramenta_id: string, argv: string[]): string[] {
  return ferramenta_id === "claude" ? juntarSettingsDoClaude(argv) : argv;
}

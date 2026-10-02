import { isMap, isScalar, isSeq, LineCounter, parseDocument, type Node as YamlNode } from "yaml";

// Regras de fronteira (T-17.25): importadores ESTÁTICOS de deptrac, import-linter, dependency-cruiser (JSON) e Packwerk.
// Só lê texto já carregado pelo chamador; nunca executa nada. Configuração em JS (`.dependency-cruiser.js/.cjs/.mjs`) NÃO é
// lida: avaliá-la executaria código do projeto (D-162). Toda regra vira `RegraFronteira` com `arquivo:linha` da fonte.

export type FerramentaRegra = "deptrac" | "import-linter" | "dependency-cruiser" | "packwerk";

export interface FonteRegra {
  arquivo: string;
  linha: number;
}

export interface RegraFronteira {
  ferramenta: FerramentaRegra;
  /** Sempre `proibida`: as listas "permitidas" são convertidas em proibições para os pares não permitidos. */
  tipo: "proibida";
  nome: string;
  /** Rótulos legíveis (camada, pacote, módulo ou regex). */
  origem: string;
  destino: string;
  /** Regex (strings) sobre o caminho relativo do arquivo. */
  origemPadroes: string[];
  destinoPadroes: string[];
  descricao: string;
  fonte: FonteRegra;
}

export interface ArquivoConfig {
  /** Relativo à raiz. */
  caminho: string;
  texto: string;
}

export interface ResultadoRegras {
  regras: RegraFronteira[];
  /** Arquivos reconhecidos mas não lidos (e o porquê) e problemas de leitura. */
  avisos: string[];
}

const base = (c: string): string => c.slice(c.lastIndexOf("/") + 1);
const pastaDe = (c: string): string => (c.includes("/") ? c.slice(0, c.lastIndexOf("/")) : ".");
const escapar = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function ehArquivoDeRegras(caminho: string): boolean {
  const b = base(caminho);
  return /^(deptrac|depfile)(\..+)?\.ya?ml$/.test(b) || b === ".importlinter" || b === "setup.cfg" || b === "pyproject.toml" || /^\.dependency-cruiser\.(json|js|cjs|mjs)$/.test(b) || b === "package.yml";
}

function linhaYaml(lc: LineCounter, no: unknown): number {
  const r = (no as YamlNode | null | undefined)?.range;
  return r === undefined || r === null ? 1 : lc.linePos(r[0]).line;
}

// ---------------------------------------------------------------------------------------------
// deptrac

function deptrac(a: ArquivoConfig, avisos: string[]): RegraFronteira[] {
  const lc = new LineCounter();
  const doc = parseDocument(a.texto, { lineCounter: lc });
  if (doc.errors.length > 0) {
    avisos.push(`${a.caminho}: YAML inválido (${doc.errors[0]?.code ?? "erro"}); regras do deptrac não importadas`);
    return [];
  }
  const raiz = doc.get("deptrac", true) ?? doc.contents;
  if (!isMap(raiz)) return [];
  const camadas = new Map<string, string[]>();
  const layers = raiz.get("layers", true);
  if (isSeq(layers)) {
    for (const item of layers.items) {
      if (!isMap(item)) continue;
      const nome = String(item.get("name") ?? "");
      if (nome === "") continue;
      const padroes: string[] = [];
      const cols = item.get("collectors", true);
      if (isSeq(cols)) {
        for (const c of cols.items) {
          if (!isMap(c)) continue;
          const tipo = String(c.get("type") ?? "");
          const valor = String(c.get("value") ?? "");
          if (valor === "") continue;
          if (tipo === "directory") padroes.push(`(^|/)${valor.replace(/^\*\*\//, "")}`);
          else if (tipo === "className" || tipo === "classNameRegex") padroes.push(`(^|/)${valor.replace(/\\\\/g, "/").replace(/\\/g, "/")}`);
          else if (tipo === "glob") padroes.push(`(^|/)${escapar(valor).replace(/\\\*\\\*/g, ".*").replace(/\\\*/g, "[^/]*")}`);
        }
      }
      if (padroes.length > 0) camadas.set(nome, padroes);
    }
  }
  const ruleset = raiz.get("ruleset", true);
  if (!isMap(ruleset)) return [];
  const permitido = new Map<string, Set<string>>();
  const linhaDe = new Map<string, number>();
  for (const par of ruleset.items) {
    const nome = String((par.key as { value?: unknown }).value ?? "");
    const destinos = new Set<string>();
    if (isSeq(par.value)) for (const d of par.value.items) destinos.add(String(isScalar(d) ? d.value : d));
    permitido.set(nome, destinos);
    linhaDe.set(nome, linhaYaml(lc, par.key));
  }
  const regras: RegraFronteira[] = [];
  for (const [origem, pOrigem] of camadas) {
    const ok = permitido.get(origem);
    if (ok === undefined) continue; // sem ruleset para a camada: o deptrac a trata como livre de verificação própria
    for (const [destino, pDestino] of camadas) {
      if (destino === origem || ok.has(destino)) continue;
      regras.push({
        ferramenta: "deptrac",
        tipo: "proibida",
        nome: `${origem} -> ${destino}`,
        origem,
        destino,
        origemPadroes: pOrigem,
        destinoPadroes: pDestino,
        descricao: `${origem} não pode depender de ${destino} (ruleset do deptrac permite: ${[...ok].join(", ") || "nenhuma camada"})`,
        fonte: { arquivo: a.caminho, linha: linhaDe.get(origem) ?? 1 },
      });
    }
  }
  return regras;
}

// ---------------------------------------------------------------------------------------------
// import-linter (.importlinter, setup.cfg, pyproject.toml)

interface ContratoIL {
  nome: string;
  tipo: string;
  camadas: string[];
  fontes: string[];
  proibidos: string[];
  linha: number;
}

function listaIni(v: string): string[] {
  return v
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter((x) => x !== "" && !x.startsWith("#"));
}

function contratosIni(a: ArquivoConfig): ContratoIL[] {
  const contratos: ContratoIL[] = [];
  const linhas = a.texto.split(/\r?\n/);
  let atual: { secao: string; linha: number; kv: Map<string, string> } | null = null;
  const fechar = (): void => {
    if (atual !== null) {
      const m = /^importlinter:contract:(.+)$/.exec(atual.secao);
      if (m !== null) {
        const kv = atual.kv;
        contratos.push({ nome: kv.get("name") ?? (m[1] as string), tipo: (kv.get("type") ?? "").trim(), camadas: listaIni(kv.get("layers") ?? ""), fontes: listaIni(kv.get("source_modules") ?? ""), proibidos: listaIni(kv.get("forbidden_modules") ?? ""), linha: atual.linha });
      }
    }
    atual = null;
  };
  let chave: string | null = null;
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i] as string;
    const sec = /^\[([^\]]+)\]\s*$/.exec(l);
    if (sec !== null) {
      fechar();
      atual = { secao: (sec[1] as string).trim(), linha: i + 1, kv: new Map() };
      chave = null;
      continue;
    }
    if (atual === null) continue;
    const kv = /^([A-Za-z_][\w.-]*)\s*[=:]\s*(.*)$/.exec(l);
    if (kv !== null && !/^\s/.test(l)) {
      chave = kv[1] as string;
      atual.kv.set(chave, kv[2] as string);
    } else if (chave !== null && /^\s+\S/.test(l)) atual.kv.set(chave, `${atual.kv.get(chave) ?? ""}\n${l.trim()}`);
  }
  fechar();
  return contratos;
}

function contratosToml(a: ArquivoConfig): ContratoIL[] {
  const contratos: ContratoIL[] = [];
  const linhas = a.texto.split(/\r?\n/);
  let dentro = false;
  let atual: ContratoIL | null = null;
  let acumulando: { chave: string; texto: string } | null = null;
  const fechar = (): void => {
    if (atual !== null) contratos.push(atual);
    atual = null;
  };
  const valores = (t: string): string[] => [...t.matchAll(/["']([^"']+)["']/g)].map((m) => m[1] as string);
  const aplicar = (chave: string, texto: string): void => {
    if (atual === null) return;
    if (chave === "name") atual.nome = valores(texto)[0] ?? atual.nome;
    else if (chave === "type") atual.tipo = valores(texto)[0] ?? "";
    else if (chave === "layers") atual.camadas = valores(texto);
    else if (chave === "source_modules") atual.fontes = valores(texto);
    else if (chave === "forbidden_modules") atual.proibidos = valores(texto);
  };
  for (let i = 0; i < linhas.length; i++) {
    const l = (linhas[i] as string).replace(/\s+#.*$/, "");
    if (acumulando !== null) {
      acumulando.texto += `\n${l}`;
      if (l.includes("]")) {
        aplicar(acumulando.chave, acumulando.texto);
        acumulando = null;
      }
      continue;
    }
    const sec = /^\s*\[\[?([^\]]+)\]\]?\s*$/.exec(l);
    if (sec !== null) {
      fechar();
      dentro = (sec[1] as string).trim() === "tool.importlinter.contracts";
      if (dentro) atual = { nome: `contrato@${i + 1}`, tipo: "", camadas: [], fontes: [], proibidos: [], linha: i + 1 };
      continue;
    }
    if (!dentro) continue;
    const kv = /^\s*([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(l);
    if (kv === null) continue;
    if ((kv[2] as string).trim().startsWith("[") && !(kv[2] as string).includes("]")) acumulando = { chave: kv[1] as string, texto: kv[2] as string };
    else aplicar(kv[1] as string, kv[2] as string);
  }
  fechar();
  return contratos;
}

/** `pacote.sub` → regex sobre o caminho (`(^|/)pacote/sub(/|\.py$)`); `*` na lista de camadas (irmãos) é ignorado. */
function padraoPython(modulo: string): string {
  const caminho = modulo.replace(/\./g, "/");
  return `(^|/)${escapar(caminho)}(/|\\.py$)`;
}

function importLinter(a: ArquivoConfig, avisos: string[]): RegraFronteira[] {
  const contratos = /pyproject\.toml$/.test(a.caminho) ? contratosToml(a) : contratosIni(a);
  const regras: RegraFronteira[] = [];
  for (const c of contratos) {
    const fonte = { arquivo: a.caminho, linha: c.linha };
    if (c.tipo === "layers") {
      // `layers` em ordem: o primeiro é o mais alto; camada baixa não pode importar camada alta
      const cs = c.camadas.map((x) => x.split("|")[0]?.trim() ?? x);
      for (let alta = 0; alta < cs.length; alta++) {
        for (let baixa = alta + 1; baixa < cs.length; baixa++) {
          const raiz = c.fontes[0] ?? "";
          const mod = (x: string): string => (raiz === "" ? x : `${raiz}.${x}`);
          regras.push({ ferramenta: "import-linter", tipo: "proibida", nome: c.nome, origem: cs[baixa] as string, destino: cs[alta] as string, origemPadroes: [padraoPython(mod(cs[baixa] as string))], destinoPadroes: [padraoPython(mod(cs[alta] as string))], descricao: `contrato "${c.nome}" (layers): ${cs[baixa]} não pode importar ${cs[alta]}`, fonte });
        }
      }
    } else if (c.tipo === "forbidden") {
      if (c.fontes.length === 0 || c.proibidos.length === 0) continue;
      regras.push({ ferramenta: "import-linter", tipo: "proibida", nome: c.nome, origem: c.fontes.join(", "), destino: c.proibidos.join(", "), origemPadroes: c.fontes.map(padraoPython), destinoPadroes: c.proibidos.map(padraoPython), descricao: `contrato "${c.nome}" (forbidden): ${c.fontes.join(", ")} não pode importar ${c.proibidos.join(", ")}`, fonte });
    } else if (c.tipo !== "") avisos.push(`${a.caminho}:${c.linha}: contrato import-linter do tipo "${c.tipo}" não é suportado (só layers e forbidden)`);
  }
  return regras;
}

// ---------------------------------------------------------------------------------------------
// dependency-cruiser (JSON)

interface RegraDC {
  name?: string;
  severity?: string;
  from?: { path?: string | string[] };
  to?: { path?: string | string[] };
}

function dependencyCruiser(a: ArquivoConfig, avisos: string[]): RegraFronteira[] {
  if (!/\.json$/.test(a.caminho)) {
    avisos.push(`${a.caminho}: não lida (configuração em JavaScript: avaliá-la executaria código do projeto)`);
    return [];
  }
  let json: { forbidden?: RegraDC[] };
  try {
    json = JSON.parse(a.texto) as { forbidden?: RegraDC[] };
  } catch {
    avisos.push(`${a.caminho}: JSON inválido; regras do dependency-cruiser não importadas`);
    return [];
  }
  const regras: RegraFronteira[] = [];
  const linhas = a.texto.split("\n");
  for (const r of json.forbidden ?? []) {
    const lista = (p: string | string[] | undefined): string[] => (p === undefined ? [] : Array.isArray(p) ? p : [p]);
    const origem = lista(r.from?.path);
    const destino = lista(r.to?.path);
    if (origem.length === 0 || destino.length === 0) continue; // regras sem `path` (circular, orphan, etc.) não viram par de caminhos
    const nome = r.name ?? "regra";
    const idx = linhas.findIndex((l) => l.includes(`"name"`) && l.includes(`"${nome}"`));
    regras.push({ ferramenta: "dependency-cruiser", tipo: "proibida", nome, origem: origem.join(" | "), destino: destino.join(" | "), origemPadroes: origem, destinoPadroes: destino, descricao: `regra "${nome}" (${r.severity ?? "error"}): ${origem.join(" | ")} não pode depender de ${destino.join(" | ")}`, fonte: { arquivo: a.caminho, linha: idx < 0 ? 1 : idx + 1 } });
  }
  return regras;
}

// ---------------------------------------------------------------------------------------------
// Packwerk

interface Pacote {
  pasta: string;
  enforce: boolean;
  dependencias: Set<string>;
  linha: number;
  arquivo: string;
}

function packwerk(arquivos: readonly ArquivoConfig[], avisos: string[]): RegraFronteira[] {
  const pacotes: Pacote[] = [];
  for (const a of arquivos) {
    const lc = new LineCounter();
    const doc = parseDocument(a.texto, { lineCounter: lc });
    if (doc.errors.length > 0) {
      avisos.push(`${a.caminho}: YAML inválido; pacote Packwerk não importado`);
      continue;
    }
    const enforce = doc.get("enforce_dependencies");
    const deps = doc.get("dependencies", true);
    const lista = new Set<string>();
    if (isSeq(deps)) for (const d of deps.items) lista.add(String(isScalar(d) ? d.value : d).replace(/\/$/, ""));
    const linha = isMap(doc.contents) && doc.contents.items[0] !== undefined ? linhaYaml(lc, doc.contents.items[0].key) : 1;
    pacotes.push({ pasta: pastaDe(a.caminho), enforce: enforce === true || enforce === "strict", dependencias: lista, linha, arquivo: a.caminho });
  }
  const regras: RegraFronteira[] = [];
  const reais = pacotes.filter((p) => p.pasta !== ".");
  for (const p of reais) {
    if (!p.enforce) continue;
    for (const q of reais) {
      if (q === p || p.dependencias.has(q.pasta)) continue;
      if (q.pasta.startsWith(`${p.pasta}/`) || p.pasta.startsWith(`${q.pasta}/`)) continue; // pacotes aninhados: ambíguo, não vira regra
      regras.push({ ferramenta: "packwerk", tipo: "proibida", nome: `${p.pasta} -> ${q.pasta}`, origem: p.pasta, destino: q.pasta, origemPadroes: [`^${escapar(p.pasta)}/`], destinoPadroes: [`^${escapar(q.pasta)}/`], descricao: `${p.pasta} (enforce_dependencies) não declara dependência de ${q.pasta}`, fonte: { arquivo: p.arquivo, linha: p.linha } });
    }
  }
  return regras;
}

/** Importa as regras de todos os arquivos de configuração reconhecidos. Arquivos não relacionados são ignorados. */
export function importarRegras(arquivos: readonly ArquivoConfig[]): ResultadoRegras {
  const avisos: string[] = [];
  const regras: RegraFronteira[] = [];
  const packs: ArquivoConfig[] = [];
  for (const a of arquivos) {
    const b = base(a.caminho);
    if (/^(deptrac|depfile)(\..+)?\.ya?ml$/.test(b)) regras.push(...deptrac(a, avisos));
    else if (b === ".importlinter" || (b === "setup.cfg" && a.texto.includes("importlinter:contract")) || (b === "pyproject.toml" && a.texto.includes("tool.importlinter"))) regras.push(...importLinter(a, avisos));
    else if (/^\.dependency-cruiser\.(json|js|cjs|mjs)$/.test(b)) regras.push(...dependencyCruiser(a, avisos));
    else if (b === "package.yml") packs.push(a);
  }
  if (packs.length > 0) regras.push(...packwerk(packs, avisos));
  return { regras, avisos };
}

// ---------------------------------------------------------------------------------------------
// Avaliação

export interface ArestaImportaCaminho {
  /** Caminhos relativos dos arquivos (não ids). */
  de: string;
  para: string;
  linha?: number | null;
}

export interface ViolacaoFronteira {
  regra: RegraFronteira;
  de: string;
  para: string;
  /** `arquivo:linha` da importação que viola. */
  evidencia: string;
  /** `arquivo:linha` da regra violada. */
  regra_fonte: string;
}

function compilar(padroes: readonly string[]): RegExp[] {
  const r: RegExp[] = [];
  for (const p of padroes) {
    try {
      r.push(new RegExp(p));
    } catch {
      // regex inválida na configuração do projeto: ignorada
    }
  }
  return r;
}

/** Violações: toda aresta de importação cujo par (origem, destino) casa com uma regra proibida. Sempre cita a regra. */
export function avaliarRegras(regras: readonly RegraFronteira[], arestas: readonly ArestaImportaCaminho[]): ViolacaoFronteira[] {
  const compiladas = regras.map((r) => ({ r, o: compilar(r.origemPadroes), d: compilar(r.destinoPadroes) }));
  const saida: ViolacaoFronteira[] = [];
  for (const e of arestas) {
    if (e.de === e.para) continue;
    for (const c of compiladas) {
      if (c.o.some((x) => x.test(e.de)) && c.d.some((x) => x.test(e.para))) {
        saida.push({ regra: c.r, de: e.de, para: e.para, evidencia: `${e.de}:${e.linha ?? 1}`, regra_fonte: `${c.r.fonte.arquivo}:${c.r.fonte.linha}` });
      }
    }
  }
  return saida;
}

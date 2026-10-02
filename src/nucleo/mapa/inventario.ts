import type { DadosAnaliseMapa } from "../../compartilhado/mapa";
import type { Manifesto } from "./manifestos";
import { analisarPadroes, classificarForca, type Forca, type ResultadoPadroes } from "./analises/padroes";
import type { ArquivoMapa } from "./analises/tipos";

// Inventário do stackx (T-17.31): fatos com FORÇA (UNÂNIME | MAJORITÁRIO n/m | CONFLITO | ÚNICO CASO | AUSENTE) e evidência
// `arquivo:linha`, pré-calculados para o `cartografo` CONFIRMAR POR AMOSTRAGEM. O mapa não decide convenção: entrega fatos com
// contagem. Só nomes de variáveis de ambiente; nenhum valor, nenhuma linha de código.

export interface ItemInventario {
  topico: string;
  fato: string;
  /** Até 5 `arquivo:linha`. */
  evidencia: string[];
  forca: Forca;
  contagens: Record<string, number>;
  confianca: "exata" | "heuristica";
}

export interface EntradaInventario {
  arquivos: readonly ArquivoMapa[];
  manifestos?: readonly Manifesto[];
  camadas?: DadosAnaliseMapa["camadas"] | null;
  /** Data de criação (ms) por caminho, para a recência (desempate de CONFLITO). */
  criado?: ReadonlyMap<string, number>;
  padroes?: ResultadoPadroes;
  /** Aliases de import extras (ex.: `tsconfig paths`). */
  aliases?: ReadonlyArray<{ alias: string; alvo: string; evidencia: string }>;
}

const MAX_EVID = 5;
const RE_PASTA_TESTE = /(^|\/)(tests?|__tests__|spec|specs|testes?)(\/|$)/i;

const base = (c: string): string => c.slice(c.lastIndexOf("/") + 1);
const pasta = (c: string): string => (c.includes("/") ? c.slice(0, c.lastIndexOf("/")) : ".");

/** Forma do nome de teste: `*.test.ts`, `test_*.py`, `*_test.go`, `*Test.java`… */
export function formaDoNomeDeTeste(caminho: string): string {
  const nome = base(caminho);
  let m = /\.(test|spec)\.([A-Za-z0-9]+)$/.exec(nome);
  if (m !== null) return `*.${m[1]}.${m[2]}`;
  m = /^test_.*\.(py|rb|php)$/.exec(nome);
  if (m !== null) return `test_*.${m[1]}`;
  m = /_(test|spec)\.([A-Za-z0-9]+)$/.exec(nome);
  if (m !== null) return `*_${m[1]}.${m[2]}`;
  m = /(Tests?|Spec)\.(java|cs|php|kt|scala)$/.exec(nome);
  if (m !== null) return `*${m[1]}.${m[2]}`;
  return "outro padrão";
}

const RUNNERS: Array<[RegExp, string]> = [
  [/^vitest($|\/)/, "vitest"], [/^@jest\/|^jest($|\/)/, "jest"], [/^mocha($|\/)/, "mocha"], [/^pytest($|\/)/, "pytest"], [/^unittest($|\.)/, "unittest"],
  [/^org\.junit/, "junit"], [/^(Xunit|NUnit|Microsoft\.VisualStudio\.TestTools)/, "xunit/nunit/mstest"], [/^PHPUnit\b/i, "phpunit"], [/^rspec($|\/)/, "rspec"],
  [/^testing$/, "testing (go)"], [/^@playwright\/test$/, "playwright"], [/^node:test$/, "node:test"],
];

function porVariante(map: Map<string, string[]>): Array<{ nome: string; n: number; evid: string[] }> {
  return [...map].map(([nome, evid]) => ({ nome, n: evid.length, evid })).sort((a, b) => b.n - a.n || a.nome.localeCompare(b.nome));
}
const contagensDe = (vs: ReadonlyArray<{ nome: string; n: number }>): Record<string, number> => Object.fromEntries(vs.map((v) => [v.nome, v.n]));
const evidDe = (vs: ReadonlyArray<{ evid: string[] }>): string[] => {
  const out: string[] = [];
  // intercala para que cada variante apareça na amostra
  for (let i = 0; out.length < MAX_EVID; i++) {
    let algum = false;
    for (const v of vs) if (v.evid[i] !== undefined && out.length < MAX_EVID) { out.push(v.evid[i] as string); algum = true; }
    if (!algum) break;
  }
  return out;
};

function item(topico: string, fato: string, vs: Array<{ nome: string; n: number; evid: string[]; criado_medio?: number | null }>, confianca: ItemInventario["confianca"], extra: Record<string, number> = {}): ItemInventario {
  const f = classificarForca(vs.map((v) => ({ nome: v.nome, n: v.n, ...(v.criado_medio !== undefined ? { criado_medio: v.criado_medio } : {}) })));
  return { topico, fato, evidencia: evidDe(vs), forca: f.forca, contagens: { ...contagensDe(vs), ...extra }, confianca };
}

const lista = (vs: ReadonlyArray<{ nome: string; n: number }>): string => (vs.length === 0 ? "nenhum" : vs.map((v) => `${v.nome} (${v.n})`).join("; "));

export function montarInventarioStackx(e: EntradaInventario): ItemInventario[] {
  const itens: ItemInventario[] = [];
  const testes = e.arquivos.filter((a) => a.extracao.e_teste && !a.extracao.e_gerado).sort((a, b) => a.caminho.localeCompare(b.caminho));
  const caminhos = new Set(e.arquivos.map((a) => a.caminho));

  // 1. onde o teste mora
  const loc = new Map<string, string[]>();
  const nomes = new Map<string, string[]>();
  for (const t of testes) {
    const nome = base(t.caminho);
    const stem = nome.replace(/\.(test|spec)(?=\.)/, "").replace(/^test_/, "").replace(/_(test|spec)(?=\.)/, "").replace(/(Tests?|Spec)(?=\.)/, "");
    const irmaos = [...caminhos].some((c) => pasta(c) === pasta(t.caminho) && c !== t.caminho && base(c) === stem);
    const k = RE_PASTA_TESTE.test(t.caminho) ? "pasta própria de testes" : irmaos ? "co-localizado com o código" : "pasta própria de testes";
    (loc.get(k) ?? loc.set(k, []).get(k) as string[]).push(`${t.caminho}:1`);
    const f = formaDoNomeDeTeste(t.caminho);
    (nomes.get(f) ?? nomes.set(f, []).get(f) as string[]).push(`${t.caminho}:1`);
  }
  const vl = porVariante(loc);
  itens.push(item("teste.localizacao", `Onde os testes moram: ${lista(vl)}.`, vl, "exata", { testes: testes.length }));
  const vn = porVariante(nomes);
  itens.push(item("teste.nome", `Forma do nome dos testes: ${lista(vn)}.`, vn, "exata"));

  // 2. runner por imports nos testes
  const runners = new Map<string, string[]>();
  for (const t of testes) {
    const vistos = new Set<string>();
    for (const i of t.extracao.imports) {
      const r = RUNNERS.find(([re]) => re.test(i.especificador));
      if (r !== undefined && !vistos.has(r[1])) { vistos.add(r[1]); (runners.get(r[1]) ?? runners.set(r[1], []).get(r[1]) as string[]).push(`${t.caminho}:${i.linha}`); }
    }
  }
  const vr = porVariante(runners);
  itens.push(item("teste.runner", `Runner de testes pelos imports: ${lista(vr)}.`, vr, "exata"));

  // 3. fixture / factory / mock
  const aux = new Map<string, string[]>();
  const marca = (k: string, t: ArquivoMapa, linha: number): void => { (aux.get(k) ?? aux.set(k, []).get(k) as string[]).push(`${t.caminho}:${linha}`); };
  for (const t of testes) {
    const x = t.extracao;
    const m = x.chamadas.find((c) => /^(mock|fn|spyOn|patch|Mock|stub|double|createMock)$/.test(c.alvo) && (c.receptor === null || /^(vi|jest|mocker|mock|sinon|unittest\.mock)$/.test(c.receptor)));
    if (m !== undefined) marca("mock", t, m.linha);
    const f = x.simbolos.find((s) => /fixture/i.test(s.nome) || s.decoradores.some((d) => /fixture/i.test(d))) ?? x.imports.find((i) => /fixture/i.test(i.especificador));
    if (f !== undefined) marca("fixture", t, f.linha);
    const fa = x.simbolos.find((s) => /factory/i.test(s.nome)) ?? x.imports.find((i) => /factor(y|ies)/i.test(i.especificador));
    if (fa !== undefined) marca("factory", t, fa.linha);
  }
  const va = porVariante(aux);
  itens.push(item("teste.apoio", `Apoio de teste (arquivos de teste que usam): ${lista(va)}.`, va, "heuristica"));

  // 4. camadas e direção de dependência
  const cam = e.camadas ?? null;
  if (cam === null || cam.modulos.length === 0) {
    itens.push({ topico: "camadas.direcao", fato: "Sem módulos analisados para inferir direção de dependência.", evidencia: [], forca: "AUSENTE", contagens: { modulos: 0 }, confianca: "heuristica" });
  } else {
    const emCiclo = cam.modulos.filter((m) => m.ciclo_id !== null).length;
    const vs = [{ nome: "módulos fora de ciclo", n: cam.modulos.length - emCiclo, evid: [] as string[] }, { nome: "módulos em ciclo", n: emCiclo, evid: [] as string[] }];
    const topo: string[] = [];
    const { modulos, celulas } = cam.dsm;
    const pares: Array<{ de: string; para: string; n: number }> = [];
    celulas.forEach((linha, i) => linha.forEach((n, j) => { if (n > 0 && i !== j) pares.push({ de: modulos[i] as string, para: modulos[j] as string, n }); }));
    pares.sort((a, b) => b.n - a.n || a.de.localeCompare(b.de) || a.para.localeCompare(b.para));
    for (const p of pares.slice(0, 5)) topo.push(`${p.de} -> ${p.para} (${p.n})`);
    const evid = cam.violacoes.flatMap((v) => v.evidencias).slice(0, MAX_EVID);
    const fort = classificarForca(vs.map((v) => ({ nome: v.nome, n: v.n })));
    itens.push({
      topico: "camadas.direcao",
      fato: `Direção de dependência entre módulos (quem importa quem): ${topo.length === 0 ? "sem dependências entre módulos" : topo.join("; ")}. ${cam.violacoes.length} violações candidatas; ${cam.regras_importadas} regras estáticas importadas.`,
      evidencia: evid, forca: fort.forca,
      contagens: { modulos: cam.modulos.length, em_ciclo: emCiclo, violacoes: cam.violacoes.length, regras_importadas: cam.regras_importadas },
      confianca: cam.regras_importadas > 0 ? "exata" : "heuristica",
    });
  }

  // 5-7. padrões: erro, config, dialeto mais recente
  const padroes = e.padroes ?? analisarPadroes(e.arquivos, e.criado);
  const eixo = (nome: string) => padroes.eixos.find((x) => x.eixo === nome);
  const ex = eixo("erro");
  if (ex !== undefined) {
    const vs = ex.variantes.map((v) => ({ nome: v.nome, n: v.arquivos, evid: v.evidencias, criado_medio: v.criado_medio === null ? null : Date.parse(v.criado_medio) }));
    const porPasta: Record<string, number> = {};
    for (const v of ex.variantes) for (const [p, n] of Object.entries(v.por_pasta)) porPasta[p] = (porPasta[p] ?? 0) + n;
    const topPastas = Object.entries(porPasta).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([p, n]) => `${p} (${n})`);
    itens.push(item("erro.sinalizacao", `Como o erro é sinalizado (arquivos): ${lista(vs)}. Pastas com mais ocorrências: ${topPastas.join("; ") || "nenhuma"}.`, vs, "heuristica"));
  }
  const ec = eixo("config");
  const nomesEnv = padroes.variaveis_de_ambiente.slice(0, 30).map((v) => v.nome);
  if (ec !== undefined) {
    const vs = ec.variantes.map((v) => ({ nome: v.nome, n: v.arquivos, evid: v.evidencias, criado_medio: v.criado_medio === null ? null : Date.parse(v.criado_medio) }));
    itens.push(item("config.leitura", `Como a configuração é lida: ${lista(vs)}. Variáveis de ambiente lidas (só nomes): ${nomesEnv.join(", ") || "nenhuma"}.`, vs, "exata", { variaveis_distintas: padroes.variaveis_de_ambiente.length }));
  }
  const conflitos = padroes.eixos.filter((x) => x.forca.forca === "CONFLITO");
  const recentes: string[] = [];
  const evidRec: string[] = [];
  for (const x of conflitos) {
    const comData = x.variantes.filter((v) => v.criado_medio !== null).sort((a, b) => Date.parse(b.criado_medio as string) - Date.parse(a.criado_medio as string));
    if (comData[0] !== undefined) { recentes.push(`${x.eixo}: ${comData[0].nome} (criado em média ${(comData[0].criado_medio as string).slice(0, 10)})`); evidRec.push(...comData[0].evidencias.slice(0, 1)); }
    else recentes.push(`${x.eixo}: sem datas do git para desempatar`);
  }
  itens.push({
    topico: "dialeto.recente", fato: conflitos.length === 0 ? "Nenhum eixo em conflito." : `Eixos em conflito e dialeto mais recente: ${recentes.join("; ")}.`,
    evidencia: evidRec.slice(0, MAX_EVID), forca: conflitos.length === 0 ? "AUSENTE" : "CONFLITO", contagens: { eixos_em_conflito: conflitos.length }, confianca: "heuristica",
  });

  // 8. aliases de import
  const alias: Array<{ nome: string; n: number; evid: string[] }> = [];
  for (const m of e.manifestos ?? []) {
    for (const p of m.psr4) alias.push({ nome: `psr4 ${p.prefixo} -> ${p.pasta}`, n: 1, evid: [`${m.arquivo}:1`] });
    if (m.go_modulo !== null) alias.push({ nome: `go module ${m.go_modulo}`, n: 1, evid: [`${m.arquivo}:1`] });
  }
  for (const a of e.aliases ?? []) alias.push({ nome: `${a.alias} -> ${a.alvo}`, n: 1, evid: [a.evidencia] });
  alias.sort((a, b) => a.nome.localeCompare(b.nome));
  const fa = classificarForca([{ nome: "alias declarado", n: alias.length }]);
  itens.push({ topico: "import.aliases", fato: alias.length === 0 ? "Nenhum alias de import declarado." : `Aliases de import declarados: ${alias.slice(0, 10).map((a) => a.nome).join("; ")}.`, evidencia: alias.flatMap((a) => a.evid).slice(0, MAX_EVID), forca: fa.forca, contagens: { aliases: alias.length }, confianca: "exata" });

  // 9. comandos reais declarados
  const porTipo = new Map<string, string[]>();
  const nomesCmd: string[] = [];
  for (const m of e.manifestos ?? []) {
    for (const c of m.comandos) {
      (porTipo.get(m.tipo) ?? porTipo.set(m.tipo, []).get(m.tipo) as string[]).push(`${c.arquivo}:${c.linha}`);
      nomesCmd.push(c.nome);
    }
  }
  const vc = porVariante(porTipo);
  const fc = classificarForca(vc.map((v) => ({ nome: v.nome, n: v.n })));
  itens.push({ topico: "comandos.declarados", fato: vc.length === 0 ? "Nenhum comando declarado em manifesto." : `Comandos declarados (nunca inferidos) por fonte: ${lista(vc)}. Nomes: ${[...new Set(nomesCmd)].sort().slice(0, 20).join(", ")}.`, evidencia: evidDe(vc), forca: fc.forca, contagens: contagensDe(vc), confianca: "exata" });
  return itens;
}

export interface MudancasInventario {
  primeira_analise: boolean;
  novos: string[];
  removidos: string[];
  alterados: Array<{ topico: string; antes: { fato: string; forca: Forca }; depois: { fato: string; forca: Forca } }>;
}

export function compararInventarios(atual: readonly ItemInventario[], anterior: readonly ItemInventario[] | null): MudancasInventario {
  if (anterior === null) return { primeira_analise: true, novos: atual.map((i) => i.topico).sort(), removidos: [], alterados: [] };
  const a = new Map(anterior.map((i) => [i.topico, i]));
  const b = new Map(atual.map((i) => [i.topico, i]));
  const alterados: MudancasInventario["alterados"] = [];
  for (const [t, i] of [...b].sort((x, y) => x[0].localeCompare(y[0]))) {
    const o = a.get(t);
    if (o !== undefined && (o.fato !== i.fato || o.forca !== i.forca)) alterados.push({ topico: t, antes: { fato: o.fato, forca: o.forca }, depois: { fato: i.fato, forca: i.forca } });
  }
  return { primeira_analise: false, novos: [...b.keys()].filter((t) => !a.has(t)).sort(), removidos: [...a.keys()].filter((t) => !b.has(t)).sort(), alterados };
}

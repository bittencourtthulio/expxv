import type { ImportBruto } from "../tipos";
import { Acumulador, arquivosDe, dirnameRel, idArquivo, idExterno, manifestoMaisProximo, type ArquivoParaResolver, type ContextoResolucao, type Resolvedor, type ResultadoResolucao } from "./comum";

// Resolvedor Java (T-17.17). O pacote do arquivo é derivado do CAMINHO (`src/main/java/<pacote>/`), porque a extração
// ainda não carrega `package` (pedido em docs/ade/pedidos/17-pedidos.md). FQN -> arquivo pelo índice pacote+classe;
// curinga; mesmo pacote sem import (visibilidade implícita); multi-módulo Maven/Gradle pelos manifestos.

const RAIZES_FONTE = /(?:^|\/)src\/(?:main|test|integrationTest|testFixtures)\/(?:java|kotlin|scala|groovy)\//;

/** Pacote derivado do caminho. `null` se o arquivo não está sob uma raiz de fontes reconhecível. */
export function pacoteDoCaminho(caminho: string): string | null {
  const pasta = dirnameRel(caminho);
  const m = RAIZES_FONTE.exec(`${pasta}/`);
  let sub: string | null = null;
  if (m !== null) sub = `${pasta}/`.slice(m.index + m[0].length);
  else {
    const partes = pasta.split("/");
    const i = partes.lastIndexOf("java");
    if (i >= 0) sub = partes.slice(i + 1).join("/");
    else if (partes[0] === "src") sub = partes.slice(1).join("/");
  }
  if (sub === null) return null;
  return sub.replace(/\/$/, "").split("/").filter(Boolean).join(".");
}

const STDLIB = /^(java|javax|jdk|sun|com\.sun)\./;

function grupoExterno(fqn: string): string {
  return fqn.split(".").slice(0, 3).join(".");
}

interface Indice {
  porFqn: Map<string, string>;
  porPacote: Map<string, string[]>;
  pacoteDe: Map<string, string>;
}

function indexar(arquivos: readonly ArquivoParaResolver[]): Indice {
  const porFqn = new Map<string, string>();
  const porPacote = new Map<string, string[]>();
  const pacoteDe = new Map<string, string>();
  for (const a of arquivos) {
    const pac = pacoteDoCaminho(a.caminho);
    if (pac === null) continue;
    pacoteDe.set(a.caminho, pac);
    const lista = porPacote.get(pac) ?? [];
    lista.push(a.caminho);
    porPacote.set(pac, lista);
    for (const s of a.extracao.simbolos) {
      if (s.qualificado.includes(".") || !["classe", "interface", "enum"].includes(s.tipo)) continue;
      const fqn = pac === "" ? s.nome : `${pac}.${s.nome}`;
      if (!porFqn.has(fqn)) porFqn.set(fqn, a.caminho);
    }
  }
  return { porFqn, porPacote, pacoteDe };
}

/** FQN -> arquivo, tentando classes aninhadas (`a.b.C.Inner` -> `a.b.C`). */
function acharClasse(fqn: string, idx: Indice): string | null {
  let atual = fqn;
  for (;;) {
    const r = idx.porFqn.get(atual);
    if (r !== undefined) return r;
    const i = atual.lastIndexOf(".");
    if (i < 0) return null;
    atual = atual.slice(0, i);
  }
}

/** `true` se o pacote imediato do FQN é do projeto. */
function pacoteLocal(fqn: string, idx: Indice): boolean {
  const i = fqn.lastIndexOf(".");
  return i > 0 && idx.porPacote.has(fqn.slice(0, i));
}

export const resolvedorJava: Resolvedor = {
  linguagens: ["java"],
  resolver(ctx: ContextoResolucao): ResultadoResolucao {
    const ac = new Acumulador();
    const arquivos = arquivosDe(ctx, ["java"]);
    const idx = indexar(arquivos);
    const poms = ctx.manifestos.filter((m) => m.eco === "maven" && (m.tipo === "pom.xml" || m.tipo === "gradle"));
    const moduloDe = (c: string): string | null => manifestoMaisProximo(poms, "pom.xml", c)?.pasta ?? manifestoMaisProximo(poms, "gradle", c)?.pasta ?? null;
    const mesmoModuloOuDeclarado = (de: string, para: string): boolean => {
      const a = moduloDe(de);
      const b = moduloDe(para);
      if (a === null || b === null || a === b) return true;
      if (poms.filter((m) => m.tipo === "pom.xml").length < 2 && poms.length < 2) return true;
      const mb = poms.find((m) => m.pasta === b && m.nome !== null);
      const ma = poms.find((m) => m.pasta === a);
      return ma !== undefined && mb !== undefined && ma.deps.some((d) => d.nome.split(":").pop() === mb.nome || d.nome === mb.nome);
    };

    for (const a of arquivos) {
      const meuPacote = idx.pacoteDe.get(a.caminho) ?? null;
      const importados = new Set<string>(); // nomes simples já cobertos por import explícito
      for (const imp of a.extracao.imports) {
        const spec = imp.especificador;
        const curinga = imp.nomes.some((n) => n.nome === "*");
        if (curinga) {
          const cls = acharClasse(spec, idx);
          if (cls !== null && idx.porFqn.has(spec)) {
            ac.ligar(a.caminho, imp, idArquivo(cls), mesmoModuloOuDeclarado(a.caminho, cls) ? "exata" : "heuristica");
            continue;
          }
          const doPacote = (idx.porPacote.get(spec) ?? []).filter((c) => c !== a.caminho).slice(0, 50);
          if (doPacote.length > 0) {
            ac.ligarMuitos(a.caminho, imp, doPacote.map(idArquivo), "heuristica");
            continue;
          }
          ac.ligar(a.caminho, imp, STDLIB.test(`${spec}.`) ? idExterno("stdlib", spec) : idExterno("maven", grupoExterno(spec)), "exata");
          continue;
        }
        importados.add(spec.split(".").pop() as string);
        const cls = acharClasse(spec, idx);
        if (cls !== null) {
          ac.ligar(a.caminho, imp, idArquivo(cls), mesmoModuloOuDeclarado(a.caminho, cls) ? "exata" : "heuristica");
          continue;
        }
        if (pacoteLocal(spec, idx)) {
          ac.perdido(a.caminho, imp, "nao_encontrado"); // o pacote é do projeto, mas a classe não existe nele
          continue;
        }
        if (STDLIB.test(spec)) ac.ligar(a.caminho, imp, idExterno("stdlib", spec.split(".").slice(0, 2).join(".")), "exata");
        else ac.ligar(a.caminho, imp, idExterno("maven", grupoExterno(spec)), "exata");
      }

      // mesmo pacote sem import: nomes de tipo usados que existem no pacote
      if (meuPacote !== null) {
        const visto = new Set<string>();
        const usar = (nome: string | null | undefined, linha: number): void => {
          if (nome === undefined || nome === null) return;
          const simples = nome.split(".")[0] as string;
          if (!/^[A-Z]/.test(simples) || importados.has(simples) || visto.has(simples)) return;
          const fqn = meuPacote === "" ? simples : `${meuPacote}.${simples}`;
          const alvo = idx.porFqn.get(fqn);
          if (alvo === undefined || alvo === a.caminho) return;
          visto.add(simples);
          const sintetico: ImportBruto = { especificador: fqn, tipo: "estatico", linha, so_tipo: false, nomes: [] };
          ac.ligar(a.caminho, sintetico, idArquivo(alvo), "exata");
        };
        for (const h of a.extracao.herancas ?? []) usar(h.base, h.linha);
        for (const c of a.extracao.chamadas ?? []) {
          usar(c.tipo === "chamada" ? c.receptor : c.alvo, c.linha);
          if (c.tipo === "chamada") usar(c.alvo, c.linha);
        }
      }
    }
    return ac.resultado();
  },
};

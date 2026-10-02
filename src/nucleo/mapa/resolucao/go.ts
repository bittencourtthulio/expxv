import type { ImportBruto } from "../tipos";
import { Acumulador, arquivosDe, dirnameRel, idArquivo, idExterno, normalizarRel, type ArquivoParaResolver, type ContextoResolucao, type Resolvedor, type ResultadoResolucao } from "./comum";

// Resolvedor Go (T-17.18). `module` do go.mod + diretório = pacote: o import liga ao pacote (refinado pelos símbolos
// que o arquivo usa de fato: `pkg.Nome`); `vendor/`; `replace` local respeitado, remoto ignorado; stdlib -> externo.

const MAX_ARQUIVOS_PACOTE = 200;

interface Mapa {
  prefixo: string;
  pasta: string;
}

function nomeLocal(spec: string, imp: ImportBruto): string | null {
  const alias = imp.nomes[0]?.alias ?? null;
  if (alias === "_" || alias === ".") return null;
  if (alias !== null) return alias;
  const ult = spec.split("/").pop() as string;
  const semVersao = /^v\d+$/.test(ult) ? (spec.split("/").slice(-2, -1)[0] as string) : ult;
  return semVersao.replace(/^go-/, "").replace(/[-.]/g, "_");
}

export const resolvedorGo: Resolvedor = {
  linguagens: ["go"],
  resolver(ctx: ContextoResolucao): ResultadoResolucao {
    const ac = new Acumulador();
    const arquivos = arquivosDe(ctx, ["go"]);
    const porPasta = new Map<string, ArquivoParaResolver[]>();
    for (const a of arquivos) {
      const p = dirnameRel(a.caminho);
      const l = porPasta.get(p) ?? [];
      l.push(a);
      porPasta.set(p, l);
    }
    const mapas: Mapa[] = [];
    const depsConhecidas: string[] = [];
    const pastasVendor: string[] = [];
    for (const m of ctx.manifestos) {
      if (m.tipo !== "go.mod") continue;
      if (m.go_modulo !== null) mapas.push({ prefixo: m.go_modulo, pasta: m.pasta });
      for (const r of m.go_replaces) mapas.push({ prefixo: r.de, pasta: r.para });
      for (const d of m.deps) depsConhecidas.push(d.nome);
      pastasVendor.push(m.pasta === "" ? "vendor" : `${m.pasta}/vendor`);
    }
    mapas.sort((a, b) => b.prefixo.length - a.prefixo.length);
    depsConhecidas.sort((a, b) => b.length - a.length);

    const alvosNaPasta = (pasta: string): ArquivoParaResolver[] =>
      (porPasta.get(pasta) ?? []).filter((f) => !f.caminho.endsWith("_test.go")).slice(0, MAX_ARQUIVOS_PACOTE);

    const ligarPacote = (a: ArquivoParaResolver, imp: ImportBruto, pasta: string, confianca: "exata" | "heuristica"): boolean => {
      const candidatos = alvosNaPasta(pasta).filter((f) => f.caminho !== a.caminho);
      if (candidatos.length === 0) return false;
      const alias = imp.nomes[0]?.alias ?? null;
      let escolhidos = candidatos;
      const local = nomeLocal(imp.especificador, imp);
      if (local !== null && alias !== "_") {
        // refina: arquivos do pacote que declaram algum símbolo usado como `local.Nome`
        const usados = new Set((a.extracao.chamadas ?? []).filter((c) => c.receptor === local).map((c) => c.alvo));
        if (usados.size > 0) {
          const refinados = candidatos.filter((f) => f.extracao.simbolos.some((s) => usados.has(s.qualificado) || usados.has(s.nome)));
          if (refinados.length > 0) escolhidos = refinados;
        }
      }
      ac.ligarMuitos(a.caminho, imp, escolhidos.map((f) => idArquivo(f.caminho)), confianca);
      return true;
    };

    for (const a of arquivos)
      for (const imp of a.extracao.imports) {
        const spec = imp.especificador;
        // 1) módulo local / replace local
        const m = mapas.find((x) => spec === x.prefixo || spec.startsWith(`${x.prefixo}/`));
        if (m !== undefined) {
          const pasta = normalizarRel(m.pasta, spec.slice(m.prefixo.length));
          if (pasta === null) {
            ac.perdido(a.caminho, imp, "fora_da_raiz");
            continue;
          }
          if (ligarPacote(a, imp, pasta, "exata")) continue;
          // o próprio pacote do arquivo (import de si) não é aresta; pacote sem arquivos Go no projeto é lacuna
          if (porPasta.has(pasta) && pasta === dirnameRel(a.caminho)) {
            ac.ligar(a.caminho, imp, null, "exata");
            continue;
          }
          ac.perdido(a.caminho, imp, "nao_encontrado");
          continue;
        }
        // 2) vendor/
        let achouVendor = false;
        for (const v of pastasVendor) {
          const pasta = normalizarRel(v, spec);
          if (pasta !== null && ligarPacote(a, imp, pasta, "exata")) {
            achouVendor = true;
            break;
          }
        }
        if (achouVendor) continue;
        // 3) stdlib × externo
        const primeiro = spec.split("/")[0] as string;
        if (!primeiro.includes(".")) {
          ac.ligar(a.caminho, imp, idExterno("stdlib", spec), "exata");
          continue;
        }
        const dep = depsConhecidas.find((d) => spec === d || spec.startsWith(`${d}/`));
        const partes = spec.split("/");
        const modulo = dep ?? (partes.length >= 3 ? partes.slice(0, 3).join("/") : spec);
        ac.ligar(a.caminho, imp, idExterno("go", modulo), "exata");
      }
    return ac.resultado();
  },
};

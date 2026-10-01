import { useMemo, useState } from "react";
import type { Trabalho } from "../../../nucleo/metodo/tipos";

const LARG_NO = 132;
const ALT_NO = 34;
const COL = 176;
const LIN = 52;
const LIMITE_NOS = 500;

interface No { id: string; rotulo: string; detalhe: string; status: string | null; ciclo: boolean; critico: boolean; ausente: boolean; x: number; y: number }
interface Aresta { de: string; para: string; ciclo: boolean; critico: boolean; ausente: boolean }

const chaveNaoOrdenada = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Profundidade em camadas (DFS ignorando arestas de retorno, então ciclos não travam). */
function camadas(ids: string[], deps: Map<string, string[]>): Map<string, number> {
  const prof = new Map<string, number>();
  const visitando = new Set<string>();
  const visitar = (id: string): number => {
    const feito = prof.get(id);
    if (feito !== undefined) return feito;
    visitando.add(id);
    let d = 0;
    for (const dep of deps.get(id) ?? []) if (!visitando.has(dep)) d = Math.max(d, visitar(dep) + 1);
    visitando.delete(id);
    prof.set(id, d);
    return d;
  };
  for (const id of ids) visitar(id);
  return prof;
}

function calcular(t: Trabalho, modo: "fases" | "tasks") {
  const g = t.grafo;
  const noCiclo = new Set(g.ciclos.flat());
  const noCritico = new Set(g.caminho_critico);
  const arestaCiclo = new Set<string>();
  for (const c of g.ciclos) for (let i = 0; i < c.length; i++) arestaCiclo.add(chaveNaoOrdenada(c[i] as string, c[(i + 1) % c.length] as string));
  const arestaCritica = new Set<string>();
  for (let i = 0; i + 1 < g.caminho_critico.length; i++) arestaCritica.add(chaveNaoOrdenada(g.caminho_critico[i] as string, g.caminho_critico[i + 1] as string));

  let nos: No[] = [];
  let arestas: Aresta[] = [];
  let omitidos = 0;

  if (modo === "tasks") {
    const existentes = new Set(g.nos.map((n) => n.id));
    const deps = new Map(g.nos.map((n) => [n.id, n.depende_de.filter((d) => existentes.has(d))]));
    const prof = camadas([...existentes], deps);
    let lista = g.nos;
    if (lista.length > LIMITE_NOS) {
      const prioritarios = lista.filter((n) => noCiclo.has(n.id) || noCritico.has(n.id));
      const resto = lista.filter((n) => !noCiclo.has(n.id) && !noCritico.has(n.id));
      lista = [...prioritarios, ...resto].slice(0, LIMITE_NOS);
      omitidos = g.nos.length - lista.length;
    }
    const ocupacao = new Map<number, number>();
    const ordenada = [...lista].sort((a, b) => (prof.get(a.id) ?? 0) - (prof.get(b.id) ?? 0));
    nos = ordenada.map((n) => {
      const c = prof.get(n.id) ?? 0;
      const l = ocupacao.get(c) ?? 0;
      ocupacao.set(c, l + 1);
      return { id: n.id, rotulo: n.id, detalhe: n.fase ?? "", status: n.status, ciclo: noCiclo.has(n.id), critico: noCritico.has(n.id), ausente: false, x: c * COL + 12, y: l * LIN + 12 };
    });
    const visiveis = new Set(nos.map((n) => n.id));
    arestas = g.arestas
      .filter((a) => visiveis.has(a.de) && visiveis.has(a.para))
      .map((a) => ({ de: a.de, para: a.para, ciclo: arestaCiclo.has(chaveNaoOrdenada(a.de, a.para)), critico: arestaCritica.has(chaveNaoOrdenada(a.de, a.para)), ausente: false }));
    // dependências inexistentes: nó fantasma tracejado na camada do dependente
    const fantasmas = new Map<string, No>();
    for (const dep of g.dependencias_inexistentes) {
      const dependente = nos.find((n) => n.id === dep.de);
      if (!dependente) continue;
      if (!fantasmas.has(dep.ate)) {
        const c = Math.max(0, Math.round((dependente.x - 12) / COL) - 1);
        const l = ocupacao.get(c) ?? 0;
        ocupacao.set(c, l + 1);
        fantasmas.set(dep.ate, { id: dep.ate, rotulo: dep.ate, detalhe: "não existe", status: null, ciclo: false, critico: false, ausente: true, x: c * COL + 12, y: l * LIN + 12 });
      }
      arestas.push({ de: dep.ate, para: dep.de, ciclo: false, critico: false, ausente: true });
    }
    nos.push(...fantasmas.values());
  } else {
    const faseDe = new Map(g.nos.map((n) => [n.id, n.fase ?? "sem fase"]));
    const grupos = new Map<string, { total: number; feitas: number; ciclo: boolean; critico: boolean }>();
    for (const n of g.nos) {
      const f = n.fase ?? "sem fase";
      const s = grupos.get(f) ?? { total: 0, feitas: 0, ciclo: false, critico: false };
      s.total++;
      if (n.status === "concluida") s.feitas++;
      s.ciclo ||= noCiclo.has(n.id);
      s.critico ||= noCritico.has(n.id);
      grupos.set(f, s);
    }
    const pares = new Map<string, Aresta>();
    const ausentesPorFase = new Set<string>();
    for (const a of g.arestas) {
      const de = faseDe.get(a.de);
      const para = faseDe.get(a.para);
      if (!de || !para || de === para) continue;
      const k = `${de}>${para}`;
      const ex = pares.get(k);
      const ciclo = arestaCiclo.has(chaveNaoOrdenada(a.de, a.para));
      const critico = arestaCritica.has(chaveNaoOrdenada(a.de, a.para));
      pares.set(k, { de, para, ciclo: (ex?.ciclo ?? false) || ciclo, critico: (ex?.critico ?? false) || critico, ausente: false });
    }
    for (const d of g.dependencias_inexistentes) ausentesPorFase.add(faseDe.get(d.de) ?? "sem fase");
    arestas = [...pares.values()];
    const deps = new Map<string, string[]>();
    for (const a of arestas) deps.set(a.para, [...(deps.get(a.para) ?? []), a.de]);
    const prof = camadas([...grupos.keys()], deps);
    const ocupacao = new Map<number, number>();
    for (const [f, s] of [...grupos].sort((a, b) => (prof.get(a[0]) ?? 0) - (prof.get(b[0]) ?? 0))) {
      const c = prof.get(f) ?? 0;
      const l = ocupacao.get(c) ?? 0;
      ocupacao.set(c, l + 1);
      nos.push({ id: f, rotulo: f, detalhe: `${s.feitas}/${s.total} concluídas${ausentesPorFase.has(f) ? " · dependência inexistente" : ""}`, status: s.feitas === s.total ? "concluida" : null, ciclo: s.ciclo, critico: s.critico, ausente: ausentesPorFase.has(f), x: c * COL + 12, y: l * LIN + 12 });
    }
  }
  const largura = nos.reduce((m, n) => Math.max(m, n.x + LARG_NO + 12), 200);
  const altura = nos.reduce((m, n) => Math.max(m, n.y + ALT_NO + 12), 80);
  return { nos, arestas, omitidos, largura, altura };
}

export default function Grafo({ trabalho }: { trabalho: Trabalho }) {
  const g = trabalho.grafo;
  const temCiclo = g.ciclos.length > 0;
  // com ciclo o grafo abre expandido (por task), para o ciclo aparecer inteiro
  const [modo, setModo] = useState<"fases" | "tasks">(temCiclo ? "tasks" : "fases");
  const d = useMemo(() => calcular(trabalho, modo), [trabalho, modo]);
  const pos = new Map(d.nos.map((n) => [n.id, n]));

  if (g.nos.length === 0) return <p className="met-suave">Este trabalho ainda não tem plano de tasks.</p>;

  return (
    <div className="met-grafo">
      <div className="met-grafo-barra">
        <button type="button" className="met-botao" aria-pressed={modo === "fases"} onClick={() => setModo("fases")}>Por fase</button>
        <button type="button" className="met-botao" aria-pressed={modo === "tasks"} onClick={() => setModo("tasks")}>Por task (expandido)</button>
        <span className="met-suave">Traço grosso: caminho crítico · tracejado com ↻: ciclo · pontilhado com ?: dependência inexistente</span>
      </div>
      <div className="met-grafo-tela">
        <svg role="img" aria-label={`Grafo do plano: ${d.nos.length} nós`} width={d.largura} height={d.altura} viewBox={`0 0 ${d.largura} ${d.altura}`}>
          <defs>
            <marker id="met-seta" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 8 4 0 8Z" fill="currentColor" /></marker>
          </defs>
          {d.arestas.map((a) => {
            const de = pos.get(a.de);
            const para = pos.get(a.para);
            if (!de || !para) return null;
            return (
              <line key={`${a.de}>${a.para}`} className="met-aresta" data-ciclo={a.ciclo ? "true" : undefined} data-critico={a.critico ? "true" : undefined} data-ausente={a.ausente ? "true" : undefined}
                x1={de.x + LARG_NO} y1={de.y + ALT_NO / 2} x2={para.x} y2={para.y + ALT_NO / 2} markerEnd="url(#met-seta)" />
            );
          })}
          {d.nos.map((n) => (
            <g key={n.id} className="met-no" data-no={n.id} data-status={n.status ?? undefined} data-ciclo={n.ciclo ? "true" : undefined} data-critico={n.critico ? "true" : undefined} data-ausente={n.ausente ? "true" : undefined} transform={`translate(${n.x} ${n.y})`}>
              <title>{`${n.rotulo}${n.detalhe ? ` · ${n.detalhe}` : ""}${n.critico ? " · caminho crítico" : ""}${n.ciclo ? " · em ciclo" : ""}`}</title>
              <rect width={LARG_NO} height={ALT_NO} rx="8" />
              <text x="10" y="15" className="met-no-id">{`${n.ciclo ? "↻ " : ""}${n.ausente && modo === "tasks" ? "? " : ""}${n.rotulo}`.slice(0, 18)}</text>
              <text x="10" y="28" className="met-no-det">{n.detalhe.slice(0, 22)}</text>
            </g>
          ))}
        </svg>
      </div>
      {d.omitidos > 0 ? <p className="met-suave">Mostrando {d.nos.length} de {g.nos.length} tasks (ciclo e caminho crítico primeiro). Use "Por fase" para ver tudo.</p> : null}
      <ul className="met-grafo-legenda">
        {g.ciclos.map((c) => <li key={c.join(">")} className="met-erro">Ciclo de dependências: {[...c, c[0]].join(" → ")}</li>)}
        {g.dependencias_inexistentes.map((x) => <li key={`${x.de}>${x.ate}`} className="met-erro">Dependência inexistente: {x.de} depende de {x.ate}</li>)}
        {g.caminho_critico.length > 0 ? <li>Caminho crítico: {g.caminho_critico.join(" → ")}</li> : <li className="met-suave">Sem caminho crítico calculado.</li>}
      </ul>
    </div>
  );
}

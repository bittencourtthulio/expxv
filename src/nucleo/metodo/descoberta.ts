import { readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import type { Layout } from "./tipos";

/** Nomes lidos (F-… §2.1 + artefatos que o ADE também lê). `00-INDICE.md` só dentro de `base/`. */
export const NOMES_DE_TRABALHO: ReadonlySet<string> = new Set([
  "ORQUESTRADOR.md", "00-BLOQUEIOS.md", "BLOQUEIOS.md", "00-DECISOES.md", "00-AUDITORIA.md",
  "00-OCORRENCIA.md", "01-CAUSA-RAIZ.md", "QA.md", "FECHAMENTO.md",
  "sprint.md", "fases.md", "tasks.md",
  // prodx (pedidos)
  "01-pedido.md", "02-existencia.md", "03-avaliacao.md", "VEREDITO.md", "BRIEFING.md",
]);

const NOMES_PROJETO = new Set(["PROJETO.md", "PREMISSAS.md", "MAPA.md", "RECURSAO.md", "VEREDITO.md", "VALIDACAO.md", "RELATORIO.md"]);
const NOMES_RELATORIO = new Set(["INDICE.md", "tecnico.md", "uso.md"]);
const NOMES_CAMADAS = new Set(["CONVENCOES.md", "PERFIL.md", "DIVIDA.md", "DESIGN-SYSTEM.md", "AUDIT.md", "PRODUTO.md", "INDICE.md"]);

const IGNORADOS = new Set(["node_modules", ".git", "dist"]);
const RESERVADAS = new Set(["sprintx", "manutencao", "produto", "projeto", "entregas", "relatorios", "eventos", "stack", "legado", "design-system"]);
const PROFUNDIDADE_MAXIMA = 6;

export interface TrabalhoDescoberto {
  /** nome da pasta (o id definitivo vem do frontmatter). */
  id: string;
  layout: Layout;
  pasta: string;
  arquivos: string[];
  diretorios: string[];
}

export interface Descoberta {
  raiz: string;
  trabalhos: TrabalhoDescoberto[];
  projeto: string[];
  entregas: { id: string; arquivos: string[] }[];
  relatorios: string[];
  camadas: string[];
  eventos: string[];
  config: { hooks: boolean; lock: boolean; memoria: boolean };
}

async function listar(abs: string): Promise<Dirent[]> {
  try {
    return await readdir(abs, { withFileTypes: true });
  } catch {
    return [];
  }
}

const ordenar = (a: Dirent, b: Dirent): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** Coleta recursivamente, por nome de arquivo, o que está na lista. */
async function coletar(raiz: string, rel: string, aceita: (nome: string, pai: string) => boolean, nivel = 0): Promise<string[]> {
  if (nivel > PROFUNDIDADE_MAXIMA) return [];
  const entradas = (await listar(join(raiz, ...rel.split("/")))).sort(ordenar);
  const achados: string[] = [];
  const subs: Promise<string[]>[] = [];
  for (const e of entradas) {
    if (e.isDirectory()) {
      if (!IGNORADOS.has(e.name)) subs.push(coletar(raiz, `${rel}/${e.name}`, aceita, nivel + 1));
    } else if (e.isFile() && e.name.endsWith(".md") && aceita(e.name, rel.slice(rel.lastIndexOf("/") + 1))) {
      achados.push(`${rel}/${e.name}`);
    }
  }
  for (const s of await Promise.all(subs)) achados.push(...s);
  return achados;
}

const aceitaTrabalho = (nome: string, pai: string): boolean => NOMES_DE_TRABALHO.has(nome) || (nome === "00-INDICE.md" && pai === "base");

async function trabalhosDe(raiz: string, pasta: string, layout: Layout, todos: boolean): Promise<TrabalhoDescoberto[]> {
  const dirs = (await listar(join(raiz, ...pasta.split("/")))).filter((e) => e.isDirectory() && !IGNORADOS.has(e.name) && !e.name.startsWith(".")).sort(ordenar);
  const candidatos = await Promise.all(
    dirs
      .filter((e) => todos || !RESERVADAS.has(e.name))
      .map(async (e) => {
        const p = `${pasta}/${e.name}`;
        const topo = await listar(join(raiz, ...p.split("/")));
        const diretorios = topo.filter((t) => t.isDirectory() && !IGNORADOS.has(t.name)).map((t) => t.name);
        if (!todos) {
          // legado (docs/<slug>/): a pasta só é um trabalho se o conteúdo indica
          const indica = topo.some((t) => t.isFile() && (t.name === "ORQUESTRADOR.md" || t.name === "00-DECISOES.md")) || diretorios.some((n) => n === "base" || /^sprint-\d+$/.test(n));
          if (!indica) return null;
        }
        const arquivos = await coletar(raiz, p, aceitaTrabalho);
        return { id: e.name, layout, pasta: p, arquivos, diretorios } satisfies TrabalhoDescoberto;
      }),
  );
  return candidatos.filter((c): c is TrabalhoDescoberto => c !== null);
}

async function existe(raiz: string, rel: string): Promise<boolean> {
  const partes = rel.split("/");
  const nome = partes.pop() as string;
  return (await listar(join(raiz, ...partes))).some((e) => e.name === nome && !e.isDirectory());
}

/** Varre a raiz (um worktree) por NOME de arquivo. Nunca lança; raiz inexistente = vazio. */
export async function descobrir(raiz: string): Promise<Descoberta> {
  const [sprintx, legado, manut, pedidos, projeto, relatorios, camadas, eventosDir, entregasDirs, hooks, lock, memoria] = await Promise.all([
    trabalhosDe(raiz, "docs/sprintx/features", "sprintx_features", true),
    trabalhosDe(raiz, "docs", "legado", false),
    trabalhosDe(raiz, "docs/manutencao", "manutencao", true),
    trabalhosDe(raiz, "docs/produto/pedidos", "pedido", true),
    coletar(raiz, "docs/projeto", (n) => NOMES_PROJETO.has(n)).then((l) => l.filter((c) => c.split("/").length === 3)),
    coletar(raiz, "docs/relatorios", (n) => NOMES_RELATORIO.has(n)),
    Promise.all(
      ["docs/stack", "docs/legado", "docs/design-system", "docs/produto"].map((p) =>
        coletar(raiz, p, (n, pai) => (pai === "pedidos" ? false : NOMES_CAMADAS.has(n) || pai === "raio")).then((l) => l.filter((c) => !c.startsWith("docs/produto/pedidos/"))),
      ),
    ).then((ls) => ls.flat()),
    listar(join(raiz, "docs", "eventos")),
    listar(join(raiz, "docs", "entregas")),
    existe(raiz, ".expx/hooks.json"),
    existe(raiz, ".expx/expx-lock.json"),
    existe(raiz, ".expx/memoria/indice.json"),
  ]);

  const entregas = await Promise.all(
    entregasDirs
      .filter((e) => e.isDirectory() && !IGNORADOS.has(e.name))
      .sort(ordenar)
      .map(async (e) => ({ id: e.name, arquivos: await coletar(raiz, `docs/entregas/${e.name}`, (n) => n === "ENTREGA.md") })),
  );

  return {
    raiz,
    trabalhos: [...sprintx, ...legado, ...manut, ...pedidos],
    projeto,
    entregas: entregas.filter((e) => e.arquivos.length > 0),
    relatorios,
    camadas,
    eventos: eventosDir.filter((e) => e.isFile() && e.name.endsWith(".jsonl")).map((e) => `docs/eventos/${e.name}`).sort(),
    config: { hooks, lock, memoria },
  };
}

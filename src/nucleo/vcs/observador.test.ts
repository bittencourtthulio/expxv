import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { criarObservadorVcs, type FuncaoWatch, type LoteVcs } from "./observador";
import { detectar } from "./detectar";
import { escrever, git, initRepo, isolarConfigGit, pastaTmp, removerPasta } from "../../../tests/fixtures/vcs/repos";

// ---- dublês ----
function criarAgendadorFalso() {
  let relogio = 0;
  let proximo = 1;
  const tarefas = new Map<number, { quando: number; fn: () => void }>();
  return {
    agendar: (fn: () => void, ms: number) => {
      const id = proximo++;
      tarefas.set(id, { quando: relogio + ms, fn });
      return id;
    },
    cancelar: (h: unknown) => void tarefas.delete(h as number),
    avancar(ms: number) {
      relogio += ms;
      for (const [id, t] of [...tarefas]) {
        if (t.quando <= relogio) {
          tarefas.delete(id);
          t.fn();
        }
      }
    },
    agora: () => relogio,
    pendentes: () => tarefas.size,
  };
}

function criarWatchFalso() {
  const abertos: Array<{ caminho: string; recursive: boolean; cb: (e: string, n: string | null) => void; fechado: boolean }> = [];
  const watch: FuncaoWatch = (caminho, { recursive }, cb) => {
    const h = { caminho, recursive, cb, fechado: false };
    abertos.push(h);
    return { close: () => void (h.fechado = true) };
  };
  return {
    watch,
    abertos,
    emitir: (i: number, nome: string | null) => abertos[i]?.cb("change", nome),
    todosFechados: () => abertos.every((h) => h.fechado),
  };
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const drenar = () => new Promise((r) => setImmediate(r));

describe("observador (dublês)", () => {
  it("rajada de 500 toques vira 1 atualização, só depois de 200 ms de silêncio", async () => {
    const ag = criarAgendadorFalso();
    const w = criarWatchFalso();
    const lotes: LoteVcs[] = [];
    const o = criarObservadorVcs({ raiz: "/r", gitDir: "/r/.git", commonDir: "/r/.git", aoMudar: (l) => void lotes.push(l), agendador: ag, watch: w.watch, agora: ag.agora });
    for (let i = 0; i < 500; i++) {
      w.emitir(0, `src/arq${i % 50}.ts`);
      ag.avancar(1);
    }
    expect(lotes).toHaveLength(0);
    ag.avancar(199);
    await drenar();
    expect(lotes).toHaveLength(1);
    expect(lotes[0]).toMatchObject({ arvore: true, indice: false, toques: 500, muitos: false });
    expect(lotes[0]?.arquivos).toHaveLength(50);
    await o.fechar();
  });

  it("classifica index/HEAD/refs, operação em curso e .svn/wc.db; ignora .git/objects, node_modules, dist e *.lock", async () => {
    const ag = criarAgendadorFalso();
    const w = criarWatchFalso();
    const lotes: LoteVcs[] = [];
    const o = criarObservadorVcs({ raiz: "/r", gitDir: "/r/.git", aoMudar: (l) => void lotes.push(l), agendador: ag, watch: w.watch, agora: ag.agora });
    const dispara = async (nome: string) => {
      w.emitir(0, nome);
      ag.avancar(200);
      await drenar();
    };
    await dispara(".git/objects/ab/cdef");
    await dispara(".git/index.lock");
    await dispara("node_modules/x/y.js");
    await dispara("dist/app.js");
    await dispara("pkg/node_modules/z.js");
    expect(lotes).toHaveLength(0);
    await dispara(".git/index");
    await dispara(".git/HEAD");
    await dispara(".git/refs/heads/feat");
    expect(lotes.map((l) => l.indice)).toEqual([true, true, true]);
    await dispara(".git/MERGE_HEAD");
    await dispara(".git/rebase-merge/done");
    await dispara(".git/CHERRY_PICK_HEAD");
    expect(lotes.slice(3).map((l) => l.operacao)).toEqual([true, true, true]);
    await dispara(".svn/wc.db");
    expect(lotes[6]).toMatchObject({ svn: true, arvore: false });
    await o.fechar();
  });

  it("teto de espera: atividade contínua dispara mesmo sem silêncio", async () => {
    const ag = criarAgendadorFalso();
    const w = criarWatchFalso();
    const lotes: LoteVcs[] = [];
    const o = criarObservadorVcs({ raiz: "/r", gitDir: null, aoMudar: (l) => void lotes.push(l), agendador: ag, watch: w.watch, agora: ag.agora, maxEsperaMs: 1000 });
    for (let i = 0; i < 40; i++) {
      w.emitir(0, "a.txt");
      ag.avancar(100); // nunca fica 200 ms em silêncio
      await drenar();
    }
    expect(lotes.length).toBeGreaterThanOrEqual(3);
    await o.fechar();
  });

  it("não sobrepõe atualizações: evento durante aoMudar gera um segundo lote depois", async () => {
    const ag = criarAgendadorFalso();
    const w = criarWatchFalso();
    const lotes: LoteVcs[] = [];
    let liberar!: () => void;
    const o = criarObservadorVcs({
      raiz: "/r", gitDir: null, agendador: ag, watch: w.watch, agora: ag.agora,
      aoMudar: async (l) => {
        lotes.push(l);
        if (lotes.length === 1) await new Promise<void>((r) => (liberar = r));
      },
    });
    w.emitir(0, "a");
    ag.avancar(200);
    await drenar();
    w.emitir(0, "b");
    ag.avancar(200);
    await drenar();
    expect(lotes).toHaveLength(1);
    liberar();
    await drenar();
    await drenar();
    ag.avancar(200);
    await drenar();
    expect(lotes.map((l) => l.arquivos)).toEqual([["a"], ["b"]]);
    await o.fechar();
  });

  it("erro em aoMudar vai para aoErro e não derruba o observador", async () => {
    const ag = criarAgendadorFalso();
    const w = criarWatchFalso();
    const erros: string[] = [];
    let n = 0;
    const o = criarObservadorVcs({
      raiz: "/r", gitDir: null, agendador: ag, watch: w.watch, agora: ag.agora, aoErro: (e) => erros.push(e.message),
      aoMudar: () => {
        if (++n === 1) throw new Error("boom");
      },
    });
    w.emitir(0, "a");
    ag.avancar(200);
    await drenar();
    w.emitir(0, "b");
    ag.avancar(200);
    await drenar();
    expect(erros).toEqual(["boom"]);
    expect(n).toBe(2);
    await o.fechar();
  });

  it("fechar libera TODOS os handles e cancela o timer; eventos depois são ignorados", async () => {
    const ag = criarAgendadorFalso();
    const w = criarWatchFalso();
    let chamadas = 0;
    // worktree vinculado: gitDir e commonDir fora da raiz => handles extras
    const o = criarObservadorVcs({
      raiz: "/wt", gitDir: "/principal/.git/worktrees/wt", commonDir: "/principal/.git", aoMudar: () => void chamadas++, agendador: ag, watch: w.watch, agora: ag.agora,
    });
    expect(o.handlesAbertos()).toBe(4);
    w.emitir(0, "a");
    expect(ag.pendentes()).toBe(1);
    await o.fechar();
    await o.fechar();
    expect(w.todosFechados()).toBe(true);
    expect(o.handlesAbertos()).toBe(0);
    expect(ag.pendentes()).toBe(0);
    w.emitir(0, "b");
    ag.avancar(1000);
    await drenar();
    expect(chamadas).toBe(0);
  });

  it("worktree vinculado: index próprio conta; index do worktree principal (diretório comum) não", async () => {
    const ag = criarAgendadorFalso();
    const w = criarWatchFalso();
    const lotes: LoteVcs[] = [];
    const o = criarObservadorVcs({ raiz: "/wt", gitDir: "/p/.git/worktrees/wt", commonDir: "/p/.git", aoMudar: (l) => void lotes.push(l), agendador: ag, watch: w.watch, agora: ag.agora });
    const [iRaiz, iGit, iComum, iRefs] = [0, 1, 2, 3];
    expect(w.abertos.map((a) => [a.caminho, a.recursive])).toEqual([["/wt", true], ["/p/.git/worktrees/wt", false], ["/p/.git", false], ["/p/.git/refs", true]]);
    w.emitir(iComum, "index");
    ag.avancar(200);
    await drenar();
    expect(lotes).toHaveLength(0);
    w.emitir(iComum, "packed-refs");
    ag.avancar(200);
    await drenar();
    w.emitir(iRefs, "heads/x");
    ag.avancar(200);
    await drenar();
    w.emitir(iGit, "index");
    ag.avancar(200);
    await drenar();
    w.emitir(iRaiz, "src/a.ts");
    ag.avancar(200);
    await drenar();
    expect(lotes.map((l) => [l.indice, l.arvore])).toEqual([[true, false], [true, false], [true, false], [false, true]]);
    await o.fechar();
  });

  it("evento sem nome força recarga total; mais de 1000 caminhos marca 'muitos'", async () => {
    const ag = criarAgendadorFalso();
    const w = criarWatchFalso();
    const lotes: LoteVcs[] = [];
    const o = criarObservadorVcs({ raiz: "/r", gitDir: null, aoMudar: (l) => void lotes.push(l), agendador: ag, watch: w.watch, agora: ag.agora });
    w.emitir(0, null);
    ag.avancar(200);
    await drenar();
    expect(lotes[0]).toMatchObject({ arvore: true, indice: true, muitos: true });
    for (let i = 0; i < 1100; i++) w.emitir(0, `f${i}`);
    ag.avancar(200);
    await drenar();
    expect(lotes[1]?.muitos).toBe(true);
    expect(lotes[1]?.arquivos).toHaveLength(1000);
    await o.fechar();
  });
});

describe("observador (fs.watch real)", () => {
  let raiz: string;
  beforeAll(isolarConfigGit);
  beforeEach(() => {
    raiz = pastaTmp("vcs-obs-");
  });
  afterEach(() => removerPasta(raiz));

  async function ate(cond: () => boolean, ms = 5000): Promise<boolean> {
    const fim = Date.now() + ms;
    while (Date.now() < fim && !cond()) await esperar(25);
    return cond();
  }

  it("editar arquivo, commitar e criar ref geram lotes; handles liberados ao fechar", async () => {
    const repo = initRepo(join(raiz, "r"));
    mkdirSync(join(repo, "node_modules"));
    const det = await detectar(repo);
    const lotes: LoteVcs[] = [];
    const o = criarObservadorVcs({ raiz: repo, gitDir: det.gitDir, commonDir: det.commonDir, aoMudar: (l) => void lotes.push(l) });
    await esperar(300); // assenta o stream de eventos do sistema
    escrever(repo, "node_modules/x.js", "ignorado");
    escrever(repo, "novo.txt", "x");
    expect(await ate(() => lotes.some((l) => l.arvore && l.arquivos.includes("novo.txt")))).toBe(true);
    expect(lotes.every((l) => !l.arquivos.includes("node_modules/x.js"))).toBe(true);
    const antes = lotes.length;
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "c");
    expect(await ate(() => lotes.length > antes && lotes.some((l) => l.indice))).toBe(true);
    await o.fechar();
    expect(o.handlesAbertos()).toBe(0);
    const depois = lotes.length;
    escrever(repo, "pos.txt", "x");
    await esperar(500);
    expect(lotes.length).toBe(depois);
  });
});

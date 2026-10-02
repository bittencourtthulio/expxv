// Orçamentos do versionamento (docs/ade/fase-06-versionamento.md): P-16, P-17, P-18, P-19, P-20 e P-21.
// Node puro (sem Electron); repositórios sintéticos em os.tmpdir (tests/fixtures/vcs/gerar.ts); sem rede.
//  - P-16: status incremental em repo de 20 000 arquivos: o COMANDO (statusGitParcial: git status só do caminho
//    que mudou, mesclado ao anterior) p95 de 30 amostras ≤ 250 ms (o status completo é medido só como referência); e de ponta a ponta (fs.watch real -> debounce 200 ms -> status -> cache) mediana ≤ 600 ms.
//  - P-16 (SVN): idem em cópia de trabalho SVN de 20 000 arquivos (`svn status --xml` só do caminho mudado, mesclado ao anterior);
//    pulado com aviso se `svnadmin` não existir.
//  - P-17: primeiro status de repo de 50 000 arquivos (+ 500 não rastreados): ≤ 1 s; passou de 2 s degrada para -uno.
//  - P-18: parser do diff de 10 000 linhas (texto real do git) ≤ 50 ms (mediana de 15 execuções, em stream de 64 KiB).
//  - P-19: histórico: 200 commits ≤ 150 ms (mediana de 15) num repo de 100 000 commits; paginação de TODOS os 100 000 por cursor sem travar
//    (atraso máximo do event loop ≤ 50 ms; cada hash exatamente uma vez; grafo consistente).
//  - P-20: stage/unstage de hunk (diff + git apply --cached) em repo de 5 000 arquivos, mediana de 30 ≤ 100 ms.
//  - P-21: memória retida pelo estado VCS com 50 000 entradas (pior caso: tudo listado) ≤ 50 MB.
//  - P-22: fetch em segundo plano (git fetch real contra remoto file:// local): no máximo 1 por vez (5 disparos simultâneos = 1 execução),
//    prioridade baixa, nunca com a janela sem foco, abortável por `pausar`, e atraso máximo do event loop durante o fetch ≤ 50 ms.
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { criarGerenciadorVcs } from "../../src/nucleo/vcs/cache";
import { parseStatusV2, statusGit, statusGitParcial } from "../../src/nucleo/vcs/git/status";
import type { StatusRepo } from "../../src/nucleo/vcs/vcs";
import { ParserDiff } from "../../src/nucleo/vcs/git/diff";
import { logGit, type CursorLog } from "../../src/nucleo/vcs/git/log";
import { desestagiarHunk, estagiarHunk, estagiarLinhas } from "../../src/nucleo/vcs/git/estagiar";
import { criarNaoRastreados, gerarRepo } from "../fixtures/vcs/gerar";
import { git, isolarConfigGit, pastaTmp, removerPasta } from "../fixtures/vcs/repos";
import { gravarMedicoes, percentil, registrar } from "./registro";
import { statusSvn, statusSvnParcial } from "../../src/nucleo/vcs/svn/status";
import { gerarCopiaSvn, temSvnReal } from "../fixtures/vcs/svn-util";
import { criarFetchSegundoPlano } from "../../src/nucleo/vcs/git/remotos";
import { executorPadrao, type ExecutorVcs, type OpcoesExec } from "../../src/nucleo/vcs/executor";

const pastas: string[] = [];
afterAll(() => {
  gravarMedicoes();
  for (const p of pastas) removerPasta(p);
});
isolarConfigGit();

const mediana = (xs: number[]): number => percentil(xs, 50);
const ms = (): number => performance.now();

function pasta(prefixo: string): string {
  const p = pastaTmp(prefixo);
  pastas.push(p);
  return p;
}

describe("P-16 · status incremental (20 000 arquivos)", () => {
  it("comando de status p95 ≤ 250 ms e atualização ponta a ponta ≤ 600 ms", async () => {
    const dir = join(pasta("vcs-perf16-"), "r");
    const t0 = ms();
    const repo = await gerarRepo(dir, { arquivos: 20_000, commits: 50 });
    console.log(`P-16: repo de 20000 arquivos gerado em ${Math.round(ms() - t0)} ms`);

    let base = await statusGit(dir); // aquece cache do SO e do índice; vira a base do incremental
    const cheio: number[] = [];
    const amostras: number[] = [];
    for (let i = 0; i < 30; i++) {
      const alvo = repo.arquivos[i * 97] as string;
      appendFileSync(join(dir, alvo), "toque\n");
      const t = ms();
      const s = await statusGitParcial(dir, base, [alvo]); // o que o observador dispara ao mudar 1 arquivo
      amostras.push(ms() - t);
      expect(s).not.toBeNull();
      base = s as StatusRepo;
      expect(base.arquivos.length).toBe(i + 1);
      if (i % 3 === 0) {
        const tc = ms();
        await statusGit(dir); // referência: status completo
        cheio.push(ms() - tc);
      }
    }
    const p95 = percentil(amostras, 95);
    console.log(`P-16: comando incremental mediana ${mediana(amostras).toFixed(0)} ms, p95 ${p95.toFixed(0)} ms, pior ${Math.max(...amostras).toFixed(0)} ms | status completo (referência) mediana ${mediana(cheio).toFixed(0)} ms, pior ${Math.max(...cheio).toFixed(0)} ms`);
    registrar({ id: "P-16", descricao: "status incremental (comando, 1 arquivo mudado) em repo de 20 000 arquivos, p95 de 30 amostras", valor: p95, limite: 250, unidade: "ms", pior: Math.max(...amostras) });

    // ponta a ponta: fs.watch recursivo real -> debounce -> status -> cache
    const ger = criarGerenciadorVcs(); // debounce padrão de 200 ms
    const e = await ger.abrir(dir, dir);
    await e.pronto;
    await new Promise((r) => setTimeout(r, 500)); // assenta o stream de eventos do sistema
    const ponta: number[] = [];
    for (let i = 0; i < 6; i++) {
      const alvo = repo.arquivos[10_000 + i * 31] as string;
      const t = ms();
      appendFileSync(join(dir, alvo), "evento\n");
      while (!e.atual().arquivos.some((a) => a.caminho === alvo) && ms() - t < 5000) await new Promise((r) => setTimeout(r, 5));
      ponta.push(ms() - t);
      await new Promise((r) => setTimeout(r, 250));
    }
    await ger.fechar();
    // a 1ª amostra aquece (primeiro evento do stream); valem as demais
    const validas = ponta.slice(1);
    console.log(`P-16: ponta a ponta (amostras) ${ponta.map((x) => x.toFixed(0)).join(", ")} ms`);
    registrar({ id: "P-16-ui", descricao: "arquivo editado -> cache de status atualizado (watch+debounce 200 ms+status), 20 000 arquivos, mediana de 5", valor: mediana(validas), limite: 600, unidade: "ms", pior: Math.max(...validas) });
    expect(mediana(validas)).toBeGreaterThan(0);
  }, 600_000);
});

describe("P-17 · primeiro status (50 000 arquivos)", () => {
  it("≤ 1 s (ou degrada para -uno acima de 2 s) e P-21: memória do estado ≤ 50 MB", async () => {
    const dir = join(pasta("vcs-perf17-"), "r");
    const t0 = ms();
    await gerarRepo(dir, { arquivos: 50_000, commits: 20 });
    criarNaoRastreados(dir, 500);
    console.log(`P-17: repo de 50000 arquivos gerado em ${Math.round(ms() - t0)} ms`);

    const t = ms();
    const s = await statusGit(dir);
    const dur = ms() - t;
    console.log(`P-17: primeiro status ${dur.toFixed(0)} ms (degradado=${s.degradado}, entradas=${s.arquivos.length})`);
    expect(s.contagens.naoRastreados).toBe(s.degradado ? 0 : 500);
    registrar({ id: "P-17", descricao: "primeiro status de repo de 50 000 arquivos (+500 não rastreados)", valor: dur, limite: 1000, unidade: "ms" });

    const rep: number[] = [];
    for (let i = 0; i < 5; i++) {
      const tt = ms();
      await statusGit(dir);
      rep.push(ms() - tt);
    }
    console.log(`P-17: status seguintes (mediana) ${mediana(rep).toFixed(0)} ms`);

    // P-21: pior caso, 50 000 entradas listadas (ex.: tudo não rastreado) retidas no cache.
    setFlagsFromString("--expose-gc");
    const gc = runInNewContext("gc") as () => void;
    const header = "# branch.oid abcdef0123456789abcdef0123456789abcdef01\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +0 -0\0";
    const h = "N... 100644 100644 100644 aaaaaaaa bbbbbbbb";
    const linhas: string[] = [];
    for (let i = 0; i < 50_000; i++) linhas.push(i % 2 === 0 ? `1 .M ${h} d${String(i % 500).padStart(3, "0")}/s${i % 7}/arq${i}.txt` : `? d${String(i % 500).padStart(3, "0")}/s${i % 7}/novo${i}.txt`);
    const bruto = header + linhas.join("\0") + "\0";
    gc();
    gc();
    const antes = process.memoryUsage().heapUsed;
    let estado: unknown = parseStatusV2(bruto);
    gc();
    gc();
    const depois = process.memoryUsage().heapUsed;
    const mb = Math.max(0, depois - antes) / (1024 * 1024);
    console.log(`P-21: estado com ${(estado as { arquivos: unknown[] }).arquivos.length} entradas retém ${mb.toFixed(1)} MB`);
    registrar({ id: "P-21", descricao: "memória retida pelo estado VCS com 50 000 entradas (pior caso)", valor: mb, limite: 50, unidade: "MB" });
    estado = null;
    void estado;
    expect(mb).toBeLessThan(500);
  }, 900_000);
});

describe("P-18 · modelo de diff de 10 000 linhas", () => {
  it("parser ≤ 50 ms (mediana)", async () => {
    const dir = join(pasta("vcs-perf18-"), "r");
    await gerarRepo(dir, { arquivos: 2, commits: 1 });
    const linhas = Array.from({ length: 10_000 }, (_, i) => `linha ${i} ${"y".repeat(i % 40)}`).join("\n") + "\n";
    appendFileSync(join(dir, "grande.txt"), linhas);
    git(dir, "add", "grande.txt"); // 10 000 linhas adicionadas
    const texto = git(dir, "diff", "--cached", "--no-color", "-U3");
    expect(texto.split("\n").length).toBeGreaterThan(10_000);
    const buf = Buffer.from(texto);
    const tempos: number[] = [];
    for (let i = 0; i < 15; i++) {
      const t = ms();
      const p = new ParserDiff();
      for (let o = 0; o < buf.length; o += 65536) p.escrever(buf.subarray(o, o + 65536));
      const d = p.finalizar();
      tempos.push(ms() - t);
      expect(d.arquivos[0]?.insercoes).toBe(10_000);
    }
    console.log(`P-18: parser de ${texto.length} bytes / 10000 linhas: mediana ${mediana(tempos).toFixed(1)} ms, pior ${Math.max(...tempos).toFixed(1)} ms`);
    registrar({ id: "P-18", descricao: "parser do diff de 10 000 linhas (modelo de hunks), mediana de 15", valor: mediana(tempos), limite: 50, unidade: "ms", pior: Math.max(...tempos) });
  }, 120_000);
});

describe("P-20 · stage/unstage de hunk e linha", () => {
  it("≤ 100 ms (mediana de 30) em repo de 5 000 arquivos", async () => {
    const dir = join(pasta("vcs-perf20-"), "r");
    await gerarRepo(dir, { arquivos: 5_000, commits: 10 });
    const original = Array.from({ length: 600 }, (_, i) => `linha ${i}`).join("\n") + "\n";
    appendFileSync(join(dir, "grande.txt"), original);
    git(dir, "add", "grande.txt");
    git(dir, "commit", "-q", "-m", "grande");
    const mexido = Array.from({ length: 600 }, (_, i) => (i % 20 === 5 ? `LINHA ${i} alterada` : `linha ${i}`)).join("\n") + "\n";
    writeFileSync(join(dir, "grande.txt"), mexido); // 30 hunks
    await statusGit(dir); // aquece
    const hunk: number[] = [];
    const comStatus: number[] = [];
    let base = await statusGit(dir);
    for (let i = 0; i < 30; i++) {
      const t = ms();
      await estagiarHunk(dir, "grande.txt", 0);
      const t1 = ms() - t;
      hunk.push(t1);
      const s = await statusGitParcial(dir, base, ["grande.txt"]);
      comStatus.push(ms() - t);
      if (s) base = s;
      await desestagiarHunk(dir, "grande.txt", 0); // devolve ao estado inicial (também é uma operação medida em separado abaixo)
    }
    const linhas: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t = ms();
      await estagiarLinhas(dir, "grande.txt", 0, [3, 4]);
      linhas.push(ms() - t);
      await desestagiarHunk(dir, "grande.txt", 0);
    }
    console.log(`P-20: estagiar hunk mediana ${mediana(hunk).toFixed(0)} ms (pior ${Math.max(...hunk).toFixed(0)}); com status parcial ${mediana(comStatus).toFixed(0)} ms; por linha ${mediana(linhas).toFixed(0)} ms`);
    registrar({ id: "P-20", descricao: "stage de hunk (diff + apply --cached), repo de 5 000 arquivos, mediana de 30", valor: mediana(hunk), limite: 100, unidade: "ms", pior: Math.max(...hunk) });
    expect(mediana(hunk)).toBeGreaterThan(0);
  }, 300_000);
});

describe("P-19 · histórico (100 000 commits)", () => {
  it("200 commits ≤ 150 ms e paginação completa por cursor sem travar", async () => {
    const dir = join(pasta("vcs-perf19-"), "r");
    const t0 = ms();
    await gerarRepo(dir, { arquivos: 300, commits: 100_000, alteracoesPorCommit: 1, linhas: 2, ramos: 20, porPasta: 50 });
    console.log(`P-19: repo de 100000 commits gerado em ${Math.round(ms() - t0)} ms`);
    await logGit(dir, { limite: 200 }); // aquece o cache do SO

    const primeira: number[] = [];
    for (let i = 0; i < 15; i++) {
      const t = ms();
      const p = await logGit(dir, { limite: 200 });
      primeira.push(ms() - t);
      expect(p.commits).toHaveLength(200);
    }
    const topo: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t = ms();
      await logGit(dir, { limite: 200, topologica: true });
      topo.push(ms() - t);
    }
    console.log(`P-19: 200 commits mediana ${mediana(primeira).toFixed(0)} ms (pior ${Math.max(...primeira).toFixed(0)}); ordem topológica estrita ${mediana(topo).toFixed(0)} ms`);
    registrar({ id: "P-19", descricao: "log de 200 commits (com grafo) em repo de 100 000 commits, mediana de 15", valor: mediana(primeira), limite: 150, unidade: "ms", pior: Math.max(...primeira) });

    // paginação completa: páginas de 5 000 por cursor; mede o atraso do event loop (nada síncrono pesado no main)
    let maxAtraso = 0;
    let ultimo = performance.now();
    const timer = setInterval(() => {
      const agora = performance.now();
      maxAtraso = Math.max(maxAtraso, agora - ultimo - 10);
      ultimo = agora;
    }, 10);
    const vistos = new Set<string>();
    let total = 0;
    let cursor: CursorLog | undefined;
    let maiorPagina = 0;
    const tp = ms();
    do {
      const t = ms();
      const p = await logGit(dir, { limite: 5000, ...(cursor ? { cursor } : {}) });
      maiorPagina = Math.max(maiorPagina, ms() - t);
      for (const c of p.commits) vistos.add(c.hash);
      total += p.commits.length;
      expect(p.grafo).toHaveLength(p.commits.length);
      cursor = p.proximo ?? undefined;
    } while (cursor);
    clearInterval(timer);
    const dur = ms() - tp;
    console.log(`P-19: ${total} commits paginados em ${Math.round(dur)} ms (maior página ${maiorPagina.toFixed(0)} ms); atraso máximo do event loop ${maxAtraso.toFixed(1)} ms`);
    expect(total).toBe(vistos.size);
    expect(total).toBeGreaterThanOrEqual(100_000);
    registrar({ id: "P-19-paginacao", descricao: "paginação de 100 000 commits por cursor: atraso máximo do event loop durante todas as páginas", valor: maxAtraso, limite: 50, unidade: "ms", pior: maiorPagina });
  }, 900_000);
});

describe.skipIf(!temSvnReal())("P-16 · status incremental SVN (20 000 arquivos)", () => {
  it("comando de status incremental p95 ≤ 250 ms (status completo só como referência)", async () => {
    const t0 = ms();
    const g = gerarCopiaSvn(20_000);
    pastas.push(g.base);
    console.log(`P-16 SVN: cópia de 20000 arquivos gerada em ${Math.round(ms() - t0)} ms`);
    let base = await statusSvn(g.wc); // aquece o cache do SO e do wc.db
    const cheio: number[] = [];
    const amostras: number[] = [];
    for (let i = 0; i < 30; i++) {
      const alvo = g.caminhos[i * 97] as string;
      appendFileSync(join(g.wc, alvo), "toque\n");
      const t = ms();
      const s = await statusSvnParcial(g.wc, base, [alvo], {});
      amostras.push(ms() - t);
      expect(s).not.toBeNull();
      base = s as StatusRepo;
      expect(base.arquivos.length).toBe(i + 1);
      if (i % 5 === 0) {
        const tc = ms();
        await statusSvn(g.wc);
        cheio.push(ms() - tc);
      }
    }
    const p95 = percentil(amostras, 95);
    console.log(`P-16 SVN: incremental mediana ${mediana(amostras).toFixed(0)} ms, p95 ${p95.toFixed(0)} ms, pior ${Math.max(...amostras).toFixed(0)} ms | status completo (referência) mediana ${mediana(cheio).toFixed(0)} ms, pior ${Math.max(...cheio).toFixed(0)} ms`);
    registrar({ id: "P-16-svn", descricao: "status incremental SVN (comando, 1 arquivo mudado) em cópia de 20 000 arquivos, p95 de 30 amostras", valor: p95, limite: 250, unidade: "ms", pior: Math.max(...amostras) });
    expect(p95).toBeGreaterThan(0);
  }, 900_000);
});

describe("P-22 · fetch em segundo plano", () => {
  it("1 por vez, prioridade baixa, sem foco não busca, pausar aborta e o event loop nunca para mais de 50 ms", async () => {
    const base = pasta("vcs-perf22-");
    const origem = join(base, "origem");
    await gerarRepo(origem, { arquivos: 3_000, commits: 200 });
    const bare = join(base, "origem.git");
    git(base, "clone", "-q", "--bare", origem, bare);
    const clone = join(base, "clone");
    git(base, "clone", "-q", `file://${bare}`, clone);
    git(clone, "config", "user.name", "Teste");
    git(clone, "config", "user.email", "t@example.invalid");
    // o remoto recebe trabalho novo (objetos para o fetch trazer)
    for (let i = 0; i < 300; i++) writeFileSync(join(origem, `novo-${i}.txt`), `novo ${i}\n${"y".repeat(200)}\n`);
    git(origem, "add", "-A");
    git(origem, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "mais trabalho");
    git(origem, "push", "-q", bare, "main");

    const opcoesVistas: Array<OpcoesExec> = [];
    let simultaneos = 0;
    let maxSimultaneos = 0;
    const espiao = {
      executar: async (args: readonly string[], op: OpcoesExec) => {
        if (args.includes("fetch")) opcoesVistas.push(op);
        if (args.includes("fetch")) maxSimultaneos = Math.max(maxSimultaneos, ++simultaneos);
        try {
          return await executorPadrao.executar(args, op);
        } finally {
          if (args.includes("fetch")) simultaneos--;
        }
      },
    } as unknown as ExecutorVcs;

    let foco = false;
    const fundo = criarFetchSegundoPlano({ janelaEmFoco: () => foco, executor: espiao });
    // sem foco: nenhuma execução
    const semFoco = await Promise.all([fundo.tentar(clone), fundo.tentar(clone)]);
    const buscasSemFoco = semFoco.filter((r) => r.executado).length;
    expect(buscasSemFoco).toBe(0);
    registrar({ id: "P-22-sem-foco", descricao: "buscas executadas com a janela sem foco (2 tentativas)", valor: buscasSemFoco, limite: 0, unidade: "buscas" });

    // com foco: 5 disparos simultâneos = 1 execução (os outros "ocupado"); mede o atraso do event loop durante o fetch
    foco = true;
    let maxAtraso = 0;
    let ultimo = performance.now();
    const t = setInterval(() => {
      const agora = performance.now();
      maxAtraso = Math.max(maxAtraso, agora - ultimo - 10);
      ultimo = agora;
    }, 10);
    const rs = await Promise.all([fundo.tentar(clone), fundo.tentar(clone), fundo.tentar(clone), fundo.tentar(clone), fundo.tentar(clone)]);
    clearInterval(t);
    const executadas = rs.filter((r) => r.executado);
    const ocupadas = rs.filter((r) => !r.executado && r.motivo === "ocupado");
    expect(executadas).toHaveLength(1);
    expect(ocupadas).toHaveLength(4);
    expect(executadas[0]).toMatchObject({ resultado: { atualizacoes: expect.any(Number) } });
    expect(opcoesVistas.every((o) => o.prioridadeBaixa === true)).toBe(true);
    expect(git(clone, "rev-parse", "origin/main").trim()).toBe(git(bare, "rev-parse", "main").trim());
    registrar({ id: "P-22-concorrencia", descricao: "fetches simultâneos com 5 disparos ao mesmo tempo", valor: maxSimultaneos, limite: 1, unidade: "fetches" });
    registrar({ id: "P-22", descricao: "atraso máximo do event loop durante o fetch em segundo plano (remoto file:// com 300 arquivos novos)", valor: Math.max(0, maxAtraso), limite: 50, unidade: "ms" });

    // pausar aborta o fetch em curso e recusa novos até retomar
    const lento = criarFetchSegundoPlano({
      janelaEmFoco: () => true,
      executor: { executar: (_a: readonly string[], op: OpcoesExec) => new Promise((_r, rej) => op.signal?.addEventListener("abort", () => rej(Object.assign(new Error("abortado"), { name: "GitCanceladoErro" })))) } as unknown as ExecutorVcs,
    });
    const emCurso = lento.tentar(clone).catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 50));
    expect(lento.ativo()).toBe(true); // em curso, preso no executor falso até o abort
    lento.pausar();
    await emCurso;
    expect(lento.ativo()).toBe(false);
    expect(await lento.tentar(clone)).toEqual({ executado: false, motivo: "pausado" });
  }, 600_000);
});

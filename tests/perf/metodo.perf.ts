// Orçamentos do Método Expx (03-ORCAMENTOS-DESEMPENHO.md): P-09, P-10 e P-11.
// Electron real; projeto temporário sintético (tests/fixtures/metodo/gerar.ts); só toca em pastas tmp.
//  - P-10: indexação do projeto (200 artefatos em docs/) ≤ 300 ms, medida NA PONTA DO WORKER: `duracao_ms` do
//    índice é cronometrado dentro da thread do worker (performance.now de ponta a ponta de `indexar`). Amostras:
//    a indexação a frio (primeira, ao abrir) + 4 releituras por mudança em arquivo; vale a MEDIANA das 5.
//  - P-11: mudança em arquivo observado → evento `metodo:mudou` no renderer ≤ 600 ms (debounce de 300 ms incluso).
//    Relógio de parede único (Date.now no teste; timeOrigin+now no renderer). A 1ª mudança aquece (primeira
//    leitura do watcher/IPC depois do boot) e é DESCARTADA, documentado; valem 5 mudanças seguintes, MEDIANA.
//  - P-09: 1 000 trabalhos na lista + 1 000 cards num quadro; rolagem programática de 3 s (lista e colunas do
//    quadro ao mesmo tempo): maior intervalo entre quadros (rAF) ≤ 20 ms e nós no DOM por lista virtualizada ≤ 300.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { abrirApp } from "../fixture";
import type { AppAberto } from "../fixture";
import { fase, gerarProjetoExpx, gerarVolume, md, orquestrador, task } from "../fixtures/metodo/gerar";
import { gravarMedicoes, percentil, registrar } from "./registro";

const pastas: string[] = [];
const abertos: AppAberto[] = [];
afterAll(async () => {
  gravarMedicoes();
  for (const a of abertos) {
    // Com ~10 000 arquivos em docs/ o `watcher.close()` do chokidar pode segurar o encerramento por dezenas de
    // segundos (ver docs/ade/perf/PENDENCIAS-PERF.md). O teste não espera: passado o teto, mata o processo.
    const fechando = a.fechar();
    const travou = await Promise.race([fechando.then(() => false), new Promise<boolean>((r) => setTimeout(() => r(true), 15_000))]);
    if (travou) {
      console.log("fechar app: encerramento travou > 15 s (watcher de projeto grande); processo morto pelo teste");
      try { a.app.process().kill("SIGKILL"); } catch { /* já saiu */ }
      await fechando;
    }
  }
  for (const p of pastas) rmSync(p, { recursive: true, force: true });
});

const mediana = (xs: number[]): number => percentil(xs, 50);

function pastaTmp(): string {
  const p = mkdtempSync(join(tmpdir(), "ade-perf-metodo-"));
  pastas.push(p);
  return p;
}

function contarArquivos(dir: string): number {
  let n = 0;
  for (const e of readdirSync(dir)) {
    const caminho = join(dir, e);
    n += statSync(caminho).isDirectory() ? contarArquivos(caminho) : 1;
  }
  return n;
}

type ApiMetodo = { metodo: { estado(id: string): Promise<{ trabalhos: Array<{ id: string }>; artefatos_lidos: number; duracao_ms: number } | null> } };

async function abrirProjeto(raiz: string): Promise<{ a: AppAberto; wsId: string }> {
  const a = await abrirApp();
  abertos.push(a);
  await a.pagina.waitForSelector('nav[aria-label="Principal"]', { timeout: 20_000 });
  const ws = await a.pagina.evaluate((r) => window.ade!.workspaces.abrir(r), raiz);
  expect(ws).not.toBeNull();
  return { a, wsId: ws!.id };
}

describe("P-10 e P-11: indexação e observação do projeto", () => {
  it("200 artefatos: indexação ≤ 300 ms (mediana de 5) e mudança → evento ≤ 600 ms (mediana de 5)", async () => {
    const raiz = join(pastaTmp(), "projeto");
    mkdirSync(raiz, { recursive: true });
    gerarProjetoExpx(raiz);
    const base = contarArquivos(join(raiz, "docs")) + contarArquivos(join(raiz, ".expx"));
    // completa até ~200 artefatos LIDOS no total (gerarVolume escreve de 10 em 10; o contador do indexador não conta tudo o que há em disco)
    gerarVolume(raiz, Math.max(10, Math.ceil((200 - base) / 10) * 10 + 10));
    const { a, wsId } = await abrirProjeto(raiz);
    const p = a.pagina;

    // 1ª indexação (a frio): espera o índice completo aparecer
    let indice: Awaited<ReturnType<ApiMetodo["metodo"]["estado"]>> = null;
    const limite = Date.now() + 60_000;
    while (Date.now() < limite && (indice === null || indice.trabalhos.length < 20)) {
      indice = await p.evaluate((id) => window.ade!.metodo.estado(id), wsId);
      if (indice === null || indice.trabalhos.length < 20) await p.waitForTimeout(100);
    }
    expect(indice, "índice não apareceu").not.toBeNull();
    const lidos = indice!.artefatos_lidos;
    expect(lidos, "artefatos lidos").toBeGreaterThanOrEqual(200);
    expect(lidos, "artefatos lidos (≈ 200, não muito mais)").toBeLessThanOrEqual(230);
    const frio = indice!.duracao_ms;

    await p.evaluate(() => {
      const w = window as unknown as { __mudou: number[] };
      w.__mudou = [];
      window.ade!.metodo.assinar(() => { w.__mudou.push(performance.timeOrigin + performance.now()); });
    });
    // espera o watcher ficar pronto (mudança antes disso se perderia)
    await p.waitForTimeout(1_500);

    const alvo = join(raiz, "docs", "sprintx", "features", "cobranca-pix", "00-BLOQUEIOS.md");
    const latencias: number[] = [];
    const indexacoes: number[] = [frio];
    for (let i = 0; i < 6; i++) {
      const t0 = Date.now();
      appendFileSync(alvo, `\n<!-- toque ${i} -->\n`);
      await p.waitForFunction((n) => (window as unknown as { __mudou: number[] }).__mudou.length > n, i, { timeout: 15_000 });
      const tEvento = await p.evaluate((n) => (window as unknown as { __mudou: number[] }).__mudou[n] as number, i);
      const atual = await p.evaluate((id) => window.ade!.metodo.estado(id), wsId);
      if (i > 0) { // a mudança 0 aquece e não entra em nenhuma das medianas
        latencias.push(tEvento - t0);
        if (indexacoes.length < 5) indexacoes.push(atual!.duracao_ms); // frio + 4 quentes = 5 amostras de indexação
      }
      await p.waitForTimeout(1_000); // deixa o lote anterior assentar: cada toque é um lote próprio
    }
    expect(indexacoes).toHaveLength(5);
    expect(latencias).toHaveLength(5);

    const p10 = registrar({ id: "P-10", descricao: `indexação de ${lidos} artefatos, no worker (mediana de 5)`, valor: mediana(indexacoes), limite: 300, unidade: "ms", pior: Math.max(...indexacoes) });
    const p11 = registrar({ id: "P-11", descricao: "mudança em arquivo → evento no renderer (mediana de 5)", valor: mediana(latencias), limite: 600, unidade: "ms", pior: Math.max(...latencias) });
    console.log(`P-10 (${lidos} artefatos lidos) amostras [frio, 4 quentes]: ${indexacoes.join(", ")} ms → mediana ${p10.valor}, pior ${p10.pior}`);
    console.log(`P-11 amostras: ${latencias.map((l) => l.toFixed(0)).join(", ")} ms → mediana ${p11.valor}, pior ${p11.pior}`);
    expect(p10.ok, `P-10 mediana ${p10.valor} ms > ${p10.limite} ms`).toBe(true);
    expect(p11.ok, `P-11 mediana ${p11.valor} ms > ${p11.limite} ms`).toBe(true);
  });
});

/** Trabalho com `n` tasks (e, portanto, `n` cards no quadro), distribuídas nas quatro colunas. */
function escreverTrabalhoGrande(raiz: string, id: string, n: number): void {
  const pasta = join(raiz, "docs", "sprintx", "features", id);
  mkdirSync(join(pasta, "sprint-01"), { recursive: true });
  const status = ["pendente", "concluida", "em_andamento", "bloqueada"];
  const tasks = Array.from({ length: n }, (_, i) => {
    const num = String(i + 1).padStart(4, "0");
    return task({ id: `T-01.${num}`, fase: "F-01.1", status: status[i % 4] as string, titulo: `Card ${num} do trabalho grande` });
  });
  const cab = { expx_schema: 1, expx_tool: "sprintx", trabalho_id: id, atualizado_em: "2026-09-28" };
  writeFileSync(join(pasta, "ORQUESTRADOR.md"), orquestrador({ id, estagio: "f6" }));
  writeFileSync(join(pasta, "sprint-01", "sprint.md"), md({ ...cab, kind: "sprint", sprint_id: "sprint-01", titulo: "Sprint grande", status: "em_andamento", criterio_saida: "tudo verde", fases: ["F-01.1"], riscos: [] }, "# Sprint\n"));
  writeFileSync(join(pasta, "sprint-01", "fases.md"), md({ ...cab, kind: "fases", sprint_id: "sprint-01", fases: [fase("F-01.1", tasks.map((t) => t["id"] as string))] }, "# Fases\n"));
  writeFileSync(join(pasta, "sprint-01", "tasks.md"), md({ ...cab, kind: "tasks", sprint_id: "sprint-01", tasks }, "# Tasks\n"));
}

describe("P-09: lista grande (1 000 trabalhos e 1 000 cards)", () => {
  it("rolagem de 3 s sem quadro lento e só os nós visíveis no DOM", async () => {
    const raiz = join(pastaTmp(), "projeto");
    mkdirSync(raiz, { recursive: true });
    gerarProjetoExpx(raiz);
    gerarVolume(raiz, 10_000); // 1 000 trabalhos (10 arquivos cada)
    escreverTrabalhoGrande(raiz, "cartoes-mil", 1_000);
    const { a, wsId } = await abrirProjeto(raiz);
    const p = a.pagina;

    let trabalhos = 0;
    let indice: number = -1;
    const limite = Date.now() + 120_000;
    while (Date.now() < limite && indice < 0) {
      const r = await p.evaluate((id) => window.ade!.metodo.estado(id), wsId);
      trabalhos = r?.trabalhos.length ?? 0;
      indice = r?.trabalhos.findIndex((t) => t.id === "cartoes-mil") ?? -1;
      if (indice < 0) await p.waitForTimeout(250);
    }
    expect(trabalhos, "trabalhos indexados").toBeGreaterThanOrEqual(1_000);
    expect(indice, "posição do trabalho grande na lista").toBeGreaterThanOrEqual(0);

    // tela Método → lista → trabalho grande → aba Quadro
    await p.locator('nav[aria-label="Principal"]').getByRole("button", { name: /Método/ }).click();
    const lista = p.locator('.virtual-lista[aria-label="Trabalhos do método"]');
    await lista.waitFor({ timeout: 30_000 });
    await lista.evaluate((el, i) => { el.scrollTop = Math.max(0, i * 68 - 136); }, indice);
    const linha = p.locator(".met-linha-trab", { hasText: "Trabalho cartoes-mil" });
    await linha.waitFor({ timeout: 10_000 });
    await linha.click();
    await p.getByRole("tab", { name: "Quadro" }).click();
    await p.locator('.met-coluna .virtual-lista[aria-label^="Cards"]').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(500);

    // rolagem: lista e colunas do quadro avançam juntas, uma posição por quadro, durante 3 s (ida e volta × 1)
    const medirRolagem = (): Promise<{ deltas: number[]; longas: number[]; nosPorLista: number[]; nosListas: number; nosDocumento: number; listas: number }> =>
      p.evaluate(async (duracaoMs) => {
        const visiveis = (): HTMLElement[] => (Array.from(document.querySelectorAll(".virtual-lista")) as HTMLElement[]).filter((l) => l.clientHeight > 0 && l.offsetParent !== null);
        const listas = visiveis();
        const longas: number[] = [];
        const obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) longas.push(e.duration); });
        obs.observe({ entryTypes: ["longtask"] });
        const deltas: number[] = [];
        let maxNos = new Array<number>(listas.length).fill(0);
        let maxSoma = 0;
        listas.forEach((l) => { l.scrollTop = 0; });
        await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
        await new Promise<void>((fim) => {
          const t0 = performance.now();
          let ultimo = t0;
          let n = 0;
          const passo = (agora: number): void => {
            if (n > 0) deltas.push(agora - ultimo);
            ultimo = agora;
            n += 1;
            const prog = Math.min(1, (agora - t0) / duracaoMs);
            for (const l of listas) l.scrollTop = prog * (l.scrollHeight - l.clientHeight);
            if (n % 10 === 0) { // amostra a contagem de nós no meio da rolagem (fora do caminho crítico de cada quadro)
              const contagens = listas.map((l) => l.querySelectorAll("*").length);
              maxNos = maxNos.map((m, i) => Math.max(m, contagens[i] as number));
              maxSoma = Math.max(maxSoma, contagens.reduce((s, c) => s + c, 0));
            }
            if (prog < 1) requestAnimationFrame(passo); else fim();
          };
          requestAnimationFrame(passo);
        });
        obs.disconnect();
        return { deltas, longas, nosPorLista: maxNos, nosListas: maxSoma, nosDocumento: document.querySelectorAll("*").length, listas: listas.length };
      }, 3_000);

    const rodadas: Array<Awaited<ReturnType<typeof medirRolagem>>> = [];
    for (let i = 0; i < 3; i++) {
      rodadas.push(await medirRolagem());
      await p.waitForTimeout(500);
    }
    const maximos = rodadas.map((r) => Math.max(...r.deltas));
    const nos = rodadas.map((r) => Math.max(...r.nosPorLista));
    for (const [i, r] of rodadas.entries()) {
      console.log(`P-09 rodada ${i + 1}: ${r.deltas.length} quadros em 3 s, maior intervalo ${maximos[i]!.toFixed(1)} ms, p95 ${percentil(r.deltas, 95).toFixed(1)} ms, > 20 ms: ${r.deltas.filter((d) => d > 20).length}, longtasks ${r.longas.length} (máx ${(r.longas.length === 0 ? 0 : Math.max(...r.longas)).toFixed(0)} ms); ${r.listas} listas visíveis, nós por lista [${r.nosPorLista.join(", ")}], soma ${r.nosListas}, documento ${r.nosDocumento}`);
    }
    const quadros = registrar({ id: "P-09", descricao: "rolagem 3 s, 1 000 trabalhos + 1 000 cards: maior quadro (mediana de 3)", valor: mediana(maximos), limite: 20, unidade: "ms", pior: Math.max(...maximos) });
    const nosM = registrar({ id: "P-09b", descricao: "nós no DOM da maior lista virtualizada (1 000 itens)", valor: Math.max(...nos), limite: 300, unidade: "nós", pior: Math.max(...nos) });
    expect(rodadas[0]!.listas, "listas virtualizadas visíveis (trabalhos + colunas do quadro)").toBeGreaterThanOrEqual(2);
    expect(nosM.ok, `${nosM.valor} nós > ${nosM.limite}`).toBe(true);
    expect(quadros.ok, `maior quadro ${quadros.valor} ms (mediana de ${maximos.map((m) => m.toFixed(1)).join(", ")}) > ${quadros.limite} ms`).toBe(true);
  });
});

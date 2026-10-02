// Orçamentos da documentação e relatórios (Fase 19; núcleo puro + SQLite em memória + disco temporário, sem Electron): P-290, P-291, P-293, P-296, P-299, P-300.
// Dados sintéticos determinísticos (tests/fixtures/relatorios/gerar.ts: sprint de 200 itens). P-292/P-294/P-297/P-298/P-301/P-302 dependem de UI/PDF/documentação do projeto (ondas seguintes).
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { abrirBanco } from "../../src/nucleo/banco/banco";
import { migrar } from "../../src/nucleo/banco/migrar";
import { criarRepoRelatoriosSqlite } from "../../src/nucleo/banco/repos/relatorios";
import { coletarFatos } from "../../src/nucleo/relatorios/fatos/coletar";
import { criarZip } from "../../src/nucleo/relatorios/formatos/zip";
import { verificarBlocos } from "../../src/nucleo/relatorios/redacao/verificar";
import { montarBlocos } from "../../src/nucleo/relatorios/redacao/deterministico";
import { criarRelatorios } from "../../src/nucleo/relatorios/servico";
import type { Bloco } from "../../src/compartilhado/relatorios";
import { SPRINT_ID, WS, gerarVolumeRelatorio, portasFalsas } from "../fixtures/relatorios/gerar";
import { gravarMedicoes, percentil, registrar } from "./registro";

afterAll(() => gravarMedicoes());

/** maior intervalo entre dois turnos do laço de eventos enquanto `fn` roda (o main não pode ficar > 50 ms sem respirar). */
async function comMonitor<T>(fn: () => Promise<T>): Promise<{ valor: T; pior: number; total: number }> {
  let pior = 0;
  let ultimo = performance.now();
  let rodando = true;
  const laco = (): void => { const n = performance.now(); pior = Math.max(pior, n - ultimo); ultimo = n; if (rodando) setImmediate(laco); };
  setImmediate(laco);
  const t0 = performance.now();
  const valor = await fn();
  const total = performance.now() - t0;
  rodando = false;
  await new Promise((r) => setImmediate(r));
  return { valor, pior, total };
}

describe("P-290: coleta de fatos (200 itens)", () => {
  it("mediana de 5 ≤ 300 ms", async () => {
    const portas = portasFalsas({}, gerarVolumeRelatorio(200));
    const t: number[] = [];
    for (let i = 0; i < 5; i++) { const t0 = performance.now(); const r = await coletarFatos(portas, WS, SPRINT_ID); t.push(performance.now() - t0); expect(r?.fatos.itens).toHaveLength(200); }
    registrar({ id: "P-290", descricao: "Coleta de fatos da sprint com 200 itens, mediana de 5", valor: percentil(t, 50), limite: 300, unidade: "ms", pior: Math.max(...t) });
  });
});

describe("P-291 e P-293: pacote completo em modo template (200 itens), disco temporário + SQLite", () => {
  it("≤ 2 s ponta a ponta; laço de eventos nunca bloqueado > 50 ms; HTML ≤ 1,5 MB e CSV ≤ 100 KB", async () => {
    const raiz = await mkdtemp(join(tmpdir(), "rel-perf-"));
    try {
      const banco = abrirBanco(":memory:");
      migrar(banco);
      banco.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES (?,?,?,?,?)", [WS, "w", raiz, "t", "t"]);
      const r = criarRelatorios({ repo: criarRepoRelatoriosSqlite(banco), portas: portasFalsas({ workspace: { raiz: () => raiz } }, gerarVolumeRelatorio(200)) });
      const m = await comMonitor(() => r.gerar(WS, { tipo: "sprint", sprint_id: SPRINT_ID }));
      const d = await r.ler(WS, m.valor.pacote_id);
      expect(d.estado).toBe("pronto");
      registrar({ id: "P-291a", descricao: "Pacote completo em modo template (200 itens), ponta a ponta", valor: m.total, limite: 2000, unidade: "ms" });
      registrar({ id: "P-291b", descricao: "Pacote completo: maior bloqueio do laço de eventos do main", valor: m.pior, limite: 50, unidade: "ms" });
      const maiorHtml = Math.max(...d.arquivos.filter((a) => a.formato === "html").map((a) => a.bytes));
      const maiorCsv = Math.max(...d.arquivos.filter((a) => a.formato === "csv").map((a) => a.bytes));
      registrar({ id: "P-293a", descricao: "Maior HTML do pacote (200 itens, sem logo)", valor: maiorHtml / 1024, limite: 1536, unidade: "KB", semFator: true });
      registrar({ id: "P-293b", descricao: "Maior CSV do pacote (200 itens)", valor: maiorCsv / 1024, limite: 100, unidade: "KB", semFator: true });
      // P-299: consultar 500 pacotes (SQLite real)
      const repo = criarRepoRelatoriosSqlite(banco);
      banco.transacao((b) => { for (let i = 0; i < 500; i++) b.executar("INSERT INTO relatorio_pacote (id, workspace_id, sprint_id, titulo, versao, hash_fatos, hash_geracao, modo_redacao, estado, pasta_ref, gerado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [`rel_perf${String(i).padStart(10, "0")}`, WS, `spr_p${i % 50}`, "t", 100 + Math.floor(i / 50), "h", `g${i}`, "template", "pronto", "p", `2027-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`]); });
      const t: number[] = [];
      for (let i = 0; i < 15; i++) { const t0 = performance.now(); repo.pacotesListar(WS); t.push(performance.now() - t0); }
      registrar({ id: "P-299", descricao: "Consultar 500 pacotes (SQLite), mediana de 15", valor: percentil(t, 50), limite: 10, unidade: "ms", pior: Math.max(...t) });
      banco.fechar();
    } finally {
      await rm(raiz, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("P-296: verificador (500 afirmações)", () => {
  it("≤ 200 ms", async () => {
    const f = (await coletarFatos(portasFalsas({}, gerarVolumeRelatorio(200)), WS, SPRINT_ID))!.fatos;
    const base = montarBlocos(f);
    const extra: Bloco[] = [{ id: "u_x", titulo: "x", publico: "usuario", origem: "llm", precisa_revisao: false, afirmacoes: Array.from({ length: 500 }, (_, i) => ({ id: `x.${i}`, texto: `Entregamos ${i % 9} itens em 02/03/2026.`, fontes: [`sprint:${SPRINT_ID}`] })) }];
    const t: number[] = [];
    for (let i = 0; i < 5; i++) { const t0 = performance.now(); verificarBlocos(f, [...base.filter((b) => b.publico === "tecnico"), ...extra], { cobertura: false }); t.push(performance.now() - t0); }
    registrar({ id: "P-296", descricao: "Verificador com 500 afirmações extras, mediana de 5", valor: percentil(t, 50), limite: 200, unidade: "ms", pior: Math.max(...t) });
  });
});

describe("P-300: ZIP store de 5 MB", () => {
  it("≤ 150 ms", () => {
    const dados = new Uint8Array(5 * 1024 * 1024).map((_, i) => (i * 31) & 0xff);
    const t: number[] = [];
    for (let i = 0; i < 5; i++) { const t0 = performance.now(); const z = criarZip([{ nome: "a.bin", dados }], new Date("2027-01-01T00:00:00Z")); t.push(performance.now() - t0); expect(z.length).toBeGreaterThan(5 * 1024 * 1024); }
    registrar({ id: "P-300", descricao: "ZIP store de 5 MB, mediana de 5", valor: percentil(t, 50), limite: 150, unidade: "ms", pior: Math.max(...t) });
  });
});

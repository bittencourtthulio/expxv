// E2E do lado main dos terminais (T-01.04/T-01.07/T-01.08 + daemon), sobre o Electron real.
// Não depende da UI do terminal: fala com `window.ade.terminais` direto no renderer.
// A CLI falsa (tests/fixtures/cli-pty.mjs) entra pelo gancho de teste do main (só existe com a
// variável E2E do produto): o executável vem do ambiente, nunca do diálogo nativo.
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { variavelDeAmbiente } from "../src/nucleo/produto";
import { abrirApp, RAIZ } from "./fixture";
import type { AppAberto } from "./fixture";

const pastasTemporarias: string[] = [];
const temporaria = (prefixo: string): string => {
  const p = mkdtempSync(join(tmpdir(), prefixo));
  pastasTemporarias.push(p);
  return p;
};

let pastaDados: string;
let raizWorkspace: string;
let env: Record<string, string>;
let app: AppAberto | null = null;

beforeAll(() => {
  pastaDados = temporaria("ade-e2e-term-dados-");
  raizWorkspace = temporaria("ade-e2e-term-ws-");
  // wrapper executável: o PTY precisa de um arquivo executável; ele chama o node com a CLI falsa
  const wrapper = join(temporaria("ade-e2e-term-bin-"), "cli-falsa.sh");
  writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${join(RAIZ, "tests", "fixtures", "cli-pty.mjs")}" "$@"\n`);
  chmodSync(wrapper, 0o755);
  env = { [variavelDeAmbiente("E2E_EXECUTAVEL")]: wrapper, [variavelDeAmbiente("E2E_RAIZ")]: raizWorkspace };
});

afterAll(async () => {
  await app?.fechar();
  for (const p of pastasTemporarias) rmSync(p, { recursive: true, force: true });
});

// ---- helpers que rodam dentro da página (window.ade é a API enumerada do preload)
interface AdeTerminais {
  selecionarExecutavel(id: string): Promise<{ executavel_id: string | null } | null>;
  abrir(p: unknown): Promise<{ sessao_id: string }>;
  escrever(id: string, d: string): void;
  redimensionar(id: string, c: number, l: number): void;
  listarSessoes(): Promise<Array<{ sessao_id: string; estado: string; persistente: boolean }>>;
  recuperar(): Promise<{ sessoes: Array<{ sessao_id: string; estado: string }> }>;
  descartar(id: string): Promise<boolean>;
  confirmarConsumo(id: string, bytes: number): Promise<boolean>;
  assinarEventos(cb: (e: { tipo: string; sessao_id: string; dados?: string; sequencia: number }) => void): () => void;
  assinarFalhas(cb: (f: unknown) => void): () => void;
}
interface JanelaTeste { ade: { terminais: AdeTerminais }; __saida?: Record<string, string>; __sequencias?: Record<string, number[]>; __falhas?: unknown[] }

/** Assina os eventos (acumula a saída por sessão, como o armazém do renderer) e confirma o consumo. */
async function assinar(a: AppAberto): Promise<void> {
  await a.pagina.evaluate(() => {
    const w = window as unknown as JanelaTeste;
    w.__saida = {};
    w.__sequencias = {};
    w.__falhas = [];
    w.ade.terminais.assinarEventos((e) => {
      if (e.tipo !== "saida") return;
      w.__saida![e.sessao_id] = (w.__saida![e.sessao_id] ?? "") + (e.dados ?? "");
      (w.__sequencias![e.sessao_id] ??= []).push(e.sequencia);
      void w.ade.terminais.confirmarConsumo(e.sessao_id, (e.dados ?? "").length);
    });
    w.ade.terminais.assinarFalhas((f) => w.__falhas!.push(f));
  });
}

async function saida(a: AppAberto, sessaoId: string): Promise<string> {
  return a.pagina.evaluate((id) => (window as unknown as JanelaTeste).__saida?.[id] ?? "", sessaoId);
}

async function esperarSaida(a: AppAberto, sessaoId: string, trecho: string): Promise<void> {
  await a.pagina.waitForFunction(([id, t]) => ((window as unknown as JanelaTeste).__saida?.[id as string] ?? "").includes(t as string), [sessaoId, trecho] as const, { timeout: 15_000 });
}

const ocorrencias = (texto: string, trecho: string): number => texto.split(trecho).length - 1;

async function prepararPagina(a: AppAberto): Promise<void> {
  await a.pagina.waitForSelector("nav", { timeout: 15_000 });
  await assinar(a);
}

/** Conta diálogos nativos chamados no main (não deve haver nenhum). */
async function vigiarDialogos(a: AppAberto): Promise<void> {
  await a.app.evaluate(({ dialog }) => {
    const g = globalThis as unknown as { __dialogos: number };
    g.__dialogos = 0;
    for (const nome of ["showOpenDialog", "showOpenDialogSync", "showSaveDialog", "showSaveDialogSync", "showMessageBox", "showMessageBoxSync", "showErrorBox"] as const) {
      (dialog as unknown as Record<string, unknown>)[nome] = () => { g.__dialogos += 1; return nome.endsWith("Sync") ? 0 : Promise.resolve({ response: 1, canceled: true, filePaths: [] }); };
    }
  });
}
const dialogosChamados = (a: AppAberto): Promise<number> => a.app.evaluate(() => (globalThis as unknown as { __dialogos?: number }).__dialogos ?? 0);

let sessaoId = "";

describe("terminais no main (Electron real, CLI falsa, daemon)", () => {
  it("registra a CLI falsa via gancho, abre a sessão, escreve, recebe o eco e redimensiona", async () => {
    app = await abrirApp({ pastaDados, env });
    await prepararPagina(app);
    await vigiarDialogos(app);
    const a = app;

    const escolhida = await a.pagina.evaluate(() => (window as unknown as JanelaTeste).ade.terminais.selecionarExecutavel("personalizado"));
    expect(escolhida?.executavel_id).toMatch(/^exe_/);

    const aberta = await a.pagina.evaluate((executavel_id) => (window as unknown as JanelaTeste).ade.terminais.abrir({
      versao: 1, ferramenta_id: "personalizado", executavel_id, argumentos: [], colunas: 80, linhas: 24, workspace_id: null,
    }), escolhida?.executavel_id);
    sessaoId = aberta.sessao_id;
    expect(sessaoId).toMatch(/^sessao_/);

    await esperarSaida(a, sessaoId, "pty> ");
    await a.pagina.evaluate((id) => (window as unknown as JanelaTeste).ade.terminais.escrever(id, "ola\r"), sessaoId);
    await esperarSaida(a, sessaoId, "eco:ola");

    await a.pagina.evaluate((id) => {
      const t = (window as unknown as JanelaTeste).ade.terminais;
      t.redimensionar(id, 132, 43);
      t.escrever(id, "tamanho\r");
    }, sessaoId);
    await esperarSaida(a, sessaoId, "tamanho:132x43");

    const lista = await a.pagina.evaluate(() => (window as unknown as JanelaTeste).ade.terminais.listarSessoes());
    expect(lista.find((s) => s.sessao_id === sessaoId)).toMatchObject({ estado: "executando", persistente: true });
    // sequencia monotônica e sem repetição, mesmo com o lote por quadro
    const seqs = await a.pagina.evaluate((id) => (window as unknown as JanelaTeste).__sequencias?.[id] ?? [], sessaoId);
    expect(seqs.length).toBeGreaterThan(0);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1] as number);
    expect(await a.pagina.evaluate(() => (window as unknown as JanelaTeste).__falhas)).toEqual([]);
  });

  it("recarregar o renderer não mata a sessão e a saída é recuperada sem duplicar", async () => {
    const a = app as AppAberto;
    await a.pagina.evaluate(() => location.reload());
    await a.pagina.waitForLoadState("domcontentloaded");
    await prepararPagina(a);

    const lista = await a.pagina.evaluate(() => (window as unknown as JanelaTeste).ade.terminais.listarSessoes());
    expect(lista.find((s) => s.sessao_id === sessaoId)?.estado).toBe("executando");

    const r = await a.pagina.evaluate(() => (window as unknown as JanelaTeste).ade.terminais.recuperar());
    expect(r.sessoes.map((s) => s.sessao_id)).toContain(sessaoId);
    await esperarSaida(a, sessaoId, "tamanho:132x43");
    const recuperada = await saida(a, sessaoId);
    expect(ocorrencias(recuperada, "eco:ola")).toBe(1);
    expect(ocorrencias(recuperada, "pty> ")).toBe(1);
    expect(ocorrencias(recuperada, "tamanho:132x43")).toBe(1);

    // a sessão continua viva e recebe entrada depois do reload
    await a.pagina.evaluate((id) => (window as unknown as JanelaTeste).ade.terminais.escrever(id, "depois do reload\r"), sessaoId);
    await esperarSaida(a, sessaoId, "eco:depois do reload");
    expect(ocorrencias(await saida(a, sessaoId), "eco:ola")).toBe(1);
  });

  it("nenhum diálogo nativo foi aberto e o canal recusa cwd e executável inventado", async () => {
    const a = app as AppAberto;
    expect(await dialogosChamados(a)).toBe(0);
    const recusas = await a.pagina.evaluate(async () => {
      const t = (window as unknown as JanelaTeste).ade.terminais;
      const tentar = (p: unknown): Promise<string> => t.abrir(p).then(() => "abriu", (e: Error) => String(e.message));
      const base = { versao: 1, ferramenta_id: "personalizado", argumentos: [], colunas: 80, linhas: 24, workspace_id: null };
      return {
        cwd: await tentar({ ...base, executavel_id: "exe_inventado", cwd: "/etc" }),
        inventado: await tentar({ ...base, executavel_id: "exe_inventado" }),
        caminho: await tentar({ ...base, executavel_id: "/bin/sh" }),
      };
    });
    expect(recusas.cwd).not.toBe("abriu");
    expect(recusas.inventado).not.toBe("abriu");
    expect(recusas.caminho).not.toBe("abriu");
  });

  it("fechar o app e reabrir com a mesma pasta de dados traz as sessões persistentes de volta (daemon)", async () => {
    await (app as AppAberto).fechar(); // pastaDados informada: não é apagada
    app = await abrirApp({ pastaDados, env });
    const a = app;
    await prepararPagina(a);
    await vigiarDialogos(a);

    const r = await a.pagina.evaluate(() => (window as unknown as JanelaTeste).ade.terminais.recuperar());
    const volta = r.sessoes.find((s) => s.sessao_id === sessaoId);
    expect(volta?.estado).toBe("executando");
    await esperarSaida(a, sessaoId, "tamanho:132x43");
    const recuperada = await saida(a, sessaoId);
    expect(ocorrencias(recuperada, "eco:ola")).toBe(1);
    expect(ocorrencias(recuperada, "eco:depois do reload")).toBe(1);

    await a.pagina.evaluate((id) => (window as unknown as JanelaTeste).ade.terminais.escrever(id, "de novo\r"), sessaoId);
    await esperarSaida(a, sessaoId, "eco:de novo");
    expect(await dialogosChamados(a)).toBe(0);
  });

  it("descartar a sessão limpa o daemon (nada fica vivo depois do teste)", async () => {
    const a = app as AppAberto;
    expect(await a.pagina.evaluate((id) => (window as unknown as JanelaTeste).ade.terminais.descartar(id), sessaoId)).toBe(true);
    const lista = await a.pagina.evaluate(() => (window as unknown as JanelaTeste).ade.terminais.listarSessoes());
    expect(lista.find((s) => s.sessao_id === sessaoId)).toBeUndefined();
  });
});

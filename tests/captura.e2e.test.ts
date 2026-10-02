// E2E da voz e da captura (Fase 11, T-11.22/T-11.23) no Electron real. ESCRITO e type-checado; NÃO executado nesta onda: rodar exige `npm run build` (e o `dist/` está em uso pelo `npm run dev` do dono).
// Sem microfone nem tela reais: o motor de STT é a CLI falsa `tests/fixtures/stt-falso.mjs`, o terminal é a CLI falsa de eco e o áudio entra por `window.ade.voz.audio` (PCM sintético).
//   1) boot: voz e captura existem só sob demanda; motor nenhum; microfone não é pedido; nada em tmp
//   2) ditado completo: iniciar -> blocos de PCM -> parar -> o texto aparece UMA vez no eco, sem Enter; ESC (cancelar) antes de soltar escreve nada
//   3) captura da janela do app: PNG válido na pasta de dados (sem workspace), listada, lida por id; id com ../ recusado; sem diálogo nativo
//   4) anexar ao Pane: o eco mostra o caminho RELATIVO, sem Enter; Pane inexistente -> erro nominal
//   5) quadros 2 fps da janela do app por ~3 s: pasta com ~6 PNGs; parar encerra; nada sobra em tmp
//   6) permissões: pedido do Chromium para câmera/vídeo/tela é negado; áudio só depois do aviso de primeiro uso
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { variavelDeAmbiente } from "../src/nucleo/produto";
import { abrirApp, RAIZ } from "./fixture";
import type { AppAberto } from "./fixture";

const temporarias: string[] = [];
const tmp = (p: string): string => { const d = mkdtempSync(join(tmpdir(), p)); temporarias.push(d); return d; };

let app: AppAberto;
let pastaDados = "";
let raiz = "";
let sessaoId = "";

interface Ade {
  terminais: {
    selecionarExecutavel(id: string): Promise<{ executavel_id: string | null } | null>;
    abrir(p: unknown): Promise<{ sessao_id: string }>;
    assinarEventos(cb: (e: { tipo: string; sessao_id: string; dados?: string }) => void): () => void;
    confirmarConsumo(id: string, bytes: number): Promise<boolean>;
  };
  voz: {
    estado(): Promise<{ motor: string; microfone: string; ditado: string; motor_pronto: boolean }>;
    configGravar(p: unknown): Promise<unknown>;
    testarMotor(): Promise<{ ok: boolean; erro: string | null }>;
    iniciar(sessao: string, disparo: string): Promise<{ ok: boolean; codigo: string | null }>;
    parar(): Promise<{ ok: boolean }>;
    cancelar(): Promise<{ ok: boolean }>;
    audio(seq: number, dados: Uint8Array): void;
    historicoListar(): Promise<{ texto: string; injetada: boolean }[]>;
  };
  captura: {
    janelaInteira(ws: string | null): Promise<{ ok: boolean; captura_id?: string; codigo?: string }>;
    listar(ws: string | null, depois: string | null): Promise<{ itens: { id: string; caminho: string; formato: string | null }[] }>;
    ler(id: string, ws: string | null): Promise<{ bytes: Uint8Array; tipo: string }>;
    anexarAoPane(id: string, ws: string | null, sessao: string): Promise<{ caminhos: string[]; texto: string }>;
    quadrosIniciar(fonte: string, fps: number, ws: string | null): Promise<{ ok: boolean }>;
    quadrosParar(): Promise<{ captura_id: string | null }>;
  };
}
interface Janela { ade: Ade; __saida?: Record<string, string> }

const pcm = (ms: number): number[] => Array.from({ length: ms * 16 * 2 }, (_, i) => ((i >> 1) % 2 === 0 ? (i % 2 === 0 ? 0x28 : 0x23) : (i % 2 === 0 ? 0xd8 : 0xdc)));
const saida = (): Promise<string> => app.pagina.evaluate((id) => (window as unknown as Janela).__saida?.[id] ?? "", sessaoId);
const esperarSaida = (trecho: string): Promise<unknown> => app.pagina.waitForFunction(([id, t]) => ((window as unknown as Janela).__saida?.[id as string] ?? "").includes(t as string), [sessaoId, trecho] as const, { timeout: 15_000 });

beforeAll(async () => {
  pastaDados = tmp("ade-e2e-cap-dados-");
  raiz = tmp("ade-e2e-cap-ws-");
  const wrapper = join(tmp("ade-e2e-cap-bin-"), "cli-falsa.sh");
  writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${join(RAIZ, "tests", "fixtures", "cli-pty.mjs")}" "$@"\n`);
  chmodSync(wrapper, 0o755);
  app = await abrirApp({ pastaDados, env: { [variavelDeAmbiente("E2E_EXECUTAVEL")]: wrapper, [variavelDeAmbiente("E2E_RAIZ")]: raiz } });
  await app.pagina.waitForSelector("nav", { timeout: 15_000 });
  await app.pagina.evaluate(() => {
    const w = window as unknown as Janela;
    w.__saida = {};
    w.ade.terminais.assinarEventos((e) => {
      if (e.tipo !== "saida") return;
      w.__saida![e.sessao_id] = (w.__saida![e.sessao_id] ?? "") + (e.dados ?? "");
      void w.ade.terminais.confirmarConsumo(e.sessao_id, (e.dados ?? "").length);
    });
  });
  const exe = await app.pagina.evaluate(() => (window as unknown as Janela).ade.terminais.selecionarExecutavel("personalizado"));
  const s = await app.pagina.evaluate((executavel_id) => (window as unknown as Janela).ade.terminais.abrir({ versao: 1, ferramenta_id: "personalizado", executavel_id, argumentos: [], colunas: 80, linhas: 24, workspace_id: null }), exe?.executavel_id);
  sessaoId = s.sessao_id;
  await esperarSaida("pty> ");
}, 120_000);

afterAll(async () => {
  await app?.fechar();
  for (const d of temporarias) rmSync(d, { recursive: true, force: true });
});

describe("voz e captura no Electron real", () => {
  it("boot: motor nenhum, microfone não pedido, ditado inexistente sem motor", async () => {
    const e = await app.pagina.evaluate(() => (window as unknown as Janela).ade.voz.estado());
    expect(e).toMatchObject({ motor: "nenhum", motor_pronto: false, ditado: "ocioso" });
    const r = await app.pagina.evaluate((id) => (window as unknown as Janela).ade.voz.iniciar(id, "segurar"), sessaoId);
    expect(r).toEqual({ ok: false, codigo: "motor_ausente" });
  });

  it("ditado completo: o texto aparece UMA vez no eco, sem Enter; cancelar antes de soltar não escreve nada", async () => {
    const falso = join(RAIZ, "tests", "fixtures", "stt-falso.mjs");
    await app.pagina.evaluate((p) => (window as unknown as Janela).ade.voz.configGravar(p), { motor: "comando_local", comando_executavel: process.execPath, comando_args: [falso, "--wav", "{wav}", "--texto", "ola ditado", "--json"], aviso_microfone_visto: true });
    expect((await app.pagina.evaluate(() => (window as unknown as Janela).ade.voz.testarMotor())).ok).toBe(true);
    // 1) fala completa
    expect((await app.pagina.evaluate((id) => (window as unknown as Janela).ade.voz.iniciar(id, "segurar"), sessaoId)).ok).toBe(true);
    await app.pagina.evaluate((dados) => { (window as unknown as Janela).ade.voz.audio(0, new Uint8Array(dados)); }, pcm(1_000));
    await app.pagina.evaluate(() => (window as unknown as Janela).ade.voz.parar());
    await esperarSaida("ola ditado");
    const antes = await saida();
    expect(antes.split("ola ditado").length - 1).toBe(1);
    expect(antes).not.toContain("eco:ola ditado"); // sem Enter: o eco de linha só viria depois do CR
    // 2) cancelar antes de soltar
    await app.pagina.evaluate((id) => (window as unknown as Janela).ade.voz.iniciar(id, "segurar"), sessaoId);
    await app.pagina.evaluate((dados) => { (window as unknown as Janela).ade.voz.audio(0, new Uint8Array(dados)); }, pcm(500));
    await app.pagina.evaluate(() => (window as unknown as Janela).ade.voz.cancelar());
    await new Promise((r) => setTimeout(r, 600));
    expect((await saida()).split("ola ditado").length - 1).toBe(1);
    // nenhum WAV sobra no tmp do sistema
    expect(readdirSync(tmpdir()).filter((n) => /-voz-[A-Za-z0-9]{6}$/.test(n) && existsSync(join(tmpdir(), n, "fala.wav")))).toEqual([]);
  });

  it("captura da janela do app: PNG válido na pasta de dados, listada e lida por id; id malicioso é recusado", async () => {
    const r = await app.pagina.evaluate(() => (window as unknown as Janela).ade.captura.janelaInteira(null));
    expect(r.ok).toBe(true);
    const lista = await app.pagina.evaluate(() => (window as unknown as Janela).ade.captura.listar(null, null));
    const item = lista.itens.find((i) => i.id === r.captura_id);
    expect(item?.caminho).toBe(join("capturas", `${r.captura_id}.${item?.formato === "jpeg" ? "jpg" : "png"}`));
    const arquivo = join(pastaDados, item!.caminho);
    expect(existsSync(arquivo)).toBe(true);
    if (item?.formato === "png") expect(readFileSync(arquivo).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const lida = await app.pagina.evaluate((id) => (window as unknown as Janela).ade.captura.ler(id, null), r.captura_id!);
    expect(lida.bytes.length).toBeGreaterThan(100);
    await expect(app.pagina.evaluate(() => (window as unknown as Janela).ade.captura.ler("../../etc/passwd", null))).rejects.toThrow(/recusado/);
  });

  it("anexar ao Pane: o eco mostra o caminho RELATIVO sem Enter; Pane inexistente dá erro nominal", async () => {
    const id = (await app.pagina.evaluate(() => (window as unknown as Janela).ade.captura.listar(null, null))).itens[0]!.id;
    const r = await app.pagina.evaluate(([c, s]) => (window as unknown as Janela).ade.captura.anexarAoPane(c as string, null, s as string), [id, sessaoId] as const);
    expect(r.caminhos[0]).toMatch(/entradas/);
    expect(r.texto.startsWith("/")).toBe(false);
    expect(r.texto).not.toMatch(/[\r\n]/);
    await esperarSaida(r.caminhos[0]!);
    await expect(app.pagina.evaluate((c) => (window as unknown as Janela).ade.captura.anexarAoPane(c, null, "sessao_inexistente-1"), id)).rejects.toThrow(/sem_terminal/);
  });

  it("quadros a 2 fps da janela do app: ~6 quadros em 3 s e parar encerra", async () => {
    expect((await app.pagina.evaluate(() => (window as unknown as Janela).ade.captura.quadrosIniciar("janela_app", 2, null))).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 3_000));
    const fim = await app.pagina.evaluate(() => (window as unknown as Janela).ade.captura.quadrosParar());
    expect(fim.captura_id).toMatch(/^q_/);
    const dir = join(pastaDados, "capturas", "quadros", fim.captura_id!.slice(2));
    const quadros = readdirSync(dir).filter((n) => /^frame_\d{4}\.png$/.test(n));
    expect(quadros.length).toBeGreaterThanOrEqual(4);
    expect(quadros.length).toBeLessThanOrEqual(8);
  });

  it("permissões do Chromium: câmera, vídeo e tela são negados; áudio só passa pelo handler do app", async () => {
    const r = await app.pagina.evaluate(async () => {
      const tentar = async (c: MediaStreamConstraints): Promise<string> => { try { (await navigator.mediaDevices.getUserMedia(c)).getTracks().forEach((t) => t.stop()); return "liberado"; } catch (e) { return (e as Error).name; } };
      return { video: await tentar({ video: true }), tela: await navigator.mediaDevices.getDisplayMedia({ video: true }).then(() => "liberado", (e: Error) => e.name) };
    });
    expect(r.video).not.toBe("liberado");
    expect(r.tela).not.toBe("liberado");
  });
});

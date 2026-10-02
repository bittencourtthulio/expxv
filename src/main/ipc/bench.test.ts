import { describe, expect, it, vi } from "vitest";
import { CANAIS_INVOKE, CANAIS_SENSIVEIS } from "../../compartilhado/ipc";
import { criarRegistroIpc, CanalRecusadoErro, type IpcMainLike } from "./registro";
import { VALIDADORES_BENCH, registrarIpcBench, paraErroIpc } from "./bench";
import { ErroBench } from "../../nucleo/bench/tipos";
import type { ServicoBench } from "../../nucleo/bench/servico";

const TOKEN = "a".repeat(48);
const BRUN = "brun_01M3V8236WR2S7C4WBR29CJ6ZA";
const BRES = "bres_01M3V8236WR2S7C4WBR29CJ6ZA";
const EST = "est_lq3k2j9x";
const ok = (c: keyof typeof VALIDADORES_BENCH, v: unknown) => (VALIDADORES_BENCH[c] as (x: unknown) => { ok: boolean })(v).ok;

function montar(servico: Partial<ServicoBench> = {}) {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const ipc: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
  const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: () => true });
  const svc = servico as ServicoBench;
  registrarIpcBench({ registro, servico: () => svc });
  return { handlers, chamar: (canal: string, p?: unknown) => (handlers.get(canal) as (e: unknown, p?: unknown) => Promise<unknown>)({}, p) };
}

describe("contrato dos canais bench:*", () => {
  const doContrato = CANAIS_INVOKE.filter((c) => c.startsWith("bench:")).sort();
  it("todo canal do contrato tem validador e manipulador; nenhum validador é órfão", () => {
    expect(Object.keys(VALIDADORES_BENCH).sort()).toEqual(doContrato);
    const { handlers } = montar();
    expect([...handlers.keys()].sort()).toEqual(doContrato);
  });
  it("rodar, rerodar e julgar são sensíveis (o token de consentimento não vai a log)", () => {
    for (const c of ["bench:rodar", "bench:rerodar", "bench:julgar"] as const) expect(CANAIS_SENSIVEIS).toContain(c);
  });
  it("NÃO existe canal que devolva mapa cego, caminho de execução ou aceite executável/ambiente", () => {
    const nomes = doContrato.join(" ");
    expect(nomes).not.toMatch(/mapa|caminho|workdir|executavel|env/i);
  });
});

describe("validadores estritos", () => {
  it("consentir: frase só RODAR / RODAR SEM SANDBOX; estimativa por regex; campo extra recusado", () => {
    expect(ok("bench:consentir", { estimativa_id: EST, confirmacao: "RODAR" })).toBe(true);
    expect(ok("bench:consentir", { estimativa_id: EST, confirmacao: "RODAR SEM SANDBOX", finalidade: "julgar" })).toBe(true);
    for (const ruim of ["rodar", "RODAR ", "RODAR!", "SIM", ""]) expect(ok("bench:consentir", { estimativa_id: EST, confirmacao: ruim }), ruim).toBe(false);
    expect(ok("bench:consentir", { estimativa_id: "../x", confirmacao: "RODAR" })).toBe(false);
    expect(ok("bench:consentir", { estimativa_id: EST, confirmacao: "RODAR", caminho: "/etc" })).toBe(false);
    expect(ok("bench:consentir", { estimativa_id: EST, confirmacao: "RODAR", finalidade: "qualquer" })).toBe(false);
  });
  it("rodar/rerodar/julgar: token de 48 hex; ids por regex", () => {
    expect(ok("bench:rodar", { estimativa_id: EST, token: TOKEN })).toBe(true);
    for (const t of ["", "x".repeat(48), "a".repeat(47), "A".repeat(48), `${"a".repeat(47)}/`]) expect(ok("bench:rodar", { estimativa_id: EST, token: t }), t).toBe(false);
    expect(ok("bench:rerodar", { run_id: BRUN, tarefa: "debug-find-and-fix", alvo: "claude-opus-high", token: TOKEN })).toBe(true);
    expect(ok("bench:rerodar", { run_id: "brun_../x", tarefa: "t", alvo: "a", token: TOKEN })).toBe(false);
    expect(ok("bench:julgar", { run_id: BRUN, tarefa: null, juiz_alvo: "j", token: TOKEN })).toBe(true);
    expect(ok("bench:julgar", { run_id: BRUN, tarefa: null, juiz_alvo: "J MAIÚSCULO", token: TOKEN })).toBe(false);
  });
  it("artefato_ler recusa ../x, absoluto, backslash e NUL; log_ler limita a 64 KiB", () => {
    for (const n of ["../x", "/etc/passwd", "a/../b", "a\\b", "a\0b", "", "x".repeat(201)]) expect(ok("bench:artefato_ler", { resultado_id: BRES, nome: n }), JSON.stringify(n)).toBe(false);
    expect(ok("bench:artefato_ler", { resultado_id: BRES, nome: "sub/index.html" })).toBe(true);
    expect(ok("bench:log_ler", { resultado_id: BRES, depois: 0, max: 65_536 })).toBe(true);
    expect(ok("bench:log_ler", { resultado_id: BRES, depois: 0, max: 65_537 })).toBe(false);
    expect(ok("bench:log_ler", { resultado_id: BRES, depois: -1, max: 10 })).toBe(false);
    expect(ok("bench:log_ler", { resultado_id: BRES, depois: 0, max: 0 })).toBe(false);
  });
  it("tarefa_salvar/alvos_salvar: nada de caminho, executável ou ambiente; lista fechada de tipos", () => {
    const tarefa = { slug: "t-ok", titulo: "T", atividade: "bug", tipo: "codigo", prompt: "p", escopo: "", checagens: [{ tipo: "command_exit_zero", alvo: "node --test", critica: true }], estado: "ativa" };
    expect(ok("bench:tarefa_salvar", { tarefa })).toBe(true);
    expect(ok("bench:tarefa_salvar", { tarefa: { ...tarefa, executavel: "/bin/sh" } })).toBe(false);
    expect(ok("bench:tarefa_salvar", { tarefa: { ...tarefa, checagens: [{ tipo: "shell", alvo: "x", critica: true }] } })).toBe(false);
    expect(ok("bench:tarefa_salvar", { tarefa: { ...tarefa, slug: "../x" } })).toBe(false);
    const alvo = { provedor: "claude", modelo: "m-1", esforco: "high", cli: "claude", conta_id: "cta_1", rotulo: null };
    expect(ok("bench:alvos_salvar", { alvos: [alvo] })).toBe(true);
    expect(ok("bench:alvos_salvar", { alvos: [{ ...alvo, cli: "gemini" }] })).toBe(false);
    expect(ok("bench:alvos_salvar", { alvos: [{ ...alvo, env: { A: "b" } }] })).toBe(false);
    expect(ok("bench:alvos_salvar", { alvos: [{ ...alvo, modelo: "x; rm -rf /" }] })).toBe(false);
  });
  it("estimar, nota_manual, preços e comparar", () => {
    const est = { tarefas: ["t"], alvos: ["a"], max_paralelo: 3, teto_usd: null, juiz_alvo: null };
    expect(ok("bench:estimar", est)).toBe(true);
    expect(ok("bench:estimar", { ...est, tarefas: [] })).toBe(false);
    expect(ok("bench:estimar", { ...est, teto_usd: -1 })).toBe(false);
    expect(ok("bench:estimar", { ...est, teto_usd: Number.NaN })).toBe(false);
    expect(ok("bench:nota_manual", { resultado_id: BRES, nota: 10, notas: null })).toBe(true);
    expect(ok("bench:nota_manual", { resultado_id: BRES, nota: 10.1, notas: null })).toBe(false);
    expect(ok("bench:nota_manual", { resultado_id: BRES, nota: -1, notas: null })).toBe(false);
    expect(ok("bench:precos_gravar", { precos: [{ provedor: "claude", modelo: "m", preco_in_mtok: 3, preco_out_mtok: 15, preco_cache_mtok: null, vale_desde: "2026-01-01T00:00:00.000Z" }] })).toBe(true);
    expect(ok("bench:precos_gravar", { precos: [{ provedor: "claude", modelo: "m", preco_in_mtok: -3, preco_out_mtok: 15, preco_cache_mtok: null, vale_desde: "2026-01-01T00:00:00.000Z" }] })).toBe(false);
    expect(ok("bench:comparar", { alvos: ["a"], tarefas: null, agrupar: "tarefa" })).toBe(false); // ≥ 2 alvos
    expect(ok("bench:comparar", { alvos: ["a", "b"], tarefas: null, agrupar: "tarefa" })).toBe(true);
    expect(ok("bench:alvos_listar", undefined)).toBe(true);
    expect(ok("bench:alvos_listar", { x: 1 })).toBe(false);
  });
});

describe("manipuladores", () => {
  it("payload inválido é recusado ANTES do manipulador (o serviço nem é tocado)", async () => {
    const rodar = vi.fn();
    const { chamar } = montar({ rodar } as never);
    await expect(chamar("bench:rodar", { estimativa_id: EST, token: "curto" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    expect(rodar).not.toHaveBeenCalled();
  });
  it("repassa só os campos validados ao serviço", async () => {
    const rodar = vi.fn(async () => ({ erro: "consentimento_invalido" as const }));
    const { chamar } = montar({ rodar } as never);
    await expect(chamar("bench:rodar", { estimativa_id: EST, token: TOKEN })).resolves.toEqual({ erro: "consentimento_invalido" });
    expect(rodar).toHaveBeenCalledWith(EST, TOKEN);
  });
  it("erro de regra chega como `[codigo] texto`; erro interno vira texto genérico sem stack nem caminho", async () => {
    const avisos: string[] = [];
    const { ipc, handlers } = (() => { const h = new Map<string, (e: unknown, ...a: unknown[]) => unknown>(); return { handlers: h, ipc: { handle: (c: string, l: (e: unknown, ...a: unknown[]) => unknown) => void h.set(c, l), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined } as IpcMainLike }; })();
    const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: () => true });
    registrarIpcBench({ registro, servico: () => ({ estadoRun: () => { throw new ErroBench("nao_encontrado", "Run inexistente"); }, resultado: () => { throw new Error("ENOENT /Users/dono/segredo/x.sqlite"); } }) as never, aviso: (m) => avisos.push(m) });
    await expect((handlers.get("bench:estado_run") as (e: unknown, p: unknown) => Promise<unknown>)({}, { run_id: BRUN })).rejects.toThrow("[nao_encontrado] Run inexistente");
    const e = await (handlers.get("bench:resultado") as (e: unknown, p: unknown) => Promise<unknown>)({}, { resultado_id: BRES }).catch((x: Error) => x);
    expect((e as Error).message).toBe("[unavailable] Falha interna no Bench.");
    expect((e as Error).message).not.toMatch(/Users|sqlite/);
    expect(avisos[0]).toMatch(/bench:/);
    expect(paraErroIpc(new Error("x")).message).toMatch(/unavailable/);
  });
});

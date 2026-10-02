import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CANAIS_SENSIVEIS } from "../../compartilhado/ipc";
import { criarCofre, criarMotorSenhaMestra, type Cofre } from "../../nucleo/cofre";
import { criarManipuladoresCofre, registrarIpcCofre } from "./cofre";
import { CanalRecusadoErro, criarRegistroIpc, type IpcMainLike } from "./registro";

const SENTINELA = "SENTINELA-ipc-cofre-c0ffee42-valor-secreto";
const SENHA = "senha-mestra-ipc-teste-9";
const pastas: string[] = [];
afterEach(() => {
  while (pastas.length) rmSync(pastas.pop() as string, { recursive: true, force: true });
});

function montar() {
  const dir = mkdtempSync(join(tmpdir(), "ipc-cofre-"));
  pastas.push(dir);
  let aberturas = 0;
  let cofre: Cofre | null = null;
  const provedor = (): Cofre => {
    aberturas++;
    cofre ??= criarCofre({ arquivo: join(dir, "cofre.json"), motor: criarMotorSenhaMestra({ scrypt: { N: 1024, r: 8, p: 1 } }) });
    return cofre;
  };
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const ipc: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
  const logs: string[] = [];
  const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: () => true, log: (l) => logs.push(l), logarPayload: true });
  registrarIpcCofre({ registro, cofre: provedor });
  const chamar = (canal: string, payload?: unknown): Promise<unknown> => (handlers.get(canal) as (e: unknown, ...a: unknown[]) => Promise<unknown>)({}, payload);
  return { dir, chamar, logs, aberturas: () => aberturas, handlers, provedor };
}
const entrada = (valor = SENTINELA) => ({ id: null, nome: "CHAVE_X", escopo: "global", workspace_id: null, sensivel: true, valor });

describe("manipuladores cofre:*", () => {
  it("registra exatamente os 7 canais e NÃO abre o cofre no registro (sob demanda)", () => {
    const m = montar();
    expect([...m.handlers.keys()].sort()).toEqual(["cofre:apagar", "cofre:bloquear", "cofre:desbloquear", "cofre:disponivel", "cofre:gravar", "cofre:listar", "cofre:senha_mestra_definir"]);
    expect(m.aberturas()).toBe(0);
  });

  it("fluxo completo: define senha-mestra, grava (valor nunca volta), lista nomes, bloqueia, falha nominal, desbloqueia, apaga", async () => {
    const m = montar();
    expect(await m.chamar("cofre:disponivel", {})).toMatchObject({ ok: true, backend: "senha_mestra", bloqueado: true });
    expect(await m.chamar("cofre:senha_mestra_definir", { senha: SENHA })).toMatchObject({ ok: true, bloqueado: false });
    const gravada = (await m.chamar("cofre:gravar", entrada())) as { id: string };
    expect(JSON.stringify(gravada)).not.toContain(SENTINELA);
    expect(gravada).toMatchObject({ nome: "CHAVE_X", sensivel: true, ultimo_uso_em: null });
    const lista = (await m.chamar("cofre:listar", {})) as Array<{ nome: string }>;
    expect(lista.map((e) => e.nome)).toEqual(["CHAVE_X"]);
    expect(JSON.stringify(lista)).not.toContain(SENTINELA);
    expect(await m.chamar("cofre:bloquear", {})).toMatchObject({ bloqueado: true });
    await expect(m.chamar("cofre:gravar", { ...entrada(), nome: "OUTRA" })).rejects.toMatchObject({ codigo: "cofre_bloqueado" });
    expect(await m.chamar("cofre:desbloquear", { senha: SENHA })).toMatchObject({ ok: true, bloqueado: false });
    expect(await m.chamar("cofre:apagar", { id: gravada.id })).toBe(true);
    expect(await m.chamar("cofre:apagar", { id: gravada.id })).toBe(false);
    expect(readFileSync(join(m.dir, "cofre.json"), "utf8")).not.toContain(SENTINELA);
    expect(m.aberturas()).toBeGreaterThan(0);
  });

  it("senha errada: estado trancado com motivo genérico (sem lançar, sem pista)", async () => {
    const m = montar();
    await m.chamar("cofre:senha_mestra_definir", { senha: SENHA });
    await m.chamar("cofre:bloquear", {});
    const r1 = await m.chamar("cofre:desbloquear", { senha: "senha-errada-numero-1" });
    const r2 = await m.chamar("cofre:desbloquear", { senha: `${SENHA}x` });
    expect(r1).toEqual(r2);
    expect(r1).toMatchObject({ ok: false, bloqueado: true, motivo: "senha_incorreta" });
    expect(JSON.stringify([r1, r2])).not.toMatch(/errada|senha-mestra-ipc/);
  });

  it("o log do registro NÃO imprime payload dos canais sensíveis (nem em payload inválido), mesmo com logarPayload ligado", async () => {
    const m = montar();
    await m.chamar("cofre:senha_mestra_definir", { senha: SENHA });
    await m.chamar("cofre:gravar", entrada());
    await expect(m.chamar("cofre:gravar", { ...entrada(), nome: "minusculo" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.chamar("cofre:gravar", { ...entrada(), [`campo_${SENTINELA}`]: 1 })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await m.chamar("cofre:desbloquear", { senha: SENHA });
    await expect(m.chamar("cofre:desbloquear", { senha: "curta" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    expect(m.logs.length).toBeGreaterThanOrEqual(6);
    const tudo = m.logs.join("\n");
    expect(tudo).not.toContain(SENTINELA);
    expect(tudo).not.toContain(SENHA);
    expect(tudo).not.toContain("curta");
    for (const canal of ["cofre:gravar", "cofre:senha_mestra_definir", "cofre:desbloquear"]) expect(CANAIS_SENSIVEIS).toContain(canal);
    expect(tudo).toContain("[sensivel: payload omitido]");
  });

  it("erros inesperados não repassam a mensagem original (pode citar valor)", async () => {
    const quebrado = {
      estado: async () => {
        throw new Error(`falha com ${SENTINELA}`);
      },
      scrubSincrono: (t: string) => t,
    } as unknown as Cofre;
    const erro = await criarManipuladoresCofre(() => quebrado).disponivel().catch((e: Error) => e);
    expect((erro as Error).message).toBe("falha no cofre");
  });

  it("testar sem salvar: valor usado uma vez, cofre intacto, erro sem o valor", async () => {
    const m = montar();
    await m.chamar("cofre:senha_mestra_definir", { senha: SENHA });
    const antes = readFileSync(join(m.dir, "cofre.json"), "utf8");
    const mm = criarManipuladoresCofre(m.provedor);
    expect(await mm.testarSemSalvar(SENTINELA, (v) => v.length)).toBe(SENTINELA.length);
    await expect(
      mm.testarSemSalvar(SENTINELA, (v) => {
        throw new Error(`401 ${v}`);
      }),
    ).rejects.toSatisfy((e: Error) => !e.message.includes(SENTINELA));
    expect(readFileSync(join(m.dir, "cofre.json"), "utf8")).toBe(antes);
    expect((await m.chamar("cofre:listar", {})) as unknown[]).toHaveLength(0);
  });
});

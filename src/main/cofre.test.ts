import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { adaptarSafeStorage, criarCofreSobDemanda, escolherMotor, type SafeStorageDoElectron } from "./cofre";

const SENTINELA = "SENTINELA-main-cofre-3b6e1f90-valor";
const pastas: string[] = [];
const nova = (): string => {
  const p = mkdtempSync(join(tmpdir(), "main-cofre-"));
  pastas.push(p);
  return p;
};
afterEach(() => {
  while (pastas.length) rmSync(pastas.pop() as string, { recursive: true, force: true });
});

/** safeStorage FALSO (nunca o Keychain real). */
function ssFalso(backend: string | undefined, disponivel = true, contadores = { cifrou: 0 }): SafeStorageDoElectron {
  return {
    isEncryptionAvailable: () => disponivel,
    encryptString: (t) => {
      contadores.cifrou++;
      return Buffer.from(`enc:${Buffer.from(t).reverse().toString("base64")}`);
    },
    decryptString: (b) => Buffer.from(Buffer.from(b).toString().slice(4), "base64").reverse().toString(),
    ...(backend === undefined ? {} : { getSelectedStorageBackend: () => backend }),
  };
}
const RAPIDO = { N: 1024, r: 8, p: 1 };
const pedido = (nome: string, valor: string) => ({ id: null, nome, escopo: "global" as const, workspace_id: null, sensivel: true, valor });

describe("cofre no main: motor e abertura sob demanda", () => {
  it("não toca o disco nem o safeStorage até o primeiro uso", async () => {
    const dir = nova();
    const c = { cifrou: 0 };
    const sob = criarCofreSobDemanda({ userData: dir, safeStorage: ssFalso(undefined, true, c) });
    expect(sob.aberto()).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
    const cofre = await sob.obter();
    expect(sob.aberto()).toBe(true);
    expect(await sob.obter()).toBe(cofre);
    expect(readdirSync(dir)).toEqual([]); // abrir não cria arquivo; só guardar
    expect(c.cifrou).toBe(0);
    await sob.encerrar();
    expect(sob.aberto()).toBe(false);
  });

  it("macOS/Windows (sem getSelectedStorageBackend) ou Linux com chaveiro: usa safeStorage", async () => {
    for (const ss of [ssFalso(undefined), ssFalso("gnome_libsecret"), ssFalso("kwallet6")]) {
      const dir = nova();
      const sob = criarCofreSobDemanda({ userData: dir, safeStorage: ss });
      const cofre = await sob.obter();
      expect(await cofre.estado()).toMatchObject({ ok: true, backend: "safe_storage", bloqueado: false });
      await cofre.guardar(pedido("A_CHAVE", SENTINELA));
      expect(JSON.parse(readFileSync(join(dir, "cofre.json"), "utf8")).motor).toBe("safe_storage");
      expect(readFileSync(join(dir, "cofre.json"), "utf8")).not.toContain(SENTINELA);
    }
  });

  it("Linux com basic_text ou sem cifrador: cai para a senha-mestra (P-29) em vez de recusar", async () => {
    for (const ss of [ssFalso("basic_text"), ssFalso(undefined, false)]) {
      const dir = nova();
      const sob = criarCofreSobDemanda({ userData: dir, safeStorage: ss, scrypt: RAPIDO });
      const cofre = await sob.obter();
      expect(await cofre.estado()).toMatchObject({ ok: true, backend: "senha_mestra", bloqueado: true });
      await cofre.definirSenhaMestra("uma-senha-mestra-boa-1");
      await cofre.guardar(pedido("A_CHAVE", SENTINELA));
      const arquivo = readFileSync(join(dir, "cofre.json"), "utf8");
      expect(JSON.parse(arquivo).motor).toBe("senha_mestra");
      expect(arquivo).not.toContain(SENTINELA);
      await sob.encerrar();
      // reabrir no próximo boot: o arquivo manda no motor, mesmo que o safeStorage volte a funcionar
      const sob2 = criarCofreSobDemanda({ userData: dir, safeStorage: ssFalso(undefined), scrypt: RAPIDO });
      const c2 = await sob2.obter();
      expect((await c2.estado()).backend).toBe("senha_mestra");
      await c2.desbloquear("uma-senha-mestra-boa-1");
      expect(await c2.obter("A_CHAVE")).toBe(SENTINELA);
      await sob2.encerrar();
    }
  });

  it("arquivo criado com safeStorage continua com safeStorage", async () => {
    const dir = nova();
    const a = criarCofreSobDemanda({ userData: dir, safeStorage: ssFalso(undefined) });
    await (await a.obter()).guardar(pedido("A_CHAVE", SENTINELA));
    const motor = await escolherMotor({ userData: dir, safeStorage: ssFalso("basic_text"), scrypt: RAPIDO });
    expect(motor.tipo).toBe("safe_storage");
    expect(motor.estado().ok).toBe(false); // agora indisponível: recusa com instrução, sem trocar de motor às escondidas
  });

  it("adaptador tolera safeStorage que lança", () => {
    const porta = adaptarSafeStorage({
      ...ssFalso(undefined),
      isEncryptionAvailable: () => {
        throw new Error("x");
      },
      getSelectedStorageBackend: () => {
        throw new Error("y");
      },
    });
    expect(porta.disponivel()).toBe(false);
    expect(porta.backend()).toBeNull();
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { guardarSegredos } from "../nucleo/conhecimento/backend/config";
import { lerSegredosRag } from "../nucleo/conhecimento/backend/cofre-rag";
import { criarCofreSobDemanda, type SafeStorageDoElectron } from "./cofre";
import { criarPortaCofreRagDoApp } from "./rag-cofre";

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop() as string, { recursive: true, force: true });
});
// safeStorage falso (cifra reversível trivial): o cofre REAL do núcleo roda sobre ele, em disco temporário.
const safe = (backend: string | null, disponivel = true): SafeStorageDoElectron => ({
  isEncryptionAvailable: () => disponivel,
  encryptString: (t) => Buffer.from(`enc:${t}`, "utf8"),
  decryptString: (d) => Buffer.from(d).toString("utf8").replace(/^enc:/, ""),
  ...(backend === null ? {} : { getSelectedStorageBackend: () => backend }),
});

describe("src/main/rag-cofre: cofre real do núcleo sobre safeStorage falso", () => {
  it("guarda, lê só no main e apaga; o arquivo do cofre não contém o valor em claro", async () => {
    const userData = await mkdtemp(join(tmpdir(), "rag-cofre-"));
    dirs.push(userData);
    const s = safe(null);
    const cofre = criarCofreSobDemanda({ userData, safeStorage: s });
    const porta = criarPortaCofreRagDoApp({ cofre, safeStorage: s });
    expect(cofre.aberto()).toBe(false);
    const r = await guardarSegredos(porta, "upstash", { token: "tok-upstash-ABCDEF123456" });
    expect(r.mascarado).toEqual({ token: "••••3456" });
    expect(await lerSegredosRag(porta, "upstash", r.ids)).toEqual({ token: "tok-upstash-ABCDEF123456" });
    const { readFile } = await import("node:fs/promises");
    expect(await readFile(join(userData, "cofre.json"), "utf8")).not.toContain("tok-upstash-ABCDEF123456");
    await porta.apagar("RAG_UPSTASH_TOKEN");
    expect(await porta.obter("RAG_UPSTASH_TOKEN")).toBeNull();
    await cofre.encerrar();
  });
  it("Linux com basic_text: recusa guardar (nada vai ao disco)", async () => {
    const userData = await mkdtemp(join(tmpdir(), "rag-cofre-"));
    dirs.push(userData);
    const s = safe("basic_text");
    const cofre = criarCofreSobDemanda({ userData, safeStorage: s });
    const porta = criarPortaCofreRagDoApp({ cofre, safeStorage: s, plataforma: "linux" });
    await expect(porta.guardar("RAG_QDRANT_API_KEY", "valor-secreto-123")).rejects.toThrow(/basic_text/);
    await cofre.encerrar();
  });
});

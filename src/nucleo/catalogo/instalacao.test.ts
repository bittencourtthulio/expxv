import { realpathSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, readdirSync, rmSync, symlinkSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { skillMd } from "../../../tests/fixtures/catalogo/gerar";
import { desinstalar, fsReal, instalar, type FsInstalacao } from "./instalacao";
import { sha256 } from "./raizes";

let raiz: string;
let home: string;
let fonte: string;
const dest = () => join(home, ".codex", "skills");
beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), "cat-inst-"));
  home = join(raiz, "home");
  fonte = join(home, ".claude", "skills", "minha-skill");
  mkdirSync(fonte, { recursive: true });
  writeFileSync(join(fonte, "SKILL.md"), skillMd("minha-skill", "d"));
});
afterEach(() => rmSync(raiz, { recursive: true, force: true }));
const base = () => ({ fonteAbs: fonte, raizDestinoAbs: dest(), modo: "symlink" as const, raizesConhecidas: [home, realpathSync(home)] });

describe("instalar", () => {
  it("instala 2x = instalado e depois ja_instalado; sem temporários; P-29 ≤ 150 ms", async () => {
    const t0 = performance.now();
    const a = await instalar(base());
    expect(performance.now() - t0).toBeLessThan(150 * Number(process.env["EXPXV_PERF_FATOR"] ?? 3));
    expect(a).toMatchObject({ estado: "instalado", caminho_rel: "minha-skill", metodo: "symlink" });
    expect(lstatSync(join(dest(), "minha-skill")).isSymbolicLink()).toBe(true);
    expect((await instalar(base())).estado).toBe("ja_instalado");
    expect(readdirSync(dest())).toEqual(["minha-skill"]);
  });
  it("destino de outra coisa = conflito, sem sobrescrever", async () => {
    mkdirSync(join(dest(), "minha-skill"), { recursive: true });
    writeFileSync(join(dest(), "minha-skill", "SKILL.md"), "meu");
    expect((await instalar(base())).estado).toBe("conflito");
    expect(readFileSync(join(dest(), "minha-skill", "SKILL.md"), "utf8")).toBe("meu");
  });
  it("recusa nome com caminho, fonte sem SKILL.md e fonte fora das raízes", async () => {
    expect((await instalar({ ...base(), fonteAbs: join(fonte, "..", "..", "skills", "..") })).codigo).toMatch(/nome_invalido|fonte/);
    mkdirSync(join(home, "vazia"), { recursive: true });
    expect((await instalar({ ...base(), fonteAbs: join(home, "vazia") })).codigo).toBe("fonte_sem_skill");
    const fora = join(raiz, "fora", "x");
    mkdirSync(fora, { recursive: true });
    writeFileSync(join(fora, "SKILL.md"), "x");
    expect((await instalar({ ...base(), fonteAbs: fora })).codigo).toBe("fonte_fora_das_raizes");
    const ln = join(home, ".claude", "skills", "link-pra-fora");
    symlinkSync(fora, ln, "dir");
    expect((await instalar({ ...base(), fonteAbs: ln })).codigo).toMatch(/fonte_fora_das_raizes|nome_invalido/);
    expect(existsSync(dest())).toBe(false);
  });
  it("cópia: copia a pasta sem seguir symlink interno", async () => {
    symlinkSync("/etc", join(fonte, "interno"));
    const r = await instalar({ ...base(), modo: "copia" });
    expect(r.estado).toBe("instalado");
    expect(lstatSync(join(dest(), "minha-skill")).isDirectory()).toBe(true);
    expect(existsSync(join(dest(), "minha-skill", "interno"))).toBe(false);
  });
  it("falha no meio limpa o temporário (nunca deixa link quebrado)", async () => {
    const fs: FsInstalacao = { ...fsReal, rename: async () => { throw new Error("boom"); } };
    const r = await instalar({ ...base(), fs });
    expect(r.estado).toBe("erro");
    expect(readdirSync(dest())).toEqual([]);
  });
  it("Windows sem privilégio: junction; sem junction, cópia", async () => {
    const chamadas: string[] = [];
    const eperm = Object.assign(new Error("x"), { code: "EPERM" });
    const fs1: FsInstalacao = { ...fsReal, symlink: async (a, c, t) => { chamadas.push(String(t)); if (t === "dir") throw eperm; return fsReal.symlink(a, c, "dir"); } };
    expect((await instalar({ ...base(), fs: fs1, plataforma: "win32" })).metodo).toBe("symlink");
    expect(chamadas).toEqual(["dir", "junction"]);
    rmSync(join(dest(), "minha-skill"), { recursive: true, force: true });
    const fs2: FsInstalacao = { ...fsReal, symlink: async () => { throw eperm; } };
    expect((await instalar({ ...base(), fs: fs2, plataforma: "win32" })).metodo).toBe("copia");
    // em outras plataformas EPERM é erro
    rmSync(join(dest(), "minha-skill"), { recursive: true, force: true });
    expect((await instalar({ ...base(), fs: fs2, plataforma: "darwin" })).estado).toBe("erro");
  });
});

describe("desinstalar", () => {
  const pedido = (o: Partial<Parameters<typeof desinstalar>[0]> = {}): Parameters<typeof desinstalar>[0] => ({
    destinoAbs: join(dest(), "minha-skill"), raizDestinoAbs: dest(), modo: "remover_criado", criado_pelo_app: true, metodo: "symlink", hash_registrado: null, origem: "usuario", plugin: null, ...o,
  });
  it("remove o symlink que o app criou, nunca a fonte", async () => {
    await instalar(base());
    expect(await desinstalar(pedido())).toEqual({ ok: true, codigo: null });
    expect(existsSync(join(dest(), "minha-skill"))).toBe(false);
    expect(existsSync(join(fonte, "SKILL.md"))).toBe(true);
  });
  it("recusa: não criado pelo app, método, plugin; diretório real só pela lixeira", async () => {
    await instalar(base());
    expect((await desinstalar(pedido({ criado_pelo_app: false }))).codigo).toBe("nao_criado_pelo_app");
    expect((await desinstalar(pedido({ origem: "metodo" }))).codigo).toBe("gerenciado_pelo_metodo");
    expect((await desinstalar(pedido({ plugin: "p" }))).codigo).toBe("gerenciado_pelo_plugin");
    rmSync(join(dest(), "minha-skill"));
    mkdirSync(join(dest(), "minha-skill"));
    writeFileSync(join(dest(), "minha-skill", "SKILL.md"), "real");
    expect((await desinstalar(pedido())).ok).toBe(false);
    expect(existsSync(join(dest(), "minha-skill", "SKILL.md"))).toBe(true);
    const lixo: string[] = [];
    expect((await desinstalar(pedido({ modo: "lixeira", criado_pelo_app: false, lixeira: async (a) => void lixo.push(a) }))).ok).toBe(true);
    expect(lixo).toEqual([join(dest(), "minha-skill")]);
    expect((await desinstalar(pedido({ modo: "lixeira" }))).codigo).toBe("lixeira_indisponivel");
  });
  it("cópia criada pelo app: remove só se não foi editada", async () => {
    await instalar({ ...base(), modo: "copia" });
    const h = sha256(readFileSync(join(dest(), "minha-skill", "SKILL.md")));
    writeFileSync(join(dest(), "minha-skill", "SKILL.md"), "editei");
    expect((await desinstalar(pedido({ metodo: "copia", hash_registrado: h }))).codigo).toBe("editada_use_lixeira");
    writeFileSync(join(dest(), "minha-skill", "SKILL.md"), skillMd("minha-skill", "d"));
    expect((await desinstalar(pedido({ metodo: "copia", hash_registrado: h }))).ok).toBe(true);
  });
  it("destino fora da raiz ou a própria raiz é recusado", async () => {
    expect((await desinstalar(pedido({ destinoAbs: dest() }))).codigo).toBe("destino_invalido");
    expect((await desinstalar(pedido({ destinoAbs: join(raiz, "outro") }))).codigo).toBe("destino_invalido");
    void readlinkSync;
  });
});

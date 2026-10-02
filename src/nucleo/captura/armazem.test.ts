import { mkdtemp, readdir, readFile, rm, symlink, writeFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarArmazem, ErroCaptura, type Armazem } from "./armazem";

function pngFalso(l = 4, a = 3): Uint8Array {
  const png = new Uint8Array(40);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(png.buffer).setUint32(16, l);
  new DataView(png.buffer).setUint32(20, a);
  return png;
}

let raiz = "";
let lixo: string[] = [];
let tempo = new Date(2026, 9, 1, 10, 0, 0);
let arm: Armazem;

beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "armazem-cap-"));
  lixo = [];
  tempo = new Date(2026, 9, 1, 10, 0, 0);
  arm = criarArmazem({ pasta: join(raiz, ".expxv", "capturas"), raiz, pastaProduto: join(raiz, ".expxv"), lixeira: async (p) => void lixo.push(p), agora: () => tempo });
});
afterEach(async () => { await rm(raiz, { recursive: true, force: true }); });

describe("armazém de capturas", () => {
  it("salva com caminho relativo sob .expxv/capturas e .gitignore interno", async () => {
    const item = await arm.salvarImagem(pngFalso(), "png");
    expect(item.caminho).toBe(join(".expxv", "capturas", "2026-10-01_10-00-00.png"));
    expect(item).toMatchObject({ tipo: "imagem", largura: 4, altura: 3, anotada: false });
    expect(await readFile(join(raiz, ".expxv", "capturas", ".gitignore"), "utf8")).toBe("*\n");
    expect(await readFile(join(raiz, ".expxv", ".gitignore"), "utf8")).toBe("*\n");
  });

  it("duas capturas no mesmo segundo não colidem", async () => {
    const a = await arm.salvarImagem(pngFalso(), "png");
    const b = await arm.salvarImagem(pngFalso(), "png");
    expect(a.id).not.toBe(b.id);
    expect(b.id).toBe("2026-10-01_10-00-00-1");
  });

  it("edição preserva o original na primeira vez e não o toca depois", async () => {
    const a = await arm.salvarImagem(pngFalso(4, 3), "png");
    const original = await readFile(join(raiz, a.caminho));
    await arm.salvarEdicao(a.id, pngFalso(8, 6));
    await arm.salvarEdicao(a.id, pngFalso(9, 9));
    const orig = await readFile(join(raiz, ".expxv", "capturas", `${a.id}.orig.png`));
    expect(Buffer.compare(orig, original)).toBe(0);
    expect((await arm.obter(a.id)).anotada).toBe(true);
    expect((await arm.obter(a.id)).largura).toBe(9);
  });

  it("recusa id com ../, symlink e edição que não é PNG", async () => {
    await expect(arm.ler("../../etc/passwd")).rejects.toBeInstanceOf(ErroCaptura);
    await mkdir(join(raiz, ".expxv", "capturas"), { recursive: true });
    await writeFile(join(raiz, "alvo.png"), pngFalso());
    await symlink(join(raiz, "alvo.png"), join(raiz, ".expxv", "capturas", "2026-10-01_09-00-00.png"));
    await expect(arm.ler("2026-10-01_09-00-00")).rejects.toMatchObject({ codigo: "captura_inexistente" });
    const a = await arm.salvarImagem(pngFalso(), "png");
    await expect(arm.salvarEdicao(a.id, new Uint8Array(50))).rejects.toBeInstanceOf(ErroCaptura);
  });

  it("lista paginada por cursor, mais recente primeiro; 50 capturas nunca apagam nada sozinhas", async () => {
    for (let i = 0; i < 50; i++) { tempo = new Date(2026, 9, 1, 10, 0, i); await arm.salvarImagem(pngFalso(), "png"); }
    const antes = (await readdir(join(raiz, ".expxv", "capturas"))).sort();
    const p1 = await arm.listar(null, 20);
    expect(p1.itens).toHaveLength(20);
    expect(p1.itens[0]?.id).toBe("2026-10-01_10-00-49");
    expect(p1.proximo).not.toBeNull();
    const p2 = await arm.listar(p1.proximo, 40);
    expect(p2.itens).toHaveLength(30);
    expect(p2.proximo).toBeNull();
    expect((await readdir(join(raiz, ".expxv", "capturas"))).sort()).toEqual(antes);
  });

  it("remover vai para a lixeira (inclui o .orig) e sem lixeira recusa", async () => {
    const a = await arm.salvarImagem(pngFalso(), "png");
    await arm.salvarEdicao(a.id, pngFalso(5, 5));
    expect(await arm.remover(a.id)).toBe(true);
    expect(lixo).toHaveLength(2);
    const semLixeira = criarArmazem({ pasta: join(raiz, ".expxv", "capturas"), raiz });
    await expect(semLixeira.remover(a.id)).rejects.toBeInstanceOf(ErroCaptura);
  });

  it("quadros: pasta, ordem, meta e pasta vazia some sem deixar órfão", async () => {
    const q = await arm.iniciarQuadros(2);
    expect(q.id).toBe("q_2026-10-01_10-00-00");
    await arm.gravarQuadro(q.id, 1, pngFalso());
    await arm.gravarQuadro(q.id, 2, pngFalso());
    const item = await arm.finalizarQuadros(q.id, 2, 2);
    expect(item).toMatchObject({ tipo: "quadros", quadros: 2, fps: 2 });
    expect(item?.caminho).toBe(join(".expxv", "capturas", "quadros", "2026-10-01_10-00-00"));
    tempo = new Date(2026, 9, 1, 10, 0, 5);
    const vazio = await arm.iniciarQuadros(1);
    expect(await arm.finalizarQuadros(vazio.id, 0, 1)).toBeNull();
    await expect(stat(vazio.pasta)).rejects.toThrow();
    const lista = await arm.listar(null);
    expect(lista.itens.map((i) => i.id)).toEqual(["q_2026-10-01_10-00-00"]);
    await expect(arm.gravarQuadro(q.id, 121, pngFalso())).rejects.toBeInstanceOf(ErroCaptura);
  });

  it("disco sem escrita vira erro claro e não deixa arquivo pela metade", async () => {
    const somenteLeitura = criarArmazem({ pasta: join(raiz, "naoexiste", "\0ruim"), raiz });
    await expect(somenteLeitura.salvarImagem(pngFalso(), "png")).rejects.toMatchObject({ codigo: "disco_sem_escrita" });
    expect((await readdir(raiz)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });
});

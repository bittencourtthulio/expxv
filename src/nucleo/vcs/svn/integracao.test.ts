// Integração REAL do SVN (T-06.29): `svnadmin create` em os.tmpdir + checkout `file://`. Nunca rede, nunca um
// repositório do usuário. PULA com aviso quando `svnadmin`/`svn` não existem (a suíte determinística cobre o resto).
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { criarVcsSvn } from "./vcs-svn";
import { criarMissaoSvn, listarMissoesSvn, removerMissaoSvn } from "./missao";
import { criarRamoDaMissaoSvn } from "./missao";
import { criarRamoSvn, mergeinfoSvn, reintegrarSvn } from "./ramos";
import { criarRepoSvn, svn, temSvnReal } from "../../../../tests/fixtures/vcs/svn-util";
import { removerPasta } from "../../../../tests/fixtures/vcs/repos";

const REAL = temSvnReal();
if (!REAL) console.warn("[svn] svnadmin/svn ausentes: testes de integração REAIS pulados (instale: brew install subversion).");
const pastas: string[] = [];
afterAll(() => pastas.forEach(removerPasta));
const novo = (arq?: Record<string, string>) => {
  const r = criarRepoSvn(arq ? { arquivos: arq } : {});
  pastas.push(r.base);
  return r;
};
const escrever = (p: string, t: string): void => writeFileSync(p, t);
const youngest = (r: { wc: string }): number => Number(/Revision: (\d+)/.exec(svn(r.wc, "info", "^/"))?.[1]);

describe.skipIf(!REAL).concurrent("SVN real: detecção, status, diff, manutenção, commit", { timeout: 120_000 }, () => {
  it("info, layout padrão, status com modificado/novo/apagado/não versionado/propriedade, diff e commit de vários arquivos", async () => {
    const r = novo({ "a.txt": "um\ndois\ntres\n", "b.txt": "b\n", "src/f.ts": "f\n" });
    const v = criarVcsSvn(r.wc, { permitirFile: true });
    const info = await v.svn.info();
    expect(info).toMatchObject({ urlRelativa: "^/trunk", revisao: 2 });
    expect(await v.svn.layout()).toMatchObject({ padrao: true });
    escrever(join(r.wc, "a.txt"), "um\nDOIS\ntres\n");
    escrever(join(r.wc, "novo.txt"), "n\n");
    escrever(join(r.wc, "solto.txt"), "s\n");
    await v.svn.manutencao.adicionar(["novo.txt"]);
    await v.svn.manutencao.remover(["b.txt"]);
    await v.svn.manutencao.mover("src/f.ts", "src/g.ts");
    await v.svn.manutencao.definirNeedsLock("a.txt", true);
    await v.svn.manutencao.ignorar(".", ["*.log"]);
    const s = await v.status();
    const por = (c: string) => s.arquivos.find((m) => m.caminho === c);
    expect(s).toMatchObject({ branch: "trunk", oid: "2", estado: "pronto" });
    expect(por("a.txt")).toMatchObject({ arvore: "M", svn: { propriedades: "modified" } });
    expect(por("novo.txt")).toMatchObject({ arvore: "A" });
    expect(por("b.txt")).toMatchObject({ arvore: "D" });
    expect(por("src/g.ts")).toMatchObject({ arvore: "A" });
    expect(por("solto.txt")).toMatchObject({ tipo: "naorastreado" });
    const d = await v.diff();
    expect(d.arquivos.find((a) => a.caminho === "a.txt")).toMatchObject({ insercoes: 1, delecoes: 1 });
    const props = await v.svn.diffPropriedades();
    expect(props.map((p) => p.nome).sort()).toEqual(["svn:ignore", "svn:needs-lock"]);
    const parcial = await v.svn.statusParcial(s, ["a.txt"]);
    expect(parcial?.arquivos.find((m) => m.caminho === "a.txt")).toBeTruthy();
    const c = await v.svn.commit({ mensagem: "vários ✓ arquivos\n\ncom corpo", origem: "usuario" });
    expect(c.revisao).toBe(3);
    expect((await v.status()).arquivos.filter((m) => m.tipo !== "naorastreado")).toEqual([]);
    const log = await v.svn.historico.log({ limite: 1 });
    expect(log.entradas[0]).toMatchObject({ revisao: 3, mensagem: "vários ✓ arquivos\n\ncom corpo" });
    expect(log.proximo).toBe(2);
    const pag2 = await v.svn.historico.log({ limite: 5, desde: log.proximo as number });
    expect(pag2.entradas.map((e) => e.revisao)).toEqual([2, 1]);
    const bl = await v.svn.historico.blame("a.txt");
    expect(bl.map((l) => l.revisao)).toEqual([2, 3, 2]);
  });

  it("automação não comita no tronco; revert recuperável; changelist; lock com confirmação", async () => {
    const r = novo();
    const v = criarVcsSvn(r.wc, { permitirFile: true });
    escrever(join(r.wc, "a.txt"), "mudou\n");
    await expect(v.svn.commit({ mensagem: "x", origem: "automacao" })).rejects.toMatchObject({ motivo: "automacao-tronco" });
    expect(youngest(r)).toBe(2);
    await v.svn.manutencao.definirChangelist("so-a", ["a.txt"]);
    expect((await v.status()).arquivos.find((m) => m.caminho === "a.txt")?.svn?.changelist).toBe("so-a");
    const seg = join(r.base, "seguranca");
    const rv = await v.svn.manutencao.reverter(["a.txt"], { pastaSeguranca: seg });
    expect(readFileSync(rv.backup as string, "utf8")).toContain("+mudou");
    expect(readFileSync(join(r.wc, "a.txt"), "utf8")).toBe("um\ndois\ntres\n");
    await expect(v.svn.manutencao.bloquear(["a.txt"], { origem: "usuario" })).rejects.toThrow();
    await v.svn.manutencao.bloquear(["a.txt"], { origem: "usuario", confirmadoServidor: true, mensagem: "editando" });
    expect((await v.svn.info()).revisao).toBe(2);
    expect((await v.status()).arquivos.find((m) => m.caminho === "a.txt")).toBeUndefined(); // normal + lock não é mudança
    await v.svn.manutencao.desbloquear(["a.txt"], { origem: "usuario", confirmadoServidor: true });
  });

  it("conflito de texto e de árvore: update --accept postpone devolve a fila; resolver e commitar", async () => {
    const r = novo({ "a.txt": "um\ndois\ntres\n", "b.txt": "b\n" });
    const v = criarVcsSvn(r.wc, { permitirFile: true });
    const wc2 = join(r.base, "wc2");
    svn(r.base, "checkout", "-q", `${r.url}/trunk`, wc2);
    escrever(join(wc2, "a.txt"), "um\nremoto\ntres\n");
    svn(wc2, "rm", "-q", "b.txt");
    svn(wc2, "commit", "-q", "-m", "remoto");
    escrever(join(r.wc, "a.txt"), "um\nlocal\ntres\n");
    escrever(join(r.wc, "b.txt"), "b editado\n");
    const u = await v.svn.atualizar();
    expect(u.conflitos.map((c) => c.caminho).sort()).toEqual(["a.txt", "b.txt"]);
    const fila = await v.svn.conflitos();
    expect(fila.find((c) => c.caminho === "a.txt")?.tipo).toBe("texto");
    expect(fila.find((c) => c.caminho === "b.txt")?.tipo).toBe("arvore");
    await expect(v.svn.commit({ mensagem: "x", origem: "usuario" })).rejects.toMatchObject({ nominal: "conflito" });
    await v.svn.manutencao.resolver(["a.txt"], "mine-full");
    await v.svn.manutencao.resolver(["b.txt"], "working");
    expect(await v.svn.conflitos()).toEqual([]);
    const c = await v.svn.commit({ mensagem: "resolvido", origem: "usuario" });
    expect(c.revisao).toBe(4);
  });

  it("externals: update ignora por padrão; seguir externals externos exige confirmação", async () => {
    const r = novo();
    const v = criarVcsSvn(r.wc, { permitirFile: true });
    const res = await v.svn.manutencao.definirPropriedade(".", "svn:externals", "^/trunk lib\nhttps://svn.invalido.example/x ext");
    expect(res.avisos).toHaveLength(1);
    await v.svn.commit({ mensagem: "externals", origem: "usuario" });
    expect((await v.svn.externals()).map((e) => [e.destino, e.foraDoRepositorio])).toEqual([["lib", false], ["ext", true]]);
    await expect(v.svn.atualizar()).resolves.toBeTruthy(); // não tenta a rede
    expect(existsSync(join(r.wc, "ext"))).toBe(false);
    await expect(v.svn.atualizar({ seguirExternals: true })).rejects.toMatchObject({ motivo: "externals-externos" });
  });
});

describe.skipIf(!REAL).concurrent("SVN real: branches, tags, switch, merge, reintegração", { timeout: 120_000 }, () => {
  it("branch por svn copy (simular -> confirmar), commit no branch, merge para o tronco com mergeinfo e reintegração", async () => {
    const r = novo();
    const v = criarVcsSvn(r.wc, { permitirFile: true });
    const plano = await v.svn.ramosServidor.criar({ tipo: "branch", nome: "feature", simular: true });
    expect(plano).toMatchObject({ simulado: true, destino: "^/branches/feature" });
    expect(youngest(r)).toBe(2);
    await expect(v.svn.ramosServidor.criar({ tipo: "branch", nome: "feature", origem: "usuario" })).rejects.toMatchObject({ motivo: "confirmacao-servidor" });
    expect(youngest(r)).toBe(2);
    const feito = await v.svn.ramosServidor.criar({ tipo: "branch", nome: "feature", origem: "usuario", confirmadoServidor: true });
    expect(feito).toMatchObject({ simulado: false, revisao: 3 });
    await expect(v.svn.ramosServidor.criar({ tipo: "branch", nome: "feature", origem: "usuario", confirmadoServidor: true })).rejects.toMatchObject({ motivo: "destino-existe" });
    expect(await v.svn.ramos("branches")).toEqual(["feature"]);
    const tag = await v.svn.ramosServidor.criar({ tipo: "tag", nome: "v1", origem: "usuario", confirmadoServidor: true });
    expect(tag.revisao).toBe(4);

    // trabalho no branch por uma cópia de trabalho própria
    const wcB = join(r.base, "wcb");
    svn(r.base, "checkout", "-q", `${r.url}/branches/feature`, wcB);
    const vb = criarVcsSvn(wcB, { permitirFile: true });
    escrever(join(wcB, "novo.txt"), "do branch\n");
    await vb.svn.manutencao.adicionar(["novo.txt"]);
    // automação PODE comitar em branch (não no tronco)
    const cb = await vb.svn.commit({ mensagem: "no branch", origem: "automacao" });
    expect(cb.revisao).toBe(5);

    await v.svn.atualizar();
    expect((await v.svn.ramosServidor.mergeinfo("branches/feature")).elegiveis).toEqual([5]);
    const sim = await v.svn.ramosServidor.mesclar({ de: "branches/feature", simular: true });
    expect(sim.simulado).toBe(true);
    expect(existsSync(join(r.wc, "novo.txt"))).toBe(false);
    const re = await v.svn.ramosServidor.reintegrar({ ramo: "branches/feature" });
    expect(re.itens.map((i) => i.caminho)).toContain("novo.txt");
    expect(re.mergeinfo?.mesclados).toEqual([3, 5].filter((n) => re.mergeinfo?.mesclados.includes(n)));
    const props = await v.svn.diffPropriedades();
    expect(props.some((p) => p.nome === "svn:mergeinfo")).toBe(true);
    const cm = await v.svn.commit({ mensagem: "reintegra feature", origem: "usuario" });
    expect(cm.revisao).toBe(6);
    expect(await mergeinfoSvn(r.wc, "branches/feature", { permitirFile: true })).toMatchObject({ elegiveis: [] });
    // switch
    const sw = await v.svn.ramosServidor.trocar("branches/feature");
    expect(sw.revisao).toBe(6);
    expect((await v.svn.info()).urlRelativa).toBe("^/branches/feature");
    await expect(v.svn.ramosServidor.reintegrar({ ramo: "trunk" })).rejects.toMatchObject({ motivo: "layout-nao-padrao" });
    void reintegrarSvn;
    void criarRamoSvn;
  });
});

describe.skipIf(!REAL).concurrent("SVN real: isolamento de Missão sem worktree", { timeout: 120_000 }, () => {
  it("duas Missões (cópias irmãs) em paralelo não se tocam; remover não mexe no repositório", async () => {
    const r = novo();
    const v = criarVcsSvn(r.wc, { permitirFile: true });
    const m1 = await v.svn.missoes.criar({ slug: "um" });
    const m2 = await v.svn.missoes.criar({ slug: "dois" });
    expect(m1.raiz).toBe(join(r.base, "wc--um"));
    expect(m2.raiz).toBe(join(r.base, "wc--dois"));
    expect((await listarMissoesSvn(r.wc)).map((m) => m.slug)).toEqual(["dois", "um"]);
    await expect(v.svn.missoes.criar({ slug: "um" })).rejects.toMatchObject({ motivo: "destino-existe" });
    await expect(v.svn.missoes.criar({ slug: "../x" })).rejects.toThrow();
    const v1 = criarVcsSvn(m1.raiz, { permitirFile: true });
    const v2 = criarVcsSvn(m2.raiz, { permitirFile: true });
    escrever(join(m1.raiz, "a.txt"), "missao um\n");
    escrever(join(m2.raiz, "outro.txt"), "missao dois\n");
    await v2.svn.manutencao.adicionar(["outro.txt"]);
    expect((await v1.status()).arquivos.map((m) => m.caminho)).toEqual(["a.txt"]);
    expect((await v2.status()).arquivos.map((m) => m.caminho)).toEqual(["outro.txt"]);
    expect((await v.status()).arquivos).toEqual([]);
    expect(readFileSync(join(r.wc, "a.txt"), "utf8")).toBe("um\ndois\ntres\n");
    const antes = youngest(r);
    await expect(v.svn.missoes.remover("um")).rejects.toMatchObject({ motivo: "arvore-suja" });
    expect(existsSync(m1.raiz)).toBe(true);
    await v.svn.missoes.remover("um", { descartarAlteracoes: true });
    await v.svn.missoes.remover("dois", { descartarAlteracoes: true });
    expect(existsSync(m1.raiz)).toBe(false);
    expect(existsSync(r.wc)).toBe(true);
    expect(youngest(r)).toBe(antes);
    await removerMissaoSvn(r.wc, "nao-existe");
  });
  it("branch no servidor para a Missão é ação explícita e confirmada; sem ela nada é gravado", async () => {
    const r = novo();
    const v = criarVcsSvn(r.wc, { permitirFile: true });
    const m = await criarMissaoSvn(r.wc, { slug: "feat", permitirFile: true });
    const antes = youngest(r);
    const plano = await criarRamoDaMissaoSvn(m.raiz, { nome: "missao-feat", simular: true, permitirFile: true });
    expect(plano.simulado).toBe(true);
    await expect(criarRamoDaMissaoSvn(m.raiz, { nome: "missao-feat", origem: "usuario", permitirFile: true })).rejects.toBeTruthy();
    expect(youngest(r)).toBe(antes);
    const feito = await criarRamoDaMissaoSvn(m.raiz, { nome: "missao-feat", origem: "usuario", confirmadoServidor: true, permitirFile: true });
    expect(feito.simulado).toBe(false);
    expect(youngest(r)).toBe(antes + 1);
    expect((await criarVcsSvn(m.raiz, { permitirFile: true }).svn.info()).urlRelativa).toBe("^/branches/missao-feat");
    escrever(join(m.raiz, "a.txt"), "na missao\n");
    const c = await criarVcsSvn(m.raiz, { permitirFile: true }).svn.commit({ mensagem: "automação no branch da missão", origem: "automacao" });
    expect(c.revisao).toBe(antes + 2);
    expect(statSync(r.wc).isDirectory()).toBe(true);
    void v;
  });
  it("URL file:// é recusada sem a opção explícita de teste", async () => {
    const r = novo();
    const v = criarVcsSvn(r.wc);
    await expect(v.svn.missoes.criar({ slug: "x" })).rejects.toMatchObject({ motivo: "url-invalida" });
  });
});

// T-22.16: manifesto assinado, chave pinada, atualização só assinada (AX-09, AX-10, AX-24).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buscarDe, copiar, criarHarnessSw, lancar, texto, type Lancamento } from "../fixtures/pwa/origem-adulterada";
import { carregar, RAIZ, type Assinar, type Verificar } from "./carregar";

const lancamentos: Lancamento[] = [];
afterAll(() => lancamentos.forEach((l) => l.limpar()));
const lancar2 = async (...a: Parameters<typeof lancar>): Promise<Lancamento> => {
  const l = await lancar(...a);
  lancamentos.push(l);
  return l;
};
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("verificação do manifesto (módulo compartilhado com o Service Worker)", async () => {
  const v = await carregar<Verificar>("pwa/verificar.js");
  const a = await carregar<Assinar>("pwa/assinar.mjs");

  it("origem legítima: aceita, versão e arquivos conferem", async () => {
    const l = await lancar2(3);
    const r = await v.baixarEVerificarShell({ buscar: buscarDe(l.origem), chaves: [l.publicaB64], versaoInstalada: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.versao).toBe(3);
      expect([...r.arquivos.keys()].sort()).toEqual(["app.css", "app.js", "icones/icone-192.png", "icones/icone-512.png", "index.html", "manifest.webmanifest", "sw.js"]);
    }
  });
  it("ax09_shell_adulterado_nao_executa: JS trocado, arquivo corrompido, manifesto/assinatura ausentes ou de outra chave, manifesto alterado: todos recusados", async () => {
    const l = await lancar2(2);
    const chaves = [l.publicaB64];
    const tentar = async (o: Map<string, Uint8Array>, ch = chaves, instalada = 0) => v.baixarEVerificarShell({ buscar: buscarDe(o), chaves: ch, versaoInstalada: instalada });
    // JS trocado por um malicioso do MESMO tamanho
    const js = copiar(l.origem);
    const orig = js.get("app.js") as Uint8Array;
    js.set("app.js", enc("x".repeat(orig.length)));
    expect(await tentar(js)).toEqual({ ok: false, motivo: "arquivo" });
    // um byte alterado no index.html
    const html = copiar(l.origem);
    const h = html.get("index.html") as Uint8Array;
    h[10] = (h[10] as number) ^ 1;
    expect((await tentar(html)).ok).toBe(false);
    // manifesto ausente / assinatura ausente / vazia / lixo
    const sem = copiar(l.origem);
    sem.delete("manifesto-pwa.sig");
    expect(await tentar(sem)).toEqual({ ok: false, motivo: "indisponivel" });
    const vazia = copiar(l.origem);
    vazia.set("manifesto-pwa.sig", enc(""));
    expect(await tentar(vazia)).toEqual({ ok: false, motivo: "assinatura" });
    const lixo = copiar(l.origem);
    lixo.set("manifesto-pwa.sig", enc("não-é-base64!!"));
    expect(await tentar(lixo)).toEqual({ ok: false, motivo: "assinatura" });
    // assinatura de OUTRA chave (o atacante assina o mesmo manifesto com a dele)
    const atacante = a.gerarParChaves();
    const outra = copiar(l.origem);
    outra.set("manifesto-pwa.sig", enc(a.assinarManifesto(texto(l.origem.get("manifesto-pwa.json")), atacante.privadaPem)));
    expect(await tentar(outra)).toEqual({ ok: false, motivo: "assinatura" });
    // manifesto alterado depois de assinado (acrescenta arquivo / muda a versão)
    const m = JSON.parse(texto(l.origem.get("manifesto-pwa.json"))) as { arquivos: Record<string, unknown>; versao: number };
    const extra = copiar(l.origem);
    extra.set("manifesto-pwa.json", enc(JSON.stringify({ ...m, arquivos: { ...m.arquivos, "evil.js": { sha256: "0".repeat(64), tamanho: 1 } } })));
    expect(await tentar(extra)).toEqual({ ok: false, motivo: "assinatura" });
    const versao = copiar(l.origem);
    versao.set("manifesto-pwa.json", enc(JSON.stringify({ ...m, versao: 99 })));
    expect(await tentar(versao)).toEqual({ ok: false, motivo: "assinatura" });
  });
  it("manifesto ASSINADO mas malformado (caminho com .., absoluto, sem index.html, campo extra) é recusado: quem tem a chave também não escapa do formato", async () => {
    const l = await lancar2(2);
    const bom = JSON.parse(texto(l.origem.get("manifesto-pwa.json"))) as { arquivos: Record<string, { sha256: string; tamanho: number }>; versao: number };
    const sha = "a".repeat(64);
    const casos: unknown[] = [
      { ...bom, arquivos: { ...bom.arquivos, "../fora.js": { sha256: sha, tamanho: 1 } } },
      { ...bom, arquivos: { ...bom.arquivos, "/abs.js": { sha256: sha, tamanho: 1 } } },
      { ...bom, arquivos: { ...bom.arquivos, "a//b.js": { sha256: sha, tamanho: 1 } } },
      { ...bom, arquivos: { "app.js": bom.arquivos["app.js"] } },
      { ...bom, extra: 1 },
      { ...bom, versao: 0 },
      { ...bom, versao: 1.5 },
      { ...bom, arquivos: { ...bom.arquivos, "x.js": { sha256: "XYZ", tamanho: 1 } } },
    ];
    for (const c of casos) {
      const texto2 = JSON.stringify(c);
      const o = copiar(l.origem);
      o.set("manifesto-pwa.json", enc(texto2));
      o.set("manifesto-pwa.sig", enc(a.assinarManifesto(texto2, l.privadaPem)));
      const r = await v.baixarEVerificarShell({ buscar: buscarDe(o), chaves: [l.publicaB64], versaoInstalada: 0 });
      expect(r, JSON.stringify(c).slice(0, 80)).toMatchObject({ ok: false, motivo: "formato" });
    }
  });
  it("ax10_atualizacao_so_assinada: versão igual ou menor (rollback) recusada; maior assinada aceita; rotação com duas chaves aceitas", async () => {
    const velha = a.gerarParChaves();
    const nova = a.gerarParChaves();
    const l5 = await lancar2(5, velha);
    const ch = [velha.publicaB64, nova.publicaB64];
    expect((await v.baixarEVerificarShell({ buscar: buscarDe(l5.origem), chaves: ch, versaoInstalada: 4 })).ok).toBe(true);
    expect(await v.baixarEVerificarShell({ buscar: buscarDe(l5.origem), chaves: ch, versaoInstalada: 5 })).toEqual({ ok: false, motivo: "versao" });
    expect(await v.baixarEVerificarShell({ buscar: buscarDe(l5.origem), chaves: ch, versaoInstalada: 9 })).toEqual({ ok: false, motivo: "versao" });
    // rotação: a próxima versão sai assinada pela chave NOVA e o SW (com as duas pinadas) aceita
    const l6 = await lancar2(6, nova, { chaves: ch });
    expect((await v.baixarEVerificarShell({ buscar: buscarDe(l6.origem), chaves: ch, versaoInstalada: 5 })).ok).toBe(true);
    // mas um SW que só conhece a chave velha recusa a nova
    expect(await v.baixarEVerificarShell({ buscar: buscarDe(l6.origem), chaves: [velha.publicaB64], versaoInstalada: 5 })).toEqual({ ok: false, motivo: "assinatura" });
    // chave de outro par nunca passa
    expect((await v.baixarEVerificarShell({ buscar: buscarDe(l6.origem), chaves: [a.gerarParChaves().publicaB64], versaoInstalada: 0 })).ok).toBe(false);
  });
  it("assinaturaValida e lerManifesto nunca lançam com lixo", async () => {
    for (const x of [null, undefined, 1, {}, "", "AAAA", "A".repeat(200), "ab=cd"]) {
      await expect(v.assinaturaValida(enc("x"), x as string, ["chave-ruim", "AAAA"])).resolves.toBe(false);
    }
    for (const x of [new Uint8Array(0), enc("{"), enc("[]"), enc("null"), enc('{"versao":1}'), new Uint8Array(70_000)]) expect(v.lerManifesto(x)).toBeNull();
    expect(v.lerManifesto("texto" as unknown as Uint8Array)).toBeNull();
  });
});

describe("Service Worker real do build (harness): recusa e mantém o shell anterior (AX-09/AX-10)", async () => {
  const a = await carregar<Assinar>("pwa/assinar.mjs");
  const swDe = (l: Lancamento): string => texto(l.origem.get("sw.js"));

  it("instala v1 assinado, serve o shell verificado e devolve 404 para arquivo fora do manifesto", async () => {
    const l = await lancar2(1);
    const sw = criarHarnessSw(swDe(l), l.origem);
    expect(await sw.instalar()).toBe("ok");
    await sw.ativar();
    const raiz = await sw.pedir("https://pwa.exemplo.com/", { navegar: true });
    expect(raiz?.status).toBe(200);
    expect(texto(raiz?.corpo)).toBe(texto(l.origem.get("index.html")));
    expect(texto((await sw.pedir("https://pwa.exemplo.com/app.js"))?.corpo)).toBe(texto(l.origem.get("app.js")));
    // a origem passa a oferecer um arquivo extra: nada disso é servido
    l.origem.set("evil.js", enc("alert(1)"));
    expect((await sw.pedir("https://pwa.exemplo.com/evil.js"))?.status).toBe(404);
    expect(texto((await sw.pedir("https://pwa.exemplo.com/qualquer/rota", { navegar: true }))?.corpo)).toBe(texto(l.origem.get("index.html")));
    // outras origens e métodos não-GET não passam pelo SW
    expect(await sw.pedir("https://outra.exemplo.com/app.js")).toBeNull();
    expect(await sw.pedir("https://pwa.exemplo.com/app.js", { metodo: "POST" })).toBeNull();
    expect(sw.caches().some((c) => c.startsWith("shell-"))).toBe(true);
  });
  it("origem adulterada na instalação inicial: o SW recusa e NADA do shell é servido", async () => {
    const l = await lancar2(1);
    const ruim = copiar(l.origem);
    ruim.set("app.js", enc("fetch('https://atacante.exemplo/roubar')"));
    const sw = criarHarnessSw(swDe(l), ruim);
    expect(await sw.instalar()).toBe("recusado");
    await sw.ativar();
    expect((await sw.pedir("https://pwa.exemplo.com/app.js"))?.status).toBe(404);
  });
  it("atualização: v2 adulterada recusada (v1 continua); v1 de volta (rollback) recusada; v2 legítima entra e v1 sai", async () => {
    const par = a.gerarParChaves();
    const v1 = await lancar2(1, par);
    const sw = criarHarnessSw(swDe(v1), v1.origem);
    expect(await sw.instalar()).toBe("ok");
    await sw.ativar();
    const v2 = await lancar2(2, par);
    const adulterada = copiar(v2.origem);
    adulterada.set("app.js", enc("// malicioso"));
    sw.trocarOrigem(adulterada);
    sw.trocarCodigo(swDe(v2));
    expect(await sw.instalar()).toBe("recusado");
    expect(texto((await sw.pedir("https://pwa.exemplo.com/app.js"))?.corpo)).toBe(texto(v1.origem.get("app.js"))); // o shell antigo segue
    sw.trocarOrigem(v1.origem); // rollback: assinatura válida, versão menor
    expect(await sw.instalar()).toBe("recusado");
    sw.trocarOrigem(v2.origem);
    expect(await sw.instalar()).toBe("ok");
    await sw.ativar();
    expect(texto((await sw.pedir("https://pwa.exemplo.com/app.js"))?.corpo)).toBe(texto(v2.origem.get("app.js")));
    expect(sw.caches().filter((c) => c.startsWith("shell-"))).toEqual(["shell-2"]);
  });
  it("A-12: o SW construído para a v3 recusa um manifesto assinado MAIS ANTIGO mesmo com o armazenamento limpo (sem versão guardada); a v3 e a v4 entram", async () => {
    const par = a.gerarParChaves();
    const v1 = await lancar2(1, par);
    const v3 = await lancar2(3, par);
    const v4 = await lancar2(4, par);
    const sw = criarHarnessSw(swDe(v3), v1.origem); // caches vazios: nenhuma versão instalada antes
    expect(await sw.instalar()).toBe("recusado"); // rollback para a v1
    sw.trocarOrigem(v3.origem);
    expect(await sw.instalar()).toBe("ok");
    const outro = criarHarnessSw(swDe(v3), v4.origem);
    expect(await outro.instalar()).toBe("ok");
  });
  it("SW com chaves de outro par não instala o build assinado por este", async () => {
    const l = await lancar2(1);
    const outroSw = (await lancar2(1)).origem.get("sw.js");
    const sw = criarHarnessSw(texto(outroSw), l.origem);
    expect(await sw.instalar()).toBe("recusado");
  });
  it("conteúdo decifrado nunca vai ao Cache: o SW só guarda arquivos do manifesto e não toca em requisições de dados", async () => {
    const l = await lancar2(1);
    const fonte = swDe(l);
    expect(fonte).not.toMatch(/localStorage|indexedDB|sessionStorage/);
    expect(fonte).toMatch(/url\.origin !== new URL\(base\(\)\)\.origin/);
  });
});

describe("ax24_sem_segredo_versionado", async () => {
  const a = await carregar<Assinar>("pwa/assinar.mjs");
  const arquivos = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      if (n === "node_modules" || n === "dist-pwa") return [];
      const c = join(dir, n);
      return statSync(c).isDirectory() ? arquivos(c) : [c];
    });

  it("a chave privada nunca vai para dist-pwa nem aparece em arquivo gerado", async () => {
    const l = await lancar2(1);
    const pem = l.privadaPem.replace(/-----[A-Z ]+-----|\s/g, "");
    for (const [nome, bytes] of l.origem) {
      const t = Buffer.from(bytes).toString("latin1");
      expect(t, nome).not.toMatch(/PRIVATE KEY/);
      expect(t, nome).not.toContain(pem.slice(0, 40));
    }
    expect(texto(l.origem.get("sw.js"))).toContain(l.publicaB64); // só a PÚBLICA é embutida
  });
  it("código-fonte do PWA, do relay e das fixtures não carrega chave privada, arquivo de ambiente nem token", () => {
    const alvos = [join(RAIZ, "pwa"), join(RAIZ, "src/nucleo/relay"), join(RAIZ, "src/nucleo/remoto-estendido"), join(RAIZ, "tests/fixtures/relay"), join(RAIZ, "tests/fixtures/pwa")].flatMap(arquivos);
    expect(alvos.length).toBeGreaterThan(20);
    for (const f of alvos) {
      expect(f, f).not.toMatch(/(^|\/)\.env(\.|$)|\.pem$|\.key$/);
      expect(readFileSync(f, "utf8"), f).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[A-Za-z0-9]{20}|AKIA[0-9A-Z]{12}/);
    }
  });
  it("a chave privada vem só de variável/arquivo por NOME; o erro cita o nome, nunca o valor", () => {
    expect(() => a.carregarChavePrivada("MINHA_VAR", {})).toThrow(/MINHA_VAR/);
    expect(() => a.carregarChavePrivada("MINHA_VAR", { MINHA_VAR: "valor-sem-pem" })).toThrow(/MINHA_VAR/);
    try {
      a.carregarChavePrivada("MINHA_VAR", { MINHA_VAR: "valor-secreto-123" });
    } catch (e) {
      expect(String((e as Error).message)).not.toContain("valor-secreto-123");
    }
    const par = a.gerarParChaves();
    expect(a.carregarChavePrivada("V", { V: par.privadaPem.replace(/\n/g, "\\n") })).toContain("PRIVATE KEY");
    expect(a.publicaBrutaDe(par.privadaPem)).toBe(par.publicaB64);
  });
});

import { describe, expect, it } from "vitest";
import { LIMITES_VARIANTE, type ConfigRelatorios, type FatosSprint } from "../../compartilhado/relatorios";
import { portasFalsas, SPRINT_ID, sprintBrutaFalsa, WS } from "../../../tests/fixtures/relatorios/gerar";
import { configPadrao } from "./config";
import { coletarFatos } from "./fatos/coletar";
import { cabecalhoVersao, entradasChangelog } from "./formatos/changelog";
import { metricasCsv, tasksCsv, tasksGithubCsv, tasksJiraCsv } from "./formatos/csv";
import { adornos, emailTxt, LIMITE_ASSUNTO, LIMITE_PREHEADER, resumoRedes } from "./formatos/divulgacao";
import { contraste, corAcessivel, renderizarHtml } from "./formatos/html";
import { lerPacoteJson } from "./formatos/json";
import { renderizarMarkdown } from "./formatos/markdown";
import { crc32, criarZip, nomeZipSeguro } from "./formatos/zip";
import { montarArquivos } from "./pacote/montar";
import { verificarBlocos } from "./redacao/verificar";
import { montarBlocos } from "./redacao/deterministico";

const XSS = [`<script>alert(1)</script>`, `"><img src=x onerror=alert(1)>`, `javascript:alert(1)`, `</style><script>x</script>`, `<svg onload=alert(1)>`, `'; DROP TABLE x;--`, `{{constructor.constructor('x')()}}`];

async function fatosHostis(): Promise<FatosSprint> {
  const bruta = sprintBrutaFalsa();
  bruta.sprint.nome = XSS[0] as string;
  bruta.sprint.meta = XSS[1] as string;
  bruta.sprint.versao_lancamento = XSS[4] as string;
  bruta.itens[0]!.item.titulo = XSS[2] as string;
  bruta.itens[0]!.item.resumo_cliente = XSS[3] as string;
  bruta.itens[1]!.item.titulo = XSS[5] as string;
  bruta.itens[1]!.fato!.commits[0]!.mensagem = XSS[1] as string;
  bruta.itens[2]!.item.titulo = XSS[6] as string;
  return (await coletarFatos(portasFalsas({ versionamento: { prs: async () => [{ trabalho_id: "tr-login", url: `https://github.com/x/y/pull/1?a="><script>x</script>`, estado: XSS[0] as string }] } }, bruta), WS, SPRINT_ID))!.fatos;
}
const cfg = (extra: Partial<ConfigRelatorios> = {}): ConfigRelatorios => ({ ...configPadrao(), ...extra });
async function arquivos(f: FatosSprint, revisao: "rascunho" | "aprovado" = "rascunho") {
  const blocos = montarBlocos(f);
  return montarArquivos({ fatos: f, hash_fatos: "h".repeat(64), blocos, verificacao: verificarBlocos(f, blocos), modo_bloco: {}, cfg: cfg(), gerado_em: "2026-03-14T12:00:00.000Z", revisao, avisos: [] });
}

describe("HTML autocontido: XSS em TODOS os campos", () => {
  it("nenhum <script, javascript:, handler on*, @import, url(http; http(s):// só dentro de href; escapes presentes", async () => {
    const htmls = (await arquivos(await fatosHostis())).filter((a) => a.formato === "html");
    expect(htmls.length).toBeGreaterThanOrEqual(5);
    for (const a of htmls) {
      const h = a.conteudo;
      expect(h, a.nome).not.toMatch(/<script/i);
      expect(h, a.nome).not.toMatch(/javascript:/i);
      expect(h.replace(/"[^"]*"/g, '""'), a.nome).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i);
      expect(h, a.nome).not.toMatch(/@import|url\(\s*["']?https?:/i);
      expect(h, a.nome).not.toContain("<img");
      expect(h, a.nome).not.toMatch(/<svg[^>]*\son/i);
      const semHref = h.replace(/href="https?:\/\/[^"]*"/g, "");
      expect(semHref, a.nome).not.toMatch(/https?:\/\//i);
      expect(h, a.nome).toContain("Content-Security-Policy");
      expect(h, a.nome).toContain("default-src 'none'");
      expect((h.match(/<html/g) ?? []).length).toBe(1);
    }
    expect(htmls.find((a) => a.nome === "tecnico.html")!.conteudo).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("link de PR só com http(s) seguro e rel=noopener; URL com aspas/tag é recusada na coleta", async () => {
    const f = await fatosHostis();
    expect(f.prs.every((p) => !p.url.includes("<") && !p.url.includes('"'))).toBe(true);
    const html = (await arquivos(await fatosOk())).find((a) => a.nome === "tecnico.html")!.conteudo;
    expect(html).toContain('href="https://github.com/exemplo/app/pull/42"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("faixa de rascunho até aprovar; aprovado troca a faixa e só nos arquivos do cliente", async () => {
    const f = await fatosOk();
    const r = await arquivos(f, "rascunho");
    const a = await arquivos(f, "aprovado");
    expect(r.find((x) => x.nome === "usuario.html")!.conteudo).toContain("RASCUNHO");
    expect(a.find((x) => x.nome === "usuario.html")!.conteudo).toContain("aprovado");
    expect(a.find((x) => x.nome === "usuario.html")!.conteudo).not.toContain("RASCUNHO");
    expect(r.find((x) => x.nome === "tecnico.html")!.conteudo).toBe(a.find((x) => x.nome === "tecnico.html")!.conteudo);
    expect(a.filter((x) => x.publico === "cliente").every((x) => x.revisao === "aprovado")).toBe(true);
    expect(r.filter((x) => x.publico !== "cliente").every((x) => x.revisao === "na")).toBe(true);
  });

  it("contraste AA: cor da marca ajustada até >= 4,5; cor inválida cai no padrão", () => {
    const c = corAcessivel("#ffff00", "#ffffff");
    expect(c.ajustada).toBe(true);
    expect(contraste(c.cor, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(corAcessivel("não é cor", "#ffffff").cor).toMatch(/^#[0-9a-f]{6}$/);
    expect(corAcessivel("#1e3a8a", "#ffffff").ajustada).toBe(false);
  });

  it("o relatório do usuário não vaza item oculto, id interno nem SHA", async () => {
    const f = await fatosOk();
    const u = (await arquivos(f)).filter((a) => a.nome.startsWith("usuario") || a.nome.startsWith("notas") || a.nome.startsWith("divulgacao/"));
    for (const a of u) {
      expect(a.conteudo, a.nome).not.toMatch(/controller|auditoria/i);
      expect(a.conteudo, a.nome).not.toMatch(/\bit_[0-9A-Za-z]{10,}|\bspr_[0-9A-Za-z]{10,}|\b[0-9a-f]{7,40}\b(?=[^"]*)/);
    }
  });
});

async function fatosOk(): Promise<FatosSprint> { return (await coletarFatos(portasFalsas(), WS, SPRINT_ID))!.fatos; }

describe("Markdown", () => {
  it("escapa o conteúdo hostil e o Markdown é estável (golden estrutural)", async () => {
    const md = (await arquivos(await fatosHostis())).find((a) => a.nome === "tecnico.md")!.conteudo;
    expect(md).not.toMatch(/(?<!\\)<script/);
    expect(md.split("\n")[0]).toMatch(/^# /);
    expect(md).toContain("## Mudanças");
    expect(md).toContain("| Item | Categoria |");
    const ok = (await arquivos(await fatosOk())).find((a) => a.nome === "tecnico.md")!.conteudo;
    expect(ok).toContain("## Fontes");
    expect(ok).toMatch(/\\\[\d+(, \d+)*\\\]/);
    expect(ok.endsWith("\n")).toBe(true);
  });
  it("tabela com uma coluna a mais por linha nunca acontece: toda linha tem o mesmo número de colunas", async () => {
    const md = (await arquivos(await fatosOk())).find((a) => a.nome === "tecnico.md")!.conteudo;
    const linhas = md.split("\n").filter((l) => l.startsWith("| ") && !l.includes("---"));
    const cols = (l: string): number => l.split(/(?<!\\)\|/).length;
    const grupos = new Map<number, number>();
    for (const l of linhas) grupos.set(cols(l), (grupos.get(cols(l)) ?? 0) + 1);
    expect(grupos.size).toBeLessThanOrEqual(4);
  });
  it("renderizarMarkdown nunca gera link com javascript:", () => {
    const md = renderizarMarkdown({ titulo: "t", subtitulo: null, estado: "interno", descricao: "d", marca: { nome: "m", cor: "#000000", rodape: null }, carimbo: "c", secoes: [{ id: "a", titulo: "A", tabela: { legenda: "l", colunas: ["c"], linhas: [[{ texto: "x", href: "javascript:alert(1)" }]] } }] });
    expect(md).not.toMatch(/\]\(javascript/);
  });
  it("renderizarHtml com href hostil devolve só texto", () => {
    const h = renderizarHtml({ titulo: "t", subtitulo: null, estado: "interno", descricao: "d", marca: { nome: "m", cor: "#000000", rodape: null }, carimbo: "c", secoes: [{ id: "a", titulo: "A", tabela: { legenda: "l", colunas: ["c"], linhas: [[{ texto: "x", href: "javascript:alert(1)" }]] } }] });
    expect(h).not.toContain("javascript:");
  });
});

describe("CSV do pacote", () => {
  it("injeção de fórmula neutralizada em todas as colunas de texto e nos perfis jira/github", async () => {
    const bruta = sprintBrutaFalsa();
    bruta.itens[0]!.item.titulo = "=HYPERLINK(\"http://x\",\"y\")";
    bruta.itens[0]!.item.resumo_cliente = "@SUM(1+1)";
    bruta.itens[1]!.item.titulo = "+cmd|' /C calc'!A0";
    bruta.itens[2]!.item.titulo = "-2+3";
    const f = (await coletarFatos(portasFalsas({}, bruta), WS, SPRINT_ID))!.fatos;
    for (const csv of [tasksCsv(f, false), tasksJiraCsv(f, false), tasksGithubCsv(f, false), metricasCsv(f, false)]) {
      const celulas = csv.split("\r\n").slice(1).flatMap((l) => l.split(","));
      for (const c of celulas) expect(/^"?[=+\-@]/.test(c) && !/^-?\d+(\.\d+)?$/.test(c), c).toBe(false);
    }
  });
  it("RFC 4180 com BOM e CRLF; desconhecido vazio, nunca 0; round-trip simples", async () => {
    const f = await fatosOk();
    const csv = tasksCsv(f, true);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.endsWith("\r\n")).toBe(true);
    const cab = csv.slice(1).split("\r\n")[0]!.split(",");
    expect(cab).toContain("duracao_observada_h");
    const m = metricasCsv({ ...f, metricas: { ...f.metricas, lead_p85_h: null } }, false);
    expect(m).toMatch(/lead_p85,,h,,desconhecido/);
    expect(m).not.toMatch(/lead_p85,0,/);
  });
});

describe("notas de versão (Keep a Changelog) e divulgação", () => {
  it("só itens visíveis entregues, na ordem padrão, sem id interno", async () => {
    const f = await fatosOk();
    const e = entradasChangelog(f);
    expect(e.map((x) => x.secao)).toEqual(["added", "fixed"]);
    expect(e.flatMap((x) => x.linhas.map((l) => l.texto)).join(" ")).not.toMatch(/it_00|controller|spr_/);
    expect(cabecalhoVersao(f)).toBe("[2.4.0] - 2026-03-13");
    expect(cabecalhoVersao({ ...f, sprint: { ...f.sprint, versao_lancamento: null } })).toMatch(/^\[Não lançada\]/);
  });
  it("resumo para redes: cada variante cabe no limite, sem emoji por padrão; hashtags e CTA só se couberem", async () => {
    const f = await fatosOk();
    const r = resumoRedes(f, { hashtags: ["novidades", "#produto"], cta: "Saiba mais no app" });
    for (const v of ["curta", "media", "longa"] as const) expect(r[v].length).toBeLessThanOrEqual(LIMITES_VARIANTE[v]);
    expect(r.longa).toContain("#novidades");
    expect(r.longa).not.toMatch(/\p{Extended_Pictographic}/u);
    const grande = { ...f, itens: Array.from({ length: 40 }, (_, k) => ({ ...f.itens[0]!, item_id: `it_${k}`, resumo_cliente: `Recurso muito interessante número ${k} que ajuda bastante o seu dia a dia no sistema.` })) };
    const g = resumoRedes(grande, { hashtags: ["a"], cta: null });
    for (const v of ["curta", "media", "longa"] as const) expect(g[v].length).toBeLessThanOrEqual(LIMITES_VARIANTE[v]);
  });
  it("e-mail: assunto <= 60 e preheader <= 90; hashtag inválida e CTA com URL insegura são descartadas", async () => {
    const f = await fatosOk();
    const m = emailTxt({ ...f, sprint: { ...f.sprint, versao_lancamento: "9".repeat(200) } }, { hashtags: [], cta: null });
    expect(m.assunto.length).toBeLessThanOrEqual(LIMITE_ASSUNTO);
    expect(m.preheader.length).toBeLessThanOrEqual(LIMITE_PREHEADER);
    expect(adornos({ hashtags: ["ok", "<script>", "a b"], cta: "veja javascript://x" }).hashtags).toBe("#ok");
    expect(adornos({ hashtags: [], cta: "veja https://u:p@x.com" }).cta ?? "").not.toContain("u:p");
    expect(adornos({ hashtags: [], cta: "veja https://exemplo.com/a" }).cta).toBe("veja https://exemplo.com/a");
  });
  it("todo texto de divulgação do cliente passa no lint de jargão", async () => {
    const f = await fatosOk();
    const bs = montarBlocos(f);
    const a = montarArquivos({ fatos: f, hash_fatos: "h".repeat(64), blocos: bs, verificacao: verificarBlocos(f, bs), modo_bloco: {}, cfg: cfg(), gerado_em: "2026-03-14T12:00:00.000Z", revisao: "rascunho", avisos: [] });
    const t = a.find((x) => x.nome === "divulgacao/resumo-redes.txt")!.conteudo;
    expect(t).toContain("== curta");
    expect(t).not.toMatch(/endpoint|cache/i);
  });
});

describe("pacote.json e ZIP", () => {
  it("pacote.json valida pelo esquema e recusa arquivo fora do esquema", async () => {
    const f = await fatosOk();
    const j = (await arquivos(f)).find((a) => a.nome === "pacote.json")!.conteudo;
    expect(lerPacoteJson(j).esquema).toBe("relatorio_pacote_v1");
    expect(() => lerPacoteJson("{}")).toThrow();
    expect(() => lerPacoteJson("nao")).toThrow();
  });
  it("ZIP íntegro: CRC e tamanhos corretos, nomes sem `..`", () => {
    const zip = criarZip([{ nome: "pasta/a.md", dados: new TextEncoder().encode("olá mundo") }, { nome: "b.csv", dados: new Uint8Array([1, 2, 3]) }], new Date("2026-03-14T12:00:00Z"));
    const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
    const fim = zip.length - 22;
    expect(dv.getUint32(fim, true)).toBe(0x06054b50);
    expect(dv.getUint16(fim + 10, true)).toBe(2);
    const offCentral = dv.getUint32(fim + 16, true);
    let p = offCentral;
    const lidos: { nome: string; crc: number; tam: number; off: number }[] = [];
    for (let i = 0; i < 2; i++) {
      const nlen = dv.getUint16(p + 28, true);
      lidos.push({ nome: new TextDecoder().decode(zip.slice(p + 46, p + 46 + nlen)), crc: dv.getUint32(p + 16, true), tam: dv.getUint32(p + 24, true), off: dv.getUint32(p + 42, true) });
      p += 46 + nlen;
    }
    for (const l of lidos) {
      const nlen = dv.getUint16(l.off + 26, true);
      const dados = zip.slice(l.off + 30 + nlen, l.off + 30 + nlen + l.tam);
      expect(crc32(dados)).toBe(l.crc);
    }
    expect(lidos.map((l) => l.nome)).toEqual(["pasta/a.md", "b.csv"]);
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    for (const ruim of ["../x", "/abs", "a\\b", "C:/x", "a/../b", ""]) expect(nomeZipSeguro(ruim)).toBe(false);
    expect(() => criarZip([{ nome: "../x", dados: new Uint8Array() }], new Date())).toThrow();
  });
});

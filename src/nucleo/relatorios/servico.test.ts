// Pipeline fechar sprint -> pacote (T-19.22/23/25), exportação (T-19.21) e divulgação: sobre diretório temporário REAL e portas falsas. Sem rede, sem Electron.
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventoAgil } from "../../compartilhado/agil";
import { VERSAO_CONSENTIMENTO_ENVIO } from "../../compartilhado/relatorios";
import { portasFalsas, SPRINT_ID, sprintBrutaFalsa, T0, WS } from "../../../tests/fixtures/relatorios/gerar";
import { ErroRelatorio } from "./erros";
import { criarArmazenamento, fsReal, type FsRelatorios } from "./exportar/armazenamento";
import { criarRelatorios } from "./servico";
import type { PortasRelatorios } from "./portas";

let raiz: string;
let destino: string;
beforeEach(async () => { raiz = await mkdtemp(join(tmpdir(), "rel-ws-")); destino = await mkdtemp(join(tmpdir(), "rel-dest-")); });
afterEach(async () => { await rm(raiz, { recursive: true, force: true }); await rm(destino, { recursive: true, force: true }); });

function fsEspiao(): { fs: FsRelatorios; escritos: string[] } {
  const escritos: string[] = [];
  const fs: FsRelatorios = {
    ...fsReal,
    writeFile: (async (p: unknown, ...r: unknown[]) => { escritos.push(String(p)); return (fsReal.writeFile as (...a: unknown[]) => Promise<void>)(p, ...r); }) as FsRelatorios["writeFile"],
    mkdir: (async (p: unknown, ...r: unknown[]) => { escritos.push(String(p)); return (fsReal.mkdir as (...a: unknown[]) => Promise<unknown>)(p, ...r); }) as FsRelatorios["mkdir"],
    rename: (async (a: unknown, b: unknown) => { escritos.push(String(b)); return (fsReal.rename as (...x: unknown[]) => Promise<void>)(a, b); }) as FsRelatorios["rename"],
  };
  return { fs, escritos };
}

function montar(extra: Partial<PortasRelatorios> = {}, bruta = sprintBrutaFalsa()) {
  const { fs, escritos } = fsEspiao();
  const eventos: { tipo: string; payload: Record<string, unknown> }[] = [];
  let t = T0;
  const portas = portasFalsas({ workspace: { raiz: (ws) => (ws === WS ? raiz : null) }, eventos: { publicar: (tipo, payload) => void eventos.push({ tipo, payload }) }, ...extra }, bruta);
  const r = criarRelatorios({ portas, relogio: () => (t += 1000), armazenamento: criarArmazenamento({ raizDe: (ws) => portas.workspace.raiz(ws), fs }) });
  return { r, escritos, eventos, portas };
}
const esc = (p: string): string => p.replaceAll("\\", "/");

describe("gerar pacote", () => {
  it("gera o pacote local, em .expxv/relatorios/<sprint>/r1, com manifesto, e publica relatorio.pronto", async () => {
    const { r, eventos } = montar();
    const { pacote_id, reaproveitado } = await r.gerar(WS, { tipo: "sprint", sprint_id: SPRINT_ID });
    expect(reaproveitado).toBe(false);
    const d = await r.ler(WS, pacote_id);
    expect(d.estado).toBe("pronto");
    expect(d.versao).toBe(1);
    expect(d.pasta_ref).toBe(`.expxv/relatorios/${SPRINT_ID}/r1`);
    expect(d.revisao_usuario).toBe("rascunho");
    const nomes = d.arquivos.map((a) => a.nome);
    expect(nomes).toEqual(expect.arrayContaining(["tecnico.html", "tecnico.md", "usuario.html", "usuario.md", "executivo.md", "notas-de-versao.md", "tasks.csv", "tasks-jira.csv", "tasks-github.csv", "metricas.csv", "pacote.json", "divulgacao/novidades.html", "divulgacao/release-github.md", "divulgacao/resumo-redes.txt", "divulgacao/email.txt"]));
    const manifesto = JSON.parse(await readFile(join(raiz, d.pasta_ref, "manifesto.json"), "utf8")) as { arquivos: { nome: string; sha256: string }[]; esquema: string };
    expect(manifesto.esquema).toBe("relatorio_manifesto_v1");
    expect(manifesto.arquivos.map((a) => a.nome).sort()).toEqual([...nomes].sort());
    for (const a of d.arquivos) expect(manifesto.arquivos.find((m) => m.nome === a.nome)?.sha256).toBe(a.sha256);
    expect(eventos.map((e) => e.tipo)).toEqual(["relatorio.gerando", "relatorio.pronto"]);
    expect(eventos[1]?.payload).toMatchObject({ pontos_entregues: 8, itens: 3 });
  });

  it("ZERO escrita fora de .expxv/relatorios (nunca em docs/**)", async () => {
    const { r, escritos } = montar();
    await mkdir(join(raiz, "docs", "sprintx"), { recursive: true });
    await r.gerar(WS, { tipo: "sprint", sprint_id: SPRINT_ID });
    expect(escritos.length).toBeGreaterThan(10);
    for (const p of escritos) {
      const rel = esc(p).slice(esc(raiz).length + 1);
      expect(rel === ".expxv" || rel.startsWith(".expxv/relatorios"), rel).toBe(true);
      expect(rel.includes("docs/"), rel).toBe(false);
    }
    expect(await readdir(join(raiz, "docs", "sprintx"))).toEqual([]);
  });

  it("caminhos absolutos do usuário nunca aparecem nos artefatos", async () => {
    const { r } = montar();
    const { pacote_id } = await r.gerar(WS, { tipo: "sprint", sprint_id: SPRINT_ID });
    const d = await r.ler(WS, pacote_id);
    for (const a of d.arquivos) {
      const t = await readFile(join(raiz, d.pasta_ref, ...a.nome.split("/")), "utf8");
      expect(t, a.nome).not.toContain(raiz);
      expect(t, a.nome).not.toMatch(/\/Users\/|\/home\/|C:\\Users/);
    }
  });

  it("idempotente: mesmo conteúdo reaproveita; mudar um ajuste humano gera r2 e preserva r1", async () => {
    const { r } = montar();
    const a = await r.gerar(WS, { tipo: "sprint", sprint_id: SPRINT_ID });
    const b = await r.gerar(WS, { tipo: "sprint", sprint_id: SPRINT_ID });
    expect(b).toEqual({ pacote_id: a.pacote_id, reaproveitado: true });
    r.ajusteGravar(WS, SPRINT_ID, "u_em_resumo", "Resumo escrito pela equipe.");
    const c = await r.regenerar(WS, a.pacote_id);
    expect(c.reaproveitado).toBe(false);
    const d2 = await r.ler(WS, c.pacote_id);
    expect(d2.versao).toBe(2);
    expect(d2.blocos_usuario.find((x) => x.id === "u_em_resumo")).toMatchObject({ texto: "Resumo escrito pela equipe.", origem: "humano", ajustado: true });
    expect((await r.previa(WS, c.pacote_id, "usuario.md")).conteudo).toContain("Resumo escrito pela equipe.");
    expect((await r.previa(WS, a.pacote_id, "usuario.md")).conteudo).not.toContain("Resumo escrito pela equipe.");
    expect(r.listar(WS).map((p) => p.versao)).toEqual([2, 1]);
    r.ajusteGravar(WS, SPRINT_ID, "u_em_resumo", null);
    expect((await r.regenerar(WS, c.pacote_id)).pacote_id).toBe(a.pacote_id);
  });

  it("rN é imutável: gravar de novo a mesma pasta é recusado", async () => {
    const { r } = montar();
    const { pacote_id } = await r.gerar(WS, { tipo: "sprint", sprint_id: SPRINT_ID });
    const p = await r.ler(WS, pacote_id);
    await expect(r.armazenamento.gravarPacote(WS, p.pasta_ref, [{ nome: "x.md", conteudo: "x" }])).rejects.toThrow(/imutável/);
  });

  it("falha parcial vira pacote `falhou` com motivo limpo e evento; nada fica pela metade; a próxima tentativa funciona", async () => {
    let falhar = true;
    const { r, eventos } = montar();
    const orig = r.armazenamento.gravarPacote.bind(r.armazenamento);
    r.armazenamento.gravarPacote = async (...a) => { if (falhar) throw new Error(`disco cheio em ${raiz}/x token=abcdef123456`); return orig(...a); };
    const a = await r.gerar(WS, { tipo: "sprint", sprint_id: SPRINT_ID });
    const d = await r.ler(WS, a.pacote_id);
    expect(d.estado).toBe("falhou");
    expect(d.motivo_falha).not.toMatch(/abcdef123456/);
    expect(d.motivo_falha).not.toContain(raiz);
    expect(eventos.some((e) => e.tipo === "relatorio.falhou")).toBe(true);
    await expect(stat(join(raiz, d.pasta_ref))).rejects.toThrow();
    falhar = false;
    const b = await r.gerar(WS, { tipo: "sprint", sprint_id: SPRINT_ID });
    expect((await r.ler(WS, b.pacote_id)).estado).toBe("pronto");
  });

  it("sprint inexistente e workspace sem raiz dão erro nominal", async () => {
    const { r } = montar();
    await expect(r.gerar(WS, { tipo: "sprint", sprint_id: "spr_inexistente0000" })).rejects.toBeInstanceOf(ErroRelatorio);
    const { r: r2 } = montar({ workspace: { raiz: () => null } });
    const a = await r2.gerar(WS, { tipo: "sprint", sprint_id: SPRINT_ID });
    expect((await r2.ler(WS, a.pacote_id)).estado).toBe("falhou");
  });

  it("isolamento por workspace: id de pacote de outro workspace não é lido nem alterado", async () => {
    const { r } = montar();
    const a = await r.gerar(WS, { tipo: "sprint", sprint_id: SPRINT_ID });
    for (const f of [() => r.ler("ws_outro00000000", a.pacote_id), () => r.previa("ws_outro00000000", a.pacote_id, "tecnico.md"), () => r.aprovar("ws_outro00000000", a.pacote_id, true), () => r.exportar("ws_outro00000000", a.pacote_id, "todos", "pasta", async () => destino), () => r.divulgacao.enfileirar("ws_outro00000000", a.pacote_id, "telegram", "curta")]) {
      await expect(f()).rejects.toMatchObject({ code: "not_found" });
    }
    expect(() => r.ajusteGravar("ws_outro00000000", SPRINT_ID, "u_em_resumo", "x")).toThrow(/sem pacote/);
  });

  it("prévia: nome fora do pacote ou hostil é recusado; arquivo adulterado na pasta vem como integro=false", async () => {
    const { r } = montar();
    const { pacote_id } = await r.gerar(WS, { tipo: "sprint", sprint_id: SPRINT_ID });
    for (const n of ["../../etc/passwd", "/etc/passwd", "inexistente.md", "a/b/c.md"]) await expect(r.previa(WS, pacote_id, n)).rejects.toBeInstanceOf(ErroRelatorio);
    const p = await r.ler(WS, pacote_id);
    expect((await r.previa(WS, pacote_id, "tecnico.html")).integro).toBe(true);
    await writeFile(join(raiz, p.pasta_ref, "tecnico.html"), "<html>adulterado</html>");
    const adult = await r.previa(WS, pacote_id, "tecnico.html");
    expect(adult.integro).toBe(false);
    expect(adult.tipo).toBe("html");
  });
});

describe("gatilho de fechamento (sprint.fechada)", () => {
  const evento = (extra: Partial<EventoAgil> = {}): EventoAgil => ({ tipo: "sprint.fechada", workspace_id: WS, sprint_id: SPRINT_ID, trabalho_id: null, task_ref: null, pontos: 8, duracao_observada_ms: null, tokens: null, quando: "2026-03-13T18:00:00.000Z", dados: { versao_lancamento: "2.4.0" }, ...extra });

  it("fechar a sprint gera o pacote em modo template; gerar_ao_fechar=false não gera; outros eventos são ignorados", async () => {
    const { r } = montar();
    await r.aoFecharSprint({ ...evento(), tipo: "sprint.iniciada" });
    expect(r.listar(WS)).toHaveLength(0);
    r.configGravar(WS, { gerar_ao_fechar: false });
    await r.aoFecharSprint(evento());
    expect(r.listar(WS)).toHaveLength(0);
    r.configGravar(WS, { gerar_ao_fechar: true });
    await r.aoFecharSprint(evento());
    const l = r.listar(WS);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ estado: "pronto", modo_redacao: "template", versao_lancamento: "2.4.0" });
  });

  it("duas sprints fechadas seguidas enfileiram (fila serial por workspace) e o mesmo evento repetido não duplica", async () => {
    const bruta = sprintBrutaFalsa();
    const segunda = { ...bruta, sprint: { ...bruta.sprint, id: "spr_0000000000BBBB", nome: "Sprint 13" } };
    const portas = portasFalsas({ workspace: { raiz: () => raiz } }, bruta);
    portas.agil = { sprint: async (_w, s) => (s === bruta.sprint.id ? bruta : s === segunda.sprint.id ? segunda : null), sprintsFechadas: async () => [] };
    const r = criarRelatorios({ portas, relogio: () => T0 });
    await Promise.all([r.aoFecharSprint(evento()), r.aoFecharSprint(evento({ sprint_id: "spr_0000000000BBBB" })), r.aoFecharSprint(evento())]);
    expect(r.listar(WS).map((p) => p.sprint_id).sort()).toEqual([SPRINT_ID, "spr_0000000000BBBB"]);
  });

  it("narrativa por IA: só com consentimento e modo != template; vira versão nova DEPOIS; sem aceite não cria versão", async () => {
    const resposta = JSON.stringify({ afirmacoes: [{ texto: "Nesta etapa entregamos 1 novidade e 1 correção.", fontes: [`sprint:${SPRINT_ID}`] }] });
    const chamadas: string[] = [];
    const ia: Partial<PortasRelatorios> = {
      perfil: { resolver: async () => ({ cli: "claude", modelo: null, faixa: "rapido" }) },
      headless: { executar: async (p) => { chamadas.push(p.entrada); return { texto: chamadas.length === 1 ? resposta : "lixo", tokens: 10 }; } },
    };
    const { r } = montar(ia);
    r.configGravar(WS, { redacao_modo: "auto" });
    await r.aoFecharSprint(evento());
    expect(chamadas).toHaveLength(0); // sem consentimento
    expect(r.listar(WS).map((p) => p.modo_redacao)).toEqual(["template"]);
    r.consentimentoLlm(WS, true);
    await r.aoFecharSprint({ ...evento(), sprint_id: SPRINT_ID });
    const l = r.listar(WS);
    expect(chamadas.length).toBeGreaterThan(0);
    expect(l.map((p) => p.modo_redacao)).toContain("misto");
    expect(l.length).toBe(2);
    expect((await r.previa(WS, l[0]!.id, "usuario.md")).conteudo).toContain("Nesta etapa entregamos 1 novidade e 1 correção");
  });
});

describe("aprovação humana do texto do cliente", () => {
  it("não aprova com jargão/cobertura reprovados; depois de corrigir (ajuste humano limpo) aprova, troca a faixa e mantém integridade", async () => {
    const { r } = montar();
    const a = await r.gerar(WS, { tipo: "sprint", sprint_id: SPRINT_ID });
    const d = await r.ler(WS, a.pacote_id);
    expect(d.blocos_usuario.find((b) => b.id === "u_correcoes")?.precisa_revisao).toBe(true);
    r.ajusteGravar(WS, SPRINT_ID, "u_correcoes", "Corrigimos uma falha que atrasava a lista de pedidos.");
    const b = await r.regenerar(WS, a.pacote_id);
    const aprovado = await r.aprovar(WS, b.pacote_id, true);
    expect(aprovado.revisao_usuario).toBe("aprovado");
    expect(aprovado.aprovado_em).not.toBeNull();
    const html = await r.previa(WS, b.pacote_id, "usuario.html");
    expect(html.integro).toBe(true);
    expect(html.conteudo).not.toContain("RASCUNHO");
    const det = await r.ler(WS, b.pacote_id);
    expect(det.arquivos.filter((x) => x.publico === "cliente").every((x) => x.revisao === "aprovado")).toBe(true);
    expect((await r.previa(WS, b.pacote_id, "tecnico.html")).conteudo).toContain("Relatório técnico");
    const desfeito = await r.aprovar(WS, b.pacote_id, false);
    expect(desfeito.revisao_usuario).toBe("rascunho");
    expect((await r.previa(WS, b.pacote_id, "usuario.html")).conteudo).toContain("RASCUNHO");
  });

  it("jargão humano no relatório do cliente bloqueia a aprovação", async () => {
    const { r } = montar();
    const a = await r.gerar(WS, { tipo: "sprint", sprint_id: SPRINT_ID });
    r.ajusteGravar(WS, SPRINT_ID, "u_correcoes", "Corrigimos o endpoint da API de pedidos.");
    const b = await r.regenerar(WS, a.pacote_id);
    await expect(r.aprovar(WS, b.pacote_id, true)).rejects.toThrow(/problema/);
    expect((await r.ler(WS, b.pacote_id)).revisao_usuario).toBe("rascunho");
  });

  it("só pacote pronto pode ser aprovado", async () => {
    const { r } = montar({ workspace: { raiz: () => null } });
    const a = await r.gerar(WS, { tipo: "sprint", sprint_id: SPRINT_ID });
    await expect(r.aprovar(WS, a.pacote_id, true)).rejects.toThrow(/pronto/);
  });
});

describe("endurecimentos da auditoria (Fase 19)", () => {
  it("A-01: aprovar depois de mudar a config (CSV sem BOM) mantém disco, manifesto e registro coerentes; a exportação continua possível", async () => {
    const { r } = montar();
    const a = await r.gerar(WS, { tipo: "sprint", sprint_id: SPRINT_ID });
    r.ajusteGravar(WS, SPRINT_ID, "u_correcoes", "Corrigimos uma falha que atrasava a lista de pedidos.");
    const b = await r.regenerar(WS, a.pacote_id);
    r.configGravar(WS, { csv_bom: false, hashtags: ["novidades"] });
    await r.aprovar(WS, b.pacote_id, true);
    const d = await r.ler(WS, b.pacote_id);
    const manifesto = JSON.parse(await readFile(join(raiz, d.pasta_ref, "manifesto.json"), "utf8")) as { arquivos: { nome: string; sha256: string }[] };
    for (const arq of d.arquivos) {
      expect((await r.previa(WS, b.pacote_id, arq.nome)).integro, arq.nome).toBe(true);
      expect(manifesto.arquivos.find((m) => m.nome === arq.nome)?.sha256, arq.nome).toBe(arq.sha256);
    }
    const res = await r.exportar(WS, b.pacote_id, "todos", "pasta", async () => destino);
    expect(res.cancelado).toBe(false);
  });

  it("A-02: texto da IA com marcação/script é só texto: sai ESCAPADO em todo HTML e Markdown", async () => {
    const mal = JSON.stringify({ afirmacoes: [{ texto: "Nesta etapa entregamos 1 novidade <script>alert(1)</script> **x** [a](javascript:alert(1)).", fontes: [`sprint:${SPRINT_ID}`] }] });
    const { r } = montar({ perfil: { resolver: async () => ({ cli: "claude", modelo: null, faixa: "rapido" }) }, headless: { executar: async () => ({ texto: mal, tokens: null }) } });
    r.configGravar(WS, { redacao_modo: "llm" });
    r.consentimentoLlm(WS, true);
    const { pacote_id } = await r.gerar(WS, { tipo: "sprint", sprint_id: SPRINT_ID });
    const d = await r.ler(WS, pacote_id);
    expect(d.modo_redacao).toBe("misto");
    for (const n of ["usuario.html", "divulgacao/novidades.html"]) {
      const h = (await r.previa(WS, pacote_id, n)).conteudo;
      expect(h, n).not.toMatch(/<script/i);
      expect(h, n).not.toMatch(/javascript:/i);
    }
    expect((await r.previa(WS, pacote_id, "usuario.md")).conteudo).not.toMatch(/(?<!\\)<script|\]\(javascript/);
  });

  it("A-03: arquivo do pacote trocado por atalho (symlink) NUNCA é lido, nem em subpasta", async () => {
    const { r } = montar();
    const { pacote_id } = await r.gerar(WS, { tipo: "sprint", sprint_id: SPRINT_ID });
    const p = await r.ler(WS, pacote_id);
    const alvo = join(destino, "segredo.txt");
    await writeFile(alvo, "SEGREDO");
    await rm(join(raiz, p.pasta_ref, "tasks.csv"));
    await symlink(alvo, join(raiz, p.pasta_ref, "tasks.csv"));
    await expect(r.previa(WS, pacote_id, "tasks.csv")).rejects.toThrow(/inválido/);
    await rm(join(raiz, p.pasta_ref, "divulgacao"), { recursive: true });
    await symlink(destino, join(raiz, p.pasta_ref, "divulgacao"));
    await expect(r.previa(WS, pacote_id, "divulgacao/email.txt")).rejects.toThrow(/inválido/);
    await expect(r.exportar(WS, pacote_id, ["tasks.csv"], "pasta", async () => destino)).rejects.toThrow();
  });

  it("A-04: fechar a sprint NUNCA envia nada a canal externo (nem com consentimento e canal pronto)", async () => {
    const enviar = vi.fn(async () => ({ ok: true, erro: null as string | null }));
    const { r } = montar({ canais: { disponiveis: async () => ["telegram"], enviar } });
    await r.divulgacao.consentimento(WS, "telegram", true);
    await r.aoFecharSprint({ tipo: "sprint.fechada", workspace_id: WS, sprint_id: SPRINT_ID, trabalho_id: null, task_ref: null, pontos: 8, duracao_observada_ms: null, tokens: null, quando: "t", dados: {} });
    expect(r.listar(WS)).toHaveLength(1);
    expect(enviar).not.toHaveBeenCalled();
  });
});

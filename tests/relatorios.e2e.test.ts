// E2E dos relatórios de entrega (Fase 19, T-19.41) no Electron real. ESCRITO e type-checado; NÃO executado nesta onda: rodar exige `npm run build` (e o `dist/` está em uso pelo
// `npm run dev` do dono). Os testes de núcleo, de main e de renderer (jsdom) cobrem a mesma lógica.
//   1) abrir Relatórios pela navegação: tela lazy, uma linha de controles, 4 abas; sem sprint fechada o estado vazio explica o próximo passo
//   2) fechar uma sprint (Fase 18) gera o pacote SOZINHO, em modo template, dentro de `.expxv/relatorios/` do projeto — e NADA em `docs/**`
//   3) a prévia do HTML é um iframe com `sandbox` vazio (sem scripts); aprovar o texto do cliente troca a faixa de rascunho
//   4) editar um bloco do texto do cliente e regenerar cria a versão r2 e preserva a r1
//   5) exportar para uma pasta (diálogo do SO simulado) e em ZIP; destino em `docs/` é recusado; zero diálogo de confirmação
//   6) divulgação: nada é enviado sem consentimento; sem canal configurado o envio fica bloqueado
//   7) nenhum canal `relatorios:*` aceita caminho, nome hostil, workspace alheio nem payload extra
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarAmbienteOrq, type AmbienteOrq } from "./fixtures/mcp/ambiente-orq";
import { dialogosChamados, vigiarDialogos } from "./terminais-ui-ajuda";

interface Pacote { id: string; estado: string; versao: number; revisao_usuario: string; pasta_ref: string; modo_redacao: string }
interface JanelaRel {
  ade: {
    agil: {
      itemCriar(ws: string, i: { titulo: string; descricao?: string | null }): Promise<{ id: string }>;
      itemAtualizar(ws: string, id: string, c: { visibilidade_cliente?: "sim"; resumo_cliente?: string }): Promise<unknown>;
      sprintCriar(ws: string, s: { nome: string; inicio: string; fim: string }): Promise<{ id: string }>;
      sprintItemMover(ws: string, s: string, i: string, a: "adicionar" | "remover"): Promise<unknown>;
      sprintIniciar(ws: string, s: string): Promise<unknown>;
      sprintFechar(ws: string, s: string, d: "backlog" | "proxima" | "descartar", versao?: string | null): Promise<unknown>;
    };
    relatorios: {
      sprints(ws: string): Promise<{ id: string; nome: string }[]>;
      listar(ws: string): Promise<Pacote[]>;
      ler(ws: string, id: string): Promise<Pacote & { arquivos: { nome: string; publico: string }[]; blocos_usuario: { id: string; texto: string }[] }>;
      previa(ws: string, id: string, nome: string): Promise<{ conteudo: string; tipo: string; integro: boolean }>;
      aprovar(ws: string, id: string, v: boolean): Promise<Pacote>;
      ajusteGravar(ws: string, sprint: string, bloco: string, texto: string | null): Promise<unknown>;
      regenerar(ws: string, id: string): Promise<{ pacote_id: string }>;
      exportar(ws: string, id: string, nomes: string[] | "todos", modo: "pasta" | "zip"): Promise<{ cancelado: boolean; destino_rotulo: string | null; arquivos: string[] }>;
      divulgacaoEstado(ws: string): Promise<{ canal: string; disponivel: boolean; consentido: boolean }[]>;
      divulgacaoEnfileirar(ws: string, id: string, canal: "telegram", v: "curta"): Promise<{ id: string; estado: string }>;
      divulgacaoEnviar(ws: string, envio: string): Promise<unknown>;
    };
  };
}

let amb: AmbienteOrq;
let pasta: string;
beforeAll(async () => {
  amb = await criarAmbienteOrq({ cli: "cli-agente.mjs" });
  pasta = mkdtempSync(join(tmpdir(), "rel-e2e-dest-"));
  await vigiarDialogos(amb.app);
}, 120_000);
afterAll(async () => { await amb?.fechar(); });

const pagina = () => amb.app.pagina;
const ev = <T, A>(fn: (w: JanelaRel, a: A) => Promise<T>, a: A): Promise<T> => pagina().evaluate(`(${fn.toString()})(window, ${JSON.stringify(a)})`) as Promise<T>;
const esperarPacote = async (): Promise<Pacote> => {
  for (let i = 0; i < 100; i++) {
    const l = await ev((w, ws: string) => w.ade.relatorios.listar(ws), amb.wsId);
    const p = l.find((x) => x.estado === "pronto");
    if (p !== undefined) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("o pacote não ficou pronto");
};

describe("relatórios de entrega no Electron real", () => {
  it("abre pela navegação com uma linha de controles e as 4 abas; sem sprint fechada o vazio explica o próximo passo", async () => {
    await pagina().locator('nav[aria-label="Principal"] button', { hasText: "Relatórios" }).click();
    await pagina().mouse.move(900, 500);
    await pagina().waitForSelector("[data-tela-relatorios]", { timeout: 15_000 });
    expect(await pagina().locator('[data-tela-relatorios] [role="tab"]').allTextContents()).toEqual(["Pacotes", "Revisão", "Divulgação", "Config"]);
    expect(await pagina().locator('[data-tela-relatorios] [role="toolbar"]').count()).toBe(1);
    await pagina().getByText("Nenhum pacote ainda").waitFor();
  });

  it("fechar a sprint gera o pacote sozinho em .expxv/relatorios do projeto, e nada em docs/", async () => {
    const ws = amb.wsId;
    const a = await ev((w, x: { ws: string }) => w.ade.agil.itemCriar(x.ws, { titulo: "Login com conta da empresa" }), { ws });
    await ev((w, x: { ws: string; id: string }) => w.ade.agil.itemAtualizar(x.ws, x.id, { visibilidade_cliente: "sim", resumo_cliente: "Agora você entra com a conta da sua empresa." }), { ws, id: a.id });
    const hoje = new Date().toISOString().slice(0, 10);
    const fim = new Date(Date.now() + 12 * 86_400_000).toISOString().slice(0, 10);
    const s = await ev((w, x: { ws: string; hoje: string; fim: string }) => w.ade.agil.sprintCriar(x.ws, { nome: "Sprint e2e", inicio: x.hoje, fim: x.fim }), { ws, hoje, fim });
    await ev((w, x: { ws: string; s: string; i: string }) => w.ade.agil.sprintItemMover(x.ws, x.s, x.i, "adicionar"), { ws, s: s.id, i: a.id });
    await ev((w, x: { ws: string; s: string }) => w.ade.agil.sprintIniciar(x.ws, x.s), { ws, s: s.id });
    await ev((w, x: { ws: string; s: string }) => w.ade.agil.sprintFechar(x.ws, x.s, "backlog", "1.0.0"), { ws, s: s.id });
    const p = await esperarPacote();
    expect(p.modo_redacao).toBe("template");
    expect(p.pasta_ref).toBe(`.expxv/relatorios/${s.id}/r1`);
    expect(existsSync(join(amb.raiz, p.pasta_ref, "manifesto.json"))).toBe(true);
    expect(existsSync(join(amb.raiz, p.pasta_ref, "tecnico.html"))).toBe(true);
    expect(existsSync(join(amb.raiz, "docs", "relatorios"))).toBe(false);
    const sprints = await ev((w, x: { ws: string }) => w.ade.relatorios.sprints(x.ws), { ws });
    expect(sprints.map((x) => x.id)).toContain(s.id);
    for (const nome of readdirSync(join(amb.raiz, p.pasta_ref))) expect(statSync(join(amb.raiz, p.pasta_ref, nome)).isSymbolicLink()).toBe(false);
  });

  it("prévia em iframe com sandbox vazio; aprovar troca a faixa de rascunho", async () => {
    const p = await esperarPacote();
    await pagina().locator('[data-tela-relatorios] [role="tab"]', { hasText: "Pacotes" }).click();
    const quadro = pagina().locator("iframe[title^='Prévia']");
    await quadro.waitFor({ timeout: 15_000 });
    expect(await quadro.getAttribute("sandbox")).toBe("");
    const antes = await ev((w, x: { ws: string; id: string }) => w.ade.relatorios.previa(x.ws, x.id, "usuario.html"), { ws: amb.wsId, id: p.id });
    expect(antes.conteudo).toContain("RASCUNHO");
    expect(antes.conteudo).not.toMatch(/<script/i);
    await pagina().getByRole("button", { name: "Aprovar texto do cliente" }).click();
    await pagina().getByRole("button", { name: "Desfazer aprovação" }).waitFor();
    const depois = await ev((w, x: { ws: string; id: string }) => w.ade.relatorios.previa(x.ws, x.id, "usuario.html"), { ws: amb.wsId, id: p.id });
    expect(depois.conteudo).not.toContain("RASCUNHO");
    expect(depois.integro).toBe(true);
  });

  it("editar um bloco e regenerar cria o r2 e preserva o r1", async () => {
    const p = await esperarPacote();
    await ev((w, x: { ws: string; s: string }) => w.ade.relatorios.ajusteGravar(x.ws, x.s, "u_em_resumo", "Resumo escrito pela equipe."), { ws: amb.wsId, s: p.pasta_ref.split("/")[2] as string });
    const r2 = await ev((w, x: { ws: string; id: string }) => w.ade.relatorios.regenerar(x.ws, x.id), { ws: amb.wsId, id: p.id });
    const lista = await ev((w, x: { ws: string }) => w.ade.relatorios.listar(x.ws), { ws: amb.wsId });
    expect(lista.map((x) => x.versao).sort()).toEqual([1, 2]);
    expect((await ev((w, x: { ws: string; id: string }) => w.ade.relatorios.previa(x.ws, x.id, "usuario.md"), { ws: amb.wsId, id: r2.pacote_id })).conteudo).toContain("Resumo escrito pela equipe.");
    expect((await ev((w, x: { ws: string; id: string }) => w.ade.relatorios.previa(x.ws, x.id, "usuario.md"), { ws: amb.wsId, id: p.id })).conteudo).not.toContain("Resumo escrito pela equipe.");
  });

  it("exporta para a pasta escolhida no diálogo (simulado) e em ZIP; destino em docs/ é recusado", async () => {
    const p = (await ev((w, x: { ws: string }) => w.ade.relatorios.listar(x.ws), { ws: amb.wsId })).find((x) => x.versao === 1) as Pacote;
    await amb.app.app.evaluate(({ dialog }, escolhida) => {
      (dialog as unknown as Record<string, unknown>)["showOpenDialog"] = () => Promise.resolve({ canceled: false, filePaths: [escolhida] });
    }, pasta);
    const r = await ev((w, x: { ws: string; id: string }) => w.ade.relatorios.exportar(x.ws, x.id, ["tecnico.md", "tasks.csv"], "pasta"), { ws: amb.wsId, id: p.id });
    expect(r.cancelado).toBe(false);
    expect(r.destino_rotulo).not.toContain(pasta);
    const z = await ev((w, x: { ws: string; id: string }) => w.ade.relatorios.exportar(x.ws, x.id, "todos", "zip"), { ws: amb.wsId, id: p.id });
    expect(z.arquivos).toContain("manifesto.json");
    expect(readdirSync(pasta).some((n) => n.endsWith(".zip"))).toBe(true);
    expect(readFileSync(join(pasta, readdirSync(pasta).find((n) => n.endsWith(".zip")) as string)).subarray(0, 4).toString("hex")).toBe("504b0304");
    const docs = join(amb.raiz, "docs");
    mkdirSync(docs, { recursive: true });
    await amb.app.app.evaluate(({ dialog }, escolhida) => {
      (dialog as unknown as Record<string, unknown>)["showOpenDialog"] = () => Promise.resolve({ canceled: false, filePaths: [escolhida] });
    }, docs);
    const recusou = await pagina().evaluate(([ws, id]) => (window as unknown as JanelaRel).ade.relatorios.exportar(ws as string, id as string, "todos", "pasta").then(() => "aceitou", (e: Error) => e.message), [amb.wsId, p.id]);
    expect(recusou).toMatch(/docs/);
    expect(readdirSync(docs)).toEqual([]);
  });

  it("divulgação: sem consentimento e sem canal configurado nada é enviado", async () => {
    const p = await esperarPacote();
    const estado = await ev((w, x: { ws: string }) => w.ade.relatorios.divulgacaoEstado(x.ws), { ws: amb.wsId });
    expect(estado[0]).toMatchObject({ canal: "telegram", consentido: false });
    const e = await ev((w, x: { ws: string; id: string }) => w.ade.relatorios.divulgacaoEnfileirar(x.ws, x.id, "telegram", "curta"), { ws: amb.wsId, id: p.id });
    expect(e.estado).toBe("rascunho");
    const r = await pagina().evaluate(([ws, id]) => (window as unknown as JanelaRel).ade.relatorios.divulgacaoEnviar(ws as string, id as string).then(() => "enviou", () => "recusou"), [amb.wsId, e.id]);
    expect(r).toBe("recusou");
  });

  it("canais relatorios:* recusam caminho, nome hostil, workspace alheio e payload extra; zero diálogo de confirmação", async () => {
    const p = await esperarPacote();
    const r = await pagina().evaluate(async ([ws, id]) => {
      const a = (window as unknown as JanelaRel).ade.relatorios as unknown as Record<string, (...x: unknown[]) => Promise<unknown>>;
      const tentar = (q: Promise<unknown>) => q.then(() => "aceitou", () => "recusou");
      return [
        await tentar(a["previa"]?.(ws, id, "../../etc/passwd") as Promise<unknown>),
        await tentar(a["previa"]?.(ws, id, "/etc/passwd") as Promise<unknown>),
        await tentar(a["ler"]?.("outro-workspace", id) as Promise<unknown>),
        await tentar(a["exportar"]?.(ws, id, ["../x.md"], "pasta") as Promise<unknown>),
        await tentar(a["gerar"]?.(ws, { tipo: "sprint", sprint_id: "/tmp/x" }) as Promise<unknown>),
      ];
    }, [amb.wsId, p.id]);
    expect(r).toEqual(["recusou", "recusou", "recusou", "recusou", "recusou"]);
    expect(await dialogosChamados(amb.app)).toBe(0); // o seletor de pasta é simulado (sem contar) e não houve nenhum diálogo de confirmação
  });
});

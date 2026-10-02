// Adaptador PortaMetodo da gestão ágil: monta a `FonteTrabalho` do modelo do método (somente leitura), com cache por assinatura barata, rastro paginado,
// QA/ENTREGA tolerantes e ocorrências runx. Nada aqui escreve em disco.
import { describe, expect, it, vi } from "vitest";
import { ev, tk, trab } from "../../tests/fixtures/metodo/construtores";
import type { Artefato, EventoRastro, Trabalho } from "../nucleo/metodo/tipos";
import { assinaturaBarata, criarPortaMetodoMain, type DepsPortaMetodoAgil } from "./agil-metodo";

const WS = "ws_AAAAAAAAAAAA";
const artefato = (caminho: string, dados: Record<string, unknown> | null, rejeicao: Artefato["rejeicao"] = null): Artefato => ({ caminho, nome: caminho.split("/").pop() as string, ferramenta: null, kind: "x", trabalho_id: null, dados, corpo: "", veredito: null, faixa: null, rejeicao, avisos: [] });

function montar(trabalhos: Trabalho[], extra: Partial<DepsPortaMetodoAgil> = {}, rastros: Record<string, EventoRastro[]> = {}, artefatos: Record<string, Artefato> = {}) {
  const chamadas = { rastro: 0, artefato: [] as string[], garantir: 0 };
  const deps: DepsPortaMetodoAgil = {
    garantir: async () => { chamadas.garantir++; return { raiz: "/raiz" }; },
    indices: async () => new Map([["/raiz", { trabalhos } as never]]),
    trabalhos: () => trabalhos,
    rastro: async (_ws, id, depois) => { chamadas.rastro++; const todos = rastros[id] ?? []; const pagina = todos.slice(depois, depois + 500); return { eventos: pagina, proximo: depois + pagina.length }; },
    lerArtefato: async (_raiz, rel) => { chamadas.artefato.push(rel); const a = artefatos[rel]; if (!a) throw new Error("sem arquivo"); return a; },
    ...extra,
  };
  return { porta: criarPortaMetodoMain(deps), chamadas };
}

const T1 = trab({ id: "feat-1", titulo: "Feature 1", pasta: "docs/sprintx/features/feat-1", veredito_qa: "aprovado", ultima_atividade: "2027-01-02T00:00:00Z", eventos_total: 3, entrega: { estado: "pronta", branch: "b", portao: "ok", pr_url: null, pr_estado: null, commits: 1, arquivo: "docs/entregas/feat-1/ENTREGA.md" } }, [tk("T-01.01", { status: "concluida", concluida_em: "2027-01-02T10:00:00Z", suite: "verde" })]);
const SEM_TASKS = trab({ id: "pedido-1", tipo: "pedido" }, []);

describe("fontes", () => {
  it("uma fonte por trabalho COM tasks; QA e ENTREGA entram tolerantes; rastro completo", async () => {
    const rastro = [ev({ trabalho_id: "feat-1", task: "T-01.01", evento: "task_iniciada", ts: "2027-01-02T09:00:00Z" }), ev({ trabalho_id: "feat-1", task: "T-01.01", evento: "task_concluida", ts: "2027-01-02T10:00:00Z" })];
    const { porta, chamadas } = montar([T1, SEM_TASKS], {}, { "feat-1": rastro }, {
      "docs/sprintx/features/feat-1/QA.md": artefato("docs/sprintx/features/feat-1/QA.md", { achados: [{ id: "a1", severidade: "alta", task: "T-01.01", descricao: "quebrou" }, "lixo", { severidade: "desconhecida" }] }),
      "docs/entregas/feat-1/ENTREGA.md": artefato("docs/entregas/feat-1/ENTREGA.md", { commits: [{ sha: "abc", mensagem: "fix(T-01.01): corrige", ts: "2027-01-03T00:00:00Z", task: "T-01.01" }, { mensagem: "" }] }),
    });
    const fontes = await porta.fontes(WS);
    expect(fontes).toHaveLength(1);
    const f = fontes[0];
    expect(f?.workspace_id).toBe(WS);
    expect(f?.rastro).toHaveLength(2);
    expect(f?.qa?.achados).toHaveLength(1);
    expect(f?.qa?.achados[0]).toMatchObject({ severidade: "alta", task: "T-01.01" });
    expect(f?.commits).toHaveLength(1);
    expect(f?.commits[0]?.task_ref).toBe("T-01.01");
    expect(f?.versao_origem).toMatch(/^[0-9a-f]{8}$/);
    // só lê dentro da pasta do trabalho e do arquivo da entrega
    expect(chamadas.artefato.sort()).toEqual(["docs/entregas/feat-1/ENTREGA.md", "docs/sprintx/features/feat-1/QA.md"]);
  });

  it("artefato rejeitado ou ausente não derruba: QA vira só o veredito, commits vazios", async () => {
    const { porta } = montar([T1], {}, {}, { "docs/sprintx/features/feat-1/QA.md": artefato("docs/sprintx/features/feat-1/QA.md", null, "yaml_invalido") });
    const [f] = await porta.fontes(WS);
    expect(f?.qa).toMatchObject({ veredito: "aprovado", achados: [] });
    expect(f?.commits).toEqual([]);
  });

  it("cache por assinatura: sem mudança não relê rastro nem arquivos; mudou, relê só o que mudou", async () => {
    const lista = [T1, trab({ id: "feat-2", titulo: "F2", pasta: "docs/sprintx/features/feat-2" }, [tk("T-01.01")])];
    const { porta, chamadas } = montar(lista);
    const a = await porta.fontes(WS);
    const lidos = chamadas.rastro;
    expect(lidos).toBe(2);
    const b = await porta.fontes(WS);
    expect(chamadas.rastro).toBe(lidos);
    expect(b[0]).toBe(a[0]); // mesmo objeto => `versao_origem` igual => o sincronizador pula
    lista[1] = { ...(lista[1] as Trabalho), eventos_total: 9, ultima_atividade: "2027-02-01T00:00:00Z" };
    await porta.fontes(WS);
    expect(chamadas.rastro).toBe(lidos + 1);
    porta.esquecer(WS);
    await porta.fontes(WS);
    expect(chamadas.rastro).toBe(lidos + 1 + 2);
  });

  it("assinatura barata muda com status de task, vereditos, commits e atividade", () => {
    const base = assinaturaBarata(T1);
    expect(assinaturaBarata({ ...T1 })).toBe(base);
    expect(assinaturaBarata({ ...T1, veredito_qa: "reprovado" })).not.toBe(base);
    expect(assinaturaBarata({ ...T1, ultima_atividade: "2028-01-01T00:00:00Z" })).not.toBe(base);
    expect(assinaturaBarata({ ...T1, eventos_total: 99 })).not.toBe(base);
    const t2 = trab({ id: "feat-1", titulo: "Feature 1", pasta: "docs/sprintx/features/feat-1", veredito_qa: "aprovado", ultima_atividade: "2027-01-02T00:00:00Z", eventos_total: 3, entrega: T1.entrega }, [tk("T-01.01", { status: "em_andamento" })]);
    expect(assinaturaBarata(t2)).not.toBe(base);
  });

  it("rastro com mais de uma página é lido por inteiro e trabalho sumido sai do cache", async () => {
    const muitos = Array.from({ length: 1234 }, (_, i) => ev({ trabalho_id: "feat-1", ts: `2027-01-02T10:${String(i % 60).padStart(2, "0")}:00Z`, task: "T-01.01" }));
    const lista = [T1];
    const { porta } = montar(lista, {}, { "feat-1": muitos });
    const [f] = await porta.fontes(WS);
    expect(f?.rastro).toHaveLength(1234);
    lista.length = 0;
    expect(await porta.fontes(WS)).toEqual([]);
  });

  it("workspace sem método (garantir falha) devolve vazio e nunca lança; bloqueios abertos contados", async () => {
    const t = trab({ id: "b", bloqueios: [{ id: "1", task: "T-01.01", aberto_em: null, resolvido_em: null, aberto: true, descricao: "x", arquivo: "a" }, { id: "2", task: null, aberto_em: null, resolvido_em: "x", aberto: false, descricao: "y", arquivo: "a" }] });
    const semMetodo = montar([t], { garantir: async () => null });
    expect(await semMetodo.porta.fontes(WS)).toEqual([]);
    expect(await semMetodo.porta.ocorrencias(WS)).toEqual([]);
    expect(await semMetodo.porta.historicoSprintx(WS)).toBeNull();
    const com = montar([t]);
    expect(com.porta.bloqueiosAbertos(WS)).toBeNull();
    await com.porta.fontes(WS);
    expect(com.porta.bloqueiosAbertos(WS)).toBe(1);
  });

  it("id de trabalho com cara de caminho não vira leitura de rastro", async () => {
    const mau = trab({ id: "../../etc" }, [tk("T-01.01")]);
    const rastro = vi.fn(async () => ({ eventos: [], proximo: 0 }));
    const { porta } = montar([mau], { rastro });
    await porta.fontes(WS);
    expect(rastro).not.toHaveBeenCalled();
  });
});

describe("ocorrências runx e histórico do sprintx", () => {
  it("lê regressao_de/categoria/arquivos do 00-OCORRENCIA.md (sem caminho absoluto) e usa cache", async () => {
    const oc = trab({ id: "OC-1", tipo: "ocorrencia", tipo_ocorrencia: "bug", pasta: "docs/runx/ocorrencias/OC-1", eventos_total: 2 }, [tk("T-01.01")]);
    const { porta, chamadas } = montar([oc], {}, {}, { "docs/runx/ocorrencias/OC-1/00-OCORRENCIA.md": artefato("docs/runx/ocorrencias/OC-1/00-OCORRENCIA.md", { aberta_em: "2027-01-05T00:00:00Z", regressao_de: "feat-1", categoria: "bug", task: "T-01.01", arquivos: ["src/a.ts", "/etc/passwd", "C:\\x\\y.ts", 3] }) });
    const r = await porta.ocorrencias(WS);
    expect(r).toEqual([{ id: "OC-1", tipo: "bug", aberta_em: "2027-01-05T00:00:00Z", regressao_de: "feat-1", categoria: "bug", task_ref: "T-01.01", arquivos: ["src/a.ts"] }]);
    await porta.ocorrencias(WS);
    expect(chamadas.artefato).toHaveLength(1);
  });

  it("HISTORICO.md: dados quando válido; null quando ausente ou rejeitado", async () => {
    const ok = montar([], {}, {}, { "docs/sprintx/estimativas/HISTORICO.md": artefato("docs/sprintx/estimativas/HISTORICO.md", { entradas: [] }) });
    expect(await ok.porta.historicoSprintx(WS)).toEqual({ entradas: [] });
    const ruim = montar([], {}, {}, { "docs/sprintx/estimativas/HISTORICO.md": artefato("docs/sprintx/estimativas/HISTORICO.md", null, "yaml_invalido") });
    expect(await ruim.porta.historicoSprintx(WS)).toBeNull();
    expect(await montar([]).porta.historicoSprintx(WS)).toBeNull();
  });
});

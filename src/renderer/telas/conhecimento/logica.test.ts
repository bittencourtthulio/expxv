import { describe, expect, it } from "vitest";
import type { ArestaGrafo, NoGrafo } from "../../../compartilhado/conhecimento";
import type { CampoProvedor } from "../../../compartilhado/rag";
import { agruparPorTipo, assinarMaquina, avaliarUrl, corDoTipo, descreverEstadoConsulta, filtrarGrafo, formatarBytes, linhaDeFonte, maquinaMigracao, validarFormulario, vizinhosDe, type EntradaMaquina } from "./logica";

const no = (id: string, tipo: string, extra: Partial<NoGrafo> = {}): NoGrafo => ({ id, tipo, rotulo: `Nó ${id}`, peso: 1, x: null, y: null, ultimo_em: "2026-10-01T10:00:00Z", mission_id: null, ...extra });
const ar = (origem: string, destino: string, tipo = "toca"): ArestaGrafo => ({ origem, destino, tipo, peso: 1 });

describe("filtro e agrupamento de nós", () => {
  const nos = [no("a", "arquivo"), no("b", "task", { mission_id: "m1" }), no("c", "commit", { ultimo_em: "2026-01-01T00:00:00Z" }), no("d", "arquivo", { rotulo: "src/login.ts" })];
  const arestas = [ar("a", "b"), ar("b", "c"), ar("c", "d"), ar("a", "x")];
  it("filtra por tipo, busca (sem acento), período e missão e poda as arestas órfãs", () => {
    expect(filtrarGrafo(nos, arestas, { tipos: new Set(["arquivo"]) }).nos.map((n) => n.id)).toEqual(["a", "d"]);
    expect(filtrarGrafo(nos, arestas, { busca: "LOGIN" }).nos.map((n) => n.id)).toEqual(["d"]);
    expect(filtrarGrafo(nos, arestas, { desde: "2026-06-01T00:00:00Z" }).nos.map((n) => n.id)).toEqual(["a", "b", "d"]);
    expect(filtrarGrafo(nos, arestas, { missionId: "m1" }).nos.map((n) => n.id)).toEqual(["b"]);
    const r = filtrarGrafo(nos, arestas, { tipos: new Set(["arquivo", "task"]) });
    expect(r.arestas).toEqual([ar("a", "b")]);
    expect(filtrarGrafo(nos, arestas, {}).nos).toHaveLength(4);
  });
  it("agrupa por tipo com contagem e ordem estável por contagem; vizinhos de 1 salto sem duplicar", () => {
    expect(agruparPorTipo(nos)).toEqual([{ tipo: "arquivo", n: 2 }, { tipo: "commit", n: 1 }, { tipo: "task", n: 1 }]);
    expect(vizinhosDe("b", arestas)).toEqual(["a", "c"]);
    expect(vizinhosDe("zz", arestas)).toEqual([]);
  });
  it("cor por tipo é estável e tipo desconhecido tem cor padrão", () => {
    expect(corDoTipo("task")).toBe(corDoTipo("task"));
    expect(corDoTipo("task")).not.toBe(corDoTipo("commit"));
    expect(corDoTipo("coisa-nova")).toMatch(/^var\(--/);
  });
});

describe("textos de estado da consulta e linhas de fonte", () => {
  it("todos os estados têm texto de uma linha; aviso do main prevalece no degradado", () => {
    for (const e of ["ok", "vazio", "lento", "degradado", "indisponivel", "desligado"] as const) {
      const t = descreverEstadoConsulta(e, null);
      expect(t.texto.length).toBeGreaterThan(5);
      expect(t.texto).not.toContain("\n");
    }
    expect(descreverEstadoConsulta("degradado", "só lexical").texto).toContain("só lexical");
    expect(descreverEstadoConsulta("ok", null).tom).toBe("sucesso");
    expect(descreverEstadoConsulta("indisponivel", null).tom).toBe("alerta");
  });
  it("linha de fonte: tipo · data · origem · missão/task", () => {
    const l = linhaDeFonte({ documento_id: "d", tipo: "commit", titulo: "t", origem: "commit:abc123", mission_id: "m1", task_ref: "T-01.02", pane_id: null, ocorrido_em: "2026-10-01T10:00:00Z" });
    expect(l).toBe("commit · 01/10/2026 · commit:abc123 · missão m1 · T-01.02");
    expect(linhaDeFonte({ documento_id: "d", tipo: "doc", titulo: "t", origem: "docs/a.md", mission_id: null, task_ref: null, pane_id: null, ocorrido_em: "lixo" })).toBe("doc · docs/a.md");
  });
  it("formata bytes", () => {
    expect(formatarBytes(0)).toBe("0 B");
    expect(formatarBytes(1536)).toBe("1,5 KB");
    expect(formatarBytes(5 * 1024 * 1024)).toBe("5,0 MB");
  });
});

describe("validação do formulário do backend", () => {
  it("https obrigatório; http só loopback/privada com aviso; resto recusado", () => {
    expect(avaliarUrl("https://x.supabase.co").ok).toBe(true);
    expect(avaliarUrl("https://x.supabase.co").aviso).toBeNull();
    expect(avaliarUrl("http://localhost:6333")).toMatchObject({ ok: true });
    expect(avaliarUrl("http://localhost:6333").aviso).toMatch(/http/i);
    expect(avaliarUrl("http://192.168.0.10:6333").ok).toBe(true);
    expect(avaliarUrl("http://10.1.2.3").ok).toBe(true);
    expect(avaliarUrl("http://172.20.0.1").ok).toBe(true);
    expect(avaliarUrl("http://172.40.0.1").ok).toBe(false);
    expect(avaliarUrl("http://exemplo.com").ok).toBe(false);
    expect(avaliarUrl("ftp://x").ok).toBe(false);
    expect(avaliarUrl("https://u:p@x.com").ok).toBe(false);
    expect(avaliarUrl("nao é url").ok).toBe(false);
    expect(avaliarUrl("").ok).toBe(false);
  });
  it("campos obrigatórios; segredo já configurado dispensa digitar de novo; nome da coleção limitado", () => {
    const campos: CampoProvedor[] = [
      { chave: "api_key", rotulo: "Chave", secreto: true, obrigatorio: true, dica: null },
      { chave: "regiao", rotulo: "Região", secreto: false, obrigatorio: false, dica: null },
    ];
    const base = { url: "https://x.io", colecao: "conhecimento_projeto", valores: { api_key: "", regiao: "" }, mascaras: {} as Record<string, string>, campos };
    expect(validarFormulario(base).ok).toBe(false);
    expect(validarFormulario(base).erros["api_key"]).toMatch(/obrigat/i);
    expect(validarFormulario({ ...base, mascaras: { api_key: "••••1234" } }).ok).toBe(true);
    expect(validarFormulario({ ...base, valores: { api_key: "abc", regiao: "" } }).ok).toBe(true);
    expect(validarFormulario({ ...base, valores: { api_key: "abc", regiao: "" }, colecao: "a b!" }).erros["colecao"]).toBeTruthy();
    expect(validarFormulario({ ...base, valores: { api_key: "abc", regiao: "" }, url: "http://x.com" }).erros["url"]).toBeTruthy();
  });
});

describe("máquina do assistente de migração", () => {
  const ent = (e: EntradaMaquina) => e;
  it("prévia → consentimento → migrando → verificando → concluída; consentimento é obrigatório", () => {
    let s = maquinaMigracao.inicial();
    expect(s.etapa).toBe("inicio");
    expect(maquinaMigracao.passo(s, ent({ tipo: "iniciar" })).etapa).toBe("inicio"); // sem consentimento nada começa
    s = maquinaMigracao.passo(s, ent({ tipo: "previa_pronta", previa_id: "p1" }));
    expect(s.etapa).toBe("previa");
    expect(maquinaMigracao.passo(s, ent({ tipo: "iniciar" })).etapa).toBe("previa");
    s = maquinaMigracao.passo(s, ent({ tipo: "pedir_consentimento" }));
    expect(s.etapa).toBe("consentimento");
    s = maquinaMigracao.passo(s, ent({ tipo: "consentir" }));
    expect(s.etapa).toBe("consentida");
    s = maquinaMigracao.passo(s, ent({ tipo: "iniciar" }));
    expect(s.etapa).toBe("migrando");
    s = maquinaMigracao.passo(s, ent({ tipo: "progresso", estado: "pausada", enviados: 5, total: 10 }));
    expect(s.etapa).toBe("pausada");
    s = maquinaMigracao.passo(s, ent({ tipo: "progresso", estado: "enviando", enviados: 6, total: 10 }));
    expect(s.etapa).toBe("migrando");
    s = maquinaMigracao.passo(s, ent({ tipo: "progresso", estado: "verificando", enviados: 10, total: 10 }));
    expect(s.etapa).toBe("verificando");
    s = maquinaMigracao.passo(s, ent({ tipo: "progresso", estado: "concluida", enviados: 10, total: 10 }));
    expect(s.etapa).toBe("concluida");
  });
  it("cancelar do consentimento volta à prévia; falha e cancelamento do main terminam; reiniciar zera", () => {
    let s = maquinaMigracao.passo(maquinaMigracao.inicial(), { tipo: "previa_pronta", previa_id: "p" });
    s = maquinaMigracao.passo(s, { tipo: "pedir_consentimento" });
    expect(maquinaMigracao.passo(s, { tipo: "recusar" }).etapa).toBe("previa");
    s = maquinaMigracao.passo(maquinaMigracao.passo(s, { tipo: "consentir" }), { tipo: "iniciar" });
    expect(maquinaMigracao.passo(s, { tipo: "progresso", estado: "falhou", enviados: 1, total: 9 }).etapa).toBe("falhou");
    expect(maquinaMigracao.passo(s, { tipo: "progresso", estado: "cancelada", enviados: 1, total: 9 }).etapa).toBe("cancelada");
    expect(maquinaMigracao.passo(s, { tipo: "reiniciar" }).etapa).toBe("inicio");
  });
  it("nova prévia invalida o consentimento anterior", () => {
    let s = maquinaMigracao.passo(maquinaMigracao.inicial(), { tipo: "previa_pronta", previa_id: "p1" });
    s = maquinaMigracao.passo(maquinaMigracao.passo(s, { tipo: "pedir_consentimento" }), { tipo: "consentir" });
    s = maquinaMigracao.passo(s, { tipo: "previa_pronta", previa_id: "p2" });
    expect(s.etapa).toBe("previa");
    expect(s.previaId).toBe("p2");
  });
  it("assinatura de máquina é estável (só etapa e contagens)", () => {
    expect(assinarMaquina({ etapa: "migrando", previaId: "p", enviados: 3, total: 9 })).toBe("migrando:3/9");
  });
});

import { describe, expect, it } from "vitest";
import { criarStoreInicio, derivarInicio } from "./inicio";
import { tk, trabalho } from "../telas/metodo/fabrica";
import type { IndiceProjeto } from "../../nucleo/metodo/tipos";

const ws = { id: "w1", nome: "p", raiz: "/p" } as never;
const indice = (trabalhos: ReturnType<typeof trabalho>[], lock = true): IndiceProjeto => ({
  raiz: "/p", gerado_em: "x", duracao_ms: 1, trabalhos, violacoes: [], rejeicoes: [], avisos: [], artefatos_lidos: 1,
  camadas: { convencoes: false, perfil_legado: false, design_system: false, produto: false, hooks: lock, lock, memoria: false },
});
const vazio = { terminais: { sessoes: [], ferramentas: null }, missoes: { itens: [], carregado: true }, metodo: { indice: indice([]), carregado: true }, workspaces: { atual: ws, carregado: true } };

describe("derivarInicio", () => {
  it("guia o primeiro uso: projeto, método, missão", () => {
    expect(derivarInicio(vazio.terminais, vazio.missoes, vazio.metodo, { atual: null, carregado: true }).proximoPasso).toBe("projeto");
    expect(derivarInicio(vazio.terminais, vazio.missoes, { indice: indice([], false), carregado: true }, vazio.workspaces).proximoPasso).toBe("metodo");
    expect(derivarInicio(vazio.terminais, vazio.missoes, vazio.metodo, vazio.workspaces).proximoPasso).toBe("missao");
  });
  it("junta aguardando, vereditos sem assinatura, PRs abertos, bloqueios e eventos", () => {
    const t = trabalho([tk("T-1")], {
      id: "a", titulo: "Feature A", prodx: { veredito: "sim", assinado: false, briefing: false },
      entrega: { estado: null, branch: "b", portao: null, pr_url: "http://pr/1", pr_estado: "open", commits: 1, arquivo: "x" },
      bloqueios: [{ id: "B-1", task: null, aberto_em: null, resolvido_em: null, aberto: true, descricao: "falta chave", arquivo: "x" }, { id: "B-2", task: null, aberto_em: null, resolvido_em: null, aberto: false, descricao: "ok", arquivo: "x" }],
      ultima_atividade: "2026-01-02",
    });
    const d = derivarInicio(
      { sessoes: [{ sessao_id: "s", ferramenta_id: "claude", numero: 3, estado: "executando", atividade: "aguardando", mensagem: null, codigo_saida: null }], ferramentas: null },
      { itens: [{ id: "m1", titulo: "M", estado: "executando" } as never, { id: "m2", titulo: "N", estado: "concluida" } as never], carregado: true },
      { indice: indice([t]), carregado: true }, vazio.workspaces);
    expect(d.proximoPasso).toBeNull();
    expect(d.aguardando.map((i) => i.destino)).toEqual(["terminais", "metodo", "metodo"]);
    expect(d.missoes).toHaveLength(1);
    expect(d.bloqueios).toHaveLength(1);
    expect(d.eventos[0]?.titulo).toBe("Feature A");
  });
});

describe("store de início", () => {
  it("assina as fontes só com ouvinte e só notifica quando o derivado muda", () => {
    let n = 0;
    const ouvs = new Set<() => void>();
    const fonte = <T,>(v: T) => ({ obter: () => v, assinar: (o: () => void) => { n++; ouvs.add(o); return () => void ouvs.delete(o); } });
    const store = criarStoreInicio({ terminais: fonte(vazio.terminais), missoes: fonte(vazio.missoes), metodo: fonte(vazio.metodo), workspaces: fonte(vazio.workspaces) });
    expect(n).toBe(0);
    let avisos = 0;
    const cancelar = store.assinar(() => avisos++);
    expect(n).toBe(4);
    ouvs.forEach((o) => o()); // nada mudou no derivado
    expect(avisos).toBe(0);
    cancelar();
    expect(ouvs.size).toBe(0);
  });
});

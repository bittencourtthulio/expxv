import { describe, expect, it } from "vitest";
import { CANAIS_ENVIO, CANAIS_INVOKE } from "../../compartilhado/ipc";
import type { LayoutTerminais } from "../../compartilhado/terminais";
import {
  FERRAMENTAS_IDS, LIMITES_LAYOUT, VALIDADORES_TERMINAIS, validarItemAnexo, validarLayoutTerminais, validarPedidoAbrirSessao,
} from "./ipc-validadores";

const SESSAO = "sessao_0123456789abcdef0123456789abcdef";
const EXE = "exe_0123456789abcdef0123456789abcdef";
const pedido = (extra: Record<string, unknown> = {}) => ({ versao: 1, ferramenta_id: "claude", executavel_id: EXE, argumentos: ["--x"], colunas: 80, linhas: 24, workspace_id: null, ...extra });

describe("cobertura de canais", () => {
  it("todo canal terminais:* de ipc.ts tem validador, e só eles", () => {
    const canais = [...CANAIS_INVOKE, ...CANAIS_ENVIO].filter((c) => c.startsWith("terminais:"));
    expect(Object.keys(VALIDADORES_TERMINAIS).sort()).toEqual([...canais].sort());
  });
});

describe("terminais:abrir", () => {
  const v = validarPedidoAbrirSessao;
  it("aceita e reconstrói campo a campo", () => {
    const r = v(pedido({ retomar: "conv-1", prompt_inicial: "faça isto", workspace_id: "ws_01ABC" }));
    expect(r).toEqual({ ok: true, valor: { versao: 1, ferramenta_id: "claude", executavel_id: EXE, argumentos: ["--x"], colunas: 80, linhas: 24, workspace_id: "ws_01ABC", retomar: "conv-1", prompt_inicial: "faça isto" } });
  });
  it("workspace_id ausente vira null", () => {
    const { workspace_id: _w, ...sem } = pedido();
    expect(v(sem)).toMatchObject({ ok: true, valor: { workspace_id: null } });
  });
  it("o renderer não consegue enviar cwd nem papel nem campo desconhecido", () => {
    expect(v(pedido({ cwd: "/etc" }))).toMatchObject({ ok: false });
    expect(v(pedido({ papel: "orquestrador" }))).toMatchObject({ ok: false });
    expect(v(pedido({ caminho: "/bin/sh" }))).toMatchObject({ ok: false });
  });
  it("recusa ferramenta fora do conjunto, executável sem prefixo e versão errada", () => {
    expect(v(pedido({ ferramenta_id: "rm" }))).toMatchObject({ ok: false });
    expect(v(pedido({ executavel_id: "/bin/sh" }))).toMatchObject({ ok: false });
    expect(v(pedido({ executavel_id: "exe_../x" }))).toMatchObject({ ok: false });
    expect(v(pedido({ versao: 2 }))).toMatchObject({ ok: false });
  });
  it("aceita todas as ferramentas do contrato", () => {
    for (const f of FERRAMENTAS_IDS) expect(v(pedido({ ferramenta_id: f }))).toMatchObject({ ok: true });
  });
  it("recusa argumentos inválidos, dimensões fora da faixa e ids de workspace com caminho", () => {
    expect(v(pedido({ argumentos: Array.from({ length: 65 }, () => "a") }))).toMatchObject({ ok: false });
    expect(v(pedido({ argumentos: ["a\0b"] }))).toMatchObject({ ok: false });
    expect(v(pedido({ argumentos: ["x".repeat(4_097)] }))).toMatchObject({ ok: false });
    expect(v(pedido({ argumentos: [1] }))).toMatchObject({ ok: false });
    expect(v(pedido({ colunas: 1 }))).toMatchObject({ ok: false });
    expect(v(pedido({ colunas: 501 }))).toMatchObject({ ok: false });
    expect(v(pedido({ linhas: 0 }))).toMatchObject({ ok: false });
    expect(v(pedido({ linhas: 10.5 }))).toMatchObject({ ok: false });
    expect(v(pedido({ workspace_id: "../fora" }))).toMatchObject({ ok: false });
    expect(v(pedido({ workspace_id: 3 }))).toMatchObject({ ok: false });
  });
  it("recusa retomar e prompt_inicial inválidos", () => {
    expect(v(pedido({ retomar: "a b" }))).toMatchObject({ ok: false });
    expect(v(pedido({ retomar: "--dangerous" }))).toMatchObject({ ok: false }); // AUD-24: id iniciado por hífen viraria opção da CLI
    expect(v(pedido({ retomar: "x; rm" }))).toMatchObject({ ok: false });
    expect(v(pedido({ prompt_inicial: "" }))).toMatchObject({ ok: false });
    expect(v(pedido({ prompt_inicial: "a\0" }))).toMatchObject({ ok: false });
    expect(v(pedido({ prompt_inicial: "x".repeat(4_097) }))).toMatchObject({ ok: false });
  });
  it("recusa o que não é objeto", () => {
    for (const x of [null, undefined, "x", 1, [], [pedido()]]) expect(v(x)).toMatchObject({ ok: false });
  });
});

describe("demais canais", () => {
  const V = VALIDADORES_TERMINAIS;
  it("canais sem payload aceitam só undefined", () => {
    for (const c of ["terminais:listar_sessoes", "terminais:recuperar", "terminais:diagnostico", "terminais:conversas"] as const) {
      expect(V[c](undefined)).toMatchObject({ ok: true });
      expect(V[c]({})).toMatchObject({ ok: false });
    }
  });
  it("ids de sessão são opacos: só sessao_<id>", () => {
    for (const c of ["terminais:encerrar", "terminais:descartar", "terminais:interromper"] as const) {
      expect(V[c]({ sessao_id: SESSAO })).toMatchObject({ ok: true });
      expect(V[c]({ sessao_id: "outra" })).toMatchObject({ ok: false });
      expect(V[c]({ sessao_id: "sessao_../x" })).toMatchObject({ ok: false });
      expect(V[c]({ sessao_id: SESSAO, extra: 1 })).toMatchObject({ ok: false });
      expect(V[c]({})).toMatchObject({ ok: false });
    }
  });
  it("listar_ferramentas e selecionar_executavel", () => {
    expect(V["terminais:listar_ferramentas"]({ forcar: true })).toMatchObject({ ok: true });
    expect(V["terminais:listar_ferramentas"]({ forcar: "sim" })).toMatchObject({ ok: false });
    expect(V["terminais:selecionar_executavel"]({ ferramenta_id: "codex" })).toMatchObject({ ok: true });
    expect(V["terminais:selecionar_executavel"]({ ferramenta_id: "/bin/sh" })).toMatchObject({ ok: false });
  });
  it("confirmar_consumo exige inteiro não negativo", () => {
    expect(V["terminais:confirmar_consumo"]({ sessao_id: SESSAO, bytes: 100 })).toMatchObject({ ok: true });
    expect(V["terminais:confirmar_consumo"]({ sessao_id: SESSAO, bytes: -1 })).toMatchObject({ ok: false });
    expect(V["terminais:confirmar_consumo"]({ sessao_id: SESSAO, bytes: 1.5 })).toMatchObject({ ok: false });
    expect(V["terminais:confirmar_consumo"]({ sessao_id: SESSAO, bytes: Number.MAX_SAFE_INTEGER })).toMatchObject({ ok: false });
  });
  it("escrever respeita o limite em bytes e recusa NUL", () => {
    expect(V["terminais:escrever"]({ sessao_id: SESSAO, dados: "ls\r" })).toMatchObject({ ok: true });
    expect(V["terminais:escrever"]({ sessao_id: SESSAO, dados: "a\0" })).toMatchObject({ ok: false });
    expect(V["terminais:escrever"]({ sessao_id: SESSAO, dados: "x".repeat(64 * 1024 + 1) })).toMatchObject({ ok: false });
    expect(V["terminais:escrever"]({ sessao_id: SESSAO, dados: "é".repeat(40_000) })).toMatchObject({ ok: false }); // 80 KB em bytes
    expect(V["terminais:escrever"]({ sessao_id: SESSAO, dados: 1 })).toMatchObject({ ok: false });
  });
  it("redimensionar respeita as faixas", () => {
    expect(V["terminais:redimensionar"]({ sessao_id: SESSAO, colunas: 120, linhas: 40 })).toMatchObject({ ok: true });
    expect(V["terminais:redimensionar"]({ sessao_id: SESSAO, colunas: 1, linhas: 40 })).toMatchObject({ ok: false });
    expect(V["terminais:redimensionar"]({ sessao_id: SESSAO, colunas: 120, linhas: 301 })).toMatchObject({ ok: false });
  });
  it("abrir_link e layout_ler", () => {
    expect(V["terminais:abrir_link"]({ url: "https://x.com" })).toMatchObject({ ok: true });
    expect(V["terminais:abrir_link"]({ url: "x".repeat(2_049) })).toMatchObject({ ok: false });
    expect(V["terminais:layout_ler"]({ workspace_id: null })).toMatchObject({ ok: true });
    expect(V["terminais:layout_ler"]({ workspace_id: "ws_1" })).toMatchObject({ ok: true });
    expect(V["terminais:layout_ler"]({ workspace_id: "a/b" })).toMatchObject({ ok: false });
  });
});

describe("ItemAnexo", () => {
  it("aceita caminho e {nome, bytes} e reconstrói", () => {
    expect(validarItemAnexo({ caminho: "/tmp/a.png" })).toEqual({ ok: true, valor: { caminho: "/tmp/a.png" } });
    const r = validarItemAnexo({ nome: "a.png", bytes: new Uint8Array([1, 2, 3]) });
    expect(r).toMatchObject({ ok: true, valor: { nome: "a.png" } });
    if (r.ok && "bytes" in r.valor) expect([...r.valor.bytes]).toEqual([1, 2, 3]);
    expect(validarItemAnexo({ nome: "b", bytes: Buffer.from("xy") })).toMatchObject({ ok: true });
  });
  it("recusa forma mista, nome com caminho, bytes que não são Uint8Array, caminho vazio ou com NUL", () => {
    expect(validarItemAnexo({ caminho: "/a", nome: "a", bytes: new Uint8Array(1) })).toMatchObject({ ok: false });
    expect(validarItemAnexo({ caminho: "/a", extra: 1 })).toMatchObject({ ok: false });
    expect(validarItemAnexo({ nome: "../a", bytes: new Uint8Array(1) })).toMatchObject({ ok: false });
    expect(validarItemAnexo({ nome: "a\\b", bytes: new Uint8Array(1) })).toMatchObject({ ok: false });
    expect(validarItemAnexo({ nome: "a", bytes: [1, 2] })).toMatchObject({ ok: false });
    expect(validarItemAnexo({ nome: "a", bytes: "abc" })).toMatchObject({ ok: false });
    expect(validarItemAnexo({ caminho: "" })).toMatchObject({ ok: false });
    expect(validarItemAnexo({ caminho: "/a\0b" })).toMatchObject({ ok: false });
    expect(validarItemAnexo({})).toMatchObject({ ok: false });
    expect(validarItemAnexo(null)).toMatchObject({ ok: false });
  });
  it("terminais:anexar limita a 10 itens", () => {
    const item = { caminho: "/a" };
    expect(VALIDADORES_TERMINAIS["terminais:anexar"]({ sessao_id: SESSAO, itens: Array(10).fill(item) })).toMatchObject({ ok: true });
    expect(VALIDADORES_TERMINAIS["terminais:anexar"]({ sessao_id: SESSAO, itens: Array(11).fill(item) })).toMatchObject({ ok: false });
  });
});

describe("LayoutTerminais", () => {
  const folha = (id: string) => ({ tipo: "terminal" as const, sessao_id: id });
  const base = (): LayoutTerminais => ({ versao: 2, ativa: "a", abas: [{ arvore: { tipo: "divisao", orientacao: "horizontal", primeiro: folha("s1"), segundo: folha("s2") } }], fixadas: ["s1"] });
  it("aceita e reconstrói", () => {
    expect(validarLayoutTerminais(base())).toEqual({ ok: true, valor: base() });
  });
  it("descarta campos extras do nó (reconstrução) — na verdade os recusa", () => {
    const l = base() as unknown as { abas: Array<{ arvore: { primeiro: Record<string, unknown> } }> };
    l.abas[0]!.arvore.primeiro["injetado"] = 1;
    expect(validarLayoutTerminais(l)).toMatchObject({ ok: false });
  });
  it("proporção opcional da divisão (D-515): número finito entre 0,05 e 0,95; recusa o resto", () => {
    const com = (proporcao: unknown): unknown => ({ ...base(), abas: [{ arvore: { tipo: "divisao", orientacao: "vertical", proporcao, primeiro: folha("a"), segundo: folha("b") } }] });
    expect(validarLayoutTerminais(com(0.45))).toMatchObject({ ok: true, valor: { abas: [{ arvore: { proporcao: 0.45 } }] } });
    for (const ruim of [0, 1, 0.01, 0.96, -1, Number.NaN, Number.POSITIVE_INFINITY, "0.5", null]) expect(validarLayoutTerminais(com(ruim))).toMatchObject({ ok: false });
  });
  it("recusa versão, ids ruins, tipo inválido e orientação inválida", () => {
    expect(validarLayoutTerminais({ ...base(), versao: 1 })).toMatchObject({ ok: false });
    expect(validarLayoutTerminais({ ...base(), ativa: "a b" })).toMatchObject({ ok: false });
    expect(validarLayoutTerminais({ ...base(), fixadas: ["../x"] })).toMatchObject({ ok: false });
    expect(validarLayoutTerminais({ ...base(), abas: [{ arvore: { tipo: "x" } }] })).toMatchObject({ ok: false });
    expect(validarLayoutTerminais({ ...base(), abas: [{ arvore: { tipo: "divisao", orientacao: "diagonal", primeiro: folha("a"), segundo: folha("b") } }] })).toMatchObject({ ok: false });
  });
  it("recusa profundidade > 16, mais de 64 nós e mais de 64 KB", () => {
    let arvore: unknown = folha("s");
    for (let i = 0; i < LIMITES_LAYOUT.profundidade; i++) arvore = { tipo: "divisao", orientacao: "vertical", primeiro: arvore, segundo: folha("t") };
    expect(validarLayoutTerminais({ ...base(), abas: [{ arvore }] })).toMatchObject({ ok: false }); // 17 níveis de divisão
    const raso = (n: number): unknown => (n <= 1 ? folha("s") : { tipo: "divisao", orientacao: "vertical", primeiro: raso(n - 1), segundo: folha("t") });
    expect(validarLayoutTerminais({ ...base(), abas: [{ arvore: raso(15) }] })).toMatchObject({ ok: true });
    const muitasAbas = Array.from({ length: 33 }, () => ({ arvore: { tipo: "divisao", orientacao: "vertical", primeiro: folha("a"), segundo: folha("b") } }));
    expect(validarLayoutTerminais({ ...base(), abas: muitasAbas })).toMatchObject({ ok: false }); // 99 nós
    expect(validarLayoutTerminais({ ...base(), fixadas: Array(65).fill("x") })).toMatchObject({ ok: false });
  });
  it("D-570: aceita expandido e foco_unico opcionais e recusa tipos errados", () => {
    expect(validarLayoutTerminais({ ...base(), expandido: "x", foco_unico: true })).toMatchObject({ ok: true, valor: { expandido: "x", foco_unico: true } });
    expect(validarLayoutTerminais({ ...base(), expandido: null })).toMatchObject({ ok: true });
    expect(validarLayoutTerminais({ ...base(), expandido: "../x" })).toMatchObject({ ok: false });
    expect(validarLayoutTerminais({ ...base(), foco_unico: "sim" })).toMatchObject({ ok: false });
  });
  it("terminais:layout_gravar aplica o validador ao layout", () => {
    expect(VALIDADORES_TERMINAIS["terminais:layout_gravar"]({ workspace_id: "ws_1", layout: base() })).toMatchObject({ ok: true });
    expect(VALIDADORES_TERMINAIS["terminais:layout_gravar"]({ workspace_id: "ws_1", layout: { versao: 9 } })).toMatchObject({ ok: false });
  });
});

import { describe, expect, it } from "vitest";
import { criarBloqueio } from "./bloqueio";
import { hashDoComando } from "./plano";
import { isolamentoPorCli, resolverServidoresLoja, type AlvoPolitica, type EntradaPolitica, type MotivoExclusao } from "./politica";
import type { RegistroHabilitacao, RegistroInstalado } from "./repositorio";
import { catalogoFalso } from "../../../tests/fixtures/mcp-loja/apoio-ciclo";

const cat = catalogoFalso();
/** O hash consentido é o do comando do catálogo ATUAL (o que a instalação grava); os testes de reconsentimento o trocam. */
const hashAtual = (id: string): string => { const e = cat.porId.get(id)?.entrada; return e === undefined ? "h" : hashDoComando(e); };
const inst = (id: string, extra: Partial<RegistroInstalado> = {}): [string, RegistroInstalado] => [id, {
  servidor_id: id, versao: "1", metodo: "npm", estado: "instalado", nivel_verificacao: "padrao", integridade: null, pasta_rel: `mcp/${id}`, comando_hash: hashAtual(id), seed_versao: "s",
  erro_codigo: null, instalado_em: "t", atualizado_em: "t", ...extra,
}];
let n = 0;
const hab = (servidor_id: string, alvo_tipo: RegistroHabilitacao["alvo_tipo"], alvo_valor: string, habilitado = true): RegistroHabilitacao =>
  ({ id: `h${++n}`, servidor_id, alvo_tipo, alvo_valor, habilitado, atualizado_em: "t" });

function resolver(alvo: AlvoPolitica, habilitacoes: RegistroHabilitacao[], extra: Partial<EntradaPolitica> = {}, instalados = ["falso-ok", "falso-publica", "falso-chave", "context7"]) {
  return resolverServidoresLoja(alvo, {
    habilitacoes, catalogo: cat, instalados: new Map(instalados.map((i) => inst(i))),
    definidas: new Map([["falso-chave", new Set(["FALSO_API_KEY"])]]), ...extra,
  });
}
const motivos = (r: ReturnType<typeof resolver>): Record<string, MotivoExclusao> => Object.fromEntries(r.excluidos.map((x) => [x.id, x.motivo]));
const W = { workspace: "w1" };

describe("política de habilitação (deny-by-default)", () => {
  it("sem nenhuma linha: zero servidores", () => {
    expect(resolver(W, [])).toEqual({ servidores: [], excluidos: [] });
  });

  it("workspace habilita; outro workspace não vê", () => {
    const hs = [hab("falso-ok", "workspace", "w1"), hab("context7", "workspace", "w2")];
    expect(resolver(W, hs).servidores).toEqual(["falso-ok"]);
    expect(motivos(resolver(W, hs))).toEqual({}); // linhas de outro workspace nem entram na conta
  });

  it("instalar não habilita: instalado sem linha fica de fora (e habilitado sem instalar também)", () => {
    expect(resolver(W, [hab("falso-ok", "workspace", "w1")], {}, []).servidores).toEqual([]);
    expect(motivos(resolver(W, [hab("falso-ok", "workspace", "w1")], {}, []))).toEqual({ "falso-ok": "nao_instalado" });
  });

  it("linha desligada (habilitado=false) = fora", () => {
    expect(resolver(W, [hab("falso-ok", "workspace", "w1", false)]).servidores).toEqual([]);
  });

  it("Missão livre: pode DESLIGAR um servidor do workspace, nunca ligar um que o workspace não liga", () => {
    const hs = [hab("falso-ok", "workspace", "w1"), hab("falso-publica", "workspace", "w1"), hab("falso-ok", "missao", "m1", false), hab("context7", "missao", "m1", true)];
    const r = resolver({ ...W, missao: "m1", modo: "livre" }, hs);
    expect(r.servidores).toEqual(["falso-publica"]);
    expect(motivos(r)).toMatchObject({ "falso-ok": "desligado_na_missao", context7: "nao_habilitado_no_workspace" });
  });

  it.each(["squad", "agentico"] as const)("Missão %s sem allow-list: ZERO servidores da Loja", (modo) => {
    const hs = [hab("falso-ok", "workspace", "w1"), hab("falso-publica", "workspace", "w1")];
    const r = resolver({ ...W, missao: "m1", modo }, hs);
    expect(r.servidores).toEqual([]);
    expect(Object.values(motivos(r))).toEqual(["sem_allow_list_da_missao", "sem_allow_list_da_missao"]);
  });

  it("Missão squad com allow-list: só a interseção com o workspace", () => {
    const hs = [hab("falso-ok", "workspace", "w1"), hab("falso-publica", "workspace", "w1"), hab("falso-ok", "missao", "m1"), hab("context7", "missao", "m1")];
    const r = resolver({ ...W, missao: "m1", modo: "squad" }, hs);
    expect(r.servidores).toEqual(["falso-ok"]);
    expect(motivos(r)).toMatchObject({ "falso-publica": "fora_da_allow_list_da_missao", context7: "nao_habilitado_no_workspace" });
  });

  it("agente com conjunto próprio restringe; agente que desliga tira; agente sem linhas herda", () => {
    const hs = [hab("falso-ok", "workspace", "w1"), hab("falso-publica", "workspace", "w1"), hab("falso-ok", "agente", "a1"), hab("falso-publica", "agente", "a2", false)];
    expect(resolver({ ...W, agente: "a1" }, hs).servidores).toEqual(["falso-ok"]);
    expect(motivos(resolver({ ...W, agente: "a1" }, hs))).toEqual({ "falso-publica": "fora_do_conjunto_do_agente" });
    expect(resolver({ ...W, agente: "a2" }, hs).servidores).toEqual(["falso-ok"]);
    expect(motivos(resolver({ ...W, agente: "a2" }, hs))).toEqual({ "falso-publica": "desligado_no_agente" });
    expect(resolver({ ...W, agente: "a3" }, hs).servidores).toEqual(["falso-ok", "falso-publica"]);
  });

  it("habilitar no agente não amplia além do workspace", () => {
    expect(resolver({ ...W, agente: "a1" }, [hab("falso-ok", "agente", "a1")]).servidores).toEqual([]);
  });

  it("variável obrigatória faltando: fora ('nao_configurado'); definida: dentro; apagada depois: sai na hora", () => {
    const hs = [hab("falso-chave", "workspace", "w1")];
    expect(resolver(W, hs).servidores).toEqual(["falso-chave"]);
    expect(motivos(resolver(W, hs, { definidas: new Map() }))).toEqual({ "falso-chave": "nao_configurado" });
  });

  it("bloqueado depois de instalado sai da política; instalação incompleta/falhou também; catálogo desconhecido também", () => {
    const hs = [hab("falso-ok", "workspace", "w1"), hab("falso-publica", "workspace", "w1"), hab("fantasma", "workspace", "w1")];
    const bloqueio = criarBloqueio({ schema_version: 1, regras: [{ id: "falso-ok", motivo: "comprometido", desde: "2026-10-01" }] });
    const r = resolverServidoresLoja(W, {
      habilitacoes: hs, catalogo: cat, bloqueio,
      instalados: new Map([inst("falso-ok"), inst("falso-publica", { estado: "instalando" }), inst("fantasma")]),
    });
    expect(r.servidores).toEqual([]);
    expect(motivos(r)).toEqual({ "falso-ok": "bloqueado", "falso-publica": "instalacao_incompleta", fantasma: "catalogo_desconhecido" });
  });

  it("saída ordenada e determinística", () => {
    const hs = [hab("falso-publica", "workspace", "w1"), hab("falso-ok", "workspace", "w1"), hab("context7", "workspace", "w1")];
    const a = resolver(W, hs).servidores;
    expect(a).toEqual(["context7", "falso-ok", "falso-publica"]);
    expect(resolver(W, [...hs].reverse()).servidores).toEqual(a);
  });

  it("selo de isolamento por CLI: Claude duro, Codex/OpenCode parcial, Gemini nenhum", () => {
    expect(isolamentoPorCli()).toEqual({ claude: "duro", codex: "parcial", opencode: "parcial", gemini: "nenhum" });
  });
});

describe("consentimento por versão (achado da auditoria A-1)", () => {
  const hs = [hab("falso-ok", "workspace", "w1"), hab("falso-publica", "workspace", "w1")];
  it("comando do catálogo mudou depois do consentimento: o servidor sai do Pane até reconsentir (nunca roda o que a pessoa não leu)", () => {
    const instalados = new Map([inst("falso-ok", { comando_hash: "hash-de-uma-versao-antiga" }), inst("falso-publica")]);
    const r = resolverServidoresLoja(W, { habilitacoes: hs, catalogo: cat, instalados, definidas: new Map() });
    expect(r.servidores).toEqual(["falso-publica"]);
    expect(motivos(r)).toEqual({ "falso-ok": "reconsentimento_pendente" });
  });
  it("hash igual ao do catálogo atual: entra normalmente", () => {
    expect(resolver(W, hs).servidores).toEqual(["falso-ok", "falso-publica"]);
  });
  it("qualquer campo do consentimento muda o hash: versão, args, url, riscos e autenticação", () => {
    const e = cat.porId.get("falso-ok")!.entrada;
    const base = hashDoComando(e);
    const variantes = [
      { ...e, instalacao: { ...e.instalacao, versao: "9.9.9" } },
      { ...e, args: [...e.args, "--novo"] },
      { ...e, url: "https://outro.example/mcp" },
      { ...e, riscos: [...e.riscos, "execucao_codigo" as const] },
      { ...e, autenticacao: e.autenticacao === "nenhuma" ? ("chave_api" as const) : ("nenhuma" as const) },
    ];
    for (const v of variantes) expect(hashDoComando(v as typeof e)).not.toBe(base);
    // a ordem dos riscos não muda o hash (conjunto)
    expect(hashDoComando({ ...e, riscos: [...e.riscos].reverse() } as typeof e)).toBe(base);
  });
});


describe("perfil do membro de squad (Fase 7): `mcps_permitidos` só ESTREITA", () => {
  const hs = [hab("falso-ok", "workspace", "w1"), hab("falso-publica", "workspace", "w1"), hab("falso-ok", "missao", "m1"), hab("falso-publica", "missao", "m1")];
  const alvo = { ...W, missao: "m1", modo: "squad" as const };
  it("lista do membro = interseção com as habilitações; id fora das habilitações nunca entra", () => {
    const r = resolver({ ...alvo, membro_mcps: ["falso-ok", "context7"] }, hs);
    expect(r.servidores).toEqual(["falso-ok"]);
    expect(motivos(r)).toMatchObject({ "falso-publica": "fora_do_perfil_do_membro" });
  });
  it("sem lista (ausente, nula ou vazia) não restringe nem amplia", () => {
    for (const membro_mcps of [undefined, null, []]) expect(resolver({ ...alvo, ...(membro_mcps === undefined ? {} : { membro_mcps }) }, hs).servidores).toEqual(["falso-ok", "falso-publica"]);
  });
  it("lista do membro NÃO abre o que a Missão deny-by-default não liberou", () => {
    expect(resolver({ ...W, missao: "m1", modo: "squad", membro_mcps: ["falso-ok"] }, [hab("falso-ok", "workspace", "w1")]).servidores).toEqual([]);
  });
});

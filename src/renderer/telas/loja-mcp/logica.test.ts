import { describe, expect, it } from "vitest";
import {
  acaoPrimaria, avisosDoDiagnostico, confirmacaoConfere, criarIndiceCartoes, FILTROS_VAZIOS, filtrarCartoes, formatarLatencia, mensagemDoCodigo, mensagemDoErro,
  problemaDoValor, rascunhoDeEntrada, resumoSaude, riscoMaximo, seloAutenticacao, temFiltroAtivo,
} from "./logica";
import { cartao, CARTOES_PADRAO, DIAGNOSTICO_OK, instalado } from "./fabrica-teste";

const ids = (l: ReadonlyArray<{ id: string }>): string[] => l.map((c) => c.id);

describe("filtrarCartoes (busca local sobre o cache)", () => {
  const tabela: Array<[string, Partial<typeof FILTROS_VAZIOS>, string[]]> = [
    ["sem filtro mantém a ordem do catálogo", {}, ["context7", "deepwiki", "playwright", "sentry", "pago", "duvida"]],
    ["busca por nome", { busca: "playwright" }, ["playwright"]],
    ["busca sem acento e sem caixa", { busca: "SERVICO" }, ["pago"]],
    ["busca por id", { busca: "deepwiki" }, ["deepwiki"]],
    ["busca por descrição", { busca: "Descrição do sentry" }, ["sentry"]],
    ["categoria", { categoria: "navegador_testes" }, ["playwright"]],
    ["instalável exclui não confirmado", { instalavel: true }, ["context7", "deepwiki", "playwright", "sentry", "pago"]],
    ["instalado", { instalado: true }, ["sentry"]],
    ["grátis inclui plano grátis e exclui pago", { gratuito: true }, ["context7", "deepwiki", "playwright", "sentry", "duvida"]],
    ["no Kit", { noKit: true }, ["context7", "deepwiki"]],
    ["combinação: instalável + grátis + categoria", { instalavel: true, gratuito: true, categoria: "documentacao_conhecimento" }, ["context7", "deepwiki"]],
    ["busca sem resultado", { busca: "zzzzzz" }, []],
  ];
  it.each(tabela)("%s", (_n, f, esperado) => {
    expect(ids(filtrarCartoes(CARTOES_PADRAO, { ...FILTROS_VAZIOS, ...f }))).toEqual(esperado);
  });
  it("usa o índice pré-computado (mesmo resultado)", () => {
    const indice = criarIndiceCartoes(CARTOES_PADRAO);
    expect(ids(filtrarCartoes(CARTOES_PADRAO, { ...FILTROS_VAZIOS, busca: "context" }, indice))).toEqual(["context7"]);
  });
  it("2 000 entradas sintéticas: uma tecla fica dentro do orçamento de 16 ms (folga x5 para CI)", () => {
    const muitos = Array.from({ length: 2000 }, (_v, i) => cartao(`srv-${i}`, { nome: `Servidor ${i} de teste`, descricao_pt: `faz a coisa numero ${i}` }));
    const indice = criarIndiceCartoes(muitos);
    filtrarCartoes(muitos, { ...FILTROS_VAZIOS, busca: "serv" }, indice); // aquece
    const t0 = performance.now();
    filtrarCartoes(muitos, { ...FILTROS_VAZIOS, busca: "coisa 19" }, indice);
    expect(performance.now() - t0).toBeLessThan(80);
  });
  it("temFiltroAtivo", () => {
    expect(temFiltroAtivo(FILTROS_VAZIOS)).toBe(false);
    expect(temFiltroAtivo({ ...FILTROS_VAZIOS, busca: " x " })).toBe(true);
    expect(temFiltroAtivo({ ...FILTROS_VAZIOS, noKit: true })).toBe(true);
  });
});

describe("acaoPrimaria (um botão por estado)", () => {
  const base = cartao("x");
  it("não instalado e instalável: Instalar", () => expect(acaoPrimaria(base, false, false, false)).toMatchObject({ tipo: "instalar", rotulo: "Instalar", desabilitada: false }));
  it("somente leitura desabilita Instalar com motivo", () => expect(acaoPrimaria(base, false, false, true)).toMatchObject({ tipo: "instalar", desabilitada: true }));
  it("não confirmado: sem botão de instalar", () => {
    const a = acaoPrimaria(cartao("y", { confirmado: false, instalavel: false, motivo_nao_instalavel: "n/c" }), false, false, false);
    expect(a).toMatchObject({ tipo: "nenhuma", rotulo: "Não confirmado", desabilitada: true, motivo: "n/c" });
  });
  it("descartado confirmado mas não instalável: Indisponível", () => expect(acaoPrimaria(cartao("z", { instalavel: false }), false, false, false).rotulo).toBe("Indisponível"));
  it("instalando (evento local ou estado)", () => {
    expect(acaoPrimaria(base, false, true, false)).toMatchObject({ tipo: "instalando", rotulo: "Instalando…", desabilitada: true });
    expect(acaoPrimaria(cartao("w", { instalado: instalado({ estado: "instalando" }) }), false, false, false).tipo).toBe("instalando");
  });
  it("falhou: Tentar de novo", () => expect(acaoPrimaria(cartao("f", { instalado: instalado({ estado: "falhou" }) }), false, false, false).tipo).toBe("tentar_de_novo"));
  it("precisa configurar vence atualizar e habilitar", () => {
    expect(acaoPrimaria(cartao("c", { instalado: instalado({ atualizacao_disponivel: true }), precisa_configurar: true }), false, false, false).tipo).toBe("configurar");
  });
  it("atualização disponível", () => expect(acaoPrimaria(cartao("u", { instalado: instalado({ atualizacao_disponivel: true }) }), false, false, false).tipo).toBe("atualizar"));
  it("instalado e configurado: Habilitar, ou Gerenciar quando já habilitado no workspace", () => {
    const c = cartao("h", { instalado: instalado() });
    expect(acaoPrimaria(c, false, false, false).tipo).toBe("habilitar");
    expect(acaoPrimaria(c, true, false, false).tipo).toBe("gerenciar");
  });
});

describe("riscos, selos e formatação", () => {
  it("risco máximo segue a ordem de severidade", () => {
    expect(riscoMaximo(["rede_saida", "execucao_codigo"])).toMatchObject({ id: "execucao_codigo", tom: "alerta" });
    expect(riscoMaximo(["rede_saida", "segredos"])?.id).toBe("segredos");
    expect(riscoMaximo([])).toBeNull();
    expect(riscoMaximo(["desconhecido"])?.id).toBe("desconhecido");
  });
  it("selo de autenticação", () => {
    expect(seloAutenticacao({ autenticacao: "oauth", pede_chave: false })).toBe("OAuth pela CLI");
    expect(seloAutenticacao({ autenticacao: "chave_api", pede_chave: true })).toBe("pede chave");
    expect(seloAutenticacao({ autenticacao: "nenhuma", pede_chave: false })).toBeNull();
  });
  it("latência e saúde", () => {
    expect(formatarLatencia(420)).toBe("420 ms");
    expect(formatarLatencia(1500)).toBe("1.5 s");
    expect(formatarLatencia(null)).toBe("—");
    expect(resumoSaude(null).rotulo).toBe("não testado");
    expect(resumoSaude({ estado: "ok", testado_em: "x", latencia_ms: 420, n_ferramentas: 5, erro_codigo: null }).rotulo).toBe("ok · 5 ferramentas · 420 ms");
    expect(resumoSaude({ estado: "indisponivel", testado_em: "x", latencia_ms: null, n_ferramentas: null, erro_codigo: "timeout" }).tom).toBe("alerta");
  });
});

describe("mensagens nominais e validações locais", () => {
  it("código conhecido vira texto em português; desconhecido vira o padrão (nunca o código cru)", () => {
    expect(mensagemDoCodigo("nao_configurado")).toMatch(/variáveis obrigatórias/);
    expect(mensagemDoCodigo("codigo_inventado")).toBe("Não foi possível concluir a operação.");
    expect(mensagemDoCodigo(null, "outro")).toBe("outro");
  });
  it("erro com caminho, quebra de linha ou texto longo vira genérico", () => {
    expect(mensagemDoErro(new Error("falha curta"))).toBe("falha curta");
    expect(mensagemDoErro(new Error("ENOENT /Users/x/.npm/foo"))).toBe("Não foi possível concluir a operação.");
    expect(mensagemDoErro(new Error("a\nb"))).toBe("Não foi possível concluir a operação.");
    expect(mensagemDoErro("string")).toBe("Não foi possível concluir a operação.");
  });
  it("confirmação digitada exige o nome exato", () => {
    expect(confirmacaoConfere("ev_x", "ev_x")).toBe(true);
    expect(confirmacaoConfere("  ev_x ", "ev_x")).toBe(true);
    expect(confirmacaoConfere("EV_X", "ev_x")).toBe(false);
    expect(confirmacaoConfere("", "")).toBe(false);
  });
  it("valor de variável: vazio, quebra de linha e > 4 KB são recusados", () => {
    expect(problemaDoValor("")).not.toBeNull();
    expect(problemaDoValor("a\nb")).not.toBeNull();
    expect(problemaDoValor("x".repeat(4097))).toMatch(/4 KB/);
    expect(problemaDoValor("x".repeat(4096))).toBeNull();
    expect(problemaDoValor("valor-ok")).toBeNull();
  });
});

describe("avisosDoDiagnostico (npm/uv ausentes)", () => {
  const cartoes = [cartao("a", { metodo: "npm" }), cartao("b", { metodo: "uvx" })];
  it("tudo presente: nenhum aviso; sem diagnóstico: nenhum aviso", () => {
    expect(avisosDoDiagnostico(DIAGNOSTICO_OK, cartoes)).toEqual([]);
    expect(avisosDoDiagnostico(null, cartoes)).toEqual([]);
  });
  it("npm ausente e uv ausente geram avisos acionáveis", () => {
    const a = avisosDoDiagnostico({ ...DIAGNOSTICO_OK, npm: { ok: false, versao: null }, uv: { ok: false, versao: null } }, cartoes);
    expect(a.map((x) => x.id)).toEqual(["npm", "uv"]);
    expect(a[0]?.texto).toMatch(/Instale o Node/);
  });
  it("só avisa de npm se há servidor npm instalável", () => {
    expect(avisosDoDiagnostico({ ...DIAGNOSTICO_OK, npm: { ok: false, versao: null } }, [cartao("r", { metodo: "remoto" })])).toEqual([]);
  });
  it("cofre indisponível", () => {
    expect(avisosDoDiagnostico({ ...DIAGNOSTICO_OK, cofre: { disponivel: false } }, cartoes).map((x) => x.id)).toEqual(["cofre"]);
  });
});

describe("rascunhoDeEntrada (Sugerir ao catálogo)", () => {
  const c = { nome: "io.github.acme/Meu-Docs", descricao: "Servidor de docs", versao: "9.9.9", repositorio: "https://github.com/acme/docs", namespace_verificado: true, transportes: ["stdio"], curado: false as const, instalavel: false as const };
  it("sempre não confirmado, sem versão, integridade nem comando; slug válido do catálogo", () => {
    const e = JSON.parse(rascunhoDeEntrada(c, "2026-10-01")) as Record<string, any>;
    expect(e.confirmado).toBe(false);
    expect(e.comando).toBeNull();
    expect(e.url).toBeNull();
    expect(e.args).toEqual([]);
    expect(e.instalacao).toMatchObject({ versao: null, integridade: null, pacote: null });
    expect(e.id).toMatch(/^[a-z0-9][a-z0-9-]{0,47}$/);
    expect(e.mantenedor).toBe("oficial");
    expect(e.fontes[0].consultado_em).toBe("2026-10-01");
    expect(JSON.stringify(e)).not.toContain("9.9.9");
  });
});

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResultadoDisparo } from "../../../compartilhado/dominio";
import { criarStoreGeracao } from "../../estado/contexto-geracao";
import { criarStoreRigidez } from "../../estado/rigidez";
import { WS, criarStoreFalso, estadoSuite } from "../../estado/suite-fixtures";
import { PRODUTO } from "../../../nucleo/produto";
import { CONTEXTOS } from "../../../nucleo/metodo/contexto";
import { CATALOGO_SUITE } from "../../../nucleo/suite/catalogo";
import { ContextoProjeto, jaConfirmouGeracao } from "./ContextoProjeto";
import { indice } from "./fabrica";
import { Instalacao } from "./Instalacao";

const TODAS = CATALOGO_SUITE.map((c) => c.nome);
const NADA = { convencoes: false, perfil_legado: false, design_system: false, produto: false, hooks: false, lock: true, memoria: false };
const ok = (c: string): ResultadoDisparo => ({ ok: true, pane_id: "pane_1", comando: c, motivo: null });

beforeEach(() => { try { localStorage.clear(); } catch { /* ok */ } });
afterEach(() => cleanup());

async function montarInstalacao(i = indice([], { camadas: NADA }), suite = estadoSuite("completa", { skills_presentes: TODAS })) {
  const m = criarStoreFalso(suite);
  const rigidez = criarStoreRigidez({ api: () => undefined });
  render(<Instalacao indice={i} workspaceId={WS} store={m.store} rigidez={rigidez} />);
  await screen.findByRole("list", { name: "Módulos" });
  return { ...m, rigidez };
}
const linha = (id: string): HTMLElement => document.querySelector<HTMLElement>(`[data-contexto="${id}"]`) as HTMLElement;

describe("aba Instalação: dois blocos e textos honestos", () => {
  it("separa 'Instalação' (suíte) de 'Contexto do projeto' (o que o método gera) e some com os textos da v1", async () => {
    await montarInstalacao();
    expect(screen.getByRole("heading", { name: "Instalação" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Contexto do projeto" })).toBeTruthy();
    const texto = document.body.textContent ?? "";
    for (const velho of [/Para instalar, rode/, /O app só mostra o comando/, /Camadas do método/, /não instalada —/, /Hooks \(somente leitura\)/, /Este app não edita esse arquivo/, /Faltam \d+ camada/]) expect(texto).not.toMatch(velho);
  });

  it("bloco A: versão, skills presentes de 9, módulos ativos N de 9 com atalho para os módulos", async () => {
    await montarInstalacao();
    const a = document.querySelector('[data-bloco="instalacao"]') as HTMLElement;
    const resumo = a.querySelector(".inst-resumo") as HTMLElement;
    expect(resumo.textContent).toMatch(/Versão instalada:?\s*0\.9\.0/);
    expect(resumo.textContent).toMatch(/Skills presentes:?\s*9 de 9/);
    await waitFor(() => expect(resumo.textContent).toMatch(/Módulos ativos:?\s*8 de 9/));
    expect(within(resumo).getByRole("button", { name: /Ajustar em Módulos da suíte/ })).toBeTruthy();
    expect(a.querySelector('[aria-label="Módulos da suíte"]')).not.toBeNull();
  });

  it("suíte incompleta: conta as skills que faltam e mantém o botão de reparar do assistente", async () => {
    await montarInstalacao(indice([], { camadas: NADA }), estadoSuite("incompleta", { skills_presentes: TODAS.slice(0, 7), skills_faltando: TODAS.slice(7), motivo: "faltam 2 skills" }));
    expect(document.querySelector(".inst-resumo")?.textContent).toMatch(/7 de 9/);
    expect(screen.getByRole("button", { name: /Reparar suíte ExpxDev/ })).toBeTruthy();
  });

  it("alerta de expx_schema continua aparecendo", async () => {
    await montarInstalacao(indice([], { camadas: NADA, rejeicoes: [{ caminho: "docs/x/PLANO.md", motivo: "schema_maior" }] }));
    expect(screen.getByRole("alert").textContent).toMatch(/Incompatibilidade de expx_schema/);
  });
});

describe("hooks de proteção (item próprio)", () => {
  it("não ativados: explica, e 'Ativar proteções' só pede à rigidez que abra (nada é escrito aqui)", async () => {
    const { rigidez } = await montarInstalacao();
    const h = document.querySelector(".inst-hooks") as HTMLElement;
    expect(h.textContent).toMatch(/Não ativados/);
    expect(h.textContent).toMatch(/Hooks de proteção bloqueiam segredo no commit e git perigoso; o instalador não os liga/);
    expect(rigidez.obter().pedidoAbrir).toBe(0);
    fireEvent.click(within(h).getByRole("button", { name: /Ativar proteções/ }));
    expect(rigidez.obter().pedidoAbrir).toBe(1);
  });

  it("ativados: mostra 'Ativados' e 'Ver a rigidez'; 'Ver o que são' lista os hooks com o modo", async () => {
    await montarInstalacao(indice([], { camadas: { ...NADA, hooks: true } }));
    const h = document.querySelector(".inst-hooks") as HTMLElement;
    expect(h.textContent).toMatch(/Ativados/);
    expect(within(h).getByRole("button", { name: /Ver a rigidez/ })).toBeTruthy();
    expect(within(h).getByText("Ver o que são")).toBeTruthy();
    expect(within(h).getByText("segredo-no-commit").closest("li")?.textContent).toContain("bloqueio");
    expect(within(h).getByText("tdd-teste-antes").closest("li")?.textContent).toContain("aviso");
  });

  it("sem o método instalado (sem lock) o botão fica desabilitado com a razão", async () => {
    await montarInstalacao(indice([], { camadas: { ...NADA, lock: false } }), estadoSuite("ausente"));
    const b = screen.getByRole("button", { name: /Ativar proteções/ }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(document.querySelector(".inst-hooks")?.textContent).toMatch(/depois de instalar a suíte/);
  });
});

describe("bloco B: contexto do projeto", () => {
  async function montarContexto(i = indice([], { camadas: NADA }), disparar = vi.fn(async (p: { gesto: string }) => ok(`/expx:${p.gesto}`)), suite = estadoSuite("completa", { skills_presentes: TODAS })) {
    const m = criarStoreFalso(suite);
    const geracao = criarStoreGeracao({ disparar: disparar as never });
    const r = render(<ContextoProjeto workspaceId={WS} indice={i} store={m.store} geracao={geracao} />);
    await waitFor(() => expect(m.api.modulosEstado).toHaveBeenCalled());
    await m.store.garantirModulos(WS);
    await m.store.garantirEstado(WS);
    return { ...m, geracao, disparar, ...r, i };
  }

  it("nada gerado: linhas com nome simples, para que serve, 'Ainda não gerado', comando mono copiável e resumo '0 de 4'", async () => {
    await montarContexto();
    await waitFor(() => expect(screen.getByText(/nada gerado ainda \(0 de 4\)/)).toBeTruthy());
    const lista = screen.getByRole("list", { name: "Contexto do projeto" });
    expect(lista.querySelectorAll("li")).toHaveLength(5);
    const conv = linha("convencoes");
    expect(conv.textContent).toMatch(/Convenções do stack/);
    expect(conv.textContent).toMatch(/Descobre as convenções do seu código para os agentes seguirem/);
    expect(conv.textContent).toMatch(/Ainda não gerado/);
    expect(conv.querySelector("code")?.textContent).toBe("/expx:stackx-detectar");
    expect(within(conv).getByRole("button", { name: "Gerar Convenções do stack agora" })).toBeTruthy();
    expect(within(conv).getByRole("button", { name: /Copiar o comando de Convenções do stack/ })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/não instalada/);
  });

  it("parcial: gerado com data de modificação, resumo '2 de 4 gerados' e 'Gerar o que falta' com a ordem", async () => {
    await montarContexto(indice([], { camadas: { ...NADA, convencoes: true, memoria: true }, camadas_mtime: { convencoes: "2026-03-04T12:00:00.000Z" } }));
    await waitFor(() => expect(screen.getByText("Contexto do projeto: 2 de 4 gerados")).toBeTruthy());
    expect(linha("convencoes").textContent).toMatch(/Gerado/);
    expect(linha("convencoes").textContent).toMatch(/atualizado em 0[34]\/03\/2026/);
    expect(linha("memoria").textContent).toMatch(/Gerado/);
    expect(within(linha("convencoes")).queryByRole("button", { name: /Gerar/ })).toBeNull();
    const seq = screen.getByRole("button", { name: "Gerar o que falta (2)" });
    expect(seq.parentElement?.textContent).toMatch(/Contexto de produto → Design system/);
  });

  it("tudo gerado: resumo e nenhum botão de gerar", async () => {
    await montarContexto(indice([], { camadas: { ...NADA, convencoes: true, design_system: true, produto: true, memoria: true } }));
    await waitFor(() => expect(screen.getByText(/todos os 4 gerados/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Gerar/ })).toBeNull();
  });

  it("legadox desligado: 'Desligado — módulo legadox desligado' com 'Ligar módulo', sem 'Gerar'; ligar chama o main", async () => {
    const m = await montarContexto();
    await waitFor(() => expect(linha("perfil_legado").textContent).toMatch(/Desligado — módulo legadox desligado/));
    expect(within(linha("perfil_legado")).queryByRole("button", { name: /Gerar/ })).toBeNull();
    fireEvent.click(within(linha("perfil_legado")).getByRole("button", { name: "Ligar o módulo legadox" }));
    await waitFor(() => expect(m.api.modulosDefinir).toHaveBeenCalledWith(WS, "legadox", true, false));
    await waitFor(() => expect(linha("perfil_legado").textContent).toMatch(/Ainda não gerado/));
  });

  it("suíte ausente: tudo 'Indisponível' e sem botões de gerar", async () => {
    await montarContexto(indice([], { camadas: NADA }), undefined, estadoSuite("ausente"));
    await waitFor(() => expect(linha("convencoes").textContent).toMatch(/Indisponível: suíte não instalada ou módulo ausente/));
    expect(screen.queryByRole("button", { name: /Gerar/ })).toBeNull();
    expect(screen.getByText(/nada disponível para gerar agora/)).toBeTruthy();
  });

  it("primeira vez pede confirmação ('abre um agente e consome tokens'); cancelar não dispara; confirmar dispara e lembra", async () => {
    const m = await montarContexto();
    await waitFor(() => expect(linha("produto").textContent).toMatch(/Ainda não gerado/));
    const gerar = () => within(linha("produto")).getByRole("button", { name: "Gerar Contexto de produto agora" });
    expect(jaConfirmouGeracao()).toBe(false);
    fireEvent.click(gerar());
    const d = screen.getByRole("dialog");
    expect(d.textContent).toMatch(/Isto abre um agente e consome tokens da sua CLI/);
    expect(d.textContent).toMatch(/\/expx:prodx-produto/);
    fireEvent.click(within(d).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(m.disparar).not.toHaveBeenCalled();
    expect(jaConfirmouGeracao()).toBe(false);

    fireEvent.click(gerar());
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Abrir agente e gerar" }));
    await waitFor(() => expect(m.disparar).toHaveBeenCalledTimes(1));
    expect(m.disparar.mock.calls[0]?.[0]).toMatchObject({ workspace_id: WS, gesto: "gerar_produto", argumento: null, pane_id: null, trabalho_id: null });
    expect(jaConfirmouGeracao()).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(/Gerando 1 de 1: Contexto de produto\. Aguardando o arquivo docs\/produto\/PRODUTO\.md/);
  });

  it("depois de confirmada uma vez, 'Gerar agora' dispara direto e o fim vem pelo arquivo no índice", async () => {
    localStorage.setItem(`${PRODUTO.id}.metodo.gerar_contexto_confirmado`, "1");
    const m = await montarContexto();
    await waitFor(() => expect(linha("convencoes").textContent).toMatch(/Ainda não gerado/));
    fireEvent.click(within(linha("convencoes")).getByRole("button", { name: "Gerar Convenções do stack agora" }));
    await waitFor(() => expect(m.disparar).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    // enquanto roda, os outros "Gerar agora" ficam desabilitados e a linha mostra o andamento
    expect(linha("convencoes").textContent).toMatch(/Gerando agora/);
    expect((within(linha("produto")).getByRole("button", { name: "Gerar Contexto de produto agora" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { await m.geracao.indiceMudou(WS, { ...NADA, convencoes: true }); });
    expect(screen.getByText(/Pronto: 1 gerado\./)).toBeTruthy();
  });

  it("'Gerar o que falta' dispara UM por vez, só os módulos ligados, com progresso aria-live, 'Pular este' e 'Cancelar'", async () => {
    const m = await montarContexto();
    await waitFor(() => screen.getByRole("button", { name: "Gerar o que falta (4)" }));
    fireEvent.click(screen.getByRole("button", { name: "Gerar o que falta (4)" }));
    const d = screen.getByRole("dialog");
    expect(d.textContent).toMatch(/um de cada vez/);
    expect(d.textContent).not.toMatch(/legadox-perfil/);
    fireEvent.click(within(d).getByRole("button", { name: "Abrir agente e gerar" }));
    await waitFor(() => expect(m.disparar).toHaveBeenCalledTimes(1));
    const vivo = screen.getByRole("status");
    expect(vivo.getAttribute("aria-live")).toBe("polite");
    expect(vivo.textContent).toMatch(/Gerando 1 de 4: Convenções do stack/);
    expect((vivo.querySelector("progress") as HTMLProgressElement).max).toBe(4);

    await act(async () => { await m.geracao.indiceMudou(WS, { ...NADA, convencoes: true }); });
    expect(m.disparar).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status").textContent).toMatch(/Gerando 2 de 4: Contexto de produto/);
    expect(linha("memoria").textContent).toMatch(/Na fila/);

    fireEvent.click(screen.getByRole("button", { name: "Pular este" }));
    await waitFor(() => expect(m.disparar).toHaveBeenCalledTimes(3));
    expect(m.disparar.mock.calls.map((c) => (c[0] as { gesto: string }).gesto)).toEqual(["gerar_convencoes", "gerar_produto", "gerar_memoria"]);

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByText(/Cancelado\. O agente que já abriu continua no Pane; nada mais será disparado\./)).toBeTruthy();
    await act(async () => { await m.geracao.indiceMudou(WS, { ...NADA, convencoes: true, memoria: true }); });
    expect(m.disparar).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.queryByText(/Cancelado/)).toBeNull();
  });

  it("recusa do main aparece como alerta com o motivo (nada some em silêncio)", async () => {
    localStorage.setItem(`${PRODUTO.id}.metodo.gerar_contexto_confirmado`, "1");
    const m = await montarContexto(undefined, vi.fn(async () => ({ ok: false, pane_id: null, comando: null, motivo: "Nenhuma CLI compatível com os comandos do método está instalada." })) as never);
    await waitFor(() => expect(linha("memoria").textContent).toMatch(/Ainda não gerado/));
    fireEvent.click(within(linha("memoria")).getByRole("button", { name: "Gerar Memória do projeto agora" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Não foi possível gerar Memória do projeto: Nenhuma CLI compatível/));
    expect(m.geracao.obter().fase).toBe("falhou");
  });

  it("lista semântica: cada camada tem um botão com nome claro e o nome não repete o do vizinho", async () => {
    await montarContexto();
    await waitFor(() => screen.getByRole("list", { name: "Contexto do projeto" }));
    const nomes = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "");
    for (const c of CONTEXTOS.filter((x) => x.id !== "perfil_legado")) expect(nomes).toContain(`Gerar ${c.nome} agora`);
  });
});

// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiRelatorios, EventoRelatoriosIpc } from "../../../compartilhado/relatorios";
import { formatar, varrer } from "../../a11y/varredura";
import { pedirRelatorios } from "../../estado/relatorios-acoes";
import { TelaRelatorios } from "./Relatorios";
import { CANAL_OFF, PACOTE, SPRINT, WS, apiFalsa, detalheFalso, type OpcoesApi } from "./fabrica-teste";

afterEach(() => { vi.restoreAllMocks(); });

type Espia = { [K in keyof ApiRelatorios]: ReturnType<typeof vi.fn> & ApiRelatorios[K] } & { emitir: (e: EventoRelatoriosIpc) => void };
function espiar(o: OpcoesApi = {}): Espia {
  const api = apiFalsa(o);
  let ouvinte: (e: EventoRelatoriosIpc) => void = () => undefined;
  api.assinar = (cb) => { ouvinte = cb; return () => undefined; };
  for (const k of Object.keys(api) as Array<keyof ApiRelatorios>) if (k !== "assinar") (api as unknown as Record<string, unknown>)[k] = vi.fn(api[k] as never);
  return Object.assign(api, { emitir: (e: EventoRelatoriosIpc) => act(() => ouvinte(e)) }) as unknown as Espia;
}
async function montar(api: Espia, ws: string | null = WS) {
  await act(async () => { render(<TelaRelatorios api={api} workspaceId={ws} />); });
  if (ws !== null) await screen.findByRole("tablist", { name: "Seções dos relatórios" });
}
const clicar = (el: HTMLElement) => act(async () => { fireEvent.click(el); });
const aba = (nome: string) => clicar(screen.getByRole("tab", { name: nome }));
const confere = (onde: string) => { const a = varrer(document.body); expect(a.length === 0 ? "" : `${onde}\n${formatar(a)}`).toBe(""); };

describe("casca", () => {
  it("uma linha de controles com as 4 abas, sprint e Gerar; lista de pacotes; sem violação de acessibilidade", async () => {
    await montar(espiar());
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Pacotes", "Revisão", "Divulgação", "Config"]);
    expect(screen.getAllByRole("toolbar")).toHaveLength(1);
    expect(screen.getByLabelText("Sprint")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Gerar/ })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Pacotes de entrega" })).toBeTruthy();
    expect(screen.getByRole("tabpanel")).toBeTruthy();
    await screen.findByTitle(/Prévia: Relatório do usuário/);
    confere("pacotes");
  });
  it("sem projeto aberto e sem recurso do app: estados vazios explicam o próximo passo", async () => {
    await montar(espiar(), null);
    expect(screen.getByText("Nenhum projeto aberto")).toBeTruthy();
    cleanup();
    await act(async () => { render(<TelaRelatorios workspaceId="ws_x" />); });
    expect(screen.getByText("Relatórios indisponíveis")).toBeTruthy();
  });
  it("sem pacote: o vazio diz o que fazer (fechar sprint ou escolher sprint e gerar)", async () => {
    await montar(espiar({ vazio: true }));
    expect(await screen.findByText("Nenhum pacote ainda")).toBeTruthy();
    expect(screen.getByText(/Feche uma sprint na Gestão ágil/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Gerar/ }) as HTMLButtonElement).disabled).toBe(true);
    confere("vazio");
  });
  it("erro ao carregar mostra o texto limpo e Tentar de novo refaz", async () => {
    const api = espiar();
    api.configLer.mockRejectedValueOnce(new Error("[unavailable] Falha interna nos relatórios."));
    await montar(api).catch(() => undefined);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Falha interna nos relatórios.");
    expect(screen.getByRole("alert").textContent).not.toContain("[unavailable]");
    await clicar(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(api.configLer).toHaveBeenCalledTimes(2));
  });
  it("setas movem a seleção das abas (teclado) e a paleta pede a aba", async () => {
    await montar(espiar());
    const primeira = screen.getByRole("tab", { name: "Pacotes" });
    primeira.focus();
    await act(async () => { fireEvent.keyDown(primeira, { key: "ArrowRight" }); });
    expect(screen.getByRole("tab", { name: "Revisão" }).getAttribute("aria-selected")).toBe("true");
    await act(async () => { pedirRelatorios("config"); });
    expect(screen.getByRole("tab", { name: "Config" }).getAttribute("aria-selected")).toBe("true");
  });
  it("evento do main recarrega; falha vira aviso", async () => {
    const api = espiar();
    await montar(api);
    const antes = api.listar.mock.calls.length;
    api.emitir({ tipo: "pronto", workspace_id: WS, pacote_id: PACOTE, sprint_id: SPRINT, versao: 2, quando: "t" });
    await waitFor(() => expect(api.listar.mock.calls.length).toBeGreaterThan(antes));
    api.emitir({ tipo: "pronto", workspace_id: "ws_outro", pacote_id: PACOTE, sprint_id: SPRINT, versao: 2, quando: "t" });
  });
});
const cleanup = (): void => { document.body.innerHTML = ""; };

describe("gerar e estados do pacote", () => {
  it("Gerar usa a sprint escolhida (ou a mais recente) e seleciona o pacote", async () => {
    const api = espiar();
    await montar(api);
    await clicar(screen.getByRole("button", { name: /Gerar/ }));
    expect(api.gerar).toHaveBeenCalledWith(WS, { tipo: "sprint", sprint_id: SPRINT });
    await act(async () => { fireEvent.change(screen.getByLabelText("Sprint"), { target: { value: "spr_0000000000BBBB" } }); });
    await clicar(screen.getByRole("button", { name: /Gerar/ }));
    expect(api.gerar).toHaveBeenLastCalledWith(WS, { tipo: "sprint", sprint_id: "spr_0000000000BBBB" });
  });
  it("gerando mostra a etapa; falhou mostra o motivo e Tentar de novo regenera", async () => {
    await montar(espiar({ pacote: detalheFalso({ estado: "gerando", etapa: "redigir", arquivos: [] }) }));
    expect((await screen.findAllByText(/Redigindo…/)).length).toBeGreaterThan(0);
    cleanup();
    const api = espiar({ pacote: detalheFalso({ estado: "falhou", arquivos: [], motivo_falha: "disco cheio" }) });
    await montar(api);
    expect(await screen.findByText("disco cheio")).toBeTruthy();
    await clicar(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(api.regenerar).toHaveBeenCalledWith(WS, PACOTE);
  });
});

describe("prévia segura", () => {
  it("HTML vai em iframe com sandbox VAZIO (sem scripts) mesmo com conteúdo malicioso; CSV vai como texto", async () => {
    const mal = `<!doctype html><html><body><script>window.parent.document.title='x'</script><img src=x onerror="alert(1)"></body></html>`;
    await montar(espiar({ previa: mal }));
    const f = (await screen.findByTitle(/Prévia: Relatório do usuário/)) as HTMLIFrameElement;
    expect(f.getAttribute("sandbox")).toBe("");
    expect(f.getAttribute("srcdoc")).toBe(mal);
    expect(document.title).not.toBe("x");
    expect(document.querySelector("script")).toBeNull();
    await act(async () => { fireEvent.change(screen.getByLabelText("Arquivo"), { target: { value: "tasks.csv" } }); });
    expect((await screen.findByLabelText(/Prévia: Tarefas \(CSV\)/)).textContent).toBe("a,b\r\n1,2\r\n");
    expect(document.querySelector("iframe")).toBeNull();
  });
  it("arquivo alterado fora do app avisa e não confia", async () => {
    const api = espiar();
    api.previa.mockResolvedValue({ conteudo: "<html></html>", tipo: "html", bytes: 5, integro: false });
    await montar(api);
    expect((await screen.findAllByRole("alert")).map((a) => a.textContent).join(" ")).toMatch(/alterado fora do aplicativo/);
  });
});

describe("aprovar e exportar (ações humanas)", () => {
  it("aprovar chama o canal e desfazer volta a rascunho; botão desabilitado com motivo quando há problema no texto do cliente", async () => {
    const api = espiar();
    await montar(api);
    await clicar(await screen.findByRole("button", { name: "Aprovar texto do cliente" }));
    expect(api.aprovar).toHaveBeenCalledWith(WS, PACOTE, true);
    cleanup();
    const ruim = espiar({ pacote: detalheFalso({ verificacao: { ok: false, afirmacoes_total: 1, com_fonte: 1, violacoes: [{ regra: "V5", bloco: "u_correcoes", afirmacao_id: null, detalhe: "termo técnico: api" }] } }) });
    await montar(ruim);
    const b = (await screen.findByRole("button", { name: "Aprovar texto do cliente" })) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.title).toMatch(/aba Revisão/);
    cleanup();
    const aprovado = espiar({ pacote: detalheFalso({ revisao_usuario: "aprovado", aprovado_em: "t" }) });
    await montar(aprovado);
    await clicar(await screen.findByRole("button", { name: "Desfazer aprovação" }));
    expect(aprovado.aprovar).toHaveBeenCalledWith(WS, PACOTE, false);
  });
  it("exportar: todos ou só o arquivo aberto, em pasta ou ZIP; o renderer NUNCA envia caminho", async () => {
    const api = espiar();
    await montar(api);
    expect(await screen.findByText(/Exportar tudo inclui arquivos internos/)).toBeTruthy();
    await clicar(await screen.findByRole("button", { name: "Exportar para pasta…" }));
    expect(api.exportar).toHaveBeenLastCalledWith(WS, PACOTE, "todos", "pasta");
    await act(async () => { fireEvent.change(screen.getByLabelText("O que exportar"), { target: { value: "um" } }); });
    await clicar(screen.getByRole("button", { name: "Exportar ZIP…" }));
    expect(api.exportar).toHaveBeenLastCalledWith(WS, PACOTE, ["usuario.html"], "zip");
    expect(JSON.stringify(api.exportar.mock.calls)).not.toMatch(/[\\/](Users|home|tmp)/);
  });
  it("regenerar chama o canal e seleciona a versão devolvida", async () => {
    const api = espiar();
    await montar(api);
    await clicar(await screen.findByRole("button", { name: "Regenerar" }));
    expect(api.regenerar).toHaveBeenCalledWith(WS, PACOTE);
  });
});

describe("Revisão do texto do cliente", () => {
  it("lista os blocos, destaca o que precisa de revisão, salva o ajuste e oferece regenerar", async () => {
    const api = espiar();
    await montar(api);
    await aba("Revisão");
    const sec = await screen.findByRole("region", { name: /Correções/ });
    expect(within(sec).getByText(/precisa de revisão/)).toBeTruthy();
    const campo = within(sec).getByRole("textbox") as HTMLTextAreaElement;
    expect(campo.value).toBe("Melhoria na plataforma.");
    await act(async () => { fireEvent.change(campo, { target: { value: "Corrigimos uma falha que atrasava a lista de pedidos." } }); });
    await clicar(within(sec).getByRole("button", { name: "Salvar ajuste" }));
    expect(api.ajusteGravar).toHaveBeenCalledWith(WS, SPRINT, "u_correcoes", "Corrigimos uma falha que atrasava a lista de pedidos.");
    await clicar(await screen.findByRole("button", { name: "Regenerar com os ajustes" }));
    expect(api.regenerar).toHaveBeenCalledWith(WS, PACOTE);
    confere("revisao");
  });
  it("problemas de linguagem do texto do cliente aparecem em destaque; ajustado oferece voltar ao padrão", async () => {
    const api = espiar({ pacote: detalheFalso({ verificacao: { ok: false, afirmacoes_total: 2, com_fonte: 2, violacoes: [{ regra: "V5", bloco: "u_correcoes", afirmacao_id: "u_correcoes.1", detalhe: "termo técnico: api" }] }, blocos_usuario: [{ id: "u_em_resumo", titulo: "Em resumo", texto: "Texto da equipe.", origem: "humano", precisa_revisao: false, ajustado: true }] }) });
    await montar(api);
    await aba("Revisão");
    expect((await screen.findByRole("alert")).textContent).toContain("termo técnico: api");
    await clicar(screen.getByRole("button", { name: "Voltar ao texto padrão" }));
    expect(api.ajusteGravar).toHaveBeenCalledWith(WS, SPRINT, "u_em_resumo", null);
  });
});

describe("Divulgação com consentimento", () => {
  it("variantes com contador e Copiar; sem canal configurado o envio fica bloqueado com o motivo", async () => {
    const copiar = vi.fn(async () => undefined);
    Object.defineProperty(globalThis.navigator, "clipboard", { value: { writeText: copiar }, configurable: true });
    const api = espiar({ fila: [{ id: "env_0000000000AAAA", pacote_id: PACOTE, workspace_id: WS, canal: "telegram", variante: "curta", texto: "texto", estado: "aprovado", criado_em: "t", enviado_em: null, erro: null }], pacote: detalheFalso({ revisao_usuario: "aprovado", aprovado_em: "t" }) });
    await montar(api);
    await aba("Divulgação");
    expect(await screen.findByRole("region", { name: "Variante Curta" })).toBeTruthy();
    expect(screen.getAllByText(/\/280 caracteres|\/600 caracteres|\/1200 caracteres/)).toHaveLength(3);
    await clicar(within(screen.getByRole("region", { name: "Variante Curta" })).getByRole("button", { name: "Copiar" }));
    expect(copiar).toHaveBeenCalledWith(expect.stringContaining("Novidades da versão 2.4.0"));
    const enviar = screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement;
    expect(enviar.disabled).toBe(true);
    expect(enviar.title).toMatch(/não configurado/);
    expect(api.divulgacaoEnviar).not.toHaveBeenCalled();
    confere("divulgacao");
  });
  it("fluxo completo: consentir no canal, colocar na fila, aprovar o item e enviar (nada antes)", async () => {
    const api = espiar({ canais: [{ ...CANAL_OFF, disponivel: true, motivo: "Falta o seu consentimento para enviar por este canal." }], pacote: detalheFalso({ revisao_usuario: "aprovado", aprovado_em: "t" }) });
    await montar(api);
    await aba("Divulgação");
    await screen.findByRole("region", { name: "Variante Média" });
    await clicar(within(screen.getByRole("region", { name: "Variante Média" })).getByRole("button", { name: "Colocar na fila do Telegram" }));
    expect(api.divulgacaoEnfileirar).toHaveBeenCalledWith(WS, PACOTE, "telegram", "media");
    const enviarInicial = (await screen.findByRole("button", { name: "Enviar" })) as HTMLButtonElement;
    expect(enviarInicial.disabled).toBe(true);
    await clicar(screen.getByRole("button", { name: "Aprovar item" }));
    expect(api.divulgacaoAprovar).toHaveBeenCalledWith(WS, "env_0000000000AAAA", true);
    expect((screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement).disabled).toBe(true); // ainda sem consentimento
    await clicar(screen.getByRole("checkbox", { name: /Consinto em enviar por Telegram/ }));
    expect(api.consentimentoCanal).toHaveBeenCalledWith(WS, "telegram", true);
    await waitFor(() => expect((screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement).disabled).toBe(false));
    expect(api.divulgacaoEnviar).not.toHaveBeenCalled();
    await clicar(screen.getByRole("button", { name: "Enviar" }));
    expect(api.divulgacaoEnviar).toHaveBeenCalledWith(WS, "env_0000000000AAAA");
  });
  it("relatório ainda em rascunho: o item não pode ser aprovado", async () => {
    const api = espiar({ fila: [{ id: "env_0000000000AAAA", pacote_id: PACOTE, workspace_id: WS, canal: "telegram", variante: "curta", texto: "t", estado: "rascunho", criado_em: "t", enviado_em: null, erro: null }] });
    await montar(api);
    await aba("Divulgação");
    expect((await screen.findByRole("button", { name: "Aprovar item" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Aprove primeiro o relatório do cliente.")).toBeTruthy();
  });
});

describe("Config", () => {
  it("o padrão é seguro; alterar grava; a IA só com consentimento explícito e revogável", async () => {
    const api = espiar();
    await montar(api);
    await aba("Config");
    expect((screen.getByRole("checkbox", { name: /Gerar o pacote ao fechar a sprint/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Redação do texto") as HTMLSelectElement).value).toBe("template");
    expect((screen.getByRole("checkbox", { name: /Permito enviar esses fatos/ }) as HTMLInputElement).checked).toBe(false);
    await clicar(screen.getByRole("checkbox", { name: /Gerar o pacote ao fechar a sprint/ }));
    expect(api.configGravar).toHaveBeenLastCalledWith(WS, { gerar_ao_fechar: false });
    await act(async () => { fireEvent.change(screen.getByLabelText("Redação do texto"), { target: { value: "auto" } }); });
    expect(api.configGravar).toHaveBeenLastCalledWith(WS, { redacao_modo: "auto" });
    await clicar(screen.getByRole("checkbox", { name: /Permito enviar esses fatos/ }));
    expect(api.consentimentoLlm).toHaveBeenCalledWith(WS, true);
    const h = screen.getByLabelText("Hashtags");
    await act(async () => { fireEvent.change(h, { target: { value: "#novidades, produto" } }); fireEvent.blur(h); });
    expect(api.configGravar).toHaveBeenLastCalledWith(WS, { hashtags: ["novidades", "produto"] });
    confere("config");
  });
});

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiCaptura, ApiVoz, EstadoCaptura, EstadoVoz } from "../../../compartilhado/captura";
import { SecaoVozCaptura } from "./SecaoVozCaptura";
import type { Falso } from "../captura/tipos-teste";

vi.mock("../../estado/captura-acoes", () => ({ pedirCaptura: vi.fn() }));
import { pedirCaptura } from "../../estado/captura-acoes";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const EV: EstadoVoz = {
  motor: "nenhum", comando_executavel: null, comando_args: [], url: null, modelo: null, modelo_local: null, ociosidade_s: 120, idioma: "pt", disparo: "segurar", atalho: "Command+Shift+Space", alternar_global: false,
  motor_pronto: false, consentimento: true, host: null, tem_chave: false, microfone: "indeterminada", ditado: "ocioso", aviso_microfone_visto: false, plataforma: "mac", atalho_erro: null,
};
const EC: EstadoCaptura = { tela: "indeterminada", janela_app: true, plataforma: "mac", aviso_visto: false, fps_padrao: 2, atalhos_globais: false, atalho_regiao: "CommandOrControl+Shift+5", atalho_quadros: "CommandOrControl+Shift+6", gravando_quadros: false, atalho_erro: null };

function fakes(ev: Partial<EstadoVoz> = {}, ec: Partial<EstadoCaptura> = {}) {
  let estadoVoz = { ...EV, ...ev };
  const voz = {
    estado: vi.fn(async () => estadoVoz),
    configGravar: vi.fn(async (p: Record<string, unknown>) => { estadoVoz = { ...estadoVoz, ...p } as EstadoVoz; return estadoVoz; }),
    segredoGravar: vi.fn(async (_n: string, v: string | null) => { estadoVoz = { ...estadoVoz, tem_chave: v !== null }; return { ok: true as const }; }),
    consentir: vi.fn(async (_s: string, _h: string, a: boolean) => { estadoVoz = { ...estadoVoz, consentimento: a }; return { ok: true as const }; }),
    testarMotor: vi.fn(async () => ({ ok: true, latencia_ms: 321, erro: null })),
    pedirMicrofone: vi.fn(async () => { estadoVoz = { ...estadoVoz, microfone: "concedida" }; return { estado: "concedida" as const }; }),
    abrirAjustes: vi.fn(async () => true),
    dicionarioListar: vi.fn(async () => []),
    dicionarioSalvar: vi.fn(async (termo: string, dica: string | null) => [{ termo, dica }]),
    dicionarioRemover: vi.fn(async () => []),
    historicoListar: vi.fn(async () => [{ id: "f1", criado_em: "", texto: "x", injetada: true, codigo: null, duracao_ms: 1 }]),
    historicoLimpar: vi.fn(async () => ({ ok: true as const })),
  } as unknown as Falso<ApiVoz>;
  let estadoCap = { ...EC, ...ec };
  const captura = {
    estado: vi.fn(async () => estadoCap),
    configGravar: vi.fn(async (p: Record<string, unknown>) => { estadoCap = { ...estadoCap, ...p } as EstadoCaptura; return estadoCap; }),
  } as unknown as Falso<ApiCaptura>;
  return { voz, captura };
}
async function montar(f: ReturnType<typeof fakes>) {
  await act(async () => { render(<SecaoVozCaptura voz={f.voz} captura={f.captura} />); });
}

describe("Configurações → Voz e captura", () => {
  it("fora do app mostra um aviso e nada mais", () => {
    render(<SecaoVozCaptura voz={undefined} captura={undefined} />);
    expect(screen.getByText("Disponível no aplicativo desktop.")).toBeTruthy();
  });

  it("nasce desligado: motor nenhum, ditado inexistente, nada pedido ao SO ao abrir a tela", async () => {
    const f = fakes();
    await montar(f);
    expect((screen.getByRole("combobox", { name: "Motor de voz" }) as HTMLSelectElement).value).toBe("nenhum");
    expect(screen.getByText("Motor ainda não configurado.")).toBeTruthy();
    expect(screen.getByText(/Nada é pedido ao abrir esta tela/)).toBeTruthy();
    expect(f.voz.pedirMicrofone).not.toHaveBeenCalled();
    expect(f.voz.configGravar).not.toHaveBeenCalled();
    expect(f.voz.abrirAjustes).not.toHaveBeenCalled();
    expect(f.voz.testarMotor).not.toHaveBeenCalled();
  });

  it("comando local: salva executável, argumentos por linha e modelo; erro do main aparece como alerta", async () => {
    const f = fakes();
    await montar(f);
    await act(async () => { fireEvent.change(screen.getByRole("combobox", { name: "Motor de voz" }), { target: { value: "comando_local" } }); });
    fireEvent.change(screen.getByLabelText(/Executável/), { target: { value: " /opt/whisper " } });
    fireEvent.change(screen.getByLabelText(/Argumentos/), { target: { value: "-f\n{wav}\n\n-l\n{idioma}" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar motor" })); });
    expect(f.voz.configGravar).toHaveBeenCalledWith({ motor: "comando_local", comando_executavel: "/opt/whisper", comando_args: ["-f", "{wav}", "-l", "{idioma}"], modelo: null });
    f.voz.configGravar.mockRejectedValueOnce(new Error("[invalido] Informe o caminho ABSOLUTO do executável."));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar motor" })); });
    expect(screen.getByRole("alert").textContent).toBe("Informe o caminho ABSOLUTO do executável.");
  });

  it("HTTP: consentimento mostra o HOST exato; permitir e revogar chamam o main; a chave nunca volta à tela", async () => {
    const f = fakes({ motor: "http_compativel", url: "https://stt.exemplo.com/v1", host: "stt.exemplo.com", motor_pronto: true, consentimento: false });
    await montar(f);
    const grupo = screen.getByRole("group", { name: "Consentimento de envio de áudio" });
    expect(grupo.textContent).toContain("O áudio será enviado a stt.exemplo.com.");
    await act(async () => { fireEvent.click(within(grupo).getByRole("button", { name: "Permitir envio de áudio a stt.exemplo.com" })); });
    expect(f.voz.consentir).toHaveBeenCalledWith("voz_stt", "stt.exemplo.com", true);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Revogar consentimento para stt.exemplo.com" })); });
    expect(f.voz.consentir).toHaveBeenLastCalledWith("voz_stt", "stt.exemplo.com", false);

    const campo = screen.getByLabelText("Chave do serviço") as HTMLInputElement;
    expect(campo.type).toBe("password");
    fireEvent.change(campo, { target: { value: "SEGREDO-123" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Guardar chave" })); });
    expect(f.voz.segredoGravar).toHaveBeenCalledWith("voz_chave_stt", "SEGREDO-123");
    expect((screen.getByLabelText("Chave do serviço") as HTMLInputElement).value).toBe("");
    expect(document.body.textContent).not.toContain("SEGREDO-123");
    expect(screen.getByText(/Chave guardada: sim/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Remover chave" })); });
    expect(f.voz.segredoGravar).toHaveBeenLastCalledWith("voz_chave_stt", null);
  });

  it("testar motor só com motor pronto e consentimento; mostra a latência", async () => {
    const f = fakes({ motor: "comando_local", comando_executavel: "/x", comando_args: ["{wav}"], motor_pronto: true });
    await montar(f);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Testar motor" })); });
    expect(screen.getByRole("status").textContent).toBe("O motor respondeu em 321 ms.");
    cleanup();
    await montar(fakes());
    expect((screen.getByRole("button", { name: "Testar motor" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("teste de tecla: só salva depois de keydown E keyup; modificador isolado é recusado com explicação", async () => {
    const f = fakes();
    await montar(f);
    const salvar = screen.getByRole("button", { name: "Salvar atalho" }) as HTMLButtonElement;
    expect(salvar.disabled).toBe(true);
    const botao = screen.getByRole("button", { name: "Testar nova tecla" });
    await act(async () => { fireEvent.click(botao); });
    const ativo = screen.getByRole("button", { name: /Pressione e solte/ });
    await act(async () => { fireEvent.keyDown(ativo, { code: "AltRight", key: "Alt", altKey: true }); });
    expect(screen.getByRole("alert").textContent).toMatch(/Option direita/);
    await act(async () => { fireEvent.keyDown(ativo, { code: "KeyV", key: "v", metaKey: true, shiftKey: true }); });
    expect(screen.getByRole("status").textContent).toContain("solte a tecla para confirmar");
    expect(salvar.disabled).toBe(true); // ainda sem keyup
    await act(async () => { fireEvent.keyUp(ativo, { code: "KeyV" }); });
    expect(salvar.disabled).toBe(false);
    await act(async () => { fireEvent.click(salvar); });
    expect(f.voz.configGravar).toHaveBeenCalledWith({ atalho: /Mac|iPhone|iPad/.test(navigator.platform) ? "Command+Shift+V" : "Super+Shift+V" });
  });

  it("permissões: pedir microfone grava o aceite e só então pergunta ao SO; Ajustes abre o painel; tela no macOS manda reabrir", async () => {
    const f = fakes();
    await montar(f);
    expect(screen.getByText(/Gravação de tela:/).textContent).toContain("ainda não pedida");
    expect(screen.getByText(/reabra o app depois de conceder/i)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Pedir permissão do microfone" })); });
    expect(f.voz.configGravar).toHaveBeenCalledWith({ aviso_microfone_visto: true });
    expect(f.voz.pedirMicrofone).toHaveBeenCalledTimes(1);
    expect(f.voz.configGravar.mock.invocationCallOrder[0]).toBeLessThan(f.voz.pedirMicrofone.mock.invocationCallOrder[0] as number);
    const botoes = screen.getAllByRole("button", { name: "Abrir Ajustes do Sistema" });
    await act(async () => { fireEvent.click(botoes[0]!); });
    expect(f.voz.abrirAjustes).toHaveBeenCalledWith("microfone");
    await act(async () => { fireEvent.click(botoes[1]!); });
    expect(f.voz.abrirAjustes).toHaveBeenCalledWith("tela");
  });

  it("dicionário: adicionar e remover; lista vazia diz o que fazer", async () => {
    const f = fakes();
    await montar(f);
    expect(screen.getByText("Nenhum termo ainda.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Termo"), { target: { value: "Supabase" } });
    fireEvent.change(screen.getByLabelText(/Dica de pronúncia/), { target: { value: "super base" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Adicionar" })); });
    expect(f.voz.dicionarioSalvar).toHaveBeenCalledWith("Supabase", "super base");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Remover Supabase" })); });
    expect(f.voz.dicionarioRemover).toHaveBeenCalledWith("Supabase");
  });

  it("acima de 100 termos a lista é virtualizada (poucas linhas no DOM)", async () => {
    const f = fakes();
    f.voz.dicionarioListar.mockResolvedValue(Array.from({ length: 300 }, (_, i) => ({ termo: `termo${i}`, dica: null })));
    await montar(f);
    expect(screen.queryAllByRole("button", { name: /^Remover termo/ }).length).toBeLessThan(40);
  });

  it("histórico em memória: contagem e limpar", async () => {
    const f = fakes();
    await montar(f);
    expect(screen.getByText("1 fala na memória.")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Limpar histórico" })); });
    expect(f.voz.historicoLimpar).toHaveBeenCalled();
    expect(screen.getByText("0 falas na memória.")).toBeTruthy();
  });

  it("captura: fps padrão, atalhos globais OPT-IN com erro explicado e abrir a galeria", async () => {
    const f = fakes();
    await montar(f);
    expect(screen.getByRole("switch", { name: /Atalhos de captura também fora do app: desligada/ })).toBeTruthy();
    await act(async () => { fireEvent.change(screen.getByRole("combobox", { name: "Quadros por segundo" }), { target: { value: "1" } }); });
    expect(f.captura.configGravar).toHaveBeenCalledWith({ fps_padrao: 1 });
    await act(async () => { fireEvent.click(screen.getByRole("switch", { name: /Atalhos de captura/ })); });
    expect(f.captura.configGravar).toHaveBeenCalledWith({ atalhos_globais: true });
    fireEvent.click(screen.getByRole("button", { name: "Abrir capturas" }));
    expect(pedirCaptura).toHaveBeenCalledWith("galeria");
    expect(screen.getByText(/não altera os atalhos do sistema/)).toBeTruthy();
  });

  it("alternar global mostra o erro de atalho em uso", async () => {
    const f = fakes({ alternar_global: true, atalho_erro: "O atalho Command+Shift+Space já está em uso por outro programa." });
    await montar(f);
    expect(screen.getByRole("alert").textContent).toMatch(/já está em uso/);
  });
});

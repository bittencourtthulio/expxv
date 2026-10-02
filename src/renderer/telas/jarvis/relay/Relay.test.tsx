// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatar, varrer } from "../../../a11y/varredura";
import { apiRelayFalsa, dispositivoRelayFalso, estadoRelayFalso, pareamentoRelayFalso } from "../fabrica-teste";
import { AbaRelay } from "./index";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const esperar = (ms = 15) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const clicar = (el: HTMLElement) => act(async () => { fireEvent.click(el); });
const digitar = (el: HTMLElement, v: string) => act(async () => { fireEvent.change(el, { target: { value: v } }); });
const confere = (onde: string) => { const a = varrer(document.body); expect(a.length === 0 ? "" : `${onde}\n${formatar(a)}`).toBe(""); };
async function montar(api = apiRelayFalsa()) {
  await act(async () => { render(<AbaRelay api={api} />); });
  await esperar();
  return api;
}
const ligado = () => estadoRelayFalso({ ligado: true, situacao: "ocioso", url: "wss://relay.exemplo.com" });

describe("aba Relay: acesso", () => {
  it("desligado por padrão: aviso EXPERIMENTAL fixo, estado por forma e texto, consentimento com o que o relay vê e não vê", async () => {
    await montar();
    expect(screen.getByRole("note").textContent).toMatch(/EXPERIMENTAL/);
    expect(screen.getByText(/Desligado/).textContent).toContain("○");
    expect(screen.getByText(/o endereço IP do seu desktop/)).toBeTruthy();
    expect(screen.getByText(/o conteúdo das mensagens/)).toBeTruthy();
    expect(screen.getByText(/ao reiniciar o app/, { exact: false })).toBeTruthy();
    confere("relay desligado");
  });
  it("ligar exige URL wss válida E os dois checkboxes; grava consentimento+reconhecimento antes de ligar", async () => {
    const api = await montar();
    const botao = screen.getByRole("button", { name: "Ligar relay" }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    await digitar(screen.getByLabelText("Endereço do seu relay"), "ws://inseguro.com");
    expect(screen.getByText(/precisa começar com wss/)).toBeTruthy();
    await digitar(screen.getByLabelText("Endereço do seu relay"), "wss://relay.exemplo.com");
    await clicar(screen.getByRole("checkbox", { name: /Li o que o relay vê/ }));
    expect(botao.disabled).toBe(true);
    await clicar(screen.getByRole("checkbox", { name: /EXPERIMENTAL e que a criptografia/ }));
    expect(botao.disabled).toBe(false);
    await clicar(botao);
    await esperar();
    expect(api.configDefinir).toHaveBeenCalledWith({ url: "wss://relay.exemplo.com", consentimento_versao: "relay-1", reconhecimento_experimental: true });
    expect(api.ligar).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Desligar relay" })).toBeTruthy();
  });
  it("erro ao ligar vira texto", async () => {
    const api = apiRelayFalsa({ ligar: { ok: false, motivo: "falhou" } });
    await montar(api);
    await digitar(screen.getByLabelText("Endereço do seu relay"), "wss://relay.exemplo.com");
    await clicar(screen.getByRole("checkbox", { name: /Li o que o relay vê/ }));
    await clicar(screen.getByRole("checkbox", { name: /EXPERIMENTAL e que a criptografia/ }));
    await clicar(screen.getByRole("button", { name: "Ligar relay" }));
    await esperar();
    expect(screen.getByRole("alert").textContent).toMatch(/Não foi possível ligar/);
  });
  it("pânico pede confirmação e só então chama a API", async () => {
    const api = await montar(apiRelayFalsa({ estado: ligado() }));
    await clicar(screen.getByRole("button", { name: "Pânico" }));
    expect(api.panico).not.toHaveBeenCalled();
    await clicar(screen.getByRole("button", { name: /Confirmar pânico/ }));
    await esperar();
    expect(api.panico).toHaveBeenCalledTimes(1);
  });
  it("estados: carregando, erro com nova tentativa e sem API", async () => {
    const api = apiRelayFalsa({ erro: true });
    await montar(api);
    expect(screen.getByRole("alert").textContent).toMatch(/Não foi possível ler/);
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
    cleanup();
    await act(async () => { render(<AbaRelay api={undefined} />); });
    expect(screen.getByText("Relay indisponível")).toBeTruthy();
  });
});

describe("aba Relay: pareamento", () => {
  it("só abre com o relay ligado", async () => {
    await montar();
    expect((screen.getByRole("button", { name: "Parear celular" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Ligue o relay para parear/)).toBeTruthy();
  });
  it("mostra QR (SVG local), código e contagem; SAS só em aguardando_decisao; Permitir envia true; o código não reaparece", async () => {
    const api = await montar(apiRelayFalsa({ estado: ligado() }));
    await clicar(screen.getByRole("button", { name: "Parear celular" }));
    await esperar();
    expect(screen.getByRole("img", { name: /QR Code/ })).toBeTruthy();
    expect(screen.getByLabelText("Código de pareamento").textContent).toBe("ABCD-EFGH-JKLM");
    expect(screen.getByText(/expira em/)).toBeTruthy();
    expect(screen.queryByLabelText("Número de confirmação")).toBeNull();
    api.definir({ sas: { situacao: "aguardando_decisao", sas: "123456", nome_dispositivo: null } });
    await act(async () => { await new Promise((r) => setTimeout(r, 1100)); });
    expect(screen.getByLabelText("Número de confirmação").textContent).toBe("123456");
    expect(screen.queryByLabelText("Código de pareamento")).toBeNull(); // o código já queimou
    confere("pareamento com SAS");
    await clicar(screen.getByRole("button", { name: "Permitir" }));
    await esperar();
    expect(api.parearDecidir).toHaveBeenCalledWith(true);
    expect(screen.queryByLabelText("Código de pareamento")).toBeNull();
    expect(screen.getByText(/Aguardando o celular concluir/)).toBeTruthy();
  }, 10_000);
  it("Recusar envia false, some tudo e informa; Cancelar também fecha", async () => {
    const api = await montar(apiRelayFalsa({ estado: ligado() }));
    await clicar(screen.getByRole("button", { name: "Parear celular" }));
    await esperar();
    await clicar(screen.getByRole("button", { name: "Cancelar" }));
    await esperar();
    expect(api.parearDecidir).toHaveBeenCalledWith(false);
    expect(screen.queryByLabelText("Código de pareamento")).toBeNull();
    expect(screen.getByText(/Pareamento recusado/)).toBeTruthy();
  });
  it("o código some ao expirar e não volta", async () => {
    const api = await montar(apiRelayFalsa({ estado: ligado() }));
    api.definir({ pareamento: pareamentoRelayFalso({ expira_em: new Date(Date.now() + 1500).toISOString() }) });
    await clicar(screen.getByRole("button", { name: "Parear celular" }));
    await esperar();
    expect(screen.getByLabelText("Código de pareamento")).toBeTruthy();
    await act(async () => { await new Promise((r) => setTimeout(r, 2300)); });
    expect(screen.queryByLabelText("Código de pareamento")).toBeNull();
    expect(screen.getByText(/O código expirou/)).toBeTruthy();
  }, 10_000);
  it("erro do host vira texto", async () => {
    const api = await montar(apiRelayFalsa({ estado: ligado() }));
    api.definir({ pareamento: { erro: "ja_pareando" } });
    await clicar(screen.getByRole("button", { name: "Parear celular" }));
    await esperar();
    expect(screen.getByRole("alert").textContent).toMatch(/Já existe um pareamento/);
  });
});

describe("aba Relay: dispositivos", () => {
  it("vazio explica; com itens mostra permissão, transporte e último visto; Revogar pede confirmação", async () => {
    await montar();
    expect(screen.getByText(/Nenhum celular pareado/)).toBeTruthy();
    cleanup();
    const api = await montar(apiRelayFalsa({ estado: ligado(), dispositivos: [dispositivoRelayFalso()] }));
    expect(screen.getByText(/iPhone do Thulio/).parentElement?.textContent).toMatch(/Só leitura · relay · visto/);
    await clicar(screen.getByRole("button", { name: "Revogar iPhone do Thulio" }));
    expect(api.revogar).not.toHaveBeenCalled();
    await clicar(screen.getByRole("button", { name: /Confirmar revogação/ }));
    await esperar();
    expect(api.revogar).toHaveBeenCalledWith("dev_relay1234");
    expect(screen.getByText(/revogado/)).toBeTruthy();
    confere("dispositivos");
  });
  it("guia remete ao arquivo local, sem link de rede", async () => {
    await montar();
    const guia = screen.getByText("Guia de hospedagem do relay").closest("details") as HTMLElement;
    expect(guia.textContent).toContain("deploy/relay/LEIA-ME.md");
    expect(guia.querySelector("a")).toBeNull();
  });
});

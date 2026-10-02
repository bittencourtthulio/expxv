// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResumoSuite } from "../../../compartilhado/suite";
import { PLANO, WS, criarStoreFalso, estadoSuite, progresso } from "../../estado/suite-fixtures";
import ModalSuite, { anuncioDaInstalacao } from "./ModalSuite";

afterEach(() => cleanup());

async function abrir(opc: { plano?: typeof PLANO; estado?: ReturnType<typeof estadoSuite> } = {}) {
  const m = criarStoreFalso(opc.estado ?? estadoSuite("ausente"));
  if (opc.plano !== undefined) m.api.requisitos.mockResolvedValue(opc.plano);
  m.store.ligar();
  await waitFor(() => expect(m.store.obter().estados[WS]).toBeDefined());
  const gatilho = document.createElement("button");
  gatilho.textContent = "gatilho";
  document.body.appendChild(gatilho);
  gatilho.focus();
  m.store.abrirModal();
  render(<ModalSuite store={m.store} />);
  return { ...m, gatilho };
}
const RESUMO: ResumoSuite = { versao: "0.9.0", skills: ["sprintx", "runx", "prodx", "mergex", "stackx", "memox", "legadox", "buildx", "designx"], criados: [".expx/expx-lock.json", ".claude/skills/runx/SKILL.md"], alterados: [], removidos: [], fora_do_esperado: [], truncado: false, doctor: "ok", backup: null, como_restaurar: null, restaurados: [] };

describe("passo 1: o que vai acontecer", () => {
  it("explica em linguagem simples, mostra comando, pasta, arquivos existentes e requisitos com marcas", async () => {
    await abrir();
    const d = await screen.findByRole("dialog", { name: "Instalar a suíte ExpxDev" });
    expect(d.getAttribute("aria-modal")).toBe("true");
    const t = d.textContent ?? "";
    expect(t).toMatch(/todas/);
    expect(within(d).getByRole("list", { name: "Skills da suíte" }).textContent).toMatch(/sprintx.*planeja e executa features novas.*runx/);
    expect(d.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(t).toMatch(/Fora do projeto:.*claude plugin/);
    expect(t).toMatch(/neste projeto/);
    expect(t).toMatch(/\.claude.*\.expx.*\.opencode/);
    expect(t).toMatch(/internet/i);
    expect(t).toMatch(/já existem 3 arquivos em \.claude\/ — serão mantidos/);
    expect(t).toContain("~/Projetos/app");
    expect(within(d).getByLabelText("Comandos que serão executados").textContent).toContain("expxdev@0.9.0");
    const lista = within(d).getByRole("list", { name: "Requisitos verificados" });
    expect(lista.textContent).toMatch(/✓.*Node\.js/);
    expect(lista.textContent).toMatch(/○.*Internet/);
    expect(lista.textContent).toMatch(/ℹ.*Git/);
  });

  it("um só botão primário 'Instalar agora' e 'Cancelar'; instalar só no clique", async () => {
    const m = await abrir();
    const d = await screen.findByRole("dialog");
    expect(d.querySelectorAll(".botao-primario")).toHaveLength(1);
    expect(m.api.instalar).not.toHaveBeenCalled();
    fireEvent.click(within(d).getByRole("button", { name: "Instalar agora" }));
    await waitFor(() => expect(m.api.instalar).toHaveBeenCalledWith(WS, "instalar"));
  });

  it("requisito ✗ bloqueia o botão e mostra a correção sugerida", async () => {
    await abrir({ plano: { ...PLANO, pode_instalar: false, requisitos: [{ id: "node", rotulo: "Node.js", situacao: "falha", detalhe: "Não encontrado nesta máquina.", correcao: "Instale o Node.js 18 ou mais novo (nodejs.org).", bloqueante: true }] } });
    const d = await screen.findByRole("dialog");
    expect((within(d).getByRole("button", { name: "Instalar agora" }) as HTMLButtonElement).disabled).toBe(true);
    expect(d.textContent).toMatch(/✗/);
    expect(d.textContent).toMatch(/Como corrigir: Instale o Node\.js 18/);
  });

  it("modos reparar e atualizar mudam título e botão; 'Agora não' vale para todos", async () => {
    await abrir({ plano: { ...PLANO, modo: "reparar" } });
    const d = await screen.findByRole("dialog", { name: "Reparar a suíte ExpxDev" });
    expect(within(d).getByRole("button", { name: "Reparar agora" })).toBeTruthy();
    expect(within(d).getByRole("button", { name: "Agora não" })).toBeTruthy();
    cleanup();
    await abrir({ plano: { ...PLANO, modo: "atualizar" } });
    expect(await screen.findByRole("dialog", { name: "Atualizar a suíte ExpxDev" })).toBeTruthy();
  });
});

describe("foco e teclado", () => {
  it("foco inicial no Cancelar (caminho seguro), foco preso e volta a quem abriu", async () => {
    const m = await abrir();
    const d = await screen.findByRole("dialog");
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Cancelar"));
    const focaveis = [...d.querySelectorAll<HTMLElement>("button:not([disabled]), pre[tabindex]")];
    const ultimo = focaveis[focaveis.length - 1]!;
    ultimo.focus();
    fireEvent.keyDown(d, { key: "Tab" });
    expect(d.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(d, { key: "Escape" });
    expect(m.store.obter().modal).toBe(false);
  });

  it("Esc FORA da instalação fecha; o foco volta ao gatilho", async () => {
    const m = await abrir();
    const { unmount } = { unmount: () => cleanup() };
    const d = await screen.findByRole("dialog");
    fireEvent.keyDown(d, { key: "Escape" });
    expect(m.store.obter().modal).toBe(false);
    unmount();
    expect(document.activeElement).toBe(m.gatilho);
  });

  it("Esc DURANTE a instalação pede confirmação (não fecha); Esc de novo desiste; confirmar cancela no main", async () => {
    const m = await abrir();
    await screen.findByRole("dialog");
    act(() => m.emitir(progresso("rodando")));
    const d = await screen.findByRole("dialog");
    fireEvent.keyDown(d, { key: "Escape" });
    expect(m.store.obter().modal).toBe(true);
    expect(await screen.findByRole("alertdialog", { name: "Cancelar a instalação?" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Continuar instalando"));
    fireEvent.keyDown(d, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(within(d).getByRole("button", { name: "Cancelar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar instalação" }));
    await waitFor(() => expect(m.api.cancelar).toHaveBeenCalledWith(WS));
  });

  it("clicar no fundo durante a instalação também só pede confirmação", async () => {
    const m = await abrir();
    act(() => m.emitir(progresso("rodando")));
    await screen.findByRole("progressbar");
    const fundo = document.querySelector(".dialogo-fundo")!;
    fireEvent.mouseDown(fundo);
    expect(m.store.obter().modal).toBe(true);
    expect(m.store.obter().confirmandoCancelar).toBe(true);
  });
});

describe("passo 2: progresso", () => {
  it("etapas com estado, barra determinística, tempo, log recolhível e região aria-live polite", async () => {
    const m = await abrir();
    act(() => m.emitir(progresso("rodando", { percentual: 37, log: ["linha 1", "linha 2"] })));
    const d = await screen.findByRole("dialog");
    const barra = within(d).getByRole("progressbar");
    expect(barra.getAttribute("aria-valuenow")).toBe("37");
    const etapas = within(d).getByRole("list", { name: "Etapas da instalação" });
    expect(etapas.children).toHaveLength(5);
    expect(etapas.querySelector('[aria-current="step"]')?.textContent).toMatch(/Baixando o instalador/);
    expect(etapas.textContent).toMatch(/✓.*Verificando requisitos/);
    const vivo = d.querySelector('[aria-live="polite"]')!;
    expect(vivo.textContent).toBe("Etapa 2 de 5: Baixando o instalador.");
    const log = d.querySelector("details.suite-log") as HTMLDetailsElement;
    expect(log.open).toBe(false);
    expect(log.textContent).toContain("linha 2");
    expect(d.querySelector(".suite-tempo")?.textContent).toMatch(/^\d\d:\d\d$/);
  });

  it("anúncio de cada fase", () => {
    expect(anuncioDaInstalacao(progresso("concluida"))).toBe("Instalação concluída.");
    expect(anuncioDaInstalacao(progresso("cancelada"))).toBe("Instalação cancelada.");
    expect(anuncioDaInstalacao(progresso("falhou", { falha: { causa: "sem_internet", mensagem: "Sem conexão.", sugestao: "", codigo: null, etapa: "baixando" } }))).toContain("Sem conexão.");
  });
});

describe("passo 3: resultado", () => {
  it("sucesso: resumo (versão, skills, arquivos), 'Abrir o Método' e 'Fechar'; foco no primário", async () => {
    const m = await abrir();
    act(() => m.emitir(progresso("concluida", { percentual: 100, resumo: RESUMO, etapas: progresso("concluida").etapas.map((e) => ({ ...e, situacao: "ok" as const })) })));
    const d = await screen.findByRole("dialog");
    expect(d.textContent).toMatch(/Versão 0\.9\.0.*instalada/);
    expect(d.textContent).toMatch(/9.*skills/);
    expect(d.textContent).toMatch(/2 arquivo\(s\) criados/);
    expect(within(d).getByRole("button", { name: "Fechar" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Abrir o Método"));
    fireEvent.click(within(d).getByRole("button", { name: "Abrir o Método" }));
    expect(m.metodo).toHaveBeenCalled();
    expect(m.store.obter().modal).toBe(false);
  });

  it("sucesso: 'Módulos ativados: 8 de 9 — o legadox está desligado' e o caminho para ajustar (abre a aba Módulos do Método)", async () => {
    const m = await abrir();
    act(() => m.emitir(progresso("concluida", { percentual: 100, resumo: RESUMO })));
    const d = await screen.findByRole("dialog");
    const linha = await within(d).findByText(/Módulos ativados: 8 de 9/);
    expect(linha.parentElement?.textContent).toMatch(/legadox está desligado \(a maioria dos projetos não é legado e não precisa dele\)/);
    fireEvent.click(within(d).getByRole("button", { name: "Ajustar módulos" }));
    expect(m.metodo).toHaveBeenCalled();
    expect(m.store.obter().metodoAba).toBe("modulos");
    expect(m.store.obter().modal).toBe(false);
  });

  it("sucesso com arquivo do usuário alterado: aviso com a cópia de segurança", async () => {
    const m = await abrir();
    act(() => m.emitir(progresso("concluida", { resumo: { ...RESUMO, alterados: [".claude/settings.json"], backup: "~/Library/dados/suite/backups/x" } })));
    const d = await screen.findByRole("dialog");
    expect(d.querySelector('[role="note"]')?.textContent).toMatch(/alterou arquivos que já existiam.*settings\.json.*cópia de segurança/);
  });

  it("falha mostra o que ficou no projeto e a cópia de segurança; não manda o usuário rodar comando", async () => {
    const m = await abrir();
    act(() => m.emitir(progresso("falhou", { falha: { causa: "defeito_do_app", mensagem: "O instalador recusou o pedido que este app montou. Isso é um defeito do app, não algo que você fez ou precise corrigir.", sugestao: "Copie o diagnóstico e avise a equipe do app.", codigo: 1, etapa: "instalando" }, situacao_projeto: "O projeto não foi alterado." })));
    const d = await screen.findByRole("dialog");
    expect(d.textContent).toMatch(/Seu projeto:.*O projeto não foi alterado\./);
    expect(d.textContent).toMatch(/defeito do app/);
    expect(d.textContent).not.toMatch(/npx|--skills/);
  });

  it("sucesso: arquivo removido/devolvido e como restaurar a cópia de segurança", async () => {
    const m = await abrir();
    act(() => m.emitir(progresso("concluida", { resumo: { ...RESUMO, removidos: [".expx/memoria/indice.json"], restaurados: [".expx/hooks.json"], backup: "~/Library/dados/suite/backups/x", como_restaurar: "Para voltar um arquivo ao que era antes, copie-o de ~/Library/dados/suite/backups/x/<caminho do arquivo> para o mesmo caminho dentro do projeto." } })));
    const d = await screen.findByRole("dialog");
    expect(d.textContent).toMatch(/devolveu o que era seu:.*hooks\.json/);
    expect(d.textContent).toMatch(/E removeu:.*indice\.json/);
    expect(d.textContent).toMatch(/cópia de segurança.*backups\/x.*copie-o de/);
  });

  it("falha: causa em linguagem simples, sugestão, 'Tentar de novo' e 'Copiar diagnóstico' (sem segredos)", async () => {
    const copiar = vi.fn(async () => undefined);
    Object.defineProperty(globalThis.navigator, "clipboard", { value: { writeText: copiar }, configurable: true });
    const m = await abrir();
    act(() => m.emitir(progresso("falhou", { falha: { causa: "sem_internet", mensagem: "Sem conexão com a internet.", sugestao: "Confira sua conexão e tente de novo.", codigo: null, etapa: "baixando" }, diagnostico: "Diagnóstico\nprojeto: ~/…/app" })));
    const d = await screen.findByRole("dialog");
    expect(within(d).getByRole("alert").textContent).toMatch(/Sem conexão com a internet\..*Confira sua conexão/);
    fireEvent.click(within(d).getByRole("button", { name: /Copiar diagnóstico/ }));
    await waitFor(() => expect(copiar).toHaveBeenCalledWith("Diagnóstico\nprojeto: ~/…/app"));
    expect(await within(d).findByText(/Diagnóstico copiado/)).toBeTruthy();
    fireEvent.click(within(d).getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(m.store.obter().progresso).toBeNull());
    expect(await screen.findByRole("button", { name: "Instalar agora" })).toBeTruthy();
  });

  it("comando falhou mostra o código", async () => {
    const m = await abrir();
    act(() => m.emitir(progresso("falhou", { falha: { causa: "comando_falhou", mensagem: "O instalador terminou com erro.", sugestao: "Veja o log.", codigo: 3, etapa: "instalando" } })));
    expect((await screen.findByRole("alert")).textContent).toContain("(código 3)");
  });

  it("cancelado: mostra o que a limpeza fez e oferece tentar de novo", async () => {
    const m = await abrir();
    act(() => m.emitir(progresso("cancelada", { limpeza: "Removi 4 arquivo(s) que a instalação tinha criado. O projeto voltou ao que era." })));
    const d = await screen.findByRole("dialog");
    expect(d.textContent).toMatch(/Instalação cancelada\..*Removi 4 arquivo/);
    expect(within(d).getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
  });
});

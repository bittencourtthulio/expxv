// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiCaptura, ApiVoz, EstadoCaptura, EstadoVoz } from "../../../compartilhado/captura";
import { VERSAO_CONSENTIMENTO_MODELO, type ListaModelosVoz, type ModeloVozInfo, type ProgressoModelo, type ResultadoAutoteste } from "../../../compartilhado/voz-local";
import { SecaoVozCaptura } from "./SecaoVozCaptura";
import { VozLocal } from "./VozLocal";

afterEach(() => cleanup());

const modelo = (o: Partial<ModeloVozInfo> = {}): ModeloVozInfo => ({
  id: "parakeet-tdt-0.6b-v3-int8", nome: "Parakeet TDT 0.6B v3 (NVIDIA)", descricao: "O mais preciso.", idiomas: ["pt", "en", "es"], pt_br: true, tamanho_bytes: 670_478_772, ram_estimada_mb: 1500, velocidade: "media", qualidade: "excelente",
  perfil: "recomendado", recomendado: true, licenca: { id: "CC-BY-4.0", url: "https://creativecommons.org/licenses/by/4.0/", atribuicao: "Modelo NVIDIA Parakeet." }, host_origem: "huggingface.co", hosts_arquivos: ["*.hf.co"],
  baixavel: true, motivo_nao_baixavel: null, instalado: false, bytes_em_disco: null, ativo: false, integridade: null, verificado_em: null, download: null, ...o,
});
const MENOR = modelo({ id: "whisper-base-int8", nome: "Whisper Base (OpenAI)", recomendado: false, perfil: "leve", tamanho_bytes: 160_609_290, ram_estimada_mb: 500, velocidade: "rapida", qualidade: "boa", licenca: { id: "MIT", url: "https://github.com/openai/whisper/blob/main/LICENSE", atribuicao: "Whisper." } });
const INGLES = modelo({ id: "moonshine-tiny-en-int8", nome: "Moonshine Tiny (inglês)", recomendado: false, perfil: "ingles", idiomas: ["en"], pt_br: false, tamanho_bytes: 123_967_539 });

const lista = (o: Partial<ListaModelosVoz> = {}): ListaModelosVoz => ({
  modelos: [modelo(), MENOR, INGLES], espaco_livre_bytes: 120e9, runtime_disponivel: true, motivo_runtime: null, pasta_exibicao: "pasta de dados do app › voz › modelos", versao_consentimento: VERSAO_CONSENTIMENTO_MODELO,
  ociosidade_s: 120, carregado: false, ram_mb: null, modelo_ativo: null, ...o,
});
const EV: EstadoVoz = {
  motor: "nenhum", comando_executavel: null, comando_args: [], url: null, modelo: null, modelo_local: null, ociosidade_s: 120, idioma: "pt", disparo: "segurar", atalho: "Command+Shift+Space", alternar_global: false,
  motor_pronto: false, consentimento: true, host: null, tem_chave: false, microfone: "indeterminada", ditado: "ocioso", aviso_microfone_visto: false, plataforma: "mac", atalho_erro: null,
};
const prog = (o: Partial<ProgressoModelo>): ProgressoModelo => ({ modelo_id: "parakeet-tdt-0.6b-v3-int8", fase: "baixando", bytes: 0, total: 670_478_772, velocidade_bps: 0, restante_s: null, arquivo_atual: null, codigo: null, instrucao: null, sequencia: 1, ...o });

function api(l: ListaModelosVoz = lista()) {
  let atual = l;
  let ouvinte: (p: ProgressoModelo) => void = () => undefined;
  const voz = {
    modelosListar: vi.fn(async () => atual),
    modeloBaixar: vi.fn(async (p: { modelo_id: string }) => ({ modelo_id: p.modelo_id })),
    modeloPausar: vi.fn(async () => ({ ok: true })),
    modeloRetomar: vi.fn(async () => ({ ok: true })),
    modeloCancelar: vi.fn(async () => ({ ok: true })),
    modeloApagar: vi.fn(async () => ({ ok: true })),
    modeloAtivar: vi.fn(async () => ({ ok: true, codigo: null, instrucao: null })),
    modeloAutoteste: vi.fn(async (): Promise<ResultadoAutoteste> => ({ ok: true, acertos: 3, esperadas: 3, carregamento_ms: 300, transcricao_ms: 40, rtf: 0.016, codigo: null, instrucao: null })),
    assinarModelos: vi.fn((cb: (p: ProgressoModelo) => void) => { ouvinte = cb; return () => { ouvinte = () => undefined; }; }),
    configGravar: vi.fn(async () => EV),
    estado: vi.fn(async () => EV),
  };
  return { voz: voz as unknown as ApiVoz, mocks: voz, definir: (n: ListaModelosVoz) => { atual = n; }, emitir: (p: ProgressoModelo) => { act(() => ouvinte(p)); } };
}
async function montar(a: ReturnType<typeof api>, ev: Partial<EstadoVoz> = {}, aoAtualizar = vi.fn()) {
  await act(async () => { render(<VozLocal voz={a.voz} ev={{ ...EV, ...ev }} aoAtualizar={aoAtualizar} />); });
  return aoAtualizar;
}

describe("assistente: escolher e consentir", () => {
  it("sem modelo instalado mostra o assistente com o recomendado pré-selecionado, PT-BR em destaque, disco livre e UM botão primário", async () => {
    await montar(api());
    const grupo = screen.getByRole("group", { name: "Escolher modelo de voz" });
    const radios = within(grupo).getAllByRole("radio") as HTMLInputElement[];
    expect(radios).toHaveLength(3);
    expect(radios[0]!.checked).toBe(true);
    expect(radios[1]!.checked).toBe(false);
    expect(within(grupo).getAllByText("PT-BR")).toHaveLength(2);
    expect(within(grupo).getByText("Sem português")).toBeTruthy();
    expect(within(grupo).getByText("Recomendado")).toBeTruthy();
    expect(within(grupo).getByText("670 MB")).toBeTruthy();
    expect(within(grupo).getAllByText(/cerca de 1,5 GB/).length).toBeGreaterThan(0);
    expect(within(grupo).getAllByText(/Excelente: a mais precisa/).length).toBeGreaterThan(0);
    expect(grupo.textContent).toContain("120 GB");
    expect(within(grupo).getAllByRole("link").map((a) => a.textContent)).toContain("CC-BY-4.0");
    expect(within(grupo).getAllByRole("button", { name: "Baixar e ativar" })).toHaveLength(1);
  });

  it("'Baixar e ativar' abre o consentimento com host, tamanho, privacidade, pasta e como apagar; cancelar não baixa nada", async () => {
    const a = api();
    await montar(a);
    fireEvent.click(screen.getByRole("button", { name: "Baixar e ativar" }));
    const d = screen.getByRole("dialog");
    const t = d.textContent ?? "";
    expect(t).toContain("huggingface.co");
    expect(t).toContain("*.hf.co");
    expect(t).toContain("670 MB");
    expect(t).toMatch(/nenhum áudio, texto ou dado seu sai do computador/);
    expect(t).toContain("pasta de dados do app › voz › modelos");
    expect(t).toMatch(/Apagar modelo/);
    expect(t).toContain("CC-BY-4.0");
    expect(a.mocks.modeloBaixar).not.toHaveBeenCalled();
    fireEvent.click(within(d).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(a.mocks.modeloBaixar).not.toHaveBeenCalled();
  });

  it("confirmar o consentimento envia SÓ id, versão do texto vigente e ativar=true (nunca URL nem caminho)", async () => {
    const a = api();
    await montar(a);
    fireEvent.click(screen.getByRole("radio", { name: /Whisper Base/ }));
    fireEvent.click(screen.getByRole("button", { name: "Baixar e ativar" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Concordo e baixar" })); });
    expect(a.mocks.modeloBaixar).toHaveBeenCalledTimes(1);
    expect(a.mocks.modeloBaixar).toHaveBeenCalledWith({ modelo_id: "whisper-base-int8", aceite_versao: VERSAO_CONSENTIMENTO_MODELO, ativar: true });
  });

  it("runtime indisponível: aviso acionável e botão desligado; sem espaço em disco: alerta e botão desligado", async () => {
    await montar(api(lista({ runtime_disponivel: false, motivo_runtime: "O componente de reconhecimento de voz não está presente neste pacote." })));
    expect(screen.getByRole("alert").textContent).toMatch(/não está presente neste pacote.*comando local/);
    expect((screen.getByRole("button", { name: "Baixar e ativar" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    await montar(api(lista({ espaco_livre_bytes: 100e6 })));
    expect(screen.getAllByRole("alert").some((x) => /Sem espaço livre/.test(x.textContent ?? ""))).toBe(true);
    expect((screen.getByRole("button", { name: "Baixar e ativar" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("modelo sem checksum confirmado aparece bloqueado com o motivo e nunca é pré-selecionado", async () => {
    const a = api(lista({ modelos: [modelo({ baixavel: false, motivo_nao_baixavel: "Checksum ainda não confirmado para 1 arquivo(s)." }), MENOR] }));
    await montar(a);
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios[0]!.disabled).toBe(true);
    expect(radios[0]!.checked).toBe(false);
    expect(radios[1]!.checked).toBe(true);
    expect(screen.getByText(/Checksum ainda não confirmado/)).toBeTruthy();
  });
});

describe("progresso, verificação e erro", () => {
  it("baixando 40%: barra com role=progressbar e aria-valuenow, bytes/total, velocidade e tempo restante; evento fora de ordem é ignorado", async () => {
    const a = api();
    await montar(a);
    a.emitir(prog({ bytes: 268_191_509, velocidade_bps: 4_200_000, restante_s: 96, sequencia: 5 }));
    const barra = screen.getByRole("progressbar");
    expect(barra.getAttribute("aria-valuenow")).toBe("40");
    expect(barra.getAttribute("aria-valuemin")).toBe("0");
    expect(barra.getAttribute("aria-valuemax")).toBe("100");
    expect(barra.getAttribute("aria-valuetext")).toBe("40%");
    expect(screen.getByText(/268 MB de 670 MB \(40%\)/).textContent).toMatch(/4,2 MB\/s · faltam 1 min 36 s/);
    a.emitir(prog({ bytes: 10, sequencia: 3 }));
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("40");
    expect(screen.queryByRole("button", { name: "Baixar e ativar" })).toBeNull(); // o assistente cede o lugar ao andamento
  });

  it("pausar → retomar → cancelar chamam o main com o id; pausado mostra Retomar", async () => {
    const a = api();
    await montar(a);
    a.emitir(prog({ bytes: 1_000_000, sequencia: 2 }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Pausar" })); });
    expect(a.mocks.modeloPausar).toHaveBeenCalledWith("parakeet-tdt-0.6b-v3-int8");
    a.emitir(prog({ fase: "pausado", bytes: 1_000_000, sequencia: 3 }));
    expect(screen.getByText(/o que já foi baixado é aproveitado ao retomar/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Cancelar" })); });
    expect(a.mocks.modeloCancelar).toHaveBeenCalledWith("parakeet-tdt-0.6b-v3-int8");
  });

  it("retomar chama o main com o id", async () => {
    const a = api();
    await montar(a);
    a.emitir(prog({ fase: "pausado", bytes: 1_000_000, sequencia: 2 }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retomar" })); });
    expect(a.mocks.modeloRetomar).toHaveBeenCalledWith("parakeet-tdt-0.6b-v3-int8");
  });

  it("verificando e autoteste: barra indeterminada (sem valuenow, com valuetext) e anúncio discreto", async () => {
    const a = api();
    await montar(a);
    a.emitir(prog({ fase: "baixando", bytes: 100, sequencia: 1 }));
    a.emitir(prog({ fase: "verificando", bytes: 670_478_772, sequencia: 2 }));
    const barra = screen.getByRole("progressbar");
    expect(barra.hasAttribute("aria-valuenow")).toBe(false);
    expect(barra.getAttribute("aria-valuetext")).toBe("Verificando os arquivos");
    expect(screen.getByText("Verificando…")).toBeTruthy();
    a.emitir(prog({ fase: "autoteste", bytes: 670_478_772, sequencia: 3 }));
    expect(screen.getByText("Testando o reconhecimento…")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuetext")).toBe("Testando o reconhecimento");
  });

  it("anúncios só na mudança de fase e ao cruzar 25/50/75%: nunca por tick", async () => {
    const a = api();
    await montar(a);
    const anuncio = (): string => (document.querySelector(".cfgvl-leitor") as HTMLElement).textContent ?? "";
    a.emitir(prog({ bytes: 1_000, sequencia: 1 }));
    expect(anuncio()).toBe("Baixando Parakeet TDT 0.6B v3 (NVIDIA).");
    a.emitir(prog({ bytes: 100_000_000, sequencia: 2 }));
    expect(anuncio()).toBe("Baixando Parakeet TDT 0.6B v3 (NVIDIA)."); // 14%: sem novo anúncio
    a.emitir(prog({ bytes: 200_000_000, sequencia: 3 }));
    expect(anuncio()).toBe("25% baixado.");
    a.emitir(prog({ bytes: 210_000_000, sequencia: 4 }));
    expect(anuncio()).toBe("25% baixado.");
    a.emitir(prog({ fase: "verificando", bytes: 670_478_772, sequencia: 5 }));
    expect(anuncio()).toBe("Verificando os arquivos baixados.");
  });

  it("instalado: recarrega a lista, avisa a seção e mostra 'Pronto: voz local ativada' com o modelo em uso", async () => {
    const a = api();
    const aoAtualizar = await montar(a, { motor: "local_embutido", modelo_local: "parakeet-tdt-0.6b-v3-int8", motor_pronto: true });
    a.definir(lista({ modelos: [modelo({ instalado: true, integridade: "ok", ativo: true, bytes_em_disco: 670_478_772 }), MENOR, INGLES], modelo_ativo: "parakeet-tdt-0.6b-v3-int8" }));
    a.emitir(prog({ fase: "instalado", bytes: 670_478_772, sequencia: 9 }));
    await act(async () => { await Promise.resolve(); });
    expect(aoAtualizar).toHaveBeenCalled();
    expect(screen.getAllByText(/Pronto: voz local ativada/).length).toBeGreaterThan(0);
    expect(screen.getByText("Em uso")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("sem internet: alerta em linguagem simples e botão Retomar; checksum inválido: 'Baixar de novo' reabre o consentimento", async () => {
    const a = api();
    await montar(a);
    a.emitir(prog({ fase: "erro", codigo: "sem_internet", instrucao: "Sem conexão com a internet. Toque em Retomar.", bytes: 5_000_000, sequencia: 4 }));
    expect(screen.getByRole("alert").textContent).toMatch(/Sem conexão com a internet/);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retomar" })); });
    expect(a.mocks.modeloRetomar).toHaveBeenCalled();
    a.emitir(prog({ fase: "erro", codigo: "checksum_invalido", instrucao: "O arquivo não confere. Toque em Baixar de novo.", sequencia: 5 }));
    expect(screen.queryByRole("button", { name: "Retomar" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Baixar de novo" }));
    expect(screen.getByRole("dialog")).toBeTruthy(); // consentimento por download
  });

  it("autoteste falhou: oferece apagar e baixar de novo", async () => {
    const a = api();
    await montar(a);
    a.emitir(prog({ fase: "erro", codigo: "autoteste_falhou", instrucao: "O teste não reconheceu as palavras esperadas.", sequencia: 4 }));
    expect(screen.getByRole("button", { name: "Apagar modelo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Baixar de novo" })).toBeTruthy();
  });
});

describe("gerenciar modelos instalados", () => {
  const instalado = (o: Partial<ModeloVozInfo> = {}): ModeloVozInfo => modelo({ instalado: true, integridade: "ok", bytes_em_disco: 670_478_772, ...o });

  it("lista instalados com tamanho e 'Em uso'; usar outro, testar, apagar (com confirmação) e baixar outro", async () => {
    const a = api(lista({ modelos: [instalado({ ativo: true }), instalado({ id: "whisper-base-int8", nome: "Whisper Base (OpenAI)", recomendado: false, bytes_em_disco: 160_609_290 }), INGLES], modelo_ativo: "parakeet-tdt-0.6b-v3-int8" }));
    const aoAtualizar = await montar(a, { motor: "local_embutido", modelo_local: "parakeet-tdt-0.6b-v3-int8" });
    const gerenciar = screen.getByRole("group", { name: "Modelos instalados" });
    expect(within(gerenciar).getByText("Em uso")).toBeTruthy();
    expect(within(gerenciar).getByText("670 MB no disco")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Escolher modelo de voz" })).toBeNull();
    await act(async () => { fireEvent.click(within(gerenciar).getByRole("button", { name: "Usar este modelo" })); });
    expect(a.mocks.modeloAtivar).toHaveBeenCalledWith("whisper-base-int8");
    expect(aoAtualizar).toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(gerenciar).getAllByRole("button", { name: "Testar" })[0]!); });
    expect(a.mocks.modeloAutoteste).toHaveBeenCalledWith("parakeet-tdt-0.6b-v3-int8");
    expect(screen.getByText(/Funcionando: 3 de 3 palavras da amostra \(0,02× o tempo real\)/)).toBeTruthy();
    fireEvent.click(within(gerenciar).getAllByRole("button", { name: "Apagar modelo" })[1]!);
    const d = screen.getByRole("dialog");
    expect(d.textContent).toMatch(/Whisper Base/);
    await act(async () => { fireEvent.click(within(d).getByRole("button", { name: "Apagar" })); });
    expect(a.mocks.modeloApagar).toHaveBeenCalledWith("whisper-base-int8");
    fireEvent.click(screen.getByRole("button", { name: "Baixar outro modelo" }));
    const assistente = screen.getByRole("group", { name: "Escolher modelo de voz" });
    expect(within(assistente).getAllByRole("radio").length).toBe(1); // só os ainda não instalados
  });

  it("modelo corrompido: aviso para apagar e baixar de novo; sem 'Usar' nem 'Testar'", async () => {
    const a = api(lista({ modelos: [instalado({ instalado: false, integridade: "corrompido" }), MENOR] }));
    await montar(a);
    expect(screen.getByText(/Arquivos corrompidos ou trocados/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Testar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Usar este modelo" })).toBeNull();
    expect(screen.getByRole("button", { name: "Apagar modelo" })).toBeTruthy();
  });

  it("tempo até descarregar da memória: configurável; mostra memória 0 quando descarregado", async () => {
    const a = api(lista({ modelos: [instalado({ ativo: true })] }));
    await montar(a);
    expect(screen.getByText(/Modelo fora da memória: 0 MB e nenhum processo ativo/)).toBeTruthy();
    const sel = screen.getByRole("combobox", { name: "Descarregar o modelo da memória após" }) as HTMLSelectElement;
    expect(sel.value).toBe("120");
    await act(async () => { fireEvent.change(sel, { target: { value: "300" } }); });
    expect(a.mocks.configGravar).toHaveBeenCalledWith({ ociosidade_s: 300 });
  });
});

describe("integração na seção Voz e captura", () => {
  const EC: EstadoCaptura = { tela: "indeterminada", janela_app: true, plataforma: "mac", aviso_visto: false, fps_padrao: 2, atalhos_globais: false, atalho_regiao: "A", atalho_quadros: "B", gravando_quadros: false, atalho_erro: null };
  async function secao(ev: Partial<EstadoVoz> = {}) {
    const a = api();
    Object.assign(a.voz, {
      estado: vi.fn(async () => ({ ...EV, ...ev })), dicionarioListar: vi.fn(async () => []), historicoListar: vi.fn(async () => []), historicoLimpar: vi.fn(),
      configGravar: vi.fn(async () => ({ ...EV, ...ev })), pedirMicrofone: vi.fn(), abrirAjustes: vi.fn(),
    });
    const captura = { estado: vi.fn(async () => EC), configGravar: vi.fn() } as unknown as ApiCaptura;
    await act(async () => { render(<SecaoVozCaptura voz={a.voz} captura={captura} />); });
    return a;
  }

  it("'Local neste computador (recomendado)' é a PRIMEIRA opção; as outras ficam como avançadas", async () => {
    await secao();
    const sel = screen.getByRole("combobox", { name: "Motor de voz" }) as HTMLSelectElement;
    const opcoes = [...sel.options].map((o) => o.textContent);
    expect(opcoes[0]).toBe("Local neste computador (recomendado)");
    expect(opcoes).toContain("Avançado: comando local externo");
    expect(opcoes).toContain("Avançado: servidor HTTP compatível (remoto)");
    expect(sel.value).toBe("nenhum"); // nasce desligado: nada é baixado sem a pessoa pedir
  });

  it("escolher 'Local' (ou o atalho 'Configurar voz local') mostra o assistente e esconde 'Salvar motor'", async () => {
    const a = await secao();
    expect(a.mocks.modelosListar).not.toHaveBeenCalled(); // nada é consultado antes de escolher
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Configurar voz local (recomendado)" })); });
    expect(screen.getByRole("group", { name: "Escolher modelo de voz" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Salvar motor" })).toBeNull();
    expect((screen.getByRole("radio", { name: /Parakeet/ }) as HTMLInputElement).checked).toBe(true);
    await act(async () => { fireEvent.change(screen.getByRole("combobox", { name: "Motor de voz" }), { target: { value: "comando_local" } }); });
    expect(screen.getByRole("button", { name: "Salvar motor" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Escolher modelo de voz" })).toBeNull();
  });

  it("com o motor local já configurado a seção abre direto nele", async () => {
    await secao({ motor: "local_embutido", modelo_local: "parakeet-tdt-0.6b-v3-int8", motor_pronto: true });
    expect((screen.getByRole("combobox", { name: "Motor de voz" }) as HTMLSelectElement).value).toBe("local_embutido");
  });
});

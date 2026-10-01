// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { IndiceProjeto } from "../../../nucleo/metodo/tipos";
import { criarStoreInicio, type Fontes } from "../../estado/inicio";
import { tk, trabalho } from "../metodo/fabrica";
import { TelaInicio } from "./index";

const ws = { id: "w1", nome: "p", raiz: "/p" } as never;
const indice = (trabalhos: ReturnType<typeof trabalho>[], lock = true): IndiceProjeto => ({
  raiz: "/p", gerado_em: "x", duracao_ms: 1, trabalhos, violacoes: [], rejeicoes: [], avisos: [], artefatos_lidos: 1,
  camadas: { convencoes: false, perfil_legado: false, design_system: false, produto: false, hooks: lock, lock, memoria: false },
});

function fontes(o: { ws?: unknown; indice?: IndiceProjeto | null; missoes?: unknown[]; sessoes?: unknown[]; metodoCarregado?: boolean } = {}): Fontes {
  const f = <T,>(v: T) => ({ obter: () => v, assinar: () => () => undefined });
  return {
    terminais: f({ sessoes: o.sessoes ?? [], ferramentas: null }) as never,
    missoes: f({ itens: o.missoes ?? [], carregado: true }) as never,
    metodo: f({ indice: o.indice === undefined ? indice([]) : o.indice, carregado: o.metodoCarregado ?? true }) as never,
    workspaces: f({ atual: o.ws === undefined ? ws : o.ws, carregado: true }) as never,
  };
}
function montar(o: Parameters<typeof fontes>[0] = {}) {
  const aoNavegar = vi.fn();
  render(<TelaInicio store={criarStoreInicio(fontes(o))} iniciar={() => () => undefined} aoNavegar={aoNavegar} />);
  return aoNavegar;
}
const miss = { id: "m1", titulo: "Migrar login", estado: "executando" };
const aguardando = { sessao_id: "s1", ferramenta_id: "claude", numero: 2, estado: "executando", atividade: "aguardando", mensagem: null, codigo_saida: null };

describe("Tela Início", () => {
  it("vazio sem projeto: guia o primeiro uso e leva aos Workspaces", () => {
    const nav = montar({ ws: null, indice: null, metodoCarregado: false });
    expect(screen.getByText("Abrir um projeto").closest("li")?.getAttribute("aria-current")).toBe("step");
    fireEvent.click(screen.getByRole("button", { name: "Abrir projeto" }));
    expect(nav).toHaveBeenCalledWith("workspaces");
  });
  it("projeto sem método instalado aponta para o Método; instalado e sem missão aponta para criar", () => {
    const nav = montar({ indice: indice([], false) });
    fireEvent.click(screen.getByRole("button", { name: "Ver instalação" }));
    expect(nav).toHaveBeenCalledWith("metodo");
  });
  it("com missões: lista só as ativas e abre a tela de Missões", () => {
    const nav = montar({ missoes: [miss, { ...miss, id: "m2", titulo: "Velha", estado: "concluida" }] });
    expect(screen.getByText("Migrar login")).toBeTruthy();
    expect(screen.queryByText("Velha")).toBeNull();
    fireEvent.click(screen.getByText("Migrar login"));
    expect(nav).toHaveBeenCalledWith("missoes");
  });
  it("com aguardando: painel, veredito sem assinatura e PR aberto levam à tela certa", () => {
    const t = trabalho([tk("T-1")], {
      titulo: "Feat", prodx: { veredito: "sim", assinado: false, briefing: false },
      entrega: { estado: null, branch: "feat/x", portao: null, pr_url: "http://pr", pr_estado: "open", commits: 1, arquivo: "x" },
    });
    const nav = montar({ sessoes: [aguardando], indice: indice([t]), missoes: [miss] });
    fireEvent.click(screen.getByText(/Painel #2/));
    expect(nav).toHaveBeenLastCalledWith("terminais");
    fireEvent.click(screen.getByText(/Veredito sem assinatura/));
    fireEvent.click(screen.getByText(/PR aberto/));
    expect(nav).toHaveBeenCalledTimes(3);
    expect(nav).toHaveBeenLastCalledWith("metodo");
  });
  it("com bloqueio aberto: mostra a descrição; dados parciais não bloqueiam a pintura", () => {
    const t = trabalho([tk("T-1")], { titulo: "Feat", bloqueios: [{ id: "B-1", task: null, aberto_em: null, resolvido_em: null, aberto: true, descricao: "falta a chave", arquivo: "x" }] });
    montar({ indice: indice([t]), missoes: [miss] });
    expect(screen.getByText("falta a chave")).toBeTruthy();
  });
  it("método ainda lendo: pinta a grade na hora com aviso de carregamento", () => {
    montar({ indice: null, metodoCarregado: false, missoes: [miss] });
    expect(screen.getByText("Migrar login")).toBeTruthy();
    expect(screen.getAllByText("Lendo o projeto…").length).toBeGreaterThan(0);
  });
  it("liga e desliga as assinaturas do método com a tela", () => {
    const parar = vi.fn();
    const iniciar = vi.fn(() => parar);
    const { unmount } = render(<TelaInicio store={criarStoreInicio(fontes())} iniciar={iniciar} aoNavegar={() => undefined} />);
    expect(iniciar).toHaveBeenCalledTimes(1);
    act(() => unmount());
    expect(parar).toHaveBeenCalled();
  });
});

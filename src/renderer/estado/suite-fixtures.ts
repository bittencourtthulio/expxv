// Dados e fábricas falsas compartilhados pelos testes da suíte ExpxDev no renderer (não é um teste).
import { vi } from "vitest";
import type { EstadoModulosSuite, EstadoSuite, EventoModulosMudou, EventoSuite, PadraoModulos, PlanoSuite, ProgressoSuite, ResultadoModulos } from "../../compartilhado/suite";
import { PRODUTO } from "../../nucleo/produto";
import { CATALOGO_SUITE } from "../../nucleo/suite/catalogo";
import { ISOLAMENTO_POR_CLI, MODULOS, PADRAO_DE_FABRICA, REQUISITOS_DE_MODULO, avisosDoEstado, dependentesDe, desligadosDe, ehModulo, mudarModulo, type EstadoModulos } from "../../nucleo/suite/modulos";
import { criarStoreSuite } from "./suite";

export const WS = "ws_AAAAAAAAAAAA";
export const estadoSuite = (estado: EstadoSuite["estado"], extra: Partial<EstadoSuite> = {}): EstadoSuite => ({
  workspace_id: WS, estado, motivo: "motivo", versao_instalada: estado === "ausente" ? null : "0.9.0", versao_pedida: "0.9.0", skills_presentes: [], skills_faltando: [], dispensado: false, instalando: false, instalacao_id: null, ...extra,
});
export const PLANO: PlanoSuite = {
  workspace_id: WS, modo: "instalar", versao: "0.9.0", skills: [{ nome: "sprintx", papel: "planeja e executa features novas", instalada: false }, { nome: "runx", papel: "ocorrências de manutenção do dia a dia", instalada: false }], comando: ["npm install --prefix <pasta temporária> expxdev@0.9.0", "node <instalador baixado>/bin init"], pasta_alvo: "~/Projetos/app", pastas_gravadas: [".claude", ".expx", ".opencode"],
  existentes: [{ pasta: ".claude", quantidade: 3 }, { pasta: ".expx", quantidade: 0 }, { pasta: ".opencode", quantidade: 0 }],
  requisitos: [
    { id: "node", rotulo: "Node.js", situacao: "ok", detalhe: "Versão v22.1.0.", correcao: null, bloqueante: true },
    { id: "npm", rotulo: "npm", situacao: "ok", detalhe: "Versão 10.5.0.", correcao: null, bloqueante: true },
    { id: "internet", rotulo: "Internet", situacao: "pendente", detalhe: "Será verificada ao clicar em Instalar agora.", correcao: null, bloqueante: false },
    { id: "pasta", rotulo: "Pasta do projeto gravável", situacao: "ok", detalhe: "ok", correcao: null, bloqueante: true },
    { id: "git", rotulo: "Git (informativo)", situacao: "info", detalhe: "Árvore limpa.", correcao: null, bloqueante: false },
  ],
  pode_instalar: true, rede: "Baixa o instalador do registro npm. Precisa de internet.", efeitos_fora: ["Se o Claude Code estiver instalado, o instalador também registra o plugin no Claude Code desta máquina (comandos `claude plugin marketplace add` e `claude plugin install`)."],
};
export const progresso = (fase: ProgressoSuite["fase"], extra: Partial<ProgressoSuite> = {}): ProgressoSuite => ({
  tipo: "progresso", instalacao_id: "suite_1", workspace_id: WS, modo: "instalar", versao: "0.9.0", fase,
  etapas: [
    { id: "requisitos", rotulo: "Verificando requisitos", situacao: "ok" }, { id: "baixando", rotulo: "Baixando o instalador", situacao: fase === "rodando" ? "ativa" : "ok" },
    { id: "instalando", rotulo: "Instalando as skills", situacao: "pendente" }, { id: "conferindo", rotulo: "Conferindo a instalação", situacao: "pendente" }, { id: "pronto", rotulo: "Pronto", situacao: "pendente" },
  ],
  percentual: 25, iniciado_em: Date.now() - 5_000, decorrido_ms: 5_000, log: ["npm http fetch GET 200"], log_truncado: false, resumo: null, falha: null, limpeza: null, situacao_projeto: null, diagnostico: null, ...extra,
});

/** Estado de módulos como o main o montaria (mesma lógica pura), para os testes de tela. */
export function estadoModulos(e: EstadoModulos = PADRAO_DE_FABRICA, o: Partial<EstadoModulosSuite> = {}): EstadoModulosSuite {
  return {
    workspace_id: WS, origem: "padrao", arquivo: `${PRODUTO.pastaNoProjeto}/modulos.json`, suite_instalada: true,
    modulos: CATALOGO_SUITE.map((c) => {
      const id = c.nome as (typeof MODULOS)[number];
      const r = REQUISITOS_DE_MODULO[id];
      return { id, nome: id, papel: c.papel, ligado: e[id], padrao_desligado: !PADRAO_DE_FABRICA[id], exige: r.exige.map((g) => [...g]), recomenda: r.recomenda.map((g) => [...g]), dependentes: dependentesDe(id), fonte: r.fonte };
    }),
    desligados: desligadosDe(e), avisos: avisosDoEstado(e).map((a) => `${a.modulo} ${a.tipo}`), isolamento: ISOLAMENTO_POR_CLI.map((x) => ({ ...x })), ...o,
  };
}

export function criarApiFalsa(inicial: EstadoSuite | null) {
  let cb: (e: EventoSuite) => void = () => undefined;
  let cbModulos: (e: EventoModulosMudou) => void = () => undefined;
  let modulos: EstadoModulos = PADRAO_DE_FABRICA;
  let padrao: EstadoModulos = PADRAO_DE_FABRICA;
  const api = {
    estado: vi.fn(async () => inicial ?? estadoSuite("ausente")),
    requisitos: vi.fn(async () => PLANO),
    instalar: vi.fn(async () => ({ instalacao_id: "suite_1" })),
    cancelar: vi.fn(async () => ({ ok: true })),
    dispensar: vi.fn(async (_w: string, d: boolean) => estadoSuite("ausente", { dispensado: d })),
    assinar: vi.fn((f: (e: EventoSuite) => void) => { cb = f; return () => undefined; }),
    modulosEstado: vi.fn(async () => estadoModulos(modulos)),
    modulosDefinir: vi.fn(async (_w: string, modulo: string, ligado: boolean, confirmar: boolean): Promise<ResultadoModulos> => {
      if (!ehModulo(modulo)) throw new Error("Módulo desconhecido.");
      const r = mudarModulo(modulos, modulo, ligado, confirmar);
      if (!r.ok) return { ok: false, precisa_confirmar: { tipo: r.precisa_confirmar.tipo, modulos: [...r.precisa_confirmar.modulos] }, estado: estadoModulos(modulos) };
      modulos = r.estado;
      return { ok: true, estado: estadoModulos(modulos), mudou: [...r.mudou] };
    }),
    modulosRestaurar: vi.fn(async () => { modulos = padrao; return estadoModulos(modulos); }),
    modulosPadrao: vi.fn(async (): Promise<PadraoModulos> => ({ modulos: { ...padrao }, fabrica: { ...PADRAO_DE_FABRICA } })),
    modulosPadraoDefinir: vi.fn(async (m: Record<string, boolean>): Promise<PadraoModulos> => { padrao = { ...PADRAO_DE_FABRICA, ...m } as EstadoModulos; return { modulos: { ...padrao }, fabrica: { ...PADRAO_DE_FABRICA } }; }),
    assinarModulos: vi.fn((f: (e: EventoModulosMudou) => void) => { cbModulos = f; return () => undefined; }),
  };
  return { api, emitir: (e: EventoSuite) => cb(e), emitirModulos: (e: EventoModulosMudou) => cbModulos(e), definirModulos: (e: EstadoModulos) => { modulos = e; } };
}
export function criarStoreFalso(inicial: EstadoSuite | null = estadoSuite("ausente")) {
  const f = criarApiFalsa(inicial);
  const workspaces = { obter: () => ({ atual: { id: WS } }) as never, assinar: () => () => undefined };
  const metodo = vi.fn();
  const store = criarStoreSuite({ api: () => f.api as never, workspaces, ocioso: (fn) => fn(), irParaMetodo: metodo });
  return { ...f, store, metodo };
}


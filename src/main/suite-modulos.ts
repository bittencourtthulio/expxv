// Módulos da suíte no main (D-480…): ligar/desligar cada skill POR PROJETO, só no que o app oferece e dispara. Estado em `<pasta do produto>/modulos.json` do repositório
// (relativo, versionável; D-04: nunca em `docs/**`, nunca no lock nem nas skills), com fallback em dados do app quando a pasta não for gravável. Leitura SÍNCRONA, barata e
// confinada (o Maestro, a orquestração e o Método consultam a cada pedido); escrita só por ação explícita do usuário ou ao fim de uma instalação (semeada pelo padrão global).
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EstadoModulosSuite, EventoModulosMudou, ModuloInfo, PadraoModulos, ResultadoModulos } from "../compartilhado/suite";
import { leitorDeDisco } from "../nucleo/executar/armazem";
import { gravarNaPastaDoProduto } from "../nucleo/orquestracao/pasta";
import {
  ISOLAMENTO_POR_CLI, NOME_ARQUIVO_MODULOS, PADRAO_DE_FABRICA, REQUISITOS_DE_MODULO, avisosDoEstado, dependentesDe, denyDeModulos, desligadosDe, ehModulo,
  lerArquivoModulos, modulosQuebrados, mudarModulo, normalizarPadraoGlobal, serializarModulos, type EstadoModulos, type ModuloId,
} from "../nucleo/suite/modulos";
import { CATALOGO_SUITE } from "../nucleo/suite/modelo";
import { PRODUTO } from "../nucleo/produto";
import { ErroSuite, type PreferenciasSuite } from "./suite";

export const ARQUIVO_MODULOS = `${PRODUTO.pastaNoProjeto}/${NOME_ARQUIVO_MODULOS}`;
export const CHAVE_PADRAO_GLOBAL = "suite_modulos_padrao";

export interface DependenciasModulos {
  pastaDados: string;
  raizDe(workspaceId: string): string | null;
  preferencias: PreferenciasSuite;
  /** a suíte está instalada? (só informativo na tela) */
  suiteInstalada?(workspaceId: string): boolean;
  emitir?(evento: EventoModulosMudou): void;
  barramento?: { emitir(tipo: string, payload: unknown): void };
  aviso?(mensagem: string): void;
  /** injeção de teste: grava na pasta do produto (padrão: `gravarNaPastaDoProduto`) */
  gravarNoProjeto?(raiz: string, rel: string, texto: string): Promise<unknown>;
}

export interface ServicoModulos {
  estado(workspaceId: string): EstadoModulosSuite;
  /** Módulos desligados (ids). Síncrono e barato: a quem consulta a cada pedido. */
  desligados(workspaceId: string): ReadonlySet<string>;
  /** Regras `permissions.deny` do Claude para os módulos desligados do workspace (vazio = nada a negar). */
  denyDoClaude(workspaceId: string): string[];
  definir(workspaceId: string, modulo: string, ligado: boolean, confirmarCascata: boolean): Promise<ResultadoModulos>;
  restaurar(workspaceId: string): Promise<EstadoModulosSuite>;
  /** Fim da instalação: se ainda não há arquivo, grava o padrão global (não sobrescreve nada que exista). */
  semear(workspaceId: string): Promise<void>;
  padrao(): PadraoModulos;
  definirPadrao(modulos: unknown): Promise<PadraoModulos>;
}

const PADRAO_FABRICA_OBJ = (): Record<string, boolean> => ({ ...PADRAO_DE_FABRICA });

export function criarServicoModulos(deps: DependenciasModulos): ServicoModulos {
  const aviso = (m: string): void => deps.aviso?.(`suite/módulos: ${m}`);
  const gravarNoProjeto = deps.gravarNoProjeto ?? gravarNaPastaDoProduto;
  const arquivoDoApp = (ws: string): string => join(deps.pastaDados, "suite", "modulos", `${ws}.json`);

  const raizObrigatoria = (ws: string): string => {
    const raiz = deps.raizDe(ws);
    if (raiz === null) throw new ErroSuite("Workspace desconhecido.");
    return raiz;
  };

  const padraoGlobal = (): EstadoModulos => normalizarPadraoGlobal(deps.preferencias.obter(CHAVE_PADRAO_GLOBAL));

  /** Lê onde estiver: projeto primeiro, depois dados do app. */
  function ler(ws: string, raiz: string): { estado: EstadoModulos; origem: "arquivo" | "app" | "padrao"; avisos: string[] } {
    const avisos: string[] = [];
    const doProjeto = lerArquivoModulos(leitorDeDisco(raiz).ler(ARQUIVO_MODULOS));
    if (doProjeto?.valido === true) return { estado: doProjeto.estado, origem: "arquivo", avisos };
    if (doProjeto !== null && !doProjeto.valido) avisos.push(doProjeto.aviso);
    let doApp: ReturnType<typeof lerArquivoModulos> = null;
    try { doApp = lerArquivoModulos(leitorDeDisco(deps.pastaDados).ler(`suite/modulos/${ws}.json`)); } catch { doApp = null; }
    if (doApp?.valido === true) return { estado: doApp.estado, origem: "app", avisos };
    if (doApp !== null && !doApp.valido) avisos.push(doApp.aviso);
    return { estado: padraoGlobal(), origem: "padrao", avisos };
  }

  function montar(ws: string, raiz: string): EstadoModulosSuite {
    const l = ler(ws, raiz);
    const e = l.estado;
    const textoAviso = (a: ReturnType<typeof avisosDoEstado>[number]): string => {
      const faltam = a.faltando.map((g) => g.join(" ou ")).join("; ");
      return a.tipo === "exige" ? `${a.modulo} está ligado mas precisa de ${faltam}, que está desligado: ele não vai funcionar.` : `${a.modulo} funciona melhor com ${faltam} ligado.`;
    };
    const modulos: ModuloInfo[] = CATALOGO_SUITE.map((c) => {
      const id = c.nome as ModuloId;
      const r = REQUISITOS_DE_MODULO[id];
      return {
        id, nome: id, papel: c.papel, ligado: e[id], padrao_desligado: !PADRAO_DE_FABRICA[id],
        exige: r.exige.map((g) => [...g]), recomenda: r.recomenda.map((g) => [...g]), dependentes: dependentesDe(id), fonte: r.fonte,
      };
    });
    return {
      workspace_id: ws, modulos, origem: l.origem, arquivo: ARQUIVO_MODULOS, desligados: desligadosDe(e), avisos: [...l.avisos, ...avisosDoEstado(e).map(textoAviso)],
      isolamento: ISOLAMENTO_POR_CLI.map((x) => ({ ...x })), suite_instalada: deps.suiteInstalada?.(ws) ?? true,
    };
  }

  const avisarMudou = (ws: string | null): void => {
    try { deps.emitir?.({ workspace_id: ws }); } catch { /* ouvinte com erro não derruba */ }
    try { deps.barramento?.emitir("suite.modulos_mudou", { workspace_id: ws }); } catch { /* idem */ }
  };

  /**
   * A pasta do produto nasce com `.gitignore` = `*` (tudo local). O arquivo de módulos é uma decisão do projeto que o time pode querer versionar: o app só acrescenta
   * `!modulos.json` ao `.gitignore` DA PRÓPRIA pasta do produto (nunca ao do repositório). Falha aqui não impede a gravação.
   */
  async function liberarNoGitignore(raiz: string): Promise<void> {
    const rel = `${PRODUTO.pastaNoProjeto}/.gitignore`;
    const linha = `!${NOME_ARQUIVO_MODULOS}`;
    try {
      const atual = leitorDeDisco(raiz).ler(rel) ?? "*\n";
      if (atual.split(/\r?\n/).includes(linha)) return;
      await gravarNoProjeto(raiz, rel, `${atual.endsWith("\n") ? atual : `${atual}\n`}${linha}\n`);
    } catch { /* o arquivo continua gravado; só não fica liberado para o git */ }
  }

  /** Grava no projeto; sem permissão, nos dados do app. Nunca lança por causa do projeto. */
  async function gravar(ws: string, raiz: string, estado: EstadoModulos, invalidoAntes: boolean): Promise<"arquivo" | "app"> {
    const texto = serializarModulos(estado);
    if (invalidoAntes) {
      // o arquivo existente estava inválido: guarda uma cópia antes de substituí-lo (nunca sobrescreve em silêncio)
      try {
        const velho = leitorDeDisco(raiz).ler(ARQUIVO_MODULOS);
        if (velho !== null) await gravarNoProjeto(raiz, `${ARQUIVO_MODULOS}.invalido`, velho);
      } catch { /* sem cópia: segue */ }
    }
    try {
      await gravarNoProjeto(raiz, ARQUIVO_MODULOS, texto);
      await liberarNoGitignore(raiz);
      return "arquivo";
    } catch (e) {
      aviso(`não deu para gravar ${ARQUIVO_MODULOS} em ${ws} (${e instanceof Error ? e.message.slice(0, 80) : "erro"}); guardando nos dados do app`);
    }
    const caminho = arquivoDoApp(ws);
    mkdirSync(join(deps.pastaDados, "suite", "modulos"), { recursive: true });
    const tmp = `${caminho}.${process.pid}.tmp`;
    writeFileSync(tmp, texto, { mode: 0o600 });
    renameSync(tmp, caminho);
    return "app";
  }

  /** há um arquivo (do projeto ou do app) que existe mas é inválido? */
  const comAvisoDoArquivo = (ws: string, raiz: string): boolean => ler(ws, raiz).avisos.length > 0;

  return {
    estado: (ws) => montar(ws, raizObrigatoria(ws)),

    desligados(ws) {
      const raiz = deps.raizDe(ws);
      if (raiz === null) return new Set();
      try { return new Set(desligadosDe(ler(ws, raiz).estado)); } catch { return new Set(); }
    },

    denyDoClaude(ws) {
      const raiz = deps.raizDe(ws);
      if (raiz === null) return [];
      try { return denyDeModulos(desligadosDe(ler(ws, raiz).estado)); } catch { return []; }
    },

    async definir(ws, modulo, ligado, confirmarCascata) {
      const raiz = raizObrigatoria(ws);
      if (!ehModulo(modulo)) throw new ErroSuite("Módulo desconhecido.");
      const atual = ler(ws, raiz);
      const r = mudarModulo(atual.estado, modulo, ligado, confirmarCascata);
      if (!r.ok) return { ok: false, precisa_confirmar: { tipo: r.precisa_confirmar.tipo, modulos: [...r.precisa_confirmar.modulos] }, estado: montar(ws, raiz) };
      if (r.mudou.length > 0) {
        await gravar(ws, raiz, r.estado, comAvisoDoArquivo(ws, raiz));
        avisarMudou(ws);
      }
      return { ok: true, estado: montar(ws, raiz), mudou: [...r.mudou] };
    },

    async restaurar(ws) {
      const raiz = raizObrigatoria(ws);
      const alvo = padraoGlobal();
      if (modulosQuebrados(alvo).length > 0) throw new ErroSuite("O padrão global deixa algum módulo sem os módulos que ele exige: ajuste o padrão nas Configurações.");
      await gravar(ws, raiz, alvo, comAvisoDoArquivo(ws, raiz));
      avisarMudou(ws);
      return montar(ws, raiz);
    },

    async semear(ws) {
      const raiz = deps.raizDe(ws);
      if (raiz === null) return;
      const l = ler(ws, raiz);
      if (l.origem !== "padrao" || l.avisos.length > 0) return; // já existe (válido ou não: nunca sobrescreve aqui)
      try { await gravar(ws, raiz, padraoGlobal(), false); avisarMudou(ws); } catch (e) { aviso(`semear ${ws}: ${e instanceof Error ? e.message.slice(0, 80) : "erro"}`); }
    },

    padrao: () => ({ modulos: { ...padraoGlobal() }, fabrica: PADRAO_FABRICA_OBJ() }),

    async definirPadrao(modulos) {
      const novo = normalizarPadraoGlobal(modulos);
      const quebrados = modulosQuebrados(novo);
      if (quebrados.length > 0) throw new ErroSuite(`Esse padrão deixaria ${quebrados.join(", ")} sem os módulos que ele exige. Ajuste e tente de novo.`);
      await deps.preferencias.definir(CHAVE_PADRAO_GLOBAL, { ...novo });
      avisarMudou(null);
      return { modulos: { ...novo }, fabrica: PADRAO_FABRICA_OBJ() };
    },
  };
}


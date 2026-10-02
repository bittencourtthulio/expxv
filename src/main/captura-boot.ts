// Ligação de captura e voz no main (Fase 11): registra os canais `captura:*`/`voz:*` (só validadores; nada de serviço, arquivo, processo, microfone nem tela) e cria os serviços SOB DEMANDA,
// no primeiro canal chamado (P-48: 0 serviços de voz/captura antes do primeiro uso). O módulo `electron` e os serviços do app entram por parâmetro (testável sem Electron).
import { join } from "node:path";
import type { EventoCapturaIpc, EventoVozIpc } from "../compartilhado/captura";
import type { ProgressoModelo } from "../compartilhado/voz-local";
import { criarArmazem, type Armazem } from "../nucleo/captura/armazem";
import { PRODUTO } from "../nucleo/produto";
import type { Cofre } from "../nucleo/cofre";
import { criarClienteRede, criarRegistroConsentimento } from "../nucleo/rede";
import { mensagemSegura } from "../nucleo/privacidade/redacao";
import { criarMotorHttp } from "../nucleo/voz/motores/http-compativel";
import { criarMotorComandoLocal } from "../nucleo/voz/motores/comando-local";
import { criarServicoCaptura, type ServicoCaptura } from "./captura";
import { criarCodificadorEletron, criarFonteEletron, criarPortaSistemaEletron, criarPreviaEletron, criarTeclaGlobalEletron, type JanelaMinima, type ModuloElectron } from "./captura-eletron";
import { registrarIpcCaptura } from "./ipc/captura";
import { registrarIpcVoz } from "./ipc/captura-voz";
import type { RegistroIpc } from "./ipc/registro";
import { criarPermissoes, type Permissoes } from "./permissoes";
import { criarServicoVoz, NOME_COFRE_DE, ociosidadeDe, type ServicoVoz } from "./voz";
import { criarRuntimeVoz, type PortaProcesso, type RuntimeVoz } from "../nucleo/voz/local/runtime";
import { carregarCatalogoDe } from "../nucleo/voz/local/catalogo-arquivo";
import type { DisponibilidadeRuntime } from "./voz-modelos-boot";
import { registrarIpcVozModelos } from "./voz-modelos-ipc";
import { criarServicoVozModelos, type ServicoVozModelos } from "./voz-modelos";

/** O que o main precisa das sessões de terminal (o `GerenciadorSessoes` real satisfaz). */
export interface SessoesParaCaptura {
  obter(id: string): { cwd: string; workspace_id: string | null } | undefined;
  escrever(id: string, dados: string): boolean;
}

export interface ElectronParaCaptura extends ModuloElectron {
  clipboard: { writeText(texto: string): void };
  shell: ModuloElectron["shell"] & { trashItem(caminho: string): Promise<void> };
}

export interface JanelaComEventos extends JanelaMinima {
  webContents: JanelaMinima["webContents"] & { send(canal: string, payload: unknown): void };
  show(): void;
  focus(): void;
  restore?(): void;
}

/** Voz local embutida (D-540): pastas, worker e disponibilidade do runtime. Sem isto o motor local não existe (os canais respondem `indisponivel`). */
export interface ParametrosVozLocal {
  /** pasta com `modelos.json` e as amostras do autoteste (`resources/voz`); `null` se ausente. */
  pastaCatalogo: () => string | null;
  /** `<userData>/voz/modelos` */
  pastaModelos: string;
  fabricaProcesso: () => PortaProcesso;
  runtimeDisponivel: () => DisponibilidadeRuntime;
  cpus: number;
}

export interface ParametrosCapturaVoz {
  registro: RegistroIpc;
  electron: ElectronParaCaptura;
  plataforma: NodeJS.Platform;
  userData: string;
  preferencias: { obter(chave: string): unknown; definir(chave: string, valor: unknown): Promise<void> };
  janela: () => JanelaComEventos | null;
  workspaceRaiz: (workspaceId: string) => string | null;
  sessoes: () => Promise<SessoesParaCaptura>;
  cofre: () => Promise<Cofre>;
  aviso?: (mensagem: string) => void;
  voz?: ParametrosVozLocal;
}

export interface LigacaoCapturaVoz {
  /** o serviço de captura/voz já foi criado? (P-48: falso até o primeiro uso) */
  criados(): { captura: boolean; voz: boolean };
  permissoes(): Permissoes;
  obterCaptura(): Promise<ServicoCaptura>;
  obterVoz(): Promise<ServicoVoz>;
  obterModelos(): Promise<ServicoVozModelos>;
  encerrar(): Promise<void>;
}

export function ligarCapturaVoz(p: ParametrosCapturaVoz): LigacaoCapturaVoz {
  let captura: Promise<ServicoCaptura> | null = null;
  let voz: Promise<ServicoVoz> | null = null;
  let capturaPronta: ServicoCaptura | null = null;
  let vozPronta: ServicoVoz | null = null;
  let modelosPronto: ServicoVozModelos | null = null;
  let runtimeVoz: RuntimeVoz | null = null;
  const permissoes = criarPermissoes(criarPortaSistemaEletron(p.electron, p.plataforma));
  const aviso = (m: string): void => p.aviso?.(m);
  const armazens = new Map<string, Armazem>();

  const emitir = (canal: "captura:evento" | "voz:evento" | "voz:modelo_progresso", payload: EventoCapturaIpc | EventoVozIpc | ProgressoModelo): void => {
    const j = p.janela();
    if (j !== null && !j.isDestroyed()) j.webContents.send(canal, payload);
  };
  const trazerJanela = (): void => {
    const j = p.janela();
    if (j === null || j.isDestroyed()) return;
    j.restore?.();
    j.show();
    j.focus();
  };

  function armazemDe(ws: string | null): Armazem | null {
    const chave = ws ?? "";
    const guardado = armazens.get(chave);
    if (guardado !== undefined) return guardado;
    const lixeira = (caminho: string): Promise<void> => p.electron.shell.trashItem(caminho);
    let a: Armazem;
    if (ws === null) {
      a = criarArmazem({ pasta: join(p.userData, "capturas"), raiz: p.userData, lixeira });
    } else {
      const raiz = p.workspaceRaiz(ws);
      if (raiz === null) return null;
      a = criarArmazem({ pasta: join(raiz, PRODUTO.pastaNoProjeto, "capturas"), raiz, pastaProduto: join(raiz, PRODUTO.pastaNoProjeto), lixeira });
    }
    armazens.set(chave, a);
    return a;
  }

  function obterCaptura(): Promise<ServicoCaptura> {
    captura ??= (async () => {
      const sessoes = await p.sessoes();
      const svc = criarServicoCaptura({
        fonte: criarFonteEletron(p.electron, p.janela),
        codificador: criarCodificadorEletron(p.electron),
        previa: criarPreviaEletron(p.electron),
        permissoes,
        prefs: p.preferencias,
        armazem: armazemDe,
        sessao: (id) => { const s = sessoes.obter(id); return s === undefined ? undefined : { cwd: s.cwd, workspace_id: s.workspace_id }; },
        escrever: (id, texto) => { try { return sessoes.escrever(id, texto); } catch { return false; } },
        copiarTexto: (t) => p.electron.clipboard.writeText(t),
        emitir: (e) => emitir("captura:evento", e),
        teclas: criarTeclaGlobalEletron(p.electron),
        trazerJanela,
        aviso,
      });
      // atalhos globais SÓ se a pessoa ligou antes (opt-in persistido)
      if (p.preferencias.obter("captura_atalhos_globais") === true) await svc.configGravar({ atalhos_globais: true });
      capturaPronta = svc;
      return svc;
    })().catch((e: unknown) => { captura = null; throw e; });
    return captura;
  }

  function obterVoz(): Promise<ServicoVoz> {
    voz ??= (async () => {
      const sessoes = await p.sessoes();
      const registroRede = criarRegistroConsentimento();
      const rede = criarClienteRede({ consentimento: registroRede, scrub: (t) => mensagemSegura(t, 500) });
      // voz local embutida: catálogo, download consentido e runtime em processo próprio (nada disto roda antes do primeiro uso da voz)
      if (p.voz !== undefined) {
        const lv = p.voz;
        runtimeVoz = criarRuntimeVoz({ fabrica: lv.fabricaProcesso, ociosidade_ms: () => ociosidadeDe(p.preferencias.obter("voz_local_ociosidade_s")) * 1000 });
        modelosPronto = criarServicoVozModelos({
          catalogo: () => { const dir = lv.pastaCatalogo(); return dir === null ? { ok: false, motivo: "catálogo de modelos ausente" } : carregarCatalogoDe(dir); },
          pastaModelos: lv.pastaModelos,
          pastaAmostras: lv.pastaCatalogo() ?? "",
          prefs: p.preferencias,
          rede,
          registroRede,
          runtime: runtimeVoz,
          runtimeDisponivel: lv.runtimeDisponivel,
          ativarMotor: async (id) => { await vozPronta?.configGravar(id === null ? { motor: "nenhum", modelo_local: null } : { motor: "local_embutido", modelo_local: id }); },
          motorAtual: () => ({ motor: String(p.preferencias.obter("voz_motor") ?? "nenhum"), modelo_local: typeof p.preferencias.obter("voz_modelo_local") === "string" ? (p.preferencias.obter("voz_modelo_local") as string) : null }),
          ociosidade_s: () => ociosidadeDe(p.preferencias.obter("voz_local_ociosidade_s")),
          emitir: (e) => emitir("voz:modelo_progresso", e),
          cpus: lv.cpus,
        });
      }
      const svc = criarServicoVoz({
        permissoes,
        prefs: p.preferencias,
        segredos: {
          disponivel: async () => (await (await p.cofre()).estado()).ok,
          guardar: async (nome, valor) => { await (await p.cofre()).guardar({ id: null, nome: NOME_COFRE_DE[nome], valor, escopo: "global", workspace_id: null, sensivel: true }); },
          existe: async (nome) => (await p.cofre()).existe(NOME_COFRE_DE[nome]),
          obter: async (nome) => { try { return await (await p.cofre()).obter(NOME_COFRE_DE[nome]); } catch { return null; } },
          apagar: async (nome) => {
            const c = await p.cofre();
            for (const e of await c.listar()) if (e.nome === NOME_COFRE_DE[nome]) await c.apagar(e.id);
          },
        },
        motores: {
          comandoLocal: (executavel, args) => criarMotorComandoLocal({ executavel, args }),
          http: (url, chave, consentido) => criarMotorHttp({ url, chave, consentido, rede, registroRede }),
        },
        ...(modelosPronto !== null ? { local: modelosPronto.local } : {}),
        sessaoExiste: (id) => sessoes.obter(id) !== undefined,
        escrever: (id, texto) => { try { return sessoes.escrever(id, texto); } catch { return false; } },
        emitir: (e) => emitir("voz:evento", e),
        teclas: criarTeclaGlobalEletron(p.electron),
        trazerJanela,
        aviso,
      });
      if (p.preferencias.obter("voz_alternar_global") === true) await svc.configGravar({ alternar_global: true });
      vozPronta = svc;
      return svc;
    })().catch((e: unknown) => { voz = null; throw e; });
    return voz;
  }

  registrarIpcCaptura({ registro: p.registro, servico: obterCaptura, aviso });
  registrarIpcVoz({ registro: p.registro, servico: obterVoz, aviso });
  function obterModelos(): Promise<ServicoVozModelos> {
    return obterVoz().then(() => {
      if (modelosPronto === null) throw new Error("[indisponivel] Voz local indisponível nesta instalação.");
      return modelosPronto;
    });
  }
  registrarIpcVozModelos({ registro: p.registro, servico: obterModelos, aviso });

  return {
    criados: () => ({ captura: capturaPronta !== null, voz: vozPronta !== null }),
    permissoes: () => permissoes,
    obterCaptura,
    obterVoz,
    obterModelos,
    async encerrar() {
      await capturaPronta?.encerrar().catch(() => undefined);
      await vozPronta?.encerrar().catch(() => undefined);
      await modelosPronto?.encerrar().catch(() => undefined); // o processo de reconhecimento não sobrevive ao app
    },
  };
}

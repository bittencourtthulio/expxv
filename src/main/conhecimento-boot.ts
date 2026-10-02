// Montagem do Conhecimento + Chat no main (Fase 15, onda 2): liga o worker, o chat e os canais ao resto do app SEM nada no boot da janela. O
// `main.ts` só chama `montarConhecimento` (import preguiçoso) depois do domínio e `iniciar()` na onda 2. Aqui ficam os detalhes que dependem
// do SO e das CLIs: caminho real da CLI (detector), ambiente seguro, `--help` para `verificarFlags`, pasta neutra do chat e ponte do Ollama.
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { CanaisEvento } from "../compartilhado/ipc";
import type { Banco } from "../nucleo/banco";
import type { Repositorios } from "../nucleo/banco/repos";
import type { ServicoMissoes } from "../nucleo/missoes/servico";
import type { ServicoPanes } from "../nucleo/missoes/panes";
import type { PortaRoteamento } from "../nucleo/conhecimento/chat/perfil";
import { ambienteSeguro } from "../nucleo/terminais/ambiente";
import type { Barramento } from "./barramento";
import { criarServicoChat, type ServicoChat } from "./chat";
import { ligarConhecimento, type LigacaoConhecimento } from "./conhecimento";
import { registrarIpcConhecimento, type ManipuladoresRag } from "./ipc/conhecimento";
import type { RegistroIpc } from "./ipc/registro";
import { criarRedeOllama } from "./rede-ollama";

/** O que o detector de CLIs (terminais) oferece a este módulo. */
export interface DetectorDeClis {
  detectar(): Promise<Array<{ id: string; instalado: boolean; executavel_id: string | null }>>;
  registro: { obter(id: string): { caminho: string; modo_lancamento: string | null } | undefined };
}

export interface DepsMontagemConhecimento {
  banco: Banco;
  repos: Repositorios;
  missoes: Pick<ServicoMissoes, "criar" | "garantirPastaMissao">;
  panes: Pick<ServicoPanes, "abrirPane" | "enviarComando">;
  barramento: Pick<Barramento, "assinar" | "emitir" | "emitirCoalescido">;
  registro: RegistroIpc;
  userData: string;
  home: string;
  /** `dist/main` (ou `app.asar/dist/main`): de onde sai o `conhecimento-worker.js`. */
  dirMain: string;
  empacotado: boolean;
  preferencias: { obter(chave: string): unknown };
  detector: DetectorDeClis;
  /** sessão do PTY → id de conversa da CLI (`terminais.conversas.listar`). */
  conversas: () => Record<string, string>;
  enviar: <C extends keyof CanaisEvento>(canal: C, payload: CanaisEvento[C]) => void;
  escolherArquivoDeSaida: (nomeSugerido: string) => Promise<string | null>;
  ocioso: () => boolean;
  /** Fase 9: troca por consumo (outra conta/modelo do mesmo provedor ou equivalente). */
  roteamento?: PortaRoteamento | null;
  /** `rag:*` (backend online opcional); ausente = canais não registrados. */
  rag?: (lig: LigacaoConhecimento) => { manipuladores: ManipuladoresRag; metodosDoMain?: Readonly<Record<string, (args: unknown[], sinal: AbortSignal) => unknown>>; aoAbrir?(workspaceId: string): Promise<void>; iniciar?(): void; encerrar?(): void };
  aviso?: (mensagem: string) => void;
  /** testes: thread em processo. */
  criarThread?: Parameters<typeof ligarConhecimento>[0]["criarThread"];
}

export interface MontagemConhecimento {
  lig: LigacaoConhecimento;
  chat: ServicoChat;
  iniciar(): Promise<void>;
  encerrar(): void;
}

/** `app.asar` → `app.asar.unpacked`: worker_threads não lê de dentro do asar. */
const foraDoAsar = (c: string): string => c.replace(/app\.asar(?=[\\/])/, "app.asar.unpacked");

function ajudaDaCli(caminho: string, ambiente: Record<string, string>): Promise<string | null> {
  return new Promise((resolver) => {
    execFile(caminho, ["--help"], { env: ambiente, timeout: 6_000, maxBuffer: 1024 * 1024, windowsHide: true, shell: false }, (erro, stdout, stderr) => {
      const saida = `${String(stdout)}\n${String(stderr)}`;
      resolver(erro !== null && saida.trim() === "" ? null : saida);
    });
  });
}

export function montarConhecimento(d: DepsMontagemConhecimento): MontagemConhecimento {
  const redeOllama = criarRedeOllama();
  let rag: ReturnType<NonNullable<DepsMontagemConhecimento["rag"]>> | null = null;
  const metodosDoMain: Record<string, (args: unknown[], sinal: AbortSignal) => unknown> = {};

  const sessoesDoApp = (workspaceId: string): string[] => {
    try {
      const mapa = d.conversas();
      const sessoes = d.banco.consultar<{ sessao_pty_id: string }>("SELECT sessao_pty_id FROM pane WHERE workspace_id = ? AND sessao_pty_id IS NOT NULL", [workspaceId]);
      return sessoes.map((s) => mapa[s.sessao_pty_id]).filter((c): c is string => typeof c === "string" && c !== "");
    } catch {
      return [];
    }
  };

  const lig = ligarConhecimento({
    banco: d.banco,
    repos: d.repos,
    barramento: d.barramento,
    pastaDados: d.userData,
    home: d.home,
    caminhoWorker: d.empacotado ? foraDoAsar(join(d.dirMain, "conhecimento-worker.js")) : join(d.dirMain, "conhecimento-worker.js"),
    preferencias: d.preferencias,
    enviar: d.enviar,
    escolherArquivoDeSaida: d.escolherArquivoDeSaida,
    ocioso: d.ocioso,
    redeOllama,
    metodosDoMain,
    sessoesDoApp,
    ...(d.aviso === undefined ? {} : { aviso: d.aviso }),
    ...(d.criarThread === undefined ? {} : { criarThread: d.criarThread }),
  });

  const resolverCli = async (cli: string): Promise<{ caminho: string; modo: string | null } | null> => {
    const f = (await d.detector.detectar()).find((x) => x.id === cli && x.instalado && x.executavel_id !== null);
    const e = f?.executavel_id == null ? undefined : d.detector.registro.obter(f.executavel_id);
    return e === undefined ? null : { caminho: e.caminho, modo: e.modo_lancamento };
  };

  const pastaNeutra = join(d.userData, "chat", "cwd");
  const chat = criarServicoChat({
    repos: lig.repos,
    config: d.repos.config,
    rag: lig.rag,
    workspace: lig.workspace,
    missoes: {
      criar: async (p) => {
        const m = await d.missoes.criar(p);
        return { id: m.id, worktree: m.worktree };
      },
      garantirPastaMissao: (id) => d.missoes.garantirPastaMissao(id),
    },
    panes: {
      abrirPane: async (p) => {
        const r = await d.panes.abrirPane(p);
        return { pane: { id: r.pane.id, cli: r.pane.cli } };
      },
      enviarComando: (id, texto) => d.panes.enviarComando(id, texto),
    },
    estadoDoPane: (id) => d.repos.pane.obter(id)?.estado ?? null,
    resolverCli,
    ajudaCli: (_cli, caminho) => ajudaDaCli(caminho, ambienteSeguro({ caminho })),
    ambiente: (caminho) => ambienteSeguro({ caminho }),
    pastaNeutra,
    ...(d.roteamento === undefined ? {} : { roteamento: d.roteamento }),
    enviar: d.enviar,
    registrarEntrada: (ws, entrada) => {
      void lig.chamarWs(ws, "registrarLote", [[entrada]]).catch(() => undefined);
    },
    ...(d.aviso === undefined ? {} : { aviso: d.aviso }),
  });

  // destilação por IA (P-56): a mesma CLI do chat, faixa rápida; erro/timeout deixam o determinístico como está
  lig.definirDestilador((ws, prompt, sinal) => chat.destilar(ws, prompt, sinal));

  // o backend online precisa dos métodos que o worker chama no main (rede com consentimento): registrar ANTES de o worker subir
  if (d.rag !== undefined) {
    rag = d.rag(lig);
    Object.assign(metodosDoMain, rag.metodosDoMain ?? {});
    if (rag.aoAbrir !== undefined) lig.aoAbrirWorkspace(rag.aoAbrir);
  }
  registrarIpcConhecimento({ registro: d.registro, conhecimento: lig.manipuladores, chat: chat.manipuladores, ...(rag === null ? {} : { rag: rag.manipuladores }) });

  return {
    lig,
    chat,
    async iniciar() {
      try {
        mkdirSync(pastaNeutra, { recursive: true });
      } catch {
        /* criada de novo no primeiro uso */
      }
      await lig.iniciar();
      rag?.iniciar?.();
    },
    encerrar() {
      chat.encerrar();
      rag?.encerrar?.();
      lig.encerrar();
    },
  };
}

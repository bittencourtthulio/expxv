// Daemon de PTY do lado do app (D-12). Sobe na ONDA 2 do boot (nunca na onda 1, P-01) e guarda o
// `ClienteDaemon`, que fala com ele por socket e cai sozinho na reserva (`AdaptadorNodePty`, no
// próprio processo) se o daemon não sobe. As sessões persistentes sobrevivem ao app: fechar o app
// NÃO mata os painéis. O daemon só é encerrado quando não há sessão viva a preservar, ou por pedido
// explícito (`encerrarTudo`: menu "sair e encerrar", instalar atualização).
//
// O daemon roda o MESMO executável do app em modo Node (ELECTRON_RUN_AS_NODE=1) apontando para
// `dist/daemon/main-daemon.js`. Empacotado, o script fica fora do asar (asarUnpack: dist/daemon/**).

import { join } from "node:path";
import { caminhosDoDaemon, lerOuCriarToken } from "../daemon/caminhos";
import { ClienteDaemon, type EstadoCliente, type OpcoesCliente } from "../daemon/cliente";
import { lancarDaemon } from "../daemon/lancador";
import type { AdaptadorPty } from "../nucleo/terminais/lancamento";
import { variavelDeAmbiente } from "../nucleo/produto";

/** Ocioso do daemon nos testes ponta a ponta: sai logo depois que o último cliente e o último processo se vão. */
export const OCIOSO_E2E_MS = 2_000;
const ESPERA_CONTAGEM_MS = 1_500;

/** O que o serviço usa do cliente (o `ClienteDaemon` real cumpre; teste injeta um falso). */
export type ClienteDaemonUsado = AdaptadorPty & Pick<ClienteDaemon, "pronto" | "listar" | "encerrarTudo" | "fechar" | "estado">;

export interface OpcoesServicoDaemon {
  /** pasta de dados do app (userData). Daemon e socket derivam dela. */
  dadosApp: string;
  /** executável do app (em pacote, o Electron; roda como Node com ELECTRON_RUN_AS_NODE). */
  executavel: string;
  /** caminho do `main-daemon.js` já resolvido para fora do asar. */
  script: string;
  /** testes ponta a ponta: daemon com ocioso curto. */
  e2e?: boolean;
  /** `<PRODUTO>_SEM_DAEMON=1`: não sobe daemon (sessões vivem no app). */
  desligado?: boolean;
  reserva: AdaptadorPty;
  criarCliente?: (op: OpcoesCliente) => ClienteDaemonUsado;
  lancar?: typeof lancarDaemon;
  /** Observa o estado da conexão com o daemon (a UI pode mostrar "reconectando…"). */
  aoMudarEstado?: (estado: EstadoCliente) => void;
}

export interface ServicoDaemon {
  /** Conecta ao daemon (subindo-o se preciso). Idempotente. Não espera a conexão. */
  iniciar(): void;
  readonly iniciado: boolean;
  /** O adaptador das sessões: o cliente do daemon, ou a reserva se o daemon está desligado ou não subiu. */
  adaptador(): AdaptadorPty;
  /** Quantas sessões estão executando dentro do daemon (0 sem daemon). */
  sessoesVivas(): Promise<number>;
  /**
   * Saída do app: encerra o daemon só se não há sessão viva a preservar; em qualquer caso fecha a
   * conexão. Em dúvida (não conseguiu contar a tempo) PRESERVA. `preservou` diz o que aconteceu.
   */
  aoSairDoApp(): Promise<{ preservou: boolean; vivas: number }>;
  /** Explícito: mata todas as sessões e manda o daemon sair. */
  encerrarTudo(): Promise<void>;
}

export function variavelSemDaemon(): string {
  return variavelDeAmbiente("SEM_DAEMON");
}

export function scriptDoDaemon(diretorioDoMain: string, empacotado: boolean): string {
  const script = join(diretorioDoMain, "..", "daemon", "main-daemon.js");
  // Em pacote o caminho passa por `app.asar`; o que roda com ELECTRON_RUN_AS_NODE precisa estar em disco.
  return empacotado ? script.replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2") : script;
}

export function criarServicoDaemon(op: OpcoesServicoDaemon): ServicoDaemon {
  let cliente: ClienteDaemonUsado | null = null;
  let iniciado = false;
  let jaFalou = false;

  const criar = op.criarCliente ?? ((o: OpcoesCliente): ClienteDaemonUsado => new ClienteDaemon(o));
  const lancar = op.lancar ?? lancarDaemon;

  async function vivas(): Promise<number> {
    if (cliente === null) return 0;
    return (await cliente.listar()).filter((s) => s.estado === "executando").length;
  }

  return {
    iniciar() {
      if (iniciado) return;
      iniciado = true;
      if (op.desligado === true) return;
      try {
        const caminhos = caminhosDoDaemon(op.dadosApp);
        const token = lerOuCriarToken(caminhos.arquivo_token, caminhos.dir);
        cliente = criar({
          socket: caminhos.socket,
          token,
          reserva: op.reserva,
          aoMudarEstado: (estado) => {
            // AUD-09: o cliente religa sozinho (com backoff); só a falha final é terminal
            if (estado === "reconectando") console.error("[daemon] conexão perdida: tentando religar…");
            else if (estado === "falhou") console.error("[daemon] não voltou: as sessões acabaram; abra um novo terminal");
            else if (estado === "conectado" && jaFalou) console.error("[daemon] religado");
            if (estado === "reconectando") jaFalou = true;
            op.aoMudarEstado?.(estado);
          },
          iniciarDaemon: () => lancar({
            executavel: op.executavel,
            script: op.script,
            dir: caminhos.dir,
            socket: caminhos.socket,
            ...(op.e2e === true ? { ocioso_ms: OCIOSO_E2E_MS } : {}),
          }),
        });
        void cliente.pronto.then((ok) => { if (!ok) console.error("[daemon] indisponível: as sessões acabam junto com o app"); });
      } catch (erro) {
        cliente = null;
        console.error(`[daemon] não iniciou: ${erro instanceof Error ? erro.message : String(erro)}`);
      }
    },
    get iniciado() { return iniciado; },
    adaptador: () => cliente ?? op.reserva,
    sessoesVivas: () => vivas().catch(() => 0),
    async aoSairDoApp() {
      const atual = cliente;
      if (atual === null) return { preservou: false, vivas: 0 };
      let contagem: number | null = null;
      try {
        contagem = await Promise.race([
          vivas(),
          new Promise<null>((resolver) => { const t = setTimeout(() => resolver(null), ESPERA_CONTAGEM_MS); t.unref(); }),
        ]);
      } catch { contagem = null; }
      const preservar = contagem === null || contagem > 0;
      if (!preservar) {
        await Promise.race([
          atual.encerrarTudo().catch(() => undefined),
          new Promise<void>((resolver) => { const t = setTimeout(resolver, ESPERA_CONTAGEM_MS); t.unref(); }),
        ]);
      }
      await atual.fechar().catch(() => undefined);
      cliente = null;
      return { preservou: preservar, vivas: contagem ?? -1 };
    },
    async encerrarTudo() {
      await cliente?.encerrarTudo().catch(() => undefined);
    },
  };
}

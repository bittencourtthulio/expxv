import type { CanaisEnvio, CanaisInvoke, NomeEnvio, NomeInvoke } from "../../compartilhado/ipc";
import { CANAIS_ENVIO, CANAIS_INVOKE, CANAIS_SENSIVEIS } from "../../compartilhado/ipc";
import type { Validador } from "./validar";

/**
 * Registro tipado de canais. Um canal só é registrado se estiver no mapa compartilhado E com
 * validador; payload inválido e remetente não autorizado são recusados ANTES do manipulador.
 */

export interface EventoIpc {
  senderFrameUrl: string;
  frameEhPrincipal: boolean;
  janelaId: number;
}

export interface IpcMainLike {
  handle(canal: string, listener: (evento: unknown, ...args: unknown[]) => unknown): void;
  on(canal: string, listener: (evento: unknown, ...args: unknown[]) => void): void;
  removeHandler(canal: string): void;
  removeAllListeners(canal: string): void;
}

export class CanalRecusadoErro extends Error {
  constructor(readonly canal: string, readonly motivo: string) {
    super(`canal ${canal} recusado: ${motivo}`);
    this.name = "CanalRecusadoErro";
  }
}

export interface OpcoesRegistro {
  ipcMain: IpcMainLike;
  /** extrai o remetente do evento nativo e diz se é autorizado. */
  autorizar: (evento: unknown) => boolean;
  aoRecusar?: (canal: string, motivo: string) => void;
  /**
   * Log de diagnóstico do registro (uma linha por chamada). NUNCA recebe o payload de um canal `sensivel`
   * (CANAIS_SENSIVEIS) e, nestes canais, o motivo da recusa é genérico (o nome de um campo enviado pelo renderer
   * também poderia carregar segredo). Para os demais, o payload só entra se `logarPayload` for verdadeiro.
   */
  log?: (linha: string) => void;
  logarPayload?: boolean;
}

/** Canal que carrega segredo no payload: o log do registro nunca o imprime. */
export function canalSensivel(canal: string): boolean {
  return (CANAIS_SENSIVEIS as readonly string[]).includes(canal);
}

const MOTIVO_SENSIVEL = "payload inválido";

export interface RegistroIpc {
  invoke<C extends NomeInvoke>(
    canal: C,
    validador: Validador<CanaisInvoke[C]["entrada"]>,
    manipulador: (entrada: CanaisInvoke[C]["entrada"], evento: unknown) => CanaisInvoke[C]["saida"] | Promise<CanaisInvoke[C]["saida"]>,
  ): void;
  envio<C extends NomeEnvio>(
    canal: C,
    validador: Validador<CanaisEnvio[C]["entrada"]>,
    manipulador: (entrada: CanaisEnvio[C]["entrada"], evento: unknown) => void,
  ): void;
  registrados(): string[];
  remover(): void;
}

export function criarRegistroIpc(op: OpcoesRegistro): RegistroIpc {
  const registrados = new Set<string>();

  function registrar(canal: string, resultado: "ok" | "recusado", motivo: string | null, payload: unknown): void {
    if (op.log === undefined) return;
    const sensivel = canalSensivel(canal);
    let linha = `ipc ${canal} ${resultado}`;
    if (motivo !== null) linha += ` (${sensivel ? MOTIVO_SENSIVEL : motivo})`;
    if (sensivel) linha += " [sensivel: payload omitido]";
    else if (op.logarPayload === true) {
      try {
        linha += ` ${JSON.stringify(payload)}`;
      } catch {
        linha += " [payload não serializável]";
      }
    }
    op.log(linha);
  }

  function garantirNovo(canal: string): void {
    if (registrados.has(canal)) throw new Error(`canal duplicado: ${canal}`);
    registrados.add(canal);
  }

  return {
    invoke(canal, validador, manipulador) {
      if (!(CANAIS_INVOKE as readonly string[]).includes(canal)) throw new Error(`canal fora do contrato: ${canal}`);
      garantirNovo(canal);
      op.ipcMain.handle(canal, async (evento, ...args) => {
        if (!op.autorizar(evento)) {
          op.aoRecusar?.(canal, "remetente");
          registrar(canal, "recusado", "remetente não autorizado", args[0]);
          throw new CanalRecusadoErro(canal, "remetente não autorizado");
        }
        const r = validador(args[0]);
        if (!r.ok) {
          const motivo = canalSensivel(canal) ? MOTIVO_SENSIVEL : r.erro;
          op.aoRecusar?.(canal, motivo);
          registrar(canal, "recusado", r.erro, args[0]);
          throw new CanalRecusadoErro(canal, motivo);
        }
        registrar(canal, "ok", null, args[0]);
        return manipulador(r.valor, evento);
      });
    },
    envio(canal, validador, manipulador) {
      if (!(CANAIS_ENVIO as readonly string[]).includes(canal)) throw new Error(`canal fora do contrato: ${canal}`);
      garantirNovo(canal);
      op.ipcMain.on(canal, (evento, ...args) => {
        if (!op.autorizar(evento)) {
          op.aoRecusar?.(canal, "remetente");
          registrar(canal, "recusado", "remetente não autorizado", args[0]);
          return;
        }
        const r = validador(args[0]);
        if (!r.ok) {
          const motivo = canalSensivel(canal) ? MOTIVO_SENSIVEL : r.erro;
          op.aoRecusar?.(canal, motivo);
          registrar(canal, "recusado", r.erro, args[0]);
          return;
        }
        registrar(canal, "ok", null, args[0]);
        manipulador(r.valor, evento);
      });
    },
    registrados: () => [...registrados].sort(),
    remover() {
      for (const canal of registrados) {
        op.ipcMain.removeHandler(canal);
        op.ipcMain.removeAllListeners(canal);
      }
      registrados.clear();
    },
  };
}

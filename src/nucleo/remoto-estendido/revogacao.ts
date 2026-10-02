// Revogação em dois níveis e pânico (T-22.12). Nível 1 (AUTORITATIVO): o host. O armazém da Fase 13 só devolve dispositivo ativo (`ativo(id)`), e o tratador confere isso a CADA quadro:
// um dispositivo revogado nunca autentica, haja ou não aviso ao relay, e quadro gravado antes da revogação não autentica depois. Nível 2 (otimização): desregistrar o canal no relay e
// apagar o segredo de canal do cofre. Pânico: fecha TODOS os sockets, cancela o pareamento, revoga todos e apaga os segredos; resultado «0 sockets» em ≤ 1 s (P-166).
import { nomeSegredoCanal } from "./pareamento-relay";

export interface PortaClienteRevogavel {
  desregistrar(): void;
  fechar(): void;
}
export interface DepsRevogacao {
  clientes: Map<string, PortaClienteRevogavel>;
  /** pareamento em curso (canal efêmero), se houver. */
  efemero(): PortaClienteRevogavel | null;
  cancelarPareamento(): void;
  apagarSegredo(nome: string): Promise<void>;
  marcarRevogado(dispositivoId: string): void;
  evento(tipo: "revogado" | "panico", dispositivoId: string | null, motivo: string | null): void;
  /** revoga todos no armazém do host (autoritativo); devolve quantos. */
  revogarTodosNoHost(): Promise<unknown>;
  dispositivosComCanal(): string[];
  aoMudar(): void;
}
export interface Revogacao {
  /** chamada pelo armazém no instante da revogação (só o dispositivo afetado; os outros seguem). */
  aoRevogado(dispositivoId: string): void;
  panico(): Promise<void>;
}

export function criarRevogacao(d: DepsRevogacao): Revogacao {
  const fecharTudo = (c: PortaClienteRevogavel): void => {
    try {
      c.desregistrar();
    } catch {
      try {
        c.fechar();
      } catch {
        /* já fechado */
      }
    }
  };
  return {
    aoRevogado(id) {
      const c = d.clientes.get(id);
      d.clientes.delete(id);
      if (c !== undefined) fecharTudo(c);
      d.marcarRevogado(id);
      void d.apagarSegredo(nomeSegredoCanal(id)).catch(() => undefined);
      d.evento("revogado", id, null);
      d.aoMudar();
    },
    async panico() {
      // 1) sockets primeiro: o orçamento é «0 sockets ≤ 1 s»
      for (const c of d.clientes.values()) fecharTudo(c);
      d.clientes.clear();
      const e = d.efemero();
      if (e !== null) fecharTudo(e);
      d.cancelarPareamento();
      // 2) depois a parte autoritativa: o host revoga todos (derruba sessões e cancela pendências) e os segredos de canal somem
      const ids = d.dispositivosComCanal();
      await d.revogarTodosNoHost().catch(() => undefined);
      await Promise.all(ids.map((id) => d.apagarSegredo(nomeSegredoCanal(id)).catch(() => undefined)));
      for (const id of ids) d.marcarRevogado(id);
      d.evento("panico", null, `canais: ${ids.length}`);
      d.aoMudar();
    },
  };
}

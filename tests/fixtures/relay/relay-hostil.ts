// Relay EM PROCESSO para os testes da Fase 22: o roteador REAL (puro) ligado a conexões falsas, com relógio e timers virtuais e um INTERPOSITOR que age como um relay hostil
// (adultera, repete, reordena, descarta, atrasa, duplica, fecha). Sem rede, sem timers reais. O host (`cliente-relay`) e o celular falso usam a mesma fábrica `abrirWs`.
import { randomBytes } from "node:crypto";
import type { ConexaoWs, OpcoesWs } from "../../../src/nucleo/remoto-estendido/ws-cliente";
import { criarRoteador, type Acao, type Roteador } from "../../../src/nucleo/relay/roteador";
import type { ConfigLimites } from "../../../src/nucleo/relay/limites";

export interface Agendador {
  agora(): number;
  agendar(fn: () => void, ms: number): () => void;
  /** avança o relógio virtual disparando os timers vencidos, em ordem. */
  avancar(ms: number): Promise<void>;
  pendentes(): number;
}
export function agendadorVirtual(t0 = Date.parse("2026-10-01T12:00:00Z")): Agendador {
  let t = t0;
  let id = 0;
  const fila = new Map<number, { em: number; fn: () => void }>();
  const assentar = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) await new Promise<void>((r) => setImmediate(r));
  };
  return {
    agora: () => t,
    agendar(fn, ms) {
      const k = ++id;
      fila.set(k, { em: t + ms, fn });
      return () => void fila.delete(k);
    },
    pendentes: () => fila.size,
    async avancar(ms) {
      const alvo = t + ms;
      for (;;) {
        let prox: [number, { em: number; fn: () => void }] | null = null;
        for (const e of fila) if (e[1].em <= alvo && (prox === null || e[1].em < prox[1].em)) prox = e;
        if (prox === null) break;
        fila.delete(prox[0]);
        t = Math.max(t, prox[1].em);
        prox[1].fn();
        await assentar();
      }
      t = alvo;
      await assentar();
    },
  };
}

export interface Nó {
  id: string;
  papel: "host" | "cliente" | "?";
  ip: string;
  criadoEm: number;
  opcoes: OpcoesWs;
  fechadaCom: number | null;
  /** o que este nó enviou ao relay (texto e binário), para inspeção. */
  enviados: Array<string | Uint8Array>;
  /** o que o relay entregou a este nó. */
  recebidos: Array<string | Uint8Array>;
}
export type Decisao = { dados: Uint8Array } | { dados: Uint8Array; atrasar: true };
export type Interpositor = (info: { de: "host" | "cliente" | "?"; para: string; dados: Uint8Array }) => Decisao[];

export interface RedeFalsa {
  roteador: Roteador;
  nos: Map<string, Nó>;
  /** fábrica `abrirWs` ligada a este relay; `ip` identifica quem conecta. */
  fabrica(ip?: string): (o: OpcoesWs) => ConexaoWs;
  interpositor: Interpositor | null;
  /** libera os quadros atrasados (na ordem dada). */
  liberarAtrasados(ordem?: "fifo" | "lifo"): Promise<void>;
  atrasados(): number;
  assentar(): Promise<void>;
  /** o relay hostil derruba todas as conexões. */
  fecharTudo(codigo?: number): Promise<void>;
  /** todo byte que passou pelo relay (texto e binário), para a prova de cegueira. */
  trafego: Array<string | Uint8Array>;
  conexoesAbertas(): number;
  /** quando verdadeiro, `abrirWs` lança (relay inalcançável). */
  indisponivel: boolean;
}

export function criarRedeFalsa(ag: Agendador, limites?: Partial<ConfigLimites>): RedeFalsa {
  const roteador = criarRoteador({ relogio: { agora: ag.agora }, aleatorio: (n) => randomBytes(n), ...(limites === undefined ? {} : { limites }) });
  const nos = new Map<string, Nó>();
  const atrasados: Array<{ para: string; dados: Uint8Array }> = [];
  const trafego: Array<string | Uint8Array> = [];
  let seq = 0;
  let pendentes = 0;
  const assentar = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) await new Promise<void>((r) => setImmediate(r));
    while (pendentes > 0) await new Promise<void>((r) => setImmediate(r));
  };
  const entregar = (id: string, f: () => void): void => {
    pendentes++;
    queueMicrotask(() => {
      try {
        f();
      } finally {
        pendentes--;
      }
    });
  };
  const rede: RedeFalsa = {
    roteador,
    nos,
    interpositor: null,
    trafego,
    indisponivel: false,
    atrasados: () => atrasados.length,
    assentar,
    conexoesAbertas: () => [...nos.values()].filter((n) => n.fechadaCom === null).length,
    async liberarAtrasados(ordem = "fifo") {
      const lote = atrasados.splice(0);
      if (ordem === "lifo") lote.reverse();
      for (const x of lote) entregar(x.para, () => nos.get(x.para)?.opcoes.aoMensagem(x.dados));
      await assentar();
    },
    async fecharTudo(codigo = 1006) {
      for (const n of nos.values()) if (n.fechadaCom === null) fecharNo(n, codigo, false);
      await assentar();
    },
    fabrica(ip = "203.0.113.5") {
      return (o) => {
        if (rede.indisponivel) throw Object.assign(new Error("falhou"), { codigo: "falhou" });
        const id = `n${++seq}`;
        const n: Nó = { id, papel: "?", ip, criadoEm: ag.agora(), opcoes: o, fechadaCom: null, enviados: [], recebidos: [] };
        nos.set(id, n);
        executar(roteador.conectar(id, ip));
        entregar(id, () => {
          if (n.fechadaCom === null) o.aoAbrir();
        });
        o.sinal?.addEventListener("abort", () => fecharNo(n, 1000, false), { once: true });
        return {
          get aberta() {
            return n.fechadaCom === null;
          },
          enviar(d) {
            if (n.fechadaCom !== null) return false;
            n.enviados.push(d);
            trafego.push(d);
            if (typeof d === "string") {
              if (n.papel === "?") {
                try {
                  const p = (JSON.parse(d) as { papel?: string }).papel;
                  if (p === "host" || p === "cliente") n.papel = p;
                } catch {
                  /* não é JSON */
                }
              }
              executar(roteador.controle(id, d));
            } else executar(roteador.binario(id, d));
            return true;
          },
          fechar(c = 1000) {
            fecharNo(n, c, true);
          },
        };
      };
    },
  };
  function fecharNo(n: Nó, codigo: number, avisarDono: boolean): void {
    if (n.fechadaCom !== null) return;
    n.fechadaCom = codigo;
    executar(roteador.desconectar(n.id));
    if (!avisarDono || true) entregar(n.id, () => n.opcoes.aoFechar(codigo));
  }
  function executar(acoes: Acao[]): void {
    for (const a of acoes) {
      if (a.k === "fechar") {
        const n = nos.get(a.con);
        if (n !== undefined) fecharNo(n, a.codigo, false);
      } else if (a.k === "texto") {
        const n = nos.get(a.para);
        if (n === undefined || n.fechadaCom !== null) continue;
        trafego.push(a.texto);
        n.recebidos.push(a.texto);
        entregar(a.para, () => n.fechadaCom === null && n.opcoes.aoMensagem(a.texto));
      } else {
        const n = nos.get(a.para);
        if (n === undefined || n.fechadaCom !== null) continue;
        const origem = [...nos.values()].find((x) => x.id !== a.para && x.papel !== "?" && x.papel !== n.papel);
        const decisoes: Decisao[] = rede.interpositor === null ? [{ dados: a.dados }] : rede.interpositor({ de: origem?.papel ?? "?", para: a.para, dados: a.dados });
        for (const dec of decisoes) {
          if ("atrasar" in dec) {
            atrasados.push({ para: a.para, dados: dec.dados });
            continue;
          }
          trafego.push(dec.dados);
          n.recebidos.push(dec.dados);
          entregar(a.para, () => n.fechadaCom === null && n.opcoes.aoMensagem(dec.dados));
        }
      }
    }
  }
  return rede;
}

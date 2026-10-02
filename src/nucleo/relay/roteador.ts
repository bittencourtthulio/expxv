// Roteador CEGO do relay (T-22.07). PURO: sem I/O, sem relógio próprio, sem aleatório próprio (tudo injetado), devolve AÇÕES que o servidor executa. Estado SÓ em memória: canais, os dois
// slots (host/cliente) e o repasse OPACO de quadros binários (nunca interpreta, nunca copia, nunca guarda, nunca mede o conteúdo: só conta quadros e bytes). Sem contas, sem fila,
// sem store-and-forward: cliente offline = quadro descartado. Toda recusa é UNIFORME (mesma mensagem, mesmo passo, mesmo atraso), venha de canal inexistente, ocupado ou prova ruim.
// A origem HTTP (`Origin`) nem chega aqui: quem autentica é a chave (AX-31).
import { CANAL_HEX, ERRO_LIMITE, ERRO_RECUSADO, LIMITES_RELAY, deB64, parseControle, serializar, verificarProva, SPKI_MAX, SPKI_MIN, type Papel, type ParamsProva, type Prova } from "./protocolo";
import { criarLimites, type ConfigLimites, type Limites, type RelogioRelay } from "./limites";

export type Acao =
  | { k: "texto"; para: string; texto: string }
  | { k: "bin"; para: string; dados: Uint8Array }
  | { k: "fechar"; con: string; codigo: number; atrasoMs?: number };

export const ATRASO_RECUSA_MS = 40;
export interface Metricas {
  conexoes: number;
  canais: number;
  quadros_repassados: number;
  bytes_repassados: number;
  descartes: number;
  recusas: number;
  limites: number;
}
export interface DepsRoteador {
  relogio: RelogioRelay;
  aleatorio: (n: number) => Buffer;
  limites?: Partial<ConfigLimites>;
  /** só códigos nominais (nunca payload, IP cru ou canal). */
  log?: (evento: string) => void;
}
export interface Roteador {
  conectar(con: string, ip: string): Acao[];
  controle(con: string, texto: string): Acao[];
  binario(con: string, dados: Uint8Array): Acao[];
  /** a conexão já passou pela prova de posse? (define o teto de quadro: 1 KiB antes, 64 KiB depois). */
  ativa(con: string): boolean;
  desconectar(con: string): Acao[];
  varrer(): Acao[];
  metricas(): Metricas;
  /** estado interno REAL (para a prova de cegueira): conexões e canais. */
  inspecionar(): { conexoes: ReadonlyMap<string, unknown>; canais: ReadonlyMap<string, unknown> };
}

interface Con {
  id: string;
  ip: string;
  estado: "novo" | "desafiado" | "ativo";
  criada: number;
  desafio?: Buffer;
  canal?: string;
  nonce?: Buffer;
  papel?: Papel;
}
interface CanalR {
  id: string;
  host: string | null;
  cliente: string | null;
  hostPub: Buffer;
  cliPub: Buffer | null;
  efemero: boolean;
  criado: number;
  usado: boolean;
}

export function criarRoteador(d: DepsRoteador): Roteador {
  const limites: Limites = criarLimites(d.relogio, d.limites);
  const conexoes = new Map<string, Con>();
  const canais = new Map<string, CanalR>();
  const m: Metricas = { conexoes: 0, canais: 0, quadros_repassados: 0, bytes_repassados: 0, descartes: 0, recusas: 0, limites: 0 };
  const log = (e: string): void => d.log?.(e);

  const recusar = (con: string, c?: Con): Acao[] => {
    m.recusas++;
    if (c !== undefined) c.estado = "novo";
    return [
      { k: "texto", para: con, texto: ERRO_RECUSADO },
      { k: "fechar", con, codigo: 1008, atrasoMs: ATRASO_RECUSA_MS },
    ];
  };
  const estourou = (con: string): Acao[] => {
    m.limites++;
    return [
      { k: "texto", para: con, texto: ERRO_LIMITE },
      { k: "fechar", con, codigo: 1013 },
    ];
  };
  const removerCanal = (id: string, exceto?: string): Acao[] => {
    const c = canais.get(id);
    if (c === undefined) return [];
    canais.delete(id);
    limites.esquecerCanal(id);
    const acoes: Acao[] = [];
    for (const x of [c.host, c.cliente]) if (x !== null && x !== exceto) acoes.push({ k: "fechar", con: x, codigo: 1000 });
    return acoes;
  };

  function provar(con: Con, p: Prova): Acao[] {
    const hello = { papel: con.papel as Papel, canal: con.canal as string };
    const pub = deB64(p.pub, SPKI_MIN, SPKI_MAX);
    const sig = deB64(p.sig, 64, 64);
    const cli = p.cli === undefined ? undefined : deB64(p.cli, SPKI_MIN, SPKI_MAX);
    if (pub === null || sig === null || cli === null || (hello.papel === "cliente" && (p.cli !== undefined || p.ef !== undefined))) return recusar(con.id, con);
    const params: ParamsProva = { desafio: con.desafio as Buffer, nonceCliente: con.nonce as Buffer, canal: hello.canal, papel: hello.papel, cli, efemero: p.ef === 1 };
    // a verificação roda SEMPRE e ANTES de qualquer regra de slot: o custo e o passo da recusa não dependem de o canal existir
    if (!verificarProva(pub, params, sig)) return recusar(con.id, con);
    const existente = canais.get(hello.canal);
    const acoes: Acao[] = [];
    if (hello.papel === "host") {
      if (existente === undefined) {
        if (!limites.canalNovo(canais.size)) return estourou(con.id);
        canais.set(hello.canal, { id: hello.canal, host: con.id, cliente: null, hostPub: pub, cliPub: cli ?? null, efemero: p.ef === 1, criado: d.relogio.agora(), usado: false });
      } else {
        if (!existente.hostPub.equals(pub)) return recusar(con.id, con); // squatting: outro dono já registrou este canal
        if (existente.host !== null && existente.host !== con.id) acoes.push({ k: "fechar", con: existente.host, codigo: 4000 });
        existente.host = con.id;
        if (cli !== undefined) existente.cliPub = cli;
      }
    } else {
      if (existente === undefined || existente.host === null || existente.cliente !== null) return recusar(con.id, con);
      if (existente.cliPub !== null && !existente.cliPub.equals(pub)) return recusar(con.id, con);
      existente.cliente = con.id;
      existente.usado = true;
    }
    con.estado = "ativo";
    acoes.push({ k: "texto", para: con.id, texto: serializar({ t: "ok" }) });
    log(hello.papel === "host" ? "host_registrado" : "cliente_conectado");
    return acoes;
  }

  return {
    conectar(con, ip) {
      if (!limites.admitir(ip)) return estourou(con);
      conexoes.set(con, { id: con, ip, estado: "novo", criada: d.relogio.agora() });
      m.conexoes++;
      return [];
    },
    controle(con, texto) {
      const c = conexoes.get(con);
      if (c === undefined) return [];
      if (!limites.mensagem(c.ip)) return estourou(con);
      if (c.estado === "novo") {
        const h = parseControle(texto);
        if (h === null || h.t !== "hello") return recusar(con, c);
        if (!limites.hello(c.ip)) return estourou(con);
        c.canal = h.canal;
        c.papel = h.papel;
        c.nonce = Buffer.from(h.nonce, "base64");
        c.desafio = d.aleatorio(16);
        c.estado = "desafiado";
        return [{ k: "texto", para: con, texto: serializar({ t: "desafio", n: c.desafio.toString("base64") }) }];
      }
      if (c.estado === "desafiado") {
        const p = parseControle(texto);
        return p === null || p.t !== "prova" ? recusar(con, c) : provar(c, p);
      }
      // ativo: controle mínimo
      const x = parseControle(texto);
      if (x === null) return [{ k: "fechar", con, codigo: 1002 }];
      switch (x.t) {
        case "ping":
          return [{ k: "texto", para: con, texto: serializar({ t: "pong" }) }];
        case "fechar":
          return [{ k: "fechar", con, codigo: 1000 }];
        case "desregistrar": {
          if (c.papel !== "host" || c.canal === undefined) return [{ k: "fechar", con, codigo: 1002 }];
          return [...removerCanal(c.canal), { k: "fechar", con, codigo: 1000 }];
        }
        default:
          return [{ k: "fechar", con, codigo: 1002 }];
      }
    },
    binario(con, dados) {
      const c = conexoes.get(con);
      if (c === undefined) return [];
      if (c.estado !== "ativo" || c.canal === undefined) return [{ k: "fechar", con, codigo: 1008 }];
      if (dados.byteLength > LIMITES_RELAY.quadro_max) return [{ k: "fechar", con, codigo: 1009 }];
      if (!limites.mensagem(c.ip) || !limites.quadro(c.canal, dados.byteLength)) {
        m.descartes++;
        return [];
      }
      const canal = canais.get(c.canal);
      const para = canal === undefined ? null : c.papel === "host" ? canal.cliente : canal.host;
      if (para === null) {
        m.descartes++; // sem fila: contraparte ausente = descarte
        return [];
      }
      m.quadros_repassados++;
      m.bytes_repassados += dados.byteLength;
      return [{ k: "bin", para, dados }];
    },
    ativa: (con) => conexoes.get(con)?.estado === "ativo",
    desconectar(con) {
      const c = conexoes.get(con);
      if (c === undefined) return [];
      conexoes.delete(con);
      limites.liberar(c.ip);
      if (c.estado !== "ativo" || c.canal === undefined) return [];
      const canal = canais.get(c.canal);
      if (canal === undefined) return [];
      if (c.papel === "host") return canal.host === con ? removerCanal(c.canal, con) : [];
      if (canal.cliente !== con) return []; // fechamento ATRASADO de um cliente velho não pode zerar o slot do cliente novo (A-02)
      canal.cliente = null;
      return canal.efemero && canal.usado ? removerCanal(c.canal, con) : [];
    },
    varrer() {
      const agora = d.relogio.agora();
      const acoes: Acao[] = [];
      for (const c of conexoes.values()) if (c.estado !== "ativo" && agora - c.criada > LIMITES_RELAY.handshake_ms) acoes.push(...recusar(c.id, c));
      for (const k of [...canais.keys()]) {
        const x = canais.get(k);
        if (x !== undefined && x.efemero && agora - x.criado > LIMITES_RELAY.ttl_pareamento_ms) acoes.push(...removerCanal(k));
      }
      limites.varrer();
      return acoes;
    },
    metricas: () => ({ ...m, conexoes: limites.totalConexoes(), canais: canais.size }),
    inspecionar: () => ({ conexoes, canais }),
  };
}
export { CANAL_HEX };

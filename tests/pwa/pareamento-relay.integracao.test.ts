// Integração REAL em loopback: relay de verdade + host (cliente efêmero e depois canal definitivo, MESMO tratador da Fase 13) + o cliente do PWA (pwa/protocolo-cliente.js, WebCrypto e
// WebSocket globais do Node 22). Pareamento com SAS nos dois lados, «Permitir» NO DESKTOP, entrega do segredo de canal por dentro da sessão, canal rotativo, PIN, esquecer e abusos.
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { VERSAO_PROTOCOLO_RELAY } from "../../src/compartilhado/relay";
import { criarCenarioRemoto, type CenarioRemoto } from "../fixtures/jarvis/cenario-remoto";
import { chaveEnvelope } from "../../src/nucleo/remoto-estendido/canal";
import { criarClienteRelay, type ClienteRelay } from "../../src/nucleo/remoto-estendido/cliente-relay";
import { criarMensagemRelay, chaveEfemera, segredoEfemero } from "../../src/nucleo/remoto-estendido/pareamento-relay";
import { impressaoHex } from "../../src/nucleo/remoto-estendido/impressao-digital";
import { criarTransporteRelay } from "../../src/nucleo/remoto-estendido/transporte-relay";
import { abrirWs } from "../../src/nucleo/remoto-estendido/ws-cliente";
import { criarLog } from "../../src/nucleo/relay/log";
import { iniciarRelay } from "../../src/nucleo/relay/servidor";
import { carregarIdentidade } from "../../src/nucleo/remoto/identidade";
import { carregar } from "./carregar";

interface Estado { fase: string; erro: string | null; sas: string | null; etapa: string | null; status: unknown; permissao: string | null; temPin: boolean; identidadeHost: string | null }
interface ClienteWeb {
  estado(): Estado;
  parear(p: { relay: string; codigo: string; host?: string; nome: string; pin?: string }): Promise<{ ok: boolean; erro?: string }>;
  iniciar(): Promise<void>;
  atualizar(): Promise<boolean>;
  enviarComando(t: string): Promise<{ tipo: string } | null>;
  travar(): void;
  destravar(pin?: string): Promise<{ ok: boolean; erro?: string }>;
  definirPin(p: string): Promise<boolean>;
  esquecer(): Promise<void>;
  encerrar(): void;
}
interface PC {
  criarClienteRemoto(d: Record<string, unknown>): ClienteWeb;
  armazemMemoria(): { ler(): Promise<Record<string, unknown> | null>; gravar(v: Record<string, unknown>): Promise<void>; apagar(): Promise<void> };
}

const limpeza: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const f of limpeza.splice(0).reverse()) await f();
});
const timerReal = (fn: () => void, ms: number): (() => void) => {
  const t = setTimeout(fn, ms);
  t.unref();
  return () => clearTimeout(t);
};
const espera = async (cond: () => boolean, ms = 8000): Promise<void> => {
  const fim = Date.now() + ms;
  while (!cond() && Date.now() < fim) await new Promise((r) => setTimeout(r, 10));
  if (!cond()) throw new Error("tempo esgotado");
};

async function montar() {
  const pc = await carregar<PC>("pwa/protocolo-cliente.js");
  const cen: CenarioRemoto = criarCenarioRemoto();
  await cen.ligar();
  limpeza.push(() => cen.fechar());
  const identidade = await carregarIdentidade({ ler: async (n) => cen.segredos.get(n) ?? null, gravar: async (n, v) => void cen.segredos.set(n, v) });
  const relay = await iniciarRelay({ bind: "127.0.0.1", porta: 0, log: criarLog({ agora: Date.now, saida: () => undefined }) });
  limpeza.push(() => relay.fechar());
  const url = `ws://127.0.0.1:${relay.porta}/v1/canal/x`;
  const tratador = cen.servico.tratador();
  const recentes = new Map<string, number>();
  const canais = new Map<string, { epoca_ultima: number; revogado_em: string | null }>();
  const entregues: Array<{ id: string; segredo: Buffer }> = [];
  cen.servico.registrarMensagemRelay(
    criarMensagemRelay({
      canais: { obter: (id) => canais.get(id) ?? null, registrar: (id, epoca) => void canais.set(id, { epoca_ultima: epoca, revogado_em: null }) },
      segredos: { gravar: async (n, v) => void cen.segredos.set(n, v) },
      relogio: cen.relogio,
      recentes,
      aoSegredoEntregue: (id, segredo) => void entregues.push({ id, segredo }),
      revogar: (id) => cen.servico.revogar(id),
      adiar: (fn, ms) => void timerReal(fn, ms),
    }),
  );
  const hosts: ClienteRelay[] = [];
  limpeza.push(() => hosts.forEach((h) => h.fechar()));
  const armazem = pc.armazemMemoria();
  const gravarOriginal = armazem.gravar;
  // quando o celular grava o registro, o host sobe o canal definitivo desse dispositivo (o serviço do main faz isso ao entregar o segredo)
  let ultimoRegistro: Record<string, unknown> | null = null;
  const subirHost = (): ClienteRelay => {
    const e = entregues[entregues.length - 1];
    if (e === undefined || ultimoRegistro === null) throw new Error("sem registro");
    const h = criarClienteRelay({ url, segredo: e.segredo, identidade, clientePub: Buffer.from(String(ultimoRegistro["publica"]), "base64"), transporte: criarTransporteRelay({ tratador, chave: chaveEnvelope(e.segredo, "sessao") }), relogio: cen.relogio, agendar: timerReal, abrirWs });
    hosts.push(h);
    h.iniciar();
    return h;
  };
  armazem.gravar = async (v) => {
    await gravarOriginal(v);
    ultimoRegistro = v;
    if (entregues.length === 0 || hosts.length > 0) return;
    subirHost();
  };
  // relógio do CELULAR: igual ao do desktop, até o teste mexer (relógio errado do aparelho)
  const desvio = { ms: 0 };
  const relogioCelular = { agora: () => cen.relogio.agora() + desvio.ms };
  const cliente = pc.criarClienteRemoto({ criarWs: (u: string) => new WebSocket(u), armazem, relogio: relogioCelular, agendar: timerReal, permitirLoopback: true, versao: VERSAO_PROTOCOLO_RELAY, intervaloPollMs: 20, iteracoesPin: 1000 });
  limpeza.push(() => cliente.encerrar());
  /** abre a janela no desktop e sobe o host efêmero; devolve o código. */
  const abrirJanela = async (): Promise<string> => {
    const p = cen.servico.parearIniciar("leitura");
    if ("erro" in p) throw new Error("janela");
    const h = criarClienteRelay({ url, segredo: segredoEfemero(p.codigo), identidade, efemero: true, transporte: criarTransporteRelay({ tratador, chave: chaveEfemera(p.codigo) }), relogio: cen.relogio, agendar: timerReal, abrirWs });
    limpeza.push(() => h.fechar());
    h.iniciar();
    await espera(() => h.estado() === "registrado");
    return p.codigo;
  };
  /** o dono confere o SAS no desktop e toca «Permitir». */
  const permitir = async (): Promise<void> => {
    await espera(() => cen.servico.estado().sas !== null && cliente.estado().sas !== null);
    expect(cliente.estado().sas).toBe(cen.servico.estado().sas);
    const d = cen.servico.parearConfirmarSas({ igual: true, confirmacao_permissao: null });
    expect(d?.permissao).toBe("leitura"); // nasce leitura (AX-28)
    recentes.set((d as { id: string }).id, cen.relogio.agora());
  };
  return { cen, cliente, armazem, abrirJanela, permitir, url, identidade, hosts, recentes, subirHost, desvio };
}

describe("pareamento via relay REAL com o cliente do PWA", () => {
  it("pareia com SAS conferido no desktop, recebe o segredo por dentro da sessão, usa o canal definitivo e lê o estado; esquecer revoga no host e apaga tudo local", async () => {
    const t = await montar();
    const codigo = await t.abrirJanela();
    const hostHex = impressaoHex((await t.identidade).publicaSpki());
    const fim = t.cliente.parear({ relay: t.url, codigo, host: hostHex, nome: "iPhone do teste" });
    await t.permitir();
    expect(await fim).toEqual({ ok: true });
    // registro: chave NÃO extraível, segredo guardado, nada em claro além do necessário
    const reg = (await t.armazem.ler()) as { chave: CryptoKey; segredo: { claro?: string } };
    expect(reg.chave.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("pkcs8", reg.chave)).rejects.toThrow();
    expect(typeof reg.segredo.claro).toBe("string");
    await espera(() => t.cliente.estado().fase === "conectado" && t.cliente.estado().status !== null, 12000);
    expect((t.cliente.estado().status as { tipo: string }).tipo).toBe("resposta");
    expect(t.cliente.estado().identidadeHost).toBe(hostHex);
    expect(t.cliente.estado().sas).toBeNull();
    // comando de leitura passa pelo MESMO tratador da Fase 13
    const r = await t.cliente.enviarComando("status");
    expect(r?.tipo).toBe("resposta");
    // esquecer: o host revoga (autoritativo) e o celular apaga tudo
    await t.cliente.esquecer();
    expect(await t.armazem.ler()).toBeNull();
    expect(t.cliente.estado().fase).toBe("sem_pareamento");
    await espera(() => t.cen.servico.estado().dispositivos.every((d) => d.revogado_em !== null));
  }, 30_000);

  it("A-01: 401 no início da sessão (relógio do celular errado, pedido antigo reenviado pelo relay) NUNCA apaga o pareamento: avisa depois de 3 recusas e volta sozinho quando o relógio acerta", async () => {
    const t = await montar();
    const codigo = await t.abrirJanela();
    const fim = t.cliente.parear({ relay: t.url, codigo, nome: "relógio errado" });
    await t.permitir();
    expect((await fim).ok).toBe(true);
    await espera(() => t.cliente.estado().fase === "conectado" && t.cliente.estado().status !== null, 12000);
    // o host cai e volta; o celular está com o relógio 10 min adiantado: o host recusa o início da sessão (fora da janela de ±60 s)
    t.hosts[0]?.fechar();
    t.desvio.ms = 10 * 60_000;
    await espera(() => t.cliente.estado().fase !== "conectado", 12000);
    t.subirHost();
    await espera(() => t.cliente.estado().erro === "sessao_recusada", 40_000);
    expect(await t.armazem.ler()).not.toBeNull(); // NADA foi apagado
    expect(t.cliente.estado().fase).not.toBe("revogado");
    expect(t.cen.servico.estado().dispositivos.every((d) => d.revogado_em === null)).toBe(true); // e o host nem revogou
    // o relógio acerta: a sessão volta sozinha e o aviso some
    t.desvio.ms = 0;
    await espera(() => t.cliente.estado().fase === "conectado" && t.cliente.estado().erro === null, 60_000);
  }, 120_000);
  it("ax26_qr_uso_unico_ttl: o código vale uma vez; reutilizá-lo depois do pareamento é recusado e nada é guardado", async () => {
    const t = await montar();
    const codigo = await t.abrirJanela();
    const fim = t.cliente.parear({ relay: t.url, codigo, nome: "primeiro" });
    await t.permitir();
    expect((await fim).ok).toBe(true);
    t.cliente.encerrar();
    const outro = (await carregar<PC>("pwa/protocolo-cliente.js")).criarClienteRemoto({ criarWs: (u: string) => new WebSocket(u), armazem: (await carregar<PC>("pwa/protocolo-cliente.js")).armazemMemoria(), relogio: t.cen.relogio, agendar: timerReal, permitirLoopback: true, versao: VERSAO_PROTOCOLO_RELAY, intervaloPollMs: 20 });
    limpeza.push(() => outro.encerrar());
    const r = await outro.parear({ relay: t.url, codigo, nome: "reuso" });
    expect(r.ok).toBe(false);
    expect(["relay_indisponivel", "codigo_invalido"]).toContain(r.erro);
    expect(outro.estado().fase).toBe("sem_pareamento");
  }, 30_000);

  it("ax26_qr_uso_unico_ttl: o pareamento expira com o relógio (janela de 120 s + 60 s de decisão) e o código sai do formulário", async () => {
    const t = await montar();
    const codigo = await t.abrirJanela();
    const fim = t.cliente.parear({ relay: t.url, codigo, nome: "lento" });
    await espera(() => t.cliente.estado().sas !== null);
    t.cen.relogio.avancar(200_000);
    const r = await fim;
    expect(r).toEqual({ ok: false, erro: "expirou" });
    expect(await t.armazem.ler()).toBeNull();
  }, 30_000);

  it("ax04_mitm_relay_no_pareamento (PWA): impressão digital do link diferente da do desktop aborta e não guarda nada; negar no desktop também", async () => {
    const t = await montar();
    const codigo = await t.abrirJanela();
    const fim = t.cliente.parear({ relay: t.url, codigo, host: "0".repeat(32), nome: "desconfiado" });
    await t.permitir();
    expect(await fim).toEqual({ ok: false, erro: "impressao_diferente" });
    expect(await t.armazem.ler()).toBeNull();
    // negado pelo desktop
    const t2 = await montar();
    const c2 = await t2.abrirJanela();
    const fim2 = t2.cliente.parear({ relay: t2.url, codigo: c2, nome: "negado" });
    await espera(() => t2.cen.servico.estado().sas !== null);
    t2.cen.servico.parearConfirmarSas({ igual: false, confirmacao_permissao: null });
    expect(await fim2).toEqual({ ok: false, erro: "negado" });
    expect(await t2.armazem.ler()).toBeNull();
  }, 40_000);

  it("PIN local: o segredo fica cifrado; travar apaga a memória; PIN errado não destrava; PIN certo reconecta", async () => {
    const t = await montar();
    const codigo = await t.abrirJanela();
    const fim = t.cliente.parear({ relay: t.url, codigo, nome: "com pin", pin: "4321" });
    await t.permitir();
    expect((await fim).ok).toBe(true);
    const reg = (await t.armazem.ler()) as { segredo: { claro?: string; pin?: object } };
    expect(reg.segredo.claro).toBeUndefined();
    expect(reg.segredo.pin).toBeDefined();
    expect(t.cliente.estado().temPin).toBe(true);
    await espera(() => t.cliente.estado().fase === "conectado" && t.cliente.estado().status !== null, 12000);
    t.cliente.travar();
    expect(t.cliente.estado().fase).toBe("travado");
    expect(t.cliente.estado().status).toBeNull(); // travar apaga o estado em memória
    expect((await t.cliente.destravar("0000")).erro).toBe("pin_incorreto");
    expect(t.cliente.estado().fase).toBe("travado");
    expect((await t.cliente.destravar("4321")).ok).toBe(true);
    await espera(() => t.cliente.estado().fase === "conectado" && t.cliente.estado().status !== null, 12000);
  }, 40_000);
});

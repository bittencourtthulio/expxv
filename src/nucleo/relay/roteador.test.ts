import { VERSAO_PROTOCOLO_RELAY } from "../../compartilhado/relay";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { aceito, canalAleatorio, fechou, handshake, novoRoteador, parChave, textos } from "../../../tests/fixtures/relay/cenarios";
import { ATRASO_RECUSA_MS } from "./roteador";
import { serializar } from "./protocolo";

describe("roteador: canais, slots e repasse opaco", () => {
  it("host e cliente registram e trocam quadros binários sem alterá-los, nos dois sentidos", () => {
    const { r } = novoRoteador();
    const canal = canalAleatorio();
    const host = parChave();
    const cli = parChave();
    expect(aceito(handshake(r, "h", { papel: "host", canal, par: host, cli: cli.pub }).fim, "h")).toBe(true);
    expect(aceito(handshake(r, "c", { papel: "cliente", canal, par: cli }).fim, "c")).toBe(true);
    const q = new Uint8Array([1, 2, 3, 4]);
    expect(r.binario("c", q)).toEqual([{ k: "bin", para: "h", dados: q }]);
    expect(r.binario("h", q)[0]).toMatchObject({ k: "bin", para: "c" });
    expect(r.binario("c", q)[0]?.k === "bin" && (r.binario("c", q)[0] as { dados: Uint8Array }).dados).toBe(q); // mesma referência: nunca copia
  });
  it("sem fila: quadro enviado sem contraparte é descartado (nada guardado)", () => {
    const { r } = novoRoteador();
    const canal = canalAleatorio();
    const host = parChave();
    handshake(r, "h", { papel: "host", canal, par: host });
    expect(r.binario("h", new Uint8Array(10))).toEqual([]);
    expect(r.metricas().descartes).toBe(1);
    const cli = parChave();
    handshake(r, "c", { papel: "cliente", canal, par: cli });
    expect(r.binario("c", new Uint8Array(1))).toHaveLength(1);
  });
  it("ax18_flood_relay: quadro binário depois do hello e ANTES da prova de posse nunca é repassado ao host (fecha a conexão)", () => {
    const { r } = novoRoteador();
    const canal = canalAleatorio();
    const host = parChave();
    const cli = parChave();
    handshake(r, "h", { papel: "host", canal, par: host, cli: cli.pub });
    r.conectar("c", "198.51.100.9");
    r.controle("c", serializar({ t: "hello", v: VERSAO_PROTOCOLO_RELAY, papel: "cliente", canal, ts: 1, nonce: randomBytes(16).toString("base64") }));
    const acoes = r.binario("c", new Uint8Array(8));
    expect(fechou(acoes, "c")).toBe(true);
    expect(acoes.some((a) => a.k === "bin")).toBe(false);
  });
  it("ax25_isolamento_de_canais (A-02): o fechamento atrasado de um cliente VELHO não zera o slot do cliente novo", () => {
    const { r } = novoRoteador();
    const canal = canalAleatorio();
    const host = parChave();
    const cli = parChave();
    handshake(r, "h1", { papel: "host", canal, par: host, cli: cli.pub });
    handshake(r, "c1", { papel: "cliente", canal, par: cli });
    r.desconectar("h1"); // o host cai: o canal é removido
    handshake(r, "h2", { papel: "host", canal, par: host, cli: cli.pub });
    expect(aceito(handshake(r, "c2", { papel: "cliente", canal, par: cli }).fim, "c2")).toBe(true);
    expect(r.binario("h2", new Uint8Array(10))).toHaveLength(1); // roteia ao c2
    r.desconectar("c1"); // o evento de fechamento do cliente VELHO chega depois
    expect(r.binario("h2", new Uint8Array(10))).toHaveLength(1); // o c2 continua no slot
  });
  it("ax18_flood_relay: antes de autenticar, binário fecha a conexão; mais de 64 KiB fecha; ping/pong funciona", () => {
    const { r } = novoRoteador();
    r.conectar("x", "198.51.100.1");
    expect(fechou(r.binario("x", new Uint8Array(1)), "x")).toBe(true);
    const canal = canalAleatorio();
    const k = parChave();
    handshake(r, "h", { papel: "host", canal, par: k });
    expect(fechou(r.binario("h", new Uint8Array(64 * 1024 + 1)), "h")).toBe(true);
    expect(textos(r.controle("h", serializar({ t: "ping" })), "h")).toEqual([{ t: "pong" }]);
  });
  it("ax05_squatting_de_canal: prova ruim recusada; outro dono não toma o canal; slot do cliente exige a chave registrada", () => {
    const { r } = novoRoteador();
    const canal = canalAleatorio();
    const dono = parChave();
    const intruso = parChave();
    const dispositivo = parChave();
    expect(aceito(handshake(r, "x1", { papel: "host", canal, par: intruso, assinarCom: dono }).fim, "x1")).toBe(false); // assina com chave que não é a declarada
    expect(aceito(handshake(r, "x2", { papel: "host", canal, par: dono, truncar: true }).fim, "x2")).toBe(false);
    expect(aceito(handshake(r, "x3", { papel: "host", canal, par: dono, papelNaAssinatura: "cliente" }).fim, "x3")).toBe(false);
    expect(aceito(handshake(r, "h", { papel: "host", canal, par: dono, cli: dispositivo.pub }).fim, "h")).toBe(true);
    // o intruso tenta registrar o MESMO canal com a chave dele (prova válida) e é recusado
    expect(aceito(handshake(r, "x4", { papel: "host", canal, par: intruso }).fim, "x4")).toBe(false);
    // o intruso tenta o slot do cliente com a chave dele (prova válida), mas o canal só aceita o dispositivo registrado
    expect(aceito(handshake(r, "x5", { papel: "cliente", canal, par: intruso }).fim, "x5")).toBe(false);
    expect(aceito(handshake(r, "c", { papel: "cliente", canal, par: dispositivo }).fim, "c")).toBe(true);
    // slot ocupado: segundo cliente recusado, mesmo com a chave certa
    expect(aceito(handshake(r, "c2", { papel: "cliente", canal, par: dispositivo }).fim, "c2")).toBe(false);
  });
  it("o mesmo host reconecta e assume o slot (a conexão antiga cai); cliente antes do host é recusado", () => {
    const { r } = novoRoteador();
    const canal = canalAleatorio();
    const host = parChave();
    const cli = parChave();
    expect(aceito(handshake(r, "c0", { papel: "cliente", canal, par: cli }).fim, "c0")).toBe(false);
    handshake(r, "h1", { papel: "host", canal, par: host });
    const novo = handshake(r, "h2", { papel: "host", canal, par: host });
    expect(aceito(novo.fim, "h2")).toBe(true);
    expect(fechou(novo.fim, "h1")).toBe(true);
  });
  it("host que sai purga o canal e derruba o cliente; cliente que sai libera o slot", () => {
    const { r } = novoRoteador();
    const canal = canalAleatorio();
    const host = parChave();
    const cli = parChave();
    handshake(r, "h", { papel: "host", canal, par: host });
    handshake(r, "c", { papel: "cliente", canal, par: cli });
    r.desconectar("c");
    expect(aceito(handshake(r, "c2", { papel: "cliente", canal, par: cli }).fim, "c2")).toBe(true);
    expect(fechou(r.desconectar("h"), "c2")).toBe(true);
    expect(r.metricas().canais).toBe(0);
    expect(r.inspecionar().canais.size).toBe(0);
  });
  it("canal efêmero (pareamento): expira em 120 s e morre no primeiro uso", () => {
    const { r, rel } = novoRoteador();
    const c1 = canalAleatorio();
    const c2 = canalAleatorio();
    const host = parChave();
    const cli = parChave();
    handshake(r, "h1", { papel: "host", canal: c1, par: host, efemero: true });
    rel.avancar(121_000);
    expect(fechou(r.varrer(), "h1")).toBe(true);
    expect(r.metricas().canais).toBe(0);
    handshake(r, "h2", { papel: "host", canal: c2, par: host, efemero: true });
    handshake(r, "c2", { papel: "cliente", canal: c2, par: cli });
    const fim = r.desconectar("c2");
    expect(fechou(fim, "h2")).toBe(true);
    expect(r.metricas().canais).toBe(0);
  });
  it("desregistrar (host autenticado) purga o canal e derruba o cliente", () => {
    const { r } = novoRoteador();
    const canal = canalAleatorio();
    const host = parChave();
    const cli = parChave();
    handshake(r, "h", { papel: "host", canal, par: host });
    handshake(r, "c", { papel: "cliente", canal, par: cli });
    const a = r.controle("h", serializar({ t: "desregistrar" }));
    expect(fechou(a, "c")).toBe(true);
    expect(r.metricas().canais).toBe(0);
    expect(fechou(r.controle("c", serializar({ t: "desregistrar" })), "c")).toBe(true); // cliente não pode
  });
  it("handshake lento (> 5 s) é derrubado pela varredura", () => {
    const { r, rel } = novoRoteador();
    r.conectar("lento", "192.0.2.1");
    rel.avancar(5_001);
    expect(fechou(r.varrer(), "lento")).toBe(true);
  });
  it("ax25_isolamento_de_canais: quadros de um canal nunca chegam a outro; canais não são listáveis", () => {
    const { r } = novoRoteador();
    const a = { canal: canalAleatorio(), host: parChave(), cli: parChave() };
    const b = { canal: canalAleatorio(), host: parChave(), cli: parChave() };
    handshake(r, "ha", { papel: "host", canal: a.canal, par: a.host });
    handshake(r, "ca", { papel: "cliente", canal: a.canal, par: a.cli });
    handshake(r, "hb", { papel: "host", canal: b.canal, par: b.host, ip: "198.51.100.20" });
    handshake(r, "cb", { papel: "cliente", canal: b.canal, par: b.cli, ip: "198.51.100.21" });
    expect(r.binario("ca", new Uint8Array(3))[0]).toMatchObject({ para: "ha" });
    expect(r.binario("cb", new Uint8Array(3))[0]).toMatchObject({ para: "hb" });
    // um cliente do canal A que sofra cota não afeta o B
    for (let i = 0; i < 1000; i++) r.binario("ca", new Uint8Array(1000));
    expect(r.binario("cb", new Uint8Array(3))).toHaveLength(1);
    // não existe API de listagem: a superfície do roteador é só conectar/controle/binario/desconectar/varrer
    expect(Object.keys(r).sort()).toEqual(["ativa", "binario", "conectar", "controle", "desconectar", "inspecionar", "metricas", "varrer"]);
  });
  it("ax31_origem_nao_autentica: a API do roteador nem recebe Origin; só a chave decide", () => {
    const { r } = novoRoteador();
    expect(r.conectar.length).toBe(2); // (con, ip)
    const canal = canalAleatorio();
    const k = parChave();
    // 'origem' de página alheia não muda nada: o mesmo handshake com chave errada falha, com chave certa passa
    expect(aceito(handshake(r, "h", { papel: "host", canal, par: k, assinarCom: parChave() }).fim, "h")).toBe(false);
    expect(aceito(handshake(r, "h2", { papel: "host", canal, par: k }).fim, "h2")).toBe(true);
  });
  it("ax06_enumeracao_uniforme: canal inexistente, ocupado e sem prova recebem respostas idênticas (mesmo passo, mesmo atraso)", () => {
    const { r } = novoRoteador();
    const canal = canalAleatorio();
    const host = parChave();
    const cli = parChave();
    handshake(r, "h", { papel: "host", canal, par: host, cli: cli.pub });
    handshake(r, "c", { papel: "cliente", canal, par: cli });
    const alvos = [
      handshake(r, "inexistente", { papel: "cliente", canal: canalAleatorio(), par: parChave() }),
      handshake(r, "ocupado", { papel: "cliente", canal, par: cli }),
      handshake(r, "sem-prova", { papel: "cliente", canal, par: cli, truncar: true }),
      handshake(r, "outra-chave", { papel: "cliente", canal, par: parChave() }),
    ];
    const forma = (a: ReturnType<typeof handshake>, con: string) => ({ desafio: textos(a.desafio, con).map((t) => t["t"]), fim: a.fim.map((x) => ({ k: x.k, ...(x.k === "texto" ? { texto: x.texto } : {}), ...(x.k === "fechar" ? { codigo: x.codigo, atrasoMs: x.atrasoMs } : {}) })) });
    const [base, ...resto] = alvos.map((a, i) => forma(a, ["inexistente", "ocupado", "sem-prova", "outra-chave"][i] as string));
    for (const x of resto) expect(x).toEqual(base);
    expect(base?.fim[1]).toMatchObject({ atrasoMs: ATRASO_RECUSA_MS });
    // o tempo de processamento também não distingue os casos (variação < 2 ms na mediana)
    const medir = (f: () => void): number => {
      const xs: number[] = [];
      for (let i = 0; i < 40; i++) {
        const t = performance.now();
        f();
        xs.push(performance.now() - t);
      }
      return xs.sort((a, b) => a - b)[20] as number;
    };
    const ip = () => `198.51.100.${Math.floor(Math.random() * 250)}`;
    const t1 = medir(() => handshake(r, `i${randomBytes(4).toString("hex")}`, { papel: "cliente", canal: canalAleatorio(), par: cli, ip: ip() }));
    const t2 = medir(() => handshake(r, `o${randomBytes(4).toString("hex")}`, { papel: "cliente", canal, par: cli, ip: ip() }));
    expect(Math.abs(t1 - t2)).toBeLessThan(2);
  });
  it("ax18_flood_relay: flood de hello, de quadros e de conexões é contido em O(1)", () => {
    const { r } = novoRoteador({ limites: { maxConexoesPorIp: 5, maxConexoes: 50 } });
    // conexões por IP
    let recusadas = 0;
    for (let i = 0; i < 20; i++) if (r.conectar(`f${i}`, "203.0.113.50").some((a) => a.k === "fechar")) recusadas++;
    expect(recusadas).toBe(15);
    // global
    for (let i = 0; i < 100; i++) r.conectar(`g${i}`, `198.51.100.${i % 200}`);
    expect(r.metricas().conexoes).toBeLessThanOrEqual(50);
    // hello flood do mesmo IP: após o balde (20) vem "limite"
    const { r: r2 } = novoRoteador({ limites: { maxConexoesPorIp: 1000 } });
    const resp: string[] = [];
    for (let i = 0; i < 60; i++) {
      r2.conectar(`h${i}`, "203.0.113.9");
      const a = r2.controle(`h${i}`, serializar({ t: "hello", v: VERSAO_PROTOCOLO_RELAY, papel: "cliente", canal: "a".repeat(32), ts: 1, nonce: randomBytes(16).toString("base64") }));
      resp.push(String(textos(a, `h${i}`)[0]?.["t"]) + (textos(a)[0]?.["c"] ?? ""));
    }
    expect(resp.filter((x) => x === "desafio").length).toBeLessThanOrEqual(21);
    expect(resp.filter((x) => x === "erro" + "limite").length).toBeGreaterThanOrEqual(39);
    // rejeição custa pouco
    const t = performance.now();
    for (let i = 0; i < 2000; i++) r2.controle("h59", serializar({ t: "ping" }));
    expect((performance.now() - t) / 2000).toBeLessThan(1);
    // quadro gigante pré-autenticação
    const { r: r3 } = novoRoteador();
    r3.conectar("g", "192.0.2.77");
    expect(fechou(r3.controle("g", "x".repeat(5000)), "g")).toBe(true);
    // cota por canal: quadros acima do balde são descartados, não enfileirados
    const canal = canalAleatorio();
    const h = parChave();
    const c = parChave();
    handshake(r3, "H", { papel: "host", canal, par: h });
    handshake(r3, "C", { papel: "cliente", canal, par: c });
    let passou = 0;
    for (let i = 0; i < 2000; i++) passou += r3.binario("C", new Uint8Array(10)).length;
    expect(passou).toBeLessThan(400);
    expect(r3.metricas().descartes).toBeGreaterThan(1500);
  });
  it("1 000 canais conectados cabem em P-162 (heap por conexão ≤ 20 KB, 1 000 canais ≤ 64 MB)", () => {
    const { r } = novoRoteador({ limites: { maxConexoesPorIp: 5000, maxConexoes: 5000, helloPorIp: { capacidade: 1e9, porSegundo: 1e9 }, msgPorIp: { capacidade: 1e9, porSegundo: 1e9 } } });
    const antes = process.memoryUsage().heapUsed;
    const k = parChave();
    for (let i = 0; i < 1000; i++) handshake(r, `h${i}`, { papel: "host", canal: canalAleatorio(), par: k, ip: "203.0.113.1" });
    const por = (process.memoryUsage().heapUsed - antes) / 1000;
    expect(r.metricas().canais).toBe(1000);
    expect(por).toBeLessThan(20 * 1024);
  });
});

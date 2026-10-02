// Orçamentos do relay (Fase 22; núcleo puro + servidor em loopback, sem Electron e sem Docker): P-160, P-161, P-162, P-163, P-164, P-167, P-169.
// P-165 (pareamento), P-166 (revogação/pânico) e P-168 (imagem Docker) dependem das ondas W3+ e de Docker: NÃO são medidos aqui e nunca aparecem verdes por engano.
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { criarCenarioRemoto } from "../fixtures/jarvis/cenario-remoto";
import { canalAleatorio, handshake, novoRoteador, parChave } from "../fixtures/relay/cenarios";
import { ClienteViaRelay } from "../fixtures/relay/cliente-pwa-falso";
import { agendadorVirtual, criarRedeFalsa } from "../fixtures/relay/relay-hostil";
import { canalId, chaveEnvelope, epocaDe } from "../../src/nucleo/remoto-estendido/canal";
import { criarClienteRelay } from "../../src/nucleo/remoto-estendido/cliente-relay";
import { SOBRECARGA_ENVELOPE } from "../../src/nucleo/remoto-estendido/padding";
import { criarTransporteRelay } from "../../src/nucleo/remoto-estendido/transporte-relay";
import { abrirWs } from "../../src/nucleo/remoto-estendido/ws-cliente";
import { carregarIdentidade } from "../../src/nucleo/remoto/identidade";
import { criarLog } from "../../src/nucleo/relay/log";
import { iniciarRelay } from "../../src/nucleo/relay/servidor";
import { assinarProva, serializar } from "../../src/nucleo/relay/protocolo";
import { VERSAO_PROTOCOLO_RELAY } from "../../src/compartilhado/relay";
import { gravarMedicoes, percentil, registrar } from "./registro";

afterAll(() => gravarMedicoes());
const RAIZ = resolve(__dirname, "../..");
const fontes = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const c = join(dir, n);
    return statSync(c).isDirectory() ? fontes(c) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [c] : [];
  });
const SEM_LIMITE = { capacidade: 1e12, porSegundo: 1e12 };
const livre = { maxConexoes: 100_000, maxConexoesPorIp: 100_000, maxCanais: 100_000, helloPorIp: SEM_LIMITE, msgPorIp: SEM_LIMITE, quadrosPorCanal: SEM_LIMITE, bytesPorCanal: SEM_LIMITE };

describe("P-160: relay desligado não existe", () => {
  it("nenhum arquivo do boot (main, renderer, preload) importa o núcleo do relay, o cliente do relay, o ws-cliente nem os módulos `main/relay` e `main/ipc/relay` estaticamente (só `import()`; o contrato `compartilhado/relay` é leve e livre): 0 B no JS inicial, 0 sockets, 0 timers", () => {
    const boot = [...fontes(join(RAIZ, "src/main")), ...fontes(join(RAIZ, "src/renderer")), ...fontes(join(RAIZ, "src/preload"))];
    const importam = boot.filter((f) => /^import (?!type)[^;]*from "(?:[^"]*(?:nucleo\/relay|remoto-estendido|ws-cliente)(?:\/[^"]*)?|\.\/(?:ipc\/)?relay)";/m.test(readFileSync(f, "utf8")));
    registrar({ id: "P-160", descricao: "Módulos do relay importados estaticamente no boot (relay desligado = 0)", valor: importam.length, limite: 0, unidade: "arquivos", semFator: true });
    expect(importam).toEqual([]);
  });
});

describe("P-162 e P-163: relay em carga sintética", () => {
  it("P-162: ≤ 20 KB de heap por conexão ociosa e 1 000 canais conectados ≤ 64 MB de RSS", () => {
    const { r } = novoRoteador({ limites: livre });
    const k = parChave();
    for (let i = 0; i < 50; i++) handshake(r, `w${i}`, { papel: "host", canal: canalAleatorio(), par: k, ip: `198.51.100.${i}` });
    const rss0 = process.memoryUsage().rss;
    const heap0 = process.memoryUsage().heapUsed;
    for (let i = 0; i < 2000; i++) handshake(r, `h${i}`, { papel: i % 2 === 0 ? "host" : "cliente", canal: canalAleatorio(), par: k, ip: `203.0.${i % 250}.${(i >> 3) % 250}` });
    const heapPorConexao = (process.memoryUsage().heapUsed - heap0) / 2000;
    const rssMb = (process.memoryUsage().rss - rss0) / 1024 / 1024;
    registrar({ id: "P-162a", descricao: "Heap por conexão ociosa do relay", valor: heapPorConexao / 1024, limite: 20, unidade: "KB" });
    registrar({ id: "P-162b", descricao: "RSS adicional de 2 000 conexões/canais", valor: rssMb, limite: 64, unidade: "MB" });
    expect(heapPorConexao).toBeLessThan(20 * 1024 * 1.0);
  });
  it("P-163: ≥ 5 000 quadros/s em 1 núcleo, nenhuma tarefa > 50 ms, handshake p95 ≤ 5 ms, rejeição de flood ≤ 1 ms", () => {
    const { r } = novoRoteador({ limites: livre });
    const k = parChave();
    const pares: Array<[string, string]> = [];
    const lat: number[] = [];
    for (let i = 0; i < 300; i++) {
      const canal = canalAleatorio();
      const ip = `203.0.${i % 250}.${i % 200}`;
      const t = performance.now();
      handshake(r, `H${i}`, { papel: "host", canal, par: k, ip });
      lat.push(performance.now() - t);
      handshake(r, `C${i}`, { papel: "cliente", canal, par: k, ip });
      pares.push([`H${i}`, `C${i}`]);
    }
    const hist = monitorEventLoopDelay({ resolution: 1 });
    hist.enable();
    const quadro = new Uint8Array(300);
    const N = 100_000;
    let maior = 0;
    const t0 = performance.now();
    let ultimo = t0;
    for (let i = 0; i < N; i++) {
      const [h, c] = pares[i % pares.length] as [string, string];
      r.binario(i % 2 === 0 ? c : h, quadro);
      if (i % 1000 === 0) {
        const agora = performance.now();
        maior = Math.max(maior, agora - ultimo);
        ultimo = agora;
      }
    }
    const fps = N / ((performance.now() - t0) / 1000);
    hist.disable();
    registrar({ id: "P-163a", descricao: "Vazão do roteador (quadros/s, 1 núcleo)", valor: fps, limite: 5000, unidade: "quadros/s", sentido: "min" });
    registrar({ id: "P-163b", descricao: "Maior tarefa contínua do roteador (a cada 1 000 quadros)", valor: maior, limite: 50, unidade: "ms" });
    registrar({ id: "P-163c", descricao: "Handshake (hello + prova de posse) p95", valor: percentil(lat, 95), limite: 5, unidade: "ms", pior: Math.max(...lat) });
    // flood: rejeição com limites padrão
    const { r: r2 } = novoRoteador();
    r2.conectar("f", "192.0.2.9");
    for (let i = 0; i < 500; i++) r2.controle("f", "x".repeat(2000));
    const rej: number[] = [];
    for (let i = 0; i < 300; i++) {
      const t = performance.now();
      r2.controle("f", serializar({ t: "ping" }));
      rej.push(performance.now() - t);
    }
    registrar({ id: "P-163d", descricao: "Rejeição de flood (p95)", valor: percentil(rej, 95), limite: 1, unidade: "ms" });
    expect(fps).toBeGreaterThan(5000);
  });
  it("P-163 em socket real: 40 canais em paralelo pelo servidor (loopback) sem tarefa de event loop > 50 ms", async () => {
    const relay = await iniciarRelay({ bind: "127.0.0.1", porta: 0, limites: livre, log: criarLog({ agora: Date.now, saida: () => undefined }) });
    try {
      const hist = monitorEventLoopDelay({ resolution: 5 });
      const k = parChave();
      let recebidos = 0;
      const esperados = 40 * 150;
      const abrir = (papel: "host" | "cliente", canal: string): Promise<(d: Uint8Array) => void> =>
        new Promise((resolve) => {
          const nonce = randomBytes(16);
          const ws = abrirWs({
            url: `ws://127.0.0.1:${relay.porta}/v1/canal/x`,
            aoAbrir: () => ws.enviar(JSON.stringify({ t: "hello", v: VERSAO_PROTOCOLO_RELAY, papel, canal, ts: Date.now(), nonce: nonce.toString("base64") })),
            aoMensagem: (m) => {
              if (typeof m !== "string") return void recebidos++;
              const j = JSON.parse(m) as { t: string; n?: string };
              if (j.t === "desafio") {
                const sig = assinarProva(k.priv, { desafio: Buffer.from(j.n as string, "base64"), nonceCliente: nonce, canal, papel });
                ws.enviar(JSON.stringify({ t: "prova", pub: k.pub.toString("base64"), sig: sig.toString("base64") }));
              } else if (j.t === "ok") resolve((d) => void ws.enviar(d));
            },
            aoFechar: () => undefined,
          });
        });
      const pares = await Promise.all(
        Array.from({ length: 40 }, async () => {
          const canal = canalAleatorio();
          const h = await abrir("host", canal);
          const c = await abrir("cliente", canal);
          return { h, c };
        }),
      );
      hist.enable(); // só a fase de tráfego (o handshake dos 80 sockets, com ECDSA, não é tráfego)
      const t0 = performance.now();
      const q = new Uint8Array(300);
      for (let i = 0; i < 150; i++) for (const p of pares) (i % 2 === 0 ? p.c : p.h)(q);
      while (recebidos < esperados && performance.now() - t0 < 10_000) await new Promise((r) => setTimeout(r, 5));
      const dt = (performance.now() - t0) / 1000;
      hist.disable();
      registrar({ id: "P-163e", descricao: "Vazão do servidor em socket real (loopback, quadros/s)", valor: recebidos / dt, limite: 5000, unidade: "quadros/s", sentido: "min" });
      registrar({ id: "P-163f", descricao: "Maior atraso de event loop do relay sob carga real", valor: hist.max / 1e6, limite: 50, unidade: "ms" });
      expect(recebidos).toBe(esperados);
    } finally {
      await relay.fechar();
    }
  }, 30_000);
});

describe("P-164: peso do PWA", () => {
  it("JS ≤ 60 KB gz, HTML ≤ 4 KB, CSS ≤ 12 KB gz", async () => {
    const { lancar } = await import("../fixtures/pwa/origem-adulterada");
    const l = await lancar(1);
    try {
      const { medir } = (await import(/* @vite-ignore */ `${RAIZ}/pwa/tamanho.mjs`)) as { medir(d: string): { js_gz: number; html: number; css_gz: number; ok: boolean } };
      const m = medir(l.dir);
      registrar({ id: "P-164a", descricao: "PWA: JS gzip", valor: m.js_gz / 1024, limite: 60, unidade: "KB", semFator: true });
      registrar({ id: "P-164b", descricao: "PWA: HTML", valor: m.html / 1024, limite: 4, unidade: "KB", semFator: true });
      registrar({ id: "P-164c", descricao: "PWA: CSS gzip", valor: m.css_gz / 1024, limite: 12, unidade: "KB", semFator: true });
      expect(m.ok).toBe(true);
    } finally {
      l.limpar();
    }
  });
});

describe("P-161, P-167 e P-169: host via relay", () => {
  it("P-161: o relay acrescenta ≤ 40 ms (p95) sobre o loopback direto da Fase 13 (200 amostras, relay real)", async () => {
    const cen = criarCenarioRemoto();
    await cen.ligar();
    const relay = await iniciarRelay({ bind: "127.0.0.1", porta: 0, log: criarLog({ agora: Date.now, saida: () => undefined }) });
    try {
      const { cliente: pareado } = await cen.parear("leitura");
      const direto = await cen.sessao("leitura");
      const identidade = await carregarIdentidade({ ler: async (n) => cen.segredos.get(n) ?? null, gravar: async (n, v) => void cen.segredos.set(n, v) });
      const segredo = randomBytes(32);
      const chave = chaveEnvelope(segredo, "sessao");
      const url = `ws://127.0.0.1:${relay.porta}/v1/canal/x`;
      const host = criarClienteRelay({ url, segredo, identidade, clientePub: pareado.par.publicaSpki, transporte: criarTransporteRelay({ tratador: cen.servico.tratador(), chave }), relogio: { agora: Date.now }, agendar: (f, ms) => { const t = setTimeout(f, ms); t.unref(); return () => clearTimeout(t); }, abrirWs });
      host.iniciar();
      for (let i = 0; i < 400 && host.estado() !== "registrado"; i++) await new Promise((r) => setTimeout(r, 10));
      const celular = new ClienteViaRelay(abrirWs, { url, canal: canalId(segredo, epocaDe(Date.now())), chaveEnvelope: chave, chavePublicaDispositivo: pareado.par.publicaSpki, chavePrivadaDispositivo: pareado.par.privadaPkcs8, aguardar: async () => undefined });
      celular.par = pareado.par;
      celular.dispositivoId = pareado.dispositivoId;
      celular.identidadeFixada = pareado.identidadeFixada;
      expect(await celular.conectar()).toBe(true);
      expect((await celular.abrirSessao()).ok).toBe(true);
      const medir = async (f: () => Promise<unknown>): Promise<number[]> => {
        for (let i = 0; i < 20; i++) await f(); // aquecimento
        const xs: number[] = [];
        for (let i = 0; i < 200; i++) {
          const t = performance.now();
          await f();
          xs.push(performance.now() - t);
        }
        return xs;
      };
      const viaDireto = await medir(() => direto.enviar({ t: "estado" }));
      const viaRelay = await medir(() => celular.enviar({ t: "estado" }));
      const acrescimo = percentil(viaRelay, 95) - percentil(viaDireto, 95);
      registrar({ id: "P-161a", descricao: "Acréscimo do relay sobre o loopback direto (p95)", valor: Math.max(0, acrescimo), limite: 40, unidade: "ms", pior: Math.max(...viaRelay) });
      registrar({ id: "P-161b", descricao: "Ida e volta de status via relay (p95)", valor: percentil(viaRelay, 95), limite: 250, unidade: "ms" });
      celular.fechar();
      host.fechar();
      expect(acrescimo).toBeLessThan(40);
    } finally {
      await relay.fechar();
      await cen.fechar();
    }
  }, 60_000);

  it("P-167 e P-169: ocioso com 1 timer, ≤ 2,5 pings/min, ≤ 100 KB/h por dispositivo; sobrecarga de 28 B por mensagem; 0 B com o relay desligado", async () => {
    const cen = criarCenarioRemoto();
    await cen.ligar();
    try {
      const { cliente: pareado } = await cen.parear("leitura");
      const identidade = await carregarIdentidade({ ler: async (n) => cen.segredos.get(n) ?? null, gravar: async (n, v) => void cen.segredos.set(n, v) });
      const ag = agendadorVirtual();
      const rede = criarRedeFalsa(ag);
      const segredo = randomBytes(32);
      const host = criarClienteRelay({ url: "wss://relay.exemplo.com", segredo, identidade, clientePub: pareado.par.publicaSpki, transporte: criarTransporteRelay({ tratador: cen.servico.tratador(), chave: chaveEnvelope(segredo, "sessao") }), relogio: ag, agendar: ag.agendar, abrirWs: rede.fabrica() });
      expect(ag.pendentes()).toBe(0); // desligado: 0 timers
      expect(rede.conexoesAbertas()).toBe(0); // e 0 sockets
      host.iniciar();
      await rede.assentar();
      expect(host.estado()).toBe("registrado");
      const no = [...rede.nos.values()][0]!;
      const antes = no.enviados.length;
      await ag.avancar(60 * 60_000);
      const env = no.enviados.slice(antes);
      const bytes = env.reduce((n: number, x) => n + (typeof x === "string" ? Buffer.byteLength(x) : x.length), 0);
      const pings = env.filter((x) => typeof x === "string" && x.includes('"ping"')).length;
      registrar({ id: "P-167a", descricao: "Timers pendentes com o relay conectado e ocioso", valor: ag.pendentes(), limite: 1, unidade: "timers", semFator: true });
      registrar({ id: "P-167b", descricao: "Requisições de manutenção por minuto (ocioso)", valor: pings / 60, limite: 2.5, unidade: "pings/min", semFator: true });
      registrar({ id: "P-169a", descricao: "Tráfego ocioso por dispositivo", valor: bytes / 1024, limite: 100, unidade: "KB/h", semFator: true });
      registrar({ id: "P-169b", descricao: "Sobrecarga por mensagem além do bloco de padding", valor: SOBRECARGA_ENVELOPE, limite: 64, unidade: "B", semFator: true });
      host.fechar();
      registrar({ id: "P-167c", descricao: "Timers pendentes depois de fechar", valor: ag.pendentes(), limite: 0, unidade: "timers", semFator: true });
      expect(ag.pendentes()).toBe(0);
      expect(bytes / 1024).toBeLessThan(100);
    } finally {
      await cen.fechar();
    }
  });
});

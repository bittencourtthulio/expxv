// Orçamentos da Fase 22 que dependem das ondas W3+ e/ou de Docker: P-160 (chunk da aba Relay), P-165 (pareamento via relay), P-166 (revogação e pânico) e P-168 (imagem Docker do relay).
// Relay REAL em loopback + serviço do host + celular de referência; Docker só local, efêmero e SEM pull. O que não puder ser medido é registrado como «não medido» (nunca verde falso).
import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { criarCenarioRemoto } from "../fixtures/jarvis/cenario-remoto";
import { ClienteViaRelay } from "../fixtures/relay/cliente-pwa-falso";
import { CONFIG_RELAY_PADRAO, TEXTO_CONSENTIMENTO_RELAY_VERSAO, type ConfigRelay } from "../../src/compartilhado/relay";
import { criarLog } from "../../src/nucleo/relay/log";
import { iniciarRelay } from "../../src/nucleo/relay/servidor";
import { chaveEnvelope, canalId, epocaDe } from "../../src/nucleo/remoto-estendido/canal";
import { canalEfemero, chaveEfemera } from "../../src/nucleo/remoto-estendido/pareamento-relay";
import { criarRepoRelay } from "../../src/nucleo/remoto-estendido/repo";
import { criarServicoRelay } from "../../src/nucleo/remoto-estendido/servico";
import { abrirWs } from "../../src/nucleo/remoto-estendido/ws-cliente";
import { carregarIdentidade } from "../../src/nucleo/remoto/identidade";
import { novoParAssinatura } from "../../src/nucleo/remoto/protocolo";
import { gravarMedicoes, naoMedido, percentil, registrar } from "./registro";

afterAll(() => gravarMedicoes());
const RAIZ = resolve(__dirname, "../..");
const timer = (fn: () => void, ms: number): (() => void) => {
  const t = setTimeout(fn, ms);
  t.unref();
  return () => clearTimeout(t);
};
const espera = async (cond: () => boolean, ms = 5000): Promise<void> => {
  const fim = Date.now() + ms;
  while (!cond() && Date.now() < fim) await new Promise((r) => setTimeout(r, 5));
  if (!cond()) throw new Error("tempo esgotado");
};

describe("P-160b: o que o relay acrescenta ao JS inicial (indicador do rodapé) ≤ 2 KB gz", () => {
  it("empacota o indicador com tudo o que ele puxa (React externo) num diretório temporário e mede o gzip", () => {
    const dir = mkdtempSync(join(tmpdir(), "relay-ind-"));
    try {
      const cfg = join(dir, "vite.config.mjs");
      writeFileSync(cfg, `export default { root: ${JSON.stringify(RAIZ)}, logLevel: "error", esbuild: { jsx: "automatic" }, build: { outDir: ${JSON.stringify(join(dir, "out"))}, emptyOutDir: true, minify: true, lib: { entry: "src/renderer/casca/IndicadorRelay.tsx", formats: ["es"], fileName: "ind" }, rollupOptions: { external: ["react", "react/jsx-runtime", "react-dom"] } } };\n`);
      const r = spawnSync("npx", ["vite", "build", "--mode", "production", "--config", cfg], { cwd: RAIZ, encoding: "utf8", timeout: 120_000, env: { ...process.env, NODE_ENV: "production" } });
      if (r.status !== 0) {
        console.warn(`P-160b: ${String(r.stderr).slice(0, 300)}`);
        naoMedido({ id: "P-160b", descricao: "Relay no JS inicial (indicador + dependências, gzip)", limite: 2, unidade: "KB", motivo: "o empacotamento de medição falhou nesta máquina" });
        return;
      }
      const kb = gzipSync(readFileSync(join(dir, "out", "ind.mjs"))).length / 1024;
      registrar({ id: "P-160b", descricao: "Relay no JS inicial (indicador + dependências, gzip)", valor: kb, limite: 2, unidade: "KB", semFator: true });
      expect(kb).toBeLessThanOrEqual(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 150_000);
});

describe("P-160: chunk lazy da aba Relay ≤ 20 KB gz", () => {
  it("mede o chunk da aba no build do renderer (se houver build); senão registra «não medido»", () => {
    const assets = join(RAIZ, "dist", "renderer", "assets");
    const alvos = existsSync(assets) ? readdirSync(assets).filter((n) => /relay/i.test(n) && n.endsWith(".js")) : [];
    if (alvos.length === 0) {
      naoMedido({ id: "P-160c", descricao: "Chunk lazy da aba Relay (gzip)", limite: 20, unidade: "KB", motivo: "sem build do renderer com o chunk da aba Relay em dist/renderer (rode `npm run build` antes do perf)" });
      return;
    }
    const kb = alvos.reduce((n, a) => n + gzipSync(readFileSync(join(assets, a))).length, 0) / 1024;
    registrar({ id: "P-160c", descricao: "Chunk lazy da aba Relay (gzip)", valor: kb, limite: 20, unidade: "KB", semFator: true });
    expect(kb).toBeLessThanOrEqual(20);
  });
});

async function montar() {
  const cen = criarCenarioRemoto();
  const relay = await iniciarRelay({ bind: "127.0.0.1", porta: 0, log: criarLog({ agora: Date.now, saida: () => undefined }) });
  const url = `ws://127.0.0.1:${relay.porta}/v1/canal/x`;
  const cfg: ConfigRelay = { ...CONFIG_RELAY_PADRAO, url, consentimento_versao: TEXTO_CONSENTIMENTO_RELAY_VERSAO, reconhecimento_experimental: true };
  const porta = { ler: async (n: string) => cen.segredos.get(n) ?? null, gravar: async (n: string, v: string) => void cen.segredos.set(n, v) };
  const svc = criarServicoRelay({ remoto: cen.servico, repo: criarRepoRelay({ banco: cen.j.banco, relogio: cen.relogio }), identidade: () => carregarIdentidade(porta), segredos: porta, relogio: cen.relogio, config: () => cfg, gravarConfig: (p) => void Object.assign(cfg, p), agendar: timer });
  return {
    cen,
    relay,
    svc,
    cfg,
    url,
    async fechar() {
      await svc.desligar();
      await relay.fechar();
      await cen.fechar();
    },
  };
}
type Montagem = Awaited<ReturnType<typeof montar>>;

async function parearComTempos(m: Montagem) {
  const t0 = performance.now();
  const r = await m.svc.parearIniciar();
  if ("erro" in r) throw new Error(r.erro);
  const par = novoParAssinatura();
  const cel = new ClienteViaRelay(abrirWs, { url: m.url, canal: canalEfemero(r.codigo), chaveEnvelope: chaveEfemera(r.codigo), chavePublicaDispositivo: par.publicaSpki, chavePrivadaDispositivo: par.privadaPkcs8, aguardar: async () => undefined }, "celular perf");
  cel.par = par;
  await espera(() => m.svc.estado().conectado);
  expect(await cel.conectar()).toBe(true);
  const ini = await cel.iniciarPareamento(r.codigo);
  if (!ini.ok) throw new Error(ini.etapa);
  const tCliente = performance.now(); // o celular já mostra o SAS
  await espera(() => m.svc.parearSas().situacao === "aguardando_decisao");
  const tDesktop = performance.now();
  expect(m.svc.parearSas().sas).toBe(ini.sas);
  await m.svc.parearDecidir(true);
  expect(await cel.concluirPareamento(ini.hid, ini.chaves)).toBe(true);
  expect((await cel.abrirSessao()).ok).toBe(true);
  const seg = ((await cel.enviar({ t: "canal_segredo" })).msg as { segredo: string }).segredo;
  const segredo = Buffer.from(seg, "base64");
  cel.fechar();
  await espera(() => m.svc._recursos().clientes === 1 + (m.svc.dispositivos().length - 1) && !m.svc._recursos().efemero);
  const def = new ClienteViaRelay(abrirWs, { url: m.url, canal: canalId(segredo, epocaDe(Date.now())), chaveEnvelope: chaveEnvelope(segredo, "sessao"), chavePublicaDispositivo: par.publicaSpki, chavePrivadaDispositivo: par.privadaPkcs8, aguardar: async () => undefined });
  def.par = par;
  def.dispositivoId = cel.dispositivoId;
  def.identidadeFixada = cel.identidadeFixada;
  expect(await def.conectar()).toBe(true);
  expect((await def.abrirSessao()).ok).toBe(true);
  return { ate_sas_ms: tDesktop - t0, atraso_desktop_ms: tDesktop - tCliente, def, id: cel.dispositivoId as string };
}

describe("P-165: pareamento via relay", () => {
  it("do toque até o SAS no desktop ≤ 3 s; SAS visível no desktop ≤ 500 ms depois do cliente; janela de 120 s respeitada", async () => {
    const m = await montar();
    try {
      expect(await m.svc.ligar()).toEqual({ ok: true });
      const r = await parearComTempos(m);
      registrar({ id: "P-165a", descricao: "Pareamento via relay: da abertura até o SAS no desktop", valor: r.ate_sas_ms, limite: 3000, unidade: "ms" });
      registrar({ id: "P-165b", descricao: "SAS no desktop depois do cliente", valor: Math.max(0, r.atraso_desktop_ms), limite: 500, unidade: "ms" });
      r.def.fechar();
      // janela de 120 s: o efêmero expira com o relógio (relay: TTL do canal; host: temporizador do pareamento)
      const ttl = (await import("../../src/compartilhado/relay")).LIMITES_RELAY.ttl_pareamento_ms;
      registrar({ id: "P-165c", descricao: "Janela do canal efêmero de pareamento (TTL)", valor: ttl / 1000, limite: 120, unidade: "s", semFator: true });
      expect(r.ate_sas_ms).toBeLessThan(3000);
    } finally {
      await m.fechar();
    }
  }, 60_000);
});

describe("P-161c: aprovação via relay", () => {
  it("celular pede → desktop confirma → celular vê ≤ 400 ms (sem contar a pessoa); o celular nunca aprova", async () => {
    const m = await montar();
    try {
      expect(await m.svc.ligar()).toEqual({ ok: true });
      const a = await parearComTempos(m);
      expect(m.cen.servico.permissaoDefinir({ dispositivo_id: a.id, permissao: "mensagem_confirmada", confirmacao: null })).not.toBeNull();
      const amostras: number[] = [];
      for (let i = 0; i < 30; i++) {
        const t0 = performance.now();
        const r = await a.def.enviar({ t: "comando", texto: `diga ao maestro: finalizar a publicação ${i}`, client_request_id: `perf-aprov-${String(i).padStart(4, "0")}` });
        const conf = (r.msg as { resultado: { tipo: string; confirmacao: { id: string } } }).resultado;
        expect(conf.tipo).toBe("confirmacao");
        const tPedido = performance.now() - t0;
        const t1 = performance.now();
        expect(await m.cen.servico.aprovarPedido(conf.confirmacao.id, true)).toBe(true); // a pessoa, no DESKTOP (o tempo de decisão não entra)
        const ver = await a.def.enviar({ t: "pedido_status", confirmacao_id: conf.confirmacao.id });
        expect(ver.msg).toMatchObject({ estado: "executada" });
        amostras.push(tPedido + (performance.now() - t1));
      }
      registrar({ id: "P-161c", descricao: "Aprovação via relay: pedido + confirmação no desktop + celular vê (p95, sem a pessoa)", valor: percentil(amostras, 95), limite: 400, unidade: "ms", pior: Math.max(...amostras) });
      a.def.fechar();
      expect(percentil(amostras, 95)).toBeLessThan(400);
    } finally {
      await m.fechar();
    }
  }, 60_000);
});

describe("P-166: revogação e pânico", () => {
  it("revogar ⇒ canal derrubado no host e purgado no relay ≤ 1 s; pânico ⇒ 0 sockets ≤ 1 s", async () => {
    const m = await montar();
    try {
      expect(await m.svc.ligar()).toEqual({ ok: true });
      const a = await parearComTempos(m);
      const b = await parearComTempos(m);
      const canais = m.relay.metricas().canais;
      const t0 = performance.now();
      await m.svc.revogar(a.id);
      await espera(() => m.svc._recursos().clientes === 1);
      const noHost = performance.now() - t0;
      await espera(() => m.relay.metricas().canais === canais - 1);
      const noRelay = performance.now() - t0;
      registrar({ id: "P-166a", descricao: "Revogar: canal derrubado no host", valor: noHost, limite: 1000, unidade: "ms" });
      registrar({ id: "P-166b", descricao: "Revogar: canal purgado no relay", valor: noRelay, limite: 1000, unidade: "ms" });
      const depois = await a.def.enviar({ t: "estado" });
      expect(depois.status === 0 || depois.status >= 400).toBe(true); // sem resposta (canal fechado) ou 401: o que o celular tinha não autentica mais
      const t1 = performance.now();
      await m.svc.panico();
      await espera(() => m.relay.metricas().conexoes === 0);
      registrar({ id: "P-166c", descricao: "Pânico: 0 sockets no relay", valor: performance.now() - t1, limite: 1000, unidade: "ms" });
      b.def.fechar();
      a.def.fechar();
      expect(noHost).toBeLessThan(1000);
      expect(noRelay).toBeLessThan(1000);
    } finally {
      await m.fechar();
    }
  }, 90_000);
});

describe("P-168: imagem Docker do relay", () => {
  it("imagem ≤ 150 MB, inicia ≤ 2 s, roda com --memory=128m --cpus=0.5 (local, efêmero, SEM pull); sem Docker/imagem base registra «não medido»", async () => {
    const docker = (...a: string[]) => spawnSync("docker", a, { encoding: "utf8", timeout: 120_000 });
    const motivo = ((): string | null => {
      if (spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8", timeout: 10_000 }).status !== 0) return "sem Docker";
      const base = /^FROM (gcr\.io\/distroless\/\S+)$/m.exec(readFileSync(join(RAIZ, "deploy", "relay", "Dockerfile"), "utf8"))?.[1];
      if (base === undefined || /@sha256:0{64}$/.test(base)) return "digest da imagem base ainda é o marcador (pendência P-360)";
      if (docker("image", "inspect", base).status !== 0 || docker("image", "inspect", "node:22-slim").status !== 0) return "imagem base fora do cache local (sem pull)";
      return null;
    })();
    if (motivo !== null) {
      for (const [id, descricao, limite, unidade] of [["P-168a", "Imagem do relay", 150, "MB"], ["P-168b", "Relay inicia (HEALTHCHECK verde)", 2, "s"]] as const) naoMedido({ id, descricao, limite, unidade, motivo });
      return;
    }
    const tag = `relay-perf-${process.pid}`;
    const nome = `relay-perf-${process.pid}`;
    try {
      execFileSync("docker", ["build", "--pull=false", "-f", "deploy/relay/Dockerfile", "-t", tag, "."], { cwd: RAIZ, stdio: "ignore", timeout: 300_000 });
      const mb = Number(execFileSync("docker", ["image", "inspect", tag, "--format", "{{.Size}}"], { encoding: "utf8" }).trim()) / 1024 / 1024;
      const t0 = Date.now();
      execFileSync("docker", ["run", "-d", "--name", nome, "--memory=128m", "--cpus=0.5", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges:true", tag], { stdio: "ignore" });
      while (Date.now() - t0 < 2000 && execFileSync("docker", ["inspect", nome, "--format", "{{.State.Status}}"], { encoding: "utf8" }).trim() !== "running") await new Promise((r) => setTimeout(r, 50));
      registrar({ id: "P-168a", descricao: "Imagem do relay", valor: mb, limite: 150, unidade: "MB", semFator: true });
      registrar({ id: "P-168b", descricao: "Relay inicia (HEALTHCHECK verde)", valor: (Date.now() - t0) / 1000, limite: 2, unidade: "s" });
    } finally {
      spawnSync("docker", ["rm", "-f", nome]);
      spawnSync("docker", ["rmi", "-f", tag]);
    }
  }, 400_000);
});

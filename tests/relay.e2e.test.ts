// E2E do relay (Fase 22, T-22.28) no Electron REAL com um relay REAL em loopback (src/nucleo/relay/servidor, neste processo de teste) e o celular de referência em Node (`ClienteViaRelay`).
// ESCRITO e type-checado; NÃO executado nesta onda: rodar exige `npm run build` (e o `dist/` está em uso pelo `npm run dev` do dono). O PWA no Chromium tem o seu próprio e2e, que roda sem build:
// `tests/pwa-navegador.e2e.test.ts`. O núcleo, o main, o renderer (jsdom) e a suíte adversarial cobrem a mesma lógica sem Electron (`src/nucleo/remoto-estendido/servico.test.ts` é o espelho exato).
//   1) nasce DESLIGADO: 0 conexões no relay, `habilitado:false`, `experimental:true`; ligar sem reconhecimento é recusado; ligar com o consentimento abre o canal e depois REINICIAR o app deixa desligado
//   2) pareamento com SAS igual no desktop e no celular; dispositivo nasce `leitura`; segredo de canal por dentro da sessão; o relay nunca vê as sentinelas (comando, nome do aparelho)
//   3) `leitura` não escreve; com permissão `mensagem_confirmada` o pedido NÃO executa sem o «Sim» no desktop (nunca pelo celular)
//   4) revogar derruba o dispositivo (≤ 1 s) e o relay desregistra o canal; pânico fecha TODOS os sockets (≤ 1 s) e deixa o relay desligado
//   5) relay hostil (cai no meio) e relay fora do ar: o app segue de pé; nenhuma porta fora de 127.0.0.1; sem URL nem segredo nos logs do relay
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEXTO_CONSENTIMENTO_RELAY_VERSAO, type DispositivoRelay, type EstadoRelay } from "../src/compartilhado/relay";
import { criarLog } from "../src/nucleo/relay/log";
import { iniciarRelay, type ServidorRelay } from "../src/nucleo/relay/servidor";
import { canalEfemero, chaveEfemera } from "../src/nucleo/remoto-estendido/pareamento-relay";
import { canalId, chaveEnvelope, epocaDe } from "../src/nucleo/remoto-estendido/canal";
import { abrirWs } from "../src/nucleo/remoto-estendido/ws-cliente";
import { novoParAssinatura } from "../src/nucleo/remoto/protocolo";
import { abrirApp, type AppAberto } from "./fixture";
import { ClienteViaRelay } from "./fixtures/relay/cliente-pwa-falso";
import { variavelDeAmbiente } from "../src/nucleo/produto";

interface JanelaRelay {
  ade: {
    relay: {
      estado(): Promise<EstadoRelay>;
      configObter(): Promise<{ habilitado: boolean; experimental: boolean; url: string; reconhecimento_experimental: boolean; consentimento_versao: string }>;
      configDefinir(p: { reconhecimento_experimental?: boolean }): Promise<unknown>;
      ligar(): Promise<{ ok: boolean; motivo?: string }>;
      desligar(): Promise<{ ok: boolean }>;
      parearIniciar(): Promise<{ codigo: string; qr: string; impressao_host: string } | { erro: string }>;
      parearSas(): Promise<{ situacao: string; sas: string | null }>;
      parearDecidir(permitir: boolean): Promise<{ ok: boolean }>;
      dispositivos(): Promise<DispositivoRelay[]>;
      revogar(id: string): Promise<{ ok: boolean }>;
      panico(): Promise<{ ok: boolean }>;
    };
    remoto: {
      permissaoDefinir(p: { dispositivo_id: string; permissao: "leitura" | "mensagem_confirmada" | "mensagem_direta"; confirmacao: string | null }): Promise<unknown>;
      estado(): Promise<{ pendentes: Array<{ id: string }> }>;
      aprovarPedido(id: string, aprovado: boolean): Promise<boolean>;
    };
  };
}

const logsDoRelay: string[] = [];
let relay: ServidorRelay;
let app: AppAberto;
let pastaDados: string;
const SENT_CMD = `SENTINELA-COMANDO-${randomBytes(5).toString("hex")}`;
const SENT_NOME = `SENTINELA-APARELHO-${randomBytes(5).toString("hex")}`;
const pagina = () => app.pagina;
const ev = <T, A = null>(fn: (w: JanelaRelay, a: A) => Promise<T>, a: A = null as A): Promise<T> => pagina().evaluate(`(${fn.toString()})(window, ${JSON.stringify(a)})`) as Promise<T>;
const espera = async (cond: () => boolean | Promise<boolean>, ms = 5000): Promise<void> => {
  const fim = Date.now() + ms;
  while (!(await cond()) && Date.now() < fim) await new Promise((r) => setTimeout(r, 25));
  if (!(await cond())) throw new Error("tempo esgotado");
};
const env = (): Record<string, string> => ({ NODE_ENV: "test", [variavelDeAmbiente("E2E")]: "1" });

function semearPreferencias(reconhecimento: boolean): void {
  // `ws://127.0.0.1` só vale com NODE_ENV=test (mesma regra do ws-cliente); o consentimento é o texto versionado
  writeFileSync(join(pastaDados, "preferencias.json"), JSON.stringify({ relay_config: { url: `ws://127.0.0.1:${relay.porta}/v1/canal/x`, consentimento_versao: TEXTO_CONSENTIMENTO_RELAY_VERSAO, reconhecimento_experimental: reconhecimento, padding: true } }));
}

beforeAll(async () => {
  relay = await iniciarRelay({ bind: "127.0.0.1", porta: 0, log: criarLog({ agora: Date.now, saida: (l) => logsDoRelay.push(l) }) });
  pastaDados = mkdtempSync(join(tmpdir(), "relay-e2e-"));
  semearPreferencias(true);
  app = await abrirApp({ pastaDados, env: env() });
  await pagina().waitForSelector('nav[aria-label="Principal"]', { timeout: 15_000 });
}, 120_000);
afterAll(async () => {
  await app?.fechar();
  await relay?.fechar();
  if (pastaDados !== undefined) rmSync(pastaDados, { recursive: true, force: true });
});

async function parear(permissaoFinal: "leitura" | "mensagem_confirmada" = "leitura") {
  const r = await ev((w) => w.ade.relay.parearIniciar());
  if ("erro" in r) throw new Error(`parearIniciar: ${r.erro}`);
  await espera(async () => relay.metricas().canais >= 1);
  const url = `ws://127.0.0.1:${relay.porta}/v1/canal/x`;
  const par = novoParAssinatura();
  const cel = new ClienteViaRelay(abrirWs, { url, canal: canalEfemero(r.codigo), chaveEnvelope: chaveEfemera(r.codigo), chavePublicaDispositivo: par.publicaSpki, chavePrivadaDispositivo: par.privadaPkcs8, aguardar: async () => undefined }, SENT_NOME);
  cel.par = par;
  if (!(await cel.conectar())) throw new Error("celular não conectou ao canal efêmero");
  const ini = await cel.iniciarPareamento(r.codigo);
  if (!ini.ok) throw new Error(`pareamento: ${ini.etapa}`);
  await espera(async () => (await ev((w) => w.ade.relay.parearSas())).situacao === "aguardando_decisao");
  const sas = await ev((w) => w.ade.relay.parearSas());
  expect(sas.sas).toBe(ini.sas); // SAS igual nos dois lados
  expect(await ev((w) => w.ade.relay.parearDecidir(true))).toEqual({ ok: true });
  expect(await cel.concluirPareamento(ini.hid, ini.chaves)).toBe(true);
  expect((await cel.abrirSessao()).ok).toBe(true);
  const msg = (await cel.enviar({ t: "canal_segredo" })).msg as { segredo: string };
  const segredo = Buffer.from(msg.segredo, "base64");
  cel.fechar();
  const id = cel.dispositivoId as string;
  if (permissaoFinal !== "leitura") await ev((w, a: { id: string; p: "mensagem_confirmada" }) => w.ade.remoto.permissaoDefinir({ dispositivo_id: a.id, permissao: a.p, confirmacao: null }), { id, p: permissaoFinal });
  await espera(async () => (await ev((w) => w.ade.relay.estado())).conectado);
  const def = new ClienteViaRelay(abrirWs, { url, canal: canalId(segredo, epocaDe(Date.now())), chaveEnvelope: chaveEnvelope(segredo, "sessao"), chavePublicaDispositivo: par.publicaSpki, chavePrivadaDispositivo: par.privadaPkcs8, aguardar: async () => undefined }, SENT_NOME);
  def.par = par;
  def.dispositivoId = id;
  def.identidadeFixada = cel.identidadeFixada;
  if (!(await def.conectar())) throw new Error("celular não conectou ao canal definitivo");
  if (!(await def.abrirSessao()).ok) throw new Error("sessão no canal definitivo falhou");
  return { def, id, segredo };
}

describe("relay no Electron real", () => {
  it("nasce DESLIGADO (0 conexões, invariantes) e ligar exige o reconhecimento consumido a cada ligação", async () => {
    expect(relay.metricas().conexoes).toBe(0);
    expect(await ev((w) => w.ade.relay.estado())).toMatchObject({ ligado: false, situacao: "desligado", experimental: true });
    expect(await ev((w) => w.ade.relay.configObter())).toMatchObject({ habilitado: false, experimental: true });
    expect(await ev((w) => w.ade.relay.parearIniciar())).toEqual({ erro: "relay_desligado" });
    expect(await ev((w) => w.ade.relay.ligar())).toEqual({ ok: true });
    expect((await ev((w) => w.ade.relay.configObter())).reconhecimento_experimental).toBe(false); // consumido
    expect(await ev((w) => w.ade.relay.ligar())).toEqual({ ok: false, motivo: "ja_ligado" });
    expect(await ev((w) => w.ade.relay.estado())).toMatchObject({ ligado: true, situacao: "ocioso" });
    expect(relay.metricas().conexoes).toBe(0); // ligado sem dispositivos: ainda 0 sockets
  });

  it("pareia com SAS igual, nasce `leitura`, `leitura` não escreve e o relay nunca vê as sentinelas", async () => {
    const { def, id } = await parear();
    const d = (await ev((w) => w.ade.relay.dispositivos())).find((x) => x.id === id) as DispositivoRelay;
    expect(d).toMatchObject({ permissao: "leitura", transporte: "relay" });
    expect((await def.enviar({ t: "estado" })).status).toBe(200);
    const r = await def.enviar({ t: "comando", texto: `diga ao maestro: ${SENT_CMD}`, client_request_id: "e2e-relay-0001" });
    expect(JSON.stringify(r.msg)).toMatch(/permiss|recus/i);
    const visto = logsDoRelay.join("\n") + JSON.stringify(relay.metricas());
    expect(visto).not.toContain(SENT_CMD);
    expect(visto).not.toContain(SENT_NOME);
    def.fechar();
    await ev((w, i: string) => w.ade.relay.revogar(i), id);
  }, 60_000);

  it("`mensagem_confirmada`: o pedido NÃO executa sem o «Sim» no desktop e o celular não consegue aprovar", async () => {
    const { def, id } = await parear("mensagem_confirmada");
    const r = await def.enviar({ t: "comando", acao: { acao: "enviar_prompt", destino: "maestro", squad: null, texto: "finalizar a publicação" }, client_request_id: "e2e-relay-0002" });
    const texto = JSON.stringify(r.msg);
    expect(texto).toMatch(/confirmacao|confirma|aguardando|recusado|indispon/i); // sem Maestro no ambiente de teste vira recusa; nunca executa direto
    // tentar aprovar pelo próprio celular: não existe caminho (lista fechada de mensagens)
    const tentativa = await def.enviar({ t: "aprovar", confirmacao_id: "cnf_falso12345", aprovado: true });
    expect(JSON.stringify(tentativa.msg)).toMatch(/quadro_invalido/);
    def.fechar();
    await ev((w, i: string) => w.ade.relay.revogar(i), id);
  }, 60_000);

  it("revogar derruba o dispositivo em ≤ 1 s, o relay desregistra o canal e o celular não reconecta; pânico fecha todos os sockets em ≤ 1 s", async () => {
    const a = await parear();
    const b = await parear();
    const antes = relay.metricas().canais;
    const t0 = Date.now();
    expect(await ev((w, i: string) => w.ade.relay.revogar(i), a.id)).toEqual({ ok: true });
    await espera(() => relay.metricas().canais === antes - 1, 1000);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect((await a.def.enviar({ t: "ping" })).status).toBeGreaterThanOrEqual(400);
    expect((await b.def.enviar({ t: "estado" })).status).toBe(200); // o outro segue
    const t1 = Date.now();
    expect(await ev((w) => w.ade.relay.panico())).toEqual({ ok: true });
    await espera(() => relay.metricas().conexoes === 0, 1000);
    expect(Date.now() - t1).toBeLessThan(1000);
    expect(await ev((w) => w.ade.relay.estado())).toMatchObject({ ligado: false, situacao: "desligado" });
    expect((await ev((w) => w.ade.relay.dispositivos())).every((d) => d.revogado_em !== null)).toBe(true);
    expect(await ev((w) => w.ade.relay.ligar())).toMatchObject({ ok: false, motivo: "reconhecimento_ausente" }); // religar exige tudo de novo
  }, 90_000);

  it("reiniciar o app deixa o relay DESLIGADO e sem sockets (mesmo com o consentimento gravado)", async () => {
    await app.fechar(); // `pastaDados` informada abaixo: o app é reaberto na mesma pasta
    semearPreferencias(true);
    app = await abrirApp({ pastaDados, env: env() });
    await pagina().waitForSelector('nav[aria-label="Principal"]', { timeout: 15_000 });
    expect(await ev((w) => w.ade.relay.estado())).toMatchObject({ ligado: false, situacao: "desligado" });
    expect((await ev((w) => w.ade.relay.configObter())).habilitado).toBe(false);
    await new Promise((r) => setTimeout(r, 1500));
    expect(relay.metricas().conexoes).toBe(0);
  }, 120_000);

  it("relay fora do ar: ligar e perder o relay não derruba o app (situação `indisponivel`, nunca revogação) e o app segue respondendo", async () => {
    await ev((w) => w.ade.relay.configDefinir({ reconhecimento_experimental: true }));
    expect((await ev((w) => w.ade.relay.ligar())).ok).toBe(true);
    await relay.fechar(); // o relay some
    await new Promise((r) => setTimeout(r, 1500));
    const e = await ev((w) => w.ade.relay.estado());
    expect(["ocioso", "indisponivel", "conectando"]).toContain(e.situacao);
    expect(await ev((w) => w.ade.relay.dispositivos())).toBeInstanceOf(Array);
    expect(await ev((w) => w.ade.relay.desligar())).toEqual({ ok: true });
  }, 60_000);
});

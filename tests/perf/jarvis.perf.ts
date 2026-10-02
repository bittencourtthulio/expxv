// Orçamentos do Jarvis e do controle remoto (Fase 13; núcleo + loopback, sem Electron nem rede externa): P-63, P-64, P-65, P-67, P-68.
// P-60..P-62 (voz realtime) não se aplicam: o Jarvis é por TEXTO e não há adaptador realtime (D-71, corte D-05). P-66 (memória no app) e P-69 (peso no JS) pedem o app/bundle.
import { afterAll, describe, expect, it } from "vitest";
import { criarCenarioRemoto } from "../fixtures/jarvis/cenario-remoto";
import { criarCenarioJarvis } from "../fixtures/jarvis/cenario-jarvis";
import { gerarCertificadoAutoassinado } from "../../src/nucleo/remoto/certificado";
import { classificarPorRegras } from "../../src/nucleo/jarvis/classificador";
import { gerarCodigo, TAMANHO_CODIGO, TTL_CODIGO_MS, MAX_ERRADAS } from "../../src/nucleo/remoto/protocolo";
import { requisicaoCrua } from "../fixtures/jarvis/cliente-remoto";
import { TEXTO_CONSENTIMENTO_REMOTO_VERSAO } from "../../src/compartilhado/jarvis";
import { gravarMedicoes, percentil, registrar } from "./registro";

afterAll(() => gravarMedicoes());

describe("P-63: latência local do Jarvis", () => {
  it("texto -> classificação p95 <= 2 ms; texto -> confirmação visível p95 <= 100 ms", async () => {
    const frases = ["status", "listar missões", "diga ao maestro: finalizar a publicação do blog", "abrir o painel 3", "pausar a missão loja", "blá blá qualquer coisa"];
    const amostras: number[] = [];
    for (let i = 0; i < 600; i++) {
      const t0 = performance.now();
      classificarPorRegras(frases[i % frases.length] as string);
      amostras.push(performance.now() - t0);
    }
    const p95 = percentil(amostras, 95);
    registrar({ id: "P-63a", descricao: "Jarvis: classificação por regras (p95)", valor: p95, limite: 2, unidade: "ms" });
    expect(p95).toBeLessThanOrEqual(2);
    const c = criarCenarioJarvis();
    const conf: number[] = [];
    for (let i = 0; i < 60; i++) {
      const t0 = performance.now();
      const r = await c.servico.processarTexto({ ator: "jarvis", origem: "fala_do_usuario", texto: `diga ao maestro: tarefa ${i}` });
      conf.push(performance.now() - t0);
      expect(r.tipo).toBe("confirmacao");
    }
    c.fechar();
    const q = percentil(conf, 95);
    registrar({ id: "P-63b", descricao: "Jarvis: texto -> confirmação visível (p95, portas falsas)", valor: q, limite: 100, unidade: "ms" });
    expect(q).toBeLessThanOrEqual(100);
  });
});

describe("P-64/P-65/P-67/P-68: controle remoto (loopback)", () => {
  it("handshake de pareamento <= 1 s; ligar <= 300 ms; revogar derruba em <= 1 s; desligar <= 500 ms com 0 sockets", async () => {
    const c = criarCenarioRemoto();
    try {
      const t0 = performance.now();
      await c.ligar();
      const ligar = performance.now() - t0;
      registrar({ id: "P-65a", descricao: "Controle remoto: ligar o servidor (loopback, sem TLS)", valor: ligar, limite: 300, unidade: "ms" });
      expect(ligar).toBeLessThanOrEqual(300);
      const t1 = performance.now();
      const cli = await c.sessao("leitura");
      const par = performance.now() - t1;
      registrar({ id: "P-64a", descricao: "Controle remoto: pareamento completo + sessão (loopback)", valor: par, limite: 1000, unidade: "ms" });
      expect(par).toBeLessThanOrEqual(1000);
      const id = cli.dispositivoId as string;
      const t2 = performance.now();
      await c.servico.revogar(id);
      const r = await cli.enviar({ t: "ping" });
      const rev = performance.now() - t2;
      registrar({ id: "P-67", descricao: "Controle remoto: revogar até o canal cair", valor: rev, limite: 1000, unidade: "ms" });
      expect(r.status).toBe(401);
      expect(rev).toBeLessThanOrEqual(1000);
      const porta = c.porta();
      const t3 = performance.now();
      await c.servico.desligar();
      const des = performance.now() - t3;
      registrar({ id: "P-65b", descricao: "Controle remoto: desligar fecha tudo", valor: des, limite: 500, unidade: "ms" });
      expect(des).toBeLessThanOrEqual(500);
      await expect(requisicaoCrua({ ip: "127.0.0.1", porta, caminho: "/v1/canal", corpo: "{}" })).rejects.toBeTruthy();
    } finally {
      await c.fechar();
    }
  });
  it("1ª geração do certificado <= 500 ms", () => {
    const t0 = performance.now();
    gerarCertificadoAutoassinado({ ips: ["192.168.1.20"] });
    const ms = performance.now() - t0;
    registrar({ id: "P-65c", descricao: "Certificado autoassinado: 1ª geração", valor: ms, limite: 500, unidade: "ms" });
    expect(ms).toBeLessThanOrEqual(500);
  });
  it("P-68: orçamento de segurança do pareamento (propriedades)", () => {
    expect(TAMANHO_CODIGO * 5).toBeGreaterThanOrEqual(60);
    expect(TTL_CODIGO_MS).toBeLessThanOrEqual(120_000);
    expect(MAX_ERRADAS).toBeLessThanOrEqual(5);
    expect(new Set(Array.from({ length: 500 }, () => gerarCodigo())).size).toBe(500);
    registrar({ id: "P-68", descricao: "Pareamento: bits do código (>= 60)", valor: TAMANHO_CODIGO * 5, limite: 60, unidade: "bits", sentido: "min" });
  });
  it("sem opt-in nada escuta: estado inicial sem porta", async () => {
    const c = criarCenarioRemoto();
    try {
      expect(c.servico.estado().transporte).toMatchObject({ ligado: false, porta: null });
      expect(await c.servico.ligar({ transporte: "loopback", interface: "auto", consentimento_versao: "x" })).toEqual({ erro: "consentimento_ausente" });
      expect(TEXTO_CONSENTIMENTO_REMOTO_VERSAO).toBe("remoto-v1");
    } finally {
      await c.fechar();
    }
  });
});

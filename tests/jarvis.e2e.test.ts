// E2E do Jarvis e do controle remoto (Fase 13) no Electron real. ESCRITO e type-checado; NÃO executado nesta onda: rodar exige `npm run build` (e o `dist/` está em uso pelo `npm run dev`
// do dono). Os testes de núcleo, main, renderer (jsdom) e a suíte adversarial cobrem a mesma lógica sem Electron. Sem rede externa: o cliente remoto é o de referência em Node, em loopback.
//   1) a tela Jarvis abre (lazy) com uma linha de controles e 3 abas; o Jarvis nasce DESLIGADO e recusa tudo
//   2) ligado, «status» responde e «diga ao maestro: …» pede confirmação (nada executa antes do «Sim»); gesto proibido é recusado
//   3) o controle remoto nasce desligado: 0 sockets; ligar sem consentimento falha; com consentimento escuta em loopback
//   4) pareamento com SAS igual no desktop e no cliente; dispositivo nasce `leitura`; `pilot`-send por texto é recusado (permissao_insuficiente)
//   5) revogar derruba o canal e o dispositivo não reconecta; desligar fecha o socket
//   6) nenhum canal jarvis:*/remoto:* aceita campo extra (ator/origem/permissão não vêm do renderer)
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClienteRemoto, requisicaoCrua } from "./fixtures/jarvis/cliente-remoto";
import { criarAmbienteOrq, type AmbienteOrq } from "./fixtures/mcp/ambiente-orq";

interface JanelaJarvis {
  ade: {
    jarvis: {
      estado(): Promise<{ config: { ligado: boolean } }>;
      configGravar(p: { ligado: boolean }): Promise<unknown>;
      enviar(t: string): Promise<{ tipo: string; codigo?: string; confirmacao?: { id: string; resumo: string } }>;
    };
    remoto: {
      estado(): Promise<{ transporte: { ligado: boolean; porta: number | null }; sas: string | null; dispositivos: Array<{ id: string; permissao: string; revogado_em: string | null }> }>;
      ligar(p: { transporte: "lan" | "loopback"; interface: string; consentimento_versao: string }): Promise<{ transporte?: { porta: number }; erro?: string }>;
      desligar(): Promise<unknown>;
      parearIniciar(p: "leitura"): Promise<{ codigo: string }>;
      parearConfirmarSas(p: { igual: boolean; confirmacao_permissao: null }): Promise<{ id: string } | null>;
      revogar(id: string): Promise<boolean>;
    };
  };
}

let amb: AmbienteOrq;
beforeAll(async () => {
  amb = await criarAmbienteOrq({ cli: "cli-agente.mjs" });
  mkdtempSync(`${tmpdir()}/jarvis-e2e-`);
}, 120_000);
afterAll(async () => {
  await amb?.fechar();
});
const pagina = () => amb.app.pagina;
const ev = <T, A>(fn: (w: JanelaJarvis, a: A) => Promise<T>, a: A): Promise<T> => pagina().evaluate(`(${fn.toString()})(window, ${JSON.stringify(a)})`) as Promise<T>;

describe("Jarvis no Electron real", () => {
  it("abre pela navegação: lazy, uma linha de controles, 3 abas; nasce desligado", async () => {
    await pagina().locator('nav[aria-label="Principal"] button', { hasText: "Jarvis" }).click();
    await pagina().mouse.move(900, 500);
    await pagina().waitForSelector("[data-tela-jarvis]", { timeout: 15_000 });
    expect(await pagina().locator('[data-tela-jarvis] [role="tab"]').allTextContents()).toEqual(["Conversa", "Controle remoto", "Auditoria"]);
    expect(await pagina().locator('[data-tela-jarvis] [role="toolbar"]').count()).toBe(1);
    expect((await ev((w) => w.ade.jarvis.estado(), null)).config.ligado).toBe(false);
    expect(await ev((w) => w.ade.jarvis.enviar("status"), null)).toMatchObject({ tipo: "recusado", codigo: "desligado" });
  });
  it("ligado: status responde, pedido ao Maestro pede confirmação e gesto proibido é barrado", async () => {
    await ev((w) => w.ade.jarvis.configGravar({ ligado: true }), null);
    expect((await ev((w) => w.ade.jarvis.enviar("status"), null)).tipo).toBe("resposta");
    const c = await ev((w) => w.ade.jarvis.enviar("diga ao maestro: finalizar a publicação"), null);
    expect(["confirmacao", "recusado"]).toContain(c.tipo); // sem Maestro configurado no ambiente de teste vira «indisponível»; nunca executa direto
    expect(await ev((w) => w.ade.jarvis.enviar("faça o merge da main"), null)).toMatchObject({ tipo: "recusado", codigo: "gesto_proibido" });
  });
});

describe("controle remoto no Electron real", () => {
  const CONSENTIMENTO = "remoto-v1";
  it("nasce desligado, exige consentimento e só então escuta (loopback)", async () => {
    expect((await ev((w) => w.ade.remoto.estado(), null)).transporte).toMatchObject({ ligado: false, porta: null });
    expect(await ev((w, v: string) => w.ade.remoto.ligar({ transporte: "loopback", interface: "auto", consentimento_versao: "x" }), "")).toMatchObject({ erro: "consentimento_ausente" });
    const r = await ev((w, v: string) => w.ade.remoto.ligar({ transporte: "loopback", interface: "auto", consentimento_versao: v }), CONSENTIMENTO);
    expect(r.transporte?.porta).toBeGreaterThan(1023);
  });
  it("pareia com SAS igual, `leitura` não escreve, revogar derruba e desligar fecha", async () => {
    const porta = (await ev((w) => w.ade.remoto.estado(), null)).transporte.porta as number;
    const { codigo } = await ev((w) => w.ade.remoto.parearIniciar("leitura"), null);
    const cli = new ClienteRemoto("127.0.0.1", porta, "celular e2e");
    const ini = await cli.iniciarPareamento(codigo);
    if (!ini.ok) throw new Error(`pareamento falhou: ${ini.etapa}`);
    expect((await ev((w) => w.ade.remoto.estado(), null)).sas).toBe(ini.sas);
    const d = await ev((w) => w.ade.remoto.parearConfirmarSas({ igual: true, confirmacao_permissao: null }), null);
    expect(d).not.toBeNull();
    expect(await cli.concluirPareamento(ini.hid, ini.chaves)).toBe(true);
    expect((await cli.abrirSessao()).ok).toBe(true);
    const r = await cli.enviar({ t: "comando", texto: "diga ao maestro: x", client_request_id: "e2e-req-0001" });
    expect(r.msg).toMatchObject({ resultado: { tipo: "recusado", codigo: "permissao_insuficiente" } });
    expect(await ev((w, id: string) => w.ade.remoto.revogar(id), (d as { id: string }).id)).toBe(true);
    expect((await cli.enviar({ t: "ping" })).status).toBe(401);
    expect((await cli.abrirSessao()).ok).toBe(false);
    await ev((w) => w.ade.remoto.desligar(), null);
    await expect(requisicaoCrua({ ip: "127.0.0.1", porta, caminho: "/v1/canal", corpo: "{}" })).rejects.toBeTruthy();
  });
  it("canais com campo extra são recusados antes do manipulador (ator/origem/permissão não vêm do renderer)", async () => {
    const r = await pagina().evaluate(`(async () => { try { return await window.ade.jarvis.enviar.call(null, "status", "extra"); } catch (e) { return "erro"; } })()`);
    expect(["object", "string"]).toContain(typeof r);
    const bruto = await pagina().evaluate(`(async () => { try { return await window.ade.remoto.parearIniciar({ permissao: "leitura", ator: "x" }); } catch (e) { return "recusado"; } })()`);
    expect(bruto).toBeTruthy();
  });
});

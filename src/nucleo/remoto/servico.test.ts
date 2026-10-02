import { afterEach, describe, expect, it } from "vitest";
import { ClienteRemoto, requisicaoCrua } from "../../../tests/fixtures/jarvis/cliente-remoto";
import { TEXTO_CONSENTIMENTO_REMOTO_VERSAO } from "../../compartilhado/jarvis";
import { criarCenarioRemoto, type CenarioRemoto } from "../../../tests/fixtures/jarvis/cenario-remoto";
import { assinar, dadosAssinadosCliente, novoParEfemero } from "./protocolo";

const abertos: CenarioRemoto[] = [];
const cen = (o: Parameters<typeof criarCenarioRemoto>[0] = {}): CenarioRemoto => {
  const c = criarCenarioRemoto(o);
  abertos.push(c);
  return c;
};
afterEach(async () => {
  for (const c of abertos.splice(0)) await c.fechar();
});
const ligado = async (o: Parameters<typeof criarCenarioRemoto>[0] = {}) => {
  const c = cen(o);
  await c.ligar();
  return c;
};

describe("ciclo de vida: nasce desligado, sob demanda, com consentimento (D-74)", () => {
  it("estado inicial: desligado, sem porta, `persistido: false`", () => {
    const c = cen();
    expect(c.servico.estado().transporte).toMatchObject({ ligado: false, porta: null, persistido: false, conectados: 0 });
  });
  it("ligar exige o consentimento versionado; sem ele nada abre", async () => {
    const c = cen();
    expect(await c.servico.ligar({ transporte: "loopback", interface: "auto", consentimento_versao: "x" })).toEqual({ erro: "consentimento_ausente" });
    expect(c.servico.estado().transporte.ligado).toBe(false);
  });
  it("LAN: só interface privada; sem rede privada -> erro tipado; IP público escolhido é recusado", async () => {
    const c = cen({ deps: { interfaces: () => [{ nome: "x", ip: "8.8.8.8" }] } });
    expect(await c.servico.ligar({ transporte: "lan", interface: "auto", consentimento_versao: TEXTO_CONSENTIMENTO_REMOTO_VERSAO })).toEqual({ erro: "sem_rede_privada" });
    const d = cen();
    expect(await d.servico.ligar({ transporte: "lan", interface: "8.8.8.8", consentimento_versao: TEXTO_CONSENTIMENTO_REMOTO_VERSAO })).toEqual({ erro: "sem_rede_privada" });
  });
  it("LAN usa TLS com certificado do IP escolhido e nunca 0.0.0.0", async () => {
    const chamadas: Array<{ ip: string; tls: boolean; transporte: string }> = [];
    const c = cen({ deps: { iniciar: async (o) => (chamadas.push({ ip: o.ip, tls: o.tls !== undefined, transporte: o.transporte }), { porta: 50000, endereco: o.ip, conexoes: () => 0, fechar: async () => undefined }) } });
    const r = await c.servico.ligar({ transporte: "lan", interface: "auto", consentimento_versao: TEXTO_CONSENTIMENTO_REMOTO_VERSAO });
    expect("erro" in r).toBe(false);
    expect(chamadas).toEqual([{ ip: "192.168.1.20", tls: true, transporte: "lan" }]);
  });
  it("porta ocupada e ligar duas vezes", async () => {
    const c = await ligado();
    expect(await c.servico.ligar({ transporte: "loopback", interface: "auto", consentimento_versao: TEXTO_CONSENTIMENTO_REMOTO_VERSAO })).toEqual({ erro: "ja_ligado" });
    const d = cen({ config: { porta: c.porta() } });
    expect(await d.servico.ligar({ transporte: "loopback", interface: "auto", consentimento_versao: TEXTO_CONSENTIMENTO_REMOTO_VERSAO })).toEqual({ erro: "porta_ocupada" });
  });
  it("reiniciar o app deixa o servidor desligado (AC-20): serviço novo, mesmo banco e mesma config", async () => {
    const c = await ligado();
    await c.parear();
    const c2 = criarCenarioRemoto({ config: c.config });
    abertos.push(c2);
    expect(c2.servico.estado().transporte.ligado).toBe(false);
  });
  it("desligar fecha o socket e derruba os canais; religar é possível", async () => {
    const c = await ligado();
    const cli = await c.sessao();
    const porta = c.porta();
    expect((await cli.enviar({ t: "ping" })).msg).toEqual({ t: "pong" });
    await c.servico.desligar();
    await expect(requisicaoCrua({ ip: "127.0.0.1", porta, caminho: "/v1/canal", corpo: "{}" })).rejects.toBeTruthy();
    await c.ligar();
    expect(c.servico.estado().transporte.ligado).toBe(true);
  });
  it("ociosidade desliga o servidor sem sessões depois de `ocioso_min`", async () => {
    const c = await ligado({ config: { ocioso_min: 5 } });
    await c.servico.varrer();
    expect(c.servico.estado().transporte.ligado).toBe(true);
    c.relogio.avancar(6 * 60_000);
    await c.servico.varrer();
    expect(c.servico.estado().transporte.ligado).toBe(false);
  });
});

describe("pareamento ponta a ponta (T-13.13/14)", () => {
  it("feliz: SAS igual, dispositivo `leitura`, só a chave pública no banco, sessão cifrada", async () => {
    const c = await ligado();
    const { dispositivo, cliente } = await c.parear();
    expect(dispositivo.permissao).toBe("leitura");
    expect(JSON.stringify(c.j.banco.consultar("SELECT * FROM remoto_dispositivo"))).not.toContain(cliente.par.privadaPkcs8.toString("base64"));
    const r = await cliente.abrirSessao();
    expect(r.ok).toBe(true);
    const e = await cliente.enviar({ t: "estado" });
    expect(e.msg).toMatchObject({ t: "estado", status: { tipo: "resposta" }, paineis: { tipo: "resposta" } });
  });
  it("sem confirmar no desktop nada é gravado; SAS diferente nega", async () => {
    const c = await ligado();
    const p = c.servico.parearIniciar("leitura");
    if ("erro" in p) throw new Error("erro");
    const cli = new ClienteRemoto("127.0.0.1", c.porta());
    const ini = await cli.iniciarPareamento(p.codigo);
    expect(ini.ok).toBe(true);
    expect(c.servico.estado().dispositivos).toHaveLength(0);
    expect(c.servico.parearConfirmarSas({ igual: false, confirmacao_permissao: null })).toBeNull();
    expect(c.servico.estado().dispositivos).toHaveLength(0);
    expect(c.servico.estado().sas).toBeNull();
  });
  it("código errado 5x fecha a janela; o 6º (mesmo certo) falha; reutilizar o código = pareamento_expirado", async () => {
    const c = await ligado();
    const p = c.servico.parearIniciar("leitura");
    if ("erro" in p) throw new Error("erro");
    const atacante = new ClienteRemoto("127.0.0.1", c.porta(), "atacante");
    for (let i = 0; i < 5; i++) {
      const r = await atacante.iniciarPareamento("AAAA-AAAA-AAAA");
      expect(r.ok).toBe(false);
    }
    // o cliente honesto aborta ao ver `conf_s` errado; o atacante que força o `fim` sem saber o código conta como tentativa errada
    expect(c.servico.estado().dispositivos).toHaveLength(0);
    const certo = new ClienteRemoto("127.0.0.1", c.porta());
    const ini = await certo.iniciarPareamento(p.codigo);
    expect(ini.ok).toBe(true);
    const dev = c.servico.parearConfirmarSas({ igual: true, confirmacao_permissao: null });
    expect(dev).not.toBeNull();
    const reuso = await new ClienteRemoto("127.0.0.1", c.porta(), "reuso").iniciarPareamento(p.codigo);
    expect(reuso).toMatchObject({ ok: false, etapa: "inicio", status: 403 });
  });
  it("`mensagem_direta` só com PERMITIR digitado; sem ele a decisão continua pendente", async () => {
    const c = await ligado();
    const p = c.servico.parearIniciar("mensagem_direta");
    if ("erro" in p) throw new Error("erro");
    const cli = new ClienteRemoto("127.0.0.1", c.porta());
    const ini = await cli.iniciarPareamento(p.codigo);
    expect(ini.ok).toBe(true);
    expect(c.servico.parearConfirmarSas({ igual: true, confirmacao_permissao: null })).toBeNull();
    expect(c.servico.parearConfirmarSas({ igual: true, confirmacao_permissao: "permitir" })).toBeNull();
    expect(c.servico.parearConfirmarSas({ igual: true, confirmacao_permissao: "PERMITIR" })).toMatchObject({ permissao: "mensagem_direta" });
  });
  it("pareamento só com o servidor ligado", () => {
    const c = cen();
    expect(c.servico.parearIniciar("leitura")).toEqual({ erro: "falhou" });
  });
});

describe("sessão e canal cifrado: autenticação, replay, revogação", () => {
  it("quadro repetido fecha a sessão (AC-11); dispositivo continua apto a abrir outra", async () => {
    const c = await ligado();
    const cli = await c.sessao();
    expect((await cli.enviar({ t: "ping" })).msg).toEqual({ t: "pong" });
    const gravado = cli.ultimoQuadro;
    const rep = await cli.enviarQuadro(gravado);
    expect(rep).toMatchObject({ status: 400, erro: "quadro_invalido" });
    expect((await cli.enviar({ t: "ping" })).status).toBe(401); // a sessão foi derrubada
    expect((await cli.abrirSessao()).ok).toBe(true);
  });
  it("pedido de sessão gravado (replay do nonce) é recusado (AC-24)", async () => {
    const c = await ligado();
    const { cliente } = await c.parear();
    const a = await cliente.abrirSessao();
    expect(a.ok).toBe(true);
    const rep = await cliente.post("/v1/sessao/inicio", a.corpoPedido);
    expect(rep.status).toBe(401);
  });
  it("assinatura de outra chave não abre sessão", async () => {
    const c = await ligado();
    const { cliente } = await c.parear();
    const outro = new ClienteRemoto("127.0.0.1", c.porta());
    const e = novoParEfemero();
    const nonce = Buffer.alloc(16, 9);
    const ts = Date.now();
    const sig = assinar(outro.par.privadaPkcs8, dadosAssinadosCliente(cliente.dispositivoId as string, e.publica, nonce, ts));
    const r = await cliente.post("/v1/sessao/inicio", { dispositivo_id: cliente.dispositivoId, epk: e.publica.toString("base64"), nonce: nonce.toString("base64"), ts, sig: sig.toString("base64") });
    expect(r.status).toBe(401);
  });
  it("revogar derruba o canal em <= 1 s (P-67) e o dispositivo não reconecta (AC-10/AC-24)", async () => {
    const c = await ligado();
    const cli = await c.sessao();
    const id = cli.dispositivoId as string;
    expect((await cli.enviar({ t: "ping" })).status).toBe(200);
    const t0 = performance.now();
    expect(await c.servico.revogar(id)).toBe(true);
    const r = await cli.enviar({ t: "ping" });
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(r.status).toBe(401);
    const nova = await cli.abrirSessao();
    expect(nova.ok).toBe(false);
    expect(c.servico.estado().dispositivos[0]?.revogado_em).not.toBeNull();
  });
  it("sessão aberta de dispositivo expirado/revogado por fora do serviço também é negada a cada requisição", async () => {
    const c = await ligado();
    const cli = await c.sessao();
    c.relogio.avancar(31 * 86_400_000);
    expect((await cli.enviar({ t: "ping" })).erro).toMatch(/dispositivo_revogado|nao_autorizado/);
  });
  it("sessão ociosa expira e, sem nenhuma sessão, o servidor se desliga", async () => {
    const c = await ligado({ config: { ocioso_min: 5 } });
    const cli = await c.sessao();
    c.relogio.avancar(6 * 60_000);
    await c.servico.varrer();
    expect(c.servico.estado().transporte.ligado).toBe(false);
    await expect(cli.enviar({ t: "ping" })).rejects.toBeTruthy();
  });
  it("limite por dispositivo: acima de 120 mensagens/min vira limite_de_taxa", async () => {
    const c = await ligado();
    const cli = await c.sessao();
    let limitado = 0;
    for (let i = 0; i < 135; i++) {
      c.relogio.avancar(1);
      const r = await cli.enviar({ t: "ping" });
      if (r.erro === "limite_de_taxa") limitado++;
    }
    expect(limitado).toBeGreaterThan(0);
  });
  it("mensagem desconhecida e quadros mal formados não derrubam o servidor", async () => {
    const c = await ligado();
    const cli = await c.sessao();
    expect((await cli.enviar({ t: "rm -rf" })).msg).toEqual({ t: "erro", e: "quadro_invalido" });
    expect((await cli.enviar("texto solto")).msg).toEqual({ t: "erro", e: "quadro_invalido" });
    expect((await cli.post("/v1/canal", { sid: cli.sid, quadro: "lixo" })).status).toBe(400);
    expect((await cli.abrirSessao()).ok).toBe(true);
  });
});

describe("comandos do dispositivo viram ações do Jarvis (permissões graduadas, T-13.16)", () => {
  it("`leitura` lê (status, painéis, missões) e `pilot`-send por texto é recusado (AC-15)", async () => {
    const c = await ligado();
    const cli = await c.sessao("leitura");
    const r = await cli.enviar({ t: "comando", texto: "diga ao maestro: finalizar", client_request_id: "req-leitura-1" });
    expect(r.msg).toMatchObject({ t: "resultado", resultado: { tipo: "recusado", codigo: "permissao_insuficiente" } });
    const a = await cli.enviar({ t: "comando", acao: { acao: "enviar_prompt", destino: "maestro", squad: null, texto: "x" } });
    expect(a.msg).toMatchObject({ resultado: { codigo: "permissao_insuficiente" } });
    expect(c.j.orquestrador.proporPlano).not.toHaveBeenCalled();
    expect((await cli.enviar({ t: "comando", texto: "listar painéis" })).msg).toMatchObject({ resultado: { tipo: "resposta", resposta: { nao_confiavel: true } } });
  });
  it("`mensagem_confirmada`: só executa depois de aprovar NO DESKTOP; o celular acompanha o estado do pedido", async () => {
    const c = await ligado();
    const cli = await c.sessao("mensagem_confirmada");
    // o armazém de permissões nasce `leitura`; subir é ação do desktop
    const id = cli.dispositivoId as string;
    expect(c.servico.permissaoDefinir({ dispositivo_id: id, permissao: "mensagem_confirmada", confirmacao: null })).not.toBeNull();
    const r = await cli.enviar({ t: "comando", texto: "diga ao maestro: finalizar a publicação", client_request_id: "req-conf-0001" });
    const conf = (r.msg as { resultado: { tipo: string; confirmacao: { id: string; dispositivo: string } } }).resultado;
    expect(conf.tipo).toBe("confirmacao");
    expect(c.j.orquestrador.executarPlano).not.toHaveBeenCalled();
    expect(c.servico.estado().pendentes).toHaveLength(1);
    expect((await cli.enviar({ t: "pedido_status", confirmacao_id: conf.confirmacao.id })).msg).toMatchObject({ estado: "pendente" });
    // o celular NÃO consegue aprovar o próprio pedido (nenhuma mensagem do canal resolve confirmação)
    const tent = await cli.enviar({ t: "comando", acao: { acao: "status" }, aprovar: conf.confirmacao.id } as never);
    expect(tent.msg).toBeTruthy();
    expect(c.j.orquestrador.executarPlano).not.toHaveBeenCalled();
    expect(await c.servico.aprovarPedido(conf.confirmacao.id, true)).toBe(true);
    expect(c.j.orquestrador.executarPlano).toHaveBeenCalledTimes(1);
    expect((await cli.enviar({ t: "pedido_status", confirmacao_id: conf.confirmacao.id })).msg).toMatchObject({ estado: "executada" });
  });
  it("outro dispositivo não vê o estado do pedido alheio", async () => {
    const c = await ligado();
    const a = await c.sessao("mensagem_confirmada");
    c.servico.permissaoDefinir({ dispositivo_id: a.dispositivoId as string, permissao: "mensagem_confirmada", confirmacao: null });
    const r = await a.enviar({ t: "comando", texto: "diga ao maestro: x", client_request_id: "req-alheio-01" });
    const id = (r.msg as { resultado: { confirmacao: { id: string } } }).resultado.confirmacao.id;
    const b = await c.sessao("leitura");
    expect((await b.enviar({ t: "pedido_status", confirmacao_id: id })).msg).toMatchObject({ estado: "desconhecido" });
  });
  it("`mensagem_direta` envia sem confirmação extra quando a política permite; tela bloqueada suspende; leitura segue", async () => {
    const c = await ligado();
    const cli = await c.sessao("mensagem_direta");
    const r = await cli.enviar({ t: "comando", texto: "diga ao maestro: ajustar a tela", client_request_id: "req-direta-01" });
    expect(r.msg).toMatchObject({ resultado: { tipo: "resposta" } });
    expect(c.j.orquestrador.executarPlano).toHaveBeenCalledTimes(1);
    c.estadoTela.bloqueada = true;
    const b = await cli.enviar({ t: "comando", texto: "diga ao maestro: outra coisa", client_request_id: "req-direta-02" });
    expect(b.msg).toMatchObject({ resultado: { tipo: "recusado", codigo: "so_no_desktop" } });
    expect(c.j.orquestrador.executarPlano).toHaveBeenCalledTimes(1);
    expect((await cli.enviar({ t: "comando", texto: "status" })).msg).toMatchObject({ resultado: { tipo: "resposta" } });
  });
  it("client_request_id repetido não duplica o pedido (AC-21)", async () => {
    const c = await ligado();
    const cli = await c.sessao("mensagem_confirmada");
    c.servico.permissaoDefinir({ dispositivo_id: cli.dispositivoId as string, permissao: "mensagem_confirmada", confirmacao: null });
    const m = { t: "comando", texto: "diga ao maestro: x", client_request_id: "req-dup-00001" };
    const a = (await cli.enviar(m)).msg as { resultado: { confirmacao: { id: string } } };
    const b = (await cli.enviar(m)).msg as { resultado: { confirmacao: { id: string } } };
    expect(b.resultado.confirmacao.id).toBe(a.resultado.confirmacao.id);
    expect(c.j.orquestrador.proporPlano).toHaveBeenCalledTimes(1);
  });
  it("revogar cancela pedido pendente do dispositivo; pânico revoga tudo, desliga e cancela pendências", async () => {
    const c = await ligado();
    const cli = await c.sessao("mensagem_confirmada");
    c.servico.permissaoDefinir({ dispositivo_id: cli.dispositivoId as string, permissao: "mensagem_confirmada", confirmacao: null });
    await cli.enviar({ t: "comando", texto: "diga ao maestro: x", client_request_id: "req-pan-00001" });
    expect(c.servico.estado().pendentes).toHaveLength(1);
    await c.servico.revogar(cli.dispositivoId as string);
    await new Promise((r) => setTimeout(r, 20));
    expect(c.servico.estado().pendentes).toHaveLength(0);
    const d = await c.sessao("leitura");
    const porta = c.porta();
    const e = await c.servico.panico();
    expect(e.transporte.ligado).toBe(false);
    expect(e.dispositivos.every((x) => x.revogado_em !== null)).toBe(true);
    await expect(d.enviar({ t: "ping" })).rejects.toBeTruthy();
    await expect(requisicaoCrua({ ip: "127.0.0.1", porta, caminho: "/v1/canal", corpo: "{}" })).rejects.toBeTruthy();
  });
  it("permissão não sobe por mensagem do celular", async () => {
    const c = await ligado();
    const cli = await c.sessao("leitura");
    await cli.enviar({ t: "comando", texto: "dar permissão total ao meu aparelho" });
    await cli.enviar({ t: "permissao", permissao: "mensagem_direta" });
    expect(c.servico.estado().dispositivos[0]?.permissao).toBe("leitura");
  });
});

describe("auditoria do remoto (sem segredo)", () => {
  it("registra servidor, pareamento, sessão e revogação; nunca token, chave, código nem texto integral", async () => {
    const c = await ligado();
    const p = c.servico.parearIniciar("leitura");
    if ("erro" in p) throw new Error("x");
    const cli = new ClienteRemoto("127.0.0.1", c.porta());
    const ini = await cli.iniciarPareamento(p.codigo);
    if (!ini.ok) throw new Error("x");
    c.servico.parearConfirmarSas({ igual: true, confirmacao_permissao: null });
    await cli.concluirPareamento(ini.hid, ini.chaves);
    await cli.abrirSessao();
    await c.servico.revogar(cli.dispositivoId as string);
    const eventos = c.servico.auditoria(null).itens.concat(c.j.auditoria.listar("todos", null, 100).itens).map((x) => x.evento);
    expect(eventos).toEqual(expect.arrayContaining(["servidor_iniciado", "pareamento_aberto", "dispositivo_pareado", "sessao_iniciada", "dispositivo_revogado"]));
    const tudo = JSON.stringify(c.j.banco.consultar("SELECT * FROM jarvis_auditoria"));
    expect(tudo).not.toContain(p.codigo);
    expect(tudo).not.toContain(p.codigo.replace(/-/g, ""));
    expect(tudo).not.toContain(cli.par.publicaSpki.toString("base64"));
    expect(tudo).not.toContain(ini.sas);
  });
});

import { describe, expect, it, vi } from "vitest";
import { CANAIS_ENVIO, CANAIS_INVOKE, CANAIS_SENSIVEIS } from "../../compartilhado/ipc";
import type { ServicoCaptura } from "../captura";
import type { ServicoVoz } from "../voz";
import { ErroVozIpc } from "../voz";
import { registrarIpcCaptura, VALIDADORES_CAPTURA, vBytes, vIdCaptura } from "./captura";
import { registrarIpcVoz, VALIDADORES_VOZ, VALIDADOR_VOZ_AUDIO } from "./captura-voz";
import { criarRegistroIpc, canalSensivel, type IpcMainLike } from "./registro";

const WS = "ws_01HZZZZZZZZZZZ";
const SESSAO = "sessao_abc-123456";
const ID = "2026-10-01_10-00-00";
const TOKEN = "a".repeat(32);

function ipcFalso() {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const ouvintes = new Map<string, (e: unknown, ...a: unknown[]) => void>();
  const ipc: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: (c, l) => void ouvintes.set(c, l), removeHandler: () => undefined, removeAllListeners: () => undefined };
  return { ipc, handlers, ouvintes };
}

describe("contrato dos canais captura:* e voz:*", () => {
  it("todo canal do contrato tem validador e nenhum validador é órfão", () => {
    const captura = [...CANAIS_INVOKE].filter((c) => c.startsWith("captura:")).sort();
    const voz = [...CANAIS_INVOKE].filter((c) => c.startsWith("voz:")).sort();
    expect(Object.keys(VALIDADORES_CAPTURA).sort()).toEqual(captura);
    expect(Object.keys(VALIDADORES_VOZ).sort()).toEqual(voz);
    expect([...CANAIS_ENVIO].filter((c) => c.startsWith("voz:"))).toEqual(["voz:audio"]);
  });

  it("a chave do serviço é canal sensível (o log do registro nunca imprime o payload)", () => {
    expect(CANAIS_SENSIVEIS).toContain("voz:segredo_gravar");
    expect(canalSensivel("voz:segredo_gravar")).toBe(true);
  });

  it("nenhum canal de captura ou voz aceita caminho, cwd ou executável livre no payload", () => {
    const v = VALIDADORES_CAPTURA as Record<string, (x: unknown) => { ok: boolean }>;
    for (const campo of ["caminho", "path", "cwd", "arquivo", "destino", "executavel"]) {
      expect(v["captura:ler"]!({ captura_id: ID, workspace_id: null, [campo]: "/etc/passwd" }).ok).toBe(false);
      expect(v["captura:anexar_ao_pane"]!({ captura_id: ID, workspace_id: null, sessao_id: SESSAO, [campo]: "/etc/passwd" }).ok).toBe(false);
    }
  });
});

describe("validadores de captura:*", () => {
  const V = VALIDADORES_CAPTURA;
  it("aceitam o formato certo e devolvem valor reconstruído", () => {
    expect(V["captura:regiao_iniciar"]({ fonte: "tela" })).toEqual({ ok: true, valor: { fonte: "tela" } });
    expect(V["captura:regiao_confirmar"]({ token: TOKEN, selecao: { x: 1, y: 2, largura: 30, altura: 40 }, workspace_id: WS }).ok).toBe(true);
    expect(V["captura:quadros_iniciar"]({ fonte: "janela_app", fps: 1, workspace_id: null }).ok).toBe(true);
    expect(V["captura:listar"]({ workspace_id: null, depois: "q_2026-10-01_10-00-00-2" }).ok).toBe(true);
    expect(V["captura:estado"](undefined).ok).toBe(true);
    expect(V["captura:config_gravar"]({ patch: { fps_padrao: 2, atalhos_globais: true } }).ok).toBe(true);
  });

  it("recusam lixo: null, lista, texto, campo extra, __proto__ e payload para canal sem payload", () => {
    for (const [canal, ok] of Object.entries(V)) {
      const f = ok as (x: unknown) => { ok: boolean };
      if (canal === "captura:estado" || canal === "captura:pedir_tela" || canal === "captura:quadros_parar") { expect(f({}).ok, canal).toBe(false); continue; }
      for (const x of [null, [], "x", 42, undefined, { extra: 1 }, JSON.parse('{"__proto__":{"polui":1}}')]) expect(f(x).ok, `${canal} ${JSON.stringify(x)}`).toBe(false);
    }
  });

  it("id de captura: só o formato gerado pelo app (nada de ../, barras, espaços nem tamanhos absurdos)", () => {
    for (const bom of [ID, `${ID}-3`, `q_${ID}`, `q_${ID}-12`]) expect(vIdCaptura(bom).ok, bom).toBe(true);
    for (const ruim of ["../../etc/passwd", `${ID}/../x`, `${ID}.png`, "q_", "", " " + ID, `${ID}\n`, `${ID}-1234`, "Q_" + ID, "x".repeat(500)]) expect(vIdCaptura(ruim).ok, ruim).toBe(false);
  });

  it("token: 32 hex minúsculos; seleção: números finitos e dentro da faixa", () => {
    expect(V["captura:regiao_cancelar"]({ token: "A".repeat(32) }).ok).toBe(false);
    expect(V["captura:regiao_cancelar"]({ token: "a".repeat(31) }).ok).toBe(false);
    for (const n of [Number.NaN, Infinity, -1e9, 1e9, "3" as unknown as number]) expect(V["captura:regiao_confirmar"]({ token: TOKEN, selecao: { x: n, y: 0, largura: 10, altura: 10 }, workspace_id: null }).ok, String(n)).toBe(false);
    expect(V["captura:regiao_confirmar"]({ token: TOKEN, selecao: { x: 0, y: 0, largura: -5, altura: 10 }, workspace_id: null }).ok).toBe(false);
  });

  it("fps só 1 ou 2; fonte só tela/janela_app; workspace_id só no formato do app ou null", () => {
    for (const fps of [0, 3, 1.5, "2", null]) expect(V["captura:quadros_iniciar"]({ fonte: "tela", fps, workspace_id: null }).ok, String(fps)).toBe(false);
    expect(V["captura:regiao_iniciar"]({ fonte: "monitor" }).ok).toBe(false);
    expect(V["captura:listar"]({ workspace_id: "../ws", depois: null }).ok).toBe(false);
  });

  it("PNG editado: Uint8Array real, não vazio e até 25 MiB; a vista é copiada e nunca repassada", () => {
    const f = V["captura:salvar_edicao"];
    expect(f({ captura_id: ID, workspace_id: null, png: new Uint8Array(0) }).ok).toBe(false);
    expect(f({ captura_id: ID, workspace_id: null, png: new Uint8Array(25 * 1024 * 1024 + 1) }).ok).toBe(false);
    expect(f({ captura_id: ID, workspace_id: null, png: [1, 2, 3] }).ok).toBe(false);
    expect(f({ captura_id: ID, workspace_id: null, png: "AAAA" }).ok).toBe(false);
    expect(f({ captura_id: ID, workspace_id: null, png: new Uint8Array(10) }).ok).toBe(true);
    expect(vBytes(4)(new Uint8Array(5)).ok).toBe(false);
  });

  it("config da captura: só as 3 chaves, com tipo certo", () => {
    const f = V["captura:config_gravar"];
    expect(f({ patch: { fps_padrao: 3 } }).ok).toBe(false);
    expect(f({ patch: { atalhos_globais: "sim" } }).ok).toBe(false);
    expect(f({ patch: { atalho_regiao: "Cmd+Shift+5" } }).ok).toBe(false);
  });
});

describe("validadores de voz:*", () => {
  const V = VALIDADORES_VOZ;
  it("aceitam o formato certo", () => {
    expect(V["voz:iniciar"]({ sessao_id: SESSAO, disparo: "segurar" }).ok).toBe(true);
    expect(V["voz:consentir"]({ servico: "voz_stt", host: "api.exemplo.com", aceitar: true }).ok).toBe(true);
    expect(V["voz:segredo_gravar"]({ nome: "voz_chave_stt", valor: "abc" }).ok).toBe(true);
    expect(V["voz:segredo_gravar"]({ nome: "voz_chave_stt", valor: null }).ok).toBe(true);
    expect(V["voz:config_gravar"]({ patch: { motor: "comando_local", comando_executavel: "/bin/x", comando_args: ["{wav}"], idioma: "en", atalho: "Command+Shift+Space" } }).ok).toBe(true);
  });

  it("recusam lixo e campos extras em todos os canais", () => {
    for (const [canal, ok] of Object.entries(V)) {
      const f = ok as (x: unknown) => { ok: boolean };
      if (["voz:estado", "voz:testar_motor", "voz:pedir_microfone", "voz:parar", "voz:cancelar", "voz:dicionario_listar", "voz:historico_listar", "voz:historico_limpar", "voz:modelos_listar"].includes(canal)) { expect(f({ x: 1 }).ok, canal).toBe(false); continue; }
      for (const x of [null, [], "x", 42, undefined, { extra: 1 }, JSON.parse('{"__proto__":{"polui":1}}')]) expect(f(x).ok, `${canal} ${JSON.stringify(x)}`).toBe(false);
    }
  });

  it("a chave do serviço só existe com os nomes conhecidos, valor 1..4096, e só estes dois campos", () => {
    const f = V["voz:segredo_gravar"];
    for (const nome of ["voz_chave_refino", "OPENAI_API_KEY", "", "__proto__"]) expect(f({ nome, valor: "x" }).ok, nome).toBe(false);
    expect(f({ nome: "voz_chave_stt", valor: "x".repeat(4_097) }).ok).toBe(false);
    expect(f({ nome: "voz_chave_stt", valor: "" }).ok).toBe(false);
    expect(f({ nome: "voz_chave_stt", valor: "x", extra: true }).ok).toBe(false);
  });

  it("configuração: chave desconhecida, controle em texto, argumentos demais e atalho com símbolo estranho são recusados", () => {
    const f = V["voz:config_gravar"];
    expect(f({ patch: { motor: "whisper" } }).ok).toBe(false);
    expect(f({ patch: { comando_executavel: "/bin/x\nrm" } }).ok).toBe(false);
    expect(f({ patch: { comando_args: Array.from({ length: 33 }, () => "a") } }).ok).toBe(false);
    expect(f({ patch: { comando_args: ["a\u0000b"] } }).ok).toBe(false);
    expect(f({ patch: { atalho: "Command+Shift+Space; rm -rf" } }).ok).toBe(false);
    expect(f({ patch: { shell: "sh" } }).ok).toBe(false);
    expect(f({ patch: { url: "x".repeat(2_049) } }).ok).toBe(false);
  });

  it("consentimento: host só com caracteres de hostname; serviço só voz_stt", () => {
    const f = V["voz:consentir"];
    expect(f({ servico: "voz_refino", host: "a.com", aceitar: true }).ok).toBe(false);
    for (const host of ["a.com/../x", "a com", "a.com\n", "", "x".repeat(300), "http://a.com"]) expect(f({ servico: "voz_stt", host, aceitar: true }).ok, host).toBe(false);
  });

  it("voz:audio: sequência inteira 0..10 milhões e bloco par de até 64 KiB (Uint8Array real)", () => {
    const f = VALIDADOR_VOZ_AUDIO;
    expect(f({ sequencia: 0, dados: new Uint8Array(4) }).ok).toBe(true);
    expect(f({ sequencia: 0, dados: new Uint8Array(65_536) }).ok).toBe(true);
    expect(f({ sequencia: 0, dados: new Uint8Array(65_538) }).ok).toBe(false);
    expect(f({ sequencia: 0, dados: new Uint8Array(3) }).ok).toBe(false);
    expect(f({ sequencia: 0, dados: new Uint8Array(0) }).ok).toBe(false);
    for (const sequencia of [-1, 1.5, 10_000_001, "0", null]) expect(f({ sequencia, dados: new Uint8Array(4) }).ok, String(sequencia)).toBe(false);
    expect(f({ sequencia: 0, dados: Array.from({ length: 4 }, () => 0) }).ok).toBe(false);
    expect(f({ sequencia: 0, dados: new Uint8Array(4), extra: 1 }).ok).toBe(false);
  });

  it("dicionário: termo sem controle de 1 a 64 caracteres", () => {
    expect(V["voz:dicionario_salvar"]({ termo: "config.json", dica: null }).ok).toBe(true);
    expect(V["voz:dicionario_salvar"]({ termo: "", dica: null }).ok).toBe(false);
    expect(V["voz:dicionario_salvar"]({ termo: "a\nb", dica: null }).ok).toBe(false);
    expect(V["voz:dicionario_salvar"]({ termo: "x".repeat(65), dica: null }).ok).toBe(false);
  });
});

describe("manipuladores", () => {
  it("captura: mapeia cada canal para o serviço, com autorização do remetente e erro genérico para falha interna", async () => {
    const { ipc, handlers } = ipcFalso();
    let autorizado = true;
    const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: () => autorizado });
    const svc = {
      estado: vi.fn(() => ({ tela: "concedida" })),
      regiaoConfirmar: vi.fn(async () => ({ ok: true, captura_id: ID })),
      anexarAoPane: vi.fn(async () => { throw new Error("EACCES: /Users/fulano/segredo/arquivo.png"); }),
      ler: vi.fn(async () => { throw new Error("[captura_inexistente] Captura inexistente."); }),
    } as unknown as ServicoCaptura;
    const aviso = vi.fn();
    registrarIpcCaptura({ registro, servico: () => svc, aviso });
    expect(await handlers.get("captura:estado")!({})).toEqual({ tela: "concedida" });
    await handlers.get("captura:regiao_confirmar")!({}, { token: TOKEN, selecao: { x: 1, y: 2, largura: 30, altura: 40 }, workspace_id: WS });
    expect((svc.regiaoConfirmar as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([TOKEN, { x: 1, y: 2, largura: 30, altura: 40 }, WS]);
    // falha interna: texto genérico, sem caminho nem mensagem original
    const e = await Promise.resolve(handlers.get("captura:anexar_ao_pane")!({}, { captura_id: ID, workspace_id: null, sessao_id: SESSAO })).catch((x: unknown) => x);
    expect((e as Error).message).toBe("[indisponivel] Falha interna na captura.");
    expect((e as Error).message).not.toContain("/Users");
    // erro de regra do serviço passa com o código
    await expect(handlers.get("captura:ler")!({}, { captura_id: ID, workspace_id: null })).rejects.toThrow("[captura_inexistente] Captura inexistente.");
    // remetente não autorizado: recusado ANTES do serviço
    autorizado = false;
    await expect(handlers.get("captura:estado")!({})).rejects.toThrow(/não autorizado/);
    expect((svc.estado as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it("voz: erro de regra mantém o código; falha interna vira texto genérico e o log não leva a mensagem", async () => {
    const { ipc, handlers, ouvintes } = ipcFalso();
    const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: () => true });
    const audio = vi.fn();
    const svc = {
      iniciar: vi.fn(async () => { throw new Error("falhou com a fala 'minha senha é 1234'"); }),
      segredoGravar: vi.fn(async () => { throw new ErroVozIpc("cofre_indisponivel", "O cofre do sistema não está disponível."); }),
      audio,
    } as unknown as ServicoVoz;
    const aviso = vi.fn();
    registrarIpcVoz({ registro, servico: () => svc, aviso });
    const e = await Promise.resolve(handlers.get("voz:iniciar")!({}, { sessao_id: SESSAO, disparo: "segurar" })).catch((x: unknown) => x);
    expect((e as Error).message).toBe("[indisponivel] Falha interna na voz.");
    expect(JSON.stringify(aviso.mock.calls)).not.toContain("senha");
    await expect(handlers.get("voz:segredo_gravar")!({}, { nome: "voz_chave_stt", valor: "CHAVE" })).rejects.toThrow("[cofre_indisponivel]");
    ouvintes.get("voz:audio")!({}, { sequencia: 3, dados: new Uint8Array(4) });
    await vi.waitFor(() => expect(audio).toHaveBeenCalledWith(3, expect.any(Uint8Array)));
  });
});

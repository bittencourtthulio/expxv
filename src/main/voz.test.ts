import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventoVozIpc } from "../compartilhado/captura";
import { ErroMotor, type MotorStt } from "../nucleo/voz/motores/motor";
import type { Permissoes } from "./permissoes";
import { criarServicoVoz, type DependenciasVoz, type ServicoVoz } from "./voz";

/** PCM16 com energia clara; 16 amostras por ms. */
const fala = (ms: number): Uint8Array => {
  const n = ms * 16;
  const b = new Uint8Array(n * 2);
  const v = new DataView(b.buffer);
  for (let i = 0; i < n; i++) v.setInt16(i * 2, i % 2 === 0 ? 9000 : -9000, true);
  return b;
};

interface Cena {
  svc: ServicoVoz;
  prefs: Map<string, unknown>;
  eventos: EventoVozIpc[];
  escritos: [string, string][];
  chamadasMotor: number;
  wavs: Uint8Array[];
  motor: { resposta: () => Promise<string> };
  mic: { estado: "concedida" | "negada" | "indeterminada" | "restrita" };
  sessoes: Set<string>;
  cofre: { valores: Map<string, string>; disponivel: boolean };
  fabricaHttp: ReturnType<typeof vi.fn>;
  relogio: { t: number; agendados: { fn: () => void; ms: number }[] };
}

function montar(extra: Partial<DependenciasVoz> = {}, prefsIniciais: Record<string, unknown> = { voz_motor: "comando_local", voz_comando_executavel: "/bin/stt", voz_comando_args: ["{wav}"] }): Cena {
  const prefs = new Map<string, unknown>(Object.entries(prefsIniciais));
  const eventos: EventoVozIpc[] = [];
  const escritos: [string, string][] = [];
  const wavs: Uint8Array[] = [];
  const motor = { resposta: async (): Promise<string> => "texto ditado" };
  const cena = { chamadasMotor: 0 } as Cena;
  const mic = { estado: "concedida" as Cena["mic"]["estado"] };
  const sessoes = new Set(["s1"]);
  const cofre = { valores: new Map<string, string>(), disponivel: true };
  const relogio = { t: 1_000, agendados: [] as { fn: () => void; ms: number }[] };
  const motorFalso: MotorStt = { transcrever: async (wav) => { cena.chamadasMotor += 1; wavs.push(new Uint8Array(wav)); return motor.resposta(); } };
  const fabricaHttp = vi.fn(() => motorFalso);
  const permissoes: Permissoes = { plataforma: "mac", microfone: () => mic.estado, tela: () => "concedida", pedirMicrofone: async () => mic.estado, abrirAjustes: async () => true };
  const svc = criarServicoVoz({
    permissoes,
    prefs: { obter: (c) => prefs.get(c) ?? null, definir: async (c, v) => void prefs.set(c, v) },
    segredos: {
      disponivel: async () => cofre.disponivel,
      guardar: async (n, v) => void cofre.valores.set(n, v),
      existe: async (n) => cofre.valores.has(n),
      obter: async (n) => cofre.valores.get(n) ?? null,
      apagar: async (n) => void cofre.valores.delete(n),
    },
    motores: { comandoLocal: () => motorFalso, http: fabricaHttp as never },
    sessaoExiste: (id) => sessoes.has(id),
    escrever: (id, t) => { if (!sessoes.has(id)) return false; escritos.push([id, t]); return true; },
    emitir: (e) => void eventos.push(e),
    agora: () => relogio.t,
    agendar: (fn, ms) => { const item = { fn, ms }; relogio.agendados.push(item); return () => void relogio.agendados.splice(relogio.agendados.indexOf(item), 1); },
    ...extra,
  });
  return Object.assign(cena, { svc, prefs, eventos, escritos, wavs, motor, mic, sessoes, cofre, fabricaHttp, relogio });
}

let c: Cena;
beforeEach(() => { c = montar(); });
afterEach(async () => { await c.svc.encerrar(); });

async function falar(ms = 1_000, sessao = "s1"): Promise<void> {
  expect((await c.svc.iniciar(sessao, "segurar")).ok).toBe(true);
  c.svc.audio(0, fala(Math.min(ms, 2_000)));
}

describe("ditado completo", () => {
  it("segurar, falar, soltar: o texto vai ao Pane UMA vez, com espaço final e SEM Enter", async () => {
    await falar();
    expect(await c.svc.parar()).toEqual({ ok: true });
    expect(c.escritos).toEqual([["s1", "texto ditado "]]);
    expect(c.escritos[0]![1]).not.toMatch(/[\r\n]/);
    expect(c.svc.ditado()).toBe("ocioso");
    expect(c.eventos.filter((e) => e.tipo === "estado").map((e) => (e as { ditado: string }).ditado)).toEqual(["gravando", "transcrevendo", "injetando", "ocioso"]);
    expect(c.eventos).toContainEqual(expect.objectContaining({ tipo: "texto", injetada: true, palavras: 2, codigo: null }));
    expect(c.wavs).toHaveLength(1);
    expect(String.fromCharCode(...c.wavs[0]!.subarray(0, 4))).toBe("RIFF");
  });

  it("duas falas seguidas viram 'A B' no prompt", async () => {
    c.motor.resposta = async () => "A";
    await falar(); await c.svc.parar();
    c.motor.resposta = async () => "B";
    await falar(); await c.svc.parar();
    expect(c.escritos.map(([, t]) => t).join("")).toBe("A B ");
  });

  it("texto com sequência de controle nunca chega ao PTY como controle", async () => {
    c.motor.resposta = async () => "ls\x1b[31m -la\r\nrm -rf /\x07";
    await falar(); await c.svc.parar();
    expect(c.escritos[0]![1]).toBe("ls -la rm -rf / ");
    expect(c.escritos[0]![1]).not.toMatch(/[\u0000-\u001f\u007f]/);
  });

  it("dicionário: config.json e Supabase sobrevivem", async () => {
    await c.svc.dicionarioSalvar("config.json", null);
    await c.svc.dicionarioSalvar("Supabase", "super base");
    c.motor.resposta = async () => "abra o Config.JSON no supabase";
    await falar(); await c.svc.parar();
    expect(c.escritos[0]![1]).toBe("abra o config.json no Supabase ");
    expect((await c.svc.dicionarioRemover("supabase")).map((t) => t.termo)).toEqual(["config.json"]);
  });
});

describe("cancelar e erros", () => {
  it("ESC durante a gravação: nada é injetado, buffer zerado, volta a ocioso", async () => {
    await falar();
    await c.svc.cancelar();
    expect(c.svc.ditado()).toBe("ocioso");
    expect(c.escritos).toEqual([]);
    expect(await c.svc.parar()).toEqual({ ok: false });
    expect(c.chamadasMotor).toBe(0);
    c.svc.audio(5, fala(500)); // fora da fala nada é guardado
  });

  it("ESC durante a transcrição: nada é injetado", async () => {
    let soltar!: (t: string) => void;
    c.motor.resposta = () => new Promise<string>((r) => { soltar = r; });
    await falar();
    const p = c.svc.parar();
    await Promise.resolve();
    expect(c.svc.ditado()).toBe("transcrevendo");
    await c.svc.cancelar();
    soltar("texto tardio");
    await p;
    expect(c.escritos).toEqual([]);
    expect(c.svc.ditado()).toBe("ocioso");
  });

  it("fala durante a transcrição é recusada (ocupado), não enfileirada", async () => {
    let soltar!: (t: string) => void;
    c.motor.resposta = () => new Promise<string>((r) => { soltar = r; });
    await falar();
    const p = c.svc.parar();
    await Promise.resolve();
    expect(await c.svc.iniciar("s1", "segurar")).toEqual({ ok: false, codigo: "ocupado" });
    soltar("ok");
    await p;
    expect(c.escritos).toHaveLength(1);
  });

  it("fala de 299 ms vira fala_curta: nada chega ao motor e o erro some em 3 s", async () => {
    expect((await c.svc.iniciar("s1", "segurar")).ok).toBe(true);
    c.svc.audio(0, fala(299));
    await c.svc.parar();
    expect(c.chamadasMotor).toBe(0);
    expect(c.eventos).toContainEqual({ tipo: "erro", codigo: "fala_curta", estagio: "transcrevendo" });
    expect(c.svc.ditado()).toBe("erro");
    c.relogio.t += 3_000;
    c.relogio.agendados.splice(0).forEach((a) => a.fn());
    expect(c.svc.ditado()).toBe("ocioso");
  });

  it("silêncio vira fala_vazia", async () => {
    await c.svc.iniciar("s1", "segurar");
    c.svc.audio(0, new Uint8Array(32 * 1000));
    await c.svc.parar();
    expect(c.eventos).toContainEqual(expect.objectContaining({ tipo: "erro", codigo: "fala_vazia" }));
    expect(c.chamadasMotor).toBe(0);
  });

  it("motor falha: erro nominal sem texto e nada injetado; ErroMotor mantém o código", async () => {
    c.motor.resposta = async () => { throw new ErroMotor("limite_de_uso", "x"); };
    await falar(); await c.svc.parar();
    expect(c.eventos).toContainEqual(expect.objectContaining({ tipo: "erro", codigo: "limite_de_uso" }));
    expect(c.escritos).toEqual([]);
  });

  it("transcrição vazia vira fala_vazia", async () => {
    c.motor.resposta = async () => " \r\n ";
    await falar(); await c.svc.parar();
    expect(c.eventos).toContainEqual(expect.objectContaining({ tipo: "erro", codigo: "fala_vazia" }));
  });

  it("Pane fechado no meio: nada é escrito, a fala fica no histórico (copiável) e o código é cancelado", async () => {
    let soltar!: (t: string) => void;
    c.motor.resposta = () => new Promise<string>((r) => { soltar = r; });
    await falar();
    const p = c.svc.parar();
    await Promise.resolve();
    c.sessoes.delete("s1");
    soltar("fala perdida");
    await p;
    expect(c.escritos).toEqual([]);
    expect(c.svc.historicoListar()[0]).toMatchObject({ texto: "fala perdida", injetada: false, codigo: "cancelado" });
    expect(c.svc.ditado()).toBe("ocioso");
  });

  it("sem Pane de destino: sem_terminal_em_foco, antes de abrir o microfone", async () => {
    expect(await c.svc.iniciar("s_nao_existe", "segurar")).toEqual({ ok: false, codigo: "sem_terminal_em_foco" });
    expect(c.svc.ditado()).toBe("ocioso");
  });

  it("120 s de fala: corta, avisa e ainda transcreve o que coube", async () => {
    await c.svc.iniciar("s1", "segurar");
    const bloco = new Uint8Array(65_536);
    bloco.set(fala(2_000).subarray(0, 65_536));
    for (let i = 0; i < 61 && c.svc.ditado() === "gravando"; i++) c.svc.audio(i, bloco);
    await vi.waitFor(() => expect(c.escritos).toHaveLength(1));
    expect(c.eventos).toContainEqual({ tipo: "aviso", codigo: "fala_cortada" });
    expect(c.wavs[0]!.byteLength).toBe(44 + 3_840_000);
  });
});

describe("motor, microfone e privacidade", () => {
  it("sem motor configurado o ditado simplesmente não existe: nada chama motor, nada conecta", async () => {
    c = montar({}, {});
    expect(await c.svc.iniciar("s1", "segurar")).toEqual({ ok: false, codigo: "motor_ausente" });
    expect(await c.svc.testarMotor()).toEqual({ ok: false, latencia_ms: null, erro: "motor_ausente" });
    expect(c.chamadasMotor).toBe(0);
    expect(c.fabricaHttp).not.toHaveBeenCalled();
    expect((await c.svc.estado()).motor_pronto).toBe(false);
  });

  it("microfone negado ou restrito: microfone_negado, sem laço de pedidos", async () => {
    c.mic.estado = "negada";
    expect(await c.svc.iniciar("s1", "segurar")).toEqual({ ok: false, codigo: "microfone_negado" });
    c.mic.estado = "restrita";
    expect(await c.svc.iniciar("s1", "segurar")).toEqual({ ok: false, codigo: "microfone_negado" });
  });

  describe("HTTP remoto", () => {
    const http = { voz_motor: "http_compativel", voz_url: "https://stt.exemplo.com/v1" };

    it("sem consentimento: iniciar recusa e o motor HTTP nunca é construído", async () => {
      c = montar({}, http);
      expect(await c.svc.iniciar("s1", "segurar")).toEqual({ ok: false, codigo: "consentimento_ausente" });
      expect(await c.svc.testarMotor()).toMatchObject({ ok: false, erro: "consentimento_ausente" });
      expect(c.fabricaHttp).not.toHaveBeenCalled();
      expect(c.chamadasMotor).toBe(0);
    });

    it("consentimento por host: vale para o host, mostra o host exato e cai ao trocar de host", async () => {
      c = montar({}, http);
      await c.svc.consentir("voz_stt", "stt.exemplo.com", true);
      let e = await c.svc.estado();
      expect(e).toMatchObject({ consentimento: true, host: "stt.exemplo.com", motor_pronto: true });
      expect((await c.svc.iniciar("s1", "segurar")).ok).toBe(true);
      await c.svc.cancelar();
      await c.svc.configGravar({ url: "https://outro.exemplo.org/v1" });
      e = await c.svc.estado();
      expect(e).toMatchObject({ consentimento: false, host: "outro.exemplo.org" });
      expect(await c.svc.iniciar("s1", "segurar")).toEqual({ ok: false, codigo: "consentimento_ausente" });
      await c.svc.configGravar({ url: "https://stt.exemplo.com/v1" });
      expect((await c.svc.estado()).consentimento).toBe(true); // o aceite antigo do host original continua valendo
      await c.svc.consentir("voz_stt", "stt.exemplo.com", false);
      expect((await c.svc.estado()).consentimento).toBe(false);
    });

    it("consentir um host diferente do configurado é recusado", async () => {
      c = montar({}, http);
      await expect(c.svc.consentir("voz_stt", "atacante.com", true)).rejects.toThrow(/host configurado/);
      expect((await c.svc.estado()).consentimento).toBe(false);
    });

    it("a chave vai ao cofre, nunca volta ao renderer e sem cofre NADA é gravado", async () => {
      c = montar({}, http);
      await c.svc.segredoGravar("voz_chave_stt", "CHAVE-SECRETA-123");
      const estadoTexto = JSON.stringify(await c.svc.estado());
      expect(estadoTexto).not.toContain("CHAVE-SECRETA-123");
      expect((await c.svc.estado()).tem_chave).toBe(true);
      expect(JSON.stringify([...c.prefs.entries()])).not.toContain("CHAVE-SECRETA-123");
      await c.svc.segredoGravar("voz_chave_stt", null);
      expect((await c.svc.estado()).tem_chave).toBe(false);
      c.cofre.disponivel = false;
      await expect(c.svc.segredoGravar("voz_chave_stt", "OUTRA-CHAVE")).rejects.toThrow(/cofre/);
      expect([...c.cofre.valores.values()]).toEqual([]);
      await expect(c.svc.segredoGravar("nome_estranho" as never, "x")).rejects.toThrow();
    });
  });

  it("configuração validada: executável relativo, URL ruim e atalho de modificador são recusados", async () => {
    await expect(c.svc.configGravar({ comando_executavel: "whisper", comando_args: ["{wav}"] })).rejects.toThrow(/ABSOLUTO/);
    await expect(c.svc.configGravar({ comando_executavel: "/bin/x", comando_args: ["sem marcador"] })).rejects.toThrow(/\{wav\}/);
    await expect(c.svc.configGravar({ url: "http://exemplo.com" })).rejects.toThrow(/https/);
    await expect(c.svc.configGravar({ atalho: "Alt" })).rejects.toThrow(/Modificador/);
    expect((await c.svc.configGravar({ atalho: "Command+Shift+KeyV".replace("KeyV", "V"), idioma: "en", disparo: "alternar" }))).toMatchObject({ idioma: "en", disparo: "alternar", atalho: "Command+Shift+V" });
  });

  it("o histórico é só em memória, com teto, e some ao encerrar; log nunca leva a fala", async () => {
    const aviso = vi.fn();
    c = montar({ aviso });
    c.motor.resposta = async () => { throw new Error("falhou processando 'segredo falado' sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv"); };
    await falar(); await c.svc.parar();
    expect(JSON.stringify(aviso.mock.calls)).not.toContain("AbCdEfGhIjKl");
    c.motor.resposta = async () => "uma fala";
    await c.svc.cancelar();
    c.relogio.agendados.splice(0).forEach((a) => a.fn());
    c.relogio.t += 4_000;
    await falar(); await c.svc.parar();
    expect(c.svc.historicoListar()).toHaveLength(1);
    expect([...c.prefs.keys()].some((k) => k.includes("historico"))).toBe(false); // nunca em preferências/disco
    await c.svc.encerrar();
    expect(c.svc.historicoListar()).toEqual([]);
    expect(c.svc.historicoLimpar()).toEqual({ ok: true });
  });

  it("testar motor mede a latência com 1 s de silêncio (nenhuma fala)", async () => {
    const r = await c.svc.testarMotor();
    expect(r).toMatchObject({ ok: true, erro: null });
    expect(c.wavs[0]!.byteLength).toBe(44 + 32_000);
    expect(c.wavs[0]!.subarray(44).every((b) => b === 0)).toBe(true);
  });
});

describe("tecla global de alternar", () => {
  it("só registra com opt-in e libera ao desligar; conflito mostra mensagem", async () => {
    const registradas: string[] = [];
    let ocupado = false;
    const teclas = { registrar: (a: string, _f: () => void) => { if (ocupado) return false; registradas.push(a); return true; }, liberar: () => undefined, liberarTodas: () => void registradas.splice(0) };
    c = montar({ teclas });
    expect(registradas).toEqual([]);
    expect((await c.svc.configGravar({ alternar_global: true })).atalho_erro).toBeNull();
    expect(registradas).toEqual(["Command+Shift+Space"]);
    await c.svc.configGravar({ alternar_global: false });
    expect(registradas).toEqual([]);
    ocupado = true;
    expect((await c.svc.configGravar({ alternar_global: true })).atalho_erro).toMatch(/em uso/);
  });
});

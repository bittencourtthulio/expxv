// O motor `local_embutido` dentro do fluxo de ditado EXISTENTE (D-540): configuração, prontidão, pré-aquecimento, injeção só do texto pós-processado e erros nominais.
import { afterEach, describe, expect, it } from "vitest";
import type { EventoVozIpc } from "../compartilhado/captura";
import { ErroMotor, type MotorStt } from "../nucleo/voz/motores/motor";
import type { Permissoes } from "./permissoes";
import { criarServicoVoz, type PortaLocalVoz, type ServicoVoz } from "./voz";

const fala = (ms: number): Uint8Array => {
  const n = ms * 16;
  const b = new Uint8Array(n * 2);
  const v = new DataView(b.buffer);
  for (let i = 0; i < n; i++) v.setInt16(i * 2, i % 2 === 0 ? 9000 : -9000, true);
  return b;
};
/** valor de teste montado em tempo de execução (não é credencial real). */
const CHAVE_FALSA = ["sk", "ant", "api03", "X".repeat(48)].join("-");

function montar(opc: { pronto?: boolean; resposta?: () => Promise<string>; prefs?: Record<string, unknown>; semLocal?: boolean } = {}) {
  const prefs = new Map<string, unknown>(Object.entries({ voz_motor: "local_embutido", voz_modelo_local: "parakeet-tdt-0.6b-v3-int8", ...(opc.prefs ?? {}) }));
  const eventos: EventoVozIpc[] = [];
  const escritos: string[] = [];
  const estado = { pronto: opc.pronto ?? true, resposta: opc.resposta ?? (async (): Promise<string> => "bom dia terminal"), preaquecidos: [] as string[], encerrado: 0, wavs: [] as Uint8Array[], http: 0, comando: 0 };
  const motor: MotorStt = { transcrever: async (wav) => { estado.wavs.push(new Uint8Array(wav)); return estado.resposta(); } };
  const local: PortaLocalVoz = {
    existeNoCatalogo: (id) => id === "parakeet-tdt-0.6b-v3-int8" || id === "whisper-base-int8",
    pronto: async (id) => estado.pronto && id !== null,
    motor: () => motor,
    preaquecer: (id, idioma) => void estado.preaquecidos.push(`${id}|${idioma}`),
    encerrar: () => void (estado.encerrado += 1),
  };
  const permissoes: Permissoes = { plataforma: "mac", microfone: () => "concedida", tela: () => "concedida", pedirMicrofone: async () => "concedida", abrirAjustes: async () => true };
  const svc: ServicoVoz = criarServicoVoz({
    permissoes,
    prefs: { obter: (c) => prefs.get(c) ?? null, definir: async (c, v) => void prefs.set(c, v) },
    segredos: { disponivel: async () => true, guardar: async () => undefined, existe: async () => false, obter: async () => null, apagar: async () => undefined },
    motores: { comandoLocal: () => { estado.comando += 1; return motor; }, http: (() => { estado.http += 1; return motor; }) as never },
    sessaoExiste: (id) => id === "s1",
    escrever: (_id, t) => { escritos.push(t); return true; },
    emitir: (e) => void eventos.push(e),
    agendar: (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return () => clearTimeout(t); },
    ...(opc.semLocal === true ? {} : { local }),
  });
  return { svc, prefs, eventos, escritos, estado };
}

let atual: ReturnType<typeof montar> | null = null;
afterEach(async () => { await atual?.svc.encerrar(); atual = null; });
const M = (...a: Parameters<typeof montar>): ReturnType<typeof montar> => (atual = montar(...a));

describe("estado e configuração", () => {
  it("modelo ativo instalado e íntegro: motor pronto e sem consentimento de rede (nada sai da máquina); host nulo", async () => {
    const c = M();
    const e = await c.svc.estado();
    expect(e).toMatchObject({ motor: "local_embutido", modelo_local: "parakeet-tdt-0.6b-v3-int8", motor_pronto: true, consentimento: true, host: null, tem_chave: false, ociosidade_s: 120 });
  });

  it("modelo ausente/corrompido: motor NÃO pronto e o ditado nem começa (modelo_ausente)", async () => {
    const c = M({ pronto: false });
    expect((await c.svc.estado()).motor_pronto).toBe(false);
    expect(await c.svc.iniciar("s1", "segurar")).toEqual({ ok: false, codigo: "modelo_ausente" });
    expect(c.svc.ditado()).toBe("ocioso");
    expect(c.estado.preaquecidos).toEqual([]);
  });

  it("sem a porta local (instalação sem voz local), o motor local simplesmente não está pronto", async () => {
    const c = M({ semLocal: true });
    expect((await c.svc.estado()).motor_pronto).toBe(false);
    expect((await c.svc.iniciar("s1", "segurar")).ok).toBe(false);
  });

  it("gravar motor/modelo/ociosidade valida: modelo só do catálogo, ociosidade 15 s a 3600 s", async () => {
    const c = M({ prefs: { voz_motor: "nenhum", voz_modelo_local: null } });
    const e = await c.svc.configGravar({ motor: "local_embutido", modelo_local: "whisper-base-int8", ociosidade_s: 300 });
    expect(e).toMatchObject({ motor: "local_embutido", modelo_local: "whisper-base-int8", ociosidade_s: 300, motor_pronto: true });
    await expect(c.svc.configGravar({ modelo_local: "../../etc/passwd" })).rejects.toThrow(/desconhecido/);
    await expect(c.svc.configGravar({ ociosidade_s: 5 })).rejects.toThrow(/ociosidade/);
    await expect(c.svc.configGravar({ ociosidade_s: 99_999 })).rejects.toThrow(/ociosidade/);
    await expect(c.svc.configGravar({ ociosidade_s: Number.NaN })).rejects.toThrow(/ociosidade/);
    expect((await c.svc.configGravar({ modelo_local: null })).modelo_local).toBeNull();
  });
});

describe("ditado com o motor local", () => {
  it("iniciar pré-aquece o modelo (idioma da configuração); parar injeta SÓ o texto pós-processado, sem Enter, e o áudio zera", async () => {
    const c = M({ resposta: async () => "ls\x1b[31m -la\r\n" });
    expect((await c.svc.iniciar("s1", "segurar")).ok).toBe(true);
    expect(c.estado.preaquecidos).toEqual(["parakeet-tdt-0.6b-v3-int8|pt"]);
    c.svc.audio(0, fala(1_000));
    expect(await c.svc.parar()).toEqual({ ok: true });
    expect(c.escritos).toEqual(["ls -la "]);
    expect(c.escritos[0]).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(c.estado.wavs).toHaveLength(1);
    expect(String.fromCharCode(...c.estado.wavs[0]!.subarray(0, 4))).toBe("RIFF");
    expect(c.estado.http + c.estado.comando).toBe(0); // nem o motor HTTP nem o comando externo foram acordados
  });

  it("erros nominais do runtime chegam como códigos (modelo corrompido, runtime indisponível, tempo esgotado), sem injetar nada", async () => {
    for (const codigo of ["modelo_corrompido", "runtime_indisponivel", "tempo_esgotado"] as const) {
      const c = M({ resposta: async () => { throw new ErroMotor(codigo, "x"); } });
      await c.svc.iniciar("s1", "segurar");
      c.svc.audio(0, fala(1_000));
      await c.svc.parar();
      expect(c.escritos).toEqual([]);
      expect(c.eventos).toContainEqual({ tipo: "erro", codigo, estagio: "transcrevendo" });
      await c.svc.encerrar();
      atual = null;
    }
  });

  it("segredo ditado vai ao terminal como a pessoa falou (é o conteúdo dela), mas o histórico (memória, copiável) é redigido", async () => {
    const c = M({ resposta: async () => `use a chave ${CHAVE_FALSA} agora` });
    await c.svc.iniciar("s1", "segurar");
    c.svc.audio(0, fala(1_000));
    await c.svc.parar();
    expect(c.escritos.join("")).toContain(CHAVE_FALSA);
    const h = c.svc.historicoListar();
    expect(h).toHaveLength(1);
    expect(h[0]?.texto).not.toContain(CHAVE_FALSA);
    expect(h[0]?.texto).toContain("[REDIGIDO]");
  });

  it("encerrar encerra o runtime local (o processo de reconhecimento não sobrevive ao app)", async () => {
    const c = M();
    await c.svc.encerrar();
    expect(c.estado.encerrado).toBe(1);
  });

  it("testarMotor com o local roda uma amostra de silêncio sem consentimento de rede", async () => {
    const c = M({ resposta: async () => "" });
    expect((await c.svc.testarMotor()).ok).toBe(true);
  });
});

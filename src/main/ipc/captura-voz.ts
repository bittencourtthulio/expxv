// Canais `voz:*` (Fase 11): validadores estritos e manipuladores. O renderer NUNCA envia caminho de áudio, `cwd` nem executável livre: o executável do comando local é REVALIDADO no serviço
// (caminho absoluto, `{wav}`, sem controle) e o Pane de destino é indicado por `sessao_id` e conferido no main. `voz:segredo_gravar` é sensível: o log do registro nunca imprime o payload.
import { LIMITES_VOZ, NOMES_SEGREDO_VOZ } from "../../compartilhado/captura";
import type { NomeInvoke } from "../../compartilhado/ipc";
import { vIdSessao } from "../../nucleo/terminais/ipc-validadores";
import { ErroVozIpc, type ServicoVoz } from "../voz";
import { VALIDADORES_VOZ_MODELOS } from "../voz-modelos-ipc";
import { vOuNulo } from "./comum-dominio";
import type { RegistroIpc } from "./registro";
import { vBooleano, vEnum, vInteiro, vLista, vObjeto, vTexto, vVazio, type Resultado, type Validador } from "./validar";
import type { ValidadoresDaFamilia } from "./validar-harness";

const falha = (erro: string): Resultado<never> => ({ ok: false, erro });
// eslint-disable-next-line no-control-regex
const SEM_CONTROLE = /^[^\u0000-\u001f\u007f]*$/;

const vDisparo = vEnum(["segurar", "alternar"] as const);
const vServico = vEnum(["voz_stt"] as const);
const vNomeSegredo = vEnum(NOMES_SEGREDO_VOZ);
const vHost = vTexto({ min: 1, max: 260, padrao: /^[A-Za-z0-9.:-]+$/ });
const vTermo = vTexto({ min: 1, max: 64, padrao: SEM_CONTROLE });
const vDica = vOuNulo(vTexto({ min: 0, max: 64, padrao: SEM_CONTROLE }));
/** PCM16 LE: tamanho par, até 64 KiB; a sequência é monotônica (conferida pelo acumulador). */
const vDados: Validador<Uint8Array> = (v) => {
  if (!(v instanceof Uint8Array)) return falha("esperado bytes");
  if (v.byteLength === 0 || v.byteLength > LIMITES_VOZ.bloco_max_bytes || v.byteLength % 2 !== 0) return falha("bloco de áudio inválido");
  return { ok: true, valor: new Uint8Array(v.buffer, v.byteOffset, v.byteLength) };
};

const CHAVES_CONFIG = ["motor", "comando_executavel", "comando_args", "url", "modelo", "modelo_local", "ociosidade_s", "idioma", "disparo", "atalho", "alternar_global", "aviso_microfone_visto"];
type PatchVoz = import("../../compartilhado/ipc").CanaisInvoke["voz:config_gravar"]["entrada"]["patch"];
const vPatch: Validador<PatchVoz> = (v) => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return falha("esperado objeto");
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!CHAVES_CONFIG.includes(k)) return falha(`campo desconhecido: ${k}`);
  const out: Record<string, unknown> = {};
  const poe = <T>(chave: string, val: Validador<T>): Resultado<never> | null => {
    if (!(chave in o) || o[chave] === undefined) return null;
    const r = val(o[chave]);
    if (!r.ok) return falha(`${chave}: ${r.erro}`);
    out[chave] = r.valor;
    return null;
  };
  const verificacoes = [
    poe("motor", vEnum(["nenhum", "local_embutido", "comando_local", "http_compativel"] as const)),
    poe("comando_executavel", vOuNulo(vTexto({ min: 1, max: 1_024, padrao: SEM_CONTROLE }))),
    poe("comando_args", vLista(vTexto({ min: 0, max: 512, padrao: SEM_CONTROLE }), 32)),
    poe("url", vOuNulo(vTexto({ min: 1, max: 2_048, padrao: SEM_CONTROLE }))),
    poe("modelo", vOuNulo(vTexto({ min: 1, max: 80, padrao: SEM_CONTROLE }))),
    poe("modelo_local", vOuNulo(vTexto({ min: 1, max: 64, padrao: /^[a-z0-9][a-z0-9.-]{0,63}$/ }))),
    poe("ociosidade_s", vInteiro({ min: 15, max: 3_600 })),
    poe("idioma", vEnum(["pt", "en"] as const)),
    poe("disparo", vDisparo),
    poe("atalho", vTexto({ min: 1, max: 80, padrao: /^[A-Za-z0-9+]+$/ })),
    poe("alternar_global", vBooleano),
    poe("aviso_microfone_visto", vBooleano),
  ];
  for (const r of verificacoes) if (r !== null) return r;
  return { ok: true, valor: out as PatchVoz };
};

export const VALIDADORES_VOZ = {
  "voz:estado": vVazio,
  "voz:config_gravar": vObjeto({ patch: vPatch }),
  "voz:segredo_gravar": vObjeto({ nome: vNomeSegredo, valor: vOuNulo(vTexto({ min: 1, max: 4_096 })) }),
  "voz:consentir": vObjeto({ servico: vServico, host: vHost, aceitar: vBooleano }),
  "voz:testar_motor": vVazio,
  "voz:pedir_microfone": vVazio,
  "voz:abrir_ajustes": vObjeto({ painel: vEnum(["microfone", "tela"] as const) }),
  "voz:iniciar": vObjeto({ sessao_id: vIdSessao, disparo: vDisparo }),
  "voz:parar": vVazio,
  "voz:cancelar": vVazio,
  "voz:dicionario_listar": vVazio,
  "voz:dicionario_salvar": vObjeto({ termo: vTermo, dica: vDica }),
  "voz:dicionario_remover": vObjeto({ termo: vTermo }),
  "voz:historico_listar": vVazio,
  "voz:historico_limpar": vVazio,
  ...VALIDADORES_VOZ_MODELOS,
} satisfies ValidadoresDaFamilia<"voz:">;

export const VALIDADOR_VOZ_AUDIO = vObjeto({ sequencia: vInteiro({ min: 0, max: 10_000_000 }), dados: vDados });

export type CanalVoz = keyof typeof VALIDADORES_VOZ;

export interface DependenciasIpcVoz {
  registro: RegistroIpc;
  servico: () => ServicoVoz | Promise<ServicoVoz>;
  aviso?: (mensagem: string) => void;
}

export function registrarIpcVoz(d: DependenciasIpcVoz): void {
  const { registro } = d;
  const V = VALIDADORES_VOZ;
  type P = Record<string, unknown>;
  const R = (canal: CanalVoz, fn: (p: P, s: ServicoVoz) => unknown): void => {
    registro.invoke(canal as NomeInvoke, V[canal] as never, (async (p: never) => {
      try {
        return await fn((p ?? {}) as P, await d.servico());
      } catch (e) {
        if (e instanceof ErroVozIpc) throw e;
        d.aviso?.(`voz: ${e instanceof Error ? e.constructor.name : "erro"}`); // nunca a mensagem: pode citar fala ou segredo
        throw new Error("[indisponivel] Falha interna na voz.");
      }
    }) as never);
  };
  R("voz:estado", (_p, s) => s.estado());
  R("voz:config_gravar", (p, s) => s.configGravar(p["patch"] as never));
  R("voz:segredo_gravar", (p, s) => s.segredoGravar(p["nome"] as never, p["valor"] as string | null));
  R("voz:consentir", (p, s) => s.consentir(p["servico"] as never, p["host"] as string, p["aceitar"] as boolean));
  R("voz:testar_motor", (_p, s) => s.testarMotor());
  R("voz:pedir_microfone", (_p, s) => s.pedirMicrofone());
  R("voz:abrir_ajustes", (p, s) => s.abrirAjustes(p["painel"] as never));
  R("voz:iniciar", (p, s) => s.iniciar(p["sessao_id"] as string, p["disparo"] as never));
  R("voz:parar", (_p, s) => s.parar());
  R("voz:cancelar", (_p, s) => s.cancelar());
  R("voz:dicionario_listar", (_p, s) => s.dicionarioListar());
  R("voz:dicionario_salvar", (p, s) => s.dicionarioSalvar(p["termo"] as string, p["dica"] as string | null));
  R("voz:dicionario_remover", (p, s) => s.dicionarioRemover(p["termo"] as string));
  R("voz:historico_listar", (_p, s) => s.historicoListar());
  R("voz:historico_limpar", (_p, s) => s.historicoLimpar());
  // envio sem resposta: o áudio só é aceito do remetente autorizado (frame principal da janela) e só vale durante a fala
  registro.envio("voz:audio", VALIDADOR_VOZ_AUDIO as never, ((p: { sequencia: number; dados: Uint8Array }) => {
    void Promise.resolve(d.servico()).then((s) => s.audio(p.sequencia, p.dados)).catch(() => undefined);
  }) as never);
}

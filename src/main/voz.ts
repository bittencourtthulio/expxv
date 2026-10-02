// ServicoVoz (Fase 11, T-11.10): ditado no terminal. Criado no PRIMEIRO uso (nada no boot, P-48). Fluxo: o renderer abre o microfone SÓ enquanto se fala e manda PCM16 em blocos; o main acumula em
// memória, monta o WAV, chama o motor (comando local OU HTTP com consentimento), pós-processa, SANITIZA e escreve no PTY do Pane de destino SEM Enter. Áudio nunca vai a disco (exceto o WAV
// temporário 0700 do motor local, apagado em `finally`). Texto de fala nunca vai a log: só contagens e códigos. Sem motor configurado o ditado simplesmente não existe (nada baixa, nada conecta).
import { randomBytes } from "node:crypto";
import {
  LIMITES_VOZ,
  NOMES_SEGREDO_VOZ,
  VERSAO_CONSENTIMENTO_VOZ,
  type CodigoErroVoz,
  type ConfigVoz,
  type DisparoVoz,
  type EntradaHistoricoVoz,
  type EstadoDitado,
  type EstadoPermissao,
  type EstadoVoz,
  type EventoVozIpc,
  type NomeSegredoVoz,
  type ServicoConsentimento,
  type TermoVoz,
} from "../compartilhado/captura";
import { LIMITES_MODELO } from "../compartilhado/voz-local";
import { criarConsentimentos, validarUrlDeServico, type Consentimentos, type RegistroConsentimento } from "../nucleo/privacidade/consentimento";
import { mensagemSegura, redigirSegredos } from "../nucleo/privacidade/redacao";
import { criarMotorComandoLocal, validarComando } from "../nucleo/voz/motores/comando-local";
import { ErroMotor, type MotorStt, type OpcoesTranscricao } from "../nucleo/voz/motores/motor";
import { criarMaquinaDitado, type AcaoDitado, type EventoDitado } from "../nucleo/voz/maquina";
import { contarPalavras, prepararTextoDitado, promptDoMotor } from "../nucleo/voz/pos-processo";
import { validarAtalho, type TeclaGlobal } from "../nucleo/voz/teclas";
import { criarAcumulador, montarWav, type Acumulador } from "../nucleo/voz/wav";
import type { Permissoes } from "./permissoes";

export interface PreferenciasVoz {
  obter(chave: string): unknown;
  definir(chave: string, valor: unknown): Promise<void>;
}

/** Segredos da voz no cofre do SO. O valor nunca volta ao renderer. */
export interface PortaSegredosVoz {
  disponivel(): Promise<boolean>;
  guardar(nome: NomeSegredoVoz, valor: string): Promise<void>;
  existe(nome: NomeSegredoVoz): Promise<boolean>;
  obter(nome: NomeSegredoVoz): Promise<string | null>;
  apagar(nome: NomeSegredoVoz): Promise<void>;
}

export interface FabricaMotor {
  comandoLocal(executavel: string, args: readonly string[]): MotorStt;
  /** `chave` é lida do cofre só no instante do envio. */
  http(url: string, chave: () => Promise<string | null>, consentido: (host: string) => boolean): MotorStt;
}

/** Voz local embutida (D-540): o serviço de voz só enxerga estas quatro operações; o catálogo, o download e o runtime ficam em `voz-modelos.ts`. */
export interface PortaLocalVoz {
  /** o modelo existe no catálogo? (validação da gravação da configuração) */
  existeNoCatalogo(modeloId: string): boolean;
  /** modelo instalado e ÍNTEGRO (verificação rápida) e runtime disponível nesta máquina? */
  pronto(modeloId: string | null): Promise<boolean>;
  /** motor de transcrição do modelo ativo (verifica a integridade antes de cada carga). */
  motor(modeloId: string): MotorStt;
  /** carrega o modelo em segundo plano ao iniciar o ditado (erros ficam para a transcrição reportar). */
  preaquecer(modeloId: string, idioma: ConfigVoz["idioma"]): void;
  encerrar(): void;
}

export interface DependenciasVoz {
  permissoes: Permissoes;
  prefs: PreferenciasVoz;
  segredos: PortaSegredosVoz;
  motores: FabricaMotor;
  /** o Pane existe nesta janela? (o `sessao_id` do renderer é só a indicação) */
  sessaoExiste: (sessaoId: string) => boolean;
  /** escreve no PTY SEM Enter; `false` se a sessão não existe mais. */
  escrever: (sessaoId: string, texto: string) => boolean;
  emitir: (e: EventoVozIpc) => void;
  teclas?: TeclaGlobal;
  trazerJanela?: () => void;
  agora?: () => number;
  agendar?: (fn: () => void, ms: number) => () => void;
  aviso?: (mensagem: string) => void;
  /** testes injetam um motor pronto no lugar da fábrica. */
  motorPronto?: () => MotorStt | null;
  /** voz local embutida; sem isto o motor `local_embutido` simplesmente não está pronto. */
  local?: PortaLocalVoz;
}

export interface ServicoVoz {
  estado(): Promise<EstadoVoz>;
  configGravar(patch: Partial<ConfigVoz> & { aviso_microfone_visto?: boolean }): Promise<EstadoVoz>;
  segredoGravar(nome: NomeSegredoVoz, valor: string | null): Promise<{ ok: true }>;
  consentir(servico: ServicoConsentimento, host: string, aceitar: boolean): Promise<{ ok: true }>;
  testarMotor(): Promise<{ ok: boolean; latencia_ms: number | null; erro: CodigoErroVoz | null }>;
  pedirMicrofone(): Promise<{ estado: EstadoPermissao }>;
  abrirAjustes(painel: "microfone" | "tela"): Promise<boolean>;
  iniciar(sessaoId: string, disparo: DisparoVoz): Promise<{ ok: boolean; codigo: CodigoErroVoz | null }>;
  parar(): Promise<{ ok: boolean }>;
  cancelar(): Promise<{ ok: boolean }>;
  audio(sequencia: number, dados: Uint8Array): void;
  dicionarioListar(): TermoVoz[];
  dicionarioSalvar(termo: string, dica: string | null): Promise<TermoVoz[]>;
  dicionarioRemover(termo: string): Promise<TermoVoz[]>;
  historicoListar(): EntradaHistoricoVoz[];
  historicoLimpar(): { ok: true };
  /** ditado em andamento? (usado pelo teste de vazamento e pelo encerramento) */
  ditado(): EstadoDitado;
  encerrar(): Promise<void>;
}

export class ErroVozIpc extends Error {
  constructor(readonly codigo: string, mensagem: string) {
    super(`[${codigo}] ${mensagem}`);
    this.name = "ErroVozIpc";
  }
}

const K = {
  motor: "voz_motor", modeloLocal: "voz_modelo_local", ociosidade: "voz_local_ociosidade_s", exe: "voz_comando_executavel", args: "voz_comando_args", url: "voz_url", modelo: "voz_modelo", idioma: "voz_idioma", disparo: "voz_disparo",
  atalho: "voz_atalho", global: "voz_alternar_global", aviso: "voz_aviso_microfone_visto", dicionario: "voz_dicionario", consentimentos: "voz_consentimentos",
} as const;

/** segundos de ociosidade até descarregar o modelo local (15 s a 1 h; padrão 2 min). */
export const ociosidadeDe = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(LIMITES_MODELO.ociosidade_max_s, Math.max(LIMITES_MODELO.ociosidade_min_s, Math.round(v))) : LIMITES_MODELO.ociosidade_padrao_s;

const SEGREDO_COFRE: Record<NomeSegredoVoz, string> = { voz_chave_stt: "VOZ_CHAVE_STT" };
export const NOME_COFRE_DE: Readonly<Record<NomeSegredoVoz, string>> = SEGREDO_COFRE;

const ATALHO_PADRAO = { mac: "Command+Shift+Space", windows: "Control+Shift+Space", linux: "Control+Shift+Space" } as const;
const CONTROLE = /[\u0000-\u001f\u007f]/;

function lerRegistros(v: unknown): RegistroConsentimento[] {
  if (!Array.isArray(v)) return [];
  const saida: RegistroConsentimento[] = [];
  for (const x of v) {
    if (typeof x !== "object" || x === null) continue;
    const o = x as Record<string, unknown>;
    if (typeof o["servico"] === "string" && typeof o["host"] === "string" && typeof o["concedido_em"] === "string" && typeof o["versao_texto"] === "string" && (o["revogado_em"] === null || typeof o["revogado_em"] === "string")) {
      saida.push({ servico: o["servico"], host: o["host"], concedido_em: o["concedido_em"], versao_texto: o["versao_texto"], revogado_em: o["revogado_em"] });
    }
  }
  return saida;
}

export function criarServicoVoz(d: DependenciasVoz): ServicoVoz {
  const agora = d.agora ?? ((): number => Date.now());
  const agendar = d.agendar ?? ((fn: () => void, ms: number): (() => void) => { const t = setTimeout(fn, ms); t.unref?.(); return () => clearTimeout(t); });
  const plataforma = d.permissoes.plataforma;
  const maquina = criarMaquinaDitado(agora);
  const consentimentos: Consentimentos = criarConsentimentos({
    armazenamento: { ler: () => lerRegistros(d.prefs.obter(K.consentimentos)), gravar: (r) => d.prefs.definir(K.consentimentos, r) },
    versao_texto: VERSAO_CONSENTIMENTO_VOZ,
  });

  let acumulador: Acumulador | null = null;
  let destino: string | null = null;
  let sinal: AbortController | null = null;
  let sequenciaEstado = 0;
  let cancelarErro: (() => void) | null = null;
  let historico: EntradaHistoricoVoz[] = [];
  let atalhoErro: string | null = null;

  // ---------------------------------------------------------------- configuração
  const cfg = (): ConfigVoz => {
    const motor = d.prefs.obter(K.motor);
    const args = d.prefs.obter(K.args);
    return {
      motor: motor === "comando_local" || motor === "http_compativel" || motor === "local_embutido" ? motor : "nenhum",
      comando_executavel: typeof d.prefs.obter(K.exe) === "string" ? (d.prefs.obter(K.exe) as string) : null,
      comando_args: Array.isArray(args) ? args.filter((a): a is string => typeof a === "string") : [],
      url: typeof d.prefs.obter(K.url) === "string" ? (d.prefs.obter(K.url) as string) : null,
      modelo: typeof d.prefs.obter(K.modelo) === "string" ? (d.prefs.obter(K.modelo) as string) : null,
      modelo_local: typeof d.prefs.obter(K.modeloLocal) === "string" ? (d.prefs.obter(K.modeloLocal) as string) : null,
      ociosidade_s: ociosidadeDe(d.prefs.obter(K.ociosidade)),
      idioma: d.prefs.obter(K.idioma) === "en" ? "en" : "pt",
      disparo: d.prefs.obter(K.disparo) === "alternar" ? "alternar" : "segurar",
      atalho: typeof d.prefs.obter(K.atalho) === "string" ? (d.prefs.obter(K.atalho) as string) : ATALHO_PADRAO[plataforma],
      alternar_global: d.prefs.obter(K.global) === true,
    };
  };

  const hostDaConfig = (c: ConfigVoz): string | null => {
    if (c.motor !== "http_compativel" || c.url === null) return null;
    const u = validarUrlDeServico(c.url);
    return u.ok ? u.host : null;
  };

  const motorProntoDe = async (c: ConfigVoz): Promise<boolean> => {
    if (d.motorPronto !== undefined) return d.motorPronto() !== null;
    if (c.motor === "local_embutido") return d.local !== undefined && c.modelo_local !== null && (await d.local.pronto(c.modelo_local));
    if (c.motor === "comando_local") return c.comando_executavel !== null && validarComando(c.comando_executavel, c.comando_args).ok;
    if (c.motor === "http_compativel") return c.url !== null && validarUrlDeServico(c.url).ok;
    return false;
  };

  const consentimentoDe = (c: ConfigVoz): boolean => {
    if (c.motor !== "http_compativel") return true; // nada sai da máquina (local embutido e comando local)
    const h = hostDaConfig(c);
    return h !== null && consentimentos.vigente("voz_stt", h);
  };

  function criarMotor(c: ConfigVoz): MotorStt | null {
    if (d.motorPronto !== undefined) return d.motorPronto();
    if (c.motor === "local_embutido" && c.modelo_local !== null && d.local !== undefined) return d.local.motor(c.modelo_local);
    if (c.motor === "comando_local" && c.comando_executavel !== null) return d.motores.comandoLocal(c.comando_executavel, c.comando_args);
    if (c.motor === "http_compativel" && c.url !== null) {
      return d.motores.http(c.url, () => d.segredos.obter("voz_chave_stt"), (host) => consentimentos.vigente("voz_stt", host));
    }
    return null;
  }

  function ligarTecla(): void {
    const t = d.teclas;
    if (t === undefined) return;
    t.liberarTodas();
    atalhoErro = null;
    const c = cfg();
    if (!c.alternar_global) return;
    const v = validarAtalho(c.atalho, { plataforma });
    if (!v.ok) { atalhoErro = v.motivo; return; }
    if (!t.registrar(v.acelerador, () => { d.trazerJanela?.(); d.emitir({ tipo: "atalho", acao: "alternar" }); })) {
      atalhoErro = `O atalho ${v.acelerador} já está em uso por outro programa.`;
    }
  }

  // ---------------------------------------------------------------- máquina
  const avisarEstado = (): void => d.emitir({ tipo: "estado", sequencia: ++sequenciaEstado, ditado: maquina.estado });

  function transitar(e: EventoDitado): AcaoDitado {
    const antes = maquina.estado;
    const r = maquina.transitar(e);
    if (r.estado !== antes) avisarEstado();
    return r.acao;
  }

  function zerarFala(): void {
    acumulador?.zerar();
    acumulador = null;
    destino = null;
    sinal?.abort();
    sinal = null;
  }

  function falhar(codigo: CodigoErroVoz, estagio: EstadoDitado): void {
    zerarFala();
    cancelarErro?.();
    if (transitar({ tipo: "falha", codigo }) === "mostrar_erro") d.emitir({ tipo: "erro", codigo, estagio });
    cancelarErro = agendar(() => { cancelarErro = null; transitar({ tipo: "tempo" }); }, 3_000);
  }

  function guardarHistorico(texto: string, injetada: boolean, codigo: CodigoErroVoz | null, duracao: number): void {
    // histórico SÓ em memória (D-66): nunca em disco, nunca em log; vale só na sessão do app
    historico = [{ id: `fala_${randomBytes(6).toString("hex")}`, criado_em: new Date(agora()).toISOString(), texto: redigirSegredos(texto), injetada, codigo, duracao_ms: duracao }, ...historico].slice(0, LIMITES_VOZ.historico_memoria);
  }

  async function finalizarFala(): Promise<void> {
    const acc = acumulador;
    const alvo = destino;
    const sig = sinal;
    if (acc === null || alvo === null || sig === null) return;
    const c = cfg();
    const cortada = acc.cortada;
    const fim = acc.finalizar();
    acumulador = null;
    if (cortada) d.emitir({ tipo: "aviso", codigo: "fala_cortada" });
    if (!fim.ok) { falhar(fim.motivo, "transcrevendo"); return; }
    const motor = criarMotor(c);
    if (motor === null) { falhar("motor_ausente", "transcrevendo"); return; }
    let bruto: string;
    try {
      const op: OpcoesTranscricao = { idioma: c.idioma, modelo: c.modelo, prompt: promptDoMotor(dicionario()), sinal: sig.signal };
      bruto = await motor.transcrever(fim.wav, op);
    } catch (e) {
      fim.wav.fill(0);
      if (sig.signal.aborted || maquina.estado !== "transcrevendo") return; // cancelado: nada é injetado
      const codigo = e instanceof ErroMotor ? e.codigo : "motor_falhou";
      if (!(e instanceof ErroMotor)) d.aviso?.(`voz: ${mensagemSegura(e)}`);
      falhar(codigo, "transcrevendo");
      return;
    }
    fim.wav.fill(0);
    if (sig.signal.aborted || maquina.estado !== "transcrevendo") return;
    const texto = prepararTextoDitado(bruto, dicionario());
    if (texto === "") { falhar("fala_vazia", "transcrevendo"); return; }
    if (transitar({ tipo: "transcrito" }) !== "injetar") return;
    const palavras = contarPalavras(texto);
    const faladoPorMs = fim.duracao_ms;
    if (!d.sessaoExiste(alvo)) {
      guardarHistorico(texto, false, "cancelado", faladoPorMs); // o Pane fechou no meio: a fala fica no histórico (copiável), nunca no clipboard sozinho
      d.emitir({ tipo: "texto", fala_id: historico[0]?.id ?? "", injetada: false, palavras, codigo: "cancelado" });
      zerarFala();
      transitar({ tipo: "cancelar" });
      return;
    }
    const escrito = d.escrever(alvo, `${texto} `);
    guardarHistorico(texto, escrito, escrito ? null : "sem_terminal_em_foco", faladoPorMs);
    d.emitir({ tipo: "texto", fala_id: historico[0]?.id ?? "", injetada: escrito, palavras, codigo: escrito ? null : "sem_terminal_em_foco" });
    zerarFala();
    transitar({ tipo: "injetado" });
  }

  // ---------------------------------------------------------------- dicionário
  const dicionario = (): TermoVoz[] => {
    const v = d.prefs.obter(K.dicionario);
    if (!Array.isArray(v)) return [];
    return v.flatMap((x) => (typeof x === "object" && x !== null && typeof (x as TermoVoz).termo === "string" ? [{ termo: (x as TermoVoz).termo, dica: typeof (x as TermoVoz).dica === "string" ? (x as TermoVoz).dica : null }] : []));
  };

  async function estado(): Promise<EstadoVoz> {
    const c = cfg();
    return {
      ...c,
      motor_pronto: await motorProntoDe(c),
      consentimento: consentimentoDe(c),
      host: hostDaConfig(c),
      // só consulta o cofre quando o motor remoto está em uso (abrir a configuração não deve acordar o chaveiro do SO)
      tem_chave: c.motor === "http_compativel" ? await d.segredos.existe("voz_chave_stt").catch(() => false) : false,
      microfone: d.permissoes.microfone(),
      ditado: maquina.estado,
      aviso_microfone_visto: d.prefs.obter(K.aviso) === true,
      plataforma,
      atalho_erro: atalhoErro,
    };
  }

  const svc: ServicoVoz = {
    estado,
    ditado: () => maquina.estado,

    async configGravar(patch) {
      if (patch.motor !== undefined) {
        if (!["nenhum", "local_embutido", "comando_local", "http_compativel"].includes(patch.motor)) throw new ErroVozIpc("invalido", "Motor desconhecido.");
        await d.prefs.definir(K.motor, patch.motor);
      }
      const exe = patch.comando_executavel !== undefined ? patch.comando_executavel : cfg().comando_executavel;
      const args = patch.comando_args !== undefined ? patch.comando_args : cfg().comando_args;
      if (patch.comando_executavel !== undefined || patch.comando_args !== undefined) {
        if (exe !== null) {
          const v = validarComando(exe, args);
          if (!v.ok) throw new ErroVozIpc("invalido", v.motivo);
        }
        await d.prefs.definir(K.exe, exe);
        await d.prefs.definir(K.args, args);
      }
      if (patch.url !== undefined) {
        if (patch.url !== null) {
          const u = validarUrlDeServico(patch.url);
          if (!u.ok) throw new ErroVozIpc("invalido", u.motivo);
        }
        await d.prefs.definir(K.url, patch.url); // trocar a URL para outro host invalida o consentimento (ele é por host)
      }
      if (patch.modelo !== undefined) {
        if (patch.modelo !== null && (patch.modelo.length > 80 || CONTROLE.test(patch.modelo))) throw new ErroVozIpc("invalido", "Nome de modelo inválido.");
        await d.prefs.definir(K.modelo, patch.modelo);
      }
      if (patch.modelo_local !== undefined) {
        if (patch.modelo_local !== null && !(d.local?.existeNoCatalogo(patch.modelo_local) ?? false)) throw new ErroVozIpc("invalido", "Modelo de voz desconhecido.");
        await d.prefs.definir(K.modeloLocal, patch.modelo_local);
      }
      if (patch.ociosidade_s !== undefined) {
        if (!Number.isFinite(patch.ociosidade_s) || patch.ociosidade_s < LIMITES_MODELO.ociosidade_min_s || patch.ociosidade_s > LIMITES_MODELO.ociosidade_max_s) throw new ErroVozIpc("invalido", `A ociosidade vai de ${LIMITES_MODELO.ociosidade_min_s} s a ${LIMITES_MODELO.ociosidade_max_s} s.`);
        await d.prefs.definir(K.ociosidade, Math.round(patch.ociosidade_s));
      }
      if (patch.idioma !== undefined) await d.prefs.definir(K.idioma, patch.idioma === "en" ? "en" : "pt");
      if (patch.disparo !== undefined) await d.prefs.definir(K.disparo, patch.disparo === "alternar" ? "alternar" : "segurar");
      if (patch.atalho !== undefined) {
        const v = validarAtalho(patch.atalho, { plataforma });
        if (!v.ok) throw new ErroVozIpc("invalido", v.motivo);
        await d.prefs.definir(K.atalho, v.acelerador);
      }
      if (patch.alternar_global !== undefined) await d.prefs.definir(K.global, patch.alternar_global === true);
      if (patch.aviso_microfone_visto !== undefined) await d.prefs.definir(K.aviso, patch.aviso_microfone_visto === true);
      if (patch.atalho !== undefined || patch.alternar_global !== undefined) ligarTecla();
      return estado();
    },

    async segredoGravar(nome, valor) {
      if (!(NOMES_SEGREDO_VOZ as readonly string[]).includes(nome)) throw new ErroVozIpc("invalido", "Nome de segredo desconhecido.");
      if (valor === null) { await d.segredos.apagar(nome); return { ok: true }; }
      if (valor.length === 0 || valor.length > 4_096 || CONTROLE.test(valor)) throw new ErroVozIpc("invalido", "Valor de chave inválido.");
      if (!(await d.segredos.disponivel())) throw new ErroVozIpc("cofre_indisponivel", "O cofre do sistema não está disponível: a chave NÃO foi gravada e o serviço remoto fica desligado.");
      await d.segredos.guardar(nome, valor);
      return { ok: true };
    },

    async consentir(servico, host, aceitar) {
      if (servico !== "voz_stt") throw new ErroVozIpc("invalido", "Serviço desconhecido.");
      const atual = hostDaConfig(cfg());
      if (atual === null || host.toLowerCase() !== atual) throw new ErroVozIpc("invalido", "O consentimento vale só para o host configurado agora.");
      if (aceitar) await consentimentos.conceder(servico, atual); else await consentimentos.revogar(servico, atual);
      return { ok: true };
    },

    async testarMotor() {
      const c = cfg();
      if (c.motor === "nenhum") return { ok: false, latencia_ms: null, erro: "motor_ausente" };
      if (!consentimentoDe(c)) return { ok: false, latencia_ms: null, erro: "consentimento_ausente" };
      const motor = criarMotor(c);
      if (motor === null) return { ok: false, latencia_ms: null, erro: "motor_ausente" };
      const wav = montarWav(new Uint8Array(LIMITES_VOZ.taxa_hz * 2)); // 1 s de silêncio: não carrega fala nenhuma
      const t0 = agora();
      try {
        await motor.transcrever(wav, { idioma: c.idioma, modelo: c.modelo, prompt: "" });
        return { ok: true, latencia_ms: agora() - t0, erro: null };
      } catch (e) {
        return { ok: false, latencia_ms: null, erro: e instanceof ErroMotor ? e.codigo : "motor_falhou" };
      }
    },

    async pedirMicrofone() {
      return { estado: await d.permissoes.pedirMicrofone() };
    },
    abrirAjustes: (painel) => d.permissoes.abrirAjustes(painel),

    async iniciar(sessaoId, disparo) {
      const c = cfg();
      if (c.motor === "nenhum") return { ok: false, codigo: "motor_ausente" };
      if (!(await motorProntoDe(c))) return { ok: false, codigo: c.motor === "local_embutido" ? "modelo_ausente" : "motor_ausente" };
      if (!consentimentoDe(c)) return { ok: false, codigo: "consentimento_ausente" };
      const mic = d.permissoes.microfone();
      if (mic === "negada" || mic === "restrita") return { ok: false, codigo: "microfone_negado" };
      if (!d.sessaoExiste(sessaoId)) return { ok: false, codigo: "sem_terminal_em_foco" };
      cancelarErro?.();
      cancelarErro = null;
      if (transitar({ tipo: "iniciar", disparo }) !== "abrir_microfone") return { ok: false, codigo: "ocupado" };
      acumulador = criarAcumulador();
      destino = sessaoId;
      sinal = new AbortController();
      if (c.motor === "local_embutido" && c.modelo_local !== null) d.local?.preaquecer(c.modelo_local, c.idioma); // o modelo carrega enquanto a pessoa fala
      return { ok: true, codigo: null };
    },

    async parar() {
      if (maquina.estado !== "gravando") return { ok: false };
      if (transitar({ tipo: "parar" }) !== "finalizar_fala") return { ok: false };
      await finalizarFala();
      return { ok: true };
    },

    async cancelar() {
      if (maquina.estado === "ocioso") return { ok: true };
      zerarFala();
      transitar({ tipo: "cancelar" });
      cancelarErro?.();
      cancelarErro = null;
      return { ok: true };
    },

    audio(sequencia, dados) {
      if (maquina.estado !== "gravando" || acumulador === null) return; // fora da fala nada é guardado
      acumulador.adicionar(sequencia, dados);
      if (acumulador.cortada) void svc.parar(); // 120 s: encerra e avisa (a fala até aqui ainda é transcrita)
    },

    dicionarioListar: dicionario,
    async dicionarioSalvar(termo, dica) {
      const t = termo.trim();
      if (t === "" || t.length > 64 || CONTROLE.test(t)) throw new ErroVozIpc("invalido", "Termo inválido (1 a 64 caracteres, sem controle).");
      if (dica !== null && (dica.length > 64 || CONTROLE.test(dica))) throw new ErroVozIpc("invalido", "Dica inválida.");
      const lista = dicionario().filter((x) => x.termo.toLowerCase() !== t.toLowerCase());
      if (lista.length >= LIMITES_VOZ.termos_max) throw new ErroVozIpc("limite", `O dicionário aceita até ${LIMITES_VOZ.termos_max} termos.`);
      lista.push({ termo: t, dica: dica === null || dica.trim() === "" ? null : dica.trim() });
      await d.prefs.definir(K.dicionario, lista);
      return lista;
    },
    async dicionarioRemover(termo) {
      const lista = dicionario().filter((x) => x.termo.toLowerCase() !== termo.trim().toLowerCase());
      await d.prefs.definir(K.dicionario, lista);
      return lista;
    },

    historicoListar: () => historico.map((h) => ({ ...h })),
    historicoLimpar() {
      historico = [];
      return { ok: true };
    },

    async encerrar() {
      cancelarErro?.();
      cancelarErro = null;
      zerarFala();
      if (maquina.estado !== "ocioso") transitar({ tipo: "cancelar" });
      historico = []; // o histórico em memória não sobrevive ao app
      d.teclas?.liberarTodas();
      d.local?.encerrar(); // o processo de reconhecimento não sobrevive ao app
    },
  };
  return svc;
}

/** Fábrica padrão de motores (comando local real; HTTP exige a camada de rede, injetada pelo main). */
export function criarFabricaMotores(http: FabricaMotor["http"]): FabricaMotor {
  return { comandoLocal: (executavel, args) => criarMotorComandoLocal({ executavel, args }), http };
}

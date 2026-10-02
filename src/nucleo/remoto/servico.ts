// Serviço do controle remoto (T-13.15/16): liga/desliga o servidor SOB DEMANDA (nada no boot; nunca religa sozinho), pareamento com SAS no desktop, sessões cifradas por
// dispositivo, permissões graduadas, kill-switch/pânico e auditoria. Os comandos do dispositivo viram chamadas ao serviço do Jarvis com `ator = remoto`: a MESMA matriz,
// política e confirmação (no DESKTOP, nunca no próprio celular). Reusa o modelo do Telegram (pareamento de uso único, janela com tentativas, auditoria sem segredo, pânico).
import {
  CONFIG_REMOTO_PADRAO,
  PERMISSOES_REMOTAS,
  TEXTO_CONSENTIMENTO_REMOTO_VERSAO,
  type ConfigRemoto,
  type DispositivoVisao,
  type EntradaAuditoriaJarvis,
  type ErroLigarRemoto,
  type EstadoRemoto,
  type PedidoPendenteVisao,
  type PermissaoRemota,
  type TransporteRemoto,
} from "../../compartilhado/jarvis";
import type { AuditoriaJarvis } from "../jarvis/auditoria";
import type { ServicoJarvis } from "../jarvis/servico";
import { gerarCertificadoAutoassinado } from "./certificado";
import { CONFIRMACAO_DIRETA, type ArmazemDispositivos, type Dispositivo } from "./dispositivos";
import type { IdentidadeServidor } from "./identidade";
import { LIMITES, criarLimiteJanela, ipDeBindPermitido, ipPrivado } from "./politica-rede";
import { criarPareamentoServidor, iniciarSessaoServidor, type Canal, type PareamentoServidor, type RelogioRemoto } from "./protocolo";
import { criarManipulador, iniciarServidor, type RespostaRota, type RotasRemoto, type ServidorRemoto } from "./servidor";
import { criarTratador, tratarMensagem, type Tratador } from "./tratador";

export interface InterfaceRede {
  nome: string;
  ip: string;
}
export interface DepsServicoRemoto {
  relogio: RelogioRemoto;
  jarvis: ServicoJarvis;
  dispositivos: ArmazemDispositivos;
  auditoria: AuditoriaJarvis;
  identidade: () => Promise<IdentidadeServidor>;
  config: () => ConfigRemoto;
  gravarConfig: (patch: Partial<ConfigRemoto>) => void;
  interfaces: () => InterfaceRede[];
  telaBloqueada?: () => boolean;
  aoMudar?: (tipo: "mudou" | "sas" | "pedido_pendente") => void;
  /** injetáveis para teste; o padrão é o real. */
  gerarCertificado?: typeof gerarCertificadoAutoassinado;
  iniciar?: typeof iniciarServidor;
  portaAleatoria?: () => number;
}

export interface ServicoRemoto {
  estado(): EstadoRemoto;
  ligar(p: { transporte: TransporteRemoto; interface: string; consentimento_versao: string }): Promise<EstadoRemoto | { erro: ErroLigarRemoto }>;
  desligar(origem?: string): Promise<EstadoRemoto>;
  configGravar(patch: Partial<ConfigRemoto>): EstadoRemoto;
  parearIniciar(permissao: PermissaoRemota): { codigo: string; expira_em: string } | { erro: ErroLigarRemoto };
  parearCancelar(): boolean;
  parearConfirmarSas(p: { igual: boolean; confirmacao_permissao: string | null }): DispositivoVisao | null;
  revogar(id: string): Promise<boolean>;
  permissaoDefinir(p: { dispositivo_id: string; permissao: PermissaoRemota; confirmacao: string | null }): DispositivoVisao | null;
  aprovarPedido(id: string, aprovado: boolean): Promise<boolean>;
  panico(): Promise<EstadoRemoto>;
  auditoria(depois: string | null): { itens: EntradaAuditoriaJarvis[]; proximo: string | null };
  /** ocioso: encerra sessões paradas e desliga o servidor se passou `ocioso_min` sem uso. Chamado por temporizador do main (e pelos testes). */
  varrer(): Promise<void>;
  /** só para teste de contrato e e2e: as rotas diretas, sem rede. */
  _rotas(): RotasRemoto;
  /** Fase 22 (T-22.04): o tratador de protocolo sem transporte; LAN, loopback e relay entregam a mesma requisição a ele. */
  tratador(): Tratador;
  /** Fase 22 (W3): habilita o pareamento/sessão SEM o servidor LAN (carrega a identidade; nada escuta). `false` se a identidade falhar. */
  prepararRelay(): Promise<boolean>;
  liberarRelay(): void;
  /** mensagens extras DENTRO da sessão cifrada, só com origem `relay` (entrega do segredo de canal, «esquecer»). `undefined` = não é comigo. */
  registrarMensagemRelay(f: ((disp: Pick<Dispositivo, "id" | "nome" | "permissao">, msg: unknown) => unknown | Promise<unknown | undefined>) | null): void;
  chaveDoDispositivo(id: string): Buffer | null;
  aoRevogarDispositivo(cb: (id: string) => void): void;
}

interface Sessao {
  sid: string;
  dispositivo_id: string;
  canal: Canal;
  criada: number;
  ultimo: number;
  ip: string;
}

const MAX_SESSOES = 8;
const rand = (min: number, max: number): number => min + Math.floor(Math.random() * (max - min + 1));
const vis = (x: Dispositivo, conectado: boolean): DispositivoVisao => ({
  id: x.id,
  nome: x.nome,
  permissao: x.permissao,
  criado_em: x.criado_em,
  ultimo_uso_em: x.ultimo_uso_em,
  ultimo_ip: x.ultimo_ip,
  expira_em: x.expira_em,
  revogado_em: x.revogado_em,
  conectado,
});

export function criarServicoRemoto(d: DepsServicoRemoto): ServicoRemoto {
  let servidor: ServidorRemoto | null = null;
  let transporte: TransporteRemoto | null = null;
  let ultimoErro: string | null = null;
  let portaAtual: number | null = null;
  let ultimoUsoGeral = d.relogio.agora();
  let permissaoDoPareamento: PermissaoRemota = "leitura";
  let hidPendente: string | null = null;
  let codigoExpiraEm: number | null = null;
  const sessoes = new Map<string, Sessao>();
  const limiteDispositivo = criarLimiteJanela(d.relogio, LIMITES.req_por_min_dispositivo);
  let identidadeCache: IdentidadeServidor | null = null;
  let recusadas = 0;
  let relayAtivo = false;
  let mensagemRelay: Parameters<ServicoRemoto["registrarMensagemRelay"]>[0] = null;

  const aud = (evento: string, o: { dispositivo_id?: string | null; ok?: boolean; codigo?: string | null; resumo?: string | null } = {}): void => {
    d.auditoria.registrar({ ator: "sistema", evento, dispositivo_id: o.dispositivo_id ?? null, ok: o.ok ?? true, codigo: o.codigo ?? null, resumo: o.resumo ?? null });
  };
  const mudou = (): void => d.aoMudar?.("mudou");

  const pareamento: PareamentoServidor = criarPareamentoServidor({
    relogio: d.relogio,
    identidadeSpki: () => (identidadeCache as IdentidadeServidor).publicaSpki(),
    aoErradas: (r) => aud("pareamento_codigo_errado", { ok: false, codigo: "pareamento_invalido", resumo: `restam ${r}` }),
    aoJanelaFechada: (motivo) => {
      codigoExpiraEm = null;
      hidPendente = motivo === "pareado" || motivo === "negado" ? hidPendente : null;
      aud("pareamento_janela_fechada", { ok: motivo === "pareado", codigo: motivo });
      mudou();
    },
    aoPedido: (p) => {
      hidPendente = p.hid;
      aud("pareamento_pedido", { resumo: `dispositivo «${p.nome}»` });
      d.aoMudar?.("sas");
      mudou();
    },
  });

  const derrubarSessoes = (filtro?: (s: Sessao) => boolean): number => {
    let n = 0;
    for (const [sid, s] of sessoes) {
      if (filtro === undefined || filtro(s)) {
        sessoes.delete(sid);
        n++;
      }
    }
    return n;
  };
  const conectado = (id: string): boolean => [...sessoes.values()].some((s) => s.dispositivo_id === id);

  // chamada pelo armazém quando um dispositivo é revogado: derruba o canal NA HORA (P-67) e cancela o que ele deixou pendente
  const aoRevogarDispositivo = (id: string): void => {
    derrubarSessoes((s) => s.dispositivo_id === id);
    void d.jarvis.anularDoDispositivo(id);
    aud("dispositivo_revogado", { dispositivo_id: id });
    mudou();
  };
  d.dispositivos.aoRevogar(aoRevogarDispositivo);

  const NAO_AUTORIZADO: RespostaRota = { status: 401, corpo: { e: "nao_autorizado" } };
  const rotas: RotasRemoto = {
    pareamentoInicio(corpo) {
      const r = pareamento.inicio(corpo);
      return r === null ? { status: 403, corpo: { e: "pareamento_expirado" } } : { status: 200, corpo: r };
    },
    pareamentoFim(corpo) {
      const r = pareamento.fim(corpo);
      return r === null ? { status: 403, corpo: { e: "pareamento_expirado" } } : { status: 200, corpo: r };
    },
    pareamentoStatus(corpo) {
      const hid = typeof corpo === "object" && corpo !== null ? (corpo as Record<string, unknown>)["hid"] : undefined;
      const r = pareamento.status(hid);
      return r === null ? { status: 403, corpo: { e: "pareamento_expirado" } } : { status: 200, corpo: r };
    },
    sessaoInicio(corpo, ctx) {
      ultimoUsoGeral = d.relogio.agora();
      if (identidadeCache === null) return NAO_AUTORIZADO;
      const ident = identidadeCache;
      const r = iniciarSessaoServidor({ relogio: d.relogio, identidade: ident, chaveDoDispositivo: (id) => d.dispositivos.ativo(id)?.chave_publica ?? null }, corpo);
      if (r === null) return NAO_AUTORIZADO;
      if (sessoes.size >= MAX_SESSOES) {
        // a mais antiga do MESMO dispositivo cai primeiro; senão recusa
        const mesma = [...sessoes.values()].find((s) => s.dispositivo_id === r.dispositivo_id);
        if (mesma === undefined) return { status: 429, corpo: { e: "limite_de_taxa" } };
        sessoes.delete(mesma.sid);
      }
      sessoes.set(r.sid, { sid: r.sid, dispositivo_id: r.dispositivo_id, canal: r.canal, criada: d.relogio.agora(), ultimo: d.relogio.agora(), ip: ctx.ip });
      d.dispositivos.tocar(r.dispositivo_id, ctx.ip);
      aud("sessao_iniciada", { dispositivo_id: r.dispositivo_id });
      mudou();
      return { status: 200, corpo: r.resposta };
    },
    async canal(corpo, ctx) {
      ultimoUsoGeral = d.relogio.agora();
      const sid = typeof corpo === "object" && corpo !== null ? (corpo as Record<string, unknown>)["sid"] : undefined;
      const s = typeof sid === "string" ? sessoes.get(sid) : undefined;
      if (s === undefined) return NAO_AUTORIZADO;
      const disp = d.dispositivos.ativo(s.dispositivo_id); // revogado/expirado NUNCA autentica, nem com sessão aberta nem com quadro gravado
      if (disp === null) {
        sessoes.delete(s.sid);
        return { status: 401, corpo: { e: "dispositivo_revogado" } };
      }
      if (!limiteDispositivo.tentar(disp.id)) return { status: 429, corpo: { e: "limite_de_taxa" } };
      const msg = s.canal.abrir((corpo as Record<string, unknown>)["quadro"]);
      if (msg === null) {
        sessoes.delete(s.sid); // quadro repetido/fora de ordem/adulterado: FECHA o canal
        aud("quadro_invalido", { dispositivo_id: disp.id, ok: false, codigo: "quadro_invalido" });
        mudou();
        return { status: 400, corpo: { e: "quadro_invalido" } };
      }
      s.ultimo = d.relogio.agora();
      d.dispositivos.tocar(disp.id, ctx.ip);
      if (ctx.ip === "relay" && mensagemRelay !== null) {
        const extra = await mensagemRelay(disp, msg);
        if (extra !== undefined) return { status: 200, corpo: { quadro: s.canal.selar(extra) } };
      }
      const resposta = await tratarMensagem(d.jarvis, disp, msg);
      return { status: 200, corpo: { quadro: s.canal.selar(resposta) } };
    },
  };

  const tratador = criarTratador(rotas);

  async function desligar(origem = "usuario"): Promise<EstadoRemoto> {
    const s = servidor;
    servidor = null;
    pareamento.cancelar();
    hidPendente = null;
    const n = derrubarSessoes();
    await d.jarvis.anularTodas().catch(() => 0);
    transporte = null;
    portaAtual = null;
    if (s !== null) {
      await s.fechar().catch(() => undefined);
      aud("servidor_parado", { resumo: `${origem}; sessões derrubadas: ${n}; requisições recusadas: ${recusadas}` });
    }
    recusadas = 0;
    mudou();
    return estado();
  }

  function interfacesVis(): Array<{ nome: string; ip: string; privado: boolean }> {
    return d.interfaces().map((i) => ({ nome: i.nome, ip: i.ip, privado: ipPrivado(i.ip, { cgnat: d.config().permitir_cgnat }) }));
  }

  function estado(): EstadoRemoto {
    const cfg = d.config();
    const conectados = new Set([...sessoes.values()].map((s) => s.dispositivo_id)).size;
    const pend: PedidoPendenteVisao[] = d.jarvis
      .confirmacoes()
      .filter((c) => c.ator === "remoto")
      .map((c) => ({ id: c.id, dispositivo: c.dispositivo ?? "", acao: c.acao, resumo: c.resumo, expira_em: c.expira_em }));
    return {
      transporte: {
        ligado: servidor !== null,
        transporte,
        endereco: servidor?.endereco ?? null,
        porta: portaAtual,
        persistido: false,
        pareando: pareamento.estado() === "aguardando_codigo" || pareamento.estado() === "handshake" || pareamento.estado() === "aguardando_desktop",
        codigo_expira_em: codigoExpiraEm === null ? null : new Date(codigoExpiraEm).toISOString(),
        conectados,
        ultimo_erro: ultimoErro,
      },
      dispositivos: d.dispositivos.listar().map((x) => vis(x, conectado(x.id))),
      pendentes: pend,
      config: cfg,
      sas: pareamento.sasPendente(),
      interfaces: interfacesVis(),
    };
  }

  return {
    estado,
    async ligar(p) {
      if (p.consentimento_versao !== TEXTO_CONSENTIMENTO_REMOTO_VERSAO) return { erro: "consentimento_ausente" };
      if (servidor !== null) return { erro: "ja_ligado" };
      const cfg = d.config();
      let ip: string | null = null;
      if (p.transporte === "loopback") ip = "127.0.0.1";
      else {
        const privadas = d.interfaces().filter((i) => ipPrivado(i.ip, { cgnat: cfg.permitir_cgnat }));
        ip = (p.interface === "auto" ? privadas[0]?.ip : privadas.find((i) => i.ip === p.interface)?.ip) ?? null;
      }
      if (ip === null || !ipDeBindPermitido(ip, p.transporte, { cgnat: cfg.permitir_cgnat })) {
        ultimoErro = "sem_rede_privada";
        return { erro: "sem_rede_privada" };
      }
      try {
        identidadeCache = await d.identidade();
      } catch {
        ultimoErro = "falhou";
        return { erro: "falhou" };
      }
      const porta = cfg.porta > 0 ? cfg.porta : (d.portaAleatoria?.() ?? rand(49152, 65535));
      const gerar = d.gerarCertificado ?? gerarCertificadoAutoassinado;
      const cert = p.transporte === "lan" ? gerar({ ips: [ip], dns: cfg.hosts_extras.filter((h) => !/^[\d.:[\]]+$/.test(h)).map((h) => h.split(":")[0] as string) }) : null;
      let portaReal = porta;
      const manipulador = criarManipulador({
        relogio: d.relogio,
        transporte: p.transporte,
        endereco: () => ip as string,
        porta: () => portaReal,
        hostsExtras: () => d.config().hosts_extras,
        cgnat: () => d.config().permitir_cgnat,
        rotas,
        aoRecusar: () => void (recusadas++),
      });
      try {
        servidor = await (d.iniciar ?? iniciarServidor)({ transporte: p.transporte, ip, porta, cgnat: cfg.permitir_cgnat, ...(cert === null ? {} : { tls: { key: cert.keyPem, cert: cert.certPem } }), manipulador });
      } catch (e) {
        const codigo = (e as { codigo?: string }).codigo;
        ultimoErro = codigo === "porta_ocupada" ? "porta_ocupada" : "falhou";
        return { erro: codigo === "porta_ocupada" ? "porta_ocupada" : "falhou" };
      }
      portaReal = servidor.porta;
      portaAtual = servidor.porta;
      transporte = p.transporte;
      ultimoErro = null;
      ultimoUsoGeral = d.relogio.agora();
      if (cfg.porta !== portaReal) d.gravarConfig({ porta: portaReal });
      aud("servidor_iniciado", { resumo: `${p.transporte} ${ip}:${portaReal}` });
      mudou();
      return estado();
    },
    desligar,
    configGravar(patch) {
      const prox: Partial<ConfigRemoto> = {};
      if (typeof patch.ocioso_min === "number") prox.ocioso_min = Math.min(Math.max(Math.round(patch.ocioso_min), 1), 1440);
      if (typeof patch.validade_dispositivo_dias === "number") prox.validade_dispositivo_dias = Math.min(Math.max(Math.round(patch.validade_dispositivo_dias), 1), 365);
      if (typeof patch.interface === "string") prox.interface = patch.interface;
      if (typeof patch.permitir_cgnat === "boolean") prox.permitir_cgnat = patch.permitir_cgnat;
      if (Array.isArray(patch.hosts_extras)) prox.hosts_extras = patch.hosts_extras.filter((h) => typeof h === "string" && /^[A-Za-z0-9.-]{1,120}(?::\d{1,5})?$/.test(h)).slice(0, 5);
      if (typeof patch.porta === "number" && servidor === null) prox.porta = patch.porta === 0 ? 0 : Math.min(Math.max(Math.round(patch.porta), 1024), 65535);
      d.gravarConfig(prox);
      mudou();
      return estado();
    },
    parearIniciar(permissao) {
      if ((servidor === null && !relayAtivo) || identidadeCache === null) return { erro: "falhou" };
      if (!(PERMISSOES_REMOTAS as readonly string[]).includes(permissao)) return { erro: "falhou" };
      permissaoDoPareamento = permissao;
      const r = pareamento.abrir();
      codigoExpiraEm = r.expira_em;
      aud("pareamento_aberto");
      mudou();
      return { codigo: r.codigo, expira_em: new Date(r.expira_em).toISOString() };
    },
    parearCancelar() {
      const ativo = pareamento.estado() !== "fechado";
      pareamento.cancelar();
      mudou();
      return ativo;
    },
    parearConfirmarSas(p) {
      const hid = hidPendente;
      if (hid === null) return null;
      if (!p.igual) {
        pareamento.decidir(hid, false);
        hidPendente = null;
        aud("pareamento_negado", { ok: false, codigo: "sas_diferente" });
        mudou();
        return null;
      }
      // `mensagem_direta` só com a palavra PERMITIR digitada no desktop: sem ela nada é gravado e a decisão continua pendente
      if (permissaoDoPareamento === "mensagem_direta" && p.confirmacao_permissao !== CONFIRMACAO_DIRETA) return null;
      const pedido = pareamento.decidir(hid, true);
      if (pedido === null) return null;
      const x = d.dispositivos.criar({ nome: pedido.nome, chave_publica: pedido.chave_publica, ip: null });
      const final = permissaoDoPareamento === "leitura" ? x : (d.dispositivos.definirPermissao(x.id, permissaoDoPareamento, p.confirmacao_permissao) ?? x);
      pareamento.concluir(hid, x.id);
      hidPendente = null;
      aud("dispositivo_pareado", { dispositivo_id: x.id, resumo: `permissão ${final.permissao}` });
      mudou();
      return vis(final, false);
    },
    async revogar(id) {
      return d.dispositivos.revogar(id);
    },
    permissaoDefinir(p) {
      const x = d.dispositivos.definirPermissao(p.dispositivo_id, p.permissao, p.confirmacao);
      if (x === null) return null;
      aud("permissao_alterada", { dispositivo_id: x.id, resumo: x.permissao });
      mudou();
      return vis(x, conectado(x.id));
    },
    async aprovarPedido(id, aprovado) {
      const c = d.jarvis.confirmacao(id);
      if (c === null || c.ator !== "remoto") return false;
      const r = await d.jarvis.resolverConfirmacao(id, aprovado, "desktop");
      mudou();
      return r.ok;
    },
    async panico() {
      const revogados = d.dispositivos.revogarTodos();
      await desligar("panico");
      aud("panico", { resumo: `dispositivos revogados: ${revogados}` });
      return estado();
    },
    auditoria: (depois) => d.auditoria.listar("remoto", depois, 50),
    async varrer() {
      const t = d.relogio.agora();
      const ocioso = d.config().ocioso_min * 60_000;
      derrubarSessoes((s) => t - s.ultimo > ocioso);
      await d.jarvis.varrer();
      if (servidor !== null && sessoes.size === 0 && t - ultimoUsoGeral > ocioso) await desligar("ociosidade");
      if (d.telaBloqueada?.() === true) mudou();
    },
    _rotas: () => rotas,
    tratador: () => tratador,
    async prepararRelay() {
      try {
        identidadeCache = identidadeCache ?? (await d.identidade());
      } catch {
        return false;
      }
      relayAtivo = true;
      return true;
    },
    liberarRelay() {
      relayAtivo = false;
      mensagemRelay = null;
      if (servidor === null) {
        pareamento.cancelar();
        hidPendente = null;
      }
    },
    registrarMensagemRelay: (f) => void (mensagemRelay = f),
    chaveDoDispositivo: (id) => d.dispositivos.ativo(id)?.chave_publica ?? null,
    aoRevogarDispositivo: (cb) => d.dispositivos.aoRevogar(cb),
  };
}

// ServicoCaptura (Fase 11, T-11.15/T-11.17/T-11.19/T-11.20): captura de tela/janela/região, gravação por quadros, armazém e anexo ao Pane. Criado no PRIMEIRO uso (nada no boot, P-48).
// Tudo que toca Electron entra por PORTA (fonte de tela, codificador, sessões, clipboard, tecla global): a lógica é testada sem Electron.
// A imagem congelada vive só em memória, por um token de uso único com TTL de 90 s, e é ZERADA ao confirmar, cancelar, expirar ou encerrar. O renderer nunca envia caminho.
import { randomBytes } from "node:crypto";
import {
  ATALHOS_CAPTURA_PADRAO,
  LIMITES_CAPTURA,
  type CodigoErroCaptura,
  type ConfigCaptura,
  type EstadoCaptura,
  type EventoCapturaIpc,
  type FonteCaptura,
  type FormatoImagem,
  type PaginaCapturas,
  type ResultadoAcaoCaptura,
  type ResultadoAnexoCaptura,
  type ResultadoRegiaoIniciar,
  type RetanguloLogico,
} from "../compartilhado/captura";
import { anexarImagemAoPane, textoPromptQuadros } from "../nucleo/captura/anexar";
import { ErroCaptura, type Armazem } from "../nucleo/captura/armazem";
import { displayDaJanela, recorteFisico, selecaoValida, type DisplayInfo, type Retangulo } from "../nucleo/captura/geometria";
import { codificarCaptura, imagemEmBranco, recortarBitmap, type Bitmap, type Codificador } from "../nucleo/captura/imagem";
import { iniciarAmostrador, type Amostrador, type MotivoFim, type RelogioQuadros } from "../nucleo/captura/quadros";
import { mensagemSegura } from "../nucleo/privacidade/redacao";
import { validarAtalho, type TeclaGlobal } from "../nucleo/voz/teclas";
import { PRODUTO } from "../nucleo/produto";
import type { Permissoes } from "./permissoes";

export interface Capturado { bitmap: Bitmap; display: DisplayInfo }

/** Fonte de pixels (Electron: `desktopCapturer` + `capturePage`; falsa nos testes). */
export interface FonteTela {
  displays(): DisplayInfo[];
  /** bounds lógicos da janela do app no desktop (para escolher o display); `null` sem janela. */
  janelaBounds(): Retangulo | null;
  /** captura o display no tamanho FÍSICO (`thumbnailSize = bounds × fator`). `null` se a fonte não entregou. */
  capturarDisplay(displayId: number): Promise<Capturado | null>;
  /** captura só a janela do app (sem permissão do SO). */
  capturarJanelaApp(): Promise<Capturado | null>;
}

export interface SessaoDoPane { cwd: string; workspace_id: string | null }

export interface PreferenciasCaptura {
  obter(chave: string): unknown;
  definir(chave: string, valor: unknown): Promise<void>;
}

export interface DependenciasCaptura {
  fonte: FonteTela;
  codificador: Codificador;
  /** JPEG já no tamanho LÓGICO do display (o renderer desenha 1:1). */
  previa: (b: Bitmap, d: DisplayInfo) => Uint8Array;
  permissoes: Permissoes;
  prefs: PreferenciasCaptura;
  /** `null` = workspace desconhecido. `null` como id = pasta de dados do app. */
  armazem: (workspaceId: string | null) => Armazem | null;
  sessao: (sessaoId: string) => SessaoDoPane | undefined;
  /** escreve no PTY SEM Enter; `false` se a sessão não existe mais. */
  escrever: (sessaoId: string, texto: string) => boolean;
  copiarTexto: (texto: string) => void;
  emitir: (e: EventoCapturaIpc) => void;
  teclas?: TeclaGlobal;
  /** traz a janela do app à frente quando um atalho global dispara. */
  trazerJanela?: () => void;
  relogio?: RelogioQuadros;
  ttl_ms?: number;
  aviso?: (mensagem: string) => void;
}

export interface ServicoCaptura {
  estado(): EstadoCaptura;
  configGravar(patch: Partial<ConfigCaptura>): Promise<EstadoCaptura>;
  pedirTela(): Promise<{ estado: EstadoCaptura["tela"]; reiniciar_app: boolean }>;
  regiaoIniciar(fonte: FonteCaptura): Promise<ResultadoRegiaoIniciar>;
  regiaoConfirmar(token: string, selecao: RetanguloLogico, workspaceId: string | null): Promise<ResultadoAcaoCaptura>;
  regiaoCancelar(token: string): boolean;
  janelaInteira(workspaceId: string | null): Promise<ResultadoAcaoCaptura>;
  quadrosIniciar(fonte: FonteCaptura, fps: 1 | 2, workspaceId: string | null): Promise<{ ok: true } | { ok: false; codigo: CodigoErroCaptura; instrucao: string }>;
  quadrosParar(): Promise<{ captura_id: string | null }>;
  listar(workspaceId: string | null, depois: string | null): Promise<PaginaCapturas>;
  ler(capturaId: string, workspaceId: string | null): Promise<{ bytes: Uint8Array; tipo: FormatoImagem }>;
  salvarEdicao(capturaId: string, workspaceId: string | null, png: Uint8Array): Promise<{ ok: true }>;
  anexarAoPane(capturaId: string, workspaceId: string | null, sessaoId: string): Promise<ResultadoAnexoCaptura>;
  anexarQuadrosAoPane(capturaId: string, workspaceId: string | null, sessaoId: string): Promise<ResultadoAnexoCaptura>;
  copiarCaminho(capturaId: string, workspaceId: string | null): Promise<boolean>;
  remover(capturaId: string, workspaceId: string | null): Promise<boolean>;
  /** quantas imagens congeladas estão na memória (0 ou 1): usado pelos testes de vazamento (P-45). */
  congeladas(): number;
  encerrar(): Promise<void>;
}

const CHAVES = { fps: "captura_fps_padrao", globais: "captura_atalhos_globais", aviso: "captura_aviso_visto" } as const;

export class ErroCapturaIpc extends Error {
  constructor(readonly codigo: CodigoErroCaptura, mensagem: string) {
    super(`[${codigo}] ${mensagem}`);
    this.name = "ErroCapturaIpc";
  }
}

export function instrucaoTelaNegada(plataforma: "mac" | "windows" | "linux"): string {
  if (plataforma === "mac") {
    return `A Gravação de Tela está desligada para o ${PRODUTO.nome}. Ative em Ajustes do Sistema > Privacidade e Segurança > Gravação de Tela e reabra o app (o macOS só aplica depois de reabrir). A captura da janela do app funciona sem essa permissão.`;
  }
  return "A captura de tela não devolveu imagem. Confira as permissões do sistema; a captura da janela do app não precisa delas.";
}

function zerar(c: Capturado | null): void {
  c?.bitmap.dados.fill(0);
}

export function criarServicoCaptura(d: DependenciasCaptura): ServicoCaptura {
  const ttl = d.ttl_ms ?? LIMITES_CAPTURA.congelado_ttl_ms;
  const plataforma = d.permissoes.plataforma;
  let congelado: { token: string; capturado: Capturado; timer: ReturnType<typeof setTimeout> } | null = null;
  let gravacao: { amostrador: Amostrador; armazem: Armazem; id: string; fps: 1 | 2; fim: Promise<{ captura_id: string | null }> } | null = null;
  let atalhoErro: string | null = null;

  const fps = (): 1 | 2 => (d.prefs.obter(CHAVES.fps) === 1 ? 1 : 2);
  const globais = (): boolean => d.prefs.obter(CHAVES.globais) === true;

  function liberar(): void {
    if (congelado === null) return;
    clearTimeout(congelado.timer);
    zerar(congelado.capturado);
    congelado = null;
  }

  function armazemDe(ws: string | null): Armazem {
    const a = d.armazem(ws);
    if (a === null) throw new ErroCapturaIpc("indisponivel", "Workspace desconhecido.");
    return a;
  }

  /** erro de domínio -> `Error` com `[codigo] texto`; qualquer outro vira texto genérico (nunca stack nem caminho). */
  function paraErro(e: unknown): Error {
    if (e instanceof ErroCaptura) return new ErroCapturaIpc(e.codigo, e.message);
    if (e instanceof ErroCapturaIpc) return e;
    d.aviso?.(`captura: ${mensagemSegura(e)}`);
    return new ErroCapturaIpc("indisponivel", "Falha interna na captura.");
  }
  const comoResultado = (e: unknown): { ok: false; codigo: CodigoErroCaptura; instrucao: string } => {
    const x = paraErro(e) as ErroCapturaIpc;
    return { ok: false, codigo: x.codigo, instrucao: x.message.replace(/^\[[a-z_]+\] /, "") };
  };

  async function capturar(fonte: FonteCaptura): Promise<Capturado> {
    if (fonte === "janela_app") {
      const c = await d.fonte.capturarJanelaApp();
      if (c === null) throw new ErroCapturaIpc("sem_janela", "Não há janela do app para capturar.");
      return c;
    }
    const tela = d.permissoes.tela();
    if (tela === "negada" || tela === "restrita") throw new ErroCapturaIpc("permissao_tela_negada", instrucaoTelaNegada(plataforma));
    const displays = d.fonte.displays();
    const bounds = d.fonte.janelaBounds();
    const alvo = (bounds !== null ? displayDaJanela(displays, bounds) : null) ?? displays[0] ?? null;
    if (alvo === null) throw new ErroCapturaIpc("sem_tela", "Nenhuma tela foi encontrada.");
    const c = await d.fonte.capturarDisplay(alvo.id);
    if (c === null || imagemEmBranco(c.bitmap)) {
      zerar(c);
      throw new ErroCapturaIpc("permissao_tela_negada", instrucaoTelaNegada(plataforma));
    }
    return c;
  }

  async function salvar(c: Capturado, ws: string | null): Promise<ResultadoAcaoCaptura> {
    const arm = armazemDe(ws);
    const { bytes, formato } = codificarCaptura(c.bitmap, d.codificador);
    const item = await arm.salvarImagem(bytes, formato);
    d.emitir({ tipo: "mudou", captura_id: item.id, acao: "criada" });
    return { ok: true, captura_id: item.id };
  }

  const estadoAtual = (): EstadoCaptura => ({
    tela: d.permissoes.tela(),
    janela_app: true,
    plataforma,
    aviso_visto: d.prefs.obter(CHAVES.aviso) === true,
    fps_padrao: fps(),
    atalhos_globais: globais(),
    atalho_regiao: ATALHOS_CAPTURA_PADRAO.regiao,
    atalho_quadros: ATALHOS_CAPTURA_PADRAO.quadros,
    gravando_quadros: gravacao !== null,
    atalho_erro: atalhoErro,
  });

  function ligarAtalhos(): void {
    const t = d.teclas;
    if (t === undefined) return;
    t.liberarTodas();
    atalhoErro = null;
    if (!globais()) return;
    const regs: [string, "regiao" | "quadros"][] = [[ATALHOS_CAPTURA_PADRAO.regiao, "regiao"], [ATALHOS_CAPTURA_PADRAO.quadros, "quadros"]];
    for (const [acel, acao] of regs) {
      const v = validarAtalho(acel, { plataforma });
      if (!v.ok || !t.registrar(v.acelerador, () => { d.trazerJanela?.(); d.emitir({ tipo: "atalho", acao }); })) {
        t.liberarTodas();
        atalhoErro = `O atalho ${acel} já está em uso por outro programa. Os atalhos globais ficaram desligados; os do menu continuam valendo.`;
        void d.prefs.definir(CHAVES.globais, false);
        return;
      }
    }
  }

  return {
    estado: estadoAtual,

    async configGravar(patch) {
      if (patch.fps_padrao !== undefined) await d.prefs.definir(CHAVES.fps, patch.fps_padrao === 1 ? 1 : 2);
      if (patch.aviso_visto !== undefined) await d.prefs.definir(CHAVES.aviso, patch.aviso_visto === true);
      if (patch.atalhos_globais !== undefined) { await d.prefs.definir(CHAVES.globais, patch.atalhos_globais === true); ligarAtalhos(); }
      return estadoAtual();
    },

    async pedirTela() {
      // O macOS não tem API de pedido para tela: tentar capturar faz o SO mostrar o diálogo uma vez. Só roda por ação da pessoa (após o diálogo do app).
      if (plataforma === "mac" && d.permissoes.tela() === "indeterminada") {
        try {
          const alvo = d.fonte.displays()[0];
          if (alvo !== undefined) zerar(await d.fonte.capturarDisplay(alvo.id));
        } catch { /* o estado abaixo diz o que ficou */ }
      }
      const estado = d.permissoes.tela();
      return { estado, reiniciar_app: plataforma === "mac" && estado !== "concedida" };
    },

    async regiaoIniciar(fonte) {
      liberar();
      try {
        const c = await capturar(fonte);
        const imagem = d.previa(c.bitmap, c.display);
        const token = randomBytes(16).toString("hex");
        const timer = setTimeout(liberar, ttl);
        timer.unref?.();
        congelado = { token, capturado: c, timer };
        return { ok: true, token, imagem, largura: c.display.largura, altura: c.display.altura, fator: c.display.fator };
      } catch (e) {
        return comoResultado(e);
      }
    },

    async regiaoConfirmar(token, selecao, ws) {
      const atual = congelado;
      if (atual === null || atual.token !== token) return { ok: false, codigo: "token_invalido", instrucao: "A imagem congelada expirou. Inicie a captura de novo." };
      try {
        if (!selecaoValida(selecao)) return { ok: false, codigo: "selecao_pequena", instrucao: "Seleção menor que 5x5 px: cancelada." };
        const rec = recorteFisico(atual.capturado.display, selecao);
        if (rec === null) return { ok: false, codigo: "selecao_pequena", instrucao: "A seleção ficou fora da tela." };
        const recorte = recortarBitmap(atual.capturado.bitmap, rec);
        try { return await salvar({ bitmap: recorte, display: atual.capturado.display }, ws); } finally { recorte.dados.fill(0); }
      } catch (e) {
        return comoResultado(e);
      } finally {
        liberar();
      }
    },

    regiaoCancelar(token) {
      if (congelado === null || congelado.token !== token) return false;
      liberar();
      return true;
    },

    async janelaInteira(ws) {
      try {
        const c = await capturar("janela_app");
        try { return await salvar(c, ws); } finally { zerar(c); }
      } catch (e) {
        return comoResultado(e);
      }
    },

    async quadrosIniciar(fonte, taxa, ws) {
      if (gravacao !== null) return { ok: false, codigo: "ja_gravando", instrucao: "Já existe uma gravação de quadros em andamento." };
      let arm: Armazem;
      let pasta: { id: string };
      try {
        arm = armazemDe(ws);
        pasta = await arm.iniciarQuadros(taxa);
      } catch (e) {
        return comoResultado(e);
      }
      let primeiro!: (r: { ok: true } | { ok: false; codigo: CodigoErroCaptura; instrucao: string }) => void;
      const aguardaPrimeiro = new Promise<{ ok: true } | { ok: false; codigo: CodigoErroCaptura; instrucao: string }>((r) => { primeiro = r; });
      let aoFim!: (r: { captura_id: string | null }) => void;
      const fim = new Promise<{ captura_id: string | null }>((r) => { aoFim = r; });
      const terminou = async (r: { motivo: MotivoFim; quadros: number; erro: Error | null }): Promise<void> => {
        let id: string | null = null;
        try {
          const item = await arm.finalizarQuadros(pasta.id, r.quadros, taxa);
          id = item?.id ?? null;
          if (id !== null) d.emitir({ tipo: "mudou", captura_id: id, acao: "criada" });
        } catch (e) { d.aviso?.(`captura: ${mensagemSegura(e)}`); }
        gravacao = null;
        const falha = r.erro === null ? null : comoResultado(r.erro);
        d.emitir({ tipo: "quadros_fim", captura_id: id, motivo: r.motivo, instrucao: falha?.instrucao ?? null });
        primeiro(falha ?? { ok: false, codigo: "indisponivel", instrucao: "A gravação terminou antes do primeiro quadro." });
        aoFim({ captura_id: id });
      };
      const amostrador = iniciarAmostrador({
        fps: taxa,
        ...(d.relogio === undefined ? {} : { relogio: d.relogio }),
        capturar: async () => {
          const c = await capturar(fonte);
          try { return d.codificador.png(c.bitmap); } finally { zerar(c); }
        },
        gravar: (n, png) => arm.gravarQuadro(pasta.id, n, png),
        aoProgredir: (n, max, ms) => {
          if (n === 1) primeiro({ ok: true });
          d.emitir({ tipo: "quadros_progresso", quadros: n, maximo: max, decorrido_ms: ms, fps: taxa });
        },
        aoTerminar: (r) => { void terminou(r); },
      });
      gravacao = { amostrador, armazem: arm, id: pasta.id, fps: taxa, fim };
      const r = await aguardaPrimeiro;
      return r;
    },

    async quadrosParar() {
      const g = gravacao;
      if (g === null) return { captura_id: null };
      g.amostrador.parar();
      return g.fim;
    },

    async listar(ws, depois) {
      try { return await armazemDe(ws).listar(depois); } catch (e) { throw paraErro(e); }
    },

    async ler(id, ws) {
      try {
        const r = await armazemDe(ws).ler(id);
        return { bytes: r.bytes, tipo: r.formato };
      } catch (e) { throw paraErro(e); }
    },

    async salvarEdicao(id, ws, png) {
      try {
        await armazemDe(ws).salvarEdicao(id, png);
        d.emitir({ tipo: "mudou", captura_id: id, acao: "editada" });
        return { ok: true };
      } catch (e) { throw paraErro(e); }
    },

    async anexarAoPane(id, ws, sessaoId) {
      try {
        const sessao = d.sessao(sessaoId);
        if (sessao === undefined) throw new ErroCapturaIpc("sem_terminal", "O terminal de destino foi fechado.");
        const abs = await armazemDe(ws).caminhoAbsoluto(id);
        if (id.startsWith("q_")) throw new ErroCapturaIpc("indisponivel", "Use 'inserir prompt de quadros' para uma gravação de quadros.");
        const r = await anexarImagemAoPane(sessao.cwd, sessaoId, abs);
        if (!d.escrever(sessaoId, r.texto)) throw new ErroCapturaIpc("sem_terminal", "O terminal de destino foi fechado.");
        return r;
      } catch (e) {
        if (e instanceof ErroCapturaIpc || e instanceof ErroCaptura) throw paraErro(e);
        // `prepararAnexos` explica a recusa (tipo, symlink, tamanho) em texto seguro; qualquer outra coisa vira genérica
        if (e instanceof Error && /Arquivo|Atalho|Tipo|anex|Caminho/.test(e.message)) throw new ErroCapturaIpc("indisponivel", e.message);
        throw paraErro(e);
      }
    },

    async anexarQuadrosAoPane(id, ws, sessaoId) {
      try {
        const sessao = d.sessao(sessaoId);
        if (sessao === undefined) throw new ErroCapturaIpc("sem_terminal", "O terminal de destino foi fechado.");
        const arm = armazemDe(ws);
        const item = await arm.obter(id);
        if (item.tipo !== "quadros") throw new ErroCapturaIpc("indisponivel", "Esta captura não é uma gravação de quadros.");
        const r = textoPromptQuadros(sessao.cwd, await arm.caminhoAbsoluto(id), item.quadros ?? 0, item.fps ?? 2);
        if (!d.escrever(sessaoId, r.texto)) throw new ErroCapturaIpc("sem_terminal", "O terminal de destino foi fechado.");
        return r;
      } catch (e) { throw paraErro(e); }
    },

    async copiarCaminho(id, ws) {
      try {
        d.copiarTexto(await armazemDe(ws).caminhoAbsoluto(id)); // ação explícita da pessoa: único lugar onde o caminho ABSOLUTO sai do main
        return true;
      } catch (e) { throw paraErro(e); }
    },

    async remover(id, ws) {
      try {
        const ok = await armazemDe(ws).remover(id);
        if (ok) d.emitir({ tipo: "mudou", captura_id: id, acao: "removida" });
        return ok;
      } catch (e) { throw paraErro(e); }
    },

    congeladas: () => (congelado === null ? 0 : 1),

    async encerrar() {
      liberar();
      if (gravacao !== null) { gravacao.amostrador.parar(); await gravacao.fim.catch(() => undefined); }
      d.teclas?.liberarTodas();
    },
  };
}

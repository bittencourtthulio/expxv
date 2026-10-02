import { useEffect, useRef, useState, type ReactElement } from "react";
import { Terminal as Xterm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import type { ItemAnexo, ResultadoAnexos } from "../../../compartilhado/terminais";
import type { TemaEfetivo } from "../../../compartilhado/ipc";
import { storeConfig, useConfig, type StoreConfig } from "../../estado/config";
import { armazemDeSaida, type Armazem } from "./armazem";
import { guardarRolagem, rolagemSalva } from "./rolagem-salva";
import { BuscaTerminal, ehAtalhoDeBusca } from "./busca";
import { GerenciadorColagem, colagensDaTela, normalizarColagem, partirColagem, precisaDeConfirmacao } from "./colagem";
import { registrarLeitorDeBuffer } from "./gancho-e2e";
import { bytesDoChunk, deveAplicarDimensao, type Dimensoes } from "./dimensao";
import { abrirLinkDoTerminal, urlNoTexto } from "./links";
import { temaXterm } from "./tema-xterm";
import { liberarContextoWebgl, reservarContextoWebgl } from "./webgl";
import "./terminal.css";

/** O que o terminal usa do main (subconjunto de `window.ade.terminais`; estrutural, o teste injeta um falso). */
export interface ApiTerminal {
  escrever(sessaoId: string, dados: string): void;
  redimensionar(sessaoId: string, colunas: number, linhas: number): void;
  confirmarConsumo(sessaoId: string, bytes: number): Promise<boolean> | void;
  anexar?(sessaoId: string, itens: ItemAnexo[]): Promise<ResultadoAnexos>;
  caminhoDoArquivo?(arquivo: File): string;
  abrirLink?(url: string): Promise<boolean>;
}

export interface PropsTerminal {
  sessaoId: string;
  rotulo?: string;
  ativo: boolean;
  tema: TemaEfetivo;
  /** WebGL só para quem o Grade escolheu (foco + até 6 visíveis, D-11); o resto usa o renderer DOM. */
  webgl: boolean;
  api: ApiTerminal;
  /** muda quando o layout muda de tamanho (divisor, expandir): pede novo ajuste. */
  layoutToken?: number;
  armazem?: Armazem;
  /** store de configuração (`terminal_scrollback`); padrão: o global. */
  config?: StoreConfig;
  colagens?: GerenciadorColagem;
  /** carregador do addon WebGL (import dinâmico por padrão; injetável em teste). */
  carregarWebgl?: () => Promise<{ WebglAddon: new () => WebglLike }>;
}

interface WebglLike { dispose(): void; onContextLoss(cb: () => void): unknown }
const carregarWebglPadrao = (): Promise<{ WebglAddon: new () => WebglLike }> => import("@xterm/addon-webgl") as never;

const EH_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

const EXTENSAO_POR_TIPO: Record<string, string> = {
  "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "application/pdf": ".pdf", "text/plain": ".txt", "text/markdown": ".md", "application/json": ".json",
};

/** Arquivo do disco vira `{ caminho }` (nada é lido); blob colado (print) vira `{ nome, bytes }`. */
async function itensDeArquivos(arquivos: readonly File[], caminhoDoArquivo?: (a: File) => string): Promise<ItemAnexo[]> {
  const itens: ItemAnexo[] = [];
  for (const arquivo of arquivos) {
    const caminho = caminhoDoArquivo?.(arquivo) ?? "";
    if (caminho !== "") { itens.push({ caminho }); continue; }
    const base = arquivo.name !== "" ? arquivo.name : "colado";
    const nome = /\.[A-Za-z0-9]{1,5}$/.test(base) ? base : `${base}${EXTENSAO_POR_TIPO[arquivo.type] ?? ""}`;
    itens.push({ nome, bytes: new Uint8Array(await arquivo.arrayBuffer()) });
  }
  return itens;
}

export function Terminal(props: PropsTerminal): ReactElement {
  const elemento = useRef<HTMLDivElement>(null);
  const instancia = useRef<Xterm | null>(null);
  const agendarAjuste = useRef<(focar?: boolean) => void>(() => undefined);
  const busca = useRef<SearchAddon | null>(null);
  const temaAtual = useRef(props.tema);
  temaAtual.current = props.tema;
  const ativoInicial = useRef(props.ativo);
  ativoInicial.current = props.ativo;
  const primeiraAtivacao = useRef(true);
  const primeiroLayout = useRef(true);
  const armazem = props.armazem ?? armazemDeSaida;
  const colagens = props.colagens ?? colagensDaTela;
  const [buscando, setBuscando] = useState(false);
  const [colando, setColando] = useState<string | null>(null);
  const [progresso, setProgresso] = useState<{ feitos: number; total: number } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const abrirBusca = useRef<(aberta: boolean) => void>(() => undefined);
  abrirBusca.current = setBuscando;
  const abrirColagem = useRef<(texto: string) => void>(() => undefined);
  const acoes = useRef<{ arquivo(texto: string): void; partes(texto: string): void }>({ arquivo: () => undefined, partes: () => undefined });
  const { api, sessaoId } = props;
  const configStore = props.config ?? storeConfig;
  const scrollback = useConfig((e) => e.scrollback, configStore);
  const scrollbackInicial = useRef(scrollback);
  scrollbackInicial.current = scrollback;

  useEffect(() => {
    const caixa = elemento.current;
    if (caixa === null) return;
    const xterm = new Xterm({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: false,
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 12,
      lineHeight: 1,
      minimumContrastRatio: 4.5,
      scrollback: scrollbackInicial.current,
      theme: temaXterm(temaAtual.current),
    });
    instancia.current = xterm;
    const ajuste = new FitAddon();
    xterm.loadAddon(ajuste);
    const pesquisa = new SearchAddon();
    xterm.loadAddon(pesquisa);
    busca.current = pesquisa;
    const dicaDoLink = `${EH_MAC ? "Cmd" : "Ctrl"}+clique para abrir`;
    xterm.loadAddon(new WebLinksAddon(
      (evento, uri) => { abrirLinkDoTerminal(api, evento, uri); },
      { hover: () => { caixa.title = dicaDoLink; }, leave: () => { caixa.removeAttribute("title"); } },
    ));
    // a busca é do painel, não do processo: devolver false impede o xterm de enviá-la ao PTY
    xterm.attachCustomKeyEventHandler((e) => {
      if (!ehAtalhoDeBusca(e, EH_MAC)) return true;
      e.preventDefault();
      abrirBusca.current(true);
      return false;
    });
    xterm.open(caixa);
    const soltarGancho = registrarLeitorDeBuffer(sessaoId, xterm);
    let vivo = true;
    const entrada = xterm.onData((dados) => { api.escrever(sessaoId, dados); });

    // ---- anexos e colagem ----
    const anexar = async (arquivos: File[]): Promise<void> => {
      if (arquivos.length === 0 || api.anexar === undefined) return;
      try {
        const r = await api.anexar(sessaoId, await itensDeArquivos(arquivos, api.caminhoDoArquivo === undefined ? undefined : (a) => api.caminhoDoArquivo!(a)));
        if (vivo) { xterm.paste(r.texto); xterm.focus(); }
      } catch { /* o main avisa a falha por terminais:falha */ }
    };
    const modo2004 = (): boolean => (xterm as unknown as { modes?: { bracketedPasteMode?: boolean } }).modes?.bracketedPasteMode === true;
    const aoColar = (e: ClipboardEvent): void => {
      const arquivos = Array.from(e.clipboardData?.files ?? []);
      if (arquivos.length > 0 && api.anexar !== undefined) { e.preventDefault(); e.stopPropagation(); void anexar(arquivos); return; }
      if (colagens.emCurso(sessaoId)) { e.preventDefault(); e.stopPropagation(); setAviso("Já há uma colagem em curso neste painel."); return; }
      const texto = e.clipboardData?.getData?.("text/plain") ?? "";
      if (precisaDeConfirmacao(texto)) { e.preventDefault(); e.stopPropagation(); abrirColagem.current(texto); }
    };
    abrirColagem.current = (texto) => { setAviso(null); setColando(texto); };
    acoes.current = {
      arquivo: (texto) => {
        setColando(null);
        if (api.anexar === undefined) return;
        const item: ItemAnexo = { nome: `colagem-${Date.now()}.txt`, bytes: new TextEncoder().encode(texto) };
        void api.anexar(sessaoId, [item]).then((r) => { if (vivo) { xterm.paste(r.texto); xterm.focus(); } }).catch(() => undefined);
      },
      partes: (texto) => {
        setColando(null);
        setProgresso({ feitos: 0, total: partirColagem(normalizarColagem(texto)).length });
        const envio = colagens.iniciar(sessaoId, {
          texto, modo2004: modo2004(), escrever: (d) => { api.escrever(sessaoId, d); },
          aoProgresso: (feitos, total) => { if (vivo) setProgresso({ feitos, total }); },
        });
        if (envio === null) { setProgresso(null); setAviso("Já há uma colagem em curso neste painel."); return; }
        void envio.concluido.finally(() => { if (vivo) setProgresso(null); });
      },
    };
    const temArquivos = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const aoArrastar = (e: DragEvent): void => {
      if (api.anexar === undefined || !temArquivos(e)) return;
      e.preventDefault();
      if (e.dataTransfer !== null) e.dataTransfer.dropEffect = "copy";
      caixa.dataset.soltar = "";
    };
    const aoSairDoArraste = (e: DragEvent): void => {
      if (e.relatedTarget instanceof Node && caixa.contains(e.relatedTarget)) return;
      delete caixa.dataset.soltar;
    };
    const aoSoltar = (e: DragEvent): void => {
      delete caixa.dataset.soltar;
      if (api.anexar === undefined || !temArquivos(e)) return;
      e.preventDefault();
      void anexar(Array.from(e.dataTransfer?.files ?? []));
    };

    // ---- Cmd/Ctrl+clique em link, inclusive com mouse-reporting do programa (captura antes do xterm) ----
    const urlSobOMouse = (e: MouseEvent): string | null => {
      const tela = caixa.querySelector<HTMLElement>(".xterm-screen");
      if (tela === null || xterm.cols < 1 || xterm.rows < 1) return null;
      const r = tela.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      const coluna = Math.floor((e.clientX - r.left) / (r.width / xterm.cols));
      const linha = Math.floor((e.clientY - r.top) / (r.height / xterm.rows));
      if (coluna < 0 || coluna >= xterm.cols || linha < 0 || linha >= xterm.rows) return null;
      const buffer = xterm.buffer.active;
      let y = buffer.viewportY + linha;
      while (y > 0 && buffer.getLine(y)?.isWrapped === true) y -= 1;
      let texto = "";
      let indice = -1;
      for (let i = y; i < buffer.length; i += 1) {
        const l = buffer.getLine(i);
        if (l === undefined || (i > y && !l.isWrapped)) break;
        if (i === buffer.viewportY + linha) indice = texto.length + coluna;
        texto += l.translateToString(false);
      }
      return indice < 0 ? null : urlNoTexto(texto, indice);
    };
    const aoClicarLink = (e: MouseEvent): void => {
      if (e.button !== 0 || (!e.metaKey && !e.ctrlKey)) return;
      const url = urlSobOMouse(e);
      if (url === null) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.type === "click") abrirLinkDoTerminal(api, e, url);
    };
    const eventosDeLink = ["mousedown", "mouseup", "click"] as const;
    for (const nome of eventosDeLink) caixa.addEventListener(nome, aoClicarLink, true);
    caixa.addEventListener("paste", aoColar, true);
    caixa.addEventListener("dragover", aoArrastar);
    caixa.addEventListener("dragleave", aoSairDoArraste);
    caixa.addEventListener("drop", aoSoltar);

    // ---- saída: armazém → xterm, chunk a chunk; consumo confirmado DEPOIS do write ----
    let atrasoRepintura: ReturnType<typeof setTimeout> | null = null;
    const repintar = (): void => {
      if (atrasoRepintura !== null) clearTimeout(atrasoRepintura);
      atrasoRepintura = setTimeout(() => {
        atrasoRepintura = null;
        if (vivo) try { xterm.refresh(0, Math.max(0, xterm.rows - 1)); } catch { /* descartado */ }
      }, 80);
    };
    let pendentes = 0; // bytes ao vivo já entregues ao xterm e ainda sem callback
    let reidratando = true;
    let houveReplay = false;
    const cancelarSaida = armazem.assinar(sessaoId, (chunk) => {
      if (reidratando) {
        // replay do armazém: o store já confirmou esses bytes quando ninguém assinava
        houveReplay = true;
        xterm.write(chunk, repintar);
        return;
      }
      const bytes = bytesDoChunk(chunk);
      pendentes += bytes;
      xterm.write(chunk, () => {
        pendentes -= bytes;
        void api.confirmarConsumo(sessaoId, bytes);
        repintar();
      });
    });
    reidratando = false;
    // D-570: terminal que voltou depois de o workspace ficar oculto (ou de a aba trocar) retoma a rolagem em que estava (linhas acima do fim)
    const rolagem = rolagemSalva.get(sessaoId);
    rolagemSalva.delete(sessaoId);
    if (houveReplay && rolagem !== undefined && rolagem > 0) xterm.write("", () => { if (vivo) try { xterm.scrollLines(-rolagem); } catch { /* descartado */ } });

    // ---- tamanho ----
    let atraso: ReturnType<typeof setTimeout> | null = null;
    let ultimoEnviado: Dimensoes | null = null;
    let deveForcar = houveReplay;
    let retornoForcado: ReturnType<typeof setTimeout> | null = null;
    const aplicarDimensoes = (): void => {
      atraso = null;
      if (caixa.offsetParent === null || caixa.clientWidth < 40 || caixa.clientHeight < 30) return;
      try {
        const proposta = ajuste.proposeDimensions();
        if (proposta === undefined || proposta === null || proposta.cols < 2 || proposta.rows < 1) return;
        if (xterm.cols !== proposta.cols || xterm.rows !== proposta.rows) ajuste.fit();
        repintar();
        if (deveForcar) {
          // sessão reidratada: o TUI só se redesenha com SIGWINCH; o vaivém de colunas o força
          deveForcar = false;
          const intermediaria = xterm.cols > 2 ? xterm.cols - 1 : xterm.cols + 1;
          api.redimensionar(sessaoId, intermediaria, xterm.rows);
          retornoForcado = setTimeout(() => { if (vivo) api.redimensionar(sessaoId, xterm.cols, xterm.rows); }, 45);
          ultimoEnviado = { colunas: xterm.cols, linhas: xterm.rows };
        } else if (deveAplicarDimensao(ultimoEnviado, xterm.cols, xterm.rows)) {
          ultimoEnviado = { colunas: xterm.cols, linhas: xterm.rows };
          api.redimensionar(sessaoId, xterm.cols, xterm.rows);
        }
      } catch { /* o painel pode sumir durante a troca de layout */ }
    };
    const pedirAjuste = (focar = false): void => {
      if (focar) { try { xterm.focus(); } catch { /* descartado */ } }
      if (atraso !== null) clearTimeout(atraso);
      atraso = setTimeout(aplicarDimensoes, 120);
    };
    agendarAjuste.current = pedirAjuste;
    const observador = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => pedirAjuste(false));
    observador?.observe(caixa.parentElement ?? caixa);
    const aoRedimensionarJanela = (): void => pedirAjuste(false);
    window.addEventListener("resize", aoRedimensionarJanela);
    aplicarDimensoes(); // primeiro fit síncrono, sem timer (P-03)
    if (ativoInicial.current) xterm.focus();

    return () => {
      vivo = false;
      colagens.cancelar(sessaoId);
      abrirColagem.current = () => undefined;
      for (const nome of eventosDeLink) caixa.removeEventListener(nome, aoClicarLink, true);
      caixa.removeEventListener("paste", aoColar, true);
      caixa.removeEventListener("dragover", aoArrastar);
      caixa.removeEventListener("dragleave", aoSairDoArraste);
      caixa.removeEventListener("drop", aoSoltar);
      if (atraso !== null) clearTimeout(atraso);
      if (atrasoRepintura !== null) clearTimeout(atrasoRepintura);
      if (retornoForcado !== null) clearTimeout(retornoForcado);
      window.removeEventListener("resize", aoRedimensionarJanela);
      observador?.disconnect();
      cancelarSaida();
      try { const b = xterm.buffer.active; guardarRolagem(sessaoId, b.baseY - b.viewportY); } catch { /* descartado */ }
      // o xterm vai descartar os callbacks de write pendentes: confirma o que ficou, senão o PTY emperra
      if (pendentes > 0) void api.confirmarConsumo(sessaoId, pendentes);
      entrada.dispose();
      soltarGancho();
      xterm.dispose();
      instancia.current = null;
      busca.current = null;
      agendarAjuste.current = () => undefined;
    };
  }, [api, sessaoId, armazem, colagens]);

  // troca de tema do app: só muda as opções do xterm, sem recriar
  useEffect(() => {
    if (instancia.current !== null) instancia.current.options.theme = temaXterm(props.tema);
  }, [props.tema]);

  // `terminal_scrollback` mudou: só a opção do xterm, sem recriar o terminal
  useEffect(() => {
    if (instancia.current !== null) instancia.current.options.scrollback = scrollback;
  }, [scrollback]);

  // o botão "buscar" da linha de controles pede a busca deste painel
  useEffect(() => {
    const aoPedir = (e: Event): void => { if ((e as CustomEvent<string>).detail === sessaoId) setBuscando(true); };
    window.addEventListener("ade:buscar-terminal", aoPedir);
    return () => window.removeEventListener("ade:buscar-terminal", aoPedir);
  }, [sessaoId]);

  // WebGL só para quem o Grade escolheu; o contexto é reservado num contador global (teto 6)
  useEffect(() => {
    const xterm = instancia.current;
    if (!props.webgl || xterm === null) return;
    if (!reservarContextoWebgl()) return;
    let vivo = true;
    let reservado = true;
    let addon: { dispose(): void } | null = null;
    const liberar = (): void => { if (reservado) { reservado = false; liberarContextoWebgl(); } };
    void (props.carregarWebgl ?? carregarWebglPadrao)().then((m) => {
      if (!vivo) { liberar(); return; }
      try {
        const webgl = new m.WebglAddon();
        webgl.onContextLoss(() => { try { webgl.dispose(); } catch { /* já solto */ } addon = null; liberar(); });
        xterm.loadAddon(webgl as never);
        addon = webgl;
      } catch { liberar(); }
    }).catch(liberar);
    return () => {
      vivo = false;
      try { addon?.dispose(); } catch { /* terminal já descartado */ }
      liberar();
    };
  }, [props.webgl, api, sessaoId, armazem, colagens, props.carregarWebgl]);

  // Esc cancela o diálogo ou o envio em partes; nada disso chega ao processo
  const colagemAtiva = colando !== null || progresso !== null;
  const enviando = progresso !== null;
  useEffect(() => {
    if (!colagemAtiva) return;
    const aoTeclar = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (enviando) colagens.cancelar(sessaoId);
      setColando(null);
    };
    window.addEventListener("keydown", aoTeclar, true);
    return () => window.removeEventListener("keydown", aoTeclar, true);
  }, [colagemAtiva, enviando, colagens, sessaoId]);

  useEffect(() => {
    if (primeiraAtivacao.current) { primeiraAtivacao.current = false; return; }
    if (props.ativo) agendarAjuste.current(true);
  }, [props.ativo]);

  useEffect(() => {
    if (primeiroLayout.current) { primeiroLayout.current = false; return; }
    agendarAjuste.current(false);
  }, [props.layoutToken]);

  const fecharBusca = (): void => {
    busca.current?.clearDecorations();
    setBuscando(false);
    try { instancia.current?.focus(); } catch { /* descartado */ }
  };
  return (
    <div className="terminal-caixa">
      <div className="terminal-xterm" ref={elemento} role="application" aria-label={props.rotulo !== undefined ? `Terminal ${props.rotulo}` : "Terminal"} />
      {buscando && busca.current !== null ? <BuscaTerminal busca={busca.current} aoFechar={fecharBusca} /> : null}
      {colando !== null ? (
        <div className="terminal-colagem" role="dialog" aria-modal="false" aria-label="Colar texto grande">
          <strong>Texto grande: {colando.length.toLocaleString("pt-BR")} caracteres</strong>
          <p>O terminal recebe até 20.000 caracteres por colagem. Escolha como enviar. Esc cancela.</p>
          <div className="terminal-colagem-acoes">
            <button type="button" autoFocus disabled={api.anexar === undefined} onClick={() => acoes.current.arquivo(colando)}>Enviar como arquivo</button>
            <button type="button" onClick={() => acoes.current.partes(colando)}>Colar em partes</button>
            <button type="button" onClick={() => setColando(null)}>Cancelar</button>
          </div>
        </div>
      ) : null}
      {progresso !== null ? <div className="terminal-colagem-progresso" role="status">Colando {progresso.feitos}/{progresso.total}. Esc cancela.</div> : null}
      {aviso !== null && progresso === null ? <div className="terminal-colagem-progresso" role="alert">{aviso}</div> : null}
    </div>
  );
}

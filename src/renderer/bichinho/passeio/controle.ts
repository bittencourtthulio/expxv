// Controlador do passeio dos bichinhos (D-650…D-654). Vanilla, sem React: guarda as "casas" (o slot do menu e os cartões do painel de
// workspaces), o detector de ociosidade, os passeantes e o registro de travessuras. A camada (`Camada.tsx`) só desenha as vistas.
//
// Custo: no posto existe UM timer (o do detector de ociosidade) e nenhum rAF. Durante o passeio, 1 timer por passeante (≤ 8) que só dispara
// nas trocas de fase (a cada alguns segundos); o movimento é CSS (transition de transform por trecho) e as travessuras são WAAPI por trecho.
import type { BichinhoVisao, EspecieId, EstagioId, HumorId } from "../../../compartilhado/bichinho";
import {
  AFUNDO_PX, caixaNoLugar, chaoDe, criarSorteio, distancia, duracaoDoTrecho, escolherLugar, hash32, limitarX, lugaresDeSono, posicaoDaParada, pontoNoChao, prenderRetangulo,
  type Ambiente, type Retangulo,
} from "./geometria";
import {
  DURACAO_ACAO, HUMOR_DA_ACAO, LIMITE_SOLTOS, escolherAcao, podePassear, selecionarPasseantes, transicao, trabalhando, type Acao, type ContextoPasseio, type Evento, type Fase,
} from "./maquina";
import { criarDetector, limitarMinutos, OCIOSIDADE_PADRAO_MIN, type Detector, type TipoAtividade } from "./ocioso";
import { ligarSegredo } from "./segredo";
import { coletarCandidatos, criarRegistro, escolherCandidato, limiteDeRecorte, type RegistroTravessuras } from "./travessuras";

export const TAMANHO_PX = 44;
export const VELOCIDADE_ANDAR = 110;
export const VELOCIDADE_CARREGAR = 85;
export const VELOCIDADE_VOLTAR = 1_100;
export const VOLTAR_MIN_MS = 350;
export const VOLTAR_MAX_MS = 1_500;
export const DORMIR_MIN_MS = 45_000;
export const DORMIR_MAX_MS = 90_000;
export const SEGREDO_MS = 40_000;
export const SEGREDO_ESTATICO_MS = 1_000;
/** Depois de trabalhar, o workspace só passeia de novo após este sossego. */
export const SOSSEGO_APOS_TRABALHO_MS = 20_000;

export interface Casa { chave: string; workspaceId: string; elemento: () => HTMLElement | null }

export interface VistaPasseante {
  chave: string;
  workspaceId: string;
  fase: Fase;
  acao: Acao | null;
  /** canto superior esquerdo da caixa, em px da janela */
  x: number;
  y: number;
  /** duração do trecho em ms (0 = salto, sem transição) */
  ms: number;
  dir: 1 | -1;
  tam: number;
  especie: EspecieId;
  estagio: EstagioId;
  humor: HumorId;
  doente: boolean;
  /** carregando um elemento da tela nas mãos. */
  carga: boolean;
  /** versão estática do segredo (animações silenciadas). */
  quieto: boolean;
}

export interface Preferencias { ligado: boolean; mostrar: boolean; silenciar: boolean; travessuras: boolean; minutos: number }
export const PREFERENCIAS_PADRAO: Preferencias = { ligado: true, mostrar: true, silenciar: false, travessuras: true, minutos: OCIOSIDADE_PADRAO_MIN };

export interface DepsControle {
  win?: Window;
  doc?: Document;
  agora?: () => number;
  setT?: (f: () => void, ms: number) => unknown;
  clearT?: (t: unknown) => void;
  /** semente → sorteio (teste injeta determinístico). */
  sorteio?: (semente: number) => () => number;
  reduzido?: () => boolean;
  avisar?: (texto: string) => void;
  registro?: RegistroTravessuras;
}

interface Passeante {
  v: VistaPasseante;
  timer: unknown;
  sorteio: () => number;
  semente: number;
  ciclo: number;
  feitas: number;
  limite: number;
  ultimaAcao: Acao | null;
  plano: Array<() => void>;
  lugarId: string | null;
  travessura: Element | null;
}

export function criarControle(deps: DepsControle = {}) {
  const win = deps.win ?? window;
  const doc = deps.doc ?? document;
  const agora = deps.agora ?? Date.now;
  const setT = deps.setT ?? ((f, ms) => setTimeout(f, ms));
  const clearT = deps.clearT ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const fazerSorteio = deps.sorteio ?? criarSorteio;
  const reduzido = deps.reduzido ?? ((): boolean => { try { return typeof win.matchMedia === "function" && win.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } });
  const registro = deps.registro ?? criarRegistro({ doc, win, setT, clearT, agora });

  let prefs: Preferencias = PREFERENCIAS_PADRAO;
  let visoes: ReadonlyMap<string, BichinhoVisao> = new Map();
  const casas = new Map<string, Casa>();
  const passeantes = new Map<string, Passeante>();
  const ultimoTrabalho = new Map<string, number>();
  const ouvintes = new Set<() => void>();
  let vistas: readonly VistaPasseante[] = [];
  let fora: ReadonlySet<string> = new Set();
  let ctx: ContextoPasseio = { ligado: true, mostrar: true, semMovimento: false, oculta: false, ocioso: false, forcado: false };
  let detector: Detector | null = null;
  let iniciado = false;
  let ambiente: Ambiente | null = null;
  let candidatos: HTMLElement[] | null = null;
  let timerSegredo: unknown = null;
  let timerReavaliar: unknown = null;
  let timerEstatico: unknown = null;
  let medidor: ((chave: string) => { x: number; y: number } | null) | null = null;
  let soltarListeners: Array<() => void> = [];

  const classificacao = { doc, win, emMovimento: (el: Element): boolean => registro.emMovimento(el) };

  // ---- publicação ----
  function publicar(): void {
    vistas = [...passeantes.values()].map((p) => ({ ...p.v }));
    fora = new Set(passeantes.keys());
    for (const o of [...ouvintes]) o();
  }
  const recalcularContexto = (patch: Partial<ContextoPasseio> = {}): void => {
    ctx = { ...ctx, ligado: prefs.ligado, mostrar: prefs.mostrar, semMovimento: prefs.silenciar || reduzido(), ...patch };
  };
  const travessurasAtivas = (): boolean => prefs.travessuras && prefs.ligado && !ctx.semMovimento;

  // ---- leitura geométrica (UMA vez por passeio) ----
  function lerAmbiente(): Ambiente {
    if (ambiente !== null) return ambiente;
    const largura = win.innerWidth;
    const altura = win.innerHeight;
    const ret = (el: Element | null): Retangulo | null => { if (el === null) return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null; };
    const rodape = ret(doc.querySelector(".rodape"));
    const cartoes = [...doc.querySelectorAll(".pws-cartao")].map(ret).filter((r): r is Retangulo => r !== null && r.top > TAMANHO_PX && r.bottom < altura).slice(0, 3);
    ambiente = { area: { largura, altura, chao: rodape !== null ? rodape.top : chaoDe(altura, 26) }, painel: ret(doc.querySelector(".painel-ws")), cartoes, topo: ret(doc.querySelector(".casca-topo")) };
    return ambiente;
  }
  function lerCandidatos(): HTMLElement[] { candidatos ??= coletarCandidatos(classificacao); return candidatos; }

  // ---- passeantes ----
  const evento = (p: Passeante, e: Evento): void => { p.v = { ...p.v, fase: transicao(p.v.fase, e) }; };
  const armar = (p: Passeante, ms: number, f: () => void): void => { if (p.timer !== null) clearT(p.timer); p.timer = setT(() => { p.timer = null; if (passeantes.get(p.v.chave) === p) f(); }, ms); };
  const limparTimer = (p: Passeante): void => { if (p.timer !== null) { clearT(p.timer); p.timer = null; } };
  const humorDaFase = (p: Passeante): HumorId => {
    if (p.v.fase === "dormindo" || p.v.fase === "deitando") return "dormindo";
    if (p.v.fase === "fazendo_algo" && p.v.acao !== null) return HUMOR_DA_ACAO[p.v.acao];
    return "ocioso";
  };
  const atualizar = (p: Passeante, patch: Partial<VistaPasseante>): void => { p.v = { ...p.v, ...patch }; p.v = { ...p.v, humor: humorDaFase(p) }; publicar(); };

  function trecho(p: Passeante, alvo: { x: number; y: number }, vel: number, depois: () => void, carga?: { el: Element; dx: number; dy: number; rot?: number }): void {
    const ms = duracaoDoTrecho(distancia(p.v, alvo), vel, 600, 9_000);
    const dir: 1 | -1 = alvo.x === p.v.x ? p.v.dir : alvo.x > p.v.x ? 1 : -1;
    atualizar(p, { x: alvo.x, y: alvo.y, ms, dir, carga: carga !== undefined });
    if (carga !== undefined) registro.mover(carga.el, { dx: carga.dx, dy: carga.dy, rot: carga.rot ?? 0 }, ms);
    armar(p, ms, depois);
  }
  function acao(p: Passeante, a: Acao, depois: () => void, ms?: number): void {
    evento(p, "chegou_acao");
    const [min, max] = DURACAO_ACAO[a];
    atualizar(p, { acao: a, ms: 0, carga: false });
    armar(p, ms ?? Math.round(min + p.sorteio() * (max - min)), () => { evento(p, "fim_acao"); atualizar(p, { acao: null }); depois(); });
  }

  function seguir(p: Passeante): void {
    const passo = p.plano.shift();
    if (passo !== undefined) { passo(); return; }
    decidir(p);
  }

  function irParaAcao(p: Passeante): void {
    const amb = lerAmbiente();
    const alvo = caixaNoLugar(pontoNoChao(amb.area, TAMANHO_PX, p.sorteio()), TAMANHO_PX);
    trecho(p, alvo, VELOCIDADE_ANDAR, () => {
      const escolhida = escolherAcao(p.sorteio, visoes.get(p.v.workspaceId)?.humor, p.ultimaAcao);
      p.ultimaAcao = escolhida; p.feitas += 1;
      acao(p, escolhida, () => seguir(p));
    });
  }

  function irDormir(p: Passeante): void {
    const amb = lerAmbiente();
    const ocupados = new Set([...passeantes.values()].map((q) => q.lugarId).filter((x): x is string => x !== null));
    const lugar = escolherLugar(lugaresDeSono(amb, TAMANHO_PX), p.semente + p.ciclo * 7, ocupados);
    if (lugar === null) { irParaAcao(p); return; }
    p.lugarId = lugar.id;
    trecho(p, caixaNoLugar(lugar, TAMANHO_PX), VELOCIDADE_ANDAR, () => {
      evento(p, "chegou_cama");
      atualizar(p, { acao: null, ms: 0 });
      armar(p, 900, () => {
        evento(p, "deitou");
        atualizar(p, {});
        armar(p, Math.round(DORMIR_MIN_MS + p.sorteio() * (DORMIR_MAX_MS - DORMIR_MIN_MS)), () => {
          evento(p, "acordar");
          atualizar(p, {});
          armar(p, 1_200, () => {
            evento(p, "levantou");
            p.lugarId = null; p.ciclo += 1; p.feitas = 0; p.limite = 2 + Math.floor(p.sorteio() * 3);
            atualizar(p, {});
            seguir(p);
          });
        });
      });
    });
  }

  function irAoEncontro(p: Passeante): boolean {
    const outros = [...passeantes.values()].filter((q) => q !== p && q.v.fase === "fazendo_algo" && q.v.acao !== "pegar" && q.v.acao !== "soltar" && !q.v.carga);
    if (outros.length === 0) return false;
    const b = outros[Math.min(outros.length - 1, Math.floor(p.sorteio() * outros.length))]!;
    const lado: 1 | -1 = b.v.x > p.v.x ? -1 : 1;
    const alvo = { x: limitarX(b.v.x + TAMANHO_PX / 2 + lado * TAMANHO_PX * 0.95, lerAmbiente().area, TAMANHO_PX) - TAMANHO_PX / 2, y: b.v.y };
    trecho(p, alvo, VELOCIDADE_ANDAR, () => {
      const parceiro = passeantes.get(b.v.chave);
      if (parceiro === undefined || parceiro.v.fase !== "fazendo_algo") { seguir(p); return; }
      // se encontram: pausam, se olham e acenam; depois caminham juntos até um ponto do chão
      limparTimer(parceiro);
      evento(parceiro, "fim_acao");
      atualizar(parceiro, { acao: null, dir: p.v.x > parceiro.v.x ? 1 : -1 });
      acao(parceiro, "cumprimentar", () => seguir(parceiro), 60_000); // espera o outro chamar para caminharem juntos
      atualizar(p, { dir: parceiro.v.x > p.v.x ? 1 : -1 });
      acao(p, "cumprimentar", () => {
        const comum = pontoNoChao(lerAmbiente().area, TAMANHO_PX, p.sorteio());
        const fim = (q: Passeante, desloc: number): void => {
          const al = caixaNoLugar({ x: limitarX(comum.x + desloc, lerAmbiente().area, TAMANHO_PX), y: comum.y }, TAMANHO_PX);
          trecho(q, al, VELOCIDADE_ANDAR * 0.8, () => {
            const a = escolherAcao(q.sorteio, undefined, q.ultimaAcao);
            q.ultimaAcao = a; q.feitas += 1;
            acao(q, a, () => seguir(q));
          });
        };
        if (passeantes.get(parceiro.v.chave) === parceiro && parceiro.v.fase === "fazendo_algo") { limparTimer(parceiro); evento(parceiro, "fim_acao"); atualizar(parceiro, { acao: null }); fim(parceiro, TAMANHO_PX * 0.55); }
        fim(p, -TAMANHO_PX * 0.55);
      }, 1_600);
    });
    return true;
  }

  // ---- travessuras ----
  function planejarTravessura(p: Passeante): boolean {
    if (!travessurasAtivas() || p.travessura !== null || registro.ativas() >= 3) return false;
    const el = escolherCandidato(lerCandidatos().filter((c) => c.isConnected), p.sorteio(), registro.elementos());
    if (el === null) return false;
    const r = el.getBoundingClientRect();
    const area = lerAmbiente().area;
    const alvo = { x: limitarX(r.left + r.width / 2, area, TAMANHO_PX) - TAMANHO_PX / 2, y: Math.min(area.chao - TAMANHO_PX + AFUNDO_PX, Math.max(0, r.bottom - TAMANHO_PX + 6)) };
    const sorteio = p.sorteio();
    const tipo: "carregar" | "empurrar" | "quicar" = sorteio < 0.6 ? "carregar" : sorteio < 0.85 ? "empurrar" : "quicar";
    const limite = limiteDeRecorte(el, { win });
    const rect: Retangulo = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    const sinal = p.sorteio() < 0.5 ? -1 : 1;
    const dist = 120 + p.sorteio() * 240;
    let dx = sinal * dist;
    let dy = (p.sorteio() - 0.5) * dist * 0.8;
    const tetoY = win.innerHeight * 0.68; // longe do campo de entrada do terminal
    if (rect.bottom + dy > tetoY) dy = Math.min(dy, tetoY - rect.bottom);
    ({ dx, dy } = prenderRetangulo(rect, dx, dy, limite));
    const rot = (p.sorteio() < 0.5 ? -1 : 1) * (4 + p.sorteio() * 8);
    const dono = p.v.chave;
    const abortar = (): void => { p.plano = []; seguir(p); };
    if (tipo === "carregar") {
      p.plano = [
        () => trecho(p, alvo, VELOCIDADE_ANDAR, () => seguir(p)),
        () => { if (!registro.pegar(el, dono)) { abortar(); return; } p.travessura = el; acao(p, "pegar", () => seguir(p)); },
        () => trecho(p, { x: alvo.x + dx, y: Math.min(area.chao - TAMANHO_PX + AFUNDO_PX, alvo.y + dy) }, VELOCIDADE_CARREGAR, () => seguir(p), { el, dx, dy }),
        () => { registro.mover(el, { dx, dy, rot }, 600, { easing: "ease-out", meio: { dx, dy: dy - 10, rot: -rot / 2 } }); acao(p, "soltar", () => seguir(p)); },
      ];
    } else {
      const lado = prenderRetangulo(rect, sinal * (14 + p.sorteio() * 12), 0, limite).dx;
      const quica = tipo === "quicar";
      p.plano = [
        () => trecho(p, { x: alvo.x - Math.sign(lado || 1) * TAMANHO_PX * 0.6, y: alvo.y }, VELOCIDADE_ANDAR, () => seguir(p)),
        () => {
          if (!registro.pegar(el, dono)) { abortar(); return; }
          p.travessura = el;
          registro.mover(el, { dx: lado, dy: 0, rot: rot / 2 }, quica ? 700 : 450, { easing: "ease-out", ...(quica ? { meio: { dx: lado / 2, dy: -36, rot: -rot } } : {}) });
          acao(p, "empurrar", () => seguir(p));
        },
      ];
    }
    seguir(p);
    return true;
  }

  function decidir(p: Passeante): void {
    if (p.feitas >= p.limite) { irDormir(p); return; }
    const u = p.sorteio();
    if (u < 0.4 && planejarTravessura(p)) return;
    if (u >= 0.4 && u < 0.62 && irAoEncontro(p)) return;
    irParaAcao(p);
  }

  // ---- entrada e saída ----
  function sair(casa: Casa, indice: number, total: number, parada: boolean): boolean {
    const el = casa.elemento();
    const v = visoes.get(casa.workspaceId);
    if (el === null || v === undefined) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || r.bottom < 0 || r.top > win.innerHeight || r.right < 0 || r.left > win.innerWidth) return false;
    const semente = hash32(casa.chave);
    const sorteio = fazerSorteio(semente);
    const p: Passeante = {
      v: { chave: casa.chave, workspaceId: casa.workspaceId, fase: "no_posto", acao: null, x: r.left + r.width / 2 - TAMANHO_PX / 2, y: r.top + r.height / 2 - TAMANHO_PX / 2, ms: 0, dir: 1, tam: TAMANHO_PX, especie: v.especie, estagio: v.estagio, humor: "ocioso", doente: v.doente, carga: false, quieto: false },
      timer: null, sorteio, semente, ciclo: 0, feitas: 0, limite: 2 + Math.floor(sorteio() * 3), ultimaAcao: null, plano: [], lugarId: null, travessura: null,
    };
    evento(p, "ocioso");
    passeantes.set(casa.chave, p);
    if (parada) {
      p.plano = [
        () => trecho(p, caixaNoLugar(posicaoDaParada(lerAmbiente().area, TAMANHO_PX, indice, total), TAMANHO_PX), VELOCIDADE_ANDAR * 2.2, () => seguir(p)),
        () => acao(p, "dancar", () => seguir(p)),
      ];
    }
    publicar();
    armar(p, 60 + indice * 140, () => { evento(p, "saiu"); atualizar(p, {}); seguir(p); }); // um instante no lugar, para a transição sair dali
    return true;
  }

  function alvoDaCasa(p: Passeante): { x: number; y: number } {
    const el = (casas.get(p.v.chave) ?? casas.get("slot") ?? [...casas.values()][0])?.elemento() ?? null;
    if (el === null) return { x: p.v.x, y: Math.min(p.v.y, win.innerHeight - TAMANHO_PX) };
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 - TAMANHO_PX / 2, y: r.top + r.height / 2 - TAMANHO_PX / 2 };
  }

  function remover(p: Passeante): void {
    limparTimer(p);
    passeantes.delete(p.v.chave);
    if (passeantes.size === 0) { ambiente = null; candidatos = null; registro.restaurarTudo({ animado: false }); }
    publicar();
  }

  function voltarUm(p: Passeante, motivo: "atividade" | "trabalho", animado: boolean): void {
    if (p.v.fase === "voltando") return;
    limparTimer(p);
    if (p.v.fase === "no_posto") { remover(p); return; }
    evento(p, motivo);
    p.plano = [];
    const aqui = medidor?.(p.v.chave) ?? { x: p.v.x, y: p.v.y };
    const alvo = alvoDaCasa(p);
    const ms = animado ? duracaoDoTrecho(distancia(aqui, alvo), VELOCIDADE_VOLTAR, VOLTAR_MIN_MS, VOLTAR_MAX_MS) : 0;
    atualizar(p, { acao: null, carga: false, x: alvo.x, y: alvo.y, ms, dir: alvo.x >= aqui.x ? 1 : -1 });
    if (ms === 0) { evento(p, "voltou"); remover(p); return; }
    armar(p, ms + 20, () => { evento(p, "voltou"); remover(p); });
  }

  function voltarTodos(motivo: "atividade" | "trabalho", animado: boolean): void {
    if (timerEstatico !== null) { clearT(timerEstatico); timerEstatico = null; }
    for (const p of [...passeantes.values()]) voltarUm(p, motivo, animado);
  }

  /** Recalcula quem deve estar fora e quem deve voltar. Barato: sai cedo quando ninguém passeia e ninguém pode. */
  function reavaliar(): void {
    if (timerReavaliar !== null) { clearT(timerReavaliar); timerReavaliar = null; }
    if (!ctx.ocioso && !ctx.forcado) return; // atividade já mandou todos voltarem
    if (ctx.oculta || ctx.semMovimento || !ctx.mostrar || (!ctx.forcado && !ctx.ligado)) { if (passeantes.size > 0) voltarTodos("atividade", false); return; }
    const t = agora();
    // quem começou a trabalhar volta; quem trabalhou há pouco ainda espera o sossego
    if (!ctx.forcado) for (const p of [...passeantes.values()]) if (trabalhando(visoes.get(p.v.workspaceId))) { registro.restaurarDe(p.v.chave, { animado: true }); voltarUm(p, "trabalho", true); }
    let espera = Infinity;
    const aptos: Array<{ chave: string; em: number }> = [];
    for (const casa of casas.values()) {
      if (passeantes.has(casa.chave)) continue;
      const v = visoes.get(casa.workspaceId);
      if (v === undefined) continue;
      const ocupado = trabalhando(v);
      const faltaSossego = (ultimoTrabalho.get(casa.workspaceId) ?? -Infinity) + SOSSEGO_APOS_TRABALHO_MS - t;
      if (!podePassear(ctx, ocupado || (!ctx.forcado && faltaSossego > 0))) { if (!ocupado && faltaSossego > 0) espera = Math.min(espera, faltaSossego); continue; }
      aptos.push({ chave: casa.chave, em: v.em });
    }
    const livres = Math.max(0, LIMITE_SOLTOS - passeantes.size);
    const escolhidos = selecionarPasseantes(aptos, livres);
    escolhidos.forEach((chave, i) => { const c = casas.get(chave); if (c !== undefined) sair(c, i, escolhidos.length, ctx.forcado); });
    if (Number.isFinite(espera)) timerReavaliar = setT(() => { timerReavaliar = null; reavaliar(); }, espera + 50);
  }

  // ---- segredo ----
  function encerrarSegredo(): void {
    if (timerSegredo !== null) { clearT(timerSegredo); timerSegredo = null; }
    if (!ctx.forcado) return;
    recalcularContexto({ forcado: false });
    registro.restaurarTudo({ animado: true });
    voltarTodos("atividade", true);
  }
  function segredo(): void {
    if (!prefs.mostrar || casas.size === 0) return;
    if (prefs.silenciar || reduzido()) { segredoEstatico(); return; }
    if (ctx.forcado) return;
    recalcularContexto({ forcado: true, ocioso: ctx.ocioso });
    timerSegredo = setT(encerrarSegredo, SEGREDO_MS);
    reavaliar();
  }
  /** Animações silenciadas: um aviso e uma pose parada de 1 s no centro, sem movimento nenhum. */
  function segredoEstatico(): void {
    deps.avisar?.("Animações silenciadas: os bichinhos só fazem uma pose rápida.");
    if (passeantes.size > 0 || timerEstatico !== null) return;
    const amb = lerAmbiente();
    const lista = [...casas.values()].filter((c) => visoes.has(c.workspaceId)).slice(0, LIMITE_SOLTOS);
    lista.forEach((casa, i) => {
      const v = visoes.get(casa.workspaceId)!;
      const l = caixaNoLugar(posicaoDaParada(amb.area, TAMANHO_PX, i, lista.length), TAMANHO_PX);
      const p: Passeante = { v: { chave: casa.chave, workspaceId: casa.workspaceId, fase: "fazendo_algo", acao: "dancar", x: l.x, y: l.y, ms: 0, dir: 1, tam: TAMANHO_PX, especie: v.especie, estagio: v.estagio, humor: "comemorando", doente: false, carga: false, quieto: true }, timer: null, sorteio: () => 0.5, semente: 0, ciclo: 0, feitas: 0, limite: 0, ultimaAcao: null, plano: [], lugarId: null, travessura: null };
      passeantes.set(casa.chave, p);
    });
    publicar();
    timerEstatico = setT(() => { timerEstatico = null; for (const p of [...passeantes.values()]) { passeantes.delete(p.v.chave); } ambiente = null; publicar(); }, SEGREDO_ESTATICO_MS);
  }

  // ---- atividade ----
  function aoAtividade(tipo: TipoAtividade, _quieto: boolean): void {
    if (ctx.forcado) { if (tipo === "clique" || tipo === "escape") encerrarSegredo(); return; }
    recalcularContexto({ ocioso: false });
    if (timerEstatico !== null) return; // pose estática de 1 s: termina sozinha
    if (passeantes.size === 0 && registro.ativas() === 0) return;
    registro.restaurarTudo({ animado: true }); // ≤ 150 ms: os elementos nunca ficam deslocados com o usuário tentando clicar
    voltarTodos("atividade", true);
  }
  function aoOcioso(): void { recalcularContexto({ ocioso: true }); reavaliar(); }

  // ---- pontos de segurança ----
  const aoOcultar = (): void => {
    const oculta = doc.visibilityState === "hidden";
    recalcularContexto({ oculta });
    if (oculta) { registro.restaurarTudo({ animado: false }); voltarTodos("atividade", false); encerrarSegredoSilencioso(); }
  };
  function encerrarSegredoSilencioso(): void { if (timerSegredo !== null) { clearT(timerSegredo); timerSegredo = null; } if (ctx.forcado) recalcularContexto({ forcado: false }); }
  const aoPerderFoco = (): void => registro.restaurarTudo({ animado: false });
  const aoSair = (): void => registro.restaurarTudo({ animado: false });

  function iniciar(): () => void {
    if (iniciado) return () => undefined;
    iniciado = true;
    recalcularContexto({ oculta: doc.visibilityState === "hidden" });
    detector = criarDetector({ alvo: win, doc, agora, setT, clearT, ms: () => prefs.minutos * 60_000, aoOcioso, aoAtividade });
    detector.iniciar();
    soltarListeners = [ligarSegredo(win, segredo)];
    doc.addEventListener("visibilitychange", aoOcultar);
    win.addEventListener("blur", aoPerderFoco);
    win.addEventListener("beforeunload", aoSair);
    win.addEventListener("pagehide", aoSair);
    let mq: MediaQueryList | null = null;
    const aoMudarMovimento = (): void => { recalcularContexto(); reavaliar(); };
    try { mq = typeof win.matchMedia === "function" ? win.matchMedia("(prefers-reduced-motion: reduce)") : null; mq?.addEventListener?.("change", aoMudarMovimento); } catch { mq = null; }
    const desfazerRegistro = registro.aoRestaurarTudo(() => { for (const p of passeantes.values()) p.travessura = null; });
    return () => {
      detector?.parar(); detector = null;
      for (const f of soltarListeners) f();
      soltarListeners = [];
      doc.removeEventListener("visibilitychange", aoOcultar);
      win.removeEventListener("blur", aoPerderFoco);
      win.removeEventListener("beforeunload", aoSair);
      win.removeEventListener("pagehide", aoSair);
      try { mq?.removeEventListener?.("change", aoMudarMovimento); } catch { /* idem */ }
      desfazerRegistro();
      for (const t of [timerSegredo, timerReavaliar, timerEstatico]) if (t !== null) clearT(t);
      timerSegredo = timerReavaliar = timerEstatico = null;
      registro.restaurarTudo({ animado: false });
      for (const p of [...passeantes.values()]) { limparTimer(p); passeantes.delete(p.v.chave); }
      ambiente = null; candidatos = null; recalcularContexto({ forcado: false, ocioso: false });
      publicar();
      iniciado = false;
    };
  }

  return {
    iniciar,
    assinar(o: () => void): () => void { ouvintes.add(o); return () => void ouvintes.delete(o); },
    obterVistas: (): readonly VistaPasseante[] => vistas,
    obterFora: (): ReadonlySet<string> => fora,
    registrarCasa(casa: Casa): () => void {
      casas.set(casa.chave, casa);
      if (ctx.ocioso || ctx.forcado) reavaliar();
      return () => { if (casas.get(casa.chave) === casa) casas.delete(casa.chave); };
    },
    definirPreferencias(p: Partial<Preferencias>): void {
      prefs = { ...prefs, ...p, minutos: limitarMinutos(p.minutos ?? prefs.minutos) };
      recalcularContexto();
      detector?.reprogramar();
      if (ctx.semMovimento || !ctx.ligado || !ctx.mostrar) { if (passeantes.size > 0 && timerEstatico === null) { registro.restaurarTudo({ animado: false }); voltarTodos("atividade", false); } return; }
      reavaliar();
    },
    definirVisoes(mapa: ReadonlyMap<string, BichinhoVisao>): void {
      visoes = mapa;
      const t = agora();
      for (const v of mapa.values()) if (trabalhando(v)) ultimoTrabalho.set(v.workspace_id, t);
      if (ctx.ocioso || ctx.forcado || passeantes.size > 0) reavaliar();
    },
    definirMedidor(f: ((chave: string) => { x: number; y: number } | null) | null): void { medidor = f; },
    segredo,
    registro,
    /** estado interno somente para teste. */
    _contexto: (): ContextoPasseio => ctx,
    _soltos: (): number => passeantes.size,
  };
}
export type ControlePasseio = ReturnType<typeof criarControle>;

let padrao: ControlePasseio | null = null;
export function controlePadrao(): ControlePasseio { padrao ??= criarControle(); return padrao; }

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { PRODUTO } from "../../nucleo/produto";
import { Icone } from "../componentes/Icone";
import {
  agregarSelos, alternarFixada, alternarGrupo, formatarSelo, gravarPrefs, lerPrefs, MAX_FIXADAS,
  type PrefsMenu, type Selo, type Selos,
} from "../estado/menu-grupos";
import { SlotBichinho } from "./SlotBichinho";
import { GRUPOS, grupoDaTela, TELAS, telasDoGrupo, type DefGrupo, type DefTela, type GrupoId, type TelaId } from "./telas";

interface Props {
  ativa: TelaId;
  fixado: boolean;
  aoSelecionar: (id: TelaId) => void;
  aoFixar: () => void;
  /** Indicadores por tela (ex.: alertas não lidos); agregam no cabeçalho do grupo fechado. */
  selos?: Selos;
  /** Muda a cada pedido de tela: reabre o grupo da tela ativa mesmo se ela já era a ativa. */
  sinalRevelar?: number;
  /** Preferências iniciais (testes); por padrão lê do armazenamento local. */
  prefsIniciais?: PrefsMenu;
  salvar?: (p: PrefsMenu) => void;
}

function temFocoVisivel(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}

function SeloVisual({ selo, rotulo }: { selo: Selo; rotulo: string }) {
  return (
    <>
      <span className="menu-selo" data-critico={selo.critico || undefined} aria-hidden="true">{formatarSelo(selo.valor)}</span>
      <span className="sr-somente"> ({selo.valor} {rotulo})</span>
    </>
  );
}

const ROTULO_SELO = "pendentes";

/**
 * Menu lateral agrupado: 56 px recolhido (ícones); abre a 232 px por cima com hover/foco de teclado; "fixar" empurra o conteúdo.
 * Grupos expansíveis (disclosure), até 3 telas fixadas no topo, modo só-ícones com flyout por grupo.
 * Teclado: ↑/↓/Home/End percorrem, → expande (ou entra no grupo), ← recolhe (ou volta ao cabeçalho), Enter/Espaço ativam.
 */
export const Menu = memo(function Menu({ ativa, fixado, aoSelecionar, aoFixar, selos = {}, sinalRevelar = 0, prefsIniciais, salvar }: Props) {
  const [sobre, setSobre] = useState(false);
  const [foco, setFoco] = useState(false);
  const [prefs, setPrefs] = useState<PrefsMenu>(() => prefsIniciais ?? lerPrefs());
  const [flyout, setFlyout] = useState<{ grupo: GrupoId; topo: number } | null>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const focoPendente = useRef<string | null>(null);
  const idBase = useId();

  const modoIcones = prefs.compacto && !fixado;
  const aberto = fixado || (!prefs.compacto && (sobre || foco));

  const atualizar = useCallback((f: (p: PrefsMenu) => PrefsMenu) => {
    setPrefs((p) => f(p));
  }, []);
  useEffect(() => { (salvar ?? gravarPrefs)(prefs); }, [prefs, salvar]);

  // O grupo da tela ativa abre sozinho (ao navegar por clique, paleta ou atalho).
  useEffect(() => {
    atualizar((p) => alternarGrupo(p, grupoDaTela(ativa), true));
  }, [ativa, sinalRevelar, atualizar]);

  // foco programático depois de um render (ex.: → entra no primeiro item do grupo recém-aberto)
  useEffect(() => {
    const alvo = focoPendente.current;
    if (alvo === null) return;
    focoPendente.current = null;
    raiz.current?.querySelector<HTMLElement>(`[data-nav="${alvo}"]`)?.focus();
  });

  // flyout: fecha ao clicar fora, ao sair do modo só-ícones
  useEffect(() => {
    if (flyout === null) return;
    const fora = (e: MouseEvent) => { if (!raiz.current?.contains(e.target as Node)) setFlyout(null); };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [flyout]);
  useEffect(() => { if (!modoIcones) setFlyout(null); }, [modoIcones]);

  const aoSairFoco = useCallback((e: FocusEvent) => {
    if (!raiz.current?.contains(e.relatedTarget as Node | null)) { setFoco(false); setFlyout(null); }
  }, []);

  const seloDe = useCallback((g: DefGrupo) => agregarSelos(selos, telasDoGrupo(g.id).map((t) => t.id)), [selos]);
  const porId = useMemo(() => new Map(TELAS.map((t) => [t.id, t] as const)), []);
  const fixadas = prefs.fixados.map((id) => porId.get(id)).filter((t): t is DefTela => t !== undefined);

  const abrirFlyout = (g: GrupoId, botao: HTMLElement, focarPrimeiro: boolean) => {
    const caixa = botao.getBoundingClientRect();
    const raizCaixa = raiz.current?.getBoundingClientRect();
    setFlyout((f) => (f?.grupo === g && !focarPrimeiro ? null : { grupo: g, topo: Math.max(0, caixa.top - (raizCaixa?.top ?? 0)) }));
    if (focarPrimeiro) focoPendente.current = `item:${telasDoGrupo(g)[0]!.id}:flyout`;
  };

  const aoClicarGrupo = (g: DefGrupo, e: { currentTarget: HTMLElement }) => {
    if (modoIcones) abrirFlyout(g.id, e.currentTarget, false);
    else atualizar((p) => alternarGrupo(p, g.id));
  };

  const escolher = (id: TelaId) => {
    setFlyout(null);
    aoSelecionar(id);
  };

  const aoTeclar = (e: KeyboardEvent<HTMLElement>) => {
    const alvo = e.target as HTMLElement;
    const chave = alvo.dataset["nav"];
    if (chave === undefined || e.altKey || e.ctrlKey || e.metaKey) return;
    const itens = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-nav]")];
    const i = itens.indexOf(alvo);
    const ir = (n: number) => { e.preventDefault(); itens[(n + itens.length) % itens.length]?.focus(); };
    const grupoAlvo = alvo.dataset["grupo"] as GrupoId | undefined;
    const ehCabecalho = chave.startsWith("grupo:");
    const noFlyout = chave.endsWith(":flyout");
    switch (e.key) {
      case "ArrowDown": ir(i + 1); break;
      case "ArrowUp": ir(i - 1); break;
      case "Home": ir(0); break;
      case "End": ir(itens.length - 1); break;
      case "ArrowRight":
        if (!ehCabecalho || grupoAlvo === undefined) break;
        e.preventDefault();
        if (modoIcones) abrirFlyout(grupoAlvo, alvo, true);
        else if (!prefs.abertos.includes(grupoAlvo)) atualizar((p) => alternarGrupo(p, grupoAlvo, true));
        else itens[i + 1]?.focus();
        break;
      case "Escape":
        if (flyout === null) break;
        e.preventDefault();
        setFlyout(null);
        focoPendente.current = `grupo:${flyout.grupo}`;
        break;
      case "ArrowLeft":
        if (grupoAlvo === undefined) break;
        e.preventDefault();
        if (noFlyout) {
          setFlyout(null);
          focoPendente.current = `grupo:${grupoAlvo}`;
        } else if (ehCabecalho) {
          if (modoIcones) setFlyout(null);
          else atualizar((p) => alternarGrupo(p, grupoAlvo, false));
        } else {
          raiz.current?.querySelector<HTMLElement>(`[data-nav="grupo:${grupoAlvo}"]`)?.focus();
        }
        break;
      case "p":
      case "P":
        if (!ehCabecalho && chave.startsWith("item:")) {
          e.preventDefault();
          atualizar((p) => alternarFixada(p, chave.split(":")[1] as TelaId));
        }
        break;
    }
  };

  /** Uma tela: botão de navegação + botão de fixar (aparece em hover/foco; não ocupa espaço). */
  const linha = (t: DefTela, contexto: "grupo" | "fixados" | "flyout") => {
    const selo = selos[t.id];
    const fixada = prefs.fixados.includes(t.id);
    const rotuloId = `${idBase}-${contexto}-${t.id}`;
    return (
      <div className="menu-linha" key={t.id}>
        <button
          type="button"
          className="menu-item menu-subitem"
          data-nav={`item:${t.id}${contexto === "flyout" ? ":flyout" : ""}`}
          data-grupo={t.grupo}
          title={t.rotulo}
          aria-keyshortcuts="P"
          aria-current={t.id === ativa ? "page" : undefined}
          onClick={() => escolher(t.id)}
        >
          <Icone nome={t.icone} />
          <span className="menu-rotulo" id={rotuloId}>{t.rotulo}</span>
          {selo !== undefined && selo.valor > 0 ? <SeloVisual selo={selo} rotulo={ROTULO_SELO} /> : null}
        </button>
        {contexto !== "fixados" ? (
          <button
            type="button"
            className="menu-fixar-item"
            aria-label="Fixar no topo"
            aria-describedby={rotuloId}
            aria-pressed={fixada}
            title={fixada ? "Desafixar do topo (P)" : prefs.fixados.length >= MAX_FIXADAS ? `Fixar no topo (P) — máx. ${MAX_FIXADAS}: a mais antiga sai` : "Fixar no topo (P)"}
            tabIndex={-1}
            onClick={() => atualizar((p) => alternarFixada(p, t.id))}
          >
            <Icone nome="fixar" />
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <div
      ref={raiz}
      className="menu"
      data-aberto={aberto || undefined}
      data-fixado={fixado || undefined}
      data-icones={modoIcones || undefined}
      onMouseEnter={() => setSobre(true)}
      onMouseLeave={() => setSobre(false)}
      onFocus={(e) => temFocoVisivel(e.target) && setFoco(true)}
      onBlur={aoSairFoco}
    >
      <div className="menu-painel">
        <div className="menu-identidade">
          <span className="menu-simbolo" aria-hidden="true" />
          <strong className="menu-nome">{PRODUTO.nome}</strong>
        </div>
        <nav aria-label="Principal" className="menu-lista" onKeyDown={aoTeclar}>
          {fixadas.length > 0 ? (
            <div role="group" aria-label="Fixados" className="menu-fixados">
              <div className="menu-secao" aria-hidden="true"><span className="menu-rotulo">Fixados</span></div>
              {fixadas.map((t) => linha(t, "fixados"))}
            </div>
          ) : null}
          {GRUPOS.map((g) => {
            const telas = telasDoGrupo(g.id);
            const abertoGrupo = !modoIcones && prefs.abertos.includes(g.id);
            const seloGrupo = abertoGrupo ? null : seloDe(g);
            const contemAtiva = telas.some((t) => t.id === ativa);
            const idLista = `${idBase}-lista-${g.id}`;
            return (
              <div className="menu-grupo" key={g.id} data-aberto={abertoGrupo || undefined}>
                <button
                  type="button"
                  className="menu-item menu-cabecalho"
                  data-nav={`grupo:${g.id}`}
                  data-grupo={g.id}
                  data-contem-ativa={(contemAtiva && !abertoGrupo) || undefined}
                  title={g.rotulo}
                  aria-expanded={modoIcones ? flyout?.grupo === g.id : abertoGrupo}
                  aria-controls={abertoGrupo ? idLista : undefined}
                  aria-haspopup={modoIcones ? "true" : undefined}
                  onClick={(e) => aoClicarGrupo(g, e)}
                >
                  <Icone nome={g.icone} />
                  <span className="menu-rotulo">{g.rotulo}</span>
                  <span className="menu-contagem" aria-hidden="true">{telas.length}</span>
                  {seloGrupo !== null ? <SeloVisual selo={seloGrupo} rotulo={ROTULO_SELO} /> : null}
                  <Icone nome="chevron" className="menu-chevron" />
                </button>
                {abertoGrupo ? (
                  <div id={idLista} className="menu-subitens" role="group" aria-label={g.rotulo}>
                    {telas.map((t) => linha(t, "grupo"))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>
        <SlotBichinho recolhido={!aberto} />
        <div className="menu-rodape">
          <button type="button" className="menu-item menu-fixar" aria-pressed={prefs.compacto} title="Só ícones: o menu não abre ao passar o mouse; cada grupo abre um painel" onClick={() => atualizar((p) => ({ ...p, compacto: !p.compacto }))}>
            <Icone nome="menos" />
            <span className="menu-rotulo">Só ícones</span>
          </button>
          <button type="button" className="menu-item menu-fixar" aria-pressed={fixado} title="Fixar menu" onClick={aoFixar}>
            <Icone nome="fixar" />
            <span className="menu-rotulo">{fixado ? "Desafixar menu" : "Fixar menu"}</span>
          </button>
        </div>
      </div>
      {flyout !== null ? (
        <div className="menu-flyout" role="group" aria-label={GRUPOS.find((g) => g.id === flyout.grupo)?.rotulo} style={{ top: flyout.topo }} onKeyDown={aoTeclar}>
          <div className="menu-secao"><span>{GRUPOS.find((g) => g.id === flyout.grupo)?.rotulo}</span></div>
          {telasDoGrupo(flyout.grupo).map((t) => linha(t, "flyout"))}
        </div>
      ) : null}
    </div>
  );
});

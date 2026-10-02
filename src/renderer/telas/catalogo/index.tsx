// Tela Catálogo (Fase 7): chunk lazy; NADA roda no boot (a varredura/lista só ao abrir a tela). Casca compacta (D-32): UMA linha de
// controles (~28 px) com abas de tipo, busca, filtros por CLI, origem/estado, atualizar, "N ausentes", Política, Skills do produto e
// badge de saúde; a tabela ocupa o resto. Busca e filtros são locais sobre o cache (zero IPC por tecla). Texto de terceiro só como texto.
import "./catalogo.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiAde } from "../../../compartilhado/ipc";
import { ade } from "../../ade";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { Dialogo } from "../../componentes/Dialogo";
import { Icone } from "../../componentes/Icone";
import { SubNavegacao } from "../../componentes/SubNavegacao";
import { aoPedirCatalogo } from "../../estado/catalogo-acoes";
import { storeCatalogo, useCatalogo, type StoreCatalogo } from "../../estado/catalogo";
import { storeWorkspaces, useWorkspaces, type StoreWorkspaces } from "../../estado/workspaces";
import { Gaveta } from "./Gaveta";
import { DialogoEmbarcadas } from "./Embarcadas";
import { DialogoPolitica } from "./Politica";
import { Tabela } from "./Tabela";
import {
  ABAS, CLIS, ehSomenteLeituraDoTipo, filtrarItens, montarLinhas, mensagemDoCodigo, mensagemDoErro, ORIGENS, quantosAusentes, ROTULO_ESTADO, ROTULO_ORIGEM, temFiltroAtivo, textoAusentes, textoContagem, type EstadoFiltro,
} from "./logica";

type Api = ApiAde["catalogo"];

export interface PropsTelaCatalogo {
  store?: StoreCatalogo;
  workspaces?: StoreWorkspaces;
  api?: Api | undefined;
}

type Dialogos = "politica" | "embarcadas" | "saude" | "limpar" | null;

export function TelaCatalogo({ store = storeCatalogo, workspaces = storeWorkspaces, api: apiProp }: PropsTelaCatalogo) {
  const api = apiProp ?? ade()?.catalogo;
  const est = useCatalogo(store);
  const { atual } = useWorkspaces(workspaces);
  const workspaceId = atual?.id ?? null;
  const [dialogo, setDialogo] = useState<Dialogos>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [recolhidos, setRecolhidos] = useState<ReadonlySet<string>>(new Set());
  const buscaRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void store.iniciar().then(() => store.aoAbrirTela()); }, [store]);
  useEffect(() => {
    if (aviso === null) return undefined;
    const t = setTimeout(() => setAviso(null), 7000);
    return () => clearTimeout(t);
  }, [aviso]);
  useEffect(() => aoPedirCatalogo((a) => {
    if (a === "atualizar") void store.varrer();
    else if (a === "politica") setDialogo("politica");
    else buscaRef.current?.focus();
  }), [store]);

  const { aba, filtros, cache, selecionado } = est;
  const c = cache[aba];
  const itens = c?.itens ?? [];
  const visiveis = useMemo(() => (c === undefined ? [] : filtrarItens(c.itens, filtros, c.indice)), [c, filtros]);
  const linhas = useMemo(() => montarLinhas(visiveis, filtros.agrupar, recolhidos), [visiveis, filtros.agrupar, recolhidos]);
  const ausentes = useMemo(() => quantosAusentes(itens), [itens]);
  const itemSel = selecionado === null ? null : itens.find((i) => i.id === selecionado) ?? null;
  const achadosErro = est.saude.filter((a) => a.nivel === "erro").length;
  const rotuloAba = ABAS.find((a) => a.tipo === aba)?.rotulo ?? "";

  const alternarGrupo = useCallback((r: string) => setRecolhidos((s) => { const n = new Set(s); if (n.has(r)) n.delete(r); else n.add(r); return n; }), []);
  const alternarCli = (cli: (typeof CLIS)[number]["cli"]) => {
    const cur = filtros.clis;
    store.definirFiltros({ clis: cur.includes(cli) ? cur.filter((x) => x !== cli) : [...cur, cli] });
  };

  if (api === undefined || !est.disponivel) {
    return <EstadoVazio icone="catalogo" titulo="Catálogo indisponível" texto="Esta tela precisa do aplicativo desktop: abra o app para ver skills, agentes, comandos e MCPs das suas CLIs." />;
  }

  const semDados = c !== undefined && itens.length === 0;
  const carregandoInicial = c === undefined && est.erro === null;
  const skills = cache["skill"]?.itens ?? [];
  const servidores = cache["mcp_server"]?.itens ?? [];

  async function limpar(): Promise<void> {
    setDialogo(null);
    try { const r = await api!.limparAusentes(aba); void store.recarregar(); setAviso(`${r.removidos} removido(s) do catálogo.`); }
    catch (e) { setAviso(mensagemDoErro(e)); }
  }

  return (
    <section className="cat-tela" data-modo="leitura" data-largura="larga" aria-label="Catálogo">
     <SubNavegacao
      base="cat" rotulo="Tipo de item" ativo={aba} recolhivel classePainel="cat-corpo sem-pad"
      itens={ABAS.map((a) => ({ id: a.tipo, rotulo: a.rotulo, icone: a.icone }))}
      onMudar={(t) => void store.definirAba(t)}
      barra={<>
      <div className="cat-barra" role="toolbar" aria-label="Controles do Catálogo">
        <div className="cat-busca" role="search">
          <Icone nome="busca" />
          <input ref={buscaRef} type="search" aria-label={`Buscar em ${rotuloAba}`} placeholder="Buscar" value={filtros.busca} onChange={(e) => store.definirFiltros({ busca: e.target.value })} />
        </div>
        <div className="cat-filtros" role="group" aria-label="Filtrar por CLI">
          {CLIS.map((x) => (
            <button key={x.cli} type="button" className="cat-btn cat-btn-cli" aria-pressed={filtros.clis.includes(x.cli)} title={`Só itens em ${x.rotulo}`} aria-label={x.rotulo} onClick={() => alternarCli(x.cli)}>{x.sigla}</button>
          ))}
        </div>
        <select className="cat-select" aria-label="Origem" title={filtros.origem === "todas" ? "Todas as origens" : ROTULO_ORIGEM[filtros.origem]} value={filtros.origem} onChange={(e) => store.definirFiltros({ origem: e.target.value as typeof filtros.origem })}>
          <option value="todas">Todas as origens</option>
          {ORIGENS.map((o) => <option key={o} value={o}>{ROTULO_ORIGEM[o]}</option>)}
        </select>
        <select className="cat-select" aria-label="Estado" title={ROTULO_ESTADO[filtros.estado]} value={filtros.estado} onChange={(e) => store.definirFiltros({ estado: e.target.value as EstadoFiltro })}>
          <option value="todos">Qualquer estado</option><option value="presente">Presente</option><option value="ausente">Ausente</option><option value="quebrado">Quebrado</option>
        </select>
        <button type="button" className="cat-btn" aria-pressed={filtros.soDivergentes} title="Só itens com conteúdo diferente entre CLIs" onClick={() => store.definirFiltros({ soDivergentes: !filtros.soDivergentes })}>Divergentes</button>
        <button type="button" className="cat-btn" aria-pressed={filtros.agrupar} title="Agrupar por plugin ou autor" onClick={() => store.definirFiltros({ agrupar: !filtros.agrupar })}>Agrupar</button>
        <span className="cat-contagem" role="status" aria-live="polite">{c === undefined ? "" : textoContagem(visiveis.length, itens.length)}</span>
        {ausentes > 0 ? <button type="button" className="cat-btn" title="Remover do catálogo o que não existe mais no disco" onClick={() => setDialogo("limpar")}>{textoAusentes(ausentes)}</button> : null}
        <button type="button" className="cat-btn" onClick={() => setDialogo("politica")} title="Quais skills e MCPs cada Pane recebe">Política</button>
        <button type="button" className="cat-btn" onClick={() => setDialogo("embarcadas")} title="Skills que acompanham o app">Skills do produto</button>
        {achadosErro > 0 || est.saude.length > 0 ? (
          <button type="button" className="cat-btn" data-tom={achadosErro > 0 ? "alerta" : "aviso"} onClick={() => setDialogo("saude")} title="Achados de saúde do catálogo">{achadosErro > 0 ? `${achadosErro} erro(s)` : `${est.saude.length} aviso(s)`}</button>
        ) : null}
        <button type="button" className="cat-btn cat-btn-icone" aria-label="Atualizar catálogo" title={est.varrendo ? "Varredura em andamento…" : "Varrer as CLIs de novo"} disabled={est.varrendo} onClick={() => void store.varrer()}><Icone nome="atualizar" /></button>
        {est.varrendo ? <span className="cat-progresso" role="status" aria-busy="true">Varrendo{est.progresso !== null ? ` ${est.progresso.feitos}${est.progresso.total !== null ? `/${est.progresso.total}` : ""}` : "…"}</span> : null}
        {aviso !== null ? <span className="cat-aviso-topo" role="status" title={aviso}>{aviso}</span> : null}
      </div>
      {est.errosCli.length > 0 ? (
        <ul className="cat-erros-cli" aria-label="Erros por CLI">
          {est.errosCli.map((e) => <li key={`${e.cli}:${e.tipo}:${e.codigo}`} className="erro-caixa" role="status">{e.cli ?? "geral"}{e.tipo !== null ? ` / ${e.tipo}` : ""}: {e.mensagem}</li>)}
        </ul>
      ) : null}
      {est.erro !== null ? <div className="erro-caixa cat-faixa" role="alert">{est.erro} <button type="button" className="cat-btn" onClick={() => void store.recarregar()}>Tentar de novo</button></div> : null}

      </>}>
        {carregandoInicial ? <div className="cat-carregando" aria-busy="true" role="status">Carregando catálogo…</div> : null}
        {semDados ? (
          <EstadoVazio icone="catalogo" titulo={`Nenhum item em ${rotuloAba}`} texto="Nenhuma CLI com itens deste tipo foi detectada. Instale uma CLI (Claude Code, Codex, OpenCode ou Gemini) ou crie itens na pasta dela, e varra de novo.">
            <button type="button" className="botao" onClick={() => void store.varrer()}>Varrer agora</button>
          </EstadoVazio>
        ) : null}
        {c !== undefined && itens.length > 0 && visiveis.length === 0 ? (
          <EstadoVazio icone="busca" titulo="Nada encontrado" texto="Nenhum item combina com a busca e os filtros.">
            {temFiltroAtivo(filtros) ? <button type="button" className="botao" onClick={() => store.limparFiltros()}>Limpar filtros</button> : null}
          </EstadoVazio>
        ) : null}
        {visiveis.length > 0 ? (
          <Tabela linhas={linhas} rotulo={rotuloAba} selecionado={selecionado} aoAbrir={(id) => void store.selecionar(id === selecionado ? null : id)} aoAlternarGrupo={alternarGrupo} />
        ) : null}
        {c?.truncado === true ? <p className="cat-nota cat-faixa" role="note">Lista truncada em 5 000 itens: use a busca para achar o resto.</p> : null}
        {itemSel !== null ? (
          <Gaveta
            api={api} item={itemSel} detalhe={est.detalhe?.id === itemSel.id ? est.detalhe : null} somenteLeituraTipo={ehSomenteLeituraDoTipo(itemSel.tipo)}
            aoFechar={() => void store.selecionar(null)} aoMudar={() => void store.recarregar()}
            aoRemovidoDoCatalogo={(id) => { store.removerLocal([id]); setAviso("Removido do catálogo."); }}
          />
        ) : null}
     </SubNavegacao>

      {dialogo === "politica" ? <DialogoPolitica api={api} workspaceId={workspaceId} skills={skills} servidores={servidores} politicas={est.politicas} aoFechar={() => setDialogo(null)} aoGravou={() => void store.recarregarExtras()} /> : null}
      {dialogo === "embarcadas" ? <DialogoEmbarcadas api={api} aoFechar={() => setDialogo(null)} aoMudar={() => void store.recarregar()} /> : null}
      {dialogo === "limpar" ? (
        <Dialogo titulo="Limpar ausentes?" aoFechar={() => setDialogo(null)}>
          <p>Remove da lista do app os itens de {rotuloAba} que não existem mais no disco. Nenhum arquivo é apagado.</p>
          <div className="dialogo-acoes">
            <button type="button" className="botao" onClick={() => setDialogo(null)}>Cancelar</button>
            <button type="button" className="botao botao-primario" data-foco-inicial onClick={() => void limpar()}>Limpar ausentes</button>
          </div>
        </Dialogo>
      ) : null}
      {dialogo === "saude" ? (
        <Dialogo titulo="Saúde do catálogo" aoFechar={() => setDialogo(null)} largura={600}>
          {est.saude.length === 0 ? <p className="cat-nota">Nenhum achado.</p> : (
            <ul className="cat-saude">{est.saude.map((a, i) => <li key={`${a.codigo}:${a.item ?? ""}:${i}`}><span className="cat-selo" data-tom={a.nivel === "erro" ? "alerta" : "aviso"}>{a.nivel === "erro" ? "erro" : "aviso"}</span> {a.item !== null ? <strong>{a.item}: </strong> : null}{a.detalhe || mensagemDoCodigo(a.codigo)}</li>)}</ul>
          )}
          <div className="dialogo-acoes"><button type="button" className="botao" onClick={() => setDialogo(null)}>Fechar</button></div>
        </Dialogo>
      ) : null}
    </section>
  );
}

export default function Tela() {
  return <TelaCatalogo />;
}

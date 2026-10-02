import { useCallback, useEffect, useState } from "react";
import type { Diff } from "../../../nucleo/vcs/tipos";
import type { RamoDetalhe, ResultadoApagarRamo, Stash, TagInfo, WorktreeEstado } from "../../../compartilhado/vcs-tipos";
import { Badge } from "../../componentes/Badge";
import { Dialogo, DialogoConfirmacao } from "../../componentes/Dialogo";
import type { NomeIcone } from "../../componentes/Icone";
import { ItemLista, type SeloLista } from "../../componentes/ItemLista";
import { SubNavegacao, type ItemSubNav } from "../../componentes/SubNavegacao";
import { VirtualLista } from "../../componentes/VirtualLista";
import { mensagemDe, useVcs } from "./contexto";
import { DialogoCampo, DialogoDigitar } from "./Dialogos";
import { DiffView } from "./diff/DiffView";

type Secao = "ramos" | "tags" | "stash" | "worktrees";
const ICONE_SECAO: Record<Secao, NomeIcone> = { ramos: "ramo", tags: "fixar", stash: "baixar", worktrees: "pasta" };
const ITENS_TIPO_SVN: ReadonlyArray<ItemSubNav<"branches" | "tags">> = [{ id: "branches", rotulo: "Branches", icone: "ramo" }, { id: "tags", rotulo: "Tags", icone: "fixar" }];

/** Linha de branch no padrão único (D-694): nome ≫ upstream/assunto ≫ selos (atual, remoto, sumiu), meta ↑/↓ e as ações de ramo. */
function ItemRamo({ r, aoTrocar, aoRenomear, aoUpstream, aoPedirApagar }: { r: RamoDetalhe; aoTrocar: () => void; aoRenomear: () => void; aoUpstream: () => void; aoPedirApagar: () => void }) {
  const selos: SeloLista[] = [];
  if (r.atual) selos.push({ texto: "atual", tom: "destaque" });
  if (r.remoto) selos.push({ texto: "remoto" });
  if (r.upstreamSumiu) selos.push({ texto: "upstream sumiu", tom: "aviso" });
  const meta = r.ahead > 0 || r.behind > 0 ? `${r.ahead > 0 ? `↑${r.ahead}` : ""}${r.ahead > 0 && r.behind > 0 ? " " : ""}${r.behind > 0 ? `↓${r.behind}` : ""}` : undefined;
  return (
    <ItemLista
      densa id={r.ref} titulo={r.nome} selos={selos} meta={meta} selecionado={r.atual}
      descricao={r.upstream !== null ? `upstream ${r.upstream}${r.upstreamSumiu ? " (sumiu)" : ""}` : r.ultimoCommit.assunto}
      acao={
        <span className="vc-ramo-acoes">
          {!r.atual && !r.remoto ? <button type="button" className="vc-mini" aria-label={`Trocar para ${r.nome}`} onClick={aoTrocar}>Trocar</button> : null}
          {!r.remoto ? <button type="button" className="vc-mini" aria-label={`Renomear ${r.nome}`} onClick={aoRenomear}>Renomear</button> : null}
          {!r.remoto ? <button type="button" className="vc-mini" aria-label={`Upstream de ${r.nome}`} onClick={aoUpstream}>Upstream</button> : null}
          {!r.remoto && !r.atual ? <button type="button" className="vc-mini vc-perigo" aria-label={`Apagar ${r.nome}`} onClick={aoPedirApagar}>Apagar</button> : null}
        </span>
      }
    />
  );
}

export function Branches() {
  const { estado } = useVcs();
  const [secao, setSecao] = useState<Secao>("ramos");
  if (estado.tipo === "svn") return <RamosSvn />;
  const abas: Array<[Secao, string]> = [["ramos", "Branches"], ["tags", "Tags"], ["stash", "Stash"], ["worktrees", "Worktrees"]];
  return (
    <div className="vc-pagina">
      <SubNavegacao base="vc-br" rotulo="Seções de branches" className="subnav-aninhada" classePainel="vc-painel-aninhado sem-pad" itens={abas.map(([id, rotulo]) => ({ id, rotulo, icone: ICONE_SECAO[id] }))} ativo={secao} onMudar={setSecao}>
        {secao === "ramos" ? <RamosGit /> : secao === "tags" ? <TagsGit /> : secao === "stash" ? <StashGit /> : <WorktreesGit />}
      </SubNavegacao>
    </div>
  );
}

function RamosGit() {
  const { api, alvo, estado, rodar, recarregar, avisar } = useVcs();
  const [lista, setLista] = useState<RamoDetalhe[] | null>(null);
  const [filtro, setFiltro] = useState("");
  const [criar, setCriar] = useState(false);
  const [renomear, setRenomear] = useState<string | null>(null);
  const [upstream, setUpstream] = useState<string | null>(null);
  const [apagar, setApagar] = useState<{ nome: string; sim: ResultadoApagarRamo } | null>(null);
  const [troca, setTroca] = useState<{ destino: string; arquivos: string[] } | null>(null);

  const carregar = useCallback(async () => { try { setLista(await api.ramos(alvo, "listar", { remotos: true })); } catch { setLista([]); } }, [api, alvo]);
  useEffect(() => { void carregar(); }, [carregar, estado.status.oid]);

  const aposEscrever = async (): Promise<void> => { await carregar(); await recarregar(); };
  const trocar = async (destino: string, estrategia: "cancelar" | "levar" | "stash" | null): Promise<void> => {
    const r = await rodar(() => api.ramos(alvo, "trocar", { destino, estrategia }));
    if (r === undefined) return;
    if (!r.trocou) setTroca({ destino, arquivos: r.arquivos });
    else { setTroca(null); avisar(`Agora em ${r.para}${r.stashCriado !== null ? " (mudanças guardadas em stash)" : r.levouMudancas ? " (mudanças levadas)" : ""}.`); await aposEscrever(); }
  };
  const pedirApagar = async (nome: string): Promise<void> => {
    const sim = await rodar(() => api.ramos(alvo, "apagar", { nome, forcar: false, simular: true, confirmacao: null }));
    if (sim !== undefined) setApagar({ nome, sim });
  };
  const apagarDeVez = async (nome: string, forcar: boolean): Promise<void> => {
    const r = await rodar(() => api.ramos(alvo, "apagar", { nome, forcar, simular: false, confirmacao: forcar ? nome : null }));
    setApagar(null);
    if (r !== undefined) { avisar(`Branch ${nome} apagado (ponta anterior ${r.hashAnterior.slice(0, 7)}: dá para recriar).`); await aposEscrever(); }
  };

  const visiveis = (lista ?? []).filter((r) => r.nome.toLowerCase().includes(filtro.toLowerCase()));
  return (
    <div className="vc-secao">
      <div className="vc-secao-barra">
        <input className="vc-campo" aria-label="Filtrar branches" placeholder="Filtrar…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        <button type="button" className="botao botao-primario vc-compacto" onClick={() => setCriar(true)}>Novo branch</button>
      </div>
      {lista === null ? <div aria-busy="true" className="vc-vazio">Carregando…</div> : (
        <VirtualLista itens={visiveis} alturaItem={38} rotulo="Branches" chave={(r) => r.ref} className="vc-lista-grande" renderItem={(r) => (
          <ItemRamo
            r={r}
            aoTrocar={() => void trocar(r.nome, null)}
            aoRenomear={() => setRenomear(r.nome)}
            aoUpstream={() => setUpstream(r.nome)}
            aoPedirApagar={() => void pedirApagar(r.nome)}
          />
        )} />
      )}
      {criar ? <DialogoCampo titulo="Novo branch" rotulo="Nome" rotuloConfirmar="Criar e trocar" texto={<p>Criado a partir de {estado.status.branch ?? "HEAD"}.</p>} aoCancelar={() => setCriar(false)} aoConfirmar={(nome) => { setCriar(false); void rodar(() => api.ramos(alvo, "criar", { nome, de: null, trocar: true })).then(() => aposEscrever()); }} /> : null}
      {renomear !== null ? <DialogoCampo titulo={`Renomear ${renomear}`} rotulo="Novo nome" inicial={renomear} rotuloConfirmar="Renomear" aoCancelar={() => setRenomear(null)} aoConfirmar={(para) => { const de = renomear; setRenomear(null); void rodar(() => api.ramos(alvo, "renomear", { de, para })).then(() => aposEscrever()); }} /> : null}
      {upstream !== null ? <DialogoCampo titulo={`Upstream de ${upstream}`} rotulo="Upstream (ex.: origin/main; vazio remove)" rotuloConfirmar="Definir" aoCancelar={() => setUpstream(null)} aoConfirmar={(u) => { const r = upstream; setUpstream(null); void rodar(() => api.ramos(alvo, "upstream_definir", { ramo: r, upstream: u })).then(() => aposEscrever()); }} texto={<button type="button" className="vc-mini" onClick={() => { const r = upstream; setUpstream(null); void rodar(() => api.ramos(alvo, "upstream_remover", { ramo: r })).then(() => aposEscrever()); }}>Remover upstream atual</button>} /> : null}
      {troca !== null ? (
        <Dialogo titulo="Mudanças locais atrapalham a troca" aoFechar={() => setTroca(null)}>
          <div className="dialogo-corpo">
            <p>Estes arquivos seriam sobrescritos ao ir para <code>{troca.destino}</code>:</p>
            <ul className="vc-lista-simples">{troca.arquivos.map((a) => <li key={a}><code>{a}</code></li>)}</ul>
          </div>
          <div className="dialogo-acoes">
            <button type="button" className="botao" data-foco-inicial onClick={() => setTroca(null)}>Cancelar</button>
            <button type="button" className="botao" onClick={() => void trocar(troca.destino, "levar")}>Levar as mudanças</button>
            <button type="button" className="botao botao-primario" onClick={() => void trocar(troca.destino, "stash")}>Guardar em stash e trocar</button>
          </div>
        </Dialogo>
      ) : null}
      {apagar !== null && !apagar.sim.requerForcar ? (
        <DialogoConfirmacao titulo={`Apagar ${apagar.nome}?`} perigoso rotuloConfirmar="Apagar branch" texto="O branch está totalmente mesclado; nenhum commit ficará sem referência." aoCancelar={() => setApagar(null)} aoConfirmar={() => void apagarDeVez(apagar.nome, false)} />
      ) : null}
      {apagar !== null && apagar.sim.requerForcar ? (
        <DialogoDigitar titulo={`Apagar ${apagar.nome} (não mesclado)`} esperado={apagar.nome} rotuloConfirmar="Apagar mesmo assim" aoCancelar={() => setApagar(null)} aoConfirmar={() => void apagarDeVez(apagar.nome, true)} texto={<><p>Estes {apagar.sim.orfaos.length} commit(s) só existem neste branch e ficariam inacessíveis:</p><ul className="vc-lista-simples">{apagar.sim.orfaos.slice(0, 15).map((c) => <li key={c.hash}><code>{c.hash.slice(0, 7)}</code> {c.assunto}</li>)}</ul></>} />
      ) : null}
    </div>
  );
}

function TagsGit() {
  const { api, alvo, rodar, avisar } = useVcs();
  const [lista, setLista] = useState<TagInfo[] | null>(null);
  const [criar, setCriar] = useState(false);
  const [apagar, setApagar] = useState<string | null>(null);
  const carregar = useCallback(async () => { try { setLista(await api.ramos(alvo, "tags_listar", {})); } catch { setLista([]); } }, [api, alvo]);
  useEffect(() => { void carregar(); }, [carregar]);
  return (
    <div className="vc-secao">
      <div className="vc-secao-barra"><button type="button" className="botao botao-primario vc-compacto" onClick={() => setCriar(true)}>Nova tag</button></div>
      {lista === null ? <div aria-busy="true" className="vc-vazio">Carregando…</div> : lista.length === 0 ? <div className="vc-vazio">Nenhuma tag.</div> : (
        <VirtualLista itens={lista} alturaItem={30} rotulo="Tags" chave={(t) => t.nome} className="vc-lista-grande" renderItem={(t) => (
          <div className="vc-ramo"><span className="vc-ramo-nome">{t.nome}</span><Badge>{t.tipo}</Badge><span className="vc-pasta">{t.hash.slice(0, 7)} {t.mensagem ?? ""}</span>
            <span className="vc-ramo-acoes"><button type="button" className="vc-mini vc-perigo" aria-label={`Apagar tag ${t.nome}`} onClick={() => setApagar(t.nome)}>Apagar</button></span></div>
        )} />
      )}
      {criar ? <DialogoCampo titulo="Nova tag" rotulo="Nome (ex.: v1.2.0)" rotuloConfirmar="Criar tag" aoCancelar={() => setCriar(false)} aoConfirmar={(nome) => { setCriar(false); void rodar(() => api.ramos(alvo, "tag_criar", { nome, de: null, mensagem: null })).then(() => carregar()); }} /> : null}
      {apagar !== null ? <DialogoConfirmacao titulo={`Apagar a tag ${apagar}?`} perigoso rotuloConfirmar="Apagar tag" texto="Só a tag local é apagada; nada é enviado ao remoto." aoCancelar={() => setApagar(null)} aoConfirmar={() => { const n = apagar; setApagar(null); void rodar(() => api.ramos(alvo, "tag_apagar", { nome: n })).then((r) => { if (r !== undefined) avisar(`Tag apagada (apontava para ${r.objetoAnterior.slice(0, 7)}).`); return carregar(); }); }} /> : null}
    </div>
  );
}

function StashGit() {
  const { api, alvo, rodar, recarregar, avisar } = useVcs();
  const [lista, setLista] = useState<Stash[] | null>(null);
  const [criar, setCriar] = useState(false);
  const [apagar, setApagar] = useState<Stash | null>(null);
  const [diff, setDiff] = useState<{ s: Stash; d: Diff } | null>(null);
  const carregar = useCallback(async () => { try { setLista(await api.stash(alvo, "listar", {})); } catch { setLista([]); } }, [api, alvo]);
  useEffect(() => { void carregar(); }, [carregar]);
  const depois = async (): Promise<void> => { await carregar(); await recarregar(); };
  const aplicar = async (s: Stash, pop: boolean): Promise<void> => {
    const r = await rodar(() => api.stash(alvo, pop ? "pop" : "aplicar", { indice: s.indice, restaurar_indice: false }));
    if (r !== undefined) { avisar(r.conflito ? `Conflito ao aplicar: ${r.arquivos.join(", ")}. O stash foi mantido.` : r.aplicado ? "Stash aplicado." : `Não aplicado: ${r.motivo ?? "mudanças locais seriam sobrescritas"}`); await depois(); }
  };
  return (
    <div className="vc-secao">
      <div className="vc-secao-barra"><button type="button" className="botao botao-primario vc-compacto" onClick={() => setCriar(true)}>Guardar mudanças (stash)</button></div>
      {lista === null ? <div aria-busy="true" className="vc-vazio">Carregando…</div> : lista.length === 0 ? <div className="vc-vazio">Nenhum stash.</div> : (
        <VirtualLista itens={lista} alturaItem={38} rotulo="Stashes" chave={(s) => s.hash} className="vc-lista-grande" renderItem={(s) => (
          <ItemLista
            densa id={s.hash} titulo={s.ref} meta={s.hash.slice(0, 7)}
            descricao={s.mensagem !== "" ? s.mensagem : `guardado em ${s.ramo ?? "ramo desconhecido"}`}
            aoAbrir={() => { void rodar(() => api.stash(alvo, "diff", { indice: s.indice })).then((d) => { if (d !== undefined) setDiff({ s, d }); }); }}
            acao={
              <span className="vc-ramo-acoes">
                <button type="button" className="vc-mini" aria-label={`Ver diff de ${s.ref}`} onClick={() => void rodar(() => api.stash(alvo, "diff", { indice: s.indice })).then((d) => { if (d !== undefined) setDiff({ s, d }); })}>Diff</button>
                <button type="button" className="vc-mini" aria-label={`Aplicar ${s.ref}`} onClick={() => void aplicar(s, false)}>Aplicar</button>
                <button type="button" className="vc-mini" aria-label={`Aplicar e remover ${s.ref}`} onClick={() => void aplicar(s, true)}>Pop</button>
                <button type="button" className="vc-mini vc-perigo" aria-label={`Apagar ${s.ref}`} onClick={() => setApagar(s)}>Apagar</button>
              </span>
            }
          />
        )} />
      )}
      {criar ? <DialogoCampo titulo="Guardar mudanças em stash" rotulo="Mensagem" rotuloConfirmar="Guardar" aoCancelar={() => setCriar(false)} aoConfirmar={(m) => { setCriar(false); void rodar(() => api.stash(alvo, "criar", { mensagem: m, nao_rastreados: true, manter_indice: false })).then(() => depois()); }} /> : null}
      {apagar !== null ? <DialogoConfirmacao titulo={`Apagar ${apagar.ref}?`} perigoso rotuloConfirmar="Apagar stash" texto={`“${apagar.mensagem}” será apagado. Dá para restaurar pelo hash ${apagar.hash.slice(0, 7)} enquanto o git não coletar.`} aoCancelar={() => setApagar(null)} aoConfirmar={() => { const s = apagar; setApagar(null); void rodar(() => api.stash(alvo, "apagar", { indice: s.indice })).then(() => depois()); }} /> : null}
      {diff !== null ? <Dialogo titulo={`Diff de ${diff.s.ref}`} aoFechar={() => setDiff(null)} largura={900}><div className="vc-dialogo-diff"><DiffView diff={diff.d} /></div><div className="dialogo-acoes"><button type="button" className="botao" data-foco-inicial onClick={() => setDiff(null)}>Fechar</button></div></Dialogo> : null}
    </div>
  );
}

function WorktreesGit() {
  const { api, alvo } = useVcs();
  const [lista, setLista] = useState<WorktreeEstado[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => { api.ramos(alvo, "worktrees_listar", { com_estado: true }).then(setLista, (e) => { setErro(mensagemDe(e)); setLista([]); }); }, [api, alvo]);
  return (
    <div className="vc-secao">
      {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}
      {lista === null ? <div aria-busy="true" className="vc-vazio">Carregando…</div> : (
        <ul className="vc-lista-simples" aria-label="Worktrees">
          {lista.map((w) => (
            <li key={w.caminho}><code>{w.caminho}</code> {w.branch !== null ? <Badge tom="destaque">{w.branch}</Badge> : <Badge>destacado</Badge>}{w.principal ? <Badge>principal</Badge> : null}{w.orfao ? <Badge tom="alerta">órfão</Badge> : null}{w.locked ? <Badge tom="aviso">travado</Badge> : null}{w.sujo === true ? <Badge tom="aviso">{w.arquivosAlterados} alterado(s)</Badge> : null}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RamosSvn() {
  const { api, alvo, estado, rodar, recarregar, avisar } = useVcs();
  const [info, setInfo] = useState<{ url_relativa: string; revisao: number } | null>(null);
  const [ramos, setRamos] = useState<string[] | null>(null);
  const [tipo, setTipo] = useState<"branches" | "tags">("branches");
  const [criar, setCriar] = useState(false);
  const [confirmar, setConfirmar] = useState<{ nome: string; kind: "branch" | "tag" } | null>(null);
  const [trocar, setTrocar] = useState<string | null>(null);
  useEffect(() => { api.svn(alvo, "info", {}).then(setInfo, () => setInfo(null)); }, [api, alvo, estado.status.oid]);
  useEffect(() => { setRamos(null); api.svn(alvo, "ramos_listar", { tipo }).then(setRamos, () => setRamos([])); }, [api, alvo, tipo]);
  return (
    <div className="vc-pagina">
      <div className="vc-secao">
        <p className="vc-aviso" role="note">SVN: não há stage, stash nem worktree. Criar branch ou tag grava no servidor e pede confirmação.</p>
        <p>{info !== null ? <>Local atual: <code>{info.url_relativa}</code> · revisão {info.revisao}</> : "Carregando informações…"}</p>
        <SubNavegacao base="vc-svn" rotulo="Tipo" className="subnav-aninhada" classePainel="vc-painel-aninhado sem-pad" itens={ITENS_TIPO_SVN} ativo={tipo} onMudar={setTipo}
          barra={<div className="vc-secao-barra"><button type="button" className="botao vc-compacto" onClick={() => setCriar(true)}>Criar no servidor…</button></div>}>
        {ramos === null ? <div aria-busy="true" className="vc-vazio">Carregando…</div> : ramos.length === 0 ? <div className="vc-vazio">Nada em {tipo}.</div> : (
          <VirtualLista itens={ramos} alturaItem={30} rotulo={tipo === "tags" ? "Tags SVN" : "Branches SVN"} chave={(r) => r} className="vc-lista-grande" renderItem={(r) => (
            <div className="vc-ramo"><span className="vc-ramo-nome">{r}</span><span className="vc-ramo-acoes"><button type="button" className="vc-mini" aria-label={`Trocar para ${r}`} onClick={() => setTrocar(`${tipo}/${r.replace(/\/$/, "")}`)}>Trocar (switch)</button></span></div>
          )} />
        )}
        </SubNavegacao>
      </div>
      {criar ? <DialogoCampo titulo="Criar no servidor" rotulo="Nome" rotuloConfirmar="Continuar" aoCancelar={() => setCriar(false)} aoConfirmar={(nome) => { setCriar(false); setConfirmar({ nome, kind: tipo === "tags" ? "tag" : "branch" }); }} /> : null}
      {confirmar !== null ? <DialogoConfirmacao titulo="Isto grava no servidor SVN" rotuloConfirmar={`Criar ${confirmar.kind} no servidor`} texto={<>Será criado <code>{confirmar.nome}</code> no repositório (<code>svn copy</code>), visível para toda a equipe.</>} aoCancelar={() => setConfirmar(null)} aoConfirmar={() => { const c = confirmar; setConfirmar(null); void rodar(() => api.svn(alvo, "ramo_criar", { tipo: c.kind, nome: c.nome, mensagem: null, confirmado_servidor: true })).then((r) => { if (r !== undefined) avisar(`${c.kind} ${c.nome} criado no servidor.`); }); }} /> : null}
      {trocar !== null ? <DialogoConfirmacao titulo={`Trocar a cópia para ${trocar}?`} rotuloConfirmar="Trocar (switch)" texto="A cópia de trabalho passa a apontar para outro caminho do repositório; mudanças locais são mantidas." aoCancelar={() => setTrocar(null)} aoConfirmar={() => { const d = trocar; setTrocar(null); void rodar(() => api.svn(alvo, "trocar", { destino: d })).then((r) => { if (r !== undefined) avisar(r.resumo); return recarregar(); }); }} /> : null}
    </div>
  );
}

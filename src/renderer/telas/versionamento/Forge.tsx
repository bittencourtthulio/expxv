import { useCallback, useEffect, useState } from "react";
import type { CheckForge, EstadoForge, PrDetalhe, PrResumo } from "../../../nucleo/forge/forge";
import { ade } from "../../ade";
import { Badge, type TomBadge } from "../../componentes/Badge";
import { Dialogo } from "../../componentes/Dialogo";
import { ItemLista, type SeloLista } from "../../componentes/ItemLista";
import { VirtualLista } from "../../componentes/VirtualLista";
import { nomeCredencialForge } from "../../../nucleo/forge/credencial";
import { mensagemDe, useVcs } from "./contexto";

type Filtro = "aberto" | "fechado" | "mesclado" | "todos";
const TOM_CHECK: Record<string, TomBadge> = { sucesso: "sucesso", falha: "alerta", pendente: "aviso", cancelado: "neutro", ignorado: "neutro", desconhecido: "neutro" };

/** Linha de PR no padrão único (D-694): título ≫ autor · origem → destino ≫ selos (rascunho, checks), meta #n; o corpo abre o detalhe. */
function ItemPr({ p, aberto, aoAbrir }: { p: PrResumo; aberto: boolean; aoAbrir: () => void }) {
  const selos: SeloLista[] = [];
  if (p.rascunho) selos.push({ texto: "rascunho" });
  if (p.checks !== null && p.checks.falha > 0) selos.push({ texto: `${p.checks.falha} check(s) falhando`, tom: "alerta" });
  else if (p.checks !== null && p.checks.pendente > 0) selos.push({ texto: "checks pendentes", tom: "aviso" });
  else if (p.checks !== null) selos.push({ texto: "checks ok", tom: "sucesso" });
  return (
    <ItemLista
      densa id={`pr-${p.numero}`} titulo={p.titulo} selos={selos} meta={`#${p.numero}`}
      descricao={`${p.autor} · ${p.ramoOrigem} → ${p.ramoDestino}`} selecionado={aberto} aoAbrir={aoAbrir}
    />
  );
}

export function PRs() {
  const { api, alvo, estado, rodar, missao, avisar } = useVcs();
  const [forge, setForge] = useState<EstadoForge | null | undefined>(undefined);
  const [filtro, setFiltro] = useState<Filtro>("aberto");
  const [lista, setLista] = useState<PrResumo[] | null>(null);
  const [truncado, setTruncado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<{ pr: PrDetalhe; checks: CheckForge[] } | null>(null);
  const [criar, setCriar] = useState(false);

  useEffect(() => { let vivo = true; api.forge(alvo, "estado", {}).then((r) => { if (vivo) setForge(r.forge); }, () => { if (vivo) setForge(null); }); return () => { vivo = false; }; }, [api, alvo]);
  const pronto = forge != null && forge.autenticado && !forge.degradado;
  const carregar = useCallback(async () => {
    setErro(null); setLista(null);
    try { const r = await api.forge(alvo, "prs_listar", { estado: filtro, limite: 50 }); setLista(r.itens); setTruncado(r.truncado); } catch (e) { setErro(mensagemDe(e)); setLista([]); }
  }, [api, alvo, filtro]);
  useEffect(() => { if (pronto) void carregar(); }, [pronto, carregar]);

  const abrir = async (numero: number): Promise<void> => {
    const pr = await rodar(() => api.forge(alvo, "pr_ver", { numero }));
    if (pr === undefined) return;
    const checks = await api.forge(alvo, "checks_do_pr", { numero }).catch(() => [] as CheckForge[]);
    setDetalhe({ pr, checks });
  };
  const abrirPelaMergex = async (): Promise<void> => {
    const a = ade();
    if (a === undefined || missao === null || missao.trabalho_id === null) return;
    const r = await rodar(() => a.metodo.disparar({ workspace_id: alvo.workspace_id, trabalho_id: missao.trabalho_id, gesto: "entrega_pr", argumento: null, pane_id: null }));
    if (r !== undefined) avisar(r.ok ? `Comando enviado ao Pane: ${r.comando ?? "/expx:mergex-pr"}` : `A mergex não pôde abrir o PR: ${r.motivo ?? "indisponível"}. Use "Criar PR aqui".`);
  };

  if (estado.tipo === "svn") return <div className="vc-vazio">SVN não tem pull requests. Use a aba Mudanças para enviar commits e Histórico para revisões.</div>;
  if (forge === undefined) return <div className="vc-vazio" aria-busy="true">Detectando o provedor…</div>;
  if (forge === null) return <div className="vc-vazio">Sem remoto reconhecível (GitHub, GitLab, Bitbucket ou Azure DevOps). O ADE segue só com git local — adicione um remoto para ver PRs.</div>;
  return (
    <div className="vc-prs">
      <div className="vc-secao-barra">
        <Badge tom="destaque">{forge.provedor}</Badge>
        <code>{forge.repo?.caminho ?? "repositório?"}</code>
        {forge.instrucao !== null ? <span className="vc-aviso" role="note">{forge.instrucao}</span> : null}
        <span className="vc-espaco" />
        {pronto ? (
          <>
            <select aria-label="Estado dos PRs" className="vc-campo" value={filtro} onChange={(e) => setFiltro(e.target.value as Filtro)}>
              <option value="aberto">Abertos</option><option value="fechado">Fechados</option><option value="mesclado">Mesclados</option><option value="todos">Todos</option>
            </select>
            <button type="button" className="vc-icone" aria-label="Atualizar PRs" title="Atualizar" onClick={() => void carregar()}>↻</button>
            {missao?.trabalho_id != null ? <button type="button" className="botao botao-primario vc-compacto" onClick={() => void abrirPelaMergex()} title="Dispara /expx:mergex-pr no Pane">Abrir PR pela mergex</button> : null}
            <button type="button" className="botao vc-compacto" onClick={() => setCriar(true)}>Criar PR aqui</button>
          </>
        ) : null}
      </div>
      {!pronto ? <div className="vc-vazio">{forge.degradado ? "Funcionamento degradado: só git, sem o provedor." : forge.provedor === "bitbucket" || forge.provedor === "azure" ? `Salve a credencial no cofre do app com o nome ${nomeCredencialForge(forge.repo?.host ?? "")} (token, ou usuario:senha). O valor nunca é exibido.` : "Entre na CLI do provedor para listar PRs (o ADE nunca guarda token)."}</div> : (
        <div className="vc-historico">
          <div className="vc-col-lista">
            {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}
            {lista === null ? <div className="vc-vazio" aria-busy="true">Carregando…</div> : lista.length === 0 ? <div className="vc-vazio">Nenhum PR.</div> : (
              <VirtualLista itens={lista} alturaItem={38} rotulo="Pull requests" chave={(p) => String(p.numero)} className="vc-lista" renderItem={(p) => (
                <ItemPr p={p} aberto={detalhe?.pr.numero === p.numero} aoAbrir={() => { void abrir(p.numero); }} />
              )} />
            )}
            {truncado ? <p className="vc-pasta">Lista truncada: refine o filtro.</p> : null}
          </div>
          <div className="vc-col-diff">
            {detalhe === null ? <div className="vc-d-vazio">Escolha um PR.</div> : (
              <div className="vc-detalhe-commit">
                <strong>#{detalhe.pr.numero} {detalhe.pr.titulo}</strong>
                <span className="vc-pasta">{detalhe.pr.estado} · revisão {detalhe.pr.revisao} · mesclável: {detalhe.pr.mesclavel} · <a href={detalhe.pr.url} onClick={(e) => { e.preventDefault(); void ade()?.terminais.abrirLink(detalhe.pr.url); }}>abrir no navegador</a></span>
                <p className="vc-aviso" role="note">O merge do PR é sempre humano (na mergex ou no provedor); esta tela não mescla.</p>
                <h4 className="vc-h3">Checks</h4>
                {detalhe.checks.length === 0 ? <p>Sem checks.</p> : <ul className="vc-lista-simples">{detalhe.checks.map((c) => <li key={c.nome}><Badge tom={TOM_CHECK[c.situacao] ?? "neutro"}>{c.situacao}</Badge> {c.nome}</li>)}</ul>}
                <h4 className="vc-h3">Arquivos ({detalhe.pr.arquivos.length})</h4>
                <ul className="vc-lista-simples">{detalhe.pr.arquivos.slice(0, 200).map((a) => <li key={a.caminho}><code>{a.caminho}</code> <span className="vc-mais">+{a.adicoes}</span> <span className="vc-menos">-{a.remocoes}</span></li>)}</ul>
                {detalhe.pr.corpo.trim() !== "" ? <pre className="vc-corpo">{detalhe.pr.corpo}</pre> : null}
              </div>
            )}
          </div>
        </div>
      )}
      {criar ? <CriarPr aoFechar={() => setCriar(false)} aoCriado={() => { setCriar(false); void carregar(); }} /> : null}
    </div>
  );
}

function CriarPr({ aoFechar, aoCriado }: { aoFechar: () => void; aoCriado: () => void }) {
  const { api, alvo, estado, rodar, avisar } = useVcs();
  const [titulo, setTitulo] = useState("");
  const [corpo, setCorpo] = useState("");
  const [rascunho, setRascunho] = useState(true);
  const publicar = async (): Promise<void> => {
    const r = await rodar(() => api.forge(alvo, "pr_criar", { titulo, corpo: corpo === "" ? null : corpo, base: null, head: null, rascunho }));
    if (r !== undefined) { avisar(`PR #${r.numero} criado.`); aoCriado(); }
  };
  return (
    <Dialogo titulo="Criar pull request" aoFechar={aoFechar} largura={600}>
      <div className="dialogo-corpo">
        <p>Do branch <code>{estado.status.branch ?? "?"}</code>. O branch precisa já estar publicado (o ADE não envia sozinho). Para entregas do método, prefira abrir pela mergex.</p>
        <label className="vc-campo-rotulo">Título<input className="vc-campo" data-foco-inicial value={titulo} onChange={(e) => setTitulo(e.target.value)} /></label>
        <label className="vc-campo-rotulo">Descrição<textarea className="vc-campo" rows={6} value={corpo} onChange={(e) => setCorpo(e.target.value)} /></label>
        <label><input type="checkbox" checked={rascunho} onChange={(e) => setRascunho(e.target.checked)} /> Como rascunho</label>
      </div>
      <div className="dialogo-acoes"><button type="button" className="botao" onClick={aoFechar}>Cancelar</button><button type="button" className="botao botao-primario" disabled={titulo.trim() === ""} onClick={() => void publicar()}>Criar PR</button></div>
    </Dialogo>
  );
}

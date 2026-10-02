import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Diff, Mudanca } from "../../../nucleo/vcs/tipos";
import { DialogoConfirmacao } from "../../componentes/Dialogo";
import { Icone } from "../../componentes/Icone";
import { VirtualLista } from "../../componentes/VirtualLista";
import { CaixaCommit } from "./CaixaCommit";
import { mensagemDe, useVcs } from "./contexto";
import { DialogoDescartar, DialogoDescartes } from "./Descartar";
import { DiffView, type AcoesDiff } from "./diff/DiffView";
import { agrupar, chaveMud, letraDe, NOME_LETRA, type GrupoId, type LinhaMud } from "./linhas";

export const ALTURA_LINHA_MUD = 24;

interface Sel { grupo: GrupoId; caminho: string }

export function Mudancas() {
  const ctx = useVcs();
  const { api, alvo, estado, rodar, recarregar, avisar } = ctx;
  const comStage = estado.capabilities.stage;
  const ehSvn = estado.tipo === "svn";
  const [recolhidos, setRecolhidos] = useState<ReadonlySet<GrupoId>>(new Set());
  const [marcados, setMarcados] = useState<ReadonlySet<string>>(new Set());
  const [sel, setSel] = useState<Sel | null>(null);
  const [diff, setDiff] = useState<Diff | null>(null);
  const [carregandoDiff, setCarregandoDiff] = useState(false);
  const [modo, setModo] = useState<"unificado" | "lado">("unificado");
  const [ignorarEspaco, setIgnorarEspaco] = useState(false);
  const [palavra, setPalavra] = useState(false);
  const [descartar, setDescartar] = useState<{ caminhos: string[]; incluirStaged: boolean } | null>(null);
  const [descartes, setDescartes] = useState(false);
  const [confirmarSvn, setConfirmarSvn] = useState<string | null>(null);
  const [mensagemSvn, setMensagemSvn] = useState("");
  const raiz = useRef<HTMLDivElement>(null);

  const linhas = useMemo(() => agrupar(estado.status.arquivos, comStage, recolhidos), [estado.status.arquivos, comStage, recolhidos]);
  const noStage = estado.status.contagens.staged;

  // diff do arquivo escolhido; recarrega quando o estado do repositório muda
  useEffect(() => {
    if (sel === null) { setDiff(null); return; }
    let vivo = true;
    setCarregandoDiff(true);
    api.diff({ ...alvo, caminho: sel.caminho, staged: sel.grupo === "staged", base: null, palavra, contexto: null, nao_rastreado: sel.grupo === "naoRastreados", limite_bytes: null })
      .then((d) => { if (vivo) setDiff(d); }, (e) => { if (vivo) { setDiff(null); avisar(`Não foi possível carregar o diff: ${mensagemDe(e)}`); } })
      .finally(() => { if (vivo) setCarregandoDiff(false); });
    return () => { vivo = false; };
  }, [api, alvo, sel, palavra, estado.status, avisar]);

  const alternarMarca = (chave: string): void => setMarcados((m) => { const n = new Set(m); if (n.has(chave)) n.delete(chave); else n.add(chave); return n; });
  const caminhosDe = (grupo: GrupoId): string[] => { const r: string[] = []; for (const l of linhas) if (l.k === "arq" && l.grupo === grupo) r.push(l.m.caminho); return r; };
  const marcadosDe = (grupo: GrupoId): string[] => [...marcados].filter((c) => c.startsWith(`${grupo}:`)).map((c) => c.slice(grupo.length + 1));

  const estagiar = async (caminhos: string[]): Promise<void> => { if (caminhos.length > 0 && (await rodar(() => api.estagio(alvo, "estagiar", { caminhos }))) !== undefined) await recarregar(); };
  const desestagiar = async (caminhos: string[]): Promise<void> => { if (caminhos.length > 0 && (await rodar(() => api.estagio(alvo, "desestagiar", { caminhos }))) !== undefined) await recarregar(); };
  const adicionarSvn = async (caminhos: string[]): Promise<void> => { if (caminhos.length > 0 && (await rodar(() => api.svn(alvo, "adicionar", { caminhos }))) !== undefined) await recarregar(); };

  const acoesDiff: AcoesDiff | undefined = !comStage || sel === null || sel.grupo === "conflitos" || sel.grupo === "naoRastreados" ? undefined : {
    sentido: sel.grupo === "staged" ? "desestagiar" : "estagiar",
    aoHunk: (_arq, hunk) => void rodar(() => api.estagio(alvo, "hunk", { sentido: sel.grupo === "staged" ? "desestagiar" : "estagiar", caminho: sel.caminho, hunk, linhas: null })).then(() => recarregar()),
    aoLinhas: (_arq, hunk, ls) => void rodar(() => api.estagio(alvo, "hunk", { sentido: sel.grupo === "staged" ? "desestagiar" : "estagiar", caminho: sel.caminho, hunk, linhas: ls })).then(() => recarregar()),
  };

  const aoTeclar = (e: KeyboardEvent): void => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.shiftKey && e.key.toLowerCase() === "u") { e.preventDefault(); void desestagiar(marcadosDe("staged").length > 0 ? marcadosDe("staged") : sel?.grupo === "staged" ? [sel.caminho] : caminhosDe("staged")); }
  };

  const renderLinha = useCallback((l: LinhaMud): React.ReactNode => {
    if (l.k === "grupo") {
      const todos = (): string[] => caminhosDe(l.id);
      return (
        <div className="vc-grupo" role="presentation">
          <button type="button" className="vc-grupo-titulo" aria-expanded={!l.recolhido} onClick={() => setRecolhidos((r) => { const n = new Set(r); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })}>
            <span aria-hidden="true">{l.recolhido ? "▸" : "▾"}</span> {l.rotulo} <span className="vc-contagem">{l.n}</span>
          </button>
          <span className="vc-grupo-acoes">
            {comStage && l.id === "staged" ? <button type="button" className="vc-icone" aria-label="Remover tudo do stage" title="Remover tudo do stage (⌘⇧U)" onClick={() => void desestagiar(todos())}><Icone nome="menos" /></button> : null}
            {comStage && (l.id === "naoStaged" || l.id === "naoRastreados") ? <button type="button" className="vc-icone" aria-label={`Estagiar tudo em ${l.rotulo}`} title="Estagiar tudo" onClick={() => void estagiar(todos())}><Icone nome="mais" /></button> : null}
            {ehSvn && l.id === "naoRastreados" ? <button type="button" className="vc-icone" aria-label="Adicionar tudo ao controle de versão" title="Adicionar tudo (svn add)" onClick={() => void adicionarSvn(todos())}><Icone nome="mais" /></button> : null}
          </span>
        </div>
      );
    }
    const { m, grupo, chave } = l;
    const letra = letraDe(m, grupo);
    const ativo = sel !== null && sel.grupo === grupo && sel.caminho === m.caminho;
    const nome = m.caminho.slice(m.caminho.lastIndexOf("/") + 1);
    const pasta = m.caminho.includes("/") ? m.caminho.slice(0, m.caminho.lastIndexOf("/")) : "";
    return (
      <div className="vc-arq" data-ativo={ativo || undefined} data-letra={letra}>
        <input type="checkbox" aria-label={`Marcar ${m.caminho}`} checked={marcados.has(chave)} onChange={() => alternarMarca(chave)} />
        <button type="button" className="vc-arq-nome" aria-pressed={ativo} title={m.caminho} onClick={() => setSel({ grupo, caminho: m.caminho })}>
          <span className="vc-letra" aria-label={NOME_LETRA[letra] ?? letra} title={NOME_LETRA[letra] ?? letra}>{letra}</span>
          <span className="vc-nome">{nome}</span>
          {pasta !== "" ? <span className="vc-pasta">{pasta}</span> : null}
          {m.origem !== undefined ? <span className="vc-pasta">← {m.origem}</span> : null}
        </button>
        <span className="vc-arq-acoes">
          {comStage && grupo === "staged" ? <button type="button" className="vc-icone" aria-label={`Remover ${m.caminho} do stage`} title="Remover do stage" onClick={() => void desestagiar([m.caminho])}><Icone nome="menos" /></button> : null}
          {comStage && (grupo === "naoStaged" || grupo === "naoRastreados") ? <button type="button" className="vc-icone" aria-label={`Estagiar ${m.caminho}`} title="Estagiar" onClick={() => void estagiar([m.caminho])}><Icone nome="mais" /></button> : null}
          {ehSvn && grupo === "naoRastreados" ? <button type="button" className="vc-icone" aria-label={`Adicionar ${m.caminho}`} title="svn add" onClick={() => void adicionarSvn([m.caminho])}><Icone nome="mais" /></button> : null}
          {grupo !== "conflitos" && (comStage ? grupo !== "staged" : grupo !== "naoRastreados") ? (
            <button type="button" className="vc-icone vc-perigo" aria-label={`Descartar ${m.caminho}`} title="Descartar (pede confirmação)" onClick={() => (ehSvn ? setConfirmarSvn(m.caminho) : setDescartar({ caminhos: [m.caminho], incluirStaged: false }))}><Icone nome="desfazer" /></button>
          ) : null}
        </span>
      </div>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marcados, sel, comStage, ehSvn, estado.status.arquivos, linhas]);

  const marcadosNaoStaged = [...marcados].filter((c) => c.startsWith("naoStaged:") || c.startsWith("naoRastreados:")).map((c) => c.slice(c.indexOf(":") + 1));

  const comitarSvn = async (caminhosMarcados: string[]): Promise<void> => {
    const r = await rodar(() => api.svn(alvo, "commit", { mensagem: mensagemSvn, caminhos: caminhosMarcados.length > 0 ? caminhosMarcados : null, changelist: null }));
    if (r !== undefined) { avisar(r.revisao === null ? "Nada a enviar." : `Revisão ${r.revisao} enviada ao servidor.`); setMensagemSvn(""); await recarregar(); }
  };
  const [pedirSvnCommit, setPedirSvnCommit] = useState(false);

  if (estado.status.estado === "calculando") return <div className="vc-vazio" aria-busy="true">Calculando o estado do repositório…</div>;

  return (
    <div className="vc-mudancas" ref={raiz} onKeyDown={aoTeclar}>
      <div className="vc-col-lista">
        <div className="vc-lista-barra">
          <span className="vc-contagem-total">{estado.status.arquivos.length.toLocaleString("pt-BR")} {estado.status.arquivos.length === 1 ? "arquivo" : "arquivos"}{estado.status.degradado ? " (sem não rastreados: repositório grande)" : ""}</span>
          {marcadosNaoStaged.length > 0 && !ehSvn ? <button type="button" className="vc-icone vc-perigo" aria-label={`Descartar ${marcadosNaoStaged.length} marcados`} title="Descartar marcados (pede confirmação)" onClick={() => setDescartar({ caminhos: marcadosNaoStaged, incluirStaged: false })}><Icone nome="lixeira" /></button> : null}
          {comStage && marcadosNaoStaged.length > 0 ? <button type="button" className="vc-icone" aria-label={`Estagiar ${marcadosNaoStaged.length} marcados`} title="Estagiar marcados" onClick={() => void estagiar(marcadosNaoStaged)}><Icone nome="mais" /></button> : null}
          {comStage ? <button type="button" className="vc-mini" onClick={() => setDescartes(true)}>Descartes recentes</button> : null}
        </div>
        {linhas.length === 0 ? (
          <div className="vc-vazio">Sem mudanças. {estado.status.ahead > 0 ? `Há ${estado.status.ahead} commit(s) para enviar.` : "A árvore está limpa."}</div>
        ) : (
          <VirtualLista itens={linhas} alturaItem={ALTURA_LINHA_MUD} rotulo="Arquivos alterados" chave={(l) => (l.k === "grupo" ? `g:${l.id}` : l.chave)} renderItem={renderLinha} className="vc-lista" extra={8} />
        )}
        {comStage ? (
          <CaixaCommit noStage={noStage} aoComitar={() => setMarcados(new Set())} />
        ) : (
          <div className="vc-commit">
            <textarea aria-label="Mensagem do commit SVN" rows={3} placeholder="Mensagem (grava no servidor)" value={mensagemSvn} onChange={(e) => setMensagemSvn(e.target.value)} />
            <p className="vc-aviso" role="note">No SVN o commit é enviado ao servidor na hora; não existe stage nem desfazer local.</p>
            <button type="button" className="botao botao-primario vc-botao-commit" disabled={mensagemSvn.trim() === ""} onClick={() => setPedirSvnCommit(true)}>Enviar ao servidor{marcados.size > 0 ? ` (${marcados.size})` : ""}</button>
          </div>
        )}
      </div>
      <div className="vc-col-diff">
        <div className="vc-diff-barra">
          <span className="vc-diff-titulo">{sel?.caminho ?? "Diff"}</span>
          <label><input type="checkbox" checked={ignorarEspaco} onChange={(e) => setIgnorarEspaco(e.target.checked)} /> Ignorar espaços</label>
          <label><input type="checkbox" checked={palavra} onChange={(e) => setPalavra(e.target.checked)} /> Por palavra</label>
          <button type="button" className="vc-mini" aria-pressed={modo === "lado"} onClick={() => setModo((m) => (m === "lado" ? "unificado" : "lado"))}>{modo === "lado" ? "Unificado" : "Lado a lado"}</button>
        </div>
        <DiffView diff={diff} carregando={carregandoDiff} modo={modo} ignorarEspaco={ignorarEspaco} acoes={acoesDiff} />
      </div>
      {descartar !== null ? <DialogoDescartar caminhos={descartar.caminhos} incluirStaged={descartar.incluirStaged} aoFechar={() => { setDescartar(null); setMarcados(new Set()); }} /> : null}
      {descartes ? <DialogoDescartes aoFechar={() => setDescartes(false)} /> : null}
      {confirmarSvn !== null ? (
        <DialogoConfirmacao titulo="Reverter arquivo no SVN?" perigoso rotuloConfirmar="Reverter" texto={<>As mudanças locais de <code>{confirmarSvn}</code> serão descartadas. Um patch de segurança é guardado.</>} aoCancelar={() => setConfirmarSvn(null)} aoConfirmar={() => { const c = confirmarSvn; setConfirmarSvn(null); void rodar(() => api.svn(alvo, "reverter", { caminhos: [c], confirmar: true })).then(() => recarregar()); }} />
      ) : null}
      {pedirSvnCommit ? (
        <DialogoConfirmacao titulo="Enviar ao servidor SVN?" rotuloConfirmar="Enviar commit" texto="Isto grava uma nova revisão no servidor e não pode ser desfeito localmente." aoCancelar={() => setPedirSvnCommit(false)} aoConfirmar={() => { setPedirSvnCommit(false); void comitarSvn([...marcados].map((c) => c.slice(c.indexOf(":") + 1))); }} />
      ) : null}
    </div>
  );
}

export type { Mudanca };
export { chaveMud };

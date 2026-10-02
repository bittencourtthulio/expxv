import { useEffect, useMemo, useState } from "react";
import { TIPOS_DOCUMENTO, type FonteResultado, type TipoDocumento } from "../../../compartilhado/conhecimento";
import type { AlvoEsquecer, FonteReindexar } from "../../../compartilhado/conhecimento-api";
import { Dialogo, DialogoConfirmacao } from "../../componentes/Dialogo";
import { ItemLista } from "../../componentes/ItemLista";
import { VirtualLista } from "../../componentes/VirtualLista";
import type { EstadoStoreConhecimento, StoreConhecimento } from "../../estado/conhecimento";
import { formatarBytes, linhaDeFonte } from "./logica";

const FONTES_REINDEXAR: ReadonlyArray<[FonteReindexar, string]> = [["tudo", "Tudo"], ["docs", "Documentos"], ["codigo", "Código"], ["git", "Commits e PRs"], ["transcricoes", "Transcrições"]];
const CLIS: ReadonlyArray<["claude" | "codex" | "opencode", string]> = [["claude", "Claude Code"], ["codex", "Codex"], ["opencode", "OpenCode"]];
type Alvo = "tipo" | "origem" | "missao" | "antes";

export interface PropsFontes { store: StoreConhecimento; estado: EstadoStoreConhecimento; nomeWorkspace: string; missoes: ReadonlyArray<{ id: string; titulo: string }> }

export function contarPorTipo(itens: readonly FonteResultado[]): Array<{ tipo: string; n: number }> {
  const m = new Map<string, number>();
  for (const i of itens) m.set(i.tipo, (m.get(i.tipo) ?? 0) + 1);
  return [...m.entries()].map(([tipo, n]) => ({ tipo, n })).sort((a, b) => b.n - a.n);
}

export function Fontes({ store, estado, nomeWorkspace, missoes }: PropsFontes) {
  const e = estado.estado;
  const f = estado.fontes;
  const [reindexar, setReindexar] = useState<FonteReindexar>("tudo");
  const [alvoTipo, setAlvoTipo] = useState<Alvo>("tipo");
  const [valor, setValor] = useState("");
  const [esquecer, setEsquecer] = useState<{ alvo: AlvoEsquecer; descricao: string } | null>(null);
  const [purgando, setPurgando] = useState(false);
  const [confirmacaoPurga, setConfirmacaoPurga] = useState("");
  const [importando, setImportando] = useState(false);
  const [cli, setCli] = useState<"claude" | "codex" | "opencode">("claude");
  const [ciente, setCiente] = useState(false);
  const [docAberto, setDocAberto] = useState<FonteResultado | null>(null);
  const [trechosDoc, setTrechosDoc] = useState<Array<string> | "carregando" | "erro">("carregando");
  const porTipo = useMemo(() => contarPorTipo(f.itens), [f.itens]);

  // trechos do documento aberto (proveniência); buscou quem pediu, o estado é daqui
  useEffect(() => {
    if (docAberto === null) return;
    let vivo = true;
    setTrechosDoc("carregando");
    void store.trechosDoDocumento(docAberto.documento_id).then((r) => { if (vivo) setTrechosDoc(r === null ? "erro" : r.map((t) => t.trecho)); }, () => { if (vivo) setTrechosDoc("erro"); });
    return () => { vivo = false; };
  }, [docAberto, store]);

  const alvoDoFormulario = (): { alvo: AlvoEsquecer; descricao: string } | null => {
    const v = valor.trim();
    if (v === "") return null;
    switch (alvoTipo) {
      case "tipo": return { alvo: { tipo: v as TipoDocumento }, descricao: `todos os documentos do tipo "${v}"` };
      case "origem": return { alvo: { origem: v }, descricao: `tudo que veio de "${v}"` };
      case "missao": return { alvo: { mission_id: v }, descricao: `tudo da missão "${missoes.find((m) => m.id === v)?.titulo ?? v}"` };
      case "antes": return { alvo: { antes_de: new Date(v).toISOString() }, descricao: `tudo anterior a ${v}` };
    }
  };

  return (
    <div className="con-rolavel">
      <div className="con-secao">
        <h2>O que está indexado</h2>
        {e === null ? <p role="status">Carregando…</p> : (
          <p>{e.documentos} documentos · {e.chunks} trechos · {formatarBytes(e.tamanho_bytes)} · modelo {e.modelo} ({e.dimensao} dimensões)</p>
        )}
        {f.erro !== null ? <p className="con-erro" role="alert">{f.erro}</p> : null}
        <table className="con-tabela" aria-label="Documentos indexados por tipo">
          <thead><tr><th scope="col">Tipo</th><th scope="col" className="num">Documentos</th></tr></thead>
          <tbody>
            {porTipo.length === 0 ? <tr><td colSpan={2}>{f.carregando ? "Carregando…" : "Nada indexado ainda."}</td></tr> : porTipo.map((t) => <tr key={t.tipo}><td>{t.tipo}</td><td className="num">{t.n}{f.proximo !== null ? "+" : ""}</td></tr>)}
          </tbody>
        </table>
        {f.proximo !== null ? <p className="meta">A contagem por tipo considera os 500 documentos mais recentes.</p> : null}

        <h2>Reindexar</h2>
        <div className="con-acoes-linha">
          <label>Fonte <select value={reindexar} onChange={(ev) => setReindexar(ev.target.value as FonteReindexar)}>{FONTES_REINDEXAR.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
          <button type="button" className="con-mini" data-tom="primario" onClick={() => void store.reindexar(reindexar)}>Reindexar</button>
          <button type="button" className="con-mini" onClick={() => setImportando(true)}>Importar histórico das CLIs…</button>
          <button type="button" className="con-mini" onClick={() => void store.exportar()}>Exportar…</button>
        </div>

        <h2>Esquecer</h2>
        <div className="con-acoes-linha">
          <label>Por <select value={alvoTipo} onChange={(ev) => { setAlvoTipo(ev.target.value as Alvo); setValor(""); }}><option value="tipo">Tipo</option><option value="origem">Origem</option><option value="missao">Missão</option><option value="antes">Período (antes de)</option></select></label>
          {alvoTipo === "tipo" ? <select aria-label="Tipo a esquecer" value={valor} onChange={(ev) => setValor(ev.target.value)}><option value="">Escolha…</option>{TIPOS_DOCUMENTO.map((t) => <option key={t} value={t}>{t}</option>)}</select> : null}
          {alvoTipo === "origem" ? <input type="text" aria-label="Origem a esquecer" placeholder="docs/arquivo.md" value={valor} onChange={(ev) => setValor(ev.target.value)} /> : null}
          {alvoTipo === "missao" ? <select aria-label="Missão a esquecer" value={valor} onChange={(ev) => setValor(ev.target.value)}><option value="">Escolha…</option>{missoes.map((m) => <option key={m.id} value={m.id}>{m.titulo}</option>)}</select> : null}
          {alvoTipo === "antes" ? <input type="date" aria-label="Esquecer o que for anterior a" value={valor} onChange={(ev) => setValor(ev.target.value)} /> : null}
          <button type="button" className="con-mini" data-tom="perigo" disabled={alvoDoFormulario() === null} onClick={() => setEsquecer(alvoDoFormulario())}>Esquecer…</button>
          <button type="button" className="con-mini" data-tom="perigo" onClick={() => { setConfirmacaoPurga(""); setPurgando(true); }}>Apagar tudo…</button>
        </div>

        <h2>Documentos</h2>
        {f.itens.length === 0 ? <p>{f.carregando ? "Carregando…" : "Sem documentos indexados."}</p> : (
          <div style={{ height: 260, display: "flex", flexDirection: "column" }}>
            <VirtualLista itens={f.itens} alturaItem={40} alturaPadrao={260} rotulo="Documentos indexados" chave={(d) => d.documento_id} renderItem={(d) => (
              <ItemLista
                densa
                titulo={d.titulo}
                descricao={linhaDeFonte(d)}
                aoAbrir={() => setDocAberto(d)}
                acao={<button type="button" className="con-mini" data-tom="perigo" aria-label={`Esquecer documento ${d.titulo}`} onClick={() => setEsquecer({ alvo: { documento_id: d.documento_id }, descricao: `o documento "${d.titulo}"` })}>Esquecer</button>}
              />
            )} />
          </div>
        )}
      </div>

      {docAberto !== null ? (
        <Dialogo titulo={docAberto.titulo} aoFechar={() => setDocAberto(null)} largura={560}>
          <div className="dialogo-corpo">
            <p className="meta">{linhaDeFonte(docAberto)}</p>
            {trechosDoc === "carregando" ? <p role="status" aria-busy="true">Carregando trechos…</p>
              : trechosDoc === "erro" ? <p className="con-erro" role="alert">Não foi possível ler os trechos deste documento. Tente de novo em instantes.</p>
              : trechosDoc.length === 0 ? <p>Sem trechos indexados deste documento.</p>
              : <ul className="con-doc-trechos">{trechosDoc.map((t, i) => <li key={i}>{t}</li>)}</ul>}
          </div>
          <div className="dialogo-acoes"><button type="button" className="botao" data-foco-inicial onClick={() => setDocAberto(null)}>Fechar</button></div>
        </Dialogo>
      ) : null}

      {esquecer !== null ? (
        <DialogoConfirmacao titulo="Esquecer do conhecimento?" rotuloConfirmar="Esquecer" perigoso aoCancelar={() => setEsquecer(null)}
          texto={<p>Isto remove {esquecer.descricao} do índice local. Os arquivos originais não são tocados; reindexar pode trazer de volta o que ainda existir.</p>}
          aoConfirmar={() => { const a = esquecer.alvo; setEsquecer(null); setValor(""); void store.esquecer(a); }} />
      ) : null}

      {purgando ? (
        <Dialogo titulo="Apagar todo o conhecimento deste projeto?" aoFechar={() => setPurgando(false)}>
          <div className="dialogo-corpo">
            <p>Isto apaga o índice, o grafo e os aprendizados deste projeto. Não dá para desfazer. Os arquivos do projeto não são tocados.</p>
            <div className="campo"><label htmlFor="con-purga">Digite o nome do projeto ({nomeWorkspace}) para confirmar</label><input id="con-purga" data-foco-inicial autoComplete="off" value={confirmacaoPurga} onChange={(ev) => setConfirmacaoPurga(ev.target.value)} /></div>
          </div>
          <div className="dialogo-acoes">
            <button type="button" className="botao" onClick={() => setPurgando(false)}>Cancelar</button>
            <button type="button" className="botao botao-perigo" disabled={confirmacaoPurga !== nomeWorkspace || nomeWorkspace === ""} onClick={() => { const c = confirmacaoPurga; setPurgando(false); void store.purgar(c); }}>Apagar tudo</button>
          </div>
        </Dialogo>
      ) : null}

      {importando ? (
        <Dialogo titulo="Importar histórico das CLIs" aoFechar={() => { setImportando(false); setCiente(false); }}>
          <div className="dialogo-corpo">
            <p>O ADE vai ler as conversas antigas da CLI escolhida neste computador e indexá-las localmente, para os agentes aprenderem com elas. Nada sai da máquina.</p>
            <p>Segredos (chaves, tokens, senhas) são mascarados antes de gravar, mas a mascaração não é perfeita: revise se o histórico tiver dados sensíveis.</p>
            <div className="campo"><label htmlFor="con-imp-cli">CLI</label><select id="con-imp-cli" data-foco-inicial value={cli} onChange={(ev) => setCli(ev.target.value as typeof cli)}>{CLIS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>
            <label><input type="checkbox" checked={ciente} onChange={(ev) => setCiente(ev.target.checked)} /> Entendo e autorizo a leitura do histórico</label>
          </div>
          <div className="dialogo-acoes">
            <button type="button" className="botao" onClick={() => { setImportando(false); setCiente(false); }}>Cancelar</button>
            <button type="button" className="botao botao-primario" disabled={!ciente} onClick={() => { setImportando(false); setCiente(false); void store.importarHistorico(cli); }}>Importar</button>
          </div>
        </Dialogo>
      ) : null}
    </div>
  );
}

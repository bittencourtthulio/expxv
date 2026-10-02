// Aba Backend (online, OPCIONAL; tudo desligado por padrão). O segredo digitado vive só neste componente até o salvar/testar e é zerado
// logo depois; o que volta do main são máscaras. A migração só começa depois do diálogo de consentimento (prévia → consentimento → envio).
import { useEffect, useMemo, useState } from "react";
import type { ModoBackend, TipoDocumento } from "../../../compartilhado/conhecimento";
import type { PedidoConfigurarBackend, ProvedorRag } from "../../../compartilhado/rag";
import { Badge } from "../../componentes/Badge";
import { Dialogo, DialogoConfirmacao } from "../../componentes/Dialogo";
import type { EstadoStoreRag, StoreRag } from "../../estado/rag";
import { avaliarUrl, formatarBytes, validarFormulario } from "./logica";

const TIPOS_PADRAO_LIGADOS: readonly TipoDocumento[] = ["doc", "relatorio", "decisao", "causa_raiz", "qa", "handoff", "task", "missao", "commit", "pr", "aprendizado", "nota"];
const TIPOS_FORTES: readonly TipoDocumento[] = ["codigo", "transcricao", "chat"];
const MODOS: ReadonlyArray<[ModoBackend, string, string]> = [["local", "Local", "tudo fica nesta máquina"], ["espelho", "Espelho", "cópia remota só sua"], ["compartilhado", "Compartilhado", "a equipe lê e escreve"]];
const ROTULO_ETAPA: Record<string, string> = { migrando: "Enviando…", pausada: "Pausada", verificando: "Verificando…", concluida: "Concluída", falhou: "Falhou", cancelada: "Cancelada", consentida: "Iniciando…" };

export interface PropsBackend { store: StoreRag; estado: EstadoStoreRag; aoVerConfig?: () => void }

export function Backend({ store, estado }: PropsBackend) {
  const b = estado.estado;
  const provedores = estado.provedores;
  const [provId, setProvId] = useState<ProvedorRag | "">("");
  const [url, setUrl] = useState("");
  const [colecao, setColecao] = useState("");
  const [valores, setValores] = useState<Record<string, string>>({});
  const [modo, setModo] = useState<ModoBackend>("local");
  const [tipos, setTipos] = useState<ReadonlySet<TipoDocumento>>(new Set(TIPOS_PADRAO_LIGADOS));
  const [equipe, setEquipe] = useState("");
  const [autor, setAutor] = useState("");
  const [tocou, setTocou] = useState(false);
  const [ciente, setCiente] = useState(false);
  const [apagando, setApagando] = useState(false);
  const [confirmaRemoto, setConfirmaRemoto] = useState("");
  const [voltando, setVoltando] = useState(false);
  const [baixar, setBaixar] = useState(false);

  // preenche o formulário com o que já está salvo (nunca o segredo)
  useEffect(() => {
    if (b === null) return;
    if (b.provedor !== null) setProvId(b.provedor);
    if (b.url !== null) setUrl(b.url);
    if (b.colecao_remota !== null) setColecao(b.colecao_remota);
    setModo(b.modo);
    if (b.tipos.length > 0) setTipos(new Set(b.tipos));
    if (b.equipe_id !== null) setEquipe(b.equipe_id);
    if (b.autor !== null) setAutor(b.autor);
  }, [b]);

  const prov = provedores.find((p) => p.id === provId) ?? null;
  const mascaras = b?.provedor === provId && b !== null ? b.segredos : {};
  const campos = prov?.campos ?? [];
  const v = useMemo(() => validarFormulario({ url, colecao, valores, mascaras, campos }), [url, colecao, valores, mascaras, campos]);
  const urlAval = avaliarUrl(url);
  const erro = (k: string): string | undefined => (tocou ? v.erros[k] : undefined);
  const algumTipoForte = TIPOS_FORTES.some((t) => tipos.has(t));

  const pedido = (): Omit<PedidoConfigurarBackend, "workspace_id"> | null => {
    if (prov === null) return null;
    const segredos: Record<string, string> = {};
    // campos extras do provedor que não são a URL (ex.: tabela do Supabase, namespace do Upstash/Pinecone) seguem junto: o main os guarda com as credenciais
    for (const c of prov.campos) if (c.chave !== "url" && (valores[c.chave] ?? "") !== "") segredos[c.chave] = valores[c.chave] as string;
    return {
      provedor: prov.id, url: url.trim(), colecao_remota: colecao.trim(), campos_secretos: segredos, modo, tipos: [...tipos],
      ...(equipe.trim() !== "" ? { equipe_id: equipe.trim() } : {}), ...(autor.trim() !== "" ? { autor: autor.trim() } : {}),
    };
  };
  const limparSegredos = (): void => setValores((x) => { const n = { ...x }; for (const c of campos) if (c.secreto) n[c.chave] = ""; return n; });

  const salvar = async (): Promise<void> => {
    setTocou(true);
    const p = pedido();
    if (p === null || !v.ok) return;
    const ok = await store.configurar(p);
    limparSegredos(); // o segredo nunca fica no estado do React depois de salvar
    if (ok) setTocou(false);
  };
  const testar = async (): Promise<void> => {
    setTocou(true);
    const p = pedido();
    if (p === null || !v.ok) return;
    await store.testar(p);
    limparSegredos();
  };

  if (!estado.disponivel) return <div className="con-rolavel"><p className="con-vazio" role="status">O backend online só funciona dentro do aplicativo.</p></div>;
  if (b === null) return <div className="con-rolavel"><p className="con-vazio" role="status" aria-busy={estado.carregando}>{estado.erro ?? "Carregando backend…"}</p></div>;

  const m = estado.maquina;
  const emVoo = m.etapa === "migrando" || m.etapa === "pausada" || m.etapa === "verificando" || m.etapa === "consentida";
  const pct = m.total > 0 ? Math.min(100, Math.round((m.enviados / m.total) * 100)) : 0;
  const previa = estado.previa;
  const teste = estado.teste.resultado;

  return (
    <div className="con-rolavel">
      <div className="con-secao">
        <p>Opcional. O conhecimento fica 100% local por padrão. Aqui você pode espelhar ou compartilhar o índice com um serviço online (Qdrant, Supabase, Upstash, Pinecone). Nada é enviado sem a sua autorização explícita.</p>
        {b.offline ? <p className="con-faixa" data-tom="info" role="status">offline: usando cópia de {b.ultima_sincronizacao !== null ? b.ultima_sincronizacao.slice(0, 10) : "data desconhecida"}{b.pendentes_envio > 0 ? ` · ${b.pendentes_envio} alterações aguardando envio` : ""}</p> : null}
        {estado.avisoRag !== null && !b.offline ? <p className="con-faixa" role="status">{estado.avisoRag}</p> : null}
        <p><Badge tom={b.modo === "local" ? "neutro" : "destaque"}>modo {b.modo}</Badge> {b.provedor !== null ? <>provedor {b.provedor}{b.host !== null ? ` · ${b.host}` : ""}{b.colecao_remota !== null ? ` · coleção ${b.colecao_remota}` : ""}</> : "nenhum provedor configurado"}</p>

        <h2>Provedor</h2>
        <div className="con-grade">
          <label htmlFor="rag-prov">Provedor</label>
          <select id="rag-prov" value={provId} onChange={(e) => { setProvId(e.target.value as ProvedorRag | ""); setValores({}); setTocou(false); }}>
            <option value="">Escolha…</option>{provedores.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
          {prov !== null ? (
            <>
              <label htmlFor="rag-url">URL do serviço</label>
              <span>
                <input id="rag-url" type="url" autoComplete="off" value={url} aria-invalid={erro("url") !== undefined} aria-describedby="rag-url-msg" onChange={(e) => setUrl(e.target.value)} />
                <span id="rag-url-msg" className={erro("url") !== undefined ? "con-erro" : "meta"}> {erro("url") ?? (urlAval.ok ? urlAval.aviso ?? "" : "")}</span>
              </span>
              <label htmlFor="rag-colecao">Coleção</label>
              <span><input id="rag-colecao" type="text" autoComplete="off" value={colecao} aria-invalid={erro("colecao") !== undefined} onChange={(e) => setColecao(e.target.value)} />{erro("colecao") !== undefined ? <span className="con-erro"> {erro("colecao")}</span> : null}</span>
              {prov.campos.map((c) => {
                const id = `rag-campo-${c.chave}`;
                const mascara = mascaras[c.chave];
                return (
                  <span key={c.chave} style={{ display: "contents" }}>
                    <label htmlFor={id}>{c.rotulo}{c.obrigatorio ? " *" : ""}</label>
                    <span>
                      <input id={id} type={c.secreto ? "password" : "text"} autoComplete={c.secreto ? "new-password" : "off"} spellCheck={false} value={valores[c.chave] ?? ""} placeholder={c.secreto && mascara !== undefined ? `configurada ${mascara}` : ""} aria-invalid={erro(c.chave) !== undefined} onChange={(e) => setValores((x) => ({ ...x, [c.chave]: e.target.value }))} />
                      {c.dica !== null ? <span className="meta"> {c.dica}</span> : null}
                      {erro(c.chave) !== undefined ? <span className="con-erro"> {erro(c.chave)}</span> : null}
                    </span>
                  </span>
                );
              })}
              <label htmlFor="rag-modo">Modo</label>
              <select id="rag-modo" value={modo} onChange={(e) => setModo(e.target.value as ModoBackend)}>{MODOS.map(([id, t, d]) => <option key={id} value={id}>{t} · {d}</option>)}</select>
              {modo === "compartilhado" ? (
                <>
                  <label htmlFor="rag-equipe">Equipe</label><input id="rag-equipe" type="text" autoComplete="off" value={equipe} onChange={(e) => setEquipe(e.target.value)} />
                  <label htmlFor="rag-autor">Seu nome na equipe</label><input id="rag-autor" type="text" autoComplete="off" value={autor} onChange={(e) => setAutor(e.target.value)} />
                </>
              ) : null}
            </>
          ) : null}
        </div>

        {prov !== null ? (
          <>
            <fieldset className="con-tipos-lista" style={{ border: 0, padding: 0, margin: "4px 0" }}>
              <legend className="meta">O que pode ser enviado</legend>
              {[...TIPOS_PADRAO_LIGADOS, ...TIPOS_FORTES].map((t) => (
                <label key={t}><input type="checkbox" checked={tipos.has(t)} onChange={(e) => setTipos((s) => { const n = new Set(s); if (e.target.checked) n.add(t); else n.delete(t); return n; })} /> {t}{TIPOS_FORTES.includes(t) ? " ⚠" : ""}</label>
              ))}
            </fieldset>
            {algumTipoForte ? <p className="con-faixa" role="note">Atenção: código, transcrições e conversas de chat podem conter segredos e dados pessoais. A mascaração é automática, mas não perfeita. Marque só se tiver certeza.</p> : null}
            <div className="con-acoes-linha">
              <button type="button" className="con-mini" data-tom="primario" disabled={estado.ocupado} onClick={() => void salvar()}>Salvar</button>
              <button type="button" className="con-mini" disabled={estado.teste.testando} onClick={() => void testar()}>Testar conexão</button>
              {b.provedor === prov.id && Object.keys(b.segredos).length > 0 ? <button type="button" className="con-mini" data-tom="perigo" onClick={() => void store.esquecerSegredo()}>Esquecer segredo</button> : null}
              {estado.teste.testando ? <span role="status">Testando…</span> : null}
              {teste !== null ? <span role="status"><Badge tom={teste.ok ? "sucesso" : "alerta"}>{teste.ok ? "conectou" : "falhou"}</Badge> {teste.ok ? `${teste.versao ?? ""}${teste.dimensao_remota !== undefined ? ` · ${teste.dimensao_remota} dimensões` : ""}` : teste.motivo ?? "sem motivo informado"}</span> : null}
            </div>
            {prov.script_preparacao !== null ? (
              <>
                <h2>Script de preparação ({prov.nome})</h2>
                <p>Rode uma vez no editor SQL do serviço antes de migrar.</p>
                <pre className="con-script" tabIndex={0}>{prov.script_preparacao}</pre>
                <div className="con-acoes-linha"><button type="button" className="con-mini" onClick={() => { void navigator.clipboard?.writeText(prov.script_preparacao ?? ""); }}>Copiar script</button></div>
              </>
            ) : null}
          </>
        ) : null}

        <h2>Migração</h2>
        {b.provedor === null ? <p>Salve um provedor para poder migrar.</p> : (
          <>
            {m.etapa === "inicio" || m.etapa === "previa" || m.etapa === "consentimento" || m.etapa === "concluida" || m.etapa === "falhou" || m.etapa === "cancelada" ? (
              <div className="con-acoes-linha">
                <button type="button" className="con-mini" disabled={estado.previaCarregando || estado.ocupado} onClick={() => void store.gerarPrevia([...tipos])}>{estado.previaCarregando ? "Montando prévia…" : "Prévia da migração"}</button>
              </div>
            ) : null}
            {previa !== null && (m.etapa === "previa" || m.etapa === "consentimento") ? (
              <section aria-label="Prévia da migração">
                <table className="con-tabela" aria-label="Itens por tipo">
                  <thead><tr><th scope="col">Tipo</th><th scope="col" className="num">Itens</th><th scope="col" className="num">Tamanho</th></tr></thead>
                  <tbody>{Object.entries(previa.por_tipo).map(([t, x]) => <tr key={t}><td>{t}</td><td className="num">{x.itens}</td><td className="num">{formatarBytes(x.bytes)}</td></tr>)}</tbody>
                  <tfoot><tr><th scope="row">Total</th><td className="num">{previa.total}</td><td /></tr></tfoot>
                </table>
                {previa.avisos.map((a) => <p key={a} className="con-faixa" role="note">{a}</p>)}
                {previa.amostra.length > 0 ? (
                  <>
                    <h2>Amostra (já com segredos mascarados)</h2>
                    <ul className="con-resultados">{previa.amostra.map((a) => <li key={`${a.tipo}:${a.origem}`} className="con-resultado"><div className="meta">{a.tipo} · {a.origem}</div><p>{a.trecho}</p></li>)}</ul>
                  </>
                ) : null}
                <div className="con-acoes-linha"><button type="button" className="con-mini" data-tom="primario" onClick={() => { setCiente(false); store.pedirConsentimento(); }}>Migrar…</button></div>
              </section>
            ) : null}
            {emVoo ? (
              <section aria-label="Progresso da migração">
                <div className="con-barra-mig" role="progressbar" aria-label="Progresso da migração" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></div>
                <p role="status">{ROTULO_ETAPA[m.etapa]} {m.enviados} de {m.total} ({pct}%)</p>
                <div className="con-acoes-linha">
                  {m.etapa === "pausada" ? <button type="button" className="con-mini" onClick={() => void store.retomar()}>Retomar</button> : <button type="button" className="con-mini" disabled={m.etapa !== "migrando"} onClick={() => void store.pausar()}>Pausar</button>}
                  <button type="button" className="con-mini" data-tom="perigo" onClick={() => void store.cancelar()}>Cancelar</button>
                </div>
              </section>
            ) : null}
            {m.etapa === "concluida" ? (
              <div className="con-acoes-linha">
                <p role="status">Migração concluída: {m.enviados} de {m.total}.</p>
                <button type="button" className="con-mini" onClick={() => void store.verificar()}>Verificar</button>
                {estado.verificacao !== null ? <span role="status"><Badge tom={estado.verificacao.ok ? "sucesso" : "alerta"}>{estado.verificacao.ok ? "íntegra" : "divergente"}</Badge> local {estado.verificacao.local} · remoto {estado.verificacao.remoto} · amostra {estado.verificacao.amostrados} · divergentes {estado.verificacao.divergentes}</span> : null}
                <button type="button" className="con-mini" onClick={() => store.reiniciarAssistente()}>Nova migração</button>
              </div>
            ) : null}
            {m.etapa === "falhou" || m.etapa === "cancelada" ? <p className="con-faixa" data-tom={m.etapa === "falhou" ? "erro" : "info"} role="status">Migração {m.etapa === "falhou" ? "falhou" : "cancelada"} depois de {m.enviados} de {m.total}. O que já foi enviado continua no remoto; nada local foi apagado. <button type="button" onClick={() => store.reiniciarAssistente()}>Recomeçar</button></p> : null}

            <h2>Voltar ao local e limpeza</h2>
            <div className="con-acoes-linha">
              {b.modo !== "local" ? <button type="button" className="con-mini" onClick={() => void store.sincronizar()}>Sincronizar agora</button> : null}
              <button type="button" className="con-mini" disabled={b.modo === "local"} onClick={() => { setBaixar(false); setVoltando(true); }}>Voltar para local</button>
              <button type="button" className="con-mini" data-tom="perigo" disabled={b.colecao_remota === null} onClick={() => { setConfirmaRemoto(""); setApagando(true); }}>Apagar remoto…</button>
            </div>
          </>
        )}
      </div>

      {m.etapa === "consentimento" && previa !== null ? (
        <Dialogo titulo="Autorizar o envio para fora desta máquina" aoFechar={() => store.recusarConsentimento()} largura={560}>
          <div className="dialogo-corpo">
            <dl className="con-grade" style={{ margin: "0 0 10px" }}>
              <dt>Provedor</dt><dd style={{ margin: 0 }}>{previa.destino.provedor}</dd>
              <dt>Servidor</dt><dd style={{ margin: 0 }}>{previa.destino.host}</dd>
              <dt>Coleção</dt><dd style={{ margin: 0 }}>{previa.destino.colecao}</dd>
              <dt>O que sai</dt><dd style={{ margin: 0 }}>{previa.total} itens ({Object.keys(previa.por_tipo).join(", ")}), já com segredos mascarados</dd>
              <dt>Quem verá</dt><dd style={{ margin: 0 }}>{modo === "compartilhado" ? `a equipe${equipe.trim() !== "" ? ` "${equipe.trim()}"` : ""} e o administrador do serviço` : "só você e o administrador do serviço"}</dd>
              <dt>Política</dt><dd style={{ margin: 0 }}>versão {previa.destino.versao_politica}</dd>
            </dl>
            <label><input type="checkbox" data-foco-inicial checked={ciente} onChange={(e) => setCiente(e.target.checked)} /> Li e autorizo o envio destes dados para este servidor</label>
          </div>
          <div className="dialogo-acoes">
            <button type="button" className="botao" onClick={() => store.recusarConsentimento()}>Cancelar</button>
            <button type="button" className="botao botao-primario" disabled={!ciente || estado.ocupado} onClick={() => void store.consentirEIniciar()}>Autorizar e migrar</button>
          </div>
        </Dialogo>
      ) : null}

      {voltando ? (
        <DialogoConfirmacao titulo="Voltar para o modo local?" rotuloConfirmar="Voltar para local" aoCancelar={() => setVoltando(false)}
          texto={<><p>O ADE passa a usar só o índice desta máquina. Nada é apagado, nem local nem remoto.</p><label><input type="checkbox" checked={baixar} onChange={(e) => setBaixar(e.target.checked)} /> Baixar antes o que só existe no remoto</label></>}
          aoConfirmar={() => { setVoltando(false); void store.voltarParaLocal(baixar); }} />
      ) : null}

      {apagando ? (
        <Dialogo titulo="Apagar a coleção remota?" aoFechar={() => setApagando(false)}>
          <div className="dialogo-corpo">
            <p>Isto apaga a coleção <strong>{b.colecao_remota}</strong> no servidor. Não dá para desfazer. O índice local não é tocado.</p>
            <div className="campo"><label htmlFor="rag-apagar">Digite o nome da coleção para confirmar</label><input id="rag-apagar" data-foco-inicial autoComplete="off" value={confirmaRemoto} onChange={(e) => setConfirmaRemoto(e.target.value)} /></div>
          </div>
          <div className="dialogo-acoes">
            <button type="button" className="botao" onClick={() => setApagando(false)}>Cancelar</button>
            <button type="button" className="botao botao-perigo" disabled={confirmaRemoto !== b.colecao_remota || b.colecao_remota === null} onClick={() => { const c = confirmaRemoto; setApagando(false); void store.apagarRemoto(c); }}>Apagar remoto</button>
          </div>
        </Dialogo>
      ) : null}
    </div>
  );
}

// Portabilidade (T-14.24): exportar, importar COM PRÉVIA OBRIGATÓRIA (membros, prompts completos, MCPs removidos, achados) e
// atualização de fábrica por membro. Nada é gravado antes da confirmação; o renderer nunca vê caminho absoluto.
import { useEffect, useState } from "react";
import type { ApiAde } from "../../../compartilhado/ipc";
import type { EstadoMembroFabrica, FabricaAtualizacao, PreviaImportacao, Squad } from "../../../compartilhado/squads";
import { LIMITES_SQUAD, PADRAO_SLUG } from "../../../compartilhado/squads";
import { Dialogo } from "../../componentes/Dialogo";
import { DiffDaFabrica } from "./DiffFabrica";

type ApiSquads = ApiAde["squads"];
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------- exportar
export function DialogoExportar({ api, slug, workspaceId, aoFechar }: { api: ApiSquads | undefined; slug: string; workspaceId: string | null; aoFechar: () => void }) {
  const [destino, setDestino] = useState<"repo" | "arquivo">(workspaceId === null ? "arquivo" : "repo");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<{ caminho: string | null } | null>(null);

  const exportar = async (): Promise<void> => {
    if (api === undefined) return;
    setOcupado(true);
    setErro(null);
    try {
      const r = await api.exportar({ slug, destino, ...(destino === "repo" && workspaceId !== null ? { workspace_id: workspaceId } : {}) });
      setFeito({ caminho: r.caminho_relativo });
    } catch (e) { setErro(`Não foi possível exportar: ${msg(e)}`); }
    finally { setOcupado(false); }
  };

  return (
    <Dialogo titulo={`Exportar squad: ${slug}`} aoFechar={aoFechar} largura={480}>
      {feito === null ? (
        <>
          <fieldset className="mis-grupo">
            <legend>Destino</legend>
            <label className="mis-opcao"><input type="radio" name="destino" checked={destino === "repo"} disabled={workspaceId === null} onChange={() => setDestino("repo")} /><span><strong>No repositório do workspace</strong><small>{workspaceId === null ? "Abra um workspace para exportar no repositório." : "Grava dentro da pasta do produto do projeto."}</small></span></label>
            <label className="mis-opcao"><input type="radio" name="destino" checked={destino === "arquivo"} onChange={() => setDestino("arquivo")} /><span><strong>Arquivo…</strong><small>Você escolhe onde salvar no seletor do sistema.</small></span></label>
          </fieldset>
          <p className="aviso-caixa" role="note">A exportação não é comitada pelo app: versionar o arquivo é decisão sua.</p>
          {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}
          <div className="dialogo-acoes">
            <button type="button" className="botao" onClick={aoFechar}>Cancelar</button>
            <button type="button" className="botao botao-primario" disabled={ocupado} onClick={() => void exportar()}>{ocupado ? "Exportando…" : "Exportar"}</button>
          </div>
        </>
      ) : (
        <>
          <p role="status">{feito.caminho === null ? "Squad exportada para o arquivo escolhido." : <>Squad exportada em <code>{feito.caminho}</code> (caminho relativo ao workspace).</>}</p>
          <p className="sq-vazio">O app não comita este arquivo.</p>
          <div className="dialogo-acoes"><button type="button" className="botao botao-primario" onClick={aoFechar}>Fechar</button></div>
        </>
      )}
    </Dialogo>
  );
}

// ---------------------------------------------------------------- importar
export function DialogoImportar({ api, workspaceId, aoFechar, aoImportada }: { api: ApiSquads | undefined; workspaceId: string | null; aoFechar: () => void; aoImportada: (s: Squad) => void }) {
  const [previa, setPrevia] = useState<PreviaImportacao | null>(null);
  const [nome, setNome] = useState("");
  const [slug, setSlug] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const ler = async (origem: "arquivo" | "repo"): Promise<void> => {
    if (api === undefined) return;
    setOcupado(true);
    setErro(null);
    try {
      const p = await api.importarPrevia(origem === "arquivo" ? { origem } : { origem, workspace_id: workspaceId as string, nome: nome.trim() });
      setPrevia(p);
      setSlug(p.squad.slug);
    } catch (e) { setErro(msg(e)); }
    finally { setOcupado(false); }
  };
  const confirmar = async (): Promise<void> => {
    if (api === undefined || previa === null) return;
    if (!PADRAO_SLUG.test(slug)) { setErro("Identificador inválido: minúsculas, números e hífen (até 40)."); return; }
    setOcupado(true);
    setErro(null);
    try { aoImportada(await api.importarConfirmar(previa.previa_id, slug)); }
    catch (e) { setErro(`Não foi possível importar: ${msg(e)}`); setOcupado(false); }
  };
  const nomeRepoOk = PADRAO_SLUG.test(nome.trim());

  if (previa === null) {
    return (
      <Dialogo titulo="Importar squad" aoFechar={aoFechar} largura={480}>
        <p className="sq-vazio">Você verá tudo o que a squad contém (inclusive os prompts) antes de confirmar. Nada é gravado nesta etapa.</p>
        <div className="sq-linha-botoes"><button type="button" className="botao botao-primario" disabled={ocupado} onClick={() => void ler("arquivo")}>Escolher arquivo…</button></div>
        <div className="sq-add">
          <input aria-label="Nome da squad exportada no repositório" placeholder="nome-da-squad" value={nome} disabled={workspaceId === null} spellCheck={false} onChange={(e) => setNome(e.target.value)} />
          <button type="button" className="botao" disabled={ocupado || workspaceId === null || !nomeRepoOk} onClick={() => void ler("repo")}>Ler do repositório</button>
        </div>
        {workspaceId === null ? <p className="sq-vazio">Abra um workspace para importar do repositório.</p> : null}
        {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}
        <div className="dialogo-acoes"><button type="button" className="botao" onClick={aoFechar}>Cancelar</button></div>
      </Dialogo>
    );
  }

  const removidos = [...previa.mcps_removidos.map((m) => `MCP ${m}`), ...previa.skills_removidas.map((s) => `skill ${s}`)];
  const erros = previa.achados.filter((a) => a.severidade === "erro");
  return (
    <Dialogo titulo={`Prévia da importação: ${previa.squad.nome}`} aoFechar={aoFechar} largura={720}>
      <p className="sq-vazio">Origem: importada. {previa.squad.membros.length} membros. Revise os prompts abaixo: eles serão executados por agentes.</p>
      {removidos.length > 0 ? (
        <div role="alert" className="aviso-caixa" data-testid="removidos">
          <strong>Removidos por segurança:</strong> {removidos.join(", ")}. Reabilite-os depois, se confiar neles.
        </div>
      ) : null}
      {previa.achados.length > 0 ? (
        <ul className="sq-achados" aria-label="Achados da importação">
          {previa.achados.map((a, i) => <li key={`${a.codigo}-${i}`} data-sev={a.severidade}><span className="sq-sev">{a.severidade === "erro" ? "erro" : "aviso"}</span> {a.mensagem}</li>)}
        </ul>
      ) : null}
      <div className="sq-previa-membros">
        {previa.squad.membros.map((m) => (
          <section key={m.slug} className="sq-previa-membro" aria-label={`Prompt de ${m.rotulo}`}>
            <h3>{m.rotulo} <small>{m.papel} · {m.perfil.cli}{m.perfil.modelo !== null ? ` · ${m.perfil.modelo}` : ""}</small></h3>
            <pre className="sq-previa-texto">{previa.prompts[m.slug] ?? "(sem prompt)"}</pre>
          </section>
        ))}
      </div>
      <label className="campo">Identificador da cópia
        <input value={slug} spellCheck={false} maxLength={LIMITES_SQUAD.slug_max} onChange={(e) => setSlug(e.target.value)} />
      </label>
      {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}
      <div className="dialogo-acoes">
        <button type="button" className="botao" onClick={aoFechar}>Cancelar</button>
        <button type="button" className="botao botao-primario" disabled={ocupado || erros.length > 0} onClick={() => void confirmar()}>{ocupado ? "Importando…" : "Importar como cópia"}</button>
      </div>
    </Dialogo>
  );
}

// ---------------------------------------------------------------- atualização de fábrica
const ROTULO_ESTADO: Record<EstadoMembroFabrica, string> = { igual: "igual à fábrica", atualizavel: "atualizável", editado: "editado por você", novo: "novo na fábrica", removido: "removido na fábrica" };

export function DialogoAtualizacaoFabrica({ api, slug, aoFechar, aoAplicada }: { api: ApiSquads | undefined; slug: string; aoFechar: () => void; aoAplicada: () => void }) {
  const [info, setInfo] = useState<FabricaAtualizacao | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  /** membros `editado` cujo diff está aberto, e os que o usuário aceitou sobrescrever (explícito, nunca por padrão). */
  const [comDiff, setComDiff] = useState<string | null>(null);
  const [sobrescrever, setSobrescrever] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (api === undefined) return;
    void api.fabricaAtualizacao(slug).then((i) => {
      setInfo(i);
      // `atualizavel` e `novo` vêm marcados; `editado` NUNCA (é preservado)
      setMarcados(new Set(i.membros.filter((m) => m.estado === "atualizavel" || m.estado === "novo").map((m) => m.membro)));
    }).catch((e: unknown) => setErro(msg(e)));
  }, [api, slug]);

  const aplicar = async (): Promise<void> => {
    if (api === undefined) return;
    setOcupado(true);
    setErro(null);
    try {
      const sobre = [...sobrescrever].filter((m) => marcados.has(m));
      await (sobre.length === 0 ? api.fabricaAplicar(slug, [...marcados]) : api.fabricaAplicar(slug, [...marcados], sobre));
      aoAplicada();
    }
    catch (e) { setErro(`Não foi possível aplicar: ${msg(e)}`); setOcupado(false); }
  };
  const alternar = (m: string): void => setMarcados((s) => { const n = new Set(s); if (n.has(m)) n.delete(m); else n.add(m); return n; });
  const aceitarSobrescrita = (m: string, valor: boolean): void => {
    setSobrescrever((s) => { const n = new Set(s); if (valor) n.add(m); else n.delete(m); return n; });
    setMarcados((s) => { const n = new Set(s); if (valor) n.add(m); else n.delete(m); return n; });
  };

  return (
    <Dialogo titulo={`Atualização de fábrica${info?.versao_nova != null ? ` (v${info.versao_nova})` : ""}`} aoFechar={aoFechar} largura={comDiff === null ? 520 : 760}>
      {info === null && erro === null ? <div aria-busy="true" /> : null}
      {info !== null ? (
        <>
          <p className="sq-vazio">Escolha o que atualizar. O que você editou é preservado, a menos que você veja as diferenças e aceite sobrescrever.</p>
          <ul className="sq-fab-lista" aria-label="Membros">
            {info.membros.map((m) => {
              const aplicavel = m.estado === "atualizavel" || m.estado === "novo";
              return (
                <li key={m.membro}>
                  <label>
                    <input type="checkbox" checked={marcados.has(m.membro)} disabled={!aplicavel} onChange={() => alternar(m.membro)} />
                    <code>{m.membro}</code>
                    <span className="sq-selo" data-tom={m.estado === "editado" ? "aviso" : m.estado === "igual" ? undefined : "destaque"}>{ROTULO_ESTADO[m.estado]}</span>
                  </label>
                  {m.estado === "editado" || m.estado === "atualizavel" || m.estado === "novo" ? (
                    <button type="button" className="botao sq-btn" aria-expanded={comDiff === m.membro} aria-label={`Ver diferenças de ${m.membro}`} onClick={() => setComDiff(comDiff === m.membro ? null : m.membro)}>Ver diferenças</button>
                  ) : null}
                  {comDiff === m.membro ? <DiffDaFabrica api={api} slug={slug} membro={m.membro} sobrescrever={sobrescrever.has(m.membro)} {...(m.estado === "editado" ? { aoSobrescrever: (v: boolean) => aceitarSobrescrita(m.membro, v) } : {})} /> : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}
      <div className="dialogo-acoes">
        <button type="button" className="botao" onClick={aoFechar}>Cancelar</button>
        <button type="button" className="botao botao-primario" disabled={ocupado || marcados.size === 0} onClick={() => void aplicar()}>Aplicar selecionados</button>
      </div>
    </Dialogo>
  );
}

// ---------------------------------------------------------------- apagar (digitar o slug)
export function DialogoApagar({ slug, emUso, aoConfirmar, aoCancelar }: { slug: string; emUso: boolean; aoConfirmar: () => Promise<void>; aoCancelar: () => void }) {
  const [digitado, setDigitado] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const confirmar = async (): Promise<void> => {
    setOcupado(true);
    try { await aoConfirmar(); } catch (e) { setErro(msg(e)); setOcupado(false); }
  };
  return (
    <Dialogo titulo="Apagar squad" aoFechar={aoCancelar} largura={440}>
      <div className="dialogo-corpo">
        <p>Para apagar <code>{slug}</code>, digite o identificador abaixo. Squad em uso por uma Missão ativa não pode ser apagada.</p>
        {emUso ? <p role="alert" className="erro-caixa">Esta squad está em uso por uma Missão ativa.</p> : null}
        <label className="campo">Identificador
          <input data-foco-inicial value={digitado} spellCheck={false} onChange={(e) => setDigitado(e.target.value)} />
        </label>
        {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}
      </div>
      <div className="dialogo-acoes">
        <button type="button" className="botao" onClick={aoCancelar}>Cancelar</button>
        <button type="button" className="botao botao-perigo" disabled={digitado !== slug || ocupado} onClick={() => void confirmar()}>Apagar</button>
      </div>
    </Dialogo>
  );
}


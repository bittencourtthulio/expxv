// Aba Etapas (T-16.32/33): matriz skill × etapa × perfil, com validação AO VIVO (V1..V9), linhas humanas travadas, perfis prontos,
// restaurar fábrica e importar/exportar com prévia. Editar uma célula atualiza o rascunho no mesmo quadro; a validação e a gravação vêm depois (300 ms).
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AchadoPipeline, CatalogoPipelines, EtapaConfig, EtapaConfigEfetiva, ModoExecucao, PerfilProntoDto, PreviaImportacaoPipelines } from "../../../compartilhado/maestro";
import { Dialogo, DialogoConfirmacao } from "../../componentes/Dialogo";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { ade } from "../../ade";
import { useCarga } from "../../estado/carga";
import { CLIS_DA_MATRIZ, COMPARATIVO_PERFIS, ESFORCOS_PADRAO, FAIXAS_PADRAO, ROTULO_FAIXA, ROTULO_MODO, achadosPorEtapa, agruparPorSkill, linhaTravada, podeDesligar, previaDoPerfilPronto, rotuloCli, rotuloEsforco, temErroDeValidacao } from "./logica";

type Escopo = "global" | "workspace";
const MODOS: readonly ModoExecucao[] = ["novo_terminal", "reusar_terminal", "confirmar", "desligada"];
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function Etapas({ workspaceId }: { workspaceId: string | null }) {
  const [escopo, setEscopo] = useState<Escopo>("global");
  const alvoWs = escopo === "workspace" ? workspaceId : null;
  const api = ade()?.pipelines;
  const catalogo = useCarga<CatalogoPipelines>(api === undefined ? undefined : () => api.catalogo(), "catalogo");
  const lista = useCarga<EtapaConfigEfetiva[]>(api === undefined ? undefined : () => api.listarConfig(alvoWs), `config|${alvoWs ?? "global"}`);
  const prontos = useCarga<PerfilProntoDto[]>(api === undefined ? undefined : () => api.perfisProntos(), "prontos");

  const [draft, setDraft] = useState<Map<string, EtapaConfigEfetiva>>(new Map());
  const [achados, setAchados] = useState<AchadoPipeline[]>([]);
  const [naoSalvas, setNaoSalvas] = useState<Set<string>>(new Set());
  const [aviso, setAviso] = useState<string | null>(null);
  const [skillsDe, setSkillsDe] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<{ tipo: "restaurar" } | { tipo: "pronto"; pronto: PerfilProntoDto } | null>(null);
  const [importando, setImportando] = useState(false);
  const [anuncio, setAnuncio] = useState("");
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => { if (lista.dados !== null) { setDraft(new Map(lista.dados.map((c) => [c.config.etapa_id, c]))); setNaoSalvas(new Set()); } }, [lista.dados]);
  useEffect(() => () => { for (const t of timers.current.values()) clearTimeout(t); }, []);
  const grupos = useMemo(() => agruparPorSkill(catalogo.dados?.etapas ?? []), [catalogo.dados]);
  const porEtapa = useMemo(() => achadosPorEtapa(achados), [achados]);

  const validarTudo = useCallback(async (): Promise<AchadoPipeline[]> => {
    if (api === undefined) return [];
    try {
      const a = await api.validar({ workspace_id: alvoWs, configs: [...draftRef.current.values()].map((c) => c.config) });
      setAchados(a);
      return a;
    } catch (e) { setAviso(`Não foi possível validar: ${msg(e)}`); return []; }
  }, [api, alvoWs]);

  const salvar = useCallback(async (etapaId: string): Promise<void> => {
    const atual = draftRef.current.get(etapaId);
    if (api === undefined || atual === undefined) return;
    const todos = await validarTudo();
    if (temErroDeValidacao(achadosPorEtapa(todos).get(etapaId) ?? [])) { setNaoSalvas((s) => new Set(s).add(etapaId)); return; }
    try {
      const r = await api.gravarConfig({ workspace_id: alvoWs, config: atual.config });
      setDraft((m) => new Map(m).set(etapaId, r.config));
      setNaoSalvas((s) => { const n = new Set(s); n.delete(etapaId); return n; });
      setAchados((a) => [...a.filter((x) => x.etapa_id !== etapaId), ...r.achados]);
      setAnuncio(`Etapa ${etapaId} salva.`);
    } catch (e) { setNaoSalvas((s) => new Set(s).add(etapaId)); setAviso(`Não foi possível salvar ${etapaId}: ${msg(e)}`); }
  }, [api, alvoWs, validarTudo]);

  const editar = (etapaId: string, mut: (c: EtapaConfig) => EtapaConfig): void => {
    const atual = draftRef.current.get(etapaId);
    if (atual === undefined) return;
    const novo: EtapaConfigEfetiva = { ...atual, config: { ...mut(atual.config), atualizado_por: "usuario" } };
    setDraft((m) => new Map(m).set(etapaId, novo));
    setNaoSalvas((s) => new Set(s).add(etapaId));
    const t = timers.current.get(etapaId);
    if (t !== undefined) clearTimeout(t);
    timers.current.set(etapaId, setTimeout(() => { timers.current.delete(etapaId); void salvar(etapaId); }, 300));
  };

  const aplicarLista = (l: EtapaConfigEfetiva[]): void => { setDraft(new Map(l.map((c) => [c.config.etapa_id, c]))); setNaoSalvas(new Set()); void validarTudo(); };
  const restaurar = async (): Promise<void> => {
    setConfirmar(null);
    try { aplicarLista(await (api as NonNullable<typeof api>).restaurarConfig({ workspace_id: alvoWs, etapa_id: null })); setAnuncio("Padrões de fábrica restaurados."); } catch (e) { setAviso(`Não foi possível restaurar: ${msg(e)}`); }
  };
  const aplicarPronto = async (p: PerfilProntoDto, cli: "manter" | "auto"): Promise<void> => {
    setConfirmar(null);
    try { aplicarLista(await (api as NonNullable<typeof api>).aplicarPronto({ workspace_id: alvoWs, pronto_id: p.id, cli })); setAnuncio(`Perfil ${p.nome} aplicado.`); } catch (e) { setAviso(`Não foi possível aplicar o perfil: ${msg(e)}`); }
  };
  const exportar = async (): Promise<void> => {
    try {
      const r = await (api as NonNullable<typeof api>).exportar({ workspace_id: alvoWs, destino: "repo" });
      setAviso(r.cancelado ? "Exportação cancelada." : `Exportado em ${r.caminho_relativo ?? "arquivo escolhido"}.`);
    } catch (e) { setAviso(`Não foi possível exportar: ${msg(e)}`); }
  };

  if (api === undefined) return <EstadoVazio icone="pipelines" titulo="A configuração só funciona no aplicativo" texto="Abra o aplicativo instalado para editar os perfis das etapas." />;
  if (catalogo.estado === "carregando" || lista.estado === "carregando") return <div className="pl-carregando" aria-busy="true" role="status">Carregando etapas…</div>;
  if (catalogo.estado === "erro" || lista.estado === "erro") return <div className="pl-erro" role="alert">{(catalogo.estado === "erro" ? catalogo.mensagem : lista.estado === "erro" ? lista.mensagem : "")} <button type="button" className="botao" onClick={() => { catalogo.recarregar(); lista.recarregar(); }}>Tentar de novo</button></div>;
  if (catalogo.estado === "indisponivel" || lista.estado === "indisponivel" || grupos.length === 0) return <EstadoVazio icone="pipelines" titulo="Nenhuma etapa disponível" texto="O catálogo do método não respondeu. Reinicie o aplicativo e tente de novo." />;

  const nErros = achados.filter((a) => a.severidade === "erro").length;
  return (
    <div className="pl-etapas">
      <header className="pl-secao-cab">
        <div>
          <h2>Quem executa cada etapa</h2>
          <p className="pl-discreto">Para cada etapa do método: a CLI, o modelo e o esforço. Mudanças são validadas na hora e salvas sozinhas.</p>
        </div>
      </header>
      <PerfisProntos prontos={prontos.dados ?? []} grupos={grupos} draft={draft} aoEscolher={(p) => setConfirmar({ tipo: "pronto", pronto: p })} />
      <div className="pl-linha pl-barra2" role="toolbar" aria-label="Ações da matriz">
        <div role="radiogroup" aria-label="Escopo da configuração" className="pl-grupo">
          <button type="button" role="radio" aria-checked={escopo === "global"} className="pl-nivel" onClick={() => setEscopo("global")}>Global</button>
          <button type="button" role="radio" aria-checked={escopo === "workspace"} disabled={workspaceId === null} className="pl-nivel" onClick={() => setEscopo("workspace")}>Este workspace</button>
        </div>
        <button type="button" className="botao" onClick={() => setConfirmar({ tipo: "restaurar" })}>Restaurar fábrica</button>
        <button type="button" className="botao" onClick={() => void exportar()}>Exportar</button>
        <button type="button" className="botao" onClick={() => setImportando(true)}>Importar…</button>
        <span className="pl-discreto" role="status">{nErros > 0 ? `${nErros} erro(s) de validação` : naoSalvas.size > 0 ? "salvando…" : "tudo salvo"}</span>
      </div>
      {aviso !== null ? <p className="pl-aviso" role="status">{aviso} <button type="button" className="botao pl-mini" onClick={() => setAviso(null)}>Fechar</button></p> : null}
      <span className="pl-sr" role="status" aria-live="polite">{anuncio}</span>
      <div className="pl-rolavel">
        <table className="pl-tabela pl-matriz" aria-label="Matriz de etapas por perfil">
          <thead><tr><th scope="col">Etapa</th><th scope="col">CLI</th><th scope="col">Modelo</th><th scope="col">Esforço</th><th scope="col">Faixa</th><th scope="col">Skills permitidas</th><th scope="col">Execução</th></tr></thead>
          {grupos.map((g) => (
            <tbody key={g.skill}>
              <tr className="pl-grupo-linha"><th scope="rowgroup" colSpan={7}>Método {g.skill}</th></tr>
              {g.etapas.map((def) => {
                const ef = draft.get(def.id);
                const erros = porEtapa.get(def.id) ?? [];
                if (linhaTravada(def)) {
                  return (
                    <tr key={def.id} className="pl-travada" data-humana>
                      <th scope="row"><span aria-hidden="true">🔒 </span>{def.nome}</th>
                      <td colSpan={6}>Ação humana: o Maestro para e avisa. Não há perfil, CLI nem modelo a configurar.</td>
                    </tr>
                  );
                }
                if (ef === undefined) return null;
                const c = ef.config;
                const idErro = `pl-erro-${def.id}`;
                return (
                  <Fragment key={def.id}>
                    <tr data-erro={erros.some((e) => e.severidade === "erro") || undefined} data-nao-salva={naoSalvas.has(def.id) || undefined}>
                      <th scope="row">{def.nome}<code className="pl-id">{def.id}</code>{def.piso ? <span className="pl-selo" title="etapa de piso: não pode ser desligada">piso</span> : null}</th>
                      <td>
                        <select aria-label={`CLI de ${def.nome}`} value={c.perfil.cli} aria-describedby={erros.length > 0 ? idErro : undefined} onChange={(e) => editar(def.id, (x) => ({ ...x, perfil: { ...x.perfil, cli: e.target.value } }))}>
                          {(CLIS_DA_MATRIZ.includes(c.perfil.cli) ? CLIS_DA_MATRIZ : [...CLIS_DA_MATRIZ, c.perfil.cli]).map((x) => <option key={x} value={x}>{rotuloCli(x)}</option>)}
                        </select>
                      </td>
                      <td>
                        <input aria-label={`Modelo de ${def.nome}`} placeholder="padrão da faixa" defaultValue={c.perfil.modelo ?? ""} key={`${def.id}-${c.perfil.modelo ?? ""}`} maxLength={100} onBlur={(e) => { const v = e.target.value.trim(); if (v !== (c.perfil.modelo ?? "")) editar(def.id, (x) => ({ ...x, perfil: { ...x.perfil, modelo: v === "" ? null : v } })); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                        <select aria-label={`Origem do modelo de ${def.nome}`} value={c.perfil.origem_modelo} onChange={(e) => editar(def.id, (x) => ({ ...x, perfil: { ...x.perfil, origem_modelo: e.target.value as "cli" | "openrouter" } }))}>
                          <option value="cli">da CLI</option><option value="openrouter">OpenRouter</option>
                        </select>
                      </td>
                      <td>
                        <select aria-label={`Esforço de ${def.nome}`} value={c.perfil.esforco ?? ""} onChange={(e) => editar(def.id, (x) => ({ ...x, perfil: { ...x.perfil, esforco: e.target.value === "" ? null : e.target.value } }))}>
                          <option value="">padrão</option>
                          {(c.perfil.esforco !== null && !ESFORCOS_PADRAO.includes(c.perfil.esforco) ? [...ESFORCOS_PADRAO, c.perfil.esforco] : ESFORCOS_PADRAO).map((x) => <option key={x} value={x}>{rotuloEsforco(x)}</option>)}
                        </select>
                      </td>
                      <td>
                        <select aria-label={`Faixa de ${def.nome}`} value={c.perfil.faixa} onChange={(e) => editar(def.id, (x) => ({ ...x, perfil: { ...x.perfil, faixa: e.target.value as EtapaConfig["perfil"]["faixa"] } }))}>
                          {FAIXAS_PADRAO.map((x) => <option key={x} value={x}>{ROTULO_FAIXA[x] ?? x}</option>)}
                        </select>
                      </td>
                      <td><button type="button" className="botao pl-mini" aria-label={`Skills permitidas de ${def.nome}: ${c.skills.length}`} onClick={() => setSkillsDe(def.id)}>skills ({c.skills.length})</button></td>
                      <td>
                        <select aria-label={`Execução de ${def.nome}`} value={c.modo_execucao} onChange={(e) => editar(def.id, (x) => ({ ...x, modo_execucao: e.target.value as ModoExecucao }))}>
                          {MODOS.map((m) => <option key={m} value={m} disabled={m === "desligada" && !podeDesligar(def)}>{ROTULO_MODO[m]}</option>)}
                        </select>
                      </td>
                    </tr>
                    {erros.length > 0 ? (
                      <tr className="pl-linha-erro"><td colSpan={7} id={idErro}>
                        <ul>{erros.map((e, i) => <li key={i} role={e.severidade === "erro" ? "alert" : undefined} data-tom={e.severidade === "erro" ? "erro" : "aviso"}><strong>{e.codigo}</strong> {e.severidade === "erro" ? "erro" : "aviso"}: {e.mensagem}{e.relacionadas !== undefined && e.relacionadas.length > 0 ? ` (junto com ${e.relacionadas.join(", ")})` : ""}</li>)}</ul>
                        {naoSalvas.has(def.id) ? <span className="pl-discreto">Não salvo: corrija o erro para gravar.</span> : null}
                      </td></tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
      {skillsDe !== null && draft.get(skillsDe) !== undefined ? <DialogoSkills etapaId={skillsDe} skills={(draft.get(skillsDe) as EtapaConfigEfetiva).config.skills} aoFechar={() => setSkillsDe(null)} aoSalvar={(s) => { editar(skillsDe, (x) => ({ ...x, skills: s })); setSkillsDe(null); }} /> : null}
      {confirmar?.tipo === "restaurar" ? <DialogoConfirmacao titulo="Restaurar os padrões de fábrica?" texto={`Todas as etapas ${escopo === "workspace" ? "deste workspace" : "globais"} voltam ao perfil de fábrica. Suas edições se perdem.`} rotuloConfirmar="Restaurar" perigoso aoCancelar={() => setConfirmar(null)} aoConfirmar={() => void restaurar()} /> : null}
      {confirmar?.tipo === "pronto" ? <DialogoPronto pronto={confirmar.pronto} aoCancelar={() => setConfirmar(null)} aoAplicar={(cli) => void aplicarPronto(confirmar.pronto, cli)} /> : null}
      {importando ? <DialogoImportar workspaceId={alvoWs} aoFechar={() => setImportando(false)} aoAplicado={(l) => { setImportando(false); aplicarLista(l); setAnuncio("Configuração importada."); }} /> : null}
    </div>
  );
}

/** Os perfis prontos lado a lado: o que cada um muda (faixa e esforço) e, abaixo, o efeito sobre cada etapa de hoje. Aplicar é sempre por confirmação. */
function PerfisProntos({ prontos, grupos, draft, aoEscolher }: { prontos: readonly PerfilProntoDto[]; grupos: ReturnType<typeof agruparPorSkill>; draft: ReadonlyMap<string, EtapaConfigEfetiva>; aoEscolher: (p: PerfilProntoDto) => void }) {
  if (prontos.length === 0) return null;
  const linhas = grupos.flatMap((g) => g.etapas).filter((d) => !d.humano && draft.get(d.id) !== undefined);
  return (
    <section className="pl-prontos" aria-label="Perfis prontos">
      <h3>Perfis prontos</h3>
      <p className="pl-discreto">Um clique troca a faixa e o esforço de todas as etapas editáveis. Etapas humanas e desligadas não mudam.</p>
      <div className="pl-prontos-lado" role="group" aria-label="Comparação dos perfis prontos">
        {prontos.map((p) => {
          const cmp = COMPARATIVO_PERFIS[p.id];
          return (
            <div key={p.id} className="pl-pronto">
              <button type="button" className="botao pl-pronto-nome" onClick={() => aoEscolher(p)}>{p.nome}</button>
              <p className="pl-pronto-desc">{p.descricao}</p>
              {cmp !== undefined ? (
                <>
                  <p className="pl-pronto-faixa">Faixa: {cmp.faixa}.</p>
                  <p className="pl-pronto-sub" id={`pl-esf-${p.id}`}>Esforço por faixa da etapa</p>
                  <dl className="pl-pronto-dados" aria-labelledby={`pl-esf-${p.id}`}>
                    {cmp.esforcos.map((x) => <div key={x.faixa}><dt>{x.faixa}</dt><dd>{x.esforco}</dd></div>)}
                  </dl>
                </>
              ) : null}
            </div>
          );
        })}
      </div>
      {linhas.length > 0 ? (
        <details className="pl-comparar">
          <summary>Comparar etapa por etapa</summary>
          <div className="pl-rolavel">
            <table className="pl-tabela" aria-label="Faixa e esforço por etapa em cada perfil pronto">
              <thead><tr><th scope="col">Etapa</th><th scope="col">Hoje</th>{prontos.map((p) => <th key={p.id} scope="col">{p.nome}</th>)}</tr></thead>
              <tbody>
                {linhas.map((d) => {
                  const c = (draft.get(d.id) as EtapaConfigEfetiva).config.perfil;
                  return (
                    <tr key={d.id}>
                      <th scope="row">{d.nome}</th>
                      <td>faixa {ROTULO_FAIXA[c.faixa] ?? c.faixa}, esforço {rotuloEsforco(c.esforco)}</td>
                      {prontos.map((p) => { const v = previaDoPerfilPronto(p.id, c.faixa); return <td key={p.id}>{v === null ? "faixa de fábrica do tipo" : `faixa ${ROTULO_FAIXA[v.faixa] ?? v.faixa}, esforço ${rotuloEsforco(v.esforco)}`}</td>; })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </section>
  );
}

function DialogoSkills({ etapaId, skills, aoFechar, aoSalvar }: { etapaId: string; skills: readonly string[]; aoFechar: () => void; aoSalvar: (s: string[]) => void }) {
  const [texto, setTexto] = useState(skills.join(", "));
  const lista = texto.split(/[\s,]+/).map((x) => x.trim()).filter((x) => x !== "");
  const invalido = lista.some((x) => !/^[a-z][a-z0-9-]{0,40}$/.test(x));
  return (
    <Dialogo titulo={`Skills permitidas — ${etapaId}`} aoFechar={aoFechar} largura={460}>
      <label className="pl-campo">Skills (separadas por vírgula; a skill da própria etapa é obrigatória)
        <textarea data-foco-inicial rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} />
      </label>
      {invalido ? <p className="pl-erro" role="alert">Use só letras minúsculas, números e hífen em cada skill.</p> : null}
      <div className="dialogo-acoes">
        <button type="button" className="botao" onClick={aoFechar}>Cancelar</button>
        <button type="button" className="botao botao-primario" disabled={invalido} onClick={() => aoSalvar(lista)}>Salvar</button>
      </div>
    </Dialogo>
  );
}

function DialogoPronto({ pronto, aoCancelar, aoAplicar }: { pronto: PerfilProntoDto; aoCancelar: () => void; aoAplicar: (cli: "manter" | "auto") => void }) {
  const [auto, setAuto] = useState(false);
  return (
    <Dialogo titulo={`Aplicar o perfil ${pronto.nome}?`} aoFechar={aoCancelar} largura={460}>
      <p>{pronto.descricao}</p>
      <p>Muda a faixa e o esforço de todas as etapas editáveis. Etapas humanas e desligadas não mudam.</p>
      <label className="pl-linha"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Deixar a CLI em “auto” (o harness escolhe a CLI instalada)</label>
      <div className="dialogo-acoes">
        <button type="button" className="botao" data-foco-inicial onClick={aoCancelar}>Cancelar</button>
        <button type="button" className="botao botao-primario" onClick={() => aoAplicar(auto ? "auto" : "manter")}>Aplicar</button>
      </div>
    </Dialogo>
  );
}

function DialogoImportar({ workspaceId, aoFechar, aoAplicado }: { workspaceId: string | null; aoFechar: () => void; aoAplicado: (l: EtapaConfigEfetiva[]) => void }) {
  const api = ade()?.pipelines;
  const [previa, setPrevia] = useState<PreviaImportacaoPipelines | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const carregar = async (origem: "repo" | "arquivo"): Promise<void> => {
    if (api === undefined) return;
    setOcupado(true); setErro(null);
    try { const p = await api.importarPrevia({ workspace_id: workspaceId, origem }); setPrevia(p.cancelado ? null : p); } catch (e) { setErro(msg(e)); } finally { setOcupado(false); }
  };
  const confirmar = async (): Promise<void> => {
    if (api === undefined || previa?.previa_id == null) return;
    setOcupado(true);
    try { aoAplicado(await api.importarConfirmar({ previa_id: previa.previa_id, workspace_id: workspaceId })); } catch (e) { setErro(msg(e)); setOcupado(false); }
  };
  const comErros = previa !== null && (previa.erros.length > 0 || temErroDeValidacao(previa.achados));
  return (
    <Dialogo titulo="Importar configuração de pipelines" aoFechar={aoFechar} largura={560}>
      {previa === null ? (
        <>
          <p>Escolha de onde importar. Nada é aplicado antes de você ver a prévia.</p>
          <div className="pl-acoes">
            <button type="button" className="botao" data-foco-inicial disabled={ocupado} onClick={() => void carregar("repo")}>Do repositório</button>
            <button type="button" className="botao" disabled={ocupado} onClick={() => void carregar("arquivo")}>De um arquivo…</button>
          </div>
        </>
      ) : (
        <div aria-label="Prévia da importação">
          <p>{previa.configs.length} etapa(s) no arquivo.</p>
          {previa.erros.length > 0 ? <ul className="pl-avisos" aria-label="Erros do arquivo">{previa.erros.map((e, i) => <li key={i} data-tom="erro"><strong>{e.campo || "arquivo"}</strong>: {e.motivo}</li>)}</ul> : null}
          {previa.achados.length > 0 ? <ul className="pl-avisos" aria-label="Achados da validação">{previa.achados.map((a, i) => <li key={i} data-tom={a.severidade === "erro" ? "erro" : "aviso"}><strong>{a.codigo}</strong> {a.etapa_id}: {a.mensagem}</li>)}</ul> : null}
          {comErros ? <p className="pl-erro" role="alert">A prévia tem erros: nada será aplicado.</p> : null}
        </div>
      )}
      {erro !== null ? <p className="pl-erro" role="alert">{erro}</p> : null}
      <div className="dialogo-acoes">
        <button type="button" className="botao" onClick={aoFechar}>Cancelar</button>
        {previa !== null ? <button type="button" className="botao botao-primario" disabled={comErros || ocupado || previa.previa_id === null} onClick={() => void confirmar()}>Aplicar</button> : null}
      </div>
    </Dialogo>
  );
}

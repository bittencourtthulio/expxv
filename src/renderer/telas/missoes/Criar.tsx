import { Fragment, useEffect, useState } from "react";
import type { Mission, ModoMissao, OrigemMissao, Papel } from "../../../compartilhado/dominio";
import type { ResultadoEnviarPrompt, Squad } from "../../../compartilhado/squads";
import { LIMITES_SQUAD } from "../../../compartilhado/squads";
import { ade } from "../../ade";
import { Dialogo } from "../../componentes/Dialogo";
import { storeProvedores, useProvedores, type StoreProvedores } from "../../estado/provedores";
import { storeSquads, useSquads, type StoreSquads } from "../../estado/squads";
import { CLI_AUTOMATICA, ROTULO_AUTOMATICO } from "./automatico";
import { RotaPrevista } from "./RotaPrevista";
import { DESCRICAO_MODO, ORIGENS_WIZARD, ROTULO_MODO, ROTULO_ORIGEM, ROTULO_PAPEL } from "./rotulos";
import { aplicarCli, montarPedido, papeisDoModo, papelObrigatorio, tituloDoObjetivo, validar, type ErrosMissao, type FormMissao } from "./validar";

export interface PropsCriar {
  workspaceId: string;
  criar: (pedido: ReturnType<typeof montarPedido>) => Promise<Mission>;
  aoFechar: () => void;
  aoCriada: (m: Mission) => void;
  provedores?: StoreProvedores;
  /** Fase 14: squads disponíveis para o modo squad (carregadas só quando esse modo é escolhido). */
  squads?: StoreSquads;
  /** abre o wizard já no modo indicado (ex.: "Nova Missão com squad…" da paleta). */
  modoInicial?: ModoMissao;
  /** Com squad escolhida, o objetivo vai pela caixa de prompt da squad (cria a Missão `squad` com o orquestrador como piloto). */
  enviarParaSquad?: (pedido: { squad_slug: string; objetivo: string }) => Promise<ResultadoEnviarPrompt>;
  aoCriadaPorSquad?: (missionId: string) => void;
}

const MODOS: readonly ModoMissao[] = ["livre", "squad", "agentico"];

export function CriarMissao({ workspaceId, criar, aoFechar, aoCriada, provedores = storeProvedores, squads = storeSquads, modoInicial = "livre", enviarParaSquad, aoCriadaPorSquad }: PropsCriar) {
  const { lista } = useProvedores(provedores);
  const { lista: listaSquads } = useSquads(squads);
  const [squadSlug, setSquadSlug] = useState("");
  const [squadCli, setSquadCli] = useState("");
  const [squadObj, setSquadObj] = useState<Squad | null>(null);
  const [form, setForm] = useState<FormMissao>({ modo: modoInicial, origem: "livre", titulo: "", pedido: "", clis: {}, cadeado: false });
  const [tentou, setTentou] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);

  useEffect(() => { if (provedores.obter().lista === null) void provedores.carregar(false); }, [provedores]);
  useEffect(() => { if (form.modo !== "livre" && squads.obter().lista === null) void squads.carregar(); }, [form.modo, squads]);

  // só CLIs reais e instaladas (o "terminal" puro não é papel de missão)
  const clis = (lista ?? []).map((p) => p.ferramenta).filter((f) => f.instalado && f.id !== "terminal");
  const squadsValidas = (listaSquads ?? []).filter((s) => s.valida);
  const comSquad = form.modo !== "livre" && squadSlug !== "";
  const resumoSquad = comSquad ? (listaSquads ?? []).find((s) => s.slug === squadSlug) : undefined;
  // "Automático (harness)": só com o harness ligado nesta janela (canal ausente = opção desabilitada, "indisponível")
  const harnessApi = ade()?.harness;
  const harnessOk = typeof harnessApi?.resolverPerfil === "function";
  const erros: ErrosMissao = validar(form, [...clis.map((c) => c.id), ...(harnessOk ? [CLI_AUTOMATICA] : [])]);
  if (comSquad) {
    // com squad, o perfil de cada membro vem da squad (não há CLI por papel) e o título nasce do objetivo
    for (const p of papeisDoModo(form.modo)) delete erros[p];
    delete erros.titulo;
    if (form.pedido.trim().length > LIMITES_SQUAD.objetivo_max) erros.pedido = `Com squad, o objetivo tem no máximo ${LIMITES_SQUAD.objetivo_max} caracteres.`;
  }
  const mostrar = (campo: keyof ErrosMissao) => (tentou ? erros[campo] : undefined);

  // perfil dos membros da squad escolhida (somente leitura), uma leitura por escolha
  useEffect(() => {
    setSquadObj(null);
    if (squadSlug === "") return undefined;
    let vivo = true;
    squads.obterSquad(squadSlug).then((s) => { if (vivo) setSquadObj(s); }).catch(() => undefined);
    return () => { vivo = false; };
  }, [squadSlug, squads]);

  const trocarModo = (modo: ModoMissao) => { setSquadSlug(""); setSquadCli(""); setForm((f) => ({ ...f, modo, clis: {} })); };
  const alternarCadeado = () => setForm((f) => {
    if (f.cadeado) return { ...f, cadeado: false };
    const base = f.clis[papeisDoModo(f.modo)[0] as Papel] ?? "";
    return aplicarCli({ ...f, cadeado: true }, papeisDoModo(f.modo)[0] as Papel, base);
  });

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setTentou(true);
    if (Object.keys(erros).length > 0) return;
    setEnviando(true);
    setFalha(null);
    try {
      if (comSquad) {
        // cadeado ou modo agêntico: a Missão nasce pelo canal de Missões com `squad_id` (o prompt direto cria sempre o modo `squad`)
        if (squadCli !== "" || form.modo === "agentico") {
          aoCriada(await criar(montarPedido({ ...form, titulo: tituloDoObjetivo(form.pedido), squad_id: squadSlug, squad_cli: squadCli }, workspaceId)));
          return;
        }
        const enviar = enviarParaSquad ?? ((p: { squad_slug: string; objetivo: string }) => ade()!.squads.enviarPrompt({ workspace_id: workspaceId, squad_slug: p.squad_slug, objetivo: p.objetivo, plano_antes: null, rigidez: null, max_paralelos: null }));
        const r = await enviar({ squad_slug: squadSlug, objetivo: form.pedido.trim() });
        aoCriadaPorSquad?.(r.mission_id);
        return;
      }
      aoCriada(await criar(montarPedido(form, workspaceId)));
    }
    catch (err) { setFalha(err instanceof Error ? err.message : String(err)); setEnviando(false); }
  };

  return (
    <Dialogo titulo="Nova missão" aoFechar={aoFechar} largura={600}>
      <form onSubmit={(e) => void enviar(e)} noValidate>
        <fieldset className="mis-grupo">
          <legend>Modo</legend>
          {MODOS.map((m) => (
            <label key={m} className="mis-opcao">
              <input type="radio" name="modo" checked={form.modo === m} onChange={() => trocarModo(m)} />
              <span><strong>{ROTULO_MODO[m]}</strong><small>{DESCRICAO_MODO[m]}</small></span>
            </label>
          ))}
        </fieldset>
        <label className="campo">Origem
          <select value={form.origem} onChange={(e) => setForm({ ...form, origem: e.target.value as OrigemMissao })}>
            {ORIGENS_WIZARD.map((o) => <option key={o} value={o}>{ROTULO_ORIGEM[o]}</option>)}
          </select>
        </label>
        {form.modo !== "livre" ? (
          <label className="campo">Squad
            <select value={squadSlug} onChange={(e) => { setSquadSlug(e.target.value); setSquadCli(""); }}>
              <option value="">{form.modo === "agentico" ? "Sem squad (opcional)" : "Sem squad (CLI por papel)"}</option>
              {squadsValidas.map((s) => <option key={s.slug} value={s.slug}>{s.nome} ({s.membros} membros)</option>)}
            </select>
            {resumoSquad !== undefined ? <span className="mis-squad-resumo" role="note">{resumoSquad.membros} membros · CLIs: {resumoSquad.clis.join(", ")} · o orquestrador da squad será o piloto e o perfil de cada membro vem da squad.</span> : null}
          </label>
        ) : null}
        {comSquad && squadObj !== null ? (
          <div className="campo">
            <ul className="mis-squad-membros" aria-label="Membros da squad">
              {squadObj.membros.map((m) => (
                <li key={m.slug}><strong>{m.rotulo}</strong> <small>{m.papel} · {m.perfil.cli}{m.perfil.modelo !== null ? ` · ${m.perfil.modelo}` : ""}{m.perfil.esforco !== null ? ` · ${m.perfil.esforco}` : ""}</small></li>
              ))}
            </ul>
            <label className="campo">Mesma CLI para todos (cadeado)
              <select value={squadCli} onChange={(e) => setSquadCli(e.target.value)}>
                <option value="">Manter o perfil de cada membro</option>
                {clis.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </label>
            <p className="mis-squad-resumo" role="note" aria-label="Aviso do cadeado">Vale só para esta Missão. Modelos inexistentes na CLI nova voltam ao padrão; o orquestrador mantém a CLI dele se a nova não tiver contrato de intake.</p>
          </div>
        ) : null}
        {!comSquad ? (
        <label className="campo">Título
          <input value={form.titulo} aria-invalid={mostrar("titulo") !== undefined} onChange={(e) => setForm({ ...form, titulo: e.target.value })} />
          {mostrar("titulo") !== undefined ? <span role="alert" className="campo-erro">{erros.titulo}</span> : null}
        </label>
        ) : null}
        <label className="campo">{comSquad ? "Objetivo para a squad" : "Pedido"}
          <textarea value={form.pedido} aria-invalid={mostrar("pedido") !== undefined} onChange={(e) => setForm({ ...form, pedido: e.target.value })} />
          {mostrar("pedido") !== undefined ? <span role="alert" className="campo-erro">{erros.pedido}</span> : null}
        </label>

        {comSquad ? null : <>
        <div className="mis-papeis-cab">
          <strong>{form.modo === "livre" ? "CLI" : "CLI por papel"}</strong>
          {form.modo !== "livre" ? (
            <button type="button" className="botao" aria-pressed={form.cadeado} title="Aplica a mesma CLI a todos os papéis" onClick={alternarCadeado}>
              {form.cadeado ? "Cadeado ligado: mesma CLI em todos" : "Cadeado: mesma CLI em todos"}
            </button>
          ) : null}
        </div>
        {lista !== null && clis.length === 0 ? (
          <p className="aviso-caixa" role="note">Nenhuma CLI instalada. Abra Provedores, instale uma CLI e atualize.</p>
        ) : null}
        {papeisDoModo(form.modo).map((p) => {
          const obrig = papelObrigatorio(form.modo, p);
          const rotulo = `${ROTULO_PAPEL[p]}${obrig ? " (obrigatório)" : ""}`;
          return (
            <Fragment key={p}>
            <label className="campo">{rotulo}
              <select value={form.clis[p] ?? ""} aria-invalid={mostrar(p) !== undefined} onChange={(e) => setForm((f) => aplicarCli(f, p, e.target.value))}>
                <option value="">{obrig ? "Escolha…" : "Não usar"}</option>
                <option value={CLI_AUTOMATICA} disabled={!harnessOk}>{ROTULO_AUTOMATICO}{harnessOk ? "" : " (indisponível)"}</option>
                {clis.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
              {mostrar(p) !== undefined ? <span role="alert" className="campo-erro">{erros[p]}</span> : null}
            </label>
            {form.clis[p] === CLI_AUTOMATICA ? <RotaPrevista papel={p} workspaceId={workspaceId} api={harnessApi} /> : null}
            </Fragment>
          );
        })}
        </>}
        {falha !== null ? <p role="alert" className="erro-caixa">Não foi possível criar: {falha}</p> : null}
        <div className="dialogo-acoes">
          <button type="button" className="botao" onClick={aoFechar}>Cancelar</button>
          <button type="submit" className="botao botao-primario" disabled={enviando}>{enviando ? "Criando…" : comSquad ? "Enviar à squad" : "Criar missão"}</button>
        </div>
      </form>
    </Dialogo>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApiAlertas, CanalVisao, FiltrosRegra, MetaTipoVisao, Regra, Severidade, SilencioDef, SilencioGlobalVisao, TipoAlerta } from "../../../compartilhado/alertas";
import { Dialogo, DialogoConfirmacao } from "../../componentes/Dialogo";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { ItemLista } from "../../componentes/ItemLista";
import { SEVERIDADE_VISUAL, silenciarAte } from "../../estado/alertas-formato";
import { avisoAgente, DIAS_SEMANA, NIVEIS, PRESETS, regraNova, resumoAgrupamento, resumoRegra, resumoSilencio, validarRegra, type RegraEditavel } from "./logica";

export const SILENCIO_VAZIO: SilencioGlobalVisao = { janela: {}, temporario_ate: null, temporario_incluir_criticos: false };

function comCampo(s: SilencioDef, k: "inicio" | "fim", v: string): SilencioDef {
  const { [k]: _removido, ...resto } = s;
  return v === "" ? resto : { ...resto, [k]: v };
}
function comSeveridade(f: FiltrosRegra, v: string): FiltrosRegra {
  const { severidade_min: _removido, ...resto } = f;
  return v === "" ? resto : { ...resto, severidade_min: v as Severidade };
}

function CamposSilencio({ valor, aoMudar, prefixo }: { valor: SilencioDef; aoMudar: (s: SilencioDef) => void; prefixo: string }) {
  const dias = valor.dias ?? [];
  return (
    <fieldset className="alertas-grupo">
      <legend>Horário de silêncio</legend>
      <label className="campo"><span>Início (HH:MM)</span><input aria-label={`${prefixo}: início`} value={valor.inicio ?? ""} placeholder="22:00" maxLength={5} onChange={(e) => aoMudar(comCampo(valor, "inicio", e.target.value))} /></label>
      <label className="campo"><span>Fim (HH:MM)</span><input aria-label={`${prefixo}: fim`} value={valor.fim ?? ""} placeholder="07:00" maxLength={5} onChange={(e) => aoMudar(comCampo(valor, "fim", e.target.value))} /></label>
      <div className="alertas-dias" role="group" aria-label={`${prefixo}: dias`}>
        {DIAS_SEMANA.map((d, i) => (
          <label key={d}><input type="checkbox" checked={dias.includes(i)} onChange={(e) => aoMudar({ ...valor, dias: e.target.checked ? [...dias, i].sort() : dias.filter((x) => x !== i) })} /> {d}</label>
        ))}
      </div>
      <label className="alertas-check"><input type="checkbox" checked={valor.excecao_critico === true} onChange={(e) => aoMudar({ ...valor, excecao_critico: e.target.checked })} /> Alertas críticos furam o silêncio</label>
    </fieldset>
  );
}
const limparSilencio = (s: SilencioDef): SilencioDef => {
  const o: SilencioDef = {};
  if (s.inicio !== undefined && s.inicio !== "") o.inicio = s.inicio;
  if (s.fim !== undefined && s.fim !== "") o.fim = s.fim;
  if (s.dias !== undefined && s.dias.length > 0) o.dias = s.dias;
  if (s.excecao_critico !== undefined) o.excecao_critico = s.excecao_critico;
  return o;
};

function EditorRegra({ regra, canais, catalogo, aoSalvar, aoFechar }: { regra: RegraEditavel; canais: readonly CanalVisao[]; catalogo: readonly MetaTipoVisao[]; aoSalvar: (r: RegraEditavel) => Promise<void>; aoFechar: () => void }) {
  const [r, setR] = useState<RegraEditavel>(regra);
  const [erros, setErros] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const canal = canais.find((c) => c.id === r.canal_id);
  const externo = canal !== undefined && canal.capacidades.precisa_consentimento;
  const aviso = avisoAgente(r.tipos, externo);
  const alternarTipo = (t: TipoAlerta | "*"): void => setR((x) => ({ ...x, tipos: x.tipos.includes(t) ? x.tipos.filter((y) => y !== t) : [...x.tipos, t] }));
  const salvar = async (): Promise<void> => {
    const limpa: RegraEditavel = { ...r, silencio: limparSilencio(r.silencio), nome: r.nome.trim() };
    const e = validarRegra(limpa);
    setErros(e);
    if (e.length > 0) return;
    setOcupado(true);
    try { await aoSalvar(limpa); } catch (x) { setErros([x instanceof Error ? x.message : "Não foi possível salvar a regra."]); setOcupado(false); }
  };
  const mudarModo = (modo: string): void => {
    const m = modo as RegraEditavel["agrupamento"]["modo"];
    setR({ ...r, agrupamento: m === "lote" ? { modo: m, janela_s: 30 } : m === "digest" ? { modo: m, hora_digest: "18:00" } : { modo: m } });
  };
  return (
    <Dialogo titulo={regra.id === undefined ? "Nova regra" : "Editar regra"} aoFechar={aoFechar} largura={640}>
      <div className="dialogo-corpo alertas-editor">
        <label className="campo"><span>Nome</span><input data-foco-inicial value={r.nome} maxLength={80} onChange={(e) => setR({ ...r, nome: e.target.value })} /></label>
        <label className="campo"><span>Canal</span>
          <select value={r.canal_id} onChange={(e) => setR({ ...r, canal_id: e.target.value })}>
            <option value="">Escolha…</option>
            {canais.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.estado === "ativo" ? "" : ` (${c.estado})`}</option>)}
          </select>
        </label>
        <fieldset className="alertas-grupo">
          <legend>Tipos de alerta</legend>
          <label className="alertas-check"><input type="checkbox" checked={r.tipos.includes("*")} onChange={() => alternarTipo("*")} /> Todos os tipos (curinga)</label>
          <div className="alertas-tipos">
            {catalogo.map((c) => (
              <label key={c.tipo} className="alertas-check" data-indisponivel={c.fonte_indisponivel || undefined}>
                <input type="checkbox" checked={r.tipos.includes(c.tipo)} onChange={() => alternarTipo(c.tipo)} /> {c.rotulo}{c.fonte_indisponivel ? " (sem fonte ainda)" : ""}
              </label>
            ))}
          </div>
          {aviso !== null ? <p role="note" className="alertas-aviso">{aviso}</p> : null}
        </fieldset>
        <label className="campo"><span>Nível da mensagem</span>
          <select value={r.nivel} onChange={(e) => setR({ ...r, nivel: e.target.value as RegraEditavel["nivel"] })}>{NIVEIS.map((n) => <option key={n.id} value={n.id}>{n.rotulo}</option>)}</select>
        </label>
        <fieldset className="alertas-grupo">
          <legend>Envio</legend>
          <label className="campo"><span>Modo</span>
            <select value={r.agrupamento.modo} onChange={(e) => mudarModo(e.target.value)}>
              <option value="imediato">Imediato</option><option value="lote">Em lote</option><option value="digest">Resumo diário</option>
            </select>
          </label>
          {r.agrupamento.modo === "lote" ? <label className="campo"><span>Janela do lote (segundos)</span><input type="number" min={5} max={3600} value={r.agrupamento.janela_s ?? 30} onChange={(e) => setR({ ...r, agrupamento: { ...r.agrupamento, janela_s: Number(e.target.value) } })} /></label> : null}
          {r.agrupamento.modo === "digest" ? <label className="campo"><span>Hora do resumo (HH:MM)</span><input value={r.agrupamento.hora_digest ?? ""} maxLength={5} onChange={(e) => setR({ ...r, agrupamento: { ...r.agrupamento, hora_digest: e.target.value } })} /></label> : null}
        </fieldset>
        <fieldset className="alertas-grupo">
          <legend>Filtros</legend>
          <label className="campo"><span>Severidade mínima</span>
            <select value={r.filtros.severidade_min ?? ""} onChange={(e) => setR({ ...r, filtros: comSeveridade(r.filtros, e.target.value) })}>
              <option value="">Qualquer</option>{(Object.keys(SEVERIDADE_VISUAL) as Severidade[]).map((s) => <option key={s} value={s}>{SEVERIDADE_VISUAL[s].texto}</option>)}
            </select>
          </label>
          <label className="alertas-check"><input type="checkbox" checked={r.filtros.so_atrasadas === true} onChange={(e) => setR({ ...r, filtros: { ...r.filtros, so_atrasadas: e.target.checked } })} /> Só o que está atrasado</label>
        </fieldset>
        <CamposSilencio valor={r.silencio} aoMudar={(s) => setR({ ...r, silencio: s })} prefixo="Silêncio da regra" />
        {erros.length > 0 ? <ul role="alert" className="campo-erro">{erros.map((e) => <li key={e}>{e}</li>)}</ul> : null}
      </div>
      <div className="dialogo-acoes">
        <button type="button" className="botao" onClick={aoFechar}>Cancelar</button>
        <button type="button" className="botao botao-primario" disabled={ocupado} onClick={() => void salvar()}>{ocupado ? "Salvando…" : "Salvar regra"}</button>
      </div>
    </Dialogo>
  );
}

export function Regras({ api, catalogo, aoAbrirCanais }: { api: ApiAlertas; catalogo: readonly MetaTipoVisao[]; aoAbrirCanais: () => void }) {
  const [regras, setRegras] = useState<Regra[] | null>(null);
  const [canais, setCanais] = useState<CanalVisao[]>([]);
  const [silencio, setSilencio] = useState<SilencioGlobalVisao>(SILENCIO_VAZIO);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [editando, setEditando] = useState<RegraEditavel | null>(null);
  const [apagando, setApagando] = useState<Regra | null>(null);
  const rotulos = useMemo(() => new Map<string, string>(catalogo.map((c) => [c.tipo, c.rotulo])), [catalogo]);
  const nomeCanal = (id: string): string => canais.find((c) => c.id === id)?.nome ?? id;

  const carregar = useCallback(async (): Promise<void> => {
    try {
      const [r, c, s] = await Promise.all([api.regrasListar(), api.canais.listar(), api.silencioLer()]);
      setRegras(r); setCanais(c); setSilencio(s); setErro(null);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível ler as regras."); }
  }, [api]);
  useEffect(() => { void carregar(); }, [carregar]);

  const gravar = async (r: RegraEditavel): Promise<void> => { await api.regraGravar(r); setEditando(null); await carregar(); };
  const preset = async (id: (typeof PRESETS)[number]["id"], tipo: "so" | "telegram"): Promise<void> => {
    const canal = canais.find((c) => c.tipo === tipo);
    if (canal === undefined) { setAviso(tipo === "telegram" ? "Configure o Telegram na aba Canais antes de usar este modelo." : "Canal indisponível."); return; }
    try { await api.regraPreset(id, canal.id); setAviso(null); await carregar(); } catch { setAviso("Não foi possível criar a regra pronta."); }
  };
  const gravarSilencio = async (s: SilencioGlobalVisao): Promise<void> => {
    try { setSilencio(await api.silencioGravar({ ...s, janela: limparSilencio(s.janela) })); setAviso(null); } catch { setAviso("Não foi possível salvar o silêncio."); }
  };

  return (
    <div className="alertas-regras">
      {erro !== null ? <div role="alert" className="alertas-erro">{erro} <button type="button" className="botao alertas-mini" onClick={() => void carregar()}>Tentar de novo</button></div> : null}
      {aviso !== null ? <p role="status" className="alertas-aviso">{aviso} {aviso.includes("aba Canais") ? <button type="button" className="alertas-link" onClick={aoAbrirCanais}>Abrir Canais</button> : null}</p> : null}
      <section aria-label="Regras prontas" className="alertas-bloco">
        <h2>Regras prontas</h2>
        <div className="alertas-linha-botoes">
          {PRESETS.map((p) => <button key={p.id} type="button" className="botao alertas-mini" onClick={() => void preset(p.id, p.canal)}>{p.rotulo}</button>)}
        </div>
      </section>
      <section aria-label="Silêncio global" className="alertas-bloco">
        <h2>Silêncio global</h2>
        <p className="alertas-nota" role="status">{silencio.temporario_ate !== null && Date.parse(silencio.temporario_ate) > Date.now() ? `Tudo silenciado até ${new Date(silencio.temporario_ate).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.` : "Sem silêncio temporário."}</p>
        <div className="alertas-linha-botoes">
          <button type="button" className="botao alertas-mini" onClick={() => void gravarSilencio({ ...silencio, temporario_ate: silenciarAte(1, Date.now()) })}>Silenciar tudo por 1 h</button>
          <button type="button" className="botao alertas-mini" disabled={silencio.temporario_ate === null} onClick={() => void gravarSilencio({ ...silencio, temporario_ate: null })}>Parar silêncio</button>
          <label className="alertas-check"><input type="checkbox" checked={silencio.temporario_incluir_criticos} onChange={(e) => void gravarSilencio({ ...silencio, temporario_incluir_criticos: e.target.checked })} /> O silêncio temporário também cobre os críticos</label>
        </div>
        <CamposSilencio valor={silencio.janela} aoMudar={(j) => setSilencio({ ...silencio, janela: j })} prefixo="Silêncio global" />
        <button type="button" className="botao alertas-mini" onClick={() => void gravarSilencio(silencio)}>Salvar horário global</button>
      </section>
      <section aria-label="Regras" className="alertas-bloco">
        <div className="alertas-bloco-cab"><h2>Regras</h2><button type="button" className="botao botao-primario alertas-mini" onClick={() => setEditando(regraNova(canais[0]?.id ?? ""))}>Nova regra</button></div>
        {regras === null ? <p className="alertas-nota" role="status" aria-busy="true">Lendo regras…</p>
          : regras.length === 0 ? <EstadoVazio icone="alerta" titulo="Nenhuma regra ainda" texto="Sem regras, nada sai do app. Use uma regra pronta acima ou crie a sua." />
          : (
            <div className="alertas-regras-lista" role="list" aria-label="Regras de alerta">
              {regras.map((r) => (
                <ItemLista
                  key={r.id}
                  id={r.id}
                  titulo={`${r.nome}${r.origem === "pedido_remoto" ? " (pedido remoto)" : ""}`}
                  descricao={resumoRegra(r, rotulos)}
                  selos={[
                    { texto: r.ativa ? "Ativa" : "Desligada", tom: r.ativa ? "sucesso" : "neutro" },
                    { texto: nomeCanal(r.canal_id) },
                    { texto: resumoAgrupamento(r) },
                    { texto: resumoSilencio(r) },
                  ]}
                  meta={r.nivel}
                  aoAbrir={() => setEditando(r)}
                  acao={<button type="button" className="botao alertas-mini" aria-label={`Editar a regra ${r.nome}`} onClick={() => setEditando(r)}>Editar</button>}
                >
                  <span className="alertas-acoes">
                    <button type="button" className="alertas-mini-botao" aria-label={`${r.ativa ? "Desligar" : "Ligar"} a regra ${r.nome}`} onClick={() => void gravar({ ...r, ativa: !r.ativa })}>{r.ativa ? "Desligar" : "Ligar"}</button>
                    <button type="button" className="alertas-mini-botao" aria-label={`Apagar a regra ${r.nome}`} onClick={() => setApagando(r)}>Apagar</button>
                  </span>
                </ItemLista>
              ))}
            </div>
          )}
      </section>
      {editando !== null ? <EditorRegra regra={editando} canais={canais} catalogo={catalogo} aoSalvar={gravar} aoFechar={() => setEditando(null)} /> : null}
      {apagando !== null ? <DialogoConfirmacao titulo="Apagar regra" texto={<p>Apagar a regra &ldquo;{apagando.nome}&rdquo;? Os alertas já criados não mudam.</p>} rotuloConfirmar="Apagar" perigoso aoCancelar={() => setApagando(null)} aoConfirmar={() => { const id = apagando.id; setApagando(null); void api.regraApagar(id).then(carregar, () => setAviso("Não foi possível apagar a regra.")); }} /> : null}
    </div>
  );
}

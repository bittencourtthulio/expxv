import { useId, useState, type ReactElement } from "react";
import type { ConfigBoard, ConfigCusto, FonteDeUsoEstado, PedidoGravarPreco, Preco } from "../../../compartilhado/custo";
import type { ApiAde } from "../../../compartilhado/ipc";
import { ade } from "../../ade";
import { DialogoConfirmacao } from "../../componentes/Dialogo";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { useCarga } from "../../estado/carga";

type ApiCusto = Partial<ApiAde["custo"]>;
const ROTULO_ESTADO: Record<FonteDeUsoEstado["estado"], string> = { lendo: "lendo", sem_fonte: "sem fonte", erro: "erro", encerrada: "encerrada" };
const num = (t: string): number | null => { const n = Number(t.replace(",", ".")); return t.trim() !== "" && Number.isFinite(n) ? n : null; };
const preco = (n: number | null): string => (n === null ? "derivado" : `US$ ${n}`);

function FormPreco({ aoGravar }: { aoGravar: (p: PedidoGravarPreco) => Promise<void> }) {
  const id = useId();
  const [v, setV] = useState({ padrao: "", e: "", s: "", ce: "", cl: "" });
  const [erro, setErro] = useState<string | null>(null);
  const enviar = async (): Promise<void> => {
    const e = num(v.e), s = num(v.s);
    if (v.padrao.trim() === "" || e === null || s === null || e < 0 || s < 0) { setErro("Informe o modelo (ex.: claude-sonnet-*) e os preços de entrada e saída por milhão de tokens, em US$."); return; }
    const ce = v.ce.trim() === "" ? null : num(v.ce), cl = v.cl.trim() === "" ? null : num(v.cl);
    if ((v.ce.trim() !== "" && ce === null) || (v.cl.trim() !== "" && cl === null)) { setErro("Os preços de cache precisam ser números."); return; }
    setErro(null);
    await aoGravar({ padrao: v.padrao.trim(), entrada_por_mtok: e, saida_por_mtok: s, cache_escrita_por_mtok: ce, cache_leitura_por_mtok: cl });
    setV({ padrao: "", e: "", s: "", ce: "", cl: "" });
  };
  const campo = (k: keyof typeof v, rotulo: string, ph = ""): ReactElement => <label htmlFor={`${id}-${k}`}>{rotulo}<input id={`${id}-${k}`} value={v[k]} placeholder={ph} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></label>;
  return (
    <div className="fp-form" role="group" aria-label="Cadastrar preço">
      {campo("padrao", "Modelo ou padrão", "claude-sonnet-*")}{campo("e", "Entrada US$/Mtok")}{campo("s", "Saída US$/Mtok")}{campo("ce", "Cache escrita (opc.)")}{campo("cl", "Cache leitura (opc.)")}
      <button type="button" className="botao-mini" onClick={() => void enviar()}>Gravar preço</button>
      {erro !== null ? <span role="alert" className="erro-caixa">{erro}</span> : null}
    </div>
  );
}

/** P-80 (opt-in por workspace): bloquear NOVOS cards delegados quando a Missão passa do teto. Padrão desligado (só avisa); nada em andamento é interrompido. */
export function BloqueioTeto({ workspaceId, api }: { workspaceId: string | null; api: Partial<ApiAde["board"]> | undefined }) {
  const cfg = useCarga<ConfigBoard>(api?.configLer === undefined || workspaceId === null ? undefined : () => api.configLer!(workspaceId), `b|${workspaceId ?? ""}`);
  const [erro, setErro] = useState<string | null>(null);
  if (api?.configGravar === undefined || workspaceId === null) return null;
  const ligado = cfg.dados?.bloquear_ao_estourar_teto === true;
  const alternar = async (v: boolean): Promise<void> => {
    if (cfg.dados === null) return;
    try { await api.configGravar!(workspaceId, { ...cfg.dados, bloquear_ao_estourar_teto: v }); setErro(null); cfg.recarregar(); } catch { setErro("Não foi possível gravar a opção."); }
  };
  return (
    <div role="group" aria-label="Bloqueio por teto">
      <label className="bd-check"><input type="checkbox" checked={ligado} disabled={cfg.dados === null} onChange={(e) => void alternar(e.target.checked)} />Bloquear novos cards delegados quando a Missão passar do teto (este workspace)</label>
      <p className="consumo-nota">Desligado: só avisa. Ligado: o ADE não inicia novo card; o que já está em andamento nunca é interrompido.</p>
      {erro !== null ? <span role="alert" className="erro-caixa">{erro}</span> : null}
    </div>
  );
}

/** Aba "Fontes e preços": estado das fontes de uso, tabela de preços (embutidos, OpenRouter, do usuário), câmbio manual, teto padrão, reprecificar (com confirmação), reindexar e diagnóstico sem conteúdo. */
export function FontesPrecos({ workspaceId, api = ade()?.custo, apiBoard = ade()?.board }: { workspaceId: string | null; api?: ApiCusto | undefined; apiBoard?: Partial<ApiAde["board"]> | undefined }) {
  const fontes = useCarga<FonteDeUsoEstado[]>(api?.fontes === undefined ? undefined : () => api.fontes!(workspaceId ?? undefined), `f|${workspaceId ?? ""}`);
  const precos = useCarga<Preco[]>(api?.precosListar === undefined ? undefined : () => api.precosListar!(), "p");
  const cfg = useCarga<ConfigCusto>(api?.configLer === undefined ? undefined : () => api.configLer!(), "c");
  const [aviso, setAviso] = useState<string | null>(null);
  const [reprec, setReprec] = useState<{ n: number } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [form, setForm] = useState<{ cambio: string; teto: string; ler: boolean; alertar: boolean; ret: string; aviso: string } | null>(null);
  const idc = useId();

  const f = form ?? (cfg.dados === null ? null : { cambio: cfg.dados.cambio_brl === null ? "" : String(cfg.dados.cambio_brl), teto: cfg.dados.teto_padrao_missao_usd === null ? "" : String(cfg.dados.teto_padrao_missao_usd), ler: cfg.dados.ler_transcripts, alertar: cfg.dados.alertar_preco_ausente, ret: String(cfg.dados.retencao_bruta_dias), aviso: cfg.dados.aviso_teto_pct === null ? "" : String(cfg.dados.aviso_teto_pct) });
  const semPreco = (precos.dados ?? []).length === 0;

  const gravarConfig = async (): Promise<void> => {
    if (f === null || cfg.dados === null || api?.configGravar === undefined) return;
    const cambio = f.cambio.trim() === "" ? null : num(f.cambio), teto = f.teto.trim() === "" ? null : num(f.teto), ret = num(f.ret), av = f.aviso.trim() === "" ? null : num(f.aviso);
    if ((f.cambio.trim() !== "" && (cambio === null || cambio <= 0)) || (f.teto.trim() !== "" && (teto === null || teto <= 0)) || ret === null || ret < 1 || ret > 3650 || (f.aviso.trim() !== "" && (av === null || av <= 0 || av > 100))) { setAviso("Revise os números: câmbio e teto maiores que zero, retenção de 1 a 3650 dias, aviso de 1 a 100%."); return; }
    try { await api.configGravar({ ...cfg.dados, cambio_brl: cambio, teto_padrao_missao_usd: teto, ler_transcripts: f.ler, alertar_preco_ausente: f.alertar, retencao_bruta_dias: Math.round(ret), aviso_teto_pct: av }); setAviso("Configuração gravada."); setForm(null); cfg.recarregar(); }
    catch { setAviso("Não foi possível gravar a configuração."); }
  };
  const executar = async (fn: () => Promise<string>): Promise<void> => { setOcupado(true); try { setAviso(await fn()); } catch { setAviso("A operação falhou."); } finally { setOcupado(false); } };

  if (api === undefined) return <EstadoVazio icone="consumo" titulo="Custo indisponível" texto="Esta janela não está ligada ao serviço de custo. Abra o app para ver as fontes de uso e os preços." />;
  return (
    <div className="fp" aria-label="Fontes e preços">
      {aviso !== null ? <p className="consumo-nota" role="status">{aviso}</p> : null}
      <section aria-label="Fontes de uso">
        <h2>Fontes de uso</h2>
        {fontes.estado === "carregando" ? <p className="consumo-nota" aria-busy="true">Lendo…</p> : fontes.estado === "erro" ? <p role="alert" className="erro-caixa">{fontes.mensagem}</p>
          : (fontes.dados ?? []).length === 0 ? <p className="consumo-nota">Nenhuma fonte ainda: elas surgem quando um Pane de CLI roda neste workspace.</p>
          : (fontes.dados ?? []).map((x, i) => (
            <div key={`${x.pane_id ?? ""}|${x.cli}|${i}`} className="fp-fonte">
              <span>{x.cli}</span><span data-estado={x.estado}>{x.estado === "erro" ? "! " : x.estado === "sem_fonte" ? "— " : ""}{ROTULO_ESTADO[x.estado]}</span>
              <span>{x.estado === "sem_fonte" ? "sem leitor de uso: o custo desta CLI fica como desconhecido (nunca 0)" : x.erro_codigo !== null ? `erro: ${x.erro_codigo}` : `${x.linhas_puladas} linhas puladas`}</span>
              <span>{x.atraso_s === null ? "—" : `atraso ${x.atraso_s} s`}</span>
            </div>
          ))}
      </section>
      <section aria-label="Preços">
        <h2>Preços por milhão de tokens (US$)</h2>
        {semPreco ? <p className="consumo-nota">Nenhum preço cadastrado: todo modelo aparece como “sem preço” e o custo fica “desconhecido”. Cadastre abaixo.</p> : null}
        {(precos.dados ?? []).map((p) => (
          <div key={p.id} className="fp-linha">
            <span title={p.fonte ?? undefined}>{p.padrao}</span><span>{preco(p.entrada_por_mtok)} in</span><span>{preco(p.saida_por_mtok)} out</span><span>{preco(p.cache_escrita_por_mtok)} c.esc</span><span>{preco(p.cache_leitura_por_mtok)} c.leit</span>
            <span>{p.origem} · {p.confirmado ? "confirmado" : "≈ aproximado"}</span>
            {p.origem === "usuario" ? <button type="button" className="botao-mini" aria-label={`Apagar preço ${p.padrao}`} onClick={() => void executar(async () => { await api.precoApagar?.(p.id); precos.recarregar(); return "Preço apagado."; })}>Apagar</button> : <span />}
          </div>
        ))}
        <FormPreco aoGravar={async (p) => { try { await api.precoGravar?.(p); setAviso("Preço gravado (origem: você). O custo já registrado não muda sem reprecificar."); precos.recarregar(); } catch { setAviso("Não foi possível gravar o preço."); } }} />
        <div className="fp-acoes">
          <button type="button" className="botao-mini" disabled={ocupado} onClick={() => void executar(async () => { const r = await api.reprecificar?.({ simular: true }); setReprec({ n: r?.registros_reprecificados ?? 0 }); return ""; })}>Reprecificar…</button>
          <span className="consumo-nota">Recalcula o custo já registrado com a tabela de agora. Nunca roda sozinho.</span>
        </div>
      </section>
      <section aria-label="Configuração de custo">
        <h2>Configuração</h2>
        {f === null ? <p className="consumo-nota" aria-busy="true">Lendo…</p> : (
          <div className="fp-form" role="group" aria-label="Configuração de custo">
            <label htmlFor={`${idc}-cambio`}>Câmbio manual (R$ por US$)<input id={`${idc}-cambio`} value={f.cambio} placeholder="só para exibição ≈ R$" onChange={(e) => setForm({ ...f, cambio: e.target.value })} /></label>
            <label htmlFor={`${idc}-teto`}>Teto padrão por Missão (US$)<input id={`${idc}-teto`} value={f.teto} placeholder="sem teto" onChange={(e) => setForm({ ...f, teto: e.target.value })} /></label>
            <label htmlFor={`${idc}-av`}>Avisar a (% do teto)<input id={`${idc}-av`} value={f.aviso} onChange={(e) => setForm({ ...f, aviso: e.target.value })} /></label>
            <label htmlFor={`${idc}-ret`}>Retenção dos brutos (dias)<input id={`${idc}-ret`} value={f.ret} onChange={(e) => setForm({ ...f, ret: e.target.value })} /></label>
            <label className="bd-check"><input type="checkbox" checked={f.ler} onChange={(e) => setForm({ ...f, ler: e.target.checked })} />Ler os transcripts locais das CLIs só para contar tokens</label>
            <label className="bd-check"><input type="checkbox" checked={f.alertar} onChange={(e) => setForm({ ...f, alertar: e.target.checked })} />Avisar de modelo sem preço</label>
            <button type="button" className="botao-mini" onClick={() => void gravarConfig()}>Gravar configuração</button>
          </div>
        )}
        <BloqueioTeto workspaceId={workspaceId} api={apiBoard} />
        <p className="consumo-nota">Por padrão o teto só avisa, uma vez; nada interrompe a Missão. O conteúdo das conversas nunca é lido nem guardado: só contagens de tokens, modelo e horário.</p>
      </section>
      <div className="fp-acoes">
        <button type="button" className="botao-mini" disabled={ocupado} onClick={() => void executar(async () => { const r = await api.reindexar?.(workspaceId ?? undefined); return `Reindexação concluída: ${r?.registros ?? 0} registros.`; })}>{ocupado ? "Trabalhando…" : "Reindexar"}</button>
        <button type="button" className="botao-mini" onClick={() => void executar(async () => { const r = await api.diagnostico?.(); await navigator.clipboard.writeText(r?.texto ?? ""); return "Diagnóstico copiado (sem conteúdo de conversa)."; })}>Copiar diagnóstico</button>
      </div>
      {reprec !== null ? (
        <DialogoConfirmacao
          titulo="Reprecificar o custo registrado?"
          texto={<><p>{reprec.n === 0 ? "Nenhum registro muda com a tabela atual." : `${reprec.n} ${reprec.n === 1 ? "registro mudaria" : "registros mudariam"} de custo.`}</p><p>O custo já gravado é recalculado com os preços vigentes agora. Isso não pode ser desfeito sem reprecificar de novo.</p></>}
          rotuloConfirmar="Reprecificar" perigoso ocupado={ocupado}
          aoCancelar={() => setReprec(null)}
          aoConfirmar={() => void executar(async () => { const r = await api.reprecificar?.({}); setReprec(null); return `${r?.registros_reprecificados ?? 0} registros reprecificados.`; })}
        />
      ) : null}
    </div>
  );
}

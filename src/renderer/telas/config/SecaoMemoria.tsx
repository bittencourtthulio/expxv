import { memo, useEffect, useState } from "react";
import type { ConfigMemoria, EstadoMemoriaApp } from "../../../compartilhado/memoria";
import { DialogoConfirmacao } from "../../componentes/Dialogo";
import { storeMemoria, useMemoria, type StoreMemoria } from "../../estado/memoria";
import { storeWorkspaces, useWorkspaces } from "../../estado/workspaces";
import { MODELO_EMBEDDING_LOCAL, ORCAMENTO_MAX, ORCAMENTO_MIN, confirmacaoConfere, textoRetencao, textoTeto, validarOrcamento, validarRetencao, validarTeto, type Validacao } from "../memoria/logica";
import "../memoria/memoria.css";

type CampoNumerico = "orcamento_brief_chars" | "retencao_dias" | "teto_mb";
const VALIDAR: Record<CampoNumerico, (t: string) => Validacao<number>> = { orcamento_brief_chars: validarOrcamento, retencao_dias: validarRetencao, teto_mb: validarTeto };

/** Interruptor acessível (`role="switch"`) com rótulo e ajuda. */
function Chave({ rotulo, ajuda, ligada, desabilitada = false, aoMudar }: { rotulo: string; ajuda?: string; ligada: boolean; desabilitada?: boolean; aoMudar: (v: boolean) => void }) {
  return (
    <div className="mem-linha-controles">
      <button type="button" role="switch" aria-checked={ligada} disabled={desabilitada} className="botao" onClick={() => aoMudar(!ligada)}>{rotulo}: {ligada ? "ligada" : "desligada"}</button>
      {ajuda !== undefined ? <span className="mem-nota">{ajuda}</span> : null}
    </div>
  );
}

function CampoNumero({ id, rotulo, ajuda, config, campo, store }: { id: string; rotulo: string; ajuda: string; config: ConfigMemoria; campo: CampoNumerico; store: StoreMemoria }) {
  const atual = String(config[campo]);
  const [texto, setTexto] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const valor = texto ?? atual;
  const aplicar = async (): Promise<void> => {
    if (texto === null) return;
    const v = VALIDAR[campo](texto);
    if (!v.ok) { setErro(v.erro); return; }
    setErro(null);
    const r = await store.gravarConfig({ [campo]: v.valor });
    if (r !== null) setTexto(null);
  };
  return (
    <div className="mem-linha-controles">
      <label htmlFor={id}>{rotulo}</label>
      <input id={id} type="number" inputMode="numeric" value={valor} aria-invalid={erro !== null} aria-describedby={`${id}-ajuda`} onChange={(e) => { setTexto(e.target.value); setErro(null); }} onBlur={() => void aplicar()} onKeyDown={(e) => { if (e.key === "Enter") void aplicar(); }} />
      <span id={`${id}-ajuda`} className="mem-nota">{ajuda}</span>
      {erro !== null ? <span role="alert" className="mem-erro">{erro}</span> : null}
    </div>
  );
}

export interface PropsAjustes { store?: StoreMemoria; estado: EstadoMemoriaApp; nomeDoProjeto: string }

/** Ajustes da memória do projeto atual (e a chave geral). Usado nas Configurações e disponível à tela Memória. */
export function AjustesMemoria({ store = storeMemoria, estado, nomeDoProjeto }: PropsAjustes) {
  const c = estado.config;
  const [apagar, setApagar] = useState(false);
  const [digitado, setDigitado] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const total = Object.values(estado.contagens).reduce((a, b) => a + b, 0);

  const confirmarApagar = async (): Promise<void> => {
    setOcupado(true);
    const r = await store.purgar("tudo", digitado);
    setOcupado(false);
    if (r === null) { setErro("Não foi possível apagar: confira o nome digitado."); return; }
    setApagar(false); setDigitado(""); setErro(null);
  };

  return (
    <>
      <Chave rotulo="Memória neste computador" ajuda="Chave geral. Desligada, nada é coletado e nada é apagado." ligada={c.global_ativa} aoMudar={(v) => void store.gravarConfig({ global_ativa: v })} />
      <Chave rotulo="Memória em Missões agênticas" ligada={c.ativa} desabilitada={!c.global_ativa} aoMudar={(v) => void store.gravarConfig({ ativa: v })} />
      <Chave rotulo="Memória em painéis livres" ajuda="Painéis fora de Missão (CLI com MCP)." ligada={c.solo} desabilitada={!c.global_ativa} aoMudar={(v) => void store.gravarConfig({ solo: v })} />
      <Chave rotulo="Memória das squads" ajuda="Cada squad tem o seu próprio anel, isolado das demais." ligada={c.squad} desabilitada={!c.global_ativa} aoMudar={(v) => void store.gravarConfig({ squad: v })} />
      <Chave rotulo="Entregar pacote aos workers" ligada={c.pacote_workers} aoMudar={(v) => void store.gravarConfig({ pacote_workers: v })} />
      <CampoNumero id="mem-orcamento" rotulo="Orçamento do brief (caracteres)" ajuda={`Avançado. De ${ORCAMENTO_MIN} a ${ORCAMENTO_MAX}.`} config={c} campo="orcamento_brief_chars" store={store} />
      <CampoNumero id="mem-retencao" rotulo="Retenção (dias)" ajuda={`Agora: ${textoRetencao(c.retencao_dias)}. 0 = sem limite; de 7 a 365 é o recomendado. Vale para Pane e Missão; entradas fixadas, aprendizados do projeto e preferências ficam até você apagar.`} config={c} campo="retencao_dias" store={store} />
      <CampoNumero id="mem-teto" rotulo="Teto de tamanho (MB)" ajuda={`Em uso: ${textoTeto(estado.tamanho_bytes, c.teto_mb)}. O app avisa a partir de 80%.`} config={c} campo="teto_mb" store={store} />
      <div className="mem-linha-controles">
        <label htmlFor="mem-embedding">Busca semântica local</label>
        <select id="mem-embedding" value={c.embedding_modelo ?? ""} title={c.embedding_modelo === null ? "Desligada (só por palavras)" : `Local, sem rede (${MODELO_EMBEDDING_LOCAL})`} onChange={(e) => void store.gravarConfig({ embedding_modelo: e.target.value === "" ? null : e.target.value })}>
          <option value="">Desligada (só por palavras)</option>
          <option value={MODELO_EMBEDDING_LOCAL}>Local, sem rede ({MODELO_EMBEDDING_LOCAL})</option>
        </select>
      </div>
      <p className="mem-nota">{total} {total === 1 ? "entrada" : "entradas"} em {textoTeto(estado.tamanho_bytes, c.teto_mb)}.</p>
      <div className="mem-acoes">
        <button type="button" className="mem-perigo" onClick={() => { setApagar(true); setErro(null); setDigitado(""); }}>Apagar memória deste projeto</button>
      </div>
      {apagar ? (
        <DialogoConfirmacao titulo="Apagar a memória deste projeto?" rotuloConfirmar="Apagar tudo" perigoso ocupado={ocupado || !confirmacaoConfere(digitado, nomeDoProjeto)} aoCancelar={() => setApagar(false)} aoConfirmar={() => void confirmarApagar()}
          texto={(
            <>
              <p>Apaga as {total} entradas de memória de <strong>{nomeDoProjeto}</strong> (Pane, Missão, squad e projeto). As preferências do usuário não são afetadas. Não dá para desfazer.</p>
              <label htmlFor="mem-digitar">Digite o nome do projeto para confirmar</label>
              <input id="mem-digitar" className="mem-campo" value={digitado} autoComplete="off" onChange={(e) => setDigitado(e.target.value)} />
              {erro !== null ? <p role="alert" className="mem-erro">{erro}</p> : null}
            </>
          )} />
      ) : null}
    </>
  );
}

export const SecaoMemoria = memo(function SecaoMemoria({ store = storeMemoria }: { store?: StoreMemoria }) {
  const { atual } = useWorkspaces(storeWorkspaces);
  const m = useMemoria(store);
  const wsId = atual?.id ?? null;
  useEffect(() => { store.iniciar(); void store.definirWorkspace(wsId); }, [store, wsId]);
  return (
    <section className="cfg-secao" aria-label="Memória">
      <h2>Memória</h2>
      <p className="cfg-ajuda">Fica só neste computador. Segredos são mascarados antes de gravar.</p>
      {atual === null ? <p className="cfg-ajuda">Abra um projeto para ajustar a memória dele.</p>
        : !m.disponivel ? <p className="cfg-ajuda">A memória não está disponível fora do aplicativo.</p>
        : m.estado === null ? (m.erroEstado !== null ? <p role="alert" className="cfg-erro">{m.erroEstado}</p> : <p className="cfg-ajuda" role="status" aria-busy="true">Carregando…</p>)
        : <AjustesMemoria store={store} estado={m.estado} nomeDoProjeto={atual.nome} />}
    </section>
  );
});

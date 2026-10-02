import { useCallback, useEffect, useState } from "react";
import type { ApiVcs } from "../../../compartilhado/vcs";
import type { PrResumo } from "../../../nucleo/forge/forge";
import { sinaleiraDoPr } from "../../../nucleo/vcs/pr-sinaleira";
import { ade } from "../../ade";
import { Badge } from "../../componentes/Badge";
import { storeWorkspaces, useWorkspaces } from "../../estado/workspaces";
import { lerPreferencia, PREF_PR_INICIO, type ApiConfig } from "./preferencias-vcs";

export interface PropsCartaoPrs {
  api?: ApiVcs | undefined;
  config?: ApiConfig | undefined;
  /** Testes: fixa o workspace; por padrão, o workspace atual. */
  workspaceId?: string | null;
}

/**
 * Início · PRs abertos e checks (T-06.35). OPT-IN e sem rede automática (D-243): desligado por padrão; ligado, ainda assim só vai ao provedor
 * (pelo login da `gh`/`glab`/cofre) no clique em "Atualizar PRs". Checks vermelhos deixam o PR amarelo, com o motivo em texto.
 */
export function CartaoPrsInicio(props: PropsCartaoPrs) {
  const { atual } = useWorkspaces(storeWorkspaces);
  const api = "api" in props ? props.api : ade()?.vcs;
  const config = "config" in props ? props.config : ade()?.config;
  const ws = props.workspaceId !== undefined ? props.workspaceId : atual?.id ?? null;
  const [ligado, setLigado] = useState(false);
  const [lista, setLista] = useState<PrResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vivo = true;
    void lerPreferencia(config, PREF_PR_INICIO).then((v) => { if (vivo) setLigado(v); });
    return () => { vivo = false; };
  }, [config]);

  const atualizar = useCallback(async () => {
    if (api === undefined || ws === null) return;
    setOcupado(true);
    setErro(null);
    try {
      const r = await api.forge({ workspace_id: ws, mission_id: null }, "prs_listar", { estado: "aberto", limite: 30 });
      setLista(r.itens);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }, [api, ws]);

  if (api === undefined || config === undefined || ws === null) return null;
  const alternar = async (v: boolean): Promise<void> => {
    try { await config.gravar(PREF_PR_INICIO, v); setLigado(v); if (!v) setLista(null); } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  };
  const falhando = lista === null ? 0 : lista.filter((p) => (p.checks?.falha ?? 0) > 0).length;
  return (
    <section className="ini-cartao" aria-label="Pull requests">
      <h2>PRs e checks{falhando > 0 ? <Badge tom="alerta">{falhando} com checks falhando</Badge> : null}</h2>
      <label className="ini-nada">
        <input type="checkbox" checked={ligado} onChange={(e) => void alternar(e.target.checked)} />
        {" "}Mostrar PRs aqui
      </label>
      {!ligado ? <p className="ini-nada">O ADE só consulta o provedor quando você pedir. Ligue para ver os PRs abertos deste projeto e os checks que falharam.</p> : (
        <>
          <p><button type="button" className="botao" disabled={ocupado} onClick={() => void atualizar()}>Atualizar PRs</button></p>
          {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}
          {lista === null ? <p className="ini-nada">Clique em Atualizar PRs para consultar.</p> : lista.length === 0 ? <p className="ini-nada">Nenhum PR aberto.</p> : (
            <ul className="ini-lista">
              {lista.map((p) => {
                const s = sinaleiraDoPr({ numero: p.numero, estado: p.estado, checks_falhando: p.checks?.falha ?? 0, checks_pendentes: p.checks?.pendente ?? 0 }, null);
                return (
                  <li key={p.numero} data-sinaleira={s.cor}>
                    <button type="button" className="ini-item" onClick={() => void ade()?.terminais.abrirLink(p.url)} title="Abrir o PR no navegador">
                      <span><code>#{p.numero}</code> <span>{p.titulo}</span></span>
                      <span className="ini-detalhe">{p.ramoOrigem} → {p.ramoDestino}{s.motivo !== null ? <> · <Badge tom="alerta">{s.motivo}</Badge></> : p.checks !== null && s.cor === "verde" ? <> · <Badge tom="sucesso">checks ok</Badge></> : p.checks !== null && s.cor === "neutra" ? <> · <Badge tom="aviso">checks pendentes</Badge></> : null}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

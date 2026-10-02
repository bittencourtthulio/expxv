import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiRelatorios, ConfigRelatorios, PacoteDetalhe, PacoteResumo, SprintCandidata } from "../../../compartilhado/relatorios";
import { ade } from "../../ade";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { Icone } from "../../componentes/Icone";
import { ItemLista } from "../../componentes/ItemLista";
import { SubNavegacao } from "../../componentes/SubNavegacao";
import { aoPedirRelatorios } from "../../estado/relatorios-acoes";
import { avisar } from "../../estado/avisos";
import { storeWorkspaces, useWorkspaces } from "../../estado/workspaces";
import { Config } from "./Config";
import { Detalhe } from "./Detalhe";
import { Divulgacao } from "./Divulgacao";
import { Carregando, FaixaErro } from "./comum";
import { ABAS_RELATORIOS, ROTULO_ETAPA, linhaDoPacote, textoDoErro, type AbaRelatorios } from "./logica";
import { Revisao } from "./Revisao";
import "./relatorios.css";

export interface PropsTelaRelatorios { api?: ApiRelatorios; workspaceId?: string | null }

/**
 * Tela Relatórios (Fase 19, D-32): UMA linha de controles (abas, sprint, gerar), lista de pacotes por sprint e o painel da aba. Lazy: nada roda no boot. Estados: vazio explica o próximo
 * passo, carregando, erro com "tentar de novo" e `gerando` com a etapa. O renderer nunca vê caminho: tudo é id de pacote e nome de arquivo.
 */
export function TelaRelatorios({ api: apiProp, workspaceId }: PropsTelaRelatorios) {
  const { atual } = useWorkspaces(storeWorkspaces);
  const api = apiProp ?? ade()?.relatorios;
  const ws = workspaceId === undefined ? (atual?.id ?? null) : workspaceId;
  const [aba, setAba] = useState<AbaRelatorios>("pacotes");
  const [config, setConfig] = useState<ConfigRelatorios | null>(null);
  const [sprints, setSprints] = useState<SprintCandidata[]>([]);
  const [pacotes, setPacotes] = useState<PacoteResumo[]>([]);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<PacoteDetalhe | null>(null);
  const [sprintEscolhida, setSprintEscolhida] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<unknown>(null);
  const [versao, setVersao] = useState(0);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recarregar = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVersao((v) => v + 1), 60);
  }, []);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);

  useEffect(() => aoPedirRelatorios((p) => {
    if (p === "pacotes" || p === "revisao" || p === "divulgacao" || p === "config") setAba(p);
    if (p === "gerar") { setAba("pacotes"); document.getElementById("rl-gerar")?.focus(); }
  }), []);

  useEffect(() => {
    if (api === undefined || ws === null) return;
    return api.assinar((e) => {
      if (e.workspace_id !== ws) return;
      if (e.tipo === "falhou") avisar(`Não foi possível gerar o pacote: ${e.motivo}`, "erro");
      recarregar();
    });
  }, [api, ws, recarregar]);

  useEffect(() => {
    if (api === undefined || ws === null) return;
    const minha = ++seq.current;
    setCarregando(true);
    void Promise.all([api.configLer(ws), api.sprints(ws), api.listar(ws)]).then(
      ([c, s, p]) => { if (seq.current !== minha) return; setConfig(c); setSprints(s); setPacotes(p); setErro(null); setCarregando(false); setSelecionado((atualSel) => (atualSel !== null && p.some((x) => x.id === atualSel) ? atualSel : (p[0]?.id ?? null))); },
      (e: unknown) => { if (seq.current !== minha) return; setErro(e); setCarregando(false); },
    );
  }, [api, ws, versao]);

  useEffect(() => {
    if (api === undefined || ws === null || selecionado === null) { setDetalhe(null); return; }
    let vivo = true;
    void api.ler(ws, selecionado).then((d) => { if (vivo) setDetalhe(d); }, (e: unknown) => { if (vivo) { setDetalhe(null); setErro(e); } });
    return () => { vivo = false; };
  }, [api, ws, selecionado, versao, pacotes]);

  const candidatas = useMemo(() => sprints.filter((s) => s.pacote_atual === null || s.pacote_atual.estado !== "gerando"), [sprints]);
  const gerar = (): void => {
    if (api === undefined || ws === null) return;
    const alvo = sprintEscolhida !== "" ? sprintEscolhida : candidatas[0]?.id;
    if (alvo === undefined) { avisar("Feche uma sprint na Gestão ágil para gerar o pacote.", "info"); return; }
    setGerando(true);
    void api.gerar(ws, { tipo: "sprint", sprint_id: alvo }).then((r) => {
      avisar(r.reaproveitado ? "Nada mudou desde o último pacote desta sprint." : "Pacote gerado.", r.reaproveitado ? "info" : "sucesso");
      setSelecionado(r.pacote_id);
      recarregar();
    }, (e) => avisar(textoDoErro(e), "erro")).finally(() => setGerando(false));
  };

  const corpo = (() => {
    if (api === undefined) return <EstadoVazio icone="relatorios" titulo="Relatórios indisponíveis" texto="Este recurso só funciona dentro do aplicativo desktop." />;
    if (ws === null) return <EstadoVazio icone="workspaces" titulo="Nenhum projeto aberto" texto="Os relatórios são por projeto. Abra uma pasta em Workspaces para gerar o pacote de entrega de uma sprint." />;
    if (erro !== null && config === null) return <FaixaErro erro={erro} aoTentar={recarregar} />;
    if (config === null) return <Carregando />;
    if (aba === "config") return <Config api={api} ws={ws} config={config} aoMudar={(c) => { setConfig(c); }} />;
    const lista = (
      <div className="rl-lista" role="list" aria-label="Pacotes de entrega">
        {pacotes.map((p) => (
          <ItemLista
            key={p.id}
            id={p.id}
            titulo={p.titulo}
            descricao={p.estado === "gerando" ? `${ROTULO_ETAPA[p.etapa ?? ""] ?? "Gerando"}…` : linhaDoPacote(p).split(" · ").slice(1).join(" · ")}
            selecionado={p.id === selecionado}
            aoAbrir={() => setSelecionado(p.id)}
          />
        ))}
      </div>
    );
    if (pacotes.length === 0) {
      return (
        <EstadoVazio icone="relatorios" titulo="Nenhum pacote ainda" texto={sprints.length === 0 ? "Feche uma sprint na Gestão ágil: o pacote de entrega (relatório técnico, do usuário, notas de versão e CSV) é gerado na hora." : "Escolha uma sprint fechada acima e clique em Gerar."} />
      );
    }
    return (
      <div className="rl-duas">
        {lista}
        <div className="rl-painel">
          {detalhe === null ? <Carregando /> : aba === "pacotes" ? <Detalhe api={api} ws={ws} pacote={detalhe} recarregar={recarregar} aoSelecionar={setSelecionado} />
            : aba === "revisao" ? <Revisao api={api} ws={ws} pacote={detalhe} recarregar={recarregar} aoSelecionar={setSelecionado} />
            : <Divulgacao api={api} ws={ws} pacote={detalhe} recarregar={recarregar} />}
        </div>
      </div>
    );
  })();

  return (
    <div className="relatorios" data-modo="leitura" data-largura="larga" data-tela-relatorios>
     <SubNavegacao itens={ABAS_RELATORIOS} ativo={aba} onMudar={setAba} rotulo="Seções dos relatórios" base="relatorios" recolhivel classePainel="rl-corpo" barra={<>
      <div className="rl-barra" role="toolbar" aria-label="Controles dos relatórios">
        <select aria-label="Sprint" value={sprintEscolhida} onChange={(e) => setSprintEscolhida(e.target.value)} disabled={api === undefined || ws === null}>
          <option value="">{candidatas.length === 0 ? "Sem sprint fechada" : "Sprint: a mais recente"}</option>
          {candidatas.map((s) => <option key={s.id} value={s.id}>{s.nome}{s.pacote_atual ? ` (r${s.pacote_atual.versao})` : ""}</option>)}
        </select>
        <span className="rl-espaco" />
        {carregando && <span className="rl-meta" role="status">carregando…</span>}
        <button id="rl-gerar" type="button" className="rl-btn" data-primario onClick={gerar} disabled={api === undefined || ws === null || gerando || candidatas.length === 0}>
          <Icone nome="relatorios" /> {gerando ? "Gerando…" : "Gerar"}
        </button>
      </div>
      {erro !== null && config !== null && <FaixaErro erro={erro} aoTentar={recarregar} />}
     </>}>{corpo}</SubNavegacao>
    </div>
  );
}

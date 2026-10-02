// Matriz "Habilitado em": workspace atual, Missão ou agente (deny-by-default: sem linha = desabilitado), com o selo honesto de
// isolamento por CLI (Claude duro, Codex/OpenCode parcial, Gemini sem injeção por Pane).
import { useCallback, useEffect, useState } from "react";
import type { ApiAde } from "../../../compartilhado/ipc";
import type { AlvoHabilitacaoTipo, CliLojaMcp, HabilitacaoMcp, NivelIsolamentoMcp } from "../../../compartilhado/loja-mcp";
import { CLIS, mensagemDoCodigo, mensagemDoErro, ROTULO_CLI, ROTULO_ISOLAMENTO, TOM_ISOLAMENTO } from "./logica";

type Api = ApiAde["lojaMcp"];

/** Padrão do núcleo enquanto não há linha (T-07B.22): serve só para o selo; o valor real vem de `habilitacoes`. */
export const ISOLAMENTO_PADRAO: Record<CliLojaMcp, NivelIsolamentoMcp> = { claude: "duro", codex: "parcial", opencode: "parcial", gemini: "nenhum" };
const PADRAO_AGENTE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export interface PropsHabilitacao {
  api: Api;
  servidorId: string;
  workspaceId: string | null;
  missoes: ReadonlyArray<{ id: string; titulo: string }>;
  podeHabilitar: boolean;
  aoMudar: () => void;
  aoConfigurar: () => void;
}

export function MatrizHabilitacao({ api, servidorId, workspaceId, missoes, podeHabilitar, aoMudar, aoConfigurar }: PropsHabilitacao) {
  const [linhas, setLinhas] = useState<HabilitacaoMcp[] | null>(null);
  const [tipo, setTipo] = useState<AlvoHabilitacaoTipo>("workspace");
  const [valor, setValor] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [precisaConfigurar, setPrecisaConfigurar] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const recarregar = useCallback(() => {
    if (workspaceId === null) { setLinhas([]); return; }
    api.habilitacoes(workspaceId).then((h) => setLinhas(h.filter((x) => x.servidor_id === servidorId)), (e: unknown) => { setLinhas([]); setErro(mensagemDoErro(e)); });
  }, [api, servidorId, workspaceId]);
  useEffect(() => { recarregar(); }, [recarregar]);

  const alvo = tipo === "workspace" ? workspaceId : valor.trim();
  const alvoValido = alvo !== null && alvo !== "" && (tipo !== "agente" || PADRAO_AGENTE.test(alvo));

  const aplicar = async (t: AlvoHabilitacaoTipo, v: string, habilitado: boolean) => {
    setOcupado(true); setErro(null); setPrecisaConfigurar(false);
    try {
      const r = await api.habilitar(servidorId, t, v, habilitado);
      if (!r.ok) { setErro(mensagemDoCodigo(r.codigo)); setPrecisaConfigurar(r.codigo === "nao_configurado"); }
      recarregar(); aoMudar();
    } catch (e) { setErro(mensagemDoErro(e)); }
    finally { setOcupado(false); }
  };
  const isolamento = linhas?.[0]?.isolamento ?? ISOLAMENTO_PADRAO;
  return (
    <section className="lm-secao" aria-label="Habilitado em">
      <h3>Habilitado em</h3>
      <p className="lm-nota">Instalar não habilita. Sem linha, o servidor fica fora de todos os terminais (deny-by-default).</p>
      <ul className="lm-habilitacoes" aria-label="Habilitações">
        {linhas === null ? <li aria-busy="true">Carregando…</li> : linhas.length === 0 ? <li>Nenhuma habilitação neste workspace.</li> : linhas.map((h) => (
          <li key={h.id}>
            <span className="lm-hab-alvo" title={`${h.alvo_tipo === "workspace" ? "Workspace" : h.alvo_tipo === "missao" ? "Missão" : "Agente"}: ${h.alvo_valor}`}>{h.alvo_tipo === "workspace" ? "Workspace" : h.alvo_tipo === "missao" ? "Missão" : "Agente"}: <code>{h.alvo_valor}</code></span>
            <span className="lst-selo" data-tom={h.habilitado ? "sucesso" : "neutro"}>{h.habilitado ? "habilitado" : "desabilitado"}</span>
            <button type="button" className="botao lm-mini" disabled={ocupado || !podeHabilitar} onClick={() => void aplicar(h.alvo_tipo, h.alvo_valor, !h.habilitado)}>{h.habilitado ? "Desabilitar" : "Habilitar"}</button>
          </li>
        ))}
      </ul>
      <div className="lm-hab-form" role="group" aria-label="Nova habilitação">
        <label className="lm-rot">Escopo
          <select value={tipo} onChange={(e) => { setTipo(e.target.value as AlvoHabilitacaoTipo); setValor(""); }}>
            <option value="workspace">Este workspace</option>
            <option value="missao">Uma Missão</option>
            <option value="agente">Um agente</option>
          </select>
        </label>
        {tipo === "missao" ? (
          <label className="lm-rot">Missão
            <select value={valor} title={missoes.find((m) => m.id === valor)?.titulo ?? "Escolha…"} onChange={(e) => setValor(e.target.value)}>
              <option value="">Escolha…</option>
              {missoes.map((m) => <option key={m.id} value={m.id}>{m.titulo}</option>)}
            </select>
          </label>
        ) : null}
        {tipo === "agente" ? (
          <label className="lm-rot">Agente
            <input value={valor} placeholder="squad.membro" aria-invalid={valor !== "" && !alvoValido} onChange={(e) => setValor(e.target.value)} />
          </label>
        ) : null}
        <button type="button" className="botao botao-primario lm-mini" disabled={ocupado || !podeHabilitar || !alvoValido} onClick={() => void aplicar(tipo, alvo as string, true)}>Habilitar</button>
      </div>
      {workspaceId === null && tipo === "workspace" ? <p className="lm-nota">Abra um projeto para habilitar neste workspace.</p> : null}
      {erro !== null ? <p role="alert" className="campo-erro">{erro}{precisaConfigurar ? <> <button type="button" className="botao lm-mini" onClick={aoConfigurar}>Configurar</button></> : null}</p> : null}
      <ul className="lm-isolamento" aria-label="Isolamento por CLI">
        {CLIS.map((c) => <li key={c}><span className="lst-selo" data-tom={TOM_ISOLAMENTO[isolamento[c]]}>{ROTULO_CLI[c]}: {ROTULO_ISOLAMENTO[isolamento[c]]}</span></li>)}
      </ul>
    </section>
  );
}

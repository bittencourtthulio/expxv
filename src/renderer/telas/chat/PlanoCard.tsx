import { useEffect, useId, useRef, useState } from "react";
import type { CliChat, EventoChatProgresso, PassoPlanoChat, PedidoDecidirPlano, PlanoChatDto } from "../../../compartilhado/chat";
import { Badge } from "../../componentes/Badge";
import { CLIS_CHAT, LIMITE_PROMPT_PLANO, avaliarAjuste, podeDecidir, rotuloEstadoPlano } from "./logica";

const ESFORCOS: ReadonlyArray<[string, string]> = [["", "padrão"], ["baixo", "baixo"], ["medio", "médio"], ["alto", "alto"], ["maximo", "máximo"]];
const TOM_PLANO = { proposto: "aviso", aprovado: "destaque", executando: "destaque", concluido: "sucesso", cancelado: "neutro", falhou: "alerta" } as const;

export function descreverPasso(p: PassoPlanoChat): string {
  switch (p.tipo) {
    case "criar_missao": return `Criar a Missão “${p.titulo}”`;
    case "abrir_pane": return `Abrir um terminal ${p.perfil.cli}${p.perfil.modelo !== null ? ` (${p.perfil.modelo})` : ""} para “${p.titulo}”`;
    case "disparar_metodo": return `Digitar ${p.comando} ${p.argumento}`.trim();
    case "enviar_prompt": return `Enviar o prompt ao terminal (${p.texto.length} caracteres)`;
  }
}

export interface PropsPlanoCard {
  plano: PlanoChatDto;
  progresso: readonly EventoChatProgresso[];
  aoDecidir: (p: PedidoDecidirPlano) => Promise<boolean>;
  aoParar: (planoId: string) => void;
  aoAbrirTela: (t: "terminais" | "missoes") => void;
  clisDisponiveis: readonly string[];
}

/** Plano proposto pelo orquestrador: DADO para exibir e aprovar (o LLM não executa nada). Texto sempre como texto. */
export function PlanoCard({ plano, progresso, aoDecidir, aoParar, aoAbrirTela, clisDisponiveis }: PropsPlanoCard) {
  const id = useId();
  const pode = podeDecidir(plano);
  const [editando, setEditando] = useState(false);
  const [cli, setCli] = useState<CliChat>(() => { const p = plano.passos.find((x) => x.tipo === "abrir_pane"); return p?.tipo === "abrir_pane" ? p.perfil.cli : "claude"; });
  const [modelo, setModelo] = useState("");
  const [esforco, setEsforco] = useState("");
  const [prompt, setPrompt] = useState(plano.prompt);
  const raiz = useRef<HTMLElement>(null);
  const decidido = useRef(false);
  const aval = avaliarAjuste({ prompt, cli });

  // depois de decidir, o foco vai para o cartão (o botão clicado some)
  useEffect(() => { if (decidido.current && plano.estado !== "proposto") { decidido.current = false; raiz.current?.focus(); } }, [plano.estado]);
  useEffect(() => { setPrompt(plano.prompt); }, [plano.prompt]);

  const decidir = async (decisao: "aprovar" | "cancelar"): Promise<void> => { decidido.current = true; await aoDecidir({ plano_id: plano.id, decisao }); };
  const aplicarEdicao = async (): Promise<void> => {
    if (!aval.ok) return;
    const ok = await aoDecidir({ plano_id: plano.id, decisao: "editar", ajuste: { cli, modelo: modelo.trim() === "" ? null : modelo.trim(), esforco: esforco === "" ? null : esforco, prompt } });
    if (ok) setEditando(false);
  };
  const executando = plano.estado === "executando" || plano.estado === "aprovado";

  return (
    <section ref={raiz} className="chat-plano" aria-labelledby={`${id}-t`} tabIndex={-1}>
      <div><strong id={`${id}-t`}>Plano: {plano.resumo}</strong> <Badge tom={TOM_PLANO[plano.estado]}>{rotuloEstadoPlano(plano.estado)}</Badge> <span className="meta">intenção: {plano.intencao}</span></div>
      {plano.avisos.map((a) => <p key={a} className="chat-faixa" role="note">{a}</p>)}
      <h3>Passos</h3>
      <ol>{plano.passos.map((p, i) => <li key={i}>{descreverPasso(p)}</li>)}</ol>
      <details>
        <summary>Prompt melhorado ({plano.prompt.length} caracteres)</summary>
        <pre tabIndex={0}>{plano.prompt}</pre>
      </details>
      {plano.criterios_aceite.length > 0 ? (<><h3>Critérios de aceite</h3><ul>{plano.criterios_aceite.map((c) => <li key={c}>{c}</li>)}</ul></>) : null}
      {plano.arquivos_provaveis.length > 0 ? (<><h3>Arquivos prováveis</h3><ul>{plano.arquivos_provaveis.map((a) => <li key={a}><code>{a}</code></li>)}</ul></>) : null}
      {plano.acoes_humanas.length > 0 ? (<><h3>Ficam com você (D-21)</h3><ul className="humanas">{plano.acoes_humanas.map((a) => <li key={a}>{a}</li>)}</ul></>) : null}

      {plano.estado === "proposto" && !plano.exige_aprovacao ? <p className="meta">Este plano roda direto (modo de execução do chat). Você ainda pode editar ou cancelar antes de começar.</p> : null}
      {editando ? (
        <div className="edicao" role="group" aria-label="Editar o plano">
          <label htmlFor={`${id}-cli`}>CLI</label>
          <select id={`${id}-cli`} value={cli} onChange={(e) => setCli(e.target.value as CliChat)}>{CLIS_CHAT.map((c) => <option key={c} value={c} disabled={clisDisponiveis.length > 0 && !clisDisponiveis.includes(c)}>{c}{clisDisponiveis.length > 0 && !clisDisponiveis.includes(c) ? " (indisponível)" : ""}</option>)}</select>
          <label htmlFor={`${id}-modelo`}>Modelo</label>
          <input id={`${id}-modelo`} type="text" autoComplete="off" placeholder="padrão da CLI" value={modelo} onChange={(e) => setModelo(e.target.value)} />
          <label htmlFor={`${id}-esforco`}>Esforço</label>
          <select id={`${id}-esforco`} value={esforco} onChange={(e) => setEsforco(e.target.value)}>{ESFORCOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
          <label htmlFor={`${id}-prompt`} style={{ gridColumn: "1 / -1" }}>Prompt ({prompt.length}/{LIMITE_PROMPT_PLANO})</label>
          <textarea id={`${id}-prompt`} value={prompt} aria-invalid={!aval.ok} onChange={(e) => setPrompt(e.target.value)} />
          {!aval.ok ? <p className="con-erro" role="alert" style={{ gridColumn: "1 / -1", margin: 0, color: "var(--alerta)" }}>{aval.motivo}</p> : null}
          <div className="acoes" style={{ gridColumn: "1 / -1" }}>
            <button type="button" className="chat-mini" data-tom="primario" disabled={!aval.ok} onClick={() => void aplicarEdicao()}>Aplicar edição</button>
            <button type="button" className="chat-mini" onClick={() => { setEditando(false); setPrompt(plano.prompt); }}>Descartar edição</button>
          </div>
        </div>
      ) : null}
      {plano.estado === "proposto" ? (
        <div className="acoes">
          {pode.aprovar ? <button type="button" data-sem-travessura className="chat-mini" data-tom="primario" onClick={() => void decidir("aprovar")}>Aprovar</button> : null}
          {pode.editar && !editando ? <button type="button" className="chat-mini" onClick={() => setEditando(true)}>Editar</button> : null}
          {pode.cancelar ? <button type="button" className="chat-mini" data-tom="perigo" onClick={() => void decidir("cancelar")}>Cancelar</button> : null}
        </div>
      ) : null}
      {progresso.length > 0 || executando ? (
        <>
          <h3>Progresso</h3>
          <ul className="chat-progresso" role="status" aria-live="polite" aria-label="Progresso do plano">
            {progresso.length === 0 ? <li>Aguardando o primeiro terminal…</li> : progresso.map((p, i) => <li key={`${p.pane_id ?? "plano"}-${i}`}>{p.pane_id !== null ? `Terminal ${p.pane_id}: ` : ""}{p.estado} — {p.resumo}</li>)}
          </ul>
        </>
      ) : null}
      {executando || plano.pane_ids.length > 0 || plano.mission_id !== null ? (
        <div className="acoes">
          {plano.pane_ids.length > 0 ? <button type="button" className="chat-mini" onClick={() => aoAbrirTela("terminais")}>Abrir terminais</button> : null}
          {plano.mission_id !== null ? <button type="button" className="chat-mini" onClick={() => aoAbrirTela("missoes")}>Ver Missão</button> : null}
          {executando ? <button type="button" className="chat-mini" data-tom="perigo" onClick={() => aoParar(plano.id)}>Parar plano</button> : null}
        </div>
      ) : null}
    </section>
  );
}

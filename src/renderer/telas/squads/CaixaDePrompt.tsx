// Caixa de prompt da squad (T-14.23): objetivo → squad → Missão. Colada ao rodapé da área; ⌘/Ctrl+Enter envia. O envio usa a versão
// SALVA da squad (o main lê os arquivos), por isso rascunho com edição não salva desabilita Enviar com o motivo.
import { useEffect, useState } from "react";
import type { ApiAde } from "../../../compartilhado/ipc";
import type { Achado, NivelRigidez, ResultadoEnviarPrompt, ResultadoPreflight, Squad, SubstituicaoCli } from "../../../compartilhado/squads";
import { LIMITES_SQUAD, NIVEIS_RIGIDEZ } from "../../../compartilhado/squads";
import { motivoDeNaoEnviar } from "./rascunho";

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface PropsCaixa {
  squad: Squad | null;
  achados: readonly Achado[];
  /** o rascunho difere do arquivo salvo. */
  sujo: boolean;
  editavel: boolean;
  workspaceId: string | null;
  api: ApiAde["squads"] | undefined;
  /** aplica as substituições de CLI ao rascunho (só squads editáveis). */
  aoAdaptar: (subs: readonly SubstituicaoCli[]) => void;
  aoEnviada: (r: ResultadoEnviarPrompt) => void;
}

export function CaixaDePrompt({ squad, achados, sujo, editavel, workspaceId, api, aoAdaptar, aoEnviada }: PropsCaixa) {
  const [objetivo, setObjetivo] = useState("");
  const [planoAntes, setPlanoAntes] = useState(true);
  const [rigidez, setRigidez] = useState<"" | `${NivelRigidez}`>("");
  const [pre, setPre] = useState<ResultadoPreflight | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);

  const slug = squad?.slug ?? null;
  const chaveClis = squad === null ? "" : squad.membros.map((m) => m.perfil.cli).join("|");
  // pré-voo (CLIs instaladas, substituições): ao trocar de squad/workspace e depois de salvar mudar as CLIs
  useEffect(() => {
    setPre(null);
    if (api === undefined || slug === null || workspaceId === null || sujo) return undefined;
    let vivo = true;
    api.preflight(slug, workspaceId).then((r) => { if (vivo) setPre(r); }).catch(() => undefined);
    return () => { vivo = false; };
  }, [api, slug, workspaceId, chaveClis, sujo]);
  useEffect(() => { setErro(null); setAvisos([]); }, [slug]);

  const n = [...objetivo].length;
  const motivo: string | null =
    squad === null ? null
    : workspaceId === null ? "Abra um workspace para enviar o objetivo à squad."
    : sujo ? "Salve a squad antes de enviar: o envio usa a versão salva."
    : motivoDeNaoEnviar(squad, achados) ?? (pre !== null && !pre.ok ? "Há CLIs indisponíveis: instale-as ou adapte a squad." : null);
  const excedeu = n > LIMITES_SQUAD.objetivo_max;
  const pode = squad !== null && motivo === null && objetivo.trim() !== "" && !excedeu && !ocupado;

  const enviar = async (): Promise<void> => {
    if (!pode || api === undefined || squad === null || workspaceId === null) return;
    setOcupado(true);
    setErro(null);
    try {
      const r = await api.enviarPrompt({ workspace_id: workspaceId, squad_slug: squad.slug, objetivo, plano_antes: planoAntes, rigidez: rigidez === "" ? null : (Number(rigidez) as NivelRigidez), max_paralelos: null });
      setAvisos(r.avisos);
      setObjetivo("");
      aoEnviada(r);
    } catch (e) { setErro(`Não foi possível enviar: ${msg(e)}`); }
    finally { setOcupado(false); }
  };

  if (squad === null) return null;
  return (
    <form className="sq-caixa" aria-label="Enviar objetivo à squad" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
      {pre !== null && (pre.avisos.length > 0 || pre.substituicoes.length > 0) ? (
        <div className="aviso-caixa sq-preflight" role="status">
          <strong>Pré-voo:</strong> {pre.avisos.join(" ")}
          {pre.substituicoes.length > 0 ? (
            <>
              {" "}Sugestão: {pre.substituicoes.map((x) => `${x.membro}: ${x.de} → ${x.para}`).join("; ")}.{" "}
              {editavel ? <button type="button" className="botao" onClick={() => aoAdaptar(pre.substituicoes)}>Adaptar CLIs</button> : <span>Duplique a squad para adaptar.</span>}
            </>
          ) : null}
        </div>
      ) : null}
      {avisos.length > 0 ? <p className="aviso-caixa" role="status">{avisos.join(" ")}</p> : null}
      {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}
      <div className="sq-caixa-linha">
        <textarea
          className="sq-caixa-texto"
          aria-label={`Objetivo para a squad ${squad.nome}`}
          rows={2}
          value={objetivo}
          placeholder="Descreva o objetivo e envie à squad (⌘/Ctrl+Enter)"
          onChange={(e) => setObjetivo(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void enviar(); } }}
        />
        <div className="sq-caixa-lado">
          <label className="sq-rot"><input type="checkbox" checked={planoAntes} onChange={(e) => setPlanoAntes(e.target.checked)} /> Plano antes</label>
          <select aria-label="Rigidez desta execução" value={rigidez} onChange={(e) => setRigidez(e.target.value as typeof rigidez)}>
            <option value="">rigidez: padrão</option>
            {NIVEIS_RIGIDEZ.map((r) => <option key={r} value={r}>rigidez {r}</option>)}
          </select>
          <span className="sq-contador" data-excedeu={excedeu || undefined}>{n}/{LIMITES_SQUAD.objetivo_max}</span>
          <button type="submit" className="botao botao-primario" disabled={!pode} title={motivo ?? undefined}>{ocupado ? "Enviando…" : "Enviar"}</button>
        </div>
      </div>
      {motivo !== null ? <p className="sq-motivo" role="status">{motivo}</p> : null}
    </form>
  );
}

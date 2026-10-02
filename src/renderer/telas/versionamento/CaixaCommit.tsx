import { useEffect, useState, type KeyboardEvent } from "react";
import { DialogoConfirmacao } from "../../componentes/Dialogo";
import { useVcs } from "./contexto";

export const LIMITE_ASSUNTO = 72;

/** Avisos (não bloqueiam) da mensagem: assunto longo e linha em branco depois do assunto. */
export function avisosDaMensagem(m: string): string[] {
  const linhas = m.split("\n");
  const av: string[] = [];
  if ((linhas[0] ?? "").length > LIMITE_ASSUNTO) av.push(`O assunto passa de ${LIMITE_ASSUNTO} caracteres (${(linhas[0] ?? "").length}).`);
  if (linhas.length > 1 && (linhas[1] ?? "") !== "") av.push("Deixe uma linha em branco depois do assunto.");
  return av;
}

/** Caixa de commit do git: ⌘/Ctrl+Enter comita; amend avisa se já foi publicado; pular hooks só com confirmação. */
export function CaixaCommit({ noStage, aoComitar }: { noStage: number; aoComitar: () => void }) {
  const { api, alvo, rodar, avisar, recarregar, estado } = useVcs();
  const [mensagem, setMensagem] = useState("");
  const [amend, setAmend] = useState(false);
  const [publicado, setPublicado] = useState<string[] | null>(null);
  const [pularHooks, setPularHooks] = useState(false);
  const [pedirHooks, setPedirHooks] = useState(false);
  const [coautores, setCoautores] = useState("");
  const [mais, setMais] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!amend) { setPublicado(null); return; }
    let vivo = true;
    void api.commit(alvo, "ultimo_publicado", {}).then((r) => { if (vivo) setPublicado(r.publicado ? r.remotas : []); }, () => undefined);
    return () => { vivo = false; };
  }, [amend, api, alvo]);

  const avisos = avisosDaMensagem(mensagem);
  const semMensagem = mensagem.trim() === "" && !amend;
  const nada = noStage === 0 && !amend;
  const bloqueado = ocupado || semMensagem || nada || (amend && publicado !== null && publicado.length > 0);

  const comitar = async (): Promise<void> => {
    if (bloqueado) return;
    setOcupado(true);
    const lista = coautores.split(/[\n;]/).map((x) => x.trim()).filter((x) => x !== "");
    const r = await rodar(() => api.commit(alvo, "criar", { mensagem: mensagem.trim() === "" ? null : mensagem, amend, pular_hooks: pularHooks, coautores: lista }));
    setOcupado(false);
    if (r !== undefined) {
      setMensagem(""); setAmend(false); setPularHooks(false);
      avisar(`Commit ${r.hashCurto}: ${r.assunto}${r.hooksPulados ? " (hooks pulados)" : ""}`);
      for (const a of r.avisos) avisar(a);
      aoComitar();
      await recarregar();
    }
  };
  const aoTeclar = (e: KeyboardEvent): void => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void comitar(); }
  };

  return (
    <div className="vc-commit">
      <textarea aria-label="Mensagem do commit" placeholder={estado.ramo_protegido ? `Mensagem (você está em ${estado.status.branch ?? "o branch padrão"}, o branch padrão)` : "Mensagem do commit (⌘Enter comita)"} value={mensagem} rows={3} onChange={(e) => setMensagem(e.target.value)} onKeyDown={aoTeclar} />
      {avisos.map((a) => <p key={a} className="vc-aviso" role="note">{a}</p>)}
      <div className="vc-commit-linha">
        <label><input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} /> Emendar o último</label>
        <label><input type="checkbox" checked={pularHooks} onChange={(e) => { if (e.target.checked) setPedirHooks(true); else setPularHooks(false); }} /> Pular hooks</label>
        <button type="button" className="vc-mini" aria-expanded={mais} onClick={() => setMais((m) => !m)}>Coautores</button>
        <button type="button" className="botao botao-primario vc-botao-commit" disabled={bloqueado} onClick={() => void comitar()}>{amend ? "Emendar" : `Comitar (${noStage})`}</button>
      </div>
      {amend && publicado !== null && publicado.length > 0 ? <p className="vc-aviso" role="alert">Este commit já foi publicado em {publicado.join(", ")}: emendar reescreveria a história publicada e o git recusará.</p> : null}
      {mais ? <input aria-label="Coautores" className="vc-campo" placeholder="Nome <email>; outro <email>" value={coautores} onChange={(e) => setCoautores(e.target.value)} /> : null}
      {pedirHooks ? (
        <DialogoConfirmacao titulo="Pular os hooks do git?" perigoso rotuloConfirmar="Pular hooks neste commit" texto="Hooks de pre-commit e commit-msg costumam rodar testes, lint e checagem de segredos. Pular vai ser registrado na auditoria." aoCancelar={() => setPedirHooks(false)} aoConfirmar={() => { setPularHooks(true); setPedirHooks(false); }} />
      ) : null}
    </div>
  );
}

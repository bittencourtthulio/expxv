import { useState } from "react";
import type { Squad } from "../../../compartilhado/squads";
import { PADRAO_SLUG } from "../../../compartilhado/squads";
import { Dialogo } from "../../componentes/Dialogo";
import type { StoreSquads } from "../../estado/squads";
import { slugDeNome, squadNova } from "./rascunho";

/** Nova squad: nasce com orquestrador, executor e revisor (o mínimo válido); o prompt de cada um é criado ao gravar. */
export function DialogoNovaSquad({ store, aoFechar, aoCriada }: { store: StoreSquads; aoFechar: () => void; aoCriada: (s: Squad) => void }) {
  const [nome, setNome] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEditado, setSlugEditado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const slugFinal = slugEditado ? slug : nome.trim() === "" ? "" : slugDeNome(nome);
  const slugOk = PADRAO_SLUG.test(slugFinal);

  const criar = async (): Promise<void> => {
    if (nome.trim() === "" || !slugOk) return;
    setOcupado(true);
    setErro(null);
    try {
      const r = await store.gravar({ squad: squadNova(slugFinal, nome.trim()), hash_esperado: null });
      if (r.ok) aoCriada(r.squad);
      else { setErro(r.achados.find((a) => a.severidade === "erro")?.mensagem ?? "Não foi possível criar a squad (o identificador já existe?)."); setOcupado(false); }
    } catch (e) { setErro(`Não foi possível criar a squad: ${e instanceof Error ? e.message : String(e)}`); setOcupado(false); }
  };

  return (
    <Dialogo titulo="Nova squad" aoFechar={aoFechar} largura={460}>
      <form onSubmit={(e) => { e.preventDefault(); void criar(); }} noValidate>
        <label className="campo">Nome
          <input data-foco-inicial value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} />
        </label>
        <label className="campo">Identificador
          <input value={slugFinal} spellCheck={false} maxLength={40} aria-invalid={slugFinal !== "" && !slugOk} onChange={(e) => { setSlug(e.target.value); setSlugEditado(true); }} />
          {slugFinal !== "" && !slugOk ? <span role="alert" className="campo-erro">Use minúsculas, números e hífen (até 40).</span> : null}
        </label>
        <p className="sq-vazio">A squad nasce com orquestrador, executor e revisor. Ajuste CLIs, modelos e prompts no editor.</p>
        {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}
        <div className="dialogo-acoes">
          <button type="button" className="botao" onClick={aoFechar}>Cancelar</button>
          <button type="submit" className="botao botao-primario" disabled={ocupado || nome.trim() === "" || !slugOk}>{ocupado ? "Criando…" : "Criar squad"}</button>
        </div>
      </form>
    </Dialogo>
  );
}

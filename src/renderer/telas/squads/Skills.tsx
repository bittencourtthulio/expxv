// Skills, MCPs e limites de UM membro (T-14.22). Deny-by-default: lista vazia = nenhuma skill. Nenhuma ação de um clique AMPLIA
// permissão: adicionar MCP pede confirmação por servidor. Sem a Fase 7 a aplicação é por instrução (aviso fixo).
import { useState } from "react";
import type { Membro } from "../../../compartilhado/squads";
import { LIMITES_SQUAD } from "../../../compartilhado/squads";
import { Dialogo, DialogoConfirmacao } from "../../componentes/Dialogo";

const NOME_VALIDO = /^[a-z0-9][a-z0-9:_.-]{0,63}$/;

export interface PropsSkills {
  membro: Membro;
  editavel: boolean;
  /** `max_instancias_paralelas` da squad: o limite do membro não passa dele. */
  maximoDaSquad: number;
  aoSalvar: (patch: Pick<Membro, "skills_permitidas" | "mcps_permitidos" | "max_instancias" | "orcamento">) => void;
  aoFechar: () => void;
}

function Chips({ itens, rotulo, editavel, aoRemover }: { itens: readonly string[]; rotulo: string; editavel: boolean; aoRemover: (i: string) => void }) {
  return (
    <ul className="sq-chips" aria-label={rotulo}>
      {itens.map((i) => (
        <li key={i} className="sq-chip">
          <code>{i}</code>
          <button type="button" className="sq-chip-x" aria-label={`Remover ${i}`} disabled={!editavel} onClick={() => aoRemover(i)}>×</button>
        </li>
      ))}
    </ul>
  );
}

export function SkillsDoMembro({ membro, editavel, maximoDaSquad, aoSalvar, aoFechar }: PropsSkills) {
  const [skills, setSkills] = useState<string[]>(membro.skills_permitidas);
  const [mcps, setMcps] = useState<string[]>(membro.mcps_permitidos);
  const [novaSkill, setNovaSkill] = useState("");
  const [novoMcp, setNovoMcp] = useState("");
  const [confirmarMcp, setConfirmarMcp] = useState<string | null>(null);
  const [instancias, setInstancias] = useState(membro.max_instancias);
  const [tempo, setTempo] = useState<string>(membro.orcamento.tempo_min === null ? "" : String(membro.orcamento.tempo_min));
  const [erro, setErro] = useState<string | null>(null);

  const validarNome = (n: string, lista: readonly string[]): string | null => {
    if (!NOME_VALIDO.test(n)) return "Nome inválido: use minúsculas, números e : _ . - (até 64).";
    if (lista.includes(n)) return "Já está na lista.";
    if (lista.length >= LIMITES_SQUAD.lista_permitidos_max) return `No máximo ${LIMITES_SQUAD.lista_permitidos_max} itens.`;
    return null;
  };
  const addSkill = (): void => {
    const n = novaSkill.trim();
    const e = validarNome(n, skills);
    setErro(e);
    if (e === null) { setSkills([...skills, n]); setNovaSkill(""); }
  };
  const pedirMcp = (): void => {
    const n = novoMcp.trim();
    const e = validarNome(n, mcps);
    setErro(e);
    if (e === null) setConfirmarMcp(n);
  };

  const salvar = (): void => {
    const t = tempo.trim() === "" ? null : Number(tempo);
    if (t !== null && (!Number.isInteger(t) || t < 1 || t > LIMITES_SQUAD.tempo_min_max)) { setErro(`Tempo: inteiro de 1 a ${LIMITES_SQUAD.tempo_min_max} minutos.`); return; }
    if (!Number.isInteger(instancias) || instancias < LIMITES_SQUAD.instancias_min || instancias > LIMITES_SQUAD.instancias_max) { setErro(`Instâncias: de ${LIMITES_SQUAD.instancias_min} a ${LIMITES_SQUAD.instancias_max}.`); return; }
    if (instancias > maximoDaSquad) { setErro(`Instâncias do membro (${instancias}) passam do limite paralelo da squad (${maximoDaSquad}).`); return; }
    aoSalvar({ skills_permitidas: skills, mcps_permitidos: mcps, max_instancias: instancias, orcamento: { ...membro.orcamento, tempo_min: t } });
  };

  return (
    <>
      <Dialogo titulo={`Skills, MCPs e limites: ${membro.rotulo || membro.slug}`} aoFechar={aoFechar} largura={560}>
        <p className="aviso-caixa" role="note">Aplicação depende da Fase 7: hoje a lista entra como instrução no prompt do membro (isolamento parcial), não como bloqueio.</p>
        <section className="sq-sec" aria-label="Skills permitidas">
          <h3>Skills permitidas</h3>
          {skills.length === 0 ? <p className="sq-vazio">Nenhuma skill permitida (deny-by-default).</p> : <Chips itens={skills} rotulo="Skills permitidas" editavel={editavel} aoRemover={(i) => setSkills(skills.filter((x) => x !== i))} />}
          {editavel ? (
            <div className="sq-add">
              <input aria-label="Nome da skill" value={novaSkill} placeholder="ev-builder" spellCheck={false} onChange={(e) => setNovaSkill(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSkill(); } }} />
              <button type="button" className="botao" onClick={addSkill}>Adicionar skill</button>
            </div>
          ) : null}
        </section>
        <section className="sq-sec" aria-label="MCPs permitidos">
          <h3>MCPs permitidos</h3>
          {mcps.length === 0 ? <p className="sq-vazio">Nenhum MCP (vazio por padrão).</p> : <Chips itens={mcps} rotulo="MCPs permitidos" editavel={editavel} aoRemover={(i) => setMcps(mcps.filter((x) => x !== i))} />}
          {editavel ? (
            <div className="sq-add">
              <input aria-label="Nome do servidor MCP" value={novoMcp} placeholder="nome-do-servidor" spellCheck={false} onChange={(e) => setNovoMcp(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); pedirMcp(); } }} />
              <button type="button" className="botao" onClick={pedirMcp}>Permitir MCP…</button>
            </div>
          ) : null}
        </section>
        <section className="sq-sec" aria-label="Hooks">
          <h3>Hooks</h3>
          <p className="sq-vazio" title="Reservado: a aplicação por agente chega com a Fase 7">Reservado para uma fase futura (nenhum hook é aplicado por agente hoje).</p>
        </section>
        <section className="sq-sec" aria-label="Limites">
          <h3>Limites</h3>
          <div className="sq-limites">
            <label>Instâncias paralelas (até {maximoDaSquad})
              <input type="number" min={1} max={LIMITES_SQUAD.instancias_max} value={instancias} disabled={!editavel || membro.papel === "orchestrator"} onChange={(e) => setInstancias(Number(e.target.value))} />
            </label>
            <label>Orçamento de tempo (min, aviso suave)
              <input type="number" min={1} max={LIMITES_SQUAD.tempo_min_max} value={tempo} placeholder="sem limite" disabled={!editavel} onChange={(e) => setTempo(e.target.value)} />
            </label>
          </div>
        </section>
        {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}
        <div className="dialogo-acoes">
          <button type="button" className="botao" onClick={aoFechar}>{editavel ? "Cancelar" : "Fechar"}</button>
          {editavel ? <button type="button" className="botao botao-primario" onClick={salvar}>Aplicar ao rascunho</button> : null}
        </div>
      </Dialogo>
      {confirmarMcp !== null ? (
        <DialogoConfirmacao
          titulo="Permitir este servidor MCP?"
          texto={<p>O agente poderá usar as ferramentas do servidor <code>{confirmarMcp}</code>. Isso AMPLIA o que ele acessa: permita só servidores em que você confia.</p>}
          rotuloConfirmar="Permitir servidor"
          aoCancelar={() => setConfirmarMcp(null)}
          aoConfirmar={() => { setMcps([...mcps, confirmarMcp]); setNovoMcp(""); setConfirmarMcp(null); }}
        />
      ) : null}
    </>
  );
}

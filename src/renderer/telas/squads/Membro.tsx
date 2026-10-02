import { useState } from "react";
import type { Achado, Membro, OpcoesPerfilCli, PermissaoMembro } from "../../../compartilhado/squads";
import { FAIXAS, type Faixa } from "../../../compartilhado/harness";
import { CLIS_CATALOGO, CLI_AUTO, ESFORCOS_NEUTROS, LIMITES_SQUAD } from "../../../compartilhado/squads";
import { Icone } from "../../componentes/Icone";
import { descreverPapel } from "./rascunho";

const PERMISSOES: ReadonlyArray<[PermissaoMembro | "", string]> = [["", "herda"], ["seguro", "seguro"], ["equilibrado", "equilibrado"], ["automatico", "automático"]];
const ORDEM_PERMISSAO: Record<PermissaoMembro, number> = { seguro: 0, equilibrado: 1, automatico: 2 };
/** `outro…` no seletor de modelo (texto livre dentro do formato aceito pelo main). */
const OUTRO = "__outro__";

export interface PropsMembro {
  membro: Membro;
  achados: readonly Achado[];
  editavel: boolean;
  opcoes: OpcoesPerfilCli | undefined;
  /** permissão do workspace atual (selo "acima do workspace"); null = desconhecida. */
  permissaoWorkspace: PermissaoMembro | null;
  podeDuplicar: boolean;
  aoMudar: (patch: Partial<Membro>) => void;
  aoPerfil: (patch: Partial<Membro["perfil"]>) => void;
  aoPrompt: () => void;
  aoSkills: () => void;
  aoDuplicar: (cli?: string) => void;
  aoRemover: () => void;
}

function SeletorModelo({ rotulo, valor, opcoes, desabilitado, aoMudar }: { rotulo: string; valor: string | null; opcoes: OpcoesPerfilCli | undefined; desabilitado: boolean; aoMudar: (m: string | null) => void }) {
  const lista = opcoes?.modelos.map((m) => m.modelo) ?? [];
  const personalizado = valor !== null && valor !== "default" && !lista.includes(valor);
  const [editandoOutro, setEditandoOutro] = useState(false);
  if (personalizado || editandoOutro) {
    return (
      <span className="sq-outro">
        <input aria-label={`Modelo de ${rotulo}`} value={valor ?? ""} disabled={desabilitado} placeholder="id do modelo" spellCheck={false} onChange={(e) => aoMudar(e.target.value === "" ? null : e.target.value)} />
        <button type="button" className="sq-icone" aria-label={`Voltar à lista de modelos de ${rotulo}`} title="Voltar à lista" disabled={desabilitado} onClick={() => { setEditandoOutro(false); aoMudar(null); }}>
          <Icone nome="desfazer" />
        </button>
      </span>
    );
  }
  return (
    <select aria-label={`Modelo de ${rotulo}`} value={valor ?? ""} disabled={desabilitado} onChange={(e) => { if (e.target.value === OUTRO) { setEditandoOutro(true); aoMudar(""); } else aoMudar(e.target.value === "" ? null : e.target.value); }}>
      <option value="">default da CLI</option>
      {lista.map((m) => <option key={m} value={m}>{m}</option>)}
      <option value={OUTRO}>outro…</option>
    </select>
  );
}

/** Linha de membro (24 px): papel, rótulo, CLI, modelo, esforço (selo indicativo), faixa, instâncias, permissão, skills/MCPs, prompt, ações, estado. */
export function LinhaMembro({ membro: m, achados, editavel, opcoes, permissaoWorkspace, podeDuplicar, aoMudar, aoPerfil, aoPrompt, aoSkills, aoDuplicar, aoRemover }: PropsMembro) {
  const rot = m.rotulo || m.slug;
  const desab = !editavel;
  const erros = achados.filter((a) => a.severidade === "erro");
  const avisos = achados.filter((a) => a.severidade === "aviso");
  const niveis = opcoes === undefined ? [] : opcoes.niveis_esforco.length > 0 ? opcoes.niveis_esforco : [...ESFORCOS_NEUTROS];
  const esforcoFora = m.perfil.esforco !== null && !niveis.includes(m.perfil.esforco);
  const indicativo = m.perfil.esforco !== null && opcoes !== undefined && (opcoes.esforco_modo === "indicativo" || opcoes.esforco_modo === "nenhum");
  const acima = m.permissao !== null && permissaoWorkspace !== null && ORDEM_PERMISSAO[m.permissao] > ORDEM_PERMISSAO[permissaoWorkspace];
  const orq = m.papel === "orchestrator";
  const estadoTxt = erros.length > 0 ? `${erros.length} erro(s): ${erros.map((a) => a.mensagem).join("; ")}` : avisos.length > 0 ? `${avisos.length} aviso(s): ${avisos.map((a) => a.mensagem).join("; ")}` : "sem achados";

  return (
    <tr className="sq-membro" data-papel={m.papel} data-erro={erros.length > 0 || undefined}>
      <td><span className="sq-papel" data-papel={m.papel}>{descreverPapel(m.papel)}</span></td>
      <td><input aria-label={`Rótulo de ${rot}`} className="sq-in-rotulo" value={m.rotulo} maxLength={LIMITES_SQUAD.rotulo_max} disabled={desab} onChange={(e) => aoMudar({ rotulo: e.target.value })} /></td>
      <td>
        <select aria-label={`CLI de ${rot}`} value={m.perfil.cli} disabled={desab} onChange={(e) => aoPerfil({ cli: e.target.value, modelo: null })}>
          {[...CLIS_CATALOGO, CLI_AUTO].map((c) => <option key={c} value={c}>{c}</option>)}
          {![...CLIS_CATALOGO, CLI_AUTO].includes(m.perfil.cli as never) ? <option value={m.perfil.cli}>{m.perfil.cli}</option> : null}
        </select>
      </td>
      <td><SeletorModelo rotulo={rot} valor={m.perfil.modelo} opcoes={opcoes} desabilitado={desab} aoMudar={(modelo) => aoPerfil({ modelo })} /></td>
      <td>
        <span className="sq-esforco">
          <select aria-label={`Esforço de ${rot}`} value={m.perfil.esforco ?? ""} disabled={desab} onChange={(e) => aoPerfil({ esforco: e.target.value === "" ? null : e.target.value })}>
            <option value="">padrão</option>
            {esforcoFora && m.perfil.esforco !== null ? <option value={m.perfil.esforco}>{m.perfil.esforco}</option> : null}
            {niveis.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          {indicativo ? <span className="sq-selo" title="Esta CLI não recebe o esforço por parâmetro: ele entra como instrução no prompt">indicativo</span> : null}
        </span>
      </td>
      <td>
        <select aria-label={`Faixa de ${rot}`} value={m.perfil.faixa} disabled={desab} onChange={(e) => aoPerfil({ faixa: e.target.value as Faixa })}>
          {FAIXAS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </td>
      <td>
        <input aria-label={`Instâncias de ${rot}`} className="sq-in-num" type="number" min={1} max={orq ? 1 : LIMITES_SQUAD.instancias_max} value={m.max_instancias} disabled={desab || orq} onChange={(e) => aoMudar({ max_instancias: Number(e.target.value) })} />
      </td>
      <td>
        <span className="sq-esforco">
          <select aria-label={`Permissão de ${rot}`} value={m.permissao ?? ""} disabled={desab} onChange={(e) => aoMudar({ permissao: e.target.value === "" ? null : (e.target.value as PermissaoMembro) })}>
            {PERMISSOES.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </select>
          {acima ? <span className="sq-selo" data-tom="aviso" title="Acima do workspace: vale o do workspace (nunca amplia)">acima do ws</span> : null}
        </span>
      </td>
      <td><button type="button" className="sq-mini" aria-label={`Skills e MCPs de ${rot}`} title="Skills, MCPs e limites" onClick={aoSkills}>{m.skills_permitidas.length}S · {m.mcps_permitidos.length}M</button></td>
      <td><button type="button" className="sq-mini" aria-label={`Editar prompt de ${rot}`} title="Editar prompt" onClick={aoPrompt}>Prompt</button></td>
      <td className="sq-acoes">
        <button type="button" className="sq-icone" aria-label={`Duplicar ${rot}`} title={orq ? "O orquestrador é único" : "Duplicar membro"} disabled={desab || orq || !podeDuplicar} onClick={() => aoDuplicar()}><Icone nome="copiar" /></button>
        <button type="button" className="sq-icone" aria-label={`Remover ${rot}`} title={orq ? "O orquestrador não pode ser removido" : "Remover membro"} disabled={desab || orq} onClick={aoRemover}><Icone nome="lixeira" /></button>
      </td>
      <td>
        <span className="sq-estado" role="img" aria-label={estadoTxt} title={estadoTxt} data-tom={erros.length > 0 ? "alerta" : avisos.length > 0 ? "aviso" : "ok"}>
          {erros.length > 0 || avisos.length > 0 ? <Icone nome="aviso" /> : <span aria-hidden="true">✓</span>}
        </span>
      </td>
    </tr>
  );
}

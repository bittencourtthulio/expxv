// Editor de política e prévia (T-07.32): por papel/agente/Missão, quais skills e quais MCPs do usuário o Pane recebe (deny-by-default em
// Missão squad/agêntico). A prévia mostra, por CLI, o selo de isolamento COM TEXTO (duro/parcial): o parcial nunca é omitido.
import { useEffect, useMemo, useState } from "react";
import type { ApiAde } from "../../../compartilhado/ipc";
import { CLIS_CATALOGO, type CliCatalogo, type ItemCatalogo, type PoliticaResolvida, type PoliticaSkills } from "../../../compartilhado/catalogo";
import { Dialogo } from "../../componentes/Dialogo";
import { VirtualLista } from "../../componentes/VirtualLista";
import { buscarFuzzy } from "../../busca-fuzzy";
import { explicacaoIsolamento, mensagemDoErro, rotuloCli, rotuloIsolamento } from "./logica";

type Api = ApiAde["catalogo"];
type AlvoTipo = "papel" | "agente" | "missao";
type PapelPol = "piloto" | "executor" | "explorador" | "revisor";
const PAPEIS: readonly PapelPol[] = ["piloto", "explorador", "executor", "revisor"];
const GRUPOS: ReadonlyArray<{ id: string; rotulo: string }> = [
  { id: "grupo:metodo", rotulo: "Skills do método Expx (grupo)" },
  { id: "grupo:embarcadas", rotulo: "Skills do produto ev-* (grupo)" },
];

interface Props {
  api: Api;
  workspaceId: string | null;
  skills: readonly ItemCatalogo[];
  servidores: readonly ItemCatalogo[];
  politicas: readonly PoliticaSkills[] | null;
  aoFechar: () => void;
  aoGravou: () => void;
}

export function DialogoPolitica({ api, workspaceId, skills, servidores, politicas, aoFechar, aoGravou }: Props) {
  const [alvoTipo, setAlvoTipo] = useState<AlvoTipo>("papel");
  const [alvoValor, setAlvoValor] = useState<string>("executor");
  const [marcadas, setMarcadas] = useState<ReadonlySet<string>>(new Set());
  const [mcpModo, setMcpModo] = useState<"nenhum" | "lista">("nenhum");
  const [mcps, setMcps] = useState<ReadonlySet<string>>(new Set());
  const [busca, setBusca] = useState("");
  const [cli, setCli] = useState<CliCatalogo>("claude");
  const [modo, setModo] = useState<"squad" | "agentico" | "livre">("squad");
  const [previa, setPrevia] = useState<PoliticaResolvida | null>(null);
  const [msg, setMsg] = useState<{ texto: string; tom: "ok" | "erro" } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // carrega a política gravada do alvo escolhido
  useEffect(() => {
    const p = politicas?.find((x) => x.alvo_tipo === alvoTipo && x.alvo_valor === alvoValor);
    setMarcadas(new Set(p?.skills ?? []));
    setMcpModo(p?.mcp_do_usuario ?? "nenhum");
    setMcps(new Set(p?.servidores_mcp ?? []));
  }, [alvoTipo, alvoValor, politicas]);

  const linhas = useMemo(() => {
    const base = [...GRUPOS.map((g) => ({ id: g.id, rotulo: g.rotulo })), ...skills.map((s) => ({ id: s.nome_normalizado, rotulo: s.nome }))];
    return busca.trim() === "" ? base : buscarFuzzy(base, busca, (x) => `${x.rotulo} ${x.id}`, base.length);
  }, [skills, busca]);

  const alternar = (c: ReadonlySet<string>, set: (s: ReadonlySet<string>) => void, id: string) => {
    const n = new Set(c);
    if (n.has(id)) n.delete(id); else n.add(id);
    set(n);
  };
  const papelPrevia: PapelPol = alvoTipo === "papel" && (PAPEIS as readonly string[]).includes(alvoValor) ? (alvoValor as PapelPol) : "executor";
  const valido = workspaceId !== null && alvoValor.trim() !== "";

  const gravar = async () => {
    if (workspaceId === null) return;
    setOcupado(true); setMsg(null);
    try {
      await api.politicaGravar({ workspace_id: workspaceId, alvo_tipo: alvoTipo, alvo_valor: alvoValor.trim(), skills: [...marcadas], mcp_do_usuario: mcpModo, servidores_mcp: mcpModo === "lista" ? [...mcps] : [] });
      setMsg({ texto: "Política gravada.", tom: "ok" });
      aoGravou();
      await atualizarPrevia();
    } catch (e) { setMsg({ texto: mensagemDoErro(e), tom: "erro" }); } finally { setOcupado(false); }
  };

  async function atualizarPrevia(): Promise<void> {
    if (workspaceId === null) return;
    try {
      setPrevia(await api.politicaPrevia({
        workspace_id: workspaceId, modo, papel: papelPrevia, cli,
        agente_id: alvoTipo === "agente" ? alvoValor.trim() : null, mission_id: alvoTipo === "missao" ? alvoValor.trim() : null,
      }));
    } catch (e) { setMsg({ texto: mensagemDoErro(e), tom: "erro" }); }
  }

  return (
    <Dialogo titulo="Política de skills e MCPs" aoFechar={aoFechar} largura={720}>
      {workspaceId === null ? <p className="cat-nota" role="status">Abra um projeto para editar a política do workspace.</p> : null}
      <div className="cat-pol">
        <div className="cat-pol-col">
          <label className="cat-campo">Alvo
            <select value={alvoTipo} onChange={(e) => { const t = e.target.value as AlvoTipo; setAlvoTipo(t); setAlvoValor(t === "papel" ? "executor" : ""); }}>
              <option value="papel">Papel</option><option value="agente">Agente (squad)</option><option value="missao">Missão</option>
            </select>
          </label>
          {alvoTipo === "papel" ? (
            <label className="cat-campo">Papel
              <select value={alvoValor} onChange={(e) => setAlvoValor(e.target.value)}>{PAPEIS.map((p) => <option key={p} value={p}>{p}</option>)}</select>
            </label>
          ) : (
            <label className="cat-campo">{alvoTipo === "agente" ? "Identificador do agente" : "Identificador da Missão"}
              <input type="text" value={alvoValor} maxLength={80} onChange={(e) => setAlvoValor(e.target.value)} />
            </label>
          )}
          <label className="cat-campo">Buscar skills
            <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Filtrar a lista" />
          </label>
          <div className="cat-pol-lista">
            <VirtualLista itens={linhas} alturaItem={36} alturaPadrao={192} rotulo="Skills permitidas" chave={(x) => x.id}
              renderItem={(x) => (
                <label className="cat-check"><input type="checkbox" checked={marcadas.has(x.id)} onChange={() => alternar(marcadas, setMarcadas, x.id)} /> <span>{x.rotulo}</span></label>
              )} />
          </div>
          <p className="cat-nota">{marcadas.size} selecionadas. Em Missão squad/agêntico, o que não está na lista não chega ao Pane.</p>
          <label className="cat-campo">MCPs do usuário
            <select value={mcpModo} onChange={(e) => setMcpModo(e.target.value as "nenhum" | "lista")}>
              <option value="nenhum">Nenhum (só o MCP do app)</option><option value="lista">Somente a lista abaixo</option>
            </select>
          </label>
          {mcpModo === "lista" ? (
            <ul className="cat-pol-mcps" aria-label="Servidores MCP permitidos">
              {servidores.length === 0 ? <li className="cat-nota">Nenhum servidor MCP no catálogo.</li> : servidores.map((s) => (
                <li key={s.id}><label className="cat-check"><input type="checkbox" checked={mcps.has(s.nome_normalizado)} onChange={() => alternar(mcps, setMcps, s.nome_normalizado)} /> <span>{s.nome}</span></label></li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="cat-pol-col" aria-label="Prévia">
          <h3>Prévia</h3>
          <div className="cat-pol-previa-form">
            <label className="cat-campo">Modo
              <select value={modo} onChange={(e) => setModo(e.target.value as typeof modo)}><option value="squad">squad</option><option value="agentico">agêntico</option><option value="livre">livre</option></select>
            </label>
            <label className="cat-campo">CLI
              <select value={cli} onChange={(e) => setCli(e.target.value as CliCatalogo)}>{CLIS_CATALOGO.map((c) => <option key={c} value={c}>{rotuloCli(c)}</option>)}</select>
            </label>
            <button type="button" className="botao cat-mini" disabled={!valido} onClick={() => void atualizarPrevia()}>Atualizar prévia</button>
          </div>
          {previa === null ? <p className="cat-nota">Grave ou atualize para ver o que o Pane recebe.</p> : (
            <div data-testid="previa">
              <p><strong>Skills efetivas:</strong> {previa.skills === null ? "sem filtro (modo livre)" : previa.skills.length === 0 ? "nenhuma" : previa.skills.join(", ")}</p>
              {previa.faltando.length > 0 ? <p className="cat-aviso" data-tom="erro" role="status"><strong>Faltando no catálogo:</strong> {previa.faltando.join(", ")}</p> : null}
              <p><strong>MCPs do usuário:</strong> {previa.mcp_do_usuario === "nenhum" ? "nenhum" : previa.servidores_mcp.join(", ") || "lista vazia"}</p>
              <ul className="cat-iso" aria-label="Isolamento por CLI">
                {CLIS_CATALOGO.map((c) => (
                  <li key={c}><span className="cat-selo" data-isolamento={previa.isolamento[c]}>{previa.isolamento[c] === "duro" ? "● " : "◐ "}{rotuloIsolamento(previa.isolamento[c])}</span> <strong>{rotuloCli(c)}</strong> <span className="cat-nota">{explicacaoIsolamento(previa.isolamento[c])}</span></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      {msg !== null ? <p role={msg.tom === "erro" ? "alert" : "status"} className="cat-aviso" data-tom={msg.tom}>{msg.texto}</p> : null}
      <div className="dialogo-acoes">
        <button type="button" className="botao" onClick={aoFechar}>Fechar</button>
        <button type="button" className="botao botao-primario" disabled={!valido || ocupado} onClick={() => void gravar()}>Gravar política</button>
      </div>
    </Dialogo>
  );
}

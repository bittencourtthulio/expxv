import "../../casca/limites.css";
import "./harness.css";
import { useEffect, useMemo, useState } from "react";
import type { ConfigHarness, ModoTroca } from "../../../compartilhado/harness";
import { ade } from "../../ade";
import { Dialogo } from "../../componentes/Dialogo";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { Icone } from "../../componentes/Icone";
import { SubNavegacao, type ItemSubNav } from "../../componentes/SubNavegacao";
import { useCarga } from "../../estado/carga";
import { aoPedirHarness, type AbaHarness } from "../../estado/harness-acoes";
import { storeProvedores, useProvedores } from "../../estado/provedores";
import { storeWorkspaces, useWorkspaces } from "../../estado/workspaces";
import { ContasLimites } from "./ContasLimites";
import { Cofre } from "./Cofre";
import { Decisoes } from "./Decisoes";
import { Equivalencia } from "./Equivalencia";
import { Politica } from "./Politica";
import type { ApiCofre, ApiHarness } from "./tipos";
import { LIMIAR_MAX, LIMIAR_MIN, validarLimiar, type ContextoPolitica } from "./validar";

const ABAS: ReadonlyArray<ItemSubNav<AbaHarness>> = [
  { id: "politica", rotulo: "Política", icone: "harness" }, { id: "equivalencia", rotulo: "Equivalência", icone: "provedores" }, { id: "contas", rotulo: "Contas e limites", icone: "consumo" },
  { id: "decisoes", rotulo: "Decisões", icone: "catalogo" }, { id: "cofre", rotulo: "Cofre", icone: "memoria" },
];
export const MODOS: ReadonlyArray<[ModoTroca | "", string]> = [["", "Modo: padrão do workspace"], ["manual", "Modo: manual"], ["so_sugerir", "Modo: só sugerir"], ["automatico", "Modo: automático"]];
const TEXTO_MODO: Record<ModoTroca, string> = { manual: "você move o trabalho quando quiser", so_sugerir: "o app sugere a troca e você decide", automatico: "o app troca sozinho ao passar do limiar" };
export { TEXTO_MODO };

export interface PropsTelaHarness { api?: ApiHarness | undefined; apiCofre?: ApiCofre | undefined; abaInicial?: AbaHarness }

export function TelaHarness({ api = ade()?.harness, apiCofre = ade()?.cofre, abaInicial = "politica" }: PropsTelaHarness) {
  const { atual } = useWorkspaces(storeWorkspaces);
  const prov = useProvedores(storeProvedores);
  const [aba, setAba] = useState<AbaHarness>(abaInicial);
  const [escopo, setEscopo] = useState<"global" | "workspace">("global");
  const [busca, setBusca] = useState("");
  const [versao, setVersao] = useState(0);
  const [novoTipo, setNovoTipo] = useState(false);
  const [restaurar, setRestaurar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [limiarTexto, setLimiarTexto] = useState<string | null>(null);
  useEffect(() => { if (storeProvedores.obter().lista === null) void storeProvedores.carregar(false); }, []);
  useEffect(() => aoPedirHarness(setAba), []);

  const wsId = atual?.id ?? null;
  const workspaceId = escopo === "workspace" ? wsId : null;
  const cfg = useCarga<ConfigHarness>(api?.lerConfig === undefined || wsId === null ? undefined : () => api.lerConfig!(wsId), `cfg|${wsId}|${versao}`);
  const limiarVal = limiarTexto ?? String(cfg.dados?.limiar_troca_pct ?? 85);
  const limiarValido = validarLimiar(limiarVal);

  const ctx: ContextoPolitica = useMemo(() => {
    const ativos = new Set<string>();
    for (const p of prov.lista ?? []) if (p.ferramenta.instalado && p.contas.some((c) => c.habilitada)) ativos.add(p.ferramenta.id);
    return { provedoresAtivos: prov.lista === null ? null : ativos };
  }, [prov.lista]);

  const gravarCfg = async (mudanca: Partial<ConfigHarness>) => {
    if (cfg.dados === null || api?.gravarConfig === undefined) return;
    const { atualizado_em: _a, ...base } = cfg.dados;
    try { await api.gravarConfig({ ...base, ...mudanca }); setErro(null); setLimiarTexto(null); cfg.recarregar(); }
    catch (e) { setErro(`Não foi possível gravar a configuração: ${e instanceof Error ? e.message : String(e)}`); }
  };
  const modo = cfg.dados?.modo_troca ?? "";

  const props = { api, workspaceId, busca, versao, ctx };
  return (
    <section className="harness" data-modo="leitura" data-largura="larga" aria-label="Harness">
     <SubNavegacao itens={ABAS} ativo={aba} onMudar={setAba} rotulo="Seções do harness" base="harness" recolhivel classePainel="harness-corpo" barra={<>
      <div className="harness-barra" role="toolbar" aria-label="Controles do harness">
        <select aria-label="Escopo" title={escopo === "global" ? "Global" : atual !== null ? `Workspace: ${atual.nome}` : "Workspace"} value={escopo} onChange={(e) => setEscopo(e.target.value as "global" | "workspace")}>
          <option value="global">Global</option>
          <option value="workspace" disabled={wsId === null}>{atual !== null ? `Workspace: ${atual.nome}` : "Workspace (abra um projeto)"}</option>
        </select>
        <select aria-label="Nível de rigidez" value={cfg.dados?.nivel ?? 4} disabled={cfg.dados === null} onChange={(e) => void gravarCfg({ nivel: Number(e.target.value) })}>
          {[1, 2, 3, 4].map((n) => <option key={n} value={n}>Nível {n}</option>)}
        </select>
        <select aria-label="Modo de troca" title={modo === "" ? "Deriva da permissão do workspace" : TEXTO_MODO[modo]} value={modo} disabled={cfg.dados === null} onChange={(e) => void gravarCfg({ modo_troca: e.target.value === "" ? null : (e.target.value as ModoTroca) })}>
          {MODOS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
        </select>
        <label className="h-nota" htmlFor="h-limiar">Limiar %</label>
        <input id="h-limiar" className="h-limiar" inputMode="numeric" aria-label="Limiar de troca em porcentagem" aria-invalid={!limiarValido.ok} title={`Entre ${LIMIAR_MIN} e ${LIMIAR_MAX}`} disabled={cfg.dados === null} value={limiarVal}
          onChange={(e) => setLimiarTexto(e.target.value)}
          onBlur={() => { if (limiarTexto !== null && limiarValido.ok) void gravarCfg({ limiar_troca_pct: limiarValido.valor }); }}
          onKeyDown={(e) => { if (e.key === "Enter" && limiarValido.ok) void gravarCfg({ limiar_troca_pct: limiarValido.valor }); }} />
        <input type="search" aria-label="Buscar" placeholder="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <button type="button" className="botao-mini" aria-label="Novo tipo de tarefa" title="Novo tipo de tarefa" disabled={api?.gravarTaskType === undefined} onClick={() => setNovoTipo(true)}><Icone nome="mais" /></button>
        <button type="button" className="botao-mini" aria-label="Restaurar semente" title="Restaurar a política semente" disabled={api?.restaurarSemente === undefined} onClick={() => setRestaurar(true)}><Icone nome="desfazer" /></button>
      </div>
      {!limiarValido.ok ? <p role="alert" className="h-erro">{limiarValido.erro}</p> : null}
      {erro !== null ? <p role="alert" className="h-erro">{erro}</p> : null}
      {wsId === null && aba !== "cofre" && aba !== "equivalencia" ? <p className="h-nota">Sem projeto aberto: o modo de troca por workspace fica indisponível; o escopo global continua editável.</p> : null}
     </>}>
        {api === undefined && aba !== "cofre" ? <EstadoVazio icone="harness" titulo="Harness indisponível" texto="Esta janela não está ligada ao app. Abra o app para configurar política, equivalência e contas." />
          : aba === "politica" ? <Politica {...props} />
          : aba === "equivalencia" ? <Equivalencia {...props} />
          : aba === "contas" ? <ContasLimites {...props} cfg={cfg.dados} aoGravarConfig={gravarCfg} />
          : aba === "decisoes" ? <Decisoes {...props} apiCofre={apiCofre} />
          : <Cofre api={apiCofre} workspaceId={wsId} busca={busca} />}
     </SubNavegacao>
      {novoTipo ? <NovoTipo api={api} aoFechar={(mudou) => { setNovoTipo(false); if (mudou) setVersao((v) => v + 1); }} /> : null}
      {restaurar ? (
        <Dialogo titulo="Restaurar política semente" aoFechar={() => setRestaurar(false)}>
          <div className="dialogo-corpo"><p>As políticas {workspaceId === null ? "globais" : "deste workspace"} voltam aos valores de fábrica. Suas edições nesse escopo são descartadas.</p></div>
          <div className="dialogo-acoes">
            <button type="button" className="botao" onClick={() => setRestaurar(false)}>Cancelar</button>
            <button type="button" className="botao botao-primario" onClick={async () => { try { await api?.restaurarSemente?.(workspaceId); setVersao((v) => v + 1); setRestaurar(false); } catch (e) { setErro(`Não foi possível restaurar: ${e instanceof Error ? e.message : String(e)}`); setRestaurar(false); } }}>Restaurar</button>
          </div>
        </Dialogo>
      ) : null}
    </section>
  );
}

function NovoTipo({ api, aoFechar }: { api: ApiHarness | undefined; aoFechar: (mudou: boolean) => void }) {
  const [slug, setSlug] = useState("");
  const [categoria, setCategoria] = useState("");
  const [rotulo, setRotulo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const problema = !/^[a-z][a-z0-9-]{1,47}$/.test(slug) ? "O identificador usa minúsculas, números e hífen (2 a 48 caracteres)." : categoria.trim() === "" ? "Informe a categoria." : rotulo.trim() === "" ? "Informe o rótulo." : null;
  const gravar = async () => {
    if (problema !== null) { setErro(problema); return; }
    try { await api?.gravarTaskType?.({ slug, categoria: categoria.trim(), rotulo: rotulo.trim(), descricao: null }); aoFechar(true); }
    catch (e) { setErro(`Não foi possível criar o tipo: ${e instanceof Error ? e.message : String(e)}`); }
  };
  return (
    <Dialogo titulo="Novo tipo de tarefa" aoFechar={() => aoFechar(false)}>
      <label className="h-campo">Identificador<input data-foco-inicial value={slug} onChange={(e) => { setSlug(e.target.value); setErro(null); }} aria-invalid={erro !== null && !/^[a-z][a-z0-9-]{1,47}$/.test(slug)} /></label>
      <label className="h-campo">Categoria<input value={categoria} onChange={(e) => { setCategoria(e.target.value); setErro(null); }} /></label>
      <label className="h-campo">Rótulo<input value={rotulo} onChange={(e) => { setRotulo(e.target.value); setErro(null); }} /></label>
      {erro !== null ? <p role="alert" className="h-erro">{erro}</p> : null}
      <div className="dialogo-acoes">
        <button type="button" className="botao" onClick={() => aoFechar(false)}>Cancelar</button>
        <button type="button" className="botao botao-primario" onClick={() => void gravar()}>Criar tipo</button>
      </div>
    </Dialogo>
  );
}

export default function Tela() {
  return <TelaHarness />;
}

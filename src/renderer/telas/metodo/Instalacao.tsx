import { useEffect } from "react";
import type { IndiceProjeto } from "../../../nucleo/metodo/tipos";
import { SCHEMA_SUPORTADO } from "../../../nucleo/metodo/tipos";
import { Icone } from "../../componentes/Icone";
import { storeRigidez, type StoreRigidez } from "../../estado/rigidez";
import { storeSuite, useSuite, type StoreSuite } from "../../estado/suite";
import { ContextoProjeto } from "./ContextoProjeto";
import { ModulosSuite } from "./ModulosSuite";
import { SuiteMetodo } from "./SuiteMetodo";

// Modos de nascimento documentados (somente leitura): métodos em aviso, segurança em bloqueio.
const HOOKS_PADRAO: readonly { nome: string; modo: "aviso" | "bloqueio" }[] = [
  { nome: "segredo-no-commit", modo: "bloqueio" },
  { nome: "git-perigoso", modo: "bloqueio" },
  { nome: "task-so-fecha-verde", modo: "aviso" },
  { nome: "tdd-teste-antes", modo: "aviso" },
  { nome: "escopo-da-task", modo: "aviso" },
  { nome: "pr-so-com-portao", modo: "aviso" },
];

const TOTAL_SKILLS_PADRAO = 9;

function irParaModulos(): void {
  const alvo = document.querySelector<HTMLElement>('[aria-label="Módulos da suíte"]');
  alvo?.scrollIntoView?.({ block: "start" });
  alvo?.querySelector<HTMLElement>('[role="switch"]')?.focus();
}

/** Hooks de proteção: item próprio, honesto. O instalador NÃO os liga; quem escreve `.expx/hooks.json` é a rigidez do app (com prévia e confirmação) ou o próprio usuário. */
function Protecoes({ ativos, metodoInstalado, rigidez }: { ativos: boolean; metodoInstalado: boolean; rigidez: StoreRigidez }) {
  return (
    <div className="inst-hooks" data-hooks={ativos ? "ativados" : "nao"}>
      <div className="inst-hooks-topo">
        <i aria-hidden="true" className="inst-marca">{ativos ? "✓" : "○"}</i>
        <b>Hooks de proteção</b>
        <span className="inst-estado" data-ok={ativos ? "true" : "false"}>{ativos ? "Ativados" : "Não ativados"}</span>
      </div>
      <p className="met-suave">
        Hooks de proteção bloqueiam segredo no commit e git perigoso; o instalador não os liga.
        {" "}Quem os escreve é a rigidez do método, por ação sua e com prévia do que será gravado em <code>.expx/hooks.json</code>.
      </p>
      <div className="inst-acoes">
        <button
          type="button" className={ativos ? "botao" : "botao botao-primario"} aria-haspopup="true" disabled={!metodoInstalado}
          title={metodoInstalado ? undefined : "Instale a suíte primeiro: sem a pasta .expx nada é gravado"}
          onClick={() => rigidez.pedirAbrir()}
        >
          <Icone nome="harness" /> {ativos ? "Ver a rigidez" : "Ativar proteções"}
        </button>
        {!metodoInstalado ? <span className="met-suave">Disponível depois de instalar a suíte.</span> : <span className="met-suave" role="status">{ativos ? "Para mudar o nível, use o seletor de rigidez no topo." : "Abre a rigidez no topo da janela: escolha o nível, confira a prévia e confirme."}</span>}
      </div>
      <details className="inst-detalhes">
        <summary>Ver o que são</summary>
        <ul className="met-hooks">
          {HOOKS_PADRAO.map((h) => <li key={h.nome}><code>{h.nome}</code> <span className="met-chip" data-modo={h.modo}>{h.modo}</span></li>)}
        </ul>
        <p className="met-suave">
          {ativos
            ? "Estes são os modos de nascimento; promover aviso para bloqueio é decisão sua, na rigidez ou à mão em .expx/hooks.json."
            : "Sem o arquivo valem os padrões de nascimento: métodos em aviso, segurança em bloqueio."}
        </p>
      </details>
    </div>
  );
}

/**
 * Aba "Instalação" do Método, em dois blocos (D-495): (A) Instalação da suíte ExpxDev (versão, skills, módulos, assistente e hooks de proteção) e
 * (B) Contexto do projeto (o que o método GERA com comandos). Misturar os dois levava a ler "não instalada" onde o certo é "ainda não gerado".
 */
export function Instalacao({ indice, workspaceId = null, store = storeSuite, rigidez = storeRigidez }: { indice: IndiceProjeto; workspaceId?: string | null; store?: StoreSuite; rigidez?: StoreRigidez }) {
  const ui = useSuite(store);
  useEffect(() => store.ligar(), [store]);
  useEffect(() => { if (workspaceId !== null) { void store.garantirEstado(workspaceId); void store.garantirModulos(workspaceId); } }, [store, workspaceId]);
  const schema = indice.rejeicoes.filter((r) => r.motivo === "schema_maior");
  const suite = workspaceId === null ? null : ui.estados[workspaceId] ?? null;
  const mods = workspaceId === null ? null : ui.modulos[workspaceId] ?? null;
  const presentes = suite?.skills_presentes.length ?? null;
  const totalSkills = suite === null ? TOTAL_SKILLS_PADRAO : suite.skills_presentes.length + suite.skills_faltando.length || TOTAL_SKILLS_PADRAO;
  const versao = suite?.versao_instalada ?? null;
  const ligados = mods === null ? null : mods.modulos.filter((m) => m.ligado).length;

  return (
    <div className="met-instalacao">
      {schema.length > 0 ? (
        <div className="met-alerta" role="alert">
          <b>Incompatibilidade de expx_schema.</b> {schema.length} arquivo(s) usam um schema mais novo que o suportado (v{SCHEMA_SUPORTADO}); foram ignorados. Atualize o app.
          <ul>{schema.slice(0, 10).map((r) => <li key={r.caminho}><code>{r.caminho}</code></li>)}</ul>
        </div>
      ) : null}

      <section className="inst-bloco" aria-labelledby="inst-titulo" data-bloco="instalacao">
        <h3 id="inst-titulo">Instalação</h3>
        <p className="met-suave">A suíte ExpxDev são as skills do método neste projeto. Instalar, reparar e atualizar é com o assistente; o contexto que o método gera vem depois, no bloco seguinte.</p>
        {workspaceId !== null ? <SuiteMetodo workspaceId={workspaceId} store={store} semLinhaCompleta /> : null}
        <dl className="inst-resumo">
          <div><dt>Versão instalada</dt><dd>{versao !== null ? versao : indice.camadas.lock ? "registrada no lock" : "não instalada"}</dd></div>
          {presentes !== null ? <div><dt>Skills presentes</dt><dd>{presentes} de {totalSkills}</dd></div> : null}
          {ligados !== null && mods !== null ? (
            <div><dt>Módulos ativos</dt><dd>{ligados} de {mods.modulos.length} <button type="button" className="inst-link" onClick={irParaModulos}>Ajustar em Módulos da suíte</button></dd></div>
          ) : null}
        </dl>
        <Protecoes ativos={indice.camadas.hooks} metodoInstalado={indice.camadas.lock} rigidez={rigidez} />
        {workspaceId !== null ? <ModulosSuite workspaceId={workspaceId} store={store} /> : null}
      </section>

      {workspaceId !== null ? <ContextoProjeto workspaceId={workspaceId} indice={indice} store={store} /> : null}
    </div>
  );
}

import type { TemplateProjeto } from "../../../compartilhado/workspaces-adicionar";
import { podeCriar, type EstadoAdicionarUI, type StoreAdicionar } from "../../estado/adicionar-workspace";
import { AvisoDestino, CampoDestino } from "./CampoDestino";

const TEMPLATES: ReadonlyArray<{ id: TemplateProjeto; rotulo: string; dica: string }> = [
  { id: "vazio", rotulo: "Pasta vazia", dica: "Só o que você marcar abaixo." },
  { id: "node", rotulo: "Node", dica: "package.json mínimo, sem dependências." },
  { id: "python", rotulo: "Python", dica: "pyproject.toml mínimo, sem dependências." },
  { id: "docs", rotulo: "Documentação", dica: "docs/index.md e README." },
];

/** Novo projeto: nome, destino, git/README/template (tudo local, sem rede) e, se quiser, a suíte ExpxDev ao terminar. */
export function SecaoNovo({ store, ui, aoFechar }: { store: StoreAdicionar; ui: EstadoAdicionarUI; aoFechar: () => void }) {
  const n = ui.novo;
  const criando = ui.criacao.fase === "criando";
  const pode = podeCriar(n, ui.destino) && !criando;
  if (ui.criacao.fase === "pronto" && ui.criacao.workspace !== null) {
    return (
      <section className="aw-secao" aria-labelledby="aw-novo-pronto">
        <div className="aw-pronto">
          <h3 id="aw-novo-pronto">Pronto</h3>
          <p><strong>{ui.criacao.workspace.nome}</strong> foi criado e já é o workspace atual.</p>
          {ui.criacao.avisos.map((a) => <p key={a} className="aw-nota" role="status">{a}</p>)}
          <div className="aw-acoes"><button type="button" className="botao botao-primario" data-foco-inicial onClick={aoFechar}>Abrir</button></div>
        </div>
      </section>
    );
  }
  return (
    <section className="aw-secao" aria-labelledby="aw-novo-titulo">
      <div className="aw-cabeca">
        <h3 id="aw-novo-titulo">Novo projeto</h3>
        <p>Cria uma pasta nova neste computador. Nada é baixado nem instalado.</p>
      </div>

      {ui.criacao.fase === "erro" && ui.criacao.erro !== null ? <p role="alert" className="erro-caixa">{ui.criacao.erro.mensagem}</p> : null}

      <label className="campo">
        Nome do projeto
        <input type="text" value={n.nome} data-foco-inicial autoComplete="off" spellCheck={false} disabled={criando} aria-invalid={n.erroNome !== null ? "true" : undefined} onChange={(e) => store.definirNovo({ nome: e.target.value })} />
      </label>
      {n.erroNome !== null ? <p role="alert" className="campo-erro">{n.erroNome}</p> : null}

      <CampoDestino destino={ui.destino} erro={ui.erroDestino} aoEscolher={(l) => void store.escolherDestino(l)} desabilitado={criando} />
      <AvisoDestino a={n.avaliacao} nome={n.nome} aoUsarSugestao={() => store.usarSugestaoNovo()} aoAbrirExistente={() => void store.abrirExistente("novo")} />

      <fieldset className="aw-opcoes">
        <legend>Ponto de partida</legend>
        {TEMPLATES.map((t) => (
          <label key={t.id} className="aw-marca"><input type="radio" name="aw-template" checked={n.template === t.id} disabled={criando} onChange={() => store.definirNovo({ template: t.id })} /><span>{t.rotulo}<small>{t.dica}</small></span></label>
        ))}
      </fieldset>

      <div className="aw-bloco">
        <h4>Opções</h4>
        <label className="aw-marca"><input type="checkbox" checked={n.git} disabled={criando} onChange={(e) => store.definirNovo({ git: e.target.checked })} /><span>Iniciar repositório git<small>Ramo <code>main</code>.</small></span></label>
        <label className="aw-marca"><input type="checkbox" checked={n.git && n.gitignore} disabled={criando || !n.git} onChange={(e) => store.definirNovo({ gitignore: e.target.checked })} /><span>Criar <code>.gitignore</code> mínimo<small>Arquivos de ambiente ficam fora do git.</small></span></label>
        <label className="aw-marca"><input type="checkbox" checked={n.git && n.commit} disabled={criando || !n.git} onChange={(e) => store.definirNovo({ commit: e.target.checked })} /><span>Fazer o commit inicial<small>Usa a identidade git que você já configurou; sem ela, o commit não é feito e você é avisado.</small></span></label>
        <label className="aw-marca"><input type="checkbox" checked={n.readme || n.template === "docs"} disabled={criando || n.template === "docs"} onChange={(e) => store.definirNovo({ readme: e.target.checked })} /><span>Criar <code>README.md</code></span></label>
        <label className="aw-marca"><input type="checkbox" checked={n.instalarSuite} disabled={criando} onChange={(e) => store.definirNovo({ instalarSuite: e.target.checked })} /><span>Instalar a suíte ExpxDev ao criar<small>Ao terminar, abre o assistente de instalação (você confirma lá).</small></span></label>
      </div>

      <div className="aw-rodape">
        <span className="aw-rodape-dica" role="status">{criando ? "Criando o projeto…" : pode ? "" : "Informe o nome e confira o destino."}</span>
        <button type="button" className="botao botao-primario" disabled={!pode} onClick={() => void store.criarNovo()}>{criando ? "Criando…" : "Criar projeto"}</button>
      </div>
    </section>
  );
}

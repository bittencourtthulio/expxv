import "../../casca/suite.css";
import { useEffect, useId } from "react";
import type { EstadoModulosSuite, ModuloInfo } from "../../../compartilhado/suite";
import { storeSuite, useSuite, type StoreSuite } from "../../estado/suite";

const ORIGEM: Record<EstadoModulosSuite["origem"], (arquivo: string) => string> = {
  arquivo: (a) => `Guardado em ${a}, no repositório do projeto (versionável).`,
  app: () => "A pasta do projeto não aceita escrita: guardado nos dados do app.",
  padrao: () => "Ainda não gravado: vale o padrão (nada é escrito no projeto até você ajustar um módulo).",
};

const lista = (g: readonly string[][]): string => g.map((x) => x.join(" ou ")).join(" e ");

/** Selos de dependência de um módulo em linguagem simples. */
export function selosDoModulo(m: ModuloInfo): string[] {
  const s: string[] = [];
  if (m.padrao_desligado) s.push("padrão: desligado");
  if (m.exige.length > 0) s.push(`exige ${lista(m.exige)}`);
  if (m.recomenda.length > 0) s.push(`recomenda ${lista(m.recomenda)}`);
  if (m.dependentes.length > 0) s.push(`usado por ${m.dependentes.join(", ")}`);
  return s;
}

function Interruptor({ m, aoMudar }: { m: ModuloInfo; aoMudar: (ligado: boolean) => void }) {
  const idDesc = useId();
  return (
    <li className="mod-item" data-ligado={m.ligado || undefined} data-modulo={m.id}>
      <div className="mod-texto">
        <span className="mod-nome" id={`${idDesc}-nome`}>{m.nome}</span>
        <span className="mod-papel" id={idDesc}>{m.papel}</span>
        <span className="mod-selos">
          {selosDoModulo(m).map((t) => <span key={t} className="mod-selo" data-tipo={t.startsWith("padrão") ? "padrao" : undefined}>{t}</span>)}
        </span>
      </div>
      <button
        type="button" role="switch" aria-checked={m.ligado} aria-labelledby={`${idDesc}-nome`} aria-describedby={idDesc} className="mod-interruptor" title={m.fonte}
        onClick={() => aoMudar(!m.ligado)}
      >
        <span className="mod-trilho" aria-hidden="true"><span className="mod-botao" /></span>
        <span className="mod-estado">{m.ligado ? "Ligado" : "Desligado"}</span>
      </button>
    </li>
  );
}

/**
 * Seção "Módulos da suíte" da tela Método: os nove módulos com interruptor por projeto. Desligar some do app (botões, comandos, pipelines do Maestro) e nega a skill
 * aos agentes do Claude Code abertos pelo app; o lock e as skills instaladas nunca são tocados. Desligar um módulo de que outro depende (ou ligar um que exige outro
 * desligado) pergunta ANTES: nada muda em cascata em silêncio.
 */
export function ModulosSuite({ workspaceId, store = storeSuite }: { workspaceId: string; store?: StoreSuite }) {
  const ui = useSuite(store);
  useEffect(() => store.ligar(), [store]);
  useEffect(() => { void store.garantirModulos(workspaceId); }, [store, workspaceId]);
  const e = ui.modulos[workspaceId];
  const confirmando = ui.confirmandoModulo !== null && ui.confirmandoModulo.workspaceId === workspaceId;
  // a pergunta aparece ACIMA da lista (o interruptor clicado pode estar longe) e leva o foco para a escolha segura
  useEffect(() => {
    if (!confirmando) return;
    const el = document.querySelector<HTMLElement>('.mod-secao [role="alertdialog"] [data-foco-inicial]');
    el?.focus();
    el?.scrollIntoView?.({ block: "center" });
  }, [confirmando]);
  const conf = ui.confirmandoModulo !== null && ui.confirmandoModulo.workspaceId === workspaceId ? ui.confirmandoModulo : null;
  if (!ui.disponivel) return null;
  if (e === undefined) return <p className="suite-suave" role="status">{ui.erroModulos ?? "Lendo os módulos…"}</p>;
  const ligados = e.modulos.filter((m) => m.ligado).length;
  return (
    <section className="mod-secao" aria-label="Módulos da suíte">
      <h3>Módulos da suíte</h3>
      <p className="suite-suave">
        Desligar um módulo some dele neste app: botões, comandos <code>/expx:</code>, ⌘K e pipelines do Maestro. Nada é removido do projeto: o arquivo de controle da suíte e as skills instaladas ficam como estão.
        <span className="mod-contagem"> {ligados} de {e.modulos.length} ligados.</span>
      </p>
      {!e.suite_instalada ? <p className="suite-aviso" role="note">A suíte ExpxDev não está instalada neste projeto: o ajuste vale para quando ela estiver.</p> : null}
      {e.avisos.map((a) => <p key={a} className="suite-aviso" role="note">{a}</p>)}
      {conf !== null ? (
        <div className="suite-confirmar" role="alertdialog" aria-label={conf.tipo === "desligar_dependentes" ? "Desligar também os dependentes?" : "Ligar também os requisitos?"}>
          <p>
            {conf.tipo === "desligar_dependentes"
              ? <><b>Desligar {conf.modulo} também desliga {conf.modulos.join(", ")}</b>, que {conf.modulos.length > 1 ? "dependem" : "depende"} dele. O app não desliga nada em cascata sem a sua confirmação.</>
              : <><b>Para ligar {conf.modulo}, o app liga também {conf.modulos.join(", ")}</b>, que ele exige.</>}
          </p>
          <div className="suite-confirmar-acoes">
            <button type="button" className="botao" data-foco-inicial onClick={() => store.cancelarConfirmacaoModulo()}>Cancelar</button>
            <button type="button" className="botao botao-primario" onClick={() => void store.confirmarModulo()}>{conf.tipo === "desligar_dependentes" ? "Desligar também os dependentes" : "Ligar também os requisitos"}</button>
          </div>
        </div>
      ) : null}
      <ul className="mod-lista" aria-label="Módulos">
        {e.modulos.map((m) => <Interruptor key={m.id} m={m} aoMudar={(ligado) => void store.alternarModulo(m.id, ligado)} />)}
      </ul>
      {ui.erroModulos !== null ? <p className="suite-erro" role="alert">{ui.erroModulos}</p> : null}
      <details className="mod-isolamento">
        <summary>Como o “desligado” vale em cada CLI</summary>
        <ul>
          {e.isolamento.map((i) => <li key={i.cli} data-efeito={i.efeito}><b>{i.nome}</b> — <span className="mod-selo" data-tipo={i.efeito === "parcial" ? "parcial" : "negado"}>{i.efeito === "parcial" ? "parcial" : "negado ao modelo"}</span> {i.texto}</li>)}
        </ul>
      </details>
      <div className="mod-rodape">
        <span className="suite-suave">{ORIGEM[e.origem](e.arquivo)}</span>
        <button type="button" className="botao" onClick={() => void store.restaurarModulos()} title="Volta aos módulos padrão para projetos novos (preferência global)">Restaurar padrões</button>
      </div>
    </section>
  );
}

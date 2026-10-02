import "../../casca/suite.css";
import { useEffect, useRef, useState } from "react";
import type { EtapaSuite, FalhaSuite, PlanoSuite, ProgressoSuite, RequisitoSuite, ResumoSuite } from "../../../compartilhado/suite";
import { formatarDuracao } from "../../../nucleo/executar/saida";
import { Dialogo } from "../../componentes/Dialogo";
import { Icone } from "../../componentes/Icone";
import { useSuite, type StoreSuite } from "../../estado/suite";

const TITULO = { instalar: "Instalar a suíte ExpxDev", reparar: "Reparar a suíte ExpxDev", atualizar: "Atualizar a suíte ExpxDev" } as const;
const ACAO = { instalar: "Instalar agora", reparar: "Reparar agora", atualizar: "Atualizar agora" } as const;
const MARCA_REQUISITO: Record<RequisitoSuite["situacao"], string> = { ok: "✓", falha: "✗", pendente: "○", info: "ℹ" };
const MARCA_ETAPA: Record<EtapaSuite["situacao"], string> = { ok: "✓", ativa: "●", falhou: "✗", pendente: "○", pulada: "–" };
const NOME_SITUACAO_ETAPA: Record<EtapaSuite["situacao"], string> = { ok: "concluída", ativa: "em andamento", falhou: "falhou", pendente: "aguardando", pulada: "pulada" };

/** Texto lido pelo leitor de tela quando a etapa muda (região `aria-live="polite"`, sem o cronômetro). */
export function anuncioDaInstalacao(p: ProgressoSuite): string {
  if (p.fase === "concluida") return "Instalação concluída.";
  if (p.fase === "cancelada") return "Instalação cancelada.";
  if (p.fase === "falhou") return `A instalação falhou: ${p.falha?.mensagem ?? ""}`;
  const i = p.etapas.findIndex((e) => e.situacao === "ativa");
  return i < 0 ? "" : `Etapa ${i + 1} de ${p.etapas.length}: ${p.etapas[i]!.rotulo}.`;
}

function copiarTexto(texto: string): Promise<boolean> {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  if (nav?.clipboard?.writeText !== undefined) return nav.clipboard.writeText(texto).then(() => true, () => false);
  try {
    const ta = document.createElement("textarea");
    ta.value = texto;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return Promise.resolve(ok);
  } catch { return Promise.resolve(false); }
}

/** Trechos entre crases viram `code` (os textos do main usam `assim` para comandos). */
function Cod({ t }: { t: string }) {
  return <>{t.split("`").map((p, i) => (i % 2 === 1 ? <code key={i}>{p}</code> : p))}</>;
}

function Requisitos({ itens }: { itens: readonly RequisitoSuite[] }) {
  return (
    <ul className="suite-requisitos" aria-label="Requisitos verificados">
      {itens.map((r) => (
        <li key={r.id} data-situacao={r.situacao}>
          <span className="suite-marca" aria-hidden="true">{MARCA_REQUISITO[r.situacao]}</span>
          <span>
            <b>{r.rotulo}</b>
            <span className="suite-sr"> — {r.situacao === "ok" ? "ok" : r.situacao === "falha" ? "falhou" : r.situacao === "pendente" ? "será verificado depois" : "informativo"}.</span>
            <span className="suite-suave"> <Cod t={r.detalhe} /></span>
            {r.situacao === "falha" && r.correcao !== null ? <span className="suite-correcao"> Como corrigir: <Cod t={r.correcao} /></span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PassoRequisitos({ plano, carregando, erro, store, ocupado }: { plano: PlanoSuite | null; carregando: boolean; erro: string | null; store: StoreSuite; ocupado: boolean }) {
  if (plano === null) {
    return (
      <>
        <div className="dialogo-corpo" role="status">{carregando ? "Verificando o projeto…" : erro ?? "Não foi possível preparar a instalação."}</div>
        <div className="dialogo-acoes"><button type="button" className="botao" data-foco-inicial onClick={() => store.fecharModal()}>Fechar</button></div>
      </>
    );
  }
  const existentes = plano.existentes.filter((e) => e.quantidade > 0);
  const bloqueios = plano.requisitos.filter((r) => r.bloqueante && r.situacao === "falha");
  return (
    <>
      <div className="dialogo-corpo suite-corpo">
        <p>
          A suíte ExpxDev é o conjunto de skills do método Expx que este app usa para planejar, corrigir e entregar trabalho. A instalação traz <b>todas</b> as {plano.skills.length}:{" "}
          {plano.skills.map((s, i) => <span key={s.nome}>{i > 0 ? ", " : ""}<code>{s.nome}</code></span>)}.
          {plano.modo === "instalar" ? " Hoje este projeto não a tem." : plano.modo === "reparar" ? " Neste projeto ela está incompleta." : " Neste projeto há uma versão mais antiga."}
        </p>
        {bloqueios.length > 0 ? (
          <div className="suite-falha" role="alert" aria-label="O que impede de instalar">
            <p><b>Antes de instalar, resolva {bloqueios.length === 1 ? "isto" : "isto"}:</b></p>
            <ul className="suite-lista">
              {bloqueios.map((r) => <li key={r.id}><b>{r.rotulo}:</b> <Cod t={r.detalhe} />{r.correcao !== null ? <> <b>Como corrigir:</b> <Cod t={r.correcao} /></> : null}</li>)}
            </ul>
          </div>
        ) : null}
        <ul className="suite-lista">
          <li><b>O que vai acontecer:</b> o app roda o instalador do método e grava as skills <b>neste projeto</b>, nas pastas {plano.pastas_gravadas.map((p, i) => <span key={p}>{i > 0 ? ", " : ""}<code>{p}</code></span>)}. Nada é commitado nem enviado.</li>
          <li><b>Precisa de internet:</b> <Cod t={plano.rede} /></li>
          <li><b>Pasta alvo:</b> <code className="suite-pasta">{plano.pasta_alvo}</code> · versão <code>{plano.versao}</code> (fixada; o app não usa “latest”).</li>
          {existentes.length > 0 ? (
            <li>
              <b>Arquivos que já existem:</b> {existentes.map((e) => `já existem ${e.quantidade} arquivo${e.quantidade === 1 ? "" : "s"} em ${e.pasta}/`).join("; ")} — serão mantidos.
              {" "}O app guarda uma cópia de segurança antes e, se o instalador alterar algum deles, avisa no final.
            </li>
          ) : null}
          {plano.efeitos_fora.map((t) => <li key={t}><b>Fora do projeto:</b> <Cod t={t} /></li>)}
        </ul>
        <h3 className="suite-subtitulo">Requisitos</h3>
        <Requisitos itens={plano.requisitos} />
        <h3 className="suite-subtitulo">Comando</h3>
        <pre className="suite-comando" tabIndex={0} aria-label="Comandos que serão executados">{plano.comando.join("\n")}</pre>
        <details className="suite-log">
          <summary>O que cada skill faz</summary>
          <ul className="suite-skills" aria-label="Skills da suíte">
            {plano.skills.map((s) => <li key={s.nome}><code>{s.nome}</code> <span className="suite-suave">{s.papel}{s.instalada ? " · já instalada" : ""}</span></li>)}
          </ul>
        </details>
        {erro !== null ? <p className="suite-erro" role="alert">{erro}</p> : null}
      </div>
      <div className="dialogo-acoes">
        <button type="button" className="botao suite-agora-nao" onClick={() => void store.dispensar(true)} title="Esconde o botão do cabeçalho neste projeto. Você pode reativar na tela Método.">Agora não</button>
        <button type="button" className="botao" data-foco-inicial onClick={() => store.fecharModal()}>Cancelar</button>
        <button type="button" className="botao botao-primario" disabled={!plano.pode_instalar || ocupado} onClick={() => void store.instalar()}>{ACAO[plano.modo]}</button>
      </div>
    </>
  );
}

function Etapas({ etapas }: { etapas: readonly EtapaSuite[] }) {
  return (
    <ol className="suite-etapas" aria-label="Etapas da instalação">
      {etapas.map((e) => (
        <li key={e.id} data-situacao={e.situacao} aria-current={e.situacao === "ativa" ? "step" : undefined}>
          <span className="suite-marca" aria-hidden="true">{MARCA_ETAPA[e.situacao]}</span>
          <span>{e.rotulo}<span className="suite-sr"> — {NOME_SITUACAO_ETAPA[e.situacao]}</span></span>
        </li>
      ))}
    </ol>
  );
}

function Log({ linhas, truncado }: { linhas: readonly string[]; truncado: boolean }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => { const el = ref.current; if (el !== null) el.scrollTop = el.scrollHeight; }, [linhas]);
  return (
    <details className="suite-log">
      <summary>Mostrar o que o instalador está fazendo</summary>
      <pre ref={ref} tabIndex={0} aria-label="Saída do instalador" aria-live="off">{truncado ? "… (início omitido)\n" : ""}{linhas.join("\n") || "(sem saída ainda)"}</pre>
    </details>
  );
}

function useCronometro(p: ProgressoSuite): number {
  const [agora, setAgora] = useState(() => Date.now());
  const rodando = p.fase === "rodando";
  useEffect(() => {
    if (!rodando) return;
    setAgora(Date.now());
    const t = setInterval(() => setAgora(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [rodando]);
  return rodando ? Math.max(0, agora - p.iniciado_em) : p.decorrido_ms;
}

function Resumo({ r }: { r: ResumoSuite }) {
  return (
    <div className="suite-resumo">
      <p><b>Versão {r.versao}</b> instalada · <b>{r.skills.length}</b> skills: {r.skills.join(", ")}.</p>
      <p>{r.criados.length}{r.truncado ? "+" : ""} arquivo(s) criados{r.alterados.length > 0 ? ` · ${r.alterados.length} já existente(s) alterado(s)` : ""}.</p>
      {r.restaurados.length > 0 ? <p className="suite-suave">O instalador troca a pasta .expx inteira; o app devolveu o que era seu: <code>{r.restaurados.join(", ")}</code>.</p> : null}
      {r.alterados.length > 0 || r.removidos.length > 0 ? (
        <div className="suite-aviso" role="note">
          {r.alterados.length > 0 ? <>O instalador alterou arquivos que já existiam: <code>{r.alterados.slice(0, 8).join(", ")}</code>{r.alterados.length > 8 ? "…" : ""}. </> : null}
          {r.removidos.length > 0 ? <>E removeu: <code>{r.removidos.slice(0, 8).join(", ")}</code>{r.removidos.length > 8 ? "…" : ""} (arquivos derivados, que o método recria). </> : null}
          {r.backup !== null ? <>A cópia de segurança do que existia antes está em <code>{r.backup}</code>. {r.como_restaurar}</> : null}
        </div>
      ) : null}
      {r.fora_do_esperado.length > 0 ? <div className="suite-aviso" role="note">Atenção: foram tocados caminhos fora das pastas esperadas: <code>{r.fora_do_esperado.slice(0, 6).join(", ")}</code>. Confira com o git.</div> : null}
      {r.doctor === "avisos" ? <p className="suite-suave">O diagnóstico do instalador (doctor) apontou avisos; veja o log. Isso não impede o uso.</p> : null}
      <details className="suite-log"><summary>Arquivos criados ({r.criados.length}{r.truncado ? "+" : ""})</summary><pre tabIndex={0} aria-label="Arquivos criados">{r.criados.join("\n") || "(nenhum)"}</pre></details>
    </div>
  );
}

function Falha({ f }: { f: FalhaSuite }) {
  return (
    <div className="suite-falha" role="alert">
      <p><b>Não foi possível concluir a instalação.</b></p>
      <p>{f.mensagem}{f.codigo !== null ? ` (código ${f.codigo})` : ""}</p>
      <p className="suite-suave">{f.sugestao}</p>
    </div>
  );
}

/** Fim da instalação: quantos módulos ficaram ligados (o legadox vem desligado de fábrica: a maioria dos projetos não é legado) e o caminho para ajustar. */
function ResumoModulos({ workspaceId, store }: { workspaceId: string; store: StoreSuite }) {
  const ui = useSuite(store);
  useEffect(() => { void store.garantirModulos(workspaceId, true); }, [store, workspaceId]);
  const e = ui.modulos[workspaceId];
  if (e === undefined) return null;
  const ligados = e.modulos.filter((m) => m.ligado).length;
  const off = e.modulos.filter((m) => !m.ligado).map((m) => m.nome);
  return (
    <p className="suite-modulos-resumo" data-ligados={ligados}>
      <b>Módulos ativados: {ligados} de {e.modulos.length}</b>
      {off.length === 0 ? "." : <> — {off.join(", ")} {off.length > 1 ? "estão desligados" : "está desligado"}{off.includes("legadox") && off.length === 1 ? " (a maioria dos projetos não é legado e não precisa dele)" : ""}.</>}
      {" "}<button type="button" className="suite-link" onClick={() => store.abrirMetodo("modulos")}>Ajustar módulos</button>
    </p>
  );
}

function PassoProgresso({ p, store, confirmando }: { p: ProgressoSuite; store: StoreSuite; confirmando: boolean }) {
  const decorrido = useCronometro(p);
  const [copiado, setCopiado] = useState<"" | "ok" | "falhou">("");
  const rodando = p.fase === "rodando";
  const anuncio = anuncioDaInstalacao(p);
  const titulo = p.fase === "concluida" ? "Pronto" : p.fase === "falhou" ? "Falhou" : p.fase === "cancelada" ? "Cancelada" : "Instalando…";
  return (
    <>
      <div className="dialogo-corpo suite-corpo">
        <div className="suite-sr" role="status" aria-live="polite">{anuncio}</div>
        <div className="suite-cabecalho-progresso">
          <b>{titulo}</b>
          <span className="suite-tempo" aria-label={`Tempo decorrido ${formatarDuracao(decorrido)}`}>{formatarDuracao(decorrido)}</span>
        </div>
        <div className="suite-barra" role="progressbar" aria-label="Progresso da instalação" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.percentual} aria-valuetext={`${p.percentual}%`} data-fase={p.fase}>
          <div className="suite-barra-preenchida" style={{ width: `${p.percentual}%` }} />
        </div>
        <Etapas etapas={p.etapas} />
        {p.fase === "concluida" && p.resumo !== null ? <Resumo r={p.resumo} /> : null}
        {p.fase === "concluida" && p.resumo !== null ? <ResumoModulos workspaceId={p.workspace_id} store={store} /> : null}
        {p.fase === "falhou" && p.falha !== null ? <Falha f={p.falha} /> : null}
        {p.fase === "cancelada" ? <div className="suite-aviso" role="note"><b>Instalação cancelada.</b> {p.limpeza}</div> : null}
        {(p.fase === "falhou" || p.fase === "cancelada") && p.situacao_projeto !== null ? <p className="suite-situacao" data-fase={p.fase}><b>Seu projeto:</b> {p.situacao_projeto}</p> : null}
        <Log linhas={p.log} truncado={p.log_truncado} />
        {copiado !== "" ? <p className="suite-suave" role="status">{copiado === "ok" ? "Diagnóstico copiado (sem segredos e com o início do caminho escondido)." : "Não foi possível copiar. Selecione o texto do log e copie manualmente."}</p> : null}
        {confirmando ? (
          <div className="suite-confirmar" role="alertdialog" aria-label="Cancelar a instalação?">
            <p><b>Cancelar a instalação?</b> O instalador será encerrado e o app desfaz com segurança o que ele já tinha criado neste projeto (os arquivos que já existiam são preservados).</p>
            <div className="suite-confirmar-acoes">
              <button type="button" className="botao" data-foco-inicial onClick={() => store.desistirCancelar()}>Continuar instalando</button>
              <button type="button" className="botao botao-perigo" onClick={() => void store.cancelar()}>Cancelar instalação</button>
            </div>
          </div>
        ) : null}
      </div>
      <div className="dialogo-acoes">
        {rodando && !confirmando ? <button type="button" className="botao" data-foco-inicial onClick={() => store.pedirCancelar()}>Cancelar</button> : null}
        {p.fase === "concluida" ? <><button type="button" className="botao" onClick={() => store.fecharModal()}>Fechar</button><button type="button" className="botao botao-primario" data-foco-inicial onClick={() => store.abrirMetodo()}>Abrir o Método</button></> : null}
        {p.fase === "falhou" || p.fase === "cancelada" ? (
          <>
            {p.diagnostico !== null ? <button type="button" className="botao" onClick={() => void copiarTexto(p.diagnostico ?? "").then((ok) => setCopiado(ok ? "ok" : "falhou"))}><Icone nome="copiar" /> Copiar diagnóstico</button> : null}
            <button type="button" className="botao" onClick={() => store.fecharModal()}>Fechar</button>
            <button type="button" className="botao botao-primario" data-foco-inicial onClick={() => store.tentarDeNovo()}>Tentar de novo</button>
          </>
        ) : null}
      </div>
    </>
  );
}

/**
 * Modal "Instalar a suíte ExpxDev": passo 1 (o que vai acontecer, comando exato, pasta, requisitos) → progresso (etapas, barra, log recolhível, tempo,
 * cancelar) → sucesso (resumo) ou falha (causa simples, tentar de novo, copiar diagnóstico). Diálogo ARIA com foco preso e retorno de foco (`Dialogo`);
 * Esc fecha fora da instalação e, durante ela, pergunta se quer cancelar.
 */
export default function ModalSuite({ store }: { store: StoreSuite }) {
  const ui = useSuite(store);
  const wsId = ui.workspaceId;
  const instalando = ui.progresso?.fase === "rodando" || (wsId !== null && ui.estados[wsId]?.instalando === true);
  const aoFechar = (): void => { if (ui.confirmandoCancelar) store.desistirCancelar(); else if (instalando) store.pedirCancelar(); else store.fecharModal(); };
  // os botões mudam a cada fase: o foco acompanha (nunca fica no botão que sumiu)
  const chaveFoco = `${ui.progresso?.fase ?? "-"}|${ui.confirmandoCancelar}|${ui.plano !== null}`;
  useEffect(() => { document.querySelector<HTMLElement>(".dialogo [data-foco-inicial]")?.focus(); }, [chaveFoco]);
  const modo = ui.progresso?.modo ?? ui.plano?.modo ?? "instalar";
  return (
    <Dialogo titulo={TITULO[modo]} aoFechar={aoFechar} largura={640}>
      {ui.progresso !== null ? (
        <PassoProgresso p={ui.progresso} store={store} confirmando={ui.confirmandoCancelar} />
      ) : instalando ? (
        <>
          <div className="dialogo-corpo" role="status">Há uma instalação em andamento neste projeto. Aguardando o progresso…</div>
          <div className="dialogo-acoes"><button type="button" className="botao" data-foco-inicial onClick={() => store.pedirCancelar()}>Cancelar instalação</button></div>
        </>
      ) : (
        <PassoRequisitos plano={ui.plano} carregando={ui.carregandoPlano} erro={ui.erro} store={store} ocupado={ui.ocupado} />
      )}
    </Dialogo>
  );
}

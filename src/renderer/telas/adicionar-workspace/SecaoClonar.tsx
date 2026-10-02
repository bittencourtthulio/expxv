import { useEffect, useMemo, useRef } from "react";
import type { ErroAdicionar, EventoClone, FaseClone, RepoRemoto } from "../../../compartilhado/workspaces-adicionar";
import { formatarBytes, formatarVelocidade } from "../../../nucleo/workspaces/adicionar/progresso";
import { Icone } from "../../componentes/Icone";
import { podeClonar, type EstadoAdicionarUI, type StoreAdicionar } from "../../estado/adicionar-workspace";
import { abrirTerminalDeLogin } from "../../estado/adicionar-login";
import { AvisoDestino, CampoDestino } from "./CampoDestino";

export const ROTULO_FASE: Record<FaseClone, string> = {
  preparando: "Preparando", conectando: "Conectando ao repositório", contando: "Contando objetos", comprimindo: "Comprimindo objetos", recebendo: "Recebendo objetos",
  resolvendo: "Resolvendo deltas", extraindo: "Extraindo arquivos", submodulos: "Baixando submódulos", concluido: "Concluído", falhou: "Falhou", cancelado: "Cancelado",
};
const NOME_PROVEDOR = { github: "GitHub", gitlab: "GitLab", bitbucket: "Bitbucket", azure: "Azure DevOps", outro: "outro servidor git", local: "pasta local" } as const;

/** Texto lido pelo leitor de tela: muda só na troca de fase e a cada 25 % (nunca a cada atualização). */
export function anuncioDoClone(e: EventoClone | null): string {
  if (e === null) return "";
  if (e.fase === "concluido") return "Clone concluído.";
  if (e.fase === "falhou") return `O clone falhou: ${e.erro?.mensagem ?? e.mensagem}`;
  if (e.fase === "cancelado") return "Clone cancelado.";
  const marco = e.percentual === null ? "" : ` ${Math.floor(e.percentual / 25) * 25} por cento`;
  return `${ROTULO_FASE[e.fase]}${marco}.`;
}

export function tempoRelativo(iso: string | null, agora: number = Date.now()): string {
  if (iso === null) return "";
  const dias = Math.floor((agora - Date.parse(iso)) / 86_400_000);
  if (!Number.isFinite(dias)) return "";
  if (dias < 1) return "hoje";
  if (dias === 1) return "ontem";
  if (dias < 30) return `há ${dias} dias`;
  if (dias < 365) return `há ${Math.floor(dias / 30)} ${Math.floor(dias / 30) === 1 ? "mês" : "meses"}`;
  return `há ${Math.floor(dias / 365)} ${Math.floor(dias / 365) === 1 ? "ano" : "anos"}`;
}

/** Trechos entre crases viram `code`. */
function Cod({ t }: { t: string }) {
  return <>{t.split("`").map((p, i) => (i % 2 === 1 ? <code key={i}>{p}</code> : p))}</>;
}

function ErroClone({ erro, store, aoLogin }: { erro: ErroAdicionar; store: StoreAdicionar; aoLogin: () => void }) {
  return (
    <div className="aw-erro" role="alert">
      <p><Cod t={erro.mensagem} /></p>
      {erro.acao === "login_gh" ? (
        <>
          <div className="aw-acoes"><button type="button" className="botao" onClick={aoLogin}>Abrir terminal para <code>gh auth login</code></button></div>
          <p className="aw-nota">O app só digita o comando no terminal: o login é seu (nome de usuário, navegador, código). Nunca pedimos senha nem token.</p>
        </>
      ) : null}
      {erro.acao === "escolher_outro_nome" && erro.sugestao !== null ? <div className="aw-acoes"><button type="button" className="botao" onClick={() => { store.reiniciarClone(); store.usarSugestao(); }}>Usar “{erro.sugestao}”</button></div> : null}
    </div>
  );
}

function MeusRepositorios({ store, ui, aoLogin }: { store: StoreAdicionar; ui: EstadoAdicionarUI; aoLogin: () => void }) {
  const { gh, repos } = ui;
  const filtrados = useMemo<RepoRemoto[]>(() => {
    const f = repos.filtro.trim().toLowerCase();
    return f === "" ? [...repos.lista] : repos.lista.filter((r) => `${r.nome_com_dono} ${r.descricao}`.toLowerCase().includes(f));
  }, [repos.lista, repos.filtro]);
  if (gh === null) return null;
  return (
    <div className="aw-bloco">
      <h4 id="aw-meus-titulo">Meus repositórios</h4>
      {!gh.instalado ? (
        <p className="aw-nota">Para listar seus repositórios aqui, instale a CLI do GitHub (<code>gh</code>, em cli.github.com). Sem ela, cole a URL acima.</p>
      ) : !gh.autenticado ? (
        <>
          <p className="aw-nota">A CLI <code>gh</code> está instalada, mas ainda não está autenticada. O login é feito por você, no terminal.</p>
          <div className="aw-acoes"><button type="button" className="botao" onClick={aoLogin}>Abrir terminal para <code>gh auth login</code></button></div>
        </>
      ) : repos.fase === "ocioso" ? (
        <div className="aw-linha-acao">
          <p className="aw-nota">Consulta o GitHub (usa a internet) como <strong>{gh.usuario ?? "sua conta"}</strong>, pela CLI <code>gh</code>. Só roda quando você clica.</p>
          <button type="button" className="botao" onClick={() => void store.carregarRepos()}>Carregar meus repositórios</button>
        </div>
      ) : repos.fase === "carregando" ? (
        <p className="aw-nota" role="status" aria-busy="true">Carregando seus repositórios…</p>
      ) : repos.fase === "erro" && repos.erro !== null ? (
        <>
          <ErroClone erro={repos.erro} store={store} aoLogin={aoLogin} />
          <div className="aw-acoes"><button type="button" className="botao" onClick={() => void store.carregarRepos()}>Tentar de novo</button></div>
        </>
      ) : (
        <>
          <label className="campo">
            <span className="aw-sr">Filtrar meus repositórios</span>
            <input type="search" value={repos.filtro} placeholder="Filtrar por nome ou descrição" autoComplete="off" spellCheck={false} onChange={(e) => store.filtrarRepos(e.target.value)} />
          </label>
          {filtrados.length === 0 ? (
            <div className="aw-vazio"><p>{repos.lista.length === 0 ? "Nenhum repositório na sua conta." : `Nenhum repositório combina com “${repos.filtro}”.`}</p></div>
          ) : (
            <ul className="aw-lista" data-rolavel aria-labelledby="aw-meus-titulo">
              {filtrados.map((r) => (
                <li key={r.nome_com_dono}>
                  <button type="button" className="aw-item" onClick={() => store.escolherRepo(r)} aria-label={`${r.nome_com_dono}${r.privado ? ", privado" : ""}${r.descricao !== "" ? `, ${r.descricao}` : ""}`}>
                    <span className="aw-item-texto"><span className="aw-item-nome">{r.nome_com_dono}</span><span className="aw-item-sub">{r.descricao !== "" ? r.descricao : "Sem descrição"}{r.atualizado_em !== null ? ` · ${tempoRelativo(r.atualizado_em)}` : ""}</span></span>
                    {r.privado ? <span className="badge" data-tom="aviso">Privado</span> : null}
                    <span className="aw-item-acao">Usar</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {repos.truncado ? <p className="aw-nota">Mostrando os 100 mais recentes. Para um mais antigo, cole a URL.</p> : null}
        </>
      )}
    </div>
  );
}

function Progresso({ ui, aoCancelarPedido }: { ui: EstadoAdicionarUI; aoCancelarPedido: () => void }) {
  const e = ui.clone.evento;
  const pct = e?.percentual ?? null;
  const fase = e === null ? "Preparando" : ROTULO_FASE[e.fase];
  const detalhe = [e?.bytes != null ? formatarBytes(e.bytes) : "", e?.velocidade_bps != null ? formatarVelocidade(e.velocidade_bps) : ""].filter((x) => x !== "").join(" · ");
  const origem = ui.clonar.origem?.ok === true ? ui.clonar.origem.origem : null;
  return (
    <section className="aw-secao" aria-labelledby="aw-clonando-titulo">
      <div className="aw-cabeca">
        <h3 id="aw-clonando-titulo">Clonando {origem?.exibicao ?? "repositório"}…</h3>
        <p>Destino: <span className="aw-mono">{e?.destino_exibicao ?? ui.clone.evento?.destino_exibicao ?? ""}</span></p>
      </div>
      <div className="aw-progresso">
        <div className="aw-progresso-linha"><span>{fase}</span><span>{pct === null ? "" : `${pct}%`}</span></div>
        <div className="aw-barra" role="progressbar" aria-label={`Progresso do clone: ${fase}`} aria-valuemin={0} aria-valuemax={100} {...(pct === null ? { "aria-busy": true as const, "data-indeterminada": "" } : { "aria-valuenow": pct })} style={pct === null ? undefined : ({ ["--aw-pct" as string]: `${pct}%` })}><i /></div>
        <div className="aw-progresso-linha"><span>{detalhe}</span><span /></div>
      </div>
      <div className="aw-sr" role="status" aria-live="polite">{anuncioDoClone(e)}</div>
      <div className="aw-acoes"><button type="button" className="botao" data-foco-inicial onClick={aoCancelarPedido}>Cancelar clone</button></div>
      <p className="aw-nota">Cancelar interrompe o download e apaga só a pasta parcial que o app criou.</p>
    </section>
  );
}

/** Clonar repositório: URL → o que salvar → consentimento → progresso ao vivo → pronto. */
export function SecaoClonar({ store, ui, aoCancelarClone, aoFechar }: { store: StoreAdicionar; ui: EstadoAdicionarUI; aoCancelarClone: () => void; aoFechar: () => void }) {
  const c = ui.clonar;
  const o = c.origem;
  const origem = o?.ok === true ? o.origem : null;
  const bloqueado = ui.clone.fase !== "ocioso";
  const refClonar = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (c.consentindo) refClonar.current?.focus(); }, [c.consentindo]);

  if (ui.clone.fase === "iniciando" || ui.clone.fase === "clonando") return <Progresso ui={ui} aoCancelarPedido={aoCancelarClone} />;

  if (ui.clone.fase === "pronto") {
    const ws = ui.clone.workspace;
    return (
      <section className="aw-secao" aria-labelledby="aw-pronto-titulo">
        <div className="aw-pronto">
          <h3 id="aw-pronto-titulo"><Icone nome="estrela" /> Pronto</h3>
          <p>O repositório está em <span className="aw-mono">{ui.clone.evento?.destino_exibicao ?? ws?.nome ?? ""}</span> e já é o workspace atual.</p>
          <p className="aw-nota">Nada do repositório foi executado. O projeto fica como <strong>não confiável</strong> para execução (hooks, scripts, “Executar”) até você confiar nele.</p>
          <div className="aw-acoes">
            <button type="button" className="botao botao-primario" data-foco-inicial onClick={aoFechar}>Abrir</button>
            {ui.clone.suiteFalta ? <button type="button" className="botao" onClick={() => store.instalarSuiteDoClone()}>Instalar suíte ExpxDev</button> : null}
          </div>
        </div>
      </section>
    );
  }

  if (ui.clone.fase === "cancelado") {
    return (
      <section className="aw-secao" aria-labelledby="aw-cancel-titulo">
        <div className="aw-cabeca"><h3 id="aw-cancel-titulo">Clone cancelado</h3><p>O download foi interrompido e a pasta parcial foi apagada.</p></div>
        <div className="aw-acoes"><button type="button" className="botao botao-primario" data-foco-inicial onClick={() => store.reiniciarClone()}>Voltar</button></div>
      </section>
    );
  }

  const formularioPronto = podeClonar(c, ui.destino);
  return (
    <section className="aw-secao" aria-labelledby="aw-clonar-titulo">
      <div className="aw-cabeca">
        <h3 id="aw-clonar-titulo">Clonar repositório</h3>
        <p>Traz uma cópia do repositório para o seu computador. Nada é baixado antes de você confirmar.</p>
      </div>

      {ui.clone.fase === "erro" && ui.clone.erro !== null ? <ErroClone erro={ui.clone.erro} store={store} aoLogin={abrirTerminalDeLogin} /> : null}

      <div className="aw-bloco">
        <label className="campo">
          URL ou identificador
          <input
            type="text" value={c.entrada} data-foco-inicial placeholder="https://github.com/dono/repo  ·  git@github.com:dono/repo.git  ·  dono/repo"
            autoComplete="off" spellCheck={false} aria-invalid={o !== null && !o.ok ? "true" : undefined} aria-describedby="aw-origem-info"
            onChange={(e) => store.definirClonar({ entrada: e.target.value })}
          />
        </label>
        <div id="aw-origem-info" aria-live="polite">
          {o !== null && !o.ok ? <p className="campo-erro">{o.motivo}</p> : null}
          {origem !== null ? <p className="aw-nota"><span className="badge" data-tom="destaque">{NOME_PROVEDOR[origem.provedor]}</span> <span className="aw-mono">{origem.exibicao}</span></p> : null}
        </div>
        <details>
          <summary className="aw-nota">Origem em pasta local do computador</summary>
          <div className="aw-bloco">
            <label className="aw-marca"><input type="checkbox" checked={c.permitirLocal} onChange={(e) => store.definirClonar({ permitirLocal: e.target.checked })} /><span>Permitir caminho local<small>Aceita um caminho absoluto ou <code>file:///</code> no campo acima. Fora isso, só https e ssh.</small></span></label>
            {c.permitirLocal ? <label className="aw-marca"><input type="checkbox" checked={c.localConfirmado} onChange={(e) => store.definirClonar({ localConfirmado: e.target.checked })} /><span>Confirmo que esta pasta é um repositório meu e de confiança</span></label> : null}
          </div>
        </details>
      </div>

      <MeusRepositorios store={store} ui={ui} aoLogin={abrirTerminalDeLogin} />

      <div className="aw-bloco">
        <h4>O que salvar (pasta de destino, nome e opções)</h4>
        <CampoDestino destino={ui.destino} erro={ui.erroDestino} aoEscolher={(l) => void store.escolherDestino(l)} desabilitado={bloqueado} titulo={false} />
        <div className="aw-linha-campos">
          <label className="campo">
            Nome da pasta
            <input type="text" value={c.nome} autoComplete="off" spellCheck={false} aria-invalid={c.erroNome !== null ? "true" : undefined} onChange={(e) => store.definirClonar({ nome: e.target.value })} />
          </label>
          <label className="campo">
            Branch (opcional)
            <input type="text" value={c.branch} placeholder="a padrão do repositório" autoComplete="off" spellCheck={false} aria-invalid={c.erroBranch !== null ? "true" : undefined} onChange={(e) => store.definirClonar({ branch: e.target.value })} />
          </label>
        </div>
        {c.erroNome !== null ? <p role="alert" className="campo-erro">{c.erroNome}</p> : null}
        {c.erroBranch !== null ? <p role="alert" className="campo-erro">{c.erroBranch}</p> : null}
        <AvisoDestino a={c.avaliacao} nome={c.nome} aoUsarSugestao={() => store.usarSugestao()} aoAbrirExistente={() => void store.abrirExistente("clonar")} />
        <fieldset className="aw-opcoes">
          <legend>Histórico</legend>
          <label className="aw-marca"><input type="radio" name="aw-raso" checked={!c.raso} onChange={() => store.definirClonar({ raso: false })} /><span>Completo<small>Todo o histórico. O padrão.</small></span></label>
          <label className="aw-marca"><input type="radio" name="aw-raso" checked={c.raso} onChange={() => store.definirClonar({ raso: true })} /><span>Raso (rápido, <code>--depth 1</code>)<small>Só o último commit. Bom para repositórios grandes.</small></span></label>
        </fieldset>
        <label className="aw-marca"><input type="checkbox" checked={c.submodulos} disabled={c.permitirLocal && c.localConfirmado} onChange={(e) => store.definirClonar({ submodulos: e.target.checked })} /><span>Incluir submódulos<small>Desligado por padrão: baixa também os repositórios que este referencia.</small></span></label>
      </div>

      {c.consentindo && origem !== null ? (
        <div className="aw-consentimento" role="group" aria-labelledby="aw-consent-titulo">
          <h4 id="aw-consent-titulo">Isto baixa o repositório para o seu computador</h4>
          <dl className="aw-resumo">
            <dt>Servidor</dt><dd>{origem.tipo === "local" ? "pasta local" : origem.host}</dd>
            <dt>Repositório</dt><dd>{origem.exibicao}</dd>
            <dt>Destino exato</dt><dd className="aw-mono">{c.avaliacao?.caminho_exibicao ?? ""}</dd>
            <dt>Opções</dt><dd>{c.raso ? "raso (último commit)" : "histórico completo"}{c.branch.trim() !== "" ? ` · branch ${c.branch.trim()}` : ""}{c.submodulos ? " · com submódulos" : ""}</dd>
          </dl>
          <p className="aw-nota">Nada do repositório é executado. Chaves e credenciais são as da sua máquina (<code>gh</code>, ssh ou o credential helper do git); o app não guarda nenhuma.</p>
          <div className="aw-acoes">
            <button ref={refClonar} type="button" className="botao botao-primario" onClick={() => void store.clonarAgora()}>Clonar</button>
            <button type="button" className="botao" onClick={() => store.cancelarConsentimento()}>Voltar</button>
          </div>
        </div>
      ) : (
        <div className="aw-rodape">
          <span className="aw-rodape-dica">{formularioPronto ? "Revise e confirme na próxima etapa." : c.avaliacao?.situacao === "ocupado" ? "Já existe uma pasta com esse nome: escolha outro nome ou abra a existente." : "Informe a URL e confira o destino."}</span>
          <button type="button" className="botao botao-primario" disabled={!formularioPronto} onClick={() => store.pedirConsentimento()}>Revisar e clonar…</button>
        </div>
      )}
    </section>
  );
}

// T-16.31 · Seletor de rigidez no TOPO de todas as páginas: slider de 5 passos (role="slider"), rótulo + badge N<n>, popover com escopo,
// descrição ligado/desligado, trava e hooks. Cor nunca é o único sinal (número + nome). Re-renderiza sozinho (store próprio, Topo é memo).
import { memo, useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import type { EscopoRigidez, NivelRigidez } from "../../compartilhado/maestro";
import { Dialogo } from "../componentes/Dialogo";
import { storeMaestro } from "../estado/maestro";
import { storeRigidez, useRigidez, type StoreRigidez } from "../estado/rigidez";
import { storeWorkspaces } from "../estado/workspaces";
import { FRASE_CONFIRMACAO, JUSTIFICATIVA_MIN, NIVEIS, NIVEL_PADRAO, NOMES_NIVEL, fraseValida, justificativaValida, nivelPorTecla, valorTexto } from "../telas/pipelines/logica";
import "./rigidez.css";

export const ATRASO_COMMIT_MS = 300;

interface Props {
  store?: StoreRigidez;
  /** testes: id do workspace fixo (senão segue o workspace atual). */
  workspaceId?: string | null;
  /** Missão do Pane em foco, quando houver. */
  missionId?: string | null;
}

function useWorkspaceAtual(): string | null {
  return useSyncExternalStore(storeWorkspaces.assinar, () => storeWorkspaces.obter().atual?.id ?? null);
}

export const SeletorRigidez = memo(function SeletorRigidez({ store = storeRigidez, workspaceId, missionId = null }: Props) {
  const wsAtual = useWorkspaceAtual();
  const ws = workspaceId === undefined ? wsAtual : workspaceId;
  const s = useRigidez(store);
  const [aberto, setAberto] = useState(false);
  const [local, setLocal] = useState<NivelRigidez | null>(null);
  const [escopo, setEscopo] = useState<EscopoRigidez>("workspace");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const idPopover = useId();

  useEffect(() => { void store.definirContexto(ws, missionId); }, [store, ws, missionId]);
  // pedido externo ("Ativar proteções" na tela Método): abre os detalhes, onde estão a prévia dos hooks e a confirmação; só reage a pedidos NOVOS
  const vistos = useRef(s.pedidoAbrir);
  useEffect(() => {
    if (s.pedidoAbrir === vistos.current) return;
    vistos.current = s.pedidoAbrir;
    if (ws !== null && s.disponivel) setAberto(true);
  }, [s.pedidoAbrir, ws, s.disponivel]);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
  // o nível do servidor manda quando chega (evento externo, voltar ao padrão); a escolha local vale só até o commit
  useEffect(() => { setLocal(null); }, [s.estado?.efetivo]);

  const nivel: NivelRigidez = local ?? s.estado?.efetivo ?? NIVEL_PADRAO;
  const nome = s.matriz?.niveis.find((n) => n.nivel === nivel)?.nome ?? NOMES_NIVEL[nivel];
  const desabilitado = ws === null || !s.disponivel;

  const confirmar = useCallback((n: NivelRigidez) => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void store.definir(n, { escopo }); }, ATRASO_COMMIT_MS);
  }, [store, escopo]);
  const escolher = useCallback((n: NivelRigidez) => { setLocal(n); confirmar(n); }, [confirmar]);

  const aoTeclar = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (desabilitado) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setAberto((a) => !a); return; }
    if (e.key === "Escape" && aberto) { setAberto(false); return; }
    const n = nivelPorTecla(e.key, nivel);
    if (n === null) return;
    e.preventDefault();
    if (n !== nivel) escolher(n);
  };
  // fechar ao sair do foco/clicar fora
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent): void => { if (raiz.current !== null && !raiz.current.contains(e.target as Node) && document.querySelector('[role="dialog"][aria-modal="true"]') === null) setAberto(false); };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  if (!s.disponivel && s.estado === null && ws !== null) return null; // fora do aplicativo: sem canal, sem seletor

  return (
    <div className="rig" ref={raiz} data-nivel={nivel}>
      <div
        className="rig-slider"
        role="slider"
        tabIndex={desabilitado ? -1 : 0}
        aria-label="Rigidez do método"
        aria-valuemin={1}
        aria-valuemax={5}
        aria-valuenow={nivel}
        aria-valuetext={valorTexto(nivel, nome)}
        aria-disabled={desabilitado || undefined}
        aria-orientation="horizontal"
        title={`Rigidez do método: ${valorTexto(nivel, nome)}. Setas mudam, Enter abre os detalhes.`}
        onKeyDown={aoTeclar}
      >
        <span className="rig-fio" aria-hidden="true" />
        {NIVEIS.map((n) => (
          <span key={n} className="rig-ponto" data-ativo={n <= nivel || undefined} data-atual={n === nivel || undefined} aria-hidden="true" onClick={() => { if (!desabilitado) escolher(n); }} />
        ))}
      </div>
      <button type="button" className="rig-rotulo" aria-haspopup="dialog" aria-expanded={aberto} aria-controls={aberto ? idPopover : undefined} disabled={desabilitado} onClick={() => setAberto((a) => !a)}>
        <span>{nome}</span>
        <span className="rig-badge">N{nivel}</span>
      </button>
      <span className="rig-sr" role="status" aria-live="polite">{s.ocupado ? "Aplicando rigidez…" : ""}</span>
      {aberto ? <PopoverRigidez id={idPopover} store={store} nivel={nivel} escopo={escopo} aoEscopo={setEscopo} aoFechar={() => { setAberto(false); (raiz.current?.querySelector(".rig-slider") as HTMLElement | null)?.focus(); }} missionId={missionId} /> : null}
      {s.pendente !== null ? <DialogoDeExigencia store={store} /> : null}
      {s.erro !== null ? <span className="rig-erro" role="alert" title={s.erro}>Rigidez: erro</span> : null}
    </div>
  );
});

function PopoverRigidez({ id, store, nivel, escopo, aoEscopo, aoFechar, missionId }: { id: string; store: StoreRigidez; nivel: NivelRigidez; escopo: EscopoRigidez; aoEscopo: (e: EscopoRigidez) => void; aoFechar: () => void; missionId: string | null }) {
  const s = useRigidez(store);
  const plano = useSyncExternalStore(storeMaestro.assinar, () => storeMaestro.obter().plano?.plano.id ?? null);
  const [voltar, setVoltar] = useState(false);
  const [hooksJa, setHooksJa] = useState(false);
  useEffect(() => { void store.carregarMatriz(); void store.carregarHooks(); }, [store]);
  const desc = s.matriz?.niveis.find((n) => n.nivel === nivel);
  const e = s.estado;
  const efetivoEscopo: EscopoRigidez = escopo === "missao" && missionId === null ? "workspace" : escopo === "pedido" && plano === null ? "workspace" : escopo;
  return (
    <div className="rig-popover" id={id} role="group" aria-label="Detalhes da rigidez" onKeyDown={(ev) => { if (ev.key === "Escape") { ev.stopPropagation(); aoFechar(); } }}>
      <p className="rig-titulo"><strong>{desc?.nome ?? NOMES_NIVEL[nivel]}</strong> · nível {nivel} de 5</p>
      {desc !== undefined ? (
        <>
          <p className="rig-texto">{desc.semantica}</p>
          <p className="rig-texto"><strong>Ligado:</strong> {desc.ligado}</p>
          <p className="rig-texto"><strong>Desligado:</strong> {desc.desligado}</p>
        </>
      ) : <p className="rig-texto" aria-busy="true">Carregando descrição…</p>}
      {e !== null && e.minimo_travado > 1 ? <p className="rig-aviso" role="note">Nível mínimo travado: {e.minimo_travado}{e.motivo_trava !== null ? ` — ${e.motivo_trava}` : ""}. Abaixo disso é preciso justificar (mín. {JUSTIFICATIVA_MIN} caracteres).</p> : null}
      {e?.lembrete != null ? <p className="rig-aviso" role="note">{e.lembrete}</p> : null}
      <fieldset className="rig-escopo">
        <legend>Vale para</legend>
        {([["workspace", "Workspace", true], ["missao", "Esta Missão", missionId !== null], ["pedido", "Só este pedido", plano !== null]] as const).map(([v, r, ok]) => (
          <label key={v} className={ok ? "" : "rig-desab"} title={ok ? undefined : v === "missao" ? "Nenhuma Missão em foco" : "Disponível ao propor um plano no Maestro"}>
            <input type="radio" name={`${id}-escopo`} value={v} checked={efetivoEscopo === v} disabled={!ok} onChange={() => aoEscopo(v)} /> {r}
          </label>
        ))}
      </fieldset>
      <label className="rig-linha"><input type="checkbox" checked={voltar} onChange={(ev) => setVoltar(ev.target.checked)} /> Voltar ao padrão ao fim</label>
      <label className="rig-linha"><input type="checkbox" checked={hooksJa} onChange={(ev) => setHooksJa(ev.target.checked)} /> Aplicar os hooks já na etapa em andamento</label>
      <div className="rig-hooks" aria-label="Prévia dos hooks">
        {s.hooks === null ? <span>Lendo hooks…</span> : !s.hooks.metodo_instalado ? <span>Método não instalado neste diretório: nenhum arquivo será escrito.</span> : s.hooks.invalido ? <span className="rig-aviso">O arquivo de hooks está inválido: nada será gravado até você corrigi-lo.</span> : (
          <span>{s.hooks.gerenciadas.length > 0 ? `${s.hooks.gerenciadas.length} hook(s) gerenciado(s) pelo app no nível ${s.hooks.nivel_aplicado ?? "?"}.` : "Nenhum hook gerenciado pelo app (nível Padrão volta ao padrão do método)."}</span>
        )}
        {s.hooks !== null && s.hooks.gerenciadas.length > 0 ? <button type="button" className="rig-botao" onClick={() => void store.reverterHooks()}>Reverter os que o app escreveu</button> : null}
      </div>
      <div className="rig-acoes">
        <button type="button" className="rig-botao rig-primario" disabled={s.ocupado} onClick={() => void store.definir(nivel, { escopo: efetivoEscopo, voltarAoPadrao: voltar || efetivoEscopo === "pedido", aplicarHooksJa: hooksJa, planoId: efetivoEscopo === "pedido" ? plano : null })}>Aplicar neste escopo</button>
        <button type="button" className="rig-botao" onClick={aoFechar}>Fechar</button>
      </div>
    </div>
  );
}

function DialogoDeExigencia({ store }: { store: StoreRigidez }) {
  const s = useRigidez(store);
  const p = s.pendente;
  const [texto, setTexto] = useState("");
  useEffect(() => { setTexto(""); }, [p?.exigencia.tipo]);
  if (p === null) return null;
  const confirmacao = p.exigencia.tipo === "confirmacao";
  const valido = confirmacao ? fraseValida(texto) : justificativaValida(texto);
  const enviar = (): void => {
    if (!valido) return;
    void store.definir(p.nivel, confirmacao ? { confirmacaoDigitada: texto.trim().toLowerCase() } : { justificativa: texto.trim() });
  };
  return (
    <Dialogo titulo={confirmacao ? "Confirmar rigidez baixa" : "Justificar nível abaixo do mínimo"} aoFechar={() => store.descartarPendente()} largura={440}>
      <p>{p.exigencia.mensagem}</p>
      {confirmacao ? (
        <label className="rig-campo">Digite <strong>{FRASE_CONFIRMACAO}</strong> para confirmar
          <input data-foco-inicial value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") enviar(); }} autoComplete="off" />
        </label>
      ) : (
        <label className="rig-campo">Justificativa (mín. {JUSTIFICATIVA_MIN} caracteres, fica registrada)
          <textarea data-foco-inicial rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} />
          <span className="rig-contador" aria-live="polite">{texto.trim().length}/{JUSTIFICATIVA_MIN}</span>
        </label>
      )}
      <div className="rig-acoes">
        <button type="button" className="rig-botao" onClick={() => store.descartarPendente()}>Cancelar</button>
        <button type="button" className="rig-botao rig-primario" disabled={!valido || s.ocupado} onClick={enviar}>Confirmar</button>
      </div>
    </Dialogo>
  );
}

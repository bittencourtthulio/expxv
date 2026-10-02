// Editor da squad (T-14.20): cabeçalho (nome, escopo, rigidez, paralelas, cadeado), tabela de membros em linhas de 24 px, validação
// ao vivo com resumo, e as ações da squad. Fábrica = somente leitura (só duplica). O prompt de cada membro vive no drawer.
import { useEffect, useMemo, useState } from "react";
import type { ApiAde } from "../../../compartilhado/ipc";
import type { Achado, Membro, NivelRigidez, OpcoesPerfilCli, PapelSquad, PermissaoMembro, SquadResumo } from "../../../compartilhado/squads";
import { CLIS_CATALOGO, CLI_AUTO, ESCOPOS_SQUAD, LIMITES_SQUAD, NIVEIS_RIGIDEZ } from "../../../compartilhado/squads";
import { Badge } from "../../componentes/Badge";
import { DialogoConfirmacao } from "../../componentes/Dialogo";
import { Icone } from "../../componentes/Icone";
import type { StoreSquads } from "../../estado/squads";
import { LinhaMembro } from "./Membro";
import { DialogoApagar, DialogoAtualizacaoFabrica, DialogoExportar } from "./Portabilidade";
import { SkillsDoMembro } from "./Skills";
import { achadosDoMembro, aplicarCadeado, descreverPapel, duplicarMembro, indiceDoAchado, mudarMembro, mudarPerfil, novoMembro, removerMembro, resumoDeAchados, temErro } from "./rascunho";
import type { RascunhoSquad } from "./useRascunho";

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const PAPEIS_NOVOS: readonly PapelSquad[] = ["executor", "scout", "reviewer"];

export interface PropsEditor {
  r: RascunhoSquad;
  store: StoreSquads;
  agentes: ApiAde["agentes"] | undefined;
  squads: ApiAde["squads"] | undefined;
  resumo: SquadResumo | null;
  workspaceId: string | null;
  permissaoWorkspace: PermissaoMembro | null;
  aoAbrirPrompt: (m: Membro) => void;
  aoApagada: () => void;
  aoNotificar: (texto: string) => void;
}

export function EditorSquad({ r, store, agentes, squads, resumo, workspaceId, permissaoWorkspace, aoAbrirPrompt, aoApagada, aoNotificar }: PropsEditor) {
  const { rascunho: s, achados, editavel } = r;
  const [opcoes, setOpcoes] = useState<Record<string, OpcoesPerfilCli>>({});
  const [avisosCadeado, setAvisosCadeado] = useState<Array<{ membro: string; mensagem: string }>>([]);
  const [skillsDe, setSkillsDe] = useState<string | null>(null);
  const [exportar, setExportar] = useState(false);
  const [apagar, setApagar] = useState(false);
  const [atualizar, setAtualizar] = useState(false);
  const [restaurar, setRestaurar] = useState(false);
  const [duplicando, setDuplicando] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [novoPapel, setNovoPapel] = useState<PapelSquad>("executor");

  // opções (modelos, esforço, modo) das CLIs em uso: em ocioso, uma vez por CLI
  const clisEmUso = useMemo(() => [...new Set((s?.membros ?? []).map((m) => m.perfil.cli))].filter((c) => c !== CLI_AUTO).sort(), [s]);
  useEffect(() => {
    let vivo = true;
    for (const cli of clisEmUso) {
      if (opcoes[cli] !== undefined) continue;
      store.opcoes(cli).then((o) => { if (vivo) setOpcoes((x) => (x[cli] === undefined ? { ...x, [cli]: o } : x)); }).catch(() => undefined);
    }
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clisEmUso.join("|"), store]);

  if (s === null) return null;
  const resumoAchados = resumoDeAchados(achados);
  const gerais = achados.filter((a) => indiceDoAchado(a) === null);
  const falhou = async (f: () => Promise<void>): Promise<void> => {
    setErroAcao(null);
    try { await f(); } catch (e) { setErroAcao(msg(e)); }
  };

  const cadeado = async (cli: string): Promise<void> => {
    if (cli === "") return;
    let modelos: string[] = [];
    try { modelos = (opcoes[cli] ?? (await store.opcoes(cli))).modelos.map((m) => m.modelo); } catch { /* sem lista: tudo vira default */ }
    const r2 = aplicarCadeado(s, cli, modelos);
    r.editar(() => r2.squad);
    setAvisosCadeado(r2.avisos);
  };

  const duplicarSquad = (): Promise<void> => falhou(async () => {
    setDuplicando(true);
    try { const c = await store.duplicar({ slug: s.slug }); aoNotificar(`Cópia criada: ${c.nome}`); } finally { setDuplicando(false); }
  });
  const restaurarFabrica = (): Promise<void> => falhou(async () => {
    setRestaurar(false);
    if (agentes === undefined) return;
    let n = 0;
    for (const m of s.membros) {
      const id = `${s.slug}.${m.slug}`;
      if ((await agentes.lerPrompt(id)).editado) { await agentes.restaurarPrompt(id); n++; }
    }
    aoNotificar(n === 0 ? "Nenhum prompt editado: nada a restaurar." : `${n} prompt(s) restaurado(s) para o original da fábrica.`);
  });

  const addMembro = (): void => r.editar((x) => (x.membros.length >= LIMITES_SQUAD.membros_max ? x : { ...x, membros: [...x.membros, novoMembro(novoPapel, x.membros, x.membros[0]?.perfil.cli ?? "claude")] }));
  const membroSkills = skillsDe === null ? undefined : s.membros.find((m) => m.slug === skillsDe);

  return (
    <div className="sq-editor-squad">
      {!editavel ? (
        <div className="sq-faixa" role="note">
          <Badge>fábrica</Badge> Somente leitura: duplique para editar.
          <button type="button" className="botao sq-direita" disabled={duplicando} onClick={() => void duplicarSquad()}>Duplicar para editar</button>
        </div>
      ) : null}
      {editavel && resumo?.atualizacao_de_fabrica === true ? (
        <div className="sq-faixa" role="status">
          <Badge tom="destaque">atualização</Badge> Nova versão da fábrica disponível.
          <button type="button" className="botao sq-direita" onClick={() => setAtualizar(true)}>Revisar atualização</button>
        </div>
      ) : null}
      {r.externaMudou ? (
        <div className="sq-faixa" role="alert">
          O arquivo mudou fora do app e você tem edições não salvas.
          <button type="button" className="botao sq-direita" onClick={() => void r.recarregar()}>Recarregar (descarta as suas)</button>
        </div>
      ) : null}

      <header className="sq-cab" aria-label="Dados da squad">
        <input className="sq-in-nome" aria-label="Nome da squad" value={s.nome} maxLength={80} disabled={!editavel} onChange={(e) => r.editar((x) => ({ ...x, nome: e.target.value }))} />
        <select aria-label="Escopo" value={s.escopo} disabled={!editavel} onChange={(e) => r.editar((x) => ({ ...x, escopo: e.target.value as typeof s.escopo }))}>
          {ESCOPOS_SQUAD.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <select aria-label="Rigidez padrão" value={s.rigidez_padrao ?? ""} disabled={!editavel} onChange={(e) => r.editar((x) => ({ ...x, rigidez_padrao: e.target.value === "" ? null : (Number(e.target.value) as NivelRigidez) }))}>
          <option value="">rigidez: padrão</option>
          {NIVEIS_RIGIDEZ.map((n) => <option key={n} value={n}>rigidez {n}</option>)}
        </select>
        <label className="sq-rot">paralelas
          <input type="number" aria-label="Instâncias paralelas da squad" className="sq-in-num" min={1} max={LIMITES_SQUAD.instancias_max} value={s.max_instancias_paralelas} disabled={!editavel} onChange={(e) => r.editar((x) => ({ ...x, max_instancias_paralelas: Number(e.target.value) }))} />
        </label>
        <select aria-label="Aplicar a mesma CLI a todos os membros (cadeado)" title="Cadeado: aplica a CLI a todos, mantendo papel e faixa" value="" disabled={!editavel} onChange={(e) => void cadeado(e.target.value)}>
          <option value="">cadeado: mesma CLI…</option>
          {[...CLIS_CATALOGO, CLI_AUTO].map((c) => <option key={c} value={c}>todos em {c}</option>)}
        </select>
      </header>

      <div className="sq-barra-acoes" role="toolbar" aria-label="Ações da squad">
        {editavel ? (
          <>
            <button type="button" className="botao botao-primario" disabled={!r.sujo || temErro(achados) || r.erroForma !== null || r.gravacao.ocupado} onClick={() => void r.salvar()}>{r.gravacao.ocupado ? "Salvando…" : "Salvar"}</button>
            <button type="button" className="botao" disabled={!r.sujo} onClick={() => { r.descartar(); setAvisosCadeado([]); }}>Descartar</button>
          </>
        ) : null}
        <button type="button" className="botao" disabled={duplicando} onClick={() => void duplicarSquad()}>Duplicar</button>
        <button type="button" className="botao" onClick={() => setExportar(true)}>Exportar</button>
        {editavel && s.fabrica !== null ? <button type="button" className="botao" onClick={() => setRestaurar(true)}>Restaurar fábrica</button> : null}
        {editavel ? <button type="button" className="botao botao-perigo" onClick={() => setApagar(true)}>Apagar</button> : null}
        <span className="sq-resumo" role="status" aria-live="polite">
          {r.erroForma !== null ? `Rascunho inválido: ${r.erroForma}` : resumoAchados.erros === 0 && resumoAchados.avisos === 0 ? "Sem achados" : `${resumoAchados.erros} erro(s) · ${resumoAchados.avisos} aviso(s)`}
          {r.sujo ? " · não salvo" : ""}
        </span>
      </div>

      {r.gravacao.conflito ? (
        <div role="alert" className="aviso-caixa sq-conflito">
          <p>O arquivo da squad mudou fora do app. Nada foi sobrescrito.</p>
          <div className="sq-linha-botoes">
            <button type="button" className="botao" onClick={() => void r.recarregar()}>Recarregar</button>
            <button type="button" className="botao botao-perigo" onClick={() => void r.salvar({ sobrescrever: true })}>Sobrescrever</button>
          </div>
        </div>
      ) : null}
      {r.gravacao.erro !== null ? <p role="alert" className="erro-caixa">{r.gravacao.erro}</p> : null}
      {erroAcao !== null ? <p role="alert" className="erro-caixa">{erroAcao}</p> : null}
      {gerais.length > 0 ? (
        <ul className="sq-achados" aria-label="Achados da squad">
          {gerais.map((a: Achado, i) => <li key={`${a.codigo}-${i}`} data-sev={a.severidade}><span className="sq-sev">{a.severidade === "erro" ? "erro" : "aviso"}</span> {a.mensagem}{a.codigo === "cli_sem_intake" ? " Use claude, codex ou opencode no orquestrador." : ""}</li>)}
        </ul>
      ) : null}
      {avisosCadeado.length > 0 ? (
        <ul className="sq-achados" aria-label="Avisos do cadeado">
          {avisosCadeado.map((a) => <li key={a.membro} data-sev="aviso"><span className="sq-sev">aviso</span> <code>{a.membro}</code>: {a.mensagem}</li>)}
        </ul>
      ) : null}

      <div className="sq-tabela-caixa">
        <table className="sq-tabela" aria-label="Membros da squad">
          <thead>
            <tr>
              <th scope="col">Papel</th><th scope="col">Rótulo</th><th scope="col">CLI</th><th scope="col">Modelo</th><th scope="col">Esforço</th><th scope="col">Faixa</th>
              <th scope="col">Inst.</th><th scope="col">Permissão</th><th scope="col">Skills/MCPs</th><th scope="col">Prompt</th><th scope="col"><span className="sr-somente">Ações</span></th><th scope="col"><span className="sr-somente">Estado</span></th>
            </tr>
          </thead>
          <tbody>
            {s.membros.map((m, i) => (
              <LinhaMembro
                key={m.slug}
                membro={m}
                achados={achadosDoMembro(achados, i)}
                editavel={editavel}
                opcoes={opcoes[m.perfil.cli]}
                permissaoWorkspace={permissaoWorkspace}
                podeDuplicar={s.membros.length < LIMITES_SQUAD.membros_max}
                aoMudar={(p) => r.editar((x) => mudarMembro(x, m.slug, p))}
                aoPerfil={(p) => r.editar((x) => mudarPerfil(x, m.slug, p))}
                aoPrompt={() => aoAbrirPrompt(m)}
                aoSkills={() => setSkillsDe(m.slug)}
                aoDuplicar={(cli) => r.editar((x) => duplicarMembro(x, m.slug, cli))}
                aoRemover={() => r.editar((x) => removerMembro(x, m.slug))}
              />
            ))}
          </tbody>
        </table>
      </div>
      {editavel ? (
        <div className="sq-add">
          <select aria-label="Papel do novo membro" value={novoPapel} onChange={(e) => setNovoPapel(e.target.value as PapelSquad)}>
            {PAPEIS_NOVOS.map((p) => <option key={p} value={p}>{descreverPapel(p)}</option>)}
          </select>
          <button type="button" className="botao" disabled={s.membros.length >= LIMITES_SQUAD.membros_max} onClick={addMembro}><Icone nome="mais" /> Membro</button>
          <span className="sq-vazio">{s.membros.length}/{LIMITES_SQUAD.membros_max} membros · o orquestrador é único e obrigatório</span>
        </div>
      ) : null}

      {membroSkills !== undefined ? (
        <SkillsDoMembro
          membro={membroSkills}
          editavel={editavel}
          maximoDaSquad={s.max_instancias_paralelas}
          aoFechar={() => setSkillsDe(null)}
          aoSalvar={(p) => { r.editar((x) => mudarMembro(x, membroSkills.slug, p)); setSkillsDe(null); }}
        />
      ) : null}
      {exportar ? <DialogoExportar api={squads} slug={s.slug} workspaceId={workspaceId} aoFechar={() => setExportar(false)} /> : null}
      {atualizar ? <DialogoAtualizacaoFabrica api={squads} slug={s.slug} aoFechar={() => setAtualizar(false)} aoAplicada={() => { setAtualizar(false); void r.recarregar(); }} /> : null}
      {apagar ? (
        <DialogoApagar
          slug={s.slug}
          emUso={resumo?.em_uso === true}
          aoCancelar={() => setApagar(false)}
          aoConfirmar={async () => { await store.apagar(s.slug, s.slug); setApagar(false); aoApagada(); }}
        />
      ) : null}
      {restaurar ? (
        <DialogoConfirmacao
          titulo="Restaurar prompts de fábrica?"
          texto={<p>Todos os prompts editados desta cópia voltam ao texto original da fábrica. A configuração (CLI, modelo, limites) não muda. Esta ação não pode ser desfeita.</p>}
          rotuloConfirmar="Restaurar"
          perigoso
          aoCancelar={() => setRestaurar(false)}
          aoConfirmar={() => void restaurarFabrica()}
        />
      ) : null}
    </div>
  );
}

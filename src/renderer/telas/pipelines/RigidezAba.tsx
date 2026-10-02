// Aba Rigidez (T-16.34): matriz nível × etapa (símbolo + aria-label + legenda), parâmetros e hooks por nível, prévia do plano,
// hooks do workspace e configuração do Maestro (`confirmar_plano` só desliga com confirmação própria).
import { useEffect, useState } from "react";
import type { CatalogoPipelines, ConfigMaestroDto, EstadoHooksDto, EstadoRigidez, EtapaDoPlano, MatrizRigidezDto, NivelRigidez, PipelineId } from "../../../compartilhado/maestro";
import { DialogoConfirmacao } from "../../componentes/Dialogo";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { ade } from "../../ade";
import { useCarga } from "../../estado/carga";
import { EscalaDeRigidez } from "./Escala";
import { CELA_CURTA, MODO_HOOK_CURTO, NIVEIS, NOMES_NIVEL, SIMBOLO_CELA, hooksDoNivel, infoDoParametro, valorDoParametro, efeitoDoNivel, frasesDoEfeito, perfilLegivel, rigoresDaEtapa, rotuloDaCela } from "./logica";

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
export function RigidezAba({ workspaceId }: { workspaceId: string | null }) {
  const api = ade();
  const matriz = useCarga<MatrizRigidezDto>(api?.rigidez?.matriz === undefined ? undefined : () => (api?.rigidez.matriz() as Promise<MatrizRigidezDto>), "matriz");
  const catalogo = useCarga<CatalogoPipelines>(api?.pipelines?.catalogo === undefined ? undefined : () => (api?.pipelines.catalogo() as Promise<CatalogoPipelines>), "catalogo");
  const atual = useCarga<EstadoRigidez>(api?.rigidez?.ler === undefined || workspaceId === null ? undefined : () => api.rigidez.ler({ workspace_id: workspaceId, mission_id: null, plano_id: null }), `rigidez|${workspaceId ?? ""}`);
  const [escolhido, setEscolhido] = useState<NivelRigidez | null>(null);
  const efetivo = atual.dados?.efetivo ?? null;
  const nivel: NivelRigidez = escolhido ?? efetivo ?? 3;
  if (api?.rigidez === undefined) return <EstadoVazio icone="pipelines" titulo="A rigidez só funciona no aplicativo" texto="Abra o aplicativo instalado para ver a matriz de níveis." />;
  if (matriz.estado === "carregando" || catalogo.estado === "carregando") return <div className="pl-carregando" aria-busy="true" role="status">Carregando a matriz…</div>;
  if (matriz.estado === "erro" || catalogo.estado === "erro") return <div className="pl-erro" role="alert">{matriz.estado === "erro" ? matriz.mensagem : catalogo.estado === "erro" ? catalogo.mensagem : ""} <button type="button" className="botao" onClick={() => { matriz.recarregar(); catalogo.recarregar(); }}>Tentar de novo</button></div>;
  if (matriz.dados === null || catalogo.dados === null) return <EstadoVazio icone="pipelines" titulo="Matriz indisponível" texto="O processo principal não respondeu. Reinicie o aplicativo." />;
  return (
    <div className="pl-rigidez">
      <Escala m={matriz.dados} c={catalogo.dados} workspaceId={workspaceId} nivel={nivel} efetivo={efetivo} onNivel={setEscolhido} />
      <Parametros m={matriz.dados} destaque={nivel} />
      <HooksPorNivel m={matriz.dados} destaque={nivel} />
      {workspaceId !== null ? (
        <div className="pl-rig-duas">
          <HooksDoWorkspace workspaceId={workspaceId} />
          <ConfigMaestro workspaceId={workspaceId} />
        </div>
      ) : null}
    </div>
  );
}

/** Escala + o que o nível escolhido faz com as etapas do pipeline em foco (a prévia do plano vem do núcleo). */
function Escala({ m, c, workspaceId, nivel, efetivo, onNivel }: { m: MatrizRigidezDto; c: CatalogoPipelines; workspaceId: string | null; nivel: NivelRigidez; efetivo: NivelRigidez | null; onNivel: (n: NivelRigidez) => void }) {
  const [pipeline, setPipeline] = useState<PipelineId>("runx");
  const passos = new Set((c.pipelines.find((p) => p.id === pipeline)?.passos ?? []).map((x) => x.etapa as string));
  const efeitos = Object.fromEntries(NIVEIS.map((n) => { const e = efeitoDoNivel(m.celulas, n, passos.size > 0 ? passos : undefined); return [n, `${e.completas + e.reduzidas + e.reforcadas} de ${e.total} rodam`]; })) as Record<NivelRigidez, string>;
  const desc = m.niveis.find((x) => x.nivel === nivel);
  const nomes = Object.fromEntries(m.niveis.map((x) => [x.nivel, x.nome])) as Record<NivelRigidez, string>;
  return (
    <section className="pl-escala-secao" aria-label="Escala de rigidez">
      <header className="pl-secao-cab">
        <div>
          <h2>Quanto rigor o método aplica</h2>
          <p className="pl-discreto">{efetivo !== null ? `Neste projeto o nível é ${NOMES_NIVEL[efetivo]} (${efetivo} de 5). ` : ""}Escolha um nível para ver o que ele muda nas etapas. Quem define o nível é o seletor do cabeçalho.</p>
        </div>
        <label className="pl-campo-linha">Pipeline em foco
          <select value={pipeline} onChange={(e) => setPipeline(e.target.value as PipelineId)}>{c.pipelines.filter((p) => p.passos.length > 0).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select>
        </label>
      </header>
      <EscalaDeRigidez nivel={nivel} onNivel={onNivel} rotulo="Nível para comparar" nomes={nomes} efeitos={efeitos} />
      {desc !== undefined ? (
        <dl className="pl-nivel-desc" aria-label={`O que o nível ${desc.nome} faz`}>
          <div className="pl-nivel-desc-lead"><dt>{desc.nome}</dt><dd>{desc.semantica}{efetivo === nivel ? " É o nível em uso." : ""}</dd></div>
          <div><dt>Entra</dt><dd>{desc.ligado}</dd></div>
          <div><dt>Fica de fora</dt><dd>{desc.desligado}</dd></div>
          <div><dt>Indicado para</dt><dd>{desc.quando}</dd></div>
        </dl>
      ) : null}
      <Previa workspaceId={workspaceId} pipeline={pipeline} nivel={nivel} c={c} m={m} />
      <MatrizNivelEtapa m={m} c={c} destaque={nivel} />
    </section>
  );
}

function MatrizNivelEtapa({ m, c, destaque }: { m: MatrizRigidezDto; c: CatalogoPipelines; destaque: NivelRigidez }) {
  const nomes = new Map(c.etapas.map((e) => [e.id as string, e.nome]));
  return (
    <section className="pl-matriz-secao" aria-label="Matriz nível por etapa">
      <h3>Etapa por nível</h3>
      <p className="pl-discreto">Cada linha é uma etapa do método; cada coluna, um nível. Passe o olho na linha para ver onde a etapa entra, encolhe ou sai.</p>
      <div className="pl-rolavel">
        <table className="pl-tabela pl-matriz-niveis" aria-label="Matriz de rigidez: etapas por nível">
          <thead><tr><th scope="col">Etapa</th>{NIVEIS.map((n) => <th key={n} scope="col" data-atual={n === destaque || undefined}>{n} · {m.niveis.find((x) => x.nivel === n)?.nome ?? NOMES_NIVEL[n]}</th>)}</tr></thead>
          <tbody>
            {m.celulas.map((l) => (
              <tr key={l.etapa_id}>
                <th scope="row">{nomes.get(l.etapa_id) ?? l.etapa_id}<code className="pl-id">{l.etapa_id}</code></th>
                {NIVEIS.map((n) => {
                  const cel = l.por_nivel[String(n)];
                  return cel === undefined ? <td key={n}>—</td> : (
                    <td key={n} data-atual={n === destaque || undefined} data-modo-cela={cel.modo} aria-label={rotuloDaCela(cel, n, nomes.get(l.etapa_id) ?? l.etapa_id)} title={rotuloDaCela(cel, n, nomes.get(l.etapa_id) ?? l.etapa_id)}>
                      <span aria-hidden="true" className="pl-cela"><span className="pl-cela-simbolo">{SIMBOLO_CELA[cel.modo]}</span> {CELA_CURTA[cel.modo]}{cel.agrupa ? " ⛓" : ""}{cel.confirma ? " !" : ""}{cel.avaliacoes !== null && cel.avaliacoes > 1 ? ` ×${cel.avaliacoes}` : ""}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="pl-legenda" aria-label="Legenda">● roda como o método define · ◐ reduzida · ◆ reforço · ○ não despachada · H humano · R substituída pelo pipeline rápido · ⛓ agrupada · ! confirma antes de enviar · ×2 duas avaliações</p>
    </section>
  );
}

function Parametros({ m, destaque }: { m: MatrizRigidezDto; destaque: NivelRigidez }) {
  const chaves = Object.keys(m.parametros["3"] ?? m.parametros["1"] ?? {});
  const nomeDe = (n: NivelRigidez): string => m.niveis.find((x) => x.nivel === n)?.nome ?? NOMES_NIVEL[n];
  return (
    <section className="pl-param-secao" aria-label="Parâmetros por nível">
      <h3>Parâmetros por nível</h3>
      <p className="pl-discreto">O que o método ajusta em cada nível: da quantidade de rodadas ao rigor do portão. O nível em comparação fica marcado.</p>
      <div className="pl-param-tabela">
        <table className="pl-tabela pl-param" aria-label="Parâmetros por nível">
          <thead><tr><th scope="col">Parâmetro</th>{NIVEIS.map((n) => <th key={n} scope="col" data-atual={n === destaque || undefined}>{n} · {nomeDe(n)}</th>)}</tr></thead>
          <tbody>
            {chaves.map((k) => {
              const info = infoDoParametro(k);
              return (
                <tr key={k}>
                  <th scope="row"><span className="pl-param-nome">{info.rotulo}</span>{info.descricao !== "" ? <span className="pl-param-desc">{info.descricao}</span> : null}</th>
                  {NIVEIS.map((n) => <td key={n} data-atual={n === destaque || undefined}>{valorDoParametro(k, m.parametros[String(n)]?.[k])}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul className="pl-param-lista" aria-label="Parâmetros por nível, um por vez">
        {chaves.map((k) => {
          const info = infoDoParametro(k);
          return (
            <li key={k} className="pl-param-item">
              <strong className="pl-param-nome">{info.rotulo}</strong>
              {info.descricao !== "" ? <span className="pl-param-desc">{info.descricao}</span> : null}
              <dl>
                {NIVEIS.map((n) => <div key={n} data-atual={n === destaque || undefined}><dt>{n} · {nomeDe(n)}</dt><dd>{valorDoParametro(k, m.parametros[String(n)]?.[k])}</dd></div>)}
              </dl>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function HooksPorNivel({ m, destaque }: { m: MatrizRigidezDto; destaque: NivelRigidez }) {
  const temAlgum = NIVEIS.some((n) => Object.keys(m.hooks_por_nivel[String(n)] ?? {}).length > 0);
  if (!temAlgum) return null;
  return (
    <section className="pl-hooks-secao" aria-label="Hooks por nível">
      <h3>Hooks por nível</h3>
      <p className="pl-discreto">As travas do método que o app liga em cada nível. Nível sem hooks volta ao padrão do método. Hooks de segurança nunca são alterados, e hook que o plugin não registrou aparece como inativo no método.</p>
      <ol className="pl-hooks-niveis">
        {NIVEIS.map((n) => {
          const hooks = hooksDoNivel(m.hooks_por_nivel, n);
          const ativos = hooks.filter((h) => h.modo !== "desligado");
          const desligados = hooks.filter((h) => h.modo === "desligado");
          const nome = m.niveis.find((x) => x.nivel === n)?.nome ?? NOMES_NIVEL[n];
          const item = (h: (typeof hooks)[number]) => (
            <li key={h.nome} className="pl-hook">
              <span className="pl-hook-topo"><code className="pl-hook-nome">{h.nome}</code><span className="pl-hook-modo" data-modo={h.modo}>{MODO_HOOK_CURTO[h.modo] ?? h.modo}</span></span>
              {h.descricao !== "" ? <span className="pl-hook-desc">{h.descricao}</span> : null}
            </li>
          );
          return (
            <li key={n} className="pl-hooks-nivel" data-atual={n === destaque || undefined}>
              <h4 className="pl-hooks-nivel-titulo">Nível {n} · {nome}<span className="pl-discreto">{hooks.length === 0 ? "padrão do método" : `${ativos.length} ${ativos.length === 1 ? "ligado" : "ligados"}${desligados.length > 0 ? `, ${desligados.length} desligados` : ""}`}</span></h4>
              {hooks.length === 0 ? <p className="pl-discreto pl-hooks-vazio">Nenhum hook gerenciado: o método volta ao padrão.</p> : null}
              {ativos.length > 0 ? <ul className="pl-hooks-lista" aria-label={`Hooks do nível ${n}`}>{ativos.map(item)}</ul> : null}
              {desligados.length > 0 ? (
                <details className="pl-hooks-off">
                  <summary>Ver os {desligados.length} hooks desligados neste nível</summary>
                  <ul className="pl-hooks-lista" aria-label={`Hooks desligados do nível ${n}`}>{desligados.map(item)}</ul>
                </details>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Previa({ workspaceId, pipeline, nivel, c, m }: { workspaceId: string | null; pipeline: PipelineId; nivel: NivelRigidez; c: CatalogoPipelines; m: MatrizRigidezDto }) {
  const api = ade()?.rigidez;
  const [etapas, setEtapas] = useState<EtapaDoPlano[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (api === undefined || workspaceId === null) return;
    let vivo = true;
    const t = setTimeout(() => { api.previaPlano({ workspace_id: workspaceId, pipeline_id: pipeline, nivel }).then((e) => { if (vivo) { setEtapas(e); setErro(null); } }, (e) => { if (vivo) setErro(msg(e)); }); }, 120);
    return () => { vivo = false; clearTimeout(t); };
  }, [api, workspaceId, pipeline, nivel]);
  const nomes = new Map(c.etapas.map((e) => [e.id as string, e.nome]));
  const passos = new Set((c.pipelines.find((p) => p.id === pipeline)?.passos ?? []).map((x) => x.etapa as string));
  const frase = frasesDoEfeito(efeitoDoNivel(m.celulas, nivel, passos.size > 0 ? passos : undefined));
  return (
    <div className="pl-previa-bloco" aria-label="Prévia do plano">
      <h3>Como ficaria o pipeline no nível {NOMES_NIVEL[nivel]}</h3>
      <p className="pl-discreto" aria-live="polite">{frase}.</p>
      {workspaceId === null ? <p className="pl-discreto">Abra um projeto para ver a prévia.</p> : erro !== null ? <p className="pl-erro" role="alert">{erro}</p> : etapas === null ? <p className="pl-carregando" aria-busy="true">Calculando…</p> : (
        <ol className="pl-trilha pl-trilha-compacta" aria-label="Etapas do plano simulado">
          {etapas.map((e) => {
            const perfil = e.estado_inicial === "humano" ? null : perfilLegivel(e.resumo_perfil);
            const rigores = rigoresDaEtapa(e);
            const fora = e.estado_inicial === "pulada_nivel";
            return (
              <li key={e.etapa_id} className="pl-passo" data-pulada={fora || undefined} data-humana={e.estado_inicial === "humano" || undefined}>
                <span className="pl-no" aria-hidden="true">{e.estado_inicial === "humano" ? "!" : e.ordem}</span>
                <div className="pl-passo-corpo">
                  <div className="pl-passo-topo">
                    <h4 className="pl-passo-nome">{nomes.get(e.etapa_id) ?? e.etapa_id}</h4>
                    <code className="pl-id">{e.etapa_id}</code>
                    <ul className="pl-rigores" aria-label="Rigor da etapa">{rigores.map((r) => <li key={r.tipo} className="pl-rigor" data-tipo={r.tipo}>{r.texto}</li>)}</ul>
                  </div>
                  {e.motivo !== null ? <p className="pl-passo-motivo">{e.motivo}</p> : null}
                  {perfil !== null && !fora ? <p className="pl-perfil-linha">{perfil.cli} · modelo {perfil.modelo} · esforço {perfil.esforco}</p> : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function HooksDoWorkspace({ workspaceId }: { workspaceId: string }) {
  const api = ade()?.rigidez;
  const carga = useCarga<EstadoHooksDto>(api === undefined ? undefined : () => api.hooksEstado({ workspace_id: workspaceId, mission_id: null }), `hooks|${workspaceId}`);
  const [aviso, setAviso] = useState<string | null>(null);
  const h = carga.dados;
  const reverter = async (): Promise<void> => {
    if (api === undefined) return;
    try { const r = await api.hooksReverter({ workspace_id: workspaceId, mission_id: null }); setAviso(r.revertidas.length === 0 ? "Nada para reverter." : `Revertidos: ${r.revertidas.join(", ")}.`); carga.recarregar(); } catch (e) { setAviso(`Não foi possível reverter: ${msg(e)}`); }
  };
  return (
    <section aria-label="Hooks do projeto">
      <h3>Hooks deste projeto</h3>
      {carga.estado === "carregando" ? <p className="pl-carregando" aria-busy="true">Lendo hooks…</p> : carga.estado === "erro" ? <p className="pl-erro" role="alert">{carga.mensagem}</p> : h === null ? <p className="pl-discreto">Indisponível.</p> : (
        <>
          <p>{!h.metodo_instalado ? "O método não está instalado neste diretório: o app não cria nenhum arquivo." : !h.presente ? "Nenhum arquivo de hooks ainda." : h.invalido ? "O arquivo de hooks está inválido: corrija-o; o app não grava nada enquanto isso." : `${h.gerenciadas.length} hook(s) gerenciado(s) pelo app${h.nivel_aplicado !== null ? ` (nível ${h.nivel_aplicado})` : ""}.`}</p>
          <button type="button" className="botao" disabled={h.gerenciadas.length === 0} onClick={() => void reverter()}>Reverter só o que o app escreveu</button>
        </>
      )}
      {aviso !== null ? <p className="pl-aviso" role="status">{aviso}</p> : null}
    </section>
  );
}

function ConfigMaestro({ workspaceId }: { workspaceId: string }) {
  const api = ade()?.maestro;
  const carga = useCarga<ConfigMaestroDto>(api?.lerConfig === undefined ? undefined : () => api.lerConfig(workspaceId), `cfg|${workspaceId}`);
  const [cfg, setCfg] = useState<ConfigMaestroDto | null>(null);
  const [desligando, setDesligando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  useEffect(() => { if (carga.dados !== null) setCfg(carga.dados); }, [carga.dados]);
  const gravar = async (novo: ConfigMaestroDto, confirmado: boolean): Promise<void> => {
    if (api === undefined) return;
    const anterior = cfg;
    setCfg(novo);
    try { setCfg(await api.gravarConfig({ workspace_id: workspaceId, config: novo, confirmado })); setAviso(null); } catch (e) { setCfg(anterior); setAviso(`Não foi possível gravar: ${msg(e)}`); }
  };
  if (carga.estado === "carregando") return <p className="pl-carregando" aria-busy="true">Carregando configuração…</p>;
  if (carga.estado === "erro") return <p className="pl-erro" role="alert">{carga.mensagem}</p>;
  if (cfg === null) return null;
  return (
    <section aria-label="Configuração do Maestro">
      <h3>Configuração do Maestro</h3>
      <div className="pl-config">
        <label className="pl-linha"><input type="checkbox" checked={cfg.confirmar_plano} onChange={(e) => { if (!e.target.checked) setDesligando(true); else void gravar({ ...cfg, confirmar_plano: true }, false); }} /> Mostrar o plano antes de executar (recomendado)</label>
        <label className="pl-linha">Hook de prompt do Claude
          <select value={cfg.hook_modo} onChange={(e) => void gravar({ ...cfg, hook_modo: e.target.value as ConfigMaestroDto["hook_modo"] }, false)}>
            <option value="encaminhar">encaminhar ao Maestro</option><option value="notificar">só avisar</option><option value="desligado">desligado</option>
          </select>
        </label>
        <label className="pl-linha"><input type="checkbox" checked={cfg.escrever_hooks} onChange={(e) => void gravar({ ...cfg, escrever_hooks: e.target.checked }, false)} /> Permitir que o app escreva os hooks do método (com backup)</label>
        <label className="pl-linha"><input type="checkbox" checked={cfg.fechar_concluidos} onChange={(e) => void gravar({ ...cfg, fechar_concluidos: e.target.checked }, false)} /> Fechar os terminais das etapas concluídas</label>
        <label className="pl-linha"><input type="checkbox" checked={cfg.producao} onChange={(e) => void gravar({ ...cfg, producao: e.target.checked }, false)} /> Este projeto é produção (exige confirmação para baixar a rigidez)</label>
        <label className="pl-linha">Terminais simultâneos por pipeline
          <input type="number" min={1} max={8} value={cfg.max_terminais} onChange={(e) => { const n = Math.min(8, Math.max(1, Number(e.target.value) || 1)); void gravar({ ...cfg, max_terminais: n }, false); }} />
        </label>
      </div>
      {aviso !== null ? <p className="pl-erro" role="alert">{aviso}</p> : null}
      {desligando ? <DialogoConfirmacao titulo="Executar sem mostrar o plano?" texto="Com isto desligado, pedidos de alta confiança podem abrir terminais sem você ver o plano antes. Isso nunca vale para baixa confiança, trava ativa ou etapa humana imediata." rotuloConfirmar="Desligar" perigoso aoCancelar={() => setDesligando(false)} aoConfirmar={() => { setDesligando(false); void gravar({ ...cfg, confirmar_plano: false }, true); }} /> : null}
    </section>
  );
}

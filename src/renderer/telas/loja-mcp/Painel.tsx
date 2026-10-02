// Painel lateral (360 px) do servidor: comando exato, pasta, hosts, variáveis, riscos, nível, fontes, ferramentas, habilitação,
// saúde/teste, logs, atualizar, remover e "instalar na minha CLI". O comando mostrado é o do plano (`permissoes.comando_exato`).
import { useCallback, useEffect, useState } from "react";
import type { ApiAde } from "../../../compartilhado/ipc";
import type { CartaoMcp, DetalheMcp, LogMcp } from "../../../compartilhado/loja-mcp";
import { Dialogo } from "../../componentes/Dialogo";
import { Icone } from "../../componentes/Icone";
import { DialogoCliUsuario } from "./CliUsuario";
import { MatrizHabilitacao } from "./Habilitacao";
import {
  formatarLatencia, mensagemDoCodigo, mensagemDoErro, resumoSaude, rotuloCategoria, rotuloRisco, ROTULO_NIVEL, ROTULO_GRATUITO, seloAutenticacao,
} from "./logica";

type Api = ApiAde["lojaMcp"];

export interface PropsPainel {
  api: Api;
  cartao: CartaoMcp;
  workspaceId: string | null;
  missoes: ReadonlyArray<{ id: string; titulo: string }>;
  somenteLeitura: boolean;
  aoFechar: () => void;
  aoInstalar: (id: string) => void;
  aoAtualizar: (id: string) => void;
  aoConfigurar: (id: string) => void;
  /** a lista precisa recarregar (habilitação, teste, remoção). */
  aoMudar: () => void;
  aoAviso: (texto: string) => void;
}

function DialogoRemover({ nome, ocupado, erro, aoConfirmar, aoFechar }: { nome: string; ocupado: boolean; erro: string | null; aoConfirmar: (apagarSegredos: boolean) => void; aoFechar: () => void }) {
  const [segredos, setSegredos] = useState(false);
  return (
    <Dialogo titulo={`Remover ${nome}?`} aoFechar={aoFechar}>
      <div className="dialogo-corpo">
        <p>Apaga a pasta do servidor, as habilitações e as configurações locais. Se algum terminal estiver usando o servidor, a remoção é recusada.</p>
        <label className="lm-entendi"><input type="checkbox" checked={segredos} onChange={(e) => setSegredos(e.target.checked)} /> Apagar também as chaves deste servidor no cofre</label>
        {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}
      </div>
      <div className="dialogo-acoes">
        <button type="button" className="botao" data-foco-inicial onClick={aoFechar}>Cancelar</button>
        <button type="button" className="botao botao-perigo" disabled={ocupado} onClick={() => aoConfirmar(segredos)}>{ocupado ? "Removendo…" : "Remover"}</button>
      </div>
    </Dialogo>
  );
}

function Logs({ api, id }: { api: Api; id: string }) {
  const [logs, setLogs] = useState<LogMcp[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    api.logs(id, 50).then((l) => { if (vivo) setLogs(l); }, (e: unknown) => { if (vivo) setErro(mensagemDoErro(e)); });
    return () => { vivo = false; };
  }, [api, id]);
  if (erro !== null) return <p role="alert" className="campo-erro">{erro}</p>;
  if (logs === null) return <p aria-busy="true">Carregando…</p>;
  if (logs.length === 0) return <p className="lm-nota">Sem registros.</p>;
  return (
    <ol className="lm-logs" aria-label="Logs do servidor">
      {logs.map((l, i) => <li key={`${l.em}-${i}`} data-nivel={l.nivel}><time>{l.em}</time> <strong>{l.evento}</strong> {l.detalhe}</li>)}
    </ol>
  );
}

export function PainelMcp({ api, cartao, workspaceId, missoes, somenteLeitura, aoFechar, aoInstalar, aoAtualizar, aoConfigurar, aoMudar, aoAviso }: PropsPainel) {
  const [det, setDet] = useState<DetalheMcp | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const [testando, setTestando] = useState(false);
  const [removendo, setRemovendo] = useState<{ ocupado: boolean; erro: string | null } | null>(null);
  const [cli, setCli] = useState(false);
  const [logs, setLogs] = useState(false);

  const assinatura = `${cartao.instalado?.estado ?? "-"}|${cartao.instalado?.versao ?? "-"}|${cartao.saude?.testado_em ?? "-"}|${cartao.precisa_configurar}`;
  useEffect(() => {
    let vivo = true;
    setErro(null);
    api.detalhe(cartao.id, workspaceId).then((d) => { if (vivo) setDet(d); }, (e: unknown) => { if (vivo) setErro(mensagemDoErro(e)); });
    return () => { vivo = false; };
  }, [api, cartao.id, workspaceId, assinatura, n]);
  useEffect(() => { setLogs(false); setDet(null); }, [cartao.id]);

  const recarregar = useCallback(() => { setN((x) => x + 1); aoMudar(); }, [aoMudar]);

  const testar = async () => {
    setTestando(true);
    try {
      const r = await api.testar(cartao.id, workspaceId);
      aoAviso(r.estado === "ok" ? `${cartao.nome}: ok · ${r.n_ferramentas} ferramentas · ${formatarLatencia(r.latencia_ms)}` : `${cartao.nome}: falhou. ${mensagemDoCodigo(r.erro, "O servidor não respondeu.")}`);
    } catch (e) { aoAviso(mensagemDoErro(e)); }
    finally { setTestando(false); recarregar(); }
  };
  const remover = async (apagarSegredos: boolean) => {
    setRemovendo({ ocupado: true, erro: null });
    try {
      const r = await api.desinstalar(cartao.id, apagarSegredos);
      if (r.ok) { setRemovendo(null); aoAviso(`${cartao.nome} removido. Resíduos: ${r.residuos.length}.`); recarregar(); }
      else setRemovendo({ ocupado: false, erro: mensagemDoCodigo(r.codigo) });
    } catch (e) { setRemovendo({ ocupado: false, erro: mensagemDoErro(e) }); }
  };

  const instalado = cartao.instalado !== null && cartao.instalado.estado === "instalado";
  const perm = det?.permissoes ?? null;
  const [rotuloGratis] = ROTULO_GRATUITO[cartao.selo_gratuito];
  const auth = seloAutenticacao(cartao);
  const saude = resumoSaude(cartao.saude);
  return (
    <aside className="lm-painel" aria-label={`Detalhes de ${cartao.nome}`}>
      <header className="lm-painel-cab">
        <h2>{cartao.nome}</h2>
        <button type="button" className="lm-icone" aria-label="Fechar detalhes" onClick={aoFechar}><Icone nome="fechar" /></button>
      </header>
      <div className="lm-painel-corpo">
        <p>{cartao.descricao_pt}</p>
        <p className="lm-nota">{rotuloCategoria(cartao.categoria)} · {cartao.mantenedor === "oficial" ? "oficial" : "comunidade"} ({cartao.mantenedor_nome}) · {rotuloGratis}{auth !== null ? ` · ${auth}` : ""}{cartao.licenca_spdx !== null ? ` · ${cartao.licenca_spdx}` : ""}</p>
        {!cartao.confirmado || !cartao.instalavel ? <p className="aviso-caixa lm-aviso" role="note"><strong>{cartao.confirmado ? "Não instalável." : "Não confirmado."}</strong> {cartao.motivo_nao_instalavel ?? "Esta entrada não foi confirmada pela curadoria."}</p> : null}
        {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}

        <div className="lm-acoes" role="group" aria-label="Ações">
          {cartao.instalado === null && cartao.instalavel ? <button type="button" className="botao botao-primario lm-mini" disabled={somenteLeitura} onClick={() => aoInstalar(cartao.id)}>Instalar</button> : null}
          {cartao.instalado?.estado === "falhou" && cartao.instalavel ? <button type="button" className="botao botao-primario lm-mini" disabled={somenteLeitura} onClick={() => aoInstalar(cartao.id)}>Tentar de novo</button> : null}
          {instalado && cartao.instalado?.atualizacao_disponivel === true ? <button type="button" className="botao botao-primario lm-mini" disabled={somenteLeitura} onClick={() => aoAtualizar(cartao.id)}>Atualizar</button> : null}
          {instalado && (cartao.precisa_configurar || (perm?.variaveis.length ?? 0) > 0) ? <button type="button" className="botao lm-mini" onClick={() => aoConfigurar(cartao.id)}>{cartao.precisa_configurar ? "Configurar" : "Chaves"}</button> : null}
          {instalado ? <button type="button" className="botao lm-mini" disabled={testando} onClick={() => void testar()}>{testando ? "Testando…" : "Testar"}</button> : null}
          {instalado ? <button type="button" className="botao lm-mini" onClick={() => setCli(true)}>Instalar na minha CLI</button> : null}
          {cartao.instalado !== null && cartao.instalado.estado !== "instalando" ? <button type="button" className="botao botao-perigo lm-mini" onClick={() => setRemovendo({ ocupado: false, erro: null })}>Remover</button> : null}
          {det?.links.repo ? <a className="botao lm-mini" href={det.links.repo} target="_blank" rel="noreferrer noopener">Repositório</a> : null}
        </div>

        {instalado ? (
          <section className="lm-secao" aria-label="Saúde">
            <h3>Saúde</h3>
            <p><span className="lst-selo" data-tom={saude.tom}>{saude.rotulo}</span> <span className="lm-nota">versão {cartao.instalado?.versao}{cartao.instalado?.atualizacao_disponivel ? " · atualização disponível" : ""}</span></p>
            <button type="button" className="botao lm-mini" aria-expanded={logs} onClick={() => setLogs((v) => !v)}>{logs ? "Ocultar logs" : "Ver logs"}</button>
            {logs ? <Logs api={api} id={cartao.id} /> : null}
          </section>
        ) : null}

        {det === null && erro === null ? <p aria-busy="true">Carregando detalhes…</p> : null}
        {det !== null && perm === null ? <p className="lm-nota">Permissões indisponíveis{det.permissoes_erro !== null ? `: ${det.permissoes_erro}` : "."}</p> : null}
        {perm !== null ? (
          <section className="lm-secao" aria-label="Permissões">
            <h3>Comando exato</h3>
            <pre className="lm-codigo" aria-label="Comando exato">{perm.comando_exato}</pre>
            <dl className="lm-dl">
              <dt>Pasta</dt><dd><code>{perm.pasta ?? "nenhuma (remoto)"}</code></dd>
              <dt>Escreve em disco</dt><dd>{perm.escrita_em_disco.length === 0 ? "nada" : perm.escrita_em_disco.join(", ")}</dd>
              <dt>Rede (instalação)</dt><dd>{perm.hosts_rede.instalacao.join(", ") || "nenhuma"}</dd>
              <dt>Rede (execução)</dt><dd>{perm.hosts_rede.execucao_livre ? "livre" : perm.hosts_rede.execucao.join(", ") || "nenhuma"}</dd>
              <dt>Verificação</dt><dd>{ROTULO_NIVEL[perm.nivel_verificacao]}</dd>
              <dt>Versão pinada</dt><dd>{perm.versao_pinada ?? "—"}</dd>
              <dt>Integridade</dt><dd><code className="lm-hash">{perm.integridade ?? "—"}</code></dd>
              <dt>Variáveis</dt>
              <dd>{perm.variaveis.length === 0 ? "nenhuma" : (
                <ul className="lm-lista-simples">{perm.variaveis.map((v) => <li key={v.nome}><code>{v.nome}</code> {v.obrigatoria ? "· obrigatória" : "· opcional"}{v.secreta ? " · secreta" : ""}{det?.variaveis.find((x) => x.nome === v.nome)?.definida ? " · definida" : ""}<br /><span className="lm-nota">{v.ajuda}</span></li>)}</ul>
              )}</dd>
              <dt>Riscos</dt><dd>{perm.riscos.length === 0 ? "nenhum declarado" : perm.riscos.map(rotuloRisco).join(", ")}{perm.riscos_texto !== "" ? <p className="lm-nota">{perm.riscos_texto}</p> : null}</dd>
            </dl>
          </section>
        ) : null}
        {det !== null && det.ferramentas.length > 0 ? (
          <section className="lm-secao" aria-label="Ferramentas vistas">
            <h3>Ferramentas ({det.ferramentas.length})</h3>
            <ul className="lm-lista-simples">{det.ferramentas.slice(0, 40).map((f) => <li key={f.nome}><code>{f.nome}</code>{f.descricao !== null ? <span className="lm-nota"> — {f.descricao}</span> : null}</li>)}</ul>
          </section>
        ) : cartao.tools_principais.length > 0 ? (
          <section className="lm-secao" aria-label="Ferramentas principais"><h3>Ferramentas principais</h3><p className="lm-nota">{cartao.tools_principais.join(", ")}. A lista completa aparece depois do primeiro teste.</p></section>
        ) : null}
        {instalado ? (
          <MatrizHabilitacao api={api} servidorId={cartao.id} workspaceId={workspaceId} missoes={missoes} podeHabilitar={!somenteLeitura} aoMudar={recarregar} aoConfigurar={() => aoConfigurar(cartao.id)} />
        ) : null}
        {det !== null && det.fontes.length > 0 ? (
          <section className="lm-secao" aria-label="Fontes">
            <h3>Fontes</h3>
            <ul className="lm-lista-simples">{det.fontes.map((f) => <li key={f.url}>{/^https:\/\//.test(f.url) ? <a href={f.url} target="_blank" rel="noreferrer noopener">{f.para}</a> : f.para} <span className="lm-nota">consultado em {f.consultado_em}</span></li>)}</ul>
            {det.observacoes !== null ? <p className="lm-nota">{det.observacoes}</p> : null}
          </section>
        ) : null}
      </div>
      {removendo !== null ? <DialogoRemover nome={cartao.nome} ocupado={removendo.ocupado} erro={removendo.erro} aoConfirmar={(s) => void remover(s)} aoFechar={() => setRemovendo(null)} /> : null}
      {cli ? <DialogoCliUsuario api={api} id={cartao.id} nome={cartao.nome} workspaceId={workspaceId} jaNaCli={det?.clis ?? []} aoMudar={recarregar} aoFechar={() => setCli(false)} /> : null}
    </aside>
  );
}

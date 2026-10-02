// Consentimento explícito (instalar, instalar o Kit, atualizar): mostra o comando EXATO que o instalador executa, o que o Pane
// executa, pasta, hosts, riscos, nível e o `comando_hash` que a UI reenvia (consentimento por versão). Nada instala sem o "Entendi".
import { useId, useState } from "react";
import type { BloqueioPlanoDto, DiffAtualizacaoMcp, PlanoInstalacaoDto } from "../../../compartilhado/loja-mcp";
import { Dialogo } from "../../componentes/Dialogo";
import { mensagemDoCodigo, ROTULO_NIVEL, rotuloRisco } from "./logica";

async function copiar(texto: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(texto); return true; } catch { return false; }
}

/** Texto copiável: o comando de instalação, linha a linha, byte a byte o que o instalador roda. */
export const textoDoComando = (p: PlanoInstalacaoDto): string => (p.comando_instalacao.length > 0 ? p.comando_instalacao.join("\n") : "(sem comando: servidor remoto, nada é baixado)");

const AVISO_TOM: Record<string, string> = { info: "info", atencao: "atenção", alto: "alto" };

function PlanoCaixa({ p }: { p: PlanoInstalacaoDto }) {
  const [copiado, setCopiado] = useState(false);
  const perm = p.permissoes;
  return (
    <section className="lm-plano" aria-label={`Plano: ${p.nome}`}>
      <h3>{p.nome}{p.versao !== null ? <span className="lm-versao"> @{p.versao}</span> : null}</h3>
      <dl className="lm-dl">
        <dt>Instalador executa</dt>
        <dd>
          <pre className="lm-codigo" aria-label={`Comando de instalação de ${p.nome}`}>{textoDoComando(p)}</pre>
          <button type="button" className="botao lm-mini" onClick={() => { void copiar(textoDoComando(p)).then((ok) => setCopiado(ok)); }}>{copiado ? "Copiado" : "Copiar comando"}</button>
        </dd>
        <dt>O terminal executa</dt>
        <dd><pre className="lm-codigo" aria-label={`Comando de execução de ${p.nome}`}>{p.comando_exato}</pre></dd>
        <dt>Pasta</dt>
        <dd><code>{p.pasta ?? "nenhuma (servidor remoto)"}</code></dd>
        <dt>Rede (instalação)</dt>
        <dd>{perm.hosts_rede.instalacao.length > 0 ? perm.hosts_rede.instalacao.join(", ") : "nenhuma"}</dd>
        <dt>Rede (execução)</dt>
        <dd>{perm.hosts_rede.execucao_livre ? "livre (o servidor acessa o que a tarefa pedir)" : perm.hosts_rede.execucao.length > 0 ? perm.hosts_rede.execucao.join(", ") : "nenhuma"}</dd>
        <dt>Verificação</dt>
        <dd>{ROTULO_NIVEL[p.nivel_verificacao]}{perm.integridade !== null ? <> · <code>{perm.integridade.slice(0, 24)}…</code></> : null}</dd>
        <dt>Variáveis</dt>
        <dd>{perm.variaveis.length === 0 ? "nenhuma" : perm.variaveis.map((v) => `${v.nome}${v.obrigatoria ? " (obrigatória)" : ""}${v.secreta ? " · secreta" : ""}`).join("; ")}</dd>
        <dt>Riscos</dt>
        <dd>{perm.riscos.length === 0 ? "nenhum declarado" : perm.riscos.map(rotuloRisco).join(", ")}{perm.riscos_texto !== "" ? <p className="lm-nota">{perm.riscos_texto}</p> : null}</dd>
        <dt>Hash do comando</dt>
        <dd><code className="lm-hash" aria-label={`Hash de ${p.nome}`}>{p.comando_hash}</code></dd>
      </dl>
      {perm.scripts_permitidos ? <p className="aviso-caixa lm-aviso"><strong>Scripts de instalação permitidos:</strong> este pacote roda scripts ao instalar.</p> : null}
      {p.avisos.map((a) => <p key={a.codigo} className="lm-aviso-linha" data-nivel={a.nivel}><strong>{AVISO_TOM[a.nivel] ?? a.nivel}:</strong> {a.texto}</p>)}
    </section>
  );
}

function Bloqueios({ itens }: { itens: readonly BloqueioPlanoDto[] }) {
  if (itens.length === 0) return null;
  return (
    <ul className="lm-bloqueios" aria-label="Não instaláveis">
      {itens.map((b) => <li key={b.id}><strong>{b.id}</strong>: {b.motivo !== "" ? b.motivo : mensagemDoCodigo(b.codigo)}{b.acao !== null ? <> {b.acao}</> : null}</li>)}
    </ul>
  );
}

export interface PropsConsentimento {
  titulo: string;
  rotuloConfirmar: string;
  planos: readonly PlanoInstalacaoDto[];
  bloqueios: readonly BloqueioPlanoDto[];
  /** só para o Kit: hash do CONJUNTO (um consentimento para vários comandos). */
  hashConjunto?: string;
  ocupado?: boolean;
  erro?: string | null;
  aoConfirmar: () => void;
  aoFechar: () => void;
}

export function DialogoConsentimento({ titulo, rotuloConfirmar, planos, bloqueios, hashConjunto, ocupado = false, erro = null, aoConfirmar, aoFechar }: PropsConsentimento) {
  const [entendi, setEntendi] = useState(false);
  const id = useId();
  const vazio = planos.length === 0;
  return (
    <Dialogo titulo={titulo} aoFechar={aoFechar} largura={720}>
      <div className="dialogo-corpo lm-consentimento">
        <p>Confira o que vai acontecer. Nada é instalado sem o seu clique, e o agente nunca instala sozinho.</p>
        {hashConjunto !== undefined ? <p className="lm-nota">Hash do conjunto: <code className="lm-hash">{hashConjunto}</code></p> : null}
        {planos.map((p) => <PlanoCaixa key={p.id} p={p} />)}
        <Bloqueios itens={bloqueios} />
        {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}
        {vazio ? null : (
          <label className="lm-entendi" htmlFor={id}>
            <input id={id} type="checkbox" checked={entendi} onChange={(e) => setEntendi(e.target.checked)} /> Entendi o que será executado e aceito instalar {planos.length > 1 ? "estes servidores" : "este servidor"}.
          </label>
        )}
      </div>
      <div className="dialogo-acoes">
        <button type="button" className="botao" data-foco-inicial onClick={aoFechar}>Cancelar</button>
        <button type="button" className="botao botao-primario" disabled={vazio || !entendi || ocupado} onClick={aoConfirmar}>{ocupado ? "Enviando…" : rotuloConfirmar}</button>
      </div>
    </Dialogo>
  );
}

export interface PropsAtualizacao {
  nome: string;
  diff: DiffAtualizacaoMcp;
  ocupado?: boolean;
  erro?: string | null;
  aoConfirmar: () => void;
  aoFechar: () => void;
}

/** Atualização: mostra diff de comando, variáveis e riscos e exige NOVO consentimento (nunca automática, D-131). */
export function DialogoAtualizacao({ nome, diff, ocupado = false, erro = null, aoConfirmar, aoFechar }: PropsAtualizacao) {
  const [entendi, setEntendi] = useState(false);
  const id = useId();
  return (
    <Dialogo titulo={`Atualizar ${nome}`} aoFechar={aoFechar} largura={680}>
      <div className="dialogo-corpo lm-consentimento">
        <p>Versão {diff.versao_de ?? "—"} → <strong>{diff.versao_para ?? "—"}</strong>. A pasta antiga só é descartada depois do teste de saúde; se falhar, ela é restaurada.</p>
        <dl className="lm-dl">
          <dt>Comando antes</dt><dd><pre className="lm-codigo">{diff.comando.antes ?? "(não havia)"}</pre></dd>
          <dt>Comando depois</dt><dd><pre className="lm-codigo" aria-label="Comando depois da atualização">{diff.comando.depois}</pre></dd>
          <dt>Variáveis</dt>
          <dd>{diff.variaveis.adicionadas.length + diff.variaveis.removidas.length === 0 ? "sem mudança" : `+ ${diff.variaveis.adicionadas.join(", ") || "nenhuma"} · − ${diff.variaveis.removidas.join(", ") || "nenhuma"}`}</dd>
          <dt>Riscos</dt>
          <dd>{diff.riscos.adicionados.length + diff.riscos.removidos.length === 0 ? "sem mudança" : `+ ${diff.riscos.adicionados.map(rotuloRisco).join(", ") || "nenhum"} · − ${diff.riscos.removidos.map(rotuloRisco).join(", ") || "nenhum"}`}</dd>
          <dt>Hash do comando</dt><dd><code className="lm-hash">{diff.comando_hash}</code></dd>
        </dl>
        {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}
        <label className="lm-entendi" htmlFor={id}>
          <input id={id} type="checkbox" checked={entendi} onChange={(e) => setEntendi(e.target.checked)} /> Entendi as mudanças e aceito atualizar.
        </label>
      </div>
      <div className="dialogo-acoes">
        <button type="button" className="botao" data-foco-inicial onClick={aoFechar}>Cancelar</button>
        <button type="button" className="botao botao-primario" disabled={!entendi || ocupado || !diff.disponivel} onClick={aoConfirmar}>{ocupado ? "Enviando…" : "Atualizar"}</button>
      </div>
    </Dialogo>
  );
}

import { useState } from "react";
import type { EntradaCofre, EscopoCofre, EstadoCofre } from "../../../compartilhado/harness";
import { ESCOPOS_COFRE } from "../../../compartilhado/harness";
import { Dialogo } from "../../componentes/Dialogo";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { ItemLista } from "../../componentes/ItemLista";
import { VirtualLista } from "../../componentes/VirtualLista";
import { useCarga } from "../../estado/carga";
import { formatarHora } from "../../estado/limites-formato";
import type { ApiCofre } from "./tipos";
import { validarNomeCofre } from "./validar";

export const ALTURA_COFRE = 56;
export const MASCARA = "••••••••";
const PROXIMO_PASSO: Record<string, string> = { indisponivel: "O cofre do sistema não está disponível. Em Linux sem keyring, defina uma senha-mestra; nos demais, verifique o chaveiro do sistema." };

function Formulario({ api, workspaceId, existente, aoFim }: { api: ApiCofre | undefined; workspaceId: string | null; existente: EntradaCofre | null; aoFim: (mudou: boolean) => void }) {
  const [nome, setNome] = useState(existente?.nome ?? "");
  const [escopo, setEscopo] = useState<EscopoCofre>(existente?.escopo ?? "global");
  const [sensivel, setSensivel] = useState(existente?.sensivel ?? true);
  const [valor, setValor] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const erroNome = existente === null && nome !== "" ? validarNomeCofre(nome) : null;
  const gravar = async () => {
    const e = existente === null ? validarNomeCofre(nome) : null;
    if (e !== null) { setErro(e); return; }
    if (valor === "") { setErro(existente === null ? "Informe o valor do segredo." : "Informe o novo valor para substituir o atual."); return; }
    if (escopo === "workspace" && workspaceId === null) { setErro("Abra um projeto para guardar uma entrada de escopo workspace."); return; }
    try {
      const v = valor;
      setValor(""); // descartado do estado antes mesmo da resposta
      await api?.gravar?.({ id: existente?.id ?? null, nome: existente?.nome ?? nome, escopo, workspace_id: escopo === "workspace" ? workspaceId : null, sensivel, valor: v });
      aoFim(true);
    } catch (x) { setErro(`Não foi possível gravar: ${x instanceof Error ? x.message : String(x)}`); }
  };
  return (
    <Dialogo titulo={existente === null ? "Nova entrada do cofre" : `Substituir ${existente.nome}`} aoFechar={() => { setValor(""); aoFim(false); }}>
      <label className="h-campo">Nome<input data-foco-inicial disabled={existente !== null} value={nome} aria-invalid={erroNome !== null} onChange={(e) => { setNome(e.target.value.toUpperCase()); setErro(null); }} placeholder="MINHA_CHAVE" />{erroNome !== null ? <span role="alert" className="h-erro">{erroNome}</span> : null}</label>
      <label className="h-campo">Escopo<select value={escopo} disabled={existente !== null} onChange={(e) => setEscopo(e.target.value as EscopoCofre)}>{ESCOPOS_COFRE.map((s) => <option key={s} value={s}>{s === "global" ? "Global" : "Workspace atual"}</option>)}</select></label>
      <label><input type="checkbox" checked={sensivel} onChange={(e) => setSensivel(e.target.checked)} /> sensível (nunca aparece em logs ou eventos)</label>
      <label className="h-campo">Valor (não pode ser lido de volta)<input type="password" autoComplete="off" spellCheck={false} value={valor} onChange={(e) => { setValor(e.target.value); setErro(null); }} /></label>
      {erro !== null ? <p role="alert" className="h-erro">{erro}</p> : null}
      <div className="dialogo-acoes">
        <button type="button" className="botao" onClick={() => { setValor(""); aoFim(false); }}>Cancelar</button>
        <button type="button" className="botao botao-primario" onClick={() => void gravar()}>Gravar no cofre</button>
      </div>
    </Dialogo>
  );
}

/** Metadados do cofre: nome, escopo, selo "sensível". O valor nunca é exibido nem copiável. */
export function Cofre({ api, workspaceId, busca }: { api: ApiCofre | undefined; workspaceId: string | null; busca: string }) {
  const [n, setN] = useState(0);
  const est = useCarga<EstadoCofre>(api?.disponivel === undefined ? undefined : () => api.disponivel!(), `cofre-est|${n}`);
  const bloqueado = est.dados?.bloqueado === true;
  const lista = useCarga<EntradaCofre[]>(api?.listar === undefined || est.dados === null || !est.dados.ok || bloqueado ? undefined : () => api.listar!(), `cofre|${n}|${est.dados?.ok}|${bloqueado}`);
  const [form, setForm] = useState<{ existente: EntradaCofre | null } | null>(null);
  const [apagar, setApagar] = useState<EntradaCofre | null>(null);
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const recarregar = () => setN((x) => x + 1);

  const trancar = async (acao: "desbloquear" | "definir") => {
    try { const s = senha; setSenha(""); if (acao === "desbloquear") await api?.desbloquear?.(s); else await api?.definirSenhaMestra?.(s); setErro(null); recarregar(); }
    catch (e) { setSenha(""); setErro(`Senha recusada ou cofre indisponível: ${e instanceof Error ? e.message : String(e)}`); }
  };
  const confirmarApagar = async () => {
    if (apagar === null) return;
    try { await api?.apagar?.(apagar.id); setApagar(null); recarregar(); }
    catch (e) { setErro(`Não foi possível apagar: ${e instanceof Error ? e.message : String(e)}`); setApagar(null); }
  };
  const b = busca.trim().toLowerCase();
  const itens = (lista.dados ?? []).filter((e) => b === "" || e.nome.toLowerCase().includes(b));

  if (est.estado === "indisponivel") return <EstadoVazio icone="harness" titulo="Cofre indisponível" texto="Este build ainda não expõe o cofre de segredos." />;
  if (est.dados === null) return <p className="h-nota" aria-busy="true">Verificando o cofre…</p>;
  if (!est.dados.ok) return <EstadoVazio icone="aviso" titulo="Cofre indisponível" texto={`${est.dados.motivo ?? "O cofre não pôde ser aberto."} ${PROXIMO_PASSO.indisponivel}`} />;
  return (
    <div className="harness-corpo-alto">
      <div className="h-secao">
        <h2>Cofre de segredos</h2>
        <p className="h-nota">Backend: {est.dados.backend === "safe_storage" ? "cofre do sistema" : "senha-mestra"}. Os valores ficam cifrados e nunca voltam para a tela: só metadados são listados.</p>
        {bloqueado ? (
          <div className="h-linha-simples" role="group" aria-label="Cofre trancado">
            <input type="password" autoComplete="off" aria-label="Senha-mestra" value={senha} onChange={(e) => setSenha(e.target.value)} />
            <button type="button" className="botao-mini" onClick={() => void trancar("desbloquear")}>Desbloquear</button>
            <button type="button" className="botao-mini" onClick={() => void trancar("definir")}>Definir senha-mestra</button>
          </div>
        ) : (
          <div className="h-linha-simples">
            <button type="button" className="botao-mini" onClick={() => setForm({ existente: null })}>Nova entrada</button>
            {est.dados.backend === "senha_mestra" ? <button type="button" className="botao-mini" onClick={() => void api?.bloquear?.().then(recarregar)}>Trancar cofre</button> : null}
          </div>
        )}
        {erro !== null ? <p role="alert" className="h-erro">{erro}</p> : null}
      </div>
      {bloqueado ? <EstadoVazio icone="aviso" titulo="Cofre trancado" texto="Informe a senha-mestra para ver e gerenciar as entradas." />
        : lista.estado === "erro" ? <p role="alert" className="h-erro">Não foi possível ler o cofre: {lista.mensagem}</p>
        : lista.dados === null ? <p className="h-nota" aria-busy="true">Carregando…</p>
        : itens.length === 0 ? <EstadoVazio icone="harness" titulo="Cofre vazio" texto="Guarde aqui chaves de provedores e do decisor. Use “Nova entrada”; o valor é gravado direto no cofre cifrado." />
        : (
          <VirtualLista
            itens={itens}
            alturaItem={ALTURA_COFRE}
            rotulo="Entradas do cofre"
            className="h-lista"
            chave={(e) => e.id}
            renderItem={(e) => (
              <ItemLista
                id={e.id}
                titulo={e.nome}
                selos={[
                  { texto: e.escopo === "global" ? "global" : "workspace" },
                  ...(e.sensivel ? [{ texto: "sensível", tom: "aviso" as const }] : []),
                ]}
                meta={<><span className="h-mascara" aria-label="valor oculto">{MASCARA}</span> · {e.ultimo_uso_em !== null ? `usado ${formatarHora(e.ultimo_uso_em)}` : "nunca usado"}</>}
                acao={<>
                  <button type="button" className="botao-mini" aria-label={`Substituir ${e.nome}`} onClick={() => setForm({ existente: e })}>Substituir</button>
                  <button type="button" className="botao-mini" aria-label={`Apagar ${e.nome}`} onClick={() => setApagar(e)}>Apagar</button>
                </>}
              />
            )}
          />
        )}
      {form !== null ? <Formulario api={api} workspaceId={workspaceId} existente={form.existente} aoFim={(m) => { setForm(null); if (m) recarregar(); }} /> : null}
      {apagar !== null ? (
        <Dialogo titulo={`Apagar ${apagar.nome}?`} aoFechar={() => setApagar(null)}>
          <div className="dialogo-corpo"><p>A entrada e o valor cifrado somem do cofre. Quem dependia dela (por exemplo o decisor) passa a falhar até você guardar outra.</p></div>
          <div className="dialogo-acoes">
            <button type="button" className="botao" onClick={() => setApagar(null)}>Cancelar</button>
            <button type="button" className="botao botao-perigo" onClick={() => void confirmarApagar()}>Apagar entrada</button>
          </div>
        </Dialogo>
      ) : null}
    </div>
  );
}

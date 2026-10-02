import { useEffect, useId, useState } from "react";
import { ade } from "../../ade";
import { lerPreferencia, PREF_FETCH_FUNDO, PREF_PR_INICIO, type ApiConfig } from "./preferencias-vcs";

/** Preferências opt-in do versionamento (T-06.35 e P-22): tudo desligado por padrão; nada sai da máquina sem ligar aqui ou sem clique. */
export function PreferenciasVcs({ config = ade()?.config }: { config?: ApiConfig | undefined }) {
  const [aberto, setAberto] = useState(false);
  const [fundo, setFundo] = useState(false);
  const [pr, setPr] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const painel = useId();

  useEffect(() => {
    if (!aberto) return undefined;
    let vivo = true;
    void lerPreferencia(config, PREF_FETCH_FUNDO).then((v) => { if (vivo) setFundo(v); });
    void lerPreferencia(config, PREF_PR_INICIO).then((v) => { if (vivo) setPr(v); });
    return () => { vivo = false; };
  }, [aberto, config]);

  if (config === undefined) return null;
  const gravar = async (chave: string, valor: boolean, aplicar: (v: boolean) => void): Promise<void> => {
    setErro(null);
    try { await config.gravar(chave, valor); aplicar(valor); } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <span className="vc-prefs">
      <button type="button" className="vc-icone" aria-label="Preferências do versionamento" aria-expanded={aberto} aria-controls={painel} title="Preferências do versionamento" onClick={() => setAberto((v) => !v)}>⚙</button>
      {aberto ? (
        <div id={painel} className="vc-prefs-painel" role="group" aria-label="Preferências do versionamento">
          <label>
            <input type="checkbox" checked={fundo} onChange={(e) => void gravar(PREF_FETCH_FUNDO, e.target.checked, setFundo)} />
            {" "}Buscar do remoto em segundo plano
          </label>
          <p className="vc-pasta">A cada 5 minutos, só com esta tela aberta e a janela em foco. É apenas fetch: nunca envia nem altera sua árvore.</p>
          <label>
            <input type="checkbox" checked={pr} onChange={(e) => void gravar(PREF_PR_INICIO, e.target.checked, setPr)} />
            {" "}Mostrar PRs e checks no Início e nas Missões
          </label>
          <p className="vc-pasta">Consulta o provedor (GitHub, GitLab, Bitbucket, Azure) pelo seu login. No Início, só quando você clica em Atualizar.</p>
          {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}
        </div>
      ) : null}
    </span>
  );
}

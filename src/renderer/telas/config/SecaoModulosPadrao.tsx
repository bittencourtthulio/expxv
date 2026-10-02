import "../../casca/suite.css";
import { useEffect, useState } from "react";
import { MODULOS, mudarModulo, type EstadoModulos, type ModuloId } from "../../../nucleo/suite/modulos";
import { CATALOGO_SUITE } from "../../../nucleo/suite/catalogo";
import { storeSuite, useSuite, type StoreSuite } from "../../estado/suite";

/**
 * Configurações › Módulos padrão para projetos novos: a preferência GLOBAL que semeia o arquivo `modulos.json` da pasta do produto quando a suíte é instalada num projeto que ainda não tem o
 * arquivo (e o que "Restaurar padrões" restaura). De fábrica tudo ligado, exceto o legadox. Não muda projetos que já têm o arquivo.
 */
export function SecaoModulosPadrao({ store = storeSuite }: { store?: StoreSuite }) {
  const ui = useSuite(store);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  useEffect(() => store.ligar(), [store]);
  useEffect(() => { void store.carregarPadraoGlobal(); }, [store]);
  const g = ui.padraoGlobal;
  if (g === null) return <section className="mod-secao"><h3>Módulos padrão para projetos novos</h3><p className="suite-suave" role="status">{ui.erroModulos ?? "Lendo…"}</p></section>;
  const atual = g.modulos as unknown as EstadoModulos;

  const mudar = async (m: ModuloId, ligado: boolean): Promise<void> => {
    setErro(null);
    setAviso(null);
    // aqui o padrão é só uma lista de interruptores: se a mudança arrasta outros módulos, aplica junto e avisa (nenhum projeto é tocado)
    const r = mudarModulo(atual, m, ligado, true);
    if (!r.ok) return;
    const e = await store.definirPadraoGlobal({ ...r.estado });
    if (e !== null) setErro(e);
    else if (r.mudou.length > 1) setAviso(`Também ajustado: ${r.mudou.filter((x) => x !== m).join(", ")} (dependem de ${m}).`);
  };
  const restaurar = async (): Promise<void> => {
    setErro(null);
    setAviso(null);
    const e = await store.definirPadraoGlobal({ ...g.fabrica });
    if (e !== null) setErro(e);
  };
  return (
    <section className="mod-secao" aria-label="Módulos padrão para projetos novos">
      <h3>Módulos padrão para projetos novos</h3>
      <p className="suite-suave">Vale quando a suíte ExpxDev é instalada num projeto que ainda não tem a configuração de módulos. De fábrica, tudo fica ligado, menos o legadox (a maioria dos projetos não é legado). Projetos que já têm a configuração não mudam.</p>
      <ul className="mod-lista" aria-label="Módulos padrão">
        {CATALOGO_SUITE.map((c) => {
          const id = c.nome as ModuloId;
          const ligado = atual[id];
          return (
            <li key={id} className="mod-item" data-ligado={ligado || undefined} data-modulo={id}>
              <div className="mod-texto">
                <span className="mod-nome" id={`pad-${id}`}>{id}</span>
                <span className="mod-papel" id={`pad-${id}-d`}>{c.papel}</span>
              </div>
              <button type="button" role="switch" aria-checked={ligado} aria-labelledby={`pad-${id}`} aria-describedby={`pad-${id}-d`} className="mod-interruptor" onClick={() => void mudar(id, !ligado)}>
                <span className="mod-trilho" aria-hidden="true"><span className="mod-botao" /></span>
                <span className="mod-estado">{ligado ? "Ligado" : "Desligado"}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {aviso !== null ? <p className="suite-aviso" role="status">{aviso}</p> : null}
      {erro !== null ? <p className="suite-erro" role="alert">{erro}</p> : null}
      <div className="mod-rodape">
        <span className="suite-suave">{MODULOS.filter((m) => atual[m]).length} de {MODULOS.length} ligados por padrão.</span>
        <button type="button" className="botao" onClick={() => void restaurar()}>Restaurar o padrão de fábrica</button>
      </div>
    </section>
  );
}

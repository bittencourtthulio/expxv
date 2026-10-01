import type { CamadasProjeto, IndiceProjeto } from "../../../nucleo/metodo/tipos";
import { SCHEMA_SUPORTADO } from "../../../nucleo/metodo/tipos";

interface DefCamada { chave: keyof CamadasProjeto; nome: string; comando: string }

const CAMADAS: readonly DefCamada[] = [
  { chave: "lock", nome: "Instalação do método (expx-lock)", comando: "expx init" },
  { chave: "hooks", nome: "Hooks de proteção", comando: "expx init" },
  { chave: "convencoes", nome: "Convenções do stack (stackx)", comando: "/expx:stackx-detectar" },
  { chave: "perfil_legado", nome: "Perfil do legado (legadox)", comando: "/expx:legadox-perfil" },
  { chave: "design_system", nome: "Design system (designx)", comando: "/expx:designx-cartography" },
  { chave: "produto", nome: "Contexto de produto (prodx)", comando: "/expx:prodx-produto" },
  { chave: "memoria", nome: "Memória do projeto (memox)", comando: "/expx:memox-indexar" },
];

// Modos de nascimento documentados (somente leitura): métodos em aviso, segurança em bloqueio.
const HOOKS_PADRAO: readonly { nome: string; modo: "aviso" | "bloqueio" }[] = [
  { nome: "segredo-no-commit", modo: "bloqueio" },
  { nome: "git-perigoso", modo: "bloqueio" },
  { nome: "task-so-fecha-verde", modo: "aviso" },
  { nome: "tdd-teste-antes", modo: "aviso" },
  { nome: "escopo-da-task", modo: "aviso" },
  { nome: "pr-so-com-portao", modo: "aviso" },
];

export function Instalacao({ indice }: { indice: IndiceProjeto }) {
  const faltam = CAMADAS.filter((c) => !indice.camadas[c.chave]);
  const schema = indice.rejeicoes.filter((r) => r.motivo === "schema_maior");
  return (
    <div className="met-instalacao">
      {schema.length > 0 ? (
        <div className="met-alerta" role="alert">
          <b>Incompatibilidade de expx_schema.</b> {schema.length} arquivo(s) usam um schema mais novo que o suportado (v{SCHEMA_SUPORTADO}); foram ignorados. Atualize o app.
          <ul>{schema.slice(0, 10).map((r) => <li key={r.caminho}><code>{r.caminho}</code></li>)}</ul>
        </div>
      ) : null}
      <h3>Camadas do método</h3>
      <ul className="met-camadas">
        {CAMADAS.map((c) => {
          const ok = indice.camadas[c.chave];
          return (
            <li key={c.chave} data-ok={ok ? "true" : "false"}>
              <i aria-hidden="true">{ok ? "✓" : "○"}</i>
              <span><b>{c.nome}</b> — {ok ? "instalada" : "não instalada"}</span>
              {!ok ? <span className="met-suave">Para instalar, rode: <code>{c.comando}</code></span> : null}
            </li>
          );
        })}
      </ul>
      {faltam.length === 0 ? <p className="met-ok">Todas as camadas estão instaladas.</p> : <p className="met-suave">Faltam {faltam.length} camada(s). O app só mostra o comando; quem roda é você, em um Pane.</p>}
      <h3>Hooks (somente leitura)</h3>
      {indice.camadas.hooks ? (
        <ul className="met-hooks">
          {HOOKS_PADRAO.map((h) => <li key={h.nome}><code>{h.nome}</code> <span className="met-chip" data-modo={h.modo}>{h.modo}</span></li>)}
        </ul>
      ) : <p className="met-suave">Hooks não instalados: valem os padrões de nascimento (métodos em aviso, segurança em bloqueio).</p>}
      <p className="met-suave">Modos exibidos são os padrões de nascimento; promover aviso para bloqueio é decisão sua em <code>.expx/hooks.json</code>. Este app não edita esse arquivo.</p>
    </div>
  );
}

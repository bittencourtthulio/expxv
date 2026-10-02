// Configurações → Voz e captura (Fase 11, T-11.13/T-11.21): motor de voz (nenhum, comando local, HTTP compatível), consentimento com o host exato, chave (só entra, nunca volta), idioma, disparo,
// atalho com TESTE DE TECLA, dicionário, histórico em memória, permissões (microfone e tela) e captura (fps, atalhos globais opt-in). Tudo nasce desligado: sem motor, o ditado não existe.
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import type { ApiCaptura, ApiVoz, EstadoCaptura, EstadoPermissao, EstadoVoz, MotorVoz, TermoVoz } from "../../../compartilhado/captura";
import { ade } from "../../ade";
import { pedirCaptura } from "../../estado/captura-acoes";
import { VirtualLista } from "../../componentes/VirtualLista";
import { combinacaoDeEvento, rotuloDoAtalho } from "../../voz/logica";
import { VozLocal } from "./VozLocal";

const EH_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const limpar = (e: unknown): string => (e instanceof Error ? e.message.replace(/^\[[a-z_]+\] /, "") : "Não foi possível concluir.");
const ROTULO_PERMISSAO: Record<EstadoPermissao, string> = { concedida: "concedida", negada: "negada", indeterminada: "ainda não pedida", restrita: "restrita pelo sistema" };
const ROTULO_MOTOR: Record<MotorVoz, string> = { local_embutido: "Local neste computador (recomendado)", nenhum: "Nenhum (desligado)", comando_local: "Avançado: comando local externo", http_compativel: "Avançado: servidor HTTP compatível (remoto)" };
const LIMITE_VIRTUAL = 100;

function Chave({ rotulo, ligada, desabilitada = false, ajuda, aoMudar }: { rotulo: string; ligada: boolean; desabilitada?: boolean; ajuda?: string; aoMudar: (v: boolean) => void }): ReactElement {
  return (
    <div className="cfg-linha cfgv-linha">
      <button type="button" role="switch" aria-checked={ligada} disabled={desabilitada} className="botao" onClick={() => aoMudar(!ligada)}>{rotulo}: {ligada ? "ligada" : "desligada"}</button>
      {ajuda !== undefined ? <span className="cfg-ajuda cfgv-nota">{ajuda}</span> : null}
    </div>
  );
}

/** Captura a combinação de teclas e só aceita se o `keydown` E o `keyup` reais chegaram (prova de que o atalho funciona neste teclado e fora do que o sistema engole). */
function TesteTecla({ atual, aoSalvar }: { atual: string; aoSalvar: (combinacao: string) => Promise<void> }): ReactElement {
  const [vista, setVista] = useState<string | null>(null);
  const [solta, setSolta] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ativo, setAtivo] = useState(false);
  const campo = useRef<HTMLButtonElement>(null);
  const baixo = (e: React.KeyboardEvent): void => {
    if (!ativo) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") { setAtivo(false); setVista(null); setAviso(null); return; }
    const c = combinacaoDeEvento({ key: e.key, code: e.code, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey }, EH_MAC);
    if (c === null) { setAviso("Use um modificador mais uma tecla (ex.: ⌘⇧Espaço). Modificador sozinho (como a Option direita) não é aceito: o sistema não avisa quando ele é solto."); setVista(null); return; }
    setAviso(null);
    setSolta(false);
    setVista(c);
  };
  const cima = (e: React.KeyboardEvent): void => { if (ativo && vista !== null) { e.preventDefault(); setSolta(true); } };
  return (
    <div className="cfgv-tecla">
      <div className="cfg-linha cfgv-linha">
        <span>Atalho atual: <kbd>{rotuloDoAtalho(atual, EH_MAC)}</kbd></span>
        <button ref={campo} type="button" className="botao" aria-pressed={ativo} onClick={() => { setAtivo(!ativo); setVista(null); setSolta(false); setAviso(null); }} onKeyDown={baixo} onKeyUp={cima} onBlur={() => setAtivo(false)}>
          {ativo ? "Pressione e solte a combinação… (Esc cancela)" : "Testar nova tecla"}
        </button>
        {vista !== null ? <span role="status">Detectado: <kbd>{rotuloDoAtalho(vista, EH_MAC)}</kbd>{solta ? " · soltar confirmado" : " · solte a tecla para confirmar"}</span> : null}
        <button type="button" className="botao botao-primario" disabled={vista === null || !solta} onClick={() => { if (vista !== null) void aoSalvar(vista).then(() => { setVista(null); setSolta(false); setAtivo(false); }); }}>Salvar atalho</button>
      </div>
      {aviso !== null ? <p role="alert" className="cfg-erro">{aviso}</p> : null}
    </div>
  );
}

interface Props { voz?: ApiVoz | undefined; captura?: ApiCaptura | undefined }

export function SecaoVozCaptura({ voz = ade()?.voz, captura = ade()?.captura }: Props): ReactElement {
  const [ev, setEv] = useState<EstadoVoz | null>(null);
  const [ec, setEc] = useState<EstadoCaptura | null>(null);
  const [termos, setTermos] = useState<TermoVoz[]>([]);
  const [falas, setFalas] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // rascunhos do motor (só gravam ao clicar em "Salvar motor")
  const [motor, setMotor] = useState<MotorVoz>("nenhum");
  const [exe, setExe] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [modelo, setModelo] = useState("");
  const [chave, setChave] = useState("");
  const [novoTermo, setNovoTermo] = useState("");
  const [novaDica, setNovaDica] = useState("");
  const [todosTermos, setTodosTermos] = useState(false);

  const aplicar = useCallback((e: EstadoVoz) => {
    setEv(e);
    setMotor(e.motor);
    setExe(e.comando_executavel ?? "");
    setArgs(e.comando_args.join("\n"));
    setUrl(e.url ?? "");
    setModelo(e.modelo ?? "");
  }, []);

  useEffect(() => {
    void voz?.estado().then(aplicar).catch((e: unknown) => setErro(limpar(e)));
    void voz?.dicionarioListar().then(setTermos).catch(() => undefined);
    void voz?.historicoListar().then((h) => setFalas(h.length)).catch(() => undefined);
    void captura?.estado().then(setEc).catch(() => undefined);
  }, [voz, captura, aplicar]);

  const rodar = async (fn: () => Promise<unknown>, ok?: string): Promise<void> => {
    setErro(null);
    setMsg(null);
    try { await fn(); if (ok !== undefined) setMsg(ok); } catch (e) { setErro(limpar(e)); }
  };

  if (voz === undefined && captura === undefined) {
    return (
      <section className="cfg-secao" aria-label="Voz e captura">
        <h2>Voz e captura</h2>
        <p className="cfg-ajuda">Disponível no aplicativo desktop.</p>
      </section>
    );
  }

  const salvarMotor = (): Promise<void> => rodar(async () => {
    if (voz === undefined) return;
    const patch = motor === "comando_local"
      ? { motor, comando_executavel: exe.trim() === "" ? null : exe.trim(), comando_args: args.split("\n").map((l) => l.trim()).filter((l) => l !== ""), modelo: modelo.trim() === "" ? null : modelo.trim() }
      : motor === "http_compativel" ? { motor, url: url.trim() === "" ? null : url.trim(), modelo: modelo.trim() === "" ? null : modelo.trim() } : { motor };
    aplicar(await voz.configGravar(patch));
  }, "Motor salvo.");

  const pedirMic = (): Promise<void> => rodar(async () => {
    if (voz === undefined) return;
    await voz.configGravar({ aviso_microfone_visto: true });
    const r = await voz.pedirMicrofone();
    aplicar(await voz.estado());
    setMsg(`Microfone: ${ROTULO_PERMISSAO[r.estado]}.`);
  });

  return (
    <section className="cfg-secao cfgv-secao" aria-label="Voz e captura">
      <h2>Voz e captura</h2>
      <p className="cfg-ajuda">Falar o prompt no terminal e mostrar o bug em imagem. Tudo local por padrão; nada sai do computador sem o seu aceite, e áudio nunca é gravado em disco.</p>
      {erro !== null ? <p role="alert" className="cfg-erro">{erro}</p> : null}
      {msg !== null ? <p role="status" className="cfg-ajuda">{msg}</p> : null}

      {voz !== undefined && ev !== null ? (
        <>
          <div role="group" aria-label="Motor de voz" className="cfgv-grupo">
            <h3>Motor de voz</h3>
            <p className="cfg-ajuda">Sem motor configurado o ditado não existe: nada é baixado nem instalado sem o seu aceite. O recomendado é a voz local embutida (roda neste computador, sem enviar áudio a ninguém); o comando local e o serviço HTTP compatível são opções avançadas.</p>
            <div className="cfg-linha cfgv-linha">
              <label>Motor <select value={motor} onChange={(e) => setMotor(e.target.value as MotorVoz)} aria-label="Motor de voz" title={ROTULO_MOTOR[motor]}>
                <option value="local_embutido">Local neste computador (recomendado)</option>
                <option value="nenhum">Nenhum (desligado)</option>
                <option value="comando_local">Avançado: comando local externo</option>
                <option value="http_compativel">Avançado: servidor HTTP compatível (remoto)</option>
              </select></label>
              {motor === "nenhum" ? <button type="button" className="botao botao-primario" onClick={() => setMotor("local_embutido")}>Configurar voz local (recomendado)</button> : null}
            </div>
            {motor === "local_embutido" ? <VozLocal voz={voz} ev={ev} aoAtualizar={() => void voz.estado().then(aplicar).catch(() => undefined)} /> : null}
            {motor === "comando_local" ? (
              <div className="cfgv-campos">
                <label>Executável (caminho absoluto)<input type="text" value={exe} onChange={(e) => setExe(e.target.value)} spellCheck={false} placeholder="/caminho/para/whisper-cli" /></label>
                <label>Argumentos (um por linha; use {"{wav}"}, {"{idioma}"}, {"{modelo}"})<textarea value={args} onChange={(e) => setArgs(e.target.value)} rows={3} spellCheck={false} placeholder={"-f\n{wav}\n-l\n{idioma}"} /></label>
                <label>Modelo (opcional)<input type="text" value={modelo} onChange={(e) => setModelo(e.target.value)} spellCheck={false} /></label>
              </div>
            ) : null}
            {motor === "http_compativel" ? (
              <div className="cfgv-campos">
                <label>URL base (https)<input type="text" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} placeholder="https://servidor.exemplo/v1" /></label>
                <label>Modelo (opcional)<input type="text" value={modelo} onChange={(e) => setModelo(e.target.value)} spellCheck={false} /></label>
                <div className="cfg-linha cfgv-linha">
                  <label>Chave do serviço<input type="password" value={chave} onChange={(e) => setChave(e.target.value)} autoComplete="off" spellCheck={false} aria-describedby="cfgv-chave-ajuda" /></label>
                  <button type="button" className="botao" disabled={chave === ""} onClick={() => void rodar(async () => { await voz.segredoGravar("voz_chave_stt", chave); setChave(""); aplicar(await voz.estado()); }, "Chave guardada no cofre do sistema.")}>Guardar chave</button>
                  <button type="button" className="botao" disabled={!ev.tem_chave} onClick={() => void rodar(async () => { await voz.segredoGravar("voz_chave_stt", null); aplicar(await voz.estado()); }, "Chave removida.")}>Remover chave</button>
                  <span id="cfgv-chave-ajuda" className="cfg-ajuda cfgv-nota">Chave guardada: {ev.tem_chave ? "sim" : "não"}. Fica no cofre do sistema e nunca volta para esta tela.</span>
                </div>
                {ev.host !== null ? (
                  <div className="cfgv-consentimento" role="group" aria-label="Consentimento de envio de áudio">
                    <p><b>O áudio será enviado a <code>{ev.host}</code>.</b> Só depois do seu aceite, só para esse endereço; trocar o endereço pede um novo aceite.</p>
                    {ev.consentimento
                      ? <button type="button" className="botao" onClick={() => void rodar(async () => { await voz.consentir("voz_stt", ev.host as string, false); aplicar(await voz.estado()); }, "Consentimento revogado.")}>Revogar consentimento para {ev.host}</button>
                      : <button type="button" className="botao botao-primario" onClick={() => void rodar(async () => { await voz.consentir("voz_stt", ev.host as string, true); aplicar(await voz.estado()); }, "Consentimento registrado.")}>Permitir envio de áudio a {ev.host}</button>}
                  </div>
                ) : null}
              </div>
            ) : null}
            {motor !== "local_embutido" ? (
            <div className="cfg-linha cfgv-linha">
              <button type="button" className="botao botao-primario" onClick={() => void salvarMotor()}>Salvar motor</button>
              <button type="button" className="botao" disabled={!ev.motor_pronto || !ev.consentimento} onClick={() => void rodar(async () => {
                const r = await voz.testarMotor();
                setMsg(r.ok ? `O motor respondeu em ${r.latencia_ms ?? "?"} ms.` : `O motor não respondeu (${r.erro ?? "erro"}).`);
              })}>Testar motor</button>
              <span className="cfg-ajuda cfgv-nota">{ev.motor_pronto ? "Motor pronto." : "Motor ainda não configurado."}</span>
            </div>
            ) : null}
          </div>

          <div role="group" aria-label="Ditado" className="cfgv-grupo">
            <h3>Ditado</h3>
            <div className="cfg-linha cfgv-linha">
              <label>Idioma <select value={ev.idioma} aria-label="Idioma da fala" onChange={(e) => void rodar(async () => aplicar(await voz.configGravar({ idioma: e.target.value as "pt" | "en" })))}>
                <option value="pt">Português</option><option value="en">English</option>
              </select></label>
              <label>Disparo <select value={ev.disparo} aria-label="Disparo do ditado" onChange={(e) => void rodar(async () => aplicar(await voz.configGravar({ disparo: e.target.value as "segurar" | "alternar" })))}>
                <option value="segurar">Segurar para falar</option><option value="alternar">Alternar (liga/desliga)</option>
              </select></label>
            </div>
            <TesteTecla atual={ev.atalho} aoSalvar={async (c) => { await rodar(async () => aplicar(await voz.configGravar({ atalho: c })), "Atalho salvo."); }} />
            <Chave rotulo="Alternar também fora do app (atalho global)" ligada={ev.alternar_global} ajuda="Segurar-para-falar só funciona com o app em foco; fora dele existe apenas o modo alternar." aoMudar={(v) => void rodar(async () => aplicar(await voz.configGravar({ alternar_global: v })))} />
            {ev.atalho_erro !== null ? <p role="alert" className="cfg-erro">{ev.atalho_erro}</p> : null}
          </div>

          <div role="group" aria-label="Dicionário técnico" className="cfgv-grupo">
            <h3>Dicionário técnico</h3>
            <p className="cfg-ajuda">Termos que o motor deve escrever do seu jeito (ex.: config.json, Supabase).</p>
            <form className="cfg-linha cfgv-linha" onSubmit={(e) => { e.preventDefault(); void rodar(async () => { setTermos(await voz.dicionarioSalvar(novoTermo, novaDica === "" ? null : novaDica)); setNovoTermo(""); setNovaDica(""); }); }}>
              <label>Termo<input type="text" value={novoTermo} onChange={(e) => setNovoTermo(e.target.value)} maxLength={64} /></label>
              <label>Dica de pronúncia (opcional)<input type="text" value={novaDica} onChange={(e) => setNovaDica(e.target.value)} maxLength={64} /></label>
              <button type="submit" className="botao" disabled={novoTermo.trim() === ""}>Adicionar</button>
            </form>
            {termos.length === 0 ? <p className="cfg-ajuda">Nenhum termo ainda.</p> : termos.length > LIMITE_VIRTUAL && !todosTermos ? (
              <>
                <VirtualLista itens={termos} alturaItem={32} alturaPadrao={200} rotulo="Termos do dicionário" chave={(t) => t.termo} className="cfgv-termos" renderItem={(t) => (
                  <div className="cfgv-termo"><code>{t.termo}</code>{t.dica !== null ? <small>{t.dica}</small> : null}<button type="button" className="botao" aria-label={`Remover ${t.termo}`} onClick={() => void rodar(async () => setTermos(await voz.dicionarioRemover(t.termo)))}>Remover</button></div>
                )} />
                <button type="button" className="botao" onClick={() => setTodosTermos(true)}>Mostrar como lista simples</button>
              </>
            ) : (
              <ul className="cfgv-termos-simples">
                {termos.map((t) => (
                  <li key={t.termo} className="cfgv-termo"><code>{t.termo}</code>{t.dica !== null ? <small>{t.dica}</small> : null}<button type="button" className="botao" aria-label={`Remover ${t.termo}`} onClick={() => void rodar(async () => setTermos(await voz.dicionarioRemover(t.termo)))}>Remover</button></li>
                ))}
              </ul>
            )}
          </div>

          <div role="group" aria-label="Histórico de falas" className="cfgv-grupo">
            <h3>Histórico</h3>
            <p className="cfg-ajuda">As falas ficam só na memória, nesta sessão do app. Nada vai para o disco.</p>
            <div className="cfg-linha cfgv-linha">
              <span>{falas} {falas === 1 ? "fala" : "falas"} na memória.</span>
              <button type="button" className="botao" disabled={falas === 0} onClick={() => void rodar(async () => { await voz.historicoLimpar(); setFalas(0); }, "Histórico limpo.")}>Limpar histórico</button>
            </div>
          </div>
        </>
      ) : null}

      <div role="group" aria-label="Permissões do sistema" className="cfgv-grupo">
        <h3>Permissões do sistema</h3>
        <p className="cfg-ajuda">Nada é pedido ao abrir esta tela. Cada permissão só é pedida no primeiro uso, depois de uma explicação.</p>
        {voz !== undefined && ev !== null ? (
          <div className="cfg-linha cfgv-linha">
            <span>Microfone: <b>{ROTULO_PERMISSAO[ev.microfone]}</b></span>
            {ev.microfone === "indeterminada" ? <button type="button" className="botao" onClick={() => void pedirMic()}>Pedir permissão do microfone</button> : null}
            <button type="button" className="botao" onClick={() => void rodar(async () => { if (!(await voz.abrirAjustes("microfone"))) setMsg("Este sistema não tem um painel conhecido: abra as configurações de privacidade manualmente."); })}>Abrir Ajustes do Sistema</button>
          </div>
        ) : null}
        {captura !== undefined && ec !== null ? (
          <div className="cfg-linha cfgv-linha">
            <span>Gravação de tela: <b>{ROTULO_PERMISSAO[ec.tela]}</b></span>
            {voz !== undefined ? <button type="button" className="botao" onClick={() => void rodar(async () => { await voz.abrirAjustes("tela"); })}>Abrir Ajustes do Sistema</button> : null}
            {ec.plataforma === "mac" && ec.tela !== "concedida" ? <span className="cfg-ajuda cfgv-nota">No macOS, reabra o app depois de conceder. A captura da janela do app não precisa dessa permissão.</span> : null}
          </div>
        ) : null}
      </div>

      {captura !== undefined && ec !== null ? (
        <div role="group" aria-label="Captura de tela" className="cfgv-grupo">
          <h3>Captura de tela</h3>
          <div className="cfg-linha cfgv-linha">
            <label>Quadros por segundo <select value={ec.fps_padrao} aria-label="Quadros por segundo" onChange={(e) => void rodar(async () => setEc(await captura.configGravar({ fps_padrao: Number(e.target.value) === 1 ? 1 : 2 })))}>
              <option value={1}>1 fps</option><option value={2}>2 fps</option>
            </select></label>
            <span>Atalhos: região <kbd>{rotuloDoAtalho(ec.atalho_regiao, EH_MAC)}</kbd>, quadros <kbd>{rotuloDoAtalho(ec.atalho_quadros, EH_MAC)}</kbd> (paleta ⌘K). O app não altera os atalhos do sistema.</span>
          </div>
          <Chave rotulo="Atalhos de captura também fora do app" ligada={ec.atalhos_globais} ajuda="Desligado por padrão. Se outro programa já usa o atalho, ele não é registrado." aoMudar={(v) => void rodar(async () => setEc(await captura.configGravar({ atalhos_globais: v })))} />
          {ec.atalho_erro !== null ? <p role="alert" className="cfg-erro">{ec.atalho_erro}</p> : null}
          <div className="cfg-linha cfgv-linha"><button type="button" className="botao" onClick={() => pedirCaptura("galeria")}>Abrir capturas</button></div>
        </div>
      ) : null}
    </section>
  );
}

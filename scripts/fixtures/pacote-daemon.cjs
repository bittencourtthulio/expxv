// Roda DENTRO do app empacotado (ELECTRON_RUN_AS_NODE=1). Prova que o daemon de PTY do pacote sobe pelo
// lançador (processo desligado do pai, executável do app como Node), cria uma sessão com node-pty, SOBREVIVE
// ao fechamento do cliente (o "app"), devolve a sessão e o histórico a um segundo cliente e encerra a pedido.
// Uso: <executavel> pacote-daemon.cjs <pasta Resources> <fixture cli-pty.mjs>
const { mkdtempSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const recursos = process.argv[2];
const cli = process.argv[3];
const asar = join(recursos, "app.asar");
const fora = join(recursos, "app.asar.unpacked");
let ativo = null; // cliente conectado: na falha, pede ao daemon que saia para não deixar processo vivo
const falhar = (m) => {
  console.error(JSON.stringify({ ok: false, erro: m }));
  const sair = () => process.exit(1);
  if (ativo === null) return sair();
  setTimeout(sair, 2000).unref();
  ativo.encerrarTudo().then(sair, sair);
};
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function ate(cond, rotulo) {
  for (let i = 0; i < 400; i++) { if (await cond()) return; await espera(25); }
  falhar(`não ocorreu: ${rotulo}`);
}

(async () => {
  const { lancarDaemon } = require(join(asar, "dist/daemon/lancador.js"));
  const { ClienteDaemon } = require(join(asar, "dist/daemon/cliente.js"));
  const base = mkdtempSync(join(process.platform === "win32" ? tmpdir() : "/tmp", "xvp-"));
  const dir = join(base, "d");
  require("node:fs").mkdirSync(dir, { recursive: true, mode: 0o700 });
  const token = "token-de-teste-do-pacote-0123456789";
  writeFileSync(join(dir, "token"), token, { mode: 0o600 });
  const socket = process.platform === "win32" ? `\\\\.\\pipe\\xvp-${process.pid}` : join(base, "d.sock");
  const novoCliente = (iniciar) => new ClienteDaemon({ socket, token, intervaloMs: 50, tentativas: 100, ...(iniciar ? { iniciarDaemon: () => lancarDaemon({ executavel: process.execPath, script: join(fora, "dist/daemon/main-daemon.js"), dir, socket, ocioso_ms: 120000 }) } : {}) });

  const t0 = Date.now();
  const primeiro = novoCliente(true);
  if (!(await primeiro.pronto)) falhar("o daemon empacotado não subiu");
  ativo = primeiro;
  const subiuEmMs = Date.now() - t0;
  const meta = { ferramenta_id: "terminal", executavel_id: "exe_pacote", argumentos: [cli], raiz: tmpdir(), workspace_id: null, colunas: 90, linhas: 28, criada_em: Date.now() };
  const proc = primeiro.spawn(
    { ferramenta_id: "terminal", caminho: process.execPath, modo_lancamento: "direto" },
    [cli],
    { sessao_id: "sessao_pacote", cwd: tmpdir(), colunas: 90, linhas: 28, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, meta },
  );
  let saida = "";
  proc.onData((d) => { saida += d; });
  await ate(() => saida.includes("pty>"), "a CLI de teste imprimir o prompt dentro do daemon");
  proc.write("antes de fechar\r");
  await ate(() => saida.includes("eco:antes de fechar"), "eco da sessão no daemon");
  await primeiro.fechar(); // o "app" fecha; o daemon (desligado do pai) e a sessão têm de continuar

  await espera(400);
  const segundo = novoCliente(false);
  ativo = segundo;
  if (!(await segundo.pronto)) falhar("o daemon não sobreviveu ao fechamento do cliente");
  const sessoes = await segundo.listar();
  const sessao = sessoes.find((s) => s.sessao_id === "sessao_pacote");
  if (!sessao || sessao.estado !== "executando") falhar(`sessão não sobreviveu: ${JSON.stringify(sessoes)}`);
  const hist = await segundo.historico("sessao_pacote");
  if (!hist.dados.includes("eco:antes de fechar")) falhar("histórico da sessão sobrevivente não tem o eco");

  await segundo.encerrarTudo();
  await segundo.fechar();
  // o daemon sai logo depois de encerrar_tudo: tenta reconectar por até ~5 s e exige que ninguém atenda
  let vivo = true;
  for (let i = 0; i < 25 && vivo; i++) {
    await espera(200);
    const sonda = new ClienteDaemon({ socket, token, intervaloMs: 10, tentativas: 1 });
    vivo = await sonda.pronto;
    await sonda.fechar();
  }
  if (vivo) falhar("o daemon continuou vivo depois de encerrar_tudo");
  rmSync(base, { recursive: true, force: true });
  console.log(JSON.stringify({ ok: true, subiuEmMs, sobreviveu: true }));
  process.exit(0);
})().catch((e) => falhar(String((e && e.stack) || e)));

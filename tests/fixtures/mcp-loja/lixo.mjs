// Servidor falso que suja o stdout com uma linha que não é JSON antes de falar o protocolo.
process.stdout.write("isto nao e json-rpc\n");
const { iniciarServidor } = await import("./_base.mjs");
await iniciarServidor({ nome: "falso-lixo" });

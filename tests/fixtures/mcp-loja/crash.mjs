// Servidor falso que quebra: responde initialize e sai com código 1 ao receber tools/list.
import { iniciarServidor } from "./_base.mjs";
await iniciarServidor({ nome: "falso-crash", aoListar: () => process.exit(1) });

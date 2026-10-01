// Servidor falso que demora para ficar pronto (FALSO_ATRASO_MS, padrão 5000 ms) — passa do timeout de 3 s.
import { dormir, iniciarServidor } from "./_base.mjs";
const atraso = Number(process.env.FALSO_ATRASO_MS ?? 5000);
await iniciarServidor({ nome: "falso-lento", antes: () => dormir(atraso) });

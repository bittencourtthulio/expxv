// @ts-nocheck
import knex from "knex";

export async function consultar(db: any, prisma: any, tabela: string) {
  await db.query("SELECT id, nome FROM clientes c JOIN pedidos p ON p.cliente_id = c.id WHERE c.id = ?");
  await db.query("INSERT INTO auditoria (a, b) VALUES (?, ?)");
  await db.query("UPDATE estoque SET qtd = qtd - 1 WHERE id = ?");
  await db.query(`DELETE FROM sessoes WHERE expira < ${Date.now()}`);
  await db.query(`SELECT * FROM ${tabela}`);
  await prisma.fatura.findMany({ where: {} });
  await prisma.fatura.create({ data: {} });
  await knex("produtos").insert({ a: 1 });
  await knex("categorias").select("*");
  const msg = "Select an item from the list";
  const aviso = "Update your profile settings";
  return msg + aviso;
}

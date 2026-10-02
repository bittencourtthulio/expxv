-- DDL
CREATE TABLE IF NOT EXISTS `Clientes` (id int, nome text);
/* comentário
   CREATE TABLE falsa (x int); */
ALTER TABLE pedidos ADD COLUMN total int;
INSERT INTO log_acesso (a) VALUES (1);
SELECT c.id FROM clientes c JOIN pedidos p ON p.cid = c.id;

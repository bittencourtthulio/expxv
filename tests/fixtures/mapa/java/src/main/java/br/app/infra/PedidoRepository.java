package br.app.infra;

import br.app.dominio.Pedido;
import org.springframework.data.jpa.repository.*;

public interface PedidoRepository extends JpaRepository<Pedido, Long> {

    @Query("SELECT p FROM pedidos p WHERE p.id = ?1")
    Pedido porId(Long id);

    @Query(value = "SELECT * FROM clientes c JOIN enderecos e ON e.c = c.id", nativeQuery = true)
    List<Object> nativa();
}

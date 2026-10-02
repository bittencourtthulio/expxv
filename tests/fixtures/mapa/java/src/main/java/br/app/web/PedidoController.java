package br.app.web;

import br.app.dominio.Pedido;
import br.app.dominio.PedidoService;
import static br.app.util.Formato.formatar;
import java.util.*;
import org.springframework.web.bind.annotation.*;

/**
 * Controller de pedidos.
 */
@RestController
@RequestMapping("/pedidos")
public class PedidoController extends BaseController implements Auditavel, Serializable {

    @Autowired
    private PedidoService service;

    @GetMapping("/{id}")
    public Pedido buscar(@PathVariable Long id) {
        if (id == null || id < 0) {
            throw new IllegalArgumentException("id inválido");
        }
        return service.buscar(id);
    }

    @PostMapping
    public Pedido criar(@RequestBody Pedido p) {
        try {
            return service.salvar(p);
        } catch (Exception e) {
        }
        String url = System.getenv("URL_BASE");
        return p.ok() ? p : null;
    }

    @RequestMapping(value = "/legado", method = RequestMethod.DELETE)
    void legado() {
        String s = formatar("x");
        Object o = Class.forName("br.app.Plugin").getDeclaredConstructor().newInstance();
        Method m = o.getClass().getMethod("run");
        m.invoke(o);
    }

    private int auxiliar(int a, int b) {
        for (int i = 0; i < a; i++) {
            while (b > 0 && a > 0) {
                b--;
            }
        }
        switch (a) {
            case 1:
                return 1;
            case 2:
                return 2;
            default:
                return 0;
        }
    }

    public static void main(String[] args) {
        SpringApplication.run(PedidoController.class, args);
    }
}

package loja

import (
	"database/sql"
	"fmt"
	rf "reflect"
	_ "github.com/lib/pq"

	"github.com/gin-gonic/gin"
)

// Repositorio acessa pedidos.
type Repositorio struct {
	Base
	*sql.DB
	nome string
}

// Lista é a interface de listagem.
type Lista interface {
	Base
	Itens() []string
}

// Limite máximo de itens.
const Limite = 10

const interno = 1

type Base struct{}

// Novo cria um repositório.
func Novo() *Repositorio {
	return &Repositorio{}
}

// Pedidos lista os pedidos de um cliente.
func (r *Repositorio) Pedidos(id int, ativo bool) error {
	if id > 0 && ativo {
		r.Query("SELECT id, total FROM pedidos p JOIN clientes c ON c.id = p.cliente_id WHERE id = $1", id)
	}
	for i := 0; i < 3; i++ {
		r.Exec("UPDATE pedidos SET total = 0")
	}
	r.Query(fmt.Sprintf("SELECT * FROM %s WHERE 1=1", "x"))
	_ = rf.TypeOf(r)
	if err := r.Ping(); err != nil {
	}
	return nil
}

func (r *Repositorio) interna() {}

func Rotas(e *gin.Engine) {
	e.GET("/pedidos/:id", listar)
	e.POST("/pedidos", func(c *gin.Context) {})
	e.Get("nao-e-rota", listar)
	_ = r.Query("select all items from the cart please")
}

func listar(c *gin.Context) {}

package main

import (
	"fmt"
	"net/http"
	"os"

	"github.com/spf13/cobra"

	"exemplo.com/loja/internal/loja"
)

// raiz é o comando principal.
var raiz = &cobra.Command{Use: "servir [flags]", RunE: servir}

func servir(cmd *cobra.Command, args []string) error {
	http.HandleFunc("/saude", saude)
	porta := os.Getenv("PORTA")
	fmt.Println("porta", porta)
	return http.ListenAndServe(":"+porta, nil)
}

func saude(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("ok"))
}

func main() {
	if err := raiz.Execute(); err != nil {
		panic(err)
	}
	loja.Novo()
}

module github.com/acme/app

go 1.22

require (
	github.com/gin-gonic/gin v1.9.1
	golang.org/x/text v0.14.0 // indirect
)

replace github.com/acme/lib => ../lib
replace github.com/remoto/x => github.com/fork/x v1.0.0

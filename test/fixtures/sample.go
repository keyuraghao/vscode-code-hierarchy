package main

import "fmt"

type Server struct {
	addr string
}

func NewServer(addr string) *Server {
	return &Server{addr: addr}
}

func (s *Server) Start() error {
	if s.addr == "" {
		return fmt.Errorf("no address")
	}
	for i := 0; i < 3; i++ {
		fmt.Println(i)
	}
	return nil
}

func handle(msg string) {
	fmt.Println(msg)
}

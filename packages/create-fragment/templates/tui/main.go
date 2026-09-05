package main

import (
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/spf13/cobra"

	"github.com/{{AUTHOR_NAME}}/{{PROJECT_NAME}}/apps/tui/app"
)

func main() {
	rootCmd := &cobra.Command{
		Use:   "{{PROJECT_NAME}}",
		Short: "{{PROJECT_NAME}} — Agentic Chat & Tool Timeline TUI",
		RunE: func(cmd *cobra.Command, args []string) error {
			m := app.NewModel()
			p := tea.NewProgram(m, tea.WithAltScreen(), tea.WithMouseCellMotion())
			if _, err := p.Run(); err != nil {
				return fmt.Errorf("error running TUI: %w", err)
			}
			return nil
		},
	}

	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"charm.land/bubbles/v2/textinput"
	"charm.land/bubbles/v2/viewport"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
)

type serviceID string

const (
	primaryService   serviceID = "primary"
	secondaryService serviceID = "secondary"
	proxyService     serviceID = "proxy"

	maxLogLines      = 4000
	exportedLogFile  = ".mctraveler-runner.log"
	plainLogFile     = ".mctraveler-runner-live.log"
	shutdownGrace    = 3 * time.Second
	shutdownDeadline = 8 * time.Second
)

type serviceConfig struct {
	id       serviceID
	title    string
	key      string
	command  string
	args     []string
	env      []string
	graceful bool
}

type serviceState struct {
	config     serviceConfig
	viewport   viewport.Model
	lines      []string
	stdin      io.WriteCloser
	cancel     context.CancelFunc
	cmd        *exec.Cmd
	running    bool
	exited     bool
	exitCode   int
	autoScroll bool
}

type logMsg struct {
	id    serviceID
	line  string
	isErr bool
}

type exitMsg struct {
	id   serviceID
	code int
	err  error
}

type commandSentMsg struct {
	id      serviceID
	command string
}

type exportedMsg struct {
	path string
	err  error
}

type clipboardMsg struct {
	err error
}

type restartMsg struct {
	id     serviceID
	reason string
}

type model struct {
	services       map[serviceID]*serviceState
	order          []serviceID
	restarting     map[serviceID]bool
	focused        serviceID
	input          textinput.Model
	inputMode      bool
	width          int
	height         int
	ready          bool
	shuttingDown   bool
	status         string
	statusSeverity severity
	logWriter      *bufio.Writer
	logFile        *os.File
	baseDir        string
	production     bool
	cancelWebhook  context.CancelFunc
}

type severity int

const (
	neutral severity = iota
	success
	warning
	danger
)

var (
	borderNormal  = lipgloss.Color("62")
	borderFocused = lipgloss.Color("42")
	borderError   = lipgloss.Color("196")
	borderStopped = lipgloss.Color("240")

	headerStyle = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("15")).Background(lipgloss.Color("62")).Padding(0, 1)
	helpStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("15")).Background(lipgloss.Color("238")).Padding(0, 1)
	inputStyle  = lipgloss.NewStyle().Foreground(lipgloss.Color("15")).Background(lipgloss.Color("25"))
)

func main() {
	productionFlag := flag.Bool("production", false, "run proxy in production mode")
	flag.Parse()

	baseDir, err := os.Getwd()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to resolve working directory: %v\n", err)
		os.Exit(1)
	}

	m, err := newModel(baseDir, *productionFlag || os.Getenv("PRODUCTION") == "1" || os.Getenv("NODE_ENV") == "production")
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to initialize runner: %v\n", err)
		os.Exit(1)
	}
	defer m.closeLog()

	program := tea.NewProgram(m)
	currentProgram = program
	if _, err := program.Run(); err != nil && !errors.Is(err, tea.ErrInterrupted) {
		fmt.Fprintf(os.Stderr, "runner failed: %v\n", err)
		os.Exit(1)
	}
}

func newModel(baseDir string, production bool) (model, error) {
	logPath := filepath.Join(baseDir, plainLogFile)
	logFile, err := os.Create(logPath)
	if err != nil {
		return model{}, err
	}

	input := textinput.New()
	input.Prompt = "> "
	input.Placeholder = "command"
	input.CharLimit = 1000

	configs := []serviceConfig{
		{
			id:       primaryService,
			title:    "Primary Server :25566",
			key:      "1",
			command:  "bun",
			args:     []string{"minecraft:primary"},
			env:      productionEnv(production),
			graceful: true,
		},
		{
			id:       secondaryService,
			title:    "Secondary Server :25567",
			key:      "2",
			command:  "bun",
			args:     []string{"minecraft:secondary"},
			env:      productionEnv(production),
			graceful: true,
		},
		{
			id:      proxyService,
			title:   "Proxy Server :25565",
			key:     "3",
			command: "bun",
			args:    proxyArgs(production),
			env:     productionEnv(production),
		},
	}

	services := make(map[serviceID]*serviceState, len(configs))
	order := make([]serviceID, 0, len(configs))
	for _, config := range configs {
		vp := viewport.New()
		vp.SoftWrap = false
		vp.MouseWheelEnabled = false
		services[config.id] = &serviceState{
			config:     config,
			viewport:   vp,
			autoScroll: true,
			exitCode:   -1,
		}
		order = append(order, config.id)
	}

	return model{
		services:       services,
		order:          order,
		restarting:     make(map[serviceID]bool),
		focused:        primaryService,
		input:          input,
		status:         "Starting services...",
		statusSeverity: neutral,
		logWriter:      bufio.NewWriter(logFile),
		logFile:        logFile,
		baseDir:        baseDir,
		production:     production,
	}, nil
}

func productionEnv(production bool) []string {
	if production {
		return []string{"PRODUCTION=1"}
	}
	return []string{"PRODUCTION=0"}
}

func proxyArgs(production bool) []string {
	if production {
		return []string{"proxy"}
	}
	return []string{"proxy:watch"}
}

func (m model) Init() tea.Cmd {
	cmds := make([]tea.Cmd, 0, len(m.order)+1)
	for _, id := range m.order {
		cmds = append(cmds, m.startService(id))
	}
	if m.production {
		cmds = append(cmds, m.startWebhook())
	}
	return tea.Batch(cmds...)
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.ready = true
		m.resizeViewports()
		return m, nil
	case tea.KeyPressMsg:
		return m.handleKey(msg)
	case tea.MouseWheelMsg:
		return m.handleMouseWheel(msg), nil
	case logMsg:
		m.appendLog(msg.id, msg.line, msg.isErr)
		return m, nil
	case exitMsg:
		return m.handleExit(msg)
	case commandSentMsg:
		m.appendLog(msg.id, "> "+msg.command, false)
		m.status = fmt.Sprintf("Sent command to %s", m.services[msg.id].config.title)
		m.statusSeverity = success
		return m, nil
	case exportedMsg:
		if msg.err != nil {
			m.status = "Export failed: " + msg.err.Error()
			m.statusSeverity = danger
		} else {
			m.status = "Exported logs to " + msg.path
			m.statusSeverity = success
		}
		return m, nil
	case clipboardMsg:
		if msg.err != nil {
			m.status = "Clipboard copy failed; logs are still exportable with e"
			m.statusSeverity = warning
		} else {
			m.status = "Focused logs copied using OSC52"
			m.statusSeverity = success
		}
		return m, nil
	case restartMsg:
		svc := m.services[msg.id]
		m.appendLog(msg.id, "Restarting "+svc.config.title+"... "+msg.reason, false)
		if svc.running && svc.cmd != nil {
			m.restarting[msg.id] = true
			terminateProcess(svc.cmd)
			return m, nil
		}
		return m, m.startService(msg.id)
	default:
		return m, nil
	}
}

func (m model) View() tea.View {
	view := tea.NewView(m.render())
	view.AltScreen = true
	view.MouseMode = tea.MouseModeNone
	return view
}

func (m model) handleKey(msg tea.KeyPressMsg) (model, tea.Cmd) {
	key := msg.String()
	if m.inputMode {
		switch key {
		case "enter":
			value := strings.TrimSpace(m.input.Value())
			focused := m.focused
			m.inputMode = false
			m.input.Blur()
			m.input.Reset()
			if value == "" {
				m.status = "Command cancelled"
				m.statusSeverity = neutral
				return m, nil
			}
			return m, m.sendCommand(focused, value)
		case "esc":
			m.inputMode = false
			m.input.Blur()
			m.input.Reset()
			m.status = "Command cancelled"
			m.statusSeverity = neutral
			return m, nil
		default:
			var cmd tea.Cmd
			m.input, cmd = m.input.Update(msg)
			return m, cmd
		}
	}

	switch key {
	case "ctrl+c", "q":
		if m.shuttingDown {
			m.forceKillAll()
			return m, tea.Quit
		}
		m.shuttingDown = true
		m.status = "Stopping services gracefully... press q again to force quit"
		m.statusSeverity = warning
		m.appendAll("Stopping services gracefully...")
		return m, tea.Batch(m.shutdownAll(), quitAfter(shutdownDeadline))
	case "1":
		m.focused = primaryService
		m.status = "Focused primary server"
		m.statusSeverity = neutral
		return m, nil
	case "2":
		m.focused = secondaryService
		m.status = "Focused secondary server"
		m.statusSeverity = neutral
		return m, nil
	case "3":
		m.focused = proxyService
		m.status = "Focused proxy server"
		m.statusSeverity = neutral
		return m, nil
	case "i", "enter":
		m.inputMode = true
		m.input.Placeholder = fmt.Sprintf("send command to %s", m.services[m.focused].config.title)
		m.status = "Type a command, enter to send, esc to cancel"
		m.statusSeverity = neutral
		return m, m.input.Focus()
	case "up", "k":
		m.scrollFocused(-1)
		return m, nil
	case "down", "j":
		m.scrollFocused(1)
		return m, nil
	case "pgup", "b":
		m.scrollFocusedPage(-1)
		return m, nil
	case "pgdown", "f":
		m.scrollFocusedPage(1)
		return m, nil
	case "home", "g":
		svc := m.services[m.focused]
		svc.viewport.GotoTop()
		svc.autoScroll = false
		return m, nil
	case "end", "G":
		svc := m.services[m.focused]
		svc.viewport.GotoBottom()
		svc.autoScroll = true
		return m, nil
	case "e":
		return m, m.exportLogs()
	case "c":
		return m, m.copyFocusedLogs()
	default:
		return m, nil
	}
}

func (m model) handleMouseWheel(msg tea.MouseWheelMsg) model {
	switch msg.Button {
	case tea.MouseWheelUp:
		m.scrollFocused(-3)
	case tea.MouseWheelDown:
		m.scrollFocused(3)
	}
	return m
}

func (m *model) resizeViewports() {
	if m.width <= 0 || m.height <= 0 {
		return
	}

	helpHeight := 2
	inputHeight := 0
	if m.inputMode {
		inputHeight = 1
	}
	contentHeight := max(3, m.height-helpHeight-inputHeight)
	topHeight := max(3, contentHeight/2)
	bottomHeight := max(3, contentHeight-topHeight)
	leftWidth := max(12, m.width/2)
	rightWidth := max(12, m.width-leftWidth)

	m.setViewportSize(primaryService, leftWidth-2, topHeight-2)
	m.setViewportSize(secondaryService, rightWidth-2, topHeight-2)
	m.setViewportSize(proxyService, m.width-2, bottomHeight-2)
	m.input.SetWidth(max(1, m.width-2))
}

func (m *model) setViewportSize(id serviceID, width, height int) {
	svc := m.services[id]
	svc.viewport.SetWidth(max(1, width))
	svc.viewport.SetHeight(max(1, height))
	if svc.autoScroll {
		svc.viewport.GotoBottom()
	}
}

func (m model) render() string {
	if !m.ready {
		return "\n Initializing MCTraveler runner..."
	}

	helpHeight := 2
	inputHeight := 0
	if m.inputMode {
		inputHeight = 1
	}
	contentHeight := max(3, m.height-helpHeight-inputHeight)
	topHeight := max(3, contentHeight/2)
	bottomHeight := max(3, contentHeight-topHeight)
	leftWidth := max(12, m.width/2)
	rightWidth := max(12, m.width-leftWidth)

	primary := m.renderPane(m.services[primaryService], leftWidth, topHeight)
	secondary := m.renderPane(m.services[secondaryService], rightWidth, topHeight)
	proxy := m.renderPane(m.services[proxyService], m.width, bottomHeight)
	top := lipgloss.JoinHorizontal(lipgloss.Top, primary, secondary)

	parts := []string{
		top,
		proxy,
		m.renderHelp(),
	}
	if m.inputMode {
		parts = append(parts, inputStyle.Width(m.width).Render(m.input.View()))
	}

	return lipgloss.JoinVertical(lipgloss.Left, parts...)
}

func (m model) renderPane(svc *serviceState, width, height int) string {
	borderColor := borderNormal
	if svc.config.id == m.focused {
		borderColor = borderFocused
	}
	if svc.exited && svc.exitCode != 0 && svc.exitCode != 143 && !m.shuttingDown {
		borderColor = borderError
	} else if svc.exited {
		borderColor = borderStopped
	}

	title := fmt.Sprintf(" %s %s ", svc.config.key, svc.config.title)
	if svc.config.id == m.focused {
		title += "FOCUSED "
	}
	if svc.running {
		title += "RUNNING "
	} else if svc.exited {
		title += fmt.Sprintf("EXIT %d ", svc.exitCode)
	}
	if !svc.autoScroll {
		title += "SCROLLED "
	}

	style := lipgloss.NewStyle().
		Width(max(1, width)).
		Height(max(1, height)).
		Border(lipgloss.RoundedBorder()).
		BorderForeground(borderColor).
		BorderTop(true).
		BorderBottom(true).
		BorderLeft(true).
		BorderRight(true)

	innerWidth := max(1, width-2)
	content := svc.viewport.View()
	if lipgloss.Height(content) < max(1, height-2) {
		content = lipgloss.NewStyle().Width(innerWidth).Height(max(1, height-2)).Render(content)
	}

	return style.Render(headerStyle.Width(innerWidth).Render(ansi.Truncate(title, innerWidth, "…")) + "\n" + content)
}

func (m model) renderHelp() string {
	status := m.statusStyle().Render(m.status)
	keys := " 1/2/3 focus | i/enter command | ↑↓/Pg scroll | End follow | e export all | c copy pane | q quit "
	line := lipgloss.JoinHorizontal(lipgloss.Center, helpStyle.Render(keys), " ", status)
	return lipgloss.NewStyle().Width(m.width).MaxWidth(m.width).Render(ansi.Truncate(line, m.width, "…"))
}

func (m model) statusStyle() lipgloss.Style {
	switch m.statusSeverity {
	case success:
		return lipgloss.NewStyle().Foreground(lipgloss.Color("42"))
	case warning:
		return lipgloss.NewStyle().Foreground(lipgloss.Color("220"))
	case danger:
		return lipgloss.NewStyle().Foreground(lipgloss.Color("196")).Bold(true)
	default:
		return lipgloss.NewStyle().Foreground(lipgloss.Color("250"))
	}
}

func (m *model) appendLog(id serviceID, line string, isErr bool) {
	svc := m.services[id]
	prefix := time.Now().Format("15:04:05")
	if isErr {
		line = "[stderr] " + line
	}
	entry := fmt.Sprintf("%s %s", prefix, line)
	svc.lines = append(svc.lines, entry)
	if len(svc.lines) > maxLogLines {
		svc.lines = svc.lines[len(svc.lines)-maxLogLines:]
	}
	svc.viewport.SetContent(strings.Join(svc.lines, "\n"))
	if svc.autoScroll {
		svc.viewport.GotoBottom()
	}
	m.writePlainLog(id, entry)
}

func (m *model) appendAll(line string) {
	for _, id := range m.order {
		m.appendLog(id, line, false)
	}
}

func (m *model) writePlainLog(id serviceID, line string) {
	if m.logWriter == nil {
		return
	}
	_, _ = fmt.Fprintf(m.logWriter, "[%s] %s\n", id, line)
	_ = m.logWriter.Flush()
}

func (m model) startService(id serviceID) tea.Cmd {
	return func() tea.Msg {
		for currentProgram == nil {
			time.Sleep(10 * time.Millisecond)
		}

		svc := m.services[id]
		ctx, cancel := context.WithCancel(context.Background())
		cmd := exec.CommandContext(ctx, svc.config.command, svc.config.args...)
		cmd.Dir = m.baseDir
		cmd.Env = append(os.Environ(), svc.config.env...)
		configureCommand(cmd)

		stdout, err := cmd.StdoutPipe()
		if err != nil {
			cancel()
			return logMsg{id: id, line: "stdout pipe failed: " + err.Error(), isErr: true}
		}
		stderr, err := cmd.StderrPipe()
		if err != nil {
			cancel()
			return logMsg{id: id, line: "stderr pipe failed: " + err.Error(), isErr: true}
		}
		stdin, err := cmd.StdinPipe()
		if err != nil {
			cancel()
			return logMsg{id: id, line: "stdin pipe failed: " + err.Error(), isErr: true}
		}
		if err := cmd.Start(); err != nil {
			cancel()
			return logMsg{id: id, line: "start failed: " + err.Error(), isErr: true}
		}

		svc.cmd = cmd
		svc.stdin = stdin
		svc.cancel = cancel
		svc.running = true
		svc.exited = false
		svc.exitCode = -1

		go scanOutput(id, stdout, false, currentProgram)
		go scanOutput(id, stderr, true, currentProgram)
		go waitForExit(id, cmd, cancel, currentProgram)

		return logMsg{id: id, line: "Starting " + svc.config.title + "...", isErr: false}
	}
}

var currentProgram *tea.Program

func scanOutput(id serviceID, r io.Reader, isErr bool, program *tea.Program) {
	scanner := bufio.NewScanner(r)
	buffer := make([]byte, 0, 64*1024)
	scanner.Buffer(buffer, 1024*1024)
	for scanner.Scan() {
		program.Send(logMsg{id: id, line: scanner.Text(), isErr: isErr})
	}
	if err := scanner.Err(); err != nil {
		program.Send(logMsg{id: id, line: "stream error: " + err.Error(), isErr: true})
	}
}

func waitForExit(id serviceID, cmd *exec.Cmd, cancel context.CancelFunc, program *tea.Program) {
	err := cmd.Wait()
	cancel()
	code := 0
	if err != nil {
		code = 1
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			code = exitErr.ExitCode()
		}
	}
	program.Send(exitMsg{id: id, code: code, err: err})
}

func (m model) handleExit(msg exitMsg) (model, tea.Cmd) {
	svc := m.services[msg.id]
	svc.running = false
	svc.exited = true
	svc.exitCode = msg.code
	if svc.stdin != nil {
		_ = svc.stdin.Close()
		svc.stdin = nil
	}

	if !m.shuttingDown && m.restarting[msg.id] {
		delete(m.restarting, msg.id)
		m.appendLog(msg.id, fmt.Sprintf("%s stopped for restart", svc.config.title), false)
		return m, m.startService(msg.id)
	}

	if m.shuttingDown {
		m.appendLog(msg.id, fmt.Sprintf("%s stopped with exit code %d", svc.config.title, msg.code), false)
		if m.allExited() {
			m.status = "All services stopped"
			m.statusSeverity = success
			m.closeLog()
			return m, tea.Quit
		}
		return m, nil
	}

	if msg.code == 0 || msg.code == 143 {
		m.appendLog(msg.id, fmt.Sprintf("%s stopped with exit code %d", svc.config.title, msg.code), false)
		m.status = fmt.Sprintf("%s stopped", svc.config.title)
		m.statusSeverity = warning
		return m, nil
	}

	m.appendLog(msg.id, fmt.Sprintf("%s exited with code %d", svc.config.title, msg.code), true)
	m.appendAll("A service crashed. Stopping all services...")
	m.shuttingDown = true
	m.status = "A service crashed; stopping all services"
	m.statusSeverity = danger
	return m, tea.Batch(m.shutdownAll(), quitAfter(shutdownDeadline))
}

func (m model) sendCommand(id serviceID, command string) tea.Cmd {
	return func() tea.Msg {
		svc := m.services[id]
		if svc.stdin == nil || !svc.running {
			return logMsg{id: id, line: "cannot send command; service is not running", isErr: true}
		}
		if _, err := io.WriteString(svc.stdin, command+"\n"); err != nil {
			return logMsg{id: id, line: "command failed: " + err.Error(), isErr: true}
		}
		return commandSentMsg{id: id, command: command}
	}
}

func (m model) shutdownAll() tea.Cmd {
	return func() tea.Msg {
		var wg sync.WaitGroup
		for _, id := range m.order {
			svc := m.services[id]
			if !svc.running || svc.cmd == nil {
				continue
			}
			if !svc.config.graceful {
				terminateProcess(svc.cmd)
				continue
			}
			wg.Add(1)
			go func(s *serviceState) {
				defer wg.Done()
				if s.stdin != nil {
					_, _ = io.WriteString(s.stdin, "stop\n")
					time.Sleep(shutdownGrace)
				}
				terminateProcess(s.cmd)
			}(svc)
		}
		wg.Wait()
		return nil
	}
}

func (m model) forceKillAll() {
	for _, id := range m.order {
		svc := m.services[id]
		if svc.cmd != nil {
			killProcess(svc.cmd)
		}
		if svc.cancel != nil {
			svc.cancel()
		}
	}
	m.closeLog()
}

func quitAfter(d time.Duration) tea.Cmd {
	return tea.Tick(d, func(time.Time) tea.Msg {
		return tea.Quit()
	})
}

func (m model) allExited() bool {
	for _, id := range m.order {
		if m.services[id].running {
			return false
		}
	}
	return true
}

func (m model) exportLogs() tea.Cmd {
	return func() tea.Msg {
		path := filepath.Join(m.baseDir, exportedLogFile)
		var b strings.Builder
		for _, id := range m.order {
			svc := m.services[id]
			b.WriteString("===== " + svc.config.title + " =====\n")
			for _, line := range svc.lines {
				b.WriteString(line)
				b.WriteByte('\n')
			}
			b.WriteByte('\n')
		}
		if err := os.WriteFile(path, []byte(b.String()), 0o644); err != nil {
			return exportedMsg{err: err}
		}
		return exportedMsg{path: path}
	}
}

func (m model) copyFocusedLogs() tea.Cmd {
	svc := m.services[m.focused]
	content := strings.Join(svc.lines, "\n")
	if strings.TrimSpace(content) == "" {
		return func() tea.Msg {
			return clipboardMsg{err: errors.New("no logs to copy")}
		}
	}
	return tea.Sequence(
		tea.SetClipboard(content),
		func() tea.Msg { return clipboardMsg{} },
	)
}

func (m *model) scrollFocused(delta int) {
	svc := m.services[m.focused]
	if delta < 0 {
		svc.viewport.ScrollUp(-delta)
	} else {
		svc.viewport.ScrollDown(delta)
	}
	svc.autoScroll = svc.viewport.AtBottom()
}

func (m *model) scrollFocusedPage(delta int) {
	svc := m.services[m.focused]
	if delta < 0 {
		svc.viewport.PageUp()
		svc.autoScroll = false
	} else {
		svc.viewport.PageDown()
		svc.autoScroll = svc.viewport.AtBottom()
	}
}

func (m *model) closeLog() {
	if m.logWriter != nil {
		_ = m.logWriter.Flush()
		m.logWriter = nil
	}
	if m.logFile != nil {
		_ = m.logFile.Close()
		m.logFile = nil
	}
	if m.cancelWebhook != nil {
		m.cancelWebhook()
		m.cancelWebhook = nil
	}
}

func (m model) startWebhook() tea.Cmd {
	return func() tea.Msg {
		ctx, cancel := context.WithCancel(context.Background())
		server := &http.Server{
			Addr:              ":9000",
			ReadHeaderTimeout: 5 * time.Second,
		}
		server.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
				return
			}
			body, err := io.ReadAll(r.Body)
			if err != nil {
				http.Error(w, "Invalid payload", http.StatusBadRequest)
				return
			}
			if strings.Contains(string(body), `"ref":"refs/heads/main"`) {
				currentProgram.Send(logMsg{id: proxyService, line: "[Webhook] Push to main detected, pulling changes...", isErr: false})
				out, err := exec.Command("git", "pull").CombinedOutput()
				currentProgram.Send(logMsg{id: proxyService, line: "[Webhook] Git pull: " + strings.TrimSpace(string(out)), isErr: err != nil})
				if err != nil {
					http.Error(w, "Git pull failed", http.StatusInternalServerError)
					return
				}
				currentProgram.Send(restartMsg{id: proxyService, reason: "webhook pulled main"})
				_, _ = w.Write([]byte("OK - pulled changes"))
				return
			}
			_, _ = w.Write([]byte("OK - ignored"))
		})
		m.cancelWebhook = cancel
		go func() {
			<-ctx.Done()
			shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer shutdownCancel()
			_ = server.Shutdown(shutdownCtx)
		}()
		go func() {
			if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				currentProgram.Send(logMsg{id: proxyService, line: "[Webhook] Server failed: " + err.Error(), isErr: true})
			}
		}()
		return logMsg{id: proxyService, line: "[Webhook] GitHub webhook URL: http://localhost:9000/", isErr: false}
	}
}

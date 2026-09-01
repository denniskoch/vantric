package api

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"vantric/internal/hypervisor"
)

// Operations: the work that outlives the request that asked for it.
//
// Cloning a VM, importing a disk, fetching an ISO — none of these
// finish inside an HTTP request, and a form that sits there spinning
// until they do is a form that loses the answer when the laptop sleeps.
// So the handler validates, starts the work, and hands back an
// operation; the console reports it in the notification bell and the
// page moves on. This is GCP's model and its vocabulary: an operation
// is RUNNING, then DONE or ERROR.
//
// It replaces three mechanisms that each tracked one thing — the
// template build registry, raw hypervisor task ids passed to the
// browser to poll, and a create handler that simply blocked.
//
// State is in memory, like the build registry it grew out of. A
// restart forgets what was in flight; it does not stop the hypervisor,
// which carries on and shows up in the next reconciler sweep. The
// alternative — rows in the database — would survive the restart as
// operations stuck at RUNNING with nothing left to advance them, which
// is a worse lie than a cleared list.

const (
	opRunning = "RUNNING"
	opDone    = "DONE"
	// opWarned is work that FINISHED and has something to say. Red means
	// fire, and a warning wearing red teaches you to ignore the bell —
	// which costs you the one time it is red for a reason. Proxmox
	// distinguishes these and so does this.
	opWarned = "WARNING"
	opError  = "ERROR"

	// How many operations to remember. The bell is a recent-activity
	// list, not an audit log.
	opHistory = 100
	// How often a hypervisor-side task is asked whether it's finished.
	opPoll = 2 * time.Second
	// A ceiling for anything running here, so a wedged task can't hold a
	// goroutine forever. Disk imports are the slow case.
	opTimeout = 2 * time.Hour
)

// Operation is one piece of long-running work, as the bell shows it.
type Operation struct {
	ID string `json:"id"`
	// Title is the whole sentence: "Creating instance web-1".
	Title string `json:"title"`
	// Resource and ResourceType say what was touched, so the console
	// knows which lists to refresh when this finishes.
	Resource     string `json:"resource"`
	ResourceType string `json:"resourceType"`
	HypervisorID string `json:"hypervisorId,omitempty"`
	Status       string `json:"status"`
	// Step is the latest thing the work reported; Steps is all of them,
	// in order, for the flows that narrate themselves (template builds).
	Step  string   `json:"step,omitempty"`
	Steps []string `json:"steps,omitempty"`
	Error string   `json:"error,omitempty"`
	// Warning is what a finished task wanted to say. Separate from Error
	// because the work happened either way.
	Warning string `json:"warning,omitempty"`
	// Output is the hypervisor's own task log, fetched when a task ends
	// with anything to say. A status like "WARNINGS: 1" tells you to go
	// and look somewhere else; this is so you don't have to.
	Output []string `json:"output,omitempty"`
	// To is where clicking the notification goes.
	To        string     `json:"to,omitempty"`
	StartedAt time.Time  `json:"startedAt"`
	EndedAt   *time.Time `json:"endedAt,omitempty"`
}

type opRegistry struct {
	mu sync.Mutex
	// Newest first, which is the order the bell wants and the order the
	// history cap trims from the far end of.
	ops []*Operation
}

func newOpRegistry() *opRegistry { return &opRegistry{} }

func (o *opRegistry) start(title, resourceType, resource, serverID, to string) *Operation {
	op := &Operation{
		ID: uuid.NewString(), Title: title,
		Resource: resource, ResourceType: resourceType, HypervisorID: serverID,
		Status: opRunning, To: to, StartedAt: time.Now(),
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	o.ops = append([]*Operation{op}, o.ops...)
	// Trim from the old end, and only what's finished: a long import
	// must not be forgotten because a hundred quick deletes happened
	// while it ran.
	for len(o.ops) > opHistory {
		trimmed := false
		for i := len(o.ops) - 1; i >= 0; i-- {
			if o.ops[i].Status != opRunning {
				o.ops = append(o.ops[:i], o.ops[i+1:]...)
				trimmed = true
				break
			}
		}
		if !trimmed {
			break
		}
	}
	return op
}

func (o *opRegistry) step(id, step string) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if op := o.find(id); op != nil {
		op.Step = step
		op.Steps = append(op.Steps, step)
	}
}

// finish closes an operation out. A message replaces the last step, so
// a finished operation reads as its outcome rather than as whatever it
// happened to be doing last.
func (o *opRegistry) finish(id, message string, err error) {
	o.finishWith(id, message, err, nil)
}

// finishWith is finish plus whatever the task said. An error carrying
// only "the hypervisor reported the task failed" is a dead end; the log
// is where the reason is.
func (o *opRegistry) finishWith(id, message string, err error, output []string) {
	o.mu.Lock()
	defer o.mu.Unlock()
	op := o.find(id)
	if op == nil {
		return
	}
	now := time.Now()
	op.EndedAt = &now
	op.Output = output
	if err != nil {
		op.Status = opError
		op.Error = err.Error()
		return
	}
	op.Status = opDone
	if message != "" {
		op.Step = message
	}
}

// warn marks an operation that finished with something to say. The work
// is done — this is not a failure, and must not be shown as one.
func (o *opRegistry) warn(id, message, warning string, output []string) {
	o.mu.Lock()
	defer o.mu.Unlock()
	op := o.find(id)
	if op == nil {
		return
	}
	now := time.Now()
	op.EndedAt = &now
	op.Status = opWarned
	op.Warning = warning
	op.Output = output
	if message != "" {
		op.Step = message
	}
}

func (o *opRegistry) list() []Operation {
	o.mu.Lock()
	defer o.mu.Unlock()
	out := make([]Operation, 0, len(o.ops))
	for _, op := range o.ops {
		out = append(out, *op)
	}
	return out
}

// dismiss drops one finished operation. A running one stays: hiding
// work that's still happening is how you end up wondering whether it
// happened.
func (o *opRegistry) dismiss(id string) bool {
	o.mu.Lock()
	defer o.mu.Unlock()
	for i, op := range o.ops {
		if op.ID == id {
			if op.Status == opRunning {
				return false
			}
			o.ops = append(o.ops[:i], o.ops[i+1:]...)
			return true
		}
	}
	return false
}

func (o *opRegistry) clearFinished() {
	o.mu.Lock()
	defer o.mu.Unlock()
	kept := o.ops[:0]
	for _, op := range o.ops {
		if op.Status == opRunning {
			kept = append(kept, op)
		}
	}
	o.ops = kept
}

// find must be called with the lock held.
func (o *opRegistry) find(id string) *Operation {
	for _, op := range o.ops {
		if op.ID == id {
			return op
		}
	}
	return nil
}

// run does the work in the background and closes the operation out with
// whatever it returns. The context is deliberately not the request's —
// the request is about to end, and that's the whole point.
func (s *Server) run(op *Operation, done string, work func(ctx context.Context, step func(string)) error) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
		defer cancel()
		err := work(ctx, func(step string) { s.ops.step(op.ID, step) })
		if err != nil {
			s.log.Error("operation failed", "title", op.Title, "error", err)
		}
		s.ops.finish(op.ID, done, err)
	}()
}

// watchTask follows a task the hypervisor is running on its own — an
// image download, a volume delete — so those look the same in the bell
// as the work this console runs itself. Until now their ids were handed
// to the browser to poll, which made every page that started one
// responsible for watching it.
func (s *Server) watchTask(op *Operation, driver hypervisor.Driver, taskID, done string) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
		defer cancel()
		err := awaitTask(ctx, driver, taskID)

		// THE LOG IS FETCHED WHERE IT MATTERS. A clean task has nothing
		// to read and asking for it would be a request per operation for
		// nothing; a task that failed or warned is exactly the one
		// somebody is about to go and look up in the hypervisor's UI.
		var output []string
		if err != nil {
			if lines, logErr := driver.TaskLog(ctx, taskID); logErr == nil {
				output = lines
			} else {
				s.log.Warn("could not read task log", "task", taskID, "error", logErr)
			}
		}

		var warn *taskWarning
		if errors.As(err, &warn) {
			s.log.Info("operation finished with warnings",
				"title", op.Title, "exit", warn.exit)
			s.ops.warn(op.ID, done, warn.exit, output)
			return
		}
		if err != nil {
			s.log.Error("operation failed", "title", op.Title, "error", err)
		}
		s.ops.finishWith(op.ID, done, err, output)
	}()
}

// awaitTask blocks until a hypervisor task ends, and is separate from
// watchTask so an operation can do something of its own once the task
// lands — a restore claims the guest it just made. See restoreBackup.
func awaitTask(ctx context.Context, driver hypervisor.Driver, taskID string) error {
	ticker := time.NewTicker(opPoll)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			status, err := driver.TaskStatus(ctx, taskID)
			if err != nil {
				return err
			}
			if status.Running {
				continue
			}
			if !status.Succeeded {
				return &taskError{exit: status.ExitStatus}
			}
			if status.Warned {
				// Not an error: the caller decides how to show it, and
				// every caller here shows it as a warning.
				return &taskWarning{exit: status.ExitStatus}
			}
			return nil
		}
	}
}

// watchOrFinish follows a hypervisor task where there is one, and
// closes the operation out where there isn't. Not every driver runs
// its work as a task the console can ask about — the mock changes
// state on a timer in memory — and an operation left RUNNING with
// nothing to advance it is the lie this package exists to avoid.
func (s *Server) watchOrFinish(op *Operation, driver hypervisor.Driver, taskID, done string) {
	if taskID == "" || driver == nil {
		s.ops.finish(op.ID, done, nil)
		return
	}
	s.watchTask(op, driver, taskID, done)
}

// taskError carries the hypervisor's own words for a failed task.
// taskWarning is a task that SUCCEEDED and said something. It is an
// error type only because that is how awaitTask reports back; callers
// test for it and finish the operation as a warning.
type taskWarning struct{ exit string }

func (e *taskWarning) Error() string { return e.exit }

type taskError struct{ exit string }

func (e *taskError) Error() string {
	if e.exit == "" {
		return "the hypervisor reported the task failed"
	}
	return e.exit
}

func (s *Server) listOperations(w http.ResponseWriter, r *http.Request) {
	s.json(w, http.StatusOK, s.ops.list())
}

func (s *Server) dismissOperation(w http.ResponseWriter, r *http.Request) {
	if !s.ops.dismiss(chi.URLParam(r, "id")) {
		s.err(w, http.StatusConflict, "operation: still running, or already gone")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) clearOperations(w http.ResponseWriter, r *http.Request) {
	s.ops.clearFinished()
	w.WriteHeader(http.StatusNoContent)
}

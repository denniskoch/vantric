// Package ai defines the abstraction over AI gateways (Bifrost first).
// It mirrors internal/hypervisor, internal/dns, internal/database,
// internal/identity, internal/network, internal/inventory and
// internal/storage: nothing outside internal/ai/* may import a
// gateway's specifics.
//
// WHY A GATEWAY AND NOT THE PROVIDERS THEMSELVES. A lab holding an
// OpenAI key, an Anthropic key and an Ollama box on a desk can ask
// each one what it served — and get three answers that share no
// vocabulary and no clock. The gateway in front of them is the only
// thing that saw the lot, which is exactly this console's rule: read
// the tool that already owns the data rather than inventing a second
// copy of it.
//
// READ ONLY, like Network and Devices. Editing a provider's keys, a
// virtual key's budget or a routing rule is the gateway's own job and
// its own blast radius. What this offers is the question no other
// console here can answer: what did the lab ask of a model, which one
// answered, how long it took and how often it failed.
package ai

import (
	"context"
	"errors"
	"time"

	"vantric/internal/registry"
)

var ErrNotFound = errors.New("ai: not found")

// ErrUnsupported is what a gateway returns for something its version
// or configuration doesn't offer — Bifrost's /metrics 404s unless the
// Prometheus plugin is enabled, which is a fact about the deployment
// rather than a failure of this console.
var ErrUnsupported = errors.New("ai: not offered by this gateway")

// Info is what the gateway reports about itself, for the connection
// check that runs before a record is stored.
type Info struct {
	Version string `json:"version"`
	// Requests is how many the gateway has logged, which is the number
	// that says whether this is the right gateway.
	Requests int64 `json:"requests"`
	// AuthEnabled says whether the gateway is asking anyone for a
	// credential. Bifrost ships with its management API open, so this
	// is reported rather than assumed — a gateway published beyond the
	// LAN with this false is a finding.
	AuthEnabled bool `json:"authEnabled"`
}

// Request is one call the gateway handled, as this console shows it.
//
// The fields are the ones a person scanning a list needs. What was
// asked and what came back stay OUT: prompts and completions are the
// most sensitive thing a gateway holds, they are already one click
// away in the gateway's own UI, and a console that mirrors them turns
// every browser tab into a copy.
type Request struct {
	ID       string    `json:"id"`
	At       time.Time `json:"at"`
	Provider string    `json:"provider"`
	Model    string    `json:"model"`
	Status   string    `json:"status"`
	// LatencyMS is nil where the gateway has none — a request that
	// failed before it was answered never had one, and zero would read
	// as instant.
	LatencyMS *float64 `json:"latencyMs,omitempty"`
	// Tokens are what the model counted. Nil where the gateway didn't
	// record them, for the same reason.
	PromptTokens     *int64 `json:"promptTokens,omitempty"`
	CompletionTokens *int64 `json:"completionTokens,omitempty"`
	TotalTokens      *int64 `json:"totalTokens,omitempty"`
	// Caller is who made the call, in the gateway's own terms — a
	// Bifrost virtual key's name. It is the closest thing to "which of
	// my services did this", which is the question a lab actually asks.
	// Cost is what the gateway priced this one call at, and it is
	// OMITTED WHERE THERE WAS NOTHING TO PRICE — a local model costs
	// nothing and the field simply isn't sent, while a call routed to a
	// paid provider carries one. A pointer rather than a zero, so
	// "free" and "not recorded" stay different answers.
	Cost   *float64 `json:"cost,omitempty"`
	Caller string   `json:"caller,omitempty"`
	// Credential is the upstream key the gateway chose. For Ollama it
	// is the machine's name, which is how a local model shows up as a
	// place rather than as an account.
	Credential string `json:"credential,omitempty"`
	Streamed   bool   `json:"streamed"`
	Kind       string `json:"kind,omitempty"`
}

// RequestError is why a call failed, in the words of whoever refused
// it. WHOSE words matters and is carried: a gateway that blocked the
// call on its own policy and a provider that rejected it are different
// problems with different fixes, and a bare status code makes you
// guess which you have.
type RequestError struct {
	// Kind is the gateway's own classification, e.g. "provider_blocked".
	Kind       string `json:"kind,omitempty"`
	StatusCode int    `json:"statusCode,omitempty"`
	Message    string `json:"message"`
	// FromGateway is true where the gateway refused it rather than
	// passing it upstream.
	FromGateway bool `json:"fromGateway"`
}

// RequestDetail is one call with the facts the list can't carry.
//
// The gateway's list endpoint omits the failure reason entirely — it
// is only on the single-log endpoint — which is the whole reason this
// exists rather than being another column.
//
// WHAT WAS ASKED AND WHAT CAME BACK STAY OUT, here as in the list. The
// prompt, the completion and the raw bodies are all on the same
// response and none of them is carried: they are the most sensitive
// thing the gateway holds, and a console that mirrors them turns every
// browser tab into a copy of the lab's conversations.
type RequestDetail struct {
	Request
	Error *RequestError `json:"error,omitempty"`
	// Retries is how many times the gateway tried before giving up.
	Retries int `json:"retries"`
	// FallbackIndex is which entry in the fallback chain answered; 0 is
	// the first choice.
	FallbackIndex int `json:"fallbackIndex"`
	// RoutingRule is the rule that chose the provider, where one did.
	RoutingRule string `json:"routingRule,omitempty"`
}

// RequestQuery is one page of the log, filtered.
//
// PAGING IS THE GATEWAY'S, not the browser's. Every other table in
// this console pulls its list and sorts it client-side, which works
// because a lab has tens of instances and thousands of CVEs. This log
// has 473,000 rows and grows with every call: the only honest table
// over it is one that asks for a page at a time.
type RequestQuery struct {
	Limit  int
	Offset int
	// SortBy is one of "timestamp", "latency", "tokens", "cost";
	// anything else is the gateway's business to reject.
	SortBy string
	Desc   bool

	Providers []string
	Models    []string
	Status    string
	Callers   []string
	Since     time.Time
	Until     time.Time
	Search    string
}

// RequestPage is a page of requests plus the size of the whole result,
// which is what a pager needs and a slice can't say.
type RequestPage struct {
	Requests []Request `json:"requests"`
	Total    int64     `json:"total"`
}

// Stats summarize the log over the whole period, not the page.
//
// They come from a SEPARATE CALL on purpose. Bifrost embeds a stats
// block in the log response too, and on this lab's gateway it is all
// zeroes beside 473,000 requests — a success rate of 0% stated
// confidently over a working gateway. The dedicated endpoint answers
// 51.6%. Same rule as the SMBIOS serial: a number nobody filled must
// not render as a finding.
type Stats struct {
	Requests    int64   `json:"requests"`
	SuccessRate float64 `json:"successRate"`
	AvgLatency  float64 `json:"avgLatencyMs"`
	TotalTokens int64   `json:"totalTokens"`
	// Cost is what the gateway priced this traffic at, in dollars.
	// Local models cost nothing and still count, so this is a floor on
	// what was spent rather than a measure of what was used.
	Cost float64 `json:"cost"`
}

// Option is a filter value with the id the gateway wants back. A
// caller is picked by name and filtered by id, and conflating the two
// is how a filter silently matches nothing.
type Option struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// TrafficBucket is one interval's worth of requests. Failures are
// carried separately rather than derived, because "how many" and "how
// many went wrong" are the two questions a traffic chart is for, and
// an outage reads as a block of red rather than as a dip.
type TrafficBucket struct {
	At        time.Time `json:"at"`
	Total     int64     `json:"total"`
	Succeeded int64     `json:"succeeded"`
	Failed    int64     `json:"failed"`
}

// Traffic is requests over time, in whatever interval the gateway
// buckets by — stated rather than assumed, since a chart that labels
// hourly buckets as minutes is worse than no chart.
type Traffic struct {
	BucketSeconds int             `json:"bucketSeconds"`
	Buckets       []TrafficBucket `json:"buckets"`
}

// ModelUsage is one model's share of the traffic.
type ModelUsage struct {
	Model     string `json:"model"`
	Provider  string `json:"provider"`
	Requests  int64  `json:"requests"`
	Succeeded int64  `json:"succeeded"`
	Tokens    int64  `json:"tokens"`
	// Cost is what the gateway priced this model's traffic at. Zero for
	// a local model, which is a fact rather than a gap.
	Cost         float64 `json:"cost"`
	AvgLatencyMS float64 `json:"avgLatencyMs"`
}

// GatewayProvider is a model provider as the GATEWAY has it
// configured — which is a different thing from the account at that
// provider (see internal/aiaccount). This says what the gateway can
// reach and with which credentials; that says what is left to spend.
type GatewayProvider struct {
	Name string `json:"name"`
	// Status is the gateway's own word for it, passed through rather
	// than mapped: "active", "unknown". Inventing a vocabulary here
	// would mean deciding what the gateway meant.
	Status string       `json:"status"`
	Keys   []GatewayKey `json:"keys"`
}

// GatewayKey is one upstream credential the gateway holds.
//
// Masked is the gateway's OWN masked form — sk-a************ywAA — and
// this console never asks for more. A key is shown so it can be
// recognised, not so it can be copied.
type GatewayKey struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Masked  string   `json:"masked,omitempty"`
	Models  []string `json:"models"`
	Enabled bool     `json:"enabled"`
	Status  string   `json:"status,omitempty"`
}

// VirtualKey is a credential the gateway issues to a caller — one per
// service in the lab, which is what makes the Caller column on the
// request log mean something.
//
// THE SECRET IS NOT HERE, AND THAT IS DELIBERATE. Bifrost returns a
// virtual key's value in plaintext on the list endpoint, so the driver
// drops it: a console that renders it turns every open browser tab
// into a way to spend money, and nothing on this page needs it. The
// gateway's own UI is where you go to copy one. Same rule as the WiFi
// passphrases Network never reads.
type VirtualKey struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Active bool   `json:"active"`
	// Access is what this key may reach, per provider.
	Access    []VirtualKeyAccess `json:"access"`
	CreatedAt time.Time          `json:"createdAt"`
	// Activity is nil where the gateway wouldn't say — best effort, so
	// a key whose figures don't come back is a key listed without them
	// rather than a page that fails.
	Activity *VirtualKeyActivity `json:"activity,omitempty"`
}

// VirtualKeyActivity is what a key has actually done — the half the
// gateway's own key list doesn't carry, and the reason this console
// asks for it: the gateway lists keys and the log lists callers, and
// nothing joins the two.
type VirtualKeyActivity struct {
	Requests    int64   `json:"requests"`
	SuccessRate float64 `json:"successRate"`
	// Cost is AN ESTIMATE and must be labelled as one wherever it is
	// shown. The gateway prices traffic from its own price list, and a
	// router like OpenRouter picks an upstream per request on
	// availability and other factors — so what was actually charged
	// can be higher or lower than this. It is a guide to which caller
	// is expensive, not a bill.
	Cost float64 `json:"cost"`
	// LastUsed is zero where the key has never been used at all, which
	// is a finding rather than a blank: a credential issued to
	// something that never called is one nobody is watching.
	LastUsed time.Time `json:"lastUsed"`
}

type VirtualKeyAccess struct {
	Provider string `json:"provider"`
	// Models is the gateway's list, in which "*" means all of them.
	Models []string `json:"models"`
}

// Limit is a cap the gateway enforces, and the thing it is attached
// to. Bifrost hangs both a spending budget and a rate limit off a
// "model config" — a scope (a virtual key, a team, a customer) plus a
// model pattern — so one record answers "who is capped, at what, on
// which models", and the join is the gateway's rather than ours.
type Limit struct {
	ID string `json:"id"`
	// Scope is what the cap applies to, in the gateway's own word:
	// "virtual_key", "team", "customer".
	Scope string `json:"scope"`
	// ScopeName is that thing's name — the virtual key's, usually, and
	// therefore the same name the request log shows as the caller.
	ScopeName string `json:"scopeName"`
	// Model is the pattern it covers. "*" is the gateway's word for all
	// of them and must not be printed raw.
	Model     string     `json:"model"`
	Budget    *Budget    `json:"budget,omitempty"`
	RateLimit *RateLimit `json:"rateLimit,omitempty"`
}

// Budget is a spending cap over a period.
type Budget struct {
	// Max and Used are in dollars.
	Max  float64 `json:"max"`
	Used float64 `json:"used"`
	// Period is the gateway's own duration string — "1w", "1d", "1M".
	// Passed through rather than parsed: the console has nothing to add
	// by turning "1M" into a number of days and something to get wrong.
	Period    string    `json:"period"`
	LastReset time.Time `json:"lastReset"`
}

// RateLimit caps how fast, rather than how much.
//
// ONLY THE CAPS ARE CARRIED, not what has been used against them.
// Bifrost's create and update contracts name the four fields below, so
// those are known; the counters on the stored row are not, and this
// lab has no rate limit configured to read one back from. Inventing
// field names would produce a column that is empty for a reason nobody
// could diagnose — see the External IP that no driver ever filled.
type RateLimit struct {
	// Nil where that half isn't set: a limit may cap requests, tokens,
	// or both.
	MaxRequests   *int64 `json:"maxRequests,omitempty"`
	RequestPeriod string `json:"requestPeriod,omitempty"`
	MaxTokens     *int64 `json:"maxTokens,omitempty"`
	TokenPeriod   string `json:"tokenPeriod,omitempty"`
}

// Filters are the values worth offering as a filter, as the gateway
// reports them — so the list of models is the list of models this
// gateway has actually seen, not one this console keeps.
type Filters struct {
	Providers []string `json:"providers"`
	Models    []string `json:"models"`
	Callers   []Option `json:"callers"`
}

// Provider is the AI gateway contract. Implementations must be safe
// for concurrent use.
type Provider interface {
	// Name identifies the implementation, e.g. "bifrost".
	Name() string
	// Check verifies the gateway is reachable and is what it claims to
	// be, before a record is stored.
	Check(ctx context.Context) (*Info, error)
	// Requests returns one page of the request log.
	Requests(ctx context.Context, q RequestQuery) (*RequestPage, error)
	// Request returns one call with its failure reason, which the list
	// endpoint does not carry.
	Request(ctx context.Context, id string) (*RequestDetail, error)
	// Stats summarizes the log for the same filter.
	Stats(ctx context.Context, q RequestQuery) (*Stats, error)
	// Filters lists the values this gateway has seen.
	Filters(ctx context.Context) (*Filters, error)
	// Traffic returns request counts over time for the same filter.
	Traffic(ctx context.Context, q RequestQuery) (*Traffic, error)
	// Rankings summarizes the traffic by model, busiest first.
	Rankings(ctx context.Context, q RequestQuery) ([]ModelUsage, error)
	// GatewayProviders lists the model providers the gateway is
	// configured to reach, with the credentials it holds for each.
	GatewayProviders(ctx context.Context) ([]GatewayProvider, error)
	// VirtualKeys lists the credentials the gateway issues to callers.
	// The query narrows the ACTIVITY on each key, not which keys are
	// listed: a key that did nothing this week is still a key, and
	// hiding it would remove the answer to "which of these is idle".
	VirtualKeys(ctx context.Context, q RequestQuery) ([]VirtualKey, error)
	// Limits lists the spending and rate caps the gateway enforces.
	Limits(ctx context.Context) ([]Limit, error)
}

// Registry holds one live Provider per configured record, keyed by its
// id, so a gateway's HTTP client and its connection are made once
// rather than per request.
type Registry = registry.Of[Provider]

// NewRegistry returns an empty registry.
func NewRegistry() *Registry { return registry.New[Provider]() }

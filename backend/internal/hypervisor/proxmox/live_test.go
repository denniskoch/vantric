package proxmox_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"vantric/internal/hypervisor"
	"vantric/internal/hypervisor/factory"
	"vantric/internal/store"
)

// A real clone against a real hypervisor, skipped unless told where one
// is. It exists because two things in Create cannot be checked any other
// way, and both fail SILENTLY rather than loudly:
//
//   - storage= on the clone. Wrong and the disk lands on the template's
//     pool anyway, which looks exactly like success.
//   - the boot-disk resize. Wrong and the guest carries the template's
//     size, which the reconciler then writes over the requested one, so
//     even the record stops disagreeing.
//
// The credential comes from the console's own database rather than from
// the environment, so running this never puts a Proxmox token on a
// command line.
//
//	VANTRIC_TEST_NODE=kl-dc-2 go test ./internal/hypervisor/proxmox -run Live -v
//
// It creates a VM, checks it, and deletes it. VANTRIC_TEST_KEEP=1 leaves
// it behind for a look.
func TestLiveCreateHonoursStorageAndDiskSize(t *testing.T) {
	node := os.Getenv("VANTRIC_TEST_NODE")
	if node == "" {
		t.Skip("set VANTRIC_TEST_NODE to run this against a real hypervisor")
	}
	// `go test` runs in the PACKAGE directory, not the module root, so a
	// bare "vantric.db" here doesn't find the console's database — it
	// makes an empty one right here, because SQLite creates what it
	// can't open. The default walks back up to backend/.
	dsn := os.Getenv("VANTRIC_TEST_DB")
	if dsn == "" {
		dsn = filepath.Join("..", "..", "..", "vantric.db")
	}
	if _, err := os.Stat(dsn); err != nil {
		t.Fatalf("no database at %s — set VANTRIC_TEST_DB to the console's: %v", dsn, err)
	}

	st, err := store.Open("sqlite", dsn)
	if err != nil {
		t.Fatalf("opening %s: %v", dsn, err)
	}
	defer st.Close()
	ctx := context.Background()

	driver, hv := driverForNode(ctx, t, st, node)
	t.Logf("hypervisor %s, node %s", hv, node)

	// A template on that node, and what its own disk looks like.
	images, err := driver.Images(ctx)
	if err != nil {
		t.Fatalf("listing templates: %v", err)
	}
	var template *hypervisor.Image
	for i := range images {
		if images[i].Node == node {
			template = &images[i]
			break
		}
	}
	if template == nil {
		t.Skipf("no template on %s to clone", node)
	}
	detail, err := driver.Describe(ctx, template.ID)
	if err != nil {
		t.Fatalf("describing template %s: %v", template.ID, err)
	}
	templateDisk := bootDiskOf(detail)
	if templateDisk == nil {
		t.Fatalf("template %s has no boot disk", template.Name)
	}
	templateGB := int(templateDisk.SizeBytes >> 30)
	t.Logf("template %s (%s): %s on %s, %d GB",
		template.Name, template.ID, templateDisk.Interface, templateDisk.Storage, templateGB)

	// A pool that is NOT the template's, so "it landed on the template's
	// storage" and "storage= worked" can't be confused.
	stores, err := driver.Datastores(ctx)
	if err != nil {
		t.Fatalf("listing datastores: %v", err)
	}
	target := ""
	for _, ds := range stores {
		if ds.Node == node && ds.Active && strings.Contains(ds.Content, "images") &&
			ds.Name != templateDisk.Storage {
			target = ds.Name
			break
		}
	}
	if target == "" {
		t.Skipf("only one images-capable pool on %s (%s), nothing to prove storage= against",
			node, templateDisk.Storage)
	}
	wantGB := templateGB + 3
	t.Logf("asking for: storage=%s, disk=%dGB", target, wantGB)

	name := "l-verify-" + time.Now().UTC().Format("150405")
	id, err := driver.Create(ctx, hypervisor.InstanceSpec{
		Name: name, Node: node, ImageID: template.ID,
		CPUs: 1, MemoryMB: 1024,
		Storage: target,
		DiskGB:  wantGB,
	})
	if id != "" && os.Getenv("VANTRIC_TEST_KEEP") == "" {
		defer func() {
			if err := driver.Delete(context.Background(), id); err != nil {
				t.Errorf("LEFT BEHIND: %s (vmid %s) could not be deleted: %v", name, id, err)
				return
			}
			t.Logf("deleted %s (vmid %s)", name, id)
		}()
	}
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	got, err := driver.Describe(ctx, id)
	if err != nil {
		t.Fatalf("describing the new VM: %v", err)
	}
	disk := bootDiskOf(got)
	if disk == nil {
		t.Fatal("the new VM has no boot disk")
	}
	gotGB := int(disk.SizeBytes >> 30)
	t.Logf("got: %s on %s, %d GB", disk.Interface, disk.Storage, gotGB)

	if disk.Storage != target {
		t.Errorf("disk landed on %q, asked for %q — storage= was ignored",
			disk.Storage, target)
	}
	if gotGB != wantGB {
		t.Errorf("disk is %d GB, asked for %d — the resize didn't take", gotGB, wantGB)
	}
}

func driverForNode(ctx context.Context, t *testing.T, st *store.Store, node string) (hypervisor.Driver, string) {
	t.Helper()
	hypervisors, err := st.ListHypervisors(ctx)
	if err != nil {
		t.Fatalf("listing hypervisors: %v", err)
	}
	seen := []string{}
	for i := range hypervisors {
		driver, err := factory.Build(&hypervisors[i])
		if err != nil {
			continue
		}
		nodes, err := driver.Nodes(ctx)
		if err != nil {
			continue
		}
		for _, n := range nodes {
			if n.ID == node {
				return driver, hypervisors[i].Name
			}
			seen = append(seen, hypervisors[i].Name+"/"+n.ID)
		}
	}
	// Naming the alternatives, because the usual reason for landing here
	// is that the node is called something slightly different.
	t.Fatalf("no configured hypervisor reaches node %q; nodes found: %s",
		node, strings.Join(seen, ", "))
	return nil, ""
}

// bootDiskOf picks the disk out of a described VM the same way the
// driver does: the first attached disk that isn't a cdrom.
func bootDiskOf(detail *hypervisor.InstanceDetail) *hypervisor.AttachedDisk {
	for i := range detail.Disks {
		if detail.Disks[i].Media != "cdrom" {
			return &detail.Disks[i]
		}
	}
	return nil
}

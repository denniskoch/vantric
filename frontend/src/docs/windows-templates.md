A Windows template is built by hand, once, and then cloned like any
other. None of the automation that produces a Linux template applies:
there is no Windows cloud image to import, so **Build a cloud template
in this console does not work for Windows**. You install from an ISO,
prepare the machine, and convert it.

This page is the preparation. Get it right once and every clone is
correct; get one part wrong and the clones are subtly broken in a way
that looks like something else entirely.

## Sysprep, or nothing else matters

**Run sysprep with `/generalize` before converting to a template.**

Every Windows installation has a machine SID, and cloning without
generalising gives every clone the same one. Windows will boot and look
fine. What breaks is anything that assumes machines are distinguishable:

- **Domain join fails, or worse, half-works.** A second clone joining
  Active Directory with a duplicate SID can take over the first one's
  computer account.
- WSUS and inventory tools collapse the clones into one record.
- Licensing and activation misbehave.

None of that names the template as the cause, which is why it costs
days. It is the same trap as setting an SMBIOS serial on a template —
inherited by every clone, invisible until something correlates on it —
but with a much larger blast radius.

```
C:\Windows\System32\Sysprep\sysprep.exe /generalize /oobe /shutdown
```

The machine shuts down; convert it to a template from there. If you use
cloudbase-init, its own sysprep unattend file goes in first — see below.

## Installing: virtio comes first

Windows setup cannot see a VirtIO SCSI disk without drivers, so the
install stops at "where do you want to install Windows" with an empty
list. Attach two CD drives before you start:

- your Windows ISO
- the **virtio-win** ISO

At the disk step choose *Load driver* and point it at `vioscsi` on the
virtio media for your Windows version, then the disk appears. Do the
same for `NetKVM` if the network is missing.

Both ISOs are in this console under **Compute → ISO images**, and
virtio-win is downloadable straight from the URL Proxmox fetches with.

> The alternative is installing on SATA and switching to VirtIO
> afterwards, which works and is slower to set up than loading one
> driver at the right moment.

## The guest agent

Same requirement as a Linux guest and a different package. Without it
this console shows no IP address for the VM, no OS information, and
Connect has nothing to reach.

It is on the virtio-win ISO:

```
E:\guest-agent\qemu-ga-x86_64.msi
```

Install it, confirm the **QEMU Guest Agent** service is running, and
tick *Expect the QEMU guest agent* when you create clones. There is no
equivalent of the SELinux and `BLOCK_RPCS` problems that RHEL guests
have — on Windows the agent either is installed or isn't.

## Connect means RDP, and that is a handoff

This console proxies SSH itself, so a Linux guest opens a terminal in
the browser. It does not proxy RDP. A Windows guest's **Connect** hands
your desktop an `rdp://` link and steps out of the way, which has two
consequences worth knowing before you build a fleet of these:

- Your RDP client asks for credentials; this console never sees them and
  cannot manage them. The per-account SSH keys that make a Linux guest's
  auth log say *who* have no Windows equivalent here.
- **Nothing is recorded.** A shell opened on a Linux guest leaves two
  rows in Activity with the account and the duration. An RDP session
  leaves none, because the console isn't in the path.

So in the template, enable Remote Desktop and open the firewall rule:

```
Set-ItemProperty 'HKLM:\System\CurrentControlSet\Control\Terminal Server' `
  -Name fDenyTSConnections -Value 0
Enable-NetFirewallRule -DisplayGroup "Remote Desktop"
```

Whoever should be able to sign in needs to be in **Remote Desktop
Users**, or be an administrator.

## Cloud-init, if you want it

The create form's cloud-init fields are not ignored on Windows — they
are read by **cloudbase-init**, which understands the same drive
Proxmox attaches. But only if it is installed in the template. Without
it, those fields are written to a drive nothing reads, and the clone
comes up with whatever the template had.

Install cloudbase-init before sysprep, and point its unattend file at
sysprep so the two co-operate rather than fighting:

```
C:\Program Files\Cloudbase Solutions\Cloudbase-Init\conf\Unattend.xml
```

What it buys you is a per-clone hostname, an administrator password and
static addressing — the same things the form offers for Linux. What it
will not do is make a non-sysprepped template safe.

## Serial numbers and disks

Two rules carry over unchanged, and one piece of advice doesn't:

**Never set a SMBIOS serial on the template.** The create flow writes
one per instance, defaulting to the instance name. A serial set here is
inherited by every clone, which is the duplicate-host problem the field
exists to prevent — and inventory tools key on it.

**Growing the boot disk at create time is free**, exactly as it is for
Linux: the resize happens before the guest ever starts.

What differs is what happens next. A Linux cloud image runs growpart on
first boot and fills the new space by itself. **Windows does not.** After
a resize the extra space is unallocated until somebody extends the
volume:

```
diskpart
  list volume
  select volume <n>
  extend
```

Or Disk Management, right-click the volume, Extend Volume.

## A template that works

| Step | Why |
| --- | --- |
| Installed with virtio-win attached | Setup can't see a VirtIO disk otherwise |
| `qemu-ga-x86_64.msi` installed and running | IP address, OS info, Connect |
| Remote Desktop enabled, firewall rule on | Connect is RDP, and it's the only way in |
| cloudbase-init installed *(optional)* | Makes the create form's cloud-init fields real |
| No SMBIOS serial on the template | Clones would all share it |
| **Sysprep `/generalize` last** | Clones need their own SID or AD breaks |
| Converted to a template, not left as a VM | A VM shows up in instances, not the picker |

The order matters at the end: sysprep goes last, immediately before the
conversion, because anything you do after it is baked into every clone.

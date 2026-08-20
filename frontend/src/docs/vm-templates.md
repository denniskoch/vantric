A template is a VM you set up once and clone from. Everything a clone
inherits — its login, its keys, its size, its DNS — is whatever the
template had, so the work you do here is the work you don't repeat.

Most of it is ordinary VM setup. This page covers the parts that decide
whether **Connect** works in this console, because those are guest-side
and nothing in the UI can do them for you.

## Why the guest has to help

The browser terminal signs in over real SSH, as the local part of your
email, using a key this console holds for your account. Two things have
to be true inside the guest before that can happen:

- The **guest agent** has to be running, or the console never learns the
  guest's IP address and has nothing to connect to.
- The account has to **exist** with your key in its `authorized_keys`.

The second one the console can do for itself — on the first failed
connect it creates the account through the hypervisor's guest agent and
retries once. That only works if the agent will run a command, which is
where the rest of this page comes in.

## The guest agent

Debian and Ubuntu cloud images **do not ship it**. Ticking "enable guest
agent" when you build a template only sets `agent=1` on the VM, which is
the hypervisor's half of the deal. The guest's half is a package, and
you install it into the image on the Proxmox host before you ever boot
it:

```
apt install libguestfs-tools
virt-customize -a debian-13-generic-amd64.qcow2 --install qemu-guest-agent
```

This console can't do that step for you: reaching the image file means
SSH to the hypervisor host, which is a credential it deliberately
doesn't hold.

Missing the agent degrades exactly the things that read the guest — no
IP address in the instance list, no OS info, and nothing for Connect to
reach — while everything else keeps working. That combination is what
makes it hard to spot.

## Guest exec, on RHEL-family guests

Rocky, Alma, CentOS and RHEL ship `qemu-guest-agent` with the exec and
file commands **blocked**. The agent works, the IP address appears, and
then the first Connect fails with:

```
500 Command guest-exec has been disabled
```

That refusal comes from the guest, not from your Proxmox token — worth
knowing, because a bare 500 sends you auditing token privileges that
were never the problem.

Drop the two exec calls from the block list and leave the file ones
blocked — the console only needs to run a command, and there is no
reason to hand it the ability to read and write arbitrary files as
root while you're there:

```
virt-customize -a your-image.qcow2 \
  --run-command "sed -i 's/,guest-exec,guest-exec-status//' /etc/sysconfig/qemu-ga"
```

Older builds spell the setting `BLACKLIST_RPC`. On a guest that is
already running, edit `/etc/sysconfig/qemu-ga` the same way and
`systemctl restart qemu-guest-agent`.

**SELinux is a separate problem on the same guests.** It confines the
agent tightly enough to deny access to `/usr/sbin/useradd`, so the
provisioning script truthfully reports "not found" about a binary that
is plainly there. Nothing inside the guest can tell that apart from an
image that genuinely lacks the tool, so the console reports what the
guest said and notes that SELinux is present. Such a guest needs its
booleans loosened, or its key installed by hand.

> If you'd rather not fight this: Debian and Ubuntu templates need none
> of it, and are what this lab standardises on.

## Sudo

Creating a login is implied by clicking Connect. Granting root across
every guest in the lab is not, so it's a separate decision and it is
**off by default**.

With `VANTRIC_SSH_PROVISION_SUDO=true` the console writes a
`NOPASSWD:ALL` file into `/etc/sudoers.d/` for the account it creates.
Leave it off and give the account sudo in the template yourself if you
want it — that way the grant is something you made once, in an image you
can inspect, rather than a fleet-wide setting.

If you set it up in the template, the usual form is:

```
usermod -aG sudo <you>        # Debian/Ubuntu
usermod -aG wheel <you>       # RHEL family
```

## Cloud-init

Only one thing here is a trap, and it's the SMBIOS serial.

**Never set a serial on a template.** Clones inherit it, and a fleet of
machines all reporting the same serial is precisely the duplicate-host
problem the field exists to prevent — inventory tools key on it. The
create flow writes a serial per instance, defaulting to the instance
name, which is what you want.

Everything else is inherited on purpose. A template with a user, a key,
a search domain and a sensible disk size produces clones that need none
of those typed again — the create form reads the template and fills its
own blanks from it.

## A template that works

Checked against what Connect actually needs:

| Step | Why |
| --- | --- |
| `qemu-guest-agent` installed in the image | The IP address, OS info, and Connect itself |
| `agent=1` on the VM | The hypervisor's half of the same thing |
| Guest exec not blocked (RHEL family) | Lets the console create your login on first connect |
| `sshd` running and reachable from this console | The terminal is proxied by the server, not your browser |
| No SMBIOS serial on the template | Clones would all share it |
| Converted to a template, not left as a VM | A build interrupted by a restart leaves a VM |

Once it's a template it shows up in the boot-disk picker, named from
the first line of its description if it has one, and from its filename
if it doesn't.

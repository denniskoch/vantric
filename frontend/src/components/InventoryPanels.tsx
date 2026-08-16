import { Fragment, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Box,
  IconButton,
  Chip,
  Link,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Typography,
} from "@mui/material";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import type { InventoryPackage, Vulnerability } from "../api/client";

/**
 * The two tables an inventory service gives you about one machine:
 * what's installed, and what that carries.
 *
 * Shared, because they're the same answer whether you arrived from a
 * VM's OS Info tab or from the host itself — and a second copy would
 * drift the moment one of them gained a column.
 */
export default function InventoryPanels({
  detail,
}: {
  detail: {
    host: { updatedAt: number };
    packages: InventoryPackage[] | null;
    vulnerabilities: Vulnerability[] | null;
  };
}) {
  const collected = detail.host.updatedAt
    ? new Date(detail.host.updatedAt * 1000).toLocaleString()
    : "never";
  // Defended as well as fixed at the source: an empty list arriving as
  // null is a thing JSON APIs do, and a page that renders someone
  // else's data shouldn't be one assumption away from a blank screen.
  const vulnerabilities = detail.vulnerabilities ?? [];
  const packages = detail.packages ?? [];
  return (
    <>
      <Panel
        title="Vulnerabilities"
        collected={collected}
        empty="No known vulnerabilities in the installed packages."
        rows={vulnerabilities.length}
      >
        <VulnerabilityTable vulnerabilities={vulnerabilities} />
      </Panel>

      <Panel
        title="Installed packages"
        collected={collected}
        empty="The agent reported no packages."
        rows={packages.length}
      >
        <PackageTable
          packages={packages.map((p) => ({
            ...p,
            vulnerabilities: p.vulnerabilities ?? [],
          }))}
        />
      </Panel>
    </>
  );
}

function Panel({
  title,
  collected,
  empty,
  rows,
  children,
}: {
  title: string;
  collected: string;
  empty: string;
  rows: number;
  children: React.ReactNode;
}) {
  return (
    <Box sx={{ mt: 3 }}>
      <Typography sx={{ fontSize: 16, color: "text.primary", mb: 1.5 }}>
        {title}
      </Typography>
      <Paper variant="outlined">
        {rows === 0 ? (
          <Typography sx={{ p: 2, fontSize: 13, color: "text.secondary" }}>
            {empty}
          </Typography>
        ) : (
          children
        )}
      </Paper>
      {/* The agent's clock, not ours: a package list is only as true as
          the last time the machine was asked. */}
      <Typography
        sx={{ fontSize: 11, color: "text.disabled", mt: 0.5, textAlign: "right" }}
      >
        Last collected: {collected}
      </Typography>
    </Box>
  );
}

/** Worst first — a list sorted by CVE number buries the one that matters. */
const severityRank: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  MINIMAL: 4,
};

const severityColor: Record<string, string> = {
  CRITICAL: "#d93025",
  HIGH: "#d93025",
  MEDIUM: "#e37400",
  LOW: "#5f6368",
  MINIMAL: "#5f6368",
};

/**
 * One row per CVE, not one per package.
 *
 * A machine carrying an old kernel reports the same flaw once for
 * every installed version — rowlf listed CVE-2012-4542 three times,
 * which is one finding wearing three hats. Grouping collapses that and
 * puts the packages behind an expander, where they belong: the CVE is
 * what you look up, the package list is what you fix.
 */
function VulnerabilityTable({
  vulnerabilities,
}: {
  vulnerabilities: Vulnerability[];
}) {
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(10);
  const [open, setOpen] = useState<string | null>(null);

  // Columns only where the data is. A free Fleet scores nothing, so a
  // Severity column would read MINIMAL for every row — a judgement
  // where there was only an absence. The list page already works this
  // way; this is the same rule, applied where I'd left it out.
  const hasScores = vulnerabilities.some((v) => v.cvssScore > 0);
  const hasPublished = vulnerabilities.some((v) => v.publishedAt > 0);

  const grouped = new Map<string, Vulnerability[]>();
  for (const v of vulnerabilities) {
    grouped.set(v.cve, [...(grouped.get(v.cve) ?? []), v]);
  }
  const rows = [...grouped.entries()]
    .map(([cve, entries]) => ({
      cve,
      entries,
      first: entries[0],
      // A CVE is fixed only where every affected package has an
      // upgrade; one unfixed package means there is still work
      // outstanding, so the row shouldn't claim otherwise.
      fixes: [...new Set(entries.map((e) => e.resolvedInVersion).filter(Boolean))],
      unfixed: entries.some((e) => !e.resolvedInVersion),
    }))
    .sort(
      (a, b) =>
        Number(b.first.knownExploited) - Number(a.first.knownExploited) ||
        (severityRank[a.first.severity] ?? 9) - (severityRank[b.first.severity] ?? 9) ||
        b.first.cvssScore - a.first.cvssScore ||
        b.entries.length - a.entries.length ||
        a.cve.localeCompare(b.cve),
    );
  const shown = rows.slice(page * perPage, page * perPage + perPage);

  return (
    <>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 36 }} />
              <TableCell>CVE</TableCell>
              <TableCell>Affected packages</TableCell>
              <TableCell>Fixed in</TableCell>
              {hasScores && <TableCell>Severity</TableCell>}
              {hasPublished && <TableCell>Published</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {shown.map((row) => (
              <Fragment key={row.cve}>
                <TableRow hover>
                  <TableCell sx={{ width: 36 }}>
                    {row.entries.length > 1 && (
                      <IconButton
                        size="small"
                        aria-label={open === row.cve ? "Hide packages" : "Show packages"}
                        onClick={() => setOpen(open === row.cve ? null : row.cve)}
                      >
                        {open === row.cve ? (
                          <ExpandLessIcon sx={{ fontSize: 16 }} />
                        ) : (
                          <ExpandMoreIcon sx={{ fontSize: 16 }} />
                        )}
                      </IconButton>
                    )}
                  </TableCell>
                  <TableCell>
                    {/* Into the console's own CVE page, not out to NVD —
                      same destination whether you got here from a guest,
                      a host, or the estate-wide list. */}
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Link
                        component={RouterLink}
                        to={`/devices/vulnerabilities/${encodeURIComponent(row.cve)}`}
                        underline="hover"
                      >
                        {row.cve}
                      </Link>
                      {row.first.knownExploited && (
                        <Chip
                          label="Exploited"
                          size="small"
                          sx={{
                            fontSize: 10,
                            height: 18,
                            bgcolor: "surface.errorTint",
                            color: "error.main",
                          }}
                        />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>
                    {row.entries.length === 1
                      ? `${row.first.package} ${row.first.installedVersion}`
                      : `${row.entries.length} packages`}
                  </TableCell>
                  {/* The difference between "patch this" and "wait". */}
                  <TableCell>
                    {row.fixes.length === 0 ? (
                      <Box component="span" sx={{ color: "text.secondary" }}>
                        No fix published
                      </Box>
                    ) : row.fixes.length === 1 && !row.unfixed ? (
                      row.fixes[0]
                    ) : (
                      `${row.fixes.length} versions${row.unfixed ? ", some unfixed" : ""}`
                    )}
                  </TableCell>
                  {hasScores && (
                    <TableCell>
                      <Box component="span" sx={{ color: severityColor[row.first.severity] ?? "#5f6368" }}>
                        {row.first.severity} {row.first.cvssScore.toFixed(1)}
                      </Box>
                    </TableCell>
                  )}
                  {hasPublished && (
                    <TableCell>
                      {row.first.publishedAt
                        ? new Date(row.first.publishedAt * 1000).toLocaleDateString()
                        : "—"}
                    </TableCell>
                  )}
                </TableRow>
                {open === row.cve && (
                  <TableRow>
                    <TableCell colSpan={6} sx={{ bgcolor: "surface.subtle", py: 1 }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Package</TableCell>
                            <TableCell>Installed</TableCell>
                            <TableCell>Fixed in</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {row.entries.map((e) => (
                            <TableRow key={`${e.package}/${e.installedVersion}`}>
                              <TableCell>{e.package}</TableCell>
                              <TableCell>{e.installedVersion || "—"}</TableCell>
                              <TableCell>
                                {e.resolvedInVersion || (
                                  <Box component="span" sx={{ color: "text.secondary" }}>
                                    No fix published
                                  </Box>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={rows.length}
        page={page}
        onPageChange={(_, next) => setPage(next)}
        rowsPerPage={perPage}
        rowsPerPageOptions={[10, 25, 100]}
        onRowsPerPageChange={(e) => {
          setPerPage(Number(e.target.value));
          setPage(0);
        }}
      />
    </>
  );
}

function PackageTable({
  packages,
}: {
  packages: {
    name: string;
    version: string;
    source: string;
    vulnerabilities: Vulnerability[];
  }[];
}) {
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(10);
  const sorted = [...packages].sort((a, b) => a.name.localeCompare(b.name));
  const shown = sorted.slice(page * perPage, page * perPage + perPage);
  return (
    <>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Package</TableCell>
              <TableCell>Version</TableCell>
              <TableCell>Source</TableCell>
              <TableCell align="right">Vulnerabilities</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {shown.map((p) => (
              <TableRow key={`${p.source}/${p.name}/${p.version}`} hover>
                <TableCell>{p.name}</TableCell>
                <TableCell>{p.version}</TableCell>
                <TableCell sx={{ color: "text.secondary" }}>
                  {sourceLabel(p.source)}
                </TableCell>
                <TableCell align="right">
                  {p.vulnerabilities.length > 0 ? (
                    <Box component="span" sx={{ color: "error.main" }}>
                      {p.vulnerabilities.length}
                    </Box>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={sorted.length}
        page={page}
        onPageChange={(_, next) => setPage(next)}
        rowsPerPage={perPage}
        rowsPerPageOptions={[10, 25, 100]}
        onRowsPerPageChange={(e) => {
          setPerPage(Number(e.target.value));
          setPage(0);
        }}
      />
    </>
  );
}

/** osquery's table names, in words: deb_packages is a fact about where
 *  it came from, not a name anybody says out loud. */
function sourceLabel(source: string): string {
  const labels: Record<string, string> = {
    deb_packages: "APT package",
    rpm_packages: "RPM package",
    apk_packages: "APK package",
    python_packages: "Python package",
    npm_packages: "npm package",
    programs: "Windows program",
    apps: "Application",
    chrome_extensions: "Browser extension",
    homebrew_packages: "Homebrew package",
  };
  return labels[source] ?? source;
}

import { useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Box,
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
      <Typography sx={{ fontSize: 16, color: "#202124", mb: 1.5 }}>
        {title}
      </Typography>
      <Paper variant="outlined">
        {rows === 0 ? (
          <Typography sx={{ p: 2, fontSize: 13, color: "#5f6368" }}>
            {empty}
          </Typography>
        ) : (
          children
        )}
      </Paper>
      {/* The agent's clock, not ours: a package list is only as true as
          the last time the machine was asked. */}
      <Typography
        sx={{ fontSize: 11, color: "#80868b", mt: 0.5, textAlign: "right" }}
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

function VulnerabilityTable({
  vulnerabilities,
}: {
  vulnerabilities: Vulnerability[];
}) {
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(10);
  const sorted = [...vulnerabilities].sort(
    (a, b) =>
      (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9) ||
      b.cvssScore - a.cvssScore ||
      a.cve.localeCompare(b.cve),
  );
  // A machine can carry hundreds of these; the same treatment its
  // package list already gets.
  const shown = sorted.slice(page * perPage, page * perPage + perPage);
  return (
    <>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>CVE</TableCell>
              <TableCell>Severity</TableCell>
              <TableCell>Package</TableCell>
              <TableCell>Installed</TableCell>
              <TableCell>Fixed in</TableCell>
              <TableCell>Published</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {shown.map((v) => (
              <TableRow key={`${v.cve}/${v.package}`} hover>
                <TableCell>
                  {/* Into the console's own CVE page, not out to NVD —
                    same destination whether you got here from a guest,
                    a host, or the estate-wide list. */}
                  <Link
                    component={RouterLink}
                    to={`/devices/vulnerabilities/${encodeURIComponent(v.cve)}`}
                    underline="hover"
                  >
                    {v.cve}
                  </Link>
                </TableCell>
                <TableCell>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Box
                      component="span"
                      sx={{ color: severityColor[v.severity] ?? "#5f6368" }}
                    >
                      {v.severity}
                    </Box>
                    {v.cvssScore > 0 && (
                      <Box
                        component="span"
                        sx={{ fontSize: 11, color: "#80868b" }}
                      >
                        {v.cvssScore.toFixed(1)}
                      </Box>
                    )}
                    {/* Known exploited beats any score: it is being used. */}
                    {v.knownExploited && (
                      <Chip
                        label="Exploited"
                        size="small"
                        sx={{
                          fontSize: 10,
                          height: 18,
                          bgcolor: "#fce8e6",
                          color: "#d93025",
                        }}
                      />
                    )}
                  </Box>
                </TableCell>
                <TableCell>{v.package}</TableCell>
                <TableCell>{v.installedVersion || "—"}</TableCell>
                {/* The difference between "patch this" and "wait". */}
                <TableCell>
                  {v.resolvedInVersion || "No fix published"}
                </TableCell>
                <TableCell>
                  {v.publishedAt
                    ? new Date(v.publishedAt * 1000).toLocaleDateString()
                    : "—"}
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
                <TableCell sx={{ color: "#5f6368" }}>
                  {sourceLabel(p.source)}
                </TableCell>
                <TableCell align="right">
                  {p.vulnerabilities.length > 0 ? (
                    <Box component="span" sx={{ color: "#d93025" }}>
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

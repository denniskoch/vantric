import { useMemo, useState } from 'react'
import {
  Box,
  Checkbox,
  IconButton,
  InputBase,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
} from '@mui/material'
import ClearIcon from '@mui/icons-material/Clear'
import SearchIcon from '@mui/icons-material/Search'
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import type {
  ColumnDef,
  RowSelectionState,
  SortingState,
  Table as TanTable,
} from '@tanstack/react-table'
import type { ReactNode } from 'react'

/**
 * The console's table: sortable, paged, and optionally selectable.
 *
 * TanStack Table is HEADLESS — it owns the row model, the sort
 * comparators, the page slicing and the selection state, and renders
 * nothing. Every cell here is still MUI, so the theme, the 28px rows and
 * the GCP look are unchanged; what moves out is the arithmetic.
 *
 * This app is mostly tables — forty-three files draw one — which is the
 * whole argument. Sorting and paging are each a dozen lines you could
 * write by hand, and writing them forty-three times is how one list ends
 * up sorting blanks to the top and another puts its footer in a
 * different place.
 *
 * PINNED TO v8 DELIBERATELY. v9 is what npm installs as latest, and it
 * is a reworked API — features registered per table, state in atoms and
 * stores — whose documentation and examples the ecosystem has not caught
 * up with. v8 does everything these tables need, is what every guide
 * describes, and is the version worth being on until v9's material
 * exists. The bump is a contained one: it lands in this file.
 *
 * SELECTION IS THE PART THAT PAYS. The bulk action bar is a documented
 * pattern here, and "select all" in a header has to mean the rows under
 * it rather than every row in the dataset — otherwise one click arms an
 * action against forty machines you cannot see. That is
 * getIsAllPageRowsSelected, upstream and already correct, rather than a
 * condition each page gets right on its own.
 */
export default function DataTable<T>({
  rows,
  columns,
  getRowId,
  initialSort,
  selection,
  onSelectionChange,
  selectable,
  empty,
  filterPlaceholder = 'Filter',
  searchable = true,
  perPageOptions = [15, 30, 45],
}: {
  rows: T[]
  columns: ColumnDef<T, unknown>[]
  /** Stable id per row — the key, and what selection is reported as. */
  getRowId: (row: T) => string
  initialSort?: SortingState
  /** Selected row ids. Omit for a table nothing is selected in. */
  selection?: string[]
  onSelectionChange?: (ids: string[]) => void
  /** False disables the boxes without removing the column, e.g. for a viewer. */
  selectable?: boolean
  empty?: ReactNode
  /** Wording for the filter box; the column names are a good hint. */
  filterPlaceholder?: string
  searchable?: boolean
  perPageOptions?: number[]
}) {
  const [sorting, setSorting] = useState<SortingState>(initialSort ?? [])
  const [filter, setFilter] = useState('')
  const selectionEnabled = Boolean(onSelectionChange)

  // BLANKS SORT LAST, BOTH WAYS, and this is the only place that can
  // make that true. A guest with no address is not "before A" or "after
  // Z" — it is an absence, and a list that opens with a screenful of
  // dashes because somebody clicked a header twice has answered a
  // question nobody asked.
  //
  // TanStack does exactly this with sortUndefined, which is applied
  // outside the ascending/descending flip so it holds in both
  // directions — but only for `undefined`. Real accessors return '' for
  // a missing address, so they are normalised here rather than in every
  // column definition, where the fourth one would forget.
  const normalised = useMemo(
    () =>
      columns.map((column) => {
        const accessor = (column as { accessorFn?: (row: T, index: number) => unknown }).accessorFn
        if (!accessor) return column
        return {
          ...column,
          accessorFn: (row: T, index: number) => {
            const value = accessor(row, index)
            return value === '' || value === null ? undefined : value
          },
        }
      }),
    [columns],
  )

  const rowSelection: RowSelectionState = {}
  for (const id of selection ?? []) rowSelection[id] = true

  const table = useReactTable({
    data: rows,
    columns: normalised,
    getRowId,
    state: { sorting, rowSelection, globalFilter: filter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    enableRowSelection: selectionEnabled && selectable !== false,
    onRowSelectionChange: (updater) => {
      if (!onSelectionChange) return
      const next = typeof updater === 'function' ? updater(rowSelection) : updater
      onSelectionChange(Object.keys(next).filter((id) => next[id]))
    },
    defaultColumn: { sortUndefined: 'last' },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: perPageOptions[0] } },
  })

  const page = table.getRowModel().rows
  const columnCount = table.getAllLeafColumns().length + (selectionEnabled ? 1 : 0)

  return (
    <TableContainer component={Paper} variant="outlined">
      {/* No box of its own: the strip above the header IS the input,
          so the filter reads as part of the table rather than a control
          parked on top of it. The rule underneath is what separates it
          from the header row. */}
      {searchable && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1.5,
            py: 0.5,
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <SearchIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
          <InputBase
            placeholder={filterPlaceholder}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            sx={{ flex: 1, fontSize: 13 }}
            inputProps={{ 'aria-label': filterPlaceholder }}
          />
          {filter && (
            <IconButton size="small" onClick={() => setFilter('')} aria-label="Clear filter">
              <ClearIcon sx={{ fontSize: 16 }} />
            </IconButton>
          )}
        </Box>
      )}
      <Table size="small">
        <TableHead>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {selectionEnabled && (
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    disabled={page.length === 0 || selectable === false}
                    checked={page.length > 0 && table.getIsAllPageRowsSelected()}
                    indeterminate={table.getIsSomePageRowsSelected()}
                    onChange={table.getToggleAllPageRowsSelectedHandler()}
                    slotProps={{ input: { 'aria-label': 'Select the rows on this page' } }}
                  />
                </TableCell>
              )}
              {group.headers.map((header) => {
                const sortable = header.column.getCanSort()
                const label = flexRender(header.column.columnDef.header, header.getContext())
                return (
                  <TableCell
                    key={header.id}
                    align={alignOf(header.column.columnDef)}
                    sx={{
                      width: header.column.columnDef.size,
                      whiteSpace: nowrapOf(header.column.columnDef),
                    }}
                  >
                    {sortable ? (
                      <TableSortLabel
                        active={Boolean(header.column.getIsSorted())}
                        direction={header.column.getIsSorted() === 'desc' ? 'desc' : 'asc'}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {label}
                      </TableSortLabel>
                    ) : (
                      label
                    )}
                  </TableCell>
                )
              })}
            </TableRow>
          ))}
        </TableHead>
        <TableBody>
          {page.map((row) => (
            <TableRow key={row.id} hover selected={row.getIsSelected()}>
              {selectionEnabled && (
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    disabled={!row.getCanSelect()}
                    checked={row.getIsSelected()}
                    onChange={row.getToggleSelectedHandler()}
                    slotProps={{ input: { 'aria-label': `Select ${row.id}` } }}
                  />
                </TableCell>
              )}
              {row.getVisibleCells().map((cell) => (
                <TableCell
                  key={cell.id}
                  align={alignOf(cell.column.columnDef)}
                  sx={{ whiteSpace: nowrapOf(cell.column.columnDef) }}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
          {page.length === 0 && (empty || filter) && (
            <TableRow>
              <TableCell colSpan={columnCount} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                {/* "Nothing matches" and "there is nothing" are different
                    answers, and showing the second one to somebody who
                    typed a filter reads as data having disappeared. */}
                {filter ? `Nothing matches "${filter}".` : empty}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {table.getRowCount() > 0 && <Pagination table={table} options={perPageOptions} />}
    </TableContainer>
  )
}

/** Column meta carries the alignment, since MUI wants it per cell. */
function alignOf(def: { meta?: unknown }): 'left' | 'right' {
  const meta = def.meta as { align?: 'left' | 'right' } | undefined
  return meta?.align === 'right' ? 'right' : 'left'
}

/**
 * Columns that must not wrap. A timestamp is the case this exists for:
 * "8/21/2026, 11:31:44 PM" is one value, and a table that breaks it
 * across two lines makes the row taller and the column harder to read
 * than simply letting it be as wide as it is.
 */
function nowrapOf(def: { meta?: unknown }): 'nowrap' | undefined {
  const meta = def.meta as { nowrap?: boolean } | undefined
  return meta?.nowrap ? 'nowrap' : undefined
}

function Pagination<T>({ table, options }: { table: TanTable<T>; options: number[] }) {
  const state = table.getState().pagination
  return (
    <TablePagination
      component="div"
      count={table.getRowCount()}
      page={state.pageIndex}
      onPageChange={(_, next) => table.setPageIndex(next)}
      rowsPerPage={state.pageSize}
      rowsPerPageOptions={options}
      onRowsPerPageChange={(e) => table.setPageSize(Number(e.target.value))}
    />
  )
}

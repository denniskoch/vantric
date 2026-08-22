import { Fragment, useMemo, useState } from 'react'
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
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import SearchIcon from '@mui/icons-material/Search'
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import type {
  ColumnDef,
  ExpandedState,
  FilterFn,
  RowData,
  RowSelectionState,
  SortingState,
  Table as TanTable,
} from '@tanstack/react-table'
import type { ReactNode } from 'react'

/**
 * What a column may say about itself beyond how to read and render it.
 *
 * Declared rather than cast, so a typo in `meta` is a compile error and
 * filterText's argument is the row type instead of `any`.
 */
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Right-align the column; MUI wants this per cell. */
    align?: 'left' | 'right'
    /** Keep the value on one line — timestamps, filenames. */
    nowrap?: boolean
    /**
     * Shrink the column to its contents. For a cell holding one icon or
     * one button, where the header word is wider than anything under it.
     */
    hug?: boolean
    /**
     * Cap the column's width in pixels. Needed by any cell that
     * truncates: `text-overflow: ellipsis` does nothing until something
     * constrains the width, so a long description simply takes the
     * table over instead of ending in a "…".
     */
    maxWidth?: number
    /**
     * The text the filter should match for this column, when what is
     * rendered differs from what is sorted on. See searchableText.
     */
    filterText?: (row: TData) => string | undefined
  }
}

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
  renderDetail,
  filterPlaceholder = 'Filter',
  searchable = true,
  perPageOptions = [15, 30, 45],
  server,
  filterValue,
  onFilterChange,
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
  /**
   * Extra detail shown in a row of its own underneath. Return nothing
   * for a row with nothing to add and it gets no expander, so the arrow
   * only appears where there is something behind it.
   */
  renderDetail?: (row: T) => ReactNode
  /** Wording for the filter box; the column names are a good hint. */
  filterPlaceholder?: string
  searchable?: boolean
  perPageOptions?: number[]
  /**
   * Paging and sorting done by whoever holds the data, for a list too
   * long to hold here. Every other table in this console pulls its
   * rows and sorts them in the browser, which is right for tens of
   * instances or thousands of CVEs and wrong for a gateway's request
   * log, where the count is six figures and grows while you read it.
   *
   * Supplying this hands both jobs back: `rows` is one page, `total`
   * is the size of the whole result, and a click on a header or a
   * pager button becomes a request rather than a re-sort.
   */
  server?: {
    total: number
    page: number
    pageSize: number
    sorting: SortingState
    onChange: (next: { page: number; pageSize: number; sorting: SortingState }) => void
  }
  /** Controlled filter box, for a search the server runs. */
  filterValue?: string
  onFilterChange?: (value: string) => void
}) {
  const [sorting, setSorting] = useState<SortingState>(initialSort ?? [])
  const [ownFilter, setOwnFilter] = useState('')
  const controlledFilter = onFilterChange !== undefined
  const filter = controlledFilter ? (filterValue ?? '') : ownFilter
  const setFilter = controlledFilter ? onFilterChange : setOwnFilter
  const [expanded, setExpanded] = useState<ExpandedState>({})
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

  // THE FILTER SEARCHES WHAT YOU CAN SEE, which is not what the table
  // sorts on. A date sorts on a unix timestamp and a size sorts on a
  // byte count, and matching those raw numbers is how a filter becomes
  // unexplainable: typing "2" hits half the rows through values printed
  // nowhere, while "8/21" misses a row displaying exactly that.
  //
  // So only STRINGS take part by default — numbers are for ordering —
  // and a column whose rendering is worth searching says so with
  // meta.filterText. Nothing is matched that isn't on screen.
  const searchableText = useMemo(() => {
    const byId = new Map(normalised.map((column) => [column.id as string, column]))
    const fn: FilterFn<T> = (row, columnId, value) => {
      const needle = String(value).toLowerCase().trim()
      if (!needle) return true
      const meta = byId.get(columnId)?.meta
      const raw = meta?.filterText ? meta.filterText(row.original) : row.getValue(columnId)
      if (typeof raw !== 'string') return false
      return raw.toLowerCase().includes(needle)
    }
    return fn
  }, [normalised])

  const table = useReactTable({
    data: rows,
    columns: normalised,
    getRowId,
    state: {
      sorting: server ? server.sorting : sorting,
      rowSelection,
      globalFilter: filter,
      expanded,
      ...(server ? { pagination: { pageIndex: server.page, pageSize: server.pageSize } } : {}),
    },
    manualPagination: Boolean(server),
    manualSorting: Boolean(server),
    manualFiltering: controlledFilter,
    ...(server ? { rowCount: server.total } : {}),
    onSortingChange: (updater) => {
      if (!server) {
        setSorting(updater)
        return
      }
      const next = typeof updater === 'function' ? updater(server.sorting) : updater
      // A new sort starts at the first page: page 4 of the old order
      // is not a place, and landing there says the click did nothing.
      server.onChange({ page: 0, pageSize: server.pageSize, sorting: next })
    },
    onGlobalFilterChange: setFilter,
    onExpandedChange: setExpanded,
    getRowCanExpand: (row) => Boolean(renderDetail?.(row.original)),
    enableRowSelection: selectionEnabled && selectable !== false,
    onRowSelectionChange: (updater) => {
      if (!onSelectionChange) return
      const next = typeof updater === 'function' ? updater(rowSelection) : updater
      onSelectionChange(Object.keys(next).filter((id) => next[id]))
    },
    defaultColumn: { sortUndefined: 'last' },
    getCoreRowModel: getCoreRowModel(),
    globalFilterFn: searchableText,
    getExpandedRowModel: getExpandedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    ...(server ? {} : { initialState: { pagination: { pageSize: perPageOptions[0] } } }),
  })

  const page = table.getRowModel().rows
  const columnCount =
    table.getAllLeafColumns().length + (selectionEnabled ? 1 : 0) + (renderDetail ? 1 : 0)

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
                <TableCell padding="checkbox" sx={selectionCell}>
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
              {renderDetail && <TableCell sx={expanderCell} />}
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
                      ...hugStyle(header.column.columnDef),
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
            <Fragment key={row.id}>
            <TableRow hover selected={row.getIsSelected()}>
              {renderDetail && (
                <TableCell sx={expanderCell}>
                  {row.getCanExpand() && (
                    <IconButton
                      size="small"
                      aria-label={row.getIsExpanded() ? 'Hide details' : 'Show details'}
                      onClick={row.getToggleExpandedHandler()}
                    >
                      {row.getIsExpanded() ? (
                        <ExpandLessIcon sx={{ fontSize: 16 }} />
                      ) : (
                        <ExpandMoreIcon sx={{ fontSize: 16 }} />
                      )}
                    </IconButton>
                  )}
                </TableCell>
              )}
              {selectionEnabled && (
                <TableCell padding="checkbox" sx={selectionCell}>
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
                  sx={{
                    whiteSpace: nowrapOf(cell.column.columnDef),
                    ...hugStyle(cell.column.columnDef),
                  }}
                >
                  {maxWidthOf(cell.column.columnDef) ? (
                    <Box sx={{ maxWidth: maxWidthOf(cell.column.columnDef), overflow: 'hidden' }}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </Box>
                  ) : (
                    flexRender(cell.column.columnDef.cell, cell.getContext())
                  )}
                </TableCell>
              ))}
            </TableRow>
            {row.getIsExpanded() && (
              <TableRow>
                <TableCell colSpan={columnCount} sx={{ bgcolor: 'surface.subtle' }}>
                  {renderDetail?.(row.original)}
                </TableCell>
              </TableRow>
            )}
            </Fragment>
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
      {table.getRowCount() > 0 && (
        <Pagination table={table} options={perPageOptions} server={server} />
      )}
    </TableContainer>
  )
}

// The checkbox column carried no width, so it absorbed whatever the
// data columns left over — and that depends on how many there are. VM
// instances gave it 88px and containers 60px, which moved the Status
// column 28px sideways as you clicked between two pages that are meant
// to read the same. Pinning it to its content fixes it everywhere at
// once, the way the row height is fixed in the theme rather than per
// page.
// The `&.MuiTableCell-paddingCheckbox` is not decoration: MUI's own
// checkbox-padding rule sets a width and carries two classes, so a
// plain `width` here loses to it.
const selectionCell = { '&.MuiTableCell-paddingCheckbox': { width: '1%' } } as const

// Same reason, and the same lesson: a px width still takes a share of
// the leftover, where a percentage one is held to its content.
const expanderCell = { width: '1%' } as const

/** Column meta carries the alignment, since MUI wants it per cell. */
function alignOf(def: { meta?: { align?: 'left' | 'right' } }): 'left' | 'right' {
  return def.meta?.align === 'right' ? 'right' : 'left'
}

/**
 * Columns that must not wrap. A timestamp is the case this exists for:
 * "8/21/2026, 11:31:44 PM" is one value, and a table that breaks it
 * across two lines makes the row taller and the column harder to read
 * than simply letting it be as wide as it is.
 */
function nowrapOf(def: { meta?: { nowrap?: boolean } }): 'nowrap' | undefined {
  return def.meta?.nowrap ? 'nowrap' : undefined
}

/**
 * Width for a column that should take only what it needs.
 *
 * `width: 1%` is the table idiom for it: a browser laying out an auto
 * table treats a tiny percentage as "give this one its minimum" and
 * hands the slack to the columns that have something to say. Setting a
 * pixel width instead only sets a floor — the column still grows when
 * there is space going spare, which is exactly what made a column
 * holding one 18px icon as wide as one holding a hostname.
 */
function hugStyle(def: { meta?: { hug?: boolean } }) {
  return def.meta?.hug ? { width: '1%', whiteSpace: 'nowrap' as const } : undefined
}

/**
 * Cap a column's width — on the CONTENT, not the cell.
 *
 * A cell's own max-width is decoration in an auto-layout table: the
 * original `maxWidth: 460` on the vulnerability description never capped
 * anything, and the column was 885px wide with the rule sitting right
 * there in the CSS. Nor does a specified width help, because MUI's table
 * is width:100% and the algorithm hands the slack back out however the
 * columns were sized.
 *
 * A block INSIDE the cell is ordinary layout and obeys max-width, so the
 * text stops where it is told and the ellipsis triggers there. The
 * column can still be given space it does not need; what it can no
 * longer do is grow because one cell had a paragraph in it.
 */
function maxWidthOf(def: { meta?: { maxWidth?: number } }) {
  return def.meta?.maxWidth
}

function Pagination<T>({
  table,
  options,
  server,
}: {
  table: TanTable<T>
  options: number[]
  server?: {
    total: number
    page: number
    pageSize: number
    sorting: SortingState
    onChange: (next: { page: number; pageSize: number; sorting: SortingState }) => void
  }
}) {
  const state = table.getState().pagination
  return (
    <TablePagination
      component="div"
      count={table.getRowCount()}
      page={state.pageIndex}
      onPageChange={(_, next) =>
        server
          ? server.onChange({ page: next, pageSize: server.pageSize, sorting: server.sorting })
          : table.setPageIndex(next)
      }
      rowsPerPage={state.pageSize}
      rowsPerPageOptions={options}
      onRowsPerPageChange={(e) =>
        server
          ? server.onChange({ page: 0, pageSize: Number(e.target.value), sorting: server.sorting })
          : table.setPageSize(Number(e.target.value))
      }
    />
  )
}

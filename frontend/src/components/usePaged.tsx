import { useState } from 'react'
import { TablePagination } from '@mui/material'

/**
 * Paging for a table whose rows are already in hand.
 *
 * Every list in this console that can grow past a screenful gets the
 * same treatment, and writing it out each time is how the fourth one
 * ends up with different page sizes or no footer at all. Returns the
 * slice to render and the footer to render under it.
 *
 * Client-side on purpose: these lists arrive whole from a service that
 * counted them anyway, so paging is about what the eye can take, not
 * about what the network can carry.
 */
export function usePaged<T>(rows: T[], initialPerPage = 10) {
  const [page, setPage] = useState(0)
  const [perPage, setPerPage] = useState(initialPerPage)

  // A filter or a reload can shrink the list under a page that no
  // longer exists; showing nothing there would look like no data.
  const lastPage = Math.max(0, Math.ceil(rows.length / perPage) - 1)
  const current = Math.min(page, lastPage)
  const shown = rows.slice(current * perPage, current * perPage + perPage)

  const pagination =
    rows.length > 0 ? (
      <TablePagination
        component="div"
        count={rows.length}
        page={current}
        onPageChange={(_, next) => setPage(next)}
        rowsPerPage={perPage}
        rowsPerPageOptions={[10, 25, 100]}
        onRowsPerPageChange={(e) => {
          setPerPage(Number(e.target.value))
          setPage(0)
        }}
      />
    ) : null

  return { shown, pagination }
}

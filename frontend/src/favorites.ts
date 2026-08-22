import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api/client'

/**
 * The sections pinned to the top of the global menu.
 *
 * ON THE ACCOUNT, not in localStorage. This console is one place you
 * sign in to from a laptop and a desktop, and a favourite that doesn't
 * follow you is a favourite you set twice. It costs one column on
 * iam_users and a self-service endpoint, which the console already had
 * the shape for.
 *
 * Toggling is OPTIMISTIC: the star is a preference, not a transaction,
 * and a star that waits for a round trip before filling in feels
 * broken. A failed save rolls it back.
 */
export function useFavorites() {
  const queryClient = useQueryClient()
  const { data: favorites = [] } = useQuery({
    queryKey: ['favorites'],
    queryFn: api.listFavorites,
    staleTime: 5 * 60_000,
  })

  const save = useMutation({
    mutationFn: api.setFavorites,
    onMutate: async (ids: string[]) => {
      await queryClient.cancelQueries({ queryKey: ['favorites'] })
      const previous = queryClient.getQueryData<string[]>(['favorites'])
      queryClient.setQueryData(['favorites'], ids)
      return { previous }
    },
    onError: (_e, _ids, context) => {
      queryClient.setQueryData(['favorites'], context?.previous ?? [])
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['favorites'] }),
  })

  return {
    favorites,
    isFavorite: (id: string) => favorites.includes(id),
    toggle: (id: string) =>
      save.mutate(
        favorites.includes(id) ? favorites.filter((f) => f !== id) : [...favorites, id],
      ),
  }
}

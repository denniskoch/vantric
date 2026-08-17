/**
 * Running one action against several resources, reported as ONE outcome.
 *
 * Four alerts for four instances is not a report. So every call is
 * issued, none is abandoned because an earlier one failed, and what
 * comes back is a single error naming how many of how many — with one
 * real reason attached, since the first failure is almost always the
 * same as the rest.
 *
 * Shared by VM instances and containers, which raise the same action bar
 * over the same checkbox column and must not drift apart in how they
 * report.
 */
export async function settle<T>(
  names: string[],
  call: (name: string) => Promise<T>,
): Promise<void> {
  const results = await Promise.allSettled(names.map(call))
  const failures = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
  if (failures.length === 0) return
  const reason = (failures[0].reason as Error).message
  throw new Error(
    failures.length === names.length
      ? reason
      : `${failures.length} of ${names.length} failed — ${reason}`,
  )
}

/** Shared bits of the Databases section. */
import type { DatabaseEngine } from './api/client'

export const engineLabels: Record<string, string> = {
  postgres: 'PostgreSQL',
  mysql: 'MySQL / MariaDB',
}

export const defaultPorts: Record<string, number> = {
  postgres: 5432,
  mysql: 3306,
}

/** The database a connection is made to; its catalog views cover the
 *  whole server regardless of which one this is. */
export const defaultDatabase: Record<string, string> = {
  postgres: 'postgres',
  mysql: 'mysql',
}

/** libpq's TLS modes, which MySQL's map onto closely enough. */
export const sslModes = [
  { value: 'prefer', label: 'Prefer — encrypt if the server offers it' },
  { value: 'require', label: 'Require — refuse to connect unencrypted' },
  { value: 'verify-full', label: 'Verify full — require and check the certificate' },
  { value: 'disable', label: 'Disable — never encrypt' },
]

/** The account an admin normally connects as. */
export const defaultUsers: Record<string, string> = {
  postgres: 'postgres',
  mysql: 'root',
}

export const engineDefaults = (engine: DatabaseEngine) => ({
  port: defaultPorts[engine] ?? 5432,
  database: defaultDatabase[engine] ?? '',
  username: defaultUsers[engine] ?? '',
})

import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from './api/client'
import type { Project } from './api/client'

interface ProjectContextValue {
  projects: Project[]
  current: Project | null
  setCurrent: (p: Project) => void
}

const ProjectContext = createContext<ProjectContextValue>({
  projects: [],
  current: null,
  setCurrent: () => {},
})

const STORAGE_KEY = 'lcm.project'

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: api.listProjects,
  })
  const [current, setCurrent] = useState<Project | null>(null)

  useEffect(() => {
    if (current || projects.length === 0) return
    const saved = localStorage.getItem(STORAGE_KEY)
    setCurrent(projects.find((p) => p.name === saved) ?? projects[0])
  }, [projects, current])

  const select = (p: Project) => {
    localStorage.setItem(STORAGE_KEY, p.name)
    setCurrent(p)
  }

  return (
    <ProjectContext.Provider value={{ projects, current, setCurrent: select }}>
      {children}
    </ProjectContext.Provider>
  )
}

export function useProject() {
  return useContext(ProjectContext)
}

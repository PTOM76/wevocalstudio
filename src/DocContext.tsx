// 開いているプロジェクトの文書（useProject の戻り値）を、部品へ props で渡さずに読めるようにする。選択、範囲、プロジェクトを変える操作はここから使う
import { createContext, useContext } from 'react'
import type { useProject } from './useProject'

export type ProjectApi = ReturnType<typeof useProject>

export const DocContext = createContext<ProjectApi | null>(null)

export function useDoc(): ProjectApi {
  const doc = useContext(DocContext)
  if (!doc) throw new Error('DocContext の外では使えない')
  return doc
}

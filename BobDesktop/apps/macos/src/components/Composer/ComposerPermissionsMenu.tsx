import type { BobMode } from '@bob-work/shared-types'
import TaskPermissionsPanel, { taskApprovalSnapshot } from './TaskPermissionsPanel'

interface Props {
  selectedMode: BobMode
  mcpEnabled: boolean
  subagentsEnabled: boolean
}

export default function ComposerPermissionsMenu(props: Props) {
  return <TaskPermissionsPanel {...props} />
}

export { taskApprovalSnapshot }

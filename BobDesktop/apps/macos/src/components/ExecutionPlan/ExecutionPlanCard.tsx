import { useState } from 'react'
import { Check, ChevronDown, Circle, CircleX, LoaderCircle, Minus, Pause, Pin } from 'lucide-react'
import type { ExecutionPlan, ExecutionPlanStepStatus } from '../../lib/executionPlan'
import { executionPlanProgress } from '../../lib/executionPlan'
import { useT } from '../../i18n'

function StatusIcon({ status }: { status: ExecutionPlanStepStatus }) {
  if (status === 'completed') return <Check aria-hidden="true" />
  if (status === 'running') return <LoaderCircle aria-hidden="true" />
  if (status === 'paused') return <Pause aria-hidden="true" />
  if (status === 'failed') return <CircleX aria-hidden="true" />
  if (status === 'skipped') return <Minus aria-hidden="true" />
  return <Circle aria-hidden="true" />
}

export function ExecutionPlanCard({ plan, live }: { plan: ExecutionPlan; live: boolean }) {
  const t = useT()
  const [collapsed, setCollapsed] = useState(false)
  const progress = executionPlanProgress(plan)
  const complete = progress.completed === progress.total
  return (
    <section className={`execution-plan-card${live ? ' is-live' : ''}${complete ? ' is-complete' : ''}`} aria-label={t('chat.executionPlan')}>
      <button
        type="button"
        className="execution-plan-card__header"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed(value => !value)}
      >
        <span className="execution-plan-card__title">
          <Pin size={14} aria-hidden="true" />
          <strong>{plan.title || t('chat.executionPlan')}</strong>
        </span>
        <span className="execution-plan-card__count">{t('chat.executionPlanProgress', { completed: progress.completed, total: progress.total })}</span>
        <ChevronDown className="execution-plan-card__chevron" size={15} aria-hidden="true" />
      </button>
      <div className="execution-plan-card__progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}>
        <span style={{ width: `${progress.percent}%` }} />
      </div>
      {!collapsed ? (
        <ol className="execution-plan-card__steps">
          {plan.steps.map((step, index) => {
            const displayedStatus = !live && step.status === 'running' ? 'paused' : step.status
            return (
              <li className={`is-${displayedStatus}`} key={step.id}>
                <span className="execution-plan-card__status"><StatusIcon status={displayedStatus} /></span>
                <span><strong>{index + 1}. {step.title}</strong>{step.detail ? <small>{step.detail}</small> : null}</span>
                <em>{t(`chat.executionPlanStatus.${displayedStatus}` as any)}</em>
              </li>
            )
          })}
        </ol>
      ) : null}
    </section>
  )
}

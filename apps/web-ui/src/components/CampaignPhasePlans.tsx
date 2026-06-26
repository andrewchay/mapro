import type { Campaign } from '@ma-proma/shared'

interface CampaignPhasePlansProps {
  campaign: Campaign
}

export function CampaignPhasePlans({ campaign }: CampaignPhasePlansProps) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <h3 className="text-lg font-semibold text-slate-900">三阶段计划</h3>
      <div className="mt-4 space-y-3">
        {campaign.phasePlans.map((phase) => (
          <div
            key={phase.phase}
            className={`rounded-lg border p-4 ${
              phase.phase === campaign.currentPhase
                ? 'border-blue-300 bg-blue-50'
                : 'border-slate-200 bg-slate-50'
            }`}
          >
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-slate-900">
                阶段 {phase.phase}：{phase.name}
              </h4>
              <span className="text-sm text-slate-500">{phase.months}</span>
            </div>
            <p className="text-sm text-slate-600 mt-1">{phase.goal}</p>
            <p className="text-sm text-slate-500 mt-2">预算：¥{(phase.budget ?? 0).toLocaleString()}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

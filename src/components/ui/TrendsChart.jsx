import { cn } from '@/lib/utils'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'

export default function TrendsChart({ data, xKey, yKey, yFormatter, className, lineColor = '#6366f1' }) {
  return (
    <div className={cn('w-full h-72', className)}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
          <XAxis dataKey={xKey} tick={{ fontSize: 12 }} stroke="#94a3b8" />
          <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="#94a3b8" tickFormatter={yFormatter} />
          <Tooltip formatter={(v, name) => [yFormatter ? yFormatter(v) : v, name]} labelStyle={{ color: '#64748b' }} />
          <Line type="monotone" dataKey={yKey} stroke={lineColor} strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}


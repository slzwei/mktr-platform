import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Car } from "lucide-react";

const statusColor = (status) => {
  if (status === 'active') return 'bg-green-100 text-green-800';
  if (status === 'maintenance') return 'bg-yellow-100 text-yellow-800';
  return 'bg-gray-100 text-gray-800';
};

function getCommissionCarId(commission) {
  return commission.carId || commission.car_id || commission.vehicleId
    || commission.metadata?.carId || commission.metadata?.car_id || null;
}

export default function VehiclePerformance({ cars, commissions }) {
  const vehicleStats = useMemo(() => {
    const earningsByCarId = {};

    for (const c of commissions) {
      const linkedCarId = getCommissionCarId(c);
      if (linkedCarId) {
        earningsByCarId[linkedCarId] = (earningsByCarId[linkedCarId] || 0) + Number(c.amount_fleet || 0);
      }
    }

    return cars
      .map(car => ({
        ...car,
        earnings: earningsByCarId[car.id] || 0
      }))
      .sort((a, b) => b.earnings - a.earnings);
  }, [cars, commissions]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-500" />
            Vehicle Performance
          </CardTitle>
        </div>
        <p className="text-sm text-gray-500">Earnings by vehicle</p>
      </CardHeader>
      <CardContent className="p-0">
        {vehicleStats.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 font-medium border-b">
              <tr>
                <th className="px-6 py-3 text-left">Vehicle</th>
                <th className="px-6 py-3 text-left">Status</th>
                <th className="px-6 py-3 text-right">Earnings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {vehicleStats.map(v => (
                <tr key={v.id} className="hover:bg-gray-50/50">
                  <td className="px-6 py-3">
                    <div>
                      <p className="font-medium text-gray-900">{v.plate_number}</p>
                      <p className="text-xs text-gray-400">{v.make || v.model || 'Unknown'} {v.color ? `• ${v.color}` : ''}</p>
                    </div>
                  </td>
                  <td className="px-6 py-3">
                    <Badge className={statusColor(v.status)}>{v.status}</Badge>
                  </td>
                  <td className="px-6 py-3 text-right font-semibold">
                    ${v.earnings.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-center py-8 text-gray-400">
            <Car className="w-10 h-10 mx-auto mb-2" />
            <p className="text-sm">No vehicle data available</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

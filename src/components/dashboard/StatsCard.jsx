import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import ArrowRight from "lucide-react/icons/arrow-right";
import TrendingUp from "lucide-react/icons/trending-up";
import { Link } from "react-router-dom";

export default function StatsCard({ title, value, icon: Icon, bgColor, trend, linkTo }) {
  const CardWrapper = linkTo ? Link : 'div';

  return (
    <CardWrapper to={linkTo} className={`${linkTo ? "block" : ""} h-full group`}>
      <Card className={`relative overflow-hidden ${linkTo ? 'hover:shadow-lg transition-shadow cursor-pointer' : ''} h-full flex flex-col`}>
        <div className={`absolute top-0 right-0 w-32 h-32 transform translate-x-8 -translate-y-8 ${bgColor} rounded-full opacity-10`} />
        <CardHeader className="p-6 flex-1 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-500">{title}</p>
                <CardTitle className="text-2xl lg:text-3xl font-bold mt-2 text-gray-900">
                  {value}
                </CardTitle>
                {trend && (
                  <div className="flex items-center mt-3 text-sm">
                    <TrendingUp className="w-4 h-4 mr-1 text-green-500" />
                    <span className="text-gray-600">{trend}</span>
                  </div>
                )}
              </div>
              <div className={`p-3 rounded-xl ${bgColor} bg-opacity-20 shrink-0`}>
                <Icon className={`w-6 h-6 ${bgColor.replace('bg-', 'text-')}`} />
              </div>
            </div>
          </div>
          <div className="flex justify-end mt-4">
              {linkTo && (
                <ArrowRight className="w-4 h-4 text-gray-400 group-hover:text-gray-600 transition-colors" />
              )}
          </div>
        </CardHeader>
      </Card>
    </CardWrapper>
  );
}
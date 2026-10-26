import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';

interface ChartProps {
  option: EChartsOption;
  height?: number | string;
  className?: string;
}

export default function Chart({ option, height = 320, className }: ChartProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption(option);
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [option]);

  const styleHeight = typeof height === 'number' ? `${height}px` : height;
  return <div ref={ref} className={className} style={{ width: '100%', height: styleHeight }} />;
}
